# Module: auth

## Status
Auth is mostly solid, but the offline sign-in path has a silent security gap and the signOut interface is mismatched with its implementation.

## Bugs

### Bug 1: `signOut` optional `clearLocal` parameter not declared in `AuthActions` interface
- Severity: Low
- Role: Both
- Platform: Mobile

**Description:**
`signOut` implementation accepts `(clearLocal: boolean = false)` but the `AuthActions` interface declares `signOut: () => Promise<void>`. TypeScript resolves the narrower interface type from `useAuth()`, so callers that need `clearLocal: true` cannot pass it without a type error.

**Steps to reproduce:**
1. Open `store/auth.tsx`.
2. Note line 38: interface has `signOut: () => Promise<void>`.
3. Note line 289: implementation is `async (clearLocal: boolean = false)`.

**Expected:**
Interface matches implementation: `signOut: (clearLocal?: boolean) => Promise<void>`.

**Actual:**
Interface hides the optional parameter. Any call-site that tries `signOut(true)` gets a TypeScript error.

**Root cause:**
`store/auth.tsx:38` — interface declaration is missing the optional parameter.

---

### Bug 2: `signInOffline()` restores session without any verification
- Severity: High
- Role: Both
- Platform: Mobile

**Description:**
A comment at line 189 says this must only be called AFTER PIN/password verification, but the function itself does NO verification. It blindly restores the cached token. If the call-site convention is broken (e.g. via code refactor or a new offline path), authentication is bypassed entirely.

**Steps to reproduce:**
1. Call `signInOffline()` directly without prior `verifyPin()` call.
2. Session is restored with a valid token regardless.

**Expected:**
Function accepts a verified flag or performs its own PIN/password check before restoring the session.

**Actual:**
Function restores session unconditionally at `store/auth.tsx:209`.

**Root cause:**
`store/auth.tsx:188-214` — No verification logic inside the function body.

---

### Bug 3: Token expiry flag not checked before offline session restore
- Severity: Medium
- Role: Both
- Platform: Mobile

**Description:**
When the server returns 401, `TokenExpiryBridge` fires `registerTokenExpiryHandler` which sets `tokenExpired: true, token: null`. If the user then calls `signInOffline()`, the function reloads the token from `SecureStore` and resets `tokenExpired: false` (`store/auth.tsx:209`). This means a server-invalidated token can be silently re-activated for offline use.

**Steps to reproduce:**
1. Server returns 401 → `tokenExpired` becomes true, `token` null.
2. User opens app offline and triggers `signInOffline()`.
3. `tokenExpired` is reset to false; stale token is back in state.

**Expected:**
`signInOffline` should not override `tokenExpired: false` if the token was explicitly invalidated by the server.

**Actual:**
`store/auth.tsx:209` — always sets `tokenExpired: false`.

**Root cause:**
`store/auth.tsx:209` — `setState` call unconditionally resets `tokenExpired`.

---

## Offline issues
- PIN-based offline login relies entirely on call-site discipline, not enforced by function contract.

## Mobile UX issues
- No indication shown to the user if `signInOffline()` returns `false` due to missing stored credentials.
