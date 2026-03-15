import { API_URL, AUTH_ENDPOINTS, TIMEOUTS } from "@/constants/config";
import { triggerSuspension } from "@/store/suspension";

const BASE_URL = API_URL;

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface User {
  id: number;
  name: string;
  email: string;
  role: "super_admin" | "owner" | "seller";
  shop_id?: number;
  shop_name?: string;
}

export interface LoginPayload {
  email: string;
  password: string;
  device_name: string;
}

export interface LoginResponse {
  token: string;
  token_type: string;
  user: User;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedMeta {
  current_page: number;
  from: number;
  last_page: number;
  per_page: number;
  to: number;
  total: number;
}

export interface Paginated<T> {
  data: T[];
  links: { first: string; last: string; prev: string | null; next: string | null };
  meta: PaginatedMeta;
}

// ─── Products ─────────────────────────────────────────────────────────────────

export interface Product {
  id: number;
  name: string;
  code: string | null;
  unit: string | null;
  cost_price: number;
  sale_price: number;
  stock_quantity: number;
  low_stock_alert: number | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProductPayload {
  name: string;
  code?: string;
  unit?: string;
  cost_price: number;
  sale_price: number;
  stock_quantity: number;
  low_stock_alert?: number;
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export interface Expense {
  id: number;
  name: string;
  quantity: number;
  price: number;
  total: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateExpensePayload {
  name: string;
  quantity: number;
  price: number;
  note?: string;
}

// ─── Debts ────────────────────────────────────────────────────────────────────

export interface DebtTransaction {
  id: number;
  debt_id: number;
  type: "give" | "take" | "repay";
  amount: number;
  note: string | null;
  created_at: string;
}

export interface Debt {
  id: number;
  person_name: string;
  opening_balance: number;
  balance: number;
  transactions?: DebtTransaction[];
  created_at: string;
  updated_at: string;
}

export interface CreateDebtPayload {
  person_name: string;
  opening_balance?: number;
}

export interface CreateDebtTransactionPayload {
  type: "give" | "take" | "repay";
  amount: number;
  note?: string;
}

// ─── Purchases ────────────────────────────────────────────────────────────────

export interface PurchaseItem {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface Purchase {
  id: number;
  supplier_name: string | null;
  total: number;
  items: PurchaseItem[];
  created_at: string;
  updated_at: string;
}

export interface CreatePurchasePayload {
  supplier_name?: string;
  items: Array<{ product_id: number; quantity: number; price: number }>;
}

// ─── Sales ────────────────────────────────────────────────────────────────────

export interface SaleItem {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  price: number;
  total: number;
}

export interface Sale {
  id: number;
  customer_name: string | null;
  total: number;
  discount: number;
  paid: number;
  debt: number;
  payment_type: "cash" | "card" | "transfer";
  items: SaleItem[];
  created_at: string;
  updated_at: string;
}

export interface CreateSalePayload {
  customer_name?: string;
  discount?: number;
  paid?: number;
  payment_type: "cash" | "card" | "transfer";
  items: Array<{ product_id: number; quantity: number; price?: number }>;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface ShopSettings {
  default_currency: string;
  tax_percent: number;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface AppUser {
  id: number;
  name: string;
  email: string;
  role: "owner" | "seller";
  shop_id: number;
  created_at: string;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: "owner" | "seller";
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export interface SalesReport {
  total_sales: number;
  total_amount: number;
  cash: number;
  card: number;
  transfer: number;
  date_from: string;
  date_to: string;
  data: Array<{ date: string; count: number; amount: number }>;
}

export interface ExpensesReport {
  total_amount: number;
  count: number;
  date_from: string;
  date_to: string;
  data: Array<{ date: string; count: number; amount: number }>;
}

export interface ProfitReport {
  total_sales: number;
  total_expenses: number;
  total_cost: number;
  profit: number;
  date_from: string;
  date_to: string;
}

export interface StockReport {
  total_products: number;
  total_value: number;
  low_stock: number;
  out_of_stock: number;
  data: Array<{
    id: number;
    name: string;
    stock_quantity: number;
    sale_price: number;
    value: number;
  }>;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export type DashboardPeriod = "day" | "week" | "month";

export interface DashboardStats {
  total_sales: number;
  total_expenses: number;
  profit: number;
  inventory_value: number;
  sales_change: number;
  expenses_change: number;
  profit_change: number;
  sales_count: number;
}

export interface LowStockItem {
  id: number;
  name: string;
  code: string;
  stock: number;
  low_stock_alert: number;
  unit: string;
}

export interface RecentSaleItem {
  id: number;
  total: number;
  paid: number;
  debt: number;
  payment_method: "cash" | "card" | "transfer";
  created_at: string;
  customer_name?: string;
}

export interface DashboardSummary {
  stats: DashboardStats;
  low_stock: LowStockItem[];
  recent_sales: RecentSaleItem[];
}

// ─── Error ────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errors?: Record<string, string[]>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, headers: extraHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(extraHeaders as Record<string, string>),
  };

  // Don't set Content-Type for FormData — React Native sets it automatically
  // with the correct multipart boundary. For all other bodies use JSON.
  if (!(rest.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUTS.request);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...rest,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError("Превышено время ожидания. Проверьте соединение.", 0);
    }
    throw new ApiError("Нет соединения с сервером. Проверьте интернет.", 0);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Signal the React tree if the shop has been suspended
    if (res.status === 403) {
      triggerSuspension();
    }
    throw new ApiError(
      body.message ?? `Request failed with status ${res.status}`,
      res.status,
      body.errors
    );
  }

  if (res.status === 204) return undefined as T;

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError("Некорректный ответ сервера.", res.status);
  }

  // Auto-unwrap Laravel envelope: { success, message, data, [meta, links] }
  if (json !== null && typeof json === "object" && "success" in json) {
    // Paginated response: meta & links live at the TOP LEVEL alongside data
    // e.g. { success, message, data: [...], meta: { current_page, ... }, links: {...} }
    if ("meta" in json && json.meta != null) {
      return {
        data: json.data ?? [],
        meta: json.meta,
        links: json.links ?? {},
      } as T;
    }

    // Single-object response: { success, message, data: { ... } }
    if ("data" in json && json.data !== undefined && json.data !== null) {
      return json.data as T;
    }
  }

  return json as T;
}

// ─── Query builder ────────────────────────────────────────────────────────────

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

// ─── Product photo FormData builder ───────────────────────────────────────────

function buildProductFormData(
  payload: Partial<CreateProductPayload>,
  photoUri: string
): FormData {
  const fd = new FormData();
  Object.entries(payload).forEach(([k, v]) => {
    if (v !== undefined && v !== null) fd.append(k, String(v));
  });
  fd.append("photo", {
    uri: photoUri,
    name: "product.jpg",
    type: "image/jpeg",
  } as unknown as Blob);
  return fd;
}

// ─── API namespace ────────────────────────────────────────────────────────────

export const api = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  auth: {
    login: (payload: LoginPayload) =>
      request<LoginResponse>(AUTH_ENDPOINTS.login, {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    me: (token: string) => request<User>(AUTH_ENDPOINTS.me, { token }),

    logout: (token: string) =>
      request<void>(AUTH_ENDPOINTS.logout, { method: "POST", token }),
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────
  dashboard: {
    summary: (period: DashboardPeriod, token: string) =>
      request<DashboardSummary>(`/dashboard?period=${period}`, { token }),
  },

  // ── Products ──────────────────────────────────────────────────────────────
  products: {
    list: (
      token: string,
      params: { page?: number; limit?: number; search?: string } = {}
    ) =>
      request<Paginated<Product>>(
        `/products${qs({ page: params.page, limit: params.limit ?? 20, search: params.search })}`,
        { token }
      ),

    get: (id: number, token: string) =>
      request<Product>(`/products/${id}`, { token }),

    create: (payload: CreateProductPayload, token: string, photoUri?: string) =>
      request<Product>("/products", {
        method: "POST",
        body: photoUri
          ? buildProductFormData(payload, photoUri)
          : JSON.stringify(payload),
        token,
      }),

    update: (id: number, payload: Partial<CreateProductPayload>, token: string, photoUri?: string) =>
      request<Product>(`/products/${id}`, {
        method: "PATCH",
        body: photoUri
          ? buildProductFormData(payload, photoUri)
          : JSON.stringify(payload),
        token,
      }),

    delete: (id: number, token: string) =>
      request<void>(`/products/${id}`, { method: "DELETE", token }),
  },

  // ── Expenses ──────────────────────────────────────────────────────────────
  expenses: {
    list: (
      token: string,
      params: { page?: number; limit?: number } = {}
    ) =>
      request<Paginated<Expense>>(
        `/expenses${qs({ page: params.page, limit: params.limit ?? 20 })}`,
        { token }
      ),

    get: (id: number, token: string) =>
      request<Expense>(`/expenses/${id}`, { token }),

    create: (payload: CreateExpensePayload, token: string) =>
      request<Expense>("/expenses", {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }),

    update: (id: number, payload: Partial<CreateExpensePayload>, token: string) =>
      request<Expense>(`/expenses/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
        token,
      }),

    delete: (id: number, token: string) =>
      request<void>(`/expenses/${id}`, { method: "DELETE", token }),
  },

  // ── Debts ─────────────────────────────────────────────────────────────────
  debts: {
    list: (token: string, params: { page?: number; limit?: number } = {}) =>
      request<Paginated<Debt>>(
        `/debts${qs({ page: params.page, limit: params.limit ?? 20 })}`,
        { token }
      ),

    get: (id: number, token: string) =>
      request<Debt>(`/debts/${id}`, { token }),

    create: (payload: CreateDebtPayload, token: string) =>
      request<Debt>("/debts", {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }),

    addTransaction: (
      id: number,
      payload: CreateDebtTransactionPayload,
      token: string
    ) =>
      request<DebtTransaction>(`/debts/${id}/transactions`, {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }),
  },

  // ── Purchases ─────────────────────────────────────────────────────────────
  purchases: {
    list: (token: string, params: { page?: number; limit?: number } = {}) =>
      request<Paginated<Purchase>>(
        `/purchases${qs({ page: params.page, limit: params.limit ?? 20 })}`,
        { token }
      ),

    get: (id: number, token: string) =>
      request<Purchase>(`/purchases/${id}`, { token }),

    create: (payload: CreatePurchasePayload, token: string) =>
      request<Purchase>("/purchases", {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }),
  },

  // ── Sales ─────────────────────────────────────────────────────────────────
  sales: {
    list: (token: string, params: { page?: number; limit?: number } = {}) =>
      request<Paginated<Sale>>(
        `/sales${qs({ page: params.page, limit: params.limit ?? 20 })}`,
        { token }
      ),

    get: (id: number, token: string) =>
      request<Sale>(`/sales/${id}`, { token }),

    create: (payload: CreateSalePayload, token: string) =>
      request<Sale>("/sales", {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }),
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get: (token: string) => request<ShopSettings>("/settings", { token }),

    update: (payload: Partial<ShopSettings>, token: string) =>
      request<ShopSettings>("/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
        token,
      }),
  },

  // ── Reports ───────────────────────────────────────────────────────────────
  reports: {
    sales: (
      token: string,
      params: { date_from?: string; date_to?: string } = {}
    ) => request<SalesReport>(`/reports/sales${qs(params)}`, { token }),

    expenses: (
      token: string,
      params: { date_from?: string; date_to?: string } = {}
    ) => request<ExpensesReport>(`/reports/expenses${qs(params)}`, { token }),

    profit: (
      token: string,
      params: { date_from?: string; date_to?: string } = {}
    ) => request<ProfitReport>(`/reports/profit${qs(params)}`, { token }),

    stock: (
      token: string,
      params: { date_from?: string; date_to?: string } = {}
    ) => request<StockReport>(`/reports/stock${qs(params)}`, { token }),
  },

  // ── Users ─────────────────────────────────────────────────────────────────
  users: {
    list: (token: string) => request<AppUser[]>("/users", { token }),

    create: (payload: CreateUserPayload, token: string) =>
      request<AppUser>("/users", {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }),

    update: (id: number, payload: Partial<CreateUserPayload>, token: string) =>
      request<AppUser>(`/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
        token,
      }),

    delete: (id: number, token: string) =>
      request<void>(`/users/${id}`, { method: "DELETE", token }),
  },

  // ── Profile (current user) ─────────────────────────────────────────────────
  profile: {
    update: (
      payload: { name?: string; email?: string; password?: string; current_password?: string },
      token: string
    ) =>
      request<User>("/profile", {
        method: "PATCH",
        body: JSON.stringify(payload),
        token,
      }),
  },
};

// ─── Kept for backward compat ─────────────────────────────────────────────────
/** @deprecated request() now auto-unwraps the Laravel envelope */
export function unwrapData<T>(response: { data?: T } & Partial<T>): T {
  return (response.data ?? response) as T;
}
