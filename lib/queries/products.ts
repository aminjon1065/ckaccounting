// ─── Products queries & mutations ───────────────────────────────────────────
//
// React Query hooks for the products domain. Search-aware list, detail
// with cache-seed, and a separate infinite query for the stock-movement
// history endpoint (cursor-based, distinct from the page-based main list).
//
// Photo uploads ride on the same mutation hooks — `photoUri` is passed
// through to the API client which builds a multipart FormData when set.

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import {
  api,
  type CreateProductPayload,
  type Paginated,
  type Product,
  type ProductMovement,
  type ProductMovementsResponse,
} from "@/lib/api";
import { deleteLocalProduct } from "@/lib/db";

const PAGE_SIZE = 30;

// ─── Filters ────────────────────────────────────────────────────────────────

export interface ProductFilters {
  search?: string;
  shopId?: number;
}

function normaliseFilters(f: ProductFilters | undefined) {
  return {
    search: f?.search?.trim() ?? "",
    shopId: f?.shopId ?? null,
  };
}

// ─── Keys ───────────────────────────────────────────────────────────────────

export const productKeys = {
  all: ["products"] as const,
  lists: () => [...productKeys.all, "list"] as const,
  list: (filters?: ProductFilters) =>
    [...productKeys.lists(), normaliseFilters(filters)] as const,
  details: () => [...productKeys.all, "detail"] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
  movements: (id: string) => [...productKeys.all, "movements", id] as const,
};

// ─── List ───────────────────────────────────────────────────────────────────

export interface ProductListPage {
  data: Product[];
  page: number;
  lastPage: number;
}

async function fetchProductsPage(
  token: string,
  page: number,
  filters: ProductFilters | undefined,
): Promise<ProductListPage> {
  const f = normaliseFilters(filters);
  const response = await api.products.list(token, {
    limit: PAGE_SIZE,
    page,
    search: f.search || undefined,
    shop_id: f.shopId ?? undefined,
  });
  const meta = (response as Paginated<Product>).meta;
  // Soft-deleted rows are stripped for the same reason every other domain
  // does it — see purchases.ts for the full note.
  const rows = (response.data ?? []).filter((p) => !p.deleted_at);
  return {
    data: rows,
    page: meta?.current_page ?? page,
    lastPage: meta?.last_page ?? page,
  };
}

export function useProductList(token: string | null, filters?: ProductFilters) {
  return useInfiniteQuery({
    queryKey: productKeys.list(filters),
    enabled: !!token,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchProductsPage(token!, pageParam, filters),
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.lastPage ? lastPage.page + 1 : undefined,
    placeholderData: (prev) => prev,
  });
}

// ─── Detail ─────────────────────────────────────────────────────────────────

export function useProductDetail(id: string | undefined, token: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: id ? productKeys.detail(id) : ["products", "detail", "noop"],
    enabled: !!id && !!token,
    queryFn: () => api.products.get(id!, token!),
    initialData: () => {
      if (!id) return undefined;
      const lists = queryClient.getQueriesData<InfiniteData<ProductListPage>>({
        queryKey: productKeys.lists(),
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
    initialDataUpdatedAt: 0,
  });
}

// ─── Movements (cursor-based history) ───────────────────────────────────────

export interface ProductMovementsPage {
  current_stock: number;
  movements: ProductMovement[];
  next_cursor: string | null;
}

export function useProductMovements(id: string | undefined, token: string | null) {
  return useInfiniteQuery({
    queryKey: id ? productKeys.movements(id) : ["products", "movements", "noop"],
    enabled: !!id && !!token,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      const response = await api.products.movements(id!, token!, {
        cursor: pageParam,
        limit: 30,
      });
      return response as ProductMovementsPage;
    },
    getNextPageParam: (lastPage: ProductMovementsResponse) => lastPage.next_cursor ?? undefined,
    placeholderData: (prev) => prev,
  });
}

// ─── List-cache helpers ─────────────────────────────────────────────────────

