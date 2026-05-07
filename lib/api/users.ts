// ─── Users endpoints ────────────────────────────────────────────────────────

import { request, qs } from "./client";
import type { Paginated } from "./types";

export interface AppUser {
  id: number;
  name: string;
  email: string;
  role: "owner" | "seller";
  shop_id: number;
  created_at: string;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password?: string;
  role: "owner" | "seller" | "super_admin";
  shop_id?: number | null;
}

export const usersApi = {
  list: (token: string, params: { page?: number; limit?: number } = {}) =>
    request<Paginated<AppUser>>(
      `/users${qs({ page: params.page, limit: params.limit ?? 20 })}`,
      { token }
    ).then((res) => res.data),

  create: (payload: CreateUserPayload, token: string) =>
    request<AppUser>("/users", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
    }),

  update: (id: number, payload: Partial<CreateUserPayload>, token: string) =>
    request<AppUser>(`/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      token,
    }),

  delete: (id: number, token: string) =>
    request<void>(`/users/${id}`, { method: "DELETE", token }),

  /**
   * Super-admin only: queue a PIN reset for the target user.
   * The server invalidates the user's tokens; on next login the mobile
   * client clears its cached PIN and forces a fresh setup.
   */
  resetPin: (id: number, token: string) =>
    request<AppUser>(`/users/${id}/reset-pin`, { method: "POST", token }),
};
