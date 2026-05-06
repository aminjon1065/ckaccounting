import * as React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Text } from "@/components/ui";
import { useSync } from "@/lib/sync/SyncContext";

/**
 * Thin top-of-screen banner shown whenever the device is offline.
 *
 * Mounts under every top-level screen so the user always knows when the app
 * is operating against cached data. Renders nothing while online so it costs
 * a single context read on the happy path.
 */
export function OfflineBanner() {
  const { isOnline, pendingActionsCount } = useSync();
  const insets = useSafeAreaInsets();

  if (isOnline && pendingActionsCount === 0) return null;

  const top = Platform.OS === "ios" ? insets.top : 0;
  const offline = !isOnline;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.container,
        offline ? styles.offline : styles.syncing,
        { paddingTop: top + 4 },
      ]}
    >
      <MaterialIcons
        name={offline ? "cloud-off" : "sync"}
        size={14}
        color="#fff"
      />
      <Text style={styles.text}>
        {offline
          ? "Нет соединения · работаем офлайн"
          : `Синхронизация · ожидает ${pendingActionsCount}`}
      </Text>
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
    backgroundColor: "#f59e0b",
  },
  text: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
