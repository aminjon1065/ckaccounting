// ─── API response schemas ─────────────────────────────────────────────────────
//
// Pilot scope: Sale + SaleItem + Paginated wrapper. These are the
// hottest read paths (SyncProvider polls sales every minute) and the
// place where a server-shape drift would silently spread NaN totals
// across dashboards. Other endpoints will follow the same pattern.
//
// Conventions:
//   • `passthrough()` on object schemas — the server is allowed to add
//     fields without breaking the client. We refuse only when a known
//     field has the wrong type.
//   • Money fields are typed as `number` (rubles in the API contract).
//     The client converts to kopecks at the SQLite write boundary; the
//     wire format stays human-friendly.
//   • Optional fields use `.optional()` (allows `undefined`) and
//     `.nullable()` (allows `null`). Many Laravel responses send `null`
//     explicitly, so we keep both options open where applicable.

import { z } from "zod";

const dateString = z.string();

export const saleItemSchema = z
  .object({
    id: z.string(),
    product_id: z.string().nullable(),
    name: z.string().nullable().optional(),
    product_name: z.string().nullable(),
    service_name: z.string().nullable().optional(),
    unit: z.string().nullable().optional(),
    quantity: z.number(),
    price: z.number(),
    total: z.number(),
  })
  .passthrough();

export const saleSchema = z
  .object({
    id: z.string(),
    type: z.enum(["product", "service"]).optional(),
    user_id: z.number().nullable().optional(),
    customer_name: z.string().nullable(),
    total: z.number(),
    discount: z.number(),
    paid: z.number(),
    debt: z.number(),
    payment_type: z.enum(["cash", "card", "transfer"]),
    notes: z.string().nullable().optional(),
    items: z.array(saleItemSchema),
    created_at: dateString,
    updated_at: dateString,
    deleted_at: dateString.nullable().optional(),
    version: z.number().optional(),
  })
  .passthrough();

// Paginated wrapper — generic in T. Backend uses both length-aware
// (`meta.current_page` etc.) and cursor (`next_cursor`) shapes, so both
// are optional and we keep backward compat with the api.ts type.
export const paginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      data: z.array(item),
      links: z
        .object({
          first: z.string(),
          last: z.string(),
          prev: z.string().nullable(),
          next: z.string().nullable(),
        })
        .partial()
        .optional(),
      meta: z
        .object({
          current_page: z.number(),
          from: z.number().nullable().optional(),
          last_page: z.number(),
          per_page: z.number(),
          to: z.number().nullable().optional(),
          total: z.number(),
        })
        .partial()
        .optional(),
      next_cursor: z.string().nullable().optional(),
      prev_cursor: z.string().nullable().optional(),
    })
    .passthrough();
