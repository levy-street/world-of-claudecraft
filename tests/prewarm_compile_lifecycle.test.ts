import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPILE_UNIT_ROOT_LABELS,
  compileRootLabel,
  createPrewarmBudgetVariantHost,
  createPrewarmCompileLifecycle,
  runPrewarmBudgetVariants,
} from '../src/render/prewarm_compile_lifecycle';

describe('prewarm compile lifecycle', () => {
  it('keeps the budget-variant clock bound to its performance receiver', () => {
    const clock = {
      now(this: unknown) {
        expect(this).toBe(clock);
        return 0;
      },
    };
    const host = createPrewarmBudgetVariantHost(
      {
        deadlineMs: 100,
        programCount: () => 0,
        applyLevels: () => {},
        renderPass: () => 1,
      },
      clock,
    );

    expect(
      runPrewarmBudgetVariants(
        [{ grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: 1 }],
        [],
        host,
      ),
    ).toEqual({ timedOut: false });
  });

  it('records bounded shader variants with numeric program and pass deltas', () => {
    let now = 0;
    let programs = 3;
    let passes = 0;
    const stats: Parameters<typeof runPrewarmBudgetVariants>[1] = [
      {
        index: -1,
        levels: { grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: 1 },
        elapsedMs: 0,
        syncMs: 0,
        programsBefore: 0,
        programsAfter: 0,
        programDelta: 0,
        passes: 10,
      },
    ];
    passes = 10;
    const levels = [
      { grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: 1 },
      { grass: 0.5, foliage: 0.75, vfx: 0.8, lighting: 0.9, resolution: 0.95 },
    ];
    const appliedLevels: typeof levels = [];

    const result = runPrewarmBudgetVariants(levels, stats, {
      deadlineMs: 100,
      now: () => now,
      programCount: () => programs,
      applyLevels: (applied) => {
        appliedLevels.push({ ...applied });
        now += 1;
        programs += 2;
      },
      renderPass: () => {
        now += 4;
        return ++passes;
      },
    });

    expect(result).toEqual({ timedOut: false });
    expect(appliedLevels).toEqual(levels);
    expect(stats.slice(1)).toEqual([
      expect.objectContaining({
        index: 0,
        elapsedMs: 5,
        syncMs: 4,
        programsBefore: 3,
        programsAfter: 5,
        programDelta: 2,
        passes: 1,
      }),
      expect.objectContaining({
        index: 1,
        elapsedMs: 5,
        syncMs: 4,
        programsBefore: 5,
        programsAfter: 7,
        programDelta: 2,
        passes: 1,
      }),
    ]);
  });

  it('stops before the first variant and accepts an empty variant list', () => {
    let applied = 0;
    const host = {
      deadlineMs: 10,
      now: () => 10,
      programCount: () => 0,
      applyLevels: () => {
        applied++;
      },
      renderPass: () => {
        applied++;
        return applied;
      },
    };
    const stats: Parameters<typeof runPrewarmBudgetVariants>[1] = [];
    const levels = [{ grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: 1 }];

    expect(runPrewarmBudgetVariants([], stats, host)).toEqual({ timedOut: false });
    expect(stats).toEqual([]);
    expect(runPrewarmBudgetVariants(levels, stats, host)).toEqual({ timedOut: true });
    expect(stats).toEqual([]);
    expect(applied).toBe(0);
  });

  it('stops before the next variant when the first pass reaches the deadline', () => {
    let now = 0;
    let applied = 0;
    const stats: Parameters<typeof runPrewarmBudgetVariants>[1] = [];
    const levels = [
      { grass: 1, foliage: 1, vfx: 1, lighting: 1, resolution: 1 },
      { grass: 0.5, foliage: 0.75, vfx: 0.8, lighting: 0.9, resolution: 0.95 },
    ];

    const result = runPrewarmBudgetVariants(levels, stats, {
      deadlineMs: 5,
      now: () => now,
      programCount: () => 0,
      applyLevels: () => {
        applied++;
        now = 1;
      },
      renderPass: () => {
        now = 5;
        return 1;
      },
    });

    expect(result).toEqual({ timedOut: true });
    expect(applied).toBe(1);
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ index: 0, passes: 1 });
  });

  it('is handed the renderer GPU submit guard, never the hard deadline (source pin)', () => {
    // Every variant runs a real renderPrewarmPass, and an already-started
    // WebGL call cannot be cancelled: launching one at hardDeadline - epsilon
    // overshoots the wall and defers every entry behind it, the deadline-exempt
    // debt payers included. The unit tests above pass literal deadlines, so
    // only a source pin can catch the call site swapping the two clocks.
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const call = source.indexOf('createPrewarmBudgetVariantHost({');
    expect(call).toBeGreaterThan(-1);
    const host = source.slice(call, source.indexOf('})', call));
    expect(host).toContain('deadlineMs: gpuSubmitDeadline,');
    expect(host).not.toContain('deadlineMs: hardDeadline,');
    // And the guard itself stays a real reserve carved out of the wall.
    expect(source).toContain(
      'const gpuSubmitDeadline = Math.max(started, hardDeadline - PREWARM_GPU_SUBMIT_GUARD_MS);',
    );
    // Pinned to its LITERAL, not just by symbol name: set the constant to 0 and
    // the whole "submit guard, never the hard deadline" fix silently becomes a
    // no-op with every other assertion above still green.
    expect(source).toContain('const PREWARM_GPU_SUBMIT_GUARD_MS = 1000;');
    // Its sibling reserve, for the same reason: the compile entry's tail passes
    // min(gpuSubmitDeadline, compileAwaitDeadline), so a zeroed await reserve
    // would let the submit loop eat the initial frame's link window.
    expect(source).toContain('const PREWARM_COMPILE_AWAIT_RESERVE_MS = 2000;');
  });

  it('records the synchronous and asynchronous boundaries on the injected clock', () => {
    let now = 100.1234;
    const lifecycle = createPrewarmCompileLifecycle(() => now);
    const record = lifecycle.recordFor({ id: 'unit-a' }, 'programs.compile-submit');
    lifecycle.markSubmitted(record);
    now = 102.5678;
    lifecycle.markSyncEnd(record);
    now = 140.555;
    lifecycle.markSettled(record);
    expect(record).toMatchObject({
      submittedAtMs: 100.12,
      syncEndAtMs: 102.57,
      settledAtMs: 140.56,
      programsBefore: null,
      programsAfter: null,
      programDelta: null,
      chargedLinks: null,
      syncMs: 2.45,
      settledDurationMs: 37.99,
    });
  });

  it('records compile counts, charged links, synchronous time, and settle duration', () => {
    let now = 10;
    const lifecycle = createPrewarmCompileLifecycle(() => now);
    const record = lifecycle.recordFor({ id: 'unit-a' }, 'programs.compile');
    lifecycle.markSubmitted(record);
    now = 16.5;
    lifecycle.markSyncEnd(record, {
      programsBefore: 4,
      programsAfter: 9,
      chargedLinks: 5,
    });
    now = 41.25;
    lifecycle.markSettled(record);

    expect(record).toMatchObject({
      programsBefore: 4,
      programsAfter: 9,
      programDelta: 5,
      chargedLinks: 5,
      syncMs: 6.5,
      settledDurationMs: 24.75,
    });
  });

  it('classifies settled, pending, deferred and failed units at reveal', () => {
    let now = 1;
    const lifecycle = createPrewarmCompileLifecycle(() => now++);
    const settled = lifecycle.recordFor({ id: 'settled' }, 'submit');
    lifecycle.markSubmitted(settled);
    lifecycle.markSyncEnd(settled);
    lifecycle.markSettled(settled);
    const pending = lifecycle.recordFor({ id: 'pending' }, 'submit');
    lifecycle.markSubmitted(pending);
    lifecycle.markSyncEnd(pending);
    lifecycle.recordFor({ id: 'deferred' }, 'submit');
    const failed = lifecycle.recordFor({ id: 'failed' }, 'submit');
    lifecycle.markSubmitted(failed);
    lifecycle.markFailed(failed);
    lifecycle.markReveal();
    expect(lifecycle.records.map((record) => [record.id, record.statusAtReveal])).toEqual([
      ['settled', 'settled'],
      ['pending', 'pending'],
      ['deferred', 'deferred'],
      ['failed', 'failed'],
    ]);
  });

  it('labels units first discovered after reveal and preserves unit identity', () => {
    const lifecycle = createPrewarmCompileLifecycle(() => 1);
    const unit = { id: 'late' };
    const first = lifecycle.recordFor(unit, 'planned');
    expect(lifecycle.recordFor(unit, 'submit')).toBe(first);
    expect(first.lane).toBe('submit');
    lifecycle.markReveal();
    expect(lifecycle.recordFor({ id: 'post' }, 'resume').statusAtReveal).toBe('post-reveal');
  });

  it("labels a unit's roots for the capture when a labeler is installed, bounded per unit", () => {
    // A capture could say a unit was deferred at the reveal but not WHICH
    // scene objects it left unlinked (bench batch 17 had to infer the far
    // bakes from the live draw cadence). The record carries the roots as
    // `name|material` labels, at most COMPILE_UNIT_ROOT_LABELS of them.
    expect(COMPILE_UNIT_ROOT_LABELS).toBe(32);
    expect(compileRootLabel({ name: 'far-bake:0:5', material: { name: 'village:Bell' } })).toBe(
      'far-bake:0:5|village:Bell',
    );
    expect(
      compileRootLabel({ type: 'Mesh', material: [{ name: '' }, { name: 'qprops:Trim' }] }),
    ).toBe('Mesh|qprops:Trim');
    expect(compileRootLabel({ name: '', type: 'InstancedMesh', material: null })).toBe(
      'InstancedMesh',
    );
    const labeled = createPrewarmCompileLifecycle(
      () => 1,
      (root) => compileRootLabel(root as { name?: string }),
    );
    const roots = Array.from({ length: COMPILE_UNIT_ROOT_LABELS + 3 }, (_, i) => ({
      name: `root-${i}`,
    }));
    const record = labeled.recordFor({ id: 'scene:6', roots }, 'programs.compile');
    expect(record.roots).toHaveLength(COMPILE_UNIT_ROOT_LABELS);
    expect(record.roots?.[0]).toBe('root-0');
    // No labeler, or a unit without roots: no field at all.
    expect(
      createPrewarmCompileLifecycle(() => 1).recordFor({ id: 'a', roots }, 'x').roots,
    ).toBeUndefined();
    expect(labeled.recordFor({ id: 'b' }, 'x').roots).toBeUndefined();
  });
});
