# CK Accounting — Full System Audit

**Audited by:** Lead Software Architect  
**Date:** 2026-04-20  
**Codebase:** Expo Router + React Native + SQLite (offline-first accounting app)  
**Backend:** Laravel API at `https://techdev.tj/api/v1`

---

## 1. Executive Summary

The architecture shows genuine engineering effort toward offline-first design. The outbox/queue pattern, cursor-based sync, idempotency keys, and per-field conflict resolution demonstrate mature thinking. However, the implementation contains **one critical inventory corruption bug**, **one remote-sales data loss bug**, a **SQL injection vulnerability**, and a **DB initialization race condition** that can silently break core features on first launch. The system is not production-safe in its current form without fixing the critical and major issues below.

**Risk level: HIGH.** Core accounting data (inventory counts, sale item history) can be corrupted silently.

---

## 2. Critical Issues 🔴

### C1 — Inventory Corruption via Pending Stock Delta Race Condition

**File:** [`lib/sync/SyncContext.tsx:156-178`](lib/sync/SyncContext.tsx), [`lib/db/index.ts:32-54`](lib/db/index.ts), [`lib/sync/OutboxProcessor.ts:93-99`](lib/sync/OutboxProcessor.ts)

The periodic interval timer (every 60 s) calls `orchestrator.current.syncAll()` **without checking `syncLock`**. Simultaneously, `useEffect` on network reconnect (line 131) also calls `syncAll()` directly without the lock. This allows concurrent sync runs.

**Corruption sequence:**

1. User creates offline sale: `stock = 95`, `pending_delta = -5`
2. App comes online → `syncOutbox()` starts processing the sale
3. Simultaneously, timer fires → another `syncAll()` starts
4. Timer's `refreshAll()` fetches server product (server stock = 100, sale not yet confirmed): `insertOrUpdateProducts` sees `delta = -5 ≠ 0` → merges: `mergedStock = 95`, **resets `pending_delta = 0`**
5. Original `syncOutbox()` finishes: `onSaleSyncSuccess(id, 5)` → `pending_delta += 5` → **`pending_delta = +5`** (now positive, wrong)
6. Next product refresh: server stock = 95 (correctly decremented), local merges: `95 + 5 = 100` → **ghost inventory: +5 units**

The bug is in `insertOrUpdateProducts` hardcoding `pending_stock_delta = 0` (literal in VALUES) when merging. Once the delta is consumed into `mergedStock`, a later `onSaleSyncSuccess` increments it into positive territory.

**Impact:** Silent, permanent inventory inflation. Every time this race occurs, stock increases by the sold quantity. The app shows more stock than actually exists.

---

### C2 — Remote Sales Display No Items (Data Loss in UI)

**File:** [`lib/db/index.ts:741`](lib/db/index.ts), [`lib/db/index.ts:598-617`](lib/db/index.ts)

`insertOrUpdateRemoteSales` stores synced server sales with `local_id = null` (line 742). `mapRowToSale` calls `getSaleItemsForLocalId(r.local_id)`. At line 598-600:

```typescript
async function getSaleItemsForLocalId(localId: string): Promise<SaleItem[]> {
  if (!localId) return [];
```

Since `local_id` is `null` for all server-synced records, **every sale fetched from the server displays with zero items**. The sale header (total, date) shows correctly, but the line items are empty.

The `sale_items` table is only populated during offline creation (via `CreateSaleUseCase`). Remote sales only have data in the JSON blob `sales.items` column, which `mapRowToSale` never reads.

**Impact:** Users cannot see what was in any sale that originated on another device or was created while online. Accounting records are incomplete.

---

### C3 — SQL Injection via Server-Provided Column Names

**File:** [`lib/sync/ConflictContext.tsx:74-84`](lib/sync/ConflictContext.tsx)

```typescript
const sets = Object.keys(chosenData)
  .filter((k) => !CONFLICT_IGNORED_FIELDS.has(k))
  .map((k) => `${k} = ?`)   // k is a column name — not sanitized
  .join(", ");
```

`chosenData` comes from `conflict.serverData`, which comes directly from the 409 response body parsed in `OutboxProcessor.ts` (line 167):

