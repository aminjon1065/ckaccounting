import React, { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as BackgroundFetch from "expo-background-fetch";
import * as TaskManager from "expo-task-manager";
import { useSync } from "./SyncContext";

// ─── Background Task Definitions ───────────────────────────────────────────────

const BACKGROUND_SYNC_TASK = "ck-background-sync";

// Module-level ref for triggerSync so background task can call it
let backgroundTriggerSync: (() => Promise<void>) | null = null;

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  // This runs when the OS triggers the background task
  // The app's SyncProvider setInterval handles actual sync — this just signals work may be pending
  try {
    if (backgroundTriggerSync) {
      await backgroundTriggerSync();
    }
  } catch (e) {
    console.error("Background sync failed:", e);
  }
  return BackgroundFetch.BackgroundFetchResult.NewData;
});

export async function registerBackgroundSync(): Promise<boolean> {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted || status === BackgroundFetch.BackgroundFetchStatus.Denied) {
      console.warn("Background fetch is restricted or denied");
      return false;
    }

    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: 15 * 60, // 15 minutes — OS minimum on iOS
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

  // Register background trigger function
  useEffect(() => {
    backgroundTriggerSync = triggerSync;
    return () => {
      if (backgroundTriggerSync === triggerSync) {
        backgroundTriggerSync = null;
      }
    };
  }, [triggerSync]);

  useEffect(() => {
    if (!enabled) return;

    // Register background task
    registerBackgroundSync().catch(console.error);

    // Sync when app returns to foreground
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

    return () => {
      subscription.remove();
      BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK).catch(() => {});
    };
  }, [enabled, triggerSync]);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function BackgroundSync({ children }: { children: React.ReactNode }) {
  useBackgroundSync(true);
  return <>{children}</>;
}