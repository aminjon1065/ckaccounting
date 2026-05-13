import { useCallback, useEffect, useRef, useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import { Platform } from "react-native";
import { isBiometricRelockSuppressed } from "@/lib/biometricRelock";

// ─── Types ───────────────────────────────────────────────────────────────────

export type BiometricStatus =
  | "checking"       // initial capability probe
  | "unavailable"    // no hardware or not enrolled → pass-through
  | "locked"         // awaiting authentication
  | "authenticating" // system prompt active
  | "unlocked"       // successfully verified
  | "failed"         // authentication rejected / too many attempts
  | "cancelled";     // user dismissed the prompt

export interface BiometricCapabilities {
  hasHardware: boolean;
  isEnrolled: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
}

export interface UseBiometricAuthReturn {
  status: BiometricStatus;
  capabilities: BiometricCapabilities | null;
  authenticate: () => Promise<void>;
  errorMessage: string | null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Manages biometric authentication state for the app guard.
 *
 * @param isEnabled - Pass `true` only when a session token exists.
 *                    Passing `false` immediately moves to `unlocked`
 *                    so unauthenticated screens are never blocked.
 */
export function useBiometricAuth(isEnabled: boolean): UseBiometricAuthReturn {
  const [status, setStatus] = useState<BiometricStatus>("checking");
  const [capabilities, setCapabilities] = useState<BiometricCapabilities | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Capability probe writes through this ref so the `authenticate`
  // callback always sees the freshest capabilities without re-binding.
  const capabilitiesRef = useRef<BiometricCapabilities | null>(null);

  // ── 1. Capability probe ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isEnabled) {
      // "unlocked" while `!isEnabled` means "no lock applies because nobody
      // is logged in". It's NOT a positive unlock signal — callers should
      // gate on `isEnabled` themselves.
      setStatus("unlocked");
      return;
    }

    // Auth just turned on (cold-launch with saved token, or fresh sign-in).
    // Force status back to "checking" so downstream consumers don't see the
    // leftover "unlocked" from the previous !isEnabled phase and mistake it
    // for a passed-lock signal before the probe has even run.
    setStatus("checking");

    let cancelled = false;

    (async () => {
      const t0 = __DEV__ ? Date.now() : 0;
      try {
        if (__DEV__) console.log("[useBiometricAuth] probing capabilities…");
        const [hasHardware, isEnrolled, supportedTypes] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          LocalAuthentication.supportedAuthenticationTypesAsync(),
        ]);
        if (__DEV__) console.log(`[useBiometricAuth] probe done in ${Date.now() - t0}ms hw=${hasHardware} enrolled=${isEnrolled} suppressed=${isBiometricRelockSuppressed()}`);

        if (cancelled) return;

        const caps: BiometricCapabilities = { hasHardware, isEnrolled, supportedTypes };
        capabilitiesRef.current = caps;
        setCapabilities(caps);

        if (hasHardware && isEnrolled) {
          // Skip locking immediately after a fresh login — the user just authenticated.
          setStatus(isBiometricRelockSuppressed() ? "unlocked" : "locked");
        } else {
          setStatus("unavailable");
        }
      } catch (e) {
        if (__DEV__) console.log(`[useBiometricAuth] probe failed in ${Date.now() - t0}ms: ${(e as Error)?.message}`);
        if (!cancelled) setStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  // ── 2. AppState: no re-lock on resume ────────────────────────────────────
  // Authentication is required only on cold start (when the OS spawned a
  // fresh JS context). Foreground resume — switching apps, dismissing a
  // system modal (camera, file picker, share sheet) — does NOT trigger
  // a re-lock by user preference. The capability probe in effect 1 above
  // sets `status = "locked"` on mount when biometrics are available, so
  // cold starts still gate behind the prompt; we simply don't re-arm it
  // when the same JS context comes back from the background.

  // ── 3. Authentication ────────────────────────────────────────────────────
  const authenticate = useCallback(async () => {
    const caps = capabilitiesRef.current;
    if (!caps?.hasHardware || !caps?.isEnrolled) return;

    if (__DEV__) console.log("[useBiometricAuth] authenticate() called — opening system prompt");
    setStatus("authenticating");
    setErrorMessage(null);

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: resolvePromptMessage(caps.supportedTypes),
        fallbackLabel: "Use Passcode",
        // Note: On Android, disableDeviceFallback: true completely disables Face Recognition
        // because it requires Class 3 biometrics. We only enforce disable on iOS.
        disableDeviceFallback: Platform.OS === "ios",
        cancelLabel: "Cancel",
      });

      if (result.success) {
        setStatus("unlocked");
      } else {
        handleAuthError(result.error ?? "unknown");
      }
    } catch (err: any) {
      setStatus("failed");
      setErrorMessage(`Auth exception: ${err?.message || err}`);
    }
  }, []);

  return { status, capabilities, authenticate, errorMessage };

  // ── Helpers ──────────────────────────────────────────────────────────────

  function handleAuthError(error: string) {
    switch (error) {
      case "user_cancel":
      case "system_cancel":
        setStatus("cancelled");
        setErrorMessage(null);
        break;
      case "lockout":
        setStatus("failed");
        setErrorMessage("Too many failed attempts. Use your device passcode to unlock.");
        break;
      case "lockout_permanent":
        setStatus("failed");
        setErrorMessage("Biometrics have been disabled. Use your device passcode.");
        break;
      case "not_enrolled":
      case "not_available":
      case "no_hardware":
        capabilitiesRef.current = null;
        setCapabilities(null);
        setStatus("unavailable");
        break;
      default:
        setStatus("failed");
        setErrorMessage(`Authentication failed (${error}). Please try again.`);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolvePromptMessage(types: LocalAuthentication.AuthenticationType[]): string {
  const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
  const hasFingerprint = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);

  if (hasFace && Platform.OS === "ios") return "Unlock with Face ID";
  if (hasFace) return "Unlock with Face Recognition";
  if (hasFingerprint) return "Unlock with Fingerprint";
  return "Authenticate to continue";
}

/** Human-readable label shown on the lock-screen button. */
export function resolveBiometricLabel(
  capabilities: BiometricCapabilities | null,
): string {
  if (!capabilities) return "Unlock App";

  const { supportedTypes } = capabilities;
  const hasFace = supportedTypes.includes(
    LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
  );
  const hasFingerprint = supportedTypes.includes(
    LocalAuthentication.AuthenticationType.FINGERPRINT,
  );

  if (hasFace && Platform.OS === "ios") return "Unlock with Face ID";
  if (hasFace) return "Unlock with Face Recognition";
  if (hasFingerprint) return "Unlock with Fingerprint";
  return "Unlock with Passcode";
}
