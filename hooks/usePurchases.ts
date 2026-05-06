import { useCallback, useEffect, useRef, useState } from "react";
import { type Purchase } from "@/lib/api";
import { getLocalPurchases, type LocalPurchase } from "@/lib/db";
import { useSync } from "@/lib/sync/SyncContext";

/**
 * Local-first purchases feed. SQLite is source of truth; SyncProvider
 * delta-sync brings new server records in; load-more extends history
 * via fetchOlderPurchases.
 */
export function usePurchases({ token, shopId }: { token: string | null; shopId?: number | null }) {
  const { triggerSync, fetchOlderPurchases, isSyncing } = useSync();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const isOffline = false;

  const wasSyncingRef = useRef(false);

  const loadFromLocal = useCallback(async () => {
    if (!token) return;
    const local = await getLocalPurchases(shopId ?? undefined);
    setPurchases(dedupePurchases(local as Purchase[]));
  }, [token, shopId]);

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
      setError("Не удалось обновить закупки.");
    } finally {
      setRefreshing(false);
    }
  }, [triggerSync, loadFromLocal]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const moreAvailable = await fetchOlderPurchases(1);
      await loadFromLocal();
      setHasMore(moreAvailable);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, fetchOlderPurchases, loadFromLocal]);

  const retryFetch = useCallback(async () => {
    setLoading(true);
    setError("");
    await loadFromLocal();
    setLoading(false);
  }, [loadFromLocal]);

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

function purchaseKey(purchase: Purchase): string {
  return `id:${purchase.id}`;
}

function dedupePurchases(purchases: Purchase[]): Purchase[] {
  const byKey = new Map<string, Purchase>();

  for (const purchase of purchases) {
    const key = purchaseKey(purchase);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, purchase);
      continue;
    }

    const existingIsPending = (existing as LocalPurchase).sync_action &&
      (existing as LocalPurchase).sync_action !== "none";
    const currentIsPending = (purchase as LocalPurchase).sync_action &&
      (purchase as LocalPurchase).sync_action !== "none";

    if (existingIsPending && !currentIsPending) {
      byKey.set(key, purchase);
    }
  }

  return Array.from(byKey.values());
}
