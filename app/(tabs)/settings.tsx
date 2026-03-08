import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  Alert,
  Modal,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar, Button, Card, CardContent, Input, Separator, Text } from "@/components/ui";
import { api, ApiError, type ShopSettings } from "@/lib/api";
import { useAuth } from "@/store/auth";

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];

// ─── Settings row ─────────────────────────────────────────────────────────────

function SettingsRow({
  icon,
  label,
  description,
  onPress,
  destructive,
  rightText,
}: {
  icon: IconName;
  label: string;
  description?: string;
  onPress?: () => void;
  destructive?: boolean;
  rightText?: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3.5 active:bg-slate-50 dark:active:bg-zinc-800"
    >
      <View
        className={`w-8 h-8 rounded-lg items-center justify-center ${
          destructive ? "bg-red-100 dark:bg-red-900/30" : "bg-slate-100 dark:bg-zinc-800"
        }`}
      >
        <MaterialIcons
          name={icon}
          size={18}
          color={destructive ? "#ef4444" : "#0a7ea4"}
        />
      </View>
      <View className="flex-1">
        <Text
          className={`text-sm font-medium ${
            destructive
              ? "text-red-500"
              : "text-slate-900 dark:text-slate-50"
          }`}
        >
          {label}
        </Text>
        {description && <Text variant="small">{description}</Text>}
      </View>
      {rightText && (
        <Text variant="small" className="mr-1">{rightText}</Text>
      )}
      {!destructive && (
        <MaterialIcons name="chevron-right" size={18} color="#94a3b8" />
      )}
    </TouchableOpacity>
  );
}

// ─── Shop settings modal ──────────────────────────────────────────────────────

function ShopSettingsModal({
  visible,
  onClose,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  token: string;
}) {
  const [currency, setCurrency] = React.useState("");
  const [taxPercent, setTaxPercent] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!visible) return;
    setError("");
    setLoading(true);
    api.settings
      .get(token)
      .then((s: ShopSettings) => {
        setCurrency(s.default_currency ?? "");
        setTaxPercent(s.tax_percent != null ? String(s.tax_percent) : "0");
      })
      .catch(() => setError("Не удалось загрузить настройки."))
      .finally(() => setLoading(false));
  }, [visible]);

  async function handleSave() {
    setError("");
    if (!currency.trim()) { setError("Введите код валюты."); return; }
    const tax = parseFloat(taxPercent);
    if (isNaN(tax) || tax < 0 || tax > 100) {
      setError("Налог должен быть от 0 до 100.");
      return;
    }
    setSubmitting(true);
    try {
      await api.settings.update(
        { default_currency: currency.trim().toUpperCase(), tax_percent: tax },
        token
      );
      Alert.alert("Сохранено", "Настройки магазина обновлены.");
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось сохранить.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-white dark:bg-zinc-950">
        <View className="flex-row items-center px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <MaterialIcons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
          <Text variant="h5" className="flex-1 text-center">Настройки магазина</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          className="flex-1 px-5"
          contentContainerStyle={{ paddingTop: 20, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {!!error && (
            <View className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 mb-4 flex-row items-center gap-2">
              <MaterialIcons name="error-outline" size={16} color="#ef4444" />
              <Text className="text-sm text-red-600 flex-1">{error}</Text>
            </View>
          )}

          {loading ? (
            <Text variant="muted" className="text-center py-8">Загрузка…</Text>
          ) : (
            <View className="gap-4">
              <Input
                label="Валюта"
                required
                placeholder="напр. UZS"
                value={currency}
                onChangeText={setCurrency}
                autoCapitalize="characters"
                hint="Код ISO (напр. UZS, USD, EUR)"
              />
              <Input
                label="Налог (%)"
                placeholder="0"
                value={taxPercent}
                onChangeText={setTaxPercent}
                keyboardType="numeric"
                hint="0 — без налога"
              />
            </View>
          )}

          <Button
            className="mt-6"
            size="lg"
            onPress={handleSave}
            loading={submitting}
            disabled={submitting || loading}
          >
            Сохранить
          </Button>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { user, signOut, token } = useAuth();
  const router = useRouter();
  const [shopSettingsVisible, setShopSettingsVisible] = React.useState(false);

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
                  name={user?.role === "owner" ? "admin-panel-settings" : "person"}
                  size={13}
                  color="#0a7ea4"
                />
                <Text className="text-xs font-medium text-primary-500 capitalize">
                  {user?.role ?? "—"}
                </Text>
                {user?.shop_name && (
                  <Text variant="small"> · {user.shop_name}</Text>
                )}
              </View>
            </View>
          </CardContent>
        </Card>

        {/* Business */}
        <Card>
          <CardContent className="p-0 pt-0 pb-0">
            <SettingsRow
              icon="storefront"
              label="Настройки магазина"
              description="Валюта, налог"
              onPress={() => setShopSettingsVisible(true)}
            />
            <Separator className="ml-16" />
            <SettingsRow
              icon="bar-chart"
              label="Отчёты"
              description="Продажи, расходы, прибыль"
              onPress={() => router.push("/reports")}
            />
          </CardContent>
        </Card>

        {/* Records */}
        <Card>
          <CardContent className="p-0 pt-0 pb-0">
            <SettingsRow
              icon="people"
              label="Долги"
              description="Учёт долгов"
              onPress={() => router.push("/debts")}
            />
            <Separator className="ml-16" />
            <SettingsRow
              icon="shopping-bag"
              label="Закупки"
              description="История закупок"
              onPress={() => router.push("/purchases")}
            />
          </CardContent>
        </Card>

        {/* Owner-only */}
        {(user?.role === "owner" || user?.role === "super_admin") && (
          <Card>
            <CardContent className="p-0 pt-0 pb-0">
              <SettingsRow
                icon="manage-accounts"
                label="Пользователи"
                description="Управление сотрудниками"
                onPress={() =>
                  Alert.alert(
                    "Скоро",
                    "Управление пользователями появится в следующем обновлении."
                  )
                }
              />
            </CardContent>
          </Card>
        )}

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

        <Text variant="small" className="text-center text-slate-400 pb-2">
          CK Accounting · v1.0.0
        </Text>
      </ScrollView>

      {/* Shop settings modal */}
      <ShopSettingsModal
        visible={shopSettingsVisible}
        onClose={() => setShopSettingsVisible(false)}
        token={token!}
      />
    </SafeAreaView>
  );
}
