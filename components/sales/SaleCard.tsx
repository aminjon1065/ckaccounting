import * as React from "react";
import { Alert, TouchableOpacity, View } from "react-native";
import { Text, Badge } from "@/components/ui";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { type Sale } from "@/lib/api";
import { fmt, fmtDate, PAYMENT_ICONS, PAYMENT_LABELS } from "./helpers";

interface SaleCardProps {
  item: Sale;
  onSelect: (id: string) => void;
  /** Show "Изменить" in the long-press menu when provided. */
  onEdit?: (sale: Sale) => void;
  /** Show "Удалить" in the long-press menu when provided. */
  onDelete?: (sale: Sale) => void;
}

function SaleCardImpl({ item, onSelect, onEdit, onDelete }: SaleCardProps) {
  const hasDebt = item.debt > 0;
  const returnedTotal = item.returned_total ?? 0;
  const isFullyReturned = !!item.is_fully_returned;
  const hasPartialReturn = returnedTotal > 0 && !isFullyReturned;
  const handlePress = React.useCallback(() => onSelect(item.id), [onSelect, item.id]);

  // Long-press opens an action sheet mirroring ProductCard's pattern:
  // Изменить / Удалить / Отмена. Only renders the entries the caller
  // wired up — sellers without delete permission see Изменить + Отмена.
  const handleLongPress = React.useMemo(() => {
    if (!onEdit && !onDelete) return undefined;
    const customer = item.customer_name?.trim() || "Покупатель";
    return () => {
      const actions: Parameters<typeof Alert.alert>[2] = [];
      if (onEdit) actions.push({ text: "Изменить", onPress: () => onEdit(item) });
      if (onDelete) actions.push({ text: "Удалить", style: "destructive", onPress: () => onDelete(item) });
      actions.push({ text: "Отмена", style: "cancel" });
      Alert.alert(customer, "Выберите действие", actions);
    };
  }, [item, onEdit, onDelete]);

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
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
          <Text
            className={`text-base font-bold ${
              isFullyReturned
                ? "text-slate-400 line-through dark:text-slate-500"
                : "text-slate-900 dark:text-slate-50"
            }`}
          >
            {fmt(item.total)}
          </Text>
          {isFullyReturned ? (
            <Badge variant="secondary">Возврат</Badge>
          ) : hasPartialReturn ? (
            <Badge variant="secondary">Возврат {fmt(returnedTotal)}</Badge>
          ) : null}
          {hasDebt && !isFullyReturned && (
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
  if (prev.onEdit !== next.onEdit) return false;
  if (prev.onDelete !== next.onDelete) return false;
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
    && (a.returned_total ?? 0) === (b.returned_total ?? 0)
    && !!a.is_fully_returned === !!b.is_fully_returned
  );
});
