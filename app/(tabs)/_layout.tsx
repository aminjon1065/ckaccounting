import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs } from "expo-router";
import { Platform, View } from "react-native";

import { can } from "@/lib/permissions";
import { useAuth } from "@/store/auth";
import { useSync } from "@/lib/sync/SyncContext";

const PRIMARY = "#0a7ea4";
const MUTED = "#94a3b8";

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];

function TabIcon({ name, color }: { name: IconName; color: string }) {
  return <MaterialIcons name={name} size={24} color={color} />;
}

function SalesTabIcon({ color }: { color: string }) {
  const { pendingActionsCount } = useSync();
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

  return (
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
          height: Platform.OS === "ios" ? 88 : 64,
          paddingBottom: Platform.OS === "ios" ? 28 : 10,
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
  );
}
