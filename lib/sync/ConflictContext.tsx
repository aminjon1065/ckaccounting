import React, { useContext, useEffect, useState, useCallback } from "react";

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
let _pendingConflicts: Conflict[] = [];

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
    // Drain pending conflicts buffered before this provider mounted
    const pending = _pendingConflicts.splice(0);
    for (const c of pending) _externalAddConflict!(c);
    return () => { _externalAddConflict = null; };
  }, []);

  const addConflict = useCallback((conflict: Conflict) => {
    // Only notify the external handler — it deduplicates and updates state.
    // Do NOT call setConflicts here to avoid double-updating state.
    _externalAddConflict?.(conflict);
  }, []);

  const resolveConflict = useCallback(async (conflictId: string, choice: "local" | "server") => {
    const conflict = conflicts.find((c) => c.id === conflictId);
    if (!conflict) {
      setConflicts((prev) => prev.filter((c) => c.id !== conflictId));
      return;
    }

    try {
      const { getDb, queueSyncAction } = await import("@/lib/db");
      const db = getDb();
      const chosenData = choice === "local" ? conflict.localData : conflict.serverData;
      const table = entityTableForType(conflict.entityType);

      if (table && conflict.localId) {
        const sanitized = sanitizeSets(conflict.entityType, chosenData);
        if (sanitized) {
          if (choice === "server") {
            // Server wins: overwrite local row and mark as clean
            await db.runAsync(
              `UPDATE ${table} SET ${sanitized.sets}, sync_action = 'none' WHERE local_id = ? OR id = ?`,
              [...(sanitized.values as (string | number | null | boolean)[]), conflict.localId, conflict.localId]
            );
            if (conflict.entityType === "product") {
              await db.runAsync(
                "UPDATE products SET pending_stock_delta = 0 WHERE local_id = ? OR id = ?",
                [conflict.localId, conflict.localId]
              );
            }
          } else {
            // Local wins: keep local data, mark as dirty, re-queue PATCH to server
            await db.runAsync(
              `UPDATE ${table} SET ${sanitized.sets}, sync_action = 'update' WHERE local_id = ? OR id = ?`,
              [...(sanitized.values as (string | number | null | boolean)[]), conflict.localId, conflict.localId]
            );

            // Re-queue PATCH so the local version gets pushed to the server.
            // Use the server's real ID if available, otherwise fall back to localId.
            const serverId = conflict.serverData.id ?? conflict.localId;
            const entityPath = entityPathForType(conflict.entityType);
            const patchPayload = {
              ...sanitizePatchPayload(conflict.entityType, conflict.localData, conflict.serverData),
              _local_id: conflict.localId,
            };
            const idempotencyKey = `conflict-resolve-local-${conflict.id}`;
            await queueSyncAction(
              "PATCH",
              `${entityPath}/${serverId}`,
              patchPayload,
              undefined,
              idempotencyKey
            );
          }
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

// Valid updatable columns per entity — anything not in this set is rejected
const VALID_COLUMNS: Record<ConflictEntity, Set<string>> = {
  product: new Set([
    "name", "code", "unit", "cost_price", "sale_price", "pricing_mode",
    "markup_percent", "bulk_price", "bulk_threshold", "stock_quantity",
    "low_stock_alert", "photo_url", "version",
  ]),
  sale: new Set([
    "customer_name", "type", "total", "discount", "paid", "debt",
    "payment_type", "notes", "items",
  ]),
  expense: new Set([
    "name", "quantity", "price", "total", "note",
  ]),
  purchase: new Set([
    "supplier_name", "total", "items",
  ]),
  debt: new Set([
    "person_name", "opening_balance", "balance", "direction",
  ]),
};

function sanitizeSets(entityType: ConflictEntity, data: Record<string, unknown>): { sets: string; values: unknown[] } | null {
  const valid = VALID_COLUMNS[entityType];
  if (!valid) return null;

  const entries = Object.keys(data)
    .filter((k) => !CONFLICT_IGNORED_FIELDS.has(k) && valid.has(k))
    .map((k) => ({ k, v: data[k] }));

  if (entries.length === 0) return null;

  return {
    sets: entries.map(({ k }) => `${k} = ?`).join(", "),
    values: entries.map(({ v }) => v),
  };
}

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

function entityPathForType(type: ConflictEntity): string {
  const map: Record<ConflictEntity, string> = {
    product: "/products",
    sale: "/sales",
    expense: "/expenses",
    purchase: "/purchases",
    debt: "/debts",
  };
  return map[type] ?? "/products";
}

/** Build a safe PATCH payload from local data using only the valid columns for this entity.
 *  Also include the server's version so the PATCH is accepted (server accepts if client
 *  version matches its own, then increments — this prevents a repeat 409 on re-submit).
 */
function sanitizePatchPayload(
  entityType: ConflictEntity,
  data: Record<string, unknown>,
  serverData: Record<string, unknown>
): Record<string, unknown> {
  const valid = VALID_COLUMNS[entityType];
  if (!valid) return {};
  const base = Object.fromEntries(
    Object.entries(data).filter(([k]) => valid.has(k))
  );
  // Include server version so server accepts the PATCH without a second 409.
  if (serverData && typeof serverData === "object" && "version" in serverData) {
    base.version = serverData.version;
  }
  return base;
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
  if (_externalAddConflict) {
    _externalAddConflict(conflict);
  } else {
    _pendingConflicts.push(conflict);
  }
}
