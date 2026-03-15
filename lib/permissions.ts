import type { User } from "@/lib/api";

export type Role = User["role"]; // "super_admin" | "owner" | "seller"

export type Action =
  | "products:view"
  | "products:create"
  | "products:edit"
  | "products:delete"
  | "sales:view"
  | "sales:create"
  | "expenses:view"
  | "expenses:create"
  | "expenses:edit"
  | "expenses:delete"
  | "purchases:view"
  | "purchases:create"
  | "debts:view"
  | "debts:create"
  | "debts:addTransaction"
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
  "expenses:view":        ["super_admin", "owner"],
  "expenses:create":      ["super_admin", "owner"],
  "expenses:edit":        ["super_admin", "owner"],
  "expenses:delete":      ["super_admin", "owner"],
  "purchases:view":       ["super_admin", "owner"],
  "purchases:create":     ["super_admin", "owner"],
  "debts:view":           ["super_admin", "owner", "seller"],
  "debts:create":         ["super_admin", "owner", "seller"],
  "debts:addTransaction": ["super_admin", "owner", "seller"],
  "reports:view":         ["super_admin", "owner"],
  "settings:viewShop":    ["super_admin", "owner"],
  "settings:editShop":    ["super_admin", "owner"],
  "users:view":           ["super_admin", "owner"],
  "users:create":         ["super_admin", "owner"],
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
