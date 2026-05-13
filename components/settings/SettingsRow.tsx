import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui";

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];
type IconTone = "primary" | "neutral" | "success" | "warning" | "destructive";

interface SettingsRowProps {
  icon: IconName;
  label: string;
  description?: string;
  onPress?: () => void;
  /** Renders the row in destructive style — red text + red icon tile, no chevron. */
  destructive?: boolean;
  /** Trailing text (e.g. "Изменить", "Русский", "5 мин"). */
  rightText?: string;
  /** Optional trailing badge (notification count, status pill). */
  badge?: React.ReactNode;
  /** Override icon background colour. Defaults to neutral slate. */
  iconTone?: IconTone;
  /** Drop the divider after this row (last row in a group). */
  last?: boolean;
}

const ICON_TILE: Record<IconTone, { bg: string; bgDark: string; fg: string }> = {
  primary:     { bg: "bg-primary-100",  bgDark: "dark:bg-primary-900/40",  fg: "#0a7ea4" },
  neutral:     { bg: "bg-slate-100",    bgDark: "dark:bg-zinc-800",        fg: "#475569" },
  success:     { bg: "bg-emerald-100",  bgDark: "dark:bg-emerald-900/40",  fg: "#10b981" },
  warning:     { bg: "bg-amber-100",    bgDark: "dark:bg-amber-900/40",    fg: "#f59e0b" },
  destructive: { bg: "bg-red-100",      bgDark: "dark:bg-red-900/40",      fg: "#ef4444" },
};

export function SettingsRow({
  icon,
  label,
  description,
  onPress,
  destructive,
  rightText,
  badge,
  iconTone,
  last,
}: SettingsRowProps) {
  // Destructive overrides any explicit iconTone.
  const tone: IconTone = destructive ? "destructive" : iconTone ?? "neutral";
  const t = ICON_TILE[tone];
  const labelClass = destructive
    ? "text-red-500"
    : "text-slate-900 dark:text-white";

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      className={`flex-row items-center gap-3 px-3.5 py-3 ${
        last ? "" : "border-b border-slate-100 dark:border-zinc-800"
      } ${onPress ? "active:bg-slate-50 dark:active:bg-zinc-800" : ""}`}
    >
      <View className={`w-9 h-9 rounded-[10px] items-center justify-center ${t.bg} ${t.bgDark}`}>
        <MaterialIcons name={icon} size={18} color={t.fg} />
      </View>
      <View className="flex-1 min-w-0">
        <Text className={`text-[14.5px] font-medium ${labelClass}`} numberOfLines={1}>
          {label}
        </Text>
        {description && (
          <Text className="text-[12px] text-slate-500 dark:text-zinc-400 mt-0.5" numberOfLines={1}>
            {description}
          </Text>
        )}
      </View>
      {rightText && (
        <Text className="text-[13px] text-slate-500 dark:text-zinc-400 mr-1">
          {rightText}
        </Text>
      )}
      {badge}
      {!destructive && onPress && (
        <MaterialIcons name="chevron-right" size={18} color="#94a3b8" />
      )}
    </Pressable>
  );
}
