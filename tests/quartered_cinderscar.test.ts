// The Cinderscar (the Quartered Isle's fire quarter) is a burnt waste: pale
// blue-grey basalt on red ground, no trees, and nothing standing in or leaning over its melt.

import { describe, expect, it } from 'vitest';
import {
  CINDERSCAR_ROCK_SOFTEN,
  CINDERSCAR_ROCK_TINT,
  ROCK_TINT_SOFTEN,
  scatterRockTint,
} from '../src/render/scatter_rock_tint_core';
import { ISLE_KIT, QUARTERED_ISLE_SPIRES } from '../src/sim/content/quartered_spires';
import { isCuratedScatter } from '../src/sim/decoration_exclusions';
import {
  CINDERSCAR_BURNWAYS,
  CINDERSCAR_MELT_PAD,
  cinderscarMeltNear,
  inCinderscar,
  quarteredFissureDepth,
  quarteredLandmarkClears,
} from '../src/sim/quartered_landmarks';
import { QUARTER_CENTERS } from '../src/sim/quartered_quarters';
import { generateDecorationsInBounds, zoneBiomeAt } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const ISLE = { minX: -260, maxX: 260, minZ: 1960, maxZ: 2420 };
const decorations = generateDecorationsInBounds(WORLD_SEED, ISLE);
const fire = QUARTER_CENTERS.fire;

describe('the Cinderscar', () => {
  it('is the fire quarter of the isle and nowhere else', () => {
    expect(inCinderscar(fire.x, fire.z)).toBe(true);
    expect(inCinderscar(-fire.x, fire.z)).toBe(false); // the Heavestone Wilds
    expect(inCinderscar(fire.x + 400, fire.z)).toBe(false); // the Drakelands proper
  });

  it('grows no tree, of either kind, while its stone stays', () => {
    const cinder = decorations.filter((d) => inCinderscar(d.x, d.z));
    expect(cinder.some((d) => d.kind === 'rock')).toBe(true);
    expect(cinder.filter((d) => d.kind !== 'rock')).toEqual([]);
    expect(isCuratedScatter('tree2', fire.x, fire.z, zoneBiomeAt)).toBe(true);
    expect(isCuratedScatter('tree', fire.x, fire.z, zoneBiomeAt)).toBe(true);
    expect(isCuratedScatter('rock', fire.x, fire.z, zoneBiomeAt)).toBe(false);
    // the rest of the isle keeps its odd dead tree
    expect(isCuratedScatter('tree2', -fire.x, fire.z, zoneBiomeAt)).toBe(false);
  });

  it('keeps every piece of scatter off its melt, out to a rock width', () => {
    for (const d of decorations) {
      if (!inCinderscar(d.x, d.z)) continue;
      expect(cinderscarMeltNear(d.x, d.z, CINDERSCAR_MELT_PAD), `${d.kind}@${d.x},${d.z}`).toBe(
        false,
      );
    }
    // a burnway's bank and a fissure's lip both clear
    const b = CINDERSCAR_BURNWAYS[0][1];
    expect(quarteredLandmarkClears(b.x, b.z + 4.5)).toBe(true);
    let lip: { x: number; z: number } | null = null;
    for (let x = 60; x < 240 && !lip; x += 0.5) {
      for (let z = 2120; z < 2300 && !lip; z += 0.5) {
        if (!inCinderscar(x, z) || quarteredFissureDepth(x, z) > 0) continue;
        if (quarteredFissureDepth(x + 1.5, z) > 1) lip = { x, z };
      }
    }
    expect(lip).not.toBeNull();
    if (lip) expect(quarteredLandmarkClears(lip.x, lip.z)).toBe(true);
  });

  it('stands a few tall column masses and the lava vents, clear of the melt', () => {
    const stone = QUARTERED_ISLE_SPIRES.filter((s) => inCinderscar(s.x, s.z));
    const columns = stone.filter((s) => s.key === 'cinderColumnsTall');
    const rubble = stone.filter((s) => s.key === 'cinderColumnRubble');
    const vents = stone.filter((s) => s.key === 'cinderLavaVent');
    // few and big: tall masses of columns, not a field of fangs
    expect(columns.length).toBeGreaterThanOrEqual(5);
    expect(columns.length).toBeLessThanOrEqual(12);
    expect(rubble).toEqual([]);
    expect(vents.length).toBeGreaterThanOrEqual(4);
    expect(vents.length).toBeLessThanOrEqual(6);
    for (const s of stone) {
      expect(['cinderColumnsTall', 'cinderColumnRubble', 'cinderLavaVent']).toContain(s.key);
      // its body (four fifths of its collider) stands clear of the melt
      expect(cinderscarMeltNear(s.x, s.z, Math.max(1, (s.r ?? 1) * 0.8))).toBe(false);
    }
    // the centrepieces tower, with lesser clusters beside them, each a
    // collider matched to its size
    const heights = columns.map((c) => c.h ?? 0);
    expect(Math.max(...heights)).toBeGreaterThan(20);
    expect(heights.filter((h) => h > 15).length).toBeGreaterThanOrEqual(3);
    for (const c of columns) {
      const scale = c.scale ?? 1;
      expect(c.h).toBeCloseTo(ISLE_KIT.cinderColumnsTall.h * scale, 1);
      expect(c.r).toBeCloseTo(ISLE_KIT.cinderColumnsTall.w * scale * 0.4, 1);
    }
    // the vents stand on the burnways' dry banks: walk-through, near a burnway
    for (const v of vents) {
      expect(v.r).toBe(0);
      const near = Math.min(
        ...CINDERSCAR_BURNWAYS.flatMap((line) =>
          line.slice(1).map((b, i) => {
            const a = line[i];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const t = Math.max(
              0,
              Math.min(1, ((v.x - a.x) * dx + (v.z - a.z) * dz) / (dx * dx + dz * dz)),
            );
            return Math.hypot(v.x - (a.x + dx * t), v.z - (a.z + dz * t));
          }),
        ),
      );
      expect(near).toBeGreaterThanOrEqual(7.5);
      expect(near).toBeLessThanOrEqual(14.5);
    }
  });

  it('tints its scatter boulders pale blue-grey, and every other rock as before', () => {
    expect(scatterRockTint('quartered', fire.x, fire.z, false)).toEqual({
      hex: CINDERSCAR_ROCK_TINT,
      soften: CINDERSCAR_ROCK_SOFTEN,
    });
    expect(scatterRockTint('quartered', -fire.x, fire.z, false)).toEqual({
      hex: 0x948c84,
      soften: ROCK_TINT_SOFTEN,
    });
    expect(scatterRockTint('ember', fire.x + 400, fire.z, false).hex).toBe(0x9a7a62);
    expect(scatterRockTint('peaks', 0, 0, false).hex).toBe(0x82847c);
    expect(scatterRockTint('peaks', 0, 0, true).hex).toBe(0x949ca8);
    // pale blue-grey: blue leads, every channel well lit
    const [r, g, b] = [16, 8, 0].map((shift) => (CINDERSCAR_ROCK_TINT >> shift) & 0xff);
    expect(b).toBeGreaterThan(r + 16);
    expect(b).toBeGreaterThanOrEqual(g);
    expect(Math.min(r, g, b)).toBeGreaterThan(0x80);
    expect(CINDERSCAR_ROCK_SOFTEN).toBeLessThan(ROCK_TINT_SOFTEN);
  });
});
