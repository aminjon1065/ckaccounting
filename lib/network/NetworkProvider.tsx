// ─── Network provider ────────────────────────────────────────────────────────
//
// Minimal replacement for the old SyncContext + syncStore. After the
// online-first migration the only piece of cross-cutting state UI still cares
// about is whether the device is online.
//
// API:
//   <NetworkProvider> — wraps the tree near the root
//   useIsOnline() — boolean, re-renders on online↔offline edge
//
// Implementation: a Zustand store driven by a single NetInfo listener mounted
// inside the provider. NetInfo's reachability check returns null briefly on
// Android — we treat null as "online" to avoid a false-offline flash at boot.

import * as React from "react";
import NetInfo from "@react-native-community/netinfo";
import { create } from "zustand";

interface NetworkState {
  isOnline: boolean;
}

export const useNetworkStore = create<NetworkState>(() => ({
  isOnline: true,
}));

export function NetworkProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = !!state.isConnected && state.isInternetReachable !== false;
      if (useNetworkStore.getState().isOnline !== online) {
        useNetworkStore.setState({ isOnline: online });
      }
    });

    // Kick the listener once on mount so the initial value reflects the
    // current device state, not the optimistic default.
    NetInfo.fetch()
      .then((state) => {
        const online = !!state.isConnected && state.isInternetReachable !== false;
        if (useNetworkStore.getState().isOnline !== online) {
          useNetworkStore.setState({ isOnline: online });
        }
      })
      .catch(() => {});

    return unsubscribe;
  }, []);

  return <>{children}</>;
}

// ─── Selector hooks ──────────────────────────────────────────────────────────

export const useIsOnline = () => useNetworkStore((s) => s.isOnline);
