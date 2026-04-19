import { getDb, initDb, clearLocalData } from "./schema";

// Product Queries
import { Product, Debt, DebtTransaction, Sale, SaleItem, Expense, Purchase, PurchaseItem, Shop } from "@/lib/api";

export async function insertOrUpdateProducts(products: Product[], shopId?: number) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const p of products) {
      // Skip products with pending local changes — don't overwrite un-synced edits
      const existing = await db.getFirstAsync<{ sync_action: string }>(
        "SELECT sync_action FROM products WHERE id = ? OR local_id = ?",
        [p.id, p.local_id ?? ""]
      );
      if (existing && existing.sync_action && existing.sync_action !== "none") {
        continue;
      }
      await db.runAsync(
        `INSERT OR REPLACE INTO products (
          id, local_id, shop_id, name, code, unit, cost_price, sale_price,
          pricing_mode, markup_percent, bulk_price, bulk_threshold, stock_quantity, low_stock_alert, photo_url, updated_at, last_synced_at, sync_action, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id, null, shopId ?? p.shop_id, p.name, p.code, p.unit, p.cost_price, p.sale_price,
          p.pricing_mode ?? "fixed", p.markup_percent ?? null, p.bulk_price ?? null, p.bulk_threshold ?? null, p.stock_quantity, p.low_stock_alert ?? null, p.photo_url ?? p.image_url ?? null, p.updated_at, new Date().toISOString(), "none", "synced"
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
    cost_price: Number(r.cost_price),
    sale_price: Number(r.sale_price),
    pricing_mode: r.pricing_mode ?? "fixed",
    markup_percent: r.markup_percent != null ? Number(r.markup_percent) : undefined,
    bulk_price: r.bulk_price != null ? Number(r.bulk_price) : undefined,
    bulk_threshold: r.bulk_threshold != null ? Number(r.bulk_threshold) : undefined,
    stock_quantity: Number(r.stock_quantity),
    low_stock_alert: r.low_stock_alert != null ? Number(r.low_stock_alert) : null,
  };
}

export async function decrementLocalProductStock(id: number, quantity: number) {
  const db = getDb();
  await db.runAsync("UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?) WHERE id = ?", [quantity, id]);
}

export async function incrementLocalProductStock(id: number, quantity: number) {
  const db = getDb();
  await db.runAsync("UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?", [quantity, id]);
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
        low_stock_alert, photo_url, updated_at, last_synced_at, sync_action, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product.id, localId ?? null, product.shop_id, product.name, product.code,
        product.unit, product.cost_price, product.sale_price,
        product.pricing_mode ?? "fixed",
        product.markup_percent ?? null, product.bulk_price ?? null,
        product.bulk_threshold ?? null, product.stock_quantity,
        product.low_stock_alert ?? null, product.photo_url ?? product.image_url ?? null,
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
          _local_id: localId,
        },
        { "Idempotency-Key": `local-prod-${localId}` }
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
      await db.runAsync(
        `INSERT OR REPLACE INTO debts (
          id, shop_id, person_name, opening_balance, balance, direction, updated_at, last_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          d.id, shopId ?? null, d.person_name, d.opening_balance ?? 0, d.balance,
          d.direction ?? "receivable", d.updated_at, new Date().toISOString()
        ]
      );
      if (d.transactions) {
        for (const tx of d.transactions) {
          await db.runAsync(
            `INSERT OR REPLACE INTO debt_transactions (
              id, debt_id, type, amount, note, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [tx.id, tx.debt_id, tx.type, tx.amount, tx.note ?? null, tx.created_at]
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
      await db.runAsync(
        `INSERT OR REPLACE INTO debt_transactions (
          id, debt_id, type, amount, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [tx.id, tx.debt_id, tx.type, tx.amount, tx.note ?? null, tx.created_at]
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
    opening_balance: Number(r.opening_balance),
    balance: Number(r.balance),
    direction: r.direction ?? "receivable",
    created_at: r.created_at ?? r.updated_at,
    updated_at: r.updated_at,
  }));
}

export async function getLocalDebtById(id: number): Promise<Debt | null> {
  const db = getDb();
  const r = await db.getFirstAsync<any>("SELECT * FROM debts WHERE id = ?", [id]);
  if (!r) return null;
  
  const txs = await getLocalDebtTransactions(id);
  return {
    id: r.id,
    person_name: r.person_name,
    opening_balance: Number(r.opening_balance),
    balance: Number(r.balance),
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
    amount: Number(r.amount),
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
  status: "pending" | "processing" | "failed" | "dead";
  retries: number;
  created_at: string;
}

export async function queueSyncAction(method: string, path: string, payload: any, headers?: Record<string, string>) {
  const db = getDb();
  await db.runAsync(
    "INSERT INTO sync_queue (method, path, payload, headers, created_at) VALUES (?, ?, ?, ?, ?)",
    [
      method, 
      path, 
      typeof payload === 'string' ? payload : JSON.stringify(payload), 
      headers ? JSON.stringify(headers) : null,
      new Date().toISOString()
    ]
  );
}

export async function getPendingSyncActions(): Promise<SyncAction[]> {
  const db = getDb();
  return await db.getAllAsync<SyncAction>(
    "SELECT * FROM sync_queue WHERE status IN ('pending', 'failed') ORDER BY id ASC LIMIT 50"
  );
}

export async function getPendingSyncActionsCount(): Promise<number> {
  const db = getDb();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE status IN ('pending', 'failed')"
  );

  return Number(result?.count ?? 0);
}

export async function getDeadSyncActionsCount(): Promise<number> {
  const db = getDb();
  const result = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue WHERE status = 'dead'"
  );

  return Number(result?.count ?? 0);
}

