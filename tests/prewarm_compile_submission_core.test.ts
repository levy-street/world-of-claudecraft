import { describe, expect, it, vi } from 'vitest';
import type { PrewarmPacing } from '../src/render/link_rate_budget';
import type { PrewarmCompileLifecycle } from '../src/render/prewarm_compile_lifecycle';
import {
  type PrewarmCompileUnitLike,
  runPrewarmCompileSubmission,
  submitPrewarmCompileUnit,
} from '../src/render/prewarm_compile_submission_core';

function harness() {
  const events: string[] = [];
  const record = {
    id: 'scene:0',
    lane: 'programs.compile-submit',
    submittedAtMs: null,
    syncEndAtMs: null,
    settledAtMs: null,
    failedAtMs: null,
    statusAtReveal: null,
  } as const;
  const lifecycle = {
    recordFor: vi.fn(() => record),
    markSubmitted: vi.fn(() => events.push('lifecycle:submitted')),
    markSyncEnd: vi.fn(() => events.push('lifecycle:sync-end')),
    markSettled: vi.fn(() => events.push('lifecycle:settled')),
    markFailed: vi.fn(() => events.push('lifecycle:failed')),
  } as unknown as PrewarmCompileLifecycle;
  const pacing = {
    markSubmitted: vi.fn(() => events.push('pacing:submitted')),
    markSyncEnd: vi.fn((_id: string, links: number) => events.push(`pacing:sync-end:${links}`)),
    markSettled: vi.fn(() => events.push('pacing:settled')),
    markFailed: vi.fn(() => events.push('pacing:failed')),
  } as unknown as PrewarmPacing;
  return { events, lifecycle, pacing };
}

