import { useCallback, useEffect, useRef, useState } from "react";
import * as LocalAuthentication from "expo-local-authentication";
import { AppState, type AppStateStatus, Platform } from "react-native";

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

  // Stable ref so AppState handler never closes over stale capabilities.
  const capabilitiesRef = useRef<BiometricCapabilities | null>(null);
  // Track whether the app actually visited the background (not just inactive).
  const wasInBackground = useRef(false);

  // ── 1. Capability probe ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isEnabled) {
      setStatus("unlocked");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const [hasHardware, isEnrolled, supportedTypes] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
          LocalAuthentication.supportedAuthenticationTypesAsync(),
        ]);

        if (cancelled) return;

        const caps: BiometricCapabilities = { hasHardware, isEnrolled, supportedTypes };
        capabilitiesRef.current = caps;
        setCapabilities(caps);
        setStatus(hasHardware && isEnrolled ? "locked" : "unavailable");
      } catch {
        if (!cancelled) setStatus("unavailable");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  // ── 2. AppState: re-lock on every foreground resume ──────────────────────
  useEffect(() => {
    if (!isEnabled) return;

    const handleChange = (next: AppStateStatus) => {
      if (next === "background") {
        wasInBackground.current = true;
        return;
      }

      if (next === "active" && wasInBackground.current) {
        wasInBackground.current = false;
        const caps = capabilitiesRef.current;
        if (caps?.hasHardware && caps?.isEnrolled) {
          setErrorMessage(null);
          setStatus("locked");
        }
      }
    };

    const sub = AppState.addEventListener("change", handleChange);
    return () => sub.remove();
  }, [isEnabled]);

  // ── 3. Authentication ────────────────────────────────────────────────────
  const authenticate = useCallback(async () => {
    const caps = capabilitiesRef.current;
    if (!caps?.hasHardware || !caps?.isEnrolled) return;

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
