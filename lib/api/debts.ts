// ─── Debts endpoints ────────────────────────────────────────────────────────

import { request, qs } from "./client";
import type { Paginated } from "./types";

export interface DebtTransaction {
  id: string;
  debt_id: string;
  type: "give" | "take" | "repay";
  amount: number;
  note: string | null;
  /** Display name of the user who logged this transaction. Server-populated. */
  created_by_name?: string | null;
  created_at: string;
}

export interface Debt {
  id: string;
  shop_id?: number;
  user_id?: number | null;
  /** Display name of the user who originally opened this debt record. */
  created_by_name?: string | null;
  person_name: string;
  opening_balance: number;
  balance: number;
  direction?: "receivable" | "payable";
  transactions?: DebtTransaction[];
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version?: number;
}

export interface CreateDebtPayload {
  person_name: string;
  shop_id?: number;
  direction?: "receivable" | "payable";
  opening_balance?: number;
}

export interface CreateDebtTransactionPayload {
  type: "give" | "take" | "repay";
  amount: number;
  note?: string;
}

export const debtsApi = {
  list: (
    token: string,
    params: { page?: number; limit?: number; after_id?: number; updated_since?: string; updated_before?: string; cursor?: string } = {}
  ) =>
    request<Paginated<Debt>>(
      `/debts${qs({ page: params.page, limit: params.limit ?? 20, after_id: params.after_id, updated_since: params.updated_since, updated_before: params.updated_before, cursor: params.cursor })}`,
      { token }
    ),

  get: (id: string, token: string) =>
    request<Debt>(`/debts/${id}`, { token }),

  create: (payload: CreateDebtPayload, token: string, idempotencyKey?: string) =>
    request<Debt>("/debts", {
      method: "POST",
      body: JSON.stringify(payload),
      token,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),

  addTransaction: (
    id: string,
    payload: CreateDebtTransactionPayload,
    token: string,
    idempotencyKey?: string
  ) =>
    request<Debt>(`/debts/${id}/transactions`, {
      method: "POST",
      body: JSON.stringify(payload),
      token,
      headers: idempotencyKey
        ? { "Idempotency-Key": idempotencyKey }
        : undefined,
    }),
};
