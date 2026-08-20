// The pure half of the compile gate's variant settle
// (src/render/program_variant_settle_core.ts): which programs of a piece still
// need a poll, what one pass concludes, and how the next pass is spaced. The
// contract it mirrors is three's own compileAsync poll, so the cadence
// constants are pinned against the patched runtime bundle.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  nextProgramVariantPollMs,
  PROGRAM_VARIANT_POLL_INTERVAL_MAX_MS,
  PROGRAM_VARIANT_POLL_INTERVAL_MS,
  PROGRAM_VARIANT_POLL_PASS_BUDGET_MS,
  pendingProgramVariants,
  pollProgramVariants,
} from '../src/render/program_variant_settle_core';

function program(name: string, answers: boolean[]) {
  const isReady = vi.fn(() => answers.shift() ?? true);
  return { name, isReady };
}

describe('pendingProgramVariants', () => {
  it('lists every variant of every material not yet proved ready, deduped, first-seen order', () => {
    // A tinted clone shared by a skinned rig and its rigid far mesh carries
    // both variants; the depth twin its own; the far mesh's second material
    // shares the rigid program through the program cache.
    const skinned = { name: 'skinned' };
    const rigid = { name: 'rigid' };
    const depth = { name: 'depth' };
    const proved = { name: 'proved' };
    const pending = pendingProgramVariants(
      [[skinned, rigid, proved], undefined, [depth], [rigid]],
      (candidate) => candidate === proved,
    );
    expect(pending).toEqual([skinned, rigid, depth]);
  });

  it('is empty when every set is missing or every program is already proved', () => {
    expect(pendingProgramVariants([undefined, undefined], () => false)).toEqual([]);
    const one = { name: 'one' };
    expect(pendingProgramVariants([[one]], () => true)).toEqual([]);
  });
});

describe('pollProgramVariants', () => {
  it('asks each pending program exactly once and splits them by answer, order kept', () => {
    const a = program('a', [true]);
    const b = program('b', [false]);
    const c = program('c', [true]);
    const pass = pollProgramVariants([a, b, c]);
    expect(pass.ready.map((p) => p.name)).toEqual(['a', 'c']);
    expect(pass.pending.map((p) => p.name)).toEqual(['b']);
    for (const p of [a, b, c]) expect(p.isReady).toHaveBeenCalledTimes(1);
  });

  it('keeps asking a program on later passes until it answers ready', () => {
    const slow = program('slow', [false, false, true]);
    let pending = [slow];
    const passes: number[] = [];
    while (pending.length > 0) {
      const pass = pollProgramVariants(pending);
      passes.push(pass.ready.length);
      pending = pass.pending;
    }
    expect(passes).toEqual([0, 0, 1]);
    expect(slow.isReady).toHaveBeenCalledTimes(3);
  });

  it('answers empty for an empty list without asking anything', () => {
    expect(pollProgramVariants([])).toEqual({ ready: [], pending: [] });
  });
});

describe('nextProgramVariantPollMs', () => {
  it('resets to the floor after a cheap pass and doubles up to the cap after an expensive one', () => {
    const floor = PROGRAM_VARIANT_POLL_INTERVAL_MS;
    expect(nextProgramVariantPollMs(0, floor)).toBe(floor);
    expect(nextProgramVariantPollMs(PROGRAM_VARIANT_POLL_PASS_BUDGET_MS - 0.5, 160)).toBe(floor);
    expect(nextProgramVariantPollMs(PROGRAM_VARIANT_POLL_PASS_BUDGET_MS, floor)).toBe(floor * 2);
    expect(nextProgramVariantPollMs(30, 160)).toBe(PROGRAM_VARIANT_POLL_INTERVAL_MAX_MS);
    expect(nextProgramVariantPollMs(30, PROGRAM_VARIANT_POLL_INTERVAL_MAX_MS)).toBe(
      PROGRAM_VARIANT_POLL_INTERVAL_MAX_MS,
    );
  });

  it("mirrors three's own compileAsync poll constants (runtime bundle source pin)", () => {
    // The cadence is three's, not a hold tuned here: a bump that changes the
    // patched compileAsync poll reds this pin instead of drifting silently.
    const bundle = readFileSync(
      new URL('../node_modules/three/build/three.module.js', import.meta.url),
      'utf8',
    );
    const at = bundle.indexOf('this.compileAsync = function');
    expect(at).toBeGreaterThan(-1);
    const compileAsync = bundle.slice(at, bundle.indexOf('function checkMaterialsReady', at));
    expect(compileAsync).toContain(
      `const POLL_PASS_BUDGET_MS = ${PROGRAM_VARIANT_POLL_PASS_BUDGET_MS};`,
    );
    expect(compileAsync).toContain(
      `const POLL_INTERVAL_MIN_MS = ${PROGRAM_VARIANT_POLL_INTERVAL_MS};`,
    );
    expect(compileAsync).toContain(
      `const POLL_INTERVAL_MAX_MS = ${PROGRAM_VARIANT_POLL_INTERVAL_MAX_MS};`,
    );
  });
});