```typescript
const serverData = responseData?.server_data ?? responseData?.data ?? {};
```

A malicious or compromised server response containing `{ "stock_quantity, id = 1 WHERE 1=1; --": 0 }` would generate:

```sql
UPDATE products SET stock_quantity, id = 1 WHERE 1=1; -- = ?, sync_action = 'none' WHERE local_id = ?
```

**Impact:** Full SQLite database compromise if the backend is ever exploited or returns unexpected shapes. Column names must be validated against a known allowlist before interpolation.

---

### C4 — Database Not Initialized Before SyncProvider Queries It

**File:** [`app/_layout.tsx:85-131`](app/_layout.tsx), [`lib/db/schema.ts:14-248`](lib/db/schema.ts)

`SyncProvider` is mounted in the React tree **before** `AuthGuard` calls `initDb()`. On first install (or fresh DB), `SyncProvider.useEffect` (line 118) immediately calls `refreshPendingActions()` → `getDb()` → queries `sync_queue`, `products`, etc. — none of which exist yet.

`initDb()` is gated behind `isLoaded` (auth loaded from SecureStore) and runs in `AuthGuard.useEffect`. `AuthGuard` is a sibling of `SyncProvider` in the tree, not a parent. React renders siblings in order, but `useEffect` hooks fire after all children mount, meaning `SyncProvider`'s effects fire at the same time as `AuthGuard`'s, with no ordering guarantee.

On first install: `initDb()` may not have run `CREATE TABLE IF NOT EXISTS` yet when `SyncProvider` queries. Errors are swallowed with `catch(console.error)`, so the failure is silent. `pendingActionsCount` starts at 0 (appearing correct), but any sync activity is silently lost.

**Impact:** On fresh install or DB corruption recovery, sync state is invisible until the next app restart.

---

## 3. Major Issues 🟠

### M1 — No Sync Lock on Periodic and Auto-Sync Paths

**File:** [`lib/sync/SyncContext.tsx:129-179`](lib/sync/SyncContext.tsx)

`triggerSync()` (user-initiated, line 81) uses `syncLock`. But:
- `useEffect` at line 131: `orchestrator.current.syncAll()` — no lock
- `setInterval` at line 160: `orchestrator.current.syncAll()` — no lock

Two concurrent `syncAll()` calls will both:
- Submit the same pending actions concurrently (mitigated by `claimPendingSyncActions` atomicity, but HTTP requests still duplicate)
- Run `refreshAll()` twice, causing double conflict detection
- Trigger the C1 delta race condition

The `syncLock` was implemented for `triggerSync` but not applied to the two more common sync paths.

---

### M2 — `signInOffline` Grants Access Without Verifying Any Credential

**File:** [`store/auth.tsx:164-186`](store/auth.tsx)

```typescript
const signInOffline = React.useCallback(async (): Promise<boolean> => {
    const [passwordHash, salt, token, userJson] = await Promise.all([...]);
    if (!passwordHash || !salt || !token) return false;
    // Only checks that a hash EXISTS, does not verify the user's password
    setState({ isLoaded: true, token, user, ... });
    return true;
  }, []);
```

`signInOffline` sets the authenticated state solely by checking that *a* password hash is stored. It does not verify the user's current password or PIN against that hash. Any code path that calls `signInOffline()` before PIN verification bypasses authentication entirely.

If `login.tsx` calls `signInOffline()` as a fallback without first checking PIN, an attacker with physical access to the device can enter *any* PIN and gain access (the PIN check might fail but `signInOffline` would still be called). Without reading `login.tsx`, this is a conditional risk — but the function itself is inherently dangerous.

---

### M3 — Entity Type Hardcoded as "product" for All 409 Conflicts

**File:** [`lib/sync/OutboxProcessor.ts:171`](lib/sync/OutboxProcessor.ts)

```typescript
const conflict = detectConflict(localId ?? String(serverData.id), "product", reqPayload, serverData);
```

