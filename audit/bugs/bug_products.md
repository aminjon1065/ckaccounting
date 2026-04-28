# Module: products

## Status
Products module handles Seller restrictions mostly well. One gap exists: the `ProductResource` API response returns `cost_price` to all authenticated users, and the `movements` endpoint exposes purchase prices to Sellers.

## Bugs

### Bug 1: `ProductResource` returns `cost_price` to Seller role (backend)
- Severity: High
- Role: Seller
- Platform: Mobile / Web

**Description:**
`GET /api/v1/products` and `GET /api/v1/products/{id}` are served via `ProductResource`. If `ProductResource` includes `cost_price` in the serialized response without role-based filtering, Sellers receive cost price data directly from the API. The mobile `ProductDetailScreen` correctly hides it in the UI (`canViewCost = user?.role !== "seller"` at line 56), but the value is in the JSON payload on the wire.

**Steps to reproduce:**
1. Authenticate as Seller.
2. `GET /api/v1/products/{id}` with Bearer token.
3. Inspect JSON — `cost_price` field is present.

**Expected:**
`cost_price` should be `null` or absent from Seller responses.

**Actual:**
`cost_price` is returned in the payload regardless of role.

**Root cause:**
`acc-backend/app/Http/Resources/Api/V1/ProductResource.php` — does not conditionally hide `cost_price` based on `$this->whenLoaded` or auth check.

---

### Bug 2: `movements` endpoint returns purchase item prices to Seller
- Severity: High
- Role: Seller
- Platform: Mobile

**Description:**
In `ProductController::movements()` (line 155-175), `purchaseMovements` is filtered with `$isSeller ? collect() : ...` — so Sellers do NOT receive purchase movement records. However, `saleMovements` includes `price` (the unit sale price) and `total` for every sale item. This is acceptable. But the comment at line 146 says it's to hide purchase cost data — the implementation is correct here. **However**, the `movements` response still includes `actor_name` for every sale by a seller, which reveals the name of the seller who made each sale. For a shared shop with multiple sellers, this leaks who sold what to other sellers.

**Steps to reproduce:**
1. Sign in as Seller A.
2. `GET /api/v1/products/{id}/movements`.
3. Each `saleMovements` entry contains `actor_name` of the seller who made the sale.

**Expected:**
Seller should not see `actor_name` for other sellers' sales.

**Actual:**
`actor_name` from `$item->sale?->user?->name` is returned unconditionally.

**Root cause:**
`acc-backend/app/Http/Controllers/Api/V1/ProductController.php:195` — `actor_name` always populated regardless of who is requesting.

---

### Bug 3: `getLocalProducts()` does not filter out products with `sync_action = 'delete'`
- Severity: Medium
- Role: Both
- Platform: Mobile

**Description:**
When a product is soft-deleted locally (`markProductDeletedLocally`), `sync_action` is set to `'delete'` and the row remains in the `products` table. However, `getLocalProducts()` at `lib/db/index.ts:163` queries all products without filtering `sync_action != 'delete'`. This means locally-deleted products appear in the product list and product picker until the sync resolves and the server returns a tombstone.

**Steps to reproduce:**
1. Delete a product while offline.
2. Open product list or the sale modal product picker.
3. Deleted product still appears.

**Expected:**
Products with `sync_action = 'delete'` should be excluded from all local list queries.

**Actual:**
`getLocalProducts()` returns all products including those pending deletion.

**Root cause:**
`lib/db/index.ts:163-180` — no `WHERE sync_action != 'delete'` condition in query.

---

## Offline issues
- `getLocalProductById` (used in `ProductDetailScreen`) also does not filter deleted products.

## Mobile UX issues
- `ProductDetailScreen` shows the "Historia движения" button to Sellers. The API call will succeed but reveal `actor_name` data. Button should be visible but `actor_name` column should be hidden.
