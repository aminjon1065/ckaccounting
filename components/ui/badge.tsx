import * as React from "react";
import { View, Text, type ViewProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "flex-row items-center self-start rounded-full px-2.5 py-0.5",
  {
    variants: {
      variant: {
        default: "bg-primary-500",
        secondary: "bg-slate-100 dark:bg-zinc-800",
        destructive: "bg-red-100 dark:bg-red-900/30",
        success: "bg-green-100 dark:bg-green-900/30",
        warning: "bg-amber-100 dark:bg-amber-900/30",
        outline:
          "border border-slate-200 dark:border-zinc-700 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const badgeTextVariants = cva("text-xs font-medium", {
  variants: {
    variant: {
      default: "text-white",
      secondary: "text-slate-700 dark:text-slate-300",
      destructive: "text-red-700 dark:text-red-400",
      success: "text-green-700 dark:text-green-400",
      warning: "text-amber-700 dark:text-amber-400",
      outline: "text-slate-700 dark:text-slate-300",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface BadgeProps extends ViewProps, VariantProps<typeof badgeVariants> {
  children: React.ReactNode;
}

function Badge({ className, variant, children, ...props }: BadgeProps) {
  return (
    <View className={cn(badgeVariants({ variant }), className)} {...props}>
      {typeof children === "string" ? (
        <Text className={cn(badgeTextVariants({ variant }))}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}

export { Badge, badgeVariants };
export type { BadgeProps };
