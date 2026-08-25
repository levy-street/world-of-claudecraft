// The boot manifest's world.initial-frame pass runs only when the compile
// lane left no link debt (src/render/initial_frame_core.ts); otherwise the
// entry defers honestly and the reveal gates plus the resume lane pay.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deferredPassArms,
  initialFrameDeferral,
  initialFrameLinkDebt,
  initialFrameShouldDefer,
} from '../src/render/initial_frame_core';

const settled = { submittedAtMs: 10, settledAtMs: 50, failedAtMs: null };
const failed = { submittedAtMs: 10, settledAtMs: null, failedAtMs: 40 };
const linking = { submittedAtMs: 10, settledAtMs: null, failedAtMs: null };
const deferred = { submittedAtMs: null, settledAtMs: null, failedAtMs: null };

describe('initialFrameLinkDebt', () => {
  it('counts never-submitted units as deferred and submitted-unsettled ones as unsettled', () => {
    expect(initialFrameLinkDebt([settled, failed, linking, linking, deferred])).toEqual({
      deferredUnits: 1,
      unsettledUnits: 2,
    });
    // settled and failed units are no debt: the pass would not wait on them
    expect(initialFrameLinkDebt([settled, failed])).toEqual({
      deferredUnits: 0,
      unsettledUnits: 0,
    });
    expect(initialFrameLinkDebt([])).toEqual({ deferredUnits: 0, unsettledUnits: 0 });
  });
});

describe('initialFrameDeferral', () => {
  it('draws (null) only with zero debt, defers on one deferred OR one unsettled unit', () => {
    expect(initialFrameDeferral([settled, settled, failed])).toBeNull();
    expect(initialFrameDeferral([settled, linking])).toEqual({
      deferredUnits: 0,
      unsettledUnits: 1,
    });
    expect(initialFrameDeferral([settled, deferred])).toEqual({
      deferredUnits: 1,
      unsettledUnits: 0,
    });
    expect(initialFrameShouldDefer({ deferredUnits: 0, unsettledUnits: 0 })).toBe(false);
    expect(initialFrameShouldDefer({ deferredUnits: 0, unsettledUnits: 1 })).toBe(true);
    expect(initialFrameShouldDefer({ deferredUnits: 3, unsettledUnits: 0 })).toBe(true);
  });
});

describe('deferredPassArms', () => {
  it('reports a deferred pass as partial with the debt, and a drawn pass as complete', () => {
    let debt: ReturnType<typeof initialFrameDeferral> = null;
    const arms = deferredPassArms(() => debt);
    expect(arms.progress()).toEqual({ done: 1, planned: 1, trimmed: false });
    expect(arms.detail()).toBe('drawn');
    debt = { deferredUnits: 3, unsettledUnits: 12 };
    expect(arms.progress()).toEqual({ done: 0, planned: 1, trimmed: true });
    expect(arms.detail()).toBe('deferred;link-debt:deferred=3,unsettled=12');
  });

  it('reports only a real deferral for an optional pass', () => {
    let debt: ReturnType<typeof initialFrameDeferral> = null;
    const arms = deferredPassArms(() => debt, false);
    expect(arms.progress()).toBeNull();
    expect(arms.detail()).toBe('eligible');
    debt = { deferredUnits: 1, unsettledUnits: 2 };
    expect(arms.progress()).toEqual({ done: 0, planned: 1, trimmed: true });
    expect(arms.detail()).toBe('deferred;link-debt:deferred=1,unsettled=2');
  });
});

describe('the renderer wires the policy into the world.initial-frame entry', () => {
  it('decides from the compile lifecycle records before drawing, and reports through the arms', () => {
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const entryAt = renderer.indexOf("id: 'world.initial-frame'");
    const nextEntryAt = renderer.indexOf("id: 'programs.compile'", entryAt);
    const entry = renderer.slice(entryAt, nextEntryAt);
    expect(entryAt).toBeGreaterThan(-1);
    const decide = entry.indexOf(
      'initialFrameDeferred = initialFrameDeferral(compileLifecycle.records);',
    );
    const bail = entry.indexOf('if (initialFrameDeferred) return;');
    const draw = entry.indexOf('this.renderPrewarmPass(1 / 60);');
    expect(decide).toBeGreaterThan(-1);
    expect(bail).toBeGreaterThan(decide);
    expect(draw).toBeGreaterThan(bail);
    expect(entry).toContain('...deferredPassArms(() => initialFrameDeferred),');
    // still never sacrificed to the soft deadline: the decision is the policy's, not the clock's
    expect(entry).toContain('deadlineExempt: true,');
  });

  it('refuses optional sky and settle draws while compile debt is still outstanding', () => {
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    for (const [id, nextId] of [
      ['sky.current-zone', 'render.settle-passes'],
      ['render.settle-passes', 'diagnostics.baseline'],
    ] as const) {
      const start = renderer.indexOf(`id: '${id}'`);
      const end = renderer.indexOf(`id: '${nextId}'`, start);
      const entry = renderer.slice(start, end);
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(entry).toContain('initialFrameDeferral(compileLifecycle.records)');
      expect(entry.indexOf('initialFrameDeferral(compileLifecycle.records)')).toBeLessThan(
        entry.indexOf('this.renderPrewarmPass(1 / 60)'),
      );
    }
  });

  it('refuses the budget-variant world draw while compile debt is still outstanding', () => {
    const renderer = readFileSync(
      new URL('../src/render/renderer.ts', import.meta.url),
      'utf8',
    ).replace(/\r\n/g, '\n');
    const start = renderer.indexOf("id: 'programs.budget-variants'");
    const end = renderer.indexOf("id: 'sky.current-zone'", start);
    const entry = renderer.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const decide = entry.indexOf(
      'budgetVariantsDeferred = initialFrameDeferral(compileLifecycle.records);',
    );
    const guard = entry.indexOf('if (budgetVariantsDeferred) return;');
    const draw = entry.indexOf('this.renderPrewarmPass(1 / 60);');
    expect(decide).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(decide);
    expect(draw).toBeGreaterThan(guard);
    expect(entry).toContain('...deferredPassArms(() => budgetVariantsDeferred, false),');
  });
});
