import * as SQLite from "expo-sqlite";

export const dbName = "ckaccounting.db";

let _db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync(dbName);
  }
  return _db;
}

export async function initDb() {
  const db = getDb();
  
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      local_id TEXT,
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
      sync_action TEXT DEFAULT 'none',
      status TEXT DEFAULT 'pending',
      created_at TEXT,
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

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER,
      local_id TEXT UNIQUE,
      shop_id INTEGER,
      user_id INTEGER,
      customer_name TEXT,
      type TEXT,
      total REAL,
      discount REAL,
      paid REAL,
      debt REAL,
      payment_type TEXT,
      notes TEXT,
      items TEXT,
      status TEXT DEFAULT 'pending',
      sync_action TEXT DEFAULT 'none',
      created_at TEXT,
      updated_at TEXT,
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER,
      local_id TEXT UNIQUE,
      shop_id INTEGER,
      user_id INTEGER,
      name TEXT,
      quantity REAL,
      price REAL,
      total REAL,
      note TEXT,
      status TEXT DEFAULT 'pending',
      sync_action TEXT DEFAULT 'none',
      created_at TEXT,
      updated_at TEXT,
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER,
      local_id TEXT UNIQUE,
      shop_id INTEGER,
      supplier_name TEXT,
      total REAL,
      items TEXT,
      status TEXT DEFAULT 'pending',
      sync_action TEXT DEFAULT 'none',
      created_at TEXT,
      updated_at TEXT,
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS shops (
      id INTEGER,
      local_id TEXT UNIQUE,
      name TEXT,
      is_active INTEGER DEFAULT 1,
      sync_action TEXT DEFAULT 'none',
      status TEXT DEFAULT 'pending',
      created_at TEXT,
      updated_at TEXT,
      last_synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dashboard_cache (
      key TEXT PRIMARY KEY,
      data TEXT,
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS reports_cache (
      key TEXT PRIMARY KEY,
      data TEXT,
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      data TEXT,
      read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS low_stock_alerts_sent (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      shop_id INTEGER NOT NULL,
      sent_at TEXT NOT NULL,
      UNIQUE(product_id, shop_id)
    );
  `);

  const MIGRATIONS: { version: number; sql: string; check?: (db: SQLite.SQLiteDatabase) => Promise<boolean> }[] = [
    { version: 1, sql: "ALTER TABLE products ADD COLUMN pricing_mode TEXT DEFAULT 'fixed';", check: async (db) => !(await columnExists(db, "products", "pricing_mode")) },
    { version: 2, sql: "ALTER TABLE products ADD COLUMN markup_percent REAL;", check: async (db) => !(await columnExists(db, "products", "markup_percent")) },
    { version: 3, sql: "ALTER TABLE products ADD COLUMN local_id TEXT;", check: async (db) => !(await columnExists(db, "products", "local_id")) },
    { version: 4, sql: "ALTER TABLE products ADD COLUMN sync_action TEXT DEFAULT 'none';", check: async (db) => !(await columnExists(db, "products", "sync_action")) },
    { version: 5, sql: "ALTER TABLE products ADD COLUMN status TEXT DEFAULT 'pending';", check: async (db) => !(await columnExists(db, "products", "status")) },
    { version: 6, sql: "ALTER TABLE purchases ADD COLUMN shop_id INTEGER;", check: async (db) => !(await columnExists(db, "purchases", "shop_id")) },
    { version: 7, sql: "ALTER TABLE products ADD COLUMN created_at TEXT;", check: async (db) => !(await columnExists(db, "products", "created_at")) },
    // Purge stale queue entries created with negative temp IDs (PATCH /entity/-timestamp)
    { version: 8, sql: "DELETE FROM sync_queue WHERE path LIKE '%/-%'" },
    // Re-run purge in case version 8 was recorded with the broken SQL
    { version: 9, sql: "DELETE FROM sync_queue WHERE path LIKE '%/-%'" },
  ];

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const row = await db.getFirstAsync<{ version: number }>("SELECT version FROM schema_version LIMIT 1");
  let currentVersion = row?.version ?? 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      const needsMigration = migration.check ? await migration.check(db) : true;
      if (needsMigration) {
        await db.execAsync(migration.sql);
      }
      await db.runAsync("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", [migration.version]);
    }
  }
}

async function columnExists(db: SQLite.SQLiteDatabase, table: string, column: string): Promise<boolean> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === column);
}

export async function clearLocalData() {
  const db = getDb();
  await db.execAsync(`
    DELETE FROM products;
    DELETE FROM sync_queue;
    DELETE FROM debts;
    DELETE FROM debt_transactions;
    DELETE FROM sales;
    DELETE FROM expenses;
    DELETE FROM purchases;
    DELETE FROM shops;
    DELETE FROM dashboard_cache;
    DELETE FROM reports_cache;
  `);
}
