# Fix Plan: permissions

### Fix for Bugs 1, 2, 3: `ApiPermissionMatrix` mismatches with `DebtPolicy`

**Goal:** Align `ApiPermissionMatrix` with the actual `DebtPolicy` so they are authoritative and consistent.

**Files to modify:**
- `acc-backend/app/ApiPermissionMatrix.php`

**Changes:**
```php
// BEFORE (lines 36-41)
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
    'create' => ['super_admin', 'owner', 'seller'],  // DebtPolicy::create() allows Seller
    'update' => ['super_admin', 'owner', 'seller'],  // DebtPolicy::update() allows Seller (own debts)
    'delete' => ['super_admin', 'owner'],             // DebtPolicy::delete() blocks Seller
],
```

**Edge cases:**
- The Matrix is a coarse gate; the Policy enforces ownership (Seller can only view/update own debts).
- The Matrix should never be MORE restrictive than the Policy unless a conscious override is intended.

**Validation:**
1. `ApiPermissionMatrix::allows($seller, 'debts', 'create')` → `true`.
2. `ApiPermissionMatrix::allows($seller, 'debts', 'delete')` → `false`.
3. `ApiPermissionMatrix::allows($owner, 'debts', 'delete')` → `true`.

---

### Fix for Bug 4: `sales:return` not guarded in sale detail screen

**Goal:** Ensure return action button is gated by `can(role, "sales:return")`.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/app/sales/[id].tsx` (if exists — read before editing)

**Changes:**
If a return button exists in the sale detail screen:
```tsx
import { can } from "@/lib/permissions";
// ...
const canReturn = can(user?.role, "sales:return");
// ...
{canReturn && (
  <TouchableOpacity onPress={handleReturn}>
    <Text>Оформить возврат</Text>
  </TouchableOpacity>
)}
```

**Validation:**
1. Seller views sale detail — no return button visible.
2. Owner views sale detail — return button visible.

---

### Consistency maintenance recommendation

**Files to review:**
- `lib/permissions.ts`
- `acc-backend/app/ApiPermissionMatrix.php`
- All `acc-backend/app/Policies/*.php`

**Process:**
Add a comment block at the top of both `ApiPermissionMatrix.php` and `lib/permissions.ts` referencing each other, and add a CI test that verifies the matrices are consistent:
```php
// In a Pest test:
it('ApiPermissionMatrix agrees with mobile permissions for key actions', function () {
    // List expected matches and assert
    expect(ApiPermissionMatrix::allows(sellerUser(), 'debts', 'create'))->toBeTrue();
    expect(ApiPermissionMatrix::allows(sellerUser(), 'expenses', 'create'))->toBeFalse();
    // etc.
});
```
