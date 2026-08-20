import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundGpuQueue } from '../src/render/background_gpu_queue';
import {
  awaitCompileGate,
  CompileGateQueue,
  type CompileGateScheduler,
  type PieceDeadline,
  SerialGateLane,
  settlePendingSwap,
} from '../src/render/compile_gate';
import { gpuPrepEventsSnapshot, resetGpuPrepEventsForTest } from '../src/render/gpu_prep_events';

beforeEach(() => {
  resetGpuPrepEventsForTest();
});

afterEach(() => {
  resetGpuPrepEventsForTest();
});

function fakeScheduler(): CompileGateScheduler & {
  fire: () => void;
  cleared: number[];
  pendingId: number | null;
} {
  let nextId = 1;
  let pendingCb: (() => void) | null = null;
  const cleared: number[] = [];
  let pendingId: number | null = null;
  return {
    setTimeout: (cb, _ms) => {
      const id = nextId++;
      pendingCb = cb;
      pendingId = id;
      return id;
    },
    clearTimeout: (id) => {
      cleared.push(id);
      if (id === pendingId) pendingCb = null;
    },
    fire: () => {
      pendingCb?.();
    },
    cleared,
    get pendingId() {
      return pendingId;
    },
    set pendingId(v) {
      pendingId = v;
    },
  };
}

describe('awaitCompileGate', () => {
  it('resolves when compile() resolves and clears the diagnostic timer', async () => {
    const scheduler = fakeScheduler();
    let resolveCompile!: () => void;
    const compile = () => new Promise<void>((resolve) => (resolveCompile = resolve));
    const gate = awaitCompileGate(compile, 1500, { scheduler });
    let done = false;
    void gate.then(() => {
      done = true;
    });
    expect(done).toBe(false);
    resolveCompile();
    await expect(gate).resolves.toEqual({ failed: false, timedOut: false });
    expect(done).toBe(true);
    expect(scheduler.cleared).toContain(scheduler.pendingId ?? -1);
  });

  it('records timeout without abandoning the active compile', async () => {
    const scheduler = fakeScheduler();
    const onTimeout = vi.fn();
    let resolveCompile!: () => void;
    const compile = () => new Promise<void>((resolve) => (resolveCompile = resolve));
    const gate = awaitCompileGate(compile, 1500, { onTimeout, scheduler });
    let done = false;
    void gate.then(() => {
      done = true;
    });

    scheduler.fire();
    await Promise.resolve();
    expect(done).toBe(false);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    resolveCompile();
    await expect(gate).resolves.toEqual({ failed: false, timedOut: true });
  });

  it('records the timeout in the GPU-preparation ring even with no onTimeout caller', async () => {
    // The whole timeout arm used to be inert in production: nothing passes
    // onTimeout, and timedOut is never read, so a driver that blew the deadline
    // left no trace at all. The default record is what makes it countable.
    const scheduler = fakeScheduler();
    let resolveCompile!: () => void;
    const gate = awaitCompileGate(
      () => new Promise<void>((resolve) => (resolveCompile = resolve)),
      1500,
      { scheduler, label: 'view:mob-archetype' },
    );
    scheduler.fire();

    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.counts['gate-timeout']).toBe(1);
    expect(snapshot.events[0].kind).toBe('gate-timeout');
    expect(snapshot.events[0].key).toBe('view:mob-archetype');
    expect(snapshot.events[0].ageMs).toBe(1500);

    // Fail-soft semantics unchanged: the event is telemetry, nothing released
    // early, and the gate still resolves only on the real settle.
    resolveCompile();
    await expect(gate).resolves.toEqual({ failed: false, timedOut: true });
  });

  it('falls back to a generic key when the gate carries no label', async () => {
    const scheduler = fakeScheduler();
    let resolveCompile!: () => void;
    const gate = awaitCompileGate(
      () => new Promise<void>((resolve) => (resolveCompile = resolve)),
      900,
      { scheduler },
    );
    scheduler.fire();
    expect(gpuPrepEventsSnapshot().events[0].key).toBe('compile-gate');
    resolveCompile();
    await gate;
  });

  it('still calls a caller-supplied onTimeout alongside the record', async () => {
    const scheduler = fakeScheduler();
    const onTimeout = vi.fn();
    let resolveCompile!: () => void;
    const gate = awaitCompileGate(
      () => new Promise<void>((resolve) => (resolveCompile = resolve)),
      1500,
      { scheduler, onTimeout, label: 'far-bake' },
    );
    scheduler.fire();
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(gpuPrepEventsSnapshot().counts['gate-timeout']).toBe(1);
    resolveCompile();
    await gate;
  });

  it('records nothing for a gate that settles inside its deadline', async () => {
    const scheduler = fakeScheduler();
    await awaitCompileGate(() => Promise.resolve(), 1500, { scheduler, label: 'fast' });
    expect(gpuPrepEventsSnapshot().total).toBe(0);
  });

  it('honours the opt-out for a gate that reports its own timeouts', async () => {
    const scheduler = fakeScheduler();
    const onTimeout = vi.fn();
    let resolveCompile!: () => void;
    const gate = awaitCompileGate(
      () => new Promise<void>((resolve) => (resolveCompile = resolve)),
      1500,
      { scheduler, onTimeout, recordTimeoutEvent: false },
    );
    scheduler.fire();
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(gpuPrepEventsSnapshot().total).toBe(0);
    resolveCompile();
    await gate;
  });

  it('settles fail-soft after a rejection or synchronous throw', async () => {
    const rejected = awaitCompileGate(() => Promise.reject(new Error('link failed')), 1500);
    await expect(rejected).resolves.toEqual({ failed: true, timedOut: false });

    const thrown = awaitCompileGate(() => {
      throw new Error('extension unavailable');
    }, 1500);
    await expect(thrown).resolves.toEqual({ failed: true, timedOut: false });
  });
});

