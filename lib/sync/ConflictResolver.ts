// ─── Field-type-aware conflict resolver ──────────────────────────────────────
//
// Implements automatic merge strategies per field type:
// - additive:    stock_quantity, pending_stock_delta — sum deltas
// - last-write-wins: name, sale_price, cost_price — server wins (owner-set)
// - max:          low_stock_alert — keep more conservative (higher) threshold
// - manual:       code, unit — human must resolve
//
// If ALL conflicts in a Conflict can be auto-resolved, returns the merged record.
// Otherwise returns null — the ConflictContext will show the manual modal.
//
// Usage:
//   const resolved = autoResolveConflict(localData, serverData, 'product');

type MergeStrategy = "additive" | "last-write-wins" | "max" | "manual";

const FIELD_STRATEGIES: Record<string, MergeStrategy> = {
  // Stock: additive — two devices both changed stock offline, sum the deltas
  stock_quantity: "additive",
  pending_stock_delta: "additive",
  // Prices: last-write-wins — server price (set by owner) supersedes
  sale_price: "last-write-wins",
  cost_price: "last-write-wins",
  // Thresholds: max — more conservative alert is safer
  low_stock_alert: "max",
  // Complex fields: manual resolution required
  name: "manual",
  code: "manual",
  unit: "manual",
  bulk_price: "manual",
  bulk_threshold: "manual",
};

function getStrategy(field: string): MergeStrategy {
  return FIELD_STRATEGIES[field] ?? "last-write-wins";
}

// Represents the base value — the value at the time of last sync.
// For additive merge: resolved = serverValue + (localValue - baseValue)
interface ConflictResolution {
  resolved: Record<string, unknown>;
  needsManual: boolean;
}

export function autoResolveConflict(
  localData: Record<string, unknown>,
  serverData: Record<string, unknown>,
  baseData: Record<string, unknown> | null,
  entityType: string
): { resolved: Record<string, unknown> } | null {
  const allKeys = new Set([
    ...Object.keys(localData),
    ...Object.keys(serverData),
  ]);

  const resolved: Record<string, unknown> = { ...serverData };
  let needsManual = false;

  for (const field of allKeys) {
    const localValue = localData[field];
    const serverValue = serverData[field];
    const baseValue = baseData?.[field] ?? null;

    // No conflict if values are equal
    if (localValue === serverValue) continue;

    const strategy = getStrategy(field);

    switch (strategy) {
      case "additive": {
        // delta = localValue - baseValue (change made locally since last sync)
        // resolved = serverValue + delta
        if (typeof localValue === "number" && typeof serverValue === "number") {
          const delta = baseValue !== null ? localValue - (baseValue as number) : 0;
          resolved[field] = serverValue + delta;
        } else {
          // Non-numeric or missing base — fall back to last-write-wins
          resolved[field] = serverValue;
        }
        break;
      }
      case "last-write-wins": {
        // Server wins (owner/admin controls prices, product names)
        resolved[field] = serverValue;
        break;
      }
      case "max": {
        // Keep the more conservative (numerically larger for alerts)
        if (typeof localValue === "number" && typeof serverValue === "number") {
          resolved[field] = Math.max(localValue, serverValue);
        } else {
          resolved[field] = serverValue ?? localValue;
        }
        break;
      }
      case "manual": {
        needsManual = true;
      }
    }
  }

  if (needsManual) return null;
  return { resolved };
}