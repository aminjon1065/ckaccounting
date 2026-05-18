import * as React from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Text } from "@/components/ui";
import { useIsFetching } from "@tanstack/react-query";
import { useIsOnline } from "@/lib/network/NetworkProvider";

/**
 * Top-of-screen connectivity / cache-refresh status banner.
 *
 * Online-first build renders one of two states (priority order, top wins):
 *   1. offline  — device has no connectivity. Shows "офлайн".
 *   2. syncing  — cache refresh is in flight. Animated.
 *
 * Clean state (online, idle) renders nothing — a single store read on the
 * happy path. The pre-migration "pending actions" / "failed actions" branches
 * are gone with the outbox.
 */
export function OfflineBanner() {
  const isOnline = useIsOnline();
  // `useIsFetching()` from React Query returns the number of currently
  // running queries across the whole app. Any non-zero count means
  // *something* is being pulled in the background.
  const inflightCount = useIsFetching();
  const insets = useSafeAreaInsets();

  const offline = !isOnline;
  const syncing = !offline && inflightCount > 0;

  if (!offline && !syncing) return null;

  const top = Platform.OS === "ios" ? insets.top : 0;
  const variant: "offline" | "syncing" = offline ? "offline" : "syncing";
  const text = variant === "offline"
    ? "Нет соединения · работаем офлайн"
    : "Синхронизация…";

  return (
    <View
      pointerEvents="none"
      style={[
        styles.container,
        styles[variant],
        { paddingTop: top + 4 },
      ]}
    >
      {variant === "syncing" ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <MaterialIcons name="cloud-off" size={14} color="#fff" />
      )}
      <Text style={styles.text}>{text}</Text>
    </View>
  );
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
  offline: {
    backgroundColor: "#dc2626",
  },
  syncing: {
    backgroundColor: "#2563eb",
  },
  text: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
