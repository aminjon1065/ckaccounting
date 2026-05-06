import * as React from "react";
import { Alert, TouchableOpacity, View } from "react-native";
import { Text } from "@/components/ui";
import { type Expense } from "@/lib/api";

function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { month: "short", day: "numeric" });
}

interface ExpenseCardProps {
  item: Expense;
  onEdit: (item: Expense) => void;
  onDelete: (id: string) => void;
}

function ExpenseCardImpl({ item, onEdit, onDelete }: ExpenseCardProps) {
  const handleEdit = React.useCallback(() => onEdit(item), [onEdit, item]);
  const handleLongPress = React.useCallback(() => {
    Alert.alert(item.name, "Выберите действие", [
      { text: "Изменить", onPress: handleEdit },
      { text: "Удалить", style: "destructive", onPress: () => onDelete(item.id) },
      { text: "Отмена", style: "cancel" },
    ]);
  }, [item, handleEdit, onDelete]);

  return (
    <TouchableOpacity
      onPress={handleEdit}
      onLongPress={handleLongPress}
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 border border-slate-100 dark:border-zinc-800 active:opacity-80"
    >
      <View className="flex-row items-start justify-between">
        <View className="flex-1 mr-3">
          <Text className="text-base font-semibold text-slate-900 dark:text-slate-50">
            {item.name}
          </Text>
          <Text variant="small">
            {item.quantity} × {fmt(item.price)} = {fmt(item.total)}
          </Text>
          {item.note ? (
            <Text variant="small" className="mt-0.5 italic">
              {item.note}
            </Text>
          ) : null}
        </View>
        <View className="items-end">
          <Text className="text-base font-bold text-red-500">
            {fmt(item.total)}
          </Text>
          <Text variant="small">{fmtDate(item.created_at)}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export const ExpenseCard = React.memo(ExpenseCardImpl, (prev, next) => {
  if (prev.onEdit !== next.onEdit || prev.onDelete !== next.onDelete) return false;
  const a = prev.item;
  const b = next.item;
  return (
    a.id === b.id
    && a.name === b.name
    && a.quantity === b.quantity
    && a.price === b.price
    && a.total === b.total
    && a.note === b.note
    && a.created_at === b.created_at
  );
});
