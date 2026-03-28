import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { Image } from "expo-image";
import * as React from "react";
import { Alert, TouchableOpacity, View } from "react-native";
import { Badge, Text } from "@/components/ui";
import { type Product } from "@/lib/api";

function fmt(n: number) {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function stockColor(p: Product) {
  if (p.stock_quantity === 0) return "text-red-500";
  if (p.low_stock_alert != null && p.stock_quantity <= p.low_stock_alert)
    return "text-amber-500";
  return "text-green-600";
}

interface ProductCardProps {
  item: Product;
  onViewDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}

export function ProductCard({
  item,
  onViewDetail,
  onEdit,
  onDelete,
  canEdit,
}: ProductCardProps) {
  const isLow =
    item.low_stock_alert != null && item.stock_quantity <= item.low_stock_alert;
  const isOut = item.stock_quantity === 0;

  return (
    <TouchableOpacity
      onPress={onViewDetail}
      onLongPress={
        canEdit
          ? () =>
              Alert.alert(item.name, "Выберите действие", [
                { text: "Изменить", onPress: onEdit },
                { text: "Удалить", style: "destructive", onPress: onDelete },
                { text: "Отмена", style: "cancel" },
              ])
          : undefined
      }
      className="bg-white dark:bg-zinc-900 rounded-2xl p-4 mb-3 shadow-sm border border-slate-100 dark:border-zinc-800 active:opacity-80"
    >
      {/* Top row */}
      <View className="flex-row items-center gap-3 mb-2">
        {/* Thumbnail */}
        {item.photo_url ? (
          <Image
            source={{ uri: item.photo_url }}
            style={{ width: 52, height: 52, borderRadius: 10 }}
            contentFit="cover"
          />
        ) : (
          <View className="w-13 h-13 rounded-xl bg-slate-100 dark:bg-zinc-800 items-center justify-center">
            <MaterialIcons name="inventory-2" size={22} color="#94a3b8" />
          </View>
        )}
        {/* Name + meta */}
        <View className="flex-1">
          <View className="flex-row items-start justify-between">
            <Text className="text-base font-semibold text-slate-900 dark:text-slate-50 flex-1 mr-2">
              {item.name}
            </Text>
            {isOut ? (
              <Badge variant="destructive">Нет в наличии</Badge>
            ) : isLow ? (
              <Badge variant="warning">Мало</Badge>
            ) : null}
          </View>
          <Text variant="small">
            {[item.code, item.unit].filter(Boolean).join(" · ") || "—"}
          </Text>
        </View>
      </View>

      {/* Prices row */}
      <View className="flex-row gap-4">
        <View>
          <Text variant="small">Закупка</Text>
          <Text className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {fmt(item.cost_price)}
          </Text>
        </View>
        <View>
          <Text variant="small">Продажа</Text>
          <Text className="text-sm font-semibold text-primary-500">
            {fmt(item.sale_price)}
          </Text>
        </View>
        <View className="flex-1 items-end">
          <Text variant="small">Остаток</Text>
          <Text className={`text-sm font-semibold ${stockColor(item)}`}>
            {item.stock_quantity} {item.unit ?? ""}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}
