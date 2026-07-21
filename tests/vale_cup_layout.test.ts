// Sowfield layout sanity: ONE module (src/sim/vale_cup_layout.ts) drives the
// terrain flatten, the movement colliders, the ball's analytic wall set, and
// the render dressing, so this suite pins the geometry they all share.

import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/sim/data';
import {
  BRAM_POS,
  GATE,
  GOAL_LINE_EAST_X,
  GOAL_LINE_WEST_X,
  GOAL_Z_MAX,
  GOAL_Z_MIN,
  isOnPitch,
  PITCH,
  PITCH_CENTER,
  PITCH_WALLS,
  SOWFIELD_EXCLUDE,
  SOWFIELD_FLAT,
  SPECTATOR_LINE_Z,
  VC_SPAWNS_A,
  VC_SPAWNS_B,
  valeCupColliders,
} from '../src/sim/vale_cup_layout';
import {
  generateDecorations,
  groundHeight,
  terrainHeight,
  terrainSteepness,
  WATER_LEVEL,
} from '../src/sim/world';

const SEED = 42; // the test-suite seed; no absolute height is content-pinned

describe('Sowfield walls', () => {
  it('boards enclose the whole pitch perimeter except the two goal mouths', () => {
    // Collect covered spans per edge.
    const north = PITCH_WALLS.filter((w) => w.nz === -1);
    const south = PITCH_WALLS.filter((w) => w.nz === 1);
    const west = PITCH_WALLS.filter((w) => w.nx === 1);
    const east = PITCH_WALLS.filter((w) => w.nx === -1);
    expect(north).toHaveLength(1);
    expect(south).toHaveLength(1);
    expect(west).toHaveLength(2);
    expect(east).toHaveLength(2);
    // North/south run the full length at the pitch edges.
    for (const w of [...north, ...south]) {
      expect(Math.min(w.x1, w.x2)).toBe(PITCH.xMin);
      expect(Math.max(w.x1, w.x2)).toBe(PITCH.xMax);
    }
    // West/east flank exactly the goal mouth: spans meet the posts and the corners.
    for (const [segs, x] of [
      [west, PITCH.xMin],
      [east, PITCH.xMax],
    ] as const) {
      const zs = segs.flatMap((w) => [w.z1, w.z2]).sort((a, b) => a - b);
      expect(segs.every((w) => w.x1 === x && w.x2 === x)).toBe(true);
      expect(zs).toEqual([PITCH.zMin, GOAL_Z_MIN, GOAL_Z_MAX, PITCH.zMax]);
    }
  });

  it('every wall normal points INTO the pitch', () => {
    for (const w of PITCH_WALLS) {
      const mx = (w.x1 + w.x2) / 2;
      const mz = (w.z1 + w.z2) / 2;
      expect(isOnPitch(mx + w.nx * 0.5, mz + w.nz * 0.5)).toBe(true);
    }
  });

  it('goal lines are the pitch edges and the mouths sit centered on the pitch', () => {
    expect(GOAL_LINE_WEST_X).toBe(PITCH.xMin);
    expect(GOAL_LINE_EAST_X).toBe(PITCH.xMax);
    expect((GOAL_Z_MIN + GOAL_Z_MAX) / 2).toBeCloseTo(PITCH_CENTER.z, 6);
  });
});

describe('Sowfield colliders (derived from the same consts)', () => {
  const colliders = valeCupColliders();

  it('boards, posts, pockets, stands, and the plinth all exist', () => {
    const obbs = colliders.filter((c) => c.type === 'obb');
    const circles = colliders.filter((c) => c.type === 'circle');
    // 2 north (gate gap) + 1 south + 4 flanks + 2 pocket backs + 4 pocket rails
    // + 2 stand fronts = 15 OBBs; 4 posts + 1 plinth = 5 circles.
    expect(obbs.length).toBe(15);
    expect(circles.length).toBe(5);
  });

  it('goal post circles stand exactly at the mouth corners', () => {
    const posts = colliders.filter((c) => c.type === 'circle' && c.r < 0.5);
    const spots = posts.map((p) => `${p.x},${p.z}`).sort();
    expect(spots).toEqual(
      [
        `${PITCH.xMin},${GOAL_Z_MIN}`,
        `${PITCH.xMin},${GOAL_Z_MAX}`,
        `${PITCH.xMax},${GOAL_Z_MIN}`,
        `${PITCH.xMax},${GOAL_Z_MAX}`,
      ].sort(),
    );
  });

  it('the north board leaves exactly the gate gap', () => {
    const northBoards = colliders.filter(
      (c) => c.type === 'obb' && c.z === PITCH.zMax && Math.abs(c.x - GATE.x) > GATE.halfW,
    );
    expect(northBoards.length).toBe(2);
    for (const b of northBoards) {
      if (b.type !== 'obb') continue;
      // Each half ends at the gate edge, none crosses into the gap.
      const nearEdge = b.x < GATE.x ? b.x + b.hw : b.x - b.hw;
      expect(Math.abs(Math.abs(nearEdge - GATE.x) - GATE.halfW)).toBeLessThan(1e-6);
    }
  });

  it('no board is a fence (boards must not be jump-through mid-match)', () => {
    for (const c of colliders) {
      expect(c.type === 'obb' ? (c.isFence ?? false) : false).toBe(false);
    }
  });
});

