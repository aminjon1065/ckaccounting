import * as React from "react";
import { View, Text, type ViewProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "rounded-xl border p-4 gap-1",
  {
    variants: {
      variant: {
        default:
          "border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900",
        destructive:
          "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20",
        success:
          "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20",
        warning:
          "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20",
        info:
          "border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-blue-900/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const alertTitleVariants = cva("text-sm font-semibold", {
  variants: {
    variant: {
      default: "text-slate-900 dark:text-slate-50",
      destructive: "text-red-700 dark:text-red-400",
      success: "text-green-700 dark:text-green-400",
      warning: "text-amber-700 dark:text-amber-400",
      info: "text-primary-500 dark:text-blue-400",
    },
  },
  defaultVariants: { variant: "default" },
});

const alertDescriptionVariants = cva("text-sm", {
  variants: {
    variant: {
      default: "text-slate-600 dark:text-slate-400",
      destructive: "text-red-600 dark:text-red-300",
      success: "text-green-600 dark:text-green-300",
      warning: "text-amber-600 dark:text-amber-300",
      info: "text-primary-500 dark:text-blue-300",
    },
  },
  defaultVariants: { variant: "default" },
});

interface AlertProps extends ViewProps, VariantProps<typeof alertVariants> {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
}

function Alert({ className, variant, title, description, icon, children, ...props }: AlertProps) {
  return (
    <View className={cn(alertVariants({ variant }), className)} {...props}>
      {(icon || title) && (
        <View className="flex-row items-center gap-2">
          {icon}
          {title && (
            <Text className={cn(alertTitleVariants({ variant }))}>{title}</Text>
          )}
        </View>
      )}
      {description && (
        <Text className={cn(alertDescriptionVariants({ variant }))}>
          {description}
        </Text>
      )}
      {children}
    </View>
  );
}

export { Alert };
export type { AlertProps };
