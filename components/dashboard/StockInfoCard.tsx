import * as React from "react";
import { View, TouchableOpacity } from "react-native";
import { Text, Card, CardContent } from "@/components/ui";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { fmtMoney } from "@/lib/formatters";
import { DEFAULT_CURRENCY } from "@/constants/config";

interface StockInfoCardProps {
  totalQty: number;
  totalCost: number;
  totalSalesValue: number;
  isDataHidden: boolean;
  onPress?: () => void;
}

export function StockInfoCard({
  totalQty,
  totalCost,
  totalSalesValue,
  isDataHidden,
  onPress,
}: StockInfoCardProps) {
  const hiddenText = "***";

  return (
    <Card className="flex-1">
      <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
        <CardContent className="pt-4 pb-4">
          <View className="flex-row items-center justify-between mb-3 border-b border-slate-100 dark:border-zinc-800 pb-2">
            <View className="flex-row items-center gap-2">
              <View className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 items-center justify-center">
                <MaterialIcons name="inventory-2" size={18} color="#6366f1" />
              </View>
              <Text className="font-semibold text-slate-900 dark:text-slate-50">
                Остаток товара
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
          </View>

          <View className="flex-row justify-between mb-2">
            <Text variant="small" className="text-slate-500 dark:text-slate-400">Общее кол-во:</Text>
            <Text className="font-medium text-slate-900 dark:text-slate-50">
              {isDataHidden ? hiddenText : totalQty.toLocaleString()} шт
            </Text>
          </View>
          
          <View className="flex-row justify-between mb-2">
            <Text variant="small" className="text-slate-500 dark:text-slate-400">Общая себестоимость:</Text>
            <Text className="font-medium text-amber-600 dark:text-amber-500">
              {isDataHidden ? hiddenText : `${fmtMoney(totalCost)} ${DEFAULT_CURRENCY}`}
            </Text>
          </View>

          <View className="flex-row justify-between">
            <Text variant="small" className="text-slate-500 dark:text-slate-400">Общая продажа:</Text>
            <Text className="font-medium text-primary-600 dark:text-primary-500">
              {isDataHidden ? hiddenText : `${fmtMoney(totalSalesValue)} ${DEFAULT_CURRENCY}`}
            </Text>
          </View>
        </CardContent>
      </TouchableOpacity>
    </Card>
  );
}
