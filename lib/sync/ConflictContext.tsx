import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type ConflictEntity = "product" | "sale" | "expense" | "purchase" | "debt";

export interface ConflictEntry {
  localId: string;
  entityType: ConflictEntity;
  localData: Record<string, unknown>;
  serverData: Record<string, unknown>;
  field: string;
  localValue: unknown;
  serverValue: unknown;
}

export interface Conflict {
  id: string;
  localId: string;
  entityType: ConflictEntity;
  localData: Record<string, unknown>;
  serverData: Record<string, unknown>;
  conflicts: ConflictEntry[];
  detectedAt: string;
}

interface ConflictContextValue {
  conflicts: Conflict[];
  addConflict: (conflict: Conflict) => void;
  resolveConflict: (conflictId: string, choice: "local" | "server") => Promise<void>;
  dismissConflict: (conflictId: string) => void;
  hasConflicts: boolean;
}

const ConflictContext = React.createContext<ConflictContextValue | null>(null);

// Module-level registry so non-React sync code can queue conflicts
let _externalAddConflict: ((conflict: Conflict) => void) | null = null;

export function ConflictProvider({ children }: { children: React.ReactNode }) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  // Register external queue callback when provider mounts
  useEffect(() => {
    _externalAddConflict = (conflict: Conflict) => {
      setConflicts((prev) => {
        if (prev.some((c) => c.id === conflict.id)) return prev;
        return [...prev, conflict];
      });
    };
    return () => { _externalAddConflict = null; };
  }, []);

  const addConflict = useCallback((conflict: Conflict) => {
    setConflicts((prev) => {
      if (prev.some((c) => c.id === conflict.id)) return prev;
      return [...prev, conflict];
    });
    _externalAddConflict?.(conflict);
  }, []);

  const resolveConflict = useCallback(async (conflictId: string, choice: "local" | "server") => {
    const conflict = conflicts.find((c) => c.id === conflictId);
    if (!conflict) {
      setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
      return;
    }

    try {
      const { getDb } = await import("@/lib/db");
      const db = getDb();
      const chosenData = choice === "local" ? conflict.localData : conflict.serverData;
      const table = entityTableForType(conflict.entityType);

      if (table && conflict.localId) {
        const sets = Object.keys(chosenData)
          .filter((k) => !CONFLICT_IGNORED_FIELDS.has(k))
          .map((k) => `${k} = ?`)
          .join(", ");
        const values = Object.keys(chosenData)
          .filter((k) => !CONFLICT_IGNORED_FIELDS.has(k))
          .map((k) => chosenData[k]);

        if (sets) {
          await db.runAsync(
            `UPDATE ${table} SET ${sets}, sync_action = 'none' WHERE local_id = ? OR id = ?`,
            [...(values as any[]), conflict.localId, conflict.localId]
          );
        }
      }
    } catch (e) {
      console.error("Failed to apply conflict resolution", e);
    }

    setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
  }, [conflicts]);

  const dismissConflict = useCallback((conflictId: string) => {
    setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
  }, []);

  return (
    <ConflictContext.Provider
      value={{
        conflicts,
        addConflict,
        resolveConflict,
        dismissConflict,
        hasConflicts: conflicts.length > 0,
      }}
    >
      {children}
    </ConflictContext.Provider>
  );
}

export function useConflict(): ConflictContextValue {
  const ctx = useContext(ConflictContext);
  if (!ctx) throw new Error("useConflict must be used within <ConflictProvider>");
  return ctx;
}

// ─── Conflict Detection ─────────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== (b as unknown[]).length) return false;
    return a.every((item, i) => deepEqual(item, (b as unknown[])[i]));
  }
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const CONFLICT_IGNORED_FIELDS = new Set([
  "id",
  "last_synced_at",
  "updated_at",
  "created_at",
  "sync_action",
  "status",
  "local_id",
]);

function entityTableForType(type: ConflictEntity): string {
  const map: Record<ConflictEntity, string> = {
    product: "products",
    sale: "sales",
    expense: "expenses",
    purchase: "purchases",
    debt: "debts",
  };
  return map[type] ?? "products";
}

export function detectConflict<T extends Record<string, unknown>>(
  localId: string,
  entityType: ConflictEntity,
  localData: T,
  serverData: T
): Conflict | null {
  const conflicts: ConflictEntry[] = [];

  const allKeys = new Set([...Object.keys(localData), ...Object.keys(serverData)]);
  for (const field of allKeys) {
    if (CONFLICT_IGNORED_FIELDS.has(field)) continue;
    const localValue = localData[field];
    const serverValue = serverData[field];
    if (!deepEqual(localValue, serverValue)) {
      conflicts.push({
        localId,
        entityType,
        localData,
        serverData,
        field,
        localValue,
        serverValue,
      });
    }
  }

  if (conflicts.length === 0) return null;

  return {
    id: `conflict_${entityType}_${localId}_${Date.now()}`,
    localId,
    entityType,
    localData,
    serverData,
    conflicts,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Queue a conflict from outside React (e.g. sync processor).
 * Must be called after ConflictProvider has mounted.
 */
export function queueExternalConflict(conflict: Conflict): void {
  _externalAddConflict?.(conflict);
}
