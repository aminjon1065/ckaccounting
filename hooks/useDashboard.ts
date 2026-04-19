import { useState, useCallback, useEffect } from "react";
import { api, type DashboardPeriod, type DashboardSummary, type Shop } from "@/lib/api";
import { getDashboardCache, setDashboardCache } from "@/lib/db";

export function useDashboard({ token, isSuperAdmin }: { token: string | null; isSuperAdmin: boolean }) {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
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

  const cacheKey = `dashboard_${period}_${activeShopId ?? "all"}_${dateFrom ?? ""}_${dateTo ?? ""}`;

  useEffect(() => {
    if (isSuperAdmin && token) {
      api.shops.list(token).then((res: any) => setShops(Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [])).catch(console.error);
    }
  }, [isSuperAdmin, token]);

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
      const isOfflineError = err?.status === 0 || !err?.message?.includes("status");
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

  useEffect(() => {
    fetchDashboard();
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
