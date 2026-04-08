import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import NetInfo from "@react-native-community/netinfo";
import {
  initDb,
  getPendingSyncActions,
  getPendingSyncActionsCount,
  insertOrUpdateProducts,
  insertOrUpdateDebts,
  markSyncActionStatus,
} from "../db";
import { api, Product, Debt } from "../api";
import { API_URL } from "@/constants/config";
import { useAuth } from "@/store/auth";

interface SyncContextType {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  pendingActionsCount: number;
  triggerSync: () => Promise<void>;
  fetchRemoteProducts: () => Promise<void>;
  fetchRemoteDebts: () => Promise<void>;
  refreshPendingActions: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType>({
  isOnline: true,
  isSyncing: false,
  lastSyncedAt: null,
  pendingActionsCount: 0,
  triggerSync: async () => {},
  fetchRemoteProducts: async () => {},
  fetchRemoteDebts: async () => {},
  refreshPendingActions: async () => {},
});

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [pendingActionsCount, setPendingActionsCount] = useState(0);
  const { token, user } = useAuth();

  const syncLock = useRef(false);

  useEffect(() => {
    initDb().catch(console.error);
    getPendingSyncActionsCount().then(setPendingActionsCount).catch(console.error);

    const unsubscribe = NetInfo.addEventListener((state: any) => {
      setIsOnline(!!state.isConnected && !!state.isInternetReachable);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const refreshPendingActions = useCallback(async () => {
    const count = await getPendingSyncActionsCount();
    setPendingActionsCount(count);
  }, []);

  const triggerSync = useCallback(async () => {
    if (!isOnline || !token || syncLock.current) return;
    try {
      syncLock.current = true;
      setIsSyncing(true);

      // Process pending queue
      const pending = await getPendingSyncActions();
      if (pending.length > 0) {
        for (const action of pending) {
          try {
            await markSyncActionStatus(action.id, "processing");

            // Reconstruct the request dynamically
            const baseHeaders = {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`,
              "Accept": "application/json"
            };

            let customHeaders = {};
            try {
              if (action.headers) customHeaders = JSON.parse(action.headers);
            } catch {}

            const requestUrl = action.path.startsWith("http")
              ? action.path
              : `${API_URL}${action.path.startsWith("/") ? action.path : `/${action.path}`}`;

            const response = await fetch(requestUrl, {
              method: action.method,
              headers: { ...baseHeaders, ...customHeaders },
              body: action.payload
            });

            if (response.ok) {
              await markSyncActionStatus(action.id, "completed");
              if (action.method === "POST" && action.path === "/debts") {
                try {
                  const responseData = await response.json().catch(() => ({}));
                  const realId = responseData?.data?.id ?? responseData?.id;
                  const reqPayload = JSON.parse(action.payload || "{}");
                  if (realId && reqPayload._temp_id) {
                    const tempId = reqPayload._temp_id;
                    const { getDb } = require("../db/schema");
                    await getDb().runAsync(
                      "UPDATE sync_queue SET path = REPLACE(path, ?, ?) WHERE path LIKE ?",
                      [`/debts/${tempId}/`, `/debts/${realId}/`, `/debts/${tempId}/%`]
                    );
                  }
                } catch (e) {
                  console.error("Failed to map temp ID", e);
                }
              }
            } else {
              const body = await response.json().catch(() => ({}));
              if (response.status >= 500) {
                await markSyncActionStatus(action.id, "failed", true);
              } else {
                // 4xx errors usually mean bad payload (e.g. out of stock remotely).
                // Mark completed to prevent deadlocks.
                await markSyncActionStatus(action.id, "completed");
                console.error("Unrecoverable sync error:", body);
              }
            }
          } catch {
            await markSyncActionStatus(action.id, "failed", true);
          }
        }
      }

      await refreshPendingActions();
      setLastSyncedAt(new Date());
    } finally {
      setIsSyncing(false);
      syncLock.current = false;
    }
  }, [isOnline, refreshPendingActions, token]);

  const fetchRemoteProducts = useCallback(async () => {
    if (!isOnline || !token || !user?.shop_id) return;
    try {
      let allProducts: Product[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await api.products.list(token, { page, limit: 100, shop_id: user.shop_id });
        if (response.data.length > 0) {
          allProducts = allProducts.concat(response.data);
          page++;
          if (page > response.meta.last_page) hasMore = false;
        } else {
          hasMore = false;
        }
      }

      if (allProducts.length > 0) {
        await insertOrUpdateProducts(allProducts);
      }
    } catch (error) {
      console.error("Failed to fetch remote products:", error);
    }
  }, [isOnline, token, user]);

  const fetchRemoteDebts = useCallback(async () => {
    if (!isOnline || !token) return;
    try {
      let allDebts: Debt[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await api.debts.list(token, { page, limit: 100 });
        if (response.data.length > 0) {
          // For debts, we also need their transactions, which index endpoint already returns as relation.
          // Wait, does api.debts.list return transactions? The backend controller does include transactions!
          allDebts = allDebts.concat(response.data);
          page++;
          if (page > response.meta.last_page) hasMore = false;
        } else {
          hasMore = false;
        }
      }

      if (allDebts.length > 0) {
        await insertOrUpdateDebts(allDebts, user?.shop_id);
      }
    } catch (error) {
      console.error("Failed to fetch remote debts:", error);
    }
  }, [isOnline, token, user]);

  // Sync when coming online / token changes
  useEffect(() => {
    if (isOnline && token) {
      (async () => {
        try { await triggerSync(); } catch (e) { console.error(e); }
        try { await fetchRemoteProducts(); } catch (e) { console.error(e); }
        try { await fetchRemoteDebts(); } catch (e) { console.error(e); }
      })();
    } else {
      refreshPendingActions().catch(console.error);
    }
  }, [isOnline, token, triggerSync, fetchRemoteProducts, fetchRemoteDebts, refreshPendingActions]);

  // Periodic sync every 60 seconds while online
  useEffect(() => {
    if (!isOnline || !token) return;
    const interval = setInterval(() => {
      triggerSync().catch(console.error);
    }, 60_000);
    return () => clearInterval(interval);
  }, [isOnline, token, triggerSync]);

  return (
    <SyncContext.Provider
      value={{
        isOnline,
        isSyncing,
        lastSyncedAt,
        pendingActionsCount,
        triggerSync,
        fetchRemoteProducts,
        fetchRemoteDebts,
        refreshPendingActions,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}
