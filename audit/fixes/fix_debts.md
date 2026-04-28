# Fix Plan: debts

### Fix for Bug 1: `ApiPermissionMatrix` missing `seller` for `debts:create`

**Goal:** Align `ApiPermissionMatrix` with `DebtPolicy` so Sellers can create debts consistently.

**Files to modify:**
- `acc-backend/app/ApiPermissionMatrix.php`

**Changes:**
```php
// BEFORE (line ~39)
'debts' => [
    'viewAny' => ['super_admin', 'owner', 'seller'],
    'view' => ['super_admin', 'owner', 'seller'],
    'create' => ['super_admin', 'owner'],
    'update' => ['super_admin', 'owner'],
],
// AFTER
'debts' => [
    'viewAny' => ['super_admin', 'owner', 'seller'],
    'view' => ['super_admin', 'owner', 'seller'],
    'create' => ['super_admin', 'owner', 'seller'],
    'update' => ['super_admin', 'owner', 'seller'],
    'delete' => ['super_admin', 'owner'],
],
```

**Edge cases:**
- `update` for Seller is restricted to own debts in `DebtPolicy::update()`. Matrix only gates entry; policy enforces ownership.

**Validation:**
1. As Seller: `POST /api/v1/debts` with valid payload — returns 201.
2. As Seller: `DELETE /api/v1/debts/{id}` — returns 403.

---

### Fix for Bug 2: `RemoteDebtFetcher` stores all shop debts for Seller

**Goal:** Only sync the current user's debts when role is Seller.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/sync/RemoteDebtFetcher.ts`
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/sync/SyncOrchestrator.ts`

**Changes:**
1. Add `role` and `userId` to `DebtFetcherDeps`:
```ts
export interface DebtFetcherDeps {
  token: string;
  role?: string;
  userId?: number;
}
```
2. Pass them from `SyncOrchestrator`:
```ts
this.debtFetcher = new RemoteDebtFetcher(() => ({
  token: getDeps().token,
  role: getDeps().role,
  userId: (getDeps() as any).userId,
}));
```
3. In `RemoteDebtFetcher.fetch()`, when role is Seller, add `user_id` param or purge other users' debts after sync:
```ts
// After all pages are fetched and inserted:
if (deps.role === "seller" && deps.userId) {
  const db = getDb();
  await db.runAsync(
    "DELETE FROM debts WHERE user_id IS NOT NULL AND user_id != ? AND shop_id = ?",
    [deps.userId, shopId]
  );
}
```

**Validation:**
1. Two Sellers on same device (sign out / in). Each sees only own debts in local DB.

---

### Fix for Bug 3: Debt creation shows error on offline sync failure

**Goal:** Show a queued-for-later success message instead of an error when offline.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/app/debts/index.tsx`

**Changes:**
Replace the `if (!syncOk)` block:
```ts
// BEFORE (lines 213-219)
const syncOk = await triggerSync().catch((e) => {
  console.error("Debt sync failed:", e);
  return false;
});
if (!syncOk) {
  setError("Не удалось отправить на сервер. Попробуйте синхронизировать вручную.");
  return;
}
onCreated(newDebt);
onClose();

// AFTER
await triggerSync().catch(console.error);
// Regardless of sync result, the debt is saved locally and queued.
// Sync will retry automatically when online.
onCreated(newDebt);
onClose();
```

Also add a toast to inform the user if offline:
```ts
// After onClose():
const { isOnline } = useSync(); // already imported
if (!isOnline) {
  showToast({ message: "Долг сохранён и будет отправлен при восстановлении сети.", variant: "warning" });
}
```

**Edge cases:**
- If the server returns 4xx (debt creation rejected), the sync action goes `dead` and appears in the failed actions list. User is notified via the sync errors screen.

**Validation:**
1. Create debt while offline — "queued" toast shown, modal closes, debt appears in list.
2. Go online — debt syncs. No duplicate.
