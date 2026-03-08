import * as React from "react";
import { Animated, View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";

interface SkeletonProps extends ViewProps {
  /** Show animated shimmer. Defaults to true. */
  animate?: boolean;
}

function Skeleton({ className, animate = true, style, ...props }: SkeletonProps) {
  const opacity = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (!animate) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [animate, opacity]);

  return (
    <Animated.View
      style={[{ opacity }, style]}
      className={cn(
        "rounded-lg bg-slate-200 dark:bg-zinc-700",
        className
      )}
      {...props}
    />
  );
}

/** Convenience skeleton row for text lines */
function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <View className={cn("gap-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4"
          style={{ width: i === lines - 1 ? "60%" : "100%" }}
        />
      ))}
    </View>
  );
}

export { Skeleton, SkeletonText };
