// ─── Auth endpoints ─────────────────────────────────────────────────────────

import { AUTH_ENDPOINTS } from "@/constants/config";
import { request } from "./client";

export interface User {
  id: number;
  name: string;
  email: string;
  role: "super_admin" | "owner" | "seller";
  /**
   * Single-shop relation. Set for sellers (their primary shop). Owners
   * use `owned_shop_ids` instead — server returns `shop_id: null` for
   * them; we type-narrow to `undefined` here so the rest of the codebase
   * keeps using `user?.shop_id` without a null branch.
   */
  shop_id?: number;
  shop_name?: string;
  /**
   * Shops this user owns (multi-shop ownership). Always present in the
   * server response — empty array `[]` for non-owners. Owners scope every
   * read/write through this list rather than the single `shop_id` above.
   */
  owned_shop_ids?: number[];
  /** When true, the server demands a PIN re-setup on this device. */
  pin_reset_required?: boolean;
}

export interface LoginPayload {
  email: string;
  password: string;
  device_name: string;
}

export interface LoginResponse {
  token: string;
  token_type: string;
  user: User;
}

export const authApi = {
  login: (payload: LoginPayload) =>
    request<LoginResponse>(AUTH_ENDPOINTS.login, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  me: (token: string) => request<User>(AUTH_ENDPOINTS.me, { token }),

  logout: (token: string) =>
    request<void>(AUTH_ENDPOINTS.logout, { method: "POST", token }),

  refresh: (token: string) =>
    request<{ token: string }>(AUTH_ENDPOINTS.refresh, {
      method: "POST",
      token,
    }),
};
