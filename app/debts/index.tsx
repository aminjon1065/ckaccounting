import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, EmptyState, FAB, Input, Select, Skeleton, Text } from "@/components/ui";
import * as Crypto from "expo-crypto";
import { api, ApiError, type CreateDebtPayload, type Debt } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";
import { getLocalDebts, getLocalShops, localScope } from "@/lib/db";
import { useLastSyncedAt } from "@/lib/cache/CacheProvider";
import { can, effectiveShopId, needsShopPicker } from "@/lib/permissions";
import { reportError } from "@/lib/observability/reporter";
import { fmt as fmtNumber } from "@/lib/formatters";

// Debt amounts are signed in storage; the UI always shows the magnitude and
// adds the +/- glyph at the call-site (different colour treatment per side).
function fmt(n: number) {
  return fmtNumber(Math.abs(n));
}

const DebtCard = React.memo(function DebtCard({ item, onPress }: { item: Debt; onPress: () => void }) {
  const isPositive = item.balance >= 0;
  const accentColor = isPositive ? "#16a34a" : "#ef4444";
  const statusLabel = isPositive ? "Нам должны" : "Мы должны";

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-start">
        <View
          className="w-11 h-11 rounded-full items-center justify-center mr-3"
          style={{ backgroundColor: `${accentColor}18` }}
        >
          <MaterialIcons name={isPositive ? "call-made" : "call-received"} size={20} color={accentColor} />
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-50" numberOfLines={1}>
            {item.person_name}
          </Text>
          <View className="flex-row items-center mt-1">
            <View
              className="px-2 py-1 rounded-full"
              style={{ backgroundColor: `${accentColor}14` }}
            >
              <Text className="text-xs font-semibold" style={{ color: accentColor }}>
                {statusLabel}
              </Text>
            </View>
            <Text variant="small" className="ml-2">
              старт {fmt(item.opening_balance)}
            </Text>
          </View>
          {item.created_by_name ? (
            <View className="flex-row items-center gap-1 mt-1">
              <MaterialIcons name="person" size={12} color="#94a3b8" />
              <Text variant="small" numberOfLines={1}>
                Дал в долг: {item.created_by_name}
              </Text>
            </View>
          ) : null}
        </View>
        <View className="items-end ml-3">
          <Text className="text-lg font-bold" style={{ color: accentColor }}>
            {isPositive ? "+" : "-"}{fmt(item.balance)}
          </Text>
          <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
        </View>
      </View>
    </TouchableOpacity>
  );
});

function DebtSummary({ debts }: { debts: Debt[] }) {
  const receivable = debts.reduce((sum, d) => sum + Math.max(0, d.balance), 0);
  const payable = debts.reduce((sum, d) => sum + Math.abs(Math.min(0, d.balance)), 0);
  const net = receivable - payable;

  return (
    <View className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-4 border border-slate-100 dark:border-zinc-800">
      <View className="flex-row items-center justify-between mb-3">
        <View>
          <Text variant="small">Итоговый баланс</Text>
          <Text
            className={`text-2xl font-bold ${
              net >= 0 ? "text-green-600" : "text-red-500"
            }`}
          >
            {net >= 0 ? "+" : "-"}{fmt(net)}
          </Text>
        </View>
        <View className="w-11 h-11 rounded-full bg-primary-50 dark:bg-blue-900/20 items-center justify-center">
          <MaterialIcons name="account-balance-wallet" size={22} color="#0a7ea4" />
        </View>
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1 rounded-xl bg-green-50 dark:bg-green-900/20 p-3">
          <Text variant="small">Нам должны</Text>
          <Text className="text-base font-semibold text-green-600">{fmt(receivable)}</Text>
        </View>
        <View className="flex-1 rounded-xl bg-red-50 dark:bg-red-900/20 p-3">
          <Text variant="small">Мы должны</Text>
          <Text className="text-base font-semibold text-red-500">{fmt(payable)}</Text>
        </View>
      </View>
    </View>
  );
}

