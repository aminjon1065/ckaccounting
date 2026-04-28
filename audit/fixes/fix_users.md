# Fix Plan: users

### Fix for Bug 1: Offline user creation missing idempotency key

**Goal:** Prevent duplicate user creation on sync retry.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/app/users/index.tsx`

**Changes:**
```ts
// In CreateUserModal.handleSubmit(), replace line ~190:
// BEFORE
await queueSyncAction("POST", "/users", payload, {});
const localUser: AppUser = { id: -Date.now(), ... };

// AFTER
const localId = String(-Date.now());
const idempKey = `local-user-${localId}`;
await queueSyncAction("POST", "/users", { ...payload, _local_id: localId }, {}, idempKey);
const localUser: AppUser = { id: Number(localId), ... };
```

**Edge cases:**
- The server must support `Idempotency-Key` header for `POST /users`. Verify with backend team.
- If idempotency is not supported server-side, at minimum add email uniqueness check locally before queuing.

**Validation:**
1. Create user offline. Sync retries 3 times (simulate flap).
2. Server creates user only once. DB shows single user record with that email.

---

### Fix for Bug 2: Offline user update missing idempotency key

**Goal:** Add idempotency key to PATCH user action.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/app/users/index.tsx`

**Changes:**
```ts
// In EditUserModal.handleSubmit(), replace line ~374:
// BEFORE
await queueSyncAction("PATCH", `/users/${editingUser!.id}`, payload, {});

// AFTER
const idempKey = `local-user-update-${editingUser!.id}-${Date.now()}`;
await queueSyncAction("PATCH", `/users/${editingUser!.id}`, payload, {}, idempKey);
```

**Validation:**
PATCH with same idempotency key returns the same user record on server without double-update.

---

### Fix for Bug 3: Single-option role selector for Owner editing Seller

**Goal:** Hide the role selector when only one option is available and show a text label instead.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/app/users/index.tsx`

**Changes:**
```tsx
// In EditUserModal, replace the role Select:
{roleOptions.length > 1 ? (
  <Select
    label="Роль"
    value={role}
    onValueChange={(v) => setRole(v as "owner" | "seller")}
    options={roleOptions}
    placeholder="Выберите роль"
  />
) : (
  <View>
    <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Роль</Text>
    <Text className="text-sm text-slate-500 dark:text-slate-400">
      {ROLE_LABELS[role]} (изменить нельзя)
    </Text>
  </View>
)}
```

**Validation:**
1. Owner editing a Seller — role shown as "Продавец (изменить нельзя)".
2. super_admin editing any user — full role dropdown visible.
