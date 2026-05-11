import * as React from "react";
import { TouchableOpacity, View } from "react-native";
import { Text, Badge } from "@/components/ui";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { type Sale } from "@/lib/api";
import { fmt, fmtDate, PAYMENT_ICONS, PAYMENT_LABELS } from "./helpers";

interface SaleCardProps {
  item: Sale;
  onSelect: (id: string) => void;
}

function SaleCardImpl({ item, onSelect }: SaleCardProps) {
  const hasDebt = item.debt > 0;
  const handlePress = React.useCallback(() => onSelect(item.id), [onSelect, item.id]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1 mr-2">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {item.customer_name || "Покупатель"}
          </Text>
          <Text variant="small" className="mt-0.5">
            {fmtDate(item.created_at)}
          </Text>
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
        {/* Seller pinned to the bottom-right corner. flex-1 spacer absorbs
            any free space so this stays glued to the edge regardless of
            which left-side chips are rendered. shrink + numberOfLines
            handles long names without breaking the row. */}
        <View className="flex-1" />
        {item.seller_name ? (
          <View className="flex-row items-center gap-1 shrink">
            <MaterialIcons name="person" size={13} color="#94a3b8" />
            <Text variant="small" numberOfLines={1} className="max-w-[120px]">
              {item.seller_name}
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export const SaleCard = React.memo(SaleCardImpl, (prev, next) => {
  if (prev.onSelect !== next.onSelect) return false;
  const a = prev.item;
  const b = next.item;
  return (
    a.id === b.id
    && a.total === b.total
    && a.debt === b.debt
    && a.discount === b.discount
    && a.customer_name === b.customer_name
    && a.seller_name === b.seller_name
    && a.payment_type === b.payment_type
    && a.type === b.type
    && a.created_at === b.created_at
    && a.items.length === b.items.length
  );
});