This line is reached for ANY 409 response from ANY endpoint (sales, expenses, purchases, debts). All conflicts are categorized as "product", which means:
1. `resolveConflict` calls `entityTableForType("product")` → always updates the `products` table
2. A conflict on a `/sales` endpoint would attempt to write sale data into the `products` table

**Impact:** Non-product conflicts (sales, debts, expenses) will corrupt the `products` table or silently fail if the UPDATE finds no matching `local_id`.

---

### M4 — Stock Decrement Outside Transaction in CreateSaleUseCase

**File:** [`lib/sync/usecases/CreateSaleUseCase.ts:135-232`](lib/sync/usecases/CreateSaleUseCase.ts)

```typescript
await db.withTransactionAsync(async () => {
    // Sale, sale_items, sync_queue written atomically ✓
});

// OUTSIDE transaction:
if (input.type === "product") {
    for (const item of input.items) {
        await decrementLocalProductStock(item.product_id, item.quantity);
        // low-stock check...
    }
}
```

If the app crashes, loses power, or the process is killed between the transaction commit and `decrementLocalProductStock`, the sale is recorded in the DB (and will sync to server) but inventory is never decremented locally. The user sees an inflated stock count until the next full sync overwrites it.

**Impact:** Inventory inflation per missed decrement. In low-battery or force-quit scenarios, this will silently over-report available stock.

---

### M5 — Reports and Dashboard Are Online-Only with Short TTL

**Files:** [`lib/api.ts:739-758`](lib/api.ts), [`lib/db/index.ts:1245-1300`](lib/db/index.ts)

Reports (`/reports/sales`, `/reports/profit`, etc.) have no local computation fallback. The `reports_cache` TTL is 10 minutes. The `dashboard_cache` TTL is 5 minutes. After expiry, if the device is offline, the user sees empty/error states for the primary business intelligence screens.

For an accounting app used in markets or shops with unreliable connectivity, this is a major offline-first failure. The data is available locally in `sales`, `expenses`, `purchases`, `products` tables — but the app always delegates aggregation to the server.

---

### M6 — `insertOrUpdateRemoteSales` Does Not Populate `sale_items` Table

**File:** [`lib/db/index.ts:724-764`](lib/db/index.ts)

The normalized `sale_items` table is only written by `createSaleUseCase` (offline creation) and `insertOrUpdateSale` (utility function). `insertOrUpdateRemoteSales` (the main inbound sync path for all server sales) writes to `sales.items` (JSON blob) but **never writes to `sale_items`**.

This means:
- Offline-created sales: items in `sale_items` ✓ (but also JSON blob)
- Server-synced sales: items only in JSON blob, `sale_items` empty

`mapRowToSale` ignores the JSON blob. All remotely-synced sales appear with no items. (This is the direct cause of C2, but the schema inconsistency deserves separate attention.)

---

### M7 — No Foreign Key Constraints on `sale_items`

**File:** [`lib/db/schema.ts:201-214`](lib/db/schema.ts)

```sql
CREATE TABLE IF NOT EXISTS sale_items (
    sale_local_id TEXT NOT NULL,
    ...
);
```

No `FOREIGN KEY (sale_local_id) REFERENCES sales(local_id) ON DELETE CASCADE`. SQLite foreign keys are also disabled by default (`PRAGMA foreign_keys = ON` is never called anywhere). Deleting a sale doesn't cascade to `sale_items`. Orphaned rows accumulate.

Same issue: `debt_transactions` has no FK to `debts`.

---

### M8 — `getPendingSyncActions` Returns No 'Dead' Actions Despite Filter Expecting Them

**File:** [`lib/db/index.ts:519-524`](lib/db/index.ts), [`lib/sync/OutboxProcessor.ts:249-258`](lib/sync/OutboxProcessor.ts)

```typescript
export async function getPendingSyncActions(): Promise<SyncAction[]> {
    return db.getAllAsync<SyncAction>(
        "SELECT * FROM sync_queue WHERE status IN ('pending', 'failed') ORDER BY id ASC LIMIT 50"
    );
}
```

But in `refreshCounts`:
```typescript
const allFailed = await getPendingSyncActions();
return {
    failed: allFailed.filter((a) => a.status === "failed" || a.status === "dead"),
};
```

