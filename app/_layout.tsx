import "../global.css";

import * as SplashScreen from "expo-splash-screen";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { LogBox } from "react-native";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts as useInterFonts,
} from "@expo-google-fonts/inter";
import {
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts as useJakartaFonts,
} from "@expo-google-fonts/plus-jakarta-sans";

import { ErrorBoundary } from "@/components/error-boundary";
import { BiometricGuard } from "@/components/auth/BiometricGuard";
import { MigrationBlockedScreen } from "@/components/MigrationBlockedScreen";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { SyncProvider } from "@/lib/sync/SyncContext";
import { BackgroundSync } from "@/lib/sync/BackgroundSync";
import { ConflictProvider } from "@/lib/sync/ConflictContext";
import { AuthProvider, useAuth } from "@/store/auth";
import { ToastProvider } from "@/store/toast";
import { requestNotificationPermissions } from "@/lib/notifications";
import { initDb } from "@/lib/db";
import { OutboxNotDrainedError } from "@/lib/db/schema";
import { reportError } from "@/lib/observability/reporter";

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated",
  "expo-notifications: Android Push notifications",
  "`expo-notifications` functionality is not fully supported in Expo Go",
]);

SplashScreen.preventAutoHideAsync();

const SPLASH_MIN_DURATION_MS = 2500;
const APP_START_AT = Date.now();

async function hideSplashAfterMinDuration() {
  const elapsed = Date.now() - APP_START_AT;
  const remaining = SPLASH_MIN_DURATION_MS - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  await SplashScreen.hideAsync().catch(() => {});
}

// Removed SyncGuard in favor of SyncProvider and Background syncing.

function AuthGuard() {
  const { isLoaded, token, shopSuspended, tokenExpired, pinSetupPending, bootstrapPending } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;
    hideSplashAfterMinDuration();

    // Shop suspended takes priority
    if (token && shopSuspended) {
      router.replace("/suspended");
      return;
    }

    const inAuthGroup = segments[0] === "(auth)";
    const inSuspendedScreen = segments[0] === "suspended";

    // Token expired — force re-login
    if (tokenExpired && !inAuthGroup) {
      router.replace("/(auth)/login?reason=expired");
      return;
    }

    // Two gates keep the user inside (auth) even when a token exists:
    //   pinSetupPending — PIN must be created before entering tabs
    //   bootstrapPending — initial post-login data pull must complete first
    // Both block tab navigation; only the absence of both lets the user in.
    const authBlocked = pinSetupPending || bootstrapPending;
    if (token && authBlocked && !inAuthGroup) router.replace("/(auth)/login");
    else if (!token && !inAuthGroup) router.replace("/(auth)/login");
    else if (token && inAuthGroup && !authBlocked) router.replace("/(tabs)");
    else if (!token && inSuspendedScreen) router.replace("/(auth)/login");
    else if (token && !shopSuspended && inSuspendedScreen) router.replace("/(tabs)");
  }, [isLoaded, token, shopSuspended, tokenExpired, pinSetupPending, bootstrapPending, segments, router]);

  return null;
}

