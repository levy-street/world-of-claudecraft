// The Guardian of the Heat's filling marks against the sim's clock (Jose's
// playtest of 2026-11-25: a circle went off before its fill read as done, so
// nobody could tell when it struck). Each mark is full at the very instant the
// sim strikes, its last half second blazes, both shaders read that blaze, and
// the melee's shore terrace never hides a mark laid on it. Plus the round lip
// wall's map boxes.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HEAT_TELEGRAPH_FINAL_SECONDS,
  heatTelegraphFill,
  heatTelegraphFinal,
} from '../src/render/smith_heart_fx/heat_telegraph_core';
import { HEAT_TELEGRAPH_FRAG } from '../src/render/smith_heart_fx/heat_telegraph_glsl';
import { HEARTH_LIP_RING } from '../src/sim/content/smith_heart_layout';
import { HEAT_TUNING as T } from '../src/sim/encounters/smith_heart/heat_ids';
import { RING_WALL_SEGMENTS, ringWallBoxes } from '../src/sim/instances/authored_field';
import { DT } from '../src/sim/types';

describe('Guardian of the Heat: a filling mark is full the instant it strikes', () => {
  it('fills linearly to exactly 1 at its seconds, never earlier', () => {
    for (const seconds of [T.cinderFallWarn, T.fistCast, T.seedLife]) {
      expect(heatTelegraphFill(0, seconds)).toBe(0);
      expect(heatTelegraphFill(seconds / 2, seconds)).toBeCloseTo(0.5, 9);
      // One sim tick before it strikes it is not yet full.
      expect(heatTelegraphFill(seconds - DT, seconds)).toBeLessThan(1);
      expect(heatTelegraphFill(seconds, seconds)).toBe(1);
      expect(heatTelegraphFill(seconds + 1, seconds)).toBe(1);
    }
  });

  it('blazes only over its last half second, peaking at the strike', () => {
    expect(HEAT_TELEGRAPH_FINAL_SECONDS).toBe(0.5);
    expect(heatTelegraphFinal(3)).toBe(0);
    expect(heatTelegraphFinal(HEAT_TELEGRAPH_FINAL_SECONDS)).toBe(0);
    expect(heatTelegraphFinal(Number.POSITIVE_INFINITY)).toBe(0);
    expect(heatTelegraphFinal(0)).toBe(1);
    expect(heatTelegraphFinal(-0.1)).toBe(1);
    let last = 0;
    for (let left = 0.49; left >= 0; left -= 0.05) {
      const k = heatTelegraphFinal(left);
      expect(k).toBeGreaterThan(last);
      last = k;
    }
  });

  it('both telegraph shaders read the blaze; the seeds sweep their whole reach', () => {
    expect(HEAT_TELEGRAPH_FRAG).toContain('uniform float uFinal;');
    expect(HEAT_TELEGRAPH_FRAG).toMatch(/uFinal \* \(rimCore/);
    const seed = readFileSync('src/render/smith_heart_fx/heat_seed_field.ts', 'utf8');
    expect(seed).toContain('uniform float uFinal;');
    expect(seed).toContain('rf = min(rf, d - s.w * s.z);');
    expect(seed).not.toContain('0.5 * s.w * s.z');
  });

  it("the melee's shore terrace writes no depth, so a mark on it always draws over it", () => {
    const shore = readFileSync('src/render/smith_heart_fx/heat_well_shore.ts', 'utf8');
    expect(shore).toMatch(/depthWrite: false/);
  });

  it('every filling mark is painted with its last moment', () => {
    for (const f of ['heat_fx.ts', 'heat_cinder_fx.ts', 'heat_coal_fx.ts']) {
      const src = readFileSync(`src/render/smith_heart_fx/${f}`, 'utf8');
      expect(src, f).toContain('setTelegraphFinal(');
    }
    const fight = readFileSync('src/render/smith_heart_fx/heat_fight_fx.ts', 'utf8');
    expect(fight).toContain('heatTelegraphFinal(left)');
    // The painters scan the frame the roster changes (a mark's fill starts the
    // frame its object arrives).
    for (const f of ['heat_fx.ts', 'heat_fight_fx.ts']) {
      const src = readFileSync(`src/render/smith_heart_fx/${f}`, 'utf8');
      expect(src, f).toMatch(/scanTimer <= 0 \|\|\s*\(this\.\w+[^)]*&& world\.entityRosterVersion !== this\.rosterSeen\)/);
    }
  });
});

describe('Guardian of the Heat: the round lip wall on the map', () => {
  it('draws its band as overlapping boxes round the well', () => {
    const boxes = ringWallBoxes(HEARTH_LIP_RING);
    expect(boxes.length).toBe(RING_WALL_SEGMENTS);
    const mid = (HEARTH_LIP_RING.inner + HEARTH_LIP_RING.outer) / 2;
    for (const b of boxes) {
      expect(Math.hypot(b.x - HEARTH_LIP_RING.x, b.z - HEARTH_LIP_RING.z)).toBeCloseTo(mid, 9);
      expect(b.hd).toBeCloseTo((HEARTH_LIP_RING.outer - HEARTH_LIP_RING.inner) / 2, 9);
      expect(b.hw).toBeGreaterThan(HEARTH_LIP_RING.outer * Math.tan(Math.PI / RING_WALL_SEGMENTS));
    }
  });
});
