import { useState, useRef, useEffect, useCallback } from "react";
import { Alert } from "react-native";
import { api, type Product } from "@/lib/api";
import { useToast } from "@/store/toast";

export function useProducts({ token }: { token: string | null }) {
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState("");

  const fetchProducts = useCallback(async (reset = false, searchVal = search) => {
    if (!token) return;
    const pg = reset ? 1 : page;
    setError("");
    try {
      const res = await api.products.list(token, {
        page: pg,
        search: searchVal || undefined,
      });
      if (reset) {
        setProducts(res.data);
        setPage(2);
      } else {
        setProducts((prev) => [...prev, ...res.data]);
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e) {
      console.error("Products fetch error:", e);
      if (reset) setError("Не удалось загрузить товары.");
    }
  }, [token, page, search]);

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
          } catch (e) {
            showToast({ message: "Не удалось удалить товар.", variant: "error" });
          }
        },
      },
    ]);
  }, [token, showToast]);

  const handleSaved = useCallback((saved: Product, wasEditing: boolean) => {
    setProducts((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
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
    handleRefresh,
    handleLoadMore,
    handleSearchChange,
    handleDelete,
    handleSaved,
    retryFetch,
  };
}
