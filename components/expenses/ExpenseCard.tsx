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

export function ExpenseCard({
  item,
  onEdit,
  onDelete,
}: {
  item: Expense;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onEdit}
      onLongPress={() =>
        Alert.alert(item.name, "Выберите действие", [
          { text: "Изменить", onPress: onEdit },
          { text: "Удалить", style: "destructive", onPress: onDelete },
          { text: "Отмена", style: "cancel" },
        ])
      }
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
