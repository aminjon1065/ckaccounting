import { SyncCoordinator, type SyncJob, type SyncJobKind } from "../SyncCoordinator";

/**
 * Helpers — shared across cases. The coordinator is executor-agnostic:
 * we drive it with a synchronous-deferred executor so the test can assert
 * exactly when the in-flight slot opens up.
 */

interface DeferredJob {
  kind: SyncJobKind;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

function makeRecordingExecutor() {
  // We capture each job along with a deferred resolver so a test can
  // intentionally hold the in-flight slot, enqueue more work, then release
  // the slot to observe what got coalesced / queued.
  const calls: DeferredJob[] = [];

  const executor = (job: SyncJob): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      calls.push({ kind: job.kind, resolve, reject });
    });
  };

  return { executor, calls };
}

// Coordinator schedules the next job via `setTimeout(0)`; flushing
// microtasks isn't enough. This drains both the macrotask queue and any
// trailing microtasks that resolve()s queued from inside.
async function flushScheduling() {
  await new Promise((r) => setTimeout(r, 0));
  await Promise.resolve();
}

describe("SyncCoordinator", () => {
  test("runs jobs sequentially, one at a time", async () => {
    const { executor, calls } = makeRecordingExecutor();
    const coordinator = new SyncCoordinator(executor);

    const p1 = coordinator.enqueue("outbox");
    const p2 = coordinator.enqueue("full");

    // First job has been picked up; second is queued behind it.
    await flushScheduling();
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe("outbox");

    calls[0].resolve(undefined);
    await p1;
    await flushScheduling();
    expect(calls).toHaveLength(2);
    expect(calls[1].kind).toBe("full");

    calls[1].resolve(undefined);
    await p2;
  });

  test("coalesces duplicate kinds: a second outbox while one is queued returns the same promise", async () => {
    const { executor, calls } = makeRecordingExecutor();
    const coordinator = new SyncCoordinator(executor);

    // Block the in-flight slot with a non-coalescable job (high-priority
    // pull) so the next two `outbox` enqueues both pile up in the queue
    // — and the second one should attach to the first.
    const blocker = coordinator.enqueue("full");
    await flushScheduling();
    expect(calls).toHaveLength(1);

    const a = coordinator.enqueue("outbox");
    const b = coordinator.enqueue("outbox");
    expect(a).toBe(b); // same promise — coalesced

    // Drain
    calls[0].resolve(undefined);
    await blocker;
    await flushScheduling();
    expect(calls).toHaveLength(2);
    expect(calls[1].kind).toBe("outbox");
    calls[1].resolve(undefined);
    await a;
  });

  test("priority: high jumps ahead of low/normal queued before it", async () => {
    const { executor, calls } = makeRecordingExecutor();
    const coordinator = new SyncCoordinator(executor);

    // Hold the in-flight slot
    const blocker = coordinator.enqueue("full");
    await flushScheduling();

    const low = coordinator.enqueue("pullAllHistory", { priority: "low" });
    const normalPull = coordinator.enqueue("pull:debts", { priority: "normal" });
    // Use a payloaded kind so it isn't coalesced with `low`'s pullAllHistory
    const high = coordinator.enqueue("outbox", { priority: "high" });

    // Release the blocker; queue order should be: high, normalPull, low.
    calls[0].resolve(undefined);
    await blocker;

    await flushScheduling();
    expect(calls[1].kind).toBe("outbox");
    calls[1].resolve(undefined);
    await high;

    await flushScheduling();
    expect(calls[2].kind).toBe("pull:debts");
    calls[2].resolve(undefined);
    await normalPull;

    await flushScheduling();
    expect(calls[3].kind).toBe("pullAllHistory");
    calls[3].resolve(undefined);
    await low;
  });

  test("cancelAll rejects queued jobs but lets the in-flight one finish", async () => {
    const { executor, calls } = makeRecordingExecutor();
    const coordinator = new SyncCoordinator(executor);

    const inFlight = coordinator.enqueue("outbox");
    await flushScheduling();
    expect(calls).toHaveLength(1);

    const queued = coordinator.enqueue("full");

    coordinator.cancelAll("test cancel");

    // Queued job rejects synchronously after cancelAll
    await expect(queued).rejects.toThrow("test cancel");

    // In-flight job should still resolve normally
    calls[0].resolve("done");
    await expect(inFlight).resolves.toBe("done");
  });

  test("non-coalescable kinds with payload do not share a promise", () => {
    const { executor } = makeRecordingExecutor();
    const coordinator = new SyncCoordinator(executor);

    const a = coordinator.enqueue("pullOlder:sales", { payload: { pages: 5 } });
    const b = coordinator.enqueue("pullOlder:sales", { payload: { pages: 5 } });

    expect(a).not.toBe(b);
  });

  test("subscribe receives state updates and unsubscribe stops them", async () => {
    const { executor, calls } = makeRecordingExecutor();
    const coordinator = new SyncCoordinator(executor);

    const states: { busy: boolean; current: string | null }[] = [];
    const unsubscribe = coordinator.subscribe((s) => {
      states.push({ busy: s.busy, current: s.current });
    });

    coordinator.enqueue("outbox");
    await flushScheduling();
    calls[0].resolve(undefined);
    await flushScheduling();

    // Initial snapshot + busy=true on enqueue + busy=false on completion
    expect(states.length).toBeGreaterThanOrEqual(3);
    expect(states[0]).toEqual({ busy: false, current: null });
    expect(states.some((s) => s.busy && s.current === "outbox")).toBe(true);
    expect(states[states.length - 1]).toEqual({ busy: false, current: null });

    unsubscribe();
    coordinator.enqueue("full");
    await flushScheduling();
    const lengthBefore = states.length;
    // No further notifications after unsubscribe
    expect(states.length).toBe(lengthBefore);
  });
});
