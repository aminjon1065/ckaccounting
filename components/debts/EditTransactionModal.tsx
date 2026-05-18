import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Crypto from "expo-crypto";
import * as React from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Text } from "@/components/ui";
import { ApiError, type Debt, type DebtTransaction } from "@/lib/api";
import { useToast } from "@/store/toast";
import {
  useDeleteDebtTransaction,
  useUpdateDebtTransaction,
} from "@/lib/queries/debts";

// ─── UI semantics ───────────────────────────────────────────────────────────
//
// The edit modal mirrors AddTransactionModal's two-action model: the
// user thinks in terms of "Дали в долг" / "Взяли в долг" regardless of
// the debt's current side. The server only knows give / repay; the
// mapping depends on the debt's CURRENT direction at the time of the
// edit, NOT what the direction was when the original transaction was
// written. That matches how a new transaction would behave and keeps
// the mental model symmetric.

type UiAction = "give" | "take";
type ServerType = "give" | "take" | "repay";

function uiToServerType(action: UiAction, isReceivable: boolean): ServerType {
  if (action === "give") return isReceivable ? "give" : "repay";
  return isReceivable ? "repay" : "give";
}

function serverToUiAction(type: string, isReceivable: boolean): UiAction {
  // Inverse mapping for pre-fill — pick the UI action whose mapping
  // matches the existing server type.
  if (isReceivable) return type === "give" ? "give" : "take";
  return type === "give" ? "take" : "give";
}

export function EditTransactionModal({
  visible,
  debt,
  transaction,
  token,
  onClose,
}: {
  visible: boolean;
  debt: Debt;
  transaction: DebtTransaction;
  token: string;
  onClose: () => void;
}) {
  const { showToast } = useToast();
  const updateMutation = useUpdateDebtTransaction(token);
  const deleteMutation = useDeleteDebtTransaction(token);
  const submitting = updateMutation.isPending || deleteMutation.isPending;
  const isReceivable = debt.direction !== "payable";

  const [action, setAction] = React.useState<UiAction>(() =>
    serverToUiAction(transaction.type, isReceivable),
  );
  const [amount, setAmount] = React.useState(() => String(transaction.amount));
  const [note, setNote] = React.useState(transaction.note ?? "");
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!visible) return;
    setAction(serverToUiAction(transaction.type, isReceivable));
    setAmount(String(transaction.amount));
    setNote(transaction.note ?? "");
    setError("");
  }, [visible, transaction, isReceivable]);

  const numericAmount = React.useMemo(() => {
    const parsed = Number(amount.replace(",", "."));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [amount]);

  async function handleSave() {
    setError("");
    if (numericAmount <= 0) {
      setError("Введите корректную сумму.");
      return;
    }
    const idempotencyKey = await Crypto.randomUUID();
    try {
      await updateMutation.mutateAsync({
        debtId: debt.id,
        transactionId: transaction.id,
        payload: {
          type: uiToServerType(action, isReceivable),
          amount: numericAmount,
          note: note.trim() || null,
          version: debt.version,
        },
        idempotencyKey,
      });
      showToast({ message: "Операция изменена", variant: "success" });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else if (e instanceof ApiError && e.status === 404) {
        showToast({ message: "Операция или долг были удалены.", variant: "error" });
        onClose();
      } else {
        setError(e instanceof ApiError ? e.describeErrors() : "Что-то пошло не так.");
      }
    }
  }

  function handleDelete() {
    Alert.alert(
      "Удалить операцию?",
      "Баланс будет пересчитан без этой записи. Действие нельзя отменить.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Удалить",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteMutation.mutateAsync({
                debtId: debt.id,
                transactionId: transaction.id,
              });
              showToast({ message: "Операция удалена", variant: "success" });
              onClose();
            } catch (e) {
              if (e instanceof ApiError && e.status === 0) {
                showToast({
                  message: "Нет соединения. Проверьте интернет.",
                  variant: "error",
                });
              } else {
                Alert.alert("Ошибка", e instanceof Error ? e.message : "Не удалось удалить операцию.");
              }
            }
          },
        },
      ],
    );
  }

  // Two options, always the same labels — mirrors AddTransactionModal.
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
              Изменить операцию
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Баланс пересчитается автоматически
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

            <View className="mt-4">
              <Input
                label="Примечание"
                placeholder="Необязательно…"
                value={note}
                onChangeText={setNote}
                returnKeyType="done"
                onSubmitEditing={handleSave}
              />
            </View>

            <Button
              className="mt-6"
              size="lg"
              onPress={handleSave}
              loading={updateMutation.isPending}
              disabled={submitting || numericAmount <= 0}
            >
              Сохранить
            </Button>

            <TouchableOpacity
              onPress={handleDelete}
              disabled={submitting}
              className="mt-3 py-3 flex-row items-center justify-center gap-2 active:opacity-60 disabled:opacity-40"
            >
              <MaterialIcons name="delete-outline" size={18} color="#ef4444" />
              <Text className="text-[14px] font-semibold text-red-500">
                Удалить операцию
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
