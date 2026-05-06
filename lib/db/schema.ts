import * as SQLite from "expo-sqlite";

export const dbName = "ckaccounting.db";

let _db: SQLite.SQLiteDatabase | null = null;
let _initDbPromise: Promise<void> | null = null;

const DB_LOCK_RETRY_DELAYS_MS = [120, 250, 500, 1000, 1500];

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) {
    _db = SQLite.openDatabaseSync(dbName);
  }
  return _db;
}

export async function initDb() {
  if (_initDbPromise) {
    return _initDbPromise;
  }

  _initDbPromise = performInitDbWithRetry();

  try {
    await _initDbPromise;
  } catch (error) {
    _initDbPromise = null;
    throw error;
  }
}

async function performInitDbWithRetry() {
  for (let attempt = 0; attempt <= DB_LOCK_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await performInitDb();
      return;
    } catch (error) {
      if (!isDatabaseLockedError(error) || attempt === DB_LOCK_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await sleep(DB_LOCK_RETRY_DELAYS_MS[attempt]);
    }
  }
}

async function performInitDb() {
  const db = getDb();

  // Improve concurrent access resilience across foreground/background connections.
  db.execSync(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
    `);

  db.execSync(`
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
      user_id INTEGER,
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
    migrate?: (db: SQLite.SQLiteDatabase) => void;
    check?: (db: SQLite.SQLiteDatabase) => boolean;
  }[] = [
    { version: 1, sql: "ALTER TABLE products ADD COLUMN pricing_mode TEXT DEFAULT 'fixed';", check: (db) => !columnExists(db, "products", "pricing_mode") },
    { version: 2, sql: "ALTER TABLE products ADD COLUMN markup_percent REAL;", check: (db) => !columnExists(db, "products", "markup_percent") },
    { version: 3, sql: "ALTER TABLE products ADD COLUMN local_id TEXT;", check: (db) => !columnExists(db, "products", "local_id") },
    { version: 4, sql: "ALTER TABLE products ADD COLUMN sync_action TEXT DEFAULT 'none';", check: (db) => !columnExists(db, "products", "sync_action") },
    { version: 5, sql: "ALTER TABLE products ADD COLUMN status TEXT DEFAULT 'pending';", check: (db) => !columnExists(db, "products", "status") },
    { version: 6, sql: "ALTER TABLE purchases ADD COLUMN shop_id INTEGER;", check: (db) => !columnExists(db, "purchases", "shop_id") },
    { version: 7, sql: "ALTER TABLE products ADD COLUMN created_at TEXT;", check: (db) => !columnExists(db, "products", "created_at") },
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
    `, check: (db) => !columnExists(db, "sync_metadata", "key") },
    // Migration v11: pending_stock_delta for race condition protection (replaces pending_sale_decrement)
    { version: 11, sql: "ALTER TABLE products ADD COLUMN pending_stock_delta INTEGER DEFAULT 0;", check: (db) => !columnExists(db, "products", "pending_stock_delta") },
    // Migration v12: indexes + last_error + batch_id columns for sync_queue
    {
      version: 12,
      migrate: (db) => {
        ensureSyncQueueColumns(db);
        db.execSync(`
          CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at);
          CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
        `);
      },
      check: (db) =>
        !columnExists(db, "sync_queue", "last_error") ||
        !columnExists(db, "sync_queue", "batch_id") ||
        !columnExists(db, "sync_queue", "idempotency_key") ||
        !indexExists(db, "idx_products_updated_at") ||
        !indexExists(db, "idx_sales_created_at"),
    },
    // Migration v13: version column for optimistic locking
    { version: 13, sql: "ALTER TABLE products ADD COLUMN version INTEGER DEFAULT 1;", check: (db) => !columnExists(db, "products", "version") },
    // Migration v14: normalize sales.items JSON → sale_items table for queryability
    { version: 14, sql: `
      CREATE TABLE IF NOT EXISTS sale_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_local_id TEXT NOT NULL,
        product_id INTEGER,
        product_name TEXT NOT NULL,
        unit TEXT,
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        total REAL NOT NULL,
        created_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
      CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_local_id);
    `, check: (db) => !columnExists(db, "sale_items", "sale_local_id") },
    // Migration v15: version column for optimistic locking on debts and sales
    { version: 15, sql: "ALTER TABLE debts ADD COLUMN version INTEGER DEFAULT 1;", check: (db) => !columnExists(db, "debts", "version") },
    { version: 16, sql: "ALTER TABLE sales ADD COLUMN version INTEGER DEFAULT 1;", check: (db) => !columnExists(db, "sales", "version") },
    // Migration v17: add index on products.shop_id for faster filtering on multi-shop queries
    { version: 17, sql: "CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);", check: (db) => !indexExists(db, "idx_products_shop_id") },
    // Migration v18: add foreign key for sale_items → sales
    { version: 18, sql: "CREATE TABLE IF NOT EXISTS sale_items (\n        id INTEGER PRIMARY KEY AUTOINCREMENT,\n        sale_local_id TEXT NOT NULL,\n        product_id INTEGER,\n        product_name TEXT NOT NULL,\n        unit TEXT,\n        quantity REAL NOT NULL,\n        unit_price REAL NOT NULL,\n        total REAL NOT NULL,\n        created_at TEXT\n      );", check: (db) => !columnExists(db, "sale_items", "sale_local_id") },
    // Migration v19: store money in integer minor units (kopecks) to avoid floating-point drift.
    // New _kopecks columns coexist with existing REAL columns during the transition.
    // Backfill populates them from existing REAL values × 100.
    {
      version: 19,
      migrate: ensureAccountingMoneyColumns,
      check: (db) =>
        !columnExists(db, "products", "cost_price_kopecks") ||
        !columnExists(db, "products", "sale_price_kopecks") ||
        !columnExists(db, "debts", "balance_kopecks") ||
        !columnExists(db, "sales", "total_kopecks") ||
        !columnExists(db, "expenses", "total_kopecks") ||
        !columnExists(db, "purchases", "total_kopecks") ||
        (tableExists(db, "sale_items") && !columnExists(db, "sale_items", "total_kopecks")),
    },
    // Migration v20: add local_id and sync_action columns to debts, purchases, and debt_transactions
    // for dirty-state tracking so remote upsert doesn't blindly overwrite pending local changes.
    {
      version: 20,
      migrate: ensureAccountingDirtyStateColumns,
      check: (db) =>
        !columnExists(db, "debts", "local_id") ||
        !columnExists(db, "debts", "sync_action") ||
        !columnExists(db, "purchases", "local_id") ||
        !columnExists(db, "purchases", "sync_action") ||
        !columnExists(db, "debt_transactions", "local_id") ||
        !columnExists(db, "debt_transactions", "sync_action"),
    },
    // Migration v21: archived_at column for sync_queue audit trail.
    // Failed/dead rows are no longer physically deleted — they are soft-deleted
    // by setting archived_at so deleted rows can be audited if needed.
    { version: 21, migrate: ensureSyncQueueColumns, check: (db) => !columnExists(db, "sync_queue", "archived_at") },
    // Migration v22: sale_items.unit for sale detail/report queries.
    { version: 22, migrate: ensureSaleItemsColumns, check: (db) => !columnExists(db, "sale_items", "unit") },
    // Migration v23: user_id column on debts for seller-scoped visibility.
    { version: 23, sql: "ALTER TABLE debts ADD COLUMN user_id INTEGER;", check: (db) => !columnExists(db, "debts", "user_id") },
    // Migration v24: UUID primary keys.
    // Drops and recreates all entity tables with id TEXT PRIMARY KEY (UUID), removing the
    // local_id dual-tracking column. sale_items.sale_local_id → sale_id. All existing data
    // is cleared; server data re-syncs on next launch.
    {
      version: 24,
      migrate: (db) => {
        db.execSync(`
          DROP TABLE IF EXISTS sale_items;
          DROP TABLE IF EXISTS purchases;
          DROP TABLE IF EXISTS sales;
          DROP TABLE IF EXISTS expenses;
          DROP TABLE IF EXISTS products;
          DROP TABLE IF EXISTS debt_transactions;
          DROP TABLE IF EXISTS debts;
          DROP TABLE IF EXISTS shops;
          DROP TABLE IF EXISTS low_stock_alerts_sent;

          CREATE TABLE products (
            id TEXT PRIMARY KEY,
            shop_id INTEGER,
            name TEXT NOT NULL,
            code TEXT,
            unit TEXT,
            cost_price REAL NOT NULL DEFAULT 0,
            sale_price REAL NOT NULL DEFAULT 0,
            pricing_mode TEXT DEFAULT 'fixed',
            markup_percent REAL,
            bulk_price REAL,
            bulk_threshold INTEGER,
            stock_quantity REAL NOT NULL DEFAULT 0,
            pending_stock_delta INTEGER DEFAULT 0,
            low_stock_alert REAL,
            photo_url TEXT,
            version INTEGER DEFAULT 1,
            sync_action TEXT DEFAULT 'none',
            status TEXT DEFAULT 'pending',
            created_at TEXT,
            updated_at TEXT,
            last_synced_at TEXT,
            cost_price_kopecks INTEGER,
            sale_price_kopecks INTEGER,
            bulk_price_kopecks INTEGER
          );

          CREATE TABLE debts (
            id TEXT PRIMARY KEY,
            shop_id INTEGER,
            user_id INTEGER,
            person_name TEXT NOT NULL,
            opening_balance REAL DEFAULT 0,
            opening_balance_kopecks INTEGER,
            balance REAL DEFAULT 0,
            balance_kopecks INTEGER,
            direction TEXT DEFAULT 'receivable',
            version INTEGER DEFAULT 1,
            sync_action TEXT DEFAULT 'none',
            status TEXT DEFAULT 'pending',
            updated_at TEXT,
            last_synced_at TEXT
          );

          CREATE TABLE debt_transactions (
            id TEXT PRIMARY KEY,
            debt_id TEXT NOT NULL,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            amount_kopecks INTEGER,
            note TEXT,
            sync_action TEXT DEFAULT 'none',
            created_at TEXT
          );

          CREATE TABLE sales (
            id TEXT PRIMARY KEY,
            shop_id INTEGER,
            user_id INTEGER,
            customer_name TEXT,
            type TEXT,
            total REAL,
            total_kopecks INTEGER,
            discount REAL,
            discount_kopecks INTEGER,
            paid REAL,
            paid_kopecks INTEGER,
            debt REAL,
            debt_kopecks INTEGER,
            payment_type TEXT,
            notes TEXT,
            items TEXT,
            version INTEGER DEFAULT 1,
            status TEXT DEFAULT 'pending',
            sync_action TEXT DEFAULT 'none',
            created_at TEXT,
            updated_at TEXT,
            last_synced_at TEXT
          );

          CREATE TABLE sale_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id TEXT NOT NULL,
            product_id TEXT,
            product_name TEXT NOT NULL,
            unit TEXT,
            quantity REAL NOT NULL,
            unit_price REAL NOT NULL,
            unit_price_kopecks INTEGER,
            total REAL NOT NULL,
            total_kopecks INTEGER,
            created_at TEXT
          );

          CREATE TABLE expenses (
            id TEXT PRIMARY KEY,
            shop_id INTEGER,
            user_id INTEGER,
            name TEXT,
            quantity REAL,
            price REAL,
            price_kopecks INTEGER,
            total REAL,
            total_kopecks INTEGER,
            note TEXT,
            version INTEGER DEFAULT 1,
            status TEXT DEFAULT 'pending',
            sync_action TEXT DEFAULT 'none',
            created_at TEXT,
            updated_at TEXT,
            last_synced_at TEXT
          );

          CREATE TABLE purchases (
            id TEXT PRIMARY KEY,
            shop_id INTEGER,
            supplier_name TEXT,
            total REAL,
            total_kopecks INTEGER,
            items TEXT,
            status TEXT DEFAULT 'pending',
            sync_action TEXT DEFAULT 'none',
            created_at TEXT,
            updated_at TEXT,
            last_synced_at TEXT
          );

          CREATE TABLE shops (
            id INTEGER,
            local_id TEXT,
            name TEXT,
            is_active INTEGER DEFAULT 1,
            sync_action TEXT DEFAULT 'none',
            status TEXT DEFAULT 'pending',
            created_at TEXT,
            updated_at TEXT,
            last_synced_at TEXT
          );

          CREATE TABLE low_stock_alerts_sent (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id TEXT NOT NULL,
            shop_id INTEGER NOT NULL,
            sent_at TEXT NOT NULL,
            UNIQUE(product_id, shop_id)
          );

          CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at);
          CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);
          CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
          CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
          CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
          CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
          CREATE INDEX IF NOT EXISTS idx_sync_queue_archived_status ON sync_queue(archived_at, status, created_at);

          DELETE FROM sync_queue;
          DELETE FROM sync_metadata;
          DELETE FROM dashboard_cache;
          DELETE FROM reports_cache;
        `);
      },
      check: (db) => {
        // Re-run if products table still has a local_id column (old schema)
        return columnExists(db, "products", "local_id");
      },
    },
    // Migration v25: hot-path indexes for the product picker, OutboxProcessor,
    // and shop-scoped queries that previously triggered full table scans.
    {
      version: 25,
      sql: `
        CREATE INDEX IF NOT EXISTS idx_products_shop_status ON products(shop_id, sync_action, status);
        CREATE INDEX IF NOT EXISTS idx_products_code ON products(code);
        CREATE INDEX IF NOT EXISTS idx_products_name ON products(name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_sales_shop_created ON sales(shop_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_debts_shop_id ON debts(shop_id);
        CREATE INDEX IF NOT EXISTS idx_debts_user_id ON debts(user_id);
        CREATE INDEX IF NOT EXISTS idx_expenses_shop_created ON expenses(shop_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_purchases_shop_created ON purchases(shop_id, created_at);
      `,
      check: (db) => !indexExists(db, "idx_products_code"),
    },
    // Migration v26: FTS5 full-text index for product search.
    // Replaces LIKE '%query%' table scans with token-based ranked search.
    // The contentless variant keeps the index in sync via triggers from
    // products INSERT/UPDATE/DELETE.
    {
      version: 26,
      migrate: (db) => {
        db.execSync(`
          CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
            id UNINDEXED,
            shop_id UNINDEXED,
            name,
            code,
            tokenize = 'unicode61 remove_diacritics 2'
          );

          CREATE TRIGGER IF NOT EXISTS products_fts_ai AFTER INSERT ON products BEGIN
            INSERT INTO products_fts(id, shop_id, name, code)
            VALUES (new.id, new.shop_id, new.name, COALESCE(new.code, ''));
          END;

          CREATE TRIGGER IF NOT EXISTS products_fts_ad AFTER DELETE ON products BEGIN
            DELETE FROM products_fts WHERE id = old.id;
          END;

          CREATE TRIGGER IF NOT EXISTS products_fts_au AFTER UPDATE ON products BEGIN
            DELETE FROM products_fts WHERE id = old.id;
            INSERT INTO products_fts(id, shop_id, name, code)
            VALUES (new.id, new.shop_id, new.name, COALESCE(new.code, ''));
          END;

          INSERT INTO products_fts(id, shop_id, name, code)
          SELECT id, shop_id, name, COALESCE(code, '') FROM products
          WHERE id NOT IN (SELECT id FROM products_fts);
        `);
      },
      check: (db) => {
        const row = db.getFirstSync<{ count: number }>(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'products_fts'"
        );
        return (row?.count ?? 0) === 0;
      },
    },
  ];

  db.execSync(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const row = db.getFirstSync<{ version: number }>("SELECT MAX(version) AS version FROM schema_version");
  let currentVersion = row?.version ?? 0;

  // Run all pending migrations atomically: if the app is killed mid-migration,
  // the transaction is rolled back and schema_version is not updated, so
  // migrations will re-run safely on next launch.
  db.withTransactionSync(() => {
    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        const needsMigration = migration.check ? migration.check(db) : true;
        if (needsMigration) {
          if (migration.migrate) {
            migration.migrate(db);
          } else if (migration.sql) {
            db.execSync(migration.sql);
          }
        }
        db.runSync("INSERT OR REPLACE INTO schema_version (version) VALUES (?)", [migration.version]);
      }
    }
  });

  ensureSyncQueueColumns(db);
  ensureAccountingSyncColumns(db);
  ensureSaleItemsColumns(db);

    // Reset any rows stuck as 'processing' from a previous crashed session.
    // This must run after sync_queue repair because older DBs may not have batch_id.
  db.runSync(
    "UPDATE sync_queue SET status = 'pending', batch_id = NULL WHERE status = 'processing'"
  );
}

function isDatabaseLockedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /database is locked/i.test(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function columnExists(db: SQLite.SQLiteDatabase, table: string, column: string): boolean {
  const cols = db.getAllSync<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some(c => c.name === column);
}

function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  definition: string
): void {
  if (!columnExists(db, table, column)) {
    db.execSync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

function ensureSyncQueueColumns(db: SQLite.SQLiteDatabase): void {
  addColumnIfMissing(db, "sync_queue", "last_error", "TEXT");
  addColumnIfMissing(db, "sync_queue", "batch_id", "TEXT");
  addColumnIfMissing(db, "sync_queue", "idempotency_key", "TEXT");
  addColumnIfMissing(db, "sync_queue", "archived_at", "TEXT");
  db.execSync(`
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_archived_status ON sync_queue(archived_at, status, created_at);
  `);
}

function ensureAccountingMoneyColumns(db: SQLite.SQLiteDatabase): void {
  addColumnIfMissing(db, "products", "cost_price_kopecks", "INTEGER");
  addColumnIfMissing(db, "products", "sale_price_kopecks", "INTEGER");
  addColumnIfMissing(db, "products", "bulk_price_kopecks", "INTEGER");
  addColumnIfMissing(db, "debts", "opening_balance_kopecks", "INTEGER");
  addColumnIfMissing(db, "debts", "balance_kopecks", "INTEGER");
  addColumnIfMissing(db, "debt_transactions", "amount_kopecks", "INTEGER");
  addColumnIfMissing(db, "sales", "total_kopecks", "INTEGER");
  addColumnIfMissing(db, "sales", "discount_kopecks", "INTEGER");
  addColumnIfMissing(db, "sales", "paid_kopecks", "INTEGER");
  addColumnIfMissing(db, "sales", "debt_kopecks", "INTEGER");
  addColumnIfMissing(db, "expenses", "price_kopecks", "INTEGER");
  addColumnIfMissing(db, "expenses", "total_kopecks", "INTEGER");
  addColumnIfMissing(db, "purchases", "total_kopecks", "INTEGER");

  if (tableExists(db, "sale_items")) {
    addColumnIfMissing(db, "sale_items", "unit_price_kopecks", "INTEGER");
    addColumnIfMissing(db, "sale_items", "total_kopecks", "INTEGER");
  }

  backfillAccountingMoneyColumns(db);
}

function ensureAccountingDirtyStateColumns(db: SQLite.SQLiteDatabase): void {
  addColumnIfMissing(db, "debts", "local_id", "TEXT");
  addColumnIfMissing(db, "debts", "sync_action", "TEXT DEFAULT 'none'");
  addColumnIfMissing(db, "purchases", "local_id", "TEXT");
  addColumnIfMissing(db, "purchases", "sync_action", "TEXT DEFAULT 'none'");
  addColumnIfMissing(db, "debt_transactions", "local_id", "TEXT");
  addColumnIfMissing(db, "debt_transactions", "sync_action", "TEXT DEFAULT 'none'");
}

function ensureSaleItemsColumns(db: SQLite.SQLiteDatabase): void {
  if (tableExists(db, "sale_items")) {
    addColumnIfMissing(db, "sale_items", "unit", "TEXT");
  }
}

function backfillAccountingMoneyColumns(db: SQLite.SQLiteDatabase): void {
  db.execSync(`
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

  if (tableExists(db, "sale_items")) {
    db.execSync(`
      UPDATE sale_items
      SET unit_price_kopecks = COALESCE(unit_price_kopecks, ROUND(unit_price * 100)),
          total_kopecks = COALESCE(total_kopecks, ROUND(total * 100));
    `);
  }
}

function ensureAccountingSyncColumns(db: SQLite.SQLiteDatabase): void {
  ensureAccountingMoneyColumns(db);
  ensureAccountingDirtyStateColumns(db);
}

function tableExists(db: SQLite.SQLiteDatabase, table: string): boolean {
  const row = db.getFirstSync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table]
  );
  return !!row;
}

function indexExists(db: SQLite.SQLiteDatabase, indexName: string): boolean {
  const row = db.getFirstSync<{ name: string }>(
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
