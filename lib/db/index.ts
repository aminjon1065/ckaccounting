import { getDb, initDb, clearLocalData } from "./schema";
export { getDb } from "./schema";

// Product Queries
import { Product, Debt, DebtTransaction, Sale, SaleItem, Expense, Purchase, PurchaseItem, Shop } from "@/lib/api";

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

export async function insertOrUpdateProducts(products: Product[], shopId?: number) {
  const db = getDb();

  // Lazy-load conflict utilities to avoid circular imports
  let detectConflict: (localId: string, entityType: "product", localData: Record<string, unknown>, serverData: Record<string, unknown>) => ReturnType<typeof import("../sync/ConflictContext").detectConflict>;
  let queueExternalConflict: (conflict: Exclude<ReturnType<typeof detectConflict>, null>) => void;

  try {
    const mod = await import("../sync/ConflictContext");
    detectConflict = mod.detectConflict;
    queueExternalConflict = mod.queueExternalConflict;
  } catch {
    // ConflictContext not available — skip conflict detection
    detectConflict = () => null;
    queueExternalConflict = () => {};
  }

  await db.withTransactionAsync(async () => {
    for (const p of products) {
      // Server tombstone: delete local record if deleted_at is set
      if ((p as any).deleted_at) {
        await db.runAsync(
          "DELETE FROM products WHERE id = ? OR local_id = ?",
          [p.id, (p as any).local_id ?? ""]
        );
        continue;
      }

      // Skip products with pending local changes — don't overwrite un-synced edits
      const existingLocalId = (p as any).local_id ?? "";
      const existing = await db.getFirstAsync<{ sync_action: string; stock_quantity: number; pending_stock_delta: number }>(
        "SELECT sync_action, stock_quantity, pending_stock_delta FROM products WHERE id = ? OR local_id = ?",
        [p.id, existingLocalId]
      );
      // If product has pending stock delta, merge server stock + local delta
      if (existing && existing.pending_stock_delta !== 0) {
        const serverStock = p.stock_quantity;
        const localDelta = existing.pending_stock_delta;
        // Only consume the delta if server stock confirms the sale happened
        // (i.e. server stock decreased by at least as much as our delta suggests).
        // If server didn't decrement (sale not yet processed), preserve delta.
        // merged_stock reflects the server's view after applying confirmed changes.
        const mergedStock = serverStock + localDelta;
        // We consume delta ONLY when server stock is consistent with the delta being
        // "confirmed" (server stock is lower than it would be without the sale).
        // If server stock is still high (sale not yet confirmed), keep delta pending.
        // Delta is consumed incrementally: compute how much of the delta is reflected
        // in the current server stock, then reduce pending_stock_delta accordingly.
        const confirmedDelta = localDelta < 0
          ? Math.min(0, serverStock - (mergedStock - localDelta)) // stock went down
          : 0; // positive delta: don't consume, it's from a cancelled/rejected sale
        const remainingDelta = localDelta - confirmedDelta;
        await db.runAsync(
          `INSERT OR REPLACE INTO products (
            id, local_id, shop_id, name, code, unit, cost_price, sale_price,
            pricing_mode, markup_percent, bulk_price, bulk_threshold, stock_quantity, low_stock_alert, photo_url, version, updated_at, last_synced_at, sync_action, status, pending_stock_delta
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            p.id, null, shopId ?? p.shop_id, p.name, p.code, p.unit, p.cost_price, p.sale_price,
            p.pricing_mode ?? "fixed", p.markup_percent ?? null, p.bulk_price ?? null, p.bulk_threshold ?? null,
            mergedStock,
            p.low_stock_alert ?? null, p.photo_url ?? p.image_url ?? null,
            (p as any).version ?? 1, p.updated_at, new Date().toISOString(), "none", "synced",
            remainingDelta,  // preserved so onSaleSyncSuccess can reconcile correctly
          ]
        );
        // Clear low-stock alert if stock is now above threshold
        if (p.stock_quantity > (p.low_stock_alert ?? 0)) {
          await db.runAsync(
            "DELETE FROM low_stock_alerts_sent WHERE product_id = ? AND shop_id = ?",
            [p.id, shopId ?? p.shop_id]
          );
        }
        continue;
      }
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        // Pending local change conflicts with server version — detect and surface
        const localRow = await db.getFirstAsync<Record<string, unknown>>(
          "SELECT * FROM products WHERE id = ? OR local_id = ?",
          [p.id, existingLocalId]
        );
        if (localRow) {
          const localData: Record<string, unknown> = { ...localRow };
          const serverData: Record<string, unknown> = {
            name: p.name, code: p.code, unit: p.unit,
            cost_price: p.cost_price, sale_price: p.sale_price,
            pricing_mode: p.pricing_mode, markup_percent: p.markup_percent,
            bulk_price: p.bulk_price, bulk_threshold: p.bulk_threshold,
            stock_quantity: p.stock_quantity, low_stock_alert: p.low_stock_alert,
            photo_url: p.photo_url ?? p.image_url,
            version: (p as any).version,
          };
          const conflict = detectConflict(
            String(existingLocalId || p.id),
            "product",
            localData,
            serverData
          );
          if (conflict) queueExternalConflict(conflict);
        }
        continue;
      }
      // Clear low-stock alert if stock is now above threshold (normal server sync)
      if (p.stock_quantity > (p.low_stock_alert ?? 0)) {
        await db.runAsync(
          "DELETE FROM low_stock_alerts_sent WHERE product_id = ? AND shop_id = ?",
          [p.id, shopId ?? p.shop_id]
        );
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO products (
          id, local_id, shop_id, name, code, unit, cost_price, sale_price,
          pricing_mode, markup_percent, bulk_price, bulk_threshold, stock_quantity, low_stock_alert, photo_url, version, updated_at, last_synced_at, sync_action, status, pending_stock_delta,
          cost_price_kopecks, sale_price_kopecks, bulk_price_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          p.id, null, shopId ?? p.shop_id, p.name, p.code, p.unit, p.cost_price, p.sale_price,
          p.pricing_mode ?? "fixed", p.markup_percent ?? null, p.bulk_price ?? null, p.bulk_threshold ?? null, p.stock_quantity, p.low_stock_alert ?? null, p.photo_url ?? p.image_url ?? null,
          (p as any).version ?? 1, p.updated_at, new Date().toISOString(), "none", "synced",
          toKopecks(p.cost_price), toKopecks(p.sale_price), toKopecks(p.bulk_price),
        ]
      );
    }
  });
}

export async function getLocalProducts(shop_id?: number, search?: string): Promise<LocalProduct[]> {
  const db = getDb();
  let query = "SELECT * FROM products";
  let params: any[] = [];

  if (shop_id && search) {
    query += " WHERE shop_id = ? AND (name LIKE ? OR code LIKE ?)";
    params = [shop_id, `%${search}%`, `%${search}%`];
  } else if (shop_id) {
    query += " WHERE shop_id = ?";
    params = [shop_id];
  } else if (search) {
    query += " WHERE name LIKE ? OR code LIKE ?";
    params = [`%${search}%`, `%${search}%`];
  }

  query += " ORDER BY name ASC";

  const results = await db.getAllAsync<any>(query, params);
  return results.map(r => ({
    id: r.id,
    shop_id: r.shop_id,
    name: r.name,
    code: r.code ?? null,
    unit: r.unit ?? null,
    // Prefer kopeck columns (integer minor units) over float columns for precision
    cost_price: r.cost_price_kopecks != null ? fromKopecks(r.cost_price_kopecks) : Number(r.cost_price),
    sale_price: r.sale_price_kopecks != null ? fromKopecks(r.sale_price_kopecks) : Number(r.sale_price),
    pricing_mode: r.pricing_mode ?? "fixed",
    markup_percent: r.markup_percent != null ? Number(r.markup_percent) : undefined,
    bulk_price: r.bulk_price_kopecks != null ? fromKopecks(r.bulk_price_kopecks) : (r.bulk_price != null ? Number(r.bulk_price) : undefined),
    bulk_threshold: r.bulk_threshold != null ? Number(r.bulk_threshold) : undefined,
    stock_quantity: Number(r.stock_quantity),
    low_stock_alert: r.low_stock_alert != null ? Number(r.low_stock_alert) : null,
    photo_url: r.photo_url ?? null,
    image_url: r.photo_url ?? null,
    created_at: r.created_at ?? r.updated_at,
    updated_at: r.updated_at,
    local_id: r.local_id ?? undefined,
    status: (r.status as LocalProduct["status"]) ?? "synced",
    sync_action: (r.sync_action as LocalProduct["sync_action"]) ?? "none",
    last_synced_at: r.last_synced_at ?? undefined,
  }));
}

export async function getLocalProductById(id: number): Promise<Product | null> {
  const db = getDb();
  const r = await db.getFirstAsync<any>("SELECT * FROM products WHERE id = ?", [id]);
  if (!r) return null;
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
  };
}

export async function decrementLocalProductStock(id: number, quantity: number) {
  const db = getDb();
  // Decrement stock optimistically AND track delta for sync
  // pending_stock_delta accumulates (multiple offline sales accumulate)
  await db.runAsync(
    "UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?), pending_stock_delta = pending_stock_delta - ? WHERE id = ?",
    [quantity, quantity, id]
  );
}

export async function incrementLocalProductStock(id: number, quantity: number) {
  const db = getDb();
  await db.runAsync("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [quantity, id]);
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

export async function onSaleSyncSuccess(productId: number, quantity: number): Promise<void> {
  // Incrementally cancel the delta — safe for parallel offline sales
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET pending_stock_delta = pending_stock_delta + ? WHERE id = ?",
    [quantity, productId]
  );
}

export async function cancelPendingStockDelta(productId: number, quantity: number): Promise<void> {
  // Server rejected / sale failed — restore stock_quantity AND cancel delta
  const db = getDb();
  await db.runAsync(
    "UPDATE products SET stock_quantity = stock_quantity + ?, pending_stock_delta = pending_stock_delta + ? WHERE id = ?",
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

// LocalProduct extends Product with offline-first sync metadata
export interface LocalProduct extends Product {
  local_id?: string;
  status?: "pending" | "synced" | "failed";
  sync_action?: "none" | "create" | "update" | "delete";
  last_synced_at?: string | null;
}

// Insert or update a single product (used for offline-created products)
export async function insertOrUpdateProduct(product: Product, localId?: string, syncAction = "none") {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO products (
        id, local_id, shop_id, name, code, unit, cost_price, sale_price,
        pricing_mode, markup_percent, bulk_price, bulk_threshold, stock_quantity,
        low_stock_alert, photo_url, version, updated_at, last_synced_at, sync_action, status,
        pending_stock_delta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        product.id, localId ?? null, product.shop_id, product.name, product.code,
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
      ]
    );

    if (syncAction !== "none") {
      await queueSyncAction(
        syncAction === "create" ? "POST" : "PATCH",
        syncAction === "create" ? "/products" : `/products/${product.id}`,
        {
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
          photo_url: product.photo_url,
          version: (product as any).version ?? 1,
          _local_id: localId,
        },
        { "Idempotency-Key": `local-prod-${localId}` },
        `local-prod-${localId}`
      );
    }
  });
}

export async function updateProductStatus(localId: string, status: string, syncAction?: string) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE products SET status = ?, sync_action = ? WHERE local_id = ?",
      [status, syncAction, localId]
    );
  } else {
    await db.runAsync("UPDATE products SET status = ? WHERE local_id = ?", [status, localId]);
  }
}

/**
 * Marks a product as deleted locally and queues a DELETE sync action.
 *
 * - Server-synced product (id > 0): updates sync_action='delete', queues DELETE /products/{id}.
 *   Uses id as fallback when local_id is NULL (server-synced rows have local_id=NULL).
 * - Local-only product (id < 0): cancels the pending CREATE from sync_queue (never sent to
 *   server) and physically deletes the local row.
 */
export async function markProductDeletedLocally(productId: number, localId?: string | null): Promise<void> {
  const db = getDb();

  if (productId > 0) {
    // Server product — mark dirty and queue DELETE
    if (localId) {
      await db.runAsync(
        "UPDATE products SET status = 'pending', sync_action = 'delete' WHERE local_id = ?",
        [localId]
      );
    } else {
      // local_id is NULL for server-synced rows; fall back to id
      await db.runAsync(
        "UPDATE products SET status = 'pending', sync_action = 'delete' WHERE id = ?",
        [productId]
      );
    }
    const idempKey = `local-prod-delete-${localId ?? productId}`;
    await queueSyncAction(
      "DELETE",
      `/products/${productId}`,
      {},
      { "Idempotency-Key": idempKey },
      idempKey
    );
  } else {
    // Local-only product — cancel pending CREATE from sync_queue, then delete locally
    await db.runAsync(
      "DELETE FROM sync_queue WHERE path = ? AND method = 'POST'",
      [`/products/${productId}`]
    );
    await db.runAsync("DELETE FROM products WHERE id = ?", [productId]);
  }
}

export async function getPendingSyncProducts(): Promise<LocalProduct[]> {
  const db = getDb();
  const results = await db.getAllAsync<any>(
    "SELECT * FROM products WHERE sync_action != 'none' ORDER BY rowid ASC"
  );
  return results.map(r => ({
    ...r,
    id: r.id,
    shop_id: r.shop_id,
    name: r.name,
    code: r.code ?? null,
    unit: r.unit ?? null,
    cost_price: Number(r.cost_price),
    sale_price: Number(r.sale_price),
    pricing_mode: r.pricing_mode ?? "fixed",
    markup_percent: r.markup_percent != null ? Number(r.markup_percent) : undefined,
    bulk_price: r.bulk_price != null ? Number(r.bulk_price) : undefined,
    bulk_threshold: r.bulk_threshold != null ? Number(r.bulk_threshold) : undefined,
    stock_quantity: Number(r.stock_quantity),
    low_stock_alert: r.low_stock_alert != null ? Number(r.low_stock_alert) : null,
    photo_url: r.photo_url ?? null,
    image_url: r.photo_url ?? null,
    created_at: r.created_at ?? r.updated_at,
    updated_at: r.updated_at,
    local_id: r.local_id ?? undefined,
    status: (r.status as LocalProduct["status"]) ?? "pending",
    sync_action: (r.sync_action as LocalProduct["sync_action"]) ?? "none",
    last_synced_at: r.last_synced_at ?? undefined,
  }));
}

export async function deleteLocalProduct(localId: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM products WHERE local_id = ?", [localId]);
}

// Debt Queries
export async function insertOrUpdateDebts(debts: Debt[], shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const d of debts) {
      // Server tombstone: delete local record if deleted_at is set
      if ((d as any).deleted_at) {
        await db.runAsync(
          "DELETE FROM debts WHERE id = ? OR local_id = ?",
          [d.id, (d as any).local_id ?? ""]
        );
        continue;
      }

      // Skip if a local pending debt (never synced to server) already exists.
      // This prevents server sync from overwriting unsent local changes.
      const existing = await db.getFirstAsync<{ sync_action: string; local_id: string | null }>(
        "SELECT sync_action, local_id FROM debts WHERE id = ? OR local_id = ?",
        [d.id, (d as any).local_id ?? ""]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        // Local pending change takes priority — don't overwrite
        continue;
      }

      // Preserve existing local_id if any; local offline-created debts provide one.
      const incomingLocalId = (d as any).local_id ?? null;
      const existingLocalId = existing?.local_id ?? incomingLocalId;
      const incomingSyncAction = (d as any).sync_action ?? "none";
      await db.runAsync(
        `INSERT OR REPLACE INTO debts (
          id, local_id, shop_id, person_name, opening_balance, balance, direction, updated_at, last_synced_at,
          opening_balance_kopecks, balance_kopecks, sync_action
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          d.id, existingLocalId, shopId ?? null, d.person_name, d.opening_balance ?? 0, d.balance,
          d.direction ?? "receivable", d.updated_at, new Date().toISOString(),
          toKopecks(d.opening_balance ?? 0), toKopecks(d.balance), incomingSyncAction,
        ]
      );
      if (d.transactions) {
        for (const tx of d.transactions) {
          const txLocalId = (tx as any).local_id ?? null;
          // Check for pending local transaction before replacing.
          // FIX: guard against NULL local_id to avoid matching unrelated rows.
          const existingTx = await db.getFirstAsync<{ sync_action: string }>(
            "SELECT sync_action FROM debt_transactions WHERE id = ? OR (local_id IS NOT NULL AND local_id = ?)",
            [tx.id, txLocalId ?? ""]
          );
          if (existingTx && existingTx.sync_action && existingTx.sync_action !== "none") {
            continue; // preserve local pending transaction
          }
          await db.runAsync(
            `INSERT OR REPLACE INTO debt_transactions (
              id, local_id, debt_id, type, amount, note, created_at, amount_kopecks, sync_action
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [tx.id, txLocalId, tx.debt_id, tx.type, tx.amount, tx.note ?? null, tx.created_at, toKopecks(tx.amount), "none"]
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
      const txLocalId = (tx as any).local_id ?? null;
      // Skip if a local pending transaction (never synced) already exists
      const existing = await db.getFirstAsync<{ sync_action: string }>(
        "SELECT sync_action FROM debt_transactions WHERE id = ? OR (local_id IS NOT NULL AND local_id = ?)",
        [tx.id, txLocalId ?? ""]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue; // preserve local pending transaction
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO debt_transactions (
          id, local_id, debt_id, type, amount, note, created_at, amount_kopecks, sync_action
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tx.id, txLocalId, tx.debt_id, tx.type, tx.amount, tx.note ?? null, tx.created_at, toKopecks(tx.amount), "none"]
      );
    }
  });
}

export async function getLocalDebts(shop_id?: number): Promise<Debt[]> {
  const db = getDb();
  let query = "SELECT * FROM debts";
  const params: any[] = [];
  if (shop_id) {
    query += " WHERE shop_id = ? OR shop_id IS NULL";
    params.push(shop_id);
  }
  query += " ORDER BY updated_at DESC";
  
  const results = await db.getAllAsync<any>(query, params);
  return results.map(r => ({
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
    created_at: r.created_at ?? r.updated_at,
    updated_at: r.updated_at,
  }));
}

export async function getLocalDebtById(id: number): Promise<Debt | null> {
  const db = getDb();
  // FIX: also search by local_id (string version of the tempId) so that after sync
  // — when the debt's `id` column is overwritten with the real server id — navigation
  // using the old tempId still resolves correctly.
  const r = await db.getFirstAsync<any>(
    "SELECT * FROM debts WHERE id = ? OR local_id = ?",
    [id, String(id)]
  );
  if (!r) return null;
  
  const txs = await getLocalDebtTransactions(id);
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

export async function getLocalDebtTransactions(debt_id: number): Promise<DebtTransaction[]> {
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

  // Atomic claim: mark rows as 'processing' with batch_id atomically
  await db.runAsync(
    `UPDATE sync_queue
     SET status = 'processing', batch_id = ?
     WHERE id IN (
       SELECT id FROM sync_queue
       WHERE status IN ('pending', 'failed') AND retries < 5
       ORDER BY id ASC
       LIMIT ?
     )`,
    [batchId, batchSize]
  );

  // Fetch all actions with this batch_id (only the ones we just claimed)
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
    await db.runAsync("DELETE FROM sync_queue WHERE id = ?", [id]);
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

/** Archive all sync queue rows matching the given status filter. */
export async function archiveSyncActions(statusFilter: string): Promise<void> {
  const db = getDb();
  await db.runAsync(
    `UPDATE sync_queue SET archived_at = ? WHERE archived_at IS NULL AND status IN (${statusFilter})`,
    [new Date().toISOString()]
  );
}

// Sale item stored as JSON in the items column
interface SaleRow {
  id: number;
  local_id: string;
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
  local_id: string;
  shop_id?: number;
  user_id?: number;
  status: "pending" | "synced" | "failed";
  sync_action: "none" | "create" | "update" | "delete";
  last_synced_at?: string | null;
}

async function getSaleItemsForLocalId(localId: string): Promise<SaleItem[]> {
  if (!localId) return [];
  const db = getDb();
  const rows = await db.getAllAsync<{
    id: number; product_id: number | null; product_name: string | null;
    unit: string | null; quantity: number; unit_price: number; total: number;
    unit_price_kopecks: number | null; total_kopecks: number | null;
  }>(
    "SELECT id, product_id, product_name, unit, quantity, unit_price, total, unit_price_kopecks, total_kopecks FROM sale_items WHERE sale_local_id = ?",
    [localId]
  );
  return rows.map((row) => ({
    id: row.id,
    product_id: row.product_id,
    product_name: row.product_name,
    unit: row.unit ?? undefined,
    quantity: row.quantity,
    // Prefer kopeck columns for precision
    price: row.unit_price_kopecks != null ? fromKopecks(row.unit_price_kopecks) : row.unit_price,
    total: row.total_kopecks != null ? fromKopecks(row.total_kopecks) : row.total,
  }));
}

async function mapRowToSale(r: SaleRow): Promise<Sale> {
  const items = await getSaleItemsForLocalId(r.local_id);
  // Fallback: parse items JSON when sale_items table is empty (remote-synced sales)
  const saleItems = items.length > 0 ? items : parseSaleItemsJson(r.items);
  return {
    id: r.id,
    type: r.type as Sale["type"],
    customer_name: r.customer_name,
    // Prefer kopeck columns for precision
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
    local_id: r.local_id,
    shop_id: r.shop_id ?? undefined,
    user_id: r.user_id ?? undefined,
    status: r.status as LocalSale["status"],
    sync_action: r.sync_action as LocalSale["sync_action"],
    last_synced_at: r.last_synced_at ?? undefined,
  };
}

export async function insertOrUpdateSale(sale: Sale, localId: string, shopId?: number, userId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO sales (
        id, local_id, shop_id, user_id, customer_name, type, total, discount, paid, debt,
        payment_type, notes, items, status, sync_action, created_at, updated_at, last_synced_at,
        total_kopecks, discount_kopecks, paid_kopecks, debt_kopecks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sale.id,
        localId,
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

    // Write sale items to normalized sale_items table for queryability
    await db.runAsync("DELETE FROM sale_items WHERE sale_local_id = ?", [localId]);
    const now = new Date().toISOString();
    for (const item of sale.items ?? []) {
      await db.runAsync(
        `INSERT INTO sale_items (sale_local_id, product_id, product_name, quantity, unit_price, total, created_at, unit_price_kopecks, total_kopecks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          localId,
          item.product_id ?? null,
          item.product_name ?? item.name ?? "",
          item.quantity,
          item.price,
          item.total,
          now,
          toKopecks(item.price),
          toKopecks(item.total),
        ]
      );
    }

    // Queue for sync — the sync_queue loop handles HTTP replay with FIFO ordering
    await queueSyncAction(
      "POST",
      "/sales",
      {
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
        _local_id: localId,
      },
      { "Idempotency-Key": `local-${localId}` },
      `local-${localId}`
    );

    // Invalidate dashboard cache so next load fetches fresh data
    await db.runAsync("DELETE FROM dashboard_cache");
  });
}

export async function insertOrUpdateRemoteSales(sales: Sale[], shopId?: number): Promise<void> {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const sale of sales) {
      // Server tombstone: delete local record if deleted_at is set
      if ((sale as any).deleted_at) {
        await db.runAsync(
          "DELETE FROM sales WHERE id = ? OR local_id = ?",
          [sale.id, String(sale.id)]
        );
        continue;
      }
      // INSERT OR IGNORE: never overwrite a locally pending sale (sync_action != 'none')
      const existing = await db.getFirstAsync<{ sync_action: string; local_id: string | null }>(
        "SELECT sync_action, local_id FROM sales WHERE id = ? OR local_id = ?",
        [sale.id, String(sale.id)]
      );
      if (existing && existing.sync_action !== "none") {
        continue; // skip — local changes pending, will sync separately
      }
      const saleLocalId = existing?.local_id ?? String(sale.id);
      await db.runAsync(
        `INSERT OR REPLACE INTO sales (
          id, local_id, shop_id, user_id, customer_name, type, total, discount, paid, debt,
          payment_type, notes, items, status, sync_action, created_at, updated_at, last_synced_at,
          total_kopecks, discount_kopecks, paid_kopecks, debt_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sale.id,
          saleLocalId,
          shopId ?? null,
          null,
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

      // Populate sale_items from the server's items JSON so mapRowToSale never returns empty
      await db.runAsync("DELETE FROM sale_items WHERE sale_local_id = ?", [saleLocalId]);
      const now = new Date().toISOString();
      for (const item of sale.items ?? []) {
        await db.runAsync(
          `INSERT INTO sale_items (sale_local_id, product_id, product_name, quantity, unit_price, total, created_at, unit_price_kopecks, total_kopecks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            saleLocalId,
            item.product_id ?? null,
            item.product_name ?? item.name ?? "",
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

export async function getLocalSales(shopId?: number): Promise<LocalSale[]> {
  const db = getDb();
  let query = "SELECT * FROM sales";
  const params: any[] = [];
  if (shopId !== undefined) {
    query += " WHERE shop_id = ?";
    params.push(shopId);
  }
  query += " ORDER BY created_at DESC";
  const results = await db.getAllAsync<SaleRow>(query, params);

  if (results.length === 0) return [];

  // Batch-fetch all sale_items for these sales in 1 query instead of N
  const saleLocalIds = results.map(r => r.local_id).filter(Boolean);
  const allItems = saleLocalIds.length > 0
    ? await db.getAllAsync<{
        sale_local_id: string; id: number; product_id: number | null;
        product_name: string | null; unit: string | null;
        quantity: number; unit_price: number; total: number;
      }>(
        `SELECT sale_local_id, id, product_id, product_name, unit, quantity, unit_price, total
         FROM sale_items WHERE sale_local_id IN (${saleLocalIds.map(() => "?").join(", ")})`,
        saleLocalIds
      )
    : [];

  // Group items by sale_local_id in memory
  const itemsBySale = new Map<string, SaleItem[]>();
  for (const item of allItems) {
    const list = itemsBySale.get(item.sale_local_id) ?? [];
    list.push({
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name,
      unit: item.unit ?? undefined,
      quantity: item.quantity,
      price: item.unit_price,
      total: item.total,
    });
    itemsBySale.set(item.sale_local_id, list);
  }

  // Fallback items JSON parse for any sales missing from sale_items
  const fallbackItemsJson = new Map<string, SaleItem[]>();

  return results.map(r => ({
    id: r.id,
    type: r.type as Sale["type"],
    customer_name: r.customer_name,
    total: r.total ?? 0,
    discount: r.discount ?? 0,
    paid: r.paid ?? 0,
    debt: r.debt ?? 0,
    payment_type: (r.payment_type as Sale["payment_type"]) ?? "cash",
    notes: r.notes ?? undefined,
    items: itemsBySale.get(r.local_id) ?? fallbackItemsJson.get(r.local_id) ?? parseSaleItemsJson(r.items),
    created_at: r.created_at,
    updated_at: r.updated_at,
    local_id: r.local_id,
    shop_id: r.shop_id ?? undefined,
    user_id: r.user_id ?? undefined,
    status: (r.status as LocalSale["status"]) ?? "synced",
    sync_action: (r.sync_action as LocalSale["sync_action"]) ?? "none",
    last_synced_at: r.last_synced_at ?? undefined,
  }));
}

export async function getLocalSaleById(localIdOrNegId: string): Promise<LocalSale | null> {
  const db = getDb();
  // Also check `id` column for negative local ids (stored as id, not local_id)
  const r = await db.getFirstAsync<SaleRow>(
    "SELECT * FROM sales WHERE local_id = ? OR (id = ? AND id < 0)",
    [localIdOrNegId, localIdOrNegId]
  );
  if (!r) return null;
  return await mapRowToLocalSale(r);
}

export async function updateSaleStatus(
  localId: string,
  status: string,
  syncAction?: string
) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE sales SET status = ?, sync_action = ? WHERE local_id = ?",
      [status, syncAction, localId]
    );
  } else {
    await db.runAsync(
      "UPDATE sales SET status = ? WHERE local_id = ?",
      [status, localId]
    );
  }
}

export async function deleteLocalSale(localId: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM sales WHERE local_id = ?", [localId]);
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
  id: number;
  local_id: string;
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
  local_id: string;
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
    // Prefer kopeck columns for precision
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
    local_id: r.local_id,
    shop_id: r.shop_id ?? undefined,
    user_id: r.user_id ?? undefined,
    status: r.status as LocalExpense["status"],
    sync_action: r.sync_action as LocalExpense["sync_action"],
    last_synced_at: r.last_synced_at ?? undefined,
  };
}

export async function insertOrUpdateExpense(expense: Expense, localId: string, shopId?: number, userId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO expenses (
        id, local_id, shop_id, user_id, name, quantity, price, total, note,
        status, sync_action, created_at, updated_at, last_synced_at,
        price_kopecks, total_kopecks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        expense.id,
        localId,
        shopId ?? null,
        userId ?? null,
        expense.name,
        expense.quantity,
        expense.price,
        expense.total,
        expense.note ?? null,
        "pending",
        "create",
        expense.created_at ?? new Date().toISOString(),
        expense.updated_at ?? new Date().toISOString(),
        null,
        toKopecks(expense.price), toKopecks(expense.total),
      ]
    );

    await queueSyncAction(
      "POST",
      "/expenses",
      {
        name: expense.name,
        quantity: expense.quantity,
        price: expense.price,
        note: expense.note,
        shop_id: shopId,
        _local_id: localId,
      },
      { "Idempotency-Key": `local-exp-${localId}` },
      `local-exp-${localId}`
    );

    // Invalidate dashboard cache so next load fetches fresh data
    await db.runAsync("DELETE FROM dashboard_cache");
  });
}

