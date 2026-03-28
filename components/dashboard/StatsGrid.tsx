import * as React from "react";
import { View } from "react-native";
import { StatCard, Skeleton } from "@/components/ui";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { type DashboardStats } from "@/lib/api";
import { fmtMoney, fmtChange } from "@/lib/formatters";

export function StatsGrid({ stats }: { stats: DashboardStats }) {
  return (
    <View className="flex-row flex-wrap gap-3 px-5">
      <StatCard
        className="flex-1 basis-[46%]"
        title="Продажи"
        value={`${fmtMoney(stats?.total_sales ?? 0)} ${DEFAULT_CURRENCY}`}
        iconName="point-of-sale"
        trend={(stats?.sales_change ?? 0) >= 0 ? "up" : "down"}
        trendLabel={fmtChange(stats?.sales_change ?? 0)}
        subtitle="vs прош. период"
        variant="primary"
      />
      <StatCard
        className="flex-1 basis-[46%]"
        title="Расходы"
        value={`${fmtMoney(stats?.total_expenses ?? 0)} ${DEFAULT_CURRENCY}`}
        iconName="account-balance-wallet"
        trend={(stats?.expenses_change ?? 0) <= 0 ? "up" : "down"}
        trendLabel={fmtChange(stats?.expenses_change ?? 0)}
        subtitle="vs прош. период"
        variant="destructive"
      />
      <StatCard
        className="flex-1 basis-[46%]"
        title="Прибыль"
        value={`${fmtMoney(stats?.profit ?? 0)} ${DEFAULT_CURRENCY}`}
        iconName="trending-up"
        trend={(stats?.profit_change ?? 0) >= 0 ? "up" : "down"}
        trendLabel={fmtChange(stats?.profit_change ?? 0)}
        subtitle="vs прош. период"
        variant="success"
      />
      <StatCard
        className="flex-1 basis-[46%]"
        title="Склад"
        value={`${fmtMoney(stats?.inventory_value ?? 0)} ${DEFAULT_CURRENCY}`}
        iconName="inventory"
        trend="neutral"
        subtitle="стоимость склада"
        variant="warning"
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
