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

import { Alert, Avatar, Select, Text } from "@/components/ui";
import { useAuth } from "@/store/auth";

import { useDashboard } from "@/hooks/useDashboard";
import { getGreeting, formatDate } from "@/lib/formatters";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import { StatsGrid, StatsGridSkeleton } from "@/components/dashboard/StatsGrid";
import { LowStockSection, LowStockSkeleton } from "@/components/dashboard/LowStockSection";
import { RecentSalesSection, RecentSalesSkeleton } from "@/components/dashboard/RecentSalesSection";
import { StockInfoCard } from "@/components/dashboard/StockInfoCard";
import { ZakatCard } from "@/components/dashboard/ZakatCard";
import { DebtsCard } from "@/components/dashboard/DebtsCard";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { CreateSaleModal } from "@/components/sales/CreateSaleModal";
import { CreatePurchaseModal } from "@/components/purchases/CreatePurchaseModal";
import { ExpenseFormModal } from "@/components/expenses/ExpenseFormModal";
import { CustomPeriodModal } from "@/components/dashboard/CustomPeriodModal";

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user, token } = useAuth();
  const router = useRouter();
  const isSuperAdmin = user?.role === "super_admin";
  const [isDataHidden, setIsDataHidden] = React.useState(false);

  // Modals state
  const [saleModalVisible, setSaleModalVisible] = React.useState(false);
  const [purchaseModalVisible, setPurchaseModalVisible] = React.useState(false);
  const [expenseModalVisible, setExpenseModalVisible] = React.useState(false);
  const [customModalVisible, setCustomModalVisible] = React.useState(false);

  const {
    period,
    setPeriod,
    activeShopId,
    setActiveShopId,
    shops,
    summary,
    loading,
    refreshing,
    error,
    fetchDashboard,
    setDateFrom,
    setDateTo,
  } = useDashboard({ token, isSuperAdmin });

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
          <View className="flex-row items-center gap-3">
            <TouchableOpacity onPress={() => setIsDataHidden(!isDataHidden)} className="w-10 h-10 items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800">
              <MaterialIcons name={isDataHidden ? "visibility-off" : "visibility"} size={22} color="#64748b" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push("/(tabs)/settings")}
              className="active:opacity-70"
            >
              <Avatar name={user?.name ?? "?"} size="default" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Shop name chip ── */}
        {isSuperAdmin ? (
          <View className="px-5 pb-2 pt-1">
            <Select
              value={activeShopId ? String(activeShopId) : ""}
              onValueChange={(v) => setActiveShopId(v ? Number(v) : null)}
              options={[
                { label: "Все магазины", value: "" },
                ...shops.map(s => ({ label: s.name, value: String(s.id) }))
              ]}
              placeholder="Все магазины"
            />
          </View>
        ) : user?.shop_name ? (
          <View className="flex-row items-center gap-1.5 px-5 pb-1">
            <MaterialIcons name="store" size={14} color="#94a3b8" />
            <Text variant="small">{user.shop_name}</Text>
          </View>
        ) : null}

        {/* ── Period filter ── */}
        <PeriodFilter 
          value={period} 
          onChange={(p) => {
            if (p === "custom") {
              setCustomModalVisible(true);
            } else {
              setDateFrom(null);
              setDateTo(null);
              setPeriod(p);
            }
          }} 
        />

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
          <StatsGrid summary={summary} isDataHidden={isDataHidden} />
        ) : null}

        {/* ── Stock, Debts & Zakat ── */}
        {summary && !loading && (
          <View className="flex-row px-5 mb-2 items-stretch gap-4">
            {/* Left column */}
            <View className="flex-1 gap-4">
              <StockInfoCard
                totalQty={summary.stock_total_qty ?? 0}
                totalCost={summary.stock_total_cost ?? 0}
                totalSalesValue={summary.stock_total_sales_value ?? 0}
                isDataHidden={isDataHidden}
                onPress={() => router.push("/(tabs)/products")}
              />
              <DebtsCard
                receivables={summary.debts_receivable ?? 0}
                payables={summary.debts_payable ?? 0}
                isDataHidden={isDataHidden}
              />
            </View>

            {/* Right column */}
            <View className="w-32">
              <ZakatCard
                totalCost={summary.stock_total_cost ?? 0}
                receivables={summary.debts_receivable ?? 0}
                payables={summary.debts_payable ?? 0}
                isDataHidden={isDataHidden}
              />
            </View>
          </View>
        )}

        {/* ── Quick Actions ── */}
        {!loading && (
          <QuickActions
            onAddSale={() => setSaleModalVisible(true)}
            onAddPurchase={() => setPurchaseModalVisible(true)}
            onAddExpense={() => setExpenseModalVisible(true)}
          />
        )}

        {/* ── Low stock ── */}
        {loading ? (
          <LowStockSkeleton />
        ) : summary ? (
          <LowStockSection
            items={summary.low_stock_products}
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

      {/* ── Modals ── */}
      <CreateSaleModal
        visible={saleModalVisible}
        onClose={() => setSaleModalVisible(false)}
        onCreated={() => { fetchDashboard(true); }}
        token={token!}
      />
      <CreatePurchaseModal
        visible={purchaseModalVisible}
        onClose={() => setPurchaseModalVisible(false)}
        onCreated={() => { fetchDashboard(true); }}
        token={token!}
      />
      <ExpenseFormModal
        visible={expenseModalVisible}
        editing={null}
        onClose={() => setExpenseModalVisible(false)}
        onSaved={() => { fetchDashboard(true); }}
        token={token!}
      />
      <CustomPeriodModal
        visible={customModalVisible}
        onClose={() => setCustomModalVisible(false)}
        onApply={(from, to) => {
          setDateFrom(from);
          setDateTo(to);
          setPeriod("custom");
        }}
      />
    </SafeAreaView>
  );
}
