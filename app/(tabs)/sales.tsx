import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  TextInput,
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
import {
  SalesFilterModal,
  DEFAULT_SALES_FILTERS,
  activeFiltersCount,
  type SalesFilters,
} from "@/components/sales/SalesFilterModal";
import { useDeleteSale, useSaleList } from "@/lib/queries/sales";
import { useIsOnline } from "@/lib/network/NetworkProvider";
import { api, ApiError, type Sale, type Shop } from "@/lib/api";
import { can, needsShopPicker, pickerShopIds } from "@/lib/permissions";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { fmt } from "@/lib/formatters";
import { ShopPicker } from "@/components/dashboard/ShopPicker";

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

  const [createVisible, setCreateVisible] = React.useState(false);
  const [editingSale, setEditingSale] = React.useState<Sale | null>(null);

  // Search + filter state. Passed through to the server via `useSaleList`
  // so the result set narrows server-side instead of just on the loaded
  // page — important once the user has more than `PAGE_SIZE` sales.
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [filters, setFilters] = React.useState<SalesFilters>(DEFAULT_SALES_FILTERS);
  const filterCount = activeFiltersCount(filters);

  // Debounce the search query so typing doesn't fire a request per
  // keystroke. 300ms feels responsive without flooding the API.
  React.useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  // Shop picker — super_admin and multi-shop owners only. Default "Все
  // магазины" (null) so the user lands on the aggregated view first.
  const showShopPicker = needsShopPicker(user);
  const allowedShopIds = React.useMemo(() => pickerShopIds(user), [user]);
  const [activeShopId, setActiveShopId] = React.useState<number | null>(null);
  const [shops, setShops] = React.useState<Shop[]>([]);

  React.useEffect(() => {
    if (!token || !showShopPicker) return;
    api.shops
      .list(token)
      .then((res: any) => {
        const raw: Shop[] = Array.isArray(res)
          ? res
          : Array.isArray(res?.data)
            ? res.data
            : [];
        const filtered =
          allowedShopIds == null
            ? raw
            : raw.filter((s) => allowedShopIds.includes(s.id));
        setShops(filtered);
      })
      .catch(() => {});
  }, [token, showShopPicker, allowedShopIds]);

  const queryFilters = React.useMemo(
    () => ({
      search: debouncedSearch || undefined,
      paymentType: filters.paymentType === "all" ? undefined : filters.paymentType,
      saleType: filters.saleType === "all" ? undefined : filters.saleType,
      debtOnly: filters.debtOnly,
      shopId: activeShopId,
    }),
    [debouncedSearch, filters, activeShopId],
  );

  const query = useSaleList(token, queryFilters);
  const {
    data,
    error,
    isPending,
    isFetching,
    isRefetching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = query;

  const sales = React.useMemo<Sale[]>(
    () => (data?.pages ?? []).flatMap((p) => p.data),
    [data],
  );

  const deleteMutation = useDeleteSale(token);

  const canEditSale = can(user?.role, "sales:edit");
  const canDeleteSale = can(user?.role, "sales:delete");

  const handleSelectSale = React.useCallback(
    (id: string) => router.push(`/sales/${id}`),
    [router],
  );

  const handleEditSale = React.useCallback((sale: Sale) => {
    setEditingSale(sale);
  }, []);

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
                await deleteMutation.mutateAsync({ id: sale.id, idempotencyKey });
                showToast({ message: "Продажа удалена", variant: "success" });
              } catch (e) {
                if (e instanceof ApiError && e.status === 0) {
                  showToast({
                    message: "Нет соединения. Проверьте интернет и попробуйте снова.",
                    variant: "error",
                  });
                } else if (e instanceof ApiError && e.status === 404) {
                  // The mutation's onMutate already removed it from the
                  // list cache; just inform the user.
                  showToast({
                    message: "Продажа уже была удалена.",
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
    [token, deleteMutation, showToast],
  );

  const rows = React.useMemo(() => buildRows(sales), [sales]);

  const periodStats = React.useMemo(() => {
    const total = sales.reduce((s, x) => s + x.total, 0);
    return { count: sales.length, total };
  }, [sales]);

  const isFilterActive = filterCount > 0 || searchQuery.trim().length > 0;

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

  // Skeleton only on the very first load (no cached data yet); a refetch
  // — pull-to-refresh, reconnect, post-mutation — keeps the existing
  // list rendered with the subtle background spinner.
  const showSkeleton = isPending && sales.length === 0;
  const showHardError = !!error && sales.length === 0;

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="bg-white dark:bg-zinc-900 border-b border-slate-200 dark:border-zinc-800">
        <View className="flex-row items-center gap-3 px-5 pt-4 pb-3">
          <View className="flex-1 min-w-0">
            <Text className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white">
              Продажи
            </Text>
            <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5">
              {`${periodStats.count} продаж · ${fmt(periodStats.total)} ${DEFAULT_CURRENCY}`}
            </Text>
          </View>
          {isFetching && !isRefetching && sales.length > 0 && (
            <ActivityIndicator size="small" color="#94a3b8" />
          )}
          <Pressable
            onPress={() => {
              setSearchOpen((open) => {
                const next = !open;
                if (!next) setSearchQuery("");
                return next;
              });
            }}
            className={`w-9 h-9 rounded-full items-center justify-center active:opacity-70 ${
              searchOpen || searchQuery.length > 0
                ? "bg-primary-100 dark:bg-primary-900/40"
                : "bg-slate-100 dark:bg-zinc-800"
            }`}
          >
            <MaterialIcons
              name="search"
              size={20}
              color={searchOpen || searchQuery.length > 0 ? "#0a7ea4" : "#475569"}
            />
          </Pressable>
          <Pressable
            onPress={() => setFilterOpen(true)}
            className={`w-9 h-9 rounded-full items-center justify-center active:opacity-70 relative ${
              filterCount > 0
                ? "bg-primary-100 dark:bg-primary-900/40"
                : "bg-slate-100 dark:bg-zinc-800"
            }`}
          >
            <MaterialIcons
              name="filter-list"
              size={20}
              color={filterCount > 0 ? "#0a7ea4" : "#475569"}
            />
            {filterCount > 0 && (
              <View className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-primary-500 items-center justify-center px-1">
                <Text className="text-[10px] font-bold text-white">{filterCount}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {searchOpen && (
          <View className="px-5 pb-3">
            <View className="flex-row items-center gap-2 bg-slate-100 dark:bg-zinc-800 rounded-2xl px-3">
              <MaterialIcons name="search" size={18} color="#94a3b8" />
              <TextInput
                autoFocus
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Покупатель, продавец, заметка…"
                placeholderTextColor="#94a3b8"
                className="flex-1 py-2.5 text-[14px] text-slate-900 dark:text-white"
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery("")} hitSlop={8} className="p-1">
                  <MaterialIcons name="close" size={16} color="#94a3b8" />
                </Pressable>
              )}
            </View>
          </View>
        )}
      </View>

      {/* Shop picker — super_admin and multi-shop owners only */}
      {showShopPicker && (
        <View className="bg-white dark:bg-zinc-900 pt-2 pb-1 border-b border-slate-200 dark:border-zinc-800">
          <ShopPicker
            shops={shops}
            activeShopId={activeShopId}
            onChange={setActiveShopId}
          />
        </View>
      )}

      {!isOnline && (
        <View className="mx-4 mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-900/20">
          <Text className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Офлайн-режим
          </Text>
          <Text className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            Показаны сохранённые продажи. Список обновится автоматически, когда вернётся интернет.
          </Text>
        </View>
      )}

      {/* List */}
      {showSkeleton ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="mb-2.5">
              <Skeleton className="h-[88px] rounded-2xl" />
            </View>
          ))}
        </View>
      ) : showHardError ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons
            name={isOnline ? "error-outline" : "cloud-off"}
            size={48}
            color="#94a3b8"
          />
          <Text variant="h5" className="mt-4 text-center">
            {isOnline ? "Ошибка загрузки" : "Нет соединения"}
          </Text>
          <Text variant="muted" className="mt-1 text-center">
            {isOnline
              ? (error as Error)?.message ?? "Попробуйте ещё раз."
              : "Список обновится автоматически, когда вернётся интернет."}
          </Text>
          <TouchableOpacity
            onPress={() => refetch().catch(() => {})}
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
          refreshing={isRefetching}
          onRefresh={() => refetch().catch(() => {})}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage().catch(() => {});
            }
          }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            isFilterActive ? (
              <EmptyState
                icon="search-off"
                title="Ничего не найдено"
                description="Попробуйте изменить запрос или сбросить фильтры."
              />
            ) : (
              <EmptyState
                icon="receipt-long"
                title="Пока нет продаж"
                description="Запишите первую продажу — кнопка «+» в правом нижнем углу."
              />
            )
          }
          ListFooterComponent={
            isFetchingNextPage ? (
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
        token={token!}
      />

      {editingSale && token && (
        <EditSaleModal
          visible={!!editingSale}
          sale={editingSale}
          token={token}
          onClose={() => setEditingSale(null)}
          onSuccess={() => {
            // Mutation already patched the caches; nothing else to do.
            setEditingSale(null);
          }}
          onMissing={() => {
            setEditingSale(null);
            showToast({
              message: "Продажа была удалена.",
              variant: "error",
            });
          }}
        />
      )}

      <SalesFilterModal
        visible={filterOpen}
        initial={filters}
        onClose={() => setFilterOpen(false)}
        onApply={setFilters}
      />
    </SafeAreaView>
  );
}