// State machine for the DB-init step. Three terminal states:
//   loading  — `initDb()` is in flight, render nothing (splash is still up).
//   ready    — proceed to the normal app tree.
//   blocked  — destructive migration refused to run because the outbox is
//              not drained; render MigrationBlockedScreen with retry.
// Any *other* init failure falls through to `ready` with a reportError —
// the offline-first SyncProvider re-tries open() on its own when SQLite is
// reachable again, so we don't block the user on a transient open glitch.
type DbInitState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "blocked"; error: OutboxNotDrainedError };

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const [dbState, setDbState] = useState<DbInitState>({ kind: "loading" });
  // Bumping this re-runs the initDb effect. The retry button on
  // MigrationBlockedScreen calls handleRetry which increments it.
  const [retryKey, setRetryKey] = useState(0);

  const [interLoaded] = useInterFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [jakartaLoaded] = useJakartaFonts({
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  const fontsLoaded = interLoaded && jakartaLoaded;

  // Request notification permissions in the background. Defer past first
  // paint so the user sees UI immediately — the OS prompt would otherwise
  // tax JS thread during mount.
  useEffect(() => {
    const handle = setTimeout(() => {
      requestNotificationPermissions().catch(() => {});
    }, 1000);
    return () => clearTimeout(handle);
  }, []);

  // Initialize DB before rendering any providers that depend on it. Re-runs
  // when retryKey changes (after the user clicks "try again" on the blocked
  // screen). initDb() itself nulls its module-level promise cache on
  // failure, so a fresh call genuinely re-attempts the migration.
  useEffect(() => {
    let cancelled = false;
    setDbState({ kind: "loading" });
    initDb()
      .then(() => {
        if (!cancelled) setDbState({ kind: "ready" });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof OutboxNotDrainedError) {
          setDbState({ kind: "blocked", error: e });
          return;
        }
        // Any other error: log and proceed. SyncProvider's retry loop will
        // pick up the slack once the underlying issue clears.
        reportError(e, { tag: "init-db-non-blocking" });
        setDbState({ kind: "ready" });
      });
    return () => {
      cancelled = true;
    };
  }, [retryKey]);

  const handleRetry = useCallback(async () => {
    // Best-effort outbox drain before re-attempting the migration. The
    // blocked screen sits *before* SyncProvider mounts, so the user can't
    // rely on the regular periodic sync loop to empty the queue — they'd
    // be stuck. Pull the token from SecureStore directly and run one
    // OutboxProcessor pass; if it succeeds, the next initDb() will pass
    // the guard. If offline / unauthed / partial, the guard re-triggers
    // and the user sees the screen again with the still-unsynced count.
    try {
      const [{ OutboxProcessor }, SecureStore, { STORAGE_KEYS }] = await Promise.all([
        import("@/lib/sync/OutboxProcessor"),
        import("expo-secure-store"),
        import("@/constants/config"),
      ]);
      const token = await SecureStore.getItemAsync(STORAGE_KEYS.authToken);
      if (token) {
        await new OutboxProcessor().triggerSync(token);
      }
    } catch (e) {
      reportError(e, { tag: "migration-retry-outbox-drain" });
    }
    setRetryKey((k) => k + 1);
  }, []);

  if (dbState.kind === "loading" || !fontsLoaded) {
    return null;
  }

  if (dbState.kind === "blocked") {
    // The normal AuthGuard hides the splash; we won't reach AuthGuard from
    // this branch, so hide it explicitly to avoid a frozen-splash UX.
    hideSplashAfterMinDuration();
    return (
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
          <MigrationBlockedScreen error={dbState.error} onRetry={handleRetry} />
          <StatusBar style="auto" />
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <ToastProvider>
            <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
              <AuthGuard />
              <SyncProvider>
                <BackgroundSync>
                <ConflictProvider>
                  <BiometricGuard>
                  <OfflineBanner />
                  <Stack>
                  <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="suspended" options={{ headerShown: false }} />
                  <Stack.Screen name="debts" options={{ headerShown: false }} />
                  <Stack.Screen name="purchases" options={{ headerShown: false }} />
                  <Stack.Screen name="expenses" options={{ headerShown: false }} />
                  <Stack.Screen name="users" options={{ headerShown: false }} />
                  <Stack.Screen name="sales" options={{ headerShown: false }} />
                  <Stack.Screen name="products" options={{ headerShown: false }} />
                  <Stack.Screen name="shops" options={{ headerShown: false }} />
                  <Stack.Screen name="notifications" options={{ headerShown: false }} />
                  <Stack.Screen name="sync-errors" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="modal"
                    options={{ presentation: "modal", title: "Modal" }}
                  />
                  </Stack>
                </BiometricGuard>
                </ConflictProvider>
                </BackgroundSync>
              </SyncProvider>
              <StatusBar style="auto" />
            </ThemeProvider>
          </ToastProvider>
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
