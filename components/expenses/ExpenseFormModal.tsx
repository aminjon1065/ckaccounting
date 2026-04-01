import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Text } from "@/components/ui";
import { api, ApiError, type CreateExpensePayload, type Expense } from "@/lib/api";
import { queueSyncAction } from "@/lib/db";
import { useToast } from "@/store/toast";

export function ExpenseFormModal({
  visible,
  editing,
  onClose,
  onSaved,
  token,
}: {
  visible: boolean;
  editing: Expense | null;
  onClose: () => void;
  onSaved: (e: Expense, wasEditing: boolean) => void;
  token: string;
}) {
  const [name, setName] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [price, setPrice] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const { showToast } = useToast();

  const qtyRef = React.useRef<RNTextInput>(null);
  const priceRef = React.useRef<RNTextInput>(null);
  const noteRef = React.useRef<RNTextInput>(null);

  React.useEffect(() => {
    if (visible && editing) {
      setName(editing.name);
      setQuantity(String(editing.quantity));
      setPrice(String(editing.price));
      setNote(editing.note ?? "");
    } else if (visible && !editing) {
      setName(""); setQuantity("1"); setPrice(""); setNote("");
    }
    setError("");
  }, [visible, editing]);

  const total =
    (parseFloat(quantity) || 0) * (parseFloat(price) || 0);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите название расхода."); return; }
    if (!quantity || isNaN(Number(quantity)) || Number(quantity) <= 0) {
      setError("Некорректное количество.");
      return;
    }
    if (!price || isNaN(Number(price)) || Number(price) <= 0) {
      setError("Некорректная цена.");
      return;
    }

    const payload: CreateExpensePayload = {
      name: name.trim(),
      quantity: parseFloat(quantity),
      price: parseFloat(price),
    };
    if (note.trim()) payload.note = note.trim();

    setSubmitting(true);
    const idempotencyKey = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    try {
      const saved = editing
        ? await api.expenses.update(editing.id, payload, token)
        : await api.expenses.create(payload, token, idempotencyKey);
      onSaved(saved, !!editing);
      onClose();
    } catch (e) {
      if (!editing && e instanceof ApiError && e.status === 0) {
        await queueSyncAction("POST", "/expenses", payload, { "Idempotency-Key": idempotencyKey });
        showToast({ message: "Нет сети. Расход сохранен в очередь.", variant: "warning" });
        onClose();
      } else {
        setError(
          e instanceof ApiError ? e.message : "Что-то пошло не так."
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fmt(n: number) {
    return Math.round(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView className="flex-1 bg-white dark:bg-zinc-950">
        {/* Header */}
        <View className="flex-row items-center px-5 py-4 border-b border-slate-200 dark:border-zinc-800">
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <MaterialIcons name="close" size={22} color="#94a3b8" />
          </TouchableOpacity>
          <Text variant="h5" className="flex-1 text-center">
            {editing ? "Изменить расход" : "Добавить расход"}
          </Text>
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
            showsVerticalScrollIndicator={false}
          >
            {!!error && (
              <View className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 mb-4 flex-row items-center gap-2">
                <MaterialIcons name="error-outline" size={16} color="#ef4444" />
                <Text className="text-sm text-red-600 flex-1">{error}</Text>
              </View>
            )}

            <View className="gap-4">
              <Input
                label="Название расхода"
                required
                placeholder="напр. Канцтовары"
                value={name}
                onChangeText={setName}
                returnKeyType="next"
                onSubmitEditing={() => qtyRef.current?.focus()}
              />

              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Input
                    ref={qtyRef}
                    label="Количество"
                    required
                    placeholder="1"
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="numeric"
                    returnKeyType="next"
                    onSubmitEditing={() => priceRef.current?.focus()}
                  />
                </View>
                <View className="flex-1">
                  <Input
                    ref={priceRef}
                    label="Цена за ед."
                    required
                    placeholder="0"
                    value={price}
                    onChangeText={setPrice}
                    keyboardType="numeric"
                    returnKeyType="next"
                    onSubmitEditing={() => noteRef.current?.focus()}
                  />
                </View>
              </View>

              {/* Total preview */}
              {total > 0 && (
                <View className="bg-slate-50 dark:bg-zinc-800 rounded-xl p-3 flex-row justify-between items-center">
                  <Text variant="muted">Итого</Text>
                  <Text className="text-base font-bold text-red-500">
                    {fmt(total)}
                  </Text>
                </View>
              )}

              <Input
                ref={noteRef}
                label="Примечание"
                placeholder="Необязательно…"
                value={note}
                onChangeText={setNote}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                multiline
                numberOfLines={3}
              />
            </View>

            <Button
              className="mt-6"
              size="lg"
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
            >
              {editing ? "Сохранить" : "Добавить расход"}
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
