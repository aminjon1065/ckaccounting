import * as React from "react";
import * as SecureStore from "expo-secure-store";
import { api, ApiError, type LoginPayload, type User } from "@/lib/api";
import { STORAGE_KEYS } from "@/constants/config";
import { registerSuspensionHandler } from "@/store/suspension";

const TOKEN_KEY = STORAGE_KEYS.authToken;
const USER_KEY = STORAGE_KEYS.authUser;

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthState {
  isLoaded: boolean;
  token: string | null;
  user: User | null;
  shopSuspended: boolean;
}

interface AuthActions {
  signIn: (payload: LoginPayload) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (user: User) => Promise<void>;
}

type AuthContextValue = AuthState & AuthActions;

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

        // Try to get fresh user data; fall back to cached if offline
        try {
          const user = await api.auth.me(token);
          if (mounted) setState({ isLoaded: true, token, user, shopSuspended: false });
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            // Token expired – clear session
            await Promise.all([
              SecureStore.deleteItemAsync(TOKEN_KEY),
              SecureStore.deleteItemAsync(USER_KEY),
            ]);
            if (mounted) setState({ isLoaded: true, token: null, user: null, shopSuspended: false });
          } else {
            // Network error – use cached user (safely parse to avoid crashing on corrupt data)
            const user: User | null = userJson
              ? (() => { try { return JSON.parse(userJson) as User; } catch { return null; } })()
              : null;
            if (mounted) setState({ isLoaded: true, token, user, shopSuspended: false });
          }
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

    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, token),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(user ?? null)),
    ]);
    setState({ isLoaded: true, token, user: user ?? null, shopSuspended: false });
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
    ]);
    setState({ isLoaded: true, token: null, user: null, shopSuspended: false });
  }, [state.token]);

  const value = React.useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signOut, updateUser }),
    [state, signIn, signOut, updateUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
