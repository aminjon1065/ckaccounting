import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { api, type Expense } from "@/lib/api";
import { useToast } from "@/store/toast";
import { getLocalExpenses, markExpenseDeletedLocally, deleteLocalExpense } from "@/lib/db";
import type { LocalExpense } from "@/lib/db";
import { useSync } from "@/lib/sync/SyncContext";

/**
 * Local-first expenses feed. Mirrors useSales: SQLite is the source of
 * truth for the UI; SyncProvider's delta-sync feeds new server records
 * in, and load-more extends the historical window via fetchOlderExpenses.
 */
export function useExpenses({ token, shopId }: { token: string | null; shopId?: number }) {
  const { showToast } = useToast();
  const { triggerSync, fetchOlderExpenses, isSyncing } = useSync();
  const [expenses, setExpenses] = useState<LocalExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const isOffline = false;

  const wasSyncingRef = useRef(false);

  const loadFromLocal = useCallback(async () => {
    if (!token) return;
    const localData = await getLocalExpenses(shopId);
    setExpenses(localData);
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

  const handleDelete = useCallback((id: string) => {
    Alert.alert("Удалить расход", "Расход будет удалён безвозвратно.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await api.expenses.delete(id, token!);
            await deleteLocalExpense(id);
            setExpenses((prev) => prev.filter((e) => e.id !== id));
            showToast({ message: "Расход удалён", variant: "success" });
          } catch (e: any) {
            if (e?.status === 0) {
              await markExpenseDeletedLocally(id);
              setExpenses((prev) => prev.filter((e) => e.id !== id));
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
      const idx = prev.findIndex((e) => e.id === saved.id);
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      await triggerSync();
      await loadFromLocal();
    } catch {
      setError("Не удалось обновить расходы.");
    } finally {
      setRefreshing(false);
    }
  }, [triggerSync, loadFromLocal]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const moreAvailable = await fetchOlderExpenses(1);
      await loadFromLocal();
      setHasMore(moreAvailable);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, fetchOlderExpenses, loadFromLocal]);

  const retryFetch = useCallback(async () => {
    setLoading(true);
    setError("");
    await loadFromLocal();
    setLoading(false);
  }, [loadFromLocal]);

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
