import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Alert } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  getDb,
  archiveSyncActions,
  type SyncAction,
} from "../db";
import { useAuth } from "@/store/auth";
import { SyncOrchestrator } from "./SyncOrchestrator";

// ─── Context type ──────────────────────────────────────────────────────────────

interface SyncContextType {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  pendingActionsCount: number;
  deadActionsCount: number;
  failedActionsCount: number;
  failedActions: SyncAction[];
  triggerSync: () => Promise<boolean>;
  /**
   * Force a full outbox + remote-pull cycle and await its completion.
   * Returns true if a sync ran (or piggy-backed on an in-flight one),
   * false if the device is offline / unauthenticated.
   * Used by the login screen to gate navigation on the initial data load.
   */
  runFullSync: () => Promise<boolean>;
  refreshProducts: (forceFullSync?: boolean) => Promise<void>;
  fetchRemoteDebts: () => Promise<void>;
  fetchRemoteShops: () => Promise<void>;
  /** Pull older sales beyond the local window. Returns true if more remain. */
  fetchOlderSales: (pages?: number) => Promise<boolean>;
  fetchOlderExpenses: (pages?: number) => Promise<boolean>;
  fetchOlderPurchases: (pages?: number) => Promise<boolean>;
  /** Drain all historical pages for products, shops, sales, expenses, and purchases. */
  fetchAllHistory: (
    onProgress?: (s: { entity: "products" | "shops" | "sales" | "expenses" | "purchases"; pagesPulled: number }) => void
  ) => Promise<void>;
  refreshPendingActions: () => Promise<void>;
  clearFailedActions: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType>({
  isOnline: true,
  isSyncing: false,
  lastSyncedAt: null,
  pendingActionsCount: 0,
  deadActionsCount: 0,
  failedActionsCount: 0,
  failedActions: [],
  triggerSync: async () => false,
  runFullSync: async () => false,
  refreshProducts: async () => {},
  fetchRemoteDebts: async () => {},
  fetchRemoteShops: async () => {},
  fetchOlderSales: async () => false,
  fetchOlderExpenses: async () => false,
  fetchOlderPurchases: async () => false,
  fetchAllHistory: async () => {},
  refreshPendingActions: async () => {},
  clearFailedActions: async () => {},
});

// ─── SyncProvider ──────────────────────────────────────────────────────────────

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [pendingActionsCount, setPendingActionsCount] = useState(0);
  const [deadActionsCount, setDeadActionsCount] = useState(0);
  const [failedActions, setFailedActions] = useState<SyncAction[]>([]);

  const { token, user, tokenExpired, pinSetupPending } = useAuth();

  // Always-current refs — avoid stale closures in event handlers and callbacks
  const authRef = useRef({ token: token ?? "", shopId: user?.shop_id, role: user?.role, userId: user?.id });
  authRef.current = { token: token ?? "", shopId: user?.shop_id, role: user?.role, userId: user?.id };

  // FIX (Bug 2): Mirror reactive state into refs so triggerSync never reads stale values
  const isOnlineRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const tokenExpiredRef = useRef(false);
  const pinSetupPendingRef = useRef(false);
  isOnlineRef.current = isOnline;
  tokenRef.current = token;
  tokenExpiredRef.current = tokenExpired;
  pinSetupPendingRef.current = pinSetupPending;

  const syncLock = useRef(false);
  const consecutiveFailuresRef = useRef(0);

  // FIX (Bug 1): Track reconnect requests that arrive while a sync is already running
  const pendingReconnectSync = useRef(false);

  // Promise that resolves when the currently-running sync finishes. Lets
  // runFullSync() piggy-back on an in-flight sync triggered by the auto
  // [isOnline, token] effect instead of returning early. Cleared when no
  // sync is running.
  const inFlightSyncRef = useRef<Promise<void> | null>(null);

  const orchestrator = useRef(
    new SyncOrchestrator(() => authRef.current)
  );

  // ─── Refresh counts ─────────────────────────────────────────────────────────

  const refreshPendingActions = useCallback(async () => {
    const { pending, dead, failed } = await orchestrator.current.refreshCounts();
    setPendingActionsCount(pending);
    setDeadActionsCount(dead);
    setFailedActions(failed);
  }, []);

  // ─── Core sync runner (shared by reconnect effect, periodic timer, manual trigger) ─

