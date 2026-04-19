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
  refresh: "/auth/refresh",
} as const;

// ─── Storage keys ─────────────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  authToken: "ck_auth_token",
  authUser: "ck_auth_user",
  authCredentials: "ck_auth_credentials", // { email, password } stored after first login
  authPin: "ck_auth_pin", // SHA-256 hash of PIN
  authPinSalt: "ck_auth_pin_salt", // random salt for PIN hashing
  authPasswordHash: "ck_auth_password_hash", // hash of password for offline login
  authPasswordSalt: "ck_auth_password_salt", // random salt for password hashing
} as const;

// ─── App ──────────────────────────────────────────────────────────────────────

export const APP_NAME = "CK Accounting";

export const DEFAULT_CURRENCY = "SMN";

export const PAGINATION = {
  defaultPageSize: 20,
  maxPageSize: 100,
} as const;

// ─── Timeouts ─────────────────────────────────────────────────────────────────

export const TIMEOUTS = {
  /** Default fetch timeout in ms */
  request: 15_000,
  /** Timeout for photo uploads (larger payloads over slow connections) */
  upload: 120_000,
} as const;
