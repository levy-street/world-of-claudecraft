// The global placement-integrity gate: every authored open-world placement
// (the calm-pad roster in src/sim/terrain_calm_anchors.ts, plus the mob
// camps) must sit on classic workable ground and be walkable from the road
// network. This is the guard behind the "cave floating inside a mountain
// ridge" and "combat dummy on an unreachable ledge" reports: any terrain
// change that strands or buries a placed thing fails here, by name.
//
// Three layers:
//  1. Category coverage: every ZonePropsDef key is classified (covered by
//     the roster or deliberately skipped), so a NEW placement category
//     cannot ship unconsidered.
//  2. Pad classicness: a surviving pad's footprint is BIT-EXACT legacy
//     ground (calm 0 blends every character layer off); a dropped optional
//     pad diverges beneath notice.
//  3. Reachability: a BFS walk under the player climb gate (swimming
//     allowed) connects each pad to a road.
import { describe, expect, it } from 'vitest';
import { CAMPS, DUNGEON_X_THRESHOLD, PROPS } from '../src/sim/data';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import {
  type CalmPadRow,
  calmSkirtWidth,
  collectCalmAnchorPads,
} from '../src/sim/terrain_calm_anchors';
import {
  roadDistance,
  terrainCalmFactorAt,
  terrainHeight,
  terrainHeightWithForcedCalm,
  waterLevelAt,
} from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;

// ---------------------------------------------------------------------------
// 1. Category coverage
// ---------------------------------------------------------------------------

// Roster categories (collectCalmAnchorPads) that source from ZonePropsDef.
const COVERED_PROP_KEYS = [
  'buildings',
  'wells',
  'stalls',
  'mines',
  'docks',
  'tents',
  'crates',
  'campfires',
  'mudHuts',
  'ruinRings',
  'benches',
  'graveyards',
  'delveMarkers',
  'decorProps',
  'raceCourse',
];

// Deliberately not padded: foliage-like dressing rides a slope fine, and
// hub-internal line work sits on hub plateaus already.
const SKIPPED_PROP_KEYS = ['marshReeds', 'greatTrees', 'fences', 'walls'];

