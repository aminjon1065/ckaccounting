import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Pressable, View } from "react-native";

import { Avatar, Badge, Card, CardContent, Skeleton, Text } from "@/components/ui";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { type RecentSaleItem } from "@/lib/api";
import { fmtMoney, fmtTime } from "@/lib/formatters";

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Нал",
  card: "Карта",
  transfer: "Перевод",
};

const PAYMENT_ICON: Record<string, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  cash: "payments",
  card: "credit-card",
  transfer: "sync",
};

export function RecentSalesSection({
  sales = [],
  onViewAll,
}: {
  sales: RecentSaleItem[];
  onViewAll: () => void;
}) {
  return (
    <View className="px-5 mt-2 mb-8">
      {/* Section header */}
      <View className="flex-row items-center justify-between mb-2.5">
        <Text className="font-heading text-[15px] tracking-tight text-slate-900 dark:text-white">
          Последние продажи
        </Text>
        <Pressable onPress={onViewAll} hitSlop={8} className="active:opacity-60">
          <Text className="text-[13px] text-primary-500 font-semibold">Все продажи</Text>
        </Pressable>
      </View>

      <Card className="p-0 overflow-hidden">
        {sales.length === 0 ? (
          <CardContent className="items-center py-6 gap-2">
            <MaterialIcons name="receipt-long" size={36} color="#cbd5e1" />
            <Text variant="muted">Продаж за период нет</Text>
          </CardContent>
        ) : (
          sales.map((sale, idx) => {
            const last = idx === sales.length - 1;
            const hasDebt = sale.debt > 0;
            const customerName = sale.customer_name ?? "Покупатель";
            const payLabel = PAYMENT_LABELS[sale.payment_type] ?? "Нал";
            const payIcon = PAYMENT_ICON[sale.payment_type] ?? "payments";
            return (
              <View
                key={sale.id}
                className={`flex-row items-center gap-3 px-3.5 py-3 ${
                  last ? "" : "border-b border-slate-100 dark:border-zinc-800"
                }`}
              >
                <Avatar name={customerName} size="sm" />
                <View className="flex-1 min-w-0">
                  <Text
                    className="text-[14px] font-semibold text-slate-900 dark:text-white leading-[18px]"
                    numberOfLines={1}
                  >
                    {customerName}
                  </Text>
                  <View className="flex-row items-center gap-1 mt-0.5">
                    <MaterialIcons name={payIcon} size={11} color="#94a3b8" />
                    <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400">
                      {payLabel} · {fmtTime(sale.created_at)}
                    </Text>
                  </View>
                </View>
                <View className="items-end">
                  <Text
                    className="font-heading text-[15px] tracking-tight text-slate-900 dark:text-white"
                    style={{ fontVariantLigatures: "none" }}
                  >
                    {fmtMoney(sale.total)}
                  </Text>
                  {hasDebt && (
                    <View className="mt-1">
                      <Badge variant="destructive">Долг {fmtMoney(sale.debt)}</Badge>
                    </View>
                  )}
                </View>
              </View>
            );
          })
        )}
      </Card>
    </View>
  );
}

export function RecentSalesSkeleton() {
  return (
    <View className="px-5 mt-2 mb-8 gap-2.5">
      <Skeleton className="h-5 w-40 rounded-lg" />
      <Card className="p-0 overflow-hidden">
        {[0, 1, 2, 3].map((i, idx, arr) => (
          <View
            key={i}
            className={`flex-row items-center gap-3 px-3.5 py-3 ${
              idx === arr.length - 1 ? "" : "border-b border-slate-100 dark:border-zinc-800"
            }`}
          >
            <Skeleton className="w-9 h-9 rounded-full" />
            <View className="flex-1 gap-1.5">
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="h-3 w-24 rounded" />
            </View>
            <Skeleton className="h-5 w-20 rounded" />
          </View>
        ))}
      </Card>
    </View>
  );
}
