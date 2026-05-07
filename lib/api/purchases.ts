// ─── Purchases endpoints ────────────────────────────────────────────────────

import { request, qs } from "./client";
import type { Paginated } from "./types";

export interface PurchaseItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface Purchase {
  id: string;
  supplier_name: string | null;
  total: number;
  items: PurchaseItem[];
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface CreatePurchasePayload {
  id?: string;
  supplier_name?: string;
  shop_id?: number;
  items: { product_id: string; quantity: number; price: number; markup_percent?: number }[];
}

export const purchasesApi = {
  list: (
    token: string,
    params: { page?: number; limit?: number; updated_since?: string; updated_before?: string; cursor?: string } = {}
  ) =>
    request<Paginated<Purchase>>(
      `/purchases${qs({ page: params.page, limit: params.limit ?? 20, updated_since: params.updated_since, updated_before: params.updated_before, cursor: params.cursor })}`,
      { token }
    ),

  get: (id: string, token: string) =>
    request<Purchase>(`/purchases/${id}`, { token }),

  create: (payload: CreatePurchasePayload, token: string, idempotencyKey?: string) =>
    request<Purchase>("/purchases", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      token,
    }),
};