describe('CompileGateQueue', () => {
  it('keeps streamed compile calls strictly sequential', async () => {
    const queue = new CompileGateQueue();
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];
    const compile = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          resolvers.push(() => {
            active -= 1;
            resolve();
          });
        }),
    );

    const first = queue.run(compile, 1500);
    const second = queue.run(compile, 1500);
    await Promise.resolve();
    expect(compile).toHaveBeenCalledTimes(1);
    resolvers.shift()?.();
    await first;
    await Promise.resolve();
    expect(compile).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
    resolvers.shift()?.();
    await second;
  });

  it('does not start the next compile when the active one only times out', async () => {
    const scheduler = fakeScheduler();
    const queue = new CompileGateQueue();
    let resolveFirst!: () => void;
    const firstCompile = vi.fn(() => new Promise<void>((resolve) => (resolveFirst = resolve)));
    const secondCompile = vi.fn(() => Promise.resolve());
    const first = queue.run(firstCompile, 1500, { scheduler });
    const second = queue.run(secondCompile, 1500);
    await Promise.resolve();

    scheduler.fire();
    await Promise.resolve();
    expect(secondCompile).not.toHaveBeenCalled();

    resolveFirst();
    await first;
    await second;
    expect(secondCompile).toHaveBeenCalledTimes(1);
  });

  it('records a queued gate timeout under the gate label', async () => {
    // CompileGateQueue.run delegates to awaitCompileGate, so the queued path
    // must carry the same telemetry: this is the path every streamed view
    // actually takes.
    const scheduler = fakeScheduler();
    const queue = new CompileGateQueue();
    let resolveCompile!: () => void;
    const gate = queue.run(() => new Promise<void>((resolve) => (resolveCompile = resolve)), 1500, {
      scheduler,
      label: 'queued-view',
    });
    await Promise.resolve();
    scheduler.fire();
    const snapshot = gpuPrepEventsSnapshot();
    expect(snapshot.counts['gate-timeout']).toBe(1);
    expect(snapshot.events[0].key).toBe('queued-view');
    resolveCompile();
    await expect(gate).resolves.toEqual({ failed: false, timedOut: true });
  });

  it('uses a shared GPU arbiter, forwards live priority, and declares its tail releasable', async () => {
    const priorities: Array<number | undefined> = [];
    const tailOptions: Array<{ releaseTail?: boolean } | undefined> = [];
    const sharedQueue = {
      run: async <T>(
        work: () => T | Promise<T>,
        priority?: number,
        _label?: string,
        options?: { releaseTail?: boolean },
      ): Promise<T> => {
        priorities.push(priority);
        tailOptions.push(options);
        return work();
      },
    };
    const queue = new CompileGateQueue(sharedQueue);

    await expect(queue.run(() => Promise.resolve(), 1500, { priority: 40 })).resolves.toEqual({
      failed: false,
      timedOut: false,
    });
    expect(priorities).toEqual([40]);
    // The gate's tail is the off-thread driver link: the shared queue may keep
    // draining other lanes while it settles (the released-tail policy).
    expect(tailOptions).toEqual([{ releaseTail: true }]);
  });

  it('overlaps gates up to the real shared queue cap and holds the next one', async () => {
    // Composition over the REAL queue, not a fake: two gates start their
    // compile prologues while neither link has settled, the third waits on
    // the released-tail cap. This is the deliberate relaxation of the strict
    // serialization the local fallback still provides.
    const queue = new CompileGateQueue(createBackgroundGpuQueue());
    const noopScheduler = { setTimeout: () => 0, clearTimeout: () => {} };
    const started: string[] = [];
    const gate = (name: string) =>
      queue.run(
        () => {
          started.push(name);
          return new Promise<void>(() => {});
        },
        1500,
        { label: name, scheduler: noopScheduler },
      );
    void gate('one');
    void gate('two');
    void gate('three');
    for (let index = 0; index < 12; index++) await Promise.resolve();
    expect(started).toEqual(['one', 'two']);
  });
});

