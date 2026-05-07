// ─── Repository scoping ────────────────────────────────────────────────────────
//
// Every "list local rows" repository call must declare *which slice* of the
// device-local cache the caller wants to see. Without this, queries default
// to the union of every shop and every seller that ever signed in on this
// device — a multi-tenant data-leak waiting for a shared device.
//
// SHAPES
//   - `shopIds` is `null` only for super-admins who haven't picked a specific
//     shop yet (they intentionally want a global view across every shop).
//   - For owners, `shopIds` holds every shop they own (multi-shop ownership);
//     for sellers, exactly one element matching their `shop_id`.
//   - `userId` is non-null only for sellers — owners and super-admins see
//     every row in their shops, sellers see only their own rows.
//
// `localScope(user, overrideShopId?)` is the single source of truth: every
// repository callsite derives its scope from it, so the filter logic lives
// in exactly one place.
//
// Do NOT shortcut by passing `{ shopIds: undefined }` — that's the legacy
// "show me everything" path the audit flagged. Use `localScope` and let
// it decide based on role.

import type { User } from "@/lib/api";

export interface LocalScope {
  /**
   * Shops the caller is allowed to see. `null` means "no shop filter"
   * — only super-admins use this branch. Otherwise an array of one
   * (seller / single-shop owner) or many (multi-shop owner) IDs.
   */
  shopIds: number[] | null;
  /** Non-null means "limit to this seller's own rows". */
  userId: number | null;
}

/**
 * Derive the canonical scope for the active user.
 *
 * @param user            The authenticated user, or null if not signed in.
 *                        A null user produces a fully-empty scope so queries
 *                        return nothing (callers should typically guard before
 *                        reaching here).
 * @param overrideShopId  Picks a specific shop in the UI. For super-admins
 *                        and owners with multiple shops the dropdown sets
 *                        this; sellers cannot override their assigned shop.
 *                        For owners, the override must be one of their owned
 *                        shops — values outside that set are silently
 *                        ignored (UI should never produce them).
 */
export function localScope(
  user: Pick<User, "role" | "shop_id" | "id" | "owned_shop_ids"> | null | undefined,
  overrideShopId?: number | null
): LocalScope {
  if (!user) {
    return { shopIds: null, userId: null };
  }

  if (user.role === "super_admin") {
    return {
      shopIds: overrideShopId != null ? [overrideShopId] : null,
      userId: null,
    };
  }

  if (user.role === "owner") {
    const ownedIds = user.owned_shop_ids ?? [];
    if (overrideShopId != null && ownedIds.includes(overrideShopId)) {
      return { shopIds: [overrideShopId], userId: null };
    }
    return { shopIds: ownedIds, userId: null };
  }

  if (user.role === "seller") {
    return {
      shopIds: user.shop_id != null ? [user.shop_id] : [],
      userId: user.id,
    };
  }

  // Unknown role — empty scope.
  return { shopIds: [], userId: null };
}

/**
 * Build the `shop_id IN (...)` SQL fragment + bind params for a given scope.
 * Returns `{ sql: "", params: [] }` when the scope has no shop filter
 * (super_admin without an explicit pick) — caller appends nothing.
 *
 * Returns `{ sql: " AND 0 = 1", params: [] }` when the scope is an empty
 * array — owner without any assigned shops, or seller without `shop_id`.
 * That guarantees zero rows instead of accidentally returning everything.
 */
export function shopIdInClause(
  shopIds: number[] | null,
  column: string = "shop_id"
): { sql: string; params: number[] } {
  if (shopIds === null) {
    return { sql: "", params: [] };
  }
  if (shopIds.length === 0) {
    return { sql: " AND 0 = 1", params: [] };
  }
  const placeholders = shopIds.map(() => "?").join(",");
  return { sql: ` AND ${column} IN (${placeholders})`, params: [...shopIds] };
}

