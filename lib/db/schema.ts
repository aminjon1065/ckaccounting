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

  // Enable foreign key constraints
  await db.execAsync("PRAGMA foreign_keys = ON");

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
      version INTEGER DEFAULT 1,
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
      created_at TEXT NOT NULL,
      last_error TEXT,
      batch_id TEXT,
      idempotency_key TEXT,
      archived_at TEXT
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

  const MIGRATIONS: {
    version: number;
    sql?: string;
    migrate?: (db: SQLite.SQLiteDatabase) => Promise<void>;
    check?: (db: SQLite.SQLiteDatabase) => Promise<boolean>;
  }[] = [
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
    // Migration v10: sync_metadata table for storing sync timestamps
    { version: 10, sql: `
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `, check: async (db) => !(await columnExists(db, "sync_metadata", "key")) },
    // Migration v11: pending_stock_delta for race condition protection (replaces pending_sale_decrement)
    { version: 11, sql: "ALTER TABLE products ADD COLUMN pending_stock_delta INTEGER DEFAULT 0;", check: async (db) => !(await columnExists(db, "products", "pending_stock_delta")) },
    // Migration v12: indexes + last_error + batch_id columns for sync_queue
    {
      version: 12,
      migrate: async (db) => {
        await ensureSyncQueueColumns(db);
        await db.execAsync(`
          CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at);
          CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
        `);
      },
      check: async (db) =>
        !(await columnExists(db, "sync_queue", "last_error")) ||
        !(await columnExists(db, "sync_queue", "batch_id")) ||
        !(await columnExists(db, "sync_queue", "idempotency_key")) ||
        !(await indexExists(db, "idx_products_updated_at")) ||
        !(await indexExists(db, "idx_sales_created_at")),
    },
    // Migration v13: version column for optimistic locking
    { version: 13, sql: "ALTER TABLE products ADD COLUMN version INTEGER DEFAULT 1;", check: async (db) => !(await columnExists(db, "products", "version")) },
    // Migration v14: normalize sales.items JSON → sale_items table for queryability
    { version: 14, sql: `
      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_local_id TEXT NOT NULL,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        total REAL NOT NULL,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
      CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_local_id);
    `, check: async (db) => !(await columnExists(db, "sale_items", "sale_local_id")) },
    // Migration v15: version column for optimistic locking on debts and sales
    { version: 15, sql: "ALTER TABLE debts ADD COLUMN version INTEGER DEFAULT 1;", check: async (db) => !(await columnExists(db, "debts", "version")) },
    { version: 16, sql: "ALTER TABLE sales ADD COLUMN version INTEGER DEFAULT 1;", check: async (db) => !(await columnExists(db, "sales", "version")) },
    // Migration v17: add index on products.shop_id for faster filtering on multi-shop queries
    { version: 17, sql: "CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);", check: async (db) => !(await indexExists(db, "idx_products_shop_id")) },
    // Migration v18: add foreign key for sale_items → sales
    { version: 18, sql: "CREATE TABLE IF NOT EXISTS sale_items (\n        id INTEGER PRIMARY KEY AUTOINCREMENT,\n        sale_local_id TEXT NOT NULL,\n        product_id INTEGER,\n        product_name TEXT NOT NULL,\n        quantity REAL NOT NULL,\n        unit_price REAL NOT NULL,\n        total REAL NOT NULL,\n        created_at TEXT\n      );", check: async (db) => !(await columnExists(db, "sale_items", "sale_local_id")) },
    // Migration v19: store money in integer minor units (kopecks) to avoid floating-point drift.
    // New _kopecks columns coexist with existing REAL columns during the transition.
    // Backfill populates them from existing REAL values × 100.
    {
      version: 19,
      migrate: ensureAccountingMoneyColumns,
      check: async (db) =>
        !(await columnExists(db, "products", "cost_price_kopecks")) ||
        !(await columnExists(db, "products", "sale_price_kopecks")) ||
        !(await columnExists(db, "debts", "balance_kopecks")) ||
        !(await columnExists(db, "sales", "total_kopecks")) ||
        !(await columnExists(db, "expenses", "total_kopecks")) ||
        !(await columnExists(db, "purchases", "total_kopecks")) ||
        ((await tableExists(db, "sale_items")) && !(await columnExists(db, "sale_items", "total_kopecks"))),
    },
    // Migration v20: add local_id and sync_action columns to debts, purchases, and debt_transactions
    // for dirty-state tracking so remote upsert doesn't blindly overwrite pending local changes.
    {
      version: 20,
      migrate: ensureAccountingDirtyStateColumns,
      check: async (db) =>
        !(await columnExists(db, "debts", "local_id")) ||
        !(await columnExists(db, "debts", "sync_action")) ||
        !(await columnExists(db, "purchases", "local_id")) ||
        !(await columnExists(db, "purchases", "sync_action")) ||
        !(await columnExists(db, "debt_transactions", "local_id")) ||
        !(await columnExists(db, "debt_transactions", "sync_action")),
    },
    // Migration v21: archived_at column for sync_queue audit trail.
    // Failed/dead rows are no longer physically deleted — they are soft-deleted
    // by setting archived_at so deleted rows can be audited if needed.
    { version: 21, migrate: ensureSyncQueueColumns, check: async (db) => !(await columnExists(db, "sync_queue", "archived_at")) },
  ];

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const row = await db.getFirstAsync<{ version: number }>("SELECT MAX(version) AS version FROM schema_version");
  let currentVersion = row?.version ?? 0;

  // Run all pending migrations atomically: if the app is killed mid-migration,
  // the transaction is rolled back and schema_version is not updated, so
  // migrations will re-run safely on next launch.
  await db.withTransactionAsync(async () => {
    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        const needsMigration = migration.check ? await migration.check(db) : true;
        if (needsMigration) {
          if (migration.migrate) {
            await migration.migrate(db);
          } else if (migration.sql) {
            await db.execAsync(migration.sql);
          }
        }
        await db.runAsync("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", [migration.version]);
      }
    }
  });

  await ensureSyncQueueColumns(db);
  await ensureAccountingSyncColumns(db);

  // Reset any rows stuck as 'processing' from a previous crashed session.
  // This must run after sync_queue repair because older DBs may not have batch_id.
  await db.runAsync(
    "UPDATE sync_queue SET status = 'pending', batch_id = NULL WHERE status = 'processing'"
  );
}

