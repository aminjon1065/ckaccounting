// ─── Purchases queries & mutations ──────────────────────────────────────────
//
// React Query hooks for the purchases domain. Replaces `hooks/usePurchases.ts`
// and the manual loading/error/retry plumbing each consumer used to wire.
//
// What this layer gives you that the old hand-rolled hook did not:
//   • Mutations invalidate the list automatically — create / update /
//     delete trigger `queryKey: ['purchases','list']` refetch, so the
//     index screen never shows a stale row after a write.
//   • Optimistic updates on delete and update — the UI updates the moment
//     the mutation runs; if the server fails we roll back from the
//     `onError` context snapshot.
//   • Single-flight: two screens asking for the same purchase ID dedupe
//     to one network request.
//   • Refetch on reconnect / app foreground built in via QueryProvider.
//   • Cache-and-revalidate: opening the detail screen for an item we
//     just had in the list shows it instantly, refetches in background.
//
// Key shape: `['purchases', 'list', filters?]` for paged lists,
// `['purchases', 'detail', id]` for single rows. Use the factory below
// instead of inlining strings so renames stay refactor-safe.

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import {
  api,
  type CreatePurchasePayload,
  type Paginated,
  type Purchase,
  type UpdatePurchasePayload,
} from "@/lib/api";

const PAGE_SIZE = 30;

// ─── Keys ────────────────────────────────────────────────────────────────────

export const purchaseKeys = {
  all: ["purchases"] as const,
  lists: () => [...purchaseKeys.all, "list"] as const,
  list: (filters?: Record<string, unknown>) =>
    [...purchaseKeys.lists(), filters ?? {}] as const,
  details: () => [...purchaseKeys.all, "detail"] as const,
  detail: (id: string) => [...purchaseKeys.details(), id] as const,
};

// ─── List (paginated) ────────────────────────────────────────────────────────
//
// Page-based pagination — Laravel's `meta.current_page` / `meta.last_page`
// are reliable on every endpoint, unlike the `next_cursor` field which
// only some endpoints expose. We trade slightly weaker insertion stability
// for a contract that actually works today.

export interface PurchaseListPage {
  data: Purchase[];
  page: number;
  lastPage: number;
}

async function fetchPurchasesPage(token: string, page: number): Promise<PurchaseListPage> {
  const response = await api.purchases.list(token, { limit: PAGE_SIZE, page });
  const meta = (response as Paginated<Purchase>).meta;
  // Server intentionally returns soft-deleted rows (`deleted_at != null`)
  // so legacy clients with local SQLite mirrors can prune their copies —
  // see PurchaseRepository::paginateForUser. We render lists in-memory
  // only, so tombstones are pure noise; filter them out here. Without
  // this, deleting a purchase makes it bubble to the top of the next
  // refetch (`updated_at = now()`) and reappear in the FlatList.
  const rows = (response.data ?? []).filter((p) => !p.deleted_at);
  return {
    data: rows,
    page: meta?.current_page ?? page,
    lastPage: meta?.last_page ?? page,
  };
}

export function usePurchaseList(token: string | null) {
  return useInfiniteQuery({
    queryKey: purchaseKeys.list(),
    enabled: !!token,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchPurchasesPage(token!, pageParam),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.lastPage ? lastPage.page + 1 : undefined,
    // Keep the previous page set visible while a refetch is in flight —
    // prevents the "list flashes to empty for half a second" jitter when
    // the user pulls-to-refresh on a slow network.
    placeholderData: (prev) => prev,
  });
}

// ─── Detail ──────────────────────────────────────────────────────────────────

export function usePurchaseDetail(id: string | undefined, token: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: id ? purchaseKeys.detail(id) : ["purchases", "detail", "noop"],
    enabled: !!id && !!token,
    queryFn: () => api.purchases.get(id!, token!),
    // Seed from any list cache entry that already holds this purchase —
    // navigation from list → detail is instant; the background refetch
    // then fills in the items (list rows include items already, but
    // future endpoints may shrink the list payload). Returning undefined
    // when not in cache means React Query falls through to queryFn.
    initialData: () => {
      if (!id) return undefined;
      const lists = queryClient.getQueriesData<InfiniteData<PurchaseListPage>>({
        queryKey: purchaseKeys.lists(),
      });
      for (const [, infiniteData] of lists) {
        if (!infiniteData) continue;
        for (const page of infiniteData.pages) {
          const hit = page.data.find((p) => p.id === id);
          if (hit) return hit;
        }
      }
      return undefined;
    },
    // When seeded from the list cache, treat the snapshot as stale right
    // away so the detail refetches in the background — the list row
    // doesn't carry the full version + nested product data the detail
    // page wants.
    initialDataUpdatedAt: 0,
  });
}

