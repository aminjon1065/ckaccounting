// ─── API ──────────────────────────────────────────────────────────────────────

export const BACKEND_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "https://techdev.tj";
export const API_VERSION = "v1";
export const API_URL = `${BACKEND_URL}/api/${API_VERSION}`;

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const AUTH_ENDPOINTS = {
  login: "/auth/login",
  logout: "/auth/logout",
  me: "/auth/me",
} as const;

// ─── Storage keys ─────────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  authToken: "ck_auth_token",
  authUser: "ck_auth_user",
} as const;

// ─── App ──────────────────────────────────────────────────────────────────────

export const APP_NAME = "CK Accounting";

export const DEFAULT_CURRENCY = "UZS";

export const PAGINATION = {
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;

// ─── Timeouts ─────────────────────────────────────────────────────────────────

export const TIMEOUTS = {
  /** Default fetch timeout in ms */
  request: 15_000,
} as const;
