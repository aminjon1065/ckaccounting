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
  api,
  ApiError,
  type CreateDebtTransactionPayload,
  type Debt,
  type DebtTransaction,
} from "@/lib/api";
import { useAuth } from "@/store/auth";

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
  give: { icon: "arrow-upward", color: "#22c55e", label: "Выдано" },
  take: { icon: "arrow-downward", color: "#ef4444", label: "Получено" },
  repay: { icon: "check-circle", color: "#0a7ea4", label: "Погашено" },
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
  onClose,
  onAdded,
  token,
}: {
  visible: boolean;
  debtId: number;
  onClose: () => void;
  onAdded: (tx: DebtTransaction, newBalance: number) => void;
  token: string;
}) {
  const [type, setType] = React.useState<"give" | "take" | "repay">("give");
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (visible) { setType("give"); setAmount(""); setNote(""); setError(""); }
  }, [visible]);

  async function handleSubmit() {
    setError("");
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setError("Введите корректную сумму.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: CreateDebtTransactionPayload = {
        type,
        amount: parseFloat(amount),
      };
      if (note.trim()) payload.note = note.trim();
      const tx = await api.debts.addTransaction(debtId, payload, token);
      // Estimate new balance change for optimistic update
      const delta =
        type === "give" ? parseFloat(amount) :
        type === "take" ? -parseFloat(amount) :
        parseFloat(amount); // repay reduces debt
      onAdded(tx, delta);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Что-то пошло не так.");
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

            {/* Type selector */}
            <Text className="text-xs font-medium text-slate-500 mb-2">Тип операции</Text>
            <View className="flex-row gap-2 mb-5">
              {(["give", "take", "repay"] as const).map((t) => {
                const cfg = TX_CONFIG[t];
                const active = type === t;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setType(t)}
                    className={`flex-1 flex-row items-center justify-center gap-1.5 py-3 rounded-xl border ${
                      active
                        ? "border-transparent"
                        : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
                    }`}
                    style={active ? { backgroundColor: cfg.color } : undefined}
                  >
                    <MaterialIcons
                      name={cfg.icon}
                      size={16}
                      color={active ? "#fff" : "#94a3b8"}
                    />
                    <Text
                      className={`text-xs font-medium capitalize ${
                        active ? "text-white" : "text-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {cfg.label}
                    </Text>
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
  const { token } = useAuth();
  const router = useRouter();

  const [debt, setDebt] = React.useState<Debt | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [txVisible, setTxVisible] = React.useState(false);

  React.useEffect(() => {
    if (!token || !id) return;
    api.debts
      .get(Number(id), token)
      .then(setDebt)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, id]);

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

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <Text variant="h4" className="flex-1">{debt.person_name}</Text>
        <TouchableOpacity
          onPress={() => setTxVisible(true)}
          className="flex-row items-center gap-1 bg-primary-50 dark:bg-blue-900/20 px-3 py-2 rounded-xl"
        >
          <MaterialIcons name="add" size={16} color="#0a7ea4" />
          <Text className="text-xs font-semibold text-primary-500">Операция</Text>
        </TouchableOpacity>
      </View>

      {/* Balance card */}
      <View className="mx-4 mt-4 bg-white dark:bg-zinc-900 rounded-2xl p-5 border border-slate-100 dark:border-zinc-800">
        <Text variant="muted" className="mb-1">Текущий баланс</Text>
        <Text
          className={`text-3xl font-bold ${isPositive ? "text-green-600" : "text-red-500"}`}
        >
          {isPositive ? "+" : "−"}{fmt(debt.balance)}
        </Text>
        <Text variant="small" className="mt-1">
          {isPositive ? "Вам должны" : "Вы должны"} · Нач.: {fmt(debt.opening_balance)}
        </Text>
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
      <AddTransactionModal
        visible={txVisible}
        debtId={debt.id}
        onClose={() => setTxVisible(false)}
        onAdded={handleTxAdded}
        token={token!}
      />
    </SafeAreaView>
  );
}
