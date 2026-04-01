import { useState, useCallback, useEffect } from "react";
import { api, type DashboardPeriod, type DashboardSummary, type Shop } from "@/lib/api";

export function useDashboard({ token, isSuperAdmin }: { token: string | null; isSuperAdmin: boolean }) {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  const [activeShopId, setActiveShopId] = useState<number | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [dateFrom, setDateFrom] = useState<string | null>(null);
  const [dateTo, setDateTo] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки данных");
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false);
    }
  }, [token, period, activeShopId, dateFrom, dateTo]);

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
    fetchDashboard,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
  };
}
