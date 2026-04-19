import { useState, useRef, useEffect, useCallback } from "react";
import { Alert } from "react-native";
import { api, type Product } from "@/lib/api";
import { useToast } from "@/store/toast";
import { getLocalProducts } from "@/lib/db";
import type { LocalProduct } from "@/lib/db";

export function useProducts({ token, shopId }: { token: string | null; shopId?: number }) {
  const { showToast } = useToast();
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const fetchProducts = useCallback(async (reset = false, searchVal = search) => {
    if (!token) return;
    const pg = reset ? 1 : page;
    setError("");

    // Always load local first — instant, always works
    const localData = await getLocalProducts(shopId, searchVal || undefined);

    try {
      const res = await api.products.list(token, {
        page: pg,
        search: searchVal || undefined,
      });
      setIsOffline(false);

      if (reset) {
        const merged = mergeProducts(localData, res.data);
        setProducts(merged);
        setPage(2);
      } else {
        setProducts((prev) => {
          const merged = mergeProducts(prev, res.data);
          return merged;
        });
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e: any) {
      const isOfflineError = e?.status === 0 || !e?.message?.includes("status");
      if (isOfflineError) {
        setIsOffline(true);
        setProducts(localData);
        setHasMore(false);
      } else {
        if (reset) setError("Не удалось загрузить товары.");
      }
    }
  }, [token, page, search, shopId]);

  useEffect(() => {
    if (token) {
      fetchProducts(true).finally(() => setLoading(false));
    }
  }, [token]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchProducts(true).finally(() => setRefreshing(false));
  }, [fetchProducts]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    fetchProducts(false).finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, fetchProducts]);

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setLoading(true);
      fetchProducts(true, text).finally(() => setLoading(false));
    }, 400);
  }, [fetchProducts]);

  const handleDelete = useCallback((id: number) => {
    Alert.alert("Удалить товар", "Товар будет удалён безвозвратно.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await api.products.delete(id, token!);
            setProducts((prev) => prev.filter((p) => p.id !== id));
            showToast({ message: "Товар удалён", variant: "success" });
          } catch (e: any) {
            if (e?.status === 0) {
              // Offline: mark for deletion in local DB, queue sync
              const { updateProductStatus } = await import("@/lib/db");
              // Find local product by id
              setProducts((prev) => {
                const idx = prev.findIndex((p) => p.id === id);
                if (idx >= 0) {
                  const next = [...prev];
                  // Mark as pending delete locally — will be removed after sync
                  next[idx] = { ...next[idx], sync_action: "delete", status: "pending" };
                  return next;
                }
                return prev;
              });
              showToast({ message: "Удалено локально. Будет удалено после синхронизации.", variant: "warning" });
            } else {
              showToast({ message: "Не удалось удалить товар.", variant: "error" });
            }
          }
        },
      },
    ]);
  }, [token, showToast]);

  const handleSaved = useCallback((saved: Product | LocalProduct, wasEditing: boolean) => {
    setProducts((prev) => {
      // Find by id (server id) or local_id
      const id = (saved as LocalProduct).local_id
        ? (saved as LocalProduct).local_id
        : saved.id;
      const idx = prev.findIndex((p) => p.id === saved.id || (p as LocalProduct).local_id === id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved as LocalProduct;
        return next;
      }
      return [saved as LocalProduct, ...prev];
    });
    showToast({
      message: wasEditing ? "Товар обновлён" : "Товар добавлен",
      variant: "success",
    });
  }, [showToast]);

  const retryFetch = useCallback(() => {
    setLoading(true);
    fetchProducts(true).finally(() => setLoading(false));
  }, [fetchProducts]);

  return {
    products,
    loading,
    refreshing,
    hasMore,
    loadingMore,
    search,
    error,
    isOffline,
    handleRefresh,
    handleLoadMore,
    handleSearchChange,
    handleDelete,
    handleSaved,
    retryFetch,
  };
}

/**
 * Merge local products with server products.
 * Server products (positive id) replace any local with the same id.
 * Local products with sync_action != 'none' are kept as pending.
 */
function mergeProducts(local: LocalProduct[], server: Product[]): LocalProduct[] {
  const serverMap = new Map<number, Product>();
  for (const s of server) {
    serverMap.set(s.id, s);
  }

  const result: LocalProduct[] = [];

  for (const l of local) {
    if (l.id > 0 && serverMap.has(l.id)) {
      // Server has this product — use server version
      result.push({ ...serverMap.get(l.id)!, local_id: l.local_id, status: l.status, sync_action: l.sync_action } as LocalProduct);
      serverMap.delete(l.id);
    } else if (l.sync_action && l.sync_action !== "none") {
      // Local pending (create/update/delete) — keep it
      result.push(l);
    } else if (l.id < 0) {
      // Local with negative id (not yet synced) — keep it
      result.push(l);
    }
  }

  // Add remaining server records
  for (const s of serverMap.values()) {
    result.push(s as LocalProduct);
  }

  return result;
}