import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Crypto from "expo-crypto";
import * as React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Text } from "@/components/ui";
import {
  ApiError,
  type CreateDebtTransactionPayload,
  type Debt,
} from "@/lib/api";
import { useToast } from "@/store/toast";
import { useAddDebtTransaction } from "@/lib/queries/debts";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { fmt as fmtNumber } from "@/lib/formatters";

// ─── UI semantics ───────────────────────────────────────────────────────────
//
// The user-facing model is symmetric and direction-agnostic:
//
//   • "Дали в долг"   — we lent something to them. Always pushes the
//                       balance toward the receivable side.
//   • "Взяли в долг"  — we borrowed something from them. Always pushes
//                       the balance toward the payable side.
//
// The server, however, only understands give / repay. It applies the
// delta literally and flips `direction` on overflow:
//
//   give  → balance += amount
//   repay → balance -= amount   (server treats `take` and `repay`
//                                identically; we use `repay` for clarity)
//
// So the UI→server map depends on the debt's CURRENT direction:
//
//                       Receivable   Payable
//   "Дали в долг"       give         repay
//   "Взяли в долг"      repay        give
//
// Same rule explained from the schema's perspective: balance is stored
// as a positive magnitude, direction carries the sign. A "give" we send
// for a payable debt means "subtract from what we owe them" — same idea
// as paying back, hence the `repay` mapping.
//
// We do NOT expose the old "Приняли оплату" / "Вернули долг" wording —
// it confused users when reading their own history. A single mental
// model ("did money flow out, or in?") is enough.

type UiAction = "give" | "take";
type ServerType = "give" | "repay";

function uiToServerType(action: UiAction, isReceivable: boolean): ServerType {
  if (action === "give") return isReceivable ? "give" : "repay";
  // "take"
  return isReceivable ? "repay" : "give";
}

function fmt(n: number) {
  return fmtNumber(Math.abs(n));
}

// ─── Outcome preview ────────────────────────────────────────────────────────

interface Outcome {
  /** Resulting balance (always >= 0 — matches schema invariant). */
  balance: number;
  /** Whether the debt will be a receivable after the operation. */
  isReceivable: boolean;
  /** True when the operation zeroes out the debt. */
  isClosing: boolean;
  /** True when the operation flips the direction. */
  willFlip: boolean;
}

