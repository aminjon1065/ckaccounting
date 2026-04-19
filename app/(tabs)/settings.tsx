import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  Alert,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar, Card, CardContent, Separator, Text } from "@/components/ui";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { useAuth } from "@/store/auth";

import { SettingsRow } from "@/components/settings/SettingsRow";
import { ShopSettingsModal } from "@/components/settings/ShopSettingsModal";
import { EditProfileModal } from "@/components/settings/EditProfileModal";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useSync } from "@/lib/sync/SyncContext";

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { user, signOut, token } = useAuth();
  const router = useRouter();
  const [shopSettingsVisible, setShopSettingsVisible] = React.useState(false);
  const [editProfileVisible, setEditProfileVisible] = React.useState(false);
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const { failedActionsCount } = useSync();

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <Text variant="h4">Настройки</Text>
        <Text variant="muted" className="mt-0.5">Аккаунт и настройки</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <Card>
          <CardContent className="flex-row items-center gap-4 pt-4">
            <Avatar name={user?.name ?? "?"} size="lg" />

            <View className="flex-1">
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
                {user?.name ?? "—"}
              </Text>
              <Text variant="muted">{user?.email ?? "—"}</Text>
              <View className="flex-row items-center gap-1.5 mt-1">
                <MaterialIcons
                  name={user?.role === "seller" ? "person" : "admin-panel-settings"}
                  size={13}
                  color="#0a7ea4"
                />
                <Text className="text-xs font-medium text-primary-500">
                  {user?.role ? ROLE_LABELS[user.role] : "—"}
                </Text>
                {user?.shop_name && (
                  <Text variant="small"> · {user.shop_name}</Text>
                )}
              </View>
            </View>
            <TouchableOpacity
              onPress={() => setEditProfileVisible(true)}
              className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center"
              hitSlop={8}
            >
              <MaterialIcons name="edit" size={17} color="#0a7ea4" />
            </TouchableOpacity>
          </CardContent>
        </Card>

        {/* Business */}
        {(can(user?.role, "settings:viewShop") || can(user?.role, "reports:view")) && (
          <Card>
            <CardContent className="p-0 pt-0 pb-0">
              {can(user?.role, "settings:viewShop") && (
                <>
                  <SettingsRow
                    icon="storefront"
                    label="Настройки магазина"
                    description="Валюта, налог"
                    onPress={() => setShopSettingsVisible(true)}
                  />
                  {can(user?.role, "expenses:view") && <Separator className="ml-16" />}
                </>
              )}
              {can(user?.role, "expenses:view") && (
                <SettingsRow
                  icon="account-balance-wallet"
                  label="Расходы"
                  description="Учёт расходов"
                  onPress={() => router.push("/expenses")}
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* Records */}
        <Card>
          <CardContent className="p-0 pt-0 pb-0">
            <SettingsRow
              icon="people"
              label="Долги"
              description="Учёт долгов"
              onPress={() => router.push("/debts")}
            />
            {can(user?.role, "purchases:view") && (
              <>
                <Separator className="ml-16" />
                <SettingsRow
                  icon="shopping-bag"
                  label="Закупки"
                  description="История закупок"
                  onPress={() => router.push("/purchases")}
                />
              </>
            )}
            <Separator className="ml-16" />
            <SettingsRow
              icon="notifications"
              label="Уведомления"
              description="Мало товара и другое"
              onPress={() => router.push("/notifications")}
            />
            <Separator className="ml-16" />
            <SettingsRow
              icon="sync-problem"
              label="Ошибки синхронизации"
              description={
                failedActionsCount > 0
                  ? `${failedActionsCount} неудачных`
                  : "Нет ошибок"
              }
              onPress={() => router.push("/sync-errors")}
              rightText={
                failedActionsCount > 0
                  ? `${failedActionsCount}`
                  : undefined
              }
            />
          </CardContent>
        </Card>

        {/* Owner-only */}
        {can(user?.role, "users:view") && (
          <Card>
            <CardContent className="p-0 pt-0 pb-0">
              <SettingsRow
                icon="manage-accounts"
                label="Пользователи"
                description="Управление сотрудниками"
                onPress={() => router.push("/users")}
              />
            </CardContent>
          </Card>
        )}

        {/* SuperAdmin-only */}
        {user?.role === "super_admin" && (
          <Card>
            <CardContent className="p-0 pt-0 pb-0">
              <SettingsRow
                icon="store"
                label="Магазины"
                description="Управление всеми магазинами"
                onPress={() => router.push("/shops")}
              />
            </CardContent>
          </Card>
        )}

        {/* Appearance */}
        <Text variant="small" className="ml-2 uppercase tracking-wide text-slate-500 font-semibold mb-[-8px]">
          Внешний вид
        </Text>
        <Card>
          <CardContent className="p-0 pt-0 pb-0">
            <SettingsRow
              icon={colorScheme === "dark" ? "dark-mode" : "light-mode"}
              label="Тема оформления"
              description={`Текущая: ${colorScheme === "dark" ? "Тёмная" : colorScheme === "system" ? "Системная" : "Светлая"}`}
              onPress={toggleColorScheme}
              rightText="Изменить"
            />
          </CardContent>
        </Card>

        {/* Sign out */}
        <Card>
          <CardContent className="p-0 pt-0 pb-0">
            <SettingsRow
              icon="logout"
              label="Выйти"
              destructive
              onPress={() =>
                Alert.alert("Выход", "Вы уверены, что хотите выйти?", [
                  { text: "Отмена", style: "cancel" },
                  { text: "Выйти", style: "destructive", onPress: signOut },
                ])
              }
            />
          </CardContent>
        </Card>

        <Text variant="small" className="text-center text-slate-400 pb-2 mt-4">
          CK Accounting · v1.0.0
        </Text>
      </ScrollView>

      {/* Shop settings modal */}
      <ShopSettingsModal
        visible={shopSettingsVisible}
        onClose={() => setShopSettingsVisible(false)}
        token={token!}
      />

      {/* Edit profile modal */}
      <EditProfileModal
        visible={editProfileVisible}
        onClose={() => setEditProfileVisible(false)}
        token={token!}
      />
    </SafeAreaView>
  );
}
