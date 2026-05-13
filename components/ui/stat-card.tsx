import * as React from "react";
import { View, Text, type ViewProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

// Tone drives the small icon chip's color only — the card body stays neutral
// so the dashboard's stat row reads as a single grid of equal-weight tiles
// (per the design). Old colored-bleed variants are kept for back-compat but
// no new code should use them.
const statCardVariants = cva(
  "rounded-2xl p-3.5 gap-2.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800",
  {
    variants: {
      variant: {
        default: "",
        primary: "",
        success: "",
        warning: "",
        destructive: "",
        indigo: "",
        emerald: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type Tone = "primary" | "success" | "warning" | "destructive" | "indigo" | "emerald" | "default";

const TONE: Record<Tone, { bg: string; bgDark: string; fg: string }> = {
  primary:     { bg: "bg-primary-100",    bgDark: "dark:bg-primary-900/40", fg: "#0a7ea4" },
  success:     { bg: "bg-success-100",    bgDark: "dark:bg-emerald-900/40", fg: "#16a34a" },
  warning:     { bg: "bg-warning-100",    bgDark: "dark:bg-amber-900/40",   fg: "#f59e0b" },
  destructive: { bg: "bg-red-100",        bgDark: "dark:bg-red-900/40",     fg: "#ef4444" },
  indigo:      { bg: "bg-indigo-100",     bgDark: "dark:bg-indigo-900/40",  fg: "#6366f1" },
  emerald:     { bg: "bg-emerald-100",    bgDark: "dark:bg-emerald-900/40", fg: "#10b981" },
  default:     { bg: "bg-slate-100",      bgDark: "dark:bg-zinc-800",       fg: "#64748b" },
};

interface StatCardProps extends ViewProps, VariantProps<typeof statCardVariants> {
  title: string;
  /** Display string — caller formats numbers/currency. Pass "***" for hidden. */
  value: string;
  /** Sub-line text (e.g. "53% от выручки"). Mutually exclusive with delta. */
  subtitle?: string;
  /** Signed percent change for the sub-line. Positive = green up, negative = red down. */
  delta?: number;
  iconName?: React.ComponentProps<typeof MaterialIcons>["name"];
  /** Currency suffix rendered after the value with subdued styling. */
  currency?: string;
}

function StatCard({
  className,
  variant,
  title,
  value,
  subtitle,
  delta,
  iconName,
  currency,
  ...props
}: StatCardProps) {
  const tone: Tone = (variant ?? "default") as Tone;
  const t = TONE[tone] ?? TONE.default;
  const deltaSign = delta != null ? (delta >= 0 ? "+" : "") : null;
  const deltaColor = delta != null && delta >= 0 ? "#16a34a" : "#ef4444";

  return (
    <View className={cn(statCardVariants({ variant }), className)} {...props}>
      {/* Header row: icon chip + title */}
      <View className="flex-row items-center gap-2">
        {iconName && (
          <View className={cn("w-7 h-7 rounded-lg items-center justify-center", t.bg, t.bgDark)}>
            <MaterialIcons name={iconName} size={16} color={t.fg} />
          </View>
        )}
        <Text
          className="text-[12px] font-medium text-slate-500 dark:text-zinc-400 flex-1"
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>

      {/* Value */}
      <View className="flex-row items-baseline gap-1">
        <Text
          className="font-heading text-[18px] leading-[20px] tracking-tight text-slate-900 dark:text-white"
          style={{ fontVariantLigatures: "none" }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </Text>
        {currency && (
          <Text className="text-[11px] font-medium text-slate-500 dark:text-zinc-400">
            {currency}
          </Text>
        )}
      </View>

      {/* Delta / subtitle */}
      {(delta != null || subtitle) && (
        <View className="flex-row items-center gap-1">
          {delta != null && (
            <View className="flex-row items-center gap-0.5">
              <MaterialIcons
                name={delta >= 0 ? "trending-up" : "trending-down"}
                size={12}
                color={deltaColor}
              />
              <Text className="text-[11px] font-semibold" style={{ color: deltaColor }}>
                {deltaSign}{delta}%
              </Text>
            </View>
          )}
          {subtitle && (
            <Text className="text-[11px] text-slate-500 dark:text-zinc-400" numberOfLines={1}>
              {delta != null ? `· ${subtitle}` : subtitle}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

export { StatCard };
export type { StatCardProps };
