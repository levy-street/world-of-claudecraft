import { describe, expect, it } from 'vitest';
import {
  WYRMWATCH_HARBOR_CRITICAL_PARTS,
  WYRMWATCH_HARBOR_OPTIONAL_PARTS,
  WYRMWATCH_HARBOR_TRIM_PARTS,
  WYRMWATCH_PATH_MIN_UP,
  WYRMWATCH_PATH_STEP,
  WYRMWATCH_PATH_STONE_PROUD,
  WYRMWATCH_PATH_STONE_TOP,
  wyrmwatchHarborParts,
  wyrmwatchPathStones,
} from '../src/render/wyrmwatch_harbor_core';
import { HOUSE_SHELL_PARTS } from '../src/render/wyrmwatch_harbor_house_core';
import {
  WYRMWATCH_HARBOR_DECKS,
  WYRMWATCH_HARBOR_PATH,
  WYRMWATCH_HARBOR_PATH_HALF_WIDTH,
  WYRMWATCH_HARBOR_PROPS,
  type WyrmwatchHarborPropKind,
} from '../src/sim/content/wyrmwatch_harbor';
import {
  HARBOR_HOUSE_PROPS,
  type HarborHousePropKind,
} from '../src/sim/content/wyrmwatch_harbor_house';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// The Wyrmwatch cliff harbor's pure core (src/render/wyrmwatch_harbor_core.ts): which parts
// each graphics tier draws (everything a player walks on, bumps into or steers by on every
// tier; only collision-free dressing is shed), and the flagstones of the path, laid the
// same way every time, seated on the terrain, never under the harbor's planks.

describe('wyrmwatch harbor tiers (graphics fairness)', () => {
  it('keeps the structure, rails, gate, house, cargo and every lantern on every tier', () => {
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      const parts = wyrmwatchHarborParts(tier);
      for (const p of WYRMWATCH_HARBOR_CRITICAL_PARTS) expect(parts, tier).toContain(p);
    }
    expect(wyrmwatchHarborParts('low')).toEqual([...WYRMWATCH_HARBOR_CRITICAL_PARTS]);
    expect(wyrmwatchHarborParts('medium')).toEqual([
      ...WYRMWATCH_HARBOR_CRITICAL_PARTS,
      ...WYRMWATCH_HARBOR_TRIM_PARTS,
    ]);
    for (const tier of ['high', 'ultra', 'insane'] as const) {
      expect(wyrmwatchHarborParts(tier)).toEqual([
        ...WYRMWATCH_HARBOR_CRITICAL_PARTS,
        ...WYRMWATCH_HARBOR_TRIM_PARTS,
        ...WYRMWATCH_HARBOR_OPTIONAL_PARTS,
      ]);
    }
  });

  it('draws every solid the sim collides with in a part the low tier keeps', () => {
    // the model part that draws each colliding prop kind, and the rails
    const drawnBy: Record<WyrmwatchHarborPropKind, string> = {
      gatePost: 'HarborGate',
      lanternPost: 'Lanterns',
      bollard: 'Cargo',
      crateStack: 'Cargo',
      barrel: 'Cargo',
      // (none stands at Wyrmwatch: Wickharbor's quay crane and cargo shelter)
      timberPost: 'Cargo',
    };
    // the house: its walls, the furniture and cargo inside, and the chimney stack on the
    // land wall (build_harbor_house.py)
    const houseDrawnBy: Record<HarborHousePropKind, string> = {
      hearth: 'HouseFurnishings',
      chimney: 'HouseWallWest',
      chartTable: 'HouseFurnishings',
      armchair: 'HouseFurnishings',
      settle: 'HouseFurnishings',
      sideTable: 'HouseFurnishings',
      crateStack: 'HouseFurnishings',
      barrel: 'HouseFurnishings',
    };
    const low = wyrmwatchHarborParts('low');
    for (const p of WYRMWATCH_HARBOR_PROPS) expect(low, p.kind).toContain(drawnBy[p.kind]);
    for (const p of HARBOR_HOUSE_PROPS) expect(low, p.kind).toContain(houseDrawnBy[p.kind]);
    for (const wall of HOUSE_SHELL_PARTS) expect(low, wall).toContain(wall);
    expect(low).toContain('HouseFrame');
    expect(low).toContain('Railings');
    for (const shed of [...WYRMWATCH_HARBOR_TRIM_PARTS, ...WYRMWATCH_HARBOR_OPTIONAL_PARTS]) {
      expect(Object.values(drawnBy)).not.toContain(shed);
      expect(Object.values(houseDrawnBy)).not.toContain(shed);
    }
  });
});

