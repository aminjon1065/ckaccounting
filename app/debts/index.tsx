import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar, EmptyState, FAB, Skeleton, Text } from "@/components/ui";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { type Debt } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useIsOnline } from "@/lib/network/NetworkProvider";
import { can, effectiveShopId, needsShopPicker, pickerShopIds } from "@/lib/permissions";
import { fmt as fmtNumber } from "@/lib/formatters";
import { useDebtList } from "@/lib/queries/debts";
import { CreateDebtModal } from "@/components/debts/CreateDebtModal";

// ─── Helpers ────────────────────────────────────────────────────────────────
//
// SCHEMA INVARIANT: `Debt.balance >= 0` always. The `direction` column
// (`receivable` | `payable`) carries the sign. When a transaction would
// push the balance negative, DebtService flips `direction` and stores
// the absolute value (see addTransaction in the backend).
//
// So every UI bucket / colour decision must be driven by `direction`,
// NEVER by Math.sign(balance) — they look equivalent on test data but
// silently agree on the wrong answer for real debts (`balance > 0,
// direction = payable` is the common case, and balance-based logic
// would mis-categorize every payable as a receivable).

function fmt(n: number) {
  return fmtNumber(Math.abs(n));
}

function fmtSince(iso: string): string {
  const d = new Date(iso);
  return `с ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
}

function isReceivable(debt: Debt): boolean {
  return debt.direction !== "payable";
}

// ─── Card ───────────────────────────────────────────────────────────────────

const DebtCard = React.memo(function DebtCard({
  item,
  onPress,
}: {
  item: Debt;
  onPress: () => void;
}) {
  const receivable = isReceivable(item);
  const amountClass = receivable
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-500";
  // Settled debts (balance = 0) get a muted look so the user can spot
  // them in the list without bringing them to the foreground.
  const isSettled = item.balance === 0;

  return (
    <Pressable
      onPress={onPress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-3.5 mb-2.5 border border-slate-200 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-center gap-3">
        <View
          className="w-10 h-10 rounded-full items-center justify-center"
          style={{
            backgroundColor: receivable ? "#dcfce7" : "#fee2e2",
          }}
        >
          <MaterialIcons
            name={receivable ? "call-made" : "call-received"}
            size={18}
            color={receivable ? "#16a34a" : "#ef4444"}
          />
        </View>
        <View className="flex-1 min-w-0">
          <Text
            className="text-[15px] font-semibold text-slate-900 dark:text-white"
            numberOfLines={1}
          >
            {item.person_name}
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5" numberOfLines={1}>
            {receivable ? "Должен нам" : "Мы должны"}
            {" · "}
            {fmtSince(item.created_at)}
          </Text>
        </View>
        <View className="items-end">
          {isSettled ? (
            <Text className="text-[14px] font-medium text-slate-400 dark:text-zinc-500">
              Закрыт
            </Text>
          ) : (
            <>
              <Text
                className={`font-heading text-[16px] tracking-tight ${amountClass}`}
                style={{ fontVariantLigatures: "none" }}
              >
                {receivable ? "+" : "−"}{fmt(item.balance)}
              </Text>
              <Text className="text-[10.5px] text-slate-500 dark:text-zinc-400 mt-0.5">
                {DEFAULT_CURRENCY}
              </Text>
            </>
          )}
        </View>
      </View>
    </Pressable>
  );
});

// ─── Top summary card ───────────────────────────────────────────────────────

function DebtsSummary({
  receivable,
  payable,
  receivableCount,
  payableCount,
}: {
  receivable: number;
  payable: number;
  receivableCount: number;
  payableCount: number;
}) {
  const net = receivable - payable;
  const netClass =
    net > 0
      ? "text-emerald-600 dark:text-emerald-400"
      : net < 0
        ? "text-red-500"
        : "text-slate-500 dark:text-zinc-400";

  return (
    <View className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-200 dark:border-zinc-800">
      <View className="flex-row gap-4">
        {/* Receivable */}
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <MaterialIcons name="call-made" size={12} color="#16a34a" />
            <Text className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">
              Нам должны
            </Text>
          </View>
          <Text
            className="font-heading text-[20px] leading-[24px] tracking-tight text-emerald-600 dark:text-emerald-400 mt-1"
            style={{ fontVariantLigatures: "none" }}
          >
            {fmt(receivable)}
          </Text>
          <Text className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
            {receivableCount} {receivableCount === 1 ? "клиент" : "клиентов"}
          </Text>
        </View>

        {/* Divider */}
        <View className="w-px bg-slate-200 dark:bg-zinc-700" />

        {/* Payable */}
        <View className="flex-1">
          <View className="flex-row items-center gap-1.5">
            <MaterialIcons name="call-received" size={12} color="#ef4444" />
            <Text className="text-[11px] font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide">
              Мы должны
            </Text>
          </View>
          <Text
            className="font-heading text-[20px] leading-[24px] tracking-tight text-red-500 mt-1"
            style={{ fontVariantLigatures: "none" }}
          >
            {fmt(payable)}
          </Text>
          <Text className="text-[11px] text-slate-500 dark:text-zinc-400 mt-0.5">
            {payableCount} {payableCount === 1 ? "позиция" : "позиций"}
          </Text>
        </View>
      </View>

      {/* Net (only when both sides have rows) */}
      {(receivable > 0 || payable > 0) && (
        <View className="mt-3 pt-3 border-t border-dashed border-slate-200 dark:border-zinc-700 flex-row justify-between items-baseline">
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400">
            Баланс
          </Text>
          <Text
            className={`font-heading text-[14px] tracking-tight ${netClass}`}
            style={{ fontVariantLigatures: "none" }}
          >
            {net > 0 ? "+" : net < 0 ? "−" : ""}
            {fmt(net)} {DEFAULT_CURRENCY}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function DebtsScreen() {
  const { user, token } = useAuth();
  const isOnline = useIsOnline();
  const router = useRouter();

  const query = useDebtList(token);
  const {
    data,
    error,
    isPending,
    isFetching,
    isRefetching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = query;

  const debts = React.useMemo<Debt[]>(
    () => (data?.pages ?? []).flatMap((p) => p.data),
    [data],
  );

  const [createVisible, setCreateVisible] = React.useState(false);
  const canCreateDebt = can(user?.role, "debts:create");

  // Compute totals. All math driven by `direction` (not by Math.sign(balance)
  // — see invariant note at top of file). Settled rows (balance = 0) stay
  // in the list as notes, like Saldo — they just don't contribute to the
  // totals because there's nothing outstanding.
  const stats = React.useMemo(() => {
    let receivable = 0;
    let payable = 0;
    let receivableCount = 0;
    let payableCount = 0;

    for (const d of debts) {
      if (d.balance === 0) continue;
      if (isReceivable(d)) {
        receivable += d.balance;
        receivableCount += 1;
      } else {
        payable += d.balance;
        payableCount += 1;
      }
    }

    return { receivable, payable, receivableCount, payableCount };
  }, [debts]);

  const renderDebt = React.useCallback(
    ({ item }: { item: Debt }) => (
      <DebtCard item={item} onPress={() => router.push(`/debts/${item.id}`)} />
    ),
    [router],
  );
  const debtKey = React.useCallback((item: Debt) => String(item.id), []);

  const showSkeleton = isPending && debts.length === 0;
  const showHardError = !!error && debts.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center gap-2 px-4 pt-4 pb-3 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800">
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
            Дебиторская и кредиторская задолженность
          </Text>
        </View>
        {isFetching && !isRefetching && debts.length > 0 && (
          <ActivityIndicator size="small" color="#94a3b8" />
        )}
      </View>

      {showSkeleton ? (
        <View className="flex-1 px-4 pt-4">
          <Skeleton className="h-[104px] rounded-2xl mb-3" />
          {[1, 2, 3].map((i) => (
            <View key={i} className="mb-2.5">
              <Skeleton className="h-[72px] rounded-2xl" />
            </View>
          ))}
        </View>
      ) : showHardError ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons
            name={isOnline ? "error-outline" : "cloud-off"}
            size={48}
            color="#94a3b8"
          />
          <Text variant="h5" className="mt-4 text-center">
            {isOnline ? "Ошибка загрузки" : "Нет соединения"}
          </Text>
          <Text variant="muted" className="mt-1 text-center">
            {isOnline
              ? (error as Error)?.message ?? "Попробуйте ещё раз."
              : "Список обновится автоматически, когда вернётся интернет."}
          </Text>
          <TouchableOpacity
            onPress={() => refetch().catch(() => {})}
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
          ListHeaderComponent={
            debts.length ? (
              <DebtsSummary
                receivable={stats.receivable}
                payable={stats.payable}
                receivableCount={stats.receivableCount}
                payableCount={stats.payableCount}
              />
            ) : null
          }
          refreshing={isRefetching}
          onRefresh={() => refetch().catch(() => {})}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage().catch(() => {});
            }
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <EmptyState
              icon="people"
              title="Долгов пока нет"
              description="Добавьте контрагента — кнопка «+» в правом нижнем углу."
            />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator
                size="small"
                color="#0a7ea4"
                style={{ marginVertical: 16 }}
              />
            ) : null
          }
          renderItem={renderDebt}
          keyExtractor={debtKey}
        />
      )}

      {canCreateDebt && <FAB onPress={() => setCreateVisible(true)} />}

      {token && (
        <CreateDebtModal
          visible={createVisible}
          onClose={() => setCreateVisible(false)}
          showShopPicker={needsShopPicker(user)}
          implicitShopId={effectiveShopId(user)}
          allowedShopIds={pickerShopIds(user)}
          token={token}
        />
      )}
    </SafeAreaView>
  );
}
