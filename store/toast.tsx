import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as React from "react";
import { Animated, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ToastOptions {
  message: string;
  variant?: "success" | "error" | "warning" | "info";
  duration?: number;
}

interface ToastItem extends Required<ToastOptions> {
  id: string;
}

interface ToastContextValue {
  showToast: (opts: ToastOptions) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = React.createContext<ToastContextValue>({
  showToast: () => {},
});

export function useToast() {
  return React.useContext(ToastContext);
}

// ─── Single toast item ────────────────────────────────────────────────────────

const VARIANT_STYLES: Record<
  ToastItem["variant"],
  { bg: string; icon: keyof typeof MaterialIcons.glyphMap }
> = {
  success: { bg: "bg-green-600", icon: "check-circle" },
  error: { bg: "bg-red-500", icon: "error-outline" },
  warning: { bg: "bg-amber-500", icon: "warning-amber" },
  info: { bg: "bg-primary-500", icon: "info-outline" },
};

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
    // Slide up + fade in
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

    // Auto-dismiss
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

  const { bg, icon } = VARIANT_STYLES[toast.variant];

  return (
    <Animated.View
      style={{ transform: [{ translateY }], opacity }}
      className={`flex-row items-center gap-3 rounded-2xl px-4 py-3.5 shadow-lg ${bg}`}
    >
      <MaterialIcons name={icon} size={18} color="#fff" />
      <Text className="flex-1 text-sm font-medium text-white" numberOfLines={2}>
        {toast.message}
      </Text>
      <TouchableOpacity onPress={dismiss} hitSlop={10}>
        <MaterialIcons name="close" size={16} color="rgba(255,255,255,0.75)" />
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

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
        paddingBottom: insets.bottom + 80, // above tab bar
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

// ─── Provider ─────────────────────────────────────────────────────────────────

const MAX_QUEUE = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = React.useState<ToastItem[]>([]);

  const showToast = React.useCallback((opts: ToastOptions) => {
    const id = Math.random().toString(36).slice(2);
    const item: ToastItem = {
      id,
      message: opts.message,
      variant: opts.variant ?? "success",
      duration: opts.duration ?? 3000,
    };
    setQueue((prev) => {
      const next = [...prev, item];
      return next.slice(-MAX_QUEUE); // keep newest MAX_QUEUE
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
