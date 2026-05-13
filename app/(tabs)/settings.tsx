import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar, Text } from "@/components/ui";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { getEntityRowCounts } from "@/lib/db";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";

import { SettingsRow } from "@/components/settings/SettingsRow";
import { ShopSettingsModal } from "@/components/settings/ShopSettingsModal";
import { EditProfileModal } from "@/components/settings/EditProfileModal";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useCacheMethods } from "@/lib/cache/CacheProvider";
import { useIsOnline } from "@/lib/network/NetworkProvider";

// ─── Section label ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 px-1 mt-4 mb-2">
      {children}
    </Text>
  );
}

// ─── Card wrapper for grouped rows ───────────────────────────────────────────

function GroupCard({ children }: { children: React.ReactNode }) {
  return (
    <View className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
      {children}
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { user, signOut, token } = useAuth();
  const router = useRouter();
  const [shopSettingsVisible, setShopSettingsVisible] = React.useState(false);
  const [editProfileVisible, setEditProfileVisible] = React.useState(false);
  const { colorScheme, toggleColorScheme } = useColorScheme();
  const { fetchAllHistory } = useCacheMethods();
  const isOnline = useIsOnline();
  const { showToast } = useToast();

  // Full-history backfill state — shown inline so the user sees per-entity progress.
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyProgress, setHistoryProgress] = React.useState<{
    products: number;
    shops: number;
    debts: number;
    sales: number;
    expenses: number;
    purchases: number;
  }>({
    products: 0,
    shops: 0,
    debts: 0,
    sales: 0,
    expenses: 0,
    purchases: 0,
  });

  const handleLoadAllHistory = React.useCallback(() => {
    if (historyLoading) return;
    if (!isOnline) {
      showToast({ message: "Нет сети. Подключитесь к интернету.", variant: "warning" });
      return;
    }
    Alert.alert(
      "Загрузить всю историю?",
      "Будут скачаны все товары, магазины, долги, продажи, расходы и закупки. Это может занять несколько минут и потребует трафика.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Загрузить",
          onPress: async () => {
            setHistoryLoading(true);
            setHistoryProgress({ products: 0, shops: 0, debts: 0, sales: 0, expenses: 0, purchases: 0 });
            try {
              await fetchAllHistory(({ entity, pagesPulled }) => {
                setHistoryProgress((prev) => ({ ...prev, [entity]: pagesPulled }));
              });
              const counts = await getEntityRowCounts();
              const summary = [
                `Товары: ${counts.products}`,
                `Магазины: ${counts.shops}`,
                `Долги: ${counts.debts}`,
                `Продажи: ${counts.sales}`,
                `Расходы: ${counts.expenses}`,
                `Закупки: ${counts.purchases}`,
              ].join("\n");
              const total =
                counts.products + counts.shops + counts.debts + counts.sales + counts.expenses + counts.purchases;
              Alert.alert(
                total > 0 ? "История загружена" : "Загрузка завершена, но данных нет",
                summary,
                [{ text: "OK" }],
              );
            } catch {
              showToast({ message: "Не удалось загрузить всю историю.", variant: "error" });
            } finally {
              setHistoryLoading(false);
            }
          },
        },
      ],
    );
  }, [historyLoading, isOnline, fetchAllHistory, showToast]);

  const themeLabel =
    colorScheme === "dark" ? "Тёмная" : colorScheme === "system" ? "Системная" : "Светлая";

  const showBusinessGroup =
    can(user?.role, "settings:viewShop") || can(user?.role, "expenses:view");
  const showRecordsGroup =
    can(user?.role, "debts:view") || can(user?.role, "purchases:view");

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="px-5 pt-4 pb-3 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800">
        <Text className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white">
          Настройки
        </Text>
        <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
          Аккаунт и приложение
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <View className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl p-3.5 flex-row items-center gap-3.5">
          <Avatar name={user?.name ?? "?"} size="lg" />
          <View className="flex-1 min-w-0">
            <Text
              className="text-[15px] font-semibold text-slate-900 dark:text-white"
              numberOfLines={1}
            >
              {user?.name ?? "—"}
            </Text>
            <Text
              className="text-[12.5px] text-slate-500 dark:text-zinc-400 mt-0.5"
              numberOfLines={1}
            >
              {user?.email ?? "—"}
            </Text>
            <View className="flex-row items-center gap-1.5 mt-1">
              <MaterialIcons
                name={user?.role === "seller" ? "person" : "admin-panel-settings"}
                size={11}
                color="#0a7ea4"
              />
              <Text className="text-[11px] font-semibold text-primary-500">
                {user?.role ? ROLE_LABELS[user.role] : "—"}
              </Text>
              {user?.shop_name && (
                <Text className="text-[11px] text-slate-500 dark:text-zinc-400" numberOfLines={1}>
                  · {user.shop_name}
                </Text>
              )}
            </View>
          </View>
          <Pressable
            onPress={() => setEditProfileVisible(true)}
            hitSlop={8}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
          >
            <MaterialIcons name="edit" size={16} color="#0a7ea4" />
          </Pressable>
        </View>

        {/* Business */}
        {showBusinessGroup && (
          <>
            <SectionLabel>Бизнес</SectionLabel>
            <GroupCard>
              {can(user?.role, "settings:viewShop") && (
                <SettingsRow
                  icon="storefront"
                  label="Настройки магазина"
                  description="Валюта, налог, реквизиты"
                  iconTone="primary"
                  onPress={() => setShopSettingsVisible(true)}
                  last={!can(user?.role, "expenses:view")}
                />
              )}
              {can(user?.role, "expenses:view") && (
                <SettingsRow
                  icon="account-balance-wallet"
                  label="Расходы"
                  description="Учёт расходов"
                  iconTone="destructive"
                  onPress={() => router.push("/expenses")}
                  last={!can(user?.role, "purchases:view")}
                />
              )}
              {can(user?.role, "purchases:view") && (
                <SettingsRow
                  icon="shopping-bag"
                  label="Закупки"
                  description="История прихода товара"
                  iconTone="success"
                  onPress={() => router.push("/purchases")}
                  last
                />
              )}
            </GroupCard>
          </>
        )}

        {/* Records */}
        {showRecordsGroup && (
          <>
            <SectionLabel>Учёт</SectionLabel>
            <GroupCard>
              {can(user?.role, "debts:view") && (
                <SettingsRow
                  icon="people"
                  label="Долги"
                  description="Дебиторская и кредиторская"
                  iconTone="primary"
                  onPress={() => router.push("/debts")}
                  last={false}
                />
              )}
              <SettingsRow
                icon="notifications"
                label="Уведомления"
                description="Мало товара и долги"
                iconTone="warning"
                onPress={() => router.push("/notifications")}
                last
              />
            </GroupCard>
          </>
        )}

        {/* Team (owner only) */}
        {can(user?.role, "users:view") && (
          <>
            <SectionLabel>Команда</SectionLabel>
            <GroupCard>
              <SettingsRow
                icon="manage-accounts"
                label="Сотрудники"
                description="Управление доступом и ролями"
                iconTone="primary"
                onPress={() => router.push("/users")}
                last
              />
            </GroupCard>
          </>
        )}

        {/* Administration (super_admin) */}
        {user?.role === "super_admin" && (
          <>
            <SectionLabel>Администрирование</SectionLabel>
            <GroupCard>
              <SettingsRow
                icon="store"
                label="Магазины"
                description="Все магазины сети"
                iconTone="primary"
                onPress={() => router.push("/shops")}
              />
              <SettingsRow
                icon="manage-accounts"
                label="Все пользователи"
                description="Сотрудники во всех магазинах"
                iconTone="primary"
                onPress={() => router.push("/users")}
                last
              />
            </GroupCard>
          </>
        )}

        {/* Appearance */}
        <SectionLabel>Внешний вид</SectionLabel>
        <GroupCard>
          <SettingsRow
            icon={colorScheme === "dark" ? "dark-mode" : "light-mode"}
            label="Тема оформления"
            iconTone="neutral"
            onPress={toggleColorScheme}
            rightText={themeLabel}
            last
          />
        </GroupCard>

        {/* Security */}
        <SectionLabel>Безопасность</SectionLabel>
        <GroupCard>
          <SettingsRow
            icon="fingerprint"
            label="Биометрия"
            description="Face ID / отпечаток"
            iconTone="primary"
          />
          <SettingsRow
            icon="lock"
            label="PIN-код"
            description="4-значный код"
            iconTone="primary"
            rightText="Изменить"
            last
          />
        </GroupCard>

        {/* Data */}
        <SectionLabel>Данные</SectionLabel>
        <GroupCard>
          <SettingsRow
            icon="cloud-download"
            label="Загрузить всю историю"
            description="На устройство для офлайн-работы"
            iconTone="primary"
            onPress={handleLoadAllHistory}
            rightText={historyLoading ? undefined : "Запустить"}
            last={!historyLoading}
          />
          {historyLoading && (
            <View className="px-3.5 pb-3.5 pt-2 border-t border-slate-100 dark:border-zinc-800">
              <View className="flex-row items-center gap-2 mb-2">
                <ActivityIndicator size="small" color="#0a7ea4" />
                <Text className="text-[12.5px] text-slate-500 dark:text-zinc-400">
                  Идёт загрузка истории…
                </Text>
              </View>
              <Text className="text-[11px] text-slate-500 dark:text-zinc-400 leading-[16px]">
                Товары {historyProgress.products > 0 ? "✓" : "…"} ·
                {" "}Магазины {historyProgress.shops > 0 ? "✓" : "…"} ·
                {" "}Долги {historyProgress.debts > 0 ? "✓" : "…"} ·
                {" "}Продажи {historyProgress.sales} стр. ·
                {" "}Расходы {historyProgress.expenses} стр. ·
                {" "}Закупки {historyProgress.purchases} стр.
              </Text>
            </View>
          )}
        </GroupCard>

        {/* Sign out */}
        <View className="mt-4">
          <GroupCard>
            <SettingsRow
              icon="logout"
              label="Выйти"
              destructive
              last
              onPress={() =>
                Alert.alert("Выход", "Вы уверены, что хотите выйти?", [
                  { text: "Отмена", style: "cancel" },
                  { text: "Выйти", style: "destructive", onPress: () => signOut() },
                ])
              }
            />
          </GroupCard>
        </View>

        <Text className="text-[11px] text-slate-400 dark:text-zinc-600 text-center pb-2 mt-6">
          CK Accounting · v1.0.0 · {themeLabel.toLowerCase()}
        </Text>
      </ScrollView>

      <ShopSettingsModal
        visible={shopSettingsVisible}
        onClose={() => setShopSettingsVisible(false)}
        token={token!}
        isSuperAdmin={user?.role === "super_admin"}
        currentShopId={user?.shop_id}
      />

      <EditProfileModal
        visible={editProfileVisible}
        onClose={() => setEditProfileVisible(false)}
        token={token!}
      />
    </SafeAreaView>
  );
}
