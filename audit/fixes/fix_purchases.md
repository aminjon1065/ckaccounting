# Fix Plan: purchases

### Fix for Bug 1: Stale purchases from old shop contaminate offline reports

**Goal:** Ensure purchases table only contains data for the current shop.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/sync/RemotePurchaseFetcher.ts`
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/db/index.ts`

**Changes:**
Option A — Purge on full sync (forceFullSync = true):
In `RemotePurchaseFetcher.fetch()`, when `forceFullSync === true`, add a DELETE before inserting:
```ts
if (forceFullSync && shopId) {
  const db = getDb();
  await db.runAsync("DELETE FROM purchases WHERE shop_id != ?", [shopId]);
}
```

Option B — Add shop_id guard to offline report COGS query:
In `OfflineReportsUseCase.ts`, the profit report already passes `shopId` to both `computeLocalSalesReport` and `computeLocalExpensesReport`. The COGS section at line 183-217 already has a `shop_id` filter:
```ts
if (shopId !== undefined) {
  salesQuery += " AND shop_id = ?";
}
```
Verify the `purchases` table query (if used) also has this filter. If not, add it.

**Validation:**
1. Sign in as Owner of Shop A. Go offline. Purchases visible.
2. Sign out. Sign in as Owner of Shop B (different shop).
3. Trigger full sync — Shop A's purchases purged from local DB.
4. Offline profit report only shows Shop B's data.

---

### Fix for Bug 2: `token!` non-null assertion with expired token

**Goal:** Guard modal from rendering when token is null/expired.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/app/purchases/index.tsx`

**Changes:**
```tsx
// Add tokenExpired from useAuth():
const { token, user, tokenExpired } = useAuth();

// Wrap the CreatePurchaseModal render condition:
{can(user?.role, "purchases:create") && token && !tokenExpired && (
  <CreatePurchaseModal
    visible={createVisible}
    onClose={() => setCreateVisible(false)}
    onCreated={(p) => {
      setPurchases((prev) => [p, ...prev]);
    }}
    token={token}  // Remove the ! assertion
  />
)}

// Also hide FAB when tokenExpired:
{can(user?.role, "purchases:create") && !tokenExpired && (
  <TouchableOpacity ...>
```

**Validation:**
1. Force token expiry (mock 401 response).
2. Navigate to Purchases — FAB hidden, modal not rendered.
