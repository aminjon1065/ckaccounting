import * as React from "react";
import {
  Modal,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Crypto from "expo-crypto";

import { Button, Input, Text } from "@/components/ui";
import { api, ApiError, type Sale } from "@/lib/api";
import { useToast } from "@/store/toast";

type PaymentType = "cash" | "card" | "transfer";

const PAYMENT_ICONS: Record<PaymentType, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  cash: "payments",
  card: "credit-card",
  transfer: "swap-horiz",
};

const PAYMENT_LABELS: Record<PaymentType, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
};

interface EditSaleModalProps {
  visible: boolean;
  sale: Sale;
  token: string;
  onClose: () => void;
  onSuccess: (updated: Sale) => void;
  /** Server reported the sale no longer exists — caller should evict it locally. */
  onMissing?: () => void;
}

export function EditSaleModal({
  visible,
  sale,
  token,
  onClose,
  onSuccess,
  onMissing,
}: EditSaleModalProps) {
  const { showToast } = useToast();
  const [customerName, setCustomerName] = React.useState(sale.customer_name ?? "");
  const [paymentType, setPaymentType] = React.useState<PaymentType>(sale.payment_type);
  const [paid, setPaid] = React.useState(String(sale.paid ?? 0));
  const [notes, setNotes] = React.useState(sale.notes ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!visible) return;
    setCustomerName(sale.customer_name ?? "");
    setPaymentType(sale.payment_type);
    setPaid(String(sale.paid ?? 0));
    setNotes(sale.notes ?? "");
  }, [visible, sale]);

  const handleSave = async () => {
    const paidNum = parseFloat(paid.replace(",", ".")) || 0;
    if (paidNum < 0) {
      Alert.alert("Ошибка", "Оплачено не может быть отрицательным.");
      return;
    }

    const payload: Parameters<typeof api.sales.update>[1] = {
      customer_name: customerName.trim() || null,
      payment_type: paymentType,
      paid: paidNum,
      notes: notes.trim() || null,
    };

    setSubmitting(true);
    const bytes = await Crypto.getRandomBytesAsync(16);
    const idempotencyKey = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    try {
      const updated = await api.sales.update(sale.id, payload, token, idempotencyKey);
      showToast({ message: "Продажа обновлена", variant: "success" });
      onSuccess(updated);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 404 && onMissing) {
        // Sale was deleted on the server while we were holding a stale local
        // copy. Hand off to the caller to evict + close the modal.
        onMissing();
      } else {
        Alert.alert("Ошибка", e?.message ?? "Не удалось обновить продажу.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
        <View className="flex-row items-center px-4 py-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <Button variant="ghost" onPress={onClose} className="p-2">
            <MaterialIcons name="close" size={22} color="#64748b" />
          </Button>
          <Text variant="h5" className="flex-1 text-center pr-8">
            Редактировать продажу
          </Text>
        </View>

        <KeyboardAvoidingView behavior="padding" className="flex-1">
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <Input
              label="Покупатель"
              placeholder="Имя клиента"
              value={customerName}
              onChangeText={setCustomerName}
              className="mb-3"
            />

            <Text className="text-xs font-medium text-slate-500 mb-2">
              Способ оплаты
            </Text>
            <View className="flex-row gap-2 mb-4">
              {(["cash", "card", "transfer"] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setPaymentType(t)}
                  className={`flex-1 flex-row items-center justify-center gap-1.5 py-2.5 rounded-xl border ${
                    paymentType === t
                      ? "bg-primary-500 border-primary-500"
                      : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
                  }`}
                >
                  <MaterialIcons
                    name={PAYMENT_ICONS[t]}
                    size={16}
                    color={paymentType === t ? "#fff" : "#94a3b8"}
                  />
                  <Text
                    className={`text-xs font-medium ${
                      paymentType === t
                        ? "text-white"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {PAYMENT_LABELS[t]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Input
              label="Оплачено"
              placeholder="0"
              value={paid}
              onChangeText={setPaid}
              keyboardType="numeric"
              className="mb-3"
            />

            <Input
              label="Заметки"
              placeholder="Необязательно"
              value={notes}
              onChangeText={setNotes}
              className="mb-3"
            />
          </ScrollView>
        </KeyboardAvoidingView>

        <View className="p-4 border-t border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <Button
            onPress={handleSave}
            loading={submitting}
            disabled={submitting}
            className="w-full"
          >
            Сохранить
          </Button>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
