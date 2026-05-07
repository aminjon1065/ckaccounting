// ─── TokenRefreshBridge regression suite ────────────────────────────────────
//
// Auth-critical glue. A bug here either:
//   • Bounces the user to /login mid-session because we falsely trip the
//     circuit on a transient 401, OR
//   • Lets a dead session hammer /auth/refresh in a tight loop, amplifying
//     a backend outage and burning the user's data plan.
//
// The suite locks down:
//   • Single-flight — N concurrent attempts share ONE in-flight refresh.
//   • Circuit breaker — 3 failures inside the 5-minute window trips it;
//     a single failure outside the window does NOT carry over.
//   • Expiry latch — `triggerTokenExpiry` fires exactly once per terminal
//     event, not on every subsequent attempt.
//   • Reset semantics — `resetTokenRefreshState` clears every counter,
//     latch, and in-flight handle so a fresh login starts clean.
//
// The bridge has module-level mutable state, so each `describe` calls
// `resetTokenRefreshState()` + `unregisterForTest()` in `beforeEach`.

import { reportError, reportMessage } from "@/lib/observability/reporter";

jest.mock("@/lib/observability/reporter", () => ({
  reportError: jest.fn(),
  reportMessage: jest.fn(),
}));

const mockTriggerTokenExpiry = jest.fn();
jest.mock("../TokenExpiryBridge", () => ({
  triggerTokenExpiry: () => mockTriggerTokenExpiry(),
}));

import {
  attemptTokenRefresh,
  isTokenRefreshHandlerRegistered,
  registerTokenRefreshHandler,
  resetTokenRefreshState,
} from "../TokenRefreshBridge";

// The bridge has no `unregister` API in production — there's never a
// reason to. For tests we need to clear the registration so the
// "handler not registered" branch can be exercised; we re-register
// `_getToken`/`_refreshToken`/`_setToken` to throwers that fail loudly
// if called, and rely on `isTokenRefreshHandlerRegistered` being false
// after we manually register `null`-returning handlers (which the bridge
// considers registered). To exercise the unregistered branch we delete
// the require cache entry between describe blocks.
function freshBridgeImport() {
  jest.resetModules();
  jest.doMock("@/lib/observability/reporter", () => ({
    reportError: jest.fn(),
    reportMessage: jest.fn(),
  }));
  jest.doMock("../TokenExpiryBridge", () => ({
    triggerTokenExpiry: () => mockTriggerTokenExpiry(),
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../TokenRefreshBridge") as typeof import("../TokenRefreshBridge");
}

describe("TokenRefreshBridge — registration", () => {
  beforeEach(() => {
    resetTokenRefreshState();
  });

  it("reports unregistered until the handler is wired", () => {
    const bridge = freshBridgeImport();
    expect(bridge.isTokenRefreshHandlerRegistered()).toBe(false);
  });

  it("reports registered after registerTokenRefreshHandler", () => {
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: async () => ({ token: "new" }),
      setToken: async () => {},
    });
    expect(isTokenRefreshHandlerRegistered()).toBe(true);
  });

  it("fires expiry once when called without a registered handler", async () => {
    const bridge = freshBridgeImport();
    mockTriggerTokenExpiry.mockClear();

    const result1 = await bridge.attemptTokenRefresh("any");
    const result2 = await bridge.attemptTokenRefresh("any");

    expect(result1).toBeNull();
    expect(result2).toBeNull();
    // Latched: even though we called twice, expiry must have fired only once.
    expect(mockTriggerTokenExpiry).toHaveBeenCalledTimes(1);
  });
});

// ─── Success path ────────────────────────────────────────────────────────────

describe("TokenRefreshBridge — successful refresh", () => {
  beforeEach(() => {
    resetTokenRefreshState();
    mockTriggerTokenExpiry.mockClear();
    (reportError as jest.Mock).mockClear();
    (reportMessage as jest.Mock).mockClear();
  });

  it("returns the new token and persists it via setToken", async () => {
    const setToken = jest.fn().mockResolvedValue(undefined);
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: jest.fn().mockResolvedValue({ token: "fresh-token" }),
      setToken,
    });

    const result = await attemptTokenRefresh("old");

    expect(result).toBe("fresh-token");
    expect(setToken).toHaveBeenCalledWith("fresh-token");
    expect(mockTriggerTokenExpiry).not.toHaveBeenCalled();
  });

  it("does not fire expiry on a single intermittent failure", async () => {
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: jest.fn().mockRejectedValue(new Error("network blip")),
      setToken: jest.fn(),
    });

    const result = await attemptTokenRefresh("old");

    expect(result).toBeNull();
    expect(mockTriggerTokenExpiry).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalled();
  });

  it("resets the failure counter on success after partial failures", async () => {
    let calls = 0;
    const refresh = jest.fn().mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return { token: "fresh" };
    });
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: refresh,
      setToken: jest.fn(),
    });

    expect(await attemptTokenRefresh("old")).toBeNull(); // failure 1
    expect(await attemptTokenRefresh("old")).toBeNull(); // failure 2
    expect(await attemptTokenRefresh("old")).toBe("fresh"); // success — resets

    // Three more failures should NOT trip the circuit, because the success
    // above cleared the counter.
    refresh.mockImplementation(async () => {
      throw new Error("transient");
    });
    expect(await attemptTokenRefresh("old")).toBeNull(); // 1 (post-reset)
    expect(await attemptTokenRefresh("old")).toBeNull(); // 2 (post-reset)
    // Two failures post-reset is below MAX_REFRESH_FAILURES, expiry should
    // still not have fired.
    expect(mockTriggerTokenExpiry).not.toHaveBeenCalled();
  });
});

// ─── Single-flight ──────────────────────────────────────────────────────────

