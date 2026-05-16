import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { api, ApiError, type Expense, type User } from "@/lib/api";
import { useToast } from "@/store/toast";
import { deleteLocalExpense, getLocalExpenses, localScope } from "@/lib/db";
import type { LocalExpense } from "@/lib/db";
import { useIsOnline } from "@/lib/network/NetworkProvider";

/**
 * Server-first expenses feed. Hits `/expenses` on every load / refresh /
 * load-more; the local SQLite mirror is consulted only when the request
 * fails with a network error so the screen still has something to show
 * offline. Writes refetch the page from the server instead of patching
 * in-memory state by hand — that removes the whole class of "local and
 * server drift apart" bugs that the local-first hook used to hit.
 */
const PAGE_SIZE = 30;

export function useExpenses({ token, user }: { token: string | null; user: User | null | undefined }) {
  const { showToast } = useToast();
  const isOnline = useIsOnline();
  const [expenses, setExpenses] = useState<LocalExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  // True when the latest successful read came from the local mirror —
  // shown in the UI as a stale-data hint.
  const [isOffline, setIsOffline] = useState(false);

  const inFlightRef = useRef(false);

  const fetchPage = useCallback(
    async (cursor?: string | null): Promise<{ data: Expense[]; nextCursor: string | null } | null> => {
      if (!token) return null;
      const response = await api.expenses.list(token, {
        limit: PAGE_SIZE,
        cursor: cursor ?? undefined,
      });
      return {
        data: response.data ?? [],
        nextCursor: (response as { next_cursor?: string | null }).next_cursor ?? null,
      };
    },
    [token],
  );

  // Pull the first page from the server. On network failure, surface the
  // local mirror as a stale view — never block the screen on connectivity.
  const loadFirstPage = useCallback(async () => {
    if (!token || inFlightRef.current) return;
    inFlightRef.current = true;
    setError("");
    try {
      const page = await fetchPage(null);
      if (!page) return;
      setExpenses(page.data as LocalExpense[]);
      setNextCursor(page.nextCursor);
      setHasMore(!!page.nextCursor);
      setIsOffline(false);
    } catch (e) {
      const isNetwork = e instanceof ApiError && e.status === 0;
      if (isNetwork) {
        try {
          const local = await getLocalExpenses(localScope(user));
          setExpenses(local);
          setIsOffline(true);
          setHasMore(false);
          setNextCursor(null);
        } catch {
          setError("Нет сети и нет локальных данных.");
        }
      } else {
        setError(e instanceof Error ? e.message : "Не удалось загрузить расходы.");
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [token, user, fetchPage]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      await loadFirstPage();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, loadFirstPage]);

  // When connectivity returns, refetch — the screen may have been showing
  // the offline fallback up until now.
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (isOnline && wasOfflineRef.current) {
      loadFirstPage().catch(() => {});
    }
    wasOfflineRef.current = !isOnline;
  }, [isOnline, loadFirstPage]);

  const dropLocalExpense = useCallback(async (id: string) => {
    try {
      await deleteLocalExpense(id);
    } catch {
      // best-effort
    }
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      Alert.alert("Удалить расход", "Расход будет удалён безвозвратно.", [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await api.expenses.delete(id, token!);
              setExpenses((prev) => prev.filter((e) => e.id !== id));
              // Drop from local mirror too so a future offline view doesn't
              // resurrect the row.
              deleteLocalExpense(id).catch(() => {});
              showToast({ message: "Расход удалён", variant: "success" });
            } catch (e: unknown) {
              if (e instanceof ApiError && e.status === 0) {
                showToast({
                  message: "Нет соединения. Проверьте интернет и попробуйте снова.",
                  variant: "error",
                });
              } else if (e instanceof ApiError && e.status === 404) {
                setExpenses((prev) => prev.filter((e) => e.id !== id));
                deleteLocalExpense(id).catch(() => {});
                showToast({
                  message: "Расход уже был удалён.",
                  variant: "success",
                });
              } else {
                showToast({ message: "Не удалось удалить расход.", variant: "error" });
              }
            }
          },
        },
      ]);
    },
    [token, showToast],
  );

  // After a create/update we re-pull the first page from the server. The
  // modal already shows its own toast; this hook just makes sure the list
  // matches the server.
  const handleSaved = useCallback(
    (_saved: Expense | LocalExpense, _wasEditing: boolean) => {
      loadFirstPage().catch(() => {});
    },
    [loadFirstPage],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFirstPage();
    } finally {
      setRefreshing(false);
    }
  }, [loadFirstPage]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor || isOffline) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextCursor);
      if (page) {
        setExpenses((prev) => [...prev, ...(page.data as LocalExpense[])]);
        setNextCursor(page.nextCursor);
        setHasMore(!!page.nextCursor);
      }
    } catch {
      // load-more failures are non-fatal; user can retry by scrolling again
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, nextCursor, isOffline, fetchPage]);

  const retryFetch = useCallback(async () => {
    setLoading(true);
    await loadFirstPage();
    setLoading(false);
  }, [loadFirstPage]);

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
