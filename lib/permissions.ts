import type { User } from "@/lib/api";

export type Role = User["role"]; // "super_admin" | "owner" | "seller"

export type Action =
  | "products:view"
  | "products:create"
  | "products:edit"
  | "products:delete"
  | "sales:view"
  | "sales:create"
  | "sales:edit"
  | "sales:delete"
  | "sales:return"
  | "expenses:view"
  | "expenses:create"
  | "expenses:edit"
  | "expenses:delete"
  | "purchases:view"
  | "purchases:create"
  | "purchases:edit"
  | "purchases:delete"
  | "debts:view"
  | "debts:create"
  | "debts:edit"
  | "debts:addTransaction"
  | "debts:delete"
  | "reports:view"
  | "settings:viewShop"
  | "settings:editShop"
  | "users:view"
  | "users:create"
  | "users:edit"
  | "users:delete";

const PERMISSIONS: Record<Action, Role[]> = {
  "products:view":        ["super_admin", "owner", "seller"],
  "products:create":      ["super_admin", "owner"],
  "products:edit":        ["super_admin", "owner"],
  "products:delete":      ["super_admin", "owner"],
  "sales:view":           ["super_admin", "owner", "seller"],
  "sales:create":         ["super_admin", "owner", "seller"],
  // Sellers can ring up sales but can't edit / delete afterwards — anti-
  // fraud / audit boundary, mirrors SalePolicy on the server.
  "sales:edit":           ["super_admin", "owner"],
  "sales:delete":         ["super_admin", "owner"],
  "sales:return":         ["super_admin", "owner"],
  // Sellers fully manage their own expenses — view / create / edit /
  // delete. Cross-seller mutation is gated server-side by ExpensePolicy
  // (own-row check on user_id). The UI doesn't have a "which seller
  // created this" indicator, so this coarse role check is enough —
  // the server is the source of truth for per-row authorization.
  "expenses:view":        ["super_admin", "owner", "seller"],
  "expenses:create":      ["super_admin", "owner", "seller"],
  "expenses:edit":        ["super_admin", "owner", "seller"],
  "expenses:delete":      ["super_admin", "owner", "seller"],
  "purchases:view":       ["super_admin", "owner"],
  "purchases:create":     ["super_admin", "owner"],
  "purchases:edit":       ["super_admin", "owner"],
  "purchases:delete":     ["super_admin", "owner"],
  "debts:view":           ["super_admin", "owner", "seller"],
  "debts:create":         ["super_admin", "owner", "seller"],
  "debts:edit":           ["super_admin", "owner", "seller"],
  "debts:addTransaction": ["super_admin", "owner", "seller"],
  "debts:delete":         ["super_admin", "owner"],
  // Sellers can pull reports — server-side scope narrows each query
  // to rows they own (own sales / sale items / sale returns / expenses).
  // Stock report stays shop-wide for sellers since per-seller stock has
  // no meaningful definition.
  "reports:view":         ["super_admin", "owner", "seller"],
  "settings:viewShop":    ["super_admin", "owner"],
  "settings:editShop":    ["super_admin", "owner"],
  "users:view":           ["super_admin", "owner"],
  // Mobile-only restriction: owners can't create employees from the app.
  // Backend ApiPermissionMatrix still allows it — admin-side flows
  // (web / Sanctum direct) remain unchanged. Hiding the mobile CTA
  // pushes employee onboarding through the admin console where shop
  // assignment + role choice is reviewed centrally.
  "users:create":         ["super_admin"],
  "users:edit":           ["super_admin", "owner"],
  "users:delete":         ["super_admin", "owner"],
};

export function can(role: Role | undefined | null, action: Action): boolean {
  if (!role) return false;
  return PERMISSIONS[action].includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Администратор",
  owner: "Владелец",
  seller: "Продавец",
};

// ─── Multi-shop helpers ─────────────────────────────────────────────────────
//
// Centralizes the "which shop is the user acting in" decision so individual
// forms / screens don't reimplement the role + owned_shop_ids logic.
//
//   • super_admin   — must always pick a shop in forms (no implicit one).
//   • owner, 0 shops — sees an empty-state, can't create anything.
//   • owner, 1 shop  — implicit shop, no picker.
//   • owner, N shops — must pick from owned set.
//   • seller         — implicit shop (their `shop_id`), no picker.

type ShopUser = Pick<User, "role" | "shop_id" | "owned_shop_ids"> | null | undefined;

/**
 * Implicit shop the user operates in WITHOUT showing a picker, or `null`
 * when a picker is required (super_admin / multi-shop owner) or no shop
 * is available (owner-with-no-shops).
 */
export function effectiveShopId(user: ShopUser): number | null {
  if (!user) return null;
  if (user.role === "seller") return user.shop_id ?? null;
  if (user.role === "owner") {
    const ids = user.owned_shop_ids ?? [];
    return ids.length === 1 ? ids[0] : null;
  }
  return null; // super_admin
}

/**
 * True when the form must render a shop picker. Sellers and single-shop
 * owners get an implicit shop; super_admin and multi-shop owners must
 * choose explicitly.
 */
export function needsShopPicker(user: ShopUser): boolean {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  if (user.role === "owner") return (user.owned_shop_ids ?? []).length > 1;
  return false;
}

/**
 * True only for owners who haven't been assigned any shops yet. Top-level
 * screens use this to render a "waiting for admin assignment" empty
 * state instead of letting the user into broken create flows.
 */
export function hasNoAccessibleShops(user: ShopUser): boolean {
  if (!user) return false;
  if (user.role !== "owner") return false;
  return (user.owned_shop_ids ?? []).length === 0;
}

/**
 * The list a shop-picker should render. For owners returns their owned
 * set; super_admin gets `null` (callers fetch the full shop list from
 * the API).
 */
export function pickerShopIds(user: ShopUser): number[] | null {
  if (!user) return [];
  if (user.role === "super_admin") return null;
  if (user.role === "owner") return user.owned_shop_ids ?? [];
  return user.shop_id != null ? [user.shop_id] : [];
}