export async function getLocalExpenses(shopId?: number): Promise<LocalExpense[]> {
  const db = getDb();
  let query = "SELECT * FROM expenses";
  const params: any[] = [];
  if (shopId) {
    query += " WHERE shop_id = ?";
    params.push(shopId);
  }
  query += " ORDER BY created_at DESC";
  const results = await db.getAllAsync<ExpenseRow>(query, params);
  return results.map(mapRowToLocalExpense);
}

export async function updateExpenseStatus(localId: string, status: string, syncAction?: string) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE expenses SET status = ?, sync_action = ? WHERE local_id = ?",
      [status, syncAction, localId]
    );
  } else {
    await db.runAsync(
      "UPDATE expenses SET status = ? WHERE local_id = ?",
      [status, localId]
    );
  }
}

export async function deleteLocalExpense(localId: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM expenses WHERE local_id = ?", [localId]);
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
      // Skip if a local pending expense (never synced to server) already exists.
      const existing = await db.getFirstAsync<{ sync_action: string; local_id: string | null }>(
        "SELECT sync_action, local_id FROM expenses WHERE id = ? OR local_id = ?",
        [e.id, (e as any).local_id ?? ""]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue; // preserve local pending expense
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO expenses (
          id, local_id, shop_id, user_id, name, quantity, price, total, note,
          status, sync_action, created_at, updated_at, last_synced_at,
          price_kopecks, total_kopecks
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id, existing?.local_id ?? null, shopId ?? null, null, e.name, e.quantity, e.price, e.total,
          e.note ?? null, "synced", "none", e.created_at, e.updated_at, new Date().toISOString(),
          toKopecks(e.price), toKopecks(e.total),
        ]
      );
    }
  });
}

