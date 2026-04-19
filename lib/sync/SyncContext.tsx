import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { Alert } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  getDb,
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
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [pendingActionsCount, setPendingActionsCount] = useState(0);
  const [deadActionsCount, setDeadActionsCount] = useState(0);
  const [failedActions, setFailedActions] = useState<SyncAction[]>([]);

  const { token, user } = useAuth();

  // Keep auth state accessible inside orchestrator callbacks without recreating it
  const authRef = useRef({ token: token ?? "", shopId: user?.shop_id });
  authRef.current = { token: token ?? "", shopId: user?.shop_id };

  const syncLock = useRef(false);
  // Track consecutive sync failures to surface a persistent error to the user
  const consecutiveFailuresRef = useRef(0);

  // Single orchestrator instance for the lifetime of this provider
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

  // ─── Trigger outbox sync ────────────────────────────────────────────────────

  const triggerSync = useCallback(async () => {
    if (!isOnline || !token || syncLock.current) return;
    try {
      syncLock.current = true;
      setIsSyncing(true);
      await orchestrator.current.syncOutbox(async () => {
        consecutiveFailuresRef.current = 0;
        await refreshPendingActions();
        setLastSyncedAt(new Date());
      });
    } finally {
      setIsSyncing(false);
      syncLock.current = false;
    }
  }, [isOnline, token, refreshPendingActions]);

  // ─── Individual fetcher wrappers (for context consumers) ───────────────────

  const refreshProducts = useCallback(async (forceFullSync = false) => {
    if (!isOnline || !token) return;
    // Delegate to orchestrator's product fetcher (deps captured via authRef)
    await orchestrator.current.refreshAll(forceFullSync);
  }, [isOnline, token]);

  const fetchRemoteDebts = useCallback(async () => {
    if (!isOnline || !token) return;
    await orchestrator.current.refreshAll();
  }, [isOnline, token]);

  const fetchRemoteShops = useCallback(async () => {
    if (!isOnline || !token) return;
    await orchestrator.current.refreshAll();
  }, [isOnline, token]);

  // ─── Mount: NetInfo subscription ────────────────────────────────────────────

  useEffect(() => {
    refreshPendingActions().catch(console.error);

    const unsubscribe = NetInfo.addEventListener((state: any) => {
      setIsOnline(!!state.isConnected && !!state.isInternetReachable);
    });

    return () => unsubscribe();
  }, []);

  // ─── Online / token change: run full sync cycle ─────────────────────────────

  useEffect(() => {
    if (isOnline && token) {
      orchestrator.current
        .syncAll()
        .catch(console.error)
        .finally(() => {
          consecutiveFailuresRef.current = 0;
          refreshPendingActions().catch(console.error);
          setLastSyncedAt(new Date());
        });
    } else {
      refreshPendingActions().catch(console.error);
    }
  }, [isOnline, token]);

  // ─── Low-stock check after products have synced ─────────────────────────────

  useEffect(() => {
    if (!isOnline || !token || !user?.shop_id) return;
    const timer = setTimeout(() => {
      orchestrator.current.checkLowStock().catch(console.error);
    }, 2_000);
    return () => clearTimeout(timer);
  }, [isOnline, token, user?.shop_id]);

  // ─── Periodic sync every 60 s ───────────────────────────────────────────────

  useEffect(() => {
    if (!isOnline || !token) return;
    const interval = setInterval(async () => {
      try {
        await orchestrator.current.syncAll();
        setLastSyncedAt(new Date());
        consecutiveFailuresRef.current = 0;
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
        refreshPendingActions().catch(console.error);
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, [isOnline, token]);

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
          await getDb().runAsync(
            "DELETE FROM sync_queue WHERE status IN ('failed', 'dead')"
          );
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
