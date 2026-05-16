// ─── useShops ────────────────────────────────────────────────────────────────
//
// Server-first: the shops list always reflects what `/shops` returns.
// On a network failure we fall back to whatever SQLite has so the screen
// is still useful offline. Writes refetch from the server instead of
// merging server responses by hand.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Shop } from "@/lib/api";
import { deleteLocalShop, getLocalShops } from "@/lib/db";
import { useIsOnline } from "@/lib/network/NetworkProvider";
import { reportError } from "@/lib/observability/reporter";

export function useShops({ token }: { token: string | null }) {
  const isOnline = useIsOnline();
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const fetchShops = useCallback(async () => {
    if (!token) return;
    setError("");
    try {
      const res = await api.shops.list(token);
      setShops(res.data ?? []);
      setIsOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        try {
          const local = await getLocalShops();
          setShops(local);
          setIsOffline(true);
        } catch (le) {
          reportError(le, { tag: "useShops-offline-fallback" });
          setError("Нет сети и нет локальных данных.");
        }
      } else {
        reportError(e, { tag: "useShops-fetch" });
        setError(e instanceof Error ? e.message : "Не удалось загрузить магазины.");
      }
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchShops().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [token, fetchShops]);

  // Refresh when connectivity returns after we'd fallen back to the cache.
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (isOnline && wasOfflineRef.current) {
      fetchShops().catch(() => {});
    }
    wasOfflineRef.current = !isOnline;
  }, [isOnline, fetchShops]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchShops().finally(() => setRefreshing(false));
  }, [fetchShops]);

  /**
   * Drop a shop from local SQLite without going through the server. Use when
   * the server has already told us the row is gone (e.g. 404 on update) so
   * the next render doesn't show the ghost.
   */
  const dropLocal = useCallback(async (id: number) => {
    await deleteLocalShop(id);
    setShops((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return {
    shops,
    setShops,
    loading,
    refreshing,
    error,
    isOffline,
    handleRefresh,
    dropLocal,
  };
}
