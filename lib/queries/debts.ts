// ─── Debts queries & mutations ──────────────────────────────────────────────
//
// React Query hooks for the debts domain. Two-level resource:
//   • `Debt` — top-level record (person, opening balance, current balance)
//   • `DebtTransaction` — child rows that mutate the parent balance
//
// The transactions endpoint returns the FULL updated Debt (with the new
// transaction in `transactions`), so `useAddDebtTransaction` writes the
// server response directly into the detail cache and lets the list-cache
// patch step bump the matching row. Optimistic step is skipped — the
// server's balance computation can flip the debt's direction
// (receivable ↔ payable) when amount crosses zero, and faking that
// locally is fragile.

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import {
  api,
  type CreateDebtPayload,
  type CreateDebtTransactionPayload,
  type Debt,
  type Paginated,
} from "@/lib/api";

const PAGE_SIZE = 50;

// ─── Keys ────────────────────────────────────────────────────────────────────

export const debtKeys = {
  all: ["debts"] as const,
  lists: () => [...debtKeys.all, "list"] as const,
  list: (filters?: Record<string, unknown>) =>
    [...debtKeys.lists(), filters ?? {}] as const,
  details: () => [...debtKeys.all, "detail"] as const,
  detail: (id: string) => [...debtKeys.details(), id] as const,
};

// ─── List ────────────────────────────────────────────────────────────────────

export interface DebtListPage {
  data: Debt[];
  page: number;
  lastPage: number;
}

async function fetchDebtsPage(token: string, page: number): Promise<DebtListPage> {
  const response = await api.debts.list(token, { limit: PAGE_SIZE, page });
  const meta = (response as Paginated<Debt>).meta;
  // Server emits tombstones for SQLite-mirror pruning; filter for in-memory.
  const rows = (response.data ?? []).filter((d) => !d.deleted_at);
  return {
    data: rows,
    page: meta?.current_page ?? page,
    lastPage: meta?.last_page ?? page,
  };
}

export function useDebtList(token: string | null) {
  return useInfiniteQuery({
    queryKey: debtKeys.list(),
    enabled: !!token,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchDebtsPage(token!, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.lastPage ? lastPage.page + 1 : undefined,
    placeholderData: (prev) => prev,
  });
}

// ─── Detail ─────────────────────────────────────────────────────────────────

export function useDebtDetail(id: string | undefined, token: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: id ? debtKeys.detail(id) : ["debts", "detail", "noop"],
    enabled: !!id && !!token,
    queryFn: () => api.debts.get(id!, token!),
    initialData: () => {
      if (!id) return undefined;
      const lists = queryClient.getQueriesData<InfiniteData<DebtListPage>>({
        queryKey: debtKeys.lists(),
      });
      for (const [, infiniteData] of lists) {
        if (!infiniteData) continue;
        for (const page of infiniteData.pages) {
          const hit = page.data.find((d) => d.id === id);
          if (hit) return hit;
        }
      }
      return undefined;
    },
    // List rows don't carry `transactions[]` — the detail screen needs
    // the full payload, so seeded data is treated as stale and a fresh
    // fetch fires in the background.
    initialDataUpdatedAt: 0,
  });
}

// ─── List-cache helpers ─────────────────────────────────────────────────────

function patchListsRemove(queryClient: QueryClient, id: string): void {
  queryClient.setQueriesData<InfiniteData<DebtListPage>>(
    { queryKey: debtKeys.lists() },
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

function patchListsUpsert(queryClient: QueryClient, updated: Debt): void {
  queryClient.setQueriesData<InfiniteData<DebtListPage>>(
    { queryKey: debtKeys.lists() },
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

export interface CreateDebtArgs {
  payload: CreateDebtPayload;
  idempotencyKey: string;
}

export function useCreateDebt(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: CreateDebtArgs) =>
      api.debts.create(payload, token!, idempotencyKey),
    onSuccess: (created) => {
      queryClient.setQueryData(debtKeys.detail(created.id), created);
      queryClient.invalidateQueries({ queryKey: debtKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface AddDebtTransactionArgs {
  id: string;
  payload: CreateDebtTransactionPayload;
  idempotencyKey: string;
}

export function useAddDebtTransaction(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload, idempotencyKey }: AddDebtTransactionArgs) =>
      api.debts.addTransaction(id, payload, token!, idempotencyKey),
    onSuccess: (updatedDebt) => {
      // Server returns the fully-recomputed Debt (new balance, full
      // transactions array). Treat it as authoritative.
      queryClient.setQueryData(debtKeys.detail(updatedDebt.id), updatedDebt);
      patchListsUpsert(queryClient, updatedDebt);
    },
    onSettled: (_data, _err, { id }) => {
      // Belt-and-suspenders: a stale background fetch fires after the
      // optimistic patch to catch any server-side state we missed
      // (audit log timestamps, balance recomputation edge cases).
      queryClient.invalidateQueries({ queryKey: debtKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: debtKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface UpdateDebtArgs {
  id: string;
  payload: { person_name: string; version?: number };
  idempotencyKey?: string;
}

export function useUpdateDebt(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload, idempotencyKey }: UpdateDebtArgs) =>
      api.debts.update(id, payload, token!, idempotencyKey),
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: debtKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: debtKeys.lists() });

      const previousDetail = queryClient.getQueryData<Debt>(debtKeys.detail(id));
      const previousLists = queryClient.getQueriesData<InfiniteData<DebtListPage>>({
        queryKey: debtKeys.lists(),
      });

      // Optimistic rename — only the label changes, balance / direction
      // stay put. Server response is authoritative in onSuccess.
      if (previousDetail) {
        const optimistic: Debt = {
          ...previousDetail,
          person_name: payload.person_name,
        };
        queryClient.setQueryData(debtKeys.detail(id), optimistic);
        patchListsUpsert(queryClient, optimistic);
      }

      return { previousDetail, previousLists };
    },
    onError: (_err, { id }, context) => {
      if (!context) return;
      if (context.previousDetail) {
        queryClient.setQueryData(debtKeys.detail(id), context.previousDetail);
      }
      for (const [key, snapshot] of context.previousLists) {
        queryClient.setQueryData(key, snapshot);
      }
    },
    onSuccess: (server, { id }) => {
      queryClient.setQueryData(debtKeys.detail(id), server);
      patchListsUpsert(queryClient, server);
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: debtKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: debtKeys.lists() });
    },
  });
}

export interface DeleteDebtArgs {
  id: string;
}

export function useDeleteDebt(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteDebtArgs) => api.debts.delete(id, token!),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: debtKeys.lists() });
      const previousLists = queryClient.getQueriesData<InfiniteData<DebtListPage>>({
        queryKey: debtKeys.lists(),
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
      queryClient.removeQueries({ queryKey: debtKeys.detail(id) });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: debtKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