describe('prewarm compile submission core', () => {
  it('reports the synchronous program delta before the asynchronous settlement', async () => {
    const { events, lifecycle, pacing } = harness();
    let programs = 10;
    let settle!: () => void;
    const unit = {
      id: 'scene:0',
      run: () => {
        events.push('run');
        programs = 14;
        return new Promise<void>((resolve) => {
          settle = resolve;
        });
      },
    };

    const submitted = submitPrewarmCompileUnit(unit, 'programs.compile-submit', {
      lifecycle,
      pacing,
      programCount: () => programs,
      onError: vi.fn(),
    });

    expect(events).toEqual([
      'lifecycle:submitted',
      'pacing:submitted',
      'run',
      'lifecycle:sync-end',
      'pacing:sync-end:4',
    ]);
    settle();
    await submitted.done;
    expect(events.slice(-2)).toEqual(['lifecycle:settled', 'pacing:settled']);
  });

  it('passes before and after counts plus the charged delta to lifecycle telemetry', () => {
    const { lifecycle, pacing } = harness();
    let programs = 10;
    submitPrewarmCompileUnit(
      {
        id: 'scene:0',
        run: () => {
          programs = 14;
        },
      },
      'programs.compile-submit',
      {
        lifecycle,
        pacing,
        programCount: () => programs,
        onError: vi.fn(),
      },
    );

    expect(lifecycle.markSyncEnd).toHaveBeenCalledWith(expect.anything(), {
      programsBefore: 10,
      programsAfter: 14,
      chargedLinks: 4,
    });
  });

  it('turns a synchronous throw into a fail-soft settled submission', async () => {
    const { events, lifecycle, pacing } = harness();
    const error = new Error('compile failed');
    const onError = vi.fn();
    const submitted = submitPrewarmCompileUnit(
      {
        id: 'scene:0',
        run: () => {
          throw error;
        },
      },
      'programs.compile',
      { lifecycle, pacing, programCount: () => 10, onError },
    );

    await expect(submitted.done).resolves.toBeUndefined();
    expect(events).toEqual([
      'lifecycle:submitted',
      'pacing:submitted',
      'lifecycle:sync-end',
      'pacing:sync-end:0',
      'lifecycle:failed',
      'pacing:failed',
    ]);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('turns a rejected promise into a fail-soft settled submission', async () => {
    // The arm that actually happens in the wild: an async compile whose driver
    // work rejects later, not a synchronous throw. Dropping markFailed here
    // leaves the unit in flight forever, so the adaptive window never reopens
    // and every remaining prewarm unit waits behind it.
    const { events, lifecycle, pacing } = harness();
    const error = new Error('link rejected');
    const onError = vi.fn();
    let programs = 10;
    const submitted = submitPrewarmCompileUnit(
      {
        id: 'scene:0',
        run: () => {
          programs = 13;
          return Promise.reject(error);
        },
      },
      'programs.compile',
      { lifecycle, pacing, programCount: () => programs, onError },
    );

    await expect(submitted.done).resolves.toBeUndefined();
    expect(events).toEqual([
      'lifecycle:submitted',
      'pacing:submitted',
      'lifecycle:sync-end',
      'pacing:sync-end:3',
      'lifecycle:failed',
      'pacing:failed',
    ]);
    expect(onError).toHaveBeenCalledWith(error);
  });
});

describe('runPrewarmCompileSubmission', () => {
  const units = (n: number): PrewarmCompileUnitLike[] =>
    Array.from({ length: n }, (_, i) => ({ id: `unit-${i}`, run: () => {} }));

  /** A host that submits everything, recording ids in order. */
  function host(overrides: Partial<Parameters<typeof runPrewarmCompileSubmission>[1]> = {}) {
    const submitted: string[] = [];
    const deferred: string[] = [];
    return {
      submitted,
      deferred,
      host: {
        outOfTime: () => false,
        awaitSlot: async () => true,
        recordDeferred: (unit: PrewarmCompileUnitLike) => deferred.push(unit.id),
        submit: (unit: PrewarmCompileUnitLike) => submitted.push(unit.id),
        yieldSlice: async () => {},
        ...overrides,
      },
    };
  }

  it('submits every unit in order when the lane never stops', async () => {
    const h = host();
    expect(await runPrewarmCompileSubmission(units(3), h.host)).toEqual({ deferred: [] });
    expect(h.submitted).toEqual(['unit-0', 'unit-1', 'unit-2']);
    expect(h.deferred).toEqual([]);
  });

  it('defers the refused unit itself and every unit after it, never dropping one', async () => {
    // The split is the P1 contract: the unit at the refused slot is NOT
    // submitted and NOT skipped, it leads the deferred tail. Their roots were
    // marked seen at build time, so these objects are the only route left to
    // their compiles.
    let slots = 0;
    const h = host({ awaitSlot: async () => slots++ < 2 });
    expect(await runPrewarmCompileSubmission(units(5), h.host)).toEqual({
      deferred: [
        expect.objectContaining({ id: 'unit-2' }),
        expect.objectContaining({ id: 'unit-3' }),
        expect.objectContaining({ id: 'unit-4' }),
      ],
    });
    expect(h.submitted).toEqual(['unit-0', 'unit-1']);
    // Every deferred unit is recorded BEFORE the loop returns.
    expect(h.deferred).toEqual(['unit-2', 'unit-3', 'unit-4']);
  });

  it('checks the slot BEFORE each unit, so a lane already stopped submits nothing', async () => {
    const h = host({ awaitSlot: async () => false });
    const result = await runPrewarmCompileSubmission(units(3), h.host);
    expect(h.submitted).toEqual([]);
    expect(result.deferred).toHaveLength(3);
  });

  it('keeps already-submitted units recorded when the loop throws mid-run', async () => {
    // The extraction regression this pins: recording the batch only at the
    // loop's return would lose units 0 and 1 from the set programs.compile
    // awaits, and world.initial-frame would draw believing their programs were
    // ready with nobody waiting on them.
    let slices = 0;
    const h = host({
      yieldSlice: async () => {
        if (++slices === 2) throw new Error('lane died');
      },
    });
    await expect(runPrewarmCompileSubmission(units(5), h.host)).rejects.toThrow('lane died');
    expect(h.submitted).toEqual(['unit-0', 'unit-1']);
  });

  it('yields after each submission, not before the first', async () => {
    const order: string[] = [];
    const h = host({
      submit: (unit: PrewarmCompileUnitLike) => order.push(`submit:${unit.id}`),
      yieldSlice: async () => {
        order.push('yield');
      },
    });
    await runPrewarmCompileSubmission(units(2), h.host);
    expect(order).toEqual(['submit:unit-0', 'yield', 'submit:unit-1', 'yield']);
  });

  it('accepts an empty plan without touching the lane', async () => {
    const awaitSlot = vi.fn(async () => true);
    const h = host({ awaitSlot });
    expect(await runPrewarmCompileSubmission([], h.host)).toEqual({ deferred: [] });
    expect(awaitSlot).not.toHaveBeenCalled();
  });
});
