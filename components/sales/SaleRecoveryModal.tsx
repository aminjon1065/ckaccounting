import * as React from "react";
import { Modal, TouchableOpacity, View, TextInput as RNTextInput, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Crypto from "expo-crypto";
import { Text, Button } from "@/components/ui";
import { type SyncAction, applyRecoveryStockDelta, insertOrUpdateSale, archiveSyncAction } from "@/lib/db";
import { useAuth } from "@/store/auth";
import { useSync } from "@/lib/sync/SyncContext";

interface SaleRecoveryModalProps {
  action: SyncAction | null;
  onClose: () => void;
}

interface ParsedSalePayload {
  type: "product" | "service";
  customer_name: string;
  total: number;
  discount: number;
  paid: number;
  debt: number;
  payment_type: "cash" | "card" | "transfer";
  notes?: string;
  items: {
    product_id?: number;
    name?: string;
    product_name?: string;
    quantity: number;
    price: number;
    total: number;
  }[];
  shop_id?: number;
}

async function generateSecureUUID(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fmt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function SaleRecoveryModal({ action, onClose }: SaleRecoveryModalProps) {
  const { user } = useAuth();
  const { refreshPendingActions } = useSync();

  const [editedItems, setEditedItems] = React.useState<ParsedSalePayload["items"]>([]);
  const [discount, setDiscount] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const parsedPayload = React.useMemo<ParsedSalePayload | null>(() => {
    if (!action?.payload) return null;
    try {
      return JSON.parse(action.payload) as ParsedSalePayload;
    } catch {
      return null;
    }
  }, [action?.payload]);

  // Parse and initialize editable items when modal opens
  React.useEffect(() => {
    if (parsedPayload) {
      setEditedItems([...parsedPayload.items]);
      setDiscount(String(Math.round(parsedPayload.discount)));
      setError("");
    }
  }, [parsedPayload]);

  if (!action || !parsedPayload) return null;

  const total = editedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalAfterDiscount = Math.max(0, total - (parseFloat(discount) || 0));

  function updateItemQuantity(index: number, qty: string) {
    const q = parseFloat(qty);
    if (isNaN(q) || q <= 0) return;
    setEditedItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantity: q };
      return next;
    });
  }

  async function handleRetryWithEdits() {
    if (!parsedPayload || !action) return;
    setLoading(true);
    setError("");
    try {
      const localId = await generateSecureUUID();
      const shopId = parsedPayload.shop_id;
      const newTotal = totalAfterDiscount;
      const newDiscount = parseFloat(discount) || 0;
      const newPaid = Math.min(parsedPayload.paid, newTotal);
      const newDebt = Math.max(0, newTotal - newPaid);

      // Re-apply the pending delta for corrected quantities.
      // The old failed action already restored stock via cancelPendingStockDelta,
      // so we re-decrement to restore the correct pending delta for the retry.
      for (const item of editedItems) {
        if (item.product_id != null && item.quantity > 0) {
          await applyRecoveryStockDelta(item.product_id, item.quantity);
        }
      }

      // Write corrected sale locally
      const correctedItems = editedItems.map((item) => ({
        id: 0,
        product_id: item.product_id ?? null,
        name: item.product_name ?? item.name ?? "",
        product_name: item.product_name ?? item.name ?? "",
        quantity: item.quantity,
        price: item.price,
        total: item.price * item.quantity,
      }));

      await insertOrUpdateSale(
        {
          id: -Date.now(),
          type: parsedPayload.type,
          customer_name: parsedPayload.customer_name,
          total: newTotal,
          discount: newDiscount,
          paid: newPaid,
          debt: newDebt,
          payment_type: parsedPayload.payment_type,
          notes: parsedPayload.notes,
          items: correctedItems,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        localId,
        shopId,
        user?.id
      );

      // Discard the old dead action (archive instead of delete for audit trail)
      await archiveSyncAction(action.id);

      await refreshPendingActions();
      onClose();
    } catch {
      setError("Не удалось сохранить изменения");
    } finally {
      setLoading(false);
    }
  }

  async function handleDiscard() {
    if (!action) return;
    setLoading(true);
    try {
      await archiveSyncAction(action.id);
      await refreshPendingActions();
      onClose();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible={!!action} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
        {/* Header */}
        <View className="px-4 py-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex-row items-center justify-between">
          <Text variant="h4">Исправить продажу</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <MaterialIcons name="close" size={24} color="#64748b" />
          </TouchableOpacity>
        </View>

        {/* Error notice */}
        <View className="mx-4 mt-4 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
          <Text className="text-xs text-red-600 dark:text-red-400">
            {action.last_error ?? "Ошибка при отправке продажи"}
          </Text>
        </View>

        <ScrollView className="flex-1 px-4 py-4" contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Customer & payment */}
          <View className="bg-white dark:bg-zinc-900 rounded-xl p-4 mb-4">
            <Text className="text-sm font-semibold mb-2">{parsedPayload.customer_name || "Покупатель"}</Text>
            <View className="flex-row items-center gap-2">
              <View className="bg-blue-50 dark:bg-blue-900/30 rounded px-2 py-1">
                <Text className="text-xs text-blue-600 dark:text-blue-400">{parsedPayload.payment_type}</Text>
              </View>
              {parsedPayload.notes && (
                <Text variant="small" className="text-slate-500">— {parsedPayload.notes}</Text>
              )}
            </View>
          </View>

          {/* Items */}
          <Text className="text-sm font-semibold mb-2">Позиции</Text>
          <View className="bg-white dark:bg-zinc-900 rounded-xl divide-y divide-slate-100 dark:divide-zinc-800 mb-4">
            {editedItems.map((item, i) => (
              <View key={i} className="p-3 flex-row items-center gap-3">
                <View className="flex-1">
                  <Text className="text-sm font-medium">{item.product_name ?? item.name ?? "Товар"}</Text>
                  <Text variant="small" className="text-slate-500">
                    {fmt(item.price)} × {item.quantity} = {fmt(item.price * item.quantity)} сум
                  </Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <TouchableOpacity
                    onPress={() => updateItemQuantity(i, String(Math.max(1, item.quantity - 1)))}
                    className="w-8 h-8 items-center justify-center bg-slate-100 dark:bg-zinc-800 rounded"
                  >
                    <MaterialIcons name="remove" size={16} color="#64748b" />
                  </TouchableOpacity>
                  <RNTextInput
                    className="w-14 h-8 text-center border border-slate-200 dark:border-zinc-700 rounded text-sm bg-white dark:bg-zinc-900"
                    keyboardType="numeric"
                    value={String(item.quantity)}
                    onChangeText={(v) => updateItemQuantity(i, v)}
                  />
                  <TouchableOpacity
                    onPress={() => updateItemQuantity(i, String(item.quantity + 1))}
                    className="w-8 h-8 items-center justify-center bg-slate-100 dark:bg-zinc-800 rounded"
                  >
                    <MaterialIcons name="add" size={16} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>

          {/* Discount */}
          <View className="flex-row items-center justify-between bg-white dark:bg-zinc-900 rounded-xl p-4 mb-4">
            <Text className="text-sm">Скидка (сумма)</Text>
            <RNTextInput
              className="w-28 h-9 px-3 border border-slate-200 dark:border-zinc-700 rounded text-sm text-right bg-white dark:bg-zinc-900"
              keyboardType="numeric"
              value={discount}
              onChangeText={setDiscount}
              placeholder="0"
            />
          </View>

          {/* Totals */}
          <View className="bg-white dark:bg-zinc-900 rounded-xl p-4 mb-4">
            <View className="flex-row justify-between mb-1">
              <Text variant="small" className="text-slate-500">Итого:</Text>
              <Text className="text-sm font-medium">{fmt(total)} сум</Text>
            </View>
            {parseFloat(discount) > 0 && (
              <View className="flex-row justify-between mb-1">
                <Text variant="small" className="text-slate-500">Скидка:</Text>
                <Text className="text-sm text-red-500">−{fmt(parseFloat(discount))} сум</Text>
              </View>
            )}
            <View className="flex-row justify-between">
              <Text className="font-semibold">К оплате:</Text>
              <Text className="font-bold text-primary-600">{fmt(totalAfterDiscount)} сум</Text>
            </View>
          </View>

          {error ? (
            <Text className="text-xs text-red-500 text-center mb-3">{error}</Text>
          ) : null}

          {/* Actions */}
          <View className="gap-2">
            <Button
              onPress={handleRetryWithEdits}
              loading={loading}
              disabled={loading}
              className="bg-primary-500"
            >
              Сохранить и отправить
            </Button>
            <Button
              variant="outline"
              onPress={handleDiscard}
              disabled={loading}
              className="border-red-200"
            >
              <Text className="text-red-500 text-sm font-medium">Удалить</Text>
            </Button>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
