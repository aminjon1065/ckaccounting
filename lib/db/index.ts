import { getDb, initDb, clearLocalData } from "./schema";
export { getDb } from "./schema";

// Product Queries
import { Product, Debt, DebtTransaction, Sale, SaleItem, Expense, Purchase, PurchaseItem, Shop, resolveBackendAssetUrl } from "@/lib/api";

// ─── Money helpers ─────────────────────────────────────────────────────────────
//
// All money values are stored as INTEGER minor units (kopecks) to avoid
// floating-point drift. 1 ruble = 100 kopecks.
//
// API values (from server) are in rubles (floats). DB stores kopecks (integers).
// Conversion: toKopecks(rubles) and fromKopecks(kopecks).

function toKopecks(rubles: number | null | undefined): number | null {
  if (rubles == null) return null;
  return Math.round(rubles * 100);
}

function fromKopecks(kopecks: number | null | undefined): number {
  if (kopecks == null) return 0;
  return kopecks / 100;
}

function signedDebtAmount(amount: number, direction: string | null | undefined): number {
  const absolute = Math.abs(amount);
  return direction === "payable" ? -absolute : absolute;
}

function localDebtTransactionType(
  type: DebtTransaction["type"],
  direction: string | null | undefined
): DebtTransaction["type"] {
  return direction === "payable" && type === "give" ? "take" : type;
}

