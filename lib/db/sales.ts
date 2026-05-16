// ─── Sales repository (online-first) ─────────────────────────────────────────
//
// Read-only cache for the `sales` + `sale_items` tables. The only writer is
// `insertOrUpdateRemoteSales`, called by the sales fetcher to mirror the
// server's view into SQLite for instant cold-launch paint and short offline
// reads.
//
// Money lives exclusively in `*_kopecks` integer columns (migration v29).
// The legacy `items` TEXT column remains as a transitional fallback while
// the server backfills `sale_items`.

import type { Sale, SaleItem } from "@/lib/api";
import { getDb } from "./schema";
import { shopIdInClause, type LocalScope } from "./scope";
import { fromKopecks, toKopecks } from "./money";
import { invalidateAggregatedCaches } from "./cache";

interface SaleRow {
  id: string;
  shop_id: number | null;
  user_id: number | null;
  seller_name: string | null;
  customer_name: string | null;
  type: string | null;
  payment_type: string | null;
  notes: string | null;
  items: string;
  created_at: string;
  updated_at: string;
  total_kopecks: number | null;
  discount_kopecks: number | null;
  paid_kopecks: number | null;
  debt_kopecks: number | null;
}

export interface LocalSale extends Sale {
  shop_id?: number;
  user_id?: number;
  // Backward-compat fields for screens that still type-narrow on these. After
  // migration v31 the underlying columns are gone; we synthesize "synced" /
  // "none" so type-narrowing keeps compiling without runtime meaning.
  status?: "pending" | "synced" | "failed";
  sync_action?: "none" | "create" | "update" | "delete";
  last_synced_at?: string | null;
}

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

async function getSaleItemsForId(saleId: string): Promise<SaleItem[]> {
  if (!saleId) return [];
  const db = getDb();
  const rows = await db.getAllAsync<SaleItemRow>(
    `SELECT ${SALE_ITEM_COLUMNS} FROM sale_items WHERE sale_id = ?`,
    [saleId]
  );
  return rows.map(mapSaleItemRow);
}

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

function parseSaleItemsJson(itemsJson: string | null): SaleItem[] {
  if (!itemsJson) return [];
  try {
    return JSON.parse(itemsJson) as SaleItem[];
  } catch {
    return [];
  }
}

