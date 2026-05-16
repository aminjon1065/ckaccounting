import { useState, useRef, useEffect, useCallback } from "react";
import { Alert } from "react-native";
import { api, ApiError, type Product, type User } from "@/lib/api";
import { useToast } from "@/store/toast";
import { deleteLocalProduct, getLocalProducts, localScope } from "@/lib/db";
import type { LocalProduct } from "@/lib/db";
import { useIsOnline } from "@/lib/network/NetworkProvider";

/**
 * Server-first products feed. The list always reflects what `/products`
 * returns; the local SQLite mirror is only consulted on a network failure
 * so the screen remains useful offline. Removing the "show local first,
 * merge server in" two-step also drops a class of merge-race bugs.
 *
 * Search is debounced and hits the server — local FTS preview was nice
 * for typists on slow networks but caused stale results to flash up when
 * a row had been deleted server-side.
 */
export function useProducts({ token, user }: { token: string | null; user: User | null | undefined }) {
  const { showToast } = useToast();
  const isOnline = useIsOnline();
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(1);
  const searchRef = useRef("");

  const fetchPage = useCallback(
    async (page: number, searchVal: string) => {
      if (!token) return null;
      return api.products.list(token, {
        page,
        search: searchVal || undefined,
      });
    },
    [token],
  );

  const loadFirstPage = useCallback(
    async (searchVal: string) => {
      if (!token) return;
      setError("");
      try {
        const res = await fetchPage(1, searchVal);
        if (!res) return;
        // Bail if the search field has moved on between the request firing
        // and the response landing — otherwise we'd flash stale results.
        if (searchVal !== searchRef.current) return;
        setProducts(res.data as LocalProduct[]);
        pageRef.current = 2;
        setHasMore(!!res.meta && res.meta.current_page < res.meta.last_page);
        setIsOffline(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) {
          try {
            const local = await getLocalProducts(localScope(user), searchVal || undefined);
            if (searchVal !== searchRef.current) return;
            setProducts(local);
            setIsOffline(true);
            setHasMore(false);
          } catch {
            setError("Нет сети и нет локальных данных.");
          }
        } else {
          setError(e instanceof Error ? e.message : "Не удалось загрузить товары.");
        }
      }
    },
    [token, user, fetchPage],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      await loadFirstPage("");
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, loadFirstPage]);

  // Refetch when connectivity returns after an offline fallback.
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (isOnline && wasOfflineRef.current) {
      loadFirstPage(searchRef.current).catch(() => {});
    }
    wasOfflineRef.current = !isOnline;
  }, [isOnline, loadFirstPage]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadFirstPage(searchRef.current).finally(() => setRefreshing(false));
  }, [loadFirstPage]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore || isOffline) return;
    setLoadingMore(true);
    try {
      const pg = pageRef.current;
      const res = await fetchPage(pg, searchRef.current);
      if (!res) return;
      setProducts((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const newItems = res.data
          .filter((p) => !existingIds.has(p.id))
          .map((p) => p as LocalProduct);
        return [...prev, ...newItems];
      });
      pageRef.current = pg + 1;
      setHasMore(!!res.meta && res.meta.current_page < res.meta.last_page);
    } catch {
      // non-fatal — user can retry by scrolling again
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, isOffline, fetchPage]);

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearch(text);
      searchRef.current = text;
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
      searchDebounce.current = setTimeout(() => {
        loadFirstPage(text);
      }, 250);
    },
    [loadFirstPage],
  );

  const dropLocalProduct = useCallback(async (id: string) => {
    try {
      await deleteLocalProduct(id);
    } catch {
      // best-effort
    }
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert("Удалить товар", "Товар будет удалён безвозвратно.", [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await api.products.delete(id, token!, `prod-delete-${id}`);
              setProducts((prev) => prev.filter((p) => p.id !== id));
              deleteLocalProduct(id).catch(() => {});
              showToast({ message: "Товар удалён", variant: "success" });
            } catch (e: unknown) {
              if (e instanceof ApiError && e.status === 0) {
                showToast({
                  message: "Нет соединения. Проверьте интернет и попробуйте снова.",
                  variant: "error",
                });
              } else if (e instanceof ApiError && e.status === 404) {
                setProducts((prev) => prev.filter((p) => p.id !== id));
                deleteLocalProduct(id).catch(() => {});
                showToast({ message: "Товар уже был удалён.", variant: "success" });
              } else {
                showToast({ message: "Не удалось удалить товар.", variant: "error" });
              }
            }
          },
        },
      ]);
    },
    [token, showToast],
  );

  const handleSaved = useCallback(
    (_saved: Product | LocalProduct, _wasEditing: boolean) => {
      // Refetch the first page so the server's view (including any
      // server-computed fields and the canonical ordering) is what shows.
      loadFirstPage(searchRef.current).catch(() => {});
    },
    [loadFirstPage],
  );

  const retryFetch = useCallback(() => {
    setLoading(true);
    loadFirstPage(searchRef.current).finally(() => setLoading(false));
  }, [loadFirstPage]);

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
    /** Evict a stale local product after the server confirms it's gone. */
    dropLocalProduct,
    retryFetch,
  };
}
