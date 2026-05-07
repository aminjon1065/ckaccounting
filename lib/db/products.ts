// ─── Products repository ──────────────────────────────────────────────────────
//
// Reads, writes, and stock-delta bookkeeping for the `products` table.
// This is the largest entity surface — phase 5.4 stage-2 split.
//
// Pending stock delta:
//   Two parallel offline sales both decrement stock locally:
//     Sale A: pending_stock_delta = -3
//     Sale B: pending_stock_delta = -5
//   When Sale A's POST eventually succeeds, we must NOT hard-reset the
//   delta to 0 (that would erase Sale B). Instead we incrementally cancel
//   via `onSaleSyncSuccess` (delta += 3 → net -2). The `cancel*` variants
//   handle the failure path — server rejected, restore stock_quantity so
//   the next retry reasons against accurate inventory.

import { getDb } from "./schema";
import { fromKopecks, toKopecks } from "./money";
import { shopIdInClause, type LocalScope } from "./scope";
import { invalidateAggregatedCaches } from "./cache";
import { queueSyncAction } from "./outbox";
import { Product, resolveBackendAssetUrl } from "@/lib/api";

// LocalProduct extends Product with offline-first sync metadata.
export interface LocalProduct extends Product {
  status?: "pending" | "synced" | "failed";
  sync_action?: "none" | "create" | "update" | "delete";
  last_synced_at?: string | null;
}