// ─── Purchases ──────────────────────────────────────────────────────────────────

interface PurchaseRow {
  id: number;
  local_id: string | null;
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
  local_id: string;
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
    // Prefer kopeck column for precision
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
    local_id: r.local_id ?? "",
    shop_id: r.shop_id ?? undefined,
    status: (r.status as LocalPurchase["status"]) ?? "pending",
    sync_action: (r.sync_action as LocalPurchase["sync_action"]) ?? "none",
    last_synced_at: r.last_synced_at ?? undefined,
  };
}

export async function insertOrUpdatePurchase(purchase: Purchase, localId: string, shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR REPLACE INTO purchases (
        id, local_id, shop_id, supplier_name, total, items,
        status, sync_action, created_at, updated_at, last_synced_at,
        total_kopecks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        purchase.id,
        localId,
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
        supplier_name: purchase.supplier_name,
        items: purchase.items,
        shop_id: shopId,
        _local_id: localId,
      },
      { "Idempotency-Key": `local-pur-${localId}` },
      `local-pur-${localId}`
    );

    // Invalidate dashboard cache so next load fetches fresh data
    await db.runAsync("DELETE FROM dashboard_cache");
  });
}

export async function getLocalPurchases(): Promise<LocalPurchase[]> {
  const db = getDb();
  const results = await db.getAllAsync<PurchaseRow>("SELECT * FROM purchases ORDER BY created_at DESC");
  return results.map(mapRowToLocalPurchase);
}

