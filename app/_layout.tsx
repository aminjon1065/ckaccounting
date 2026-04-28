import "../global.css";

import * as SplashScreen from "expo-splash-screen";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
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
import { useColorScheme } from "@/hooks/use-color-scheme";
import { SyncProvider } from "@/lib/sync/SyncContext";
import { ConflictProvider } from "@/lib/sync/ConflictContext";
import { ConflictResolutionModal } from "@/components/sync/ConflictResolutionModal";
import { AuthProvider, useAuth } from "@/store/auth";
import { ToastProvider } from "@/store/toast";
import { requestNotificationPermissions } from "@/lib/notifications";
import { initDb } from "@/lib/db";

LogBox.ignoreLogs([
  "SafeAreaView has been deprecated",
  "expo-notifications: Android Push notifications",
  "`expo-notifications` functionality is not fully supported in Expo Go",
]);

SplashScreen.preventAutoHideAsync();

// Removed SyncGuard in favor of SyncProvider and Background syncing.

function AuthGuard() {
  const { isLoaded, token, shopSuspended, tokenExpired, pinSetupPending } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;
    SplashScreen.hideAsync();

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

    if (!token && !inAuthGroup) router.replace("/(auth)/login");
    else if (token && inAuthGroup && !pinSetupPending) router.replace("/(tabs)");
    else if (!token && inSuspendedScreen) router.replace("/(auth)/login");
    else if (token && !shopSuspended && inSuspendedScreen) router.replace("/(tabs)");
  }, [isLoaded, token, shopSuspended, tokenExpired, pinSetupPending, segments, router]);

  return null;
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const [isDbReady, setIsDbReady] = useState(false);

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

  // Request notification permissions on app start
  useEffect(() => {
    requestNotificationPermissions();
  }, []);

  // Initialize DB before rendering any providers that depend on it
  useEffect(() => {
    initDb()
      .then(() => setIsDbReady(true))
      .catch((e) => {
        console.error("Failed to init DB:", e);
        setIsDbReady(true); // Still proceed — SyncProvider will retry
      });
  }, []);

  if (!isDbReady || !fontsLoaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <ToastProvider>
            <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
              <AuthGuard />
              <SyncProvider>
                <ConflictProvider>
                  <ConflictResolutionModal />
                  <BiometricGuard>
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
              </SyncProvider>
              <StatusBar style="auto" />
            </ThemeProvider>
          </ToastProvider>
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
