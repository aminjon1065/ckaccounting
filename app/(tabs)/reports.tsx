import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import * as React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { File, Paths } from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { Card, CardContent, Skeleton, Text } from "@/components/ui";
import {
  api,
  ApiError,
  type ExpensesReport,
  type ProfitReport,
  type SalesReport,
  type Shop,
  type StockReport,
} from "@/lib/api";
import { can, needsShopPicker, pickerShopIds } from "@/lib/permissions";
import { useAuth } from "@/store/auth";
import { useIsOnline } from "@/lib/network/NetworkProvider";
import { reportError } from "@/lib/observability/reporter";
import { getSalesExportRows, localScope } from "@/lib/db";
import { ShopPicker } from "@/components/dashboard/ShopPicker";

import { fmt as fmtNumber } from "@/lib/formatters";
import { DEFAULT_CURRENCY } from "@/constants/config";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return "0";
  return fmtNumber(n);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function dateFromValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}
function dateToValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function dateLabel(value: string) {
  return dateFromValue(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
function shortDayLabel(value: string) {
  return dateFromValue(value).toLocaleDateString("ru-RU", { day: "numeric" });
}
function reportFileName(
  tab: ReportTab,
  dateFrom: string,
  dateTo: string,
  stockMode: "snapshot" | "period" = "snapshot",
) {
  const names: Record<ReportTab, string> = {
    sales: "sales",
    expenses: "expenses",
    profit: "profit",
    stock: "stock",
  };
  // Snapshot stock reports stamp today's date so the filename is
  // unambiguous; period reports use the actual A→B range — same as
  // every other tab.
  const period =
    tab === "stock" && stockMode === "snapshot"
      ? dateToValue(new Date())
      : `${dateFrom}_${dateTo}`;
  return `ck-report-${names[tab]}-${period}.pdf`;
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

type ReportTab = "sales" | "expenses" | "profit" | "stock";

const TABS: { key: ReportTab; label: string; icon: React.ComponentProps<typeof MaterialIcons>["name"] }[] = [
  { key: "sales", label: "Продажи", icon: "receipt-long" },
  { key: "expenses", label: "Расходы", icon: "account-balance-wallet" },
  { key: "profit", label: "Прибыль", icon: "trending-up" },
  { key: "stock", label: "Склад", icon: "inventory" },
];

const PERIODS = [
  { label: "Сегодня", from: today(), to: today() },
  { label: "7 дней", from: daysAgo(7), to: today() },
  { label: "30 дней", from: daysAgo(30), to: today() },
  { label: "90 дней", from: daysAgo(90), to: today() },
];

// ─── Hero summary card ───────────────────────────────────────────────────────

function HeroSummary({
  label,
  value,
  sub,
  tone = "primary",
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "primary" | "success" | "destructive" | "indigo";
  delta?: number;
}) {
  const grad =
    tone === "success"
      ? { from: "#10b981", to: "#047857", text: "text-white" }
      : tone === "destructive"
        ? { from: "#ef4444", to: "#b91c1c", text: "text-white" }
        : tone === "indigo"
          ? { from: "#6366f1", to: "#3730a3", text: "text-white" }
          : { from: "#0a7ea4", to: "#053f53", text: "text-white" };
  return (
    <View
      className="rounded-2xl p-4 mb-3 overflow-hidden"
      style={{ backgroundColor: grad.from }}
    >
      {/* Soft inner highlight for premium feel */}
      <View
        className="absolute -top-10 -right-10 w-44 h-44 rounded-full"
        style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
      />
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-[12px] text-white/75 font-medium">{label}</Text>
        {delta != null && (
          <View className="flex-row items-center gap-1 bg-white/16 rounded-full px-2 py-0.5">
            <MaterialIcons
              name={delta >= 0 ? "trending-up" : "trending-down"}
              size={11}
              color="#fff"
            />
            <Text className="text-[11px] font-semibold text-white">
              {delta >= 0 ? "+" : ""}{delta}%
            </Text>
          </View>
        )}
      </View>
      <Text
        className="font-heading text-[32px] leading-[34px] tracking-tight text-white"
        style={{ fontVariantLigatures: "none" }}
      >
        {value}
        <Text className="text-[14px] font-medium text-white/75">  {DEFAULT_CURRENCY}</Text>
      </Text>
      {sub && (
        <Text className="text-[12px] text-white/75 mt-1">{sub}</Text>
      )}
    </View>
  );
}

// ─── Stat row (refined) ──────────────────────────────────────────────────────

function StatRow({
  label,
  value,
  color,
  large,
  last,
}: {
  label: string;
  value: string;
  color?: string;
  large?: boolean;
  last?: boolean;
}) {
  const cls = color ?? (large ? "text-slate-900 dark:text-white" : "text-slate-700 dark:text-zinc-200");
  return (
    <View
      className={`flex-row items-baseline justify-between py-2.5 ${
        last ? "" : "border-b border-slate-100 dark:border-zinc-800"
      }`}
    >
      <Text className="text-[13px] text-slate-500 dark:text-zinc-400">{label}</Text>
      <Text
        className={`${
          large ? "font-heading text-[18px] tracking-tight" : "font-heading text-[14px] tracking-tight"
        } ${cls}`}
        style={{ fontVariantLigatures: "none" }}
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Mini bar chart ──────────────────────────────────────────────────────────

interface BarPoint {
  label: string;
  value: number;
  /** Optional secondary value (e.g., expenses against income) */
  secondary?: number;
}

function MiniBarChart({ data, height = 120 }: { data: BarPoint[]; height?: number }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => Math.max(d.value, d.secondary ?? 0)), 1);
  // Cap label count to 7 to keep the x-axis readable on small screens.
  const labelStep = Math.max(1, Math.floor(data.length / 7));
  return (
    <View>
      <View
        className="flex-row items-end gap-1.5"
        style={{ height }}
      >
        {data.map((d, i) => {
          const h = Math.max(2, (d.value / max) * height);
          const hSecondary = d.secondary != null ? Math.max(2, (d.secondary / max) * height) : 0;
          const hasSecondary = d.secondary != null;
          return (
            <View key={i} className="flex-1 flex-row items-end gap-0.5">
              <View
                className="flex-1 rounded-t-md bg-emerald-500"
                style={{ height: h }}
              />
              {hasSecondary && (
                <View
                  className="flex-1 rounded-t-md bg-red-400"
                  style={{ height: hSecondary }}
                />
              )}
            </View>
          );
        })}
      </View>
      <View className="flex-row mt-2 gap-1.5">
        {data.map((d, i) => (
          <View key={i} className="flex-1 items-center">
            {i % labelStep === 0 ? (
              <Text className="text-[10px] text-slate-500 dark:text-zinc-400" style={{ fontVariantLigatures: "none" }}>
                {d.label}
              </Text>
            ) : (
              <Text className="text-[10px] text-transparent">·</Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Insight card ────────────────────────────────────────────────────────────

function InsightCard({
  tone,
  icon,
  title,
  body,
}: {
  tone: "success" | "warning" | "destructive";
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  title: string;
  body: string;
}) {
  const bg =
    tone === "success"
      ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900/40"
      : tone === "warning"
        ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900/40"
        : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-900/40";
  const tileBg =
    tone === "success"
      ? "bg-emerald-100 dark:bg-emerald-900/40"
      : tone === "warning"
        ? "bg-amber-100 dark:bg-amber-900/40"
        : "bg-red-100 dark:bg-red-900/40";
  const iconColor =
    tone === "success" ? "#10b981" : tone === "warning" ? "#f59e0b" : "#ef4444";
  return (
    <View className={`flex-row gap-3 rounded-2xl border p-3.5 mb-3 ${bg}`}>
      <View className={`w-9 h-9 rounded-[10px] items-center justify-center ${tileBg}`}>
        <MaterialIcons name={icon} size={18} color={iconColor} />
      </View>
      <View className="flex-1">
        <Text className="font-heading text-[14px] tracking-tight text-slate-900 dark:text-white">
          {title}
        </Text>
        <Text className="text-[12.5px] text-slate-700 dark:text-zinc-300 mt-1 leading-[18px]">
          {body}
        </Text>
      </View>
    </View>
  );
}

// ─── Report views ────────────────────────────────────────────────────────────

function SalesReportView({ data }: { data: SalesReport }) {
  const points: BarPoint[] = (data.data ?? []).map((d) => ({
    label: shortDayLabel(d.date),
    value: d.amount,
  }));
  const avgPerSale = data.total_sales > 0 ? Math.round(data.total_amount / data.total_sales) : 0;
  return (
    <View>
      <HeroSummary
        label="Выручка"
        value={fmt(data.total_amount)}
        sub={`${fmt(data.total_sales)} продаж · средний чек ${fmt(avgPerSale)} ${DEFAULT_CURRENCY}`}
        tone="primary"
      />

      <Card className="mb-3.5">
        <CardContent className="pt-3.5">
          <View className="flex-row items-center justify-between mb-3">
            <View>
              <Text className="font-heading text-[14px] tracking-tight text-slate-900 dark:text-white">
                По дням
              </Text>
              <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400 mt-0.5">
                {points.length} дней
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              <View className="w-2 h-2 rounded-sm bg-emerald-500" />
              <Text className="text-[11px] text-slate-500 dark:text-zinc-400">Выручка</Text>
            </View>
          </View>
          {points.length > 0 ? (
            <MiniBarChart data={points} />
          ) : (
            <View className="items-center py-6">
              <MaterialIcons name="bar-chart" size={36} color="#94a3b8" />
              <Text variant="muted" className="mt-2">Нет дневных данных</Text>
            </View>
          )}
        </CardContent>
      </Card>

      {/* Returns breakdown — visible only when the server reports any
          refunds in this window. Keeps the typical "no returns" period
          uncluttered while making the deduction obvious when it matters. */}
      {(data.returns_total ?? 0) > 0 && (
        <>
          <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 px-1 mb-2">
            Расшифровка выручки
          </Text>
          <Card className="mb-3.5">
            <CardContent className="py-3">
              <StatRow
                label="Брутто продаж"
                value={`${fmt(data.sales_gross ?? 0)} ${DEFAULT_CURRENCY}`}
              />
              <StatRow
                label="Возвраты"
                value={`− ${fmt(data.returns_total ?? 0)} ${DEFAULT_CURRENCY}`}
                color="text-amber-500"
              />
              <View
                className="my-2 border-t border-dashed border-slate-200 dark:border-zinc-700"
                style={{ borderStyle: "dashed" }}
              />
              <StatRow
                label="Чистая выручка"
                value={`${fmt(data.total_amount)} ${DEFAULT_CURRENCY}`}
                color="text-emerald-600 dark:text-emerald-400"
                large
                last
              />
            </CardContent>
          </Card>
        </>
      )}

      <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 px-1 mb-2">
        Способы оплаты
      </Text>
      <Card className="mb-3.5">
        <CardContent className="py-3">
          <StatRow label="Наличные" value={`${fmt(data.cash)} ${DEFAULT_CURRENCY}`} />
          <StatRow label="Карта" value={`${fmt(data.card)} ${DEFAULT_CURRENCY}`} />
          <StatRow label="Перевод" value={`${fmt(data.transfer)} ${DEFAULT_CURRENCY}`} last />
        </CardContent>
      </Card>
    </View>
  );
}

function ExpensesReportView({ data }: { data: ExpensesReport }) {
  return (
    <View>
      <HeroSummary
        label="Расходы"
        value={`− ${fmt(data.total_amount)}`}
        sub={`${data.count} операций`}
        tone="destructive"
      />
      <Card>
        <CardContent className="py-3">
          <StatRow label="Кол-во операций" value={String(data.count)} />
          <StatRow
            label="Общая сумма"
            value={`${fmt(data.total_amount)} ${DEFAULT_CURRENCY}`}
            color="text-red-500"
            large
            last
          />
        </CardContent>
      </Card>
    </View>
  );
}

function ProfitReportView({ data }: { data: ProfitReport }) {
  const isPositive = data.profit > 0;
  const isNegative = data.profit < 0;
  const cogsPct = data.total_sales > 0 ? Math.round((data.total_cost / data.total_sales) * 100) : 0;
  const expensesPct =
    data.total_sales > 0 ? Math.round((data.total_expenses / data.total_sales) * 100) : 0;

  return (
    <View>
      <HeroSummary
        label="Чистая прибыль"
        value={(data.profit >= 0 ? "+" : "−") + fmt(data.profit)}
        sub={
          data.total_sales > 0
            ? `Выручка ${fmt(data.total_sales)} · себестоимость ${cogsPct}% · расходы ${expensesPct}%`
            : "Нет данных за период"
        }
        tone={isNegative ? "destructive" : "success"}
      />

      <Card className="mb-3.5">
        <CardContent className="py-3">
          {/* When returns happened in this window, show the gross→net
              breakdown so the user can see WHY revenue is lower than
              the sum of sale receipts. */}
          {(data.returns_total ?? 0) > 0 ? (
            <>
              <StatRow
                label="Брутто продаж"
                value={`${fmt(data.sales_gross ?? data.total_sales)} ${DEFAULT_CURRENCY}`}
              />
              <StatRow
                label="Возвраты"
                value={`− ${fmt(data.returns_total ?? 0)} ${DEFAULT_CURRENCY}`}
                color="text-amber-500"
              />
              <StatRow
                label="Чистая выручка"
                value={`${fmt(data.total_sales)} ${DEFAULT_CURRENCY}`}
                color="text-emerald-600 dark:text-emerald-400"
              />
            </>
          ) : (
            <StatRow label="Выручка" value={`${fmt(data.total_sales)} ${DEFAULT_CURRENCY}`} />
          )}
          <StatRow
            label="Себестоимость"
            value={`− ${fmt(data.total_cost)} ${DEFAULT_CURRENCY}`}
            color="text-amber-500"
          />
          <StatRow
            label="Расходы"
            value={`− ${fmt(data.total_expenses)} ${DEFAULT_CURRENCY}`}
            color="text-red-500"
          />
          <View
            className="my-2 border-t border-dashed border-slate-200 dark:border-zinc-700"
            style={{ borderStyle: "dashed" }}
          />
          <StatRow
            label="Чистая прибыль"
            value={`${data.profit >= 0 ? "+" : "−"} ${fmt(data.profit)} ${DEFAULT_CURRENCY}`}
            color={isPositive ? "text-emerald-600 dark:text-emerald-400" : isNegative ? "text-red-500" : undefined}
            large
            last
          />
        </CardContent>
      </Card>

      {data.total_sales > 0 && isPositive && (
        <InsightCard
          tone="success"
          icon="trending-up"
          title="Прибыльный период"
          body={`Чистая прибыль составляет ${Math.round((data.profit / data.total_sales) * 100)}% от выручки. Себестоимость занимает ${cogsPct}%, расходы — ${expensesPct}%.`}
        />
      )}
      {isNegative && (
        <InsightCard
          tone="destructive"
          icon="trending-down"
          title="Период в минусе"
          body={`Расходы и себестоимость превышают выручку на ${fmt(Math.abs(data.profit))} ${DEFAULT_CURRENCY}. Проверьте крупные расходы.`}
        />
      )}
    </View>
  );
}

function StockReportView({ data }: { data: StockReport }) {
  const isPeriod = data.mode === "period";
  return (
    <View>
      <HeroSummary
        label={isPeriod ? "Остаток на конец периода" : "Стоимость склада"}
        value={fmt(data.total_value)}
        sub={
          isPeriod
            ? `${data.total_products} наименований · ${data.date_from} → ${data.date_to}`
            : `${data.total_products} наименований`
        }
        tone="indigo"
      />

      {isPeriod ? (
        // Period balance card — opening, movements, closing.
        <Card className="mb-3.5">
          <CardContent className="py-3">
            <StatRow
              label="Было на начало"
              value={`${fmt(data.opening_qty ?? 0)} шт`}
              color="text-slate-600 dark:text-slate-300"
            />
            <StatRow
              label="Поступило (закупки)"
              value={`+ ${fmt(data.incoming_qty ?? 0)} шт`}
              color="text-emerald-600 dark:text-emerald-400"
            />
            <StatRow
              label="Продано"
              value={`− ${fmt(data.outgoing_qty ?? 0)} шт`}
              color="text-red-500"
            />
            <StatRow
              label="Вернули (возвраты)"
              value={`+ ${fmt(data.returned_qty ?? 0)} шт`}
              color="text-amber-500"
            />
            <View
              className="my-2 border-t border-dashed border-slate-200 dark:border-zinc-700"
              style={{ borderStyle: "dashed" }}
            />
            <StatRow
              label="Осталось на конец"
              value={`${fmt(data.closing_qty ?? 0)} шт`}
              color="text-primary-500"
              large
              last
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-3.5">
          <CardContent className="py-3">
            <StatRow label="Всего товаров" value={String(data.total_products)} />
            <StatRow
              label="Сумма себестоимости"
              value={`${fmt(data.total_cost_value)} ${DEFAULT_CURRENCY}`}
              color="text-slate-500"
            />
            <StatRow
              label="Сумма продажи"
              value={`${fmt(data.total_value)} ${DEFAULT_CURRENCY}`}
              color="text-primary-500"
              large
            />
            <StatRow
              label="Мало на складе"
              value={String(data.low_stock)}
              color="text-amber-500"
            />
            <StatRow
              label="Нет в наличии"
              value={String(data.out_of_stock)}
              color="text-red-500"
              last
            />
          </CardContent>
        </Card>
      )}

      {data.data && data.data.length > 0 && (
        <>
          <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 px-1 mb-2">
            {isPeriod ? "По активности за период" : "Топ по стоимости"}
          </Text>
          <Card className="p-0 overflow-hidden mb-3.5">
            {data.data.slice(0, 15).map((p, idx, arr) => (
              <View
                key={p.id}
                className={`flex-row items-center gap-3 px-3.5 py-3 ${
                  idx === arr.length - 1 ? "" : "border-b border-slate-100 dark:border-zinc-800"
                }`}
              >
                <View className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 items-center justify-center">
                  <MaterialIcons name="inventory-2" size={16} color="#6366f1" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text
                    className="text-[14px] font-medium text-slate-900 dark:text-white"
                    numberOfLines={1}
                  >
                    {p.name}
                  </Text>
                  {isPeriod ? (
                    <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400 mt-0.5">
                      {fmt(p.opening_qty ?? 0)} → {fmt(p.closing_qty ?? p.stock_quantity)}
                      {(p.incoming_qty ?? 0) > 0 ? `  ·  +${fmt(p.incoming_qty ?? 0)}` : ""}
                      {(p.outgoing_qty ?? 0) > 0 ? `  ·  −${fmt(p.outgoing_qty ?? 0)}` : ""}
                      {(p.returned_qty ?? 0) > 0 ? `  ·  +${fmt(p.returned_qty ?? 0)} верн.` : ""}
                    </Text>
                  ) : (
                    <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400 mt-0.5">
                      Остаток: {p.stock_quantity}{p.unit ? ` ${p.unit}` : ""}
                    </Text>
                  )}
                </View>
                <Text
                  className="font-heading text-[14px] tracking-tight text-primary-500"
                  style={{ fontVariantLigatures: "none" }}
                >
                  {isPeriod ? `${fmt(p.closing_qty ?? p.stock_quantity)}` : fmt(p.value)}
                </Text>
              </View>
            ))}
          </Card>
        </>
      )}

      {data.out_of_stock > 0 && (
        <InsightCard
          tone="destructive"
          icon="warning-amber"
          title="Закончились товары"
          body={`${data.out_of_stock} ${data.out_of_stock === 1 ? "товар" : "товаров"} нет в наличии. Запланируйте закупку, чтобы не упустить продажи.`}
        />
      )}
      {data.out_of_stock === 0 && data.low_stock > 0 && (
        <InsightCard
          tone="warning"
          icon="warning-amber"
          title="Низкий остаток"
          body={`${data.low_stock} ${data.low_stock === 1 ? "товар" : "товаров"} близко к порогу. Загляните в раздел Товары → фильтр «Мало»."`}
        />
      )}
    </View>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const { token, user } = useAuth();
  const isOnline = useIsOnline();

  const [activeTab, setActiveTab] = React.useState<ReportTab>("sales");
  const [dateFrom, setDateFrom] = React.useState(daysAgo(30));
  const [dateTo, setDateTo] = React.useState(today());
  const [pickerTarget, setPickerTarget] = React.useState<"from" | "to" | null>(null);

  const [loading, setLoading] = React.useState(false);
  const [salesReport, setSalesReport] = React.useState<SalesReport | null>(null);
  const [expensesReport, setExpensesReport] = React.useState<ExpensesReport | null>(null);
  const [profitReport, setProfitReport] = React.useState<ProfitReport | null>(null);
  const [stockReport, setStockReport] = React.useState<StockReport | null>(null);
  const [error, setError] = React.useState("");
  const [generatingPDF, setGeneratingPDF] = React.useState(false);

  // Shop picker — super_admin and multi-shop owners get one. Single-shop
  // users always operate within their implicit shop and don't need a picker.
  const showShopPicker = needsShopPicker(user);
  const allowedShopIds = React.useMemo(() => pickerShopIds(user), [user]);
  const [shops, setShops] = React.useState<Shop[]>([]);
  const [activeShopId, setActiveShopId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!showShopPicker || !token) return;
    api.shops
      .list(token)
      .then((res) => {
        const raw = res.data ?? [];
        setShops(
          allowedShopIds == null
            ? raw
            : raw.filter((s) => allowedShopIds.includes(s.id)),
        );
      })
      .catch((e) => reportError(e, { tag: "reports-shops-load" }));
  }, [showShopPicker, token, allowedShopIds]);

  const handleDatePickerChange = React.useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === "android") setPickerTarget(null);
      if (event.type === "dismissed" || !selectedDate || !pickerTarget) return;
      const nextValue = dateToValue(selectedDate);
      if (pickerTarget === "from") {
        setDateFrom(nextValue);
        if (dateFromValue(nextValue) > dateFromValue(dateTo)) setDateTo(nextValue);
      } else {
        setDateTo(nextValue);
        if (dateFromValue(nextValue) < dateFromValue(dateFrom)) setDateFrom(nextValue);
      }
    },
    [dateFrom, dateTo, pickerTarget],
  );

  const currentData =
    activeTab === "sales"
      ? salesReport
      : activeTab === "expenses"
        ? expensesReport
        : activeTab === "profit"
          ? profitReport
          : stockReport;

  const generatePDF = React.useCallback(async () => {
    if (!currentData) return;
    setGeneratingPDF(true);
    try {
      let html = `
        <html><head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; padding: 24px; color: #0f172a; }
            h1 { font-size: 22px; color: #0a7ea4; margin: 0 0 4px; }
            h3 { font-size: 13px; color: #64748b; margin: 0 0 18px; font-weight: 500; }
            .stat-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e2e8f0; }
            .stat-label { color: #64748b; font-size: 13px; }
            .stat-value { font-weight: 600; font-size: 14px; }
            .table-title { font-weight: 700; margin: 18px 0 8px; font-size: 14px; color: #334155; }
            table { width: 100%; border-collapse: collapse; }
            th, td { text-align: left; padding: 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
            th { background: #f8fafc; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
            .text-right { text-align: right; }
            .card { background: #fff; padding: 14px 16px; border-radius: 12px; border: 1px solid #e2e8f0; }
          </style>
        </head><body>
          <h1>${TABS.find((t) => t.key === activeTab)?.label ?? "Отчёт"}</h1>
          <h3>${
            activeTab === "stock"
              ? (currentData as StockReport | null)?.mode === "period"
                ? `За период: ${dateFrom} — ${dateTo}`
                : "На текущий момент"
              : `За период: ${dateFrom} — ${dateTo}`
          }</h3>
          <div class="card">
      `;
      if (activeTab === "sales") {
        // Summary mirrors what's on screen (server when online, local
        // fallback when offline). Per-item breakdown still comes from
        // the local mirror because no server endpoint returns sale_items
        // with cost_price.
        const d = currentData as SalesReport;
        html += `
          <div class="stat-row"><span class="stat-label">Кол-во продаж</span><span class="stat-value">${fmt(d.total_sales)}</span></div>
          <div class="stat-row"><span class="stat-label">Выручка</span><span class="stat-value" style="color:#0a7ea4;">${fmt(d.total_amount)}</span></div>
          <div class="stat-row"><span class="stat-label">Наличные</span><span class="stat-value">${fmt(d.cash)}</span></div>
          <div class="stat-row"><span class="stat-label">Карта</span><span class="stat-value">${fmt(d.card)}</span></div>
          <div class="stat-row" style="border:0"><span class="stat-label">Перевод</span><span class="stat-value">${fmt(d.transfer)}</span></div>
        </div>`;
        const exportRows = await getSalesExportRows(localScope(user, activeShopId), {
          dateFrom,
          dateTo,
        });
        if (exportRows.length > 0) {
          html += `<div class="table-title">По товарам</div><table><thead><tr>
            <th>Дата</th>
            <th>Продавец</th>
            <th>Товар</th>
            <th class="text-right">Кол-во</th>
            <th class="text-right">Себест.</th>
            <th class="text-right">Цена</th>
            <th class="text-right">Сумма</th>
          </tr></thead><tbody>`;
          exportRows.forEach((it) => {
            const d2 = it.created_at
              ? new Date(it.created_at).toLocaleDateString("ru-RU", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })
              : "—";
            html += `<tr>
              <td>${d2}</td>
              <td>${it.seller_name ?? "—"}</td>
              <td>${it.product_name ?? "—"}</td>
              <td class="text-right">${fmt(it.quantity)}</td>
              <td class="text-right">${fmt(it.cost_price)}</td>
              <td class="text-right">${fmt(it.unit_price)}</td>
              <td class="text-right"><b>${fmt(it.line_total)}</b></td>
            </tr>`;
          });
          html += `</tbody></table>`;
        }
      } else if (activeTab === "expenses") {
        const d = currentData as ExpensesReport;
        html += `
          <div class="stat-row"><span class="stat-label">Кол-во расходов</span><span class="stat-value">${d.count}</span></div>
          <div class="stat-row" style="border:0"><span class="stat-label">Общая сумма</span><span class="stat-value" style="color:#ef4444">${fmt(d.total_amount)}</span></div>
        </div>`;
        // Per-row table — columns specified by the user: name, unit,
        // quantity, price, total, note. `items` is optional on older
        // servers; guard with `?? []`.
        const items = d.items ?? [];
        if (items.length > 0) {
          html += `<div class="table-title">Расшифровка</div><table><thead><tr>
            <th>Название</th>
            <th>Ед. изм.</th>
            <th class="text-right">Кол-во</th>
            <th class="text-right">Цена</th>
            <th class="text-right">Сумма</th>
            <th>Примечание</th>
          </tr></thead><tbody>`;
          items.forEach((it) => {
            const escapedName = String(it.name ?? "").replace(/</g, "&lt;");
            const escapedUnit = String(it.unit ?? "—").replace(/</g, "&lt;");
            const escapedNote = String(it.note ?? "").replace(/</g, "&lt;");
            html += `<tr>
              <td>${escapedName}</td>
              <td>${escapedUnit}</td>
              <td class="text-right">${fmt(it.quantity)}</td>
              <td class="text-right">${fmt(it.price)}</td>
              <td class="text-right"><b>${fmt(it.total)}</b></td>
              <td>${escapedNote}</td>
            </tr>`;
          });
          html += `</tbody></table>`;
        }
      } else if (activeTab === "profit") {
        const d = currentData as ProfitReport;
        const profitColor = d.profit > 0 ? "#16a34a" : d.profit < 0 ? "#ef4444" : "#0f172a";
        html += `
          <div class="stat-row"><span class="stat-label">Выручка</span><span class="stat-value">${fmt(d.total_sales)}</span></div>
          <div class="stat-row"><span class="stat-label">Себестоимость</span><span class="stat-value">${fmt(d.total_cost)}</span></div>
          <div class="stat-row"><span class="stat-label">Расходы</span><span class="stat-value">${fmt(d.total_expenses)}</span></div>
          <div class="stat-row" style="border:0"><span class="stat-label">Чистая прибыль</span><span class="stat-value" style="color:${profitColor};font-size:16px">${(d.profit >= 0 ? "+" : "−") + fmt(d.profit)}</span></div>
        </div>`;
      } else {
        const d = currentData as StockReport;
        const periodMode = d.mode === "period";
        if (periodMode) {
          html += `
          <div class="stat-row"><span class="stat-label">Период</span><span class="stat-value">${d.date_from} → ${d.date_to}</span></div>
          <div class="stat-row"><span class="stat-label">Было на начало</span><span class="stat-value">${fmt(d.opening_qty ?? 0)} шт</span></div>
          <div class="stat-row"><span class="stat-label">Поступило</span><span class="stat-value" style="color:#16a34a">+ ${fmt(d.incoming_qty ?? 0)} шт</span></div>
          <div class="stat-row"><span class="stat-label">Продано</span><span class="stat-value" style="color:#ef4444">− ${fmt(d.outgoing_qty ?? 0)} шт</span></div>
          <div class="stat-row"><span class="stat-label">Вернули</span><span class="stat-value" style="color:#f59e0b">+ ${fmt(d.returned_qty ?? 0)} шт</span></div>
          <div class="stat-row" style="border:0"><span class="stat-label">Осталось на конец</span><span class="stat-value" style="color:#0a7ea4;font-size:16px">${fmt(d.closing_qty ?? 0)} шт</span></div>
        </div>`;
        } else {
          html += `
          <div class="stat-row"><span class="stat-label">Всего товаров</span><span class="stat-value">${d.total_products}</span></div>
          <div class="stat-row"><span class="stat-label">Сумма себестоимости</span><span class="stat-value" style="color:#64748b">${fmt(d.total_cost_value)}</span></div>
          <div class="stat-row"><span class="stat-label">Сумма продажи</span><span class="stat-value" style="color:#0a7ea4">${fmt(d.total_value)}</span></div>
          <div class="stat-row"><span class="stat-label">Мало на складе</span><span class="stat-value" style="color:#f59e0b">${d.low_stock}</span></div>
          <div class="stat-row" style="border:0"><span class="stat-label">Нет в наличии</span><span class="stat-value" style="color:#ef4444">${d.out_of_stock}</span></div>
        </div>`;
        }
        if (d.data?.length) {
          if (periodMode) {
            // Period balance table — opening / in / out / returned / closing per row.
            html += `<div class="table-title">Движение за период</div><table><thead><tr>
              <th>Товар</th>
              <th>Ед.</th>
              <th class="text-right">Было</th>
              <th class="text-right">Пришло</th>
              <th class="text-right">Ушло</th>
              <th class="text-right">Возврат</th>
              <th class="text-right">Остаток</th>
            </tr></thead><tbody>`;
            d.data.forEach((it) => {
              const esc = (s: string) => s.replace(/</g, "&lt;");
              html += `<tr>
                <td>${esc(it.name)}</td>
                <td>${esc(it.unit ?? "—")}</td>
                <td class="text-right">${fmt(it.opening_qty ?? 0)}</td>
                <td class="text-right" style="color:#16a34a">${fmt(it.incoming_qty ?? 0)}</td>
                <td class="text-right" style="color:#ef4444">${fmt(it.outgoing_qty ?? 0)}</td>
                <td class="text-right" style="color:#f59e0b">${fmt(it.returned_qty ?? 0)}</td>
                <td class="text-right"><b>${fmt(it.closing_qty ?? it.stock_quantity)}</b></td>
              </tr>`;
            });
            html += `</tbody></table>`;
          } else {
            html += `<div class="table-title">Товары</div><table><thead><tr>
              <th>Товар</th>
              <th class="text-right">Остаток</th>
              <th class="text-right">Себест.</th>
              <th class="text-right">Цена</th>
              <th class="text-right">Сумма себест.</th>
              <th class="text-right">Сумма продажи</th>
            </tr></thead><tbody>`;
            d.data.forEach((it) => {
              html += `<tr>
                <td>${it.name}</td>
                <td class="text-right">${fmt(it.stock_quantity)}</td>
                <td class="text-right">${fmt(it.cost_price)}</td>
                <td class="text-right">${fmt(it.sale_price)}</td>
                <td class="text-right">${fmt(it.cost_value)}</td>
                <td class="text-right"><b>${fmt(it.value)}</b></td>
              </tr>`;
            });
            html += `</tbody></table>`;
          }
        }
      }
      html += `</body></html>`;

      const { uri } = await Print.printToFileAsync({ html });
      const fileName = reportFileName(
        activeTab,
        dateFrom,
        dateTo,
        (currentData as StockReport | null)?.mode === "period" ? "period" : "snapshot",
      );
      const generatedPdf = new File(uri);
      const savedPdf = new File(Paths.document, fileName);
      if (savedPdf.exists) savedPdf.delete();
      generatedPdf.copy(savedPdf);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(savedPdf.uri, {
          UTI: ".pdf",
          mimeType: "application/pdf",
          dialogTitle: fileName,
        });
      } else {
        setError(`PDF сохранён: ${fileName}`);
      }
    } catch (e) {
      reportError(e, { tag: "reports-pdf-generate", activeTab });
      setError("Не удалось создать PDF");
    } finally {
      setGeneratingPDF(false);
    }
  }, [activeTab, currentData, dateFrom, dateTo, user, activeShopId]);

  const loadReport = React.useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    const params = {
      date_from: dateFrom,
      date_to: dateTo,
      ...(activeShopId != null ? { shop_id: activeShopId } : {}),
    };
    // Reports are server-computed only. The legacy local-SQLite fallback
    // is gone because the read-side cache it depended on isn't populated
    // any more (React Query keeps everything in memory). When the device
    // is offline we surface a clear error rather than silently rendering
    // an empty stale report.
    if (!isOnline) {
      setError("Отчёты доступны только в онлайн-режиме.");
      setLoading(false);
      return;
    }

    try {
      switch (activeTab) {
        case "sales":
          setSalesReport(await api.reports.sales(token, params));
          break;
        case "expenses":
          setExpensesReport(await api.reports.expenses(token, params));
          break;
        case "profit":
          setProfitReport(await api.reports.profit(token, params));
          break;
        case "stock":
          setStockReport(await api.reports.stock(token, params));
          break;
      }
    } catch (e: any) {
      const isNetworkError =
        (e instanceof ApiError && e.status === 0)
        || e?.message?.includes("Network request failed");
      setError(
        isNetworkError
          ? "Нет соединения. Откройте отчёт, когда восстановится интернет."
          : e?.message ?? "Не удалось загрузить отчёт.",
      );
    } finally {
      setLoading(false);
    }
  }, [activeTab, dateFrom, dateTo, token, isOnline]);

  // Reset cached reports when any of the inputs that affect the result
  // changes — period or active shop. Without `activeShopId` here, the
  // alreadyLoaded gate below kept the previous shop's report and the
  // screen looked stuck on stale data until you hit "Применить".
  React.useEffect(() => {
    setSalesReport(null);
    setExpensesReport(null);
    setProfitReport(null);
    setStockReport(null);
  }, [dateFrom, dateTo, activeShopId]);

  React.useEffect(() => {
    if (!can(user?.role, "reports:view")) return;
    const alreadyLoaded =
      (activeTab === "sales" && salesReport)
      || (activeTab === "expenses" && expensesReport)
      || (activeTab === "profit" && profitReport)
      || (activeTab === "stock" && stockReport);
    if (alreadyLoaded) return;
    loadReport();
  }, [loadReport, user?.role, activeTab, salesReport, expensesReport, profitReport, stockReport]);

  if (!can(user?.role, "reports:view")) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons name="lock" size={48} color="#94a3b8" />
        <Text variant="h5" className="mt-4 text-center">
          Нет доступа
        </Text>
        <Text variant="muted" className="mt-2 text-center">
          У вас нет прав для просмотра отчётов.
        </Text>
      </SafeAreaView>
    );
  }

  const monthLabel = new Date().toLocaleDateString("ru-RU", { month: "long", year: "numeric" });

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 pt-4 pb-3 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800">
        <View className="flex-1 min-w-0">
          <Text className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white">
            Отчёты
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5 capitalize">
            {monthLabel}
            {user?.shop_name ? ` · ${user.shop_name}` : ""}
          </Text>
        </View>
        <Pressable
          onPress={generatePDF}
          disabled={!currentData || generatingPDF}
          className={`w-9 h-9 items-center justify-center rounded-full ${
            !currentData || generatingPDF
              ? "bg-slate-100 dark:bg-zinc-800 opacity-50"
              : "bg-slate-100 dark:bg-zinc-800 active:opacity-70"
          }`}
        >
          {generatingPDF ? (
            <ActivityIndicator size="small" color="#0a7ea4" />
          ) : (
            <MaterialIcons name="ios-share" size={20} color="#475569" />
          )}
        </Pressable>
      </View>

      {/* Shop picker — multi-shop owner / super_admin only. Sellers and
          single-shop owners are implicitly scoped via localScope. */}
      {showShopPicker && (
        <View className="bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800 py-1">
          <ShopPicker
            shops={shops}
            activeShopId={activeShopId}
            onChange={setActiveShopId}
          />
        </View>
      )}

      {/* Tabs */}
      <View className="bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 6 }}
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                className={`px-3.5 py-1.5 rounded-full border flex-row items-center gap-1.5 active:opacity-80 ${
                  active
                    ? "bg-primary-500 border-primary-500"
                    : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
                }`}
              >
                <MaterialIcons
                  name={tab.icon}
                  size={14}
                  color={active ? "#ffffff" : "#64748b"}
                />
                <Text
                  className={`text-[13px] font-semibold ${
                    active ? "text-white" : "text-slate-700 dark:text-zinc-300"
                  }`}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Date filter — visible on every tab. On Stock the dates flip the
          report into "period balance" mode (opening → closing reconstruction);
          omit them to see the live snapshot. */}
      <View className="bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}
        >
          {PERIODS.map((p) => {
            const active = dateFrom === p.from && dateTo === p.to;
            return (
              <Pressable
                key={p.label}
                onPress={() => {
                  setDateFrom(p.from);
                  setDateTo(p.to);
                }}
                className={`px-3 py-1 rounded-full active:opacity-80 ${
                  active ? "bg-slate-900 dark:bg-white" : "bg-slate-100 dark:bg-zinc-800"
                }`}
              >
                <Text
                  className={`text-[12px] font-semibold ${
                    active ? "text-white dark:text-slate-900" : "text-slate-700 dark:text-zinc-300"
                  }`}
                >
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Content */}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Custom date picker row — visible on every tab. */}
        <View className="flex-row items-end gap-2 mb-3">
          <View className="flex-1">
            <Text className="text-[11px] font-semibold uppercase tracking-[0.4px] text-slate-500 dark:text-zinc-400 mb-1">
              С
            </Text>
            <Pressable
              onPress={() => setPickerTarget("from")}
              className="flex-row items-center justify-between bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 active:opacity-70"
            >
              <Text className="text-[13px] font-medium text-slate-900 dark:text-white">
                {dateLabel(dateFrom)}
              </Text>
              <MaterialIcons name="calendar-today" size={15} color="#94a3b8" />
            </Pressable>
          </View>
          <View className="flex-1">
            <Text className="text-[11px] font-semibold uppercase tracking-[0.4px] text-slate-500 dark:text-zinc-400 mb-1">
              По
            </Text>
            <Pressable
              onPress={() => setPickerTarget("to")}
              className="flex-row items-center justify-between bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-xl px-3 py-2.5 active:opacity-70"
            >
              <Text className="text-[13px] font-medium text-slate-900 dark:text-white">
                {dateLabel(dateTo)}
              </Text>
              <MaterialIcons name="calendar-today" size={15} color="#94a3b8" />
            </Pressable>
          </View>
          <Pressable
            onPress={loadReport}
            className="bg-primary-500 rounded-xl px-4 py-2.5 active:opacity-80"
          >
            <Text className="text-[12px] font-semibold text-white">Применить</Text>
          </Pressable>
          {pickerTarget && (
            <DateTimePicker
              value={dateFromValue(pickerTarget === "from" ? dateFrom : dateTo)}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={handleDatePickerChange}
            />
          )}
        </View>

        {/* Error */}
        {!!error && (
          <View className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 mb-4 flex-row items-center gap-2">
            <MaterialIcons name="error-outline" size={16} color="#ef4444" />
            <Text className="text-sm text-red-600 flex-1">{error}</Text>
          </View>
        )}

        {/* Report */}
        {loading ? (
          <View className="gap-3">
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-36 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
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

        {/* Export buttons row at the bottom of every tab */}
        {currentData && (
          <View className="mt-3">
            <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400 px-1 mb-2">
              Экспорт
            </Text>
            <View className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl overflow-hidden">
              <Pressable
                onPress={generatePDF}
                disabled={generatingPDF}
                className="flex-row items-center gap-3 px-3.5 py-3 active:opacity-70 border-b border-slate-100 dark:border-zinc-800"
              >
                <View className="w-9 h-9 rounded-[10px] bg-red-100 dark:bg-red-900/40 items-center justify-center">
                  <MaterialIcons name="picture-as-pdf" size={18} color="#ef4444" />
                </View>
                <View className="flex-1">
                  <Text className="text-[14px] font-semibold text-slate-900 dark:text-white">
                    Скачать PDF
                  </Text>
                  <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400">
                    Все цифры этого периода
                  </Text>
                </View>
                {generatingPDF ? (
                  <ActivityIndicator size="small" color="#0a7ea4" />
                ) : (
                  <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
                )}
              </Pressable>
              <Pressable
                onPress={generatePDF}
                disabled={generatingPDF}
                className="flex-row items-center gap-3 px-3.5 py-3 active:opacity-70"
              >
                <View className="w-9 h-9 rounded-[10px] bg-primary-100 dark:bg-primary-900/40 items-center justify-center">
                  <MaterialIcons name="ios-share" size={18} color="#0a7ea4" />
                </View>
                <View className="flex-1">
                  <Text className="text-[14px] font-semibold text-slate-900 dark:text-white">
                    Поделиться
                  </Text>
                  <Text className="text-[11.5px] text-slate-500 dark:text-zinc-400">
                    WhatsApp · Telegram · Email
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
