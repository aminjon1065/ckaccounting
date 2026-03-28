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

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const { user, token } = useAuth();
  const router = useRouter();
  const isSuperAdmin = user?.role === "super_admin";

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
          <TouchableOpacity
            onPress={() => router.push("/(tabs)/settings")}
            className="active:opacity-70"
          >
            <Avatar name={user?.name ?? "?"} size="default" />
          </TouchableOpacity>
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
        {!loading && summary?.stats && (
          <View className="flex-row items-center gap-1.5 px-5 mt-3">
            <MaterialIcons name="receipt" size={14} color="#94a3b8" />
            <Text variant="small">
              {summary.stats.sales_count ?? 0} продаж за период
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
