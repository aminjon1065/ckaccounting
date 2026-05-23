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
  "rounded-2xl p-3.5 gap-2.5 border",
  {
    variants: {
      variant: {
        default:     "bg-white dark:bg-zinc-900 border-slate-200 dark:border-zinc-800",
        primary:     "bg-blue-600 dark:bg-blue-700 border-blue-700 dark:border-blue-800",
        success:     "bg-emerald-600 dark:bg-emerald-700 border-emerald-700 dark:border-emerald-800",
        warning:     "bg-amber-500 dark:bg-amber-600 border-amber-600 dark:border-amber-700",
        destructive: "bg-red-600 dark:bg-red-700 border-red-700 dark:border-red-800",
        indigo:      "bg-indigo-600 dark:bg-indigo-700 border-indigo-700 dark:border-indigo-800",
        emerald:     "bg-emerald-600 dark:bg-emerald-700 border-emerald-700 dark:border-emerald-800",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type Tone = "primary" | "success" | "warning" | "destructive" | "indigo" | "emerald" | "default";

const TONE: Record<Tone, { bg: string; bgDark: string; fg: string }> = {
  primary:     { bg: "bg-white/20",       bgDark: "dark:bg-white/15",       fg: "#ffffff" },
  success:     { bg: "bg-white/20",       bgDark: "dark:bg-white/15",       fg: "#ffffff" },
  warning:     { bg: "bg-white/25",       bgDark: "dark:bg-white/15",       fg: "#ffffff" },
  destructive: { bg: "bg-white/20",       bgDark: "dark:bg-white/15",       fg: "#ffffff" },
  indigo:      { bg: "bg-white/20",       bgDark: "dark:bg-white/15",       fg: "#ffffff" },
  emerald:     { bg: "bg-white/20",       bgDark: "dark:bg-white/15",       fg: "#ffffff" },
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
  const isColored = tone !== "default";
  const titleClass = isColored
    ? "text-[12px] font-medium text-white/85 flex-1"
    : "text-[12px] font-medium text-slate-500 dark:text-zinc-400 flex-1";
  const valueClass = isColored
    ? "font-heading text-[18px] leading-[20px] tracking-tight text-white"
    : "font-heading text-[18px] leading-[20px] tracking-tight text-slate-900 dark:text-white";
  const subTextClass = isColored
    ? "text-[11px] font-medium text-white/80"
    : "text-[11px] font-medium text-slate-500 dark:text-zinc-400";
  const subtitleClass = isColored
    ? "text-[11px] text-white/80"
    : "text-[11px] text-slate-500 dark:text-zinc-400";
  const deltaSign = delta != null ? (delta >= 0 ? "+" : "") : null;
  const deltaColor = isColored
    ? "#ffffff"
    : delta != null && delta >= 0
      ? "#16a34a"
      : "#ef4444";

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
          className={titleClass}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>

      {/* Value */}
      <View className="flex-row items-baseline gap-1">
        <Text
          className={valueClass}
          style={{ fontVariantLigatures: "none" }}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </Text>
        {currency && (
          <Text className={subTextClass}>
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
            <Text className={subtitleClass} numberOfLines={1}>
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