export async function insertOrUpdateProducts(products: Product[], shopId?: number) {
  const db = getDb();

  let detectConflict: (localId: string, entityType: "product", localData: Record<string, unknown>, serverData: Record<string, unknown>) => ReturnType<typeof import("../sync/ConflictContext").detectConflict>;
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
      if ((p as any).deleted_at) {
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
        const confirmedDelta = localDelta < 0
          ? Math.min(0, serverStock - (mergedStock - localDelta))
          : 0;
        const remainingDelta = localDelta - confirmedDelta;
        await db.runAsync(
          `INSERT OR REPLACE INTO products (
            id, shop_id, name, code, unit, cost_price, sale_price,
            pricing_mode, markup_percent, bulk_price, bulk_threshold, stock_quantity, low_stock_alert, photo_url, version, updated_at, last_synced_at, sync_action, status, pending_stock_delta,
            cost_price_kopecks, sale_price_kopecks, bulk_price_kopecks
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id, p.shop_id ?? shopId, p.name, p.code, p.unit, p.cost_price, p.sale_price,
            p.pricing_mode ?? "fixed", p.markup_percent ?? null, p.bulk_price ?? null, p.bulk_threshold ?? null,
            mergedStock, p.low_stock_alert ?? null, p.photo_url ?? p.image_url ?? null,
            (p as any).version ?? 1, p.updated_at, new Date().toISOString(), "none", "synced",
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
          "SELECT * FROM products WHERE id = ?", [p.id]
        );
        if (localRow) {
          const serverData: Record<string, unknown> = {
            name: p.name, code: p.code, unit: p.unit,
            cost_price: p.cost_price, sale_price: p.sale_price,
            pricing_mode: p.pricing_mode, markup_percent: p.markup_percent,
            bulk_price: p.bulk_price, bulk_threshold: p.bulk_threshold,
            stock_quantity: p.stock_quantity, low_stock_alert: p.low_stock_alert,
            photo_url: p.photo_url ?? p.image_url, version: (p as any).version,
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
          id, shop_id, name, code, unit, cost_price, sale_price,
          pricing_mode, markup_percent, bulk_price, bulk_threshold, stock_quantity, low_stock_alert, photo_url, version, updated_at, last_synced_at, sync_action, status, pending_stock_delta,
          cost_price_kopecks, sale_price_kopecks, bulk_price_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          p.id, p.shop_id ?? shopId, p.name, p.code, p.unit, p.cost_price, p.sale_price,
          p.pricing_mode ?? "fixed", p.markup_percent ?? null, p.bulk_price ?? null, p.bulk_threshold ?? null,
          p.stock_quantity, p.low_stock_alert ?? null, p.photo_url ?? p.image_url ?? null,
          (p as any).version ?? 1, p.updated_at, new Date().toISOString(), "none", "synced",
          toKopecks(p.cost_price), toKopecks(p.sale_price), toKopecks(p.bulk_price),
        ]
      );
    }
  });
}

function mapProductRow(r: any): LocalProduct {
  const photoUrl = resolveBackendAssetUrl(r.photo_url);
  return {
    id: r.id,
    shop_id: r.shop_id,
    name: r.name,
    code: r.code ?? null,
    unit: r.unit ?? null,
    cost_price: r.cost_price_kopecks != null ? fromKopecks(r.cost_price_kopecks) : Number(r.cost_price),
    sale_price: r.sale_price_kopecks != null ? fromKopecks(r.sale_price_kopecks) : Number(r.sale_price),
    pricing_mode: r.pricing_mode ?? "fixed",
    markup_percent: r.markup_percent != null ? Number(r.markup_percent) : undefined,
    bulk_price: r.bulk_price_kopecks != null ? fromKopecks(r.bulk_price_kopecks) : (r.bulk_price != null ? Number(r.bulk_price) : undefined),
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
 * - Splits on whitespace and drops short noise tokens.
 * - Escapes embedded double quotes by doubling them (the FTS5 grammar's only
 *   way to include a quote inside a phrase) and wraps each token as a phrase
 *   to neutralize special characters like `-`, `:`, `*` in the input.
 * - Appends a `*` after each phrase for prefix matching.
 *
 * Returns null when the cleaned input is empty (caller should fall back to
 * a non-search query).
 */
function buildFtsMatchQuery(search: string): string | null {
  const tokens = search
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

export async function getLocalProducts(shop_id?: number, search?: string): Promise<LocalProduct[]> {
  const db = getDb();
  const trimmedSearch = search?.trim();

  // Search path: use the FTS5 virtual table for token-based ranked matching.
  // Falls back to a LIKE scan if the user input degenerates to an empty query.
  if (trimmedSearch) {
    const matchQuery = buildFtsMatchQuery(trimmedSearch);
    if (matchQuery) {
      const params: any[] = [matchQuery];
      let sql = `
        SELECT p.* FROM products p
        JOIN products_fts f ON f.id = p.id
        WHERE products_fts MATCH ?
          AND (p.sync_action IS NULL OR p.sync_action != 'delete')
      `;
      if (shop_id) {
        sql += " AND p.shop_id = ?";
        params.push(shop_id);
      }
      sql += " ORDER BY rank";
      const results = await db.getAllAsync<any>(sql, params);
      return results.map(mapProductRow);
    }
  }

  // Non-search path
  let query = "SELECT * FROM products WHERE (sync_action IS NULL OR sync_action != 'delete')";
  const params: any[] = [];
  if (shop_id) {
    query += " AND shop_id = ?";
    params.push(shop_id);
  }
  query += " ORDER BY name ASC";

  const results = await db.getAllAsync<any>(query, params);
  return results.map(mapProductRow);
}

export async function getLocalProductById(id: string): Promise<Product | null> {
  const db = getDb();
  const r = await db.getFirstAsync<any>("SELECT * FROM products WHERE id = ? AND (sync_action IS NULL OR sync_action != 'delete')", [id]);
  if (!r) return null;
  const photoUrl = resolveBackendAssetUrl(r.photo_url);
  return {
    ...r,
    cost_price: r.cost_price_kopecks != null ? fromKopecks(r.cost_price_kopecks) : Number(r.cost_price),
    sale_price: r.sale_price_kopecks != null ? fromKopecks(r.sale_price_kopecks) : Number(r.sale_price),
    pricing_mode: r.pricing_mode ?? "fixed",
    markup_percent: r.markup_percent != null ? Number(r.markup_percent) : undefined,
    bulk_price: r.bulk_price_kopecks != null ? fromKopecks(r.bulk_price_kopecks) : (r.bulk_price != null ? Number(r.bulk_price) : undefined),
    bulk_threshold: r.bulk_threshold != null ? Number(r.bulk_threshold) : undefined,
    stock_quantity: Number(r.stock_quantity),
    low_stock_alert: r.low_stock_alert != null ? Number(r.low_stock_alert) : null,
    photo_url: photoUrl,
    image_url: photoUrl,
  };
}

export async function decrementLocalProductStock(id: string, quantity: number) {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?), pending_stock_delta = pending_stock_delta - ? WHERE id = ?",
    [quantity, quantity, id]
  );
}

export async function incrementLocalProductStock(id: string, quantity: number) {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET stock_quantity = stock_quantity + ?, pending_stock_delta = pending_stock_delta + ? WHERE id = ?",
    [quantity, quantity, id]
  );
}

// ─── Pending Stock Delta ───────────────────────────────────────────────────────
//
// Two parallel offline sales both decrement stock:
//   Sale A: pending_stock_delta = -3
//   Sale B: pending_stock_delta = -5
// When Sale A syncs, we must NOT hard-reset to 0 (Sale B's delta would be lost).
// Instead we incrementally cancel: pending_stock_delta += 3 (net: -2)
//
// Failure path (cancelPendingStockDelta): server rejected the sale.
// We must restore stock_quantity so inventory is accurate for next retry.
//

export async function onSaleSyncSuccess(productId: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET pending_stock_delta = pending_stock_delta + ? WHERE id = ?",
    [quantity, productId]
  );
}

export async function onPurchaseSyncSuccess(productId: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET pending_stock_delta = pending_stock_delta - ? WHERE id = ?",
    [quantity, productId]
  );
}

export async function cancelPendingStockDelta(productId: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET stock_quantity = stock_quantity + ?, pending_stock_delta = pending_stock_delta + ? WHERE id = ?",
    [quantity, quantity, productId]
  );
}

export async function cancelPendingPurchaseStockDelta(productId: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?), pending_stock_delta = pending_stock_delta - ? WHERE id = ?",
    [quantity, quantity, productId]
  );
}

/**
 * Restore stock for a recovered (retried) sale.
 * Unlike cancelPendingStockDelta, this is called on user-initiated retry after a failed
 * sale whose stock was already restored by cancelPendingStockDelta. It re-applies the
 * pending delta for the corrected quantities so the new sale's sync success will
 * correctly cancel it.
 */
export async function applyRecoveryStockDelta(productId: string, quantity: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET stock_quantity = stock_quantity - ?, pending_stock_delta = pending_stock_delta - ? WHERE id = ?",
    [quantity, quantity, productId]
  );
}

export async function getProductsLastSyncedAt(): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_metadata WHERE key = 'products_last_synced_at'"
  );
  return row?.value ?? null;
}

export async function setProductsLastSyncedAt(timestamp: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('products_last_synced_at', ?)",
    [timestamp]
  );
}

export async function getDebtsLastSyncedAt(): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_metadata WHERE key = 'debts_last_synced_at'"
  );
  return row?.value ?? null;
}

export async function setDebtsLastSyncedAt(timestamp: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('debts_last_synced_at', ?)",
    [timestamp]
  );
}

export async function getSalesLastSyncedAt(): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_metadata WHERE key = 'sales_last_synced_at'"
  );
  return row?.value ?? null;
}

export async function setSalesLastSyncedAt(timestamp: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('sales_last_synced_at', ?)",
    [timestamp]
  );
}

export async function getExpensesLastSyncedAt(): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_metadata WHERE key = 'expenses_last_synced_at'"
  );
  return row?.value ?? null;
}

export async function setExpensesLastSyncedAt(timestamp: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('expenses_last_synced_at', ?)",
    [timestamp]
  );
}

export async function getPurchasesLastSyncedAt(): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_metadata WHERE key = 'purchases_last_synced_at'"
  );
  return row?.value ?? null;
}

export async function setPurchasesLastSyncedAt(timestamp: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('purchases_last_synced_at', ?)",
    [timestamp]
  );
}

/**
 * Generic accessor for arbitrary sync_metadata keys. Used for the
 * "oldest_synced_at" boundary that lets capped initial syncs grow
 * historically when the user scrolls past the local window.
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

export async function getShopsLastSyncedAt(): Promise<string | null> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM sync_metadata WHERE key = 'shops_last_synced_at'"
  );
  return row?.value ?? null;
}

export async function setShopsLastSyncedAt(timestamp: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES ('shops_last_synced_at', ?)",
    [timestamp]
  );
}

// LocalProduct extends Product with offline-first sync metadata
export interface LocalProduct extends Product {
  status?: "pending" | "synced" | "failed";
  sync_action?: "none" | "create" | "update" | "delete";
  last_synced_at?: string | null;
}

// Insert or update a single product (used for offline-created products).
// product.id must be a UUID generated client-side before calling this.
export async function insertOrUpdateProduct(product: Product, syncAction = "none") {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO products (
        id, shop_id, name, code, unit, cost_price, sale_price,
        pricing_mode, markup_percent, bulk_price, bulk_threshold, stock_quantity,
        low_stock_alert, photo_url, version, updated_at, last_synced_at, sync_action, status,
        pending_stock_delta,
        cost_price_kopecks, sale_price_kopecks, bulk_price_kopecks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        product.id, product.shop_id, product.name, product.code,
        product.unit, product.cost_price, product.sale_price,
        product.pricing_mode ?? "fixed",
        product.markup_percent ?? null, product.bulk_price ?? null,
        product.bulk_threshold ?? null, product.stock_quantity,
        product.low_stock_alert ?? null, product.photo_url ?? product.image_url ?? null,
        (product as any).version ?? 1,
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
      const localPhoto = product.photo_url && product.photo_url.startsWith("file://")
        ? product.photo_url
        : null;

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
          version: (product as any).version ?? 1,
        },
        { "Idempotency-Key": `prod-${product.id}` },
        `prod-${product.id}`
      );
    }
  });
}

export async function updateProductStatus(id: string, status: string, syncAction?: string) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE products SET status = ?, sync_action = ? WHERE id = ?",
      [status, syncAction, id]
    );
  } else {
    await db.runAsync("UPDATE products SET status = ? WHERE id = ?", [status, id]);
  }
}

/**
 * Marks a product as deleted locally and queues a DELETE sync action.
 *
 * - Synced product: mark sync_action='delete', queue DELETE /products/{id}.
 * - Local-only (sync_action='create', never sent): cancel the pending CREATE and delete the row.
 */
export async function markProductDeletedLocally(productId: string): Promise<void> {
  const db = getDb();

  const existing = await db.getFirstAsync<{ sync_action: string; version: number | null }>(
    "SELECT sync_action, version FROM products WHERE id = ?",
    [productId]
  );

  if (existing?.sync_action === "create") {
    // Never synced — cancel the pending CREATE and remove the row
    await db.runAsync(
      "DELETE FROM sync_queue WHERE idempotency_key = ?",
      [`prod-${productId}`]
    );
    await db.runAsync("DELETE FROM products WHERE id = ?", [productId]);
  } else {
    // Server product — mark dirty and queue DELETE
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
}

/**
 * Marks an expense as deleted locally and queues a DELETE sync action.
 *
 * - Synced expense: mark sync_action='delete', queue DELETE /expenses/{id}.
 * - Local-only (sync_action='create'): cancel pending CREATE and delete the row.
 */
export async function markExpenseDeletedLocally(expenseId: string): Promise<void> {
  const db = getDb();

  const existing = await db.getFirstAsync<{ sync_action: string; version: number | null }>(
    "SELECT sync_action, version FROM expenses WHERE id = ?",
    [expenseId]
  );

  if (existing?.sync_action === "create") {
    await db.runAsync(
      "DELETE FROM sync_queue WHERE idempotency_key = ?",
      [`exp-${expenseId}`]
    );
    await db.runAsync("DELETE FROM expenses WHERE id = ?", [expenseId]);
  } else {
    await db.runAsync(
      "UPDATE expenses SET status = 'pending', sync_action = 'delete' WHERE id = ?",
      [expenseId]
    );
    const idempKey = `exp-delete-${expenseId}`;
    await queueSyncAction(
      "DELETE",
      `/expenses/${expenseId}`,
      { version: existing?.version ?? 1 },
      { "Idempotency-Key": idempKey },
      idempKey
    );
  }
}

export async function getPendingSyncProducts(): Promise<LocalProduct[]> {
  const db = getDb();
  const results = await db.getAllAsync<any>(
    "SELECT * FROM products WHERE sync_action != 'none' ORDER BY rowid ASC"
  );
  return results.map(r => {
    const photoUrl = resolveBackendAssetUrl(r.photo_url);

    return {
    ...r,
    id: r.id,
    shop_id: r.shop_id,
    name: r.name,
    code: r.code ?? null,
    unit: r.unit ?? null,
    cost_price: r.cost_price_kopecks != null ? fromKopecks(r.cost_price_kopecks) : Number(r.cost_price),
    sale_price: r.sale_price_kopecks != null ? fromKopecks(r.sale_price_kopecks) : Number(r.sale_price),
    pricing_mode: r.pricing_mode ?? "fixed",
    markup_percent: r.markup_percent != null ? Number(r.markup_percent) : undefined,
    bulk_price: r.bulk_price_kopecks != null ? fromKopecks(r.bulk_price_kopecks) : (r.bulk_price != null ? Number(r.bulk_price) : undefined),
    bulk_threshold: r.bulk_threshold != null ? Number(r.bulk_threshold) : undefined,
    stock_quantity: Number(r.stock_quantity),
    low_stock_alert: r.low_stock_alert != null ? Number(r.low_stock_alert) : null,
    photo_url: photoUrl,
    image_url: photoUrl,
    created_at: r.created_at ?? r.updated_at,
    updated_at: r.updated_at,
    status: (r.status as LocalProduct["status"]) ?? "pending",
    sync_action: (r.sync_action as LocalProduct["sync_action"]) ?? "none",
    last_synced_at: r.last_synced_at ?? undefined,
    };
  });
}

export async function deleteLocalProduct(id: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM products WHERE id = ?", [id]);
}

// Debt Queries
export async function insertOrUpdateDebts(debts: Debt[], shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const d of debts) {
      if ((d as any).deleted_at) {
        await db.runAsync("DELETE FROM debts WHERE id = ?", [d.id]);
        continue;
      }

      const existing = await db.getFirstAsync<{ sync_action: string }>(
        "SELECT sync_action FROM debts WHERE id = ?",
        [d.id]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue;
      }

      const incomingSyncAction = (d as any).sync_action ?? "none";
      const openingBalance = d.opening_balance ?? 0;
      await db.runAsync(
        `INSERT OR REPLACE INTO debts (
          id, shop_id, user_id, person_name, opening_balance, balance, direction, updated_at, last_synced_at,
          opening_balance_kopecks, balance_kopecks, sync_action
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          d.id, shopId ?? d.shop_id ?? null, (d as any).user_id ?? null, d.person_name, openingBalance, d.balance,
          d.direction ?? "receivable", d.updated_at, new Date().toISOString(),
          toKopecks(openingBalance), toKopecks(d.balance), incomingSyncAction,
        ]
      );
      if (d.transactions) {
        for (const tx of d.transactions) {
          const existingTx = await db.getFirstAsync<{ sync_action: string }>(
            "SELECT sync_action FROM debt_transactions WHERE id = ?",
            [tx.id]
          );
          if (existingTx && existingTx.sync_action && existingTx.sync_action !== "none") {
            continue;
          }
          await db.runAsync(
            `INSERT OR REPLACE INTO debt_transactions (
              id, debt_id, type, amount, note, created_at, amount_kopecks, sync_action
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              tx.id,
              tx.debt_id ?? d.id,
              localDebtTransactionType(tx.type, d.direction),
              tx.amount,
              tx.note ?? null,
              tx.created_at,
              toKopecks(tx.amount),
              "none",
            ]
          );
        }
      }
    }
  });
}

export async function insertOrUpdateDebtTransactions(transactions: DebtTransaction[]) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const tx of transactions) {
      const existing = await db.getFirstAsync<{ sync_action: string }>(
        "SELECT sync_action FROM debt_transactions WHERE id = ?",
        [tx.id]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO debt_transactions (
          id, debt_id, type, amount, note, created_at, amount_kopecks, sync_action
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tx.id, tx.debt_id, tx.type, tx.amount, tx.note ?? null, tx.created_at, toKopecks(tx.amount), "none"]
      );
    }
  });
}

export async function getLocalDebts(shop_id?: number, userId?: number | null): Promise<Debt[]> {
  const db = getDb();
  let query = "SELECT * FROM debts";
  const params: any[] = [];
  const conditions: string[] = [];
  if (shop_id) {
    conditions.push("(shop_id = ? OR shop_id IS NULL)");
    params.push(shop_id);
  }
  if (userId) {
    conditions.push("user_id = ?");
    params.push(userId);
  }
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY updated_at DESC";

  const results = await db.getAllAsync<any>(query, params);
  return results.map(r => ({
    id: r.id,
    user_id: r.user_id ?? undefined,
    person_name: r.person_name,
    opening_balance: signedDebtAmount(
      r.opening_balance_kopecks != null ? fromKopecks(r.opening_balance_kopecks) : Number(r.opening_balance),
      r.direction
    ),
    balance: signedDebtAmount(
      r.balance_kopecks != null ? fromKopecks(r.balance_kopecks) : Number(r.balance),
      r.direction
    ),
    direction: r.direction ?? "receivable",
    created_at: r.created_at ?? r.updated_at,
    updated_at: r.updated_at,
  }));
}

export async function getLocalDebtById(id: string): Promise<Debt | null> {
  const db = getDb();
  const r = await db.getFirstAsync<any>(
    "SELECT * FROM debts WHERE id = ?",
    [id]
  );
  if (!r) return null;

  const txs = await getLocalDebtTransactions(r.id);
  return {
    id: r.id,
    person_name: r.person_name,
    opening_balance: signedDebtAmount(
      r.opening_balance_kopecks != null ? fromKopecks(r.opening_balance_kopecks) : Number(r.opening_balance),
      r.direction
    ),
    balance: signedDebtAmount(
      r.balance_kopecks != null ? fromKopecks(r.balance_kopecks) : Number(r.balance),
      r.direction
    ),
    direction: r.direction ?? "receivable",
    transactions: txs,
    created_at: r.created_at ?? r.updated_at,
    updated_at: r.updated_at,
  };
}

export async function getLocalDebtTransactions(debt_id: string): Promise<DebtTransaction[]> {
  const db = getDb();
  const results = await db.getAllAsync<any>(
    "SELECT * FROM debt_transactions WHERE debt_id = ? ORDER BY created_at DESC",
    [debt_id]
  );
  return results.map(r => ({
    id: r.id,
    debt_id: r.debt_id,
    type: r.type,
    amount: r.amount_kopecks != null ? fromKopecks(r.amount_kopecks) : Number(r.amount),
    note: r.note,
    created_at: r.created_at,
  }));
}

// Queue Queries
export interface SyncAction {
  id: number;
  method: string;
  path: string;
  payload: string;
  headers: string | null;
  status: "pending" | "processing" | "failed" | "completed" | "dead";
  retries: number;
  created_at: string;
  last_error?: string | null;
  batch_id?: string | null;
  idempotency_key?: string | null;
}

export async function queueSyncAction(method: string, path: string, payload: any, headers?: Record<string, string>, idempotencyKey?: string) {
  const db = getDb();
  await db.runAsync(
    "INSERT INTO sync_queue (method, path, payload, headers, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [
      method,
      path,
      typeof payload === 'string' ? payload : JSON.stringify(payload),
      headers ? JSON.stringify(headers) : null,
      idempotencyKey ?? null,
      new Date().toISOString(),
    ]
  );
}

export async function claimPendingSyncActions(batchSize = 10): Promise<SyncAction[]> {
  const db = getDb();
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await db.runAsync(
    `UPDATE sync_queue
     SET status = 'processing', batch_id = ?
     WHERE id IN (
       SELECT id FROM sync_queue
       WHERE archived_at IS NULL
         AND status IN ('pending', 'failed')
         AND retries < 5
       ORDER BY id ASC
       LIMIT ?
     )`,
    [batchId, batchSize]
  );

  return db.getAllAsync<SyncAction>(
    "SELECT * FROM sync_queue WHERE batch_id = ? ORDER BY id ASC",
    [batchId]
  );
}

export async function getPendingSyncActions(): Promise<SyncAction[]> {
  const db = getDb();
  return await db.getAllAsync<SyncAction>(
    "SELECT * FROM sync_queue WHERE archived_at IS NULL AND status IN ('pending', 'failed', 'dead') ORDER BY id ASC LIMIT 50"
  );
}

export async function getPendingSyncActionsCount(): Promise<number> {
  const db = getDb();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE archived_at IS NULL AND status IN ('pending', 'failed')"
  );

  return Number(result?.count ?? 0);
}

export async function getDeadSyncActionsCount(): Promise<number> {
  const db = getDb();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE archived_at IS NULL AND status = 'dead'"
  );

  return Number(result?.count ?? 0);
}

export async function markSyncActionStatus(id: number, status: "pending" | "processing" | "failed" | "completed" | "dead", incrementRetry = false, lastError?: string) {
  const db = getDb();
  if (status === "completed") {
    await db.runAsync(
      "UPDATE sync_queue SET status = 'completed', archived_at = ? WHERE id = ?",
      [new Date().toISOString(), id]
    );
  } else if (status === "dead") {
    await db.runAsync("UPDATE sync_queue SET status = 'dead', last_error = ? WHERE id = ?", [lastError ?? null, id]);
  } else if (incrementRetry) {
    const args: (string | number)[] = lastError !== undefined
      ? [status, lastError, id]
      : [status, id];
    await db.runAsync(
      `UPDATE sync_queue SET status = CASE WHEN retries >= 4 THEN 'dead' ELSE ? END, retries = retries + 1${lastError !== undefined ? ", last_error = ?" : ""} WHERE id = ?`,
      args
    );
  } else {
    const args: (string | number)[] = lastError !== undefined
      ? [status, lastError, id]
      : [status, id];
    await db.runAsync(`UPDATE sync_queue SET status = ?${lastError !== undefined ? ", last_error = ?" : ""} WHERE id = ?`, args);
  }
}

/** Archive a single sync queue row (soft-delete instead of physical DELETE for audit). */
export async function archiveSyncAction(id: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "UPDATE sync_queue SET archived_at = ? WHERE id = ?",
    [new Date().toISOString(), id]
  );
}

/**
 * Prune archived completed rows older than the specified number of days.
 * Keeps the audit trail bounded while preserving recent completed rows for
 * crash-recovery idempotency reasoning. Dead/failed rows are not pruned.
 */
export async function pruneArchivedSyncActions(olderThanDays = 30): Promise<void> {
  const db = getDb();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  await db.runAsync(
    "DELETE FROM sync_queue WHERE archived_at IS NOT NULL AND archived_at < ? AND status = 'completed'",
    [cutoff]
  );
}

/** Archive all sync queue rows matching the given status filter. */
export async function archiveSyncActions(
  statuses: Array<"pending" | "failed" | "dead" | "completed">
): Promise<void> {
  const db = getDb();
  const placeholders = statuses.map(() => "?").join(", ");
  await db.runAsync(
    `UPDATE sync_queue SET archived_at = ? WHERE status IN (${placeholders}) AND archived_at IS NULL`,
    [new Date().toISOString(), ...statuses]
  );
}

// Sale item stored as JSON in the items column
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

// LocalSale extends Sale with offline-first sync metadata
export interface LocalSale extends Sale {
  shop_id?: number;
  user_id?: number;
  status: "pending" | "synced" | "failed";
  sync_action: "none" | "create" | "update" | "delete";
  last_synced_at?: string | null;
}

async function getSaleItemsForId(saleId: string): Promise<SaleItem[]> {
  if (!saleId) return [];
  const db = getDb();
  const rows = await db.getAllAsync<{
    id: string; product_id: string | null; product_name: string | null;
    unit: string | null; quantity: number; unit_price: number; total: number;
    unit_price_kopecks: number | null; total_kopecks: number | null;
  }>(
    "SELECT id, product_id, product_name, unit, quantity, unit_price, total, unit_price_kopecks, total_kopecks FROM sale_items WHERE sale_id = ?",
    [saleId]
  );
  return rows.map((row) => ({
    id: row.id,
    product_id: row.product_id,
    product_name: row.product_name,
    unit: row.unit ?? undefined,
    quantity: row.quantity,
    price: row.unit_price_kopecks != null ? fromKopecks(row.unit_price_kopecks) : row.unit_price,
    total: row.total_kopecks != null ? fromKopecks(row.total_kopecks) : row.total,
  }));
}

async function mapRowToSale(r: SaleRow): Promise<Sale> {
  const items = await getSaleItemsForId(r.id);
  const saleItems = items.length > 0 ? items : parseSaleItemsJson(r.items);
  return {
    id: r.id,
    type: r.type as Sale["type"],
    customer_name: r.customer_name,
    total: r.total_kopecks != null ? fromKopecks(r.total_kopecks) : (r.total ?? 0),
    discount: r.discount_kopecks != null ? fromKopecks(r.discount_kopecks) : (r.discount ?? 0),
    paid: r.paid_kopecks != null ? fromKopecks(r.paid_kopecks) : (r.paid ?? 0),
    debt: r.debt_kopecks != null ? fromKopecks(r.debt_kopecks) : (r.debt ?? 0),
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

async function mapRowToLocalSale(r: SaleRow): Promise<LocalSale> {
  const base = await mapRowToSale(r);
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
        id, shop_id, user_id, customer_name, type, total, discount, paid, debt,
        payment_type, notes, items, status, sync_action, created_at, updated_at, last_synced_at,
        total_kopecks, discount_kopecks, paid_kopecks, debt_kopecks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sale.id,
        shopId ?? null,
        userId ?? null,
        sale.customer_name,
        sale.type ?? null,
        sale.total,
        sale.discount,
        sale.paid,
        sale.debt,
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
        `INSERT INTO sale_items (sale_id, product_id, product_name, unit, quantity, unit_price, total, created_at, unit_price_kopecks, total_kopecks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sale.id,
          item.product_id ?? null,
          item.product_name ?? (item as any).name ?? "",
          item.unit ?? null,
          item.quantity,
          item.price,
          item.total,
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

    await db.runAsync("DELETE FROM dashboard_cache");
  });
}

export async function insertOrUpdateRemoteSales(sales: Sale[], shopId?: number): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const sale of sales) {
      if ((sale as any).deleted_at) {
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
          id, shop_id, user_id, customer_name, type, total, discount, paid, debt,
          payment_type, notes, items, status, sync_action, created_at, updated_at, last_synced_at,
          total_kopecks, discount_kopecks, paid_kopecks, debt_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sale.id,
          shopId ?? null,
          sale.user_id ?? null,
          sale.customer_name,
          sale.type ?? null,
          sale.total,
          sale.discount,
          sale.paid,
          sale.debt,
          sale.payment_type,
          sale.notes ?? null,
          JSON.stringify(sale.items),
          "synced",
          "none",
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
          `INSERT INTO sale_items (sale_id, product_id, product_name, unit, quantity, unit_price, total, created_at, unit_price_kopecks, total_kopecks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            sale.id,
            item.product_id ?? null,
            item.product_name ?? (item as any).name ?? "",
            item.unit ?? null,
            item.quantity,
            item.price,
            item.total,
            now,
            toKopecks(item.price),
            toKopecks(item.total),
          ]
        );
      }
    }
  });
}

export async function getLocalSales(shopId?: number, userId?: number): Promise<LocalSale[]> {
  const db = getDb();
  let query = "SELECT * FROM sales";
  const params: any[] = [];
  const conditions: string[] = [];
  if (shopId !== undefined) {
    conditions.push("shop_id = ?");
    params.push(shopId);
  }
  if (userId !== undefined) {
    conditions.push("user_id = ?");
    params.push(userId);
  }
  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY created_at DESC";
  const results = await db.getAllAsync<SaleRow>(query, params);

  if (results.length === 0) return [];

  const saleIds = results.map(r => r.id).filter(Boolean);
  const allItems = saleIds.length > 0
    ? await db.getAllAsync<{
        sale_id: string; id: string; product_id: string | null;
        product_name: string | null; unit: string | null;
        quantity: number; unit_price: number; total: number;
        unit_price_kopecks: number | null; total_kopecks: number | null;
      }>(
        `SELECT sale_id, id, product_id, product_name, unit, quantity, unit_price, total,
                unit_price_kopecks, total_kopecks
         FROM sale_items WHERE sale_id IN (${saleIds.map(() => "?").join(", ")})`,
        saleIds
      )
    : [];

  const itemsBySale = new Map<string, SaleItem[]>();
  for (const item of allItems) {
    const list = itemsBySale.get(item.sale_id) ?? [];
    list.push({
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name,
      unit: item.unit ?? undefined,
      quantity: item.quantity,
      price: item.unit_price_kopecks != null ? fromKopecks(item.unit_price_kopecks) : item.unit_price,
      total: item.total_kopecks != null ? fromKopecks(item.total_kopecks) : item.total,
    });
    itemsBySale.set(item.sale_id, list);
  }

  return results.map(r => ({
    id: r.id,
    type: r.type as Sale["type"],
    customer_name: r.customer_name,
    total: r.total_kopecks != null ? fromKopecks(r.total_kopecks) : (r.total ?? 0),
    discount: r.discount_kopecks != null ? fromKopecks(r.discount_kopecks) : (r.discount ?? 0),
    paid: r.paid_kopecks != null ? fromKopecks(r.paid_kopecks) : (r.paid ?? 0),
    debt: r.debt_kopecks != null ? fromKopecks(r.debt_kopecks) : (r.debt ?? 0),
    payment_type: (r.payment_type as Sale["payment_type"]) ?? "cash",
    notes: r.notes ?? undefined,
    items: itemsBySale.get(r.id) ?? parseSaleItemsJson(r.items),
    created_at: r.created_at,
    updated_at: r.updated_at,
    shop_id: r.shop_id ?? undefined,
    user_id: r.user_id ?? undefined,
    status: (r.status as LocalSale["status"]) ?? "synced",
    sync_action: (r.sync_action as LocalSale["sync_action"]) ?? "none",
    last_synced_at: r.last_synced_at ?? undefined,
  }));
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
  return Promise.all(results.map(mapRowToLocalSale));
}

// ─── Expenses ──────────────────────────────────────────────────────────────────

interface ExpenseRow {
  id: string;
  shop_id: number | null;
  user_id: number | null;
  name: string;
  quantity: number | null;
  price: number | null;
  total: number | null;
  note: string | null;
  status: string;
  sync_action: string;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  price_kopecks: number | null;
  total_kopecks: number | null;
}

// LocalExpense extends Expense with offline-first sync metadata
export interface LocalExpense extends Expense {
  shop_id?: number;
  user_id?: number;
  status: "pending" | "synced" | "failed";
  sync_action: "none" | "create" | "update" | "delete";
  last_synced_at?: string | null;
}

function mapRowToExpense(r: ExpenseRow): Expense {
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity ?? 0,
    price: r.price_kopecks != null ? fromKopecks(r.price_kopecks) : (r.price ?? 0),
    total: r.total_kopecks != null ? fromKopecks(r.total_kopecks) : (r.total ?? 0),
    note: r.note,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function mapRowToLocalExpense(r: ExpenseRow): LocalExpense {
  const base = mapRowToExpense(r);
  return {
    ...base,
    shop_id: r.shop_id ?? undefined,
    user_id: r.user_id ?? undefined,
    status: r.status as LocalExpense["status"],
    sync_action: r.sync_action as LocalExpense["sync_action"],
    last_synced_at: r.last_synced_at ?? undefined,
  };
}

// expense.id must be a UUID generated client-side before calling this.
export async function insertOrUpdateExpense(expense: Expense, shopId?: number, userId?: number, syncAction: "create" | "update" | "none" = "create") {
  const db = getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO expenses (
        id, shop_id, user_id, name, quantity, price, total, note,
        status, sync_action, created_at, updated_at, last_synced_at,
        price_kopecks, total_kopecks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        expense.id,
        shopId ?? null,
        userId ?? null,
        expense.name,
        expense.quantity,
        expense.price,
        expense.total,
        expense.note ?? null,
        "pending",
        syncAction,
        expense.created_at ?? now,
        expense.updated_at ?? now,
        null,
        toKopecks(expense.price), toKopecks(expense.total),
      ]
    );

    if (syncAction === "create") {
      await queueSyncAction(
        "POST",
        "/expenses",
        {
          id: expense.id,
          name: expense.name,
          quantity: expense.quantity,
          price: expense.price,
          note: expense.note,
          shop_id: shopId,
        },
        { "Idempotency-Key": `exp-${expense.id}` },
        `exp-${expense.id}`
      );
    } else if (syncAction === "update") {
      const patchPayload: Record<string, unknown> = {
        name: expense.name,
        quantity: expense.quantity,
        price: expense.price,
        note: expense.note,
        shop_id: shopId,
      };
      if ((expense as any).version !== undefined) {
        patchPayload.version = (expense as any).version;
      }
      await queueSyncAction(
        "PATCH",
        `/expenses/${expense.id}`,
        patchPayload,
        undefined,
        `exp-update-${expense.id}`
      );
    }

    await db.runAsync("DELETE FROM dashboard_cache");
  });
}

export async function getLocalExpenses(shopId?: number): Promise<LocalExpense[]> {
  const db = getDb();
  let query = "SELECT * FROM expenses";
  const params: any[] = [];
  if (shopId) {
    query += " WHERE shop_id = ? AND (sync_action IS NULL OR sync_action != 'delete')";
    params.push(shopId);
  } else {
    query += " WHERE (sync_action IS NULL OR sync_action != 'delete')";
  }
  query += " ORDER BY created_at DESC";
  const results = await db.getAllAsync<ExpenseRow>(query, params);
  return results.map(mapRowToLocalExpense);
}

export async function updateExpenseStatus(id: string, status: string, syncAction?: string) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE expenses SET status = ?, sync_action = ? WHERE id = ?",
      [status, syncAction, id]
    );
  } else {
    await db.runAsync(
      "UPDATE expenses SET status = ? WHERE id = ?",
      [status, id]
    );
  }
}

export async function deleteLocalExpense(id: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM expenses WHERE id = ?", [id]);
}

export async function getPendingSyncExpenses(): Promise<LocalExpense[]> {
  const db = getDb();
  const results = await db.getAllAsync<ExpenseRow>(
    "SELECT * FROM expenses WHERE sync_action != 'none' ORDER BY created_at ASC"
  );
  return results.map(mapRowToLocalExpense);
}

export async function insertOrUpdateExpenses(expenses: Expense[], shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const e of expenses) {
      if ((e as any).deleted_at) {
        await db.runAsync(
          `UPDATE expenses SET sync_action = 'delete', status = 'synced', updated_at = ?
           WHERE id = ?`,
          [new Date().toISOString(), e.id]
        );
        continue;
      }

      const existing = await db.getFirstAsync<{ sync_action: string; status: string }>(
        "SELECT sync_action, status FROM expenses WHERE id = ?",
        [e.id]
      );
      if (existing?.sync_action === 'delete' && existing?.status === 'synced') {
        continue;
      }
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO expenses (
          id, shop_id, user_id, name, quantity, price, total, note,
          status, sync_action, created_at, updated_at, last_synced_at,
          price_kopecks, total_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id, shopId ?? null, null, e.name, e.quantity, e.price, e.total,
          e.note ?? null, "synced", "none", e.created_at, e.updated_at, new Date().toISOString(),
          toKopecks(e.price), toKopecks(e.total),
        ]
      );
    }
  });
}

export async function insertOrUpdatePurchases(purchases: Purchase[], shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const p of purchases) {
      if ((p as any).deleted_at) {
        await db.runAsync("DELETE FROM purchases WHERE id = ?", [p.id]);
        continue;
      }

      const existing = await db.getFirstAsync<{ sync_action: string }>(
        "SELECT sync_action FROM purchases WHERE id = ?",
        [p.id]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO purchases (
          id, shop_id, supplier_name, total, items,
          status, sync_action, created_at, updated_at, last_synced_at,
          total_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id, shopId ?? null, p.supplier_name ?? null, p.total ?? 0,
          JSON.stringify(p.items ?? []),
          "synced", "none", p.created_at ?? "", p.updated_at ?? "", new Date().toISOString(),
          toKopecks(p.total),
        ]
      );
    }
  });
}

// ─── Purchases ──────────────────────────────────────────────────────────────────

interface PurchaseRow {
  id: string;
  shop_id: number | null;
  supplier_name: string | null;
  total: number | null;
  items: string | null;
  status: string | null;
  sync_action: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_synced_at: string | null;
  total_kopecks: number | null;
}

// LocalPurchase extends Purchase with offline-first sync metadata
export interface LocalPurchase extends Purchase {
  shop_id?: number;
  status: "pending" | "synced" | "failed";
  sync_action: "none" | "create" | "update" | "delete";
  last_synced_at?: string;
}

function mapRowToPurchase(r: PurchaseRow): Purchase {
  let items: PurchaseItem[] = [];
  try {
    items = JSON.parse(r.items || "[]");
  } catch {}
  return {
    id: r.id,
    supplier_name: r.supplier_name ?? null,
    total: r.total_kopecks != null ? fromKopecks(r.total_kopecks) : (r.total ?? 0),
    items,
    created_at: r.created_at ?? "",
    updated_at: r.updated_at ?? "",
  };
}

function mapRowToLocalPurchase(r: PurchaseRow): LocalPurchase {
  const base = mapRowToPurchase(r);
  return {
    ...base,
    shop_id: r.shop_id ?? undefined,
    status: (r.status as LocalPurchase["status"]) ?? "pending",
    sync_action: (r.sync_action as LocalPurchase["sync_action"]) ?? "none",
    last_synced_at: r.last_synced_at ?? undefined,
  };
}

// purchase.id must be a UUID generated client-side before calling this.
export async function insertOrUpdatePurchase(purchase: Purchase, shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO purchases (
        id, shop_id, supplier_name, total, items,
        status, sync_action, created_at, updated_at, last_synced_at,
        total_kopecks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        purchase.id,
        shopId ?? null,
        purchase.supplier_name ?? null,
        purchase.total ?? 0,
        JSON.stringify(purchase.items ?? []),
        "pending",
        "create",
        purchase.created_at || new Date().toISOString(),
        purchase.updated_at || new Date().toISOString(),
        null,
        toKopecks(purchase.total),
      ]
    );

    await queueSyncAction(
      "POST",
      "/purchases",
      {
        id: purchase.id,
        supplier_name: purchase.supplier_name,
        items: purchase.items,
        shop_id: shopId,
      },
      { "Idempotency-Key": `pur-${purchase.id}` },
      `pur-${purchase.id}`
    );

    for (const item of purchase.items ?? []) {
      await db.runAsync(
        "UPDATE products SET stock_quantity = stock_quantity + ?, pending_stock_delta = pending_stock_delta + ? WHERE id = ?",
        [item.quantity, item.quantity, item.product_id]
      );
    }

    await db.runAsync("DELETE FROM dashboard_cache");
  });
}

export async function getLocalPurchases(shopId?: number): Promise<LocalPurchase[]> {
  const db = getDb();
  let query = "SELECT * FROM purchases";
  const params: any[] = [];
  if (shopId !== undefined) {
    query += " WHERE shop_id = ? AND (sync_action IS NULL OR sync_action != 'delete')";
    params.push(shopId);
  } else {
    query += " WHERE (sync_action IS NULL OR sync_action != 'delete')";
  }
  query += " ORDER BY created_at DESC";
  const results = await db.getAllAsync<PurchaseRow>(query, params);
  return results.map(mapRowToLocalPurchase);
}

export async function updatePurchaseStatus(id: string, status: string, syncAction?: string) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE purchases SET status = ?, sync_action = ? WHERE id = ?",
      [status, syncAction, id]
    );
  } else {
    await db.runAsync(
      "UPDATE purchases SET status = ? WHERE id = ?",
      [status, id]
    );
  }
}

export async function deleteLocalPurchase(id: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM purchases WHERE id = ?", [id]);
}

export async function getPendingSyncPurchases(): Promise<LocalPurchase[]> {
  const db = getDb();
  const results = await db.getAllAsync<PurchaseRow>(
    "SELECT * FROM purchases WHERE sync_action != 'none' ORDER BY created_at ASC"
  );
  return results.map(mapRowToLocalPurchase);
}

// ─── Shops ───────────────────────────────────────────────────────────────────────

interface ShopRow {
  id: number;
  local_id: string | null;
  name: string | null;
  is_active: number | null;
  sync_action: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_synced_at: string | null;
}

// LocalShop extends Shop with offline-first sync metadata
export interface LocalShop extends Shop {
  local_id: string;
  status: "pending" | "synced" | "failed";
  sync_action: "none" | "create" | "update" | "delete";
  last_synced_at?: string;
}

function mapRowToLocalShop(r: ShopRow): LocalShop {
  return {
    id: r.id,
    name: r.name ?? "",
    is_active: !!r.is_active,
    local_id: r.local_id ?? "",
    status: (r.status as LocalShop["status"]) ?? "pending",
    sync_action: (r.sync_action as LocalShop["sync_action"]) ?? "none",
    created_at: r.created_at ?? "",
    last_synced_at: r.last_synced_at ?? undefined,
  };
}

export async function insertOrUpdateShop(shop: Shop, localId: string) {
  const db = getDb();

  const existing = await db.getFirstAsync<{ sync_action: string }>(
    "SELECT sync_action FROM shops WHERE id = ? OR local_id = ?",
    [shop.id, localId]
  );
  if (existing && existing.sync_action && existing.sync_action !== "none") {
    return;
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO shops (
      id, local_id, name, is_active,
      sync_action, status, created_at, updated_at, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      shop.id,
      localId,
      shop.name,
      shop.is_active ? 1 : 0,
      "none",
      "synced",
      shop.created_at || new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    ]
  );
}

/**
 * Batch upsert for delta-sync. Soft-deleted server records (deleted_at set)
 * are removed locally so the mobile catalogue stays consistent.
 */
export async function insertOrUpdateShops(shops: Array<Shop & { deleted_at?: string | null }>): Promise<void> {
  if (shops.length === 0) return;
  const db = getDb();

  await db.withTransactionAsync(async () => {
    for (const shop of shops) {
      if (shop.deleted_at) {
        await db.runAsync("DELETE FROM shops WHERE id = ?", [shop.id]);
        continue;
      }

      const existing = await db.getFirstAsync<{ sync_action: string }>(
        "SELECT sync_action FROM shops WHERE id = ?",
        [shop.id]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue;
      }

      await db.runAsync(
        `INSERT OR REPLACE INTO shops (
          id, local_id, name, is_active,
          sync_action, status, created_at, updated_at, last_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          shop.id,
          String(shop.id),
          shop.name,
          shop.is_active ? 1 : 0,
          "none",
          "synced",
          shop.created_at || new Date().toISOString(),
          shop.updated_at || new Date().toISOString(),
          new Date().toISOString(),
        ]
      );
    }
  });
}

