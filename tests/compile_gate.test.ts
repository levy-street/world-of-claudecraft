import { describe, expect, it, vi } from 'vitest';
import {
  awaitCompileGate,
  CompileGateQueue,
  type CompileGateScheduler,
} from '../src/render/compile_gate';

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

  it('uses a shared GPU arbiter and forwards live priority', async () => {
    const priorities: Array<number | undefined> = [];
    const sharedQueue = {
      run: async <T>(work: () => T | Promise<T>, priority?: number): Promise<T> => {
        priorities.push(priority);
        return work();
      },
    };
    const queue = new CompileGateQueue(sharedQueue);

    await expect(queue.run(() => Promise.resolve(), 1500, { priority: 40 })).resolves.toEqual({
      failed: false,
      timedOut: false,
    });
    expect(priorities).toEqual([40]);
  });
});
