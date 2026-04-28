# Module: sales

## Status
Sales has two meaningful bugs: Seller price-below-sale_price validation only runs for online path — offline sales bypass it entirely; and a `setSubmitting(false)` call is misplaced, leaving the submit button stuck on "loading" when the seller validation fails.

## Bugs

### Bug 1: Seller "price below sale_price" validation is skipped for offline sales
- Severity: High
- Role: Seller
- Platform: Mobile

**Description:**
In `CreateSaleModal.tsx`, the price validation at line 395-403 only runs before the online `api.sales.create()` call. If the API call throws with `status === 0` (offline), the code jumps to the offline path at line 435 and stores the sale locally without any price check. A Seller can therefore record a sale at below-cost price while offline and the server will accept it when it syncs (because the server does not enforce this Seller-specific business rule either).

**Steps to reproduce:**
1. Sign in as Seller.
2. Disable network.
3. Open CreateSaleModal, add product, manually type price lower than `sale_price`.
4. Submit — sale is queued offline with the underprice.
5. Restore network — sale syncs successfully.

**Expected:**
Seller price validation should run before the offline queue path, not just before the online API call.

**Actual:**
Validation at `CreateSaleModal.tsx:395-403` runs only before `api.sales.create()`. The offline catch block at line 434 does not re-run validation.

**Root cause:**
`components/sales/CreateSaleModal.tsx:356-506` — validation check at line 395 is inside `handleSubmit` but the offline path (line 435+) is unreachable until after the online API call fails. Moving validation before `setSubmitting(true)` fixes both paths.

---

### Bug 2: `setSubmitting(false)` called before early return in Seller validation
- Severity: Medium
- Role: Seller
- Platform: Mobile

**Description:**
In `handleSubmit`, at lines 395-403:
```ts
if (user?.role === "seller" && saleType === "product") {
  for (const c of cart) {
    if (c.price < (c.product.sale_price ?? 0)) {
      setError(`Цена "${c.product.name}" ниже прайса (${c.product.sale_price})`);
      setSubmitting(false);  // line 399
      return;
    }
  }
}

setSubmitting(true);  // line 405
```
`setSubmitting(false)` is called at line 399 but `setSubmitting(true)` hasn't been called yet (it's at line 405). So after the early return, the button is still in non-loading state, which is technically correct — but the sequence shows a misunderstanding of the flow: the validation was intended to run after `setSubmitting(true)`, meaning the original design expected the button to be "stuck loading" until explicitly reset. If validation is ever moved post-`setSubmitting(true)` (the correct order), the bug would reappear.

**Steps to reproduce:**
1. Sign in as Seller.
2. Manually set price below `sale_price` for a cart item.
3. Tap submit — error message appears and the button is not stuck. (Currently works by accident of ordering.)

**Expected:**
Validation should happen before `setSubmitting(true)` so the guard is structural.

**Actual:**
Validation happens between the cart check and `setSubmitting(true)`. The redundant `setSubmitting(false)` call is a code smell that will cause a regression if ordering changes.

**Root cause:**
`components/sales/CreateSaleModal.tsx:395-406` — seller validation block placed at the wrong position in the submit flow.

---

### Bug 3: `onSaleSyncSuccess` is never called for offline sales in `OutboxProcessor`
- Severity: Medium
- Role: Both
- Platform: Mobile

**Description:**
In `OutboxProcessor.ts` line 218-232, when a `/sales` POST succeeds online, the code only calls `onPurchaseSyncSuccess` (for purchase path), but does NOT call `onSaleSyncSuccess`. Looking at lines 218-232:
```ts
if (action.method === "POST" && (action.path === "/sales" || action.path === "/purchases")) {
  ...
  if (action.path === "/purchases") {
    await onPurchaseSyncSuccess(item.product_id, qty);
  }
  // NOTE: no else branch for /sales
}
```
`onSaleSyncSuccess` (which cancels `pending_stock_delta`) is never invoked. This means `pending_stock_delta` keeps accumulating downward for offline sales, leading to progressively incorrect stock totals.

**Steps to reproduce:**
1. Go offline.
2. Record 3 sales for the same product (qty 1 each). `pending_stock_delta` = -3.
3. Go online. All 3 sync. `onSaleSyncSuccess` is never called.
4. `pending_stock_delta` stays at -3 forever.
5. Next server sync calculates `mergedStock = serverStock + (-3)` = artificially low.

**Expected:**
After each `/sales` POST syncs, `onSaleSyncSuccess(product_id, quantity)` must be called for every item in the sale.

**Actual:**
`lib/sync/OutboxProcessor.ts:218-232` — only purchase path calls the success handler.

**Root cause:**
`lib/sync/OutboxProcessor.ts:225-230` — missing `else` (or sibling) branch for `/sales` path.

---

## Offline issues
- Offline sale total shown in the `CreateSaleModal` summary uses computed `total` which is correct, but `debt` is only computed if `paidVal < total`. If `paidVal === 0` (nothing entered in the "Paid" field), `debt` equals `total` and the offline sale records the full amount as debt — this is intentional but no warning is shown to the user about creating a debt record.

## Mobile UX issues
- The sales list in `app/(tabs)/sales.tsx` does not re-fetch after a successful sync cycle — `lastSyncedAt` from `SyncContext` is available but not used to trigger a refresh.
