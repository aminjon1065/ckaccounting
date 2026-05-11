import * as React from "react";
import { View, TouchableOpacity } from "react-native";
import { Text, Card, CardContent } from "@/components/ui";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DEFAULT_CURRENCY } from "@/constants/config";
import { fmt as fmtNumber } from "@/lib/formatters";

interface DebtsCardProps {
  receivables: number;
  payables: number;
  isDataHidden?: boolean;
  onPress?: () => void;
}

function fmt(n: number, hidden: boolean) {
  if (hidden) return "***";
  return fmtNumber(n);
}

export function DebtsCard({
  receivables,
  payables,
  isDataHidden = false,
  onPress,
}: DebtsCardProps) {
  const content = (
    <CardContent className="pt-4 pb-4">
      <View className="flex-row items-center justify-between mb-3 border-b border-slate-100 dark:border-zinc-800 pb-2">
        <View className="flex-row items-center gap-2">
          <View className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 items-center justify-center">
            <MaterialIcons name="account-balance-wallet" size={18} color="#10b981" />
          </View>
          <Text className="font-semibold text-slate-900 dark:text-slate-50">
            Баланс долгов
          </Text>
        </View>
        {onPress ? (
          <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
        ) : null}
      </View>

      <View className="flex-row justify-between mb-2">
        <Text variant="small" className="text-slate-500 dark:text-slate-400">Нам должны:</Text>
        <Text className="font-medium text-green-600">
          {isDataHidden ? "***" : `${fmt(receivables, false)} ${DEFAULT_CURRENCY}`}
        </Text>
      </View>

      <View className="flex-row justify-between">
        <Text variant="small" className="text-slate-500 dark:text-slate-400">Мы должны:</Text>
        <Text className="font-medium text-red-500">
          {isDataHidden ? "***" : `${fmt(payables, false)} ${DEFAULT_CURRENCY}`}
        </Text>
      </View>
    </CardContent>
  );

  return (
    <Card className="flex-1">
      {onPress ? (
        <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
          {content}
        </TouchableOpacity>
      ) : (
        content
      )}
    </Card>
  );
}
