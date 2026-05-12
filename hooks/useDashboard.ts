import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { api, type DashboardPeriod, type DashboardSummary, type Shop } from "@/lib/api";
import { getDashboardCache, setDashboardCache } from "@/lib/db";

const FILTER_DEBOUNCE_MS = 250;

export function useDashboard({
  token,
  isSuperAdmin,
  isMultiShopOwner = false,
}: {
  token: string | null;
  isSuperAdmin: boolean;
  /** Owner with more than one assigned shop — show the same shop picker. */
  isMultiShopOwner?: boolean;
}) {
  const [period, setPeriod] = useState<DashboardPeriod>("day");
  const [activeShopId, setActiveShopId] = useState<number | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [cacheAge, setCacheAge] = useState<string | null>(null);

  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);

  // Stable cache key — useMemo so reference equality holds across renders
  // when filter inputs haven't changed (prevents needless fetches).
  const cacheKey = useMemo(
    () => `dashboard_${period}_${activeShopId ?? "all"}_${dateFrom ?? ""}_${dateTo ?? ""}`,
    [period, activeShopId, dateFrom, dateTo]
  );

  useEffect(() => {
    // Load the shop list for anyone who needs the dashboard picker:
    // super_admin (sees every shop) and multi-shop owners (sees their
    // owned set — server-side scoped via accessibleShopIds).
    if ((isSuperAdmin || isMultiShopOwner) && token) {
      api.shops
        .list(token)
        .then((res: any) =>
          setShops(Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []),
        )
        .catch(console.error);
    }
  }, [isSuperAdmin, isMultiShopOwner, token]);

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (!token) return;
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);

    try {
      const sum = await api.dashboard.summary(period, token, activeShopId ?? undefined, dateFrom ?? undefined, dateTo ?? undefined);
      setSummary(sum);
      setIsOffline(false);
      // Cache successful response
      await setDashboardCache(cacheKey, sum);
    } catch (err: any) {
      const isOfflineError =
        err?.status === 0 ||
        err?.message === "Network request failed" ||
        (typeof err?.message === "string" && err.message.includes("Network request failed"));
      if (isOfflineError) {
        setIsOffline(true);
        // Try to load from cache
        const cached = await getDashboardCache(cacheKey);
        if (cached) {
          setSummary(cached.data as DashboardSummary);
          setError(null);
          if (cached.stale) {
            const age = Math.round((Date.now() - new Date(cached.fetched_at).getTime()) / 60000);
            setCacheAge(`Данные обновлены ${age} мин. назад`);
          } else {
            setCacheAge(null);
          }
        } else {
          setSummary(null);
          setError("Нет сети. Данные недоступны офлайн.");
          setCacheAge(null);
        }
      } else {
        setError(err instanceof Error ? err.message : "Ошибка загрузки данных");
      }
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false);
    }
  }, [token, period, activeShopId, dateFrom, dateTo, cacheKey]);

  // Debounce filter changes so rapid taps (period / shop / date pickers)
  // collapse into a single network request.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      fetchDashboard();
    }, FILTER_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [fetchDashboard]);

  return {
    period,
    setPeriod,
    activeShopId,
    setActiveShopId,
    shops,
    summary,
    loading,
    refreshing,
    error,
    isOffline,
    cacheAge,
    fetchDashboard,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
  };
}
