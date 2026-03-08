import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as React from "react";
import { ScrollView, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Skeleton, Text } from "@/components/ui";
import { api, type Purchase } from "@/lib/api";
import { useAuth } from "@/store/auth";

function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PurchaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuth();
  const router = useRouter();

  const [purchase, setPurchase] = React.useState<Purchase | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!token || !id) return;
    api.purchases
      .get(Number(id), token)
      .then(setPurchase)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, id]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
        <View className="flex-1 px-4 pt-20 gap-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </View>
      </SafeAreaView>
    );
  }

  if (!purchase) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center">
        <Text variant="muted">Закупка не найдена.</Text>
        <Button onPress={() => router.back()} className="mt-4">Назад</Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <Text variant="h4" className="flex-1">Закупка №{purchase.id}</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Summary card */}
        <View className="bg-white dark:bg-zinc-900 rounded-2xl p-5 mb-4 border border-slate-100 dark:border-zinc-800">
          <View className="flex-row justify-between mb-3">
            <View>
              <Text variant="muted">Поставщик</Text>
              <Text className="text-base font-semibold text-slate-900 dark:text-slate-50 mt-0.5">
                {purchase.supplier_name || "Неизвестно"}
              </Text>
            </View>
            <View className="items-end">
              <Text variant="muted">Сумма</Text>
              <Text className="text-xl font-bold text-primary-500 mt-0.5">
                {fmt(purchase.total)}
              </Text>
            </View>
          </View>
          <Text variant="small">{fmtDate(purchase.created_at)}</Text>
        </View>

        {/* Items */}
        <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50 mb-3">
          Товары ({(purchase.items ?? []).length})
        </Text>

        <View className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 overflow-hidden">
          {(purchase.items ?? []).map((item, index) => (
            <View
              key={item.id}
              className={`p-4 flex-row items-center ${index < (purchase.items ?? []).length - 1
                  ? "border-b border-slate-100 dark:border-zinc-800"
                  : ""
                }`}
            >
              <View className="flex-1">
                <Text className="text-sm font-medium text-slate-900 dark:text-slate-50">
                  {item.product_name}
                </Text>
                <Text variant="small">
                  {item.quantity} × {fmt(item.price)}
                </Text>
              </View>
              <Text className="text-sm font-bold text-primary-500">
                {fmt(item.total)}
              </Text>
            </View>
          ))}

          {/* Total row */}
          <View className="p-4 bg-slate-50 dark:bg-zinc-800 flex-row justify-between">
            <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Итого
            </Text>
            <Text className="text-base font-bold text-primary-500">
              {fmt(purchase.total)}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
