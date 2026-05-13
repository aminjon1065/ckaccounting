import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Animated, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui";
import * as haptics from "@/lib/haptics";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ToastOptions {
  /** Headline text. Required for the single-line legacy variant; for the
   *  two-line variant pass `title` + `description` instead. */
  message?: string;
  /** Bold first line. Prefer this over `message` for richer toasts. */
  title?: string;
  /** Muted second line for context (id, sum, hint). */
  description?: string;
  variant?: "success" | "error" | "warning" | "info";
  duration?: number;
}

interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: NonNullable<ToastOptions["variant"]>;
  duration: number;
}

interface ToastContextValue {
  showToast: (opts: ToastOptions) => void;
}

const ToastContext = React.createContext<ToastContextValue>({
  showToast: () => {},
});

export function useToast() {
  return React.useContext(ToastContext);
}

// ─── Variant styling ─────────────────────────────────────────────────────────

interface VariantStyle {
  bg: string;
  border: string;
  tile: string;
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  iconColor: string;
  title: string;
  description: string;
}

const VARIANT: Record<ToastItem["variant"], VariantStyle> = {
  success: {
    bg: "bg-emerald-50 dark:bg-emerald-900/40",
    border: "border-emerald-200 dark:border-emerald-900/60",
    tile: "bg-emerald-100 dark:bg-emerald-900/60",
    icon: "check-circle",
    iconColor: "#10b981",
    title: "text-emerald-800 dark:text-emerald-200",
    description: "text-emerald-700/80 dark:text-emerald-300/70",
  },
  error: {
    bg: "bg-red-50 dark:bg-red-900/40",
    border: "border-red-200 dark:border-red-900/60",
    tile: "bg-red-100 dark:bg-red-900/60",
    icon: "error-outline",
    iconColor: "#ef4444",
    title: "text-red-800 dark:text-red-200",
    description: "text-red-700/80 dark:text-red-300/70",
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-900/40",
    border: "border-amber-200 dark:border-amber-900/60",
    tile: "bg-amber-100 dark:bg-amber-900/60",
    icon: "warning-amber",
    iconColor: "#f59e0b",
    title: "text-amber-900 dark:text-amber-200",
    description: "text-amber-800/80 dark:text-amber-300/70",
  },
  info: {
    bg: "bg-primary-50 dark:bg-primary-900/40",
    border: "border-primary-200 dark:border-primary-900/60",
    tile: "bg-primary-100 dark:bg-primary-900/60",
    icon: "info-outline",
    iconColor: "#0a7ea4",
    title: "text-primary-700 dark:text-primary-200",
    description: "text-primary-700/80 dark:text-primary-300/70",
  },
};

// ─── Single toast item ───────────────────────────────────────────────────────

function ToastItemView({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const translateY = React.useRef(new Animated.Value(80)).current;
  const opacity = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 18,
        stiffness: 200,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      dismiss();
    }, toast.duration);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dismiss() {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 80,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss(toast.id));
  }

  const v = VARIANT[toast.variant];

  return (
    <Animated.View
      style={{ transform: [{ translateY }], opacity }}
      className={`flex-row items-start gap-3 rounded-2xl border px-3.5 py-3 shadow-lg ${v.bg} ${v.border}`}
    >
      <View className={`w-9 h-9 rounded-[10px] items-center justify-center shrink-0 ${v.tile}`}>
        <MaterialIcons name={v.icon} size={18} color={v.iconColor} />
      </View>
      <View className="flex-1 min-w-0">
        <Text className={`text-[14px] font-semibold tracking-tight ${v.title}`} numberOfLines={2}>
          {toast.title}
        </Text>
        {toast.description && (
          <Text className={`text-[12px] mt-0.5 leading-[16px] ${v.description}`} numberOfLines={2}>
            {toast.description}
          </Text>
        )}
      </View>
      <Pressable onPress={dismiss} hitSlop={10} className="mt-0.5 active:opacity-60">
        <MaterialIcons name="close" size={16} color="#94a3b8" />
      </Pressable>
    </Animated.View>
  );
}

// ─── Overlay ─────────────────────────────────────────────────────────────────

function ToastOverlay({
  queue,
  dismiss,
}: {
  queue: ToastItem[];
  dismiss: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();

  if (queue.length === 0) return null;

  return (
    <View
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        paddingBottom: insets.bottom + 80,
        paddingHorizontal: 16,
        gap: 8,
        pointerEvents: "box-none",
      }}
      pointerEvents="box-none"
    >
      {queue.map((toast) => (
        <ToastItemView key={toast.id} toast={toast} onDismiss={dismiss} />
      ))}
    </View>
  );
}

// ─── Provider ────────────────────────────────────────────────────────────────

const MAX_QUEUE = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = React.useState<ToastItem[]>([]);

  const showToast = React.useCallback((opts: ToastOptions) => {
    const id = Math.random().toString(36).slice(2);
    const variant = opts.variant ?? "success";
    // Back-compat: callers pass `message`; new callers can pass `title` +
    // optional `description`. We resolve to a normalised internal shape.
    const title = opts.title ?? opts.message ?? "";
    if (!title) return;
    const item: ToastItem = {
      id,
      title,
      description: opts.description,
      variant,
      duration: opts.duration ?? 3000,
    };
    if (variant === "success") haptics.success();
    else if (variant === "error") haptics.error();
    else if (variant === "warning") haptics.warning();
    setQueue((prev) => {
      const next = [...prev, item];
      return next.slice(-MAX_QUEUE);
    });
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setQueue((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = React.useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastOverlay queue={queue} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}
