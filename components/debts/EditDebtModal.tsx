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
import { ApiError, type Debt } from "@/lib/api";
import { useToast } from "@/store/toast";
import { useUpdateDebt } from "@/lib/queries/debts";

/**
 * Edit the contact name on a debt. Balance / direction / transactions
 * are NOT editable here — they're driven by the storeTransaction
 * endpoint where every change leaves an audit trail.
 *
 * Mostly used to fix typos in person_name (Saldo-style "rename this
 * contact" UX), so the modal is single-field and intentionally minimal.
 */
export function EditDebtModal({
  visible,
  debt,
  token,
  onClose,
  onSuccess,
  onMissing,
}: {
  visible: boolean;
  debt: Debt;
  token: string;
  onClose: () => void;
  /** Optional — detail cache is updated by the mutation. */
  onSuccess?: (updated: Debt) => void;
  /** Server reported the debt no longer exists. */
  onMissing?: () => void;
}) {
  const { showToast } = useToast();
  const updateMutation = useUpdateDebt(token);
  const submitting = updateMutation.isPending;

  const [personName, setPersonName] = React.useState(debt.person_name);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!visible) return;
    setPersonName(debt.person_name);
    setError("");
  }, [visible, debt.person_name]);

  const trimmed = personName.trim();
  const isDirty = trimmed !== debt.person_name && trimmed.length > 0;

  async function handleSave() {
    setError("");
    if (!trimmed) {
      setError("Введите имя контрагента.");
      return;
    }
    if (!isDirty) {
      // Nothing changed — close silently.
      onClose();
      return;
    }
    const idempotencyKey = await Crypto.randomUUID();
    try {
      const updated = await updateMutation.mutateAsync({
        id: debt.id,
        payload: { person_name: trimmed, version: debt.version },
        idempotencyKey,
      });
      showToast({ message: "Контакт переименован", variant: "success" });
      onSuccess?.(updated);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && onMissing) {
        onMissing();
        onClose();
      } else if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else {
        setError(e instanceof ApiError ? e.describeErrors() : "Что-то пошло не так.");
      }
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
              Изменить контакт
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Меняется только имя — баланс и история не затрагиваются
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

            <Input
              label="Имя контрагента"
              required
              placeholder="Напр. Иван Иванов"
              value={personName}
              onChangeText={setPersonName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />

            <Button
              className="mt-6"
              size="lg"
              onPress={handleSave}
              loading={submitting}
              disabled={submitting || !isDirty}
            >
              Сохранить
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
