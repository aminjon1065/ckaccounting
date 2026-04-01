import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import NetInfo from "@react-native-community/netinfo";
import { initDb, getPendingSyncActions, markSyncActionStatus, insertOrUpdateProducts } from "../db";
import { api, Product } from "../api";
import { useAuth } from "@/store/auth";

interface SyncContextType {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  triggerSync: () => Promise<void>;
  fetchRemoteProducts: () => Promise<void>;
}

const SyncContext = createContext<SyncContextType>({
  isOnline: true,
  isSyncing: false,
  lastSyncedAt: null,
  triggerSync: async () => {},
  fetchRemoteProducts: async () => {},
});

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const { token, user } = useAuth();
  
  const syncLock = useRef(false);

  useEffect(() => {
    let mounted = true;
    initDb().catch(console.error);

    const unsubscribe = NetInfo.addEventListener((state: any) => {
      setIsOnline(!!state.isConnected && !!state.isInternetReachable);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
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
            } catch (e) {}

            const response = await fetch(action.path, {
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
                 // 4xx errors usually mean bad payload (e.g. out of stock remotely), we keep them failed or discard them.
                 // For now, mark them completed/failed and stop retrying to prevent deadlocks.
                 await markSyncActionStatus(action.id, "completed");
                 console.error("Unrecoverable sync error:", body);
              }
            }
          } catch (e) {
            await markSyncActionStatus(action.id, "failed", true);
          }
        }
      }

      setLastSyncedAt(new Date());
    } finally {
      setIsSyncing(false);
      syncLock.current = false;
    }
  }, [isOnline, token]);

  const fetchRemoteProducts = useCallback(async () => {
    if (!isOnline || !token || !user?.shop_id) return;
    try {
      // Basic implementation for pulling products
      // In a real app we'd paginate or use an 'updated_since' timestamp
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
    } catch (e) {
      console.error("Failed to fetch remote products:", e);
    }
  }, [isOnline, token, user]);

  // Sync when coming online
  useEffect(() => {
    if (isOnline && token) {
      triggerSync().catch(console.error);
      fetchRemoteProducts().catch(console.error);
    }
  }, [isOnline, token, triggerSync, fetchRemoteProducts]);

  return (
    <SyncContext.Provider value={{ isOnline, isSyncing, lastSyncedAt, triggerSync, fetchRemoteProducts }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}
