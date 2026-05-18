import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Input, Select, Text } from "@/components/ui";
import { api, ApiError, type CreateExpensePayload, type Expense, type Shop } from "@/lib/api";
import { insertOrUpdateExpenses } from "@/lib/db";
import { fmt, parseDecimal } from "@/lib/formatters";
import { useToast } from "@/store/toast";
import { useAuth } from "@/store/auth";
import { effectiveShopId, needsShopPicker, pickerShopIds } from "@/lib/permissions";
import { reportError } from "@/lib/observability/reporter";
import { STORAGE_KEYS } from "@/constants/config";
import { useCreateExpense, useUpdateExpense } from "@/lib/queries/expenses";

export function ExpenseFormModal({
  visible,
  editing,
  onClose,
  onSaved,
  onMissing,
  token,
}: {
  visible: boolean;
  editing: Expense | null;
  onClose: () => void;
  /** Optional — list invalidation now happens via React Query, but
   *  callers that need post-save side effects (navigate, focus next
   *  field) can still hook in here. */
  onSaved?: (e: Expense, wasEditing: boolean) => void;
  /** Server reported the expense no longer exists (404 on edit). */
  onMissing?: (id: string) => void;
  token: string;
}) {
  const [name, setName] = React.useState("");
  const [unit, setUnit] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [price, setPrice] = React.useState("");
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");
  const { showToast } = useToast();
  const { user } = useAuth();
  const createMutation = useCreateExpense(token);
  const updateMutation = useUpdateExpense(token);
  const submitting = createMutation.isPending || updateMutation.isPending;

  const showShopPicker = needsShopPicker(user);
  const implicitShopId = effectiveShopId(user);
  const allowedShopIds = React.useMemo(() => pickerShopIds(user), [user]);
  const [shopId, setShopId] = React.useState<string>("");
  const [shops, setShops] = React.useState<Shop[]>([]);

  React.useEffect(() => {
    if (visible && showShopPicker) {
      api.shops.list(token)
        .then((res) => {
          const raw = res.data ?? [];
          const list = allowedShopIds == null
            ? raw
            : raw.filter((s) => allowedShopIds.includes(s.id));
          setShops(list);
          // Pre-fill from last expense's shop if still in allowed set.
          SecureStore.getItemAsync(STORAGE_KEYS.prefLastShopId)
            .then((stored) => {
              if (stored && list.some((s) => String(s.id) === stored)) {
                setShopId(stored);
              }
            })
            .catch(() => {});
        })
        .catch((e) => reportError(e, { tag: "expense-modal-shops-load" }));
    }
  }, [visible, showShopPicker, token, allowedShopIds]);

  const qtyRef = React.useRef<RNTextInput>(null);
  const priceRef = React.useRef<RNTextInput>(null);
  const noteRef = React.useRef<RNTextInput>(null);

  React.useEffect(() => {
    if (visible && editing) {
      setName(editing.name);
      setUnit(editing.unit ?? "");
      setQuantity(String(editing.quantity));
      setPrice(String(editing.price));
      setNote(editing.note ?? "");
    } else if (visible && !editing) {
      setName(""); setUnit(""); setQuantity("1"); setPrice(""); setNote("");
      setShopId("");
    }
    setError("");
  }, [visible, editing]);

  const total =
    (parseDecimal(quantity) || 0) * (parseDecimal(price) || 0);

  async function handleSubmit() {
    setError("");
    if (!name.trim()) { setError("Введите название расхода."); return; }
    const quantityNum = parseDecimal(quantity);
    if (Number.isNaN(quantityNum) || quantityNum <= 0) {
      setError("Некорректное количество.");
      return;
    }
    const priceNum = parseDecimal(price);
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      setError("Некорректная цена.");
      return;
    }

    // Resolve target shop. shop_id is optional in the API payload (server
    // forces it to user's accessible shops via repo scoping for sellers /
    // single-shop owners), but multi-shop owners must pick.
    const targetShopId = !editing
      ? (showShopPicker
          ? (shopId ? Number(shopId) : null)
          : implicitShopId)
      : null;
    if (!editing && showShopPicker && !shopId) {
      setError("Выберите магазин."); return;
    }
    if (!editing && !showShopPicker && implicitShopId === null) {
      setError("Магазин не назначен."); return;
    }

    const payload: CreateExpensePayload & { shop_id?: number } = {
      name: name.trim(),
      quantity: quantityNum,
      price: priceNum,
    };
    if (unit.trim()) payload.unit = unit.trim();
    if (note.trim()) payload.note = note.trim();
    if (targetShopId !== null) payload.shop_id = targetShopId;

    // Idempotency-Key protects against double-tap retries on the same
    // submission. Only used on create — update doesn't accept one
    // server-side and the optimistic patch already covers the user-side
    // double-tap case.
    const idempotencyKey = await Crypto.randomUUID();
    try {
      const saved = editing
        ? await updateMutation.mutateAsync({ id: editing.id, payload })
        : await createMutation.mutateAsync({ payload, idempotencyKey });
      if (!editing && showShopPicker && shopId) {
        SecureStore.setItemAsync(STORAGE_KEYS.prefLastShopId, shopId).catch(() => {});
      }
      // Mirror to SQLite alongside the React Query cache. The query layer
      // is the source of truth for in-session reads; the local mirror
      // only kicks in when the device is offline and the cache hasn't
      // been populated yet (cold launch with no network).
      const persistShopId = editing
        ? (editing as Expense & { shop_id?: number | null }).shop_id ?? undefined
        : targetShopId ?? undefined;
      const persistUserId = user?.role === "seller" ? user.id : undefined;
      await insertOrUpdateExpenses(
        [saved],
        persistShopId ?? undefined,
        persistUserId,
      ).catch((err) => reportError(err, { tag: "expense-form-persist" }));
      onSaved?.(saved, !!editing);
      showToast({
        message: editing ? "Расход обновлён" : "Расход добавлен",
        variant: "success",
      });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        showToast({
          message: "Нет соединения. Проверьте интернет и попробуйте снова.",
          variant: "error",
        });
      } else if (e instanceof ApiError && e.status === 404 && editing && onMissing) {
        // Expense was deleted on the server while we still had it in
        // the cache. The mutation's onError rolled back the optimistic
        // patch; tell the caller to surface a toast.
        onMissing(editing.id);
        onClose();
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
        {/* Header */}
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
              {editing ? "Изменить расход" : "Новый расход"}
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              {editing ? "Сохраните изменения" : "Сумма, категория и заметка"}
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
            showsVerticalScrollIndicator={false}
          >
            {!!error && (
              <View className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 mb-4 flex-row items-center gap-2">
                <MaterialIcons name="error-outline" size={16} color="#ef4444" />
                <Text className="text-sm text-red-600 flex-1">{error}</Text>
              </View>
            )}

            <View className="gap-4">
              {/* Shop picker — shown for super_admin and multi-shop owners */}
              {/* on create only. Editing keeps the existing shop assignment. */}
              {showShopPicker && !editing && (
                <Select
                  label="Магазин"
                  required
                  value={shopId}
                  onValueChange={setShopId}
                  options={shops.map((s) => ({ label: s.name, value: String(s.id) }))}
                  placeholder="Выберите магазин"
                />
              )}

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
                <View className="w-24">
                  <Input
                    label="Ед. изм."
                    placeholder="шт"
                    value={unit}
                    onChangeText={setUnit}
                    returnKeyType="next"
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
