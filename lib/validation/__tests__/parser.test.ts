import { z } from "zod";
import { parseOrLog } from "../parser";

// Capture reportMessage calls so we can assert on what gets shipped to
// observability without actually logging during the test.
jest.mock("@/lib/observability/reporter", () => ({
  reportMessage: jest.fn(),
}));

import { reportMessage } from "@/lib/observability/reporter";

const reportMessageMock = reportMessage as jest.MockedFunction<typeof reportMessage>;

describe("parseOrLog", () => {
  beforeEach(() => {
    reportMessageMock.mockClear();
  });

  test("returns parsed value on success and does not log", () => {
    const schema = z.object({ id: z.string(), n: z.number() });
    const result = parseOrLog(schema, { id: "abc", n: 42 }, { tag: "ok" });
    expect(result).toEqual({ id: "abc", n: 42 });
    expect(reportMessageMock).not.toHaveBeenCalled();
  });

  test("on mismatch: logs once with structured context and returns the raw value", () => {
    const schema = z.object({ id: z.string(), n: z.number() });
    // `n` is wrong on purpose; the soft fallback returns whatever we got.
    const raw = { id: "abc", n: "not-a-number" };
    const result = parseOrLog(schema, raw, { tag: "wrong-shape", extra: { url: "/x" } });

    // Soft fallback: same identity as input.
    expect(result).toBe(raw);

    expect(reportMessageMock).toHaveBeenCalledTimes(1);
    const [message, severity, ctx] = reportMessageMock.mock.calls[0];
    expect(message).toMatch(/wrong-shape/);
    expect(severity).toBe("warning");
    expect(ctx).toMatchObject({ tag: "wrong-shape", url: "/x" });
    expect(typeof ctx?.firstIssues).toBe("string");
  });

  test("on completely-missing required fields: still falls back, doesn't throw", () => {
    const schema = z.object({ id: z.string() });
    expect(() => parseOrLog(schema, {}, { tag: "missing" })).not.toThrow();
    expect(reportMessageMock).toHaveBeenCalled();
  });

  test("passthrough schemas accept extra fields", () => {
    const schema = z.object({ id: z.string() }).passthrough();
    const result = parseOrLog(schema, { id: "abc", extra: "ok" }, { tag: "passthrough" }) as { id: string; extra?: string };
    expect(result.id).toBe("abc");
    // passthrough preserves the extra field in the parsed output too
    expect(result.extra).toBe("ok");
    expect(reportMessageMock).not.toHaveBeenCalled();
  });
});
