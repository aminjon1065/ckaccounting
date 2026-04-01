import * as React from "react";
import { View } from "react-native";
import { StatCard, Skeleton } from "@/components/ui";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { type DashboardSummary } from "@/lib/api";
import { fmtMoney } from "@/lib/formatters";

export function StatsGrid({ summary, isDataHidden }: { summary: DashboardSummary; isDataHidden: boolean }) {
  const hiddenText = "***";
  return (
    <View className="flex-row flex-wrap gap-3 px-5 mb-4">
      <StatCard
        className="flex-1 basis-[46%]"
        title="Продажа"
        value={isDataHidden ? hiddenText : `${fmtMoney(summary?.period_sales_total ?? 0)} ${DEFAULT_CURRENCY}`}
        iconName="point-of-sale"
        variant="primary"
      />
      <StatCard
        className="flex-1 basis-[46%]"
        title="Себестоимость"
        value={isDataHidden ? hiddenText : `${fmtMoney(summary?.period_cogs ?? 0)} ${DEFAULT_CURRENCY}`}
        iconName="inventory"
        variant="warning"
      />
      <StatCard
        className="flex-1 basis-[46%]"
        title="Расход"
        value={isDataHidden ? hiddenText : `${fmtMoney(summary?.period_expenses_total ?? 0)} ${DEFAULT_CURRENCY}`}
        iconName="account-balance-wallet"
        variant="destructive"
      />
      <StatCard
        className="flex-1 basis-[46%]"
        title="Чистая прибыль"
        value={isDataHidden ? hiddenText : `${fmtMoney(summary?.period_profit ?? 0)} ${DEFAULT_CURRENCY}`}
        iconName="trending-up"
        variant="success"
      />
    </View>
  );
}

export function StatsGridSkeleton() {
  return (
    <View className="flex-row flex-wrap gap-3 px-5">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="flex-1 basis-[46%] h-28 rounded-2xl" />
      ))}
    </View>
  );
}
