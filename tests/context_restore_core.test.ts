// The pure half of a WebGL context restore (src/render/context_restore_core.ts):
// the reset registry and the pass sequencing the host drives.
import { describe, expect, it, vi } from 'vitest';
import { ARRIVAL_REVEAL_SETTLE_MAX_MS } from '../src/game/arrival_warmup';
import {
  CONTEXT_RESTORE_HOLD_MAX_MS,
  createContextRestoreRegistry,
  createContextRestoreSequence,
} from '../src/render/context_restore_core';

describe('context restore registry', () => {
  it('resets every live owner once per run, whatever order they registered in', () => {
    const registry = createContextRestoreRegistry();
    const a = { done: true };
    const b = { done: true };
    const c = { ready: 3 };
    registry.register('flag', a, (owner) => {
      owner.done = false;
    });
    registry.register('flag', b, (owner) => {
      owner.done = false;
    });
    registry.register('bits', c, (owner) => {
      owner.ready = 0;
    });
    // A second registration of the same owner is a no-op, not a second reset.
    const reset = vi.fn();
    registry.register('flag', a, reset);
    const report = registry.run();
    expect(a.done).toBe(false);
    expect(b.done).toBe(false);
    expect(c.ready).toBe(0);
    expect(reset).not.toHaveBeenCalled();
    expect(report).toEqual({ owners: 2, instances: 3, failed: [] });
    expect(registry.counts()).toEqual(
      new Map([
        ['flag', 2],
        ['bits', 1],
      ]),
    );
  });

  it('isolates a throwing reset: every other owner still resets, the failure is named', () => {
    const registry = createContextRestoreRegistry();
    const after = { done: true };
    registry.register('broken', {}, () => {
      throw new Error('boom');
    });
    registry.register('after', after, (owner) => {
      owner.done = false;
    });
    const errors: string[] = [];
    const report = registry.run((id) => errors.push(id));
    expect(after.done).toBe(false);
    expect(report.failed).toEqual(['broken']);
    expect(report.instances).toBe(1);
    expect(errors).toEqual(['broken']);
  });

  it('prunes dead owners on registration, so a session between restores stays bounded', () => {
    const registry = createContextRestoreRegistry();
    // WeakRefs whose target is already gone, the way a collected rig looks,
    // counting how often the registry looks at them.
    const RealWeakRef = globalThis.WeakRef;
    let derefs = 0;
    globalThis.WeakRef = class {
      deref(): undefined {
        derefs++;
        return undefined;
      }
    } as unknown as WeakRefConstructor;
    try {
      for (let i = 0; i < 500; i++) registry.register('rig', {}, () => {});
    } finally {
      globalThis.WeakRef = RealWeakRef;
    }
    // Registration alone pruned (only run/bound/counts would otherwise look),
    // and every prune found the list empty again: at most one live pass over
    // each batch, never the whole history.
    expect(derefs).toBeGreaterThan(0);
    expect(derefs).toBeLessThan(500);
    expect(registry.counts().get('rig')).toBe(0);
  });

  it('binds each live owner to its callback for a host that runs them one by one', () => {
    const registry = createContextRestoreRegistry();
    const target = { baked: 0 };
    registry.register('target', target, (owner) => {
      owner.baked++;
    });
    const bound = registry.bound();
    expect(bound.map((entry) => entry.id)).toEqual(['target']);
    expect(target.baked).toBe(0);
    bound[0].run();
    expect(target.baked).toBe(1);
  });
});

describe('context restore pass sequencing', () => {
  it('holds for at most the arrival bound, online and offline alike', () => {
    expect(CONTEXT_RESTORE_HOLD_MAX_MS).toBe(3000);
    expect(CONTEXT_RESTORE_HOLD_MAX_MS).toBe(ARRIVAL_REVEAL_SETTLE_MAX_MS);
    const sequence = createContextRestoreSequence();
    sequence.lost(0);
    const pass = sequence.restored(1000);
    expect(sequence.holdDeadline()).toBe(1000 + CONTEXT_RESTORE_HOLD_MAX_MS);
    expect(sequence.snapshot().phase).toBe('holding');
    expect(sequence.endHold(pass, 1400, 'settled')).toBe(true);
    expect(sequence.holdDeadline()).toBeNull();
    expect(sequence.snapshot()).toMatchObject({
      phase: 'resuming',
      losses: 1,
      restores: 1,
      lastHold: { ms: 400, end: 'settled' },
    });
    sequence.resumed(pass);
    expect(sequence.snapshot().phase).toBe('live');
  });

  it('a second loss cancels the pass: its generation is stale and its hold is recorded cancelled', () => {
    const sequence = createContextRestoreSequence(3000);
    sequence.lost(0);
    const first = sequence.restored(100);
    sequence.lost(600);
    expect(sequence.current(first)).toBe(false);
    expect(sequence.snapshot().lastHold).toEqual({ ms: 500, end: 'cancelled' });
    // The stale pass can neither end a hold nor move the phase.
    expect(sequence.endHold(first, 700, 'settled')).toBe(false);
    sequence.resumed(first);
    expect(sequence.snapshot().phase).toBe('lost');
    const second = sequence.restored(900);
    expect(sequence.current(second)).toBe(true);
    expect(sequence.endHold(second, 900 + 3000, 'bound')).toBe(true);
    expect(sequence.endHold(second, 900 + 3001, 'settled')).toBe(false);
    expect(sequence.snapshot().lastHold).toEqual({ ms: 3000, end: 'bound' });
  });
});
