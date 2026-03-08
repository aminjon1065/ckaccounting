import * as React from "react";
import { View, Text, type ViewProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

const statCardVariants = cva(
  "rounded-2xl p-4 gap-3",
  {
    variants: {
      variant: {
        default: "bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800",
        primary: "bg-primary-500",
        success: "bg-success",
        warning: "bg-warning",
        destructive: "bg-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

type TrendDirection = "up" | "down" | "neutral";

interface StatCardProps extends ViewProps, VariantProps<typeof statCardVariants> {
  title: string;
  value: string;
  subtitle?: string;
  trend?: TrendDirection;
  trendLabel?: string;
  iconName?: React.ComponentProps<typeof MaterialIcons>["name"];
}

const trendConfig: Record<
  TrendDirection,
  { icon: React.ComponentProps<typeof MaterialIcons>["name"]; color: string; text: string }
> = {
  up: { icon: "arrow-upward", color: "#22c55e", text: "text-green-500" },
  down: { icon: "arrow-downward", color: "#ef4444", text: "text-red-500" },
  neutral: { icon: "remove", color: "#94a3b8", text: "text-slate-400" },
};

function StatCard({
  className,
  variant,
  title,
  value,
  subtitle,
  trend,
  trendLabel,
  iconName,
  ...props
}: StatCardProps) {
  const isColored = variant && variant !== "default";
  const textColor = isColored ? "text-white" : "text-slate-900 dark:text-slate-50";
  const mutedColor = isColored ? "text-white/70" : "text-slate-500 dark:text-slate-400";
  const iconColor = isColored ? "#ffffff99" : "#0a7ea4";

  return (
    <View className={cn(statCardVariants({ variant }), className)} {...props}>
      {/* Header row */}
      <View className="flex-row items-center justify-between">
        <Text className={cn("text-sm font-medium", mutedColor)}>{title}</Text>
        {iconName && (
          <View
            className={cn(
              "w-9 h-9 rounded-xl items-center justify-center",
              isColored ? "bg-white/20" : "bg-primary-50 dark:bg-blue-900/30"
            )}
          >
            <MaterialIcons name={iconName} size={18} color={iconColor} />
          </View>
        )}
      </View>

      {/* Value */}
      <Text
        className={cn("text-2xl font-bold tracking-tight", textColor)}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>

      {/* Trend / subtitle */}
      {(trend || subtitle) && (
        <View className="flex-row items-center gap-1">
          {trend && (
            <>
              <MaterialIcons
                name={trendConfig[trend].icon}
                size={14}
                color={isColored ? "#ffffff" : trendConfig[trend].color}
              />
              {trendLabel && (
                <Text
                  className={cn(
                    "text-xs font-medium",
                    isColored ? "text-white/90" : trendConfig[trend].text
                  )}
                >
                  {trendLabel}
                </Text>
              )}
            </>
          )}
          {subtitle && !trendLabel && (
            <Text className={cn("text-xs", mutedColor)}>{subtitle}</Text>
          )}
          {subtitle && trendLabel && (
            <Text className={cn("text-xs", mutedColor)}> · {subtitle}</Text>
          )}
        </View>
      )}
    </View>
  );
}

export { StatCard };
export type { StatCardProps };
