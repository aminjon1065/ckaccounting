import * as SQLite from "expo-sqlite";

export const dbName = "ckaccounting.db";

export function getDb() {
  return SQLite.openDatabaseSync(dbName);
}

export async function initDb() {
  const db = getDb();
  
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      shop_id INTEGER,
      name TEXT NOT NULL,
      code TEXT,
      unit TEXT,
      cost_price REAL NOT NULL,
      sale_price REAL NOT NULL,
      bulk_price REAL,
      bulk_threshold INTEGER,
      stock_quantity REAL NOT NULL,
      low_stock_alert REAL,
      photo_url TEXT,
      updated_at TEXT,
      last_synced_at TEXT
    );

    DROP TABLE IF EXISTS sync_queue;
    CREATE TABLE sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      payload TEXT,
      headers TEXT,
      status TEXT DEFAULT 'pending',
      retries INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
}

export async function clearLocalData() {
  const db = getDb();
  await db.execAsync(`
    DELETE FROM products;
    DELETE FROM sync_queue;
  `);
}
