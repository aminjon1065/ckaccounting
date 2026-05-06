import { useState, useRef, useEffect, useCallback } from "react";
import { Alert } from "react-native";
import { api, type Product } from "@/lib/api";
import { useToast } from "@/store/toast";
import { getLocalProducts, markProductDeletedLocally } from "@/lib/db";
import type { LocalProduct } from "@/lib/db";

export function useProducts({ token, shopId }: { token: string | null; shopId?: number }) {
  const { showToast } = useToast();
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  // useRef for page so fetchProducts never reads a stale closure value.
  // `page` state caused fetchProducts to recreate on every page change,
  // and triggered wrong-page fetches when called before state updated.
  const pageRef = useRef(1);

  const fetchProducts = useCallback(async (reset = false, searchVal = search) => {
    if (!token) return;
    setError("");

    if (reset) {
      // ── Initial load / refresh ─────────────────────────────────────────────
      // 1. Show local DB data instantly so the user sees something immediately,
      //    even while the network request is in flight.
      const localData = await getLocalProducts(shopId, searchVal || undefined);
      setProducts(localData);
      setHasMore(true); // Reset so we can paginate again after coming back online

      try {
        const res = await api.products.list(token, {
          page: 1,
          search: searchVal || undefined,
        });
        setIsOffline(false);
        // Merge: replace synced local items with fresh server data, but keep any
        // locally-pending items (creates/updates/deletes not yet synced).
        setProducts(mergeProducts(localData, res.data));
        pageRef.current = 2;
        setHasMore(res.meta.current_page < res.meta.last_page);
      } catch (e: any) {
        const offline = e?.status === 0 || !e?.message?.includes("status");
        if (offline) {
          setIsOffline(true);
          setHasMore(false);
          // localData is already set above — nothing more to do
        } else {
          setError("Не удалось загрузить товары.");
        }
      }
    } else {
      // ── Load more (append next page) ───────────────────────────────────────
      // BUG FIX: the previous code called mergeProducts(prev, res.data) here,
      // which iterated `prev` and only kept items found in the new page's
      // serverMap — dropping ALL already-loaded page 1 items.
      // Correct approach: simply append new items that aren't already shown.
      const pg = pageRef.current;

      try {
        const res = await api.products.list(token, {
          page: pg,
          search: searchVal || undefined,
        });
        setIsOffline(false);
        setProducts((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const newItems = res.data
            .filter((p) => !existingIds.has(p.id))
            .map((p) => p as LocalProduct);
          return [...prev, ...newItems];
        });
        pageRef.current = pg + 1;
        setHasMore(res.meta.current_page < res.meta.last_page);
      } catch (e: any) {
        const offline = e?.status === 0 || !e?.message?.includes("status");
        if (offline) {
          setIsOffline(true);
          setHasMore(false);
        }
        // On load-more error, leave the existing list intact — don't clear it.
      }
    }
  }, [token, search, shopId]); // `page` removed from deps — we use pageRef now

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
    // 600ms gives the user time to type a few characters before we burn
    // a network round-trip — under flaky links this prevents 3-5 stacked
    // requests for a single search.
    searchDebounce.current = setTimeout(() => {
      setLoading(true);
      fetchProducts(true, text).finally(() => setLoading(false));
    }, 600);
  }, [fetchProducts]);

  const handleDelete = useCallback((id: string) => {
    Alert.alert("Удалить товар", "Товар будет удалён безвозвратно.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await api.products.delete(id, token!, `prod-delete-${id}`);
            setProducts((prev) => prev.filter((p) => p.id !== id));
            showToast({ message: "Товар удалён", variant: "success" });
          } catch (e: any) {
            if (e?.status === 0) {
              await markProductDeletedLocally(id);
              setProducts((prev) => {
                const idx = prev.findIndex((p) => p.id === id);
                if (idx >= 0) {
                  const next = [...prev];
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
  }, [token, products, showToast]);

  const handleSaved = useCallback((saved: Product | LocalProduct, wasEditing: boolean) => {
    setProducts((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
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
 * Merge local products with server products (used for initial load / refresh only).
 *
 * Rules:
 * - Server products replace their local counterparts (same id).
 * - Local products with pending sync_action (create/update/delete) are kept as-is
 *   so offline changes remain visible before sync completes.
 * - Local-only products (negative id, never sent to server) are preserved.
 * - Synced local products NOT present in server page are dropped — they will
 *   appear when the user scrolls to their respective server page.
 */
function mergeProducts(local: LocalProduct[], server: Product[]): LocalProduct[] {
  const serverMap = new Map<string, Product>();
  for (const s of server) {
    serverMap.set(s.id, s);
  }

  const result: LocalProduct[] = [];

  for (const l of local) {
    if (serverMap.has(l.id)) {
      // Server has this product — use the fresh server version, preserving sync metadata
      result.push({
        ...serverMap.get(l.id)!,
        status: l.status,
        sync_action: l.sync_action,
      } as LocalProduct);
      serverMap.delete(l.id);
    } else if (l.sync_action && l.sync_action !== "none") {
      // Pending local change (create/update/delete not yet synced) — keep it visible
      result.push(l);
    }
    // Otherwise: synced product not on this server page → omit (will load on scroll)
  }

  // Append server products that weren't in local DB at all
  for (const s of serverMap.values()) {
    result.push(s as LocalProduct);
  }

  return result;
}
