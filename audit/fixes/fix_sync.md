# Fix Plan: sync

### Fix for Bug 1: Cross-user sales not purged for Seller after sync

**Goal:** After Seller sync, delete sales from local DB that don't belong to this user.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/sync/RemoteSaleFetcher.ts`
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/sync/SyncOrchestrator.ts`

**Changes:**
1. Add `role` and `userId` to `SaleFetcherDeps`:
```ts
export interface SaleFetcherDeps {
  token: string;
  shopId: number | undefined;
  role?: string;
  userId?: number;
}
```

2. Pass them from `SyncOrchestrator` constructor:
```ts
this.saleFetcher = new RemoteSaleFetcher(() => ({
  token: getDeps().token,
  shopId: getDeps().shopId,
  role: getDeps().role,
  userId: (getDeps() as any).userId,
}));
```
Note: `SyncContext` sets `getDeps` via `authRef.current` which has `{ token, shopId, role }`. Add `userId: user?.id` to `authRef.current`.

3. In `RemoteSaleFetcher.fetch()`, after all pages are inserted, add cleanup:
```ts
// Resolve the TODO at line 51:
if (this.deps().role === "seller" && this.deps().userId) {
  const { getDb } = await import("../db");
  const db = getDb();
  await db.runAsync(
    "DELETE FROM sales WHERE user_id IS NOT NULL AND user_id != ? AND shop_id = ?",
    [this.deps().userId, shopId]
  );
}
```

4. In `SyncContext.tsx`, add `userId` to `authRef.current`:
```ts
authRef.current = { token: token ?? "", shopId: user?.shop_id, role: user?.role, userId: user?.id };
```

**Edge cases:**
- Sales with `user_id = NULL` (created by Owner before user_id tracking) should NOT be deleted.
- Only delete when `user_id IS NOT NULL AND user_id != ?` — the NULL guard is essential.

**Validation:**
1. Owner syncs → 10 sales in DB (various user_ids).
2. Seller logs in, syncs → sales with `user_id != seller.id` and `user_id IS NOT NULL` removed.

---

### Fix for Bug 2: `fetchRemoteDebts`/`fetchRemoteShops` trigger full refreshAll

**Goal:** Each named fetcher should only refresh its own entity.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/sync/SyncContext.tsx`

**Changes:**
Add individual fetcher methods to `SyncOrchestrator` and expose them:

In `SyncOrchestrator.ts`, add:
```ts
async refreshDebts(forceFullSync = false): Promise<void> {
  await this.debtFetcher.fetch(forceFullSync);
}

async refreshShops(): Promise<void> {
  await this.shopFetcher.fetch();
}
```

In `SyncContext.tsx`, update the callbacks:
```ts
const fetchRemoteDebts = useCallback(async () => {
  if (!isOnlineRef.current || !tokenRef.current || tokenExpiredRef.current) return;
  await orchestrator.current.refreshDebts();
}, []);

const fetchRemoteShops = useCallback(async () => {
  if (!isOnlineRef.current || !tokenRef.current || tokenExpiredRef.current) return;
  await orchestrator.current.refreshShops();
}, []);
```
Also switch these to use refs (like `triggerSync`) to avoid stale closures.

**Validation:**
1. Call `fetchRemoteDebts()` — only the debt fetcher network request appears in proxy.
2. Call `fetchRemoteShops()` — only shop fetcher runs.

---

### Fix for Bug 3: `archiveSyncActions` receives raw SQL string

**Goal:** Replace raw SQL fragment parameter with a typed array.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/db/index.ts`
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/sync/SyncContext.tsx`

**Changes:**
1. In `lib/db/index.ts`, redefine `archiveSyncActions` to accept an array:
```ts
export async function archiveSyncActions(
  statuses: Array<"pending" | "failed" | "dead" | "completed">
): Promise<void> {
  const db = getDb();
  const placeholders = statuses.map(() => "?").join(", ");
  await db.runAsync(
    `UPDATE sync_queue SET archived_at = ? WHERE status IN (${placeholders}) AND archived_at IS NULL`,
    [new Date().toISOString(), ...statuses]
  );
}
```
2. Update `SyncContext.tsx:238`:
```ts
clearFailedActions: async () => {
  await archiveSyncActions(["failed", "dead"]);
  setFailedActions([]);
},
```

**Validation:**
Run `clearFailedActions()`. Confirm `failed` and `dead` actions are archived. No SQL injection possible with array-based parameterized query.
