import React, { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import * as SecureStore from "expo-secure-store";
import { STORAGE_KEYS } from "@/constants/config";
import { getDb, initDb } from "../db";
import { SyncOrchestrator } from "./SyncOrchestrator";
import { useSync } from "./SyncContext";

// ─── Background Task Definitions ───────────────────────────────────────────────

const BACKGROUND_SYNC_TASK = "ck-background-sync";

/**
 * Self-contained background sync handler.
 * Called by the OS when the background task fires — runs outside the React tree,
 * so it must read auth credentials from SecureStore directly.
 */
TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const token = await SecureStore.getItemAsync(STORAGE_KEYS.authToken);
    const authUserStr = await SecureStore.getItemAsync(STORAGE_KEYS.authUser);
    if (!token || !authUserStr) {
      // No logged-in session — nothing to sync
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    let shopId: number | undefined;
    try {
      const authUser = JSON.parse(authUserStr) as { shop_id?: number };
      shopId = authUser.shop_id;
    } catch {}

    // initDb() ensures all tables exist on fresh install/background run.
    await initDb();
    getDb(); // ensure DB is open

    // Run full sync: outbox push + pull all remote entities.
    const orchestrator = new SyncOrchestrator(() => ({ token, shopId }));
    await orchestrator.syncAll(false);

    const db = getDb();
    await db.runAsync(
      "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)",
      ["last_background_sync_at", new Date().toISOString()]
    );

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    // Write error durably so it survives the process exit.
    try {
      const db = getDb();
      await db.runAsync(
        "INSERT OR REPLACE INTO sync_metadata (key, value) VALUES (?, ?)",
        ["last_background_sync_error", String(e)]
      );
    } catch {}
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<boolean> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (
      status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
      status === BackgroundFetch.BackgroundFetchStatus.Denied
    ) {
      console.warn("Background fetch is restricted or denied");
      return false;
    }

    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: 15 * 60, // 15 minutes — iOS minimum on iOS
      stopOnTerminate: false,
      startOnBoot: true,
    });
    return true;
  } catch (e) {
    console.error("Failed to register background sync:", e);
    return false;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBackgroundSync(enabled: boolean) {
  const { triggerSync } = useSync();
  const appState = useRef(AppState.currentState);

  // FIX (Bug 5): Register the background task ONCE on mount.
  // Never unregister in cleanup — the OS task must survive re-renders caused by
  // isOnline/token changes. Unregistering on every triggerSync change (which
  // happens on every network event) left gaps where background sync was inactive.
  useEffect(() => {
    if (!enabled) return;
    registerBackgroundSync().catch(console.error);
    // Intentionally NO cleanup: background fetch should remain registered
    // for the lifetime of the app session.
  }, [enabled]);

  // AppState foreground listener — separate effect so it can track the latest
  // triggerSync without disturbing the background task registration above.
  useEffect(() => {
    if (!enabled) return;

    const subscription = AppState.addEventListener(
      "change",
      (nextAppState: AppStateStatus) => {
        if (
          appState.current.match(/inactive|background/) &&
          nextAppState === "active"
        ) {
          triggerSync().catch(console.error);
        }
        appState.current = nextAppState;
      }
    );

    return () => subscription.remove();  // only removes the AppState listener
  }, [enabled, triggerSync]);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BackgroundSync({ children }: { children: React.ReactNode }) {
  useBackgroundSync(true);
  return <>{children}</>;
}
