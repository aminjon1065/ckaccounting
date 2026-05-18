import * as React from "react";
import { Alert, Pressable, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { Text } from "@/components/ui";
import { type Expense } from "@/lib/api";
import { fmt } from "@/lib/formatters";

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

interface ExpenseCardProps {
  item: Expense;
  onEdit: (item: Expense) => void;
  /** Optional — sellers (and other restricted roles) can edit their
   *  own rows but not delete them. The "Удалить" option is omitted
   *  from the long-press menu when this is not provided. */
  onDelete?: (id: string) => void;
}

function ExpenseCardImpl({ item, onEdit, onDelete }: ExpenseCardProps) {
  const handleEdit = React.useCallback(() => onEdit(item), [onEdit, item]);
  const handleLongPress = React.useCallback(() => {
    const buttons: Parameters<typeof Alert.alert>[2] = [
      { text: "Изменить", onPress: handleEdit },
    ];
    if (onDelete) {
      buttons.push({
        text: "Удалить",
        style: "destructive",
        onPress: () => onDelete(item.id),
      });
    }
    buttons.push({ text: "Отмена", style: "cancel" });
    Alert.alert(item.name, "Выберите действие", buttons);
  }, [item, handleEdit, onDelete]);

  return (
    <Pressable
      onPress={handleEdit}
      onLongPress={handleLongPress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-3.5 mb-2.5 border border-slate-200 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-center gap-3">
        <View className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 items-center justify-center">
          <MaterialIcons name="account-balance-wallet" size={20} color="#ef4444" />
        </View>
        <View className="flex-1 min-w-0">
          <Text
            className="text-[15px] font-semibold text-slate-900 dark:text-white"
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5" numberOfLines={1}>
            {item.note ? `${item.note} · ` : ""}
            {fmtShortDate(item.created_at)}
            {item.quantity > 1
              ? `  ·  ${item.quantity}${item.unit ? ` ${item.unit}` : ""} × ${fmt(item.price)}`
              : item.unit
                ? `  ·  ${item.unit}`
                : ""}
          </Text>
          {item.created_by_name ? (
            <View className="flex-row items-center gap-1 mt-0.5">
              <MaterialIcons name="person" size={11} color="#94a3b8" />
              <Text
                className="text-[11px] text-slate-500 dark:text-zinc-400"
                numberOfLines={1}
              >
                {item.created_by_name}
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          className="font-heading text-[16px] tracking-tight text-red-500"
          style={{ fontVariantLigatures: "none" }}
        >
          − {fmt(item.total)}
        </Text>
      </View>
    </Pressable>
  );
}

export const ExpenseCard = React.memo(ExpenseCardImpl, (prev, next) => {
  if (prev.onEdit !== next.onEdit || prev.onDelete !== next.onDelete) return false;
  const a = prev.item;
  const b = next.item;
  return (
    a.id === b.id
    && a.name === b.name
    && a.unit === b.unit
    && a.quantity === b.quantity
    && a.price === b.price
    && a.total === b.total
    && a.note === b.note
    && a.created_by_name === b.created_by_name
    && a.created_at === b.created_at
  );
});
