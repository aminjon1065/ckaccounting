# Module: permissions

## Status
The permissions layer has one confirmed mismatch between `ApiPermissionMatrix` and `DebtPolicy`, and a broader pattern where the mobile `lib/permissions.ts` matrix is not guaranteed to stay in sync with backend policies as features evolve.

## Bugs

### Bug 1: `ApiPermissionMatrix` `debts.create` excludes Seller but `DebtPolicy::create()` allows Seller
- Severity: High
- Role: Seller
- Platform: Both

**Description:**
See also bug_debts.md Bug 1. `DebtPolicy::create()` uses `isOperationalRole()` which includes any user with `shop_id !== null` — i.e., both Owner and Seller. But `ApiPermissionMatrix::MATRIX['debts']['create']` only lists `['super_admin', 'owner']`. If `ApiPermissionMatrix::allows()` is used as a pre-filter (e.g., in a middleware or gate), Sellers will be blocked before the policy is even evaluated.

**Steps to reproduce:**
1. Check if any middleware calls `ApiPermissionMatrix::allows()` before the controller's `$this->authorize()`.
2. If so, Sellers get 403 on debt creation despite the Policy allowing it.

**Expected:**
Matrix and Policy agree on who can create debts.

**Actual:**
`ApiPermissionMatrix.php:39` — `'create' => ['super_admin', 'owner']` — Seller absent.
`DebtPolicy.php:33-35` — `isOperationalRole()` returns true for Seller.

**Root cause:**
`acc-backend/app/ApiPermissionMatrix.php:39` — missing `seller` in `debts.create`.

---

### Bug 2: Mobile `lib/permissions.ts` allows Seller `debts:create` but backend Matrix does NOT
- Severity: High
- Role: Seller
- Platform: Mobile

**Description:**
`lib/permissions.ts:47` — `"debts:create": ["super_admin", "owner", "seller"]` — the mobile side correctly allows Sellers to create debts. But since the backend `ApiPermissionMatrix.php` excludes Seller from `debts.create`, any debt creation attempt by a Seller that goes through the Matrix gate will fail with 403. The mobile UI will show the "Create Debt" button to Sellers, but the API call will be rejected.

**Steps to reproduce:**
1. Sign in as Seller.
2. Open Debts screen — FAB is visible (mobile permission allows it).
3. Create a debt — request goes to server.
4. Server rejects with 403 if Matrix is checked before Policy.

**Expected:**
Backend Matrix and mobile permissions.ts must agree.

**Actual:**
Mobile: `debts:create` allows Seller. Backend Matrix: does not allow Seller.

**Root cause:**
Inconsistency between `lib/permissions.ts:47` and `acc-backend/app/ApiPermissionMatrix.php:39`.

---

### Bug 3: `ApiPermissionMatrix` has no `delete` entry for `debts` but `DebtPolicy::delete()` exists
- Severity: Low
- Role: Owner
- Platform: Web

**Description:**
`ApiPermissionMatrix.php` `debts` section has no `delete` entry. `DebtPolicy::delete()` allows Owner for same-shop debts. If any frontend or middleware checks `ApiPermissionMatrix::allows($user, 'debts', 'delete')`, it gets `false` for everyone (returns `[]` → no roles match). This silently blocks the delete action for everyone except super_admin (who bypasses policy checks via `isSuperAdmin()`).

**Steps to reproduce:**
1. `ApiPermissionMatrix::allows($owner_user, 'debts', 'delete')` → returns `false` (no entry).

**Expected:**
Matrix has `'delete' => ['super_admin', 'owner']` for debts.

**Actual:**
No `delete` entry exists in `ApiPermissionMatrix.php` for `debts`.

**Root cause:**
`acc-backend/app/ApiPermissionMatrix.php:36-41` — `delete` key missing from `debts` section.

---

### Bug 4: `sales:return` not in mobile `lib/permissions.ts` Action type
- Severity: Low
- Role: Owner
- Platform: Mobile

**Description:**
`lib/permissions.ts` defines `Action` type at lines 5-29. The action `"sales:return"` is listed (line 12) and has permissions `["super_admin", "owner"]` (line 38). This is correctly defined. HOWEVER, the mobile app does not appear to gate the "return" button in any sale detail screen using `can(role, "sales:return")`. If a Seller navigates to a sale detail screen that has a return button, they may see it even though they lack the permission.

**Steps to reproduce:**
1. Sign in as Seller.
2. Navigate to a sale detail screen (if such a screen exists with a return action).
3. If the return button is not guarded with `can(user?.role, "sales:return")`, Sellers see it.

**Expected:**
Return button guarded: `can(user?.role, "sales:return")`.

**Actual:**
Need to verify the sales detail screen — the main audit scope did not include a sale detail screen file.

**Root cause:**
Requires reading `/app/sales/[id].tsx` to confirm. Flag for verification.

---

## Offline issues
- Permission checks run entirely offline from local `lib/permissions.ts`. Backend policies are authoritative, but any discrepancy creates security gaps when online.

## Mobile UX issues
- No runtime validation that `lib/permissions.ts` matches the backend role definitions.