async function mapRowToSale(r: SaleRow, items?: SaleItem[]): Promise<Sale> {
  const resolvedItems = items ?? (await getSaleItemsForId(r.id));
  const saleItems = resolvedItems.length > 0 ? resolvedItems : parseSaleItemsJson(r.items);
  return {
    id: r.id,
    type: r.type as Sale["type"],
    seller_name: r.seller_name,
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

async function mapRowToLocalSale(r: SaleRow, items?: SaleItem[]): Promise<LocalSale> {
  const base = await mapRowToSale(r, items);
  return {
    ...base,
    shop_id: r.shop_id ?? undefined,
    user_id: r.user_id ?? undefined,
    status: "synced",
    sync_action: "none",
  };
}

export async function insertOrUpdateRemoteSales(sales: Sale[], shopId?: number): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const sale of sales) {
      if (sale.deleted_at) {
        await db.runAsync("DELETE FROM sales WHERE id = ?", [sale.id]);
        continue;
      }
      // Prefer the row's own shop_id (server returns it on every sale);
      // fall back to the param when the caller knows the scope from context
      // (create-from-form). Without this, the fetcher stored shop_id=NULL
      // and scoped reads for owner/seller returned nothing.
      const resolvedShopId = sale.shop_id ?? shopId ?? null;
      await db.runAsync(
        `INSERT OR REPLACE INTO sales (
          id, shop_id, user_id, seller_name, customer_name, type,
          payment_type, notes, items, created_at, updated_at,
          total_kopecks, discount_kopecks, paid_kopecks, debt_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sale.id,
          resolvedShopId,
          sale.user_id ?? null,
          sale.seller_name ?? null,
          sale.customer_name,
          sale.type ?? null,
          sale.payment_type,
          sale.notes ?? null,
          JSON.stringify(sale.items),
          sale.created_at ?? new Date().toISOString(),
          sale.updated_at ?? new Date().toISOString(),
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
  await invalidateAggregatedCaches();
}

export async function getLocalSales(scope: LocalScope): Promise<LocalSale[]> {
  const db = getDb();
  let query = "SELECT * FROM sales WHERE 1 = 1";
  const params: (string | number)[] = [];
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

  const saleIds = results.map((r) => r.id).filter(Boolean);
  const itemsBySale = await loadSaleItemsBatch(saleIds);

  return Promise.all(
    results.map((r) => mapRowToLocalSale(r, itemsBySale.get(r.id) ?? parseSaleItemsJson(r.items)))
  );
}

export async function getLocalSaleById(id: string): Promise<LocalSale | null> {
  const db = getDb();
  const r = await db.getFirstAsync<SaleRow>("SELECT * FROM sales WHERE id = ?", [id]);
  if (!r) return null;
  return await mapRowToLocalSale(r);
}

/**
 * Per-item rows used by the sales export. Joins sale_items with the parent
 * sale and the product (for cost_price). Service items have product_id=null
 * — they appear with cost_price=0.
 */
export interface SaleExportRow {
  sale_id: string;
  created_at: string;
  seller_name: string | null;
  product_name: string | null;
  quantity: number;
  unit_price: number;
  cost_price: number;
  line_total: number;
}

export async function getSalesExportRows(
  scope: LocalScope,
  range: { dateFrom?: string; dateTo?: string }
): Promise<SaleExportRow[]> {
  const db = getDb();
  let query = `
    SELECT s.id AS sale_id, s.created_at AS created_at, s.seller_name AS seller_name,
           si.product_name AS product_name, si.quantity AS quantity,
           si.unit_price_kopecks AS unit_price_kopecks,
           p.cost_price_kopecks AS cost_price_kopecks,
           si.total_kopecks AS line_total_kopecks
    FROM sale_items si
    INNER JOIN sales s ON s.id = si.sale_id
    LEFT JOIN products p ON p.id = si.product_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];
  const shopFilter = shopIdInClause(scope.shopIds, "s.shop_id");
  query += shopFilter.sql;
  params.push(...shopFilter.params);
  if (scope.userId !== null) {
    query += " AND s.user_id = ?";
    params.push(scope.userId);
  }
  if (range.dateFrom) {
    query += " AND s.created_at >= ?";
    params.push(`${range.dateFrom}T00:00:00`);
  }
  if (range.dateTo) {
    query += " AND s.created_at <= ?";
    params.push(`${range.dateTo}T23:59:59.999`);
  }
  query += " ORDER BY s.created_at DESC, si.id ASC";

  const rows = await db.getAllAsync<{
    sale_id: string;
    created_at: string;
    seller_name: string | null;
    product_name: string | null;
    quantity: number;
    unit_price_kopecks: number | null;
    cost_price_kopecks: number | null;
    line_total_kopecks: number | null;
  }>(query, params);

  return rows.map((r) => ({
    sale_id: r.sale_id,
    created_at: r.created_at,
    seller_name: r.seller_name,
    product_name: r.product_name,
    quantity: r.quantity,
    unit_price: fromKopecks(r.unit_price_kopecks),
    cost_price: fromKopecks(r.cost_price_kopecks),
    line_total: fromKopecks(r.line_total_kopecks),
  }));
}

/**
 * Drop a sale and its line items from the local cache. Used when the server
 * reports the sale no longer exists (404 on a write) so subsequent reads
 * don't resurrect a ghost row.
 */
export async function deleteLocalSale(id: string | number): Promise<void> {
  if (id === null || id === undefined || id === "") return;
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM sale_items WHERE sale_id = ?", [id]);
    await db.runAsync("DELETE FROM sales WHERE id = ?", [id]);
  });
  invalidateAggregatedCaches();
}
