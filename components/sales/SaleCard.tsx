import * as React from "react";
import { TouchableOpacity, View } from "react-native";
import { Text, Badge } from "@/components/ui";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { type Sale } from "@/lib/api";
import { fmt, fmtDate, PAYMENT_ICONS, PAYMENT_LABELS } from "./helpers";

export function SaleCard({ item, onPress }: { item: Sale; onPress: () => void }) {
  const hasDebt = item.debt > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {item.customer_name || "Покупатель"}
          </Text>
          <Text variant="small">{fmtDate(item.created_at)}</Text>
        </View>
        <View className="items-end gap-1">
          <Text className="text-base font-bold text-slate-900 dark:text-slate-50">
            {fmt(item.total)}
          </Text>
          {hasDebt && (
            <Badge variant="destructive">Долг {fmt(item.debt)}</Badge>
          )}
        </View>
      </View>

      <View className="flex-row items-center gap-2 mt-1">
        <View className="flex-row items-center gap-1 bg-slate-100 dark:bg-zinc-800 rounded-lg px-2 py-1">
          <MaterialIcons
            name={PAYMENT_ICONS[item.payment_type] ?? "payments"}
            size={13}
            color="#0a7ea4"
          />
          <Text className="text-xs text-slate-600 dark:text-slate-400">
            {PAYMENT_LABELS[item.payment_type] ?? item.payment_type}
          </Text>
        </View>
        {item.type === "service" ? (
          <Badge variant="secondary">Услуга</Badge>
        ) : (
          <Text variant="small">{item.items.length} поз.</Text>
        )}
        {item.discount > 0 && (
          <Text variant="small">Скидка: {fmt(item.discount)}</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}
