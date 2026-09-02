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

// A pad the player cannot walk OFF is the "combat dummy on an unreachable
// ledge" report in its general form, and it is what the Highwatch training
// dummy pin below characterizes by hand at one spot. This generalizes that pin
// over the whole roster, under ruling qr-19-npc-terrain-pad-rule.
//
// NUMBER-FREE ON PURPOSE: the bounds are the live climb gate
// (PLAYER_MAX_CLIMB_SLOPE) and the same hop-down cap the reachability walk
// uses, so the arm invents no threshold. The packet holds only two pad-delta
// measurements and no sanctioned ceiling, which is why the DELTA form of this
// question stays with the maintainer and this shape does not need it.
//
// A RADIAL rim-slope walk (the literal generalization of the Highwatch pin's
// spoke comparison) was measured first and REFUSED, so the next reader does
// not re-derive it. The measurement, with the parameters it needs to be
// reproducible: 8 spokes, a 1 yd radial step, a strict `>` against
// PLAYER_MAX_CLIMB_SLOPE, walked from rIn+1 to rOut over the 901 surviving
// open-world pads. It reports 389 over-gate steps against the LIVE terrain
// field (terrainHeight) and 468 against the calm-lifted field; the worst single
// step is 13.64 yd at the IGNIVAR KEEP door pad (503.05, 2243.70), which passes
// both the road walk and the escape walk. Rim climbability in every radial
// direction is not a property this roster has or needs, because a player routes
// AROUND a cliff. The escape walk models that; the radial form does not.
// The one hand-chosen number here, and it is a SEARCH BOUND rather than a
// threshold: the walk must actually get CLEAR of the ring, not merely take one
// step past it, so success is measured at rOut plus this margin and the queue
// is bounded by the same distance. Three lattice cells. It cannot make a
// failing pad pass (a wider margin only asks for more walking); the CLIMB and
// DROP gates are what decide the verdict, and those are the live constants.
const PAD_ESCAPE_MARGIN = 3 * WALK_CELL;

/** True when a walk from the pad centre leaves its surviving ring under the
 *  climb gate. `h` is injected so the arm below can be driven over synthetic
 *  ground: a sweep whose only run is over the real world cannot tell a working
 *  predicate from one that returns true unconditionally. */
function escapesPad(
  row: Pick<CalmPadRow, 'x' | 'z'>,
  rOut: number,
  h: (x: number, z: number) => number,
  waterAt: (x: number, z: number) => number = (x, z) => waterLevelAt(x, z, SEED),
): boolean {
  const limit = rOut + PAD_ESCAPE_MARGIN;
  const sx = Math.round(row.x / WALK_CELL) * WALK_CELL;
  const sz = Math.round(row.z / WALK_CELL) * WALK_CELL;
  const seen = new Set<string>([`${sx},${sz}`]);
  const queue: [number, number][] = [[sx, sz]];
  let read = 0;
  while (read < queue.length) {
    const [cx, cz] = queue[read++];
    const hHere = h(cx, cz);
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
      const d = Math.hypot(nx - row.x, nz - row.z);
      if (d > limit + WALK_CELL) continue;
      const hNext = h(nx, nz);
      const wl = waterAt(nx, nz);
      const swim = wl !== -Infinity && hNext < wl;
      // FORWARD, unlike reachesRoad above. That walk searches in REVERSE (pad
      // out to a road) and so reads the forward climb as `hHere - hNext`; this
      // one walks the direction the player actually travels, centre outward, so
      // the climb is `hNext - hHere` and the drop is `hHere - hNext`. Copying
      // the reverse form here gated the outward CLIMB at the hop-down cap (8 yd
      // over a 2 yd cell) and the outward DROP at the climb gate, which waves a
      // 7 yd wall through and refuses a legal 4 yd hop down; the control below
      // drives exactly those two cases.
      if (
        !swim &&
        (hNext - hHere > PLAYER_MAX_CLIMB_SLOPE * WALK_CELL || hHere - hNext > WALK_DROP_MAX)
      )
        continue;
      if (d > rOut + PAD_ESCAPE_MARGIN) return true;
      seen.add(key);
      queue.push([nx, nz]);
    }
  }
  return false;
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

  it('every surviving pad can be walked off its own ring', () => {
    // The roster-wide form of the Highwatch pin: no pad's own skirt may be a
    // wall the player is stuck inside. Distinct from the road walk above,
    // which is memoized on a rounded cell and may leave through a NEIGHBOUR's
    // graded ground; this one has to leave THIS ring.
    const failures: string[] = [];
    let walked = 0;
    for (const row of openWorldPads) {
      const rOut = survivingROut(row);
      if (rOut === null) continue;
      walked++;
      if (!escapesPad(row, rOut, hAt)) {
        failures.push(`${row.category} (${row.x}, ${row.z}) rOut=${rOut.toFixed(1)}`);
      }
    }
    // OCCUPANCY FLOOR. Every pad here is skipped when its skirt is dropped, so a
    // calmSkirtWidth regression that returned null everywhere would empty this
    // arm and pass green over nothing. 901 walk today; the floor sits under that
    // with room for ordinary roster churn.
    expect(walked, 'the escape sweep walked almost no pads').toBeGreaterThanOrEqual(800);
    expect(failures, failures.join('; ')).toEqual([]);
  });

  it('the escape walk refuses a walled pad and accepts a flat one', () => {
    // The positive control, because every pad on the real roster escapes: a
    // sweep that only ever sees passing input cannot tell a working predicate
    // from `return true`. Synthetic ground, driven through the same function
    // the arm above uses.
    const pad = { x: 0, z: 0 };
    // Fully synthetic: the water probe is injected too, so the control cannot
    // depend on the live water field near the origin (a swimmable cell would
    // let the pit case escape and silently invert the assertion).
    const dry = (): number => -Infinity;
    const ring = (inside: number, outside: number) => (x: number, z: number) =>
      Math.hypot(x, z) > 10 ? outside : inside;
    const escapes = (h: (x: number, z: number) => number) => escapesPad(pad, 10, h, dry);
    expect(escapes(ring(0, 0)), 'flat ground must escape').toBe(true);
    expect(escapes(ring(0, 100)), 'a wall at the ring edge must refuse').toBe(false);
    expect(escapes(ring(0, -100)), 'a lethal drop at the ring edge must refuse').toBe(false);
    // AT THE THRESHOLDS, which is what an extreme-only control cannot see: a
    // +100 wall and a -100 pit are refused under EITHER gate orientation, so
    // they certify nothing about the gates themselves. These two do: a 7 yd rise
    // is over the climb gate (PLAYER_MAX_CLIMB_SLOPE * WALK_CELL = 3) and under
    // the hop-down cap (8), and a 4 yd drop is the reverse. With the climb and
    // drop terms swapped, both of these invert.
    expect(escapes(ring(0, 7)), 'a rise over the climb gate must refuse').toBe(false);
    expect(escapes(ring(0, -4)), 'a drop under the hop-down cap must escape').toBe(true);
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
