import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import * as Crypto from "expo-crypto";

import { Avatar, Button, Input, Skeleton, Text } from "@/components/ui";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { Pressable } from "react-native";
import {
  api,
  ApiError,
  type CreateDebtTransactionPayload,
  type Debt,
  type DebtTransaction,
} from "@/lib/api";
import { deleteLocalDebt, getLocalDebtById } from "@/lib/db";
import { can } from "@/lib/permissions";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";
import { reportError } from "@/lib/observability/reporter";
import { fmt as fmtNumber } from "@/lib/formatters";

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Debt amounts are signed in storage; the UI shows the magnitude with a
// separately-rendered sign glyph.
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
    <View className="flex-row items-center py-3 gap-3">
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
    </View>
  );
}

// ─── Add transaction modal ────────────────────────────────────────────────────

function AddTransactionModal({
  visible,
  debtId,
  currentBalance,
  token,
  onClose,
  onAdded,
  onMissing,
}: {
  visible: boolean;
  debtId: string;
  currentBalance: number;
  token: string;
  onClose: () => void;
  onAdded: (updatedDebt: Debt) => void;
  /** Server reported the debt no longer exists — caller should evict it locally. */
  onMissing: () => void;
}) {
  const [type, setType] = React.useState<TransactionType>(
    currentBalance >= 0 ? "give" : "take"
  );
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const { showToast } = useToast();

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
    // Bazaar reality: customers routinely pay more than they owe (advance,
    // tip rolled into the bill, partial barter). The old "amount > balance"
    // guard rejected these. Now the backend accepts any amount, flips the
    // debt direction if balance crosses zero, and the next render shows
    // the resulting "Мы должны 500" instead of an error toast.
    setSubmitting(true);
    try {
      // Map UI types to server types. The server only knows give/take/repay,
      // and "take" in our UI for receivable debts maps to a server "give"
      // (we give more, so the receivable grows). Repay is server-native.
      const serverType: TransactionType = type === "take" ? "give" : type;
      const payload: CreateDebtTransactionPayload = {
        type: serverType,
        amount: numericAmount,
      };
      if (note.trim()) payload.note = note.trim();

      // Idempotency-Key dedupes accidental double-taps on the submit button.
      const idempotencyKey = await Crypto.randomUUID();

      const updated = await api.debts.addTransaction(debtId, payload, token, idempotencyKey);

      onAdded(updated);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else if (e instanceof ApiError && e.status === 404) {
        // Debt was deleted on the server while the local cache still had it.
        // Evict the ghost and bounce the user back to the list.
        onMissing();
        showToast({
          message: "Долг был удалён. Локальная копия очищена.",
          variant: "error",
        });
        onClose();
      } else {
        setError(e instanceof ApiError ? e.describeErrors() : "Что-то пошло не так.");
      }
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
              Добавить операцию
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Платёж, выдача или возврат
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
  const { user, token } = useAuth();
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

  function handleTxAdded(updated: Debt) {
    // Server returns the full updated debt including the new transaction
    // and the freshly-computed balance — trust it as the source of truth.
    setDebt((prev) => prev ? { ...prev, ...updated } : updated);
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
  const amountClass = isPositive
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-500";
  const sinceLabel = `${isPositive ? "Дебитор" : "Кредитор"} · с ${new Date(debt.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;

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
            {isPositive ? "Должен нам" : "Мы должны"}
          </Text>
          <View className="flex-row items-baseline gap-1.5 mt-1">
            <Text
              className={`font-heading text-[34px] leading-[38px] tracking-tight ${amountClass}`}
              style={{ fontVariantLigatures: "none" }}
            >
              {isPositive ? "+" : "−"}{fmt(debt.balance)}
            </Text>
            <Text className="text-[14px] font-medium text-slate-500 dark:text-zinc-400">
              {DEFAULT_CURRENCY}
            </Text>
          </View>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-1">
            Старт: {debt.opening_balance >= 0 ? "+" : "−"}{fmt(debt.opening_balance)} {DEFAULT_CURRENCY}
            {transactions.length > 0 ? `  ·  ${transactions.length} операций` : ""}
          </Text>
          {canAddTransaction && (
            <View className="flex-row gap-2 mt-4 w-full">
              <Pressable
                onPress={() => setTxVisible(true)}
                className="flex-1 bg-primary-500 rounded-2xl py-3 flex-row items-center justify-center gap-1.5 active:opacity-80"
              >
                <MaterialIcons name="payments" size={18} color="#fff" />
                <Text className="text-[14px] font-semibold text-white">
                  {isPositive ? "Принять оплату" : "Внести оплату"}
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
                className={idx === transactions.length - 1 ? "px-3.5" : "px-3.5 border-b border-slate-100 dark:border-zinc-800"}
              >
                <TxCard item={tx} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add transaction modal */}
      {canAddTransaction && token && (
        <AddTransactionModal
          visible={txVisible}
          debtId={debt.id}
          currentBalance={debt.balance}
          token={token}
          onClose={() => setTxVisible(false)}
          onAdded={handleTxAdded}
          onMissing={() => {
            deleteLocalDebt(debt.id)
              .catch((e) => reportError(e, { tag: "debt-detail-evict-ghost", debtId: debt.id }))
              .finally(() => router.back());
          }}
        />
      )}
    </SafeAreaView>
  );
}
