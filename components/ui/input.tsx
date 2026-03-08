import * as React from "react";
import {
  TextInput,
  View,
  Text,
  type TextInputProps,
  type ViewProps,
} from "react-native";
import { cn } from "@/lib/utils";
import { Label } from "./label";

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerClassName?: string;
}

const Input = React.forwardRef<
  React.ElementRef<typeof TextInput>,
  InputProps
>(function Input(
  {
    className,
    containerClassName,
    label,
    error,
    hint,
    required,
    leftIcon,
    rightIcon,
    editable = true,
    onFocus,
    onBlur,
    ...props
  },
  ref
) {
  const [focused, setFocused] = React.useState(false);

  return (
    <View className={cn("gap-1.5", containerClassName)}>
      {label && <Label required={required}>{label}</Label>}

      <View
        className={cn(
          "flex-row items-center h-12 rounded-xl border bg-white dark:bg-zinc-900 px-3 gap-2",
          focused
            ? "border-primary-500"
            : error
            ? "border-destructive"
            : "border-slate-200 dark:border-zinc-700",
          !editable && "opacity-50 bg-slate-50 dark:bg-zinc-800"
        )}
      >
        {leftIcon && <View className="mr-1">{leftIcon}</View>}
        <TextInput
          ref={ref}
          className={cn(
            "flex-1 text-sm text-slate-900 dark:text-slate-50 h-full",
            className
          )}
          placeholderTextColor="#94a3b8"
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          editable={editable}
          {...props}
        />
        {rightIcon && <View className="ml-1">{rightIcon}</View>}
      </View>

      {error ? (
        <Text className="text-xs text-destructive">{error}</Text>
      ) : hint ? (
        <Text className="text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

export { Input };
export type { InputProps };
