// ─── Haptics helper ──────────────────────────────────────────────────────────
//
// Thin wrapper around `expo-haptics` that exposes semantic intents instead
// of the raw `ImpactFeedbackStyle` / `NotificationFeedbackType` enums. The
// rest of the app calls these by purpose ("user confirmed", "user errored")
// — if we change the underlying feedback later we only touch this file.
//
// All entry points are fire-and-forget and swallow errors so a missing
// vibration motor or a Web build never crashes the caller.
//
// iOS: real Taptic Engine. Android: a short vibration. Web: no-op.

import * as Haptics from "expo-haptics";

function safe(fn: () => Promise<unknown>): void {
  fn().catch(() => {
    // Haptics throw on unsupported platforms / locked devices — silently
    // ignore. UI feel degrades gracefully without breaking the action.
  });
}

/** Light tap. Use on cosmetic buttons (toggle, tab, chevron). */
export function tap(): void {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Medium impact. Use on primary actions (FAB, "Создать продажу"). */
export function press(): void {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
}

/** Heavy impact. Use sparingly — destructive flows ("Удалить", "Возврат"). */
export function strong(): void {
  safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
}

/** Selection change. Use on filter chips, period switches, segmented controls. */
export function selection(): void {
  safe(() => Haptics.selectionAsync());
}

/** Success notification — operation completed. */
export function success(): void {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Warning notification — partial success, soft failure. */
export function warning(): void {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

/** Error notification — operation failed. */
export function error(): void {
  safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
