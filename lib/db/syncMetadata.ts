// ─── Sync metadata accessors ─────────────────────────────────────────────────
//
// The `sync_metadata` table is a simple key/value store used to track:
//   • per-entity `*_last_synced_at` timestamps (the high-watermark for
//     incremental delta sync)
//   • the `oldest_synced_at` boundary that lets capped initial syncs
//     grow historically when the user scrolls past the local window
//   • any other small ad-hoc state that doesn't deserve its own table
//
// Per-entity helpers below are typed pass-throughs over the generic
// `getSyncMetadata` / `setSyncMetadata` pair — they exist purely to
// keep callsites self-documenting (`getSalesLastSyncedAt()` reads better
// than `getSyncMetadata("sales_last_synced_at")`).

import { getDb } from "./schema";

/**
 * Generic accessor for arbitrary sync_metadata keys.
 */
export async function getSyncMetadata(key: string): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_metadata WHERE key = ?",
    [key]
  );
  return row?.value ?? null;
}

export async function setSyncMetadata(key: string, value: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)",
    [key, value]
  );
}

export async function getProductsLastSyncedAt(): Promise<string | null> {
  return getSyncMetadata("products_last_synced_at");
}

export async function setProductsLastSyncedAt(timestamp: string): Promise<void> {
  return setSyncMetadata("products_last_synced_at", timestamp);
}

export async function getDebtsLastSyncedAt(): Promise<string | null> {
  return getSyncMetadata("debts_last_synced_at");
}

export async function setDebtsLastSyncedAt(timestamp: string): Promise<void> {
  return setSyncMetadata("debts_last_synced_at", timestamp);
}

export async function getSalesLastSyncedAt(): Promise<string | null> {
  return getSyncMetadata("sales_last_synced_at");
}

export async function setSalesLastSyncedAt(timestamp: string): Promise<void> {
  return setSyncMetadata("sales_last_synced_at", timestamp);
}

export async function getExpensesLastSyncedAt(): Promise<string | null> {
  return getSyncMetadata("expenses_last_synced_at");
}

export async function setExpensesLastSyncedAt(timestamp: string): Promise<void> {
  return setSyncMetadata("expenses_last_synced_at", timestamp);
}

export async function getPurchasesLastSyncedAt(): Promise<string | null> {
  return getSyncMetadata("purchases_last_synced_at");
}

export async function setPurchasesLastSyncedAt(timestamp: string): Promise<void> {
  return setSyncMetadata("purchases_last_synced_at", timestamp);
}

export async function getShopsLastSyncedAt(): Promise<string | null> {
  return getSyncMetadata("shops_last_synced_at");
}

export async function setShopsLastSyncedAt(timestamp: string): Promise<void> {
  return setSyncMetadata("shops_last_synced_at", timestamp);
}

// ─── Diagnostics ────────────────────────────────────────────────────────────

export interface EntityRowCounts {
  products: number;
  shops: number;
  debts: number;
  sales: number;
  expenses: number;
  purchases: number;
}

/**
 * Cheap row-count snapshot per offline-relevant entity. Used by the
 * "Load all history" UI to show the user exactly what landed locally —
 * without this, a fetcher that silently early-exits (missing shop_id,
 * empty server data, swallowed error) leaves the user staring at an
 * empty list with no way to tell what went wrong.
 */
export async function getEntityRowCounts(): Promise<EntityRowCounts> {
  const db = getDb();
  const tables = ["products", "shops", "debts", "sales", "expenses", "purchases"] as const;
  const result: Record<string, number> = {};
  for (const t of tables) {
    const row = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) AS c FROM ${t} WHERE (sync_action IS NULL OR sync_action != 'delete')`
    );
    result[t] = row?.c ?? 0;
  }
  return result as unknown as EntityRowCounts;
}
