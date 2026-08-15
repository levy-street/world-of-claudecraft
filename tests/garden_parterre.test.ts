// The Evergarden's formal planting plan (src/render/garden_parterre_core.ts):
// every authored plot must sit on flat dry lawn clear of the Great Maze, the
// hamlet, the walks, the camps, the gather nodes, and the great tree trunks.
// The beds are MODELED decor in a satellite pattern (six large square
// gardens, each orbited by 3-4 small round beds, mirrored across the decor
// entries, the world.ts level pads, and these plots); only the mill lawn's
// ring beds, the walk ribbons, and the clipped path hedges stay procedural,
// and the plan must keep reading as a designed garden.

import { describe, expect, it } from 'vitest';
import {
  BED_MODEL_WIDTH,
  clearOfGardenBuildings,
  GARDEN_BED_TINTS,
  gardenMeadowTintAt,
  inParterrePlot,
  PARTERRE_PLOTS,
  parterreBushSpots,
  parterreFlowerTintAt,
} from '../src/render/garden_parterre_core';
import { resolveMovement } from '../src/sim/colliders';
import { EVERGARDEN_CAMPS, EVERGARDEN_PROPS, EVERGARDEN_ZONE } from '../src/sim/content/evergarden';
import { GATHER_NODES } from '../src/sim/content/gather_nodes';
import {
  GARDEN_BED_PADS,
  gardenLandness,
  MAZE_CELL,
  MAZE_COLS,
  MAZE_WALL_DEPTH,
  MAZE_X0,
  MAZE_Z0,
  MAZE_Z1,
  roadDistance,
  terrainHeight,
  WATER_LEVEL,
} from '../src/sim/world';

// The production seed: the plots are placed against the live world geometry.
const SEED = 20061;

const slopeAt = (x: number, z: number): number => {
  const e = 1.2;
  const hx = terrainHeight(x + e, z, SEED) - terrainHeight(x - e, z, SEED);
  const hz = terrainHeight(x, z + e, SEED) - terrainHeight(x, z - e, SEED);
  return Math.hypot(hx, hz) / (2 * e);
};

describe('parterre plot sites', () => {
  it('every plot sits on flat dry lawn inside the zone', () => {
    for (const p of PARTERRE_PLOTS) {
      expect(p.x - p.r).toBeGreaterThan(EVERGARDEN_ZONE.xMin ?? 180);
      expect(p.x + p.r).toBeLessThan(EVERGARDEN_ZONE.xMax ?? 540);
      expect(p.z - p.r).toBeGreaterThan(EVERGARDEN_ZONE.zMin);
      expect(p.z + p.r).toBeLessThan(EVERGARDEN_ZONE.zMax);
      for (let a = 0; a < 8; a++) {
        for (const rr of [0, p.r * 0.6, p.r]) {
          const x = p.x + Math.sin((a * Math.PI) / 4) * rr;
          const z = p.z + Math.cos((a * Math.PI) / 4) * rr;
          const label = `plot (${p.x},${p.z}) at a${a} r${rr.toFixed(1)}`;
          expect(terrainHeight(x, z, SEED), `${label} height`).toBeGreaterThan(WATER_LEVEL + 1.6);
          expect(gardenLandness(x, z), `${label} landness`).toBeGreaterThan(0.25);
          expect(slopeAt(x, z), `${label} slope`).toBeLessThan(0.55);
          if (rr === 0) break;
        }
      }
    }
  });

  it('every plot clears the maze, hub, roads, camps, nodes, and great trees', () => {
    const mazeX1 = MAZE_X0 + MAZE_COLS * MAZE_CELL;
    const hub = EVERGARDEN_ZONE.hub;
    for (const p of PARTERRE_PLOTS) {
      const label = `plot (${p.x},${p.z})`;
      const inMaze =
        p.x + p.r > MAZE_X0 - 4 &&
        p.x - p.r < mazeX1 + 4 &&
        p.z + p.r > MAZE_Z0 - 4 &&
        p.z - p.r < MAZE_Z1 + 4;
      expect(inMaze, `${label} overlaps the maze`).toBe(false);
      expect(Math.hypot(p.x - hub.x, p.z - hub.z), `${label} hub`).toBeGreaterThan(
        hub.radius + p.r + 2,
      );
      expect(roadDistance(p.x, p.z), `${label} road`).toBeGreaterThan(p.r + 2);
      for (const camp of EVERGARDEN_CAMPS) {
        expect(
          Math.hypot(p.x - camp.center.x, p.z - camp.center.z),
          `${label} vs camp (${camp.center.x},${camp.center.z})`,
        ).toBeGreaterThan(p.r + camp.radius);
      }
      for (const node of GATHER_NODES) {
        if (node.zoneId !== 'evergarden') continue;
        expect(
          Math.hypot(p.x - node.pos.x, p.z - node.pos.z),
          `${label} vs node ${node.id}`,
        ).toBeGreaterThan(p.r + 2);
      }
      for (const tree of EVERGARDEN_PROPS.greatTrees ?? []) {
        expect(
          Math.hypot(p.x - tree.x, p.z - tree.z),
          `${label} vs great tree (${tree.x},${tree.z})`,
        ).toBeGreaterThan(p.r + tree.r);
      }
    }
  });
});

