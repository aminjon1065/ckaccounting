import React, { useCallback, useEffect, useState } from "react";
import { useSegments } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as LocalAuthentication from "expo-local-authentication";
import * as Haptics from "expo-haptics";

import {
  resolveBiometricLabel,
  useBiometricAuth,
  type BiometricCapabilities,
  type BiometricStatus,
} from "@/hooks/useBiometricAuth";
import { useAuth } from "@/store/auth";
import { reportError } from "@/lib/observability/reporter";

// ─── Public component ────────────────────────────────────────────────────────

interface BiometricGuardProps {
  children: React.ReactNode;
}

/**
 * Wraps protected content with a biometric lock screen.
 *
 * Behaviour:
 * - Not logged in  → renders children immediately (auth routing handles redirect).
 * - No biometrics  → renders children immediately (no compatible hardware / not enrolled).
 * - Locked         → shows full-screen lock UI; children are NOT rendered.
 * - Unlocked       → renders children.
 *
 * The guard re-locks every time the app returns from the background, forcing
 * re-authentication on each foreground resume.
 *
 * Fallback: When biometric fails and PIN is set, shows PIN entry screen.
 */
export function BiometricGuard({ children }: BiometricGuardProps) {
  const { token, user, verifyPin, hasPin, pinSetupPending, signOut } = useAuth();
  const segments = useSegments();
  const isEnabled = !!token;
  const inAuthGroup = segments[0] === "(auth)";

  const { status, capabilities, authenticate, errorMessage } =
    useBiometricAuth(isEnabled);

  const [showPinFallback, setShowPinFallback] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [pinAvailable, setPinAvailable] = useState(false);
  // Explicit "the user successfully entered their PIN this session" flag.
  // Cleared on session change (token flip) and on background→foreground
  // resume so the relock semantics match biometric flow. This avoids the
  // earlier bug where derived `pinOnlyLocked` state could be re-engaged
  // by an effect re-run while we still wanted the user inside the app.
  const [unlockedViaPin, setUnlockedViaPin] = useState(false);

  // Check PIN availability whenever the biometric layer reports a state
  // where a PIN may be needed (failed / cancelled / unavailable).
  useEffect(() => {
    if (!isEnabled) return;
    if (status === "failed" || status === "cancelled" || status === "unavailable") {
      hasPin().then(setPinAvailable);
    }
  }, [status, isEnabled, hasPin]);

  // Sign-out / sign-in boundary clears the manual unlock so a different user
  // can't inherit the previous session's authorization.
  useEffect(() => {
    if (!isEnabled) setUnlockedViaPin(false);
  }, [isEnabled]);

  // Background→foreground re-engages the lock — same semantics the biometric
  // hook applies to its own status. Without this, a PIN-only user would
  // never be re-prompted after backgrounding the app.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background") setUnlockedViaPin(false);
    });
    return () => sub.remove();
  }, []);

  // Auto-trigger the system biometric prompt whenever the guard enters the
  // locked state (initial launch AND every foreground resume).
  useEffect(() => {
    if (status === "locked") {
      setShowPinFallback(false);
      setPinValue("");
      setPinError("");
      authenticate();
    }
  }, [status, authenticate]);

  // When biometric unlocks, clear PIN UI residue so a later PIN entry starts clean.
  useEffect(() => {
    if (status === "unlocked") {
      setShowPinFallback(false);
      setPinValue("");
      setPinError("");
    }
  }, [status]);

  // Accepts the pin as an argument so the auto-submit path (called from
  // inside the keypad's onPress) doesn't race against the setPinValue
  // re-render — React's state updates are async and the closure in setTimeout
  // would otherwise see the previous (3-digit) value.
  const handlePinSubmit = useCallback(async (pinToCheck: string) => {
    if (pinToCheck.length !== 4) return;
    setIsVerifyingPin(true);
    setPinError("");
    const valid = await verifyPin(pinToCheck);
    if (valid) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPinValue("");
      setPinError("");
      setShowPinFallback(false);
      // Single source of truth for "unlocked this session via PIN". Both the
      // pin-only-locked path (no biometric hardware) and the "Use PIN
      // instead" path (biometric available but user chose PIN) end here;
      // the derived `pinOnlyLocked` below honors this flag so the screen
      // doesn't bounce back into the lock UI.
      setUnlockedViaPin(true);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setPinError("Неверный PIN-код");
      setPinValue("");
    }
    setIsVerifyingPin(false);
  }, [verifyPin]);

  // Derived. Recomputed every render — no chance of getting stuck in a stale
  // truthy state from a re-fired effect, which was the failure mode in the
  // earlier `pinOnlyLocked` useState + useEffect implementation.
  const pinOnlyLocked =
    isEnabled
    && !inAuthGroup
    && !pinSetupPending
    && status === "unavailable"
    && pinAvailable
    && !unlockedViaPin;

  // Sign-out from the PIN screen (used when the user has forgotten the PIN
  // or wants to switch accounts). Confirms first because signing out wipes
  // the offline session and any unsynced data needs to be flushed first.
  const handleSignOut = useCallback(() => {
    Alert.alert(
      "Выйти из аккаунта?",
      "Чтобы войти снова, потребуется интернет и пароль. Несинхронизированные данные могут быть потеряны.",
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Выйти",
          style: "destructive",
          onPress: () => { signOut().catch((e) => reportError(e, { tag: "biometric-guard-sign-out" })); },
        },
      ]
    );
  }, [signOut]);

  // ── Pass-through cases ────────────────────────────────────────────────────
  // Not logged in: let AuthGuard in _layout handle routing.
  if (!isEnabled || inAuthGroup || pinSetupPending) return <>{children}</>;

  // Still probing hardware capabilities — pass through to avoid mounting a
  // full-screen overlay during an active Fabric navigation transition.
  // The lock screen will appear once the probe resolves to "locked".
  if (status === "checking") return <>{children}</>;

  // No biometrics, but the user has a PIN — require it before showing the app.
  // No onBack prop: there's no biometric to fall back to.
  if (pinOnlyLocked) {
    return (
      <PinFallbackScreen
        pinValue={pinValue}
        setPinValue={setPinValue}
        pinError={pinError}
        isVerifying={isVerifyingPin}
        onSubmit={handlePinSubmit}
        userIdentity={user?.email ?? user?.name ?? undefined}
        onSignOut={handleSignOut}
      />
    );
  }

  // Biometrics unavailable (no hardware / not enrolled) and no PIN → pass through.
  // Sensitive data is still protected by the server-side token.
  if (status === "unavailable") return <>{children}</>;

  // Successfully authenticated: show the app. `unlockedViaPin` covers the
  // "Use PIN instead" flow — without it, status stays at locked/failed/
  // cancelled after a successful PIN entry and we'd bounce back into the
  // lock screen instead of letting the user through.
  if (status === "unlocked" || unlockedViaPin) return <>{children}</>;

  // ── PIN Fallback Screen ────────────────────────────────────────────────────
  if (showPinFallback) {
    return (
      <PinFallbackScreen
        pinValue={pinValue}
        setPinValue={setPinValue}
        pinError={pinError}
        isVerifying={isVerifyingPin}
        onSubmit={handlePinSubmit}
        userIdentity={user?.email ?? user?.name ?? undefined}
        onSignOut={handleSignOut}
        onBack={() => {
          setShowPinFallback(false);
          setPinValue("");
          setPinError("");
        }}
      />
    );
  }

  // ── Lock screen ───────────────────────────────────────────────────────────
  return (
    <LockScreen
      status={status}
      capabilities={capabilities}
      errorMessage={errorMessage}
      onAuthenticate={authenticate}
      onUsePinFallback={() => {
        if (pinAvailable) setShowPinFallback(true);
      }}
      showPinFallback={pinAvailable}
    />
  );
}

