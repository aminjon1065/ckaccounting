import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { View, type ViewProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { Text } from "./text";

const alertVariants = cva("rounded-2xl border p-3.5 flex-row gap-3", {
  variants: {
    variant: {
      default: "border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900",
      destructive: "border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20",
      success: "border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/20",
      warning: "border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/20",
      info: "border-primary-200 dark:border-primary-900/40 bg-primary-50 dark:bg-primary-900/20",
    },
  },
  defaultVariants: { variant: "default" },
});

const titleVariants = cva("text-[14px] font-semibold tracking-tight", {
  variants: {
    variant: {
      default: "text-slate-900 dark:text-white",
      destructive: "text-red-700 dark:text-red-300",
      success: "text-emerald-700 dark:text-emerald-300",
      warning: "text-amber-800 dark:text-amber-300",
      info: "text-primary-700 dark:text-primary-300",
    },
  },
  defaultVariants: { variant: "default" },
});

const descriptionVariants = cva("text-[12.5px] mt-1 leading-[18px]", {
  variants: {
    variant: {
      default: "text-slate-600 dark:text-zinc-400",
      destructive: "text-red-600 dark:text-red-300/80",
      success: "text-emerald-700 dark:text-emerald-300/80",
      warning: "text-amber-700 dark:text-amber-300/80",
      info: "text-primary-700 dark:text-primary-300/80",
    },
  },
  defaultVariants: { variant: "default" },
});

const tileVariants = cva("w-9 h-9 rounded-[10px] items-center justify-center shrink-0", {
  variants: {
    variant: {
      default: "bg-slate-100 dark:bg-zinc-800",
      destructive: "bg-red-100 dark:bg-red-900/40",
      success: "bg-emerald-100 dark:bg-emerald-900/40",
      warning: "bg-amber-100 dark:bg-amber-900/40",
      info: "bg-primary-100 dark:bg-primary-900/40",
    },
  },
  defaultVariants: { variant: "default" },
});

const DEFAULT_ICON: Record<NonNullable<VariantProps<typeof alertVariants>["variant"]>, React.ComponentProps<typeof MaterialIcons>["name"]> = {
  default: "info-outline",
  destructive: "error-outline",
  success: "check-circle",
  warning: "warning-amber",
  info: "info-outline",
};

const ICON_COLOR: Record<NonNullable<VariantProps<typeof alertVariants>["variant"]>, string> = {
  default: "#64748b",
  destructive: "#ef4444",
  success: "#10b981",
  warning: "#f59e0b",
  info: "#0a7ea4",
};

interface AlertProps extends ViewProps, VariantProps<typeof alertVariants> {
  title?: string;
  description?: string;
  /** Override the icon. If a ReactNode is passed it replaces the entire tile;
   *  if a MaterialIcons name string is passed it's drawn into the variant tile. */
  icon?: React.ReactNode | React.ComponentProps<typeof MaterialIcons>["name"];
  /** Hide the icon tile entirely (rare — used when the alert is purely textual). */
  hideIcon?: boolean;
}

function Alert({
  className,
  variant,
  title,
  description,
  icon,
  hideIcon,
  children,
  ...props
}: AlertProps) {
  const v = (variant ?? "default") as NonNullable<VariantProps<typeof alertVariants>["variant"]>;
  // Caller may pass a ReactNode (custom icon) or just a string (MaterialIcons
  // name). The string form is the easiest call-site — keeps the icon palette
  // consistent with the alert's variant by routing through the variant tile.
  const renderIcon = () => {
    if (hideIcon) return null;
    if (React.isValidElement(icon)) {
      return <View className={cn(tileVariants({ variant: v }))}>{icon}</View>;
    }
    const iconName = typeof icon === "string" ? icon : DEFAULT_ICON[v];
    return (
      <View className={cn(tileVariants({ variant: v }))}>
        <MaterialIcons name={iconName as any} size={18} color={ICON_COLOR[v]} />
      </View>
    );
  };

  return (
    <View className={cn(alertVariants({ variant }), className)} {...props}>
      {renderIcon()}
      <View className="flex-1 min-w-0">
        {title && (
          <Text className={cn(titleVariants({ variant }))} numberOfLines={2}>
            {title}
          </Text>
        )}
        {description && (
          <Text className={cn(descriptionVariants({ variant }))}>{description}</Text>
        )}
        {children}
      </View>
    </View>
  );
}

export { Alert };
export type { AlertProps };
