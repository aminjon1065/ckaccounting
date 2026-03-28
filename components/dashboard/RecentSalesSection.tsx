import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { TouchableOpacity, View } from "react-native";

import { Badge, Card, CardContent, Separator, Skeleton, Text } from "@/components/ui";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { type RecentSaleItem } from "@/lib/api";
import { fmtMoney, fmtTime } from "@/lib/formatters";

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Нал.",
  card: "Карта",
  transfer: "Перевод",
};

const PAYMENT_ICON: Record<string, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  cash: "payments",
  card: "credit-card",
  transfer: "swap-horiz",
};

export function RecentSalesSection({
  sales = [],
  onViewAll,
}: {
  sales: RecentSaleItem[];
  onViewAll: () => void;
}) {
  return (
    <View className="px-5 mt-5 mb-8">
      {/* Section header */}
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center gap-2">
          <MaterialIcons name="receipt-long" size={18} color="#0a7ea4" />
          <Text variant="h5">Последние продажи</Text>
        </View>
        <TouchableOpacity onPress={onViewAll} className="flex-row items-center gap-1">
          <Text className="text-sm text-primary-500 font-medium">Все</Text>
          <MaterialIcons name="chevron-right" size={16} color="#0a7ea4" />
        </TouchableOpacity>
      </View>

      <Card>
        {sales.length === 0 ? (
          <CardContent className="items-center py-6 gap-2">
            <MaterialIcons name="receipt-long" size={36} color="#cbd5e1" />
            <Text variant="muted">Продаж за период нет</Text>
          </CardContent>
        ) : (
          sales.map((sale, idx) => {
            const hasDebt = sale.debt > 0;
            return (
              <View key={sale.id}>
                {idx > 0 && <Separator className="mx-4" />}
                <View className="px-4 py-3 flex-row items-center gap-3">
                  {/* Payment method icon */}
                  <View className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-blue-900/30 items-center justify-center">
                    <MaterialIcons
                      name={PAYMENT_ICON[sale.payment_method] ?? "payments"}
                      size={18}
                      color="#0a7ea4"
                    />
                  </View>

                  {/* Info */}
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-slate-900 dark:text-slate-50">
                      {sale.customer_name ?? "Покупатель"}
                    </Text>
                    <Text variant="small">
                      #{sale.id} · {fmtTime(sale.created_at)} · {PAYMENT_LABELS[sale.payment_method]}
                    </Text>
                  </View>

                  {/* Amount + debt badge */}
                  <View className="items-end gap-1">
                    <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                      {fmtMoney(sale.total)} {DEFAULT_CURRENCY}
                    </Text>
                    {hasDebt ? (
                      <Badge variant="destructive">
                        Долг {fmtMoney(sale.debt)}
                      </Badge>
                    ) : (
                      <Badge variant="success">Оплачено</Badge>
                    )}
                  </View>
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
    <View className="px-5 mt-5 mb-8 gap-3">
      <Skeleton className="h-5 w-36 rounded-lg" />
      <Card>
        <CardContent className="gap-4 pt-4">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} className="flex-row items-center gap-3">
              <Skeleton className="w-9 h-9 rounded-xl" />
              <View className="flex-1 gap-1.5">
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-3 w-24 rounded" />
              </View>
              <View className="items-end gap-1.5">
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </View>
            </View>
          ))}
        </CardContent>
      </Card>
    </View>
  );
}
