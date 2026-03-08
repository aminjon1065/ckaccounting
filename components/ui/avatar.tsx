import * as React from "react";
import { Image, View, Text, type ViewProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const avatarVariants = cva(
  "rounded-full items-center justify-center overflow-hidden",
  {
    variants: {
      size: {
        sm: "h-8 w-8",
        default: "h-10 w-10",
        lg: "h-14 w-14",
        xl: "h-20 w-20",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
);

const avatarTextVariants = cva("font-semibold text-white uppercase", {
  variants: {
    size: {
      sm: "text-xs",
      default: "text-sm",
      lg: "text-xl",
      xl: "text-2xl",
    },
  },
  defaultVariants: {
    size: "default",
  },
});

/** Returns initials from a name (up to 2 letters) */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/** Generates a consistent background color from a string */
function getAvatarColor(name: string): string {
  const colors = [
    "#0a7ea4", "#6366f1", "#8b5cf6", "#ec4899",
    "#f59e0b", "#10b981", "#ef4444", "#3b82f6",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

interface AvatarProps extends ViewProps, VariantProps<typeof avatarVariants> {
  src?: string;
  name?: string;
  fallback?: string;
}

function Avatar({ className, size, src, name, fallback, ...props }: AvatarProps) {
  const [imageError, setImageError] = React.useState(false);
  const initials = name ? getInitials(name) : (fallback ?? "?");
  const bgColor = name ? getAvatarColor(name) : "#0a7ea4";

  return (
    <View
      className={cn(avatarVariants({ size }), className)}
      style={{ backgroundColor: bgColor }}
      {...props}
    >
      {src && !imageError ? (
        <Image
          source={{ uri: src }}
          className="w-full h-full"
          onError={() => setImageError(true)}
        />
      ) : (
        <Text className={cn(avatarTextVariants({ size }))}>{initials}</Text>
      )}
    </View>
  );
}

export { Avatar };
export type { AvatarProps };
