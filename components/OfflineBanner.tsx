import * as React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Text } from "@/components/ui";
import { useSync } from "@/lib/sync/SyncContext";

/**
 * Top-of-screen sync/connectivity status banner.
 *
 * Renders one of four states (priority order, top wins):
 *   1. failed   — outbox has actions that the server rejected; tappable,
 *                  routes to /sync-errors so the user can act on them.
 *   2. offline  — device has no connectivity. Shows "офлайн".
 *   3. syncing  — outbox push or remote pull is in flight. Animated.
 *   4. pending  — online & idle but the queue still has items waiting.
 *
 * The clean state (online, queue empty, not syncing) renders nothing — a
 * single context read on the happy path.
 */
export function OfflineBanner() {
  const { isOnline, isSyncing, pendingActionsCount, failedActionsCount } = useSync();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const failed = failedActionsCount > 0;
  const offline = !isOnline;
  const syncing = isSyncing;
  const pending = !syncing && pendingActionsCount > 0;

  if (!failed && !offline && !syncing && !pending) return null;

  const top = Platform.OS === "ios" ? insets.top : 0;

  // failed > offline > syncing > pending
  const variant: "failed" | "offline" | "syncing" | "pending" =
    failed ? "failed" : offline ? "offline" : syncing ? "syncing" : "pending";

  const text =
    variant === "failed"
      ? `${failedActionsCount} ${pluralizeAction(failedActionsCount)} не отправлено · нажмите`
      : variant === "offline"
        ? "Нет соединения · работаем офлайн"
        : variant === "syncing"
          ? pendingActionsCount > 0
            ? `Синхронизация · ${pendingActionsCount} ${pluralizeAction(pendingActionsCount)}`
            : "Синхронизация…"
          : `Ожидает синхронизации: ${pendingActionsCount}`;

  const handlePress = () => {
    if (variant === "failed") router.push("/sync-errors");
  };

  // Only the failed banner is interactive — others stay tap-through so users
  // can still hit UI underneath.
  const tapThrough = variant !== "failed";

  return (
    <Pressable
      onPress={handlePress}
      pointerEvents={tapThrough ? "none" : "auto"}
      style={[
        styles.container,
        styles[variant],
        { paddingTop: top + 4 },
      ]}
    >
      {variant === "syncing" ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <MaterialIcons
          name={
            variant === "failed"
              ? "error-outline"
              : variant === "offline"
                ? "cloud-off"
                : "sync"
          }
          size={14}
          color="#fff"
        />
      )}
      <Text style={styles.text}>{text}</Text>
    </Pressable>
  );
}

function pluralizeAction(n: number): string {
  // 1 действие, 2-4 действия, 5+ действий
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return "действий";
  if (mod10 === 1) return "действие";
  if (mod10 >= 2 && mod10 <= 4) return "действия";
  return "действий";
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingBottom: 4,
    paddingHorizontal: 12,
  },
  failed: {
    backgroundColor: "#dc2626",
  },
  offline: {
    backgroundColor: "#dc2626",
  },
  syncing: {
    backgroundColor: "#2563eb",
  },
  pending: {
    backgroundColor: "#f59e0b",
  },
  text: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
