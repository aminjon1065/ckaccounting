import * as React from "react";
import { Pressable, View, ScrollView } from "react-native";
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
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 6 }}
      >
        {PERIODS.map((p) => {
          const active = value === p.key;
          return (
            <Pressable
              key={p.key}
              onPress={() => onChange(p.key)}
              className={`px-3.5 py-1.5 rounded-full border active:opacity-80 ${
                active
                  ? "bg-primary-500 border-primary-500"
                  : "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800"
              }`}
            >
              <Text
                className={`text-[13px] font-semibold ${
                  active ? "text-white" : "text-slate-700 dark:text-zinc-300"
                }`}
              >
                {p.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
