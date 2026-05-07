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

  // PRAGMA tuning. Three are persistent / connection-shared (WAL is sticky in
  // the DB header; busy_timeout + foreign_keys persist for the connection),
  // the rest are per-connection knobs that have to be re-applied here on
  // every cold open. Both the foreground app and the OS background-fetch
  // task call initDb() so this block runs in both contexts.
  //
  // Concurrency:
  //   journal_mode = WAL          — readers don't block the writer (the
  //                                 outbox processor runs alongside list
  //                                 reads on the dashboard).
  //   busy_timeout = 5000         — let SQLite spin up to 5 s on lock
  //                                 contention before throwing SQLITE_BUSY.
  //                                 Crash recovery + the cross-process
  //                                 sync-lock retry loop both rely on this.
  //   foreign_keys = ON           — explicit, since the default is OFF in
  //                                 every SQLite shipped with expo-sqlite.
  //
  // Performance (added phase 6.1):
  //   synchronous = NORMAL        — pairs with WAL: durable across app /
  //                                 process crashes, only loses commits on
  //                                 OS / power crash. The outbox pattern
  //                                 makes that bound acceptable — anything
  //                                 lost locally either never reached the
  //                                 server (and the user retries) or already
  //                                 reached it (and the next pull restores
  //                                 it). FULL is overkill on a battery
  //                                 device and ~2-5x slower on writes.
  //   cache_size = -32000         — 32 MB page cache (negative value = KB,
  //                                 not pages). Default 2 MB is too small
  //                                 for the dashboard's parallel SELECTs
  //                                 over sales / debts / products at once.
  //   temp_store = MEMORY         — keep temp B-trees / sort buffers in RAM
  //                                 instead of spilling to disk. Material
  //                                 win for FTS5 product search and
  //                                 GROUP BY on the daily-aggregation
  //                                 reports.
  //   mmap_size = 67108864        — 64 MB memory-mapped read window. Hot
  //                                 catalogue pages stay in the OS page
  //                                 cache rather than being read() through
  //                                 the syscall boundary on every SELECT.
  //                                 Falls back to standard I/O above the
  //                                 limit, so larger DBs still work.
  db.execSync(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = NORMAL;
      PRAGMA cache_size = -32000;
      PRAGMA temp_store = MEMORY;
      PRAGMA mmap_size = 67108864;
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
        // Refuse to run if the user still has unsynced offline writes —
        // this migration wipes sync_queue (line ~end of execSync below) and
        // would silently drop them. Block here, let the user come online,
        // let the outbox drain, then retry on next launch.
        assertSyncQueueDrained(db, "v24 (UUID PK conversion)");

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
    // Migration v27: cross-process advisory lock for the sync coordinator.
    // Single-row table; foreground SyncCoordinator and the OS background-fetch
    // task both attempt to claim it before running. TTL-based so a crashed
    // holder cannot deadlock peers.
    {
      version: 27,
      sql: `
        CREATE TABLE IF NOT EXISTS sync_lock (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          holder TEXT,
          acquired_at TEXT,
          expires_at TEXT
        );
        INSERT OR IGNORE INTO sync_lock (id, holder, acquired_at, expires_at)
          VALUES (1, NULL, NULL, NULL);
      `,
      check: (db) => !tableExists(db, "sync_lock"),
    },
    // Migration v28: sync_queue.claimed_at — timestamp when a row entered
    // the 'processing' state. Enables a sweeper to detect rows whose claim
    // was orphaned by a crashed processor (foreground or background) and
    // return them to 'pending' so a subsequent outbox cycle retries them.
    {
      version: 28,
      sql: `
        ALTER TABLE sync_queue ADD COLUMN claimed_at TEXT;
        CREATE INDEX IF NOT EXISTS idx_sync_queue_processing_claimed
          ON sync_queue(status, claimed_at) WHERE status = 'processing';
      `,
      check: (db) => !columnExists(db, "sync_queue", "claimed_at"),
    },
    // Migration v29: kopecks-only money columns.
    //
    // Until now every money field had two columns side by side: a REAL
    // (rubles, the legacy storage) and an INTEGER (`*_kopecks`, minor units).
    // Readers preferred kopecks but fell back to REAL; writers wrote both;
    // every code review since the audit had to remember the dual-column
    // dance. After phase 2.4's reader/writer canonicalization, REAL columns
    // are no longer touched by code — this migration drops them so the
    // schema can no longer drift back into the dual state.
    //
    // Order matters: backfill any kopecks values still NULL from the REAL
    // column FIRST, then drop the REAL column. SQLite ≥ 3.35 supports
    // `ALTER TABLE … DROP COLUMN`; expo-sqlite ships SQLite ≥ 3.45 in this
    // SDK so the syntax is safe.
    {
      version: 29,
      migrate: dropRealMoneyColumns,
      check: (db) => columnExists(db, "products", "cost_price"),
    },
    // Migration v30: shops PK fix.
    //
    // The v24 rewrite recreated the shops table without a PRIMARY KEY or
    // UNIQUE constraint on `id`, so `INSERT OR REPLACE` had nothing to
    // match and every fetcher pull appended duplicate rows (3 → 6 → 9 …).
    // This rebuilds the table with `id INTEGER PRIMARY KEY` and dedupes
    // existing rows by keeping the latest write per id.
    //
    // local_id stays UNIQUE because the offline-created path uses it as
    // the stable handle until the server hands back the real id.
    {
      version: 30,
      migrate: (db) => {
        db.execSync(`
          CREATE TABLE shops_new (
            id INTEGER PRIMARY KEY,
            local_id TEXT UNIQUE,
            name TEXT,
            is_active INTEGER DEFAULT 1,
            sync_action TEXT DEFAULT 'none',
            status TEXT DEFAULT 'pending',
            created_at TEXT,
            updated_at TEXT,
            last_synced_at TEXT
          );

          INSERT INTO shops_new
          SELECT id, local_id, name, is_active, sync_action, status,
                 created_at, updated_at, last_synced_at
          FROM shops s
          WHERE rowid = (SELECT MAX(rowid) FROM shops WHERE id IS s.id);

          DROP TABLE shops;
          ALTER TABLE shops_new RENAME TO shops;
        `);
      },
      // Run if `id` is not the PK yet. PRAGMA index_list / table_info can
      // tell us; cheaper to just check that rebuilding is needed by looking
      // for any duplicate ids that snuck in.
      check: (db) => {
        const dupes = db.getFirstSync<{ c: number }>(
          "SELECT COUNT(*) AS c FROM (SELECT id FROM shops GROUP BY id HAVING COUNT(*) > 1)"
        );
        if ((dupes?.c ?? 0) > 0) return true;
        // Also run if the table exists but has no PK on id (zero-dup case
        // on a fresh install — still need to add the constraint).
        const info = db.getAllSync<{ name: string; pk: number }>(
          "PRAGMA table_info(shops)"
        );
        const idCol = info.find((c) => c.name === "id");
        return !!idCol && idCol.pk === 0;
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

  // Recover any rows stuck as 'processing' from a previous crashed session.
  // We only release them back to 'pending' here — the runtime sweeper
  // (`releaseStuckSyncActions`) is responsible for promoting truly broken
  // rows to 'dead' and unwinding any pending_stock_delta they leaked.
  // Doing the dead-promotion here is unsafe because it would skip the
  // stock-unwind path (which is async, not callable from the synchronous
  // migration runner). Sellers would see phantom inventory until next sync.
  db.runSync(
    `UPDATE sync_queue
     SET status = 'pending',
         batch_id = NULL,
         claimed_at = NULL,
         retries = retries + 1,
         last_error = COALESCE(last_error, '') || ' | launch: stuck in processing'
     WHERE status = 'processing'`
  );

  // Clear any *expired* sync_lock left behind by a previous crashed session.
  // We only clear locks whose expires_at has already passed — never an active
  // lock, since the OS background-fetch task may legitimately be holding one
  // while the foreground process is starting.
  if (tableExists(db, "sync_lock")) {
    db.runSync(
      "UPDATE sync_lock SET holder = NULL, acquired_at = NULL, expires_at = NULL " +
        "WHERE id = 1 AND (expires_at IS NULL OR datetime(expires_at) < datetime('now'))"
    );
  }
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
  addColumnIfMissing(db, "sync_queue", "claimed_at", "TEXT");
  db.execSync(`
    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_archived_status ON sync_queue(archived_at, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_processing_claimed ON sync_queue(status, claimed_at) WHERE status = 'processing';
  `);
}

/**
 * Thrown when a destructive migration (one that wipes `sync_queue`) is asked
 * to run while pending offline writes still exist on the device. Aborting
 * the migration this way preserves the user's unsynced data — the schema
 * stays at the prior version, the user is told to come online and let the
 * outbox drain, and only then upgrade.
 *
 * The error caries the unsynced row count for diagnostics. The caller (the
 * migration runner inside `withTransactionSync`) re-throws it; SQLite rolls
 * back the partial migration and `schema_version` is not bumped, so the
 * next launch retries.
 */
export class OutboxNotDrainedError extends Error {
  constructor(
    public readonly migrationLabel: string,
    public readonly unsyncedRows: number
  ) {
    super(
      `Destructive migration "${migrationLabel}" refused to run: ${unsyncedRows} unsynced ` +
        "outbox row(s) would be lost. Connect the device to the network, let the outbox drain, " +
        "and re-launch the app to retry."
    );
    this.name = "OutboxNotDrainedError";
  }
}

/**
 * Pre-flight guard for any migration that wipes or replaces `sync_queue`.
 * Counts non-archived rows in pending/processing/failed/dead states — any
 * row that has not yet been delivered to the server. If non-zero, aborts.
 *
 * RULE: every future migration that does `DELETE FROM sync_queue` (or
 * structurally rebuilds the table) must call this helper first. The audit
 * surfaced exactly this gap in v24 — that migration silently dropped
 * unsynced offline writes.
 */
export function assertSyncQueueDrained(
  db: SQLite.SQLiteDatabase,
  migrationLabel: string
): void {
  if (!tableExists(db, "sync_queue")) {
    return;
  }
  const row = db.getFirstSync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM sync_queue
     WHERE archived_at IS NULL
       AND status IN ('pending', 'processing', 'failed', 'dead')`
  );
  const unsynced = Number(row?.n ?? 0);
  if (unsynced > 0) {
    throw new OutboxNotDrainedError(migrationLabel, unsynced);
  }
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

/**
 * Drop the legacy REAL money columns. Two-step:
 *   1. Backfill any *_kopecks values that are still NULL by rounding the
 *      paired REAL value × 100 — this catches rows synced before the
 *      kopecks-only writer landed.
 *   2. DROP each REAL column. SQLite happily drops columns referenced by
 *      indexes only; views/triggers must be recreated, but we have neither
 *      on these tables for money fields.
 *
 * If a REAL column was already dropped on a previous (failed) attempt, the
 * `dropColumnIfExists` helper makes the migration idempotent.
 */
function dropRealMoneyColumns(db: SQLite.SQLiteDatabase): void {
  // Step 1: backfill NULLs from REAL where present.
  if (columnExists(db, "products", "cost_price")) {
    db.execSync(`
      UPDATE products
      SET cost_price_kopecks = COALESCE(cost_price_kopecks, ROUND(cost_price * 100)),
          sale_price_kopecks = COALESCE(sale_price_kopecks, ROUND(sale_price * 100)),
          bulk_price_kopecks = CASE
            WHEN bulk_price IS NULL THEN bulk_price_kopecks
            ELSE COALESCE(bulk_price_kopecks, ROUND(bulk_price * 100))
          END
      WHERE cost_price_kopecks IS NULL
         OR sale_price_kopecks IS NULL
         OR (bulk_price IS NOT NULL AND bulk_price_kopecks IS NULL);
    `);
  }
  if (columnExists(db, "debts", "balance")) {
    db.execSync(`
      UPDATE debts
      SET opening_balance_kopecks = COALESCE(opening_balance_kopecks, ROUND(opening_balance * 100)),
          balance_kopecks = COALESCE(balance_kopecks, ROUND(balance * 100))
      WHERE opening_balance_kopecks IS NULL OR balance_kopecks IS NULL;
    `);
  }
  if (columnExists(db, "debt_transactions", "amount")) {
    db.execSync(`
      UPDATE debt_transactions
      SET amount_kopecks = COALESCE(amount_kopecks, ROUND(amount * 100))
      WHERE amount_kopecks IS NULL;
    `);
  }
  if (columnExists(db, "sales", "total")) {
    db.execSync(`
      UPDATE sales
      SET total_kopecks = COALESCE(total_kopecks, ROUND(total * 100)),
          discount_kopecks = COALESCE(discount_kopecks, ROUND(discount * 100)),
          paid_kopecks = COALESCE(paid_kopecks, ROUND(paid * 100)),
          debt_kopecks = COALESCE(debt_kopecks, ROUND(debt * 100))
      WHERE total_kopecks IS NULL OR discount_kopecks IS NULL
         OR paid_kopecks IS NULL OR debt_kopecks IS NULL;
    `);
  }
  if (columnExists(db, "expenses", "price")) {
    db.execSync(`
      UPDATE expenses
      SET price_kopecks = COALESCE(price_kopecks, ROUND(price * 100)),
          total_kopecks = COALESCE(total_kopecks, ROUND(total * 100))
      WHERE price_kopecks IS NULL OR total_kopecks IS NULL;
    `);
  }
  if (columnExists(db, "purchases", "total")) {
    db.execSync(`
      UPDATE purchases
      SET total_kopecks = COALESCE(total_kopecks, ROUND(total * 100))
      WHERE total_kopecks IS NULL;
    `);
  }
  if (tableExists(db, "sale_items") && columnExists(db, "sale_items", "unit_price")) {
    db.execSync(`
      UPDATE sale_items
      SET unit_price_kopecks = COALESCE(unit_price_kopecks, ROUND(unit_price * 100)),
          total_kopecks = COALESCE(total_kopecks, ROUND(total * 100))
      WHERE unit_price_kopecks IS NULL OR total_kopecks IS NULL;
    `);
  }

  // Step 2: drop the REAL columns. Each drop is independently idempotent.
  dropColumnIfExists(db, "products", "cost_price");
  dropColumnIfExists(db, "products", "sale_price");
  dropColumnIfExists(db, "products", "bulk_price");
  dropColumnIfExists(db, "debts", "opening_balance");
  dropColumnIfExists(db, "debts", "balance");
  dropColumnIfExists(db, "debt_transactions", "amount");
  dropColumnIfExists(db, "sales", "total");
  dropColumnIfExists(db, "sales", "discount");
  dropColumnIfExists(db, "sales", "paid");
  dropColumnIfExists(db, "sales", "debt");
  dropColumnIfExists(db, "expenses", "price");
  dropColumnIfExists(db, "expenses", "total");
  dropColumnIfExists(db, "purchases", "total");
  if (tableExists(db, "sale_items")) {
    dropColumnIfExists(db, "sale_items", "unit_price");
    dropColumnIfExists(db, "sale_items", "total");
  }
}

function dropColumnIfExists(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string
): void {
  if (columnExists(db, table, column)) {
    db.execSync(`ALTER TABLE ${table} DROP COLUMN ${column};`);
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