async function columnExists(db: SQLite.SQLiteDatabase, table: string, column: string): Promise<boolean> {
  const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === column);
}

async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string
): Promise<void> {
  if (!(await columnExists(db, table, column))) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

async function ensureSyncQueueColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, "sync_queue", "last_error", "TEXT");
  await addColumnIfMissing(db, "sync_queue", "batch_id", "TEXT");
  await addColumnIfMissing(db, "sync_queue", "idempotency_key", "TEXT");
  await addColumnIfMissing(db, "sync_queue", "archived_at", "TEXT");
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_archived_status ON sync_queue(archived_at, status, created_at);
  `);
}

async function ensureAccountingMoneyColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, "products", "cost_price_kopecks", "INTEGER");
  await addColumnIfMissing(db, "products", "sale_price_kopecks", "INTEGER");
  await addColumnIfMissing(db, "products", "bulk_price_kopecks", "INTEGER");
  await addColumnIfMissing(db, "debts", "opening_balance_kopecks", "INTEGER");
  await addColumnIfMissing(db, "debts", "balance_kopecks", "INTEGER");
  await addColumnIfMissing(db, "debt_transactions", "amount_kopecks", "INTEGER");
  await addColumnIfMissing(db, "sales", "total_kopecks", "INTEGER");
  await addColumnIfMissing(db, "sales", "discount_kopecks", "INTEGER");
  await addColumnIfMissing(db, "sales", "paid_kopecks", "INTEGER");
  await addColumnIfMissing(db, "sales", "debt_kopecks", "INTEGER");
  await addColumnIfMissing(db, "expenses", "price_kopecks", "INTEGER");
  await addColumnIfMissing(db, "expenses", "total_kopecks", "INTEGER");
  await addColumnIfMissing(db, "purchases", "total_kopecks", "INTEGER");

  if (await tableExists(db, "sale_items")) {
    await addColumnIfMissing(db, "sale_items", "unit_price_kopecks", "INTEGER");
    await addColumnIfMissing(db, "sale_items", "total_kopecks", "INTEGER");
  }

  await backfillAccountingMoneyColumns(db);
}

async function ensureAccountingDirtyStateColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  await addColumnIfMissing(db, "debts", "local_id", "TEXT");
  await addColumnIfMissing(db, "debts", "sync_action", "TEXT DEFAULT 'none'");
  await addColumnIfMissing(db, "purchases", "local_id", "TEXT");
  await addColumnIfMissing(db, "purchases", "sync_action", "TEXT DEFAULT 'none'");
  await addColumnIfMissing(db, "debt_transactions", "local_id", "TEXT");
  await addColumnIfMissing(db, "debt_transactions", "sync_action", "TEXT DEFAULT 'none'");
}

async function backfillAccountingMoneyColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    UPDATE products
    SET cost_price_kopecks = COALESCE(cost_price_kopecks, ROUND(cost_price * 100)),
        sale_price_kopecks = COALESCE(sale_price_kopecks, ROUND(sale_price * 100)),
        bulk_price_kopecks = CASE
          WHEN bulk_price IS NULL THEN bulk_price_kopecks
          ELSE COALESCE(bulk_price_kopecks, ROUND(bulk_price * 100))
        END;
    UPDATE debts
    SET opening_balance_kopecks = COALESCE(opening_balance_kopecks, ROUND(opening_balance * 100)),
        balance_kopecks = COALESCE(balance_kopecks, ROUND(balance * 100));
    UPDATE debt_transactions
    SET amount_kopecks = COALESCE(amount_kopecks, ROUND(amount * 100));
    UPDATE sales
    SET total_kopecks = COALESCE(total_kopecks, ROUND(total * 100)),
        discount_kopecks = COALESCE(discount_kopecks, ROUND(discount * 100)),
        paid_kopecks = COALESCE(paid_kopecks, ROUND(paid * 100)),
        debt_kopecks = COALESCE(debt_kopecks, ROUND(debt * 100));
    UPDATE expenses
    SET price_kopecks = COALESCE(price_kopecks, ROUND(price * 100)),
        total_kopecks = COALESCE(total_kopecks, ROUND(total * 100));
    UPDATE purchases
    SET total_kopecks = COALESCE(total_kopecks, ROUND(total * 100));
  `);

  if (await tableExists(db, "sale_items")) {
    await db.execAsync(`
      UPDATE sale_items
      SET unit_price_kopecks = COALESCE(unit_price_kopecks, ROUND(unit_price * 100)),
          total_kopecks = COALESCE(total_kopecks, ROUND(total * 100));
    `);
  }
}

async function ensureAccountingSyncColumns(db: SQLite.SQLiteDatabase): Promise<void> {
  await ensureAccountingMoneyColumns(db);
  await ensureAccountingDirtyStateColumns(db);
}

async function tableExists(db: SQLite.SQLiteDatabase, table: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table]
  );
  return !!row;
}

async function indexExists(db: SQLite.SQLiteDatabase, indexName: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
    [indexName]
  );
  return !!row;
}

export async function clearLocalData() {
  const db = getDb();
  await db.execAsync(`
    DELETE FROM products;
    DELETE FROM sync_queue;
    DELETE FROM debts;
    DELETE FROM debt_transactions;
    DELETE FROM sales;
    DELETE FROM sale_items;
    DELETE FROM expenses;
    DELETE FROM purchases;
    DELETE FROM shops;
    DELETE FROM dashboard_cache;
    DELETE FROM reports_cache;
    DELETE FROM sync_metadata;
    DELETE FROM notifications;
    DELETE FROM low_stock_alerts_sent;
  `);
}
