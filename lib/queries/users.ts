// ─── Users queries & mutations ──────────────────────────────────────────────
//
// Same shape as shops — small flat list, single `useQuery`, no infinite
// scroll. The API client returns the array directly (already unwrapped
// from the Laravel envelope by `request`).

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import {
  api,
  type AppUser,
  type CreateUserPayload,
} from "@/lib/api";

// ─── Keys ───────────────────────────────────────────────────────────────────

export const userKeys = {
  all: ["users"] as const,
  list: () => [...userKeys.all, "list"] as const,
  details: () => [...userKeys.all, "detail"] as const,
  detail: (id: number) => [...userKeys.details(), id] as const,
};

// ─── List ───────────────────────────────────────────────────────────────────

async function fetchUsers(token: string): Promise<AppUser[]> {
  const res: any = await api.users.list(token, { limit: 100 });
  return Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
}

export function useUserList(token: string | null) {
  return useQuery({
    queryKey: userKeys.list(),
    enabled: !!token,
    queryFn: () => fetchUsers(token!),
    staleTime: 60_000,
  });
}

// ─── List-cache helpers ─────────────────────────────────────────────────────

function patchListRemove(queryClient: QueryClient, id: number): void {
  queryClient.setQueryData<AppUser[]>(userKeys.list(), (old) =>
    old ? old.filter((u) => u.id !== id) : old,
  );
}

function patchListUpsert(queryClient: QueryClient, updated: AppUser): void {
  queryClient.setQueryData<AppUser[]>(userKeys.list(), (old) => {
    if (!old) return old;
    const idx = old.findIndex((u) => u.id === updated.id);
    if (idx === -1) return [updated, ...old];
    const next = [...old];
    next[idx] = updated;
    return next;
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export interface CreateUserArgs {
  payload: CreateUserPayload;
}

export function useCreateUser(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload }: CreateUserArgs) => api.users.create(payload, token!),
    onSuccess: (created) => {
      patchListUpsert(queryClient, created);
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
}

export interface UpdateUserArgs {
  id: number;
  payload: Partial<CreateUserPayload>;
}

export function useUpdateUser(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: UpdateUserArgs) =>
      api.users.update(id, payload, token!),
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey: userKeys.list() });
      const previousList = queryClient.getQueryData<AppUser[]>(userKeys.list());

      if (previousList) {
        const target = previousList.find((u) => u.id === id);
        if (target) {
          const optimistic: AppUser = {
            ...target,
            ...(payload.name !== undefined && { name: payload.name }),
            ...(payload.role !== undefined && { role: payload.role as AppUser["role"] }),
            ...(payload.shop_id !== undefined && {
              shop_id: payload.shop_id as number,
            }),
          };
          patchListUpsert(queryClient, optimistic);
        }
      }

      return { previousList };
    },
    onError: (_err, _args, context) => {
      if (!context?.previousList) return;
      queryClient.setQueryData(userKeys.list(), context.previousList);
    },
    onSuccess: (server) => {
      patchListUpsert(queryClient, server);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
}

export interface DeleteUserArgs {
  id: number;
}

export function useDeleteUser(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteUserArgs) => api.users.delete(id, token!),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: userKeys.list() });
      const previousList = queryClient.getQueryData<AppUser[]>(userKeys.list());
      patchListRemove(queryClient, id);
      return { previousList };
    },
    onError: (_err, _args, context) => {
      if (!context?.previousList) return;
      queryClient.setQueryData(userKeys.list(), context.previousList);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.list() });
    },
  });
}

export interface ResetPinArgs {
  id: number;
}

export function useResetPin(token: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: ResetPinArgs) => api.users.resetPin(id, token!),
    onSuccess: (server) => {
      patchListUpsert(queryClient, server);
    },
  });
}
