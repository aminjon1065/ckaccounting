// ─── Sync state store ─────────────────────────────────────────────────────────
//
// Holds the *state* half of the sync surface (what the UI displays). The
// methods half — `triggerSync`, `runFullSync`, `refreshProducts`, … — stays
// in `SyncContext` because those callbacks need access to React-scoped
// orchestrator instance + auth refs.
//
// Why split state out of the context value:
//   Before: every consumer that called `useSync()` got the entire context
//   value. A 60 s `isSyncing` toggle re-rendered every screen mounting
//   `useSync()` even when the screen only cared about, say, the periodic
//   pending-action badge.
//
//   After: state lives in a Zustand store; consumers subscribe via
//   selectors and re-render only when the slice they read actually
//   changes. Methods stay on Context (they're memoized once and never
//   change identity, so a stable Context is the simplest delivery).
//
// `SyncProvider` is now the sole writer to this store — every state
// transition that used to call `setIsSyncing` etc. now calls
// `useSyncStore.setState(...)`. UI consumers are read-only.

import { create } from "zustand";
import type { SyncAction } from "../db";

export interface SyncStoreState {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  pendingActionsCount: number;
  deadActionsCount: number;
  failedActions: SyncAction[];
}

export const useSyncStore = create<SyncStoreState>(() => ({
  isOnline: false,
  isSyncing: false,
  lastSyncedAt: null,
  pendingActionsCount: 0,
  deadActionsCount: 0,
  failedActions: [],
}));

// ─── Selector hooks ──────────────────────────────────────────────────────────
//
// Convenience wrappers around the store. Each one subscribes to *one* field
// and re-renders only on that field's change. Components that read multiple
// fields should call the individual hooks rather than reach for the full
// state — that way an unrelated field's update doesn't bubble through.

export const useIsOnline = () => useSyncStore((s) => s.isOnline);
export const useIsSyncing = () => useSyncStore((s) => s.isSyncing);
export const useLastSyncedAt = () => useSyncStore((s) => s.lastSyncedAt);
export const usePendingActionsCount = () => useSyncStore((s) => s.pendingActionsCount);
export const useDeadActionsCount = () => useSyncStore((s) => s.deadActionsCount);
export const useFailedActions = () => useSyncStore((s) => s.failedActions);
export const useFailedActionsCount = () => useSyncStore((s) => s.failedActions.length);
