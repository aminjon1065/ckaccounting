import { useCallback, useEffect, useState } from "react";
import { api, type Purchase } from "@/lib/api";
import { getLocalPurchases, type LocalPurchase } from "@/lib/db";

export function usePurchases({ token }: { token: string | null }) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const fetchPurchases = useCallback(async (reset = false) => {
    if (!token) return;
    const pg = reset ? 1 : page;
    setError("");

    // Always load local purchases first — instant, always works
    const localPurchases = await getLocalPurchases();

    try {
      const res = await api.purchases.list(token, { page: pg });
      setIsOffline(false);

      if (reset) {
        const merged = mergePurchases(localPurchases, res.data);
        setPurchases(merged);
        setPage(2);
      } else {
        setPurchases((prev) => {
          const merged = mergePurchases(prev, res.data);
          return merged;
        });
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e: any) {
      const isOfflineError = e?.status === 0 || !e?.message?.includes("status");
      if (isOfflineError) {
        setIsOffline(true);
        setPurchases(localPurchases as Purchase[]);
        setHasMore(false);
      } else {
        if (reset) setError("Не удалось загрузить закупки.");
      }
    }
  }, [token, page]);

  useEffect(() => {
    if (token) {
      fetchPurchases(true).finally(() => setLoading(false));
    }
  }, [token]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPurchases(true).finally(() => setRefreshing(false));
  }, [fetchPurchases]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    fetchPurchases(false).finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, fetchPurchases]);

  const retryFetch = useCallback(() => {
    setLoading(true);
    fetchPurchases(true).finally(() => setLoading(false));
  }, [fetchPurchases]);

  return {
    purchases,
    setPurchases,
    loading,
    refreshing,
    hasMore,
    loadingMore,
    error,
    isOffline,
    handleRefresh,
    handleLoadMore,
    retryFetch,
  };
}

/**
 * Merge local purchases with server purchases.
 * - Server purchases (positive id) replace any local with the same id
 * - Local purchases with negative id (pending sync) that don't exist on server are kept
 */
function mergePurchases(local: Purchase[], server: Purchase[]): Purchase[] {
  const serverMap = new Map<number, Purchase>();
  for (const s of server) {
    serverMap.set(s.id, s);
  }

  const result: Purchase[] = [];
  for (const l of local as LocalPurchase[]) {
    if (l.id < 0) {
      // Local pending — check if server has a matching record
      const absId = Math.abs(l.id);
      if (serverMap.has(absId)) {
        // Server version supersedes local pending
        result.push(serverMap.get(absId)!);
        serverMap.delete(absId);
      } else {
        // No server counterpart yet — keep local pending
        result.push(l);
      }
    } else {
      // Local with positive id — treat as server record
      result.push(l);
    }
  }

  // Add remaining server records
  for (const s of serverMap.values()) {
    result.push(s);
  }

  // Sort by created_at desc
  result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return result;
}