describe('wyrmwatch harbor path stones', () => {
  const ground = (x: number, z: number): number => terrainHeight(x, z, WORLD_SEED);
  const stones = wyrmwatchPathStones(
    WYRMWATCH_HARBOR_PATH,
    WYRMWATCH_HARBOR_PATH_HALF_WIDTH,
    ground,
  );

  it('lays the same stones every time, three abreast the whole way', () => {
    expect(
      wyrmwatchPathStones(WYRMWATCH_HARBOR_PATH, WYRMWATCH_HARBOR_PATH_HALF_WIDTH, ground),
    ).toEqual(stones);
    let length = 0;
    for (let i = 0; i + 1 < WYRMWATCH_HARBOR_PATH.length; i++) {
      const [x0, z0] = WYRMWATCH_HARBOR_PATH[i];
      const [x1, z1] = WYRMWATCH_HARBOR_PATH[i + 1];
      length += Math.hypot(x1 - x0, z1 - z0);
    }
    const rows = length / WYRMWATCH_PATH_STEP;
    // a worn path: a few side stones are left out, never so many it stops reading
    expect(stones.length).toBeGreaterThan(rows * 2.5);
    expect(stones.length).toBeLessThanOrEqual(Math.ceil(rows + WYRMWATCH_HARBOR_PATH.length) * 3);
    expect(new Set(stones.map((s) => s.variant))).toEqual(new Set([0, 1, 2]));
  });

  it('keeps every stone on the path, seated just proud of the ground, flush to its slope', () => {
    for (const s of stones) {
      // within the path's half width of its centre line
      let best = Number.POSITIVE_INFINITY;
      for (let i = 0; i + 1 < WYRMWATCH_HARBOR_PATH.length; i++) {
        const [x0, z0] = WYRMWATCH_HARBOR_PATH[i];
        const [x1, z1] = WYRMWATCH_HARBOR_PATH[i + 1];
        const dx = x1 - x0;
        const dz = z1 - z0;
        const t = Math.max(
          0,
          Math.min(1, ((s.x - x0) * dx + (s.z - z0) * dz) / (dx * dx + dz * dz)),
        );
        best = Math.min(best, Math.hypot(s.x - (x0 + dx * t), s.z - (z0 + dz * t)));
      }
      expect(best).toBeLessThan(WYRMWATCH_HARBOR_PATH_HALF_WIDTH);
      expect(s.y + WYRMWATCH_PATH_STONE_TOP - ground(s.x, s.z)).toBeCloseTo(
        WYRMWATCH_PATH_STONE_PROUD,
        9,
      );
      expect(Math.hypot(s.nx, s.ny, s.nz)).toBeCloseTo(1, 9);
      expect(s.ny).toBeGreaterThanOrEqual(WYRMWATCH_PATH_MIN_UP);
      expect(s.scale).toBeGreaterThan(0.9);
      expect(s.scale).toBeLessThan(1.15);
    }
  });

  it('starts off the top landing: no stone lies under the harbor planks', () => {
    for (const s of stones) {
      for (const d of WYRMWATCH_HARBOR_DECKS) {
        const dx = s.x - d.x;
        const dz = s.z - d.z;
        const along = dx * Math.sin(d.rot) + dz * Math.cos(d.rot);
        const across = dx * Math.cos(d.rot) - dz * Math.sin(d.rot);
        expect(Math.abs(along) > d.hl || Math.abs(across) > d.hw, d.id).toBe(true);
      }
    }
  });
});
