import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  RefreshControl,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { SafeAreaView } from "react-native-safe-area-context";

import { Alert, Avatar, Text } from "@/components/ui";
import { useAuth } from "@/store/auth";
import { useCacheMethods } from "@/lib/cache/CacheProvider";

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
import { ShopPicker } from "@/components/dashboard/ShopPicker";
import { CreateSaleModal } from "@/components/sales/CreateSaleModal";
import { CreatePurchaseModal } from "@/components/purchases/CreatePurchaseModal";
import { ExpenseFormModal } from "@/components/expenses/ExpenseFormModal";
import { CustomPeriodModal } from "@/components/dashboard/CustomPeriodModal";
import { STORAGE_KEYS } from "@/constants/config";
import { can } from "@/lib/permissions";

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user, token } = useAuth();
  const router = useRouter();
  const { refreshProducts } = useCacheMethods();
  const isSuperAdmin = user?.role === "super_admin";
  // Multi-shop owners get the same shop picker on the dashboard so they
  // can flip between an aggregated view and a single-shop view. Single-
  // shop owners and sellers don't need the picker — their data is already
  // scoped server-side.
  const ownedShopIds = user?.owned_shop_ids ?? [];
  const isMultiShopOwner = user?.role === "owner" && ownedShopIds.length > 1;
  const showShopPicker = isSuperAdmin || isMultiShopOwner;
  const [isDataHidden, setIsDataHidden] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    SecureStore.getItemAsync(STORAGE_KEYS.dashboardHideAmounts)
      .then((stored) => {
        if (!cancelled) {
          setIsDataHidden(stored === "true");
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const toggleDataHidden = React.useCallback(() => {
    setIsDataHidden((current) => {
      const next = !current;
      SecureStore.setItemAsync(STORAGE_KEYS.dashboardHideAmounts, String(next)).catch(() => {});
      return next;
    });
  }, []);

  // Modals state — `mounted` is sticky once the user opens a modal, so we
  // only pay the mount cost on first open instead of on every dashboard render.
  // Closing only flips `visible`; the modal subtree stays in memory for
  // instant reopen, but never mounts unless the user actually opens it.
  const [saleModalVisible, setSaleModalVisible] = React.useState(false);
  const [saleModalMounted, setSaleModalMounted] = React.useState(false);
  const [purchaseModalVisible, setPurchaseModalVisible] = React.useState(false);
  const [purchaseModalMounted, setPurchaseModalMounted] = React.useState(false);
  const [expenseModalVisible, setExpenseModalVisible] = React.useState(false);
  const [expenseModalMounted, setExpenseModalMounted] = React.useState(false);
  const [customModalVisible, setCustomModalVisible] = React.useState(false);
  const [customModalMounted, setCustomModalMounted] = React.useState(false);

  const openSaleModal = React.useCallback(() => {
    setSaleModalMounted(true);
    setSaleModalVisible(true);
  }, []);
  const openPurchaseModal = React.useCallback(() => {
    setPurchaseModalMounted(true);
    setPurchaseModalVisible(true);
  }, []);
  const openExpenseModal = React.useCallback(() => {
    setExpenseModalMounted(true);
    setExpenseModalVisible(true);
  }, []);
  const openCustomModal = React.useCallback(() => {
    setCustomModalMounted(true);
    setCustomModalVisible(true);
  }, []);

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
    isOffline,
    fetchDashboard,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
  } = useDashboard({ token, isSuperAdmin, isMultiShopOwner });

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              await Promise.all([fetchDashboard(true), refreshProducts(true)]);
            }}
            tintColor="#0a7ea4"
            colors={["#0a7ea4"]}
          />
        }
      >
        {/* ── Header ── */}
        <View className="flex-row items-center gap-3 px-5 pt-4 pb-3">
          <View className="flex-1 min-w-0">
            <Text className="font-heading text-[22px] leading-7 tracking-tight text-slate-900 dark:text-white" numberOfLines={1}>
              {getGreeting(user?.name)}
            </Text>
            <Text className="text-[12.5px] text-slate-500 dark:text-zinc-400 mt-0.5">
              {formatDate()}
            </Text>
          </View>
          <TouchableOpacity
            onPress={toggleDataHidden}
            className="w-[38px] h-[38px] items-center justify-center rounded-full bg-slate-100 dark:bg-zinc-800 active:opacity-70"
          >
            <MaterialIcons name={isDataHidden ? "visibility-off" : "visibility"} size={20} color="#64748b" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/(tabs)/settings")}
            className="active:opacity-70"
          >
            <Avatar name={user?.name ?? "?"} size="default" />
          </TouchableOpacity>
        </View>

        {/* ── Shop chip / picker ──
            super_admin and multi-shop owners get a bottom-sheet picker.
            Sellers and single-shop owners see a tiny static chip below. */}
        {showShopPicker ? (
          <ShopPicker
            shops={shops}
            activeShopId={activeShopId}
            onChange={setActiveShopId}
          />
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
              openCustomModal();
            } else {
              setDateFrom(null);
              setDateTo(null);
              setPeriod(p);
            }
          }}
        />

        {/* ── Offline banner ── */}
        {isOffline && (
          <Alert
            variant="warning"
            title="Офлайн режим"
            description="Показаны сохранённые данные. Некоторые данные могут быть устаревшими."
            className="mx-5 mb-4"
          />
        )}

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
          <StatsGrid summary={summary} isDataHidden={isDataHidden} userRole={user?.role} />
        ) : null}

        {/* ── Stock, Debts & Zakat ── */}
        {summary && !loading && (
          <View className="flex-row px-5 mb-2 items-stretch gap-4">
            {/* Left column */}
            <View className="flex-1 gap-4">
              <StockInfoCard
                totalQty={summary.stock_total_qty ?? 0}
                totalCost={user?.role !== "seller" ? (summary.stock_total_cost ?? 0) : 0}
                totalSalesValue={summary.stock_total_sales_value ?? 0}
                isDataHidden={isDataHidden}
                onPress={() => router.push("/(tabs)/products")}
              />
              <DebtsCard
                receivables={summary.debts_receivable ?? 0}
                payables={summary.debts_payable ?? 0}
                isDataHidden={isDataHidden}
                onPress={can(user?.role, "debts:view") ? () => router.push("/debts") : undefined}
              />
            </View>

            {/* Right column */}
            {user?.role !== "seller" && (
              <View className="w-32">
                <ZakatCard
                  totalCost={summary.stock_total_cost ?? 0}
                  receivables={summary.debts_receivable ?? 0}
                  payables={summary.debts_payable ?? 0}
                  isDataHidden={isDataHidden}
                />
              </View>
            )}
          </View>
        )}

        {/* ── Quick Actions ── */}
        {!loading && (
          <QuickActions
            onAddSale={openSaleModal}
            onAddPurchase={openPurchaseModal}
            onAddExpense={openExpenseModal}
            userRole={user?.role}
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

      {/* ── Modals (mounted lazily on first open) ── */}
      {saleModalMounted && (
        <CreateSaleModal
          visible={saleModalVisible}
          onClose={() => setSaleModalVisible(false)}
          onCreated={() => { fetchDashboard(true); }}
          token={token!}
        />
      )}
      {purchaseModalMounted && can(user?.role, "purchases:create") && (
        <CreatePurchaseModal
          visible={purchaseModalVisible}
          onClose={() => setPurchaseModalVisible(false)}
          onCreated={() => { fetchDashboard(true); }}
          token={token!}
        />
      )}
      {expenseModalMounted && can(user?.role, "expenses:create") && (
        <ExpenseFormModal
          visible={expenseModalVisible}
          editing={null}
          onClose={() => setExpenseModalVisible(false)}
          onSaved={() => { fetchDashboard(true); }}
          token={token!}
        />
      )}
      {customModalMounted && (
        <CustomPeriodModal
          visible={customModalVisible}
          onClose={() => setCustomModalVisible(false)}
          initialFrom={dateFrom}
          initialTo={dateTo}
          onApply={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
            setPeriod("custom");
          }}
        />
      )}
    </SafeAreaView>
  );
}