export async function markSyncActionStatus(id: number, status: "pending" | "processing" | "failed" | "completed" | "dead", incrementRetry = false) {
  const db = getDb();
  if (status === "completed") {
    await db.runAsync("DELETE FROM sync_queue WHERE id = ?", [id]);
  } else if (status === "dead") {
    await db.runAsync("UPDATE sync_queue SET status = 'dead' WHERE id = ?", [id]);
  } else {
    let query = "UPDATE sync_queue SET status = ?";
    if (incrementRetry) {
      query += ", retries = retries + 1";
      // Move to dead after 5 retries
      query = `UPDATE sync_queue SET status = CASE WHEN retries >= 4 THEN 'dead' ELSE ? END, retries = retries + 1 WHERE id = ?`;
      await db.runAsync(query, [status, id]);
      return;
    }
    query += " WHERE id = ?";
    await db.runAsync(query, [status, id]);
  }
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

function mapRowToSale(r: SaleRow): Sale {
  let items: SaleItem[] = [];
  try {
    items = JSON.parse(r.items || "[]");
  } catch {}
  return {
    id: r.id,
    type: r.type as Sale["type"],
    customer_name: r.customer_name,
    total: r.total ?? 0,
    discount: r.discount ?? 0,
    paid: r.paid ?? 0,
    debt: r.debt ?? 0,
    payment_type: (r.payment_type as Sale["payment_type"]) ?? "cash",
    notes: r.notes ?? undefined,
    items,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function mapRowToLocalSale(r: SaleRow): LocalSale {
  const base = mapRowToSale(r);
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
        payment_type, notes, items, status, sync_action, created_at, updated_at, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ]
    );

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
      { "Idempotency-Key": `local-${localId}` }
    );
  });
}

export async function getLocalSales(): Promise<LocalSale[]> {
  const db = getDb();
  const results = await db.getAllAsync<SaleRow>("SELECT * FROM sales ORDER BY created_at DESC");
  return results.map(mapRowToLocalSale);
}

export async function getLocalSaleById(localIdOrNegId: string): Promise<LocalSale | null> {
  const db = getDb();
  // Also check `id` column for negative local ids (stored as id, not local_id)
  const r = await db.getFirstAsync<SaleRow>(
    "SELECT * FROM sales WHERE local_id = ? OR (id = ? AND id < 0)",
    [localIdOrNegId, localIdOrNegId]
  );
  if (!r) return null;
  return mapRowToLocalSale(r);
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
  return results.map(mapRowToLocalSale);
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
    price: r.price ?? 0,
    total: r.total ?? 0,
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
        status, sync_action, created_at, updated_at, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      { "Idempotency-Key": `local-exp-${localId}` }
    );
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
      await db.runAsync(
        `INSERT OR REPLACE INTO expenses (
          id, local_id, shop_id, user_id, name, quantity, price, total, note,
          status, sync_action, created_at, updated_at, last_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id, null, shopId ?? null, null, e.name, e.quantity, e.price, e.total,
          e.note ?? null, "synced", "none", e.created_at, e.updated_at, new Date().toISOString()
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
    total: r.total ?? 0,
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
        status, sync_action, created_at, updated_at, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      { "Idempotency-Key": `local-pur-${localId}` }
    );
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

export async function insertOrUpdateLocalShop(shop: Partial<Shop> & { id: number; name: string; is_active: boolean }, localId: string, syncAction: "create" | "update" | "delete") {
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
        { "Idempotency-Key": `local-shop-${localId}` }
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