describe('Sowfield spawns and site placement', () => {
  it('team spawns sit inside their own halves of the pitch, facing the enemy goal', () => {
    for (const s of VC_SPAWNS_A) {
      expect(isOnPitch(s.x, s.z)).toBe(true);
      expect(s.x).toBeLessThan(PITCH_CENTER.x);
      expect(Math.sin(s.facing)).toBeGreaterThan(0); // A defends west, faces east
    }
    for (const s of VC_SPAWNS_B) {
      expect(isOnPitch(s.x, s.z)).toBe(true);
      expect(s.x).toBeGreaterThan(PITCH_CENTER.x);
      expect(Math.sin(s.facing)).toBeLessThan(0); // B defends east, faces west
    }
  });

  it('the flatten rect contains the pitch with apron room and the exclude rect contains both', () => {
    expect(SOWFIELD_FLAT.xMin).toBeLessThan(PITCH.xMin);
    expect(SOWFIELD_FLAT.xMax).toBeGreaterThan(PITCH.xMax);
    expect(SOWFIELD_FLAT.zMin).toBeLessThan(PITCH.zMin);
    expect(SOWFIELD_FLAT.zMax).toBeGreaterThan(PITCH.zMax);
    expect(SOWFIELD_EXCLUDE.xMin).toBeLessThanOrEqual(SOWFIELD_FLAT.xMin - SOWFIELD_FLAT.falloff);
    expect(SOWFIELD_EXCLUDE.xMax).toBeGreaterThanOrEqual(
      SOWFIELD_FLAT.xMax + SOWFIELD_FLAT.falloff,
    );
    expect(SOWFIELD_EXCLUDE.zMin).toBeLessThanOrEqual(SOWFIELD_FLAT.zMin - SOWFIELD_FLAT.falloff);
    expect(SOWFIELD_EXCLUDE.zMax).toBeGreaterThanOrEqual(
      SOWFIELD_FLAT.zMax + SOWFIELD_FLAT.falloff,
    );
  });

  it('the whole site sits inside the Eastbrook Vale zone band (gather-nodes guard pattern)', () => {
    const zone1 = ZONES[0];
    expect(zone1.id).toBe('eastbrook_vale');
    for (const z of [SOWFIELD_EXCLUDE.zMin, SOWFIELD_EXCLUDE.zMax, BRAM_POS.z, SPECTATOR_LINE_Z]) {
      expect(z).toBeGreaterThanOrEqual(zone1.zMin);
      expect(z).toBeLessThanOrEqual(zone1.zMax);
    }
  });

  it('flatten influence ends north of the world-rim onset at z = -150', () => {
    expect(SOWFIELD_FLAT.zMin - SOWFIELD_FLAT.falloff).toBeGreaterThanOrEqual(-150);
  });
});

describe('Sowfield terrain (the flatten arm)', () => {
  it('levels the pitch flat, dry, and walkable', () => {
    for (let x = PITCH.xMin; x <= PITCH.xMax; x += 4) {
      for (let z = PITCH.zMin; z <= PITCH.zMax; z += 4) {
        const h = terrainHeight(x, z, SEED);
        expect(h).toBeCloseTo(SOWFIELD_FLAT.height, 3);
        expect(h).toBeGreaterThan(WATER_LEVEL + 0.75);
        expect(groundHeight(x, z, SEED)).toBe(h);
        expect(terrainSteepness(x, z, SEED)).toBeLessThan(0.05);
      }
    }
  });

  it('the walk-up aprons blend back to natural terrain with a walkable slope', () => {
    // The north (town approach), west, and east aprons must be walkable. The
    // SOUTH apron deliberately is not checked: it abuts the world-rim ramp
    // (z < -150 is impassable by design) and may bank steeper than the climb
    // limit; tests/terrain_walls.test.ts proves the rim itself stays intact.
    const probes = [
      { x: PITCH_CENTER.x, z: SOWFIELD_FLAT.zMax + SOWFIELD_FLAT.falloff / 2 },
      { x: SOWFIELD_FLAT.xMin - SOWFIELD_FLAT.falloff / 2, z: PITCH_CENTER.z },
      { x: SOWFIELD_FLAT.xMax + SOWFIELD_FLAT.falloff / 2, z: PITCH_CENTER.z },
    ];
    for (const p of probes) {
      expect(terrainSteepness(p.x, p.z, SEED)).toBeLessThanOrEqual(1.5);
    }
    // Bram and the gate approach stand on walkable ground.
    expect(terrainSteepness(BRAM_POS.x, BRAM_POS.z, SEED)).toBeLessThanOrEqual(1.5);
    expect(terrainSteepness(GATE.x, GATE.z, SEED)).toBeLessThanOrEqual(1.5);
  });

  it('grows no procedural decorations inside the stadium footprint', () => {
    for (const d of generateDecorations(SEED)) {
      const inside =
        d.x >= SOWFIELD_EXCLUDE.xMin &&
        d.x <= SOWFIELD_EXCLUDE.xMax &&
        d.z >= SOWFIELD_EXCLUDE.zMin &&
        d.z <= SOWFIELD_EXCLUDE.zMax;
      expect(inside).toBe(false);
    }
  });
});

describe('the Sowfield poi index is pinned', () => {
  it('zone 1 poi index 10 is The Sowfield (localizeZone + locale fills key off it)', async () => {
    const { ZONES } = await import('../src/sim/data');
    const zone1 = ZONES.find((z) => z.id === 'eastbrook_vale');
    expect(zone1?.pois[10]?.label).toBe('The Sowfield');
  });
});
