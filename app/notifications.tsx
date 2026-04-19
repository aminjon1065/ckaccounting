import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { FlatList, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge, Card, CardContent, Separator, Text } from "@/components/ui";
import { getUnreadNotifications, markNotificationsRead, type LocalNotification } from "@/lib/db";

export default function NotificationsScreen() {
  const [notifications, setNotifications] = React.useState<LocalNotification[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);

  async function loadNotifications() {
    const notifs = await getUnreadNotifications();
    setNotifications(notifs);
  }

  React.useEffect(() => {
    loadNotifications();
  }, []);

  async function handleMarkRead() {
    const ids = notifications.map(n => n.id);
    await markNotificationsRead(ids);
    await loadNotifications();
  }

  async function handleRefresh() {
    setRefreshing(true);
    await loadNotifications();
    setRefreshing(false);
  }

  function getIcon(type: string) {
    if (type === "low_stock") return "warning-amber";
    if (type === "sync_error") return "sync-problem";
    return "notifications";
  }

  function getIconColor(type: string) {
    if (type === "low_stock") return "#f59e0b";
    if (type === "sync_error") return "#ef4444";
    return "#0a7ea4";
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "только что";
    if (diffMins < 60) return `${diffMins} мин. назад`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} ч. назад`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} дн. назад`;
    return d.toLocaleDateString("ru-RU");
  }

  function renderItem({ item }: { item: LocalNotification }) {
    const data = item.data ? JSON.parse(item.data) : null;
    return (
      <View key={item.id}>
        <TouchableOpacity
          className="px-4 py-3 flex-row items-start gap-3"
          onPress={async () => {
            await markNotificationsRead([item.id]);
            await loadNotifications();
          }}
        >
          <View
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: getIconColor(item.type) + "20" }}
          >
            <MaterialIcons name={getIcon(item.type) as any} size={20} color={getIconColor(item.type)} />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50 flex-1">
                {item.title}
              </Text>
              {item.type === "low_stock" && (
                <Badge variant="warning">Мало товара</Badge>
              )}
              {item.type === "sync_error" && (
                <Badge variant="destructive">Ошибка</Badge>
              )}
            </View>
            {item.body && (
              <Text variant="small" className="mt-0.5 text-slate-500 dark:text-slate-400">
                {item.body}
              </Text>
            )}
            <Text variant="small" className="mt-1 text-slate-400">
              {formatDate(item.created_at)}
            </Text>
          </View>
          {!item.read && (
            <View className="w-2 h-2 rounded-full bg-primary-500 mt-2" />
          )}
        </TouchableOpacity>
        <Separator className="ml-16" />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      <View className="px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <View className="flex-row items-center justify-between">
          <View>
            <Text variant="h4">Уведомления</Text>
            <Text variant="muted" className="mt-0.5">
              {notifications.length > 0 ? `${notifications.length} новых` : "Нет новых"}
            </Text>
          </View>
          {notifications.length > 0 && (
            <TouchableOpacity onPress={handleMarkRead}>
              <Text className="text-sm text-primary-500 font-medium">Отметить все</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {notifications.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-3">
          <MaterialIcons name="notifications-none" size={56} color="#94a3b8" />
          <Text variant="muted">Нет новых уведомлений</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          renderItem={renderItem}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      )}
    </SafeAreaView>
  );
}
