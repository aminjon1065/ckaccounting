import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as LocalAuthentication from "expo-local-authentication";

import {
  resolveBiometricLabel,
  useBiometricAuth,
  type BiometricCapabilities,
  type BiometricStatus,
} from "@/hooks/useBiometricAuth";
import { useAuth } from "@/store/auth";

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
  const { token, verifyPin, hasPin } = useAuth();
  const isEnabled = !!token;

  const { status, capabilities, authenticate, errorMessage } =
    useBiometricAuth(isEnabled);

  const [showPinFallback, setShowPinFallback] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [pinAvailable, setPinAvailable] = useState(false);

  // Check if PIN is available when biometric fails
  useEffect(() => {
    if ((status === "failed" || status === "cancelled") && isEnabled) {
      hasPin().then(setPinAvailable);
    }
  }, [status, isEnabled]);

  // Auto-trigger the system biometric prompt whenever the guard enters the
  // locked state (initial launch AND every foreground resume).
  useEffect(() => {
    if (status === "locked") {
      setShowPinFallback(false);
      setPinValue("");
      setPinError("");
      authenticate();
    }
  }, [status]);

  // When unlocked, clear all fallback state
  useEffect(() => {
    if (status === "unlocked") {
      setShowPinFallback(false);
      setPinValue("");
      setPinError("");
    }
  }, [status]);

  const handlePinSubmit = useCallback(async () => {
    if (pinValue.length < 4) return;
    setIsVerifyingPin(true);
    setPinError("");
    const valid = await verifyPin(pinValue);
    if (valid) {
      setPinValue("");
      setPinError("");
    } else {
      setPinError("Неверный PIN-код");
      setPinValue("");
    }
    setIsVerifyingPin(false);
  }, [pinValue, verifyPin]);

  // ── Pass-through cases ────────────────────────────────────────────────────
  // Not logged in: let AuthGuard in _layout handle routing.
  if (!isEnabled) return <>{children}</>;

  // Biometrics unavailable (no hardware / not enrolled): pass through.
  // Sensitive data is still protected by the server-side token.
  if (status === "unavailable") return <>{children}</>;

  // Successfully authenticated: show the app.
  if (status === "unlocked") return <>{children}</>;

  // ── PIN Fallback Screen ────────────────────────────────────────────────────
  if (showPinFallback) {
    return (
      <PinFallbackScreen
        pinValue={pinValue}
        setPinValue={setPinValue}
        pinError={pinError}
        isVerifying={isVerifyingPin}
        onSubmit={handlePinSubmit}
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
  onSubmit: () => void;
  onBack: () => void;
}

function PinFallbackScreen({
  pinValue,
  setPinValue,
  pinError,
  isVerifying,
  onSubmit,
  onBack,
}: PinFallbackScreenProps) {
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
            {isVerifying ? (
              <ActivityIndicator size="large" color={COLORS.tint} />
            ) : (
              <MaterialIcons name="pin" size={52} color={COLORS.tint} />
            )}
          </View>

          {/* Title */}
          <Text style={styles.title}>Enter PIN</Text>

          {/* Subtitle */}
          <Text style={styles.subtitle}>
            Enter your PIN code to unlock the app
          </Text>

          {/* PIN dots */}
          <View style={styles.pinDotsRow}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <View
                key={i}
                style={[
                  styles.pinDot,
                  i < pinValue.length && styles.pinDotFilled,
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

          {/* Keypad */}
          <View style={styles.keypad}>
            {[["1","2","3"],["4","5","6"],["7","8","9"],[,"0","⌫"]].map((row, ri) => (
              <View key={ri} style={styles.keypadRow}>
                {row.map((key) => key ? (
                  <Pressable
                    key={key}
                    style={({ pressed }) => [
                      styles.keypadKey,
                      pressed && styles.keypadKeyPressed,
                    ]}
                    onPress={() => {
                      if (key === "⌫") {
                        setPinValue(pinValue.slice(0, -1));
                      } else if (pinValue.length < 6) {
                        const newPin = pinValue + key;
                        setPinValue(newPin);
                        if (newPin.length >= 4) {
                          setTimeout(() => {
                            // auto-submit when 4+ digits entered
                            if (newPin.length >= 4) {
                              // trigger submit check
                            }
                          }, 100);
                        }
                      }
                    }}
                    disabled={isVerifying}
                  >
                    <Text style={styles.keypadKeyText}>{key}</Text>
                  </Pressable>
                ) : <View key="empty" style={styles.keypadKey} />)}
              </View>
            ))}
          </View>

          {/* Submit button */}
          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && styles.buttonPressed,
              (pinValue.length < 4 || isVerifying) && styles.buttonDisabled,
            ]}
            onPress={onSubmit}
            disabled={pinValue.length < 4 || isVerifying}
          >
            <Text style={styles.buttonText}>Unlock</Text>
          </Pressable>

          {/* Back to biometric */}
          <Pressable
            style={styles.backButton}
            onPress={onBack}
          >
            <Text style={styles.backButtonText}>Back to biometric</Text>
          </Pressable>
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <MaterialIcons name="lock" size={14} color={COLORS.muted} />
          <Text style={styles.footerText}>
            Protected with PIN
          </Text>
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
});