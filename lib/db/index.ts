import { getDb, initDb, clearLocalData } from "./schema";

// Product Queries
import { Product } from "@/lib/api";

export async function insertOrUpdateProducts(products: Product[]) {
  const db = getDb();
  await db.withTransactionAsync(async () => {
    for (const p of products) {
      await db.runAsync(
        `INSERT OR REPLACE INTO products (
          id, shop_id, name, code, unit, cost_price, sale_price, 
          bulk_price, bulk_threshold, stock_quantity, low_stock_alert, photo_url, updated_at, last_synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          p.id, p.shop_id, p.name, p.code, p.unit, p.cost_price, p.sale_price,
          p.bulk_price ?? null, p.bulk_threshold ?? null, p.stock_quantity, p.low_stock_alert ?? null, p.photo_url, p.updated_at, new Date().toISOString()
        ]
      );
    }
  });
}

export async function getLocalProducts(shop_id?: number, search?: string): Promise<Product[]> {
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
    ...r,
    cost_price: Number(r.cost_price),
    sale_price: Number(r.sale_price),
    bulk_price: r.bulk_price != null ? Number(r.bulk_price) : undefined,
    bulk_threshold: r.bulk_threshold != null ? Number(r.bulk_threshold) : undefined,
    stock_quantity: Number(r.stock_quantity),
    low_stock_alert: r.low_stock_alert != null ? Number(r.low_stock_alert) : undefined,
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
    bulk_price: r.bulk_price != null ? Number(r.bulk_price) : undefined,
    bulk_threshold: r.bulk_threshold != null ? Number(r.bulk_threshold) : undefined,
    stock_quantity: Number(r.stock_quantity),
    low_stock_alert: r.low_stock_alert != null ? Number(r.low_stock_alert) : undefined,
  };
}

export async function decrementLocalProductStock(id: number, quantity: number) {
  const db = getDb();
  await db.runAsync("UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?) WHERE id = ?", [quantity, id]);
}

// Queue Queries
export interface SyncAction {
  id: number;
  method: string;
  path: string;
  payload: string;
  headers: string | null;
  status: "pending" | "processing" | "failed";
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
    "SELECT * FROM sync_queue WHERE status = 'pending' OR status = 'failed' ORDER BY id ASC LIMIT 50"
  );
}

export async function markSyncActionStatus(id: number, status: "pending" | "processing" | "failed" | "completed", incrementRetry = false) {
  const db = getDb();
  if (status === "completed") {
    await db.runAsync("DELETE FROM sync_queue WHERE id = ?", [id]);
  } else {
    let query = "UPDATE sync_queue SET status = ?";
    if (incrementRetry) query += ", retries = retries + 1";
    query += " WHERE id = ?";
    await db.runAsync(query, [status, id]);
  }
}

export { initDb, clearLocalData };
