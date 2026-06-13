// ─── Sales queries & mutations ──────────────────────────────────────────────
//
// React Query hooks for the sales domain. Mirrors purchases.ts but adds:
//   • Filter-aware list keys — search / payment_type / type / debt_only
//     each get their own cache slot. Switching filters reads from cache
//     when available and refetches in background; reverting feels instant.
//   • `useReturnSale` mutation for partial refunds. A return mutates the
//     sale's `returned_total` + items' `returned_quantity` AND restocks
//     products, so it invalidates both detail + list + products keys.
//   • Soft-delete filter in `queryFn` — the server intentionally returns
//     trashed rows so legacy SQLite mirrors can prune; React Query lists
//     are in-memory, so tombstones are pure noise.

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import {
  api,
  type CreateSalePayload,
  type Paginated,
  type Sale,
  type UpdateSalePayload,
} from "@/lib/api";

const PAGE_SIZE = 30;

// ─── Filters ────────────────────────────────────────────────────────────────

export interface SalesFiltersInput {
  search?: string;
  paymentType?: "cash" | "card" | "transfer";
  saleType?: "product" | "service";
  debtOnly?: boolean;
  /** Narrow to a specific shop. null / undefined → all accessible shops. */
  shopId?: number | null;
}

// Normalise inputs into a stable key fragment. Empty strings → undefined,
// booleans default to false. Without this, two equivalent caller objects
// would hash to different keys and split the cache.
function normaliseFilters(f: SalesFiltersInput | undefined): Required<{
  search: string;
  paymentType: string;
  saleType: string;
  debtOnly: boolean;
  shopId: number | null;
}> {
  return {
    search: f?.search?.trim() ?? "",
    paymentType: f?.paymentType ?? "",
    saleType: f?.saleType ?? "",
    debtOnly: !!f?.debtOnly,
    shopId: f?.shopId ?? null,
  };
}

// ─── Keys ───────────────────────────────────────────────────────────────────

export const saleKeys = {
  all: ["sales"] as const,
  lists: () => [...saleKeys.all, "list"] as const,
  list: (filters?: SalesFiltersInput) =>
    [...saleKeys.lists(), normaliseFilters(filters)] as const,
  details: () => [...saleKeys.all, "detail"] as const,
  detail: (id: string) => [...saleKeys.details(), id] as const,
};

// ─── List (paginated) ───────────────────────────────────────────────────────

export interface SaleListPage {
  data: Sale[];
  page: number;
  lastPage: number;
}

async function fetchSalesPage(
  token: string,
  page: number,
  filters: SalesFiltersInput | undefined,
): Promise<SaleListPage> {
  const f = normaliseFilters(filters);
  const response = await api.sales.list(token, {
    limit: PAGE_SIZE,
    page,
    search: f.search || undefined,
    payment_type: (f.paymentType as "cash" | "card" | "transfer" | undefined) || undefined,
    type: (f.saleType as "product" | "service" | undefined) || undefined,
    debt_only: f.debtOnly || undefined,
    shop_id: f.shopId ?? undefined,
  });
  const meta = (response as Paginated<Sale>).meta;
  // See purchases.ts: server returns soft-deleted rows so legacy clients
  // can prune their SQLite mirrors. We render the list in memory, so
  // tombstones bubble to the top on delete (updated_at = now()) and
  // resurrect themselves; filter them out here.
  const rows = (response.data ?? []).filter((s) => !s.deleted_at);
  return {
    data: rows,
    page: meta?.current_page ?? page,
    lastPage: meta?.last_page ?? page,
  };
}

export function useSaleList(token: string | null, filters?: SalesFiltersInput) {
  return useInfiniteQuery({
    queryKey: saleKeys.list(filters),
    enabled: !!token,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchSalesPage(token!, pageParam, filters),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.lastPage ? lastPage.page + 1 : undefined,
    placeholderData: (prev) => prev,
  });
}

// ─── Detail ─────────────────────────────────────────────────────────────────

export function useSaleDetail(id: string | undefined, token: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: id ? saleKeys.detail(id) : ["sales", "detail", "noop"],
    enabled: !!id && !!token,
    queryFn: () => api.sales.get(id!, token!),
    initialData: () => {
      if (!id) return undefined;
      const lists = queryClient.getQueriesData<InfiniteData<SaleListPage>>({
        queryKey: saleKeys.lists(),
      });
      for (const [, infiniteData] of lists) {
        if (!infiniteData) continue;
        for (const page of infiniteData.pages) {
          const hit = page.data.find((s) => s.id === id);
          if (hit) return hit;
        }
      }
      return undefined;
    },
    // Treat list-seeded data as stale so the detail screen still refetches
    // in the background — list rows usually carry items but may omit
    // computed fields (returned_total, version) on some endpoints.
    initialDataUpdatedAt: 0,
  });
}

// ─── List-cache helpers ─────────────────────────────────────────────────────

