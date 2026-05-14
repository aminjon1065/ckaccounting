import * as React from "react";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { api, type LoginPayload, type User } from "@/lib/api";
import { STORAGE_KEYS } from "@/constants/config";
import { registerSuspensionHandler } from "@/store/suspension";
import { registerTokenExpiryHandler } from "@/lib/api/tokenExpiry";
import { registerTokenRefreshHandler, resetTokenRefreshState } from "@/lib/api/tokenRefresh";
import { reportError } from "@/lib/observability/reporter";
import { clearLocalData } from "@/lib/db";
import { suppressBiometricRelock } from "@/lib/biometricRelock";

const TOKEN_KEY = STORAGE_KEYS.authToken;
const USER_KEY = STORAGE_KEYS.authUser;
const PIN_KEY = STORAGE_KEYS.authPin;
const PIN_SALT_KEY = STORAGE_KEYS.authPinSalt;
const PASSWORD_HASH_KEY = STORAGE_KEYS.authPasswordHash;
const PASSWORD_SALT_KEY = STORAGE_KEYS.authPasswordSalt;
const SHOP_SUSPENDED_KEY = STORAGE_KEYS.shopSuspended;
const PREV_USER_ID_KEY = STORAGE_KEYS.authPrevUserId;

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthState {
  isLoaded: boolean;
  token: string | null;
  user: User | null;
  shopSuspended: boolean;
  tokenExpired: boolean;
  pinSetupPending: boolean;
  /**
   * True once the user has authenticated *locally* this session — via
   * biometric, PIN, or a fresh password sign-in. Cold-launched sessions
   * with a saved token start with this `false`; BiometricGuard flips it
   * `true` after the lock screen is dismissed. CacheProvider gates its
   * background sync on this flag so we don't fetch data behind the
   * still-locked PIN screen.
   */
  localUnlocked: boolean;
}

interface AuthActions {
  signIn: (payload: LoginPayload) => Promise<void>;
  signInOffline: () => Promise<boolean>;
  signInWithPassword: (email: string, password: string) => Promise<boolean>;
  signOut: (clearLocal?: boolean) => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  hasPin: () => Promise<boolean>;
  hasCredentials: () => Promise<boolean>;
  setPinSetupPending: (pending: boolean) => void;
  /** Toggled by BiometricGuard when biometric or PIN unlock succeeds. */
  setLocalUnlocked: (unlocked: boolean) => void;
}

type AuthContextValue = AuthState & AuthActions;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pin + salt);
}