`getPendingSyncActions` never returns `'dead'` rows (excluded by the WHERE clause). The filter for `"dead"` will always find nothing. `deadActionsCount` in the UI will always be correct (from `getDeadSyncActionsCount`), but `failedActions` array in the context will never contain dead items, making the `/sync-errors` screen incomplete.

---

### M9 — PBKDF2 Runs Synchronously on the JS Thread

**File:** [`store/auth.tsx:57-61`](store/auth.tsx)

```typescript
async function hashPassword(password: string, salt: string): Promise<string> {
    const key = pbkdf2(sha256, password, salt, { c: 100_000, dkLen: 32 });
    return bytesToHex(key);
}
```

`pbkdf2` from `@noble/hashes` is a **synchronous** function. Despite being in an `async` function, it runs entirely on the JS thread. At 100,000 iterations of SHA-256, this is approximately 200ms of CPU-bound work that **blocks the entire React Native UI thread**.

During login, the app freezes for 200ms. On slower devices, this could be 500ms+. There is no spinner or loading state shown during this computation (the function is async but the sync work blocks before any `await` yields).

---

## 4. Minor Issues 🟡

### Y1 — `addConflict` in ConflictContext Calls `_externalAddConflict` on Itself

**File:** [`lib/sync/ConflictContext.tsx:52-58`](lib/sync/ConflictContext.tsx)

```typescript
const addConflict = useCallback((conflict: Conflict) => {
    setConflicts(...); // adds to state
    _externalAddConflict?.(conflict); // also calls the module-level handler — which also calls setConflicts
}, []);
```

The `useEffect` sets `_externalAddConflict` to a function that calls `setConflicts`. When `addConflict` (the context method) is called internally, it calls `setConflicts` twice — once directly and once via `_externalAddConflict`. Deduplication (`prev.some(c => c.id ===)`) prevents double-adding, but the redundant call is a logic error.

---

### Y2 — `isOnline` Starts as `true`, Will Flip to `false` Briefly on Android

**File:** [`lib/sync/SyncContext.tsx:48`](lib/sync/SyncContext.tsx), [`lib/sync/SyncContext.tsx:120-125`](lib/sync/SyncContext.tsx)

```typescript
const [isOnline, setIsOnline] = useState(true);
```

On Android, `NetInfo.isInternetReachable` returns `null` initially. `!!null === false`. So on Android, `isOnline` starts as `true` (from `useState`), then flips to `false` on the first NetInfo event (since `isInternetReachable` is `null`), triggering an unnecessary `refreshPendingActions` call and briefly showing the app as offline.

---

### Y3 — N+1 Query Pattern in `getLocalSales`

**File:** [`lib/db/index.ts:766-777`](lib/db/index.ts)

```typescript
const results = await db.getAllAsync<SaleRow>(query, params);
return Promise.all(results.map(mapRowToLocalSale)); // N+1
```

`mapRowToLocalSale` → `mapRowToSale` → `getSaleItemsForLocalId` (one SELECT per sale). For 100 sales, this is 101 sequential queries inside a `Promise.all`. Since SQLite in expo-sqlite serializes operations, this is effectively sequential, not parallel.

**Fix:** One JOIN query: `SELECT s.*, si.* FROM sales s LEFT JOIN sale_items si ON si.sale_local_id = s.local_id WHERE ...`

---

### Y4 — No Index on `products.shop_id`

**File:** [`lib/db/schema.ts`](lib/db/schema.ts)

`getLocalProducts(shop_id)` runs `SELECT * FROM products WHERE shop_id = ?` on every screen load. There is no index on `shop_id`. Migration v12 adds indexes on `products.updated_at` and `sales.created_at` but misses `shop_id`, which is the primary filter dimension for a multi-shop app.

---

### Y5 — `clearLocalData` Doesn't Clear Sync Metadata or Notifications

**File:** [`lib/db/schema.ts:255-268`](lib/db/schema.ts)

```typescript
export async function clearLocalData() {
    await db.execAsync(`
        DELETE FROM products;
        DELETE FROM sync_queue;
        ...
    `);
}
```

