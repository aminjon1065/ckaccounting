// ─── Expenses endpoints ─────────────────────────────────────────────────────

import { request, qs } from "./client";
import type { Paginated } from "./types";

export interface Expense {
  id: string;
  name: string;
  quantity: number;
  price: number;
  total: number;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version?: number;
}

export interface CreateExpensePayload {
  name: string;
  quantity: number;
  price: number;
  note?: string;
}

export const expensesApi = {
  list: (
    token: string,
    params: { page?: number; limit?: number; updated_since?: string; updated_before?: string; cursor?: string } = {}
  ) =>
    request<Paginated<Expense>>(
      `/expenses${qs({ page: params.page, limit: params.limit ?? 20, updated_since: params.updated_since, updated_before: params.updated_before, cursor: params.cursor })}`,
      { token }
    ),

  get: (id: string, token: string) =>
    request<Expense>(`/expenses/${id}`, { token }),

  create: (payload: CreateExpensePayload, token: string, idempotencyKey?: string) =>
    request<Expense>("/expenses", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      token,
    }),

  update: (id: string, payload: Partial<CreateExpensePayload>, token: string) =>
    request<Expense>(`/expenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      token,
    }),

  delete: (id: string, token: string) =>
    request<void>(`/expenses/${id}`, { method: "DELETE", token }),
};
