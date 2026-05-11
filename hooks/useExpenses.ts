import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { api, ApiError, type Expense, type User } from "@/lib/api";
import { useToast } from "@/store/toast";
import { deleteLocalExpense, getLocalExpenses, localScope } from "@/lib/db";
import type { LocalExpense } from "@/lib/db";
import { useCacheMethods, useIsSyncing } from "@/lib/cache/CacheProvider";

/**
 * Local-first expenses feed. Mirrors useSales: SQLite is the source of
 * truth for the UI; SyncProvider's delta-sync feeds new server records
 * in, and load-more extends the historical window via fetchOlderExpenses.
 *
 * Scoping is derived from `user` via `localScope` — see useSales for the
 * rationale. Expenses are owner-only on the backend, so a seller scope
 * effectively returns nothing here too.
 */
export function useExpenses({ token, user }: { token: string | null; user: User | null | undefined }) {
  const { showToast } = useToast();
  const { triggerSync, fetchOlderExpenses } = useCacheMethods();
  const isSyncing = useIsSyncing();
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
    const localData = await getLocalExpenses(localScope(user));
    setExpenses(localData);
  }, [token, user]);

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

  const dropLocalExpense = useCallback(async (id: string) => {
    try {
      await deleteLocalExpense(id);
    } catch {
      // best-effort
    }
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const handleDelete = useCallback((id: string) => {
    Alert.alert("Удалить расход", "Расход будет удалён безвозвратно.", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await api.expenses.delete(id, token!);
            await dropLocalExpense(id);
            showToast({ message: "Расход удалён", variant: "success" });
          } catch (e: any) {
            if (e?.status === 0) {
              showToast({
                message: "Нет соединения. Проверьте интернет и попробуйте снова.",
                variant: "error",
              });
            } else if (e instanceof ApiError && e.status === 404) {
              await dropLocalExpense(id);
              showToast({
                message: "Расход уже был удалён. Локальная копия очищена.",
                variant: "success",
              });
            } else {
              showToast({ message: "Не удалось удалить расход.", variant: "error" });
            }
          }
        },
      },
    ]);
  }, [token, showToast, dropLocalExpense]);

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
    /** Evict a stale local expense after the server confirms it's gone. */
    dropLocalExpense,
    retryFetch,
  };
}
