# Module: users

## Status
Users module is correctly gated. One bug: offline user creation queues a sync action without an idempotency key, risking duplicate user creation. A second issue: Seller users can see the Users screen link in Settings but the screen correctly shows "access denied" — the link itself is never shown to Sellers (guarded by `can(user?.role, "users:view")`), so navigation to Users by Sellers requires direct URL routing.

## Bugs

### Bug 1: Offline user creation (`queueSyncAction`) has no idempotency key
- Severity: Medium
- Role: Owner
- Platform: Mobile

**Description:**
In `app/users/index.tsx:190`:
```ts
await queueSyncAction("POST", "/users", payload, {});
```
No idempotency key is passed (5th argument is missing). If the same sync action is retried multiple times (due to network flap), the server could create duplicate user accounts because there is no idempotency protection.

**Steps to reproduce:**
1. Create a user while offline.
2. Go online. First sync attempt fails partway.
3. Sync retries — server processes the POST twice.
4. Two user accounts with the same email are created (or validation rejects second with 422, leaving action dead).

**Expected:**
User creation sync action should include an idempotency key.

**Actual:**
`app/users/index.tsx:190` — `queueSyncAction("POST", "/users", payload, {})` — no idempotency key.

**Root cause:**
`app/users/index.tsx:190` — missing 5th argument to `queueSyncAction`.

---

### Bug 2: Offline user update (`PATCH /users/{id}`) has no idempotency key
- Severity: Low
- Role: Owner
- Platform: Mobile

**Description:**
Similarly, `app/users/index.tsx:374`:
```ts
await queueSyncAction("PATCH", `/users/${editingUser!.id}`, payload, {});
```
No idempotency key. While PATCH is idempotent by HTTP semantics, our sync queue may retry it, and without the key the server cannot deduplicate identical requests.

**Root cause:**
`app/users/index.tsx:374` — missing idempotency key.

---

### Bug 3: Owner can see role selector for Seller in Edit modal — can try to set role to "owner" which backend blocks
- Severity: Low
- Role: Owner
- Platform: Mobile

**Description:**
In `EditUserModal`, the role selector `roleOptions` for non-super-admin is:
```ts
const roleOptions = isSuperAdmin
  ? [owner, seller]
  : [seller];  // Only "seller" for Owner
```
So Owner can only assign "seller" role — this is correct. However the Select component is still rendered with a single option. For an Owner editing a Seller, the role Select is visible but has only one option ("Продавец"). This is not a security bug but is confusing UI.

**Steps to reproduce:**
1. Sign in as Owner.
2. Edit a seller — role select shows only "Продавец" with no other choices.

**Expected:**
Either show the role as a read-only text label (since it can't be changed), or hide the selector entirely.

**Actual:**
Select with single option rendered.

**Root cause:**
`app/users/index.tsx:451-457` — role select always rendered, even when only one option exists.

---

## Offline issues
- User creation queued offline has a local `id: -Date.now()` negative ID. If the sync fails permanently (dead action), this ghost user remains in the UI list with a fake negative ID and cannot be deleted (delete would try `DELETE /users/-1234567890` which returns 404 → goes dead).

## Mobile UX issues
- No loading state shown when deleting a user — the confirmation dialog fires and the user is removed from UI immediately, but if the API call is slow, the user has no feedback.
