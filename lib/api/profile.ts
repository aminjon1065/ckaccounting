// ─── Profile (current user) endpoints ───────────────────────────────────────

import { request } from "./client";
import type { User } from "./auth";

export const profileApi = {
  update: (
    payload: { name?: string; email?: string; password?: string; current_password?: string },
    token: string
  ) =>
    request<User>("/profile", {
      method: "PATCH",
      body: JSON.stringify(payload),
      token,
    }),
};
