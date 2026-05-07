import { localScope, shopIdInClause } from "../scope";
import type { User } from "@/lib/api";

const baseUser: User = {
  id: 42,
  name: "Test User",
  email: "test@example.com",
  role: "owner",
  shop_id: undefined,
  owned_shop_ids: [7],
};

describe("localScope", () => {
  test("seller scope: single-shop array + own userId", () => {
    expect(localScope({ ...baseUser, role: "seller", shop_id: 7, owned_shop_ids: [] })).toEqual({
      shopIds: [7],
      userId: 42,
    });
  });

  test("seller without shop_id collapses to empty (no rows) instead of leaking", () => {
    expect(localScope({ ...baseUser, role: "seller", shop_id: undefined, owned_shop_ids: [] })).toEqual({
      shopIds: [],
      userId: 42,
    });
  });

  test("owner with one owned shop: shopIds = [that shop], no userId", () => {
    expect(localScope({ ...baseUser, role: "owner", owned_shop_ids: [7] })).toEqual({
      shopIds: [7],
      userId: null,
    });
  });

  test("owner with multiple owned shops: shopIds = full owned set", () => {
    expect(localScope({ ...baseUser, role: "owner", owned_shop_ids: [3, 5, 7] })).toEqual({
      shopIds: [3, 5, 7],
      userId: null,
    });
  });

  test("owner without any shops: empty shopIds (no rows) — admin hasn't assigned yet", () => {
    expect(localScope({ ...baseUser, role: "owner", owned_shop_ids: [] })).toEqual({
      shopIds: [],
      userId: null,
    });
  });

  test("owner override picks one of their shops", () => {
    expect(
      localScope({ ...baseUser, role: "owner", owned_shop_ids: [3, 5, 7] }, 5)
    ).toEqual({ shopIds: [5], userId: null });
  });

  test("owner override outside owned set is ignored (falls back to full owned scope)", () => {
    // Defense in depth: UI shouldn't produce a non-owned override, but if
    // it does, the scope helper falls back to the safe owned-set default
    // rather than honoring the foreign shop.
    expect(
      localScope({ ...baseUser, role: "owner", owned_shop_ids: [3, 5] }, 999)
    ).toEqual({ shopIds: [3, 5], userId: null });
  });

  test("super_admin defaults to null shopIds (no filter, sees all shops)", () => {
    expect(localScope({ ...baseUser, role: "super_admin", shop_id: undefined, owned_shop_ids: [] })).toEqual({
      shopIds: null,
      userId: null,
    });
  });

  test("super_admin override picks a specific shop", () => {
    expect(
      localScope({ ...baseUser, role: "super_admin", shop_id: undefined, owned_shop_ids: [] }, 99)
    ).toEqual({ shopIds: [99], userId: null });
  });

  test("seller override is ignored — sellers cannot escape their assigned shop", () => {
    expect(
      localScope({ ...baseUser, role: "seller", shop_id: 7, owned_shop_ids: [] }, 999)
    ).toEqual({ shopIds: [7], userId: 42 });
  });

  test("null / undefined user yields fully-empty scope", () => {
    // Queries hitting this path return nothing; callers should typically
    // guard before reaching here, but the empty scope is the safe default.
    expect(localScope(null)).toEqual({ shopIds: null, userId: null });
    expect(localScope(undefined)).toEqual({ shopIds: null, userId: null });
  });
});

describe("shopIdInClause", () => {
  test("null shopIds = no filter (super_admin all-shops view)", () => {
    expect(shopIdInClause(null)).toEqual({ sql: "", params: [] });
  });

  test("empty array = AND 0 = 1 (zero rows, never accidentally everything)", () => {
    // This is the safety guard — owner without any shops, or seller
    // without `shop_id`, must NOT collapse to "no filter".
    expect(shopIdInClause([])).toEqual({ sql: " AND 0 = 1", params: [] });
  });

  test("single shop renders as IN (?) with one binding", () => {
    expect(shopIdInClause([7])).toEqual({ sql: " AND shop_id IN (?)", params: [7] });
  });

  test("multiple shops render with one ? per id", () => {
    expect(shopIdInClause([3, 5, 7])).toEqual({
      sql: " AND shop_id IN (?,?,?)",
      params: [3, 5, 7],
    });
  });

  test("custom column name lets callers prefix table aliases", () => {
    expect(shopIdInClause([1, 2], "p.shop_id")).toEqual({
      sql: " AND p.shop_id IN (?,?)",
      params: [1, 2],
    });
  });
});
