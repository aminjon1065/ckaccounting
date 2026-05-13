import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";

import { EmptyState, FAB, Skeleton, Text } from "@/components/ui";
import { useAuth } from "@/store/auth";
import { useToast } from "@/store/toast";

import { SaleCard } from "@/components/sales/SaleCard";
import { CreateSaleModal } from "@/components/sales/CreateSaleModal";
import { EditSaleModal } from "@/components/sales/EditSaleModal";
import { useSales } from "@/hooks/useSales";
import { useIsOnline } from "@/lib/network/NetworkProvider";
import { api, ApiError, type Sale } from "@/lib/api";
import { deleteLocalSale } from "@/lib/db";
import { can } from "@/lib/permissions";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { fmt } from "@/lib/formatters";

// ─── Date grouping ───────────────────────────────────────────────────────────

type ListRow = { kind: "section"; key: string; label: string; total: number } | { kind: "sale"; sale: Sale };

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(key: string): string {
  const today = new Date();
  const yKey = localDay(today.toISOString());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yestKey = localDay(yesterday.toISOString());
  if (key === yKey) return "Сегодня";
  if (key === yestKey) return "Вчера";
  const [y, m, d] = key.split("-").map(Number);
  // ru month names, day + month
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function buildRows(sales: Sale[]): ListRow[] {
  const rows: ListRow[] = [];
  let currentKey = "";
  let currentTotal = 0;
  let sectionIdx = -1;
  for (const sale of sales) {
    const key = localDay(sale.created_at);
    if (key !== currentKey) {
      currentKey = key;
      currentTotal = 0;
      rows.push({ kind: "section", key, label: dayLabel(key), total: 0 });
      sectionIdx = rows.length - 1;
    }
    currentTotal += sale.total;
    (rows[sectionIdx] as Extract<ListRow, { kind: "section" }>).total = currentTotal;
    rows.push({ kind: "sale", sale });
  }
  return rows;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SalesScreen() {
  const { token, user } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const isOnline = useIsOnline();

  const {
    sales,
    setSales,
    loading,
    refreshing,
    loadingMore,
    error,
    handleRefresh,
    handleLoadMore,
    retryFetch,
  } = useSales({ token, user });

  const [createVisible, setCreateVisible] = React.useState(false);
  const [editingSale, setEditingSale] = React.useState<Sale | null>(null);

  const canEditSale = can(user?.role, "sales:edit");
  const canDeleteSale = can(user?.role, "sales:delete");

  const handleSelectSale = React.useCallback(
    (id: string) => router.push(`/sales/${id}`),
    [router],
  );

  const handleEditSale = React.useCallback((sale: Sale) => {
    setEditingSale(sale);
  }, []);

  const dropLocalSaleAndList = React.useCallback(
    async (id: string) => {
      try {
        await deleteLocalSale(id);
      } catch {
        // best-effort; the periodic reconcile / next sync will catch up
      }
      setSales((prev) => prev.filter((s) => s.id !== id));
    },
    [setSales],
  );

  const handleDeleteSale = React.useCallback(
    (sale: Sale) => {
      if (!token) return;
      Alert.alert(
        "Удалить продажу?",
        "Товары будут возвращены на склад. Действие нельзя отменить.",
        [
          { text: "Отмена", style: "cancel" },
          {
            text: "Удалить",
            style: "destructive",
            onPress: async () => {
              try {
                const bytes = await Crypto.getRandomBytesAsync(16);
                const idempotencyKey = Array.from(bytes)
                  .map((b) => b.toString(16).padStart(2, "0"))
                  .join("");
                await api.sales.delete(sale.id, token, idempotencyKey);
                await dropLocalSaleAndList(sale.id);
                showToast({ message: "Продажа удалена", variant: "success" });
              } catch (e) {
                if (e instanceof ApiError && e.status === 0) {
                  showToast({
                    message: "Нет соединения. Проверьте интернет и попробуйте снова.",
                    variant: "error",
                  });
                } else if (e instanceof ApiError && e.status === 404) {
                  await dropLocalSaleAndList(sale.id);
                  showToast({
                    message: "Продажа уже была удалена. Локальная копия очищена.",
                    variant: "success",
                  });
                } else {
                  showToast({ message: "Не удалось удалить продажу.", variant: "error" });
                }
              }
            },
          },
        ],
      );
    },
    [token, dropLocalSaleAndList, showToast],
  );

  // Flatten with date headers. Memoised on `sales` to keep FlatList stable.
  const rows = React.useMemo(() => buildRows(sales), [sales]);

  // Period stats for the header subtitle.
  const periodStats = React.useMemo(() => {
    const total = sales.reduce((s, x) => s + x.total, 0);
    return { count: sales.length, total };
  }, [sales]);

  const renderRow = React.useCallback(
    ({ item }: { item: ListRow }) => {
      if (item.kind === "section") {
        return (
          <View className="flex-row items-center gap-2 px-1 pt-3 pb-2">
            <Text className="text-[12px] font-semibold uppercase tracking-[0.8px] text-slate-500 dark:text-zinc-400">
              {item.label}
            </Text>
            <View className="flex-1 h-px bg-slate-200 dark:bg-zinc-800" />
            <Text
              className="font-heading text-[12px] tracking-tight text-slate-700 dark:text-zinc-300"
              style={{ fontVariantLigatures: "none" }}
            >
              {fmt(item.total)} {DEFAULT_CURRENCY}
            </Text>
          </View>
        );
      }
      return (
        <SaleCard
          item={item.sale}
          onSelect={handleSelectSale}
          onEdit={canEditSale ? handleEditSale : undefined}
          onDelete={canDeleteSale ? handleDeleteSale : undefined}
        />
      );
    },
    [handleSelectSale, handleEditSale, handleDeleteSale, canEditSale, canDeleteSale],
  );

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center gap-3 px-5 pt-4 pb-3 bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800">
        <View className="flex-1 min-w-0">
          <Text className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white">
            Продажи
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
            {isOnline
              ? `${periodStats.count} продаж · ${fmt(periodStats.total)} ${DEFAULT_CURRENCY}`
              : "Офлайн · показаны сохранённые"}
          </Text>
        </View>
        <Pressable
          onPress={() => showToast({ message: "Поиск скоро будет добавлен", variant: "success" })}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
        >
          <MaterialIcons name="search" size={20} color="#475569" />
        </Pressable>
        <Pressable
          onPress={() => showToast({ message: "Фильтры скоро будут добавлены", variant: "success" })}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
        >
          <MaterialIcons name="filter-list" size={20} color="#475569" />
        </Pressable>
      </View>

      {!isOnline && (
        <View className="mx-4 mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-900/20">
          <Text className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Офлайн-режим
          </Text>
          <Text className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Показаны сохранённые продажи. Новые операции станут доступны после восстановления сети.
          </Text>
        </View>
      )}

      {/* List */}
      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="mb-2.5">
              <Skeleton className="h-[88px] rounded-2xl" />
            </View>
          ))}
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons name="cloud-off" size={48} color="#94a3b8" />
          <Text variant="h5" className="mt-4 text-center">
            Ошибка загрузки
          </Text>
          <Text variant="muted" className="mt-1 text-center">
            {error}
          </Text>
          <TouchableOpacity
            onPress={retryFetch}
            className="mt-4 flex-row items-center gap-2 bg-primary-500 px-5 py-2.5 rounded-xl"
          >
            <MaterialIcons name="refresh" size={18} color="#fff" />
            <Text className="text-sm font-semibold text-white">Повторить</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) =>
            item.kind === "section" ? `s:${item.key}` : item.sale.id
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 }}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={5}
          removeClippedSubviews
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-long"
              title="Пока нет продаж"
              description="Запишите первую продажу — кнопка «+» в правом нижнем углу."
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <View className="flex-row items-center justify-center gap-2 py-4">
                <ActivityIndicator size="small" color="#0a7ea4" />
                <Text variant="muted">Загружается история…</Text>
              </View>
            ) : null
          }
          renderItem={renderRow}
        />
      )}

      <FAB onPress={() => setCreateVisible(true)} />

      <CreateSaleModal
        visible={createVisible}
        onClose={() => setCreateVisible(false)}
        onCreated={(s) => {
          setSales((prev) => [s, ...prev]);
          showToast({ message: "Продажа записана", variant: "success" });
        }}
        token={token!}
      />

      {editingSale && token && (
        <EditSaleModal
          visible={!!editingSale}
          sale={editingSale}
          token={token}
          onClose={() => setEditingSale(null)}
          onSuccess={(updated) => {
            setSales((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
            setEditingSale(null);
          }}
          onMissing={() => {
            const id = editingSale.id;
            setEditingSale(null);
            dropLocalSaleAndList(id).catch(() => {});
            showToast({
              message: "Продажа была удалена. Локальная копия очищена.",
              variant: "error",
            });
          }}
        />
      )}
    </SafeAreaView>
  );
}
