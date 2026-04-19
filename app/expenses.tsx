import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useRouter } from "expo-router";
import * as React from "react";
import {
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Skeleton, Text } from "@/components/ui";
import { type Expense } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuth } from "@/store/auth";

import { ExpenseCard } from "@/components/expenses/ExpenseCard";
import { ExpenseFormModal } from "@/components/expenses/ExpenseFormModal";
import { useExpenses } from "@/hooks/useExpenses";

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const { token, user } = useAuth();
  const router = useRouter();

  const {
    expenses,
    loading,
    refreshing,
    loadingMore,
    error,
    isOffline,
    handleDelete,
    handleSaved,
    handleRefresh,
    handleLoadMore,
    retryFetch,
  } = useExpenses({ token, shopId: user?.shop_id });

  const [formVisible, setFormVisible] = React.useState(false);
  const [editing, setEditing] = React.useState<Expense | null>(null);

  if (!can(user?.role, "expenses:view")) {
    return (
      <SafeAreaView className="flex-1 bg-slate-50 dark:bg-zinc-950 items-center justify-center px-8">
        <MaterialIcons name="lock" size={48} color="#94a3b8" />
        <Text variant="h5" className="mt-4 text-center">Нет доступа</Text>
        <Text variant="muted" className="mt-2 text-center">
          У вас нет прав для просмотра расходов.
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
          <Text variant="h4">Расходы</Text>
          <Text variant="muted" className="mt-0.5">
            Учёт расходов
          </Text>
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View className="flex-1 px-4 pt-4">
          {[1, 2, 3, 4].map((i) => (
            <View key={i} className="mb-3">
              <Skeleton className="h-20 rounded-2xl" />
            </View>
          ))}
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center px-8">
          <MaterialIcons name="cloud-off" size={48} color="#94a3b8" />
          <Text variant="h5" className="mt-4 text-center">Ошибка загрузки</Text>
          <Text variant="muted" className="mt-1 text-center">{error}</Text>
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
          refreshing={refreshing}
          onRefresh={handleRefresh}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            <View className="items-center justify-center py-20">
              <MaterialIcons name="account-balance-wallet" size={48} color="#94a3b8" />
              <Text variant="muted" className="mt-3 text-center">
                Расходов нет.{"\n"}Нажмите + для записи.
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator size="small" color="#0a7ea4" style={{ marginVertical: 16 }} />
            ) : null
          }
          renderItem={({ item }) => (
            <ExpenseCard
              item={item}
              onEdit={() => {
                setEditing(item);
                setFormVisible(true);
              }}
              onDelete={() => handleDelete(item.id)}
            />
          )}
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        onPress={() => {
          setEditing(null);
          setFormVisible(true);
        }}
        className="absolute bottom-8 right-6 w-14 h-14 rounded-full bg-primary-500 items-center justify-center shadow-lg active:opacity-80"
        style={{ elevation: 6 }}
      >
        <MaterialIcons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Form modal */}
      <ExpenseFormModal
        visible={formVisible}
        editing={editing}
        onClose={() => setFormVisible(false)}
        onSaved={(saved, wasEditing) => handleSaved(saved, wasEditing)}
        token={token!}
      />
    </SafeAreaView>
  );
}
