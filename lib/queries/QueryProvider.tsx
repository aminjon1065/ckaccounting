// ─── React Query provider ───────────────────────────────────────────────────
//
// Wraps the tree with a single QueryClient and wires TanStack's
// `onlineManager` and `focusManager` to React Native primitives so the
// library knows when to pause / resume queries.
//
// • onlineManager — driven by the existing NetworkProvider zustand store
//   (one source of truth, no duplicate NetInfo listener). When the device
//   loses connectivity, queries pause and mutations don't fire. When it
//   comes back, every active query refetches automatically.
//
// • focusManager — driven by RN's AppState. Returning to the app from
//   background triggers a refetch of every active query whose
//   `refetchOnWindowFocus` is enabled (we keep that off by default —
//   but useful as an opt-in for screens that need it).

import * as React from "react";
import { AppState, type AppStateStatus, type NativeEventSubscription } from "react-native";
import { QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";

import { makeQueryClient } from "./client";
import { useNetworkStore } from "@/lib/network/NetworkProvider";

// Single instance, created once when the module is first imported. We
// intentionally hold it at module scope (not in component state) so a
// hot reload doesn't blow away the cache.
const queryClient = makeQueryClient();

// Hook TanStack's online manager into our existing NetInfo-backed store.
// `setEventListener` registers a callback that the library calls with a
// setter — we feed it `true/false` whenever the store changes.
onlineManager.setEventListener((setOnline) => {
  const unsubscribe = useNetworkStore.subscribe((state, prev) => {
    if (state.isOnline !== prev.isOnline) {
      setOnline(state.isOnline);
    }
  });
  // Seed with the current value so the library starts in the right state.
  setOnline(useNetworkStore.getState().isOnline);
  return unsubscribe;
});

function onAppStateChange(status: AppStateStatus): void {
  // RN's AppState fires on background/foreground transitions.
  // `focusManager.setFocused(true)` triggers any focus-aware refetches.
  focusManager.setFocused(status === "active");
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const sub: NativeEventSubscription = AppState.addEventListener("change", onAppStateChange);
    return () => sub.remove();
  }, []);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// Exported for non-component code paths that need to invalidate /
// prefetch (e.g. background jobs). Most callers should use the
// `useQueryClient()` hook from `@tanstack/react-query` instead.
export function getQueryClient(): typeof queryClient {
  return queryClient;
}
