import * as React from "react";
import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const textVariants = cva("text-slate-900 dark:text-slate-50", {
  variants: {
    variant: {
      default: "text-base",
      h1: "text-4xl font-bold tracking-tight",
      h2: "text-3xl font-semibold tracking-tight",
      h3: "text-2xl font-semibold",
      h4: "text-xl font-semibold",
      h5: "text-lg font-semibold",
      lead: "text-lg text-slate-600 dark:text-slate-300",
      muted: "text-sm text-slate-500 dark:text-slate-400",
      small: "text-xs text-slate-500 dark:text-slate-400",
      label: "text-sm font-medium",
      mono: "text-sm font-mono",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface TextProps extends RNTextProps, VariantProps<typeof textVariants> {}

const Text = React.forwardRef<React.ElementRef<typeof RNText>, TextProps>(
  ({ className, variant, ...props }, ref) => (
    <RNText
      ref={ref}
      className={cn(textVariants({ variant }), className)}
      {...props}
    />
  )
);
Text.displayName = "Text";

export { Text, textVariants };
export type { TextProps };