describe('CompileGateQueue.runPieces', () => {
  // The gate cut into one queue unit per material group (compile_gate_pieces.ts):
  // the aggregate result, the deadline each piece arms for its own work, the
  // per-piece labels, and the serial local fallback.
  const settledResult = { failed: false, timedOut: false };

  function recordingSharedQueue() {
    const units: Array<{ priority?: number; label?: string; releaseTail?: boolean }> = [];
    const sharedQueue = {
      run: <T>(
        work: () => T | Promise<T>,
        priority?: number,
        label?: string,
        options?: { releaseTail?: boolean },
      ): Promise<T> => {
        units.push({ priority, label, releaseTail: options?.releaseTail });
        return Promise.resolve().then(work);
      },
    };
    return { units, sharedQueue };
  }

  it('aggregates settled pieces into one settled gate, one labelled unit per piece, in order', async () => {
    const { units, sharedQueue } = recordingSharedQueue();
    const queue = new CompileGateQueue(sharedQueue);
    const ran: number[] = [];
    const piece = (index: number) => () => {
      ran.push(index);
      return Promise.resolve();
    };
    const gate = queue.runPieces([piece(0), piece(1), piece(2)], 1500, {
      priority: 40,
      label: 'live-gate:Group',
    });
    await expect(gate).resolves.toEqual(settledResult);
    expect(ran).toEqual([0, 1, 2]);
    // The kind stays the label head (the budget's per-kind estimate is
    // unchanged); the piece index lands after the root name. Every piece
    // rides the gate's priority and releases its tail like a whole gate.
    expect(units).toEqual([
      { priority: 40, label: 'live-gate:Group:0', releaseTail: true },
      { priority: 40, label: 'live-gate:Group:1', releaseTail: true },
      { priority: 40, label: 'live-gate:Group:2', releaseTail: true },
    ]);
  });

  it('fails the gate when any piece rejects or throws, still settling every other piece', async () => {
    const { sharedQueue } = recordingSharedQueue();
    const queue = new CompileGateQueue(sharedQueue);
    const others = vi.fn(() => Promise.resolve());
    const rejected = queue.runPieces(
      [others, () => Promise.reject(new Error('link failed')), others],
      1500,
    );
    await expect(rejected).resolves.toEqual({ failed: true, timedOut: false });
    expect(others).toHaveBeenCalledTimes(2);
    const thrown = queue.runPieces(
      [
        () => {
          throw new Error('extension unavailable');
        },
      ],
      1500,
    );
    await expect(thrown).resolves.toEqual({ failed: true, timedOut: false });
  });

  /** Many timers at once, each fired by hand: the per-piece deadlines. */
  function multiScheduler() {
    let nextId = 1;
    const pending = new Map<number, () => void>();
    const armedMs: number[] = [];
    const cleared: number[] = [];
    return {
      setTimeout: (cb: () => void, ms: number) => {
        const id = nextId++;
        pending.set(id, cb);
        armedMs.push(ms);
        return id;
      },
      clearTimeout: (id: number) => {
        cleared.push(id);
        pending.delete(id);
      },
      fire: (id: number) => {
        const cb = pending.get(id);
        pending.delete(id);
        cb?.();
      },
      armedMs,
      cleared,
      get live() {
        return [...pending.keys()];
      },
    };
  }

  it('arms one deadline PER PIECE when its work starts, and clears it when that piece settles', async () => {
    const scheduler = multiScheduler();
    const { sharedQueue } = recordingSharedQueue();
    const queue = new CompileGateQueue(sharedQueue);
    const resolvers: Array<() => void> = [];
    const pending = () => new Promise<void>((resolve) => resolvers.push(resolve));
    const gate = queue.runPieces([pending, pending, pending], 1500, {
      scheduler,
      label: 'live-gate:Group',
    });
    for (let index = 0; index < 4; index++) await Promise.resolve();
    expect(resolvers).toHaveLength(3);
    // three pieces started, three deadlines live, each the full constant:
    // the driver latency of ONE unit, never the whole gate's queue depth
    expect(scheduler.armedMs).toEqual([1500, 1500, 1500]);
    expect(scheduler.live).toEqual([1, 2, 3]);
    resolvers[0]();
    await Promise.resolve();
    await Promise.resolve();
    // settling piece 1 clears ITS timer and no other
    expect(scheduler.cleared).toEqual([1]);
    expect(scheduler.live).toEqual([2, 3]);
    resolvers[1]();
    resolvers[2]();
    await expect(gate).resolves.toEqual({ failed: false, timedOut: false });
    expect(scheduler.live).toEqual([]);
    expect(gpuPrepEventsSnapshot().total).toBe(0);
  });

  it('times the gate out when ANY piece exceeds the deadline from its own start, recorded once', async () => {
    const scheduler = multiScheduler();
    const { sharedQueue } = recordingSharedQueue();
    const queue = new CompileGateQueue(sharedQueue);
    const resolvers: Array<() => void> = [];
    const pending = () => new Promise<void>((resolve) => resolvers.push(resolve));
    const gate = queue.runPieces([() => Promise.resolve(), pending, pending], 1500, {
      scheduler,
      label: 'live-gate:Group',
    });
    for (let index = 0; index < 4; index++) await Promise.resolve();
    // the first piece was fast (its timer cleared); the second and third
    // are still linking when their deadlines land
    expect(scheduler.cleared).toEqual([1]);
    scheduler.fire(2);
    scheduler.fire(3);
    const snapshot = gpuPrepEventsSnapshot();
    // recorded ONCE per gate, under the GATE label, with the deadline that elapsed
    expect(snapshot.counts['gate-timeout']).toBe(1);
    expect(snapshot.events[0]).toMatchObject({
      kind: 'gate-timeout',
      key: 'live-gate:Group',
      ageMs: 1500,
    });
    // fail-soft, as for a whole gate: nothing is released early, the gate
    // still resolves only on the last piece's real settle
    let done = false;
    void gate.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    resolvers[0]();
    resolvers[1]();
    await expect(gate).resolves.toEqual({ failed: false, timedOut: true });
  });

  it('a late piece times the gate out even when the first was fast, from ITS start', async () => {
    const scheduler = multiScheduler();
    const queue = new CompileGateQueue();
    let resolveSecond!: () => void;
    const gate = queue.runPieces(
      [() => Promise.resolve(), () => new Promise<void>((resolve) => (resolveSecond = resolve))],
      1500,
      { scheduler, label: 'live-gate:Group' },
    );
    for (let index = 0; index < 8; index++) await Promise.resolve();
    // serial fallback: piece 1 settled (timer 1 cleared), piece 2 armed its own
    expect(scheduler.cleared).toEqual([1]);
    expect(scheduler.live).toEqual([2]);
    scheduler.fire(2);
    resolveSecond();
    await expect(gate).resolves.toEqual({ failed: false, timedOut: true });
    expect(gpuPrepEventsSnapshot().counts['gate-timeout']).toBe(1);
  });

  it('arms a deadline only when a piece STARTS, never at enqueue: a queued gate is not timed out', async () => {
    // A parked piece (the shared queue holds it behind other lanes) must not
    // burn a deadline while it waits: the deadline bounds the LINK, not the
    // queue depth. Nothing is armed until a piece is released, and pieces
    // that are merely queued long leave a fast gate un-timed-out.
    const scheduler = multiScheduler();
    const parked: Array<() => Promise<unknown>> = [];
    const parkingQueue = {
      run: <T>(work: () => T | Promise<T>): Promise<T> =>
        new Promise<T>((resolve) => {
          parked.push(() => Promise.resolve().then(work).then(resolve));
        }),
    };
    const queue = new CompileGateQueue(parkingQueue);
    const gate = queue.runPieces([() => Promise.resolve(), () => Promise.resolve()], 1500, {
      scheduler,
      label: 'live-gate:Group',
    });
    for (let index = 0; index < 4; index++) await Promise.resolve();
    expect(parked).toHaveLength(2);
    expect(scheduler.armedMs).toEqual([]);
    // release ONE piece: its own deadline arms now, with the full budget, and
    // its settle clears it
    await parked[0]();
    expect(scheduler.armedMs).toEqual([1500]);
    expect(scheduler.cleared).toEqual([1]);
    // releasing the second (however long it waited) arms a second, fresh one
    await parked[1]();
    expect(scheduler.armedMs).toEqual([1500, 1500]);
    expect(scheduler.cleared).toEqual([1, 2]);
    await expect(gate).resolves.toEqual(settledResult);
    expect(gpuPrepEventsSnapshot().total).toBe(0);
  });

  it('records a pieces timeout under the generic key when the gate carries no label', async () => {
    const scheduler = fakeScheduler();
    const { sharedQueue } = recordingSharedQueue();
    const queue = new CompileGateQueue(sharedQueue);
    let resolvePiece!: () => void;
    const gate = queue.runPieces(
      [() => new Promise<void>((resolve) => (resolvePiece = resolve))],
      900,
      { scheduler },
    );
    for (let index = 0; index < 4; index++) await Promise.resolve();
    scheduler.fire();
    expect(gpuPrepEventsSnapshot().events[0]).toMatchObject({
      kind: 'gate-timeout',
      key: 'compile-gate',
      ageMs: 900,
    });
    resolvePiece();
    await expect(gate).resolves.toEqual({ failed: false, timedOut: true });
  });

  it('records no timeout for a gate whose pieces all settle inside the deadline', async () => {
    const scheduler = fakeScheduler();
    const { sharedQueue } = recordingSharedQueue();
    const queue = new CompileGateQueue(sharedQueue);
    await queue.runPieces([() => Promise.resolve(), () => Promise.resolve()], 1500, {
      scheduler,
      label: 'fast',
    });
    expect(gpuPrepEventsSnapshot().total).toBe(0);
    // firing the already-cleared guard is inert
    scheduler.fire();
    expect(gpuPrepEventsSnapshot().total).toBe(0);
  });

  it('a gate with no pieces (a root without a material carrier) settles at once', async () => {
    const { units, sharedQueue } = recordingSharedQueue();
    const queue = new CompileGateQueue(sharedQueue);
    await expect(queue.runPieces([], 1500, { label: 'empty' })).resolves.toEqual(settledResult);
    expect(units).toEqual([]);
  });

  it('runs the pieces strictly serially, in order, on the local fallback', async () => {
    const queue = new CompileGateQueue();
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const resolvers: Array<() => void> = [];
    const piece = (name: string) => () =>
      new Promise<void>((resolve) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(name);
        resolvers.push(() => {
          active -= 1;
          resolve();
        });
      });
    const gate = queue.runPieces([piece('a'), piece('b')], 1500);
    const next = queue.run(piece('c'), 1500);
    for (let index = 0; index < 4; index++) await Promise.resolve();
    expect(order).toEqual(['a']);
    resolvers.shift()?.();
    for (let index = 0; index < 4; index++) await Promise.resolve();
    expect(order).toEqual(['a', 'b']);
    resolvers.shift()?.();
    await expect(gate).resolves.toEqual(settledResult);
    for (let index = 0; index < 4; index++) await Promise.resolve();
    // a whole gate queued behind the pieces waits for the last of them
    expect(order).toEqual(['a', 'b', 'c']);
    resolvers.shift()?.();
    await next;
    expect(maxActive).toBe(1);
  });

  it('overlaps a gate pieces up to the real shared queue cap and holds the rest', async () => {
    // Composition over the REAL queue: two pieces start their compile
    // prologues while neither link has settled, the third waits on the
    // released-tail cap. That cap, now per piece, is what bounds how many of
    // one root's links pile on the driver at once.
    const queue = new CompileGateQueue(createBackgroundGpuQueue());
    const noopScheduler = { setTimeout: () => 0, clearTimeout: () => {} };
    const started: number[] = [];
    const piece = (index: number) => () => {
      started.push(index);
      return new Promise<void>(() => {});
    };
    void queue.runPieces([piece(0), piece(1), piece(2)], 1500, {
      label: 'live-gate:Group',
      scheduler: noopScheduler,
    });
    for (let index = 0; index < 12; index++) await Promise.resolve();
    expect(started).toEqual([0, 1]);
  });

  it('hands each piece its OWN deadline, which reads fired only once that piece timer fired', async () => {
    // A piece that keeps polling the driver after its compile resolves (the
    // variant settle) ends that poll on this flag, so the one constant bounds
    // the whole piece; a sibling piece's timeout must not end it early.
    const scheduler = multiScheduler();
    const { sharedQueue } = recordingSharedQueue();
    const queue = new CompileGateQueue(sharedQueue);
    const deadlines: PieceDeadline[] = [];
    const resolvers: Array<() => void> = [];
    const piece = (deadline: PieceDeadline) => {
      deadlines.push(deadline);
      return new Promise<void>((resolve) => resolvers.push(resolve));
    };
    const gate = queue.runPieces([piece, piece], 1500, {
      scheduler,
      label: 'live-gate:Group',
      recordTimeoutEvent: false,
    });
    for (let index = 0; index < 4; index++) await Promise.resolve();
    expect(deadlines).toHaveLength(2);
    expect(deadlines[0]).not.toBe(deadlines[1]);
    expect(deadlines.map((deadline) => deadline.fired)).toEqual([false, false]);
    scheduler.fire(2);
    expect(deadlines.map((deadline) => deadline.fired)).toEqual([false, true]);
    scheduler.fire(1);
    expect(deadlines.map((deadline) => deadline.fired)).toEqual([true, true]);
    resolvers[0]();
    resolvers[1]();
    await expect(gate).resolves.toEqual({ failed: false, timedOut: true });
  });

  it('a piece deadline never fires while the piece settles in time', async () => {
    const scheduler = multiScheduler();
    const queue = new CompileGateQueue();
    let seen: PieceDeadline | null = null;
    const gate = queue.runPieces(
      [
        (deadline) => {
          seen = deadline;
          return Promise.resolve();
        },
      ],
      1500,
      { scheduler },
    );
    await expect(gate).resolves.toEqual({ failed: false, timedOut: false });
    expect(seen).not.toBeNull();
    expect((seen as unknown as PieceDeadline).fired).toBe(false);
    expect(scheduler.live).toEqual([]);
  });

  it('propagates a queue rejection (shutdown) and disarms the live piece deadlines', async () => {
    // The piece STARTS (its deadline arms) and never settles; the queue then
    // rejects the unit (shutdown): the live timer is cleared, and a piece the
    // queue releases after that arms none, so the dead gate records nothing.
    const scheduler = multiScheduler();
    const shutdown = new Error('queue shut down');
    const late: Array<() => Promise<unknown>> = [];
    let units = 0;
    const sharedQueue = {
      run: <T>(work: () => T | Promise<T>): Promise<T> => {
        units++;
        if (units === 1) {
          void work();
          return Promise.reject(shutdown);
        }
        return new Promise<T>((resolve) => {
          late.push(() => Promise.resolve().then(work).then(resolve));
        });
      },
    };
    const queue = new CompileGateQueue(sharedQueue);
    const deadlines: PieceDeadline[] = [];
    const gate = queue.runPieces(
      [
        (deadline) => {
          deadlines.push(deadline);
          return new Promise(() => {});
        },
        (deadline) => {
          deadlines.push(deadline);
          return Promise.resolve();
        },
      ],
      1500,
      { scheduler, label: 'gone' },
    );
    await expect(gate).rejects.toBe(shutdown);
    expect(scheduler.armedMs).toEqual([1500]);
    expect(scheduler.live).toEqual([]);
    // the disarmed piece's deadline reads FIRED, so a poll it still runs
    // (the variant settle) stops instead of asking a dying context forever
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0].fired).toBe(true);
    expect(late).toHaveLength(1);
    await late[0]();
    expect(scheduler.armedMs).toEqual([1500]);
    // and the piece released after the close is handed a fired deadline too
    expect(deadlines).toHaveLength(2);
    expect(deadlines[1].fired).toBe(true);
    expect(gpuPrepEventsSnapshot().total).toBe(0);
  });
});

