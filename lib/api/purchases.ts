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
  /** Server-authoritative copy of `total_amount` — kept distinct from `total`
   *  for parity with PurchaseResource which exposes both. */
  total_amount?: number;
  items: PurchaseItem[];
  /** Optimistic-lock token. Bumped on every server-side write; the client
   *  echoes the last-known value on update/delete so concurrent edits get
   *  rejected with a 409. */
  version?: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface PurchaseItemPayload {
  product_id: string;
  quantity: number;
  price: number;
  markup_percent?: number;
}

export interface CreatePurchasePayload {
  id?: string;
  supplier_name?: string;
  shop_id?: number;
  items: PurchaseItemPayload[];
}

export interface UpdatePurchasePayload {
  /** Echo of `version` from the last-loaded Purchase — enables 409 conflict
   *  detection. Omit to opt out (legacy clients). */
  version?: number;
  supplier_name?: string | null;
  /** When omitted the existing items are left alone (stock untouched).
   *  When present, the server rolls back the old items' stock impact and
   *  applies the new lines atomically. */
  items?: PurchaseItemPayload[];
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

  /**
   * Edit a purchase. Mirrors the SaleService update contract: partial
   * patches are honoured, and sending `items` triggers a full stock
   * rollback + re-apply on the server. Owner-only.
   */
  update: (
    id: string,
    payload: UpdatePurchasePayload,
    token: string,
    idempotencyKey?: string
  ) =>
    request<Purchase>(`/purchases/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      token,
    }),

  /**
   * Soft-delete and roll back stock. Owner-only.
   */
  delete: (id: string, token: string, idempotencyKey?: string) =>
    request<void>(`/purchases/${id}`, {
      method: "DELETE",
      token,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),
};
