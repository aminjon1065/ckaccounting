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

  /**
   * Rename the contact on an existing debt. Only `person_name` is
   * editable — balance / direction / transaction history are derived
   * from the storeTransaction endpoint and not touched here.
   */
  update: (
    id: string,
    payload: { person_name: string; version?: number },
    token: string,
    idempotencyKey?: string,
  ) =>
    request<Debt>(`/debts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      token,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),

  /**
   * Soft-delete a debt. Owner / super_admin only — see ApiPermissionMatrix.
   * Transactions remain in the history; only the debt row gets a
   * `deleted_at` so reports keep their books straight.
   */
  delete: (id: string, token: string) =>
    request<void>(`/debts/${id}`, { method: "DELETE", token }),

  /**
   * Edit one transaction. Server recomputes the parent debt's balance
   * and direction against the resulting history.
   */
  updateTransaction: (
    debtId: string,
    transactionId: string,
    payload: { type: "give" | "take" | "repay"; amount: number; note?: string | null; version?: number },
    token: string,
    idempotencyKey?: string,
  ) =>
    request<Debt>(`/debts/${debtId}/transactions/${transactionId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      token,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),

  /**
   * Delete one transaction. Balance and direction recompute from
   * what's left.
   */
  deleteTransaction: (debtId: string, transactionId: string, token: string) =>
    request<Debt>(`/debts/${debtId}/transactions/${transactionId}`, {
      method: "DELETE",
      token,
    }),
};
