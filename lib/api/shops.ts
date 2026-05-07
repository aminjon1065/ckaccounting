// ─── Shops endpoints ────────────────────────────────────────────────────────
//
// `is_active` ↔ `status: "active"|"suspended"` mapping is handled here so
// every other layer can keep using the boolean directly.

import { request, qs } from "./client";
import type { Paginated } from "./types";

export interface Shop {
  id: number;
  name: string;
  is_active: boolean;
  /** Multi-shop ownership: the user that owns this shop. Null = unassigned. */
  owner_id?: number | null;
  /** Legacy free-form text label (display-only). */
  owner_name?: string | null;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface CreateShopPayload {
  name: string;
  is_active?: boolean;
}

export function normalizeShop(shop: any): Shop {
  return {
    ...shop,
    is_active: shop.is_active !== undefined ? shop.is_active : shop.status === 'active',
  };
}

export function normalizeShopsPage(page: Paginated<any>): Paginated<Shop> {
  return {
    ...page,
    data: page.data.map(normalizeShop),
  };
}

export const shopsApi = {
  list: (token: string, params: { page?: number; limit?: number; updated_since?: string; updated_before?: string } = {}) =>
    request<Paginated<any>>(
      `/shops${qs({
        page: params.page,
        limit: params.limit ?? 100,
        updated_since: params.updated_since,
        updated_before: params.updated_before,
      })}`,
      { token }
    ).then(normalizeShopsPage),

  get: (id: number, token: string) =>
    request<any>(`/shops/${id}`, { token }).then(normalizeShop),

  create: (payload: CreateShopPayload, token: string) => {
    const { is_active, ...rest } = payload;
    const apiPayload = is_active !== undefined ? { ...rest, status: is_active ? "active" : "suspended" } : rest;
    return request<any>("/shops", {
      method: "POST",
      body: JSON.stringify(apiPayload),
      token,
    }).then(normalizeShop);
  },

  update: (id: number, payload: Partial<CreateShopPayload>, token: string) => {
    const apiPayload: any = { ...payload };
    if (apiPayload.is_active !== undefined) {
      apiPayload.status = apiPayload.is_active ? "active" : "suspended";
      delete apiPayload.is_active;
    }
    return request<any>(`/shops/${id}`, {
      method: "PATCH",
      body: JSON.stringify(apiPayload),
      token,
    }).then(normalizeShop);
  },

  delete: (id: number, token: string) =>
    request<void>(`/shops/${id}`, { method: "DELETE", token }),
};
