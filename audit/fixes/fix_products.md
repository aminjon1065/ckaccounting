# Fix Plan: products

### Fix for Bug 1: `ProductResource` returns `cost_price` to Seller

**Goal:** Hide `cost_price` from Seller role in API response.

**Files to modify:**
- `acc-backend/app/Http/Resources/Api/V1/ProductResource.php`

**Changes:**
```php
// In toArray(), replace the cost_price line:
// BEFORE
'cost_price' => $this->cost_price,

// AFTER
'cost_price' => $this->when(
    ! (auth()->user()?->role === \App\UserRole::Seller),
    $this->cost_price
),
```
Or use a helper method:
```php
private function canViewCost(): bool
{
    $user = auth()->user();
    return $user && $user->role !== \App\UserRole::Seller;
}
// Then:
'cost_price' => $this->when($this->canViewCost(), $this->cost_price),
```

**Edge cases:**
- Unauthenticated requests (if any public endpoint) should also get null.
- super_admin and owner must still receive cost_price.

**Validation:**
1. `GET /api/v1/products/{id}` as Seller — `cost_price` absent from response.
2. `GET /api/v1/products/{id}` as Owner — `cost_price` present.

---

### Fix for Bug 2: `movements` endpoint exposes `actor_name` to Sellers

**Goal:** Strip or null-out `actor_name` for requests from Seller role.

**Files to modify:**
- `acc-backend/app/Http/Controllers/Api/V1/ProductController.php`

**Changes:**
```php
// In movements(), add after $isSeller is defined at line 146:
$hideActorName = $isSeller;

// In saleMovements map (line 186-198), replace:
'actor_name' => $item->sale?->user?->name,
// With:
'actor_name' => $hideActorName ? null : $item->sale?->user?->name,

// Same for returnMovements (line 208-218):
'actor_name' => $hideActorName ? null : $item->saleReturn?->user?->name,
```

**Validation:**
1. As Seller: `GET /api/v1/products/{id}/movements` — `actor_name` is `null` for all entries.
2. As Owner: `actor_name` contains the seller's name.

---

### Fix for Bug 3: `getLocalProducts()` returns products pending deletion

**Goal:** Exclude locally-deleted products from all list queries.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/lib/db/index.ts`

**Changes:**
1. In `getLocalProducts()` at line 163, add filter:
```ts
// BEFORE
let query = "SELECT * FROM products";
// For shop_id + search:
query += " WHERE shop_id = ? AND (name LIKE ? OR code LIKE ?)";
// ...etc

// AFTER — add sync_action filter to every WHERE branch:
if (shop_id && search) {
  query += " WHERE shop_id = ? AND sync_action != 'delete' AND (name LIKE ? OR code LIKE ?)";
} else if (shop_id) {
  query += " WHERE shop_id = ? AND sync_action != 'delete'";
} else if (search) {
  query += " WHERE sync_action != 'delete' AND (name LIKE ? OR code LIKE ?)";
} else {
  query += " WHERE sync_action != 'delete'";
}
```

2. In `getLocalProductById()` at line 212:
```ts
// BEFORE
const r = await db.getFirstAsync<any>("SELECT * FROM products WHERE id = ?", [id]);
// AFTER
const r = await db.getFirstAsync<any>(
  "SELECT * FROM products WHERE id = ? AND sync_action != 'delete'",
  [id]
);
```

**Edge cases:**
- If the sync fails and the delete action is in `dead` state, product should still be hidden (user initiated the delete).

**Validation:**
1. Delete a product while offline.
2. Open product list — deleted product absent.
3. Open sale modal picker — deleted product absent.
4. Go online, sync — DELETE sent to server. Product removed from server.
