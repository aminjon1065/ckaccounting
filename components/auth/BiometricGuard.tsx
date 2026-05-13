import React, { useCallback, useEffect, useState } from "react";
import { useSegments } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
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
import { Avatar, Text } from "@/components/ui";
import { PinKeypad } from "@/components/auth/PinKeypad";

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
  const { token, user, verifyPin, hasPin, pinSetupPending, signOut, setLocalUnlocked, isLoaded } = useAuth();
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
  /**
   * True once `hasPin()` has resolved at least once after biometric probe
   * completed. We rely on this to defer the local-unlock signal until we
   * actually know whether a PIN gate is needed; before this resolves,
   * `pinAvailable=false` is just "not yet known", not "definitively no PIN".
   */
  const [pinChecked, setPinChecked] = useState(false);
  // Explicit "the user successfully entered their PIN this session" flag.
  // Cleared on session change (token flip) and on background→foreground
  // resume so the relock semantics match biometric flow. This avoids the
  // earlier bug where derived `pinOnlyLocked` state could be re-engaged
  // by an effect re-run while we still wanted the user inside the app.
  const [unlockedViaPin, setUnlockedViaPin] = useState(false);

  // Check PIN availability whenever the biometric layer reports a state
  // where a PIN may be needed (failed / cancelled / unavailable). The
  // resolved value gates the `localUnlocked` signal below — until this fires
  // we don't know whether to show the PIN fallback or pass through.
  useEffect(() => {
    if (!isEnabled) return;
    if (status === "failed" || status === "cancelled" || status === "unavailable") {
      hasPin().then((has) => {
        setPinAvailable(has);
        setPinChecked(true);
      });
    }
  }, [status, isEnabled, hasPin]);

  // Reset the check on session change so a fresh session re-resolves.
  useEffect(() => {
    if (!isEnabled) setPinChecked(false);
  }, [isEnabled]);

  // Sign-out / sign-in boundary clears the manual unlock so a different user
  // can't inherit the previous session's authorization.
  useEffect(() => {
    if (!isEnabled) setUnlockedViaPin(false);
  }, [isEnabled]);

  // No re-lock on backgrounding by user preference: PIN / biometric is
  // required only at cold start. The unlock flag persists for the full
  // lifetime of the JS context, so backgrounding (system modals, app
  // switching, share sheet, camera) doesn't re-prompt. The `isEnabled`
  // effect above still wipes the flag on sign-out so a fresh login
  // can't inherit the previous session's authorization.

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

  // Mirror the local-auth gate into auth state so background services
  // (CacheProvider's sync, future biometric-gated APIs, etc.) can wait until
  // the user has cleared the lock. "Unlocked enough" conditions:
  //   1. Biometric succeeded (status === "unlocked"), or
  //   2. PIN was just verified (unlockedViaPin), or
  //   3. Device offers neither biometric nor PIN — no local lock to clear.
  //      For (3) we MUST wait for `pinChecked` first; otherwise on cold
  //      launch the probe flips status="unavailable" while pinAvailable is
  //      still its stale `false`, and we'd auto-unlock before the PIN
  //      lookup confirmed there's no PIN — leaking sync past the lock.
  // The pinSetupPending branch is excluded; the PIN setup flow itself follows
  // a fresh login which already set localUnlocked=true in the auth store.
  useEffect(() => {
    if (!isEnabled) return;
    const noLocalLock = status === "unavailable" && pinChecked && !pinAvailable;
    if (status === "unlocked" || unlockedViaPin || noLocalLock) {
      setLocalUnlocked(true);
    }
  }, [isEnabled, status, unlockedViaPin, pinAvailable, pinChecked, setLocalUnlocked]);

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

  // ── Auth-loading gate ─────────────────────────────────────────────────────
  // On cold launch expo-router restores the last route before AuthProvider
  // has finished reading the saved token from SecureStore. During that
  // window `token` is null → `isEnabled=false` → the pass-through case
  // below would render the restored route (e.g. Dashboard) and its data
  // hooks would fire BEFORE the lock screen ever appeared. Block render
  // entirely until auth state is loaded so the protected tree stays mounted-
  // off until we know which screen to show.
  if (!isLoaded) {
    return <View className="flex-1 bg-slate-50 dark:bg-zinc-950" />;
  }

  // ── Pass-through cases ────────────────────────────────────────────────────
  // Not logged in: let AuthGuard in _layout handle routing.
  if (!isEnabled || inAuthGroup || pinSetupPending) return <>{children}</>;

  // Still probing hardware capabilities — render a neutral background
  // (NOT children) so the wrapped Dashboard / tabs don't mount and fire
  // their own data fetches during the ~400ms probe. Once status resolves
  // we either pass through or overlay the lock UI.
  if (status === "checking") {
    return <View className="flex-1 bg-slate-50 dark:bg-zinc-950" />;
  }

  // After the probe completes we know whether a PIN check is even needed.
  // For the "unavailable" branch we still have to wait until `hasPin()`
  // has reported in (`pinChecked`) before deciding pass-through vs PIN
  // fallback — otherwise we'd briefly render children and trigger their
  // data fetches before the PIN screen took over.
  if (status === "unavailable" && !pinChecked) {
    return <View className="flex-1 bg-slate-50 dark:bg-zinc-950" />;
  }

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
    <View
      className="absolute inset-0 bg-slate-50 dark:bg-zinc-950"
      style={{ zIndex: 9999 }}
    >
      <SafeAreaView className="flex-1 px-6 py-4">
        {/* ── Brand row ── */}
        <View className="flex-row items-center gap-2.5 mb-4">
          <View className="w-11 h-11 rounded-xl bg-primary-500 items-center justify-center">
            <Text className="font-heading text-white text-[20px] tracking-tighter">ck</Text>
          </View>
          <View>
            <Text className="font-heading text-[17px] text-slate-900 dark:text-white tracking-tight">
              CK Accounting
            </Text>
            <Text className="text-slate-500 dark:text-zinc-400 text-[12px] mt-px">
              Защищено биометрией
            </Text>
          </View>
        </View>

        {/* ── Centre ── */}
        <View className="flex-1 items-center justify-center px-2">
          <View className="w-[120px] h-[120px] rounded-[32px] bg-primary-100 dark:bg-primary-900/30 items-center justify-center border-2 border-primary-200 dark:border-primary-900/60">
            {isAuthenticating ? (
              <ActivityIndicator size="large" color="#0a7ea4" />
            ) : (
              <MaterialIcons name={iconName} size={52} color="#0a7ea4" />
            )}
          </View>

          <Text className="font-heading text-[24px] tracking-tight text-slate-900 dark:text-white mt-5">
            {isAuthenticating ? "Подтверждение…" : "Приложение заблокировано"}
          </Text>
          <Text className="text-[13.5px] text-slate-500 dark:text-zinc-400 text-center mt-2 max-w-[280px] leading-[20px]">
            {subtitle}
          </Text>

          {/* Error / cancelled message */}
          {isFailed && errorMessage ? (
            <View className="flex-row items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-xl px-3.5 py-2.5 mt-4 max-w-[320px]">
              <MaterialIcons name="error-outline" size={16} color="#ef4444" />
              <Text className="text-[13px] text-red-600 dark:text-red-400 flex-1 leading-[18px]">
                {errorMessage}
              </Text>
            </View>
          ) : null}
          {isCancelled && (
            <Text className="text-[12.5px] text-slate-500 dark:text-zinc-400 text-center mt-3 max-w-[260px] leading-[18px]">
              Подтверждение отменено. Нажмите кнопку ниже, чтобы попробовать снова.
            </Text>
          )}

          {/* Primary action */}
          {showRetry && (
            <Pressable
              onPress={onAuthenticate}
              className="flex-row items-center justify-center gap-2 bg-primary-500 rounded-2xl px-6 mt-5 active:opacity-80"
              style={{ height: 52, minWidth: 240 }}
              accessibilityRole="button"
              accessibilityLabel={buttonLabel}
            >
              <MaterialIcons name={iconName} size={20} color="#fff" />
              <Text className="text-[15px] font-semibold text-white">{buttonLabel}</Text>
            </Pressable>
          )}

          {/* PIN fallback */}
          {showPinFallback && (
            <Pressable
              onPress={onUsePinFallback}
              hitSlop={8}
              className="flex-row items-center justify-center gap-1.5 mt-3 py-2 active:opacity-60"
            >
              <MaterialIcons name="pin" size={16} color="#64748b" />
              <Text className="text-[13.5px] font-medium text-slate-600 dark:text-zinc-300">
                Войти по PIN-коду
              </Text>
            </Pressable>
          )}
        </View>

        {/* ── Footer ── */}
        <View className="flex-row items-center justify-center gap-1.5 pb-2">
          <MaterialIcons name="lock" size={13} color="#94a3b8" />
          <Text className="text-[12px] text-slate-400 dark:text-zinc-500">
            Данные защищены {Platform.OS === "ios" ? "iOS" : "Android"} Keystore
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
  return (
    <View
      className="absolute inset-0 bg-slate-50 dark:bg-zinc-950"
      style={{ zIndex: 9999 }}
    >
      <SafeAreaView className="flex-1 px-6 py-4">
        {/* ── Back link (only when a biometric fallback is possible) ── */}
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={12}
            className="flex-row items-center -ml-1.5 self-start active:opacity-60"
          >
            <MaterialIcons name="chevron-left" size={22} color="#64748b" />
            <Text className="text-slate-500 dark:text-zinc-400 text-[14px]">
              Назад к биометрии
            </Text>
          </Pressable>
        ) : (
          <View className="h-[26px]" />
        )}

        {/* ── Identity ── */}
        <View className="items-center mt-4">
          {userIdentity ? (
            <Avatar name={userIdentity} size="lg" />
          ) : (
            <View className="w-14 h-14 rounded-2xl bg-primary-500 items-center justify-center">
              <MaterialIcons name="lock-outline" size={26} color="#fff" />
            </View>
          )}
          {userIdentity && (
            <Text
              className="font-heading text-[18px] tracking-tight text-slate-900 dark:text-white mt-3"
              numberOfLines={1}
            >
              {userIdentity}
            </Text>
          )}
        </View>

        {/* ── Title + subtitle ── */}
        <View className="items-center mt-4 px-4">
          <Text className="font-heading text-[22px] tracking-tight text-slate-900 dark:text-white">
            Введите PIN-код
          </Text>
          <Text className="text-[13px] text-slate-500 dark:text-zinc-400 text-center mt-1 leading-[18px]">
            4-значный PIN для входа в приложение
          </Text>
        </View>

        {/* ── Keypad ── */}
        <View className="flex-1 justify-end">
          {isVerifying && (
            <View className="flex-row items-center justify-center gap-2 mb-3">
              <ActivityIndicator size="small" color="#0a7ea4" />
              <Text className="text-[13px] text-slate-500 dark:text-zinc-400">
                Проверка…
              </Text>
            </View>
          )}
          <PinKeypad
            value={pinValue}
            onChange={setPinValue}
            onComplete={onSubmit}
            error={pinError || null}
            disabled={isVerifying}
          />
        </View>

        {/* ── Forgot-PIN escape ── */}
        {onSignOut && (
          <View className="items-center pt-3">
            <Pressable onPress={onSignOut} hitSlop={10} className="py-2 active:opacity-60">
              <Text className="text-[13px] text-slate-500 dark:text-zinc-400">
                Забыли PIN? Выйти
              </Text>
            </Pressable>
          </View>
        )}
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

