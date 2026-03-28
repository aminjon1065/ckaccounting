import { useCallback, useEffect, useState } from "react";
import { api, type Sale } from "@/lib/api";

export function useSales({ token }: { token: string | null }) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const fetchSales = useCallback(async (reset = false) => {
    if (!token) return;
    const pg = reset ? 1 : page;
    setError("");
    try {
      const res = await api.sales.list(token, { page: pg });
      if (reset) {
        setSales(res.data);
        setPage(2);
      } else {
        setSales((prev) => [...prev, ...res.data]);
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e) {
      console.error("Sales fetch error:", e);
      if (reset) setError("Не удалось загрузить продажи.");
    }
  }, [token, page]);

  useEffect(() => {
    if (token) {
      fetchSales(true).finally(() => setLoading(false));
    }
  }, [token]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchSales(true).finally(() => setRefreshing(false));
  }, [fetchSales]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    fetchSales(false).finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, fetchSales]);

  const retryFetch = useCallback(() => {
    setLoading(true);
    fetchSales(true).finally(() => setLoading(false));
  }, [fetchSales]);

  return {
    sales,
    setSales,
    loading,
    refreshing,
    hasMore,
    loadingMore,
    error,
    handleRefresh,
    handleLoadMore,
    retryFetch,
  };
}
