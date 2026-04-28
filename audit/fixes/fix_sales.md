# Fix Plan: sales

### Fix for Bug 1: Seller price validation skipped for offline sales

**Goal:** Apply seller price validation before any path (online or offline) accepts the sale.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/components/sales/CreateSaleModal.tsx`

**Changes:**
Move the Seller price validation block to immediately after the item count checks and before `setSubmitting(true)`:

```ts
// In handleSubmit(), place this block BEFORE the setSubmitting(true) call at line 405.
// Remove the current block at lines 395-403.

// Validate Seller cannot sell below sale_price (applies to BOTH online and offline paths)
if (user?.role === "seller" && saleType === "product") {
  for (const c of cart) {
    if (c.price < (c.product.sale_price ?? 0)) {
      setError(`Цена "${c.product.name}" ниже прайса (${c.product.sale_price})`);
      return; // No setSubmitting to reset — it hasn't been set yet
    }
  }
}

setSubmitting(true);
// ... rest of submit (online try, offline catch)
```

**Edge cases:**
- Validation must not fire for `saleType === "service"` (no `sale_price` concept).
- The block already has `saleType === "product"` guard, so services are safe.

**Validation:**
1. Sign in as Seller, disable network.
2. Add product, set price below `sale_price`.
3. Submit — error message shown, sale NOT queued.
4. Enable network, same test — same error shown.

---

### Fix for Bug 2: Redundant `setSubmitting(false)` in Seller validation

**Goal:** Clean up code order so validation is structurally before the loading state.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/components/sales/CreateSaleModal.tsx`

**Changes:**
After moving the validation block (Fix 1 above), remove the `setSubmitting(false)` call at line 399 since `setSubmitting(true)` has not yet been called at that point. The early `return` alone is sufficient.

**Validation:**
Seller price validation error shows correctly; submit button does not get stuck.

---

### Fix for Bug 3: `onSaleSyncSuccess` never called in OutboxProcessor

**Goal:** Cancel `pending_stock_delta` after each offline sale syncs successfully.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/sync/OutboxProcessor.ts`

**Changes:**
In `processAction`, inside the `response.ok` block at lines 218-232, add the sales success handler:

```ts
if (action.method === "POST" && (action.path === "/sales" || action.path === "/purchases")) {
  try {
    const reqPayload = JSON.parse(action.payload || "{}");
    if (reqPayload.items) {
      for (const item of reqPayload.items) {
        const qty = safeQty(item.quantity);
        if (item.product_id != null && qty !== null) {
          if (action.path === "/purchases") {
            await onPurchaseSyncSuccess(item.product_id, qty);
          } else {
            // FIX: cancel the pending stock delta for the synced sale
            await onSaleSyncSuccess(item.product_id, qty);
          }
        }
      }
    }
  } catch {}
}
```

**Edge cases:**
- Service-type sales have no `product_id` items — the `item.product_id != null` guard handles this.
- If `qty` is null (invalid), `safeQty` returns null and the call is skipped safely.

**Validation:**
1. Record 2 offline sales for product X (qty 1 each).
2. Go online — both sync.
3. Query local DB: `pending_stock_delta` for product X should be 0 after sync.
4. Pull remote product — `stock_quantity` matches server without artificial subtraction.
