import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import NetInfo from "@react-native-community/netinfo";
import {
  initDb,
  getPendingSyncActions,
  getPendingSyncActionsCount,
  insertOrUpdateProducts,
  markSyncActionStatus,
} from "../db";
import { api, Product } from "../api";
import { API_URL } from "@/constants/config";
import { useAuth } from "@/store/auth";

interface SyncContextType {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  pendingActionsCount: number;
  triggerSync: () => Promise<void>;
  fetchRemoteProducts: () => Promise<void>;
  refreshPendingActions: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType>({
  isOnline: true,
  isSyncing: false,
  lastSyncedAt: null,
  pendingActionsCount: 0,
  triggerSync: async () => {},
  fetchRemoteProducts: async () => {},
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

  // Sync when coming online / token changes
  useEffect(() => {
    if (isOnline && token) {
      triggerSync().catch(console.error);
      fetchRemoteProducts().catch(console.error);
    } else {
      refreshPendingActions().catch(console.error);
    }
  }, [isOnline, token, triggerSync, fetchRemoteProducts, refreshPendingActions]);

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
