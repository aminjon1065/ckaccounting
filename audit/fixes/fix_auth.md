# Fix Plan: auth

### Fix for Bug 1: `signOut` optional `clearLocal` parameter not declared in interface

**Goal:** Align `AuthActions` interface with implementation so TypeScript consumers can call `signOut(true)`.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/store/auth.tsx`

**Changes:**
1. At line 38, change:
   ```ts
   // BEFORE
   signOut: () => Promise<void>;
   // AFTER
   signOut: (clearLocal?: boolean) => Promise<void>;
   ```

**Edge cases:**
- All existing call-sites pass no argument → default `false` → no behavior change.

**Validation:**
Run `tsc --noEmit`. Confirm no type errors for `signOut(true)` at any call-site.

---

### Fix for Bug 2: `signInOffline()` restores session without verification

**Goal:** Make the function self-documenting by requiring a `verified: true` parameter so callers must prove they checked credentials before calling.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/store/auth.tsx`

**Changes:**
1. Change the function signature:
   ```ts
   // BEFORE (line 188)
   const signInOffline = React.useCallback(async (): Promise<boolean> => {
   // AFTER
   const signInOffline = React.useCallback(async (verified: true): Promise<boolean> => {
   ```
2. Add early guard at the top of the function body:
   ```ts
   if (!verified) return false;
   ```
3. Update `AuthActions` interface at line 36:
   ```ts
   // BEFORE
   signInOffline: () => Promise<boolean>;
   // AFTER
   signInOffline: (verified: true) => Promise<boolean>;
   ```
4. Update all call-sites to pass `verified: true` only after PIN/password verification has succeeded.

**Edge cases:**
- Any path that skips verification will fail TypeScript compilation.

**Validation:**
Search for all `signInOffline(` calls. Each must have been preceded by a successful `verifyPin()` or `signInWithPassword()` call.

---

### Fix for Bug 3: Token expiry flag not checked before offline session restore

**Goal:** Preserve `tokenExpired` state when restoring offline session if the token was explicitly invalidated.

**Files to modify:**
- `/Users/aminjon/Desktop/ckapp/ckaccounting/store/auth.tsx`

**Changes:**
1. In `signInOffline`, read the existing `tokenExpired` from current state before overwriting it:
   ```ts
   // At line 209, replace:
   setState({ isLoaded: true, token, user, shopSuspended: suspendedFlag === "1", tokenExpired: false, pinSetupPending: false });
   // With:
   setState(prev => ({
     isLoaded: true,
     token,
     user,
     shopSuspended: suspendedFlag === "1",
     // Preserve server-invalidated flag; only clear it when we have fresh online auth
     tokenExpired: prev.tokenExpired,
     pinSetupPending: false,
   }));
   ```

**Edge cases:**
- If `tokenExpired` is true and user tries to sync, `SyncContext` already gates on `!tokenExpired` — correct behavior.
- User must do a full online login to clear `tokenExpired`.

**Validation:**
1. Trigger a 401 response (server invalidates token).
2. Kill network, reopen app, sign in offline.
3. Confirm `tokenExpired` remains true and sync does not fire.
