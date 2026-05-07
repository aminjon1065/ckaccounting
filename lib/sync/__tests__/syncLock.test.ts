// ─── syncLock regression suite ──────────────────────────────────────────────
//
// Cross-process advisory lock between the foreground React app and the
// OS background-fetch task. A bug here corrupts data: two writers
// interleaving outbox replays, a holder failing to release on throw, or
// release accidentally clobbering a peer that legitimately reclaimed an
// expired lock.
//
// The lock is SQLite-backed, so the tests mock `@/lib/db` and assert
// against the SQL-shaped intent (atomic claim WHERE clause covers the
// three valid cases; release filters by holder identity; re-throw on
// contention; release-in-finally on throw).

const mockRunAsync = jest.fn();
const mockGetFirstAsync = jest.fn();
const mockReportError = jest.fn();

jest.mock("@/lib/db", () => ({
  getDb: () => ({
    runAsync: mockRunAsync,
    getFirstAsync: mockGetFirstAsync,
  }),
}));

jest.mock("@/lib/observability/reporter", () => ({
  reportError: (...args: unknown[]) => mockReportError(...args),
}));

import {
  SyncLockBusyError,
  acquireSyncLock,
  releaseSyncLock,
  withSyncLock,
} from "../syncLock";

beforeEach(() => {
  mockRunAsync.mockReset();
  mockGetFirstAsync.mockReset();
  mockReportError.mockReset();
});

// ─── acquireSyncLock ────────────────────────────────────────────────────────

describe("acquireSyncLock — happy path", () => {
  it("issues a single UPDATE on the sync_lock row with the expected WHERE", async () => {
    mockRunAsync.mockResolvedValueOnce({ changes: 1 });

    await acquireSyncLock({ holder: "foreground:full" });

    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    const [sql, params] = mockRunAsync.mock.calls[0];
    // The atomic-claim WHERE must accept all three valid cases:
    //   (1) lock free, (2) prior holder's TTL lapsed, (3) re-entrant by us.
    expect(sql).toMatch(/UPDATE\s+sync_lock/i);
    expect(sql).toMatch(/WHERE\s+id\s*=\s*1/i);
    expect(sql).toMatch(/holder\s+IS\s+NULL/i);
    expect(sql).toMatch(/datetime\(expires_at\)\s*<\s*datetime\(\?\)/i);
    expect(sql).toMatch(/holder\s*=\s*\?/i);
    // Params: holder, acquired_at, expires_at, now-for-comparison, holder-for-reentry.
    expect(params).toHaveLength(5);
    expect(params[0]).toBe("foreground:full");
    expect(params[4]).toBe("foreground:full");
  });

  it("returns successfully when changes > 0 (UPDATE matched a row)", async () => {
    mockRunAsync.mockResolvedValueOnce({ changes: 1 });
    await expect(acquireSyncLock({ holder: "x" })).resolves.toBeUndefined();
  });

  it("uses the supplied TTL to compute expires_at", async () => {
    mockRunAsync.mockResolvedValueOnce({ changes: 1 });

    const before = Date.now();
    await acquireSyncLock({ holder: "x", ttlMs: 30_000 });

    const params = mockRunAsync.mock.calls[0][1];
    const acquiredAt = new Date(params[1] as string).getTime();
    const expiresAt = new Date(params[2] as string).getTime();
    expect(expiresAt - acquiredAt).toBe(30_000);
    expect(acquiredAt).toBeGreaterThanOrEqual(before);
  });
});

// ─── acquireSyncLock — contention ───────────────────────────────────────────

