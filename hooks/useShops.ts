// ─── useShops ────────────────────────────────────────────────────────────────
//
// Local SQLite is the single source of truth for the screen. The cache layer
// (RemoteShopFetcher) keeps SQLite in sync with the server — including
// applying soft-delete tombstones and, on reconcile, pruning ghost rows the
// server hard-deleted. This hook just reads from SQLite and asks the cache
// to refresh; it does not merge a transient API response into local state.
//
// Why this matters: an earlier version called `api.shops.list` directly and
// merged the result with local rows, keeping any local row that was absent
// from the server response. That preserved deleted shops indefinitely and
// produced "Resource not found" on subsequent edits.

import { useCallback, useEffect, useState } from "react";
import { useCacheMethods } from "@/lib/cache/CacheProvider";
import { deleteLocalShop, getLocalShops } from "@/lib/db";
import type { Shop } from "@/lib/api";
import { reportError } from "@/lib/observability/reporter";

export function useShops({ token }: { token: string | null }) {
  const { reconcileRemoteShops, fetchRemoteShops } = useCacheMethods();
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadFromLocal = useCallback(async () => {
    const local = await getLocalShops();
    setShops(local);
  }, []);

  const reconcileAndLoad = useCallback(async () => {
    setError("");
    // Reconcile prunes ghosts (server hard-deletes); fetch pulls fresh row
    // data via delta sync — including owner_id / owner_name / is_active /
    // name updates made on this device or another. Without the fetch call,
    // SQLite would stay frozen on its initial snapshot for everything but
    // shop existence, and edits made elsewhere would never appear locally.
    try {
      await Promise.all([reconcileRemoteShops(), fetchRemoteShops()]);
    } catch (e) {
      reportError(e, { tag: "useShops-reconcile" });
    }
    try {
      await loadFromLocal();
    } catch (e) {
      reportError(e, { tag: "useShops-load" });
      setError("Не удалось загрузить магазины.");
    }
  }, [reconcileRemoteShops, fetchRemoteShops, loadFromLocal]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    loadFromLocal()
      .catch((e) => reportError(e, { tag: "useShops-initial-load" }))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    reconcileAndLoad().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, loadFromLocal, reconcileAndLoad]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    reconcileAndLoad().finally(() => setRefreshing(false));
  }, [reconcileAndLoad]);

  /**
   * Drop a shop from local SQLite without going through the server. Use when
   * the server has already told us the row is gone (e.g. 404 on update) so
   * the next render doesn't show the ghost.
   */
  const dropLocal = useCallback(async (id: number) => {
    await deleteLocalShop(id);
    await loadFromLocal();
  }, [loadFromLocal]);

  return {
    shops,
    setShops,
    loading,
    refreshing,
    error,
    handleRefresh,
    dropLocal,
  };
}