describe('SerialGateLane', () => {
  // A promise chain settles over a few microtasks; a macrotask hop is the
  // robust "everything queued has run" boundary.
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('starts one gate at a time, in arrival order, and runs each caller reaction on its settle', async () => {
    const lane = new SerialGateLane();
    const started: string[] = [];
    const settles: Record<string, () => void> = {};
    const reactions: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      lane.enqueue(
        (settled) => {
          started.push(name);
          settles[name] = settled;
        },
        () => reactions.push(name),
      );
    }
    expect(lane.pending).toBe(3);
    await tick();
    // only the head started
    expect(started).toEqual(['a']);
    settles.a();
    // a double settle is inert
    settles.a();
    expect(reactions).toEqual(['a']);
    await tick();
    expect(started).toEqual(['a', 'b']);
    expect(lane.pending).toBe(2);
    settles.b();
    await tick();
    expect(started).toEqual(['a', 'b', 'c']);
    settles.c();
    expect(reactions).toEqual(['a', 'b', 'c']);
    expect(lane.pending).toBe(0);
  });

  it('a gate that settles synchronously frees the lane for the next at once', async () => {
    const lane = new SerialGateLane();
    const started: string[] = [];
    lane.enqueue((settled) => {
      started.push('sync');
      settled();
    });
    lane.enqueue((settled) => {
      started.push('next');
      settled();
    });
    await tick();
    expect(started).toEqual(['sync', 'next']);
    expect(lane.pending).toBe(0);
  });
});

