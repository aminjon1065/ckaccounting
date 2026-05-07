import React, { createContext, useContext, useEffect, useCallback, useMemo, useRef } from "react";
import { Alert } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { archiveSyncActions, type SyncAction } from "../db";
import { useAuth } from "@/store/auth";
import { SyncOrchestrator, type HistoryProgress } from "./SyncOrchestrator";
import { SyncCoordinator, type CoordinatorState } from "./SyncCoordinator";
import { createSyncExecutor } from "./syncExecutor";
import { SyncLockBusyError } from "./syncLock";
import { useSyncStore } from "./syncStore";
import { reportError } from "@/lib/observability/reporter";

// ─── Methods-only context ────────────────────────────────────────────────────
//
// The methods half of the sync surface stays on Context: stable callbacks
// that never change identity, so consumers don't re-render when sync state
// transitions (those go through the Zustand store now).
//
// Layered hooks:
//   • `useSyncMethods()` — methods only, stable.
//   • `useIsSyncing()`, `useIsOnline()`, `usePendingActionsCount()`, etc.
//     — fine-grained selectors over the Zustand store.
//   • `useSync()` — backward-compat fat hook returning state + methods.
//     New code should prefer the narrower hooks; this stays for legacy
//     callsites that haven't been migrated yet.

export interface SyncMethods {
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
  /** Drain all historical pages for every offline-relevant entity. */
  fetchAllHistory: (onProgress?: (s: HistoryProgress) => void) => Promise<void>;
  refreshPendingActions: () => Promise<void>;
  clearFailedActions: () => Promise<void>;
}

const noopMethods: SyncMethods = {
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
};

const SyncMethodsContext = createContext<SyncMethods>(noopMethods);

// `runSync()` skips the full pull leg if a successful one happened recently.
// Reconnect events on flaky networks would otherwise trigger a full pull
// every few seconds. Outbox-only re-runs aren't gated by this — those are
// cheap and we always want user data shipped out promptly.
const FULL_SYNC_COOLDOWN_MS = 30_000;
const PERIODIC_SYNC_INTERVAL_MS = 60_000;

