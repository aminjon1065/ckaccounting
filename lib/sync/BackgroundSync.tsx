import React, { useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as TaskManager from "expo-task-manager";
import { triggerSync } from "@/lib/sync/SyncContext";

// ─── Background Task Definitions ───────────────────────────────────────────────

const BACKGROUND_SYNC_TASK = "ck-background-sync";

TaskManager.defineBackgroundTask(BACKGROUND_SYNC_TASK, async () => {
  // This runs when the OS triggers the background task
  try {
    await triggerSync();
  } catch (e) {
    console.error("Background sync failed:", e);
  }
  return null;
});

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useBackgroundSync(enabled: boolean) {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    if (!enabled) return;

    // Register the background task
    TaskManager.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      canBeExecutedInBackground: true,
    }).catch(console.error);

    // Schedule the task to run periodically
    const scheduleBackgroundSync = async () => {
      await TaskManager.scheduleTaskAsync(BACKGROUND_SYNC_TASK, {
        type: TaskManager.TaskType.BACKGROUND,
        timeout: 30_000, // 30 second timeout for each run
        periodic: {
          delay: 60_000, // Repeat every minute (minimum)
        },
      });
    };

    scheduleBackgroundSync().catch(console.error);

    // Also sync when app returns to foreground
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
      TaskManager.cancelTaskAsync(BACKGROUND_SYNC_TASK).catch(() => {});
    };
  }, [enabled]);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BackgroundSync({ children }: { children: React.ReactNode }) {
  useBackgroundSync(true);
  return <>{children}</>;
}
