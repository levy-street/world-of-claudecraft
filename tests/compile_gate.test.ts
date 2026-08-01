import { describe, expect, it, vi } from 'vitest';
import { type CompileGateScheduler, raceCompileGate } from '../src/render/compile_gate';

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

describe('raceCompileGate', () => {
  it('resolves once compile() resolves, before the timeout fires', async () => {
    const scheduler = fakeScheduler();
    let resolveCompile!: () => void;
    const compile = () => new Promise<void>((resolve) => (resolveCompile = resolve));
    const gate = raceCompileGate(compile, 1500, scheduler);
    let done = false;
    void gate.then(() => {
      done = true;
    });
    expect(done).toBe(false);
    resolveCompile();
    await gate;
    await Promise.resolve();
    expect(done).toBe(true);
    expect(scheduler.cleared).toContain(scheduler.pendingId ?? -1);
  });

  it('resolves once compile() rejects, treating failure the same as success', async () => {
    const scheduler = fakeScheduler();
    let rejectCompile!: (err: unknown) => void;
    const compile = () => new Promise<void>((_resolve, reject) => (rejectCompile = reject));
    const gate = raceCompileGate(compile, 1500, scheduler);
    rejectCompile(new Error('link failed'));
    await expect(gate).resolves.toBeUndefined();
  });

  it('resolves via the timeout when compile() never settles', async () => {
    const scheduler = fakeScheduler();
    const compile = () => new Promise<void>(() => {});
    const gate = raceCompileGate(compile, 1500, scheduler);
    let done = false;
    void gate.then(() => {
      done = true;
    });
    expect(done).toBe(false);
    scheduler.fire();
    await gate;
    expect(done).toBe(true);
  });

  it('only resolves once even if both the compile and the timeout fire', async () => {
    const scheduler = fakeScheduler();
    let resolveCompile!: () => void;
    const compile = () => new Promise<void>((resolve) => (resolveCompile = resolve));
    const gate = raceCompileGate(compile, 1500, scheduler);
    const spy = vi.fn();
    void gate.then(spy);
    resolveCompile();
    await gate;
    scheduler.fire();
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('resolves and clears the timer when compile() throws synchronously', async () => {
    const scheduler = fakeScheduler();
    const compile = (): Promise<unknown> => {
      throw new Error('extension unavailable');
    };
    const gate = raceCompileGate(compile, 1500, scheduler);
    await expect(gate).resolves.toBeUndefined();
    expect(scheduler.cleared.length).toBeGreaterThan(0);
  });
});