function patchListsRemove(queryClient: QueryClient, id: string): void {
  queryClient.setQueriesData<InfiniteData<SaleListPage>>(
    { queryKey: saleKeys.lists() },
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

function patchListsUpsert(queryClient: QueryClient, updated: Sale): void {
  queryClient.setQueriesData<InfiniteData<SaleListPage>>(
    { queryKey: saleKeys.lists() },
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

export interface CreateSaleArgs {
  payload: CreateSalePayload;
  idempotencyKey: string;
}

export function useCreateSale(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: CreateSaleArgs) =>
      api.sales.create(payload, token!, idempotencyKey),
    onSuccess: (created) => {
      queryClient.setQueryData(saleKeys.detail(created.id), created);
      // Invalidate every filter slot — the new sale might match any of
      // them. Cheap because only mounted lists actually refetch.
      queryClient.invalidateQueries({ queryKey: saleKeys.lists() });
      // Stock decremented → products / dashboard caches stale.
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // Sale may have created a debt row if customer underpaid.
      queryClient.invalidateQueries({ queryKey: ["debts"] });
    },
  });
}

export interface UpdateSaleArgs {
  id: string;
  payload: UpdateSalePayload;
  idempotencyKey: string;
}

export function useUpdateSale(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload, idempotencyKey }: UpdateSaleArgs) =>
      api.sales.update(id, payload, token!, idempotencyKey),
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: saleKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: saleKeys.lists() });

      const previousDetail = queryClient.getQueryData<Sale>(saleKeys.detail(id));
      const previousLists = queryClient.getQueriesData<InfiniteData<SaleListPage>>({
        queryKey: saleKeys.lists(),
      });

      // Optimistic patch covers metadata changes only. When `items` is
      // present the new total / debt / type derive server-side from a
      // mixed cart and stock validation; it's not safe to fake locally.
      // Skip the optimistic step in that case and let the server response
      // drive the cache update in onSuccess.
      const itemsChanged = payload.items !== undefined;

      if (previousDetail && !itemsChanged) {
        const nextDiscount =
          payload.discount !== undefined ? payload.discount : previousDetail.discount;
        const nextPaid = payload.paid !== undefined ? payload.paid : previousDetail.paid;
        const subtotal = previousDetail.total + previousDetail.discount;
        const nextTotal = Math.max(0, subtotal - nextDiscount);
        // Debt = total − returns − paid (mirrors SaleService::updateSale).
        // Recomputing from total − paid alone would resurrect the returned
        // amount; for a sale with no returns the returns sum is 0.
        const nextDebt = Math.max(0, nextTotal - (previousDetail.returned_total ?? 0) - nextPaid);

        const optimistic: Sale = {
          ...previousDetail,
          ...(payload.customer_name !== undefined && {
            customer_name: payload.customer_name,
          }),
          ...(payload.payment_type !== undefined && {
            payment_type: payload.payment_type,
          }),
          ...(payload.notes !== undefined && { notes: payload.notes }),
          discount: nextDiscount,
          paid: nextPaid,
          total: nextTotal,
          debt: nextDebt,
        };
        queryClient.setQueryData(saleKeys.detail(id), optimistic);
        patchListsUpsert(queryClient, optimistic);
      }

      return { previousDetail, previousLists };
    },
    onError: (_err, { id }, context) => {
      if (!context) return;
      if (context.previousDetail) {
        queryClient.setQueryData(saleKeys.detail(id), context.previousDetail);
      }
      for (const [key, snapshot] of context.previousLists) {
        queryClient.setQueryData(key, snapshot);
      }
    },
    onSuccess: (server, { id }) => {
      queryClient.setQueryData(saleKeys.detail(id), server);
      patchListsUpsert(queryClient, server);
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: saleKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: saleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      // Sale debt change ripples into the debts feed; items change moves
      // stock so the product catalog needs to refetch too.
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["debts"] });
    },
  });
}

export interface DeleteSaleArgs {
  id: string;
  idempotencyKey: string;
}

export function useDeleteSale(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, idempotencyKey }: DeleteSaleArgs) =>
      api.sales.delete(id, token!, idempotencyKey),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: saleKeys.lists() });
      const previousLists = queryClient.getQueriesData<InfiniteData<SaleListPage>>({
        queryKey: saleKeys.lists(),
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
      // Don't tear down the detail cache immediately — the user is on
      // it, removeQueries would flash an empty state pre-navigation.
      // The detail screen evicts itself on 404 via its own error path.
      queryClient.removeQueries({ queryKey: saleKeys.detail(id) });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: saleKeys.lists() });
      // Stock restored, dashboard totals shifted.
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["debts"] });
    },
  });
}

export interface ReturnSaleArgs {
  id: string;
  items: Array<{ product_id: string; quantity: number }>;
  reason?: string;
  refundMethod?: string;
}

export function useReturnSale(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items, reason, refundMethod }: ReturnSaleArgs) =>
      api.sales.return(id, token!, {
        items,
        reason,
        refund_method: refundMethod,
      }),
    onSuccess: (_data, { id }) => {
      // The return endpoint doesn't return the sale itself — it returns
      // the SaleReturn record. So we can't seed the sale detail cache
      // directly; invalidate instead so the next read pulls the updated
      // sale with refreshed `returned_total` / `is_fully_returned`.
      queryClient.invalidateQueries({ queryKey: saleKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: saleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["debts"] });
    },
  });
}
