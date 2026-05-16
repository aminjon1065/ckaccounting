import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";
import * as React from "react";
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar, Text } from "@/components/ui";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { useAuth } from "@/store/auth";

import { SettingsRow } from "@/components/settings/SettingsRow";
import { ShopSettingsModal } from "@/components/settings/ShopSettingsModal";
import { EditProfileModal } from "@/components/settings/EditProfileModal";
import { ChangePinModal } from "@/components/settings/ChangePinModal";
import { useColorScheme } from "@/hooks/use-color-scheme";

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
  const { user, signOut, token, hasPin } = useAuth();
  const router = useRouter();
  const [shopSettingsVisible, setShopSettingsVisible] = React.useState(false);
  const [editProfileVisible, setEditProfileVisible] = React.useState(false);
  const [changePinVisible, setChangePinVisible] = React.useState(false);
  const [pinIsSet, setPinIsSet] = React.useState(false);
  const [biometricStatus, setBiometricStatus] = React.useState<
    "checking" | "ready" | "not-enrolled" | "unavailable"
  >("checking");
  const [biometricLabel, setBiometricLabel] = React.useState("Проверка…");
  const { colorScheme, toggleColorScheme } = useColorScheme();

  // Probe PIN + biometric state so the rows reflect reality.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pinSet, hasHardware, isEnrolled, types] = await Promise.all([
        hasPin(),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
      ]);
      if (cancelled) return;
      setPinIsSet(pinSet);
      if (!hasHardware) {
        setBiometricStatus("unavailable");
        setBiometricLabel("Недоступно");
      } else if (!isEnrolled) {
        setBiometricStatus("not-enrolled");
        setBiometricLabel("Не настроено");
      } else {
        setBiometricStatus("ready");
        const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
        const hasFinger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
        setBiometricLabel(
          hasFace && Platform.OS === "ios"
            ? "Face ID включён"
            : hasFace
              ? "Распознавание лица включено"
              : hasFinger
                ? "Отпечаток включён"
                : "Включена",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasPin, changePinVisible]);

  const handleBiometricPress = React.useCallback(() => {
    const titleMap = {
      checking: "Биометрия",
      ready: "Биометрия включена",
      "not-enrolled": "Биометрия не настроена",
      unavailable: "Биометрия недоступна",
    } as const;
    const messageMap = {
      checking: "Подождите, идёт проверка устройства…",
      ready: "Управление биометрией доступно в системных настройках устройства.",
      "not-enrolled":
        "На устройстве не настроен Face ID / отпечаток. Добавьте их в системных настройках, чтобы использовать в приложении.",
      unavailable: "Это устройство не поддерживает биометрическую разблокировку.",
    } as const;
    const canOpenSettings =
      biometricStatus === "ready" || biometricStatus === "not-enrolled";
    Alert.alert(
      titleMap[biometricStatus],
      messageMap[biometricStatus],
      canOpenSettings
        ? [
            { text: "Закрыть", style: "cancel" },
            { text: "Открыть настройки", onPress: () => Linking.openSettings() },
          ]
        : [{ text: "OK" }],
    );
  }, [biometricStatus]);

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
            onPress={handleBiometricPress}
            rightText={biometricLabel}
          />
          <SettingsRow
            icon="lock"
            label="PIN-код"
            description="4-значный код"
            iconTone="primary"
            onPress={() => setChangePinVisible(true)}
            rightText={pinIsSet ? "Изменить" : "Задать"}
            last
          />
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
        user={user ?? null}
      />

      <EditProfileModal
        visible={editProfileVisible}
        onClose={() => setEditProfileVisible(false)}
        token={token!}
      />

      <ChangePinModal
        visible={changePinVisible}
        onClose={() => setChangePinVisible(false)}
        hasExistingPin={pinIsSet}
      />
    </SafeAreaView>
  );
}
