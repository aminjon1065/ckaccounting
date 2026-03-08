import * as React from "react";
import { Text, type TextProps } from "react-native";
import { cn } from "@/lib/utils";

interface LabelProps extends TextProps {
  required?: boolean;
}

function Label({ className, required, children, ...props }: LabelProps) {
  return (
    <Text
      className={cn(
        "text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5",
        className
      )}
      {...props}
    >
      {children}
      {required && (
        <Text className="text-destructive ml-1"> *</Text>
      )}
    </Text>
  );
}

export { Label };
export type { LabelProps };