`sync_metadata` (sync timestamps), `notifications`, `low_stock_alerts_sent`, `schema_version` are NOT cleared. After `clearLocalData`, the sync cursors (`products_last_synced_at`, etc.) still point to old timestamps, causing incremental sync to miss data. Stale notifications also persist across logouts.

---

### Y6 — Schema Migration Has Version Tracking Bug

**File:** [`lib/db/schema.ts:237-247`](lib/db/schema.ts)

```typescript
await db.withTransactionAsync(async () => {
    for (const migration of MIGRATIONS) {
        if (migration.version > currentVersion) {
            const needsMigration = migration.check ? await migration.check(db) : true;
```

The `check` function calls `columnExists()` which runs `PRAGMA table_info(table)` **inside the transaction**. If the current transaction has already added the column (in an earlier migration step of the same transaction), the PRAGMA may not reflect it correctly in all SQLite versions. This can cause migrations to re-run and fail with "duplicate column" errors.

Additionally, there is only one row in `schema_version`. `INSERT OR REPLACE` overwrites the version on every migration, but the `SELECT version FROM schema_version LIMIT 1` before the loop reads only the latest version. If migrations v8–v12 all ran but the app crashed before v13 could commit, the transaction rolls back and version stays at 7. On restart, v8–v12 re-run. Most are idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), but `ALTER TABLE ADD COLUMN` is not — it would throw if the column already exists. The `check` guard mitigates this, but it's fragile.

---

### Y7 — Token Refresh Endpoint Exists But Is Never Called

**File:** [`lib/api.ts:562-566`](lib/api.ts)

```typescript
refresh: (token: string) =>
    request<{ token: string }>(AUTH_ENDPOINTS.refresh, { method: "POST", token }),
```

Defined but never invoked. On 401, `triggerTokenExpiry()` forces full re-login. If the backend supports token refresh, this is an unnecessary UX disruption (user is logged out and must re-enter credentials instead of transparently getting a new token).

---

### Y8 — `Math.random()` Used for Idempotency Key Generation

**File:** [`lib/sync/usecases/CreateSaleUseCase.ts:48`](lib/sync/usecases/CreateSaleUseCase.ts)

```typescript
const idempotencyKey = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
```

`Math.random()` is not cryptographically secure. For idempotency keys, collision resistance is critical. Use `expo-crypto`'s `getRandomBytesAsync(16)` (already imported in auth store) to generate a UUID/random key.

---

### Y9 — `DashboardSummary` Uses `any[]` for Several Fields

**File:** [`lib/api.ts:368-372`](lib/api.ts)

```typescript
recent_expenses: any[];
recent_debt_transactions: any[];
unpaid_debts: any[];
```

These fields bypass TypeScript's type safety. If the server changes the response shape, no compile-time error is raised and runtime crashes occur silently.

---

### Y10 — Unused Dependency: `@react-native-async-storage/async-storage`

The package is installed but no code imports from it. All storage uses `expo-secure-store` and SQLite. Dead dependency increases bundle size and attack surface.

---

### Y11 — Hard-Coded Russian Strings Throughout Codebase

Error messages, alert titles, and notification text are hard-coded in Russian with no i18n abstraction. Examples: `"Ошибка синхронизации"` (SyncContext:169), `"Мало товара"` (multiple files). This blocks internationalization and makes string changes require code deploys.

---

### Y12 — `signOut` Closure Captures Stale `state.token`

**File:** [`store/auth.tsx:256-269`](store/auth.tsx)

```typescript
const signOut = React.useCallback(async () => {
    if (state.token) {
        api.auth.logout(state.token).catch(() => {});
    }
    ...
}, [state.token]);
```

`state.token` in `useCallback` dependencies means the callback is recreated on every token change. This is correct but means any component holding a stale `signOut` reference won't fire logout. More critically, if `tokenExpired` is true, `state.token` is `null` (set in `registerTokenExpiryHandler` callback), so logout is skipped silently.

---

## 5. Offline-First Assessment ⭐

### What Is Implemented Correctly

