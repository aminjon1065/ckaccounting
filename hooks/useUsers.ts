import { useCallback, useEffect, useState } from "react";
import { api, type AppUser } from "@/lib/api";
import { getDashboardCache, setDashboardCache } from "@/lib/db";

export function useUsers({ token }: { token: string | null }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const fetchUsers = useCallback(async (reset = false) => {
    if (!token) return;
    setError("");

    try {
      const res: any = await api.users.list(token);
      const data: AppUser[] = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      setUsers(data);
      setIsOffline(false);
      await setDashboardCache("users_list", data);
    } catch (e: any) {
      const isOfflineError = e?.status === 0 || !e?.message?.includes("status");
      if (isOfflineError) {
        setIsOffline(true);
        const cached = await getDashboardCache("users_list");
        if (cached?.data) {
          setUsers(cached.data as AppUser[]);
        } else {
          setError("Нет сети. Список сотрудников недоступен.");
        }
      } else {
        if (reset) setError("Не удалось загрузить сотрудников.");
      }
    }
  }, [token]);

  useEffect(() => {
    if (token) {
      fetchUsers(true).finally(() => setLoading(false));
    }
  }, [token]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchUsers(true).finally(() => setRefreshing(false));
  }, [fetchUsers]);

  const retryFetch = useCallback(() => {
    setLoading(true);
    fetchUsers(true).finally(() => setLoading(false));
  }, [fetchUsers]);

  return {
    users,
    setUsers,
    loading,
    refreshing,
    error,
    isOffline,
    handleRefresh,
    retryFetch,
  };
}
