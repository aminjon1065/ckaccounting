import { useCallback, useEffect, useRef, useState } from "react";
import { type Sale } from "@/lib/api";
import { getLocalSales } from "@/lib/db";
import { useSync } from "@/lib/sync/SyncContext";

/**
 * Local-first sales feed.
 *
 * - mount → render whatever's in SQLite immediately (no network blocking).
 * - SyncProvider runs delta-sync in the background; when it finishes, we
 *   reload from SQLite to pick up new server records.
 * - pull-to-refresh → manual triggerSync, then reload.
 * - load-more (scroll bottom) → fetchOlderSales pulls one historical page
 *   beyond the cap window, then we reload. hasMore tracks whether the
 *   server still has older history.
 */
export function useSales({ token, userId, isSeller }: { token: string | null; userId?: number | null; isSeller?: boolean }) {
  const { triggerSync, fetchOlderSales, isSyncing } = useSync();

  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const isOffline = false; // kept for backward-compatible API; the global offline banner handles UI now

  // Track previous isSyncing so we only refresh on completion edge.
  const wasSyncingRef = useRef(false);

  const loadFromLocal = useCallback(async () => {
    if (!token) return;
    const localSales = await getLocalSales(undefined, isSeller && userId ? userId : undefined);
    setSales(localSales);
  }, [token, userId, isSeller]);

  // Initial load + reload after each completed background sync.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      await loadFromLocal();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token, loadFromLocal]);

  useEffect(() => {
    if (wasSyncingRef.current && !isSyncing) {
      loadFromLocal().catch(() => {});
    }
    wasSyncingRef.current = isSyncing;
  }, [isSyncing, loadFromLocal]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      await triggerSync();
      await loadFromLocal();
    } catch {
      setError("Не удалось обновить продажи.");
    } finally {
      setRefreshing(false);
    }
  }, [triggerSync, loadFromLocal]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const moreAvailable = await fetchOlderSales(1);
      await loadFromLocal();
      setHasMore(moreAvailable);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, fetchOlderSales, loadFromLocal]);

  const retryFetch = useCallback(async () => {
    setLoading(true);
    setError("");
    await loadFromLocal();
    setLoading(false);
  }, [loadFromLocal]);

  return {
    sales,
    setSales,
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