- **Outbox/queue pattern**: All mutations go through `sync_queue`. Atomic claim prevents double-processing. FIFO ordering preserved.
- **Idempotency keys**: Offline-created entities use `local-{type}-{localId}` keys, preventing duplicates on retry.
- **Cursor-based incremental sync**: `after_id` + `updated_since` prevents full table scans on each sync cycle.
- **Optimistic stock management**: `pending_stock_delta` concept is architecturally correct for tracking offline inventory changes. The implementation has a critical bug (C1) but the design is sound.
- **Conflict detection**: Per-field strategy (additive/last-write-wins/max/manual) is a sophisticated and appropriate approach.
- **Processing recovery**: `status = 'processing'` rows reset to `pending` on app startup (schema.ts:229-232), preventing stuck actions from a crash.
- **Auth offline**: PBKDF2-hashed password stored in SecureStore enables offline login verification.
- **Background sync**: `expo-background-fetch` + foreground re-entry sync ensure eventual consistency.
- **Network detection**: NetInfo integration correctly prevents sync when offline.

### What Is Missing / Broken

1. **Remote sale items not stored in normalized table** → all server-synced sales appear with no items (C2)
2. **Reports have no offline fallback** → core accounting screens fail offline (M5)
3. **Dashboard cache is server-computed** → can't rebuild locally from SQLite data
4. **No sync for debts/expenses when `sync_action != 'none'`** — `insertOrUpdateDebts` has no conflict detection (unlike products). Debt changes from another device silently overwrite local pending changes.
5. **No retry UI** — dead actions are visible in `/sync-errors` but the user cannot selectively retry or edit them
6. **Concurrent sync not protected** → C1 and M1
7. **DB not ready when SyncProvider starts** → C4

### Verdict

**This is partially offline-first.** CRUD operations (sales, expenses, purchases) work correctly offline. The sync architecture has the right bones. However, the inventory count corruption (C1), missing sale items on remote records (C2), and offline-breaking reports (M5) mean the system cannot be trusted for production accounting use without fixes.

---

## 6. Data Consistency & Sync Analysis

### Sync Model

- **Type:** Outbox (push) + periodic pull. Bidirectional in effect.
- **Ordering:** FIFO on outbox. Pull is cursor-based (eventually consistent).
- **Conflict strategy:** 409 from server → per-field detection → auto-resolve where possible, UI modal for manual fields.

### Conflict Risks

| Scenario | Handled? | Risk |
|---|---|---|
| Two offline sales for same product | ✅ `pending_stock_delta` accumulation | C1 race still exists |
| Two devices edit same product | ✅ 409 → modal | M3: entity type hardcoded as "product" |
| Two devices edit same sale | ❌ No conflict detection for sales | Data loss: last write wins silently |
| Two devices edit same debt | ❌ `insertOrUpdateDebts` has no conflict detection | Silent overwrite |
| Sale fails server validation | ✅ `cancelPendingStockDelta` restores stock | Works correctly |
| Network cut mid-sync | ✅ Processing → pending recovery on restart | Works correctly |

### Data Integrity Risks

- `sales.items` (JSON blob) and `sale_items` table diverge for any remote sync (M6)
- `pending_stock_delta` can go positive (ghost inventory) under concurrent sync (C1)
- Stock decrement outside transaction can leave stock inflated on crash (M4)
- No FK constraints → orphaned `sale_items`, `debt_transactions` accumulate over time

---

## 7. Architecture Review

### Strengths

- **Clean separation between sync logic and React**: `SyncOrchestrator`, `OutboxProcessor`, `RemoteXFetcher` have zero React imports. `TokenExpiryBridge` and `SuspensionBridge` use dependency injection (module-level callbacks) to break circular dependencies elegantly.
- **Strong TypeScript types**: All API shapes are fully typed. `LocalProduct`, `LocalSale` etc. extend server types with sync metadata — good pattern.
- **RBAC**: `lib/permissions.ts` provides centralized, auditable permission checks.
- **Single DB instance**: `getDb()` singleton with `openDatabaseSync` avoids connection pool issues.
- **Migration system**: Version-tracked migrations with idempotency checks (column existence guards).

### Weaknesses

