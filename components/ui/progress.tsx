import * as React from "react";
import { View, Text, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";

interface ProgressProps extends ViewProps {
  value: number;       // 0–100
  max?: number;
  label?: string;
  showValue?: boolean;
  color?: "primary" | "success" | "warning" | "destructive";
}

const barColors: Record<NonNullable<ProgressProps["color"]>, string> = {
  primary: "#0a7ea4",
  success: "#22c55e",
  warning: "#f59e0b",
  destructive: "#ef4444",
};

function Progress({
  className,
  value,
  max = 100,
  label,
  showValue = false,
  color = "primary",
  ...props
}: ProgressProps) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <View className={cn("gap-1.5", className)} {...props}>
      {(label || showValue) && (
        <View className="flex-row justify-between items-center">
          {label && (
            <Text className="text-xs font-medium text-slate-600 dark:text-slate-400">
              {label}
            </Text>
          )}
          {showValue && (
            <Text className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {Math.round(pct)}%
            </Text>
          )}
        </View>
      )}
      <View className="h-2 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden">
        <View
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            backgroundColor: barColors[color],
          }}
        />
      </View>
    </View>
  );
}

export { Progress };
export type { ProgressProps };
