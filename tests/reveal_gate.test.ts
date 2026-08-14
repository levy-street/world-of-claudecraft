import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRevealGate, REVEAL_GATE_WATCHDOG_MS } from '../src/render/reveal_gate';

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Deferred {
  promise: Promise<unknown>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = () => res(undefined);
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A schedule fake that records arms/cancels and lets a test fire the timeout. */
function fakeSchedule() {
  const state = {
    armedMs: [] as number[],
    cancels: 0,
    fire: () => undefined as void,
  };
  const schedule = (onTimeout: () => void, ms: number): (() => void) => {
    state.armedMs.push(ms);
    state.fire = () => onTimeout();
    return () => {
      state.cancels++;
    };
  };
  return { state, schedule };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('reveal gate driver', () => {
  it('compiles every root behind the key and settles once all resolve', async () => {
    const rootA = { name: 'a' };
    const rootB = { name: 'b' };
    const pending = new Map<object, Deferred>();
    const { schedule } = fakeSchedule();
    const gate = createRevealGate(
      {
        compile: (root) => {
          const d = deferred();
          pending.set(root, d);
          return d.promise;
        },
        schedule,
      },
      () => [rootA, rootB],
    );
    expect(gate.allow('cell')).toBe(false);
    expect([...pending.keys()]).toEqual([rootA, rootB]);
    pending.get(rootA)?.resolve();
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(false);
    pending.get(rootB)?.resolve();
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(true);
  });

  it('cancels the watchdog once the compiles settle', async () => {
    const { state, schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => Promise.resolve(), schedule }, () => [{}]);
    gate.allow('cell');
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(true);
    expect(state.cancels).toBe(1);
    // A late timeout firing after the cancel window must be inert.
    state.fire();
    expect(gate.allow('cell')).toBe(true);
  });

  it('settles on mixed resolved and rejected compiles (fail-soft)', async () => {
    const { schedule } = fakeSchedule();
    let first = true;
    const gate = createRevealGate(
      {
        compile: () => {
          if (first) {
            first = false;
            return Promise.resolve();
          }
          return Promise.reject(new Error('link failed'));
        },
        schedule,
      },
      () => [{}, {}],
    );
    expect(gate.allow('cell')).toBe(false);
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(true);
  });

  it('absorbs a synchronous throw from a compile request and still settles', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { schedule } = fakeSchedule();
    const gate = createRevealGate(
      {
        compile: () => {
          throw new Error('sync throw');
        },
        schedule,
      },
      () => [{}],
    );
    expect(() => gate.allow('cell')).not.toThrow();
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(true);
    expect(errors).toHaveBeenCalled();
  });

  it('absorbs a throwing roots provider and still settles', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => Promise.resolve(), schedule }, () => {
      throw new Error('no roots');
    });
    expect(() => gate.allow('cell')).not.toThrow();
    await flushMicrotasks();
    expect(gate.allow('cell')).toBe(true);
    expect(errors).toHaveBeenCalled();
  });

  it('the watchdog settles a key whose compile never resolves, and warns', async () => {
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { state, schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => new Promise(() => undefined), schedule }, () => [
      {},
    ]);
    expect(gate.allow('cell')).toBe(false);
    expect(state.armedMs).toEqual([REVEAL_GATE_WATCHDOG_MS]);
    state.fire();
    expect(gate.allow('cell')).toBe(true);
    expect(warns).toHaveBeenCalledOnce();
  });

  it('pins the watchdog bound to its literal', () => {
    // The schedule fakes above would stay green if the constant drifted to 0,
    // which turns the whole gate into a no-op in production.
    expect(REVEAL_GATE_WATCHDOG_MS).toBe(10_000);
  });

  it('the default scheduler holds until the real watchdog elapses', () => {
    vi.useFakeTimers();
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gate = createRevealGate({ compile: () => new Promise(() => undefined) }, () => [{}]);
    expect(gate.allow('cell')).toBe(false);
    vi.advanceTimersByTime(REVEAL_GATE_WATCHDOG_MS - 1);
    expect(gate.allow('cell')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(gate.allow('cell')).toBe(true);
    expect(warns).toHaveBeenCalledOnce();
  });

  it('a key with no roots settles immediately', async () => {
    const { schedule } = fakeSchedule();
    const gate = createRevealGate({ compile: () => Promise.resolve(), schedule }, () => []);
    expect(gate.allow('empty')).toBe(false);
    await flushMicrotasks();
    expect(gate.allow('empty')).toBe(true);
  });

  it('requests each key once and resolves roots per key', async () => {
    const asked: string[] = [];
    let compiles = 0;
    const { schedule } = fakeSchedule();
    const gate = createRevealGate(
      {
        compile: () => {
          compiles++;
          return Promise.resolve();
        },
        schedule,
      },
      (key) => {
        asked.push(key);
        return [{}, {}];
      },
    );
    gate.allow('a');
    gate.allow('a');
    gate.allow('b');
    await flushMicrotasks();
    expect(asked).toEqual(['a', 'b']);
    expect(compiles).toBe(4);
    expect(gate.allow('a')).toBe(true);
    expect(gate.allow('b')).toBe(true);
  });
});