// ─── Lock screen ─────────────────────────────────────────────────────────────

interface LockScreenProps {
  status: BiometricStatus;
  capabilities: BiometricCapabilities | null;
  errorMessage: string | null;
  onAuthenticate: () => Promise<void>;
  onUsePinFallback?: () => void;
  showPinFallback?: boolean;
}

function LockScreen({
  status,
  capabilities,
  errorMessage,
  onAuthenticate,
  onUsePinFallback,
  showPinFallback,
}: LockScreenProps) {
  const isAuthenticating = status === "authenticating";
  const isCancelled = status === "cancelled";
  const isFailed = status === "failed";
  const showRetry = isCancelled || isFailed;

  const iconName = resolveIconName(capabilities);
  const buttonLabel = resolveBiometricLabel(capabilities);
  const subtitle = resolveSubtitle(capabilities, status);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>

        {/* ── Branding ── */}
        <View style={styles.brandRow}>
          <MaterialIcons name="account-balance" size={22} color={COLORS.tint} />
          <Text style={styles.brandText}>CK Accounting</Text>
        </View>

        {/* ── Center content ── */}
        <View style={styles.center}>
          {/* Icon */}
          <View style={styles.iconRing}>
            {isAuthenticating ? (
              <ActivityIndicator size="large" color={COLORS.tint} />
            ) : (
              <MaterialIcons name={iconName} size={52} color={COLORS.tint} />
            )}
          </View>

          {/* Title */}
          <Text style={styles.title}>
            {isAuthenticating ? "Verifying…" : "App Locked"}
          </Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>{subtitle}</Text>

          {/* Error message */}
          {(isFailed && errorMessage) && (
            <View style={styles.errorBox}>
              <MaterialIcons name="error-outline" size={16} color={COLORS.error} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

          {/* Cancelled message */}
          {isCancelled && (
            <Text style={styles.cancelledText}>
              Authentication was cancelled. Tap below to try again.
            </Text>
          )}

          {/* Primary action button */}
          {showRetry && (
            <Pressable
              style={({ pressed }) => [
                styles.button,
                pressed && styles.buttonPressed,
              ]}
              onPress={onAuthenticate}
              accessibilityRole="button"
              accessibilityLabel={buttonLabel}
            >
              <MaterialIcons
                name={iconName}
                size={20}
                color="#fff"
                style={styles.buttonIcon}
              />
              <Text style={styles.buttonText}>{buttonLabel}</Text>
            </Pressable>
          )}

          {/* PIN fallback button */}
          {showPinFallback && (
            <Pressable
              style={({ pressed }) => [
                styles.pinButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={onUsePinFallback}
              accessibilityRole="button"
            >
              <MaterialIcons
                name="pin"
                size={18}
                color={COLORS.muted}
                style={styles.buttonIcon}
              />
              <Text style={styles.pinButtonText}>Use PIN instead</Text>
            </Pressable>
          )}
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <MaterialIcons name="lock" size={14} color={COLORS.muted} />
          <Text style={styles.footerText}>
            Your data is protected with {Platform.OS === "ios" ? "iOS" : "Android"} security
          </Text>
        </View>

      </SafeAreaView>
    </View>
  );
}

// ─── PIN Fallback Screen ─────────────────────────────────────────────────────

interface PinFallbackScreenProps {
  pinValue: string;
  setPinValue: (v: string) => void;
  pinError: string;
  isVerifying: boolean;
  /** Called with the full 4-digit PIN. Either auto-fired by the keypad
   *  (when reaching 4 digits) or manually via the Unlock button. */
  onSubmit: (pin: string) => void;
  /** When set, renders a "Назад к биометрии" button. Omit on devices
   *  without biometrics — there's nothing to fall back to. */
  onBack?: () => void;
  /** User email/name shown as a subtle greeting so the user can confirm
   *  which account they're unlocking before entering a PIN. */
  userIdentity?: string;
  /** Forgot-PIN escape hatch — wipes session and routes back to login. */
  onSignOut?: () => void;
}

function PinFallbackScreen({
  pinValue,
  setPinValue,
  pinError,
  isVerifying,
  onSubmit,
  onBack,
  userIdentity,
  onSignOut,
}: PinFallbackScreenProps) {
  // Light haptic on every numeric tap; medium on backspace; ignore platform
  // failures (e.g. Android device without a haptic motor).
  const tapHaptic = useCallback((kind: "tap" | "back") => {
    const style = kind === "tap"
      ? Haptics.ImpactFeedbackStyle.Light
      : Haptics.ImpactFeedbackStyle.Medium;
    Haptics.impactAsync(style).catch(() => {});
  }, []);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>

        {/* ── Branding + greeting ── */}
        <View style={styles.brandRow}>
          <MaterialIcons name="account-balance" size={22} color={COLORS.tint} />
          <Text style={styles.brandText}>CK Accounting</Text>
        </View>

        {/* ── Center content ── */}
        <View style={styles.center}>
          {/* Icon */}
          <View style={styles.iconRing}>
            {isVerifying ? (
              <ActivityIndicator size="large" color={COLORS.tint} />
            ) : (
              <MaterialIcons name="lock" size={48} color={COLORS.tint} />
            )}
          </View>

          {/* Title */}
          <Text style={styles.title}>Введите PIN</Text>

          {/* Subtitle: identity if available, otherwise generic prompt */}
          <Text style={styles.subtitle}>
            {userIdentity
              ? `Введите 4-значный PIN для входа\n${userIdentity}`
              : "Введите 4-значный PIN для разблокировки приложения"}
          </Text>

          {/* PIN dots — exactly 4. Highlighted red on error so the failure
              is unmistakable even if the user dismissed the error banner. */}
          <View style={styles.pinDotsRow}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={[
                  styles.pinDot,
                  i < pinValue.length && styles.pinDotFilled,
                  !!pinError && styles.pinDotError,
                ]}
              />
            ))}
          </View>

          {/* Error message */}
          {!!pinError && (
            <View style={styles.errorBox}>
              <MaterialIcons name="error-outline" size={16} color={COLORS.error} />
              <Text style={styles.errorText}>{pinError}</Text>
            </View>
          )}

          {/* Keypad. Capped at 4 digits with auto-submit on the 4th digit
              so users don't have to hunt for an "Unlock" button. */}
          <View style={styles.keypad}>
            {[["1","2","3"],["4","5","6"],["7","8","9"],[null,"0","⌫"]].map((row, ri) => (
              <View key={ri} style={styles.keypadRow}>
                {row.map((key, ki) => key ? (
                  <Pressable
                    key={key}
                    style={({ pressed }) => [
                      styles.keypadKey,
                      pressed && styles.keypadKeyPressed,
                    ]}
                    onPress={() => {
                      if (isVerifying) return;
                      if (key === "⌫") {
                        if (pinValue.length === 0) return;
                        tapHaptic("back");
                        setPinValue(pinValue.slice(0, -1));
                        return;
                      }
                      if (pinValue.length >= 4) return;
                      tapHaptic("tap");
                      const newPin = pinValue + key;
                      setPinValue(newPin);
                      if (newPin.length === 4) {
                        // Auto-submit with the local value — relying on the
                        // closed-over pinValue would race against React's
                        // async state flush.
                        onSubmit(newPin);
                      }
                    }}
                    disabled={isVerifying}
                  >
                    <Text style={styles.keypadKeyText}>{key}</Text>
                  </Pressable>
                ) : <View key={`empty-${ri}-${ki}`} style={styles.keypadKey} />)}
              </View>
            ))}
          </View>
        </View>

        {/* ── Footer actions ── */}
        <View style={styles.footerActions}>
          {onBack && (
            <Pressable onPress={onBack} hitSlop={10}>
              <Text style={styles.linkText}>Назад к биометрии</Text>
            </Pressable>
          )}
          {onSignOut && (
            <Pressable onPress={onSignOut} hitSlop={10}>
              <Text style={styles.linkText}>Забыли PIN? Выйти</Text>
            </Pressable>
          )}
        </View>

      </SafeAreaView>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const { FACIAL_RECOGNITION, FINGERPRINT } = LocalAuthentication.AuthenticationType;

function resolveIconName(
  capabilities: BiometricCapabilities | null,
): React.ComponentProps<typeof MaterialIcons>["name"] {
  if (!capabilities) return "lock";
  const { supportedTypes } = capabilities;
  if (supportedTypes.includes(FACIAL_RECOGNITION)) return "face";
  if (supportedTypes.includes(FINGERPRINT)) return "fingerprint";
  return "lock";
}

function resolveSubtitle(
  capabilities: BiometricCapabilities | null,
  status: BiometricStatus,
): string {
  if (status === "authenticating") return "Follow the prompt on your device";
  if (status === "failed") return "Verify your identity to access the app";
  if (!capabilities) return "Verify your identity to continue";

  const { supportedTypes } = capabilities;
  if (supportedTypes.includes(FACIAL_RECOGNITION) && Platform.OS === "ios")
    return "Use Face ID to unlock";
  if (supportedTypes.includes(FACIAL_RECOGNITION))
    return "Use face recognition to unlock";
  if (supportedTypes.includes(FINGERPRINT))
    return "Use fingerprint or passcode to unlock";
  return "Use your device passcode to unlock";
}

// ─── Constants ───────────────────────────────────────────────────────────────

const COLORS = {
  bg: "#0f172a",         // slate-900
  surface: "#1e293b",    // slate-800
  tint: "#0a7ea4",       // brand primary
  tintLight: "#0e9dc8",  // hover/ring
  text: "#f1f5f9",       // slate-100
  muted: "#64748b",      // slate-500
  error: "#f87171",      // red-400
  errorBg: "#450a0a",    // red-950
  border: "#334155",     // slate-700
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.bg,
    zIndex: 9999,
  },
  safeArea: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 16,
  },

  // Branding
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 8,
  },
  brandText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
  },

  // Center
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
  },
  iconRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.surface,
    borderWidth: 1.5,
    borderColor: COLORS.tint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  subtitle: {
    color: COLORS.muted,
    fontSize: 15,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 22,
  },

  // Error
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: COLORS.errorBg,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 320,
  },
  errorText: {
    color: COLORS.error,
    fontSize: 13,
    flex: 1,
    lineHeight: 19,
  },
  cancelledText: {
    color: COLORS.muted,
    fontSize: 13,
    textAlign: "center",
    maxWidth: 260,
    lineHeight: 19,
  },

  // Button
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: COLORS.tint,
    borderRadius: 14,
    height: 54,
    paddingHorizontal: 32,
    marginTop: 8,
    minWidth: 240,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonIcon: {
    // icon sits inline with text
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },

  // PIN button (secondary)
  pinButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  pinButtonText: {
    color: COLORS.muted,
    fontSize: 14,
  },

  // Footer
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingBottom: 8,
  },
  footerText: {
    color: COLORS.muted,
    fontSize: 12,
  },

  // PIN Fallback Screen
  pinDotsRow: {
    flexDirection: "row",
    gap: 12,
    marginVertical: 8,
  },
  pinDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: COLORS.muted,
    backgroundColor: "transparent",
  },
  pinDotFilled: {
    backgroundColor: COLORS.tint,
    borderColor: COLORS.tint,
  },
  pinDotError: {
    borderColor: COLORS.error,
    backgroundColor: "transparent",
  },

  // Keypad
  keypad: {
    marginTop: 16,
    gap: 8,
  },
  keypadRow: {
    flexDirection: "row",
    gap: 16,
    justifyContent: "center",
  },
  keypadKey: {
    width: 72,
    height: 56,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  keypadKeyPressed: {
    backgroundColor: COLORS.border,
  },
  keypadKeyText: {
    color: COLORS.text,
    fontSize: 24,
    fontWeight: "600",
  },

  // Back button
  backButton: {
    marginTop: 16,
    paddingVertical: 8,
  },
  backButtonText: {
    color: COLORS.muted,
    fontSize: 14,
  },

  // Footer action row (back to biometric / sign out links)
  footerActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 8,
    minHeight: 24,
  },
  linkText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "500",
  },
});
