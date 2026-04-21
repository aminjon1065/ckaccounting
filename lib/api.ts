import { API_URL, AUTH_ENDPOINTS, TIMEOUTS } from "@/constants/config";
import { triggerSuspension } from "@/store/suspension";
import { triggerTokenExpiry } from "@/lib/sync/TokenExpiryBridge";
import { attemptTokenRefresh } from "@/lib/sync/TokenRefreshBridge";

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

// ─── Shops ────────────────────────────────────────────────────────────────────

export interface Shop {
  id: number;
  name: string;
  is_active: boolean;
  owner_id?: number | null;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface CreateShopPayload {
  name: string;
  is_active?: boolean;
}

// ─── Products ─────────────────────────────────────────────────────────────────

export interface Product {
  id: number;
  shop_id: number;
  name: string;
  code: string | null;
  unit: string | null;
  cost_price: number;
  sale_price: number;
  pricing_mode: "fixed" | "markup" | "manual";
  markup_percent?: number | null;
  bulk_price?: number | null;
  bulk_threshold?: number | null;
  stock_quantity: number;
  low_stock_alert: number | null;
  photo_url: string | null;
  image_url?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version?: number;
}

export interface CreateProductPayload {
  name: string;
  code?: string;
  unit?: string;
  cost_price: number;
  sale_price?: number;
  pricing_mode?: "fixed" | "markup" | "manual";
  markup_percent?: number;
  bulk_price?: number;
  bulk_threshold?: number;
  stock_quantity: number;
  low_stock_alert?: number;
  shop_id?: number;
  version?: number;
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
  deleted_at?: string | null;
  version?: number;
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
  direction?: "receivable" | "payable";
  transactions?: DebtTransaction[];
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version?: number;
}

export interface CreateDebtPayload {
  person_name: string;
  direction?: "receivable" | "payable";
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
  deleted_at?: string | null;
}

export interface CreatePurchasePayload {
  supplier_name?: string;
  items: { product_id: number; quantity: number; price: number; markup_percent?: number }[];
}

// ─── Sales ────────────────────────────────────────────────────────────────────

export type SaleType = "product" | "service";

export interface SaleItem {
  id: number;
  product_id: number | null;
  name?: string | null;
  product_name: string | null;
  /** Populated for service-type sales */
  service_name?: string | null;
  unit?: string | null;
  quantity: number;
  price: number;
  total: number;
}

export interface Sale {
  id: number;
  type?: SaleType;
  customer_name: string | null;
  total: number;
  discount: number;
  paid: number;
  debt: number;
  payment_type: "cash" | "card" | "transfer";
  notes?: string | null;
  items: SaleItem[];
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  version?: number;
}

// Item shapes for the two sale types
export interface ProductSaleItemPayload {
  product_id: number;
  quantity: number;
  price?: number;
}

export interface ServiceSaleItemPayload {
  name: string;
  unit?: string;
  quantity: number;
  price: number;
}

export interface CreateSalePayload {
  type?: SaleType;
  customer_name?: string;
  discount?: number;
  paid?: number;
  notes?: string;
  shop_id?: number;
  payment_type: "cash" | "card" | "transfer";
  items: (ProductSaleItemPayload | ServiceSaleItemPayload)[];
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
  password?: string;
  role: "owner" | "seller" | "super_admin";
  shop_id?: number | null;
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
  data: { date: string; count: number; amount: number }[];
}

export interface ExpensesReport {
  total_amount: number;
  count: number;
  date_from: string;
  date_to: string;
  data: { date: string; count: number; amount: number }[];
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
  data: {
    id: number;
    name: string;
    stock_quantity: number;
    sale_price: number;
    value: number;
  }[];
}

// ─── Product Movement ─────────────────────────────────────────────────────────

export type ProductMovementType = "purchase" | "sale" | "write_off";

export interface ProductMovement {
  id: number;
  type: ProductMovementType;
  quantity: number;
  price: number;
  total: number;
  created_at: string;
  reference_id: number | null;
  reference_type: string | null;
  actor_name: string | null;
}

export interface ProductMovementsResponse {
  current_stock: number;
  movements: ProductMovement[];
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export type DashboardPeriod = "day" | "week" | "month" | "year" | "custom";

export interface LowStockItem {
  id: number;
  name: string;
  code: string;
  stock_quantity: number;
  low_stock_alert: number;
  unit?: string;
}

export interface RecentSaleItem {
  id: number;
  total: number;
  paid: number;
  debt: number;
  payment_type: "cash" | "card" | "transfer";
  created_at: string;
  customer_name?: string;
  actor_name?: string;
}

// Recent expense item on the dashboard
export interface RecentExpenseItem {
  id: number;
  name: string;
  total: number;
  created_at: string;
}

// Recent debt transaction on the dashboard
export interface RecentDebtTransactionItem {
  id: number;
  debt_id: number;
  person_name: string;
  amount: number;
  type: "give" | "take" | "repay";
  created_at: string;
}

// Unpaid/overdue debt summary item
export interface UnpaidDebtItem {
  id: number;
  person_name: string;
  balance: number;
  direction: "receivable" | "payable";
  created_at: string;
}

export interface DashboardSummary {
  period: DashboardPeriod;
  date_from: string;
  date_to: string;
  shop_id: number | null;
  period_sales_total: number;
  period_expenses_total: number;
  period_profit: number;
  period_cogs: number;
  debts_receivable: number;
  debts_payable: number;
  debts_net: number;
  stock_total_qty: number;
  stock_total_cost: number;
  stock_total_sales_value: number;
  low_stock_count: number;
  recent_sales: RecentSaleItem[];
  recent_expenses: RecentExpenseItem[];
  recent_debt_transactions: RecentDebtTransactionItem[];
  low_stock_products: LowStockItem[];
  unpaid_debts: UnpaidDebtItem[];
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

// ─── Retry helper ─────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000;

// Transient errors that should be retried vs permanent errors (4xx) that should not
function isRetryableStatus(status: number): boolean {
  return status === 0       // network error / no connection
    || status === 429       // rate limited
    || status === 502       // bad gateway
    || status === 503       // service unavailable
    || status === 504;      // gateway timeout
}

async function withRetry<T>(
  fn: () => Promise<T>,
  method: string,
  retries = MAX_RETRIES,
  tokenRef?: { current: string | undefined }
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && attempt < retries) {
        // On 401: attempt token refresh once, then retry with the new token
        if (err.status === 401 && tokenRef?.current && attempt === 0) {
          const newToken = await attemptTokenRefresh(tokenRef!.current);
          if (newToken) {
            // Update the shared token ref; fn() re-reads options.token each time
            tokenRef.current = newToken;
            try {
              return await fn();
            } catch (retryErr) {
              if (retryErr instanceof ApiError && isRetryableStatus(retryErr.status)) {
                await new Promise((r) => setTimeout(r, Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt), 30_000)));
                continue;
              }
              throw retryErr;
            }
          }
          // Refresh failed — fall through to normal error handling
        }
        // Don't retry 4xx errors — they are permanent failures (validation error, etc.)
        if (!isRetryableStatus(err.status)) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, Math.min(RETRY_BASE_DELAY * Math.pow(2, attempt), 30_000)));
        continue;
      }
      throw err;
    }
  }
  throw new ApiError("Retry exhausted", 0);
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

