import { Platform } from "react-native";
import * as React from "react";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import { api, type LoginPayload, type User } from "@/lib/api";
import { STORAGE_KEYS } from "@/constants/config";
import { registerSuspensionHandler } from "@/store/suspension";

const TOKEN_KEY = STORAGE_KEYS.authToken;
const USER_KEY = STORAGE_KEYS.authUser;
const PIN_KEY = STORAGE_KEYS.authPin;
const PIN_SALT_KEY = STORAGE_KEYS.authPinSalt;
const PASSWORD_HASH_KEY = STORAGE_KEYS.authPasswordHash;
const PASSWORD_SALT_KEY = STORAGE_KEYS.authPasswordSalt;

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthState {
  isLoaded: boolean;
  token: string | null;
  user: User | null;
  shopSuspended: boolean;
}

interface AuthActions {
  signIn: (payload: LoginPayload) => Promise<void>;
  signInOffline: () => Promise<boolean>;
  signInWithPassword: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  hasPin: () => Promise<boolean>;
  hasCredentials: () => Promise<boolean>;
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
  });

  // Register the suspension handler so api.ts can signal when 403 is received
  React.useEffect(() => {
    registerSuspensionHandler(() =>
      setState((prev) => ({ ...prev, shopSuspended: true }))
    );
  }, []);

  // Load persisted session on mount
  React.useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [token, userJson] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);

        if (!token) {
          if (mounted) setState({ isLoaded: true, token: null, user: null, shopSuspended: false });
          return;
        }

        // Restore session immediately from cache — don't block on network
        const cachedUser: User | null = userJson
          ? (() => { try { return JSON.parse(userJson) as User; } catch { return null; } })()
          : null;
        if (mounted) setState({ isLoaded: true, token, user: cachedUser, shopSuspended: false });

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
        if (mounted) setState({ isLoaded: true, token: null, user: null, shopSuspended: false });
      }
    })();

    return () => { mounted = false; };
  }, []);

  const signIn = React.useCallback(async (payload: LoginPayload) => {
    const { token, user } = await api.auth.login(payload);

    if (!token || typeof token !== "string") {
      throw new Error("Authentication failed: server did not return a token.");
    }

    // Store password hash for offline login
    const salt = await generateSalt();
    const passwordHash = await hashPassword(payload.password, salt);

    // Store credentials for offline login
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, token),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(user ?? null)),
      SecureStore.setItemAsync(PASSWORD_HASH_KEY, passwordHash),
      SecureStore.setItemAsync(PASSWORD_SALT_KEY, salt),
    ]);
    setState({ isLoaded: true, token, user: user ?? null, shopSuspended: false });
  }, []);

  const signInOffline = React.useCallback(async (): Promise<boolean> => {
    try {
      const [passwordHash, salt, token, userJson] = await Promise.all([
        SecureStore.getItemAsync(PASSWORD_HASH_KEY),
        SecureStore.getItemAsync(PASSWORD_SALT_KEY),
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
      ]);

      if (!passwordHash || !salt || !token) return false;

      // Cannot verify password offline without stored email/password
      // Fall back to cached token if available (even if expired)
      const user: User | null = userJson
        ? (() => { try { return JSON.parse(userJson) as User; } catch { return null; } })()
        : null;

      setState({ isLoaded: true, token, user, shopSuspended: false });
      return true;
    } catch {
      return false;
    }
  }, []);

  const signInWithPassword = React.useCallback(async (email: string, password: string): Promise<boolean> => {
    try {
      const [passwordHash, salt] = await Promise.all([
        SecureStore.getItemAsync(PASSWORD_HASH_KEY),
        SecureStore.getItemAsync(PASSWORD_SALT_KEY),
      ]);

      if (!passwordHash || !salt) return false;

      const inputHash = await hashPassword(password, salt);
      if (inputHash !== passwordHash) return false;

      const [token, userJson] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
      ]);

      if (!token) return false;

      const user: User | null = userJson
        ? (() => { try { return JSON.parse(userJson) as User; } catch { return null; } })()
        : null;

      setState({ isLoaded: true, token, user, shopSuspended: false });
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

  const updateUser = React.useCallback(async (user: User) => {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    setState((prev) => ({ ...prev, user }));
  }, []);

  const signOut = React.useCallback(async () => {
    if (state.token) {
      api.auth.logout(state.token).catch(() => {});
    }
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
      SecureStore.deleteItemAsync(PIN_KEY),
      SecureStore.deleteItemAsync(PIN_SALT_KEY),
      SecureStore.deleteItemAsync(PASSWORD_HASH_KEY),
      SecureStore.deleteItemAsync(PASSWORD_SALT_KEY),
    ]);
    setState({ isLoaded: true, token: null, user: null, shopSuspended: false });
  }, [state.token]);

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
    }),
    [state, signIn, signInOffline, signInWithPassword, signOut, updateUser, setPin, verifyPin, hasPin, hasCredentials]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
