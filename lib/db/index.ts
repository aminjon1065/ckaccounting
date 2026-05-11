// ─── DB facade ───────────────────────────────────────────────────────────────
//
// This module is a re-export-only barrel: every consumer in the app imports
// from `@/lib/db`, and we forward each name to the per-domain repository
// it lives in. Adding a new query? Put it in the matching repository file
// (or create a new one) and add a single line below — never grow this file.
//
// Repository files: products, debts, sales, expenses, purchases, shops,
// notifications, cache, syncMetadata, money, scope, schema.
//
// Online-first: the outbox (`./outbox`) and offline mutation helpers
// (decrement/cancel stock deltas, *Status setters, *DeletedLocally markers)
// were removed in Phase 2. Writes go directly to the API; SQLite is a
// read-only cache mirrored from remote fetchers in `lib/cache`.

export { getDb, initDb, clearLocalData } from "./schema";
export { localScope } from "./scope";
export type { LocalScope } from "./scope";

// Money helpers — see lib/db/money.ts for kopecks/rubles conversion rules.
export { toKopecks, fromKopecks, signedDebtAmount, localDebtTransactionType } from "./money";

// Products repository — see lib/db/products.ts
export {
  insertOrUpdateProducts,
  getLocalProducts,
  getLocalProductById,
} from "./products";
export type { LocalProduct } from "./products";

// Sync metadata — see lib/db/syncMetadata.ts (cache cursors, not outbox).
export {
  getSyncMetadata,
  setSyncMetadata,
  getProductsLastSyncedAt,
  setProductsLastSyncedAt,
  getDebtsLastSyncedAt,
  setDebtsLastSyncedAt,
  getSalesLastSyncedAt,
  setSalesLastSyncedAt,
  getExpensesLastSyncedAt,
  setExpensesLastSyncedAt,
  getPurchasesLastSyncedAt,
  setPurchasesLastSyncedAt,
  getShopsLastSyncedAt,
  setShopsLastSyncedAt,
  getEntityRowCounts,
} from "./syncMetadata";
export type { EntityRowCounts } from "./syncMetadata";

// Debts repository — see lib/db/debts.ts
export {
  insertOrUpdateDebts,
  insertOrUpdateDebtTransactions,
  getLocalDebts,
  getLocalDebtById,
  getLocalDebtTransactions,
} from "./debts";

// Sales repository — see lib/db/sales.ts
export {
  insertOrUpdateRemoteSales,
  getLocalSales,
  getLocalSaleById,
} from "./sales";
export type { LocalSale } from "./sales";

// Expenses repository — see lib/db/expenses.ts
export {
  insertOrUpdateExpenses,
  getLocalExpenses,
} from "./expenses";
export type { LocalExpense } from "./expenses";

// Purchases repository — see lib/db/purchases.ts
export {
  insertOrUpdatePurchases,
  getLocalPurchases,
} from "./purchases";
export type { LocalPurchase } from "./purchases";

// Shops repository — see lib/db/shops.ts
export {
  insertOrUpdateShops,
  getLocalShops,
  getLocalShopById,
} from "./shops";
export type { LocalShop } from "./shops";

// Cache helpers — see lib/db/cache.ts
export {
  invalidateAggregatedCaches,
  setDashboardCache,
  getDashboardCache,
  setReportsCache,
  getReportsCache,
} from "./cache";

// Notifications & low-stock — see lib/db/notifications.ts
export {
  insertNotification,
  getUnreadNotifications,
  markNotificationsRead,
  checkAndNotifyLowStock,
  hasLowStockAlertBeenSent,
  markLowStockAlertSent,
} from "./notifications";
export type { LocalNotification } from "./notifications";
