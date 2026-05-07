// ─── Sales repository ────────────────────────────────────────────────────────
//
// CRUD over `sales` and `sale_items`. Sales are the busiest write path in
// the app — every PoS receipt creates one — so the read paths (`getLocalSales`,
// `getPendingSyncSales`) batch-load `sale_items` via a single IN(...) query
// instead of looping per-sale; the per-sale `getSaleItemsForId` is reserved
// for the rare single-row reader (`getLocalSaleById`).
//
// Money lives exclusively in `*_kopecks` integer columns since migration
// v29; the legacy `unit_price` / `total` REAL columns were dropped at the
// same time. The `items` TEXT column remains as a transitional fallback
// for rows hydrated from servers that haven't backfilled `sale_items` yet.
//
// `insertOrUpdateSale` is the local-create path: it queues the POST,
// writes the sale row + sale_items, and invalidates dashboard caches.
// `insertOrUpdateRemoteSales` is the server-pull path: it skips rows
// with a non-`none` sync_action so a remote pull can't clobber unsynced
// local edits, and persists the server's optimistic-locking `version`.

import type { Sale, SaleItem } from "@/lib/api";
import { getDb } from "./schema";
import { shopIdInClause, type LocalScope } from "./scope";
import { fromKopecks, toKopecks } from "./money";
import { invalidateAggregatedCaches } from "./cache";
import { queueSyncAction } from "./outbox";

interface SaleRow {
  id: string;
  shop_id: number | null;
  user_id: number | null;
  customer_name: string | null;
  type: string | null;
  total: number | null;
  discount: number | null;
  paid: number | null;
  debt: number | null;
  payment_type: string | null;
  notes: string | null;
  items: string;
  status: string;
  sync_action: string;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  total_kopecks: number | null;
  discount_kopecks: number | null;
  paid_kopecks: number | null;
  debt_kopecks: number | null;
}

export interface LocalSale extends Sale {
  shop_id?: number;
  user_id?: number;
  status: "pending" | "synced" | "failed";
  sync_action: "none" | "create" | "update" | "delete";
  last_synced_at?: string | null;
}

/**
 * Money is stored exclusively in *_kopecks columns (see migration v29);
 * the old REAL `unit_price` / `total` columns were dropped at the same time.
 */
interface SaleItemRow {
  sale_id?: string;
  id: string;
  product_id: string | null;
  product_name: string | null;
  unit: string | null;
  quantity: number;
  unit_price_kopecks: number | null;
  total_kopecks: number | null;
}

const SALE_ITEM_COLUMNS = "id, product_id, product_name, unit, quantity, unit_price_kopecks, total_kopecks";

function mapSaleItemRow(row: SaleItemRow): SaleItem {
  return {
    id: row.id,
    product_id: row.product_id,
    product_name: row.product_name,
    unit: row.unit ?? undefined,
    quantity: row.quantity,
    price: fromKopecks(row.unit_price_kopecks),
    total: fromKopecks(row.total_kopecks),
  };
}

/**
 * Per-sale lookup. Reserved for `getLocalSaleById` — calling this in a
 * loop is the N+1 antipattern; multi-sale readers must use
 * `loadSaleItemsBatch` instead.
 */
async function getSaleItemsForId(saleId: string): Promise<SaleItem[]> {
  if (!saleId) return [];
  const db = getDb();
  const rows = await db.getAllAsync<SaleItemRow>(
    `SELECT ${SALE_ITEM_COLUMNS} FROM sale_items WHERE sale_id = ?`,
    [saleId]
  );
  return rows.map(mapSaleItemRow);
}

/**
 * Batch-load sale_items for many sales in a single SQL round-trip. Returns
 * a map keyed by sale_id so callers can hydrate each sale row in O(1).
 */
async function loadSaleItemsBatch(saleIds: readonly string[]): Promise<Map<string, SaleItem[]>> {
  const result = new Map<string, SaleItem[]>();
  if (saleIds.length === 0) return result;
  const db = getDb();
  const placeholders = saleIds.map(() => "?").join(", ");
  const rows = await db.getAllAsync<SaleItemRow & { sale_id: string }>(
    `SELECT sale_id, ${SALE_ITEM_COLUMNS} FROM sale_items WHERE sale_id IN (${placeholders})`,
    saleIds as string[]
  );
  for (const row of rows) {
    const list = result.get(row.sale_id) ?? [];
    list.push(mapSaleItemRow(row));
    result.set(row.sale_id, list);
  }
  return result;
}

