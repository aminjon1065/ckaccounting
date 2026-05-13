import * as React from "react";
import { View } from "react-native";
import { StatCard, Skeleton } from "@/components/ui";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { type DashboardSummary } from "@/lib/api";
import { fmtMoney } from "@/lib/formatters";

export function StatsGrid({
  summary,
  isDataHidden,
  userRole,
}: {
  summary: DashboardSummary;
  isDataHidden: boolean;
  userRole?: string;
}) {
  const isSeller = userRole === "seller";
  // Currency is passed separately so the StatCard can render it muted next to
  // the value (per design). Hidden state shows ∗∗∗∗ without a currency tail.
  const display = (n: number) => (isDataHidden ? "∗∗∗∗" : fmtMoney(n));
  const cur = isDataHidden ? undefined : DEFAULT_CURRENCY;

  // Margin/cost-of-goods as a hint when both sales & cogs are available.
  const sales = summary?.period_sales_total ?? 0;
  const cogs = summary?.period_cogs ?? 0;
  const cogsPct = sales > 0 ? Math.round((cogs / sales) * 100) : null;

  return (
    <View className="flex-row flex-wrap gap-2.5 px-5 mb-3.5">
      <StatCard
        className="flex-1 basis-[46%]"
        title="Продажа"
        value={display(sales)}
        currency={cur}
        iconName="point-of-sale"
        variant="primary"
      />
      {!isSeller && (
        <StatCard
          className="flex-1 basis-[46%]"
          title="Себестоимость"
          value={display(cogs)}
          currency={cur}
          iconName="inventory"
          variant="warning"
          subtitle={cogsPct != null ? `${cogsPct}% от выручки` : undefined}
        />
      )}
      {!isSeller && (
        <StatCard
          className="flex-1 basis-[46%]"
          title="Расход"
          value={display(summary?.period_expenses_total ?? 0)}
          currency={cur}
          iconName="account-balance-wallet"
          variant="destructive"
        />
      )}
      {!isSeller && (
        <StatCard
          className="flex-1 basis-[46%]"
          title="Чистая прибыль"
          value={display(summary?.period_profit ?? 0)}
          currency={cur}
          iconName="trending-up"
          variant="success"
        />
      )}
    </View>
  );
}

export function StatsGridSkeleton() {
  return (
    <View className="flex-row flex-wrap gap-2.5 px-5 mb-3.5">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="flex-1 basis-[46%] h-[88px] rounded-2xl" />
      ))}
    </View>
  );
}
