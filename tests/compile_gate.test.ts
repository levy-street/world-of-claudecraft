import { describe, expect, it, vi } from 'vitest';
import { createBackgroundGpuQueue } from '../src/render/background_gpu_queue';
import {
  awaitCompileGate,
  CompileGateQueue,
  type CompileGateScheduler,
  settlePendingSwap,
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
