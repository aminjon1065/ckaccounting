# Fix Plan: expenses

### Fix for Bug 1: `token!` non-null assertion without expiry guard

**Goal:** Prevent modal from opening with an invalid/null token.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/app/expenses.tsx`

**Changes:**
```tsx
// Add tokenExpired to the destructured auth values:
const { token, user, tokenExpired } = useAuth();

// Guard the modal render:
{!tokenExpired && token && (
  <ExpenseFormModal
    visible={formVisible}
    editing={editing}
    onClose={() => setFormVisible(false)}
    onSaved={(saved, wasEditing) => handleSaved(saved, wasEditing)}
    token={token}  // Remove the ! assertion
  />
)}
```

Also hide the FAB when tokenExpired:
```tsx
{can(user?.role, "expenses:create") && !tokenExpired && (
  <TouchableOpacity ...>
```

**Validation:**
1. Force 401 from server (expiry scenario).
2. Navigate to Expenses — FAB disabled, editing not possible.

---

### Fix for Bug 2: Stale expenses from old shop in offline report

**Goal:** Purge stale shop expenses on full sync.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/sync/RemoteExpenseFetcher.ts`

**Changes:**
Add purge step when `forceFullSync === true`:
```ts
// At the start of fetch(), after resolving shopId:
if (forceFullSync && token) {
  const db = getDb();
  // Purge expenses not belonging to the current user's shop
  // (only if we have a known shopId to scope against)
  if (shopId) {
    await db.runAsync("DELETE FROM expenses WHERE shop_id != ?", [shopId]);
  }
}
```

**Validation:**
1. Owner in Shop A syncs. Has expenses in DB.
2. Owner reassigned to Shop B. Trigger full sync.
3. Shop A expenses purged. Only Shop B expenses in DB.