- **SyncProvider / AuthGuard / DB init sequencing**: No explicit initialization dependency graph. Components assume DB is ready when it may not be (C4).
- **`lib/db/index.ts` is 1400 lines**: A monolithic file mixing schema types, CRUD, sync helpers, cache management, notifications. Should be split into domain modules (`productRepository.ts`, `saleRepository.ts`, etc.).
- **Two code paths for offline sale creation**: `createSaleUseCase` and `insertOrUpdateSale` both insert sales + queue sync actions, with divergent behavior. This will cause confusion and bugs.
- **No unit tests or integration tests visible**: The entire sync/offline logic is untested. The C1 race condition would be immediately caught by a concurrency test.
- **`any` types in DB queries**: `getAllAsync<any>` throughout `lib/db/index.ts`. Column mapping is manual and error-prone.

### Best Practice Violations

- **Open/Closed:** `OutboxProcessor.processAction` has `if (action.method === "POST" && action.path === "/sales")` hardcoded twice. Adding a new entity type requires modifying this method.
- **Single Responsibility:** `createSaleUseCase` handles: stock validation, DB insert, sync queue, low-stock check, online fallback, offline storage. Too many responsibilities.
- **DRY:** Stock decrement logic is duplicated between `CreateSaleUseCase` (offline path) and should mirror the online path cleanup.

---

## 8. Security Issues

| Issue | Severity | Location |
|---|---|---|
| SQL injection via server column names in `resolveConflict` | 🔴 Critical | `ConflictContext.tsx:74` |
| `signInOffline` grants auth without credential verification | 🔴 Critical | `store/auth.tsx:164` |
| `Math.random()` for idempotency/security keys | 🟡 Minor | `CreateSaleUseCase.ts:48` |
| PBKDF2 blocking UI thread (DoS on slow devices) | 🟠 Major | `store/auth.tsx:59` |
| Photo upload accepts any file URI, no type/size validation | 🟡 Minor | `OutboxProcessor.ts:70-78` |
| Stale cached user persisted indefinitely in SecureStore | 🟡 Minor | `store/auth.tsx:119-134` |
| No certificate pinning (MITM possible) | 🟡 Minor | `lib/api.ts` |

**Most urgent:** Fix C3 (SQL injection) and M2 (auth bypass) before any production deployment.

---

## 9. Performance Bottlenecks

| Issue | Impact | Location |
|---|---|---|
| N+1 queries in `getLocalSales` | High: 101+ queries per sales screen load | `lib/db/index.ts:776` |
| Missing index on `products.shop_id` | Medium: full table scan on every product list | `lib/db/schema.ts` |
| PBKDF2 sync on JS thread (200ms+) | High: UI freeze on login | `store/auth.tsx:59` |
| Concurrent `syncAll()` runs duplicate HTTP requests | Medium: wastes bandwidth, increases server load | `SyncContext.tsx:131,160` |
| `claimPendingSyncActions(50)` in single batch | Low-Medium: 50 sequential HTTP requests before UI unblocks | `OutboxProcessor.ts:229` |
| No progressive loading for large product lists | Medium: `SELECT * FROM products` with no LIMIT/pagination | `lib/db/index.ts:106-121` |
| `refreshAll()` fetches all 4 entity types in parallel | Low: good pattern, may overwhelm slow connections | `SyncOrchestrator.ts:55` |
| Reports cache TTL 10 min, not adjustable | Low: frequent API calls if user refreshes reports | hardcoded |

---

## 10. Recommendations

### Fix Immediately (before any production deployment)

1. **Fix C1** — Add `syncLock` to the periodic interval and auto-sync `useEffect`. Do not reset `pending_stock_delta` to 0 in `insertOrUpdateProducts`; instead preserve it after merging stock.

2. **Fix C2** — In `insertOrUpdateRemoteSales`, populate `sale_items` from `sale.items` JSON. In `mapRowToSale`, fall back to parsing `r.items` JSON when `getSaleItemsForLocalId` returns empty.

3. **Fix C3** — In `resolveConflict`, validate all keys in `chosenData` against a hardcoded allowlist of valid column names before building the SQL `SET` clause.