async function mapRowToSale(r: SaleRow, items?: SaleItem[]): Promise<Sale> {
  const resolvedItems = items ?? (await getSaleItemsForId(r.id));
  const saleItems = resolvedItems.length > 0 ? resolvedItems : parseSaleItemsJson(r.items);
  return {
    id: r.id,
    type: r.type as Sale["type"],
    customer_name: r.customer_name,
    total: fromKopecks(r.total_kopecks),
    discount: fromKopecks(r.discount_kopecks),
    paid: fromKopecks(r.paid_kopecks),
    debt: fromKopecks(r.debt_kopecks),
    payment_type: (r.payment_type as Sale["payment_type"]) ?? "cash",
    notes: r.notes ?? undefined,
    items: saleItems,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function parseSaleItemsJson(itemsJson: string | null): SaleItem[] {
  if (!itemsJson) return [];
  try {
    return JSON.parse(itemsJson) as SaleItem[];
  } catch {
    return [];
  }
}

async function mapRowToLocalSale(r: SaleRow, items?: SaleItem[]): Promise<LocalSale> {
  const base = await mapRowToSale(r, items);
  return {
    ...base,
    shop_id: r.shop_id ?? undefined,
    user_id: r.user_id ?? undefined,
    status: r.status as LocalSale["status"],
    sync_action: r.sync_action as LocalSale["sync_action"],
    last_synced_at: r.last_synced_at ?? undefined,
  };
}

// sale.id must be a UUID generated client-side before calling this.
export async function insertOrUpdateSale(sale: Sale, shopId?: number, userId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO sales (
        id, shop_id, user_id, customer_name, type,
        payment_type, notes, items, status, sync_action, created_at, updated_at, last_synced_at,
        total_kopecks, discount_kopecks, paid_kopecks, debt_kopecks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sale.id,
        shopId ?? null,
        userId ?? null,
        sale.customer_name,
        sale.type ?? null,
        sale.payment_type,
        sale.notes ?? null,
        JSON.stringify(sale.items),
        "pending",
        "create",
        sale.created_at ?? new Date().toISOString(),
        sale.updated_at ?? new Date().toISOString(),
        null,
        toKopecks(sale.total), toKopecks(sale.discount), toKopecks(sale.paid), toKopecks(sale.debt),
      ]
    );

    await db.runAsync("DELETE FROM sale_items WHERE sale_id = ?", [sale.id]);
    const now = new Date().toISOString();
    for (const item of sale.items ?? []) {
      await db.runAsync(
        `INSERT INTO sale_items (sale_id, product_id, product_name, unit, quantity, created_at, unit_price_kopecks, total_kopecks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sale.id,
          item.product_id ?? null,
          item.product_name ?? item.name ?? "",
          item.unit ?? null,
          item.quantity,
          now,
          toKopecks(item.price),
          toKopecks(item.total),
        ]
      );
    }

    await queueSyncAction(
      "POST",
      "/sales",
      {
        id: sale.id,
        type: sale.type,
        customer_name: sale.customer_name,
        total: sale.total,
        discount: sale.discount,
        paid: sale.paid,
        debt: sale.debt,
        payment_type: sale.payment_type,
        notes: sale.notes,
        items: sale.items,
        shop_id: shopId,
      },
      { "Idempotency-Key": `sale-${sale.id}` },
      `sale-${sale.id}`
    );

    await invalidateAggregatedCaches();
  });
}

export async function insertOrUpdateRemoteSales(sales: Sale[], shopId?: number): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const sale of sales) {
      if (sale.deleted_at) {
        await db.runAsync("DELETE FROM sales WHERE id = ?", [sale.id]);
        continue;
      }
      const existing = await db.getFirstAsync<{ sync_action: string }>(
        "SELECT sync_action FROM sales WHERE id = ?",
        [sale.id]
      );
      if (existing && existing.sync_action !== "none") {
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO sales (
          id, shop_id, user_id, customer_name, type,
          payment_type, notes, items, status, sync_action, version, created_at, updated_at, last_synced_at,
          total_kopecks, discount_kopecks, paid_kopecks, debt_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sale.id,
          shopId ?? null,
          sale.user_id ?? null,
          sale.customer_name,
          sale.type ?? null,
          sale.payment_type,
          sale.notes ?? null,
          JSON.stringify(sale.items),
          "synced",
          "none",
          // Persist server-supplied optimistic-locking version. Falls back to
          // 1 for legacy responses that don't expose it (transitional).
          sale.version ?? 1,
          sale.created_at ?? new Date().toISOString(),
          sale.updated_at ?? new Date().toISOString(),
          new Date().toISOString(),
          toKopecks(sale.total), toKopecks(sale.discount), toKopecks(sale.paid), toKopecks(sale.debt),
        ]
      );

      await db.runAsync("DELETE FROM sale_items WHERE sale_id = ?", [sale.id]);
      const now = new Date().toISOString();
      for (const item of sale.items ?? []) {
        await db.runAsync(
          `INSERT INTO sale_items (sale_id, product_id, product_name, unit, quantity, created_at, unit_price_kopecks, total_kopecks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sale.id,
            item.product_id ?? null,
            item.product_name ?? item.name ?? "",
            item.unit ?? null,
            item.quantity,
            now,
            toKopecks(item.price),
            toKopecks(item.total),
          ]
        );
      }
    }
  });
  // period_sales_total / period_cogs / period_profit / recent_sales widgets
  // all depend on this.
  await invalidateAggregatedCaches();
}

