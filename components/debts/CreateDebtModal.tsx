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

import { Button, Input, Select, Text } from "@/components/ui";
import { api, ApiError, type CreateDebtPayload, type Debt } from "@/lib/api";
import { useToast } from "@/store/toast";
import { useCreateDebt } from "@/lib/queries/debts";

export function CreateDebtModal({
  visible,
  onClose,
  onCreated,
  showShopPicker,
  implicitShopId,
  allowedShopIds,
  token,
}: {
  visible: boolean;
  onClose: () => void;
  /** Optional — list invalidation is automatic via React Query. */
  onCreated?: (d: Debt) => void;
  /** Render shop picker when true. super_admin and multi-shop owner. */
  showShopPicker: boolean;
  /** Implicit shop for sellers / single-shop owners. */
  implicitShopId?: number | null;
  /** Shop ids the user may pick. `null` means "no restriction" (super_admin). */
  allowedShopIds?: number[] | null;
  token: string;
}) {
  const [shopId, setShopId] = React.useState("");
  const [shops, setShops] = React.useState<{ id: number; name: string }[]>([]);
  const [personName, setPersonName] = React.useState("");
  const [direction, setDirection] = React.useState<"receivable" | "payable">("receivable");
  const [openingBalance, setOpeningBalance] = React.useState("");
  const [error, setError] = React.useState("");
  const { showToast } = useToast();
  const createMutation = useCreateDebt(token);
  const submitting = createMutation.isPending;

  React.useEffect(() => {
    if (!visible) return;
    setShopId("");
    setPersonName("");
    setDirection("receivable");
    setOpeningBalance("");
    setError("");

    if (showShopPicker) {
      // Server-side scoping returns only shops the user owns; super_admin
      // gets the full set. `allowedShopIds` narrows further when present.
      api.shops
        .list(token)
        .then((res) => {
          const raw = res.data ?? [];
          const filtered =
            allowedShopIds == null
              ? raw
              : raw.filter((s) => allowedShopIds.includes(s.id));
          setShops(filtered.map((shop) => ({ id: shop.id, name: shop.name })));
        })
        .catch(() => {});
    }
  }, [showShopPicker, visible, allowedShopIds, token]);

  async function handleSubmit() {
    setError("");
    if (!personName.trim()) {
      setError("Введите имя.");
      return;
    }
    const selectedShopId = showShopPicker
      ? shopId
        ? Number(shopId)
        : undefined
      : implicitShopId ?? undefined;
    if (showShopPicker && !selectedShopId) {
      setError("Выберите магазин.");
      return;
    }
    if (!showShopPicker && !selectedShopId) {
      setError("Магазин не назначен.");
      return;
    }
    const amount = openingBalance ? Number(openingBalance.replace(",", ".")) : 0;
    if (openingBalance && (isNaN(amount) || amount < 0)) {
      setError("Введите сумму без минуса.");
      return;
    }

    const payload: CreateDebtPayload = {
      person_name: personName.trim(),
      direction,
    };
    if (selectedShopId) payload.shop_id = selectedShopId;
    if (amount > 0) payload.opening_balance = amount;

    const idempotencyKey = await Crypto.randomUUID();

    try {
      const created = await createMutation.mutateAsync({ payload, idempotencyKey });
      showToast({ message: "Запись добавлена", variant: "success" });
      onCreated?.(created);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
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
              Новый долг
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              Контрагент и стартовый баланс
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

            <View className="gap-4">
              {showShopPicker && (
                <Select
                  label="Магазин"
                  required
                  value={shopId}
                  onValueChange={setShopId}
                  options={shops.map((shop) => ({
                    label: shop.name,
                    value: String(shop.id),
                  }))}
                  placeholder="Выберите магазин"
                />
              )}
              <Input
                label="Контрагент"
                required
                placeholder="Напр. Иван Иванов"
                value={personName}
                onChangeText={setPersonName}
                returnKeyType="next"
              />
              <View>
                <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
                  Направление
                </Text>
                <View className="flex-row gap-2">
                  {(
                    [
                      ["receivable", "Нам должны", "call-made", "#16a34a"],
                      ["payable", "Мы должны", "call-received", "#ef4444"],
                    ] as const
                  ).map(([value, label, icon, color]) => {
                    const active = direction === value;
                    return (
                      <TouchableOpacity
                        key={value}
                        onPress={() => setDirection(value)}
                        className={`flex-1 flex-row items-center justify-center gap-2 h-12 rounded-xl border ${
                          active
                            ? "border-transparent"
                            : "border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                        }`}
                        style={active ? { backgroundColor: color } : undefined}
                      >
                        <MaterialIcons
                          name={icon}
                          size={17}
                          color={active ? "#fff" : color}
                        />
                        <Text
                          className={`text-sm font-semibold ${
                            active
                              ? "text-white"
                              : "text-slate-700 dark:text-slate-200"
                          }`}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <Input
                label="Начальная сумма"
                placeholder="0 (необязательно)"
                hint="Введите сумму без минуса, направление выберите выше"
                value={openingBalance}
                onChangeText={setOpeningBalance}
                keyboardType="numeric"
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
              Создать
            </Button>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
