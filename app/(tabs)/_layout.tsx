import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { can, hasNoAccessibleShops } from "@/lib/permissions";
import { useAuth } from "@/store/auth";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { NoShopsAssignedScreen } from "@/components/NoShopsAssignedScreen";

const PRIMARY = "#0a7ea4";
const MUTED_LIGHT = "#94a3b8";
const MUTED_DARK = "#71717a";
const BG_LIGHT = "#ffffff";
const BG_DARK = "#18181b";
const BORDER_LIGHT = "#e2e8f0";
const BORDER_DARK = "#27272a";

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];

function TabIcon({ name, color }: { name: IconName; color: string }) {
  return <MaterialIcons name={name} size={24} color={color} />;
}

export default function TabLayout() {
  const { user } = useAuth();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";
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
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: PRIMARY,
        tabBarInactiveTintColor: isDark ? MUTED_DARK : MUTED_LIGHT,
        tabBarStyle: {
          backgroundColor: isDark ? BG_DARK : BG_LIGHT,
          borderTopColor: isDark ? BORDER_DARK : BORDER_LIGHT,
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
          tabBarIcon: ({ color }) => <TabIcon name="receipt-long" color={color} />,
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
