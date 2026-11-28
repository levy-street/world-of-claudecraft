// Avalanche's eruption (Jose's playtest of 2026-11-20: the old cones read as
// "not very AAA"): the pure plan (src/render/smith_heart_fx/
// final_avalanche_core.ts) and the shapes (final_avalanche_fx.ts). The
// painter's run over a fake world (the spikes outliving their lane object,
// then gone) is in tests/smith_heart_final_elements_ui.test.ts.

import { describe, expect, it } from 'vitest';
import {
  avalancheLife,
  avalancheSpike,
  AVALANCHE_BEATS as B,
  debrisAt,
  AVALANCHE_POOLS as P,
  SCAR_FADE,
  scarLook,
  spikeEruption,
} from '../src/render/smith_heart_fx/final_avalanche_core';
import {
  iceSpikeGeometry,
  stoneSpikeGeometry,
} from '../src/render/smith_heart_fx/final_avalanche_fx';
import { ELEMENT_TUNING as E } from '../src/sim/encounters/smith_heart/final_elements_ids';

describe('the eruption', () => {
  it('bursts up past its height, holds, then sinks and crumbles away', () => {
    expect(spikeEruption(-0.01).shown).toBe(false);
    const early = spikeEruption(B.burst * 0.25).rise;
    expect(early).toBeGreaterThan(0.3);
    let peak = 0;
    for (let t = 0; t <= B.burst; t += 0.005) peak = Math.max(peak, spikeEruption(t).rise);
    expect(peak).toBeGreaterThan(1.05);
    expect(peak).toBeLessThan(1.3);
    const hold = spikeEruption((B.burst + B.hold) / 2);
    expect(hold.rise).toBeCloseTo(1, 1);
    expect(hold.sink).toBe(0);
    const late = spikeEruption(B.hold + B.crumble * 0.9);
    expect(late.crumble).toBeGreaterThan(0.85);
    expect(late.sink).toBeGreaterThan(0.4);
    expect(late.topple).toBeGreaterThan(0.2);
    expect(late.swell).toBeLessThan(0.7);
    expect(spikeEruption(B.hold + B.crumble + 0.01).shown).toBe(false);
  });

  it('every spike its own, in its lane, ice and stone mixed, the same on every client', () => {
    const half = 2.5;
    const spikes = Array.from({ length: P.spikesPerLane }, (_, k) =>
      avalancheSpike(77, k, E.avalancheLength, half),
    );
    expect(new Set(spikes.map((s) => s.height.toFixed(2))).size).toBeGreaterThan(8);
    for (const s of spikes) {
      expect(Math.abs(s.side)).toBeLessThanOrEqual(half);
      expect(s.along).toBeGreaterThan(0);
      expect(s.along).toBeLessThan(E.avalancheLength);
      expect(s.height).toBeGreaterThan(2);
    }
    // Along the lane in order (the front reaches them in turn).
    for (let k = 1; k < spikes.length; k++)
      expect(spikes[k].along).toBeGreaterThan(spikes[k - 1].along);
    const ice = spikes.filter((s) => s.ice).length;
    expect(ice).toBeGreaterThan(spikes.length / 3);
    expect(ice).toBeLessThan(spikes.length);
    expect(avalancheSpike(77, 3, 40, half)).toEqual(spikes[3]);
  });

  it('the chunks fly on an arc and are gone; the scar tears behind the front and fades', () => {
    const o = { x: 0, y: 0, z: 0, spin: 0, size: 0 };
    expect(debrisAt(1, 0, 0, 0.2, 4, o)).toBe(true);
    const up = o.y;
    expect(up).toBeGreaterThan(0.3);
    expect(debrisAt(1, 0, 0, 2, 4, o)).toBe(false);
    expect(debrisAt(1, 0, 1, -0.1, 4, o)).toBe(false);
    const run = E.avalancheRun;
    expect(scarLook(-0.1, run).alpha).toBe(0);
    expect(scarLook(run / 2, run).front).toBeCloseTo(0.5, 5);
    expect(scarLook(run, run).alpha).toBe(1);
    const end = run + B.hold + B.crumble;
    expect(scarLook(end + SCAR_FADE / 2, run).alpha).toBeCloseTo(0.5, 5);
    expect(scarLook(end + SCAR_FADE, run).alpha).toBe(0);
    expect(avalancheLife(run)).toBeCloseTo(end + SCAR_FADE, 9);
  });
});

describe('the shapes', () => {
  for (const [name, make] of [
    ['ice', iceSpikeGeometry],
    ['stone', stoneSpikeGeometry],
  ] as const)
    it(`${name}: a faceted spike standing on its foot, its faces turned outward`, () => {
      const g = make();
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      expect(pos.count % 3).toBe(0);
      expect(pos.count).toBeGreaterThan(60);
      let minY = Infinity;
      let maxY = -Infinity;
      let outward = 0;
      let sides = 0;
      for (let i = 0; i < pos.count; i++) {
        minY = Math.min(minY, pos.getY(i));
        maxY = Math.max(maxY, pos.getY(i));
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        if (r < 0.3 || pos.getY(i) > 0.6) continue;
        sides++;
        if (pos.getX(i) * nor.getX(i) + pos.getZ(i) * nor.getZ(i) > 0) outward++;
      }
      expect(minY).toBeLessThan(0.01);
      expect(maxY).toBeGreaterThan(0.85);
      expect(maxY).toBeLessThanOrEqual(1.01);
      // The lower faces of the main body point away from its axis.
      expect(outward / sides).toBeGreaterThan(0.75);
      g.dispose();
    });
});