  // Skip the heavy remote-fetch leg if a successful sync just happened.
  // Reconnect events on flaky networks would otherwise trigger a full
  // pull every few seconds.
  const FULL_SYNC_COOLDOWN_MS = 30_000;
  const lastFullSyncAtRef = useRef<number>(0);

  // FIX (Bug 1): Single sync runner that drains pending reconnect requests
  const runSync = useCallback(async (forceFullSync = false) => {
    if (syncLock.current) {
      // A sync is already in flight — mark the pending reconnect so it's
      // re-run as soon as the lock is released (instead of being silently dropped).
      pendingReconnectSync.current = true;
      return;
    }
    syncLock.current = true;
    setIsSyncing(true);
    let resolveDone: (() => void) | undefined;
    inFlightSyncRef.current = new Promise<void>((resolve) => { resolveDone = resolve; });
    try {
      const sinceLast = Date.now() - lastFullSyncAtRef.current;
      const shouldDoFullSync = forceFullSync || sinceLast >= FULL_SYNC_COOLDOWN_MS;
      if (shouldDoFullSync) {
        await orchestrator.current.syncAll(forceFullSync);
        lastFullSyncAtRef.current = Date.now();
      } else {
        // Cheap path: just drain the outbox so user-created data ships out,
        // skip the 6-fetcher remote pull until cooldown expires.
        await orchestrator.current.syncOutbox();
      }
      consecutiveFailuresRef.current = 0;
      setLastSyncedAt(new Date());
    } catch (e) {
      console.error(e);
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3) {
        consecutiveFailuresRef.current = 0;
        Alert.alert(
          "Ошибка синхронизации",
          "Синхронизация не удалась несколько раз подряд. Проверьте подключение к интернету.",
          [{ text: "OK" }]
        );
      }
    } finally {
      await refreshPendingActions().catch(console.error);
      setIsSyncing(false);
      syncLock.current = false;
      resolveDone?.();
      inFlightSyncRef.current = null;

      // Drain any reconnect sync that arrived while we were busy
      if (pendingReconnectSync.current) {
        pendingReconnectSync.current = false;
        // Defer one tick so the React tree can process the lock-release state update
        setTimeout(() => runSync(), 0);
      }
    }
  }, [refreshPendingActions]);

  // Public wrapper: forces a full sync and awaits actual completion. If a
  // sync is already running (e.g. kicked by the [isOnline, token] effect on
  // first login), piggy-back on its in-flight promise instead of skipping.
  const runFullSync = useCallback(async (): Promise<boolean> => {
    if (!isOnlineRef.current || !tokenRef.current || tokenExpiredRef.current) return false;
    if (syncLock.current && inFlightSyncRef.current) {
      try { await inFlightSyncRef.current; } catch {}
      return true;
    }
    await runSync(true);
    return true;
  }, [runSync]);

  // ─── Manual foreground sync trigger (outbox only, not full pull) ────────────

  // FIX (Bug 2): Read from refs so AppState event handlers always see current values
  const triggerSync = useCallback(async (): Promise<boolean> => {
    if (!isOnlineRef.current || !tokenRef.current || syncLock.current || tokenExpiredRef.current) return false;
    syncLock.current = true;
    setIsSyncing(true);
    try {
      await orchestrator.current.syncOutbox(async () => {
        consecutiveFailuresRef.current = 0;
        await refreshPendingActions();
        setLastSyncedAt(new Date());
      });
      return true;
    } finally {
      setIsSyncing(false);
      syncLock.current = false;

      if (pendingReconnectSync.current) {
        pendingReconnectSync.current = false;
        setTimeout(() => runSync(), 0);
      }
    }
  }, [refreshPendingActions, runSync]);

  // ─── Individual fetcher wrappers (for context consumers) ───────────────────

  const refreshProducts = useCallback(async (forceFullSync = false) => {
    if (!isOnlineRef.current || !tokenRef.current || tokenExpiredRef.current) return;
    await orchestrator.current.refreshAll(forceFullSync);
  }, []);

  const fetchRemoteDebts = useCallback(async () => {
    if (!isOnlineRef.current || !tokenRef.current || tokenExpiredRef.current) return;
    await orchestrator.current.refreshDebts();
  }, []);

  const fetchRemoteShops = useCallback(async () => {
    if (!isOnlineRef.current || !tokenRef.current || tokenExpiredRef.current) return;
    await orchestrator.current.refreshShops();
  }, []);

  const fetchOlderSales = useCallback(async (pages = 5): Promise<boolean> => {
    if (!isOnlineRef.current || !tokenRef.current || tokenExpiredRef.current) return false;
    return orchestrator.current.fetchOlderSales(pages);
  }, []);

  const fetchOlderExpenses = useCallback(async (pages = 5): Promise<boolean> => {
    if (!isOnlineRef.current || !tokenRef.current || tokenExpiredRef.current) return false;
    return orchestrator.current.fetchOlderExpenses(pages);
  }, []);

  const fetchOlderPurchases = useCallback(async (pages = 5): Promise<boolean> => {
    if (!isOnlineRef.current || !tokenRef.current || tokenExpiredRef.current) return false;
    return orchestrator.current.fetchOlderPurchases(pages);
  }, []);

  const fetchAllHistory = useCallback(
    async (onProgress?: (s: { entity: "products" | "shops" | "sales" | "expenses" | "purchases"; pagesPulled: number }) => void) => {
      if (!isOnlineRef.current || !tokenRef.current || tokenExpiredRef.current) return;
      await orchestrator.current.fetchAllHistory(onProgress);
    },
    []
  );

  // ─── Mount: NetInfo subscription ────────────────────────────────────────────

  useEffect(() => {
    refreshPendingActions().catch(console.error);

    const unsubscribe = NetInfo.addEventListener((state: any) => {
      // Use !== false so that null ("unknown/probing" on Android) is treated as online.
      // === true would keep Android permanently offline on devices that never resolve
      // isInternetReachable, because the OS skips the ping on many Android versions.
      setIsOnline(!!state.isConnected && state.isInternetReachable !== false);
    });

    return () => unsubscribe();
  }, []);

  // ─── Online / token change: run full sync cycle ─────────────────────────────

  useEffect(() => {
    if (isOnline && token && !tokenExpired) {
      // FIX (Bug 1): runSync() now queues reconnect sync if lock is held,
      // instead of silently dropping it.
      runSync();
    } else {
      refreshPendingActions().catch(console.error);
    }
  }, [isOnline, token, tokenExpired]);

  // ─── Low-stock check after products have synced ─────────────────────────────

  useEffect(() => {
    if (!isOnline || !token || !user?.shop_id || tokenExpired) return;
    const timer = setTimeout(() => {
      orchestrator.current.checkLowStock().catch(console.error);
    }, 2_000);
    return () => clearTimeout(timer);
  }, [isOnline, token, user?.shop_id, tokenExpired]);

  // ─── Periodic sync every 60 s ───────────────────────────────────────────────

  useEffect(() => {
    if (!isOnline || !token || tokenExpired) return;
    const interval = setInterval(() => {
      // runSync() handles the lock internally — no double-check needed here
      runSync();
    }, 60_000);
    return () => clearInterval(interval);
  }, [isOnline, token, tokenExpired, runSync]);

  // ─── Context value ──────────────────────────────────────────────────────────
  // Memoize so consumers (every screen via useSync) don't re-render on
  // unrelated provider re-renders.

  const clearFailedActions = useCallback(async () => {
    await archiveSyncActions(["failed", "dead"]);
    setFailedActions([]);
  }, []);

  const value = useMemo<SyncContextType>(
    () => ({
      isOnline,
      isSyncing,
      lastSyncedAt,
      pendingActionsCount,
      deadActionsCount,
      failedActionsCount: failedActions.length,
      failedActions,
      triggerSync,
      runFullSync,
      refreshProducts,
      fetchRemoteDebts,
      fetchRemoteShops,
      fetchOlderSales,
      fetchOlderExpenses,
      fetchOlderPurchases,
      fetchAllHistory,
      refreshPendingActions,
      clearFailedActions,
    }),
    [
      isOnline,
      isSyncing,
      lastSyncedAt,
      pendingActionsCount,
      deadActionsCount,
      failedActions,
      triggerSync,
      runFullSync,
      refreshProducts,
      fetchRemoteDebts,
      fetchRemoteShops,
      fetchOlderSales,
      fetchOlderExpenses,
      fetchOlderPurchases,
      fetchAllHistory,
      refreshPendingActions,
      clearFailedActions,
    ]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  return useContext(SyncContext);
}
