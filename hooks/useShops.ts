import { useCallback, useEffect, useState } from "react";
import { api, type Shop } from "@/lib/api";
import { getLocalShops, type LocalShop } from "@/lib/db";

export function useShops({ token }: { token: string | null }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const fetchShops = useCallback(async (reset = false) => {
    if (!token) return;
    setError("");

    // Always load local shops first — instant, always works
    const localShops = await getLocalShops();

    try {
      const res = await api.shops.list(token);
      setIsOffline(false);
      const serverShops: Shop[] = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      // Merge: server shops + any local-only pending shops
      const merged = mergeShops(localShops, serverShops);
      setShops(merged);
    } catch (e: any) {
      const isOfflineError = e?.status === 0 || !e?.message?.includes("status");
      if (isOfflineError) {
        setIsOffline(true);
        setShops(localShops as Shop[]);
      } else {
        if (reset) setError("Не удалось загрузить магазины.");
      }
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchShops(true).finally(() => setLoading(false));
    }
  }, [token]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchShops(true).finally(() => setRefreshing(false));
  }, [fetchShops]);

  const retryFetch = useCallback(() => {
    setLoading(true);
    fetchShops(true).finally(() => setLoading(false));
  }, [fetchShops]);

  return {
    shops,
    setShops,
    loading,
    refreshing,
    error,
    isOffline,
    handleRefresh,
    retryFetch,
  };
}

/**
 * Merge local shops with server shops.
 * - Server shops replace any local with same id
 * - Local shops with negative id (pending sync) that don't exist on server are kept
 */
function mergeShops(local: LocalShop[], server: Shop[]): Shop[] {
  const serverMap = new Map<number, Shop>();
  for (const s of server) {
    serverMap.set(s.id, s);
  }

  const result: Shop[] = [];
  for (const l of local) {
    if (l.id < 0) {
      // Local pending — keep if not on server
      if (!serverMap.has(l.id)) {
        result.push(l);
      }
    } else if (serverMap.has(l.id)) {
      // Server version supersedes
      result.push(serverMap.get(l.id)!);
      serverMap.delete(l.id);
    } else {
      result.push(l);
    }
  }

  for (const s of serverMap.values()) {
    result.push(s);
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}
