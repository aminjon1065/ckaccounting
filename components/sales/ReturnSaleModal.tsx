import * as React from "react";
import { Modal, View, TextInput as RNTextInput, ScrollView, Alert, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Text, Button } from "@/components/ui";
import { api, ApiError, type SaleItem } from "@/lib/api";
import { useToast } from "@/store/toast";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { fmt } from "@/lib/formatters";

interface ReturnSaleModalProps {
  visible: boolean;
  saleId: string;
  items: SaleItem[];
  token: string;
  onClose: () => void;
  onSuccess: () => void;
  /** Server reported the sale no longer exists — caller should evict it locally. */
  onMissing?: () => void;
}

interface ReturnItem {
  item: SaleItem;
  returnQty: string;
}

/**
 * Sanitize raw input into a numeric string. Strips letters, accepts a single
 * decimal separator (comma or dot — both normalised to dot), drops leading
 * zeros that aren't followed by a decimal point. Empty string is allowed —
 * the user is mid-edit.
 */
function sanitizeQty(raw: string): string {
  // Replace decimal comma with dot.
  let s = raw.replace(/,/g, ".");
  // Allow only digits and at most one dot.
  s = s.replace(/[^0-9.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  }
  return s;
}

export function ReturnSaleModal({
  visible,
  saleId,
  items,
  token,
  onClose,
  onSuccess,
  onMissing,
}: ReturnSaleModalProps) {
  const { showToast } = useToast();
  // Default to 0 returned per row. Pre-filling with full quantity used to
  // make "wrong-button" returns very easy — user opens the modal, taps
  // "Оформить возврат" and accidentally rolls back the entire sale.
  const [returnItems, setReturnItems] = React.useState<ReturnItem[]>(
    items.map((item) => ({ item, returnQty: "" }))
  );
  const [loading, setLoading] = React.useState(false);

  // Reset when items change (e.g. switching sales without unmount).
  React.useEffect(() => {
    setReturnItems(items.map((item) => ({ item, returnQty: "" })));
  }, [items]);

  // Refundable quantity per line = sold - already-refunded. If a sale was
  // partially returned earlier, the modal must not let the user request more
  // than what's left. Falls back to full quantity for callers that don't
  // populate `returned_quantity` (e.g. legacy server payloads).
  const remainingFor = React.useCallback((item: SaleItem) => {
    const sold = item.quantity ?? 0;
    const returned = item.returned_quantity ?? 0;
    return Math.max(0, sold - returned);
  }, []);

  const overflowIndex = returnItems.findIndex(
    (ri) => (parseFloat(ri.returnQty) || 0) > remainingFor(ri.item),
  );
  const hasOverflow = overflowIndex !== -1;

  const totalReturn = returnItems.reduce((sum, ri) => {
    const raw = parseFloat(ri.returnQty) || 0;
    const clamped = Math.min(raw, remainingFor(ri.item));
    return sum + clamped * ri.item.price;
  }, 0);

  const totalReturnQty = returnItems.reduce(
    (sum, ri) => sum + (parseFloat(ri.returnQty) || 0),
    0,
  );

  const handleReturnQtyChange = (index: number, value: string) => {
    const sanitized = sanitizeQty(value);
    setReturnItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], returnQty: sanitized };
      return next;
    });
  };

  const handleSetMax = (index: number) => {
    setReturnItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], returnQty: String(remainingFor(next[index].item)) };
      return next;
    });
  };

  const handleConfirm = async () => {
    if (hasOverflow) {
      Alert.alert(
        "Ошибка",
        "Количество для возврата не может превышать проданное.",
      );
      return;
    }

    const validItems = returnItems
      .map((ri) => ({
        product_id: ri.item.product_id,
        quantity: parseFloat(ri.returnQty) || 0,
      }))
      .filter(
        (ri): ri is { product_id: string; quantity: number } =>
          ri.product_id != null && ri.quantity > 0
      );

    if (validItems.length === 0) {
      Alert.alert("Ошибка", "Укажите количество для возврата.");
      return;
    }

    setLoading(true);
    try {
      await api.sales.return(saleId, token, { items: validItems });
      showToast({ message: "Возврат оформлен", variant: "success" });
      onSuccess();
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 404 && onMissing) {
        onMissing();
      } else {
        Alert.alert("Ошибка", e?.message ?? "Не удалось оформить возврат.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
        {/* Header */}
        <View className="flex-row items-center px-4 py-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <Button variant="ghost" onPress={onClose} className="p-2">
            <MaterialIcons name="close" size={22} color="#64748b" />
          </Button>
          <Text variant="h5" className="flex-1 text-center pr-8">Возврат продажи</Text>
        </View>

        <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: 24 }}>
          <Text variant="small" className="text-muted mb-3">Укажите количество товара для возврата</Text>

          {returnItems.map((ri, index) => {
            const displayName = ri.item.service_name ?? ri.item.product_name ?? "—";
            const soldQty = ri.item.quantity;
            const alreadyReturned = ri.item.returned_quantity ?? 0;
            const remaining = remainingFor(ri.item);
            const fullyReturned = remaining <= 0;
            const qtyNum = parseFloat(ri.returnQty) || 0;
            const isOverflow = qtyNum > remaining;
            return (
              <View
                key={ri.item.id ?? index}
                className="py-3 border-b border-slate-100 dark:border-zinc-800"
              >
                <View className="flex-row items-start mb-2">
                  <View className="flex-1 mr-3">
                    <Text className="text-sm font-medium text-slate-900 dark:text-slate-50">
                      {displayName}
                    </Text>
                    <Text variant="small" className="text-muted">
                      {fmt(ri.item.price)} {DEFAULT_CURRENCY} × {soldQty}
                      {alreadyReturned > 0
                        ? `  ·  возвращено ${alreadyReturned}`
                        : ""}
                    </Text>
                  </View>
                </View>

                {fullyReturned ? (
                  <Text variant="small" className="text-amber-600 dark:text-amber-400">
                    Уже полностью возвращено
                  </Text>
                ) : (
                  <View className="flex-row items-center gap-3">
                    <Text variant="small" className="text-slate-700 dark:text-slate-300">
                      К возврату:
                    </Text>
                    <View
                      className={`flex-row items-center rounded-xl border ${
                        isOverflow
                          ? "border-red-400 bg-red-50 dark:border-red-500/60 dark:bg-red-900/20"
                          : "border-slate-300 bg-white dark:border-zinc-600 dark:bg-zinc-800"
                      }`}
                    >
                      <RNTextInput
                        value={ri.returnQty}
                        onChangeText={(v) => handleReturnQtyChange(index, v)}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor="#94a3b8"
                        style={{
                          width: 88,
                          height: 44,
                          paddingHorizontal: 12,
                          textAlign: "center",
                          fontSize: 18,
                          fontWeight: "600",
                          color: isOverflow ? "#dc2626" : undefined,
                        }}
                        className="text-slate-900 dark:text-slate-50"
                        selectTextOnFocus
                      />
                    </View>
                    <Text variant="small" className="text-muted">/ {remaining}</Text>
                    <View className="flex-1" />
                    <TouchableOpacity
                      onPress={() => handleSetMax(index)}
                      hitSlop={8}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 active:opacity-70"
                    >
                      <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Макс
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {isOverflow ? (
                  <Text variant="small" className="text-red-600 dark:text-red-400 mt-1">
                    Можно вернуть не более {remaining}
                  </Text>
                ) : null}
              </View>
            );
          })}

          {/* Total */}
          <View className="mt-4 p-4 bg-slate-100 dark:bg-zinc-800 rounded-xl">
            <View className="flex-row justify-between">
              <Text>К возврату:</Text>
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
                {fmt(totalReturn)} {DEFAULT_CURRENCY}
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Footer */}
        <View className="p-4 border-t border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          {hasOverflow ? (
            <View className="flex-row items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20">
              <MaterialIcons name="error-outline" size={16} color="#dc2626" />
              <Text className="text-sm text-red-700 dark:text-red-300 flex-1">
                Количество для возврата не может превышать проданное.
              </Text>
            </View>
          ) : null}
          <Button
            onPress={handleConfirm}
            loading={loading}
            disabled={loading || hasOverflow || totalReturnQty <= 0}
            variant="destructive"
            className="w-full"
          >
            Оформить возврат
          </Button>
        </View>
      </SafeAreaView>
    </Modal>
  );
}