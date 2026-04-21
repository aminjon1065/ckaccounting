import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui";

interface DebtsCardProps {
  receivables: number;
  payables: number;
  isDataHidden?: boolean;
}

function fmt(n: number, hidden: boolean) {
  if (hidden) return "***";
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function DebtsCard({
  receivables,
  payables,
  isDataHidden = false,
}: DebtsCardProps) {
  const netDebt = receivables - payables;

  return (
    <View className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800 p-4 flex-1 justify-center">
      <View className="items-center mb-3">
        <Text variant="small" className="mb-1">Баланс долгов</Text>
        <Text
          className={`text-2xl font-bold ${
            netDebt > 0 ? "text-green-600" : netDebt < 0 ? "text-red-500" : "text-slate-900 dark:text-slate-50"
          }`}
        >
          {isDataHidden ? "***" : netDebt > 0 ? `+${fmt(netDebt, false)}` : fmt(netDebt, false)}
        </Text>
      </View>

      <View className="h-[1px] bg-slate-100 dark:bg-zinc-800 w-full mb-3" />

      <View className="flex-row items-center divide-x divide-slate-100 dark:divide-zinc-800">
        <View className="flex-1 items-center px-1">
          <Text variant="small" className="text-center mb-1 leading-tight">Нам должны</Text>
          <Text className="text-base font-semibold text-green-600">
            {fmt(receivables, isDataHidden)}
          </Text>
        </View>
        <View className="flex-1 items-center px-1">
          <Text variant="small" className="text-center mb-1 leading-tight">Мы должны</Text>
          <Text className="text-base font-semibold text-red-500">
            {fmt(payables, isDataHidden)}
          </Text>
        </View>
      </View>
    </View>
  );
}
