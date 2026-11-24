// The Cinderscar's molten fissures (quartered_fissure_lava_core.ts).
// Node-only (RENDER_PURE_CORES): no Three, no DOM.
import { describe, expect, it } from 'vitest';
import {
  BURNWAY_MELT_GAIN,
  cinderscarMeltDepth,
  type FissureLavaTile,
  fissureLavaTriangles,
  LAVA_FIRE_HI,
  LAVA_FIRE_LO,
  LAVA_GRID_STEP,
  LAVA_LIFT,
  LAVA_MIN_DEPTH,
  LAVA_RIM_DROP,
  LAVA_SKIRT,
  LAVA_TILE_SIZE,
  lavaFireShare,
  planFissureLava,
} from '../src/render/quartered_fissure_lava_core';
import {
  CINDERSCAR_BURNWAYS,
  quarteredBurnwayDepth,
  quarteredFissureDepth,
} from '../src/sim/quartered_landmarks';
import { quarterWeightsAt } from '../src/sim/quartered_quarters';
import { ISLE_SHATTER } from '../src/sim/quartered_shatter';
import { terrainHeight } from '../src/sim/world';

const finished = (x: number, z: number): number => terrainHeight(x, z, 0);

// A synthetic crack for the shape rules: a straight V-trench along z at x = 0,
// 4yd deep at its floor, full fire everywhere.
const trenchDepth = (x: number) => Math.max(0, 4 - Math.abs(x) * 1.2);
const trench = {
  groundAt: (x: number) => 10 - trenchDepth(x),
  depthAt: (x: number) => trenchDepth(x),
  fireAt: () => 1,
  bounds: { minX: -20, maxX: 20, minZ: 0, maxZ: 40 },
};

function vertices(tiles: readonly FissureLavaTile[]): { x: number; y: number; z: number }[] {
  const out: { x: number; y: number; z: number }[] = [];
  for (const t of tiles) {
    for (let v = 0; v < t.positions.length; v += 3) {
      out.push({ x: t.positions[v], y: t.positions[v + 1], z: t.positions[v + 2] });
    }
  }
  return out;
}

