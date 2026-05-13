import * as React from "react";
import { View, Pressable } from "react-native";
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
    <View className="px-5 mb-5">
      {/* Primary row: "Записать продажу" — wide, prominent */}
      <Pressable
        onPress={onAddSale}
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl flex-row items-center gap-3 px-4 py-3.5 mb-2.5 active:opacity-80"
      >
        <View className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/40 items-center justify-center">
          <MaterialIcons name="point-of-sale" size={22} color="#3b82f6" />
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-bold text-slate-900 dark:text-white tracking-tight">
            Записать продажу
          </Text>
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-px">
            Товары или услуги · 2 шага
          </Text>
        </View>
        <MaterialIcons name="add" size={22} color="#94a3b8" />
      </Pressable>

      {/* Secondary row: stacked-label tiles (owner/admin only) */}
      {showBottomRow && (
        <View className="flex-row gap-2.5">
          {canAddPurchase && (
            <Pressable
              onPress={onAddPurchase}
              className="flex-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl py-3.5 px-3 gap-2 active:opacity-80"
            >
              <View className="w-8 h-8 rounded-[10px] bg-emerald-100 dark:bg-emerald-900/40 items-center justify-center">
                <MaterialIcons name="inventory" size={18} color="#10b981" />
              </View>
              <Text className="text-[13px] font-semibold text-slate-900 dark:text-white leading-4">
                Приход{"\n"}товара
              </Text>
            </Pressable>
          )}
          {canAddExpense && (
            <Pressable
              onPress={onAddExpense}
              className="flex-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-2xl py-3.5 px-3 gap-2 active:opacity-80"
            >
              <View className="w-8 h-8 rounded-[10px] bg-red-100 dark:bg-red-900/40 items-center justify-center">
                <MaterialIcons name="account-balance-wallet" size={18} color="#ef4444" />
              </View>
              <Text className="text-[13px] font-semibold text-slate-900 dark:text-white leading-4">
                Добавить{"\n"}расход
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
