import { encodeCursor } from "../cursor";

describe("encodeCursor", () => {
  test("encodes (updated_at, id) as base64 JSON for UUID id", () => {
    const cursor = encodeCursor("2026-05-07T10:00:00.000Z", "abc-123");
    const decoded = JSON.parse(globalThis.atob(cursor));
    expect(decoded).toEqual({
      updated_at: "2026-05-07T10:00:00.000Z",
      id: "abc-123",
    });
  });

  test("encodes integer id (e.g. for shops which still use numeric PKs)", () => {
    const cursor = encodeCursor("2026-05-07T10:00:00.000Z", 42);
    const decoded = JSON.parse(globalThis.atob(cursor));
    expect(decoded).toEqual({
      updated_at: "2026-05-07T10:00:00.000Z",
      id: 42,
    });
  });

  test("two cursors built from the same input are identical", () => {
    // Stable encoding matters for caching / comparison logic on the
    // server side; if the order of keys ever stops being deterministic,
    // ETag-style equality comparisons would break.
    const a = encodeCursor("2026-01-01T00:00:00.000Z", "x");
    const b = encodeCursor("2026-01-01T00:00:00.000Z", "x");
    expect(a).toBe(b);
  });
});