export async function insertOrUpdateLocalShop(shop: Partial<Shop> & { id: number; name: string; is_active: boolean }, localId: string, syncAction: "create" | "update" | "delete" | "none") {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO shops (
        id, local_id, name, is_active,
        sync_action, status, created_at, updated_at, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shop.id,
        localId,
        shop.name,
        shop.is_active ? 1 : 0,
        syncAction,
        "pending",
        new Date().toISOString(),
        new Date().toISOString(),
        null,
      ]
    );

    if (syncAction !== "none") {
      const method = syncAction === "create" ? "POST"
        : syncAction === "update" ? "PATCH"
        : "DELETE";
      const path = syncAction === "create" ? "/shops" : `/shops/${shop.id}`;
      await queueSyncAction(
        method,
        path,
        { name: shop.name, is_active: shop.is_active, _local_id: localId },
        { "Idempotency-Key": `local-shop-${localId}` },
        `local-shop-${localId}`
      );
    }
  });
}

export async function getLocalShops(): Promise<LocalShop[]> {
  const db = getDb();
  const results = await db.getAllAsync<ShopRow>("SELECT * FROM shops ORDER BY name ASC");
  return results.map(mapRowToLocalShop);
}

export async function getLocalShopById(localIdOrNegId: string): Promise<LocalShop | null> {
  const db = getDb();
  const r = await db.getFirstAsync<ShopRow>(
    "SELECT * FROM shops WHERE local_id = ? OR (id = ? AND id < 0)",
    [localIdOrNegId, localIdOrNegId]
  );
  if (!r) return null;
  return mapRowToLocalShop(r);
}

