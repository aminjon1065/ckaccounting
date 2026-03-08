import * as React from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
} from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "flex-row items-center justify-center gap-2 rounded-xl",
  {
    variants: {
      variant: {
        default: "bg-primary-500 active:opacity-75",
        destructive: "bg-destructive active:opacity-75",
        outline:
          "border border-slate-200 dark:border-zinc-700 bg-transparent active:bg-slate-50 dark:active:bg-zinc-800",
        secondary:
          "bg-slate-100 dark:bg-zinc-800 active:opacity-80",
        ghost: "active:bg-slate-100 dark:active:bg-zinc-800",
        link: "active:opacity-70",
      },
      size: {
        default: "h-12 px-5",
        sm: "h-9 px-3",
        lg: "h-14 px-8",
        icon: "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const buttonTextVariants = cva("font-semibold text-center", {
  variants: {
    variant: {
      default: "text-white",
      destructive: "text-white",
      outline: "text-slate-900 dark:text-slate-50",
      secondary: "text-slate-900 dark:text-slate-50",
      ghost: "text-slate-900 dark:text-slate-50",
      link: "text-primary-500 underline",
    },
    size: {
      default: "text-sm",
      sm: "text-sm",
      lg: "text-base",
      icon: "text-sm",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

interface ButtonProps
  extends PressableProps,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  children: React.ReactNode;
}

function Button({
  className,
  variant,
  size,
  disabled,
  loading,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      className={cn(
        buttonVariants({ variant, size }),
        isDisabled && "opacity-50",
        className
      )}
      disabled={!!isDisabled}
      {...props}
    >
      {loading && (
        <ActivityIndicator
          size="small"
          color={
            variant === "default" || variant === "destructive"
              ? "#fff"
              : "#0a7ea4"
          }
        />
      )}
      {typeof children === "string" ? (
        <Text className={cn(buttonTextVariants({ variant, size }))}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

export { Button, buttonVariants, buttonTextVariants };
export type { ButtonProps };
