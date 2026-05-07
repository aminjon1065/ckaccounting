// ─── Products endpoints ─────────────────────────────────────────────────────
//
// Includes asset-URL resolution (`resolveBackendAssetUrl`) and
// product-image normalizers used by every list/get/create/update path
// to canonicalize the various shapes the backend has historically returned
// (top-level `photo_url`, nested `image` object, array of media, etc.).

import { BACKEND_URL } from "@/constants/config";
import { request, qs } from "./client";
import type { Paginated } from "./types";

export interface Product {
  id: string;
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
  id?: string;
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

export type ProductMovementType = "purchase" | "sale" | "return" | "write_off";

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
  next_cursor: string | null;
}

// ─── Asset URL helpers ──────────────────────────────────────────────────────

export function resolveBackendAssetUrl(url?: string | null): string | null {
  if (!url) return null;

  const base = BACKEND_URL.replace(/\/+$/, "");

  if (/^(file:|content:|data:|blob:)/i.test(url)) {
    return url;
  }

  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith("/storage/")) {
        try {
          const configuredBackend = new URL(base);
          if (parsed.origin !== configuredBackend.origin) {
            return `${base}${parsed.pathname}${parsed.search}`;
          }
        } catch {
          return `${base}${parsed.pathname}${parsed.search}`;
        }
      }
    } catch {
      return url;
    }

    return url;
  }

  const path = url.startsWith("/") ? url : `/${url}`;
  return `${base}${path}`;
}

function extractImageUrlFromValue(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractImageUrlFromValue(item);
      if (nested) return nested;
    }
    return null;
  }

  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    return extractImageUrlFromValue(
      candidate.url ??
      candidate.uri ??
      candidate.path ??
      candidate.src ??
      candidate.original_url ??
      candidate.preview_url ??
      candidate.image_url ??
      candidate.photo_url ??
      candidate.media_url ??
      candidate.file
    );
  }

  return null;
}

function normalizeProductImageUrls(product: Product): Product {
  const rawProduct = product as Product & Record<string, unknown>;
  const imageCandidate =
    extractImageUrlFromValue(rawProduct.photo_url) ??
    extractImageUrlFromValue(rawProduct.image_url) ??
    extractImageUrlFromValue(rawProduct.photo) ??
    extractImageUrlFromValue(rawProduct.image) ??
    extractImageUrlFromValue(rawProduct.image_path) ??
    extractImageUrlFromValue(rawProduct.photo_path) ??
    extractImageUrlFromValue(rawProduct.media_url) ??
    extractImageUrlFromValue(rawProduct.thumbnail_url) ??
    extractImageUrlFromValue(rawProduct.media) ??
    extractImageUrlFromValue(rawProduct.images);
  const imageUrl = resolveBackendAssetUrl(imageCandidate);
  return {
    ...product,
    photo_url: imageUrl,
    image_url: imageUrl,
  };
}

function normalizeProductsPage(page: Paginated<Product>): Paginated<Product> {
  return {
    ...page,
    data: page.data.map(normalizeProductImageUrls),
  };
}

// ─── Photo upload FormData ──────────────────────────────────────────────────

function buildProductFormData(
  payload: Partial<CreateProductPayload>,
  photoUri: string
): FormData {
  const fd = new FormData();
  Object.entries(payload).forEach(([k, v]) => {
    if (v !== undefined && v !== null) fd.append(k, String(v));
  });
  fd.append("image", {
    uri: photoUri,
    name: "product.jpg",
    type: "image/jpeg",
  } as unknown as Blob);
  return fd;
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export const productsApi = {
  list: (
    token: string,
    params: { page?: number; limit?: number; search?: string; shop_id?: number; after_id?: number; updated_since?: string; updated_before?: string; cursor?: string } = {}
  ) =>
    request<Paginated<Product>>(
      `/products${qs({ page: params.page, limit: params.limit ?? 20, search: params.search, shop_id: params.shop_id, after_id: params.after_id, updated_since: params.updated_since, updated_before: params.updated_before, cursor: params.cursor })}`,
      { token }
    ).then(normalizeProductsPage),

  get: (id: string, token: string) =>
    request<Product>(`/products/${id}`, { token }).then(normalizeProductImageUrls),

  create: (payload: CreateProductPayload, token: string, photoUri?: string) =>
    request<Product>("/products", {
      method: "POST",
      body: photoUri
        ? buildProductFormData(payload, photoUri)
        : JSON.stringify(payload),
      token,
    }).then(normalizeProductImageUrls),

  update: (id: string, payload: Partial<CreateProductPayload>, token: string, photoUri?: string) =>
    request<Product>(`/products/${id}`, {
      method: "PATCH",
      body: photoUri
        ? buildProductFormData(payload, photoUri)
        : JSON.stringify(payload),
      token,
    }).then(normalizeProductImageUrls),

  delete: (id: string, token: string, idempotencyKey?: string) =>
    request<void>(`/products/${id}`, {
      method: "DELETE",
      token,
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    }),

  movements: (id: string, token: string, params: { cursor?: string; limit?: number } = {}) =>
    request<ProductMovementsResponse>(
      `/products/${id}/movements${qs({ cursor: params.cursor, limit: params.limit })}`,
      { token }
    ),
};
