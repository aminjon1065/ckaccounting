import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Skeleton, Text } from "@/components/ui";
import {
  ApiError,
  type CreateDebtTransactionPayload,
  type Debt,
  type DebtTransaction,
} from "@/lib/api";
import { getLocalDebtById, insertOrUpdateDebtTransactions, queueSyncAction } from "@/lib/db";
import { generateUUID } from "@/lib/uuid";
import { useSyncMethods } from "@/lib/sync/SyncContext";
import { can } from "@/lib/permissions";
import { useAuth } from "@/store/auth";
import { reportError } from "@/lib/observability/reporter";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return Math.round(Math.abs(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
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

type TransactionType = "give" | "take" | "repay";
type MaterialIconName = React.ComponentProps<typeof MaterialIcons>["name"];
type TransactionOption = {
  value: TransactionType;
  submitType?: TransactionType;
  label: string;
  description: string;
  icon: MaterialIconName;
  color: string;
};

// ─── Transaction card ─────────────────────────────────────────────────────────

function TxCard({ item }: { item: DebtTransaction }) {
  const cfg = TX_CONFIG[item.type] ?? TX_CONFIG.give;

  return (
    <View className="flex-row items-center py-3.5 border-b border-slate-100 dark:border-zinc-800">
      <View
        className="w-9 h-9 rounded-full items-center justify-center mr-3"
        style={{ backgroundColor: cfg.color + "20" }}
      >
        <MaterialIcons name={cfg.icon} size={18} color={cfg.color} />
      </View>
      <View className="flex-1">
        <Text className="text-sm font-medium text-slate-900 dark:text-slate-50">
          {cfg.label}
        </Text>
        {item.note ? (
          <Text variant="small">{item.note}</Text>
        ) : null}
        <Text variant="small">{fmtDate(item.created_at)}</Text>
      </View>
      <Text
        className="text-sm font-bold"
        style={{ color: cfg.color }}
      >
        {fmt(item.amount)}
      </Text>
    </View>
  );
}

// ─── Add transaction modal ────────────────────────────────────────────────────

function AddTransactionModal({
  visible,
  debtId,
  currentBalance,
  onClose,
  onAdded,
}: {
  visible: boolean;
  debtId: string;
  currentBalance: number;
  onClose: () => void;
  onAdded: (tx: DebtTransaction, newBalance: number) => void;
}) {
  const [type, setType] = React.useState<TransactionType>(
    currentBalance >= 0 ? "give" : "take"
  );
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const { refreshPendingActions, triggerSync } = useSyncMethods();

  React.useEffect(() => {
    if (visible) {
      setType(currentBalance >= 0 ? "give" : "take");
      setAmount("");
      setNote("");
      setError("");
    }
  }, [currentBalance, visible]);

  async function handleSubmit() {
    setError("");
    const numericAmount = Number(amount.replace(",", "."));
    if (!amount || isNaN(numericAmount) || numericAmount <= 0) {
      setError("Введите корректную сумму.");
      return;
    }
    if (type === "repay" && currentBalance === 0) {
      setError("Текущий баланс уже закрыт.");
      return;
    }
    if (type === "repay" && numericAmount > Math.abs(currentBalance)) {
      setError("Сумма погашения больше текущего долга.");
      return;
    }
    setSubmitting(true);
    try {
      const serverType: TransactionType = type === "take" ? "give" : type;
      const txId = generateUUID();
      const payload: CreateDebtTransactionPayload & { id: string } = {
        id: txId,
        type: serverType,
        amount: numericAmount,
      };
      if (note.trim()) payload.note = note.trim();

      const tx: DebtTransaction = {
        id: txId,
        debt_id: debtId,
        type,
        amount: payload.amount,
        note: payload.note ?? null,
        created_at: new Date().toISOString()
      };
      const delta =
        type === "give" ? numericAmount :
        type === "take" ? -numericAmount :
        currentBalance >= 0 ? -numericAmount : numericAmount;

      await insertOrUpdateDebtTransactions([tx]);

      // Update the stored raw balance. Payable debts synced from the server are
      // stored as a positive amount plus direction='payable', while old local
      // rows may still be signed.
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      const row = await db.getFirstAsync<{
        direction: string | null;
        balance_kopecks: number | null;
        version: number | null;
      }>(
        "SELECT direction, balance_kopecks, version FROM debts WHERE id = ?",
        [debtId]
      );
      const rawBalance = (row?.balance_kopecks ?? 0) / 100;
      const rawDelta = row?.direction === "payable" && rawBalance >= 0
        ? -delta
        : delta;
      // Single source of truth: balance lives in balance_kopecks (INTEGER).
      // The legacy REAL `balance` column is no longer maintained — see the
      // money-canonicalization pass (phase 2.4).
      await db.runAsync(
        `UPDATE debts
         SET balance_kopecks = COALESCE(balance_kopecks, 0) + ?
         WHERE id = ?`,
        [Math.round(rawDelta * 100), debtId]
      );

      // Optimistic locking: include the last-known server version so the
      // backend can reject the transaction if another client already
      // modified the parent debt (returns 409 + server_data).
      await queueSyncAction(
        "POST",
        `/debts/${debtId}/transactions`,
        { ...payload, version: row?.version ?? 1 },
        { "Idempotency-Key": `debt-tx-${txId}` },
        `debt-tx-${txId}`
      );
      await refreshPendingActions();

      onAdded(tx, delta);
      onClose();
      triggerSync().catch((e) => reportError(e, { tag: "debt-tx-create-sync" }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Что-то пошло не так.");
    } finally {
      setSubmitting(false);
    }
  }

  const transactionOptions: TransactionOption[] = currentBalance >= 0
    ? [
        { value: "give", label: "Дали ещё", description: "Баланс увеличится", icon: "call-made", color: "#16a34a" },
        { value: "repay", label: "Приняли оплату", description: "Баланс уменьшится", icon: "check-circle", color: "#0a7ea4" },
      ]
    : [
        { value: "take", submitType: "give", label: "Взяли ещё", description: "Мы будем должны больше", icon: "call-received", color: "#ef4444" },
        { value: "repay", label: "Вернули долг", description: "Баланс уменьшится", icon: "check-circle", color: "#0a7ea4" },
      ];

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
          <Text variant="h5" className="flex-1 text-center">Добавить операцию</Text>
          <View style={{ width: 22 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
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

            <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              Что произошло
            </Text>
            <View className="gap-2 mb-5">
              {transactionOptions.map((option) => {
                const active = type === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => setType(option.value)}
                    className={`flex-row items-center p-3 rounded-xl border ${
                      active
                        ? "border-transparent"
                        : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
                    }`}
                    style={active ? { backgroundColor: option.color } : undefined}
                  >
                    <View className="w-9 h-9 rounded-full bg-white/20 items-center justify-center mr-3">
                      <MaterialIcons name={option.icon} size={18} color={active ? "#fff" : option.color} />
                    </View>
                    <View className="flex-1">
                      <Text className={`text-sm font-semibold ${active ? "text-white" : "text-slate-900 dark:text-slate-50"}`}>
                        {option.label}
                      </Text>
                      <Text className={`text-xs ${active ? "text-white/80" : "text-slate-500 dark:text-slate-400"}`}>
                        {option.description}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View className="gap-4">
              <Input
                label="Сумма"
                required
                placeholder="0"
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                returnKeyType="next"
              />
              <Input
                label="Примечание"
                placeholder="Необязательно…"
                value={note}
                onChangeText={setNote}
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
              Добавить операцию
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Debt detail screen ───────────────────────────────────────────────────────

export default function DebtDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const canAddTransaction = can(user?.role, "debts:addTransaction");

  const [debt, setDebt] = React.useState<Debt | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [txVisible, setTxVisible] = React.useState(false);

  React.useEffect(() => {
    if (!id) return;

    getLocalDebtById(id)
      .then(setDebt)
      .catch((e) => reportError(e, { tag: "debt-detail-load", debtId: id }))
      .finally(() => setLoading(false));
  }, [id]);

  function handleTxAdded(tx: DebtTransaction, balanceDelta: number) {
    setDebt((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        balance: prev.balance + balanceDelta,
        transactions: [tx, ...(prev.transactions ?? [])],
      };
    });
  }

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

  if (!debt) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center">
        <Text variant="muted">Запись не найдена.</Text>
        <Button onPress={() => router.back()} className="mt-4">Назад</Button>
      </SafeAreaView>
    );
  }

  const isPositive = debt.balance >= 0;
  const transactions = debt.transactions ?? [];
  const accentColor = isPositive ? "#16a34a" : "#ef4444";

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <View className="flex-1 min-w-0">
          <Text variant="h4" numberOfLines={1}>{debt.person_name}</Text>
          <Text variant="small">{isPositive ? "Нам должны" : "Мы должны"}</Text>
        </View>
        {canAddTransaction && (
          <TouchableOpacity
            onPress={() => setTxVisible(true)}
            className="w-11 h-11 rounded-full bg-primary-50 dark:bg-blue-900/20 items-center justify-center"
          >
            <MaterialIcons name="add" size={22} color="#0a7ea4" />
          </TouchableOpacity>
        )}
      </View>

      {/* Balance card */}
      <View className="mx-4 mt-4 bg-white dark:bg-zinc-900 rounded-2xl p-5 border border-slate-100 dark:border-zinc-800">
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            <Text variant="muted" className="mb-1">Текущий баланс</Text>
            <Text className="text-3xl font-bold" style={{ color: accentColor }}>
              {isPositive ? "+" : "-"}{fmt(debt.balance)}
            </Text>
            <Text variant="small" className="mt-1">
              {isPositive ? "Этот контрагент должен вам" : "Вы должны этому контрагенту"}
            </Text>
          </View>
          <View
            className="w-12 h-12 rounded-full items-center justify-center"
            style={{ backgroundColor: `${accentColor}18` }}
          >
            <MaterialIcons name={isPositive ? "call-made" : "call-received"} size={22} color={accentColor} />
          </View>
        </View>
        <View className="h-[1px] bg-slate-100 dark:bg-zinc-800 my-4" />
        <View className="flex-row justify-between">
          <Text variant="small">Начальная сумма</Text>
          <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {debt.opening_balance >= 0 ? "+" : "-"}{fmt(debt.opening_balance)}
          </Text>
        </View>
      </View>

      {/* Transactions */}
      <View className="flex-1 mx-4 mt-4">
        <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50 mb-3">
          Операции ({transactions.length})
        </Text>

        {transactions.length === 0 ? (
          <View className="bg-white dark:bg-zinc-900 rounded-2xl p-8 items-center border border-slate-100 dark:border-zinc-800">
            <MaterialIcons name="receipt" size={36} color="#94a3b8" />
            <Text variant="muted" className="mt-2 text-center">
              Операций нет.
            </Text>
          </View>
        ) : (
          <FlatList
            data={transactions}
            keyExtractor={(item) => String(item.id)}
            className="bg-white dark:bg-zinc-900 rounded-2xl px-4 border border-slate-100 dark:border-zinc-800"
            contentContainerStyle={{ paddingBottom: 16 }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => <TxCard item={item} />}
          />
        )}
      </View>

      {/* Add transaction modal */}
      {canAddTransaction && (
        <AddTransactionModal
          visible={txVisible}
          debtId={debt.id}
          currentBalance={debt.balance}
          onClose={() => setTxVisible(false)}
          onAdded={handleTxAdded}
        />
      )}
    </SafeAreaView>
  );
}
