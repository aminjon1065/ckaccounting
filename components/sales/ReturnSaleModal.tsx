import * as React from "react";
import { Modal, View, TextInput as RNTextInput, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Text, Button } from "@/components/ui";
import { api, type SaleItem } from "@/lib/api";
import { useToast } from "@/store/toast";

interface ReturnSaleModalProps {
  visible: boolean;
  saleId: string;
  items: SaleItem[];
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}

function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

interface ReturnItem {
  item: SaleItem;
  returnQty: string;
}

export function ReturnSaleModal({
  visible,
  saleId,
  items,
  token,
  onClose,
  onSuccess,
}: ReturnSaleModalProps) {
  const { showToast } = useToast();
  const [returnItems, setReturnItems] = React.useState<ReturnItem[]>(
    items.map((item) => ({ item, returnQty: String(item.quantity) }))
  );
  const [loading, setLoading] = React.useState(false);

  const totalReturn = returnItems.reduce((sum, ri) => {
    const qty = parseFloat(ri.returnQty) || 0;
    return sum + qty * ri.item.price;
  }, 0);

  const handleReturnQtyChange = (index: number, value: string) => {
    setReturnItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], returnQty: value };
      return next;
    });
  };

  const handleConfirm = async () => {
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
      Alert.alert("Ошибка", e?.message ?? "Не удалось оформить возврат.");
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
            const maxQty = ri.item.quantity;
            return (
              <View
                key={ri.item.id ?? index}
                className="flex-row items-center py-3 border-b border-slate-100 dark:border-zinc-800"
              >
                <View className="flex-1 mr-3">
                  <Text className="text-sm font-medium text-slate-900 dark:text-slate-50">
                    {displayName}
                  </Text>
                  <Text variant="small" className="text-muted">
                    {fmt(ri.item.price)} ₽ × {maxQty}
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Text variant="small" className="text-muted">Возврат:</Text>
                  <RNTextInput
                    value={ri.returnQty}
                    onChangeText={(v) => handleReturnQtyChange(index, v)}
                    keyboardType="numeric"
                    className="w-16 h-9 text-center text-sm border border-slate-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-slate-900 dark:text-slate-50"
                    placeholder={`1-${maxQty}`}
                    placeholderTextColor="#94a3b8"
                  />
                  <Text variant="small" className="text-muted">/ {maxQty}</Text>
                </View>
              </View>
            );
          })}

          {/* Total */}
          <View className="mt-4 p-4 bg-slate-100 dark:bg-zinc-800 rounded-xl">
            <View className="flex-row justify-between">
              <Text>К возврату:</Text>
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
                {fmt(totalReturn)} ₽
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Footer */}
        <View className="p-4 border-t border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <Button
            onPress={handleConfirm}
            loading={loading}
            disabled={loading}
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