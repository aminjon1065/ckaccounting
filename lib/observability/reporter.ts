// ─── Error / event reporter ────────────────────────────────────────────────────
//
// Single funnel for error and event reporting from the mobile app. Today
// it forwards to `console.error` / `console.warn` so devs see everything
// in Metro logs; production hookup (Sentry / Crashlytics / Bugsnag) plugs
// in by replacing the implementations of `reportError` / `reportMessage`
// without touching any callsite.
//
// Why the indirection now, before there's a live backend:
//   1. We get a consistent calling convention across the codebase
//      (always pass `context` — see the type — instead of free-form logs).
//   2. When a SaaS gets wired up, it's a one-file change. No grep-and-
//      replace through 50 callsites later.
//   3. Tests can mock the reporter via dependency-injection later (or via
//      Jest mocks once the test scaffold lands in 5.2).
//
// USAGE
//
//   import { reportError, reportMessage } from "@/lib/observability/reporter";
//
//   try { ... } catch (e) {
//     reportError(e, { tag: "outbox-processor", entityId: action.id });
//   }
//
//   reportMessage("circuit breaker tripped", "warning", { failures: 3 });

/**
 * Severity classes mirror Sentry's; the no-op implementation just maps
 * `error` → console.error and everything else → console.warn so dev
 * builds get appropriate stacktrace highlighting.
 */
export type ReporterSeverity = "fatal" | "error" | "warning" | "info" | "debug";

/**
 * Free-form key/value pairs attached to the event. Pick names that read
 * well as Sentry tags — short, kebab-case, descriptive (`tag`, `entity-id`,
 * `user-role`). Avoid PII; if you're tempted to attach a customer name or
 * email, attach an opaque ID instead.
 */
export type ReporterContext = Record<string, string | number | boolean | null | undefined>;

/**
 * Report a thrown error. The error is forwarded to `console.error` for
 * local visibility regardless of remote configuration. `context` is
 * stringified into a single log line so the dev console stays scannable.
 *
 * `error` is `unknown` because catch blocks in TypeScript receive
 * `unknown` by default; the function normalizes both Error instances and
 * non-Error rejections.
 */
export function reportError(error: unknown, context?: ReporterContext): void {
  // Normalize to an Error so consumers always get a stack trace.
  const normalized = error instanceof Error ? error : new Error(stringifyUnknown(error));
  if (context && Object.keys(context).length > 0) {
    console.error(`[reportError] ${normalized.message}`, context, normalized);
  } else {
    console.error(`[reportError] ${normalized.message}`, normalized);
  }
  // TODO(observability): once Sentry is configured, also call:
  //   Sentry.captureException(normalized, { tags: filterTags(context), extra: context });
}

/**
 * Report a non-error event — circuit breaker trips, sync skips, login
 * fallback paths, etc. Severity defaults to "warning" because most call
 * sites are noting something unusual rather than a crash.
 */
export function reportMessage(
  message: string,
  severity: ReporterSeverity = "warning",
  context?: ReporterContext
): void {
  const channel = severity === "error" || severity === "fatal" ? console.error : console.warn;
  if (context && Object.keys(context).length > 0) {
    channel(`[reportMessage:${severity}] ${message}`, context);
  } else {
    channel(`[reportMessage:${severity}] ${message}`);
  }
  // TODO(observability): once Sentry is configured, also call:
  //   Sentry.captureMessage(message, { level: severity, extra: context, tags: filterTags(context) });
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "Unknown error";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ─── Global handlers ─────────────────────────────────────────────────────────
//
// `installGlobalErrorHandlers()` wires the reporter into RN's two top-level
// catch points:
//
//   1. `ErrorUtils.setGlobalHandler` — uncaught synchronous JS errors that
//      escape every component's try/catch + ErrorBoundary. Without this they
//      crash the JS thread and we never see them in production logs.
//
//   2. `process.on("unhandledRejection")` — promise rejections with no
//      .catch handler. RN polyfills `process` in modern versions; we guard
//      against environments where it isn't present.
//
// We CHAIN the previous handlers instead of replacing them so RN's own red-
// box / LogBox still triggers in dev. The reporter sees the error first;
// RN's default behaviour runs after.
//
// Call once at app startup (root layout). Re-calling is safe — installation
// is idempotent.

let _installed = false;

interface ErrorUtilsLike {
  getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
  setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
}

declare const ErrorUtils: ErrorUtilsLike | undefined;

export function installGlobalErrorHandlers(): void {
  if (_installed) return;
  _installed = true;

  if (typeof ErrorUtils !== "undefined" && ErrorUtils?.setGlobalHandler) {
    const prev = ErrorUtils.getGlobalHandler?.();
    ErrorUtils.setGlobalHandler((error, isFatal) => {
      reportError(error, {
        tag: "global-error-handler",
        fatal: !!isFatal,
      });
      // Chain to RN's red-box so dev experience stays intact.
      prev?.(error, isFatal);
    });
  }

  // Promise rejection handler. Available on `process` in modern RN.
  const proc = (globalThis as { process?: { on?: (event: string, cb: (...args: unknown[]) => void) => void } }).process;
  if (proc?.on) {
    proc.on("unhandledRejection", (reason: unknown) => {
      reportError(reason, { tag: "unhandled-rejection" });
    });
  }
}