describe('the flower plan', () => {
  it('paints only the mill ring beds: the modeled beds keep their own ground', () => {
    for (const p of PARTERRE_PLOTS) {
      let painted = 0;
      let inside = 0;
      for (let dx = -p.r; dx <= p.r; dx += 1) {
        for (let dz = -p.r; dz <= p.r; dz += 1) {
          // sample the bed interior (inside the hedge line)
          if (Math.hypot(dx, dz) > p.r * 0.7) continue;
          inside++;
          if (parterreFlowerTintAt(p.x + dx, p.z + dz) >= 0) painted++;
        }
      }
      if (p.centerpiece === 'windmill') {
        // the mill lawn's procedural rings still fill edge to edge
        expect(painted / inside, `plot (${p.x},${p.z}) interior coverage`).toBeGreaterThan(0.9);
      } else {
        // a modeled bed stands here: no procedural ground flowers beneath it
        expect(painted, `plot (${p.x},${p.z}) stays unpainted`).toBe(0);
      }
    }
    // far from every plot and road: bare lawn (meadow drifts are separate)
    expect(parterreFlowerTintAt(210, 795)).toBe(-1);
    expect(parterreFlowerTintAt(300, 745)).toBe(-1);
  });

  it('mirrors every modeled bed across decor, pads, and plots in a satellite pattern', () => {
    const decor = (EVERGARDEN_PROPS.decorProps ?? []).filter((d) => d.key.startsWith('flowerBed'));
    const modeled = PARTERRE_PLOTS.filter((p) => p.kind !== 'ring');
    expect(decor.length).toBe(modeled.length);
    expect(GARDEN_BED_PADS.length).toBe(modeled.length);
    const keys = new Set<string>();
    for (const p of modeled) {
      const here = decor.filter((e) => Math.hypot(e.x - p.x, e.z - p.z) < 0.01);
      expect(here.length, `plot (${p.x},${p.z}) decor entry`).toBe(1);
      const e = here[0];
      keys.add(e.key);
      if (p.kind === 'square') {
        // the large beds are the detailed square gardens, axis-aligned
        expect(e.key === 'flowerBedSquareA' || e.key === 'flowerBedSquareB', 'square key').toBe(
          true,
        );
        expect(e.rot === 0 || e.rot === Math.PI / 2, `plot (${p.x},${p.z}) axis-aligned`).toBe(
          true,
        );
      } else {
        expect(e.key, `plot (${p.x},${p.z}) round key`).toBe('flowerBedRound');
      }
      // the model spans the plot, the collider fills it, the pad levels it
      expect(e.scale ?? 0, `plot (${p.x},${p.z}) scale`).toBeCloseTo(
        (p.r * 2) / BED_MODEL_WIDTH,
        1,
      );
      expect(e.r ?? 0, `plot (${p.x},${p.z}) collider`).toBeGreaterThan(p.r - 0.3);
      expect(e.r ?? 0, `plot (${p.x},${p.z}) collider`).toBeLessThanOrEqual(p.r);
      const pad = GARDEN_BED_PADS.filter(
        (g) => Math.hypot(g.x - p.x, g.z - p.z) < 0.01 && g.r === p.r,
      );
      expect(pad.length, `plot (${p.x},${p.z}) pad`).toBe(1);
    }
    // the pattern: every large square bed keeps 3 or 4 small round beds at
    // its outer edge, each satellite anchored to exactly one square (and
    // its pad anchored to that square's center)
    const squares = modeled.filter((p) => p.kind === 'square');
    const rounds = modeled.filter((p) => p.kind === 'round');
    let claimed = 0;
    for (const s of squares) {
      const sats = rounds.filter((q) => {
        const d = Math.hypot(q.x - s.x, q.z - s.z);
        return d > s.r && d < s.r + 8;
      });
      expect(sats.length, `square (${s.x},${s.z}) satellites`).toBeGreaterThanOrEqual(3);
      expect(sats.length, `square (${s.x},${s.z}) satellites`).toBeLessThanOrEqual(4);
      claimed += sats.length;
      for (const q of sats) {
        const pad = GARDEN_BED_PADS.find((g) => Math.hypot(g.x - q.x, g.z - q.z) < 0.01);
        expect(pad?.ax, `satellite (${q.x},${q.z}) anchor`).toBe(s.x);
        expect(pad?.az, `satellite (${q.x},${q.z}) anchor`).toBe(s.z);
      }
    }
    expect(claimed, 'every round bed orbits exactly one square').toBe(rounds.length);
    // both square designs and the round model all appear across the garden
    expect(keys.has('flowerBedSquareA')).toBe(true);
    expect(keys.has('flowerBedSquareB')).toBe(true);
    expect(keys.has('flowerBedRound')).toBe(true);
  });

  it('levels the ground under every modeled bed to its ensemble terrace', () => {
    for (const p of PARTERRE_PLOTS) {
      if (p.kind === 'ring') continue;
      const hc = terrainHeight(p.x, p.z, SEED);
      for (let a = 0; a < 8; a++) {
        const x = p.x + Math.sin((a * Math.PI) / 4) * p.r;
        const z = p.z + Math.cos((a * Math.PI) / 4) * p.r;
        expect(
          Math.abs(terrainHeight(x, z, SEED) - hc),
          `plot (${p.x},${p.z}) rim a${a}`,
        ).toBeLessThan(0.35);
      }
    }
  });

  it('blocks walking into a modeled bed', () => {
    const p = PARTERRE_PLOTS.find((q) => q.kind === 'square');
    expect(p).toBeDefined();
    if (!p) return;
    const end = resolveMovement(SEED, p.x - p.r - 4, p.z, p.x, p.z, 0.5);
    expect(
      Math.hypot(end.x - p.x, end.z - p.z),
      'the bed collider stops the walk at its edge',
    ).toBeGreaterThan(p.r - 1);
  });

  it('edges the maze hedges with white and gold blooms', () => {
    // a corridor point just off a hedge face blooms white or gold; the
    // corridor center and the hedge interior stay bare. Face positions
    // derive from the wall grid: the (8,15) piece's west face edges the
    // entrance corridor.
    const faceX = MAZE_X0 + 8 * MAZE_CELL + (MAZE_CELL - MAZE_WALL_DEPTH) / 2;
    const midZ = MAZE_Z1 - 15.5 * MAZE_CELL;
    let blooms = 0;
    for (let dz = -3; dz <= 3; dz += 0.5) {
      const tint = parterreFlowerTintAt(faceX - 0.8, midZ + dz);
      if (tint >= 0) {
        blooms++;
        expect([0xffffff, 0xf2c94c]).toContain(tint);
      }
    }
    expect(blooms, 'the border band blooms along the face').toBeGreaterThan(9);
    // the outer perimeter blooms too (south of the south wall's outer face)
    const southOuterZ = MAZE_Z1 - 16.5 * MAZE_CELL - MAZE_WALL_DEPTH / 2 - 0.8;
    let outer = 0;
    for (let x = MAZE_X0 + 10; x < MAZE_X0 + 55; x += 0.7) {
      const tint = parterreFlowerTintAt(x, southOuterZ);
      if (tint >= 0) {
        outer++;
        expect([0xffffff, 0xf2c94c]).toContain(tint);
      }
    }
    expect(outer, 'the outer edge blooms').toBeGreaterThan(30);
    // bare where it should be bare
    expect(parterreFlowerTintAt(MAZE_X0 + 7.5 * MAZE_CELL, midZ), 'corridor center').toBe(-1);
    expect(parterreFlowerTintAt(MAZE_X0 + 8.5 * MAZE_CELL, midZ), 'inside the hedge').toBe(-1);
  });

  it('lays ribbon beds along the walks but not in the maze or hamlet', () => {
    // mid-segment points on the Hedgewick -> Rose Wilds walk, in the ribbon
    // band behind the path hedge line (5.2 to 6.6 off the road center)
    let ribbon = 0;
    for (let t = 0; t <= 1; t += 0.1) {
      const cx = 298 + (276 - 298) * t;
      const cz = 852 + (894 - 852) * t;
      for (let off = 5.3; off < 6.5; off += 0.3) {
        if (parterreFlowerTintAt(cx + off, cz) >= 0) ribbon++;
      }
    }
    expect(ribbon).toBeGreaterThan(3);
    // no ribbons inside the maze rect or the hamlet ring
    expect(parterreFlowerTintAt(360, 1016)).toBe(-1);
    expect(parterreFlowerTintAt(EVERGARDEN_ZONE.hub.x + 3, EVERGARDEN_ZONE.hub.z)).toBe(-1);
  });

  it('blooms meadow drifts on the open lawns, clear of walks and features', () => {
    // the big southeast lawn holds open ground: some cells must bloom
    let blooms = 0;
    for (let x = 440; x <= 530; x += 2) {
      for (let z = 740; z <= 810; z += 2) {
        const tint = gardenMeadowTintAt(x, z);
        if (tint >= 0) {
          blooms++;
          // a drift never sits on a walk, in a bed, or in the maze
          expect(roadDistance(x, z)).toBeGreaterThan(7.4);
          expect(inParterrePlot(x, z, 3.9)).toBe(false);
        }
      }
    }
    expect(blooms, 'southeast lawn meadow blooms').toBeGreaterThan(20);
    // never inside the maze or the hamlet
    expect(gardenMeadowTintAt(360, 1016)).toBe(-1);
    expect(gardenMeadowTintAt(EVERGARDEN_ZONE.hub.x + 4, EVERGARDEN_ZONE.hub.z)).toBe(-1);
  });

  it('draws the mill ring beds from the shared color wheel', () => {
    const seen = new Set<number>();
    for (const p of PARTERRE_PLOTS) {
      if (p.centerpiece !== 'windmill') continue;
      for (let dx = -p.r; dx <= p.r; dx += 0.8) {
        for (let dz = -p.r; dz <= p.r; dz += 0.8) {
          const tint = parterreFlowerTintAt(p.x + dx, p.z + dz);
          if (tint >= 0) seen.add(tint);
        }
      }
    }
    expect(seen.size, 'distinct mill-bed colors in use').toBeGreaterThanOrEqual(4);
    for (const tint of seen) {
      if (![0xffffff, 0xf27ba6, 0xf2c94c].includes(tint)) {
        expect(GARDEN_BED_TINTS).toContain(tint);
      }
    }
  });
});

