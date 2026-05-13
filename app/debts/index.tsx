import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar, Button, EmptyState, FAB, Input, Select, Skeleton, Text } from "@/components/ui";
import { DEFAULT_CURRENCY } from "@/constants/config";
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

function fmtSince(iso: string): string {
  const d = new Date(iso);
  return `с ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
}

const DebtCard = React.memo(function DebtCard({ item, onPress }: { item: Debt; onPress: () => void }) {
  const isPositive = item.balance >= 0;
  const amountClass = isPositive
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-500";

  return (
    <Pressable
      onPress={onPress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-3.5 mb-2.5 border border-slate-200 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-center gap-3">
        <Avatar name={item.person_name} size="default" />
        <View className="flex-1 min-w-0">
          <Text
            className="text-[15px] font-semibold text-slate-900 dark:text-white"
            numberOfLines={1}
          >
            {item.person_name}
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5" numberOfLines={1}>
            {item.created_by_name ? `${item.created_by_name} · ` : ""}
            {fmtSince(item.created_at)}
          </Text>
        </View>
        <View className="items-end">
          <Text
            className={`font-heading text-[16px] tracking-tight ${amountClass}`}
            style={{ fontVariantLigatures: "none" }}
          >
            {isPositive ? "+" : "−"}{fmt(item.balance)}
          </Text>
          <Text className="text-[10.5px] text-slate-500 dark:text-zinc-400 mt-0.5">
            {DEFAULT_CURRENCY}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});

type DebtTab = "receivable" | "payable";

function DebtTabs({
  active,
  onChange,
  receivableTotal,
  payableTotal,
}: {
  active: DebtTab;
  onChange: (t: DebtTab) => void;
  receivableTotal: number;
  payableTotal: number;
}) {
  return (
    <View className="flex-row gap-6 px-5 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800">
      {(
        [
          { k: "receivable", l: "Нам должны", amt: receivableTotal, color: "text-emerald-600 dark:text-emerald-400" },
          { k: "payable", l: "Мы должны", amt: payableTotal, color: "text-red-500" },
        ] as { k: DebtTab; l: string; amt: number; color: string }[]
      ).map((t) => {
        const isActive = t.k === active;
        return (
          <Pressable
            key={t.k}
            onPress={() => onChange(t.k)}
            className="py-3 flex-col items-start"
            style={{
              borderBottomWidth: 2,
              borderBottomColor: isActive ? "#0a7ea4" : "transparent",
            }}
          >
            <Text
              className={`text-[13.5px] font-semibold ${
                isActive ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-zinc-400"
              }`}
            >
              {t.l}
            </Text>
            <Text
              className={`font-heading text-[12px] tracking-tight mt-0.5 ${t.color}`}
              style={{ fontVariantLigatures: "none" }}
            >
              {fmt(t.amt)} {DEFAULT_CURRENCY}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function DebtTabSummary({
  tab,
  total,
  count,
}: {
  tab: DebtTab;
  total: number;
  count: number;
}) {
  const isReceivable = tab === "receivable";
  return (
    <View className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-200 dark:border-zinc-800">
      <Text className="text-[12px] text-slate-500 dark:text-zinc-400 font-medium">
        Всего {isReceivable ? "нам должны" : "мы должны"}
      </Text>
      <Text
        className={`font-heading text-[26px] leading-[30px] tracking-tight mt-1 ${
          isReceivable ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"
        }`}
        style={{ fontVariantLigatures: "none" }}
      >
        {fmt(total)}{" "}
        <Text className="text-[14px] font-medium text-slate-500 dark:text-zinc-400">
          {DEFAULT_CURRENCY}
        </Text>
      </Text>
      <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-1">
        {count} {isReceivable ? "клиентов" : "позиций"}
      </Text>
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
        <View className="flex-row items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <TouchableOpacity
            onPress={onClose}
            hitSlop={10}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
          >
            <MaterialIcons name="close" size={20} color="#475569" />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="font-heading text-[17px] tracking-tight text-slate-900 dark:text-white">
              Новый долг
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Контрагент и стартовый баланс
            </Text>
          </View>
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
  const [activeTab, setActiveTab] = React.useState<DebtTab>("receivable");
  const canCreateDebt = can(user?.role, "debts:create");

  // Per-tab totals + filtered list. `balance >= 0` means they owe us
  // (receivable), `< 0` means we owe them (payable). The card always shows
  // the absolute value; the sign drives colour + tab placement.
  const { receivableTotal, payableTotal, filtered } = React.useMemo(() => {
    let receivable = 0;
    let payable = 0;
    const inTab: Debt[] = [];
    for (const d of debts) {
      if (d.balance >= 0) {
        receivable += d.balance;
        if (activeTab === "receivable") inTab.push(d);
      } else {
        payable += Math.abs(d.balance);
        if (activeTab === "payable") inTab.push(d);
      }
    }
    return { receivableTotal: receivable, payableTotal: payable, filtered: inTab };
  }, [debts, activeTab]);

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

  const isReceivable = activeTab === "receivable";

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      <View className="flex-row items-center gap-2 px-4 pt-4 pb-3 bg-white dark:bg-zinc-900">
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
        >
          <MaterialIcons name="arrow-back" size={20} color="#475569" />
        </Pressable>
        <View className="flex-1">
          <Text className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white">
            Долги
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
            Дебиторская и кредиторская
          </Text>
        </View>
      </View>

      <DebtTabs
        active={activeTab}
        onChange={setActiveTab}
        receivableTotal={receivableTotal}
        payableTotal={payableTotal}
      />

      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3].map((i) => (
            <View key={i} className="mb-2.5">
              <Skeleton className="h-[72px] rounded-2xl" />
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
          data={filtered}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          ListHeaderComponent={
            debts.length ? (
              <DebtTabSummary
                tab={activeTab}
                total={isReceivable ? receivableTotal : payableTotal}
                count={filtered.length}
              />
            ) : null
          }
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
              title={isReceivable ? "Нам никто не должен" : "Мы никому не должны"}
              description={
                debts.length === 0
                  ? "Добавьте человека или поставщика, чтобы видеть баланс и историю операций."
                  : "В этой вкладке пусто. Переключитесь на другую."
              }
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