export async function updateShopStatus(localId: string, status: string, syncAction?: string) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE shops SET status = ?, sync_action = ? WHERE local_id = ?",
      [status, syncAction, localId]
    );
  } else {
    await db.runAsync(
      "UPDATE shops SET status = ? WHERE local_id = ?",
      [status, localId]
    );
  }
}

export async function deleteLocalShop(localId: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM shops WHERE local_id = ?", [localId]);
}

export async function getPendingSyncShops(): Promise<LocalShop[]> {
  const db = getDb();
  const results = await db.getAllAsync<ShopRow>(
    "SELECT * FROM shops WHERE sync_action != 'none' ORDER BY created_at ASC"
  );
  return results.map(mapRowToLocalShop);
}

// ─── Dashboard Cache ──────────────────────────────────────────────────────────

const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function setDashboardCache(key: string, data: unknown) {
  const db = getDb();
  await db.runAsync(
    "INSERT OR REPLACE INTO dashboard_cache (key, data, fetched_at) VALUES (?, ?, ?)",
    [key, JSON.stringify(data), new Date().toISOString()]
  );
}

export async function getDashboardCache(key: string): Promise<{ data: unknown; fetched_at: string; stale?: boolean } | null> {
  const db = getDb();
  const r = await db.getFirstAsync<{ key: string; data: string; fetched_at: string }>(
    "SELECT * FROM dashboard_cache WHERE key = ?",
    [key]
  );
  if (!r) return null;
  try {
    const fetchedAt = new Date(r.fetched_at).getTime();
    const now = Date.now();
    const stale = (now - fetchedAt) > DASHBOARD_CACHE_TTL_MS;
    return { data: JSON.parse(r.data), fetched_at: r.fetched_at, stale };
  } catch {
    return null;
  }
}