function patchListsRemove(queryClient: QueryClient, id: string): void {
  queryClient.setQueriesData<InfiniteData<ProductListPage>>(
    { queryKey: productKeys.lists() },
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

function patchListsUpsert(queryClient: QueryClient, updated: Product): void {
  queryClient.setQueriesData<InfiniteData<ProductListPage>>(
    { queryKey: productKeys.lists() },
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

export interface CreateProductArgs {
  payload: CreateProductPayload;
  photoUri?: string;
}

export function useCreateProduct(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, photoUri }: CreateProductArgs) =>
      api.products.create(payload, token!, photoUri),
    onSuccess: (created) => {
      queryClient.setQueryData(productKeys.detail(created.id), created);
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      // Dashboard cards (stock_total_qty, low_stock_count) reflect product
      // catalogue size — invalidate so they refresh.
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface UpdateProductArgs {
  id: string;
  payload: Partial<CreateProductPayload>;
  photoUri?: string;
}

export function useUpdateProduct(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload, photoUri }: UpdateProductArgs) =>
      api.products.update(id, payload, token!, photoUri),
    onMutate: async ({ id, payload, photoUri }) => {
      await queryClient.cancelQueries({ queryKey: productKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: productKeys.lists() });

      const previousDetail = queryClient.getQueryData<Product>(productKeys.detail(id));
      const previousLists = queryClient.getQueriesData<InfiniteData<ProductListPage>>({
        queryKey: productKeys.lists(),
      });

      // Optimistic patch for text fields only — photo upload writes a new
      // URL the client can't predict, so we let the server response drive
      // the image swap.
      if (previousDetail && !photoUri) {
        const optimistic: Product = {
          ...previousDetail,
          ...(payload.name !== undefined && { name: payload.name }),
          ...(payload.code !== undefined && { code: payload.code ?? null }),
          ...(payload.unit !== undefined && { unit: payload.unit ?? null }),
          ...(payload.cost_price !== undefined && { cost_price: payload.cost_price }),
          ...(payload.sale_price !== undefined && { sale_price: payload.sale_price }),
          ...(payload.pricing_mode !== undefined && { pricing_mode: payload.pricing_mode }),
          ...(payload.markup_percent !== undefined && { markup_percent: payload.markup_percent ?? null }),
          ...(payload.bulk_price !== undefined && { bulk_price: payload.bulk_price ?? null }),
          ...(payload.bulk_threshold !== undefined && { bulk_threshold: payload.bulk_threshold ?? null }),
          ...(payload.stock_quantity !== undefined && { stock_quantity: payload.stock_quantity }),
          ...(payload.low_stock_alert !== undefined && { low_stock_alert: payload.low_stock_alert ?? null }),
        };
        queryClient.setQueryData(productKeys.detail(id), optimistic);
        patchListsUpsert(queryClient, optimistic);
      }

      return { previousDetail, previousLists };
    },
    onError: (_err, { id }, context) => {
      if (!context) return;
      if (context.previousDetail) {
        queryClient.setQueryData(productKeys.detail(id), context.previousDetail);
      }
      for (const [key, snapshot] of context.previousLists) {
        queryClient.setQueryData(key, snapshot);
      }
    },
    onSuccess: (server, { id }) => {
      queryClient.setQueryData(productKeys.detail(id), server);
      patchListsUpsert(queryClient, server);
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: productKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export interface DeleteProductArgs {
  id: string;
  idempotencyKey?: string;
}

export function useDeleteProduct(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, idempotencyKey }: DeleteProductArgs) =>
      api.products.delete(id, token!, idempotencyKey),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: productKeys.lists() });
      const previousLists = queryClient.getQueriesData<InfiniteData<ProductListPage>>({
        queryKey: productKeys.lists(),
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
      queryClient.removeQueries({ queryKey: productKeys.detail(id) });
      queryClient.removeQueries({ queryKey: productKeys.movements(id) });
      // Purge the local SQLite mirror too. The sale ProductPicker reads
      // products from SQLite (getLocalProducts), so without this the deleted
      // product lingers in the picker until an app restart even though the
      // React Query lists already dropped it.
      deleteLocalProduct(id).catch(() => {});
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