function predictOutcome(
  currentBalance: number,
  currentIsReceivable: boolean,
  action: UiAction,
  amount: number,
): Outcome {
  const serverType = uiToServerType(action, currentIsReceivable);
  const delta = serverType === "give" ? amount : -amount;
  const rawNew = currentBalance + delta;

  if (rawNew < 0) {
    return {
      balance: Math.abs(rawNew),
      isReceivable: !currentIsReceivable,
      isClosing: false,
      willFlip: true,
    };
  }
  return {
    balance: rawNew,
    isReceivable: currentIsReceivable,
    isClosing: rawNew === 0,
    willFlip: false,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AddTransactionModal({
  visible,
  debtId,
  currentBalance,
  isReceivable,
  token,
  onClose,
  onAdded,
  onMissing,
}: {
  visible: boolean;
  debtId: string;
  /** Current outstanding balance (always >= 0). Used for the live
   *  outcome preview. */
  currentBalance: number;
  /** True for "they owe us" debts. Source of truth is the Debt.direction
   *  column — see app/debts/index.tsx for the invariant note. */
  isReceivable: boolean;
  token: string;
  onClose: () => void;
  /** Optional — detail cache is updated by the mutation. */
  onAdded?: (updatedDebt: Debt) => void;
  /** Server reported the debt no longer exists — caller should evict. */
  onMissing: () => void;
}) {
  // Default the action to the one that mirrors the debt's current side
  // — most operations on a receivable are "we gave more" (lend, sale on
  // credit), and on a payable are "we took more" (more invoices from
  // the supplier). If the user wants the opposite, one tap.
  const [action, setAction] = React.useState<UiAction>(
    isReceivable ? "give" : "take",
  );
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");
  const { showToast } = useToast();
  const addTxMutation = useAddDebtTransaction(token);
  const submitting = addTxMutation.isPending;

  React.useEffect(() => {
    if (!visible) return;
    setAction(isReceivable ? "give" : "take");
    setAmount("");
    setNote("");
    setError("");
  }, [isReceivable, visible]);

  const numericAmount = React.useMemo(() => {
    const parsed = Number(amount.replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [amount]);

  const outcome = React.useMemo<Outcome | null>(() => {
    if (numericAmount <= 0) return null;
    return predictOutcome(currentBalance, isReceivable, action, numericAmount);
  }, [numericAmount, currentBalance, isReceivable, action]);

  async function handleSubmit() {
    setError("");
    if (numericAmount <= 0) {
      setError("Введите корректную сумму.");
      return;
    }

    const serverType = uiToServerType(action, isReceivable);
    const payload: CreateDebtTransactionPayload = {
      type: serverType,
      amount: numericAmount,
    };
    if (note.trim()) payload.note = note.trim();

    const idempotencyKey = await Crypto.randomUUID();

    try {
      const updated = await addTxMutation.mutateAsync({
        id: debtId,
        payload,
        idempotencyKey,
      });

      // Server response is authoritative for the toast (covers any
      // direction flips / rounding gaps our prediction might miss).
      const serverIsRecv = updated.direction !== "payable";
      const serverBalance = updated.balance;
      let message: string;
      if (serverBalance === 0) {
        message = "Долг закрыт. Запись осталась в истории.";
      } else if (outcome?.willFlip) {
        message = serverIsRecv
          ? `Теперь нам должны ${fmt(serverBalance)} ${DEFAULT_CURRENCY}`
          : `Теперь мы должны ${fmt(serverBalance)} ${DEFAULT_CURRENCY}`;
      } else {
        message = serverIsRecv
          ? `Должны нам ${fmt(serverBalance)} ${DEFAULT_CURRENCY}`
          : `Мы должны ${fmt(serverBalance)} ${DEFAULT_CURRENCY}`;
      }
      showToast({ message, variant: "success" });
      onAdded?.(updated);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else if (e instanceof ApiError && e.status === 404) {
        onMissing();
        onClose();
      } else {
        setError(e instanceof ApiError ? e.describeErrors() : "Что-то пошло не так.");
      }
    }
  }

  // ── Action options — only two, always the same labels ──

  const options: {
    value: UiAction;
    label: string;
    description: string;
    icon: React.ComponentProps<typeof MaterialIcons>["name"];
    color: string;
  }[] = [
    {
      value: "give",
      label: "Дали в долг",
      description: "Мы дали — клиент будет должен больше",
      icon: "call-made",
      color: "#16a34a",
    },
    {
      value: "take",
      label: "Взяли в долг",
      description: "Мы взяли — мы будем должны больше",
      icon: "call-received",
      color: "#ef4444",
    },
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
              {currentBalance === 0
                ? "Долг сейчас закрыт"
                : isReceivable
                  ? `Должны нам ${fmt(currentBalance)} ${DEFAULT_CURRENCY}`
                  : `Мы должны ${fmt(currentBalance)} ${DEFAULT_CURRENCY}`}
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView behavior="padding" className="flex-1">
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

            {/* Action picker — two options, always the same. */}
            <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
              Что произошло
            </Text>
            <View className="gap-2 mb-5">
              {options.map((option) => {
                const active = action === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => setAction(option.value)}
                    className={`flex-row items-center p-3 rounded-xl border ${
                      active
                        ? "border-transparent"
                        : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
                    }`}
                    style={active ? { backgroundColor: option.color } : undefined}
                  >
                    <View className="w-9 h-9 rounded-full bg-white/20 items-center justify-center mr-3">
                      <MaterialIcons
                        name={option.icon}
                        size={18}
                        color={active ? "#fff" : option.color}
                      />
                    </View>
                    <View className="flex-1">
                      <Text
                        className={`text-sm font-semibold ${
                          active ? "text-white" : "text-slate-900 dark:text-slate-50"
                        }`}
                      >
                        {option.label}
                      </Text>
                      <Text
                        className={`text-xs ${
                          active ? "text-white/80" : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {option.description}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Input
              label="Сумма"
              required
              placeholder="0"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              returnKeyType="next"
            />

            {/* Live outcome preview */}
            {outcome && <OutcomePreview outcome={outcome} />}

            <View className="mt-4">
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
              disabled={submitting || numericAmount <= 0}
            >
              Добавить операцию
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Outcome preview block ──────────────────────────────────────────────────

function OutcomePreview({ outcome }: { outcome: Outcome }) {
  if (outcome.isClosing) {
    return (
      <View className="mt-3 bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 flex-row items-start gap-2">
        <MaterialIcons name="balance" size={18} color="#64748b" />
        <View className="flex-1">
          <Text className="text-[13px] font-semibold text-slate-800 dark:text-zinc-200">
            После операции: баланс 0
          </Text>
          <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400 mt-0.5">
            Запись останется в списке как заметка.
          </Text>
        </View>
      </View>
    );
  }
  if (outcome.willFlip) {
    return (
      <View className="mt-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-3 flex-row items-start gap-2">
        <MaterialIcons name="swap-horiz" size={18} color="#d97706" />
        <View className="flex-1">
          <Text className="text-[13px] font-semibold text-amber-900 dark:text-amber-200">
            Сменится направление
          </Text>
          <Text className="text-[12px] text-amber-800 dark:text-amber-300 mt-0.5">
            {outcome.isReceivable
              ? `После операции: нам должны ${fmt(outcome.balance)} ${DEFAULT_CURRENCY}`
              : `После операции: мы должны ${fmt(outcome.balance)} ${DEFAULT_CURRENCY}`}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View className="mt-3 bg-slate-50 dark:bg-zinc-800/60 border border-slate-200 dark:border-zinc-700 rounded-xl p-3 flex-row items-center gap-2">
      <MaterialIcons
        name="info-outline"
        size={16}
        color={outcome.isReceivable ? "#16a34a" : "#ef4444"}
      />
      <Text className="text-[12.5px] text-slate-700 dark:text-zinc-200 flex-1">
        После операции:{" "}
        <Text
          className={`font-semibold ${
            outcome.isReceivable
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-500"
          }`}
        >
          {outcome.isReceivable ? "нам должны" : "мы должны"} {fmt(outcome.balance)}{" "}
          {DEFAULT_CURRENCY}
        </Text>
      </Text>
    </View>
  );
}
