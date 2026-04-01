import * as React from "react";
import { TouchableOpacity, View, ScrollView } from "react-native";
import { Text } from "@/components/ui";
import { type DashboardPeriod } from "@/lib/api";

const PERIODS: { key: DashboardPeriod; label: string }[] = [
  { key: "day", label: "Сегодня" },
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "year", label: "Год" },
  { key: "custom", label: "Период" },
];

export function PeriodFilter({
  value,
  onChange,
}: {
  value: DashboardPeriod;
  onChange: (p: DashboardPeriod) => void;
}) {
  return (
    <View>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false} 
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12, gap: 8 }}
      >
        {PERIODS.map((p) => {
          const active = value === p.key;
          return (
            <TouchableOpacity
              key={p.key}
              onPress={() => onChange(p.key)}
              className={`px-4 py-1.5 rounded-full border ${
                active
                  ? "bg-primary-500 border-primary-500"
                  : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-700"
              }`}
            >
              <Text
                className={`text-sm font-medium ${
                  active ? "text-white" : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