describe('settlePendingSwap', () => {
  it('clears the token when it still names the settling owner', () => {
    const root = { id: 'bear' };
    expect(settlePendingSwap(root, root)).toBeNull();
  });

  it('leaves an already-clear token alone', () => {
    expect(settlePendingSwap(null, { id: 'bear' })).toBeNull();
  });

  it('does not clobber a newer pending swap: the classic druid form-dance race', () => {
    // Bear form is built and gated first (token = bearRoot). Before its compile
    // settles, the player reswaps to cat form, which is built and gated second
    // (token = catRoot, overwriting bearRoot). When bear's gate finally settles,
    // its callback must NOT clear cat's still-pending token, or cat would reveal
    // one frame before its own shader actually finished linking: the exact
    // freeze this gate exists to prevent, just relocated to a rapid form swap.
    const bearRoot = { id: 'bear' };
    const catRoot = { id: 'cat' };
    let pending: typeof bearRoot | typeof catRoot | null = bearRoot;
    pending = catRoot; // cat's build reassigns the shared token before bear settles
    pending = settlePendingSwap(pending, bearRoot); // bear's onSettled fires late
    expect(pending).toBe(catRoot);
    pending = settlePendingSwap(pending, catRoot); // cat's own onSettled fires next
    expect(pending).toBeNull();
  });
});