// Raw product row coming back from SQLite (kopecks columns + sync flags).
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
  version: number | null;
  created_at: string | null;
  updated_at: string;
  last_synced_at: string | null;
  status: string | null;
  sync_action: string | null;
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
    status: (r.status as LocalProduct["status"]) ?? "synced",
    sync_action: (r.sync_action as LocalProduct["sync_action"]) ?? "none",
    last_synced_at: r.last_synced_at ?? undefined,
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

  // Conflict context lazy-imported to avoid the products↔conflict cycle.
  let detectConflict: (
    localId: string,
    entityType: "product",
    localData: Record<string, unknown>,
    serverData: Record<string, unknown>
  ) => ReturnType<typeof import("../sync/ConflictContext").detectConflict>;
  let queueExternalConflict: (conflict: Exclude<ReturnType<typeof detectConflict>, null>) => void;

  try {
    const mod = await import("../sync/ConflictContext");
    detectConflict = mod.detectConflict;
    queueExternalConflict = mod.queueExternalConflict;
  } catch {
    detectConflict = () => null;
    queueExternalConflict = () => {};
  }

  // Batch-load every existing row up front to replace N round-trips with 1.
  // This is the hottest sync path: a 500-product catalog used to issue 500
  // SELECTs inside the transaction; it's now a single query.
  type ExistingRow = { id: string; sync_action: string; status: string; stock_quantity: number; pending_stock_delta: number };
  const existingMap = new Map<string, ExistingRow>();
  if (products.length > 0) {
    const ids = products.map((p) => p.id);
    const placeholders = ids.map(() => "?").join(",");
    const rows = await db.getAllAsync<ExistingRow>(
      `SELECT id, sync_action, status, stock_quantity, pending_stock_delta FROM products WHERE id IN (${placeholders})`,
      ids
    );
    for (const r of rows) existingMap.set(r.id, r);
  }

  await db.withTransactionAsync(async () => {
    for (const p of products) {
      if ((p as { deleted_at?: string | null }).deleted_at) {
        await db.runAsync(
          `UPDATE products SET sync_action = 'delete', status = 'synced', updated_at = ? WHERE id = ?`,
          [new Date().toISOString(), p.id]
        );
        continue;
      }

      const existing = existingMap.get(p.id) ?? null;

      if (existing?.sync_action === "delete" && existing?.status === "synced") {
        continue;
      }

      if (existing && existing.pending_stock_delta !== 0) {
        const serverStock = p.stock_quantity;
        const localDelta = existing.pending_stock_delta;
        const mergedStock = serverStock + localDelta;
        const confirmedDelta =
          localDelta < 0 ? Math.min(0, serverStock - (mergedStock - localDelta)) : 0;
        const remainingDelta = localDelta - confirmedDelta;
        await db.runAsync(
          `INSERT OR REPLACE INTO products (
            id, shop_id, name, code, unit,
            pricing_mode, markup_percent, bulk_threshold, stock_quantity, low_stock_alert, photo_url, version, updated_at, last_synced_at, sync_action, status, pending_stock_delta,
            cost_price_kopecks, sale_price_kopecks, bulk_price_kopecks
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id, p.shop_id ?? shopId, p.name, p.code, p.unit,
            p.pricing_mode ?? "fixed", p.markup_percent ?? null, p.bulk_threshold ?? null,
            mergedStock, p.low_stock_alert ?? null, p.photo_url ?? p.image_url ?? null,
            (p as { version?: number }).version ?? 1, p.updated_at, new Date().toISOString(), "none", "synced",
            remainingDelta, toKopecks(p.cost_price), toKopecks(p.sale_price), toKopecks(p.bulk_price),
          ]
        );
        if (p.stock_quantity > (p.low_stock_alert ?? 0)) {
          await db.runAsync(
            "DELETE FROM low_stock_alerts_sent WHERE product_id = ? AND shop_id = ?",
            [p.id, p.shop_id ?? shopId]
          );
        }
        continue;
      }

      if (existing && existing.sync_action && existing.sync_action !== "none") {
        const localRow = await db.getFirstAsync<Record<string, unknown>>(
          "SELECT * FROM products WHERE id = ?",
          [p.id]
        );
        if (localRow) {
          const serverData: Record<string, unknown> = {
            name: p.name, code: p.code, unit: p.unit,
            cost_price: p.cost_price, sale_price: p.sale_price,
            pricing_mode: p.pricing_mode, markup_percent: p.markup_percent,
            bulk_price: p.bulk_price, bulk_threshold: p.bulk_threshold,
            stock_quantity: p.stock_quantity, low_stock_alert: p.low_stock_alert,
            photo_url: p.photo_url ?? p.image_url, version: (p as { version?: number }).version,
          };
          const conflict = detectConflict(p.id, "product", { ...localRow }, serverData);
          if (conflict) queueExternalConflict(conflict);
        }
        continue;
      }

      if (p.stock_quantity > (p.low_stock_alert ?? 0)) {
        await db.runAsync(
          "DELETE FROM low_stock_alerts_sent WHERE product_id = ? AND shop_id = ?",
          [p.id, shopId ?? p.shop_id]
        );
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO products (
          id, shop_id, name, code, unit,
          pricing_mode, markup_percent, bulk_threshold, stock_quantity, low_stock_alert, photo_url, version, updated_at, last_synced_at, sync_action, status, pending_stock_delta,
          cost_price_kopecks, sale_price_kopecks, bulk_price_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          p.id, p.shop_id ?? shopId, p.name, p.code, p.unit,
          p.pricing_mode ?? "fixed", p.markup_percent ?? null, p.bulk_threshold ?? null,
          p.stock_quantity, p.low_stock_alert ?? null, p.photo_url ?? p.image_url ?? null,
          (p as { version?: number }).version ?? 1, p.updated_at, new Date().toISOString(), "none", "synced",
          toKopecks(p.cost_price), toKopecks(p.sale_price), toKopecks(p.bulk_price),
        ]
      );
    }
  });
  // Remote merge changed catalog state — `low_stock_count` on the dashboard
  // could now disagree with the cached aggregate.
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
          AND (p.sync_action IS NULL OR p.sync_action != 'delete')
      `;
      const shopFilter = shopIdInClause(scope.shopIds, "p.shop_id");
      sql += shopFilter.sql;
      params.push(...shopFilter.params);
      sql += " ORDER BY rank";
      const results = await db.getAllAsync<ProductRow>(sql, params);
      return results.map(mapProductRow);
    }
  }

  // Non-search path
  let query = "SELECT * FROM products WHERE (sync_action IS NULL OR sync_action != 'delete')";
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
  const r = await db.getFirstAsync<ProductRow>(
    "SELECT * FROM products WHERE id = ? AND (sync_action IS NULL OR sync_action != 'delete')",
    [id]
  );
  if (!r) return null;
  return mapProductRow(r);
}

export async function getPendingSyncProducts(): Promise<LocalProduct[]> {
  const db = getDb();
  const results = await db.getAllAsync<ProductRow>(
    "SELECT * FROM products WHERE sync_action != 'none' ORDER BY rowid ASC"
  );
  return results.map((r) => {
    const product = mapProductRow(r);
    // Pending rows default to 'pending' status if SQLite returned null
    return { ...product, status: product.status ?? "pending" };
  });
}

// ─── Stock writes ────────────────────────────────────────────────────────────

export async function decrementLocalProductStock(id: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?), pending_stock_delta = pending_stock_delta - ? WHERE id = ?",
    [quantity, quantity, id]
  );
}

export async function incrementLocalProductStock(id: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET stock_quantity = stock_quantity + ?, pending_stock_delta = pending_stock_delta + ? WHERE id = ?",
    [quantity, quantity, id]
  );
}

// ─── Pending stock delta ─────────────────────────────────────────────────────
// See file header for the semantics. Each function moves at most one row;
// callers iterate over sale items.

/** Server confirmed our offline sale — incrementally cancel the local decrement. */
export async function onSaleSyncSuccess(productId: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET pending_stock_delta = pending_stock_delta + ? WHERE id = ?",
    [quantity, productId]
  );
}

/** Server confirmed our offline purchase — incrementally cancel the local increment. */
export async function onPurchaseSyncSuccess(productId: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET pending_stock_delta = pending_stock_delta - ? WHERE id = ?",
    [quantity, productId]
  );
}

/** Server rejected the sale — restore stock so the next retry has accurate inventory. */
export async function cancelPendingStockDelta(productId: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET stock_quantity = stock_quantity + ?, pending_stock_delta = pending_stock_delta + ? WHERE id = ?",
    [quantity, quantity, productId]
  );
}

