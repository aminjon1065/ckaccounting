import * as React from "react";
import { View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";

interface SeparatorProps extends ViewProps {
  orientation?: "horizontal" | "vertical";
}

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorProps) {
  return (
    <View
      className={cn(
        "bg-slate-200 dark:bg-zinc-700",
        orientation === "horizontal" ? "h-px w-full" : "w-px h-full",
        className
      )}
      {...props}
    />
  );
}

export { Separator };
export type { SeparatorProps };
