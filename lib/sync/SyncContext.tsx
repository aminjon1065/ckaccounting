import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
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
  triggerSync: () => Promise<void>;
  refreshProducts: (forceFullSync?: boolean) => Promise<void>;
  fetchRemoteDebts: () => Promise<void>;
  fetchRemoteShops: () => Promise<void>;
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
  triggerSync: async () => {},
  refreshProducts: async () => {},
  fetchRemoteDebts: async () => {},
  fetchRemoteShops: async () => {},
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

  const { token, user, tokenExpired } = useAuth();

  // Always-current refs — avoid stale closures in event handlers and callbacks
  const authRef = useRef({ token: token ?? "", shopId: user?.shop_id });
  authRef.current = { token: token ?? "", shopId: user?.shop_id };

  // FIX (Bug 2): Mirror reactive state into refs so triggerSync never reads stale values
  const isOnlineRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const tokenExpiredRef = useRef(false);
  isOnlineRef.current = isOnline;
  tokenRef.current = token;
  tokenExpiredRef.current = tokenExpired;

  const syncLock = useRef(false);
  const consecutiveFailuresRef = useRef(0);

  // FIX (Bug 1): Track reconnect requests that arrive while a sync is already running
  const pendingReconnectSync = useRef(false);

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
    try {
      await orchestrator.current.syncAll(forceFullSync);
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

      // Drain any reconnect sync that arrived while we were busy
      if (pendingReconnectSync.current) {
        pendingReconnectSync.current = false;
        // Defer one tick so the React tree can process the lock-release state update
        setTimeout(() => runSync(), 0);
      }
    }
  }, [refreshPendingActions]);

  // ─── Manual foreground sync trigger (outbox only, not full pull) ────────────

  // FIX (Bug 2): Read from refs so AppState event handlers always see current values
  const triggerSync = useCallback(async () => {
    if (!isOnlineRef.current || !tokenRef.current || syncLock.current || tokenExpiredRef.current) return;
    syncLock.current = true;
    setIsSyncing(true);
    try {
      await orchestrator.current.syncOutbox(async () => {
        consecutiveFailuresRef.current = 0;
        await refreshPendingActions();
        setLastSyncedAt(new Date());
      });
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
    if (!isOnline || !token || tokenExpired) return;
    await orchestrator.current.refreshAll(forceFullSync);
  }, [isOnline, token, tokenExpired]);

  const fetchRemoteDebts = useCallback(async () => {
    if (!isOnline || !token || tokenExpired) return;
    await orchestrator.current.refreshAll();
  }, [isOnline, token, tokenExpired]);

  const fetchRemoteShops = useCallback(async () => {
    if (!isOnline || !token || tokenExpired) return;
    await orchestrator.current.refreshAll();
  }, [isOnline, token, tokenExpired]);

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

  return (
    <SyncContext.Provider
      value={{
        isOnline,
        isSyncing,
        lastSyncedAt,
        pendingActionsCount,
        deadActionsCount,
        failedActionsCount: failedActions.length,
        failedActions,
        triggerSync,
        refreshProducts,
        fetchRemoteDebts,
        fetchRemoteShops,
        refreshPendingActions,
        clearFailedActions: async () => {
          await archiveSyncActions("'failed', 'dead'");
          setFailedActions([]);
        },
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}
