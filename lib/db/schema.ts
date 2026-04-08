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
      pricing_mode TEXT DEFAULT 'fixed',
      markup_percent REAL,
      bulk_price REAL,
      bulk_threshold INTEGER,
      stock_quantity REAL NOT NULL,
      low_stock_alert REAL,
      photo_url TEXT,
      updated_at TEXT,
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      payload TEXT,
      headers TEXT,
      status TEXT DEFAULT 'pending',
      retries INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS debts (
      id INTEGER PRIMARY KEY,
      shop_id INTEGER,
      person_name TEXT NOT NULL,
      opening_balance REAL DEFAULT 0,
      balance REAL DEFAULT 0,
      direction TEXT DEFAULT 'receivable',
      updated_at TEXT,
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS debt_transactions (
      id INTEGER PRIMARY KEY,
      debt_id INTEGER,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      note TEXT,
      created_at TEXT
    );
  `);

  const productColumns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(products)");
  const existingProductColumns = new Set(productColumns.map((column) => column.name));

  if (!existingProductColumns.has("pricing_mode")) {
    await db.execAsync("ALTER TABLE products ADD COLUMN pricing_mode TEXT DEFAULT 'fixed';");
  }

  if (!existingProductColumns.has("markup_percent")) {
    await db.execAsync("ALTER TABLE products ADD COLUMN markup_percent REAL;");
  }
}

export async function clearLocalData() {
  const db = getDb();
  await db.execAsync(`
    DELETE FROM products;
    DELETE FROM sync_queue;
    DELETE FROM debts;
    DELETE FROM debt_transactions;
  `);
}