// ─── SyncProvider ──────────────────────────────────────────────────────────────

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { token, user, tokenExpired, pinSetupPending } = useAuth();

  // Always-current refs — avoid stale closures in event handlers and callbacks
  const authRef = useRef({ token: token ?? "", shopId: user?.shop_id, role: user?.role, userId: user?.id });
  authRef.current = { token: token ?? "", shopId: user?.shop_id, role: user?.role, userId: user?.id };

  const tokenRef = useRef<string | null>(null);
  const tokenExpiredRef = useRef(false);
  tokenRef.current = token;
  tokenExpiredRef.current = tokenExpired;

  // Build the orchestrator + coordinator exactly once. The coordinator
  // owns concurrency state for the lifetime of the provider.
  const orchestrator = useRef(new SyncOrchestrator(() => authRef.current));
  const coordinator = useRef(
    new SyncCoordinator(
      createSyncExecutor({
        orchestrator: orchestrator.current,
        holder: "foreground",
      })
    )
  );

  const consecutiveFailuresRef = useRef(0);
  const lastFullSyncAtRef = useRef<number>(0);

  // ─── Refresh counts ─────────────────────────────────────────────────────────

  const refreshPendingActions = useCallback(async () => {
    const { pending, dead, failed } = await orchestrator.current.refreshCounts();
    useSyncStore.setState({
      pendingActionsCount: pending,
      deadActionsCount: dead,
      failedActions: failed,
    });
  }, []);

  // ─── Coordinator state → store ─────────────────────────────────────────────
  // Surfaces coordinator's busy flag as `isSyncing` and reports counters and
  // last-success timestamp after every job. Centralizing this here means
  // every sync trigger (manual, periodic, AppState foreground, reconnect)
  // updates the UI consistently — no duplication in callsites.

  useEffect(() => {
    let lastBusy = false;
    const unsubscribe = coordinator.current.subscribe((state: CoordinatorState) => {
      useSyncStore.setState({ isSyncing: state.busy });

      // Refresh counters at every busy → idle transition.
      if (lastBusy && !state.busy) {
        refreshPendingActions().catch((e) => reportError(e, { tag: "sync-refresh-counters", phase: "post-busy" }));
      }
      lastBusy = state.busy;
    });
    return unsubscribe;
  }, [refreshPendingActions]);

  // ─── Job submission helpers ────────────────────────────────────────────────

  /**
   * Reconnect/periodic sync. Outbox-only on the cheap path so flaky
   * reconnects don't pull the full remote dataset every few seconds; full
   * sync once per cooldown.
   */
  const runSync = useCallback(async (forceFullSync = false): Promise<void> => {
    const sinceLast = Date.now() - lastFullSyncAtRef.current;
    const shouldDoFullSync = forceFullSync || sinceLast >= FULL_SYNC_COOLDOWN_MS;
    const kind = shouldDoFullSync ? "full" : "outbox";
    try {
      await coordinator.current.enqueue(kind, { priority: shouldDoFullSync ? "normal" : "high" });
      consecutiveFailuresRef.current = 0;
      if (shouldDoFullSync) {
        lastFullSyncAtRef.current = Date.now();
      }
      useSyncStore.setState({ lastSyncedAt: new Date() });
    } catch (e) {
      // SyncLockBusyError is benign — a peer (background task) is mid-sync.
      // Don't count it as a failure or alert the user.
      if (e instanceof SyncLockBusyError) return;

      reportError(e, { tag: "sync-runSync", jobKind: shouldDoFullSync ? "full" : "outbox" });
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3) {
        consecutiveFailuresRef.current = 0;
        Alert.alert(
          "Ошибка синхронизации",
          "Синхронизация не удалась несколько раз подряд. Проверьте подключение к интернету.",
          [{ text: "OK" }]
        );
      }
    }
  }, []);

  /**
   * Manual user-initiated outbox push. High priority so it jumps ahead of
   * any queued background pulls. Returns false if offline/unauthed/locked
   * by a peer; true on a successful (or coalesced) outbox run.
   */
  const triggerSync = useCallback(async (): Promise<boolean> => {
    if (!useSyncStore.getState().isOnline || !tokenRef.current || tokenExpiredRef.current) return false;
    try {
      await coordinator.current.enqueue("outbox", { priority: "high" });
      useSyncStore.setState({ lastSyncedAt: new Date() });
      return true;
    } catch (e) {
      if (e instanceof SyncLockBusyError) return false;
      reportError(e, { tag: "sync-triggerSync" });
      return false;
    }
  }, []);

  /**
   * Login-bootstrap: full outbox + pull, awaited. The login screen blocks
   * tab navigation until this resolves. Identical work in flight is
   * coalesced — second caller piggybacks on the first promise.
   */
  const runFullSync = useCallback(async (): Promise<boolean> => {
    if (!useSyncStore.getState().isOnline || !tokenRef.current || tokenExpiredRef.current) return false;
    try {
      await coordinator.current.enqueue("full", { priority: "normal" });
      lastFullSyncAtRef.current = Date.now();
      useSyncStore.setState({ lastSyncedAt: new Date() });
      return true;
    } catch (e) {
      if (e instanceof SyncLockBusyError) return false;
      reportError(e, { tag: "sync-runFullSync" });
      return false;
    }
  }, []);

  // ─── Individual fetcher wrappers (for context consumers) ───────────────────
  // Public name kept for call-site stability; semantics: a normal-priority
  // full pull. (Pre-coordinator code also resolved `refreshProducts` to
  // `refreshAll`.) Callers that genuinely want only one entity should switch
  // to the per-entity helpers below.

  const refreshProducts = useCallback(async (forceFullSync = false): Promise<void> => {
    if (!useSyncStore.getState().isOnline || !tokenRef.current || tokenExpiredRef.current) return;
    await coordinator.current.enqueue("full", { priority: forceFullSync ? "normal" : "low" }).catch((e) => {
      if (!(e instanceof SyncLockBusyError)) reportError(e, { tag: "sync-refreshProducts" });
    });
  }, []);

  const fetchRemoteDebts = useCallback(async (): Promise<void> => {
    if (!useSyncStore.getState().isOnline || !tokenRef.current || tokenExpiredRef.current) return;
    await coordinator.current.enqueue("pull:debts").catch((e) => {
      if (!(e instanceof SyncLockBusyError)) reportError(e, { tag: "sync-fetchRemoteDebts" });
    });
  }, []);

  const fetchRemoteShops = useCallback(async (): Promise<void> => {
    if (!useSyncStore.getState().isOnline || !tokenRef.current || tokenExpiredRef.current) return;
    await coordinator.current.enqueue("pull:shops").catch((e) => {
      if (!(e instanceof SyncLockBusyError)) reportError(e, { tag: "sync-fetchRemoteShops" });
    });
  }, []);

  const fetchOlderSales = useCallback(async (pages = 5): Promise<boolean> => {
    if (!useSyncStore.getState().isOnline || !tokenRef.current || tokenExpiredRef.current) return false;
    return coordinator.current.enqueue<boolean>("pullOlder:sales", {
      priority: "low",
      payload: { pages },
    });
  }, []);

  const fetchOlderExpenses = useCallback(async (pages = 5): Promise<boolean> => {
    if (!useSyncStore.getState().isOnline || !tokenRef.current || tokenExpiredRef.current) return false;
    return coordinator.current.enqueue<boolean>("pullOlder:expenses", {
      priority: "low",
      payload: { pages },
    });
  }, []);

  const fetchOlderPurchases = useCallback(async (pages = 5): Promise<boolean> => {
    if (!useSyncStore.getState().isOnline || !tokenRef.current || tokenExpiredRef.current) return false;
    return coordinator.current.enqueue<boolean>("pullOlder:purchases", {
      priority: "low",
      payload: { pages },
    });
  }, []);

  const fetchAllHistory = useCallback(
    async (onProgress?: (s: HistoryProgress) => void): Promise<void> => {
      if (!useSyncStore.getState().isOnline || !tokenRef.current || tokenExpiredRef.current) return;
      await coordinator.current.enqueue("pullAllHistory", {
        priority: "low",
        payload: { onProgress },
      });
    },
    []
  );

  // ─── Mount: NetInfo subscription ────────────────────────────────────────────

  useEffect(() => {
    refreshPendingActions().catch((e) => reportError(e, { tag: "sync-refresh-counters", phase: "mount" }));

    const unsubscribe = NetInfo.addEventListener((state: any) => {
      // Use !== false so that null ("unknown/probing" on Android) is treated as online.
      // === true would keep Android permanently offline on devices that never resolve
      // isInternetReachable, because the OS skips the ping on many Android versions.
      useSyncStore.setState({
        isOnline: !!state.isConnected && state.isInternetReachable !== false,
      });
    });

    return () => unsubscribe();
  }, [refreshPendingActions]);

  // ─── Online / token change: run sync cycle ─────────────────────────────────
  // We subscribe to the relevant *single* slice of the store rather than the
  // whole state — the effect should re-run only when these specific values
  // flip. tokenRef is read inside the effect to avoid stale-closure issues
  // without forcing a full re-run on every render.

  const isOnlineForEffect = useSyncStore((s) => s.isOnline);

  useEffect(() => {
    if (isOnlineForEffect && token && !tokenExpired) {
      runSync();
    } else {
      refreshPendingActions().catch((e) => reportError(e, { tag: "sync-refresh-counters", phase: "offline" }));
    }
  }, [isOnlineForEffect, token, tokenExpired, runSync, refreshPendingActions]);

  // ─── Low-stock check after products have synced ─────────────────────────────

  useEffect(() => {
    if (!isOnlineForEffect || !token || !user?.shop_id || tokenExpired) return;
    const timer = setTimeout(() => {
      orchestrator.current.checkLowStock().catch((e) => reportError(e, { tag: "sync-low-stock-check" }));
    }, 2_000);
    return () => clearTimeout(timer);
  }, [isOnlineForEffect, token, user?.shop_id, tokenExpired]);

  // ─── Periodic sync ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOnlineForEffect || !token || tokenExpired) return;
    const interval = setInterval(() => {
      runSync();
    }, PERIODIC_SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isOnlineForEffect, token, tokenExpired, runSync]);

  // ─── Reset coordinator on logout ────────────────────────────────────────────
  // When the user signs out, the queued jobs no longer correspond to a valid
  // session and must be drained. The coordinator is re-enabled on next login
  // via the auth-state effect.

  useEffect(() => {
    if (!token && !pinSetupPending) {
      coordinator.current.cancelAll("user signed out");
      coordinator.current.reset();
    }
  }, [token, pinSetupPending]);

  // ─── Methods context value ─────────────────────────────────────────────────
  // Memoized once — the entries are themselves stable useCallbacks, so the
  // wrapping object reference also never changes after first render. This
  // is what lets `useSyncMethods()` consumers skip re-rendering on state.

  const clearFailedActions = useCallback(async () => {
    await archiveSyncActions(["failed", "dead"]);
    useSyncStore.setState({ failedActions: [] });
  }, []);

  const methods = useMemo<SyncMethods>(
    () => ({
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

  return <SyncMethodsContext.Provider value={methods}>{children}</SyncMethodsContext.Provider>;
}

// ─── Public hooks ────────────────────────────────────────────────────────────

/** Stable methods. Consumers calling only methods will never re-render on state. */
export function useSyncMethods(): SyncMethods {
  return useContext(SyncMethodsContext);
}

/**
 * Backward-compatible fat hook: combines methods (Context) with the full
 * state slice (Zustand). Subscribes to all state fields, so any sync state
 * transition will re-render the consumer. Prefer the narrower hooks
 * (`useIsSyncing`, `useIsOnline`, `usePendingActionsCount`, ...) where you
 * can. Kept for callers that genuinely need most of the surface.
 */
export function useSync(): SyncMethods & {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  pendingActionsCount: number;
  deadActionsCount: number;
  failedActions: SyncAction[];
  failedActionsCount: number;
} {
  const methods = useSyncMethods();
  const isOnline = useSyncStore((s) => s.isOnline);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);
  const pendingActionsCount = useSyncStore((s) => s.pendingActionsCount);
  const deadActionsCount = useSyncStore((s) => s.deadActionsCount);
  const failedActions = useSyncStore((s) => s.failedActions);
  return {
    ...methods,
    isOnline,
    isSyncing,
    lastSyncedAt,
    pendingActionsCount,
    deadActionsCount,
    failedActions,
    failedActionsCount: failedActions.length,
  };
}