describe("acquireSyncLock — contention", () => {
  it("throws SyncLockBusyError immediately when waitMs=0 and lock is held", async () => {
    // Atomic claim returns 0 changes (someone else holds it).
    mockRunAsync.mockResolvedValueOnce({ changes: 0 });
    // Then readCurrentHolder returns whoever currently holds it.
    mockGetFirstAsync.mockResolvedValueOnce({ holder: "bg-task", expires_at: "2026-12-31T23:59:59.999Z" });

    await expect(acquireSyncLock({ holder: "foreground:full", waitMs: 0 }))
      .rejects.toBeInstanceOf(SyncLockBusyError);
  });

  it("attaches the current holder to SyncLockBusyError for diagnostics", async () => {
    mockRunAsync.mockResolvedValueOnce({ changes: 0 });
    mockGetFirstAsync.mockResolvedValueOnce({ holder: "bg-task", expires_at: null });

    let caught: unknown;
    try {
      await acquireSyncLock({ holder: "foreground", waitMs: 0 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SyncLockBusyError);
    expect((caught as SyncLockBusyError).currentHolder).toBe("bg-task");
  });

  it("retries while the wait budget remains, succeeds when peer releases", async () => {
    // First claim attempt fails, second succeeds.
    mockRunAsync
      .mockResolvedValueOnce({ changes: 0 })
      .mockResolvedValueOnce({ changes: 1 });

    // waitMs=2000 gives the retry loop budget for at least one ACQUIRE_RETRY_DELAY_MS=250 sleep.
    await expect(acquireSyncLock({ holder: "x", waitMs: 2000 })).resolves.toBeUndefined();
    expect(mockRunAsync).toHaveBeenCalledTimes(2);
  }, 5000);

  it("throws SyncLockBusyError with currentHolder=null if no row was found at all", async () => {
    // SQLite would return 0 changes for an UPDATE that matched nothing AND
    // an empty row from the SELECT. Edge case if migrations didn't seed
    // the lock row yet.
    mockRunAsync.mockResolvedValueOnce({ changes: 0 });
    mockGetFirstAsync.mockResolvedValueOnce(undefined);

    let caught: unknown;
    try {
      await acquireSyncLock({ holder: "x", waitMs: 0 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SyncLockBusyError);
    expect((caught as SyncLockBusyError).currentHolder).toBeNull();
  });
});

// ─── releaseSyncLock ────────────────────────────────────────────────────────

describe("releaseSyncLock", () => {
  it("issues an UPDATE that filters by holder identity", async () => {
    mockRunAsync.mockResolvedValueOnce({ changes: 1 });

    await releaseSyncLock("foreground:full");

    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    const [sql, params] = mockRunAsync.mock.calls[0];
    expect(sql).toMatch(/UPDATE\s+sync_lock/i);
    expect(sql).toMatch(/holder\s*=\s*NULL/i);
    expect(sql).toMatch(/WHERE\s+id\s*=\s*1\s+AND\s+holder\s*=\s*\?/i);
    expect(params).toEqual(["foreground:full"]);
  });

  it("is idempotent — does not throw when row no longer matches our holder", async () => {
    // Peer reclaimed the lock between our acquire and release; UPDATE
    // matches 0 rows, that's fine — release MUST NOT throw.
    mockRunAsync.mockResolvedValueOnce({ changes: 0 });

    await expect(releaseSyncLock("ghost-holder")).resolves.toBeUndefined();
  });
});

// ─── withSyncLock ───────────────────────────────────────────────────────────

describe("withSyncLock", () => {
  it("acquires, runs fn, releases — happy path", async () => {
    mockRunAsync
      .mockResolvedValueOnce({ changes: 1 }) // acquire
      .mockResolvedValueOnce({ changes: 1 }); // release

    const fn = jest.fn().mockResolvedValue("payload");
    const result = await withSyncLock({ holder: "x" }, fn);

    expect(result).toBe("payload");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockRunAsync).toHaveBeenCalledTimes(2);
  });

  it("releases the lock even if fn throws (finally guarantee)", async () => {
    mockRunAsync
      .mockResolvedValueOnce({ changes: 1 }) // acquire
      .mockResolvedValueOnce({ changes: 1 }); // release

    const fn = jest.fn().mockRejectedValue(new Error("inner failed"));

    await expect(withSyncLock({ holder: "x" }, fn)).rejects.toThrow("inner failed");

    // 2nd runAsync must be the release — proves finally fired.
    expect(mockRunAsync).toHaveBeenCalledTimes(2);
    const [releaseSql] = mockRunAsync.mock.calls[1];
    expect(releaseSql).toMatch(/holder\s*=\s*NULL/i);
  });

  it("re-throws SyncLockBusyError when acquisition fails (caller decides skip vs retry)", async () => {
    mockRunAsync.mockResolvedValueOnce({ changes: 0 }); // acquire fails
    mockGetFirstAsync.mockResolvedValueOnce({ holder: "peer", expires_at: null });

    const fn = jest.fn();
    await expect(withSyncLock({ holder: "x", waitMs: 0 }, fn)).rejects.toBeInstanceOf(SyncLockBusyError);

    // fn must NOT have run — we never held the lock.
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not call fn or release when acquire throws (release would clobber peer)", async () => {
    mockRunAsync.mockResolvedValueOnce({ changes: 0 }); // acquire fails
    mockGetFirstAsync.mockResolvedValueOnce({ holder: "peer", expires_at: null });

    const fn = jest.fn();
    await expect(withSyncLock({ holder: "x", waitMs: 0 }, fn)).rejects.toBeInstanceOf(SyncLockBusyError);

    // Only the acquire UPDATE happened. The fn and release UPDATEs did not.
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it("reports release errors via reporter without breaking fn's result", async () => {
    mockRunAsync
      .mockResolvedValueOnce({ changes: 1 }) // acquire
      .mockRejectedValueOnce(new Error("release exploded")); // release throws

    const fn = jest.fn().mockResolvedValue("ok");
    const result = await withSyncLock({ holder: "x" }, fn);

    expect(result).toBe("ok"); // fn's value is preserved
    expect(mockReportError).toHaveBeenCalledWith(expect.any(Error), { tag: "sync-lock-release" });
  });
});