export async function updatePurchaseStatus(localId: string, status: string, syncAction?: string) {
  const db = getDb();
  if (syncAction !== undefined) {
    await db.runAsync(
      "UPDATE purchases SET status = ?, sync_action = ? WHERE local_id = ?",
      [status, syncAction, localId]
    );
  } else {
    await db.runAsync(
      "UPDATE purchases SET status = ? WHERE local_id = ?",
      [status, localId]
    );
  }
}

export async function deleteLocalPurchase(localId: string) {
  const db = getDb();
  await db.runAsync("DELETE FROM purchases WHERE local_id = ?", [localId]);
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

  // Skip if a local pending shop (never synced) already exists — don't overwrite local changes.
  const existing = await db.getFirstAsync<{ sync_action: string }>(
    "SELECT sync_action FROM shops WHERE id = ? OR local_id = ?",
    [shop.id, localId]
  );
  if (existing && existing.sync_action && existing.sync_action !== "none") {
    return; // preserve local pending shop
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

// ─── Low Stock Alerts ────────────────────────────────────────────────────────────

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

      // Show push notification on mobile
      try {
        const { showLocalNotification } = await import("@/lib/notifications");
        await showLocalNotification(title, body, { product_id: p.id, shop_id: shopId });
      } catch {}
    }
  }
}

export async function hasLowStockAlertBeenSent(productId: number, shopId: number): Promise<boolean> {
  const db = getDb();
  const row = await db.getFirstAsync<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM low_stock_alerts_sent WHERE product_id = ? AND shop_id = ?",
    [productId, shopId]
  );
  return (row?.cnt ?? 0) > 0;
}

export async function markLowStockAlertSent(productId: number, shopId: number): Promise<void> {
  const db = getDb();
  await db.runAsync(
    "INSERT OR IGNORE INTO low_stock_alerts_sent (product_id, shop_id, sent_at) VALUES (?, ?, ?)",
    [productId, shopId, new Date().toISOString()]
  );
}

export { initDb, clearLocalData };
