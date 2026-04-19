import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import NetInfo from "@react-native-community/netinfo";
import {
  initDb,
  getPendingSyncActions,
  getPendingSyncActionsCount,
  getDeadSyncActionsCount,
  insertOrUpdateProducts,
  insertOrUpdateDebts,
  insertOrUpdateShop,
  markSyncActionStatus,
  queueSyncAction,
  getDb,
  incrementLocalProductStock,
  type SyncAction,
} from "../db";
import { api, Product, Debt, Shop } from "../api";
import { API_URL } from "@/constants/config";
import { useAuth } from "@/store/auth";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function entityTableForPath(path: string): string | null {
  if (path.includes("/sales")) return "sales";
  if (path.includes("/products")) return "products";
  if (path.includes("/expenses")) return "expenses";
  if (path.includes("/purchases")) return "purchases";
  if (path.includes("/shops")) return "shops";
  return null;
}

// ─── Context ───────────────────────────────────────────────────────────────────

interface SyncContextType {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  pendingActionsCount: number;
  deadActionsCount: number;
  failedActionsCount: number;
  failedActions: SyncAction[];
  triggerSync: () => Promise<void>;
  fetchRemoteProducts: () => Promise<void>;
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
  fetchRemoteProducts: async () => {},
  fetchRemoteDebts: async () => {},
  fetchRemoteShops: async () => {},
  refreshPendingActions: async () => {},
  clearFailedActions: async () => {},
});

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [pendingActionsCount, setPendingActionsCount] = useState(0);
  const [deadActionsCount, setDeadActionsCount] = useState(0);
  const [failedActions, setFailedActions] = useState<SyncAction[]>([]);
  const { token, user } = useAuth();

  const syncLock = useRef(false);

  useEffect(() => {
    initDb().catch(console.error);
    getPendingSyncActionsCount().then(setPendingActionsCount).catch(console.error);
    getDeadSyncActionsCount().then(setDeadActionsCount).catch(console.error);

    const unsubscribe = NetInfo.addEventListener((state: any) => {
      setIsOnline(!!state.isConnected && !!state.isInternetReachable);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const refreshPendingActions = useCallback(async () => {
    const [count, deadCount, allFailed] = await Promise.all([
      getPendingSyncActionsCount(),
      getDeadSyncActionsCount(),
      getPendingSyncActions(),
    ]);
    setPendingActionsCount(count);
    setDeadActionsCount(deadCount);
    setFailedActions(allFailed.filter(a => a.status === "failed" || a.status === "dead"));
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

            // Handle FormData for product photo uploads
            let fetchOptions: RequestInit & { _photoUri?: string } = {
              method: action.method,
              headers: { ...baseHeaders, ...customHeaders },
            };

            try {
              const reqPayload = action.payload ? JSON.parse(action.payload) : {};
              if (reqPayload.photo_uri) {
                // Photo upload — construct FormData
                const formData = new FormData();
                formData.append("photo", {
                  uri: reqPayload.photo_uri,
                  type: "image/jpeg",
                  name: "photo.jpg",
                } as any);
                fetchOptions.body = formData as any;
                // Remove Content-Type header so fetch sets its own boundary
                delete (fetchOptions.headers as Record<string, string>)["Content-Type"];
              } else {
                fetchOptions.body = action.payload;
              }
            } catch {
              fetchOptions.body = action.payload;
            }

            const response = await fetch(requestUrl, fetchOptions as RequestInit);

            if (response.ok) {
              await markSyncActionStatus(action.id, "completed");

              // Map real IDs back to per-entity tables and handle entity-specific logic
              try {
                const responseData = await response.json().catch(() => ({}));
                const realId = responseData?.data?.id ?? responseData?.id;
                const reqPayload = JSON.parse(action.payload || "{}");
                const localId = reqPayload._local_id;
                const now = new Date().toISOString();

                // Map real server ID to local row via _local_id
                if (realId && localId) {
                  const table = entityTableForPath(action.path);
                  if (table) {
                    await getDb().runAsync(
                      `UPDATE ${table} SET id = ?, status = 'synced', sync_action = 'none', last_synced_at = ? WHERE local_id = ?`,
                      [realId, now, localId]
                    );
                  }

                  // Phase 2: upload product photo if it's a local file
                  if (table === "products" && action.method === "POST") {
                    try {
                      const row = await getDb().getFirstAsync<{ photo_url: string | null }>(
                        "SELECT photo_url FROM products WHERE local_id = ?", [localId]
                      );
                      if (row?.photo_url?.startsWith("file://")) {
                        const formData = new FormData();
                        formData.append("photo", {
                          uri: row.photo_url,
                          type: "image/jpeg",
                          name: "photo.jpg",
                        } as any);
                        const photoResponse = await fetch(`${API_URL}/products/${realId}`, {
                          method: "PATCH",
                          headers: {
                            "Authorization": `Bearer ${token}`,
                            "Accept": "application/json",
                          },
                          body: formData,
                        });
                        if (!photoResponse.ok) {
                          // Queue a separate photo upload action for retry
                          await queueSyncAction(
                            "PATCH",
                            `/products/${realId}`,
                            { photo_uri: row.photo_url },
                            { "Content-Type": "multipart/form-data" }
                          );
                        }
                      }
                    } catch {}
                  }

                  // Update debt transaction paths if applicable
                  if (action.path.startsWith("/debts")) {
                    const tempId = localId;
                    await getDb().runAsync(
                      "UPDATE sync_queue SET path = REPLACE(path, ?, ?) WHERE path LIKE ?",
                      [`/debts/${tempId}/`, `/debts/${realId}/`, `/debts/${tempId}/%`]
                    );
                    await getDb().runAsync(
                      "UPDATE sync_queue SET path = REPLACE(path, ?, ?) WHERE path = ?",
                      [`/debts/${tempId}`, `/debts/${realId}`, `/debts/${tempId}`]
                    );
                  }
                }
              } catch (e) {
                console.error("Failed to map real ID to local row", e);
              }
            } else {
              // 4xx errors mean the request was rejected (validation, out of stock, etc.)
              // Do NOT mark as completed — mark as failed so the error is surfaced.
              const errBody = await response.json().catch(() => ({}));
              await markSyncActionStatus(action.id, "failed", false);
              console.error("Sync rejected by server:", response.status, errBody, { method: action.method, url: requestUrl, payload: action.payload });

              // Rollback stock for sales that were rejected (compensating transaction)
              if (action.method === "POST" && action.path === "/sales") {
                try {
                  const reqPayload = JSON.parse(action.payload || "{}");
                  if (reqPayload.items) {
                    for (const item of reqPayload.items) {
                      if (item.product_id != null) {
                        await incrementLocalProductStock(item.product_id, item.quantity);
                      }
                    }
                  }
                } catch {}
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

  const fetchRemoteShops = useCallback(async () => {
    if (!isOnline || !token) return;
    try {
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const response = await api.shops.list(token, { page, limit: 100 });
        const shops: Shop[] = Array.isArray(response) ? response : response.data ?? [];
        for (const shop of shops) {
          await insertOrUpdateShop(shop, String(shop.id));
        }
        const meta = (response as any).meta;
        if (meta && page < meta.last_page) {
          page++;
        } else {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error("Failed to fetch remote shops:", error);
    }
  }, [isOnline, token]);

  // Sync when coming online / token changes
  useEffect(() => {
    if (isOnline && token) {
      (async () => {
        try { await triggerSync(); } catch (e) { console.error(e); }
        try { await fetchRemoteProducts(); } catch (e) { console.error(e); }
        try { await fetchRemoteDebts(); } catch (e) { console.error(e); }
        try { await fetchRemoteShops(); } catch (e) { console.error(e); }
      })();
    } else {
      refreshPendingActions().catch(console.error);
    }
  }, [isOnline, token, triggerSync, fetchRemoteProducts, fetchRemoteDebts, fetchRemoteShops, refreshPendingActions]);

  // Periodic sync every 60 seconds while online
  useEffect(() => {
    if (!isOnline || !token) return;
    const interval = setInterval(async () => {
      try { await triggerSync(); } catch (e) { console.error(e); }
      try { await fetchRemoteShops(); } catch (e) { console.error(e); }
    }, 60_000);
    return () => clearInterval(interval);
  }, [isOnline, token, triggerSync, fetchRemoteShops]);

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
        fetchRemoteProducts,
        fetchRemoteDebts,
        fetchRemoteShops,
        refreshPendingActions,
        clearFailedActions: async () => {
          await getDb().runAsync("DELETE FROM sync_queue WHERE status IN ('failed', 'dead')");
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
