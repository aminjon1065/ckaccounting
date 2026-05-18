// ─── Expenses queries & mutations ───────────────────────────────────────────
//
// React Query hooks for the expenses domain. Same shape as purchases/sales:
//   • Page-based infinite list with deleted-row filtering.
//   • Detail seeded from list cache (we don't have a dedicated detail
//     screen today, but the cache is ready for one).
//   • Optimistic patches on update / delete; rollback from snapshot.
//   • Invalidates dashboard on every write (expenses feed into KPI cards).

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import {
  api,
  type CreateExpensePayload,
  type Expense,
  type Paginated,
} from "@/lib/api";

const PAGE_SIZE = 30;

// ─── Keys ────────────────────────────────────────────────────────────────────

export const expenseKeys = {
  all: ["expenses"] as const,
  lists: () => [...expenseKeys.all, "list"] as const,
  list: (filters?: Record<string, unknown>) =>
    [...expenseKeys.lists(), filters ?? {}] as const,
  details: () => [...expenseKeys.all, "detail"] as const,
  detail: (id: string) => [...expenseKeys.details(), id] as const,
};

// ─── List ────────────────────────────────────────────────────────────────────

export interface ExpenseListPage {
  data: Expense[];
  page: number;
  lastPage: number;
}

async function fetchExpensesPage(token: string, page: number): Promise<ExpenseListPage> {
  const response = await api.expenses.list(token, { limit: PAGE_SIZE, page });
  const meta = (response as Paginated<Expense>).meta;
  // See purchases.ts — server emits soft-deleted rows for SQLite mirror
  // pruning; in-memory UI filters them out so a delete doesn't bubble back.
  const rows = (response.data ?? []).filter((e) => !e.deleted_at);
  return {
    data: rows,
    page: meta?.current_page ?? page,
    lastPage: meta?.last_page ?? page,
  };
}

export function useExpenseList(token: string | null) {
  return useInfiniteQuery({
    queryKey: expenseKeys.list(),
    enabled: !!token,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchExpensesPage(token!, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.lastPage ? lastPage.page + 1 : undefined,
    placeholderData: (prev) => prev,
  });
}

// ─── Detail ─────────────────────────────────────────────────────────────────

export function useExpenseDetail(id: string | undefined, token: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: id ? expenseKeys.detail(id) : ["expenses", "detail", "noop"],
    enabled: !!id && !!token,
    queryFn: () => api.expenses.get(id!, token!),
    initialData: () => {
      if (!id) return undefined;
      const lists = queryClient.getQueriesData<InfiniteData<ExpenseListPage>>({
        queryKey: expenseKeys.lists(),
      });
      for (const [, infiniteData] of lists) {
        if (!infiniteData) continue;
        for (const page of infiniteData.pages) {
          const hit = page.data.find((e) => e.id === id);
          if (hit) return hit;
        }
      }
      return undefined;
    },
    initialDataUpdatedAt: 0,
  });
}

// ─── List-cache helpers ─────────────────────────────────────────────────────

function patchListsRemove(queryClient: QueryClient, id: string): void {
  queryClient.setQueriesData<InfiniteData<ExpenseListPage>>(
    { queryKey: expenseKeys.lists() },
    (old) => {
      if (!old) return old;
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          data: p.data.filter((x) => x.id !== id),
        })),
      };
    },
  );
}

function patchListsUpsert(queryClient: QueryClient, updated: Expense): void {
  queryClient.setQueriesData<InfiniteData<ExpenseListPage>>(
    { queryKey: expenseKeys.lists() },
    (old) => {
      if (!old) return old;
      let inserted = false;
      const nextPages = old.pages.map((page) => ({
        ...page,
        data: page.data.map((x) => {
          if (x.id === updated.id) {
            inserted = true;
            return updated;
          }
          return x;
        }),
      }));
      if (!inserted && nextPages.length > 0) {
        nextPages[0] = {
          ...nextPages[0],
          data: [updated, ...nextPages[0].data],
        };
      }
      return { ...old, pages: nextPages };
    },
  );
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export interface CreateExpenseArgs {
  payload: CreateExpensePayload & { shop_id?: number };
  idempotencyKey: string;
}

export function useCreateExpense(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: CreateExpenseArgs) =>
      api.expenses.create(payload, token!, idempotencyKey),
    onSuccess: (created) => {
      queryClient.setQueryData(expenseKeys.detail(created.id), created);
      queryClient.invalidateQueries({ queryKey: expenseKeys.lists() });
      // Expenses show up on the dashboard's KPI cards / charts.
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface UpdateExpenseArgs {
  id: string;
  payload: Partial<CreateExpensePayload>;
}

export function useUpdateExpense(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: UpdateExpenseArgs) =>
      api.expenses.update(id, payload, token!),
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: expenseKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: expenseKeys.lists() });

      const previousDetail = queryClient.getQueryData<Expense>(expenseKeys.detail(id));
      const previousLists = queryClient.getQueriesData<InfiniteData<ExpenseListPage>>({
        queryKey: expenseKeys.lists(),
      });

      if (previousDetail) {
        const nextQuantity =
          payload.quantity !== undefined ? payload.quantity : previousDetail.quantity;
        const nextPrice =
          payload.price !== undefined ? payload.price : previousDetail.price;
        const optimistic: Expense = {
          ...previousDetail,
          ...(payload.name !== undefined && { name: payload.name }),
          ...(payload.unit !== undefined && { unit: payload.unit ?? null }),
          quantity: nextQuantity,
          price: nextPrice,
          total: nextQuantity * nextPrice,
          ...(payload.note !== undefined && { note: payload.note ?? null }),
        };
        queryClient.setQueryData(expenseKeys.detail(id), optimistic);
        patchListsUpsert(queryClient, optimistic);
      }

      return { previousDetail, previousLists };
    },
    onError: (_err, { id }, context) => {
      if (!context) return;
      if (context.previousDetail) {
        queryClient.setQueryData(expenseKeys.detail(id), context.previousDetail);
      }
      for (const [key, snapshot] of context.previousLists) {
        queryClient.setQueryData(key, snapshot);
      }
    },
    onSuccess: (server, { id }) => {
      queryClient.setQueryData(expenseKeys.detail(id), server);
      patchListsUpsert(queryClient, server);
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: expenseKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface DeleteExpenseArgs {
  id: string;
}

export function useDeleteExpense(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteExpenseArgs) => api.expenses.delete(id, token!),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: expenseKeys.lists() });
      const previousLists = queryClient.getQueriesData<InfiniteData<ExpenseListPage>>({
        queryKey: expenseKeys.lists(),
      });
      patchListsRemove(queryClient, id);
      return { previousLists };
    },
    onError: (_err, _args, context) => {
      if (!context) return;
      for (const [key, snapshot] of context.previousLists) {
        queryClient.setQueryData(key, snapshot);
      }
    },
    onSuccess: (_data, { id }) => {
      queryClient.removeQueries({ queryKey: expenseKeys.detail(id) });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: expenseKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
