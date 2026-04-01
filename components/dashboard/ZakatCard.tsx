import * as React from "react";
import { View } from "react-native";
import { Text, Card, CardContent } from "@/components/ui";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { fmtMoney } from "@/lib/formatters";
import { DEFAULT_CURRENCY } from "@/constants/config";

interface ZakatCardProps {
  totalCost: number;
  receivables: number;
  payables: number;
  isDataHidden: boolean;
}

export function ZakatCard({
  totalCost,
  receivables,
  payables,
  isDataHidden,
}: ZakatCardProps) {
  const zakatValue = (totalCost + receivables - payables) * 0.025;
  // Ensure we don't show negative zakat
  const displayValue = Math.max(0, zakatValue);

  return (
    <Card className="flex-1 border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-none">
      <CardContent className="flex-1 p-3 items-center justify-center">
        <View className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 items-center justify-center mb-3">
          <MaterialIcons name="volunteer-activism" size={20} color="#10b981" />
        </View>
        <Text variant="small" className="text-emerald-800 dark:text-emerald-400 font-medium mb-1 text-center">
          Закят 2.5%
        </Text>
        <View className="items-center mt-2">
          <Text className="text-xl font-bold text-emerald-700 dark:text-emerald-400 text-center">
            {isDataHidden ? "***" : `${fmtMoney(displayValue)}`}
          </Text>
          <Text className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">{DEFAULT_CURRENCY}</Text>
        </View>
      </CardContent>
    </Card>
  );
}
