import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Sale, type User } from "@/lib/api";
import { getLocalSales, localScope } from "@/lib/db";
import { useIsOnline } from "@/lib/network/NetworkProvider";

/**
 * Server-first sales feed with server-side search + filter passthrough.
 *
 * - `/sales` is hit on mount / refresh / load-more via cursor pagination.
 * - On a network failure we fall back to whatever is in the local SQLite
 *   mirror so the screen still has data offline (the offline view is NOT
 *   filtered server-side, so the caller can mention "filters disabled
 *   offline" in the UI when `isOffline=true`).
 * - Search/filter params are passed straight to the API. Changing them
 *   resets to page 1 and re-fetches.
 */
const PAGE_SIZE = 30;

export interface SalesQuery {
  search?: string;
  paymentType?: "cash" | "card" | "transfer";
  saleType?: "product" | "service";
  debtOnly?: boolean;
}

export function useSales({
  token,
  user,
  query,
}: {
  token: string | null;
  user: User | null | undefined;
  query?: SalesQuery;
}) {
  const isOnline = useIsOnline();

  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const inFlightRef = useRef(false);
  // Capture the current query in a ref so fetchPage closures always see
  // the latest values without forcing the callback identity to change on
  // every keystroke.
  const queryRef = useRef<SalesQuery | undefined>(query);
  queryRef.current = query;

  const fetchPage = useCallback(
    async (cursor?: string | null): Promise<{ data: Sale[]; nextCursor: string | null } | null> => {
      if (!token) return null;
      const q = queryRef.current;
      const response = await api.sales.list(token, {
        limit: PAGE_SIZE,
        cursor: cursor ?? undefined,
        search: q?.search?.trim() ? q.search.trim() : undefined,
        payment_type: q?.paymentType,
        type: q?.saleType,
        debt_only: q?.debtOnly ? true : undefined,
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
      setSales(page.data);
      setNextCursor(page.nextCursor);
      setHasMore(!!page.nextCursor);
      setIsOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        try {
          const local = await getLocalSales(localScope(user));
          setSales(local);
          setIsOffline(true);
          setHasMore(false);
          setNextCursor(null);
        } catch {
          setError("Нет сети и нет локальных данных.");
        }
      } else {
        setError(e instanceof Error ? e.message : "Не удалось загрузить продажи.");
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [token, user, fetchPage]);

  // Initial load + reload whenever the query changes. Using a stringified
  // serialization keeps the effect deps stable (we don't want to depend
  // on a reference that the caller might recreate every render).
  const querySignature = JSON.stringify({
    search: query?.search?.trim() ?? "",
    paymentType: query?.paymentType ?? "",
    saleType: query?.saleType ?? "",
    debtOnly: !!query?.debtOnly,
  });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      await loadFirstPage();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, querySignature, loadFirstPage]);

  // Refresh when connectivity returns after we'd fallen back to the cache.
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
        setSales((prev) => [...prev, ...page.data]);
        setNextCursor(page.nextCursor);
        setHasMore(!!page.nextCursor);
      }
    } catch {
      // non-fatal — user can retry by scrolling again
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
