import * as React from "react";
import { View, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { can, type Role } from "@/lib/permissions";

interface QuickActionsProps {
  onAddSale: () => void;
  onAddPurchase: () => void;
  onAddExpense: () => void;
  userRole?: string;
}

export function QuickActions({
  onAddSale,
  onAddPurchase,
  onAddExpense,
  userRole,
}: QuickActionsProps) {
  const role = userRole as Role | undefined;
  const canAddPurchase = can(role, "purchases:create");
  const canAddExpense = can(role, "expenses:create");
  const showBottomRow = canAddPurchase || canAddExpense;

  return (
    <View className="px-5 mb-6">
      {/* Top Wide Button -> Sales */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onAddSale}
        className="bg-white dark:bg-zinc-900 border border-slate-100 dark:border-zinc-800 rounded-2xl flex-row items-center justify-center py-4 mb-3 shadow-sm"
      >
        <MaterialIcons name="point-of-sale" size={24} color="#3b82f6" className="mr-2" />
        <View className="items-center ml-2">
          <Text className="text-base font-bold text-slate-900 dark:text-slate-50">Продажа</Text>
          <Text variant="small">Товар и услуг</Text>
        </View>
      </TouchableOpacity>

      {/* Bottom Row -> Purchases & Expenses (owner/admin only) */}
      {showBottomRow && (
        <View className="flex-row gap-3">
          {canAddPurchase && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={onAddPurchase}
              className="flex-1 bg-white dark:bg-zinc-900 border border-slate-100 dark:border-zinc-800 rounded-2xl flex-row items-center justify-center py-4 shadow-sm"
            >
              <MaterialIcons name="inventory" size={20} color="#10b981" />
              <Text className="ml-2 font-semibold text-slate-900 dark:text-slate-50">Приход Товар</Text>
            </TouchableOpacity>
          )}

          {canAddExpense && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={onAddExpense}
              className="flex-1 bg-white dark:bg-zinc-900 border border-slate-100 dark:border-zinc-800 rounded-2xl flex-row items-center justify-center py-4 shadow-sm"
            >
              <MaterialIcons name="account-balance-wallet" size={20} color="#ef4444" />
              <Text className="ml-2 font-semibold text-slate-900 dark:text-slate-50">Добавить расход</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