export async function getLocalSales(scope: LocalScope): Promise<LocalSale[]> {
  const db = getDb();
  let query = "SELECT * FROM sales WHERE 1 = 1";
  const params: any[] = [];
  const shopFilter = shopIdInClause(scope.shopIds);
  query += shopFilter.sql;
  params.push(...shopFilter.params);
  if (scope.userId !== null) {
    query += " AND user_id = ?";
    params.push(scope.userId);
  }
  query += " ORDER BY created_at DESC";
  const results = await db.getAllAsync<SaleRow>(query, params);

  if (results.length === 0) return [];

  // One SQL for all sale_items across the result set — turns the previous
  // per-sale lookup into O(1) round-trips instead of O(N).
  const saleIds = results.map((r) => r.id).filter(Boolean);
  const itemsBySale = await loadSaleItemsBatch(saleIds);

  return Promise.all(
    results.map((r) => mapRowToLocalSale(r, itemsBySale.get(r.id) ?? parseSaleItemsJson(r.items)))
  );
}

export async function getLocalSaleById(id: string): Promise<LocalSale | null> {
  const db = getDb();
  const r = await db.getFirstAsync<SaleRow>(
    "SELECT * FROM sales WHERE id = ?",
    [id]
  );
  if (!r) return null;
  return await mapRowToLocalSale(r);
}

export async function updateSaleStatus(
  id: string,
  status: string,
  syncAction?: string
) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE sales SET status = ?, sync_action = ? WHERE id = ?",
      [status, syncAction, id]
    );
  } else {
    await db.runAsync(
      "UPDATE sales SET status = ? WHERE id = ?",
      [status, id]
    );
  }
}

export async function deleteLocalSale(id: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM sales WHERE id = ?", [id]);
}

export async function getPendingSyncSales(): Promise<LocalSale[]> {
  const db = getDb();
  const results = await db.getAllAsync<SaleRow>(
    "SELECT * FROM sales WHERE sync_action != 'none' ORDER BY created_at ASC"
  );
  if (results.length === 0) return [];
  // Batch-load sale_items in one SQL instead of N — see loadSaleItemsBatch.
  const itemsBySale = await loadSaleItemsBatch(results.map((r) => r.id).filter(Boolean));
  return Promise.all(
    results.map((r) => mapRowToLocalSale(r, itemsBySale.get(r.id) ?? parseSaleItemsJson(r.items)))
  );
}
