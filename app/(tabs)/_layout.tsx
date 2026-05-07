import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs } from "expo-router";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { can, hasNoAccessibleShops } from "@/lib/permissions";
import { useAuth } from "@/store/auth";
import { usePendingActionsCount } from "@/lib/sync/syncStore";
import { ConflictResolutionModal } from "@/components/sync/ConflictResolutionModal";
import { NoShopsAssignedScreen } from "@/components/NoShopsAssignedScreen";

const PRIMARY = "#0a7ea4";
const MUTED = "#94a3b8";

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];

function TabIcon({ name, color }: { name: IconName; color: string }) {
  return <MaterialIcons name={name} size={24} color={color} />;
}

function SalesTabIcon({ color }: { color: string }) {
  const pendingActionsCount = usePendingActionsCount();
  return (
    <View>
      <MaterialIcons name="receipt-long" size={24} color={color} />
      {pendingActionsCount > 0 && (
        <View
          style={{
            position: "absolute",
            top: -3,
            right: -6,
            backgroundColor: "#f59e0b",
            borderRadius: 6,
            minWidth: 12,
            height: 12,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 2,
          }}
        />
      )}
    </View>
  );
}

export default function TabLayout() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === "android" ? insets.bottom : Math.max(insets.bottom, 20);
  const tabBarPaddingBottom = Math.max(bottomInset, Platform.OS === "ios" ? 20 : 10);
  const tabBarHeight = 56 + tabBarPaddingBottom;

  // Owner without any assigned shops can't meaningfully use any tab
  // (every list would be empty, every form blocked at validation).
  // Replace the tabs with a clear "wait for admin" state until the
  // assignment lands.
  if (hasNoAccessibleShops(user)) {
    return <NoShopsAssignedScreen />;
  }

  return (
    <>
    <ConflictResolutionModal />
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          backgroundColor: Platform.OS === "ios" ? undefined : "#ffffff",
          borderTopColor: "#e2e8f0",
          borderTopWidth: 1,
          elevation: 0,
          height: tabBarHeight,
          paddingBottom: tabBarPaddingBottom,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "500",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Главная",
          tabBarIcon: ({ color }) => <TabIcon name="dashboard" color={color} />,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: "Товары",
          tabBarIcon: ({ color }) => <TabIcon name="inventory" color={color} />,
        }}
      />
      <Tabs.Screen
        name="sales"
        options={{
          title: "Продажа",
          tabBarIcon: ({ color }) => <SalesTabIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: "Отчёты",
          tabBarIcon: ({ color }) => (
            <TabIcon name="bar-chart" color={color} />
          ),
          tabBarItemStyle: can(user?.role, "reports:view")
            ? undefined
            : { display: "none" },
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Настройки",
          tabBarIcon: ({ color }) => <TabIcon name="settings" color={color} />,
        }}
      />
    </Tabs>
    </>
  );
}