// ─── Reports Cache ────────────────────────────────────────────────────────────

const REPORTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function setReportsCache(type: string, dateRange: string, data: unknown) {
  const db = getDb();
  const key = `${type}:${dateRange}`;
  await db.runAsync(
    "INSERT OR REPLACE INTO reports_cache (key, data, fetched_at) VALUES (?, ?, ?)",
    [key, JSON.stringify(data), new Date().toISOString()]
  );
}

export async function getReportsCache(type: string, dateRange: string): Promise<{ data: unknown; fetched_at: string; stale?: boolean } | null> {
  const db = getDb();
  const key = `${type}:${dateRange}`;
  const r = await db.getFirstAsync<{ key: string; data: string; fetched_at: string }>(
    "SELECT * FROM reports_cache WHERE key = ?",
    [key]
  );
  if (!r) return null;
  try {
    const fetchedAt = new Date(r.fetched_at).getTime();
    const now = Date.now();
    const stale = (now - fetchedAt) > REPORTS_CACHE_TTL_MS;
    return { data: JSON.parse(r.data), fetched_at: r.fetched_at, stale };
  } catch {
    return null;
  }
}

// ─── Notifications ───────────────────────────────────────────────────────────────

export interface LocalNotification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
  read: boolean;
  created_at: string;
}