async function hashPassword(password: string, salt: string): Promise<string> {
  // Native SHA-256 with salt via expo-crypto. The previous pure-JS PBKDF2 with
  // 10k iterations sounded cheap on paper (~20ms on dev devices) but locked the
  // JS thread for ~14s on low-end Android, blocking login-to-PIN transition.
  // Acceptable tradeoff: this hash exists only for OFFLINE login verification
  // on a device already gated by PIN/biometric + Android Keystore. An attacker
  // who has extracted the stored hash already has device-level access where
  // PBKDF2 rounds add little real-world resistance.
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, password + salt);
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = React.createContext<AuthContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<AuthState>({
    isLoaded: false,
    token: null,
    user: null,
    shopSuspended: false,
    tokenExpired: false,
    pinSetupPending: false,
    localUnlocked: false,
  });

  // Always-current token ref — avoids stale closure in callbacks that depend on token
  const tokenRef = React.useRef<string | null>(null);
  tokenRef.current = state.token;

  // Register the suspension handler so api.ts can signal when 403 is received
  // On suspension: clear sensitive local data to prevent data leak on rooted devices
  React.useEffect(() => {
    registerSuspensionHandler(async () => {
      // Never delete unsynced local accounting data on suspension.
      // The shop is locked but data is preserved for recovery/export.
      // Only mark the shop as suspended — UI will show suspension screen
      // and block further sync operations.
      await SecureStore.setItemAsync(SHOP_SUSPENDED_KEY, "1");
      setState((prev) => ({ ...prev, shopSuspended: true }));
    });
  }, []);

  // Register the token expiry handler so api.ts can signal when 401 is received
  // On token expiry: mark state so sync stops and UI prompts re-authentication
  React.useEffect(() => {
    registerTokenExpiryHandler(() => {
      setState((prev) => ({ ...prev, tokenExpired: true, token: null }));
    });
  }, []);

  // Register token refresh handler so api.ts can attempt refresh on 401 before forcing re-login
  React.useEffect(() => {
    registerTokenRefreshHandler({
      getToken: () => tokenRef.current,
      refreshToken: (token: string) => api.auth.refresh(token),
      setToken: async (newToken: string) => {
        await SecureStore.setItemAsync(TOKEN_KEY, newToken);
        setState((prev) => ({ ...prev, token: newToken, tokenExpired: false }));
      },
    });
  }, []); // mount only — tokenRef is always current

  // Load persisted session on mount
  React.useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [token, userJson, suspendedFlag, pinHash] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
          SecureStore.getItemAsync(SHOP_SUSPENDED_KEY),
          SecureStore.getItemAsync(PIN_KEY),
        ]);

        const wasShopSuspended = suspendedFlag === "1";

        if (!token) {
          if (mounted) setState({ isLoaded: true, token: null, user: null, shopSuspended: wasShopSuspended, tokenExpired: false, pinSetupPending: false, localUnlocked: false });
          return;
        }

        // Restore session immediately from cache — don't block on network.
        // Returning users skip the bootstrap gate: their local SQLite already
        // holds their data, so SyncProvider's background pull is enough.
        const cachedUser: User | null = userJson
          ? (() => { try { return JSON.parse(userJson) as User; } catch { return null; } })()
          : null;
        // If we have a token but no PIN saved, force the PIN setup flow before
        // letting the user reach the app — PIN is mandatory for every account.
        const pinPending = !pinHash;
        // localUnlocked starts false on cold-launch even with a saved token —
        // user still has to clear the biometric/PIN lock before sync fires.
        // BiometricGuard flips it true after the gate is dismissed; for the
        // pinSetupPending branch, signIn would have set it true already and
        // this code path doesn't run (PIN setup follows a fresh login).
        if (mounted) setState({ isLoaded: true, token, user: cachedUser, shopSuspended: wasShopSuspended, tokenExpired: false, pinSetupPending: pinPending, localUnlocked: false });

        // Best-effort: refresh user profile in background when online
        try {
          const user = await api.auth.me(token);
          if (mounted) {
            await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
            setState((prev) => ({ ...prev, user }));
          }
        } catch {
          // Offline or server error — cached user is sufficient, stay logged in
        }
      } catch {
        if (mounted) setState({ isLoaded: true, token: null, user: null, shopSuspended: false, tokenExpired: false, pinSetupPending: false, localUnlocked: false });
      }
    })();

    return () => { mounted = false; };
  }, []);

  const signIn = React.useCallback(async (payload: LoginPayload) => {
    const t0 = Date.now();
    const { token, user } = await api.auth.login(payload);
    if (__DEV__) console.log(`[signIn] api.auth.login resolved in ${Date.now() - t0}ms`);

    if (!token || typeof token !== "string") {
      throw new Error("Authentication failed: server did not return a token.");
    }

    // Cross-account isolation: if a different user_id signs in on this device,
    // wipe the local SQLite cache before arming the bootstrap. Otherwise the
    // new user would briefly see the previous account's products/sales until
    // the remote pull replaces them. Same user_id (re-login) keeps cache —
    // their data is already correct.
    const newUserId = user?.id != null ? String(user.id) : null;
    const prevUserId = await SecureStore.getItemAsync(PREV_USER_ID_KEY);
    const isDifferentAccount = !!prevUserId && !!newUserId && prevUserId !== newUserId;
    if (isDifferentAccount) {
      try {
        await clearLocalData();
      } catch (e) {
        reportError(e, {
          tag: "auth-account-switch-clear",
          prevUserId: prevUserId ?? null,
          newUserId: newUserId ?? null,
        });
      }
    }

    // Server-initiated PIN reset: drop the local PIN hash so the next
    // setup flow starts clean. The login response only carries this flag
    // once — the server consumes it on success.
    if (user?.pin_reset_required) {
      await Promise.all([
        SecureStore.deleteItemAsync(PIN_KEY),
        SecureStore.deleteItemAsync(PIN_SALT_KEY),
      ]);
    }

    // Re-check PIN presence after the optional reset above.
    const pin = await SecureStore.getItemAsync(PIN_KEY);
    const pinPending = !pin;

    // Critical writes — must land before unblocking: every subsequent API call
    // and cold-launch restore reads token + user from SecureStore.
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, token),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(user ?? null)),
    ]);

    // Fresh session: clear any circuit-breaker state from the previous one
    // so a single bad day on the network doesn't poison the new login.
    resetTokenRefreshState();
    // Suppress biometric lock for 10s so the capability probe triggered by
    // token becoming non-null doesn't immediately lock the user out after login.
    suppressBiometricRelock(10_000);
    // Online-first: drop the bootstrap gate so the user lands in tabs
    // immediately. Screens read from the local SQLite cache first (instant
    // paint) and refresh from the server on mount. SyncProvider's background
    // pull warms the cache; no need to block navigation on it.
    // Fresh online login = local authentication. Mark unlocked so sync fires
    // as soon as the user clears the PIN setup flow (or immediately if PIN
    // already exists for this device).
    setState({ isLoaded: true, token, user: user ?? null, shopSuspended: false, tokenExpired: false, pinSetupPending: pinPending, localUnlocked: true });
    if (__DEV__) console.log(`[signIn] total before setState: ${Date.now() - t0}ms`);

    // Deferred persistence — none of this blocks the PIN screen from rendering.
    // PBKDF2 is ~1-2s on low-end Android (pure-JS SHA256 in the JS thread);
    // SecureStore writes serialise through Android Keystore. Worst case if the
    // user kills the app within a second of login: they re-enter password next
    // time online, and offline login is unavailable until the next online sign-in.
    void (async () => {
      try {
        const salt = await generateSalt();
        const passwordHash = await hashPassword(payload.password, salt);
        await Promise.all([
          SecureStore.setItemAsync(PASSWORD_HASH_KEY, passwordHash),
          SecureStore.setItemAsync(PASSWORD_SALT_KEY, salt),
          SecureStore.deleteItemAsync(SHOP_SUSPENDED_KEY),
          newUserId
            ? SecureStore.setItemAsync(PREV_USER_ID_KEY, newUserId)
            : SecureStore.deleteItemAsync(PREV_USER_ID_KEY),
        ]);
      } catch (e) {
        reportError(e, { tag: "auth-signin-deferred-persist" });
      }
    })();
  }, []);

  const signInOffline = React.useCallback(async (): Promise<boolean> => {
    // SECURITY: This must only be called AFTER the user's PIN or password has been
    // verified. The login screen enforces this by requiring PIN entry before calling
    // this function. Calling it directly without verification bypasses authentication.
    try {
      const [passwordHash, salt, token, userJson, suspendedFlag] = await Promise.all([
        SecureStore.getItemAsync(PASSWORD_HASH_KEY),
        SecureStore.getItemAsync(PASSWORD_SALT_KEY),
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
        SecureStore.getItemAsync(SHOP_SUSPENDED_KEY),
      ]);

      if (!passwordHash || !salt || !token) return false;

      // Cannot verify password offline without stored email/password
      // Fall back to cached token if available (even if expired)
      const user: User | null = userJson
        ? (() => { try { return JSON.parse(userJson) as User; } catch { return null; } })()
        : null;

      // Going back online from this session should retry refresh with a clean
      // counter — the previous session's failures are no longer relevant
      // once the user has re-authenticated locally.
      resetTokenRefreshState();
      setState(() => ({
        isLoaded: true,
        token,
        user,
        shopSuspended: suspendedFlag === "1",
        // Fresh local-auth session — clear any prior tokenExpired latch so
        // the next 401 can re-trigger the redirect. The bridge counters were
        // reset above; the React-state flag must match.
        tokenExpired: false,
        pinSetupPending: false,
        // PIN was just verified — that's the local-auth step.
        localUnlocked: true,
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const signInWithPassword = React.useCallback(async (_email: string, password: string): Promise<boolean> => {
    try {
      const [passwordHash, salt] = await Promise.all([
        SecureStore.getItemAsync(PASSWORD_HASH_KEY),
        SecureStore.getItemAsync(PASSWORD_SALT_KEY),
      ]);

      if (!passwordHash || !salt) return false;

      const inputHash = await hashPassword(password, salt);
      if (inputHash !== passwordHash) return false;

      const [token, userJson, suspendedFlag] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
        SecureStore.getItemAsync(SHOP_SUSPENDED_KEY),
      ]);

      if (!token) return false;

      const user: User | null = userJson
        ? (() => { try { return JSON.parse(userJson) as User; } catch { return null; } })()
        : null;

      // Same rationale as signInOffline: fresh local re-auth, clear circuit.
      resetTokenRefreshState();
      setState({ isLoaded: true, token, user, shopSuspended: suspendedFlag === "1", tokenExpired: false, pinSetupPending: false, localUnlocked: true });
      return true;
    } catch {
      return false;
    }
  }, []);

  const hasCredentials = React.useCallback(async (): Promise<boolean> => {
    const hash = await SecureStore.getItemAsync(PASSWORD_HASH_KEY);
    return !!hash;
  }, []);

  const setPin = React.useCallback(async (pin: string): Promise<void> => {
    const salt = await generateSalt();
    const hash = await hashPin(pin, salt);
    await Promise.all([
      SecureStore.setItemAsync(PIN_KEY, hash),
      SecureStore.setItemAsync(PIN_SALT_KEY, salt),
    ]);
  }, []);

  const verifyPin = React.useCallback(async (pin: string): Promise<boolean> => {
    try {
      const [hash, salt] = await Promise.all([
        SecureStore.getItemAsync(PIN_KEY),
        SecureStore.getItemAsync(PIN_SALT_KEY),
      ]);
      if (!hash || !salt) return false;
      const inputHash = await hashPin(pin, salt);
      return inputHash === hash;
    } catch {
      return false;
    }
  }, []);

  const hasPin = React.useCallback(async (): Promise<boolean> => {
    const pin = await SecureStore.getItemAsync(PIN_KEY);
    return !!pin;
  }, []);

  const setPinSetupPending = React.useCallback((pending: boolean) => {
    setState((prev) => ({ ...prev, pinSetupPending: pending }));
  }, []);

  const setLocalUnlocked = React.useCallback((unlocked: boolean) => {
    setState((prev) => (prev.localUnlocked === unlocked ? prev : { ...prev, localUnlocked: unlocked }));
  }, []);

  const updateUser = React.useCallback(async (user: User) => {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    setState((prev) => ({ ...prev, user }));
  }, []);

  const signOut = React.useCallback(async (clearLocal: boolean = false) => {
    // Use tokenRef to avoid stale closure — state.token may be null while the
    // token expiry handler is still running its setState
    const currentToken = tokenRef.current;
    if (currentToken) {
      api.auth.logout(currentToken).catch(() => {});
    }
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
      SecureStore.deleteItemAsync(PIN_KEY),
      SecureStore.deleteItemAsync(PIN_SALT_KEY),
      SecureStore.deleteItemAsync(PASSWORD_HASH_KEY),
      SecureStore.deleteItemAsync(PASSWORD_SALT_KEY),
    ]);
    if (clearLocal) {
      await clearLocalData();
    }
    // signOut also drops the prev-user pointer so the next signIn doesn't
    // misclassify itself as the "same account" against stale state.
    await SecureStore.deleteItemAsync(PREV_USER_ID_KEY).catch(() => {});
    // Discard any in-flight refresh + circuit-breaker counters — the next
    // login starts with a clean slate.
    resetTokenRefreshState();
    setState({ isLoaded: true, token: null, user: null, shopSuspended: false, tokenExpired: false, pinSetupPending: false, localUnlocked: false });
  }, []);

  const value = React.useMemo<AuthContextValue>(
    () => ({
      ...state,
      signIn,
      signInOffline,
      signInWithPassword,
      signOut,
      updateUser,
      setPin,
      verifyPin,
      hasPin,
      hasCredentials,
      setPinSetupPending,
      setLocalUnlocked,
    }),
    [state, signIn, signInOffline, signInWithPassword, signOut, updateUser, setPin, verifyPin, hasPin, hasCredentials, setPinSetupPending, setLocalUnlocked]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
