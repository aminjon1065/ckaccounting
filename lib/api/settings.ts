// ─── Settings endpoints ─────────────────────────────────────────────────────

import { request, qs } from "./client";

export interface ShopSettings {
  default_currency: string;
  tax_percent: number;
}

export const settingsApi = {
  get: (token: string, shopId?: number) =>
    request<ShopSettings>(`/settings${qs({ shop_id: shopId })}`, { token }),

  update: (payload: Partial<ShopSettings>, token: string, shopId?: number) =>
    request<ShopSettings>(`/settings${qs({ shop_id: shopId })}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      token,
    }),
};
