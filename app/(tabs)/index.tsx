import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  RefreshControl,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  Alert,
  Avatar,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Progress,
  Separator,
  Skeleton,
  StatCard,
  Text,
} from "@/components/ui";
import { DEFAULT_CURRENCY } from "@/constants/config";
import {
  api,
  type DashboardPeriod,
  type DashboardStats,
  type DashboardSummary,
  type LowStockItem,
  type RecentSaleItem,
} from "@/lib/api";
import { useAuth } from "@/store/auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(name?: string | null): string {
  const h = new Date().getHours();
  const base = h < 12 ? "Доброе утро" : h < 17 ? "Добрый день" : "Добрый вечер";
  return name ? `${base}, ${name.split(" ")[0]}` : base;
}

function formatDate(): string {
  return new Date().toLocaleDateString("ru-RU", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function fmtChange(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Нал.",
  card: "Карта",
  transfer: "Перевод",
};

// ─── Period filter ────────────────────────────────────────────────────────────

const PERIODS: { key: DashboardPeriod; label: string }[] = [
  { key: "day", label: "Сегодня" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
];

function PeriodFilter({
  value,
  onChange,
}: {
  value: DashboardPeriod;
  onChange: (p: DashboardPeriod) => void;
}) {
  return (
    <View className="flex-row gap-2 px-5 py-3">
      {PERIODS.map((p) => {
        const active = value === p.key;
        return (
          <TouchableOpacity
            key={p.key}
            onPress={() => onChange(p.key)}
            className={`px-4 py-1.5 rounded-full border ${
              active
                ? "bg-primary-500 border-primary-500"
                : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                active ? "text-white" : "text-slate-600 dark:text-slate-400"
              }`}
            >
              {p.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Stat cards grid ──────────────────────────────────────────────────────────

function StatsGrid({ stats }: { stats: DashboardStats }) {
  return (
    <View className="flex-row flex-wrap gap-3 px-5">
      <StatCard
        className="flex-1 basis-[46%]"
        title="Продажи"
        value={`${fmtMoney(stats.total_sales)} ${DEFAULT_CURRENCY}`}
        iconName="point-of-sale"
        trend={stats.sales_change >= 0 ? "up" : "down"}
        trendLabel={fmtChange(stats.sales_change)}
        subtitle="vs прош. период"
        variant="primary"
      />
      <StatCard
        className="flex-1 basis-[46%]"
        title="Расходы"
        value={`${fmtMoney(stats.total_expenses)} ${DEFAULT_CURRENCY}`}
        iconName="account-balance-wallet"
        trend={stats.expenses_change <= 0 ? "up" : "down"}
        trendLabel={fmtChange(stats.expenses_change)}
        subtitle="vs прош. период"
        variant="destructive"
      />
      <StatCard
        className="flex-1 basis-[46%]"
        title="Прибыль"
        value={`${fmtMoney(stats.profit)} ${DEFAULT_CURRENCY}`}
        iconName="trending-up"
        trend={stats.profit_change >= 0 ? "up" : "down"}
        trendLabel={fmtChange(stats.profit_change)}
        subtitle="vs прош. период"
        variant="success"
      />
      <StatCard
        className="flex-1 basis-[46%]"
        title="Склад"
        value={`${fmtMoney(stats.inventory_value)} ${DEFAULT_CURRENCY}`}
        iconName="inventory"
        trend="neutral"
        subtitle="стоимость склада"
        variant="warning"
      />
    </View>
  );
}

function StatsGridSkeleton() {
  return (
    <View className="flex-row flex-wrap gap-3 px-5">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="flex-1 basis-[46%] h-28 rounded-2xl" />
      ))}
    </View>
  );
}

// ─── Low stock section ────────────────────────────────────────────────────────

function LowStockSection({
  items,
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
              ? Math.min((item.stock / item.low_stock_alert) * 100, 100)
              : 0;
            const outOfStock = item.stock === 0;

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
                      {outOfStock ? "Нет в наличии" : `${item.stock} ${item.unit}`}
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

function LowStockSkeleton() {
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

// ─── Recent sales section ─────────────────────────────────────────────────────

const PAYMENT_ICON: Record<string, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  cash: "payments",
  card: "credit-card",
  transfer: "swap-horiz",
};

function RecentSalesSection({
  sales,
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

function RecentSalesSkeleton() {
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

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user, token } = useAuth();
  const router = useRouter();

  const [period, setPeriod] = React.useState<DashboardPeriod>("month");
  const [summary, setSummary] = React.useState<DashboardSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchDashboard = React.useCallback(
    async (isRefresh = false) => {
      if (!token) return;
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        const summary = await api.dashboard.summary(period, token);
        setSummary(summary);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Ошибка загрузки данных");
      } finally {
        isRefresh ? setRefreshing(false) : setLoading(false);
      }
    },
    [token, period]
  );

  React.useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchDashboard(true)}
            tintColor="#0a7ea4"
            colors={["#0a7ea4"]}
          />
        }
      >
        {/* ── Header ── */}
        <View className="flex-row items-center justify-between px-5 pt-4 pb-2">
          <View>
            <Text variant="h4">{getGreeting(user?.name)}</Text>
            <Text variant="muted" className="mt-0.5">{formatDate()}</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push("/(tabs)/settings")}
            className="active:opacity-70"
          >
            <Avatar name={user?.name ?? "?"} size="default" />
          </TouchableOpacity>
        </View>

        {/* ── Shop name chip ── */}
        {user?.shop_name && (
          <View className="flex-row items-center gap-1.5 px-5 pb-1">
            <MaterialIcons name="store" size={14} color="#94a3b8" />
            <Text variant="small">{user.shop_name}</Text>
          </View>
        )}

        {/* ── Period filter ── */}
        <PeriodFilter value={period} onChange={setPeriod} />

        {/* ── Error ── */}
        {error && (
          <Alert
            variant="destructive"
            title="Ошибка загрузки"
            description={error}
            className="mx-5 mb-4"
          />
        )}

        {/* ── Stats ── */}
        {loading ? (
          <StatsGridSkeleton />
        ) : summary ? (
          <StatsGrid stats={summary.stats} />
        ) : null}

        {/* ── Sales count chip ── */}
        {!loading && summary && (
          <View className="flex-row items-center gap-1.5 px-5 mt-3">
            <MaterialIcons name="receipt" size={14} color="#94a3b8" />
            <Text variant="small">
              {summary.stats.sales_count} продаж за период
            </Text>
          </View>
        )}

        {/* ── Low stock ── */}
        {loading ? (
          <LowStockSkeleton />
        ) : summary ? (
          <LowStockSection
            items={summary.low_stock}
            onViewAll={() => router.push("/(tabs)/products")}
          />
        ) : null}

        {/* ── Recent sales ── */}
        {loading ? (
          <RecentSalesSkeleton />
        ) : summary ? (
          <RecentSalesSection
            sales={summary.recent_sales}
            onViewAll={() => router.push("/(tabs)/sales")}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
