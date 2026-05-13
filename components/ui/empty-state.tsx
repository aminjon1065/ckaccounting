import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Pressable, View } from "react-native";

import * as haptics from "@/lib/haptics";
import { Text } from "./text";

type EmptyTone = "neutral" | "primary" | "warning" | "destructive" | "success" | "indigo";

interface EmptyStateProps {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  /** Short headline — 2-4 words, e.g. "Пока нет продаж". */
  title: string;
  /** One-line subtitle explaining what the list shows or how to create the
   *  first item. Keep it conversational, not technical. */
  description?: string;
  /** Optional action — renders a primary button under the description.
   *  Skip when the screen already has a visible FAB for the same action. */
  action?: {
    label: string;
    onPress: () => void;
    icon?: React.ComponentProps<typeof MaterialIcons>["name"];
  };
  /** Optional tint for the icon tile. Defaults to neutral slate. */
  tone?: EmptyTone;
}

const TILE: Record<EmptyTone, { bg: string; bgDark: string; fg: string }> = {
  neutral:     { bg: "bg-slate-100",   bgDark: "dark:bg-zinc-800",        fg: "#94a3b8" },
  primary:     { bg: "bg-primary-100", bgDark: "dark:bg-primary-900/40",  fg: "#0a7ea4" },
  warning:     { bg: "bg-amber-100",   bgDark: "dark:bg-amber-900/40",    fg: "#f59e0b" },
  destructive: { bg: "bg-red-100",     bgDark: "dark:bg-red-900/40",      fg: "#ef4444" },
  success:     { bg: "bg-emerald-100", bgDark: "dark:bg-emerald-900/40",  fg: "#10b981" },
  indigo:      { bg: "bg-indigo-100",  bgDark: "dark:bg-indigo-900/40",   fg: "#6366f1" },
};

/**
 * Empty-list placeholder. Identical visual rhythm across every list screen
 * so the user gets the same "nothing here yet" signal whether they're on
 * sales, debts, expenses or purchases.
 */
export function EmptyState({ icon, title, description, action, tone = "neutral" }: EmptyStateProps) {
  const handlePress = React.useCallback(() => {
    if (!action) return;
    haptics.press();
    action.onPress();
  }, [action]);

  const t = TILE[tone];

  return (
    <View className="items-center justify-center px-8 py-16">
      <View className={`w-[88px] h-[88px] rounded-[26px] items-center justify-center mb-4 ${t.bg} ${t.bgDark}`}>
        <MaterialIcons name={icon} size={42} color={t.fg} />
      </View>
      <Text className="font-heading text-[20px] tracking-tight text-slate-900 dark:text-white text-center">
        {title}
      </Text>
      {description ? (
        <Text className="text-[13.5px] text-slate-500 dark:text-zinc-400 mt-2 text-center max-w-[300px] leading-[20px]">
          {description}
        </Text>
      ) : null}
      {action ? (
        <Pressable
          onPress={handlePress}
          className="mt-5 flex-row items-center gap-2 bg-primary-500 px-5 py-2.5 rounded-xl active:opacity-80"
        >
          {action.icon ? <MaterialIcons name={action.icon} size={18} color="#fff" /> : null}
          <Text className="text-[14px] font-semibold text-white">{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