export async function insertNotification(
  type: string,
  title: string,
  body: string | null = null,
  data: Record<string, unknown> | null = null
): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `INSERT INTO notifications (type, title, body, data, read, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [type, title, body, data ? JSON.stringify(data) : null, new Date().toISOString()]
  );
}

export async function getUnreadNotifications(): Promise<LocalNotification[]> {
  const db = getDb();
  const rows = await db.getAllAsync<any>(
    "SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT 50"
  );
  return rows.map(row => ({ ...row, read: !!row.read }));
}

export async function markNotificationsRead(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  await db.runAsync(`UPDATE notifications SET read = 1 WHERE id IN (${placeholders})`, ids);
}

// ─── Low Stock Notifications ───────────────────────────────────────────────────

export async function checkAndNotifyLowStock(shopId: number): Promise<void> {
  const db = getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT id, name, code, unit, stock_quantity, low_stock_alert
     FROM products
     WHERE shop_id = ?
       AND low_stock_alert IS NOT NULL
       AND low_stock_alert > 0
       AND stock_quantity <= low_stock_alert`,
    [shopId]
  );

  for (const p of rows) {
    const alreadySent = await hasLowStockAlertBeenSent(p.id, shopId);
    if (!alreadySent) {
      const title = `Мало товара: ${p.name}`;
      const body = `Остаток ${p.stock_quantity} ${p.unit ?? "шт"} при минимуме ${p.low_stock_alert}`;
      await insertNotification(
        "low_stock",
        title,
        body,
        { product_id: p.id, shop_id: shopId }
      );
      await markLowStockAlertSent(p.id, shopId);

      try {
        const { showLocalNotification } = await import("@/lib/notifications");
        await showLocalNotification(title, body, { product_id: p.id, shop_id: shopId });
      } catch {}
    }
  }
}

export async function hasLowStockAlertBeenSent(productId: string, shopId: number): Promise<boolean> {
  const db = getDb();
  const row = await db.getFirstAsync<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM low_stock_alerts_sent WHERE product_id = ? AND shop_id = ?",
    [productId, shopId]
  );
  return (row?.cnt ?? 0) > 0;
}

export async function markLowStockAlertSent(productId: string, shopId: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR IGNORE INTO low_stock_alerts_sent (product_id, shop_id, sent_at) VALUES (?, ?, ?)",
    [productId, shopId, new Date().toISOString()]
  );
}

export { initDb, clearLocalData };
