import * as React from "react";
import { Alert, Pressable, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { Text, Badge } from "@/components/ui";
import { type Sale } from "@/lib/api";
import { fmt, PAYMENT_ICONS, PAYMENT_LABELS } from "./helpers";
import { fmtTime } from "@/lib/formatters";

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

  // Return-state styling — three visual signals working together so the user
  // can't miss a returned sale in a long list:
  //   1. Left accent stripe (3px, color per state)
  //   2. `keyboard-return` icon next to the customer name
  //   3. Card-level dim + bg tint for fully-returned rows
  const hasAnyReturn = isFullyReturned || hasPartialReturn;
  const stripeColor = isFullyReturned ? "#94a3b8" : hasPartialReturn ? "#f59e0b" : null;
  const cardBgClass = isFullyReturned
    ? "bg-slate-50 dark:bg-zinc-900/60"
    : "bg-white dark:bg-zinc-900";

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      className={`relative ${cardBgClass} rounded-2xl p-3.5 mb-2.5 border border-slate-200 dark:border-zinc-800 active:opacity-80 overflow-hidden`}
      style={isFullyReturned ? { opacity: 0.78 } : undefined}
    >
      {/* Left accent stripe — drawn as an absolute child so it spans the full
          card height without fighting the rounded border. */}
      {stripeColor && (
        <View
          className="absolute left-0 top-0 bottom-0"
          style={{ width: 3, backgroundColor: stripeColor }}
        />
      )}

      {/* Top row: customer + amount/badges */}
      <View className="flex-row items-start justify-between mb-2">
        <View className="flex-1 mr-3 min-w-0">
          <View className="flex-row items-center gap-1.5">
            {hasAnyReturn && (
              <MaterialIcons
                name="keyboard-return"
                size={14}
                color={isFullyReturned ? "#64748b" : "#f59e0b"}
              />
            )}
            <Text
              className={`text-[15px] font-semibold flex-shrink ${
                isFullyReturned
                  ? "text-slate-500 dark:text-zinc-400"
                  : "text-slate-900 dark:text-white"
              }`}
              numberOfLines={1}
            >
              {item.customer_name || "Покупатель"}
            </Text>
          </View>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
            {fmtTime(item.created_at)}
          </Text>
        </View>
        <View className="items-end gap-1">
          <Text
            className={`font-heading text-[16px] tracking-tight ${
              isFullyReturned
                ? "text-slate-400 line-through dark:text-zinc-500"
                : "text-slate-900 dark:text-white"
            }`}
            style={{ fontVariantLigatures: "none" }}
          >
            {fmt(item.total)}
          </Text>
          {isFullyReturned ? (
            <Badge variant="secondary">Возвращена</Badge>
          ) : hasPartialReturn ? (
            <Badge variant="warning">Возврат {fmt(returnedTotal)}</Badge>
          ) : null}
          {hasDebt && !isFullyReturned && (
            <Badge variant="destructive">Долг {fmt(item.debt)}</Badge>
          )}
        </View>
      </View>

      {/* Bottom row: payment pill + items hint + seller */}
      <View className="flex-row items-center gap-2">
        <View className="flex-row items-center gap-1 bg-slate-100 dark:bg-zinc-800 rounded-lg px-2 py-1">
          <MaterialIcons
            name={PAYMENT_ICONS[item.payment_type] ?? "payments"}
            size={12}
            color="#0a7ea4"
          />
          <Text className="text-[11px] font-medium text-slate-700 dark:text-zinc-300">
            {PAYMENT_LABELS[item.payment_type] ?? item.payment_type}
          </Text>
        </View>
        {item.type === "service" ? (
          <Badge variant="secondary">Услуга</Badge>
        ) : (
          <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400">
            {item.items.length} поз.
          </Text>
        )}
        {item.discount > 0 && (
          <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400">
            · скидка {fmt(item.discount)}
          </Text>
        )}
        <View className="flex-1" />
        {item.seller_name ? (
          <View className="flex-row items-center gap-1 shrink">
            <MaterialIcons name="person" size={12} color="#94a3b8" />
            <Text
              className="text-[11.5px] text-slate-500 dark:text-zinc-400 max-w-[110px]"
              numberOfLines={1}
            >
              {item.seller_name}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
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
