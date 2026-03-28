import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { api, type Expense } from "@/lib/api";
import { useToast } from "@/store/toast";

export function useExpenses({ token }: { token: string | null }) {
  const { showToast } = useToast();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const fetchExpenses = useCallback(async (reset = false) => {
    if (!token) return;
    const pg = reset ? 1 : page;
    setError("");
    try {
      const res = await api.expenses.list(token, { page: pg });
      if (reset) {
        setExpenses(res.data);
        setPage(2);
      } else {
        setExpenses((prev) => [...prev, ...res.data]);
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e) {
      console.error("Expenses fetch error:", e);
      if (reset) setError("Не удалось загрузить расходы.");
    }
  }, [token, page]);

  useEffect(() => {
    if (token) {
      fetchExpenses(true).finally(() => setLoading(false));
    }
  }, [token]);

  const handleDelete = useCallback((id: number) => {
    Alert.alert("Удалить расход", "Расход будет удалён безвозвратно.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await api.expenses.delete(id, token!);
            setExpenses((prev) => prev.filter((e) => e.id !== id));
            showToast({ message: "Расход удалён", variant: "success" });
          } catch {
            showToast({ message: "Не удалось удалить расход.", variant: "error" });
          }
        },
      },
    ]);
  }, [token, showToast]);

  const handleSaved = useCallback((saved: Expense, wasEditing: boolean) => {
    setExpenses((prev) => {
      const idx = prev.findIndex((e) => e.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
    showToast({
      message: wasEditing ? "Расход обновлён" : "Расход добавлен",
      variant: "success",
    });
  }, [showToast]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchExpenses(true).finally(() => setRefreshing(false));
  }, [fetchExpenses]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    fetchExpenses(false).finally(() => setLoadingMore(false));
  }, [hasMore, loadingMore, fetchExpenses]);

  const retryFetch = useCallback(() => {
    setLoading(true);
    fetchExpenses(true).finally(() => setLoading(false));
  }, [fetchExpenses]);

  return {
    expenses,
    loading,
    refreshing,
    hasMore,
    loadingMore,
    error,
    handleDelete,
    handleSaved,
    handleRefresh,
    handleLoadMore,
    retryFetch,
  };
}
