import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Purchase, type User } from "@/lib/api";
import { getLocalPurchases, localScope } from "@/lib/db";
import { useIsOnline } from "@/lib/network/NetworkProvider";

/**
 * Server-first purchases feed. Hits `/purchases` for the first page on
 * mount / refresh, paginates via cursor on load-more. The local SQLite
 * mirror is consulted only when the request fails with a network error,
 * so the screen still shows something offline.
 */
const PAGE_SIZE = 30;

export function usePurchases({ token, user }: { token: string | null; user: User | null | undefined }) {
  const isOnline = useIsOnline();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const inFlightRef = useRef(false);

  const fetchPage = useCallback(
    async (cursor?: string | null): Promise<{ data: Purchase[]; nextCursor: string | null } | null> => {
      if (!token) return null;
      const response = await api.purchases.list(token, {
        limit: PAGE_SIZE,
        cursor: cursor ?? undefined,
      });
      return {
        data: response.data ?? [],
        nextCursor: (response as { next_cursor?: string | null }).next_cursor ?? null,
      };
    },
    [token],
  );

  const loadFirstPage = useCallback(async () => {
    if (!token || inFlightRef.current) return;
    inFlightRef.current = true;
    setError("");
    try {
      const page = await fetchPage(null);
      if (!page) return;
      setPurchases(page.data);
      setNextCursor(page.nextCursor);
      setHasMore(!!page.nextCursor);
      setIsOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        try {
          const local = await getLocalPurchases(localScope(user));
          setPurchases(local);
          setIsOffline(true);
          setHasMore(false);
          setNextCursor(null);
        } catch {
          setError("Нет сети и нет локальных данных.");
        }
      } else {
        setError(e instanceof Error ? e.message : "Не удалось загрузить закупки.");
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [token, user, fetchPage]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      await loadFirstPage();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, loadFirstPage]);

  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (isOnline && wasOfflineRef.current) {
      loadFirstPage().catch(() => {});
    }
    wasOfflineRef.current = !isOnline;
  }, [isOnline, loadFirstPage]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFirstPage();
    } finally {
      setRefreshing(false);
    }
  }, [loadFirstPage]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor || isOffline) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextCursor);
      if (page) {
        setPurchases((prev) => [...prev, ...page.data]);
        setNextCursor(page.nextCursor);
        setHasMore(!!page.nextCursor);
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextCursor, isOffline, fetchPage]);

  const retryFetch = useCallback(async () => {
    setLoading(true);
    await loadFirstPage();
    setLoading(false);
  }, [loadFirstPage]);

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
