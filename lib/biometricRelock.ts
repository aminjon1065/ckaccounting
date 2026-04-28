let suppressRelockUntil = 0;

export function suppressBiometricRelock(durationMs: number) {
  suppressRelockUntil = Math.max(suppressRelockUntil, Date.now() + durationMs);
}

export function suppressBiometricRelockForSystemUi() {
  // Camera / gallery / crop flows temporarily background the app while the user
  // is still in an intentional in-app media action.
  suppressBiometricRelock(120_000);
}

export function finishSystemUiBiometricSuppression() {
  // Keep a small cooldown after returning so AppState "active" and picker
  // resolution don't race with the relock effect.
  suppressBiometricRelock(2_500);
}

export function isBiometricRelockSuppressed() {
  return Date.now() < suppressRelockUntil;
}