describe('the Cinderscar fissure lava sheet', () => {
  it('fills a crack level, a lift over its floor, and dives its rim under the rock', () => {
    const tiles = planFissureLava(trench);
    expect(tiles.length).toBe(1);
    let wet = 0;
    for (const v of vertices(tiles)) {
      expect(Number.isInteger((v.x - trench.bounds.minX) / LAVA_GRID_STEP)).toBe(true);
      if (trenchDepth(v.x) >= LAVA_MIN_DEPTH) {
        // a wet node: the window floor (the trench bottom, 6) plus the lift
        expect(v.y).toBeCloseTo(6 + LAVA_LIFT, 5);
        wet++;
      } else {
        // a dry rim node: under the melt beside it AND under its own ground,
        // so the edge is buried and never climbs the wall
        expect(v.y).toBeCloseTo(
          Math.min(trench.groundAt(v.x) - LAVA_SKIRT, 6 + LAVA_LIFT - LAVA_RIM_DROP),
          5,
        );
        expect(v.y).toBeLessThan(6 + LAVA_LIFT);
      }
      // a band of cells along the crack, nothing beyond its rim nodes
      expect(Math.abs(v.x)).toBeLessThanOrEqual(2 * LAVA_GRID_STEP);
    }
    expect(wet).toBeGreaterThan(0);
  });

  it('never stands up as a wall where the crack meets a heaved plate', () => {
    // the crack's east side is a plate heaved 9yd: its rim nodes must still
    // dive under the melt, not climb to the plate's top
    const heaved = {
      ...trench,
      groundAt: (x: number) => 10 - trenchDepth(x) + (x > 3 ? 9 : 0),
    };
    const melt = 6 + LAVA_LIFT;
    for (const v of vertices(planFissureLava(heaved))) {
      expect(v.y, `node at x ${v.x}`).toBeLessThanOrEqual(melt + 1e-5);
    }
  });

  it('winds every triangle up (counter-clockwise from above)', () => {
    for (const t of planFissureLava(trench)) {
      for (let k = 0; k < t.indices.length; k += 3) {
        const a = t.indices[k];
        const b = t.indices[k + 1];
        const c = t.indices[k + 2];
        const ux = t.positions[b * 3] - t.positions[a * 3];
        const uz = t.positions[b * 3 + 2] - t.positions[a * 3 + 2];
        const wx = t.positions[c * 3] - t.positions[a * 3];
        const wz = t.positions[c * 3 + 2] - t.positions[a * 3 + 2];
        // the y of (b - a) x (c - a)
        expect(uz * wx - ux * wz).toBeGreaterThan(0);
      }
    }
  });

  it('fades with the fire weight: none where fire is gone, sunk lower at the fade', () => {
    expect(lavaFireShare(LAVA_FIRE_LO)).toBe(0);
    expect(lavaFireShare(LAVA_FIRE_HI)).toBe(1);
    expect(planFissureLava({ ...trench, fireAt: () => LAVA_FIRE_LO - 0.01 })).toEqual([]);
    const mid = (LAVA_FIRE_LO + LAVA_FIRE_HI) / 2;
    let checked = 0;
    for (const v of vertices(planFissureLava({ ...trench, fireAt: () => mid }))) {
      if (trenchDepth(v.x) < LAVA_MIN_DEPTH) continue;
      expect(v.y).toBeLessThan(6 + LAVA_LIFT - 0.1);
      expect(v.y).toBeGreaterThan(6 - 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('shows only in the fire quarter and only over deep fissures and burnway beds, on the real isle', () => {
    const tiles = planFissureLava({ groundAt: finished });
    expect(tiles.length).toBeGreaterThan(0);
    let shown = 0;
    for (const v of vertices(tiles)) {
      const g = finished(v.x, v.z);
      if (v.y <= g) continue;
      shown++;
      // every node standing proud of the ground is a wet node in the fire quarter
      expect(quarterWeightsAt(v.x, v.z).fire).toBeGreaterThan(LAVA_FIRE_LO);
      expect(cinderscarMeltDepth(v.x, v.z)).toBeGreaterThanOrEqual(LAVA_MIN_DEPTH);
      // and never more than the lift over the ground under it
      expect(v.y - g).toBeLessThanOrEqual(LAVA_LIFT + 1e-4);
      // the Cinderscar is the +x side
      expect(v.x).toBeGreaterThan(0);
    }
    // the cracks really do read as molten rivers: hundreds of nodes show
    expect(shown).toBeGreaterThan(200);
  });

  it('stays inside its triangle budget, in a handful of tiles', () => {
    const tiles = planFissureLava({ groundAt: finished });
    // a few thousand triangles in a few draws, never a mesh per cell
    expect(fissureLavaTriangles(tiles)).toBeLessThan(8000);
    expect(tiles.length).toBeLessThanOrEqual(8);
    for (const t of tiles) {
      expect(t.indices.length % 3).toBe(0);
      const n = t.positions.length / 3;
      for (const i of t.indices) expect(i).toBeLessThan(n);
      // every vertex sits on its tile's square or its far edge
      for (const v of vertices([t])) {
        const ti = (v.x - ISLE_SHATTER.minX) / LAVA_TILE_SIZE;
        const tj = (v.z - ISLE_SHATTER.minZ) / LAVA_TILE_SIZE;
        expect(ti).toBeGreaterThanOrEqual(t.ti);
        expect(ti).toBeLessThanOrEqual(t.ti + 1 + 1e-9);
        expect(tj).toBeGreaterThanOrEqual(t.tj);
        expect(tj).toBeLessThanOrEqual(t.tj + 1 + 1e-9);
      }
    }
  });

  it('is deterministic', () => {
    expect(planFissureLava({ groundAt: finished })).toEqual(
      planFissureLava({ groundAt: finished }),
    );
  });
});

describe('the Cinderscar burnways run with the same melt', () => {
  it('reads every burnway bed as deep enough for the melt, and leaves its banks dry', () => {
    for (const line of CINDERSCAR_BURNWAYS) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = line[i];
        const b = line[i + 1];
        const mx = (a.x + b.x) / 2;
        const mz = (a.z + b.z) / 2;
        expect(quarteredBurnwayDepth(mx, mz)).toBeGreaterThan(1);
        expect(cinderscarMeltDepth(mx, mz)).toBeGreaterThanOrEqual(LAVA_MIN_DEPTH);
        // ten yards off the line is the dry bank
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        expect(quarteredBurnwayDepth(mx + nx * 10, mz + nz * 10)).toBe(0);
      }
    }
    expect(BURNWAY_MELT_GAIN * 1.4).toBeGreaterThan(LAVA_MIN_DEPTH);
  });

  it('lays melt over the middle of every burnway stretch on the real terrain', () => {
    const tiles = planFissureLava({ groundAt: (x, z) => terrainHeight(x, z, 0) });
    for (const line of CINDERSCAR_BURNWAYS) {
      for (let i = 0; i + 1 < line.length; i++) {
        const mx = (line[i].x + line[i + 1].x) / 2;
        const mz = (line[i].z + line[i + 1].z) / 2;
        let near = Infinity;
        for (const t of tiles) {
          for (let v = 0; v < t.positions.length; v += 3) {
            near = Math.min(near, Math.hypot(t.positions[v] - mx, t.positions[v + 2] - mz));
          }
        }
        expect(near, `burnway stretch at ${mx},${mz}`).toBeLessThan(2.5);
      }
    }
  });
});
