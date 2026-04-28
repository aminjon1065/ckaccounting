# Module: sync

## Status
Sync layer is architecturally sound but has three significant bugs: (1) `onSaleSyncSuccess` is never called in OutboxProcessor (already noted in sales module), (2) cross-user sales data is not cleaned from local DB for Sellers (there is a TODO comment acknowledging this), and (3) `SyncContext.refreshProducts` / `fetchRemoteDebts` use captured closure values instead of refs, creating stale-closure bugs after token refresh.

## Bugs

### Bug 1: TODO comment in `RemoteSaleFetcher` — cross-user sale data not cleaned for Seller
- Severity: High
- Role: Seller
- Platform: Mobile

**Description:**
`lib/sync/RemoteSaleFetcher.ts:51-54` has an explicit TODO:
```ts
// TODO: For Seller role, delete cross-user sales after insert.
// Requires role and userId in SaleFetcherDeps — add when refactoring getDeps.
```
The server correctly scopes `GET /sales` by user for Sellers (via `SalePolicy::view`). But if the device was previously logged in as Owner (who syncs all shop sales), those sales remain in the local `sales` table. A Seller who logs in on the same device (different user, same shop) sees all previous sales from the Owner's session in the local DB. `getLocalSales` is called with `userId` filter for Sellers, so the DISPLAY is correct — but raw DB contains other users' sales which is a privacy violation on a shared/rooted device.

**Steps to reproduce:**
1. Owner logs in, syncs → all shop sales in local DB.
2. Owner logs out. Seller logs in.
3. Inspect local DB `sales` table — Owner's sales are present (just filtered from display).

**Expected:**
On full sync, Seller's session should purge sales not belonging to them from local DB.

**Actual:**
`lib/sync/RemoteSaleFetcher.ts:51-54` — acknowledged TODO, not yet implemented.

**Root cause:**
`lib/sync/RemoteSaleFetcher.ts:51-54` — missing cleanup after `insertOrUpdateRemoteSales`.

---

### Bug 2: `SyncContext.refreshProducts` and `fetchRemoteDebts` use stale closure values
- Severity: Medium
- Role: Both
- Platform: Mobile

**Description:**
In `SyncContext.tsx`:
```ts
const refreshProducts = useCallback(async (forceFullSync = false) => {
  if (!isOnline || !token || tokenExpired) return;  // line 158 — captures stale closures
  await orchestrator.current.refreshAll(forceFullSync);
}, [isOnline, token, tokenExpired]);
```
While `isOnline`, `token`, and `tokenExpired` are listed as dependencies, this callback is re-created on every state change. The ref-based pattern used by `triggerSync` (which reads from `isOnlineRef.current`, `tokenRef.current`) avoids stale-closure bugs in event-driven paths. The `refreshProducts` callback does NOT use refs — if it's called inside an event handler or timer that captured a stale version of the callback, it reads stale state.

The main risk: `fetchRemoteDebts` and `fetchRemoteShops` (lines 162-170) both call `orchestrator.current.refreshAll()` — which does a full sync including expenses and purchases. These functions are named as single-entity fetchers but actually trigger a complete `refreshAll`. This is wasteful and can cause SQLite transaction contention.

**Steps to reproduce:**
1. Open Debts screen and call `fetchRemoteDebts()`.
2. Observe all fetchers (products, sales, expenses, purchases) triggered, not just debts.

**Expected:**
`fetchRemoteDebts()` should only refresh debts, not all entities.

**Actual:**
`SyncContext.tsx:162-165` — calls `orchestrator.current.refreshAll()` which runs every fetcher.

**Root cause:**
`lib/sync/SyncContext.tsx:162-170` — `fetchRemoteDebts` and `fetchRemoteShops` call the full `refreshAll` instead of their specific fetchers.

---

### Bug 3: `archiveSyncActions` called with raw string interpolation — SQL injection risk
- Severity: Low
- Role: Both
- Platform: Mobile

**Description:**
In `SyncContext.tsx:237`:
```ts
clearFailedActions: async () => {
  await archiveSyncActions("'failed', 'dead'");
```
The function `archiveSyncActions` receives a raw string `"'failed', 'dead'"` that is presumably interpolated directly into a SQL `IN(...)` clause. If the function uses string concatenation rather than parameterized queries, this is a SQL injection vector (minor, since the string is hardcoded here, but the function signature is dangerous by design).

**Steps to reproduce:**
Read `archiveSyncActions` implementation in `lib/db/index.ts` to confirm whether it uses parameterized queries.

**Expected:**
`archiveSyncActions` should accept a typed array or enum values, not a raw SQL fragment.

**Actual:**
`SyncContext.tsx:238` — passes `"'failed', 'dead'"` as a raw string.

**Root cause:**
`lib/sync/SyncContext.tsx:238` — raw SQL string passed to `archiveSyncActions`. The function interface is unsafe.

---

## Offline issues
- The `pendingReconnectSync` ref prevents dropped syncs when reconnect happens during an active sync. This is correctly implemented.
- However, if the app is backgrounded during a sync cycle, the `syncLock` remains `true` and the periodic 60-second timer queues a `pendingReconnectSync`. This means the next sync runs immediately when the app foregrounds — correct behavior.

## Mobile UX issues
- No AppState listener for foreground/background transitions. The sync only runs on online/token change and periodic 60s timer. If the app is foregrounded after 5 minutes of background, no immediate sync is triggered until the next 60s tick.
