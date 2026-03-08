import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";

const PRIMARY = "#0a7ea4";
const MUTED = "#94a3b8";

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];

function TabIcon({ name, color }: { name: IconName; color: string }) {
  return <MaterialIcons name={name} size={24} color={color} />;
}

export default function TabLayout() {
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
          title: "Продажи",
          tabBarIcon: ({ color }) => (
            <TabIcon name="receipt-long" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          title: "Расходы",
          tabBarIcon: ({ color }) => (
            <TabIcon name="account-balance-wallet" color={color} />
          ),
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
