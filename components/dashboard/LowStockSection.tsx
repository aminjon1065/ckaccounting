import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { TouchableOpacity, View } from "react-native";

import { Badge, Card, CardContent, Progress, Separator, Skeleton, Text } from "@/components/ui";
import { type LowStockItem } from "@/lib/api";

export function LowStockSection({
  items = [],
  onViewAll,
}: {
  items: LowStockItem[];
  onViewAll: () => void;
}) {
  return (
    <View className="px-5 mt-5">
      {/* Section header */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2">
          <MaterialIcons name="warning-amber" size={18} color="#f59e0b" />
          <Text variant="h5">Мало на складе</Text>
          {items.length > 0 && (
            <Badge variant="warning">{items.length}</Badge>
          )}
        </View>
        <TouchableOpacity onPress={onViewAll} className="flex-row items-center gap-1">
          <Text className="text-sm text-primary-500 font-medium">Все</Text>
          <MaterialIcons name="chevron-right" size={16} color="#0a7ea4" />
        </TouchableOpacity>
      </View>

      <Card>
        {items.length === 0 ? (
          <CardContent className="items-center py-6 gap-2">
            <MaterialIcons name="check-circle" size={36} color="#22c55e" />
            <Text variant="muted">Все товары в наличии</Text>
          </CardContent>
        ) : (
          items.map((item, idx) => {
            const stockPct = item.low_stock_alert > 0
              ? Math.min((item.stock_quantity / item.low_stock_alert) * 100, 100)
              : 0;
            const outOfStock = item.stock_quantity === 0;

            return (
              <View key={item.id}>
                {idx > 0 && <Separator className="mx-4" />}
                <View className="px-4 py-3 gap-1.5">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1 mr-3">
                      <Text className="text-sm font-medium text-slate-900 dark:text-slate-50" numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text variant="small">{item.code}</Text>
                    </View>
                    <Badge variant={outOfStock ? "destructive" : "warning"}>
                      {outOfStock ? "Нет в наличии" : `${item.stock_quantity} ${item.unit}`}
                    </Badge>
                  </View>
                  <Progress
                    value={stockPct}
                    color={outOfStock ? "destructive" : "warning"}
                    label={`Мин: ${item.low_stock_alert} ${item.unit}`}
                  />
                </View>
              </View>
            );
          })
        )}
      </Card>
    </View>
  );
}

export function LowStockSkeleton() {
  return (
    <View className="px-5 mt-5 gap-3">
      <Skeleton className="h-5 w-32 rounded-lg" />
      <Card>
        <CardContent className="gap-3 pt-4">
          {[0, 1, 2].map((i) => (
            <View key={i} className="gap-2">
              <View className="flex-row justify-between">
                <Skeleton className="h-4 w-40 rounded" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </View>
              <Skeleton className="h-2 w-full rounded-full" />
            </View>
          ))}
        </CardContent>
      </Card>
    </View>
  );
}
