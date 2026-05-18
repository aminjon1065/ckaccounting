// ─── DB facade ───────────────────────────────────────────────────────────────
//
// Re-export-only barrel for the residual SQLite layer. After the React
// Query migration most domain reads moved to the network cache; what
// remains here is:
//   • Schema lifecycle (initDb, clearLocalData)
//   • Multi-tenant scope helper (localScope) — used by reports + sale form
//   • Money utilities (toKopecks / fromKopecks et al.)
//   • Dashboard / reports offline cache (queries/dashboard reads this on
//     network failure)
//   • Notification dedupe table (low-stock alerts)
//   • A handful of write-through helpers used by create-sale / create-expense
//     to persist the freshly-saved row locally for the report aggregator.
//
// Anything not exported here is dead code — don't add re-exports without
// a real caller.

export { getDb, initDb, clearLocalData } from "./schema";
export { localScope } from "./scope";
export type { LocalScope } from "./scope";

// Money helpers — kopecks/rubles conversion rules used by every repo.
export { toKopecks, fromKopecks, signedDebtAmount, localDebtTransactionType } from "./money";

// Products — only the create-sale modal still touches this layer, for
// ghost eviction + instant picker render. The list / detail screens are
// on React Query.
export {
  insertOrUpdateProducts,
  getLocalProducts,
  deleteLocalProduct,
} from "./products";
export type { LocalProduct } from "./products";

// Sales — used by reports (export rows) and the create-sale form (writes
// the new sale to the local mirror so reports include it before the next
// sync cycle).
export {
  insertOrUpdateRemoteSales,
  getSalesExportRows,
} from "./sales";
export type { SaleExportRow } from "./sales";

// Expenses — used by the create-expense form for the same reason as sales.
export { insertOrUpdateExpenses } from "./expenses";

// Shops — multi-shop pickers (create-debt, edit-product, settings) read
// this for the dropdown contents.
export { getLocalShops } from "./shops";
export type { LocalShop } from "./shops";

// Dashboard / reports offline cache. Read by queries/dashboard inside its
// queryFn as the offline fallback; written on every successful pull.
export {
  setDashboardCache,
  getDashboardCache,
} from "./cache";

// Notification dedupe + low-stock alerts.
export {
  insertNotification,
  getUnreadNotifications,
  markNotificationsRead,
  hasLowStockAlertBeenSent,
  markLowStockAlertSent,
} from "./notifications";
export type { LocalNotification } from "./notifications";
