import { useCallback, useEffect, useState } from "react";
import { api, type Sale } from "@/lib/api";
import { getLocalSales } from "@/lib/db";

export function useSales({ token, userId, isSeller }: { token: string | null; userId?: number | null; isSeller?: boolean }) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const fetchSales = useCallback(async (reset = false) => {
    if (!token) return;
    const pg = reset ? 1 : page;
    setError("");

    // Always load local sales first — instant, always works
    // Pass userId for Sellers so the DB query itself filters to own sales
    const localSales = await getLocalSales(undefined, isSeller && userId ? userId : undefined);

    // filteredLocal is already scoped by userId when isSeller
    const filteredLocal = localSales;

    try {
      const res = await api.sales.list(token, { page: pg });
      setIsOffline(false);

      if (reset) {
        // Merge: server data first, then any local-only records (sync_action != 'none')
        const merged = mergeSales(filteredLocal, res.data);
        setSales(merged);
        setPage(2);
      } else {
        setSales((prev) => {
          const merged = mergeSales(prev, res.data);
          return merged;
        });
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e: any) {
      const isOfflineError = e?.status === 0 || !e?.message?.includes("status");
      if (isOfflineError) {
        // Offline: use only own sales for seller
        setIsOffline(true);
        setSales(filteredLocal);
        setHasMore(false);
      } else {
        if (reset) setError("Не удалось загрузить продажи.");
      }
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
    isOffline,
    handleRefresh,
    handleLoadMore,
    retryFetch,
  };
}

/**
 * Merge local sales with server sales.
 * - Server sales (positive id) replace any local with the same id
 * - Local sales with negative id (pending sync) that don't exist on server are kept
 */
function mergeSales(local: Sale[], server: Sale[]): Sale[] {
  const serverMap = new Map<number, Sale>();
  for (const s of server) {
    serverMap.set(s.id, s);
  }

  // For local sales with negative id, if server has same absolute id, replace with server version.
  // For positive ids, prefer the freshest server version and don't keep a duplicate local row.
  const result: Sale[] = [];
  const seenKeys = new Set<string>();

  const pushUnique = (sale: Sale) => {
    const localId = (sale as { local_id?: string | null }).local_id;
    const key = localId ? `local:${localId}` : `id:${sale.id}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    result.push(sale);
  };

  for (const l of local) {
    if (l.id < 0) {
      // Local pending — check if server has a matching record
      const absId = Math.abs(l.id);
      if (serverMap.has(absId)) {
        // Server version supersedes local pending
        pushUnique(serverMap.get(absId)!);
        serverMap.delete(absId);
      } else {
        // No server counterpart yet — keep local pending
        pushUnique(l);
      }
    } else {
      // Local with positive id mirrors a server record; if server has it, prefer server.
      if (serverMap.has(l.id)) {
        pushUnique(serverMap.get(l.id)!);
        serverMap.delete(l.id);
      } else {
        pushUnique(l);
      }
    }
  }

  // Add remaining server records
  for (const s of serverMap.values()) {
    pushUnique(s);
  }

  // Sort by created_at desc
  result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return result;
}
