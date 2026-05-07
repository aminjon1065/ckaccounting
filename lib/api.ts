// ─── API facade ─────────────────────────────────────────────────────────────
//
// Re-export-only barrel: every consumer in the app imports from `@/lib/api`,
// and we forward each name to the per-domain endpoint module it lives in.
// Adding a new endpoint? Put it in the matching file under `lib/api/` (or
// create a new one) and add a single line below — never grow this file.
//
// Domain modules: auth, products, sales, debts, expenses, purchases, shops,
// users, reports, dashboard, settings, profile. Shared core: client, types.

export { ApiError, getLastServerTime } from "./api/client";
export type { Paginated, PaginatedMeta } from "./api/types";

// Auth
export { authApi } from "./api/auth";
export type { User, LoginPayload, LoginResponse } from "./api/auth";

// Products
export { productsApi, resolveBackendAssetUrl } from "./api/products";
export type {
  Product,
  CreateProductPayload,
  ProductMovement,
  ProductMovementType,
  ProductMovementsResponse,
} from "./api/products";

// Sales
export { salesApi } from "./api/sales";
export type {
  Sale,
  SaleItem,
  SaleType,
  CreateSalePayload,
  ProductSaleItemPayload,
  ServiceSaleItemPayload,
} from "./api/sales";

// Debts
export { debtsApi } from "./api/debts";
export type {
  Debt,
  DebtTransaction,
  CreateDebtPayload,
  CreateDebtTransactionPayload,
} from "./api/debts";

// Expenses
export { expensesApi } from "./api/expenses";
export type { Expense, CreateExpensePayload } from "./api/expenses";

// Purchases
export { purchasesApi } from "./api/purchases";
export type { Purchase, PurchaseItem, CreatePurchasePayload } from "./api/purchases";

// Shops
export { shopsApi, normalizeShop, normalizeShopsPage } from "./api/shops";
export type { Shop, CreateShopPayload } from "./api/shops";

// Users
export { usersApi } from "./api/users";
export type { AppUser, CreateUserPayload } from "./api/users";

// Reports
export { reportsApi } from "./api/reports";
export type { SalesReport, ExpensesReport, ProfitReport, StockReport } from "./api/reports";

// Dashboard
export { dashboardApi } from "./api/dashboard";
export type {
  DashboardPeriod,
  DashboardSummary,
  LowStockItem,
  RecentSaleItem,
  RecentExpenseItem,
  RecentDebtTransactionItem,
  UnpaidDebtItem,
} from "./api/dashboard";

// Settings
export { settingsApi } from "./api/settings";
export type { ShopSettings } from "./api/settings";

// Profile
export { profileApi } from "./api/profile";

// ─── Composite namespace ────────────────────────────────────────────────────
//
// `api.products.list(...)` is the canonical call site across the codebase;
// keep this object intact so we don't churn every caller. New endpoints
// should land in their domain module and be added here, not the other way.

import { authApi } from "./api/auth";
import { productsApi } from "./api/products";
import { salesApi } from "./api/sales";
import { debtsApi } from "./api/debts";
import { expensesApi } from "./api/expenses";
import { purchasesApi } from "./api/purchases";
import { shopsApi } from "./api/shops";
import { usersApi } from "./api/users";
import { reportsApi } from "./api/reports";
import { dashboardApi } from "./api/dashboard";
import { settingsApi } from "./api/settings";
import { profileApi } from "./api/profile";

export const api = {
  auth: authApi,
  dashboard: dashboardApi,
  products: productsApi,
  expenses: expensesApi,
  debts: debtsApi,
  purchases: purchasesApi,
  sales: salesApi,
  settings: settingsApi,
  reports: reportsApi,
  users: usersApi,
  shops: shopsApi,
  profile: profileApi,
};

