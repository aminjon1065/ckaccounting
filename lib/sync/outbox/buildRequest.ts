// ─── Outbox request builder ─────────────────────────────────────────────────
//
// Prepare the fetch options for a single sync action: headers (auth +
// custom + idempotency), payload normalization (debt direction fixup,
// debt-transaction type fixup), client-meta stripping, and FormData for
// product photo uploads.
//
// The two debt-related fixups exist because the offline UX models debts
// with signed amounts (positive = receivable, negative = payable), but the
// server expects an unsigned amount + a `direction` discriminator and
// inverts the transaction type accordingly. Doing the conversion here
// keeps the offline UX clean and the server contract narrow.

import { API_URL } from "@/constants/config";
import { getDb, type SyncAction } from "../../db";
import { stripClientMeta } from "./helpers";

export interface BuiltRequest {
  url: string;
  options: RequestInit;
}

export async function buildOutboxRequest(action: SyncAction, authToken: string): Promise<BuiltRequest> {
  const baseHeaders = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${authToken}`,
    "Accept": "application/json",
  };

  let customHeaders: Record<string, string> = {};
  try {
    if (action.headers) customHeaders = JSON.parse(action.headers);
  } catch {}

  if (action.idempotency_key && !customHeaders["Idempotency-Key"]) {
    customHeaders["Idempotency-Key"] = action.idempotency_key;
  }

  const url = action.path.startsWith("http")
    ? action.path
    : `${API_URL}${action.path.startsWith("/") ? action.path : `/${action.path}`}`;

  const options: RequestInit = {
    method: action.method,
    headers: { ...baseHeaders, ...customHeaders },
  };

  let requestPayload: Record<string, unknown> = {};
  try {
    requestPayload = action.payload ? JSON.parse(action.payload) : {};
  } catch {}

  // Debt POST: server takes unsigned amount + direction discriminator.
  // Offline UX writes signed (positive = receivable, negative = payable);
  // convert at this boundary.
  if (action.method === "POST" && action.path === "/debts") {
    const openingBalance = Number(requestPayload.opening_balance ?? 0);
    if (Number.isFinite(openingBalance) && openingBalance < 0) {
      requestPayload.direction = "payable";
      requestPayload.opening_balance = Math.abs(openingBalance);
    }
  }

  // Debt-transaction POST: when the parent debt is payable, the offline
  // UX uses `take` for "I gave more"; the server's invariant flips the
  // semantics, so swap to `give` before shipping.
  if (action.method === "POST" && /\/debts\/[^/]+\/transactions$/.test(action.path)) {
    try {
      const debtUuid = action.path.match(/\/debts\/([^/]+)\/transactions$/)?.[1];
      const debt = await getDb().getFirstAsync<{ direction: string | null; balance: number | null; balance_kopecks: number | null }>(
        "SELECT direction, balance, balance_kopecks FROM debts WHERE id = ?",
        [debtUuid ?? ""]
      );
      const rawBalance = debt?.balance_kopecks != null
        ? debt.balance_kopecks / 100
        : Number(debt?.balance ?? 0);
      const isPayable = debt?.direction === "payable" || rawBalance < 0;
      if (isPayable && requestPayload.type === "take") {
        requestPayload.type = "give";
      }
    } catch {}
  }

  const serverPayload = stripClientMeta(requestPayload);

  try {
    if (requestPayload.photo_uri) {
      const formData = new FormData();
      // React Native accepts a `{ uri, type, name }` object as a FormData
      // value but the lib.dom.d.ts FormData typing only allows `Blob | string`.
      // Cast at the boundary; this is a well-known RN/TypeScript mismatch.
      formData.append("image", {
        uri: requestPayload.photo_uri,
        type: "image/jpeg",
        name: "photo.jpg",
      } as unknown as Blob);
      options.body = formData;
      delete (options.headers as Record<string, string>)["Content-Type"];
    } else {
      options.body = Object.keys(serverPayload).length > 0
        ? JSON.stringify(serverPayload)
        : action.payload;
    }
  } catch {
    options.body = action.payload;
  }

  return { url, options };
}
