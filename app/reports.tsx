import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  ScrollView,
  TextInput as RNTextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card, CardContent, Skeleton, Text } from "@/components/ui";
import {
  api,
  type ExpensesReport,
  type ProfitReport,
  type SalesReport,
  type StockReport,
} from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuth } from "@/store/auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  if (n == null) return "0";
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Tab types ────────────────────────────────────────────────────────────────

type ReportTab = "sales" | "expenses" | "profit" | "stock";

const TABS: { key: ReportTab; label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"] }[] = [
  { key: "sales", label: "Продажи", icon: "receipt-long" },
  { key: "expenses", label: "Расходы", icon: "account-balance-wallet" },
  { key: "profit", label: "Прибыль", icon: "trending-up" },
  { key: "stock", label: "Склад", icon: "inventory" },
];

// ─── Period presets ───────────────────────────────────────────────────────────

const PERIODS = [
  { label: "Сегодня", from: today(), to: today() },
  { label: "7 дней", from: daysAgo(7), to: today() },
  { label: "30 дней", from: daysAgo(30), to: today() },
  { label: "90 дней", from: daysAgo(90), to: today() },
];

// ─── Stat row ─────────────────────────────────────────────────────────────────

function StatRow({
  label,
  value,
  color,
  large,
}: {
  label: string;
  value: string;
  color?: string;
  large?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between py-3 border-b border-slate-100 dark:border-zinc-800">
      <Text variant="muted">{label}</Text>
      <Text
        className={`font-bold ${large ? "text-xl" : "text-base"} ${
          color ?? "text-slate-900 dark:text-slate-50"
        }`}
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Sales report ─────────────────────────────────────────────────────────────

function SalesReportView({
  data,
}: {
  data: SalesReport;
}) {
  return (
    <View className="gap-4">
      <Card>
        <CardContent className="pt-3">
          <StatRow label="Кол-во продаж" value={fmt(data.total_sales)} large />
          <StatRow label="Выручка" value={fmt(data.total_amount)} color="text-primary-500" large />
          <StatRow label="Наличные" value={fmt(data.cash)} />
          <StatRow label="Карта" value={fmt(data.card)} />
          <StatRow label="Перевод" value={fmt(data.transfer)} />
        </CardContent>
      </Card>

      {data.data && data.data.length > 0 && (
        <Card>
          <CardContent className="pt-3">
            <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50 mb-2">
              По дням
            </Text>
            {data.data.slice(0, 10).map((d) => (
              <View
                key={d.date}
                className="flex-row items-center justify-between py-2.5 border-b border-slate-100 dark:border-zinc-800"
              >
                <Text variant="small">{d.date}</Text>
                <Text variant="small">{d.count} прод.</Text>
                <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {fmt(d.amount)}
                </Text>
              </View>
            ))}
          </CardContent>
        </Card>
      )}
    </View>
  );
}

// ─── Expenses report ──────────────────────────────────────────────────────────

function ExpensesReportView({ data }: { data: ExpensesReport }) {
  return (
    <Card>
      <CardContent className="pt-3">
        <StatRow label="Кол-во расходов" value={String(data.count)} />
        <StatRow label="Общая сумма" value={fmt(data.total_amount)} color="text-red-500" large />
      </CardContent>
    </Card>
  );
}

// ─── Profit report ────────────────────────────────────────────────────────────

function ProfitReportView({ data }: { data: ProfitReport }) {
  const profitColor =
    data.profit > 0 ? "text-green-600" : data.profit < 0 ? "text-red-500" : undefined;

  return (
    <Card>
      <CardContent className="pt-3">
        <StatRow label="Выручка" value={fmt(data.total_sales)} />
        <StatRow label="Себестоимость" value={fmt(data.total_cost)} />
        <StatRow label="Расходы" value={fmt(data.total_expenses)} />
        <StatRow
          label="Чистая прибыль"
          value={(data.profit >= 0 ? "+" : "−") + fmt(data.profit)}
          color={profitColor}
          large
        />
      </CardContent>
    </Card>
  );
}

// ─── Stock report ─────────────────────────────────────────────────────────────

function StockReportView({ data }: { data: StockReport }) {
  return (
    <View className="gap-4">
      <Card>
        <CardContent className="pt-3">
          <StatRow label="Всего товаров" value={String(data.total_products)} />
          <StatRow label="Общая стоимость" value={fmt(data.total_value)} color="text-primary-500" large />
          <StatRow label="Мало на складе" value={String(data.low_stock)} color="text-amber-500" />
          <StatRow label="Нет в наличии" value={String(data.out_of_stock)} color="text-red-500" />
        </CardContent>
      </Card>

      {data.data && data.data.length > 0 && (
        <Card>
          <CardContent className="pt-3">
            <Text className="text-sm font-semibold text-slate-900 dark:text-slate-50 mb-2">
              Товары по стоимости
            </Text>
            {data.data.slice(0, 15).map((p) => (
              <View
                key={p.id}
                className="flex-row items-center justify-between py-2.5 border-b border-slate-100 dark:border-zinc-800"
              >
                <View className="flex-1 mr-2">
                  <Text className="text-sm font-medium text-slate-900 dark:text-slate-50" numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text variant="small">Остаток: {p.stock_quantity}</Text>
                </View>
                <Text className="text-sm font-semibold text-primary-500">
                  {fmt(p.value)}
                </Text>
              </View>
            ))}
          </CardContent>
        </Card>
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const { token, user } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = React.useState<ReportTab>("sales");
  const [dateFrom, setDateFrom] = React.useState(daysAgo(30));
  const [dateTo, setDateTo] = React.useState(today());

  const [loading, setLoading] = React.useState(false);
  const [salesReport, setSalesReport] = React.useState<SalesReport | null>(null);
  const [expensesReport, setExpensesReport] = React.useState<ExpensesReport | null>(null);
  const [profitReport, setProfitReport] = React.useState<ProfitReport | null>(null);
  const [stockReport, setStockReport] = React.useState<StockReport | null>(null);
  const [error, setError] = React.useState("");

  async function loadReport() {
    if (!token) return;
    setLoading(true);
    setError("");
    const params = { date_from: dateFrom, date_to: dateTo };
    try {
      switch (activeTab) {
        case "sales": {
          const data = await api.reports.sales(token, params);
          setSalesReport(data);
          break;
        }
        case "expenses": {
          const data = await api.reports.expenses(token, params);
          setExpensesReport(data);
          break;
        }
        case "profit": {
          const data = await api.reports.profit(token, params);
          setProfitReport(data);
          break;
        }
        case "stock": {
          const data = await api.reports.stock(token, params);
          setStockReport(data);
          break;
        }
      }
    } catch (e: any) {
      setError(e.message ?? "Не удалось загрузить отчёт.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadReport();
  }, [activeTab, token]);

  const currentData =
    activeTab === "sales" ? salesReport :
    activeTab === "expenses" ? expensesReport :
    activeTab === "profit" ? profitReport :
    stockReport;

  if (!can(user?.role, "reports:view")) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons name="lock" size={48} color="#94a3b8" />
        <Text variant="h5" className="mt-4 text-center">Нет доступа</Text>
        <Text variant="muted" className="mt-2 text-center">
          У вас нет прав для просмотра отчётов.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center px-5 pt-4 pb-3 border-b border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} className="mr-3">
          <MaterialIcons name="arrow-back" size={22} color="#0a7ea4" />
        </TouchableOpacity>
        <View className="flex-1">
          <Text variant="h4">Отчёты</Text>
          <Text variant="muted" className="mt-0.5">Аналитика</Text>
        </View>
      </View>

      {/* Tabs */}
      <View className="flex-row bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800 px-2">
        {TABS.map((tab) => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            className={`flex-1 flex-row items-center justify-center gap-1 py-3 border-b-2 ${
              activeTab === tab.key
                ? "border-primary-500"
                : "border-transparent"
            }`}
          >
            <MaterialIcons
              name={tab.icon}
              size={15}
              color={activeTab === tab.key ? "#0a7ea4" : "#94a3b8"}
            />
            <Text
              className={`text-xs font-medium ${
                activeTab === tab.key
                  ? "text-primary-500"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Date filter */}
      {activeTab !== "stock" && (
        <View className="flex-row items-center gap-2 px-4 py-3 bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800">
          {/* Period presets */}
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p.label}
              onPress={() => {
                setDateFrom(p.from);
                setDateTo(p.to);
              }}
              className={`px-2.5 py-1.5 rounded-lg ${
                dateFrom === p.from && dateTo === p.to
                  ? "bg-primary-500"
                  : "bg-slate-100 dark:bg-zinc-800"
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  dateFrom === p.from && dateTo === p.to
                    ? "text-white"
                    : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Content */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Apply button (if custom dates) */}
        {activeTab !== "stock" && (
          <View className="flex-row items-center gap-3 mb-4">
            <View className="flex-1">
              <Text variant="small" className="mb-1">С</Text>
              <View className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2.5">
                <RNTextInput
                  value={dateFrom}
                  onChangeText={setDateFrom}
                  placeholder="YYYY-MM-DD"
                  className="text-sm text-slate-900 dark:text-slate-50"
                  placeholderTextColor="#94a3b8"
                />
              </View>
            </View>
            <View className="flex-1">
              <Text variant="small" className="mb-1">По</Text>
              <View className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2.5">
                <RNTextInput
                  value={dateTo}
                  onChangeText={setDateTo}
                  placeholder="YYYY-MM-DD"
                  className="text-sm text-slate-900 dark:text-slate-50"
                  placeholderTextColor="#94a3b8"
                />
              </View>
            </View>
            <TouchableOpacity
              onPress={loadReport}
              className="mt-5 bg-primary-500 rounded-xl px-4 py-2.5"
            >
              <Text className="text-xs font-semibold text-white">Применить</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Error */}
        {!!error && (
          <View className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 mb-4 flex-row items-center gap-2">
            <MaterialIcons name="error-outline" size={16} color="#ef4444" />
            <Text className="text-sm text-red-600 flex-1">{error}</Text>
          </View>
        )}

        {/* Report data */}
        {loading ? (
          <View className="gap-4">
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-32 rounded-2xl" />
          </View>
        ) : !currentData ? (
          <View className="items-center justify-center py-20">
            <MaterialIcons name="bar-chart" size={48} color="#94a3b8" />
            <Text variant="muted" className="mt-3 text-center">
              Нет данных за выбранный период.
            </Text>
          </View>
        ) : activeTab === "sales" ? (
          <SalesReportView data={salesReport!} />
        ) : activeTab === "expenses" ? (
          <ExpensesReportView data={expensesReport!} />
        ) : activeTab === "profit" ? (
          <ProfitReportView data={profitReport!} />
        ) : (
          <StockReportView data={stockReport!} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
