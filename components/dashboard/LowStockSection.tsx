import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Pressable, View } from "react-native";

import { Badge, Card, CardContent, Skeleton, Text } from "@/components/ui";
import { type LowStockItem } from "@/lib/api";

export function LowStockSection({
  items = [],
  onViewAll,
}: {
  items: LowStockItem[];
  onViewAll: () => void;
}) {
  return (
    <View className="px-5 mt-2 mb-2">
      {/* Section header */}
      <View className="flex-row items-center justify-between mb-2.5">
        <View className="flex-row items-center gap-2">
          <Text className="font-heading text-[15px] tracking-tight text-slate-900 dark:text-white">
            Мало на складе
          </Text>
          {items.length > 0 && <Badge variant="warning">{items.length}</Badge>}
        </View>
        <Pressable onPress={onViewAll} hitSlop={8} className="active:opacity-60">
          <Text className="text-[13px] text-primary-500 font-semibold">Все товары</Text>
        </Pressable>
      </View>

      <Card className="p-0 overflow-hidden">
        {items.length === 0 ? (
          <CardContent className="items-center py-6 gap-2">
            <MaterialIcons name="check-circle" size={36} color="#22c55e" />
            <Text variant="muted">Все товары в наличии</Text>
          </CardContent>
        ) : (
          items.map((item, idx) => {
            const out = item.stock_quantity === 0;
            const last = idx === items.length - 1;
            return (
              <View
                key={item.id}
                className={`flex-row items-center gap-3 px-3.5 py-3 ${
                  last ? "" : "border-b border-slate-100 dark:border-zinc-800"
                }`}
              >
                <View className="w-9 h-9 rounded-[10px] bg-slate-100 dark:bg-zinc-800 items-center justify-center">
                  <MaterialIcons name="inventory-2" size={18} color="#94a3b8" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text
                    className="text-[14px] font-medium text-slate-900 dark:text-white leading-[18px]"
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400 mt-0.5">
                    {item.code ? `${item.code} · ` : ""}порог {item.low_stock_alert} {item.unit ?? "шт"}
                  </Text>
                </View>
                <Badge variant={out ? "destructive" : "warning"}>
                  {out ? "Нет" : `${item.stock_quantity} ${item.unit}`}
                </Badge>
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
    <View className="px-5 mt-2 mb-2 gap-2.5">
      <Skeleton className="h-5 w-32 rounded-lg" />
      <Card className="p-0 overflow-hidden">
        {[0, 1, 2].map((i, idx, arr) => (
          <View
            key={i}
            className={`flex-row items-center gap-3 px-3.5 py-3 ${
              idx === arr.length - 1 ? "" : "border-b border-slate-100 dark:border-zinc-800"
            }`}
          >
            <Skeleton className="w-9 h-9 rounded-[10px]" />
            <View className="flex-1 gap-1.5">
              <Skeleton className="h-4 w-40 rounded" />
              <Skeleton className="h-3 w-28 rounded" />
            </View>
            <Skeleton className="h-5 w-14 rounded-full" />
          </View>
        ))}
      </Card>
    </View>
  );
}
