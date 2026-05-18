// ─── Shops queries & mutations ──────────────────────────────────────────────
//
// Shops are a small flat list (typically <100 rows even in big tenants),
// so a single `useQuery` is enough — no infinite scroll, no filter
// matrix. The screen does client-side tab filtering on top of the cache.

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import {
  api,
  type CreateShopPayload,
  type Paginated,
  type Shop,
} from "@/lib/api";

// ─── Keys ───────────────────────────────────────────────────────────────────

export const shopKeys = {
  all: ["shops"] as const,
  list: () => [...shopKeys.all, "list"] as const,
  details: () => [...shopKeys.all, "detail"] as const,
  detail: (id: number) => [...shopKeys.details(), id] as const,
};

// ─── List ───────────────────────────────────────────────────────────────────

async function fetchShops(token: string): Promise<Shop[]> {
  const response = (await api.shops.list(token, { limit: 200 })) as Paginated<Shop>;
  const rows = (response.data ?? []).filter((s) => !s.deleted_at);
  return rows;
}

export function useShopList(token: string | null) {
  return useQuery({
    queryKey: shopKeys.list(),
    enabled: !!token,
    queryFn: () => fetchShops(token!),
    // Shops change rarely — give the cache a longer staleTime so the screen
    // hits the server only on intentional refresh / after mutations.
    staleTime: 60_000,
  });
}

// ─── Detail ─────────────────────────────────────────────────────────────────

export function useShopDetail(id: number | undefined, token: string | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: id !== undefined ? shopKeys.detail(id) : ["shops", "detail", "noop"],
    enabled: id !== undefined && !!token,
    queryFn: () => api.shops.get(id!, token!),
    initialData: () => {
      if (id === undefined) return undefined;
      const list = queryClient.getQueryData<Shop[]>(shopKeys.list());
      return list?.find((s) => s.id === id);
    },
    initialDataUpdatedAt: 0,
  });
}

// ─── List-cache helpers ─────────────────────────────────────────────────────

function patchListRemove(queryClient: QueryClient, id: number): void {
  queryClient.setQueryData<Shop[]>(shopKeys.list(), (old) =>
    old ? old.filter((s) => s.id !== id) : old,
  );
}

function patchListUpsert(queryClient: QueryClient, updated: Shop): void {
  queryClient.setQueryData<Shop[]>(shopKeys.list(), (old) => {
    if (!old) return old;
    const idx = old.findIndex((s) => s.id === updated.id);
    if (idx === -1) return [updated, ...old];
    const next = [...old];
    next[idx] = updated;
    return next;
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export interface CreateShopArgs {
  payload: CreateShopPayload & { owner_id?: number };
}

export function useCreateShop(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload }: CreateShopArgs) => api.shops.create(payload, token!),
    onSuccess: (created) => {
      queryClient.setQueryData(shopKeys.detail(created.id), created);
      patchListUpsert(queryClient, created);
      // Other screens cache shop lists (sales/products pickers, dashboard
      // picker). Invalidate so they pick up the new row.
      queryClient.invalidateQueries({ queryKey: shopKeys.list() });
    },
  });
}

export interface UpdateShopArgs {
  id: number;
  payload: Partial<CreateShopPayload> & { owner_id?: number | null };
}

export function useUpdateShop(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: UpdateShopArgs) =>
      api.shops.update(id, payload, token!),
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: shopKeys.detail(id) });
      await queryClient.cancelQueries({ queryKey: shopKeys.list() });

      const previousDetail = queryClient.getQueryData<Shop>(shopKeys.detail(id));
      const previousList = queryClient.getQueryData<Shop[]>(shopKeys.list());

      if (previousDetail) {
        const optimistic: Shop = {
          ...previousDetail,
          ...(payload.name !== undefined && { name: payload.name }),
          ...(payload.is_active !== undefined && { is_active: payload.is_active }),
        };
        queryClient.setQueryData(shopKeys.detail(id), optimistic);
        patchListUpsert(queryClient, optimistic);
      }

      return { previousDetail, previousList };
    },
    onError: (_err, { id }, context) => {
      if (!context) return;
      if (context.previousDetail) {
        queryClient.setQueryData(shopKeys.detail(id), context.previousDetail);
      }
      if (context.previousList) {
        queryClient.setQueryData(shopKeys.list(), context.previousList);
      }
    },
    onSuccess: (server, { id }) => {
      queryClient.setQueryData(shopKeys.detail(id), server);
      patchListUpsert(queryClient, server);
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: shopKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: shopKeys.list() });
    },
  });
}

export interface DeleteShopArgs {
  id: number;
}

export function useDeleteShop(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteShopArgs) => api.shops.delete(id, token!),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: shopKeys.list() });
      const previousList = queryClient.getQueryData<Shop[]>(shopKeys.list());
      patchListRemove(queryClient, id);
      return { previousList };
    },
    onError: (_err, _args, context) => {
      if (!context?.previousList) return;
      queryClient.setQueryData(shopKeys.list(), context.previousList);
    },
    onSuccess: (_data, { id }) => {
      queryClient.removeQueries({ queryKey: shopKeys.detail(id) });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: shopKeys.list() });
    },
  });
}