function CreateDebtModal({
  visible,
  onClose,
  onCreated,
  showShopPicker,
  implicitShopId,
  userId: _userId,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (d: Debt) => void;
  /** Render shop picker when true. super_admin and multi-shop owner. */
  showShopPicker: boolean;
  /** Implicit shop for sellers / single-shop owners. */
  implicitShopId?: number | null;
  userId?: number | null;
  token: string;
}) {
  const [shopId, setShopId] = React.useState("");
  const [shops, setShops] = React.useState<{ id: number; name: string }[]>([]);
  const [personName, setPersonName] = React.useState("");
  const [direction, setDirection] = React.useState<"receivable" | "payable">("receivable");
  const [openingBalance, setOpeningBalance] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const { showToast } = useToast();

  React.useEffect(() => {
    if (visible) {
      setShopId("");
      setPersonName("");
      setDirection("receivable");
      setOpeningBalance("");
      setError("");

      if (showShopPicker) {
        // getLocalShops returns shops the user can access (server-scoped
        // when synced; for owners that's their owned set).
        getLocalShops()
          .then((local) => setShops(local.map((shop) => ({ id: shop.id, name: shop.name }))))
          .catch(() => {});
      }
    }
  }, [showShopPicker, visible]);

  async function handleSubmit() {
    setError("");
    if (!personName.trim()) {
      setError("Введите имя.");
      return;
    }
    const selectedShopId = showShopPicker
      ? (shopId ? Number(shopId) : undefined)
      : (implicitShopId ?? undefined);
    if (showShopPicker && !selectedShopId) {
      setError("Выберите магазин.");
      return;
    }
    if (!showShopPicker && !selectedShopId) {
      setError("Магазин не назначен.");
      return;
    }
    setSubmitting(true);
    try {
      const amount = openingBalance ? Number(openingBalance.replace(",", ".")) : 0;
      if (openingBalance && (isNaN(amount) || amount < 0)) {
        setError("Введите сумму без минуса.");
        return;
      }
      const payload: CreateDebtPayload = {
        person_name: personName.trim(),
        direction,
      };
      if (selectedShopId) {
        payload.shop_id = selectedShopId;
      }
      if (amount > 0) {
        payload.opening_balance = amount;
      }

      const idempotencyKey = await Crypto.randomUUID();
      const created = await api.debts.create(payload, token, idempotencyKey);
      onCreated(created);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else {
        setError(e instanceof ApiError ? e.describeErrors() : "Что-то пошло не так.");
      }
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
          <Text variant="h5" className="flex-1 text-center">
            Новый долг
          </Text>
          <View style={{ width: 22 }} />
        </View>

        <KeyboardAvoidingView
          behavior="padding"
          className="flex-1"
        >
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

            <View className="gap-4">
              {showShopPicker && (
                <Select
                  label="Магазин"
                  required
                  value={shopId}
                  onValueChange={setShopId}
                  options={shops.map((shop) => ({ label: shop.name, value: String(shop.id) }))}
                  placeholder="Выберите магазин"
                />
              )}
              <Input
                label="Контрагент"
                required
                placeholder="Напр. Иван Иванов"
                value={personName}
                onChangeText={setPersonName}
                returnKeyType="next"
              />
              <View>
                <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                  Направление
                </Text>
                <View className="flex-row gap-2">
                  {([
                    ["receivable", "Нам должны", "call-made", "#16a34a"],
                    ["payable", "Мы должны", "call-received", "#ef4444"],
                  ] as const).map(([value, label, icon, color]) => {
                    const active = direction === value;
                    return (
                      <TouchableOpacity
                        key={value}
                        onPress={() => setDirection(value)}
                        className={`flex-1 flex-row items-center justify-center gap-2 h-12 rounded-xl border ${
                          active ? "border-transparent" : "border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                        }`}
                        style={active ? { backgroundColor: color } : undefined}
                      >
                        <MaterialIcons name={icon} size={17} color={active ? "#fff" : color} />
                        <Text className={`text-sm font-semibold ${active ? "text-white" : "text-slate-700 dark:text-slate-200"}`}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <Input
                label="Начальная сумма"
                placeholder="0 (необязательно)"
                hint="Введите сумму без минуса, направление выберите выше"
                value={openingBalance}
                onChangeText={setOpeningBalance}
                keyboardType="numeric"
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>

            <Button
              className="mt-6"
              size="lg"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              Создать
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export default function DebtsScreen() {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const lastSyncedAt = useLastSyncedAt();
  const router = useRouter();

  const [debts, setDebts] = React.useState<Debt[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [hasMore, setHasMore] = React.useState(false); // local lists are unpaginated
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [createVisible, setCreateVisible] = React.useState(false);
  const [error, setError] = React.useState("");
  const canCreateDebt = can(user?.role, "debts:create");

  const renderDebt = React.useCallback(
    ({ item }: { item: Debt }) => (
      <DebtCard item={item} onPress={() => router.push(`/debts/${item.id}`)} />
    ),
    [router]
  );
  const debtKey = React.useCallback((item: Debt) => String(item.id), []);

  const fetchDebts = React.useCallback(
    async (reset = false) => {
      setError("");
      try {
        const localDebts = await getLocalDebts(localScope(user));
        setDebts(localDebts);
        setHasMore(false);
      } catch (e) {
        reportError(e, { tag: "debts-fetch" });
        if (reset) setError("Не удалось загрузить долги.");
      }
    },
    [user]
  );

  React.useEffect(() => {
    fetchDebts(true).finally(() => setLoading(false));
  }, [fetchDebts]);

  // FIX: re-fetch whenever a sync cycle completes so that synced debts (with
  // updated real server ids) replace stale tempId records in the list.
  React.useEffect(() => {
    if (lastSyncedAt) {
      fetchDebts(false).catch((e) => reportError(e, { tag: "debts-refetch-on-sync" }));
    }
  }, [fetchDebts, lastSyncedAt]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text variant="h4">Взаиморасчеты</Text>
          <Text variant="muted" className="mt-0.5">
            Кто кому должен
          </Text>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3].map((i) => (
            <View key={i} className="mb-3">
              <Skeleton className="h-16 rounded-2xl" />
            </View>
          ))}
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons name="cloud-off" size={48} color="#94a3b8" />
          <Text variant="h5" className="mt-4 text-center">
            Ошибка загрузки
          </Text>
          <Text variant="muted" className="mt-1 text-center">
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setLoading(true);
              fetchDebts(true).finally(() => setLoading(false));
            }}
            className="mt-4 flex-row items-center gap-2 bg-primary-500 px-5 py-2.5 rounded-xl"
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={debts}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          ListHeaderComponent={debts.length ? <DebtSummary debts={debts} /> : null}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchDebts(true).finally(() => setRefreshing(false));
          }}
          onEndReached={() => {
            if (!hasMore || loadingMore) return;
            setLoadingMore(true);
            fetchDebts(false).finally(() => setLoadingMore(false));
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <EmptyState
              icon="people"
              title="Пока нет записей"
              description="Добавьте человека или поставщика, чтобы видеть баланс и историю операций."
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color="#0a7ea4" style={{ marginVertical: 16 }} />
            ) : null
          }
          renderItem={renderDebt}
          keyExtractor={debtKey}
        />
      )}

      {canCreateDebt && (
        <FAB onPress={() => setCreateVisible(true)} />
      )}

      {token && (
        <CreateDebtModal
          visible={createVisible}
          onClose={() => setCreateVisible(false)}
          onCreated={(d) => {
            setDebts((prev) => [d, ...prev]);
            showToast({ message: "Запись добавлена", variant: "success" });
          }}
          showShopPicker={needsShopPicker(user)}
          implicitShopId={effectiveShopId(user)}
          userId={user?.id}
          token={token}
        />
      )}
    </SafeAreaView>
  );
}