describe('the bush and topiary plan', () => {
  it('plants the walk hedges, mill rings, and cardinal roses', () => {
    const spots = parterreBushSpots(SEED);
    const hedges = spots.filter((s) => s.kind === 'bush');
    const roses = spots.filter((s) => s.kind === 'bushFlowers');
    expect(hedges.length).toBeGreaterThan(250); // the walk lines plus mill rings
    for (const s of hedges) expect(s.scale).toBe(0.82); // the gardener's shears
    for (const s of roses) {
      expect(s.bloomTint).toBeDefined();
      expect(GARDEN_BED_TINTS).toContain(s.bloomTint);
    }
    for (const s of spots) {
      expect(terrainHeight(s.x, s.z, SEED), `bush at (${s.x},${s.z})`).toBeGreaterThan(
        WATER_LEVEL + 1.6,
      );
      expect(slopeAt(s.x, s.z), `bush slope at (${s.x},${s.z})`).toBeLessThan(0.65);
    }
    let millRoses = 0;
    for (const p of PARTERRE_PLOTS) {
      const center = roses.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) < 1);
      // no plot keeps a rose at its heart: the modeled beds bring their own
      // planting and the mills stand on theirs
      expect(center.length, `plot (${p.x},${p.z}) heart`).toBe(0);
      if (p.centerpiece === 'windmill') {
        const prop = (EVERGARDEN_PROPS.decorProps ?? []).filter(
          (d) => d.key === 'hexWindmill' && Math.hypot(d.x - p.x, d.z - p.z) < 1,
        );
        expect(prop.length, `plot (${p.x},${p.z}) windmill prop`).toBe(1);
        // the mill ring bed keeps its packed hedge ring and cardinal roses
        const ring = hedges.filter(
          (s) => Math.abs(Math.hypot(s.x - p.x, s.z - p.z) - p.r * 0.98) < p.r * 0.12,
        );
        expect(ring.length, `plot (${p.x},${p.z}) hedge ring density`).toBeGreaterThanOrEqual(
          Math.floor((Math.PI * 2 * p.r) / 2.3),
        );
        millRoses += roses.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) < p.r + 1).length;
      } else {
        // modeled beds grow no procedural bushes at all
        const inPlot = spots.filter((s) => Math.hypot(s.x - p.x, s.z - p.z) < p.r * 0.9);
        expect(inPlot.length, `plot (${p.x},${p.z}) stays clear for its model`).toBe(0);
      }
    }
    expect(millRoses, 'cardinal roses on the mill beds').toBeGreaterThanOrEqual(10);
  });

  it('lines every walk with a clipped hedge, broken at junctions', () => {
    const spots = parterreBushSpots(SEED);
    // mid-segment of the Rose Wilds walk: hedge lines flank at ~4.15yd
    const nearWalk = spots.filter(
      (s) =>
        s.kind === 'bush' &&
        Math.hypot(s.x - 287, s.z - 873) < 16 &&
        Math.abs(roadDistance(s.x, s.z) - 4.15) < 0.9,
    );
    expect(nearWalk.length, 'path hedge presence').toBeGreaterThan(8);
    // no hedge sits ON a walk
    for (const s of spots) {
      expect(roadDistance(s.x, s.z), `bush on the road at (${s.x},${s.z})`).toBeGreaterThan(3.3);
    }
  });

  it('never grows a hedge through a built structure', () => {
    // the built-footprint check: no hedge inside any collidered decor,
    // village building, well, or stall (walls use their thin visual depth;
    // bed roses are exempt: a mill bed's cardinal roses sit inside the
    // mill's generous collider circle but clear of its visual base)
    const spots = parterreBushSpots(SEED);
    for (const s of spots) {
      if (s.kind !== 'bush') continue;
      expect(
        clearOfGardenBuildings(s.x, s.z, 0.7),
        `hedge inside a structure at (${s.x.toFixed(1)},${s.z.toFixed(1)})`,
      ).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(parterreBushSpots(SEED)).toEqual(parterreBushSpots(SEED));
  });
});
