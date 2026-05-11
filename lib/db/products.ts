// ─── Products repository (online-first) ──────────────────────────────────────
//
// Read-only cache surface. Writes go directly to the API; the only writer
// here is `insertOrUpdateProducts`, called by `lib/cache/fetchers/ProductFetcher`
// to mirror the server's view of the catalog into SQLite.
//
// The pre-Phase-2 surface (single-product offline create/update, stock-delta
// bookkeeping, soft-delete markers, conflict detection) is gone. SQLite is
// no longer authoritative for any product mutation.

import { getDb } from "./schema";
import { fromKopecks, toKopecks } from "./money";
import { shopIdInClause, type LocalScope } from "./scope";
import { invalidateAggregatedCaches } from "./cache";
import { Product, resolveBackendAssetUrl } from "@/lib/api";

export interface LocalProduct extends Product {
  // Legacy fields kept on the type for backward-compat in screens that still
  // import `LocalProduct`. After migration v31 these are no longer read from
  // SQLite — defaulted to "synced" / "none" in `mapProductRow`.
  status?: "pending" | "synced" | "failed";
  sync_action?: "none" | "create" | "update" | "delete";
  last_synced_at?: string | null;
}

type ProductRow = {
  id: string;
  shop_id: number | null;
  name: string;
  code: string | null;
  unit: string | null;
  pricing_mode: string | null;
  markup_percent: number | null;
  bulk_threshold: number | null;
  stock_quantity: number;
  low_stock_alert: number | null;
  photo_url: string | null;
  created_at: string | null;
  updated_at: string;
  cost_price_kopecks: number | null;
  sale_price_kopecks: number | null;
  bulk_price_kopecks: number | null;
};

function mapProductRow(r: ProductRow): LocalProduct {
  const photoUrl = resolveBackendAssetUrl(r.photo_url);
  return {
    id: r.id,
    shop_id: r.shop_id ?? 0,
    name: r.name,
    code: r.code ?? null,
    unit: r.unit ?? null,
    cost_price: fromKopecks(r.cost_price_kopecks),
    sale_price: fromKopecks(r.sale_price_kopecks),
    pricing_mode: (r.pricing_mode ?? "fixed") as LocalProduct["pricing_mode"],
    markup_percent: r.markup_percent != null ? Number(r.markup_percent) : undefined,
    bulk_price: r.bulk_price_kopecks != null ? fromKopecks(r.bulk_price_kopecks) : undefined,
    bulk_threshold: r.bulk_threshold != null ? Number(r.bulk_threshold) : undefined,
    stock_quantity: Number(r.stock_quantity),
    low_stock_alert: r.low_stock_alert != null ? Number(r.low_stock_alert) : null,
    photo_url: photoUrl,
    image_url: photoUrl,
    created_at: r.created_at ?? r.updated_at,
    updated_at: r.updated_at,
    status: "synced",
    sync_action: "none",
  };
}

/**
 * Build a safe FTS5 MATCH query from raw user input.
 *
 * Splits on whitespace, escapes embedded double quotes by doubling them
 * (the only way the FTS5 grammar admits a quote inside a phrase), wraps
 * each token as a phrase to neutralize special chars (`-`, `:`, `*`),
 * and appends `*` for prefix matching.
 *
 * Returns null for empty input — callers should fall back to a non-search
 * query.
 */
