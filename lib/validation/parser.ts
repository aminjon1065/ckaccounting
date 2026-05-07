// ─── Runtime schema parsing on the API + SQL boundary ─────────────────────────
//
// `as Type` casts in TypeScript are unchecked at runtime — if the server
// (or a SQLite row written by an old code path) hands us a shape that
// doesn't match what the type claims, the cast silently goes through and
// the bug surfaces somewhere downstream as `undefined.foo` or NaN.
//
// `parseOrLog` runs every payload through a Zod schema and:
//   • on success, returns the parsed value (refined types — Zod can
//     normalize / coerce / strip).
//   • on failure, ships a structured error to the observability reporter
//     and falls back to the raw value cast to T. The fallback keeps
//     existing UX flowing while production gets a Sentry alert that
//     points at the exact field mismatch.
//
// This is intentionally non-throwing. The audit found the app silently
// trusting server data; throwing on every mismatch would over-correct,
// turning every server-side schema rollout into a hard crash. The right
// middle ground: log loud, fail soft, fix forward.

import type { ZodType } from "zod";
import { reportMessage } from "@/lib/observability/reporter";

export interface ParseContext {
  /** Short kebab-case identifier, e.g. "sales-list" or "products-get". */
  tag: string;
  /** Optional extra context attached to the report (URL, request id, etc.). */
  extra?: Record<string, string | number | boolean | null | undefined>;
}

export function parseOrLog<T>(schema: ZodType<T>, value: unknown, ctx: ParseContext): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  // Compose a flat summary of the first few issues. Zod gives one row per
  // problem; trimming keeps the log readable in the common case where
  // many fields shift in lockstep (e.g. server renamed a nested object).
  const issues = result.error.issues.slice(0, 5).map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));

  reportMessage(`Schema mismatch: ${ctx.tag}`, "warning", {
    tag: ctx.tag,
    issueCount: result.error.issues.length,
    firstIssues: JSON.stringify(issues),
    ...ctx.extra,
  });

  // Soft fallback: cast the raw value through. Downstream code keeps
  // working with whatever shape it actually got; this is intentional —
  // see the file header for why.
  return value as T;
}
