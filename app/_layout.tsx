import "../global.css";

import * as SplashScreen from "expo-splash-screen";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { LogBox } from "react-native";
import "react-native-reanimated";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/error-boundary";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { SyncProvider } from "@/lib/sync/SyncContext";
import { AuthProvider, useAuth } from "@/store/auth";
import { ToastProvider } from "@/store/toast";

LogBox.ignoreLogs(["SafeAreaView has been deprecated"]);

SplashScreen.preventAutoHideAsync();

// Removed SyncGuard in favor of SyncProvider and Background syncing.

function AuthGuard() {
  const { isLoaded, token, shopSuspended } = useAuth();
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

    if (!token && !inAuthGroup) router.replace("/(auth)/login");
    else if (token && inAuthGroup) router.replace("/(tabs)");
    else if (!token && inSuspendedScreen) router.replace("/(auth)/login");
    else if (token && !shopSuspended && inSuspendedScreen) router.replace("/(tabs)");
  }, [isLoaded, token, shopSuspended, segments, router]);

  return null;
}

export default function RootLayout() {
  const { colorScheme } = useColorScheme();

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <ToastProvider>
            <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
              <AuthGuard />
              <SyncProvider>
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
                  <Stack.Screen
                    name="modal"
                    options={{ presentation: "modal", title: "Modal" }}
                  />
                </Stack>
              </SyncProvider>
              <StatusBar style="auto" />
            </ThemeProvider>
          </ToastProvider>
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
