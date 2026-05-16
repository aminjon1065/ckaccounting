import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFocusEffect, useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState, FAB, Skeleton, Text } from "@/components/ui";
import { type Expense } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuth } from "@/store/auth";

import { ExpenseCard } from "@/components/expenses/ExpenseCard";
import { ExpenseFormModal } from "@/components/expenses/ExpenseFormModal";
import { useExpenses } from "@/hooks/useExpenses";
import { fmt } from "@/lib/formatters";
import { DEFAULT_CURRENCY } from "@/constants/config";

// ─── Main screen ─────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const { token, user } = useAuth();
  const router = useRouter();

  const {
    expenses,
    loading,
    refreshing,
    loadingMore,
    error,
    handleDelete,
    handleSaved,
    handleRefresh,
    handleLoadMore,
    dropLocalExpense,
    retryFetch,
  } = useExpenses({ token, user });

  const [formVisible, setFormVisible] = React.useState(false);
  const [editing, setEditing] = React.useState<Expense | null>(null);

  // Refresh when returning to the screen so external mutations (other
  // device, role with edit access on detail) reflect immediately.
  const isFirstFocusRef = React.useRef(true);
  useFocusEffect(
    React.useCallback(() => {
      if (isFirstFocusRef.current) {
        isFirstFocusRef.current = false;
        return;
      }
      handleRefresh();
    }, [handleRefresh]),
  );

  const handleEditExpense = React.useCallback((expense: Expense) => {
    setEditing(expense);
    setFormVisible(true);
  }, []);
  const renderExpense = React.useCallback(
    ({ item }: { item: Expense }) => (
      <ExpenseCard item={item} onEdit={handleEditExpense} onDelete={handleDelete} />
    ),
    [handleEditExpense, handleDelete],
  );

  // Current month name + total for the summary card.
  const monthLabel = React.useMemo(() => {
    const now = new Date();
    return now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  }, []);
  const stats = React.useMemo(() => {
    const total = expenses.reduce((s, e) => s + e.total, 0);
    return { total, count: expenses.length };
  }, [expenses]);

  if (!can(user?.role, "expenses:view")) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons name="lock" size={48} color="#94a3b8" />
        <Text variant="h5" className="mt-4 text-center">
          Нет доступа
        </Text>
        <Text variant="muted" className="mt-2 text-center">
          У вас нет прав для просмотра расходов.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950">
      {/* Header */}
      <View className="flex-row items-center gap-2 px-4 pt-4 pb-3">
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          className="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 items-center justify-center active:opacity-70"
        >
          <MaterialIcons name="arrow-back" size={20} color="#475569" />
        </Pressable>
        <View className="flex-1">
          <Text className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white">
            Расходы
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5 capitalize">
            {monthLabel}
          </Text>
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 px-4 pt-2">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="mb-2.5">
              <Skeleton className="h-[72px] rounded-2xl" />
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
          data={expenses}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            expenses.length > 0 ? (
              <View className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-2xl p-3.5 mb-3 flex-row items-center gap-3">
                <View className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/40 items-center justify-center">
                  <MaterialIcons name="account-balance-wallet" size={20} color="#ef4444" />
                </View>
                <View className="flex-1">
                  <Text className="text-[12px] text-red-800/80 dark:text-red-300/80">
                    {stats.count} операций
                  </Text>
                  <Text
                    className="font-heading text-[18px] tracking-tight text-red-600 dark:text-red-300"
                    style={{ fontVariantLigatures: "none" }}
                  >
                    − {fmt(stats.total)} {DEFAULT_CURRENCY}
                  </Text>
                </View>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="account-balance-wallet"
              title="Расходов пока нет"
              description="Запишите первый расход — кнопка «+» в правом нижнем углу."
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
          renderItem={renderExpense}
        />
      )}

      {can(user?.role, "expenses:create") && (
        <FAB
          onPress={() => {
            setEditing(null);
            setFormVisible(true);
          }}
        />
      )}

      <ExpenseFormModal
        visible={formVisible}
        editing={editing}
        onClose={() => setFormVisible(false)}
        onSaved={(saved, wasEditing) => handleSaved(saved, wasEditing)}
        onMissing={(id) => {
          dropLocalExpense(id).catch(() => {});
        }}
        token={token!}
      />
    </SafeAreaView>
  );
}