let lastServerTime: string | null = null;

export function getLastServerTime(): string | null {
  return lastServerTime;
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  // Use a holder object so withRetry can update the token after refresh.
  // The closure (fn) reads options.token each time, which will pick up the
  // updated holder.current after a token refresh.
  const tokenHolder = { current: options.token ?? undefined };
  const method = options.method ?? "GET";

  return withRetry(async () => {
    const { token: _token, headers: extraHeaders, ...rest } = options;

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(extraHeaders as Record<string, string>),
    };

    // Don't set Content-Type for FormData — React Native sets it automatically
    // with the correct multipart boundary. For all other bodies use JSON.
    if (!(rest.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    // Read from holder so retries after token refresh pick up the new token.
    if (tokenHolder.current) headers["Authorization"] = `Bearer ${tokenHolder.current}`;

    const controller = new AbortController();
    // Use longer timeout for photo uploads (FormData) vs regular JSON requests
    const isUpload = rest.body instanceof FormData;
    const timeout = isUpload ? TIMEOUTS.upload : TIMEOUTS.request;
    const timer = setTimeout(() => controller.abort(), timeout);

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
      // Signal token expiry — sync should stop and user should re-authenticate
      if (res.status === 401) {
        triggerTokenExpiry();
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

    // Capture server_time for sync high-water mark persistence
    if (json !== null && typeof json === "object" && "server_time" in json) {
      lastServerTime = (json as any).server_time as string;
    }

    // Auto-unwrap Laravel envelope: { success, message, data, [meta, links] }
    if (json !== null && typeof json === "object" && "success" in json) {
      // Paginated response: meta & links live at the TOP LEVEL alongside data
      // e.g. { success, message, data: [...], meta: { current_page, ... }, links: {...} }
      if ("meta" in json && json.meta != null) {
        const jsonAny = json as any;
        return {
          data: jsonAny.data ?? [],
          meta: jsonAny.meta,
          links: jsonAny.links ?? {},
        } as T;
      }

      // Single-object response: { success, message, data: { ... } }
      if ("data" in json && json.data !== undefined && json.data !== null) {
        return json.data as T;
      }
    }

    return json as T;
  }, method, MAX_RETRIES, tokenHolder);
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

    refresh: (token: string) =>
      request<{ token: string }>(AUTH_ENDPOINTS.refresh, {
        method: "POST",
        token,
      }),
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────
  dashboard: {
    summary: (period: DashboardPeriod, token: string, shopId?: number | null, dateFrom?: string, dateTo?: string) =>
      request<DashboardSummary>(
        `/dashboard?period=${period}${shopId ? `&shop_id=${shopId}` : ""}${dateFrom ? `&date_from=${dateFrom}` : ""}${dateTo ? `&date_to=${dateTo}` : ""}`,
        { token }
      ),
  },

  // ── Products ──────────────────────────────────────────────────────────────
  products: {
    list: (
      token: string,
      params: { page?: number; limit?: number; search?: string; shop_id?: number; after_id?: number; updated_since?: string; updated_before?: string; cursor?: string } = {}
    ) =>
      request<Paginated<Product>>(
        `/products${qs({ page: params.page, limit: params.limit ?? 20, search: params.search, shop_id: params.shop_id, after_id: params.after_id, updated_since: params.updated_since, updated_before: params.updated_before, cursor: params.cursor })}`,
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

    delete: (id: number, token: string, idempotencyKey?: string) =>
      request<void>(`/products/${id}`, {
        method: "DELETE",
        token,
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      }),

    movements: (id: number, token: string) =>
      request<ProductMovementsResponse>(`/products/${id}/movements`, { token }),
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

    create: (payload: CreateExpensePayload, token: string, idempotencyKey?: string) =>
      request<Expense>("/expenses", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
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
    list: (
      token: string,
      params: { page?: number; limit?: number; after_id?: number; updated_since?: string; updated_before?: string; cursor?: string } = {}
    ) =>
      request<Paginated<Debt>>(
        `/debts${qs({ page: params.page, limit: params.limit ?? 20, after_id: params.after_id, updated_since: params.updated_since, updated_before: params.updated_before, cursor: params.cursor })}`,
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

    create: (payload: CreatePurchasePayload, token: string, idempotencyKey?: string) =>
      request<Purchase>("/purchases", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
        token,
      }),
  },

  // ── Sales ─────────────────────────────────────────────────────────────────
  sales: {
    list: (
      token: string,
      params: { page?: number; limit?: number; after_id?: number; updated_since?: string; updated_before?: string; cursor?: string } = {}
    ) =>
      request<Paginated<Sale>>(
        `/sales${qs({ page: params.page, limit: params.limit ?? 20, after_id: params.after_id, updated_since: params.updated_since, updated_before: params.updated_before, cursor: params.cursor })}`,
        { token }
      ),

    get: (id: number, token: string) =>
      request<Sale>(`/sales/${id}`, { token }),

    create: (payload: CreateSalePayload, token: string, idempotencyKey?: string) =>
      request<Sale>("/sales", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
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

  // ─── Shops ──────────────────────────────────────────────────────────────────
  shops: {
    list: (token: string, params: { page?: number; limit?: number } = {}) =>
      request<Paginated<Shop>>(
        `/shops${qs({ page: params.page, limit: params.limit ?? 100 })}`,
        { token }
      ),

    get: (id: number, token: string) =>
      request<Shop>(`/shops/${id}`, { token }),

    create: (payload: CreateShopPayload, token: string) =>
      request<Shop>("/shops", {
        method: "POST",
        body: JSON.stringify(payload),
        token,
      }),

    update: (id: number, payload: Partial<CreateShopPayload>, token: string) =>
      request<Shop>(`/shops/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
        token,
      }),

    delete: (id: number, token: string) =>
      request<void>(`/shops/${id}`, { method: "DELETE", token }),
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