4. **Fix C4** — Move `initDb()` call to before `SyncProvider` mounts. Use a top-level `useState` + `useEffect` in `RootLayout` to gate rendering of `SyncProvider` until `isDbReady === true`.

5. **Fix M3** — In `OutboxProcessor.processAction`, derive entity type from the action's `path` using `entityTableForPath()` (already exists) instead of hardcoding `"product"`.

### Fix Soon

6. **Fix M1** — Apply `syncLock` to all sync paths, or replace the ref with a proper async mutex.

7. **Fix M2** — Audit the login screen flow. Ensure `signInOffline()` is only called AFTER successful PIN/password verification, or rename it to clarify its intent.

8. **Fix M4** — Move `decrementLocalProductStock` calls inside the transaction in `createSaleUseCase`.

9. **Fix M6** — Consolidate to a single `sale_items` source of truth. Remove the duplicate JSON blob in `sales.items` or make `mapRowToSale` handle both cases.

10. **Fix M9** — Run PBKDF2 inside `expo-task-manager` or use a Web Worker to avoid blocking the UI thread. Show a loading indicator during the computation.

### Improve Soon

11. Add `PRAGMA foreign_keys = ON` after every DB open.
12. Add index: `CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id)`.
13. Fix `getLocalSales` N+1 with a JOIN query.
14. Fix `getPendingSyncActions` to include `'dead'` status so `/sync-errors` screen shows all failed items.
15. Fix `clearLocalData` to also clear `sync_metadata`, `notifications`, `low_stock_alerts_sent`.
16. Implement offline report computation from local SQLite data (aggregations on `sales`, `expenses`, `products`).
17. Implement token refresh before forcing re-login on 401.

### Optional Enhancements

18. Extract `lib/db/index.ts` into domain repositories.
19. Add conflict detection for debts and sales (not just products).
20. Replace `Math.random()` with `expo-crypto.getRandomBytesAsync` for all key generation.
21. Add telemetry for sync failure rates, conflict frequency, delta drift.
22. i18n extraction for all hardcoded Russian strings.
23. Remove unused `@react-native-async-storage/async-storage` dependency.

---

## 11. Fix Roadmap

### Phase 1 — Stop Data Corruption (Immediate, ~1–2 days)

1. **C3:** Whitelist-validate column names in `resolveConflict` before SQL interpolation
2. **M3:** Fix entity type in `OutboxProcessor` 409 handler (1 line change)
3. **C2:** Fix `insertOrUpdateRemoteSales` to write to `sale_items`; fix `mapRowToSale` fallback
4. **M4:** Move stock decrement inside `createSaleUseCase` transaction

### Phase 2 — Stabilize Sync Layer (~2–3 days)

5. **C1 + M1:** Add sync lock to all sync paths; fix `pending_stock_delta` reset logic
6. **C4:** Ensure DB is initialized before any sync consumer mounts
7. **M8:** Fix `getPendingSyncActions` to include 'dead' status
8. **Y5:** Fix `clearLocalData` to clear all relevant tables

### Phase 3 — Fix Core Features (~1–2 days)

9. **M5:** Implement offline report aggregation from local tables
10. **M6:** Consolidate sale items to single source of truth
11. **Y3:** Fix N+1 queries in sale loading
12. **Y4:** Add missing DB index on `products.shop_id`

### Phase 4 — Harden Security and Auth (~1 day)

13. **M2:** Audit and fix `signInOffline` authentication gate
14. **M9:** Move PBKDF2 off the UI thread
15. **Y8:** Use cryptographically secure RNG for keys
16. Add `PRAGMA foreign_keys = ON` post DB open

### Phase 5 — Architecture and UX Improvements (~3–5 days)

17. Token refresh on 401 (before forcing re-login)
18. Conflict detection for sales and debts
19. Split `lib/db/index.ts` into domain repositories
20. i18n for all user-facing strings
21. Retry UI in `/sync-errors` screen (per-action retry button)
22. Telemetry/observability for sync health

---

*Total critical/blocking issues: 4. None of them are cosmetic — all affect data integrity or security in core accounting workflows.*