describe('placement categories are classified', () => {
  it('every ZonePropsDef key is covered or deliberately skipped', () => {
    const classified = new Set([...COVERED_PROP_KEYS, ...SKIPPED_PROP_KEYS]);
    for (const key of Object.keys(PROPS)) {
      expect(classified.has(key), `new prop category "${key}" is unclassified`).toBe(true);
    }
  });

  it('the roster carries every non-prop placement domain', () => {
    const categories = new Set(collectCalmAnchorPads().map((row) => row.category));
    for (const required of [
      'gatherNode',
      'npc',
      'dungeonDoor',
      'portal',
      'graveyard',
      'mailbox',
      'noticeboard',
      'musterBoard',
      'groundObject',
      'tunnelMouth',
      'worldBoss',
      'escortRoute',
      'poi',
      'deckRoot',
      'valeCup',
    ]) {
      expect(categories.has(required), `roster lost the ${required} category`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Shared probes
// ---------------------------------------------------------------------------

const probe = (x: number, z: number, calm: number): number =>
  terrainHeightWithForcedCalm(x, z, SEED, calm);

// Mirror of the production sizing decision, so the test checks the exact
// rings players walk.
function survivingROut(row: CalmPadRow): number | null {
  const width = calmSkirtWidth(row.x, row.z, row.rIn, row.baseROut - row.rIn, row.optional, probe);
  return width === null ? null : row.rIn + width;
}

const openWorldPads = collectCalmAnchorPads().filter((row) => row.x <= DUNGEON_X_THRESHOLD);

const openWorldCamps = CAMPS.filter((camp) => camp.center.x <= DUNGEON_X_THRESHOLD);

// The BFS walk lattice. 2yd cells resolve every walkable ramp the calm
// skirts produce (their slopes are bounded far under the climb gate).
const WALK_CELL = 2;
const WALK_BUDGET = 24000;
// The largest forward DROP counted as a route (a player can always hop
// down; past this the fall is a hazard, not a path).
const WALK_DROP_MAX = 8;

const heightCache = new Map<string, number>();
function hAt(x: number, z: number): number {
  const key = `${x},${z}`;
  let h = heightCache.get(key);
  if (h === undefined) {
    h = terrainHeight(x, z, SEED);
    heightCache.set(key, h);
  }
  return h;
}

// True when a player can travel road -> (x, z). Searched in REVERSE (pad
// out to a road within 6yd of a polyline), so each reverse step C -> N
// mirrors the forward step N -> C: the forward CLIMB (hC - hN) is bounded
// by the climb gate, the forward DROP (hN - hC) by the hop-down cap, and
// swimmable water passes.
const reachMemo = new Map<string, boolean>();
function reachesRoad(x0: number, z0: number): boolean {
  const sx = Math.round(x0 / WALK_CELL) * WALK_CELL;
  const sz = Math.round(z0 / WALK_CELL) * WALK_CELL;
  const memoKey = `${sx},${sz}`;
  const memoized = reachMemo.get(memoKey);
  if (memoized !== undefined) return memoized;
  const result = ((): boolean => {
    if (roadDistance(sx, sz) < 6) return true;
    const seen = new Set<string>([memoKey]);
    const queue: [number, number][] = [[sx, sz]];
    let read = 0;
    while (read < queue.length && seen.size < WALK_BUDGET) {
      const [cx, cz] = queue[read++];
      const hHere = hAt(cx, cz);
      for (const [dx, dz] of [
        [WALK_CELL, 0],
        [-WALK_CELL, 0],
        [0, WALK_CELL],
        [0, -WALK_CELL],
      ] as const) {
        const nx = cx + dx;
        const nz = cz + dz;
        const key = `${nx},${nz}`;
        if (seen.has(key)) continue;
        const hNext = hAt(nx, nz);
        const wl = waterLevelAt(nx, nz, SEED);
        const swim = wl !== -Infinity && hNext < wl;
        const forwardClimb = hHere - hNext;
        const forwardDrop = hNext - hHere;
        if (
          !swim &&
          (forwardClimb > PLAYER_MAX_CLIMB_SLOPE * WALK_CELL || forwardDrop > WALK_DROP_MAX)
        )
          continue;
        if (roadDistance(nx, nz) < 6) return true;
        seen.add(key);
        queue.push([nx, nz]);
      }
    }
    return false;
  })();
  reachMemo.set(memoKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// 2. Pad classicness
// ---------------------------------------------------------------------------

describe('pads sit on classic ground', () => {
  it('every surviving pad footprint has its character layers fully off', () => {
    // calm 0 across the footprint is the classic-ground guarantee: at calm
    // 0 the height pipeline computes the exact legacy field (plus the
    // calm-independent authored features the content was graded against).
    const failures: string[] = [];
    for (const row of openWorldPads) {
      const rOut = survivingROut(row);
      if (rOut === null) continue;
      for (const [fx, fz] of [
        [0, 0],
        [row.rIn * 0.7, 0],
        [-row.rIn * 0.7, 0],
        [0, row.rIn * 0.7],
        [0, -row.rIn * 0.7],
      ]) {
        if (terrainCalmFactorAt(row.x + fx, row.z + fz, SEED) !== 0) {
          failures.push(`${row.category} (${row.x}, ${row.z})`);
          break;
        }
      }
    }
    expect(failures, failures.join('; ')).toEqual([]);
  });

  it('every dropped optional pad diverges beneath notice', () => {
    const failures: string[] = [];
    for (const row of openWorldPads) {
      if (survivingROut(row) !== null) continue;
      const d = Math.abs(terrainHeight(row.x, row.z, SEED) - probe(row.x, row.z, 0));
      if (d > 1.25) failures.push(`${row.category} (${row.x}, ${row.z}) drifts ${d.toFixed(2)}`);
    }
    expect(failures, failures.join('; ')).toEqual([]);
  });

  it('every open-world camp core has its character layers fully off', () => {
    for (const camp of openWorldCamps) {
      expect(
        terrainCalmFactorAt(camp.center.x, camp.center.z, SEED),
        `camp at (${camp.center.x}, ${camp.center.z})`,
      ).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Reachability
// ---------------------------------------------------------------------------

describe('every placement is walkable from the road network', () => {
  it('all roster pads reach a road under the climb gate', () => {
    const failures: string[] = [];
    for (const row of openWorldPads) {
      if (!reachesRoad(row.x, row.z)) {
        failures.push(`${row.category} (${row.x}, ${row.z})`);
      }
    }
    expect(failures, failures.join('; ')).toEqual([]);
  });

  it('all open-world camps reach a road under the climb gate', () => {
    const failures: string[] = [];
    for (const camp of openWorldCamps) {
      if (!reachesRoad(camp.center.x, camp.center.z)) {
        failures.push(`camp (${camp.center.x}, ${camp.center.z})`);
      }
    }
    expect(failures, failures.join('; ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The two reported regressions, pinned by name
// ---------------------------------------------------------------------------

describe('the reported spots', () => {
  it('the Thornpeak crystal cave portal sits on its probed level bench', () => {
    // The duskfall_passage side-a gate mound footprint: level to within a
    // step across the whole prop (the pre-fix field varied 5yd here).
    const hC = terrainHeight(10, 770, SEED);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = terrainHeight(10 + Math.cos(a) * 5, 770 + Math.sin(a) * 5, SEED);
      expect(Math.abs(h - hC)).toBeLessThan(1.0);
    }
    expect(reachesRoad(10, 770)).toBe(true);
  });

  it('the Highwatch training dummy is reachable, not a ledge', () => {
    // The radius-0 camp at (-40, 648): the pre-fix skirt compressed ~12yd
    // of divergence into 4.4yd of ring (a 5.9 grade wall at r=8).
    for (let r = 5; r <= 20; r += 1) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const hIn = terrainHeight(-40 + Math.cos(a) * (r - 1), 648 + Math.sin(a) * (r - 1), SEED);
        const hOut = terrainHeight(-40 + Math.cos(a) * r, 648 + Math.sin(a) * r, SEED);
        expect(Math.abs(hOut - hIn)).toBeLessThan(PLAYER_MAX_CLIMB_SLOPE);
      }
    }
    expect(reachesRoad(-40, 648)).toBe(true);
  });
});
