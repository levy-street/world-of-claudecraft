import { describe, expect, it } from 'vitest';
import {
  COMPILE_UNIT_ROOT_LABELS,
  compileRootLabel,
  createPrewarmCompileLifecycle,
} from '../src/render/prewarm_compile_lifecycle';

describe('prewarm compile lifecycle', () => {
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
