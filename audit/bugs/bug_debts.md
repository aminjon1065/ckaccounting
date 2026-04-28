# Module: debts

## Status
Debts module has a critical data visibility bug: `getLocalDebts` for Sellers passes `userId` only when `isSeller` is true, but the `apiPermissionMatrix` allows Sellers to create debts — meaning a Seller-created debt gets a `user_id` set. If another Seller is added to the same shop, both Sellers' debts appear in the same local SQLite table and the query scoping relies on `user_id` which may be null for old records.

## Bugs

### Bug 1: `ApiPermissionMatrix` allows Seller `debts:create` but `DebtPolicy::create()` also allows it — yet `debts:delete` frontend permission says Owner-only but backend `DebtPolicy::delete()` also allows it for Owner in same shop (not Seller). These are consistent. However `ApiPermissionMatrix` for `debts` has no `delete` entry at all.
- Severity: Medium
- Role: Owner
- Platform: Web / Mobile

**Description:**
`ApiPermissionMatrix.php` defines:
```php
'debts' => [
    'viewAny' => [...],
    'view' => [...],
    'create' => ['super_admin', 'owner'],  // ← Seller is MISSING here
    'update' => ['super_admin', 'owner'],
],
```
But `DebtPolicy::create()` calls `isOperationalRole()` which includes Seller:
```php
private function isOperationalRole(User $user): bool
{
    return $user->isSuperAdmin() || $user->shop_id !== null;
}
```
So the Policy allows Sellers to create debts, but the `ApiPermissionMatrix` MATRIX does not list `seller` for `debts.create`. If any middleware or gate uses `ApiPermissionMatrix::allows()` instead of the Policy, Sellers are blocked from creating debts inconsistently.

**Steps to reproduce:**
1. Authenticate as Seller.
2. `POST /api/v1/debts` with valid payload.
3. Result depends on which gate is checked first — Policy or Matrix.

**Expected:**
`ApiPermissionMatrix.php` `debts.create` should include `seller` to match `DebtPolicy::create()`.

**Actual:**
`ApiPermissionMatrix.php:39` — `'create' => ['super_admin', 'owner']` — missing `seller`.

**Root cause:**
`acc-backend/app/ApiPermissionMatrix.php:36-40` — `debts` section missing `seller` for `create`.

---

### Bug 2: Seller can see other users' debts if `user_id` is NULL in local DB
- Severity: Medium
- Role: Seller
- Platform: Mobile

**Description:**
`getLocalDebts()` at `lib/db/index.ts:715-750` applies a `user_id = ?` filter when `userId` is provided. However, debts synced from the server for the Owner (which have `user_id = null` or `user_id` of the Owner) are also stored in the same table. If a Seller queries debts and the server previously synced all shop debts (before the Seller came online), the `user_id = ?` filter only works if those records have `user_id` set. Records with `user_id = NULL` pass neither the user filter nor get excluded — they are filtered OUT correctly since `user_id = ?` won't match NULL.

Wait — actually `user_id = ?` does NOT match NULL rows in SQLite (NULL != any value). So Sellers correctly see only their own debts IF the DB contains nulls for others. But if a debt was created by a Seller with their user_id, and then that Seller is deleted, a different Seller could see that debt in the Owner's view. More importantly: the `getLocalDebts` scoping only applies when `isSeller` is passed — let me re-check the call site.

At `app/debts/index.tsx:360`:
```ts
const localDebts = await getLocalDebts(user?.shop_id, isSeller ? user.id : undefined);
```
This is correct — Seller path passes `user.id`, Owner path passes `undefined` (shows all shop debts). The issue is that the `RemoteDebtFetcher` fetches ALL debts for the shop (not just the current user's debts) and stores them. So Sellers, when syncing, get all shop debts into local DB. The display is correctly filtered, but the data is stored locally — a rooted device or DB inspection could reveal all shop debts to a Seller.

**Steps to reproduce:**
1. Sign in as Owner, sync debts. All shop debts in local DB.
2. Sign out, sign in as Seller on same device.
3. Inspect SQLite `debts` table — all shop debts present.
4. `getLocalDebts` display filtering is correct, but raw DB access reveals all debts.

**Expected:**
`RemoteDebtFetcher` should only fetch debts scoped to the current user for Seller role.

**Actual:**
`lib/sync/RemoteDebtFetcher.ts` fetches all shop debts regardless of role.

**Root cause:**
`lib/sync/RemoteDebtFetcher.ts` — no `user_id` scoping for Seller role. The server `DebtPolicy::view()` correctly restricts Seller to their own debts, but the fetch likely sends `GET /debts` which the backend scopes via `paginateForUser`. If backend correctly returns only the Seller's debts, the local DB pollution concern is mainly about stale data from previous user sessions.

---

### Bug 3: Debt `CreateDebtModal` sets error on sync failure but does NOT revert the local debt
- Severity: Medium
- Role: Both
- Platform: Mobile

**Description:**
In `app/debts/index.tsx:213-219`:
```ts
const syncOk = await triggerSync().catch(...);
if (!syncOk) {
  setError("Не удалось отправить на сервер. Попробуйте синхронизировать вручную.");
  return;
}
onCreated(newDebt);
onClose();
```
When `syncOk === false`, an error is shown but `newDebt` has ALREADY been inserted into the local DB at line 203 (`insertOrUpdateDebts`) and the sync action is queued. The UI shows an error but the debt IS in the local DB and WILL sync later. The user sees "failed" but the debt will appear on next refresh. This is confusing and may lead to duplicate creation.

**Steps to reproduce:**
1. Offline — triggerSync() returns false immediately.
2. Error is shown: "Не удалось отправить на сервер".
3. User taps "Create" again → second local debt queued.
4. Both debts sync when online → duplicate debt on server.

**Expected:**
If `triggerSync()` fails because we're offline, this should be considered a "queued for later" success, not an error. Only a definitive server rejection (4xx) should show an error.

**Actual:**
Any non-`true` return from `triggerSync()` (including offline returning `false`) shows an error and leaves the user confused.

**Root cause:**
`app/debts/index.tsx:213-219` — `triggerSync() === false` is treated as a failure, but it means "offline, will retry" not "server rejected."

---

## Offline issues
- Debt balance updates in `[id].tsx` write directly to the `debts` table and queue a sync action. If the user loses connection mid-session and the app crashes, the in-memory `balanceDelta` is applied but the DB write may not have completed atomically.

## Mobile UX issues
- Error message "Не удалось отправить на сервер. Попробуйте синхронизировать вручную." shown when simply offline — should instead show "Долг сохранён и будет отправлен при восстановлении сети."