/** Server rejected the purchase — undo the local stock increase. */
export async function cancelPendingPurchaseStockDelta(productId: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?), pending_stock_delta = pending_stock_delta - ? WHERE id = ?",
    [quantity, quantity, productId]
  );
}

/**
 * Re-apply a pending decrement when the user retries a previously failed
 * sale with corrected quantities. cancelPendingStockDelta has already
 * restored stock; this function reapplies the new (corrected) decrement
 * so the retry's eventual sync-success step will cancel it cleanly.
 */
export async function applyRecoveryStockDelta(productId: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET stock_quantity = stock_quantity - ?, pending_stock_delta = pending_stock_delta - ? WHERE id = ?",
    [quantity, quantity, productId]
  );
}

// ─── Single-product writes (offline create / update) ──────────────────────────

/**
 * Insert or update a single product row (offline path). product.id must
 * be a UUID generated client-side. When syncAction != "none", a sync
 * queue row is enqueued on the same transaction so the outbox processor
 * can replay the write to the server.
 */
export async function insertOrUpdateProduct(product: Product, syncAction: "none" | "create" | "update" = "none"): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO products (
        id, shop_id, name, code, unit,
        pricing_mode, markup_percent, bulk_threshold, stock_quantity,
        low_stock_alert, photo_url, version, updated_at, last_synced_at, sync_action, status,
        pending_stock_delta,
        cost_price_kopecks, sale_price_kopecks, bulk_price_kopecks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        product.id, product.shop_id, product.name, product.code,
        product.unit,
        product.pricing_mode ?? "fixed",
        product.markup_percent ?? null,
        product.bulk_threshold ?? null, product.stock_quantity,
        product.low_stock_alert ?? null, product.photo_url ?? product.image_url ?? null,
        (product as { version?: number }).version ?? 1,
        product.updated_at ?? new Date().toISOString(),
        new Date().toISOString(),
        syncAction,
        syncAction === "none" ? "synced" : "pending",
        toKopecks(product.cost_price),
        toKopecks(product.sale_price),
        toKopecks(product.bulk_price),
      ]
    );

    if (syncAction !== "none") {
      // Local file URIs (file://) must travel via multipart/form-data — the
      // outbox processor switches to FormData when it sees `photo_uri`.
      // Server-side HTTP URLs are skipped: the server already has them.
      const localPhoto =
        product.photo_url && product.photo_url.startsWith("file://") ? product.photo_url : null;

      await queueSyncAction(
        syncAction === "create" ? "POST" : "PATCH",
        syncAction === "create" ? "/products" : `/products/${product.id}`,
        {
          id: product.id,
          name: product.name,
          code: product.code,
          unit: product.unit,
          cost_price: product.cost_price,
          sale_price: product.sale_price,
          pricing_mode: product.pricing_mode,
          markup_percent: product.markup_percent,
          bulk_price: product.bulk_price,
          bulk_threshold: product.bulk_threshold,
          stock_quantity: product.stock_quantity,
          low_stock_alert: product.low_stock_alert,
          shop_id: product.shop_id,
          ...(localPhoto ? { photo_uri: localPhoto } : {}),
          version: (product as { version?: number }).version ?? 1,
        },
        { "Idempotency-Key": `prod-${product.id}` },
        `prod-${product.id}`
      );
    }
  });
}

export async function updateProductStatus(id: string, status: string, syncAction?: string): Promise<void> {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync("UPDATE products SET status = ?, sync_action = ? WHERE id = ?", [status, syncAction, id]);
  } else {
    await db.runAsync("UPDATE products SET status = ? WHERE id = ?", [status, id]);
  }
}

/**
 * Mark a product as deleted locally and queue the DELETE for sync.
 * Two paths:
 *   • Synced product: mark sync_action='delete', queue DELETE /products/{id}.
 *   • Local-only (sync_action='create', never sent): cancel the pending
 *     CREATE in the outbox and physically remove the row.
 */
export async function markProductDeletedLocally(productId: string): Promise<void> {
  const db = getDb();

  const existing = await db.getFirstAsync<{ sync_action: string; version: number | null }>(
    "SELECT sync_action, version FROM products WHERE id = ?",
    [productId]
  );

  if (existing?.sync_action === "create") {
    // Never synced — cancel the pending CREATE and remove the row.
    await db.runAsync("DELETE FROM sync_queue WHERE idempotency_key = ?", [`prod-${productId}`]);
    await db.runAsync("DELETE FROM products WHERE id = ?", [productId]);
    return;
  }

  // Server product — mark dirty and queue DELETE.
  await db.runAsync(
    "UPDATE products SET status = 'pending', sync_action = 'delete' WHERE id = ?",
    [productId]
  );
  const idempKey = `prod-delete-${productId}`;
  await queueSyncAction(
    "DELETE",
    `/products/${productId}`,
    { version: existing?.version ?? 1 },
    { "Idempotency-Key": idempKey },
    idempKey
  );
}

export async function deleteLocalProduct(id: string): Promise<void> {
  const db = getDb();
  await db.runAsync("DELETE FROM products WHERE id = ?", [id]);
}
