// ─── Sales endpoints ────────────────────────────────────────────────────────
//
// Pilot for runtime schema validation (phase 5.3): every response is run
// through `parseOrLog`, which on shape mismatch reports to observability
// and falls back to the raw value. Other endpoints will follow this pattern
// incrementally — keep the validation hop here as the canonical example.

import { request, qs } from "./client";
import type { Paginated } from "./types";
import { paginatedSchema, saleSchema } from "@/lib/api/schemas";
import { parseOrLog } from "@/lib/validation/parser";

export type SaleType = "product" | "service";

export interface SaleItem {
  id: string;
  product_id: string | null;
  name?: string | null;
  product_name: string | null;
  /** Populated for service-type sales */
  service_name?: string | null;
  unit?: string | null;
  quantity: number;
  price: number;
  total: number;
  /**
   * How much of this item has already been refunded across all returns for
   * the parent sale. Defaults to 0. Mobile clamps the return modal at
   * `quantity - returned_quantity` so a sale can't be refunded twice.
   */
  returned_quantity?: number;
}

export interface Sale {
  id: string;
  type?: SaleType;
  /** Backend returns this on every sale; local mirror needs it so scoped
   *  reads (owner / seller) don't filter out rows with shop_id=NULL. */
  shop_id?: number | null;
  /** Display name of the shop this sale belongs to. Printed/shared receipts
   *  prefer this over `user.shop_name` so super_admin / multi-shop owners
   *  see the actual branch the sale came from. Server eager-loads
   *  `shop:id,name` on `show`/`update`; list endpoints may omit it (null). */
  shop_name?: string | null;
  user_id?: number | null;
  /** Display name of the seller who rang up the receipt. Populated by the
   *  server when `user` is eager-loaded; null for sales whose seller has
   *  been deleted. */
  seller_name?: string | null;
  customer_name: string | null;
  total: number;
  discount: number;
  paid: number;
  debt: number;
  payment_type: "cash" | "card" | "transfer";
  notes?: string | null;
  items: SaleItem[];
  /** Sum of money refunded for this sale across all returns. 0 by default. */
  returned_total?: number;
  /** True when every line has been fully returned. */
  is_fully_returned?: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version?: number;
}

// Item shapes for the two sale types.
export interface ProductSaleItemPayload {
  product_id: string;
  quantity: number;
  price?: number;
}

export interface ServiceSaleItemPayload {
  name: string;
  unit?: string;
  quantity: number;
  price: number;
}

export interface CreateSalePayload {
  id?: string;
  type?: SaleType;
  customer_name?: string;
  discount?: number;
  paid?: number;
  notes?: string;
  shop_id?: number;
  payment_type: "cash" | "card" | "transfer";
  items: (ProductSaleItemPayload | ServiceSaleItemPayload)[];
}

/**
 * Partial-update payload. Every field is optional — sending `items` is
 * what triggers a full stock rollback + re-apply on the server (mirrors
 * SaleService::updateSale). Metadata-only patches (e.g. just `paid`)
 * leave items + stock untouched.
 */
export interface UpdateSalePayload {
  customer_name?: string | null;
  payment_type?: "cash" | "card" | "transfer";
  notes?: string | null;
  paid?: number;
  discount?: number;
  items?: (ProductSaleItemPayload | ServiceSaleItemPayload)[];
}

export const salesApi = {
  list: async (
    token: string,
    params: {
      page?: number;
      limit?: number;
      after_id?: number;
      updated_since?: string;
      updated_before?: string;
      cursor?: string;
      /** Substring match on customer name, notes, and seller name. */
      search?: string;
      /** Filter by payment method. */
      payment_type?: "cash" | "card" | "transfer";
      /** Filter by sale type. */
      type?: "product" | "service";
      /** When true, only sales with outstanding debt are returned. */
      debt_only?: boolean;
      /** Narrow to a specific shop (must be in the user's accessible
       *  set — server silently ignores otherwise). */
      shop_id?: number;
    } = {}
  ): Promise<Paginated<Sale>> => {
    const raw = await request<Paginated<Sale>>(
      `/sales${qs({
        page: params.page,
        limit: params.limit ?? 20,
        after_id: params.after_id,
        updated_since: params.updated_since,
        updated_before: params.updated_before,
        cursor: params.cursor,
        search: params.search,
        payment_type: params.payment_type,
        type: params.type,
        debt_only: params.debt_only ? 1 : undefined,
        shop_id: params.shop_id,
      })}`,
      { token }
    );
    return parseOrLog(paginatedSchema(saleSchema), raw, { tag: "sales-list" }) as Paginated<Sale>;
  },

  get: async (id: string, token: string): Promise<Sale> => {
    const raw = await request<Sale>(`/sales/${id}`, { token });
    return parseOrLog(saleSchema, raw, { tag: "sales-get", extra: { saleId: id } }) as Sale;
  },

  create: async (payload: CreateSalePayload, token: string, idempotencyKey?: string): Promise<Sale> => {
    const raw = await request<Sale>("/sales", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      token,
    });
    return parseOrLog(saleSchema, raw, { tag: "sales-create" }) as Sale;
  },

  return: (
    id: string,
    token: string,
    payload?: { items?: Array<{ product_id: string; quantity: number }>; reason?: string; refund_method?: string }
  ) =>
    request<Sale>(`/sales/${id}/return`, {
      method: "POST",
      body: payload ? JSON.stringify(payload) : undefined,
      token,
    }),

  /**
   * Partial update. Pass only the fields you want to change.
   *
   * Sending `items` triggers the server's full rollback path: existing
   * items get their stock returned, lines are deleted, the new items
   * are inserted with fresh stock decrements. Without `items`, the
   * existing line items + stock are left alone.
   */
  update: async (
    id: string,
    payload: UpdateSalePayload,
    token: string,
    idempotencyKey?: string
  ): Promise<Sale> => {
    const raw = await request<Sale>(`/sales/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      token,
    });
    return parseOrLog(saleSchema, raw, { tag: "sales-update", extra: { saleId: id } }) as Sale;
  },

  delete: (id: string, token: string, idempotencyKey?: string) =>
    request<void>(`/sales/${id}`, {
      method: "DELETE",
      token,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),
};