describe("TokenRefreshBridge — single-flight", () => {
  beforeEach(() => {
    resetTokenRefreshState();
    mockTriggerTokenExpiry.mockClear();
  });

  it("coalesces N concurrent attempts into ONE refresh call", async () => {
    let resolveRefresh!: (token: { token: string }) => void;
    const refresh = jest.fn().mockImplementation(
      () => new Promise<{ token: string }>((resolve) => { resolveRefresh = resolve; })
    );
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: refresh,
      setToken: jest.fn().mockResolvedValue(undefined),
    });

    // 5 concurrent callers
    const promises = [
      attemptTokenRefresh("old"),
      attemptTokenRefresh("old"),
      attemptTokenRefresh("old"),
      attemptTokenRefresh("old"),
      attemptTokenRefresh("old"),
    ];

    // Single network call regardless of concurrency.
    expect(refresh).toHaveBeenCalledTimes(1);

    resolveRefresh({ token: "fresh" });
    const results = await Promise.all(promises);

    // All callers see the same fresh token.
    expect(results).toEqual(["fresh", "fresh", "fresh", "fresh", "fresh"]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("releases the in-flight slot after completion (next call refreshes again)", async () => {
    const refresh = jest.fn()
      .mockResolvedValueOnce({ token: "first" })
      .mockResolvedValueOnce({ token: "second" });
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: refresh,
      setToken: jest.fn().mockResolvedValue(undefined),
    });

    const a = await attemptTokenRefresh("old");
    const b = await attemptTokenRefresh("old");

    expect(a).toBe("first");
    expect(b).toBe("second");
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

// ─── Circuit breaker ────────────────────────────────────────────────────────

describe("TokenRefreshBridge — circuit breaker", () => {
  beforeEach(() => {
    resetTokenRefreshState();
    mockTriggerTokenExpiry.mockClear();
    (reportMessage as jest.Mock).mockClear();
  });

  it("trips after MAX_REFRESH_FAILURES (3) failures in the window and fires expiry", async () => {
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: jest.fn().mockRejectedValue(new Error("server down")),
      setToken: jest.fn(),
    });

    expect(await attemptTokenRefresh("old")).toBeNull(); // 1
    expect(mockTriggerTokenExpiry).not.toHaveBeenCalled();

    expect(await attemptTokenRefresh("old")).toBeNull(); // 2
    expect(mockTriggerTokenExpiry).not.toHaveBeenCalled();

    expect(await attemptTokenRefresh("old")).toBeNull(); // 3 — trips
    expect(mockTriggerTokenExpiry).toHaveBeenCalledTimes(1);
    expect(reportMessage).toHaveBeenCalled();
  });

  it("after tripping, subsequent calls short-circuit without invoking refreshToken", async () => {
    const refresh = jest.fn().mockRejectedValue(new Error("server down"));
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: refresh,
      setToken: jest.fn(),
    });

    // Trip the circuit.
    await attemptTokenRefresh("old");
    await attemptTokenRefresh("old");
    await attemptTokenRefresh("old");
    expect(refresh).toHaveBeenCalledTimes(3);

    // Further attempts are no-ops at the network layer.
    refresh.mockClear();
    expect(await attemptTokenRefresh("old")).toBeNull();
    expect(await attemptTokenRefresh("old")).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("only fires triggerTokenExpiry ONCE per terminal event (latch)", async () => {
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: jest.fn().mockRejectedValue(new Error("down")),
      setToken: jest.fn(),
    });

    await attemptTokenRefresh("old");
    await attemptTokenRefresh("old");
    await attemptTokenRefresh("old"); // trip
    await attemptTokenRefresh("old"); // post-trip
    await attemptTokenRefresh("old"); // post-trip

    expect(mockTriggerTokenExpiry).toHaveBeenCalledTimes(1);
  });

  it("a failure outside FAILURE_WINDOW_MS resets the counter (does not trip on stale failures)", async () => {
    const FIVE_MIN_PLUS = 5 * 60_000 + 1;
    const refresh = jest.fn().mockRejectedValue(new Error("down"));
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: refresh,
      setToken: jest.fn(),
    });

    const realNow = Date.now;
    let now = 1_000_000;
    const nowSpy = jest.spyOn(Date, "now").mockImplementation(() => now);

    try {
      await attemptTokenRefresh("old"); // failure 1 at t=1_000_000
      now += FIVE_MIN_PLUS;
      await attemptTokenRefresh("old"); // failure 1 again — window reset
      now += FIVE_MIN_PLUS;
      await attemptTokenRefresh("old"); // failure 1 again — window reset

      // None of these should have tripped the circuit, because each failure
      // was outside the prior window.
      expect(mockTriggerTokenExpiry).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
      Date.now = realNow;
    }
  });

  it("resetTokenRefreshState clears the tripped state so re-login can recover", async () => {
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: jest.fn().mockRejectedValue(new Error("down")),
      setToken: jest.fn(),
    });

    // Trip.
    await attemptTokenRefresh("old");
    await attemptTokenRefresh("old");
    await attemptTokenRefresh("old");
    expect(mockTriggerTokenExpiry).toHaveBeenCalledTimes(1);

    // Fresh login boundary.
    resetTokenRefreshState();
    mockTriggerTokenExpiry.mockClear();

    // Re-register with a working refresh; the circuit must be open again.
    registerTokenRefreshHandler({
      getToken: () => "old",
      refreshToken: jest.fn().mockResolvedValue({ token: "post-reset-token" }),
      setToken: jest.fn().mockResolvedValue(undefined),
    });

    const result = await attemptTokenRefresh("old");
    expect(result).toBe("post-reset-token");
    expect(mockTriggerTokenExpiry).not.toHaveBeenCalled();
  });
});
