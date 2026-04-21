import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { api, type Expense } from "@/lib/api";
import { useToast } from "@/store/toast";
import { getLocalExpenses, insertOrUpdateExpenses, queueSyncAction, updateExpenseStatus } from "@/lib/db";
import type { LocalExpense } from "@/lib/db";

export function useExpenses({ token, shopId }: { token: string | null; shopId?: number }) {
  const { showToast } = useToast();
  const [expenses, setExpenses] = useState<LocalExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [isOffline, setIsOffline] = useState(false);

  const fetchExpenses = useCallback(async (reset = false) => {
    if (!token) return;
    const pg = reset ? 1 : page;
    setError("");

    // Always load local first — instant
    const localData = await getLocalExpenses(shopId);

    try {
      const res = await api.expenses.list(token, { page: pg });
      setIsOffline(false);

      if (reset) {
        const merged = mergeExpenses(localData, res.data);
        setExpenses(merged);
        setPage(2);
      } else {
        setExpenses((prev) => {
          const merged = mergeExpenses(prev, res.data);
          return merged;
        });
        setPage(pg + 1);
      }
      setHasMore(res.meta.current_page < res.meta.last_page);
    } catch (e: any) {
      const isOfflineError = e?.status === 0 || !e?.message?.includes("status");
      if (isOfflineError) {
        setIsOffline(true);
        setExpenses(localData);
        setHasMore(false);
      } else {
        if (reset) setError("Не удалось загрузить расходы.");
      }
    }
  }, [token, page, shopId]);

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
          } catch (e: any) {
            if (e?.status === 0) {
              // Offline: mark for deletion locally
              setExpenses((prev) => {
                const idx = prev.findIndex((e) => e.id === id);
                if (idx >= 0) {
                  const next = [...prev];
                  next[idx] = { ...next[idx], sync_action: "delete", status: "pending" };
                  return next;
                }
                return prev;
              });
              await queueSyncAction("DELETE", `/expenses/${id}`, {}, undefined, `local-exp-delete-${id}`);
              showToast({ message: "Удалено локально. Будет удалено после синхронизации.", variant: "warning" });
            } else {
              showToast({ message: "Не удалось удалить расход.", variant: "error" });
            }
          }
        },
      },
    ]);
  }, [token, showToast]);

  const handleSaved = useCallback((saved: Expense | LocalExpense, wasEditing: boolean) => {
    setExpenses((prev) => {
      const id = (saved as LocalExpense).local_id ? (saved as LocalExpense).local_id : saved.id;
      const idx = prev.findIndex((e) => e.id === saved.id || (e as LocalExpense).local_id === id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved as LocalExpense;
        return next;
      }
      return [saved as LocalExpense, ...prev];
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
    isOffline,
    handleDelete,
    handleSaved,
    handleRefresh,
    handleLoadMore,
    retryFetch,
  };
}

function mergeExpenses(local: LocalExpense[], server: Expense[]): LocalExpense[] {
  const serverMap = new Map<number, Expense>();
  for (const s of server) {
    serverMap.set(s.id, s);
  }

  const result: LocalExpense[] = [];

  for (const l of local) {
    if (l.id > 0 && serverMap.has(l.id)) {
      result.push({ ...serverMap.get(l.id)!, local_id: l.local_id, status: l.status, sync_action: l.sync_action } as LocalExpense);
      serverMap.delete(l.id);
    } else if (l.sync_action && l.sync_action !== "none") {
      result.push(l);
    } else if (l.id < 0) {
      result.push(l);
    }
  }

  for (const s of serverMap.values()) {
    result.push(s as LocalExpense);
  }

  result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return result;
}