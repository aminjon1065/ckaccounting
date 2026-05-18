import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar, Button, Skeleton, Text } from "@/components/ui";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { ApiError, type DebtTransaction } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";
import { useIsOnline } from "@/lib/network/NetworkProvider";
import { can } from "@/lib/permissions";
import { fmt as fmtNumber } from "@/lib/formatters";
import { useDebtDetail, useDeleteDebt } from "@/lib/queries/debts";
import { AddTransactionModal } from "@/components/debts/AddTransactionModal";
import { EditDebtModal } from "@/components/debts/EditDebtModal";
import { EditTransactionModal } from "@/components/debts/EditTransactionModal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return fmtNumber(Math.abs(n));
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TX_CONFIG: Record<
  string,
  { icon: React.ComponentProps<typeof MaterialIcons>["name"]; color: string; label: string }
> = {
  give: { icon: "call-made", color: "#16a34a", label: "Мы дали" },
  take: { icon: "call-received", color: "#ef4444", label: "Мы взяли" },
  repay: { icon: "check-circle", color: "#0a7ea4", label: "Погашение" },
};

// ─── Transaction card ────────────────────────────────────────────────────────

function TxCard({
  item,
  onPress,
}: {
  item: DebtTransaction;
  onPress?: () => void;
}) {
  const cfg = TX_CONFIG[item.type] ?? TX_CONFIG.give;
  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper
      onPress={onPress}
      className="flex-row items-center py-3 gap-3 active:opacity-70"
    >
      <View
        className="w-9 h-9 rounded-[10px] items-center justify-center"
        style={{ backgroundColor: cfg.color + "20" }}
      >
        <MaterialIcons name={cfg.icon} size={18} color={cfg.color} />
      </View>
      <View className="flex-1 min-w-0">
        <Text className="text-[14px] font-medium text-slate-900 dark:text-white" numberOfLines={1}>
          {cfg.label}
          {item.note ? ` · ${item.note}` : ""}
        </Text>
        <View className="flex-row items-center gap-1 mt-0.5">
          <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400">
            {fmtDate(item.created_at)}
          </Text>
          {item.created_by_name ? (
            <>
              <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400">·</Text>
              <MaterialIcons name="person" size={11} color="#94a3b8" />
              <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400" numberOfLines={1}>
                {item.created_by_name}
              </Text>
            </>
          ) : null}
        </View>
      </View>
      <Text
        className="font-heading text-[14px] tracking-tight"
        style={{ color: cfg.color, fontVariantLigatures: "none" }}
      >
        {fmt(item.amount)}
      </Text>
      {onPress && (
        <MaterialIcons name="chevron-right" size={18} color="#cbd5e1" />
      )}
    </Wrapper>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function DebtDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const isOnline = useIsOnline();
  const canAddTransaction = can(user?.role, "debts:addTransaction");
  const canEditDebt = can(user?.role, "debts:edit");
  const canDeleteDebt = can(user?.role, "debts:delete");

  const detailQuery = useDebtDetail(id, token);
  const deleteMutation = useDeleteDebt(token);

  const debt = detailQuery.data ?? null;
  const loading = detailQuery.isPending;
  const error = detailQuery.error;
  const deleting = deleteMutation.isPending;
  const isFetchingInBackground = detailQuery.isFetching && !loading;

  const [txVisible, setTxVisible] = React.useState(false);
  const [editVisible, setEditVisible] = React.useState(false);
  // Tap-to-edit any transaction in the history. Sellers can edit their
  // own debts' transactions; owners can edit any debt's transactions in
  // their shop. Backend recomputes the parent debt's balance on save.
  const [editingTx, setEditingTx] = React.useState<DebtTransaction | null>(null);

  const handleDelete = React.useCallback(() => {
    if (!debt) return;
    Alert.alert(
      "Удалить запись о долге?",
      "История транзакций сохранится в архиве, но запись пропадёт из списка.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync({ id: debt.id });
              showToast({ message: "Долг удалён", variant: "success" });
              router.back();
            } catch (e: any) {
              if (e instanceof ApiError && e.status === 404) {
                showToast({
                  message: "Долг уже был удалён.",
                  variant: "error",
                });
                router.back();
              } else if (e instanceof ApiError && e.status === 0) {
                Alert.alert(
                  "Нет соединения",
                  "Не удалось связаться с сервером. Попробуйте, когда восстановится интернет.",
                );
              } else {
                Alert.alert("Ошибка", e?.message ?? "Не удалось удалить долг.");
              }
            }
          },
        },
      ],
    );
  }, [debt, deleteMutation, router, showToast]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
        <View className="flex-1 px-4 pt-20 gap-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
          <Skeleton className="h-16 rounded-2xl" />
        </View>
      </SafeAreaView>
    );
  }

  const is404 = error instanceof ApiError && error.status === 404;
  if (!debt) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons
          name={is404 ? "person-off" : isOnline ? "error-outline" : "cloud-off"}
          size={48}
          color="#94a3b8"
        />
        <Text variant="h5" className="mt-4 text-center">
          {is404
            ? "Запись не найдена."
            : isOnline
              ? "Не удалось загрузить долг."
              : "Нет соединения"}
        </Text>
        {!is404 && (
          <Text variant="muted" className="mt-2 text-center">
            {isOnline
              ? (error as Error)?.message ?? "Попробуйте ещё раз."
              : "Откройте экран, когда восстановится интернет."}
          </Text>
        )}
        <View className="flex-row gap-3 mt-4">
          <Button variant="outline" onPress={() => router.back()}>Назад</Button>
          {!is404 && (
            <Button onPress={() => detailQuery.refetch()}>Повторить</Button>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // The schema keeps `balance >= 0` always; the direction column carries
  // the sign. Reading sign off `balance` would treat every payable as a
  // receivable — see app/debts/index.tsx for the full invariant note.
  const isReceivable = debt.direction !== "payable";
  const isSettled = debt.balance === 0;
  const transactions = debt.transactions ?? [];
  const amountClass = isReceivable
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-500";
  const sinceLabel = `${isReceivable ? "Дебитор" : "Кредитор"} · с ${new Date(debt.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center gap-2 px-4 pt-4 pb-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
        >
          <MaterialIcons name="arrow-back" size={20} color="#475569" />
        </Pressable>
        <View className="flex-1 min-w-0">
          <Text
            className="font-heading text-[17px] tracking-tight text-slate-900 dark:text-white"
            numberOfLines={1}
          >
            {debt.person_name}
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
            {sinceLabel}
          </Text>
        </View>
        {isFetchingInBackground && (
          <Text variant="muted" className="text-xs mr-1">Обновляется…</Text>
        )}
        {canEditDebt && (
          <Pressable
            onPress={() => setEditVisible(true)}
            hitSlop={8}
            className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70 ml-2"
          >
            <MaterialIcons name="edit" size={18} color="#475569" />
          </Pressable>
        )}
        {canDeleteDebt && (
          <Pressable
            onPress={handleDelete}
            disabled={deleting}
            hitSlop={8}
            className="w-9 h-9 rounded-full bg-red-50 dark:bg-red-900/20 items-center justify-center active:opacity-70 ml-2"
          >
            <MaterialIcons name="delete-outline" size={18} color="#ef4444" />
          </Pressable>
        )}
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero card */}
        <View className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 p-5 items-center mb-3.5">
          <Avatar name={debt.person_name} size="lg" />
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 font-medium mt-3">
            {isSettled
              ? "Долг закрыт"
              : isReceivable
                ? "Должен нам"
                : "Мы должны"}
          </Text>
          <View className="flex-row items-baseline gap-1.5 mt-1">
            <Text
              className={`font-heading text-[34px] leading-[38px] tracking-tight ${
                isSettled
                  ? "text-slate-400 dark:text-zinc-500"
                  : amountClass
              }`}
              style={{ fontVariantLigatures: "none" }}
            >
              {isSettled ? "" : isReceivable ? "+" : "−"}{fmt(debt.balance)}
            </Text>
            <Text className="text-[14px] font-medium text-slate-500 dark:text-zinc-400">
              {DEFAULT_CURRENCY}
            </Text>
          </View>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-1">
            Старт: {fmt(debt.opening_balance)} {DEFAULT_CURRENCY}
            {transactions.length > 0 ? `  ·  ${transactions.length} операций` : ""}
          </Text>
          {canAddTransaction && (
            <View className="flex-row gap-2 mt-4 w-full">
              <Pressable
                onPress={() => setTxVisible(true)}
                className="flex-1 bg-primary-500 rounded-2xl py-3 flex-row items-center justify-center gap-1.5 active:opacity-80"
              >
                <MaterialIcons name="add" size={18} color="#fff" />
                <Text className="text-[14px] font-semibold text-white">
                  Добавить операцию
                </Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* History */}
        <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 px-1 mb-2">
          История ({transactions.length})
        </Text>
        {transactions.length === 0 ? (
          <View className="bg-white dark:bg-zinc-900 rounded-2xl p-8 items-center border border-slate-200 dark:border-zinc-800">
            <MaterialIcons name="receipt" size={36} color="#94a3b8" />
            <Text variant="muted" className="mt-2 text-center">
              Операций нет.
            </Text>
          </View>
        ) : (
          <View className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 overflow-hidden">
            {transactions.map((tx, idx) => (
              <View
                key={tx.id}
                className={
                  idx === transactions.length - 1
                    ? "px-3.5"
                    : "px-3.5 border-b border-slate-100 dark:border-zinc-800"
                }
              >
                <TxCard
                  item={tx}
                  onPress={canEditDebt ? () => setEditingTx(tx) : undefined}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {canAddTransaction && token && (
        <AddTransactionModal
          visible={txVisible}
          debtId={debt.id}
          currentBalance={debt.balance}
          isReceivable={isReceivable}
          token={token}
          onClose={() => setTxVisible(false)}
          onMissing={() => {
            // Mutation onError handles cache rollback; just leave the
            // screen so the user can go back.
            showToast({
              message: "Долг был удалён.",
              variant: "error",
            });
            router.back();
          }}
        />
      )}

      {canEditDebt && token && editingTx && (
        <EditTransactionModal
          visible={true}
          debt={debt}
          transaction={editingTx}
          token={token}
          onClose={() => setEditingTx(null)}
        />
      )}

      {canEditDebt && token && (
        <EditDebtModal
          visible={editVisible}
          debt={debt}
          token={token}
          onClose={() => setEditVisible(false)}
          onMissing={() => {
            showToast({ message: "Долг был удалён.", variant: "error" });
            router.back();
          }}
        />
      )}
    </SafeAreaView>
  );
}