function buildFtsMatchQuery(search: string): string | null {
  const tokens = search
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

// ─── Bulk remote merge ────────────────────────────────────────────────────────

export async function insertOrUpdateProducts(products: Product[], shopId?: number): Promise<void> {
  const db = getDb();
  if (products.length === 0) return;

  await db.withTransactionAsync(async () => {
    for (const p of products) {
      if ((p as { deleted_at?: string | null }).deleted_at) {
        await db.runAsync("DELETE FROM products WHERE id = ?", [p.id]);
        continue;
      }

      // Clear the low-stock alert dedupe row when stock comes back above
      // threshold — otherwise the user never gets a fresh alert if it dips
      // again.
      if (p.stock_quantity > (p.low_stock_alert ?? 0)) {
        await db.runAsync(
          "DELETE FROM low_stock_alerts_sent WHERE product_id = ? AND shop_id = ?",
          [p.id, p.shop_id ?? shopId]
        );
      }

      await db.runAsync(
        `INSERT OR REPLACE INTO products (
          id, shop_id, name, code, unit,
          pricing_mode, markup_percent, bulk_threshold, stock_quantity,
          low_stock_alert, photo_url, updated_at,
          cost_price_kopecks, sale_price_kopecks, bulk_price_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id, p.shop_id ?? shopId, p.name, p.code, p.unit,
          p.pricing_mode ?? "fixed", p.markup_percent ?? null, p.bulk_threshold ?? null,
          p.stock_quantity, p.low_stock_alert ?? null, p.photo_url ?? p.image_url ?? null,
          p.updated_at,
          toKopecks(p.cost_price), toKopecks(p.sale_price), toKopecks(p.bulk_price),
        ]
      );
    }
  });
  await invalidateAggregatedCaches();
}

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function getLocalProducts(scope: LocalScope, search?: string): Promise<LocalProduct[]> {
  const db = getDb();
  const trimmedSearch = search?.trim();

  // Products live per-shop, not per-user — every staff member in a shop
  // shares the same catalog. scope.userId is intentionally ignored here.
  // Search path uses the FTS5 virtual table for token-based ranked matching.
  if (trimmedSearch) {
    const matchQuery = buildFtsMatchQuery(trimmedSearch);
    if (matchQuery) {
      const params: (string | number)[] = [matchQuery];
      let sql = `
        SELECT p.* FROM products p
        JOIN products_fts f ON f.id = p.id
        WHERE products_fts MATCH ?
      `;
      const shopFilter = shopIdInClause(scope.shopIds, "p.shop_id");
      sql += shopFilter.sql;
      params.push(...shopFilter.params);
      sql += " ORDER BY rank";
      const results = await db.getAllAsync<ProductRow>(sql, params);
      return results.map(mapProductRow);
    }
  }

  let query = "SELECT * FROM products WHERE 1=1";
  const params: (string | number)[] = [];
  const shopFilter = shopIdInClause(scope.shopIds);
  query += shopFilter.sql;
  params.push(...shopFilter.params);
  query += " ORDER BY name ASC";

  const results = await db.getAllAsync<ProductRow>(query, params);
  return results.map(mapProductRow);
}

export async function getLocalProductById(id: string): Promise<Product | null> {
  const db = getDb();
  const r = await db.getFirstAsync<ProductRow>("SELECT * FROM products WHERE id = ?", [id]);
  if (!r) return null;
  return mapProductRow(r);
}

/**
 * Drop a product from the local cache without going through the server.
 * Use after a 404 on a product write to evict the ghost row.
 */
export async function deleteLocalProduct(id: string | number): Promise<void> {
  if (id === null || id === undefined || id === "") return;
  const db = getDb();
  await db.runAsync("DELETE FROM products WHERE id = ?", [id]);
}

/**
 * Replace the local catalogue scope with the authoritative server set: keep
 * rows whose id appears in `serverIds`, drop the rest. Called after a full
 * id-only pull to evict ghost rows that the delta sync (`updated_since`) can
 * never observe (i.e. server-side hard-deletes).
 *
 * `scope` mirrors the same scope the fetcher used so we never delete rows
 * outside the user's visibility — e.g. an owner's reconcile must not touch
 * other shops' cached products that happen to share this device.
 */
export async function reconcileLocalProducts(
  scope: LocalScope,
  serverIds: ReadonlyArray<string>,
): Promise<void> {
  const db = getDb();
  const shopFilter = shopIdInClause(scope.shopIds);

  if (serverIds.length === 0) {
    await db.runAsync(`DELETE FROM products WHERE 1=1${shopFilter.sql}`, shopFilter.params);
    return;
  }

  // Chunk to keep the IN-list comfortably under SQLite's 999-bound parameter
  // limit (we also reserve some slots for the shop filter).
  const CHUNK = 500;
  const idSet = new Set(serverIds.map(String));

  const existing = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM products WHERE 1=1${shopFilter.sql}`,
    shopFilter.params,
  );
  const ghostIds = existing
    .map((r) => String(r.id))
    .filter((id) => !idSet.has(id));

  for (let i = 0; i < ghostIds.length; i += CHUNK) {
    const slice = ghostIds.slice(i, i + CHUNK);
    const placeholders = slice.map(() => "?").join(",");
    await db.runAsync(`DELETE FROM products WHERE id IN (${placeholders})`, slice);
  }
}