// ─── Helpers shared by mutations ─────────────────────────────────────────────

function patchListsRemove(queryClient: QueryClient, id: string): void {
  queryClient.setQueriesData<InfiniteData<PurchaseListPage>>(
    { queryKey: purchaseKeys.lists() },
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

function patchListsUpsert(queryClient: QueryClient, updated: Purchase): void {
  queryClient.setQueriesData<InfiniteData<PurchaseListPage>>(
    { queryKey: purchaseKeys.lists() },
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
        // New row from `create` — prepend onto the first page so the user
        // sees it instantly without scrolling.
        nextPages[0] = {
          ...nextPages[0],
          data: [updated, ...nextPages[0].data],
        };
      }
      return { ...old, pages: nextPages };
    },
  );
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export interface CreatePurchaseArgs {
  payload: CreatePurchasePayload;
  idempotencyKey: string;
}

export function useCreatePurchase(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: CreatePurchaseArgs) =>
      api.purchases.create(payload, token!, idempotencyKey),
    onSuccess: (created) => {
      // Two things to do: seed the detail cache (no extra round-trip if
      // the user immediately taps in) and refetch the list (an authoritative
      // refetch beats trying to prepend manually — the server may have
      // applied default ordering / shop-scope adjustments).
      queryClient.setQueryData(purchaseKeys.detail(created.id), created);
      queryClient.invalidateQueries({ queryKey: purchaseKeys.lists() });
      // Catalog and dashboard depend on stock movements from this purchase,
      // so nudge their caches too. Safe no-op when those keys don't exist.
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface UpdatePurchaseArgs {
  id: string;
  payload: UpdatePurchasePayload;
  idempotencyKey: string;
}

export function useUpdatePurchase(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload, idempotencyKey }: UpdatePurchaseArgs) =>
      api.purchases.update(id, payload, token!, idempotencyKey),
    // Optimistic patch: update the detail cache and any list pages
    // immediately so the UI is responsive. If the server rejects we
    // roll back from the snapshot in `onError`.
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: purchaseKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: purchaseKeys.lists() });

      const previousDetail = queryClient.getQueryData<Purchase>(purchaseKeys.detail(id));
      const previousLists = queryClient.getQueriesData<InfiniteData<PurchaseListPage>>({
        queryKey: purchaseKeys.lists(),
      });

      if (previousDetail) {
        const optimistic: Purchase = {
          ...previousDetail,
          supplier_name:
            payload.supplier_name !== undefined
              ? payload.supplier_name
              : previousDetail.supplier_name,
        };
        queryClient.setQueryData(purchaseKeys.detail(id), optimistic);
        patchListsUpsert(queryClient, optimistic);
      }

      return { previousDetail, previousLists };
    },
    onError: (_err, { id }, context) => {
      if (!context) return;
      if (context.previousDetail) {
        queryClient.setQueryData(purchaseKeys.detail(id), context.previousDetail);
      }
      for (const [key, snapshot] of context.previousLists) {
        queryClient.setQueryData(key, snapshot);
      }
    },
    onSuccess: (server, { id }) => {
      // Server response is authoritative — overwrite optimistic state.
      queryClient.setQueryData(purchaseKeys.detail(id), server);
      patchListsUpsert(queryClient, server);
    },
    onSettled: (_data, _err, { id }) => {
      // Belt and suspenders: invalidate so the next render fetches fresh
      // data if anything went sideways with the optimistic patch.
      queryClient.invalidateQueries({ queryKey: purchaseKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: purchaseKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface DeletePurchaseArgs {
  id: string;
  idempotencyKey: string;
}

export function useDeletePurchase(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, idempotencyKey }: DeletePurchaseArgs) =>
      api.purchases.delete(id, token!, idempotencyKey),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: purchaseKeys.lists() });

      const previousLists = queryClient.getQueriesData<InfiniteData<PurchaseListPage>>({
        queryKey: purchaseKeys.lists(),
      });

      // Pull the row out of every cached list page immediately. The
      // detail cache stays — the user is on that screen as we mutate,
      // tearing it down would flash an empty state before nav-back.
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
      // Drop the detail cache for the deleted row so any background
      // refetch doesn't resurrect it. Also tear down dependent caches.
      queryClient.removeQueries({ queryKey: purchaseKeys.detail(id) });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: purchaseKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
