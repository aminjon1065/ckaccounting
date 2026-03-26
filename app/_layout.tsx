import "../global.css";

import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import { useColorScheme } from "@/hooks/use-color-scheme";
import { AuthProvider, useAuth } from "@/store/auth";
import { ToastProvider } from "@/store/toast";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/error-boundary";
import * as Network from "expo-network";
import { useSyncStore } from "@/store/syncStore";

SplashScreen.preventAutoHideAsync();

function SyncGuard() {
  const { token, isLoaded } = useAuth();
  const syncSales = useSyncStore((s) => s.syncSales);

  useEffect(() => {
    if (!isLoaded || !token) return;

    // Check on mount
    Network.getNetworkStateAsync().then((state) => {
      if (state.isConnected) syncSales(token);
    });

    // Or poll every 30 seconds to flush queue
    const interval = setInterval(() => {
      Network.getNetworkStateAsync().then((state) => {
        if (state.isConnected) syncSales(token);
      });
    }, 30000);

    return () => clearInterval(interval);
  }, [isLoaded, token, syncSales]);

  return null;
}

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
  }, [isLoaded, token, shopSuspended, segments]);

  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <ToastProvider>
            <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
              <AuthGuard />
              <SyncGuard />
              <Stack>
                <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="suspended" options={{ headerShown: false }} />
                <Stack.Screen name="debts" options={{ headerShown: false }} />
                <Stack.Screen name="purchases" options={{ headerShown: false }} />
                <Stack.Screen name="reports" options={{ headerShown: false }} />
                <Stack.Screen name="users" options={{ headerShown: false }} />
                <Stack.Screen name="sales" options={{ headerShown: false }} />
                <Stack.Screen name="products" options={{ headerShown: false }} />
                <Stack.Screen
                  name="modal"
                  options={{ presentation: "modal", title: "Modal" }}
                />
              </Stack>
              <StatusBar style="auto" />
            </ThemeProvider>
          </ToastProvider>
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
