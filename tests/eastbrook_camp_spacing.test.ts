import { describe, expect, it } from 'vitest';
import { campSpawnOffset } from '../src/sim/camp_scatter';
import { isBlocked } from '../src/sim/colliders';
import { LAKE, ZONE1_CAMPS } from '../src/sim/content/zone1';
import { QUESTS } from '../src/sim/data';
import { PLAYER_SWIM_DEPTH } from '../src/sim/pathfind';
import { rideSteepnessAt } from '../src/sim/ride_height';
import type { CampDef } from '../src/sim/types';
import {
  groundHeight,
  isInWaterBody,
  terrainHeight,
  WATER_LEVEL,
  waterLevel,
  waterLevelAt,
} from '../src/sim/world';

// The starter zone's hostile camps used to chain-pull: mobs stood about 8 yd apart
// inside a camp while their aggro radii are 9-13 yd, so tagging one dragged its
// neighbours, the wolf and boar discs reached to within ~34 yd of the town hub, and
// several camps of DIFFERENT families overlapped, so one bad pull woke two
// populations at once. The lever is SPACING (camp radius, camp separation, and
// where a camp could not otherwise fit, a small count cut): aggroRadius and the
// flee-rally in src/sim/mob/social_aggro.ts are deliberately untouched here.

// The production world seed (server/game.ts WORLD_SEED, server/main.ts).
const SEED = 20061;

// Nominal nearest-neighbour spacing of a sunflower camp disc (camp_scatter.ts:51).
const NOMINAL_SPACING = (camp: CampDef) => camp.radius / Math.sqrt(camp.count);

// Floors this suite enforces.
const MIN_NEIGHBOUR_SPACING = 11.5; // yd between adjacent mobs in one camp
const MIN_TOWN_CLEARANCE = 38; // yd from the town hub at origin to a camp's disc edge
const CROSS_POPULATION_GAP = 2; // yd of clear ground between two DIFFERENT families
const SAME_POPULATION_SLOPE = 0.75; // one family split in two may still abut
const SAME_POPULATION_INTERCEPT = 8;
const STARTER_BAND = 100; // "close to town": disc edge within this many yd of origin
const MAX_BEARING_DRIFT_DEG = 15; // camps push outward, they do not relocate across the map

const centerDistance = (c: CampDef) => Math.hypot(c.center.x, c.center.z);
const discEdgeToTown = (c: CampDef) => centerDistance(c) - c.radius;
const campDistance = (a: CampDef, b: CampDef) =>
  Math.hypot(a.center.x - b.center.x, a.center.z - b.center.z);

// Two camps of the same mobId are ONE population split across two sites, so their
// scatter discs may lightly abut. Two different mobIds are two populations and must
// not touch at all, or a single pull wakes both families.
const requiredSeparation = (a: CampDef, b: CampDef) =>
  a.mobId === b.mobId
    ? (a.radius + b.radius) * SAME_POPULATION_SLOPE + SAME_POPULATION_INTERCEPT
    : a.radius + b.radius + CROSS_POPULATION_GAP;

// Every ZONE1_CAMPS row in author order. Author order is a determinism contract
// (src/sim/data.ts: a camp inserted mid-array shifts every later camp's world-gen
// rng draws), and the roster pin is what stops a spacing retune from "fixing"
// density by quietly deleting a pack or thinning a named elite.
//
// COUNTS WERE DELIBERATELY REDUCED (maintainer-authorized, 2026-07-28): the packed
// camps came down by one each so their discs could be pulled fully apart, and the
// murlocs by three because Mirror Lake caps their radius (see the exemption below).
// Every named rare and elite (old_greyjaw, mogger, gorrak, captain_verlan) is
// untouched at count 1: those are the key mobs and are never thinned. Each camp
// stays at or above half of the largest single kill-quest requirement against its
// mobId, which the quest-floor test below re-derives from the live quest tables.
const PINNED_ROSTER: { mobId: string; count: number }[] = [
  { mobId: 'forest_wolf', count: 6 },
  { mobId: 'forest_wolf', count: 5 },
  { mobId: 'old_greyjaw', count: 1 },
  { mobId: 'wild_boar', count: 5 },
  { mobId: 'wild_boar', count: 4 },
  { mobId: 'mogger', count: 1 },
  { mobId: 'webwood_spider', count: 6 },
  { mobId: 'mudfin_murloc', count: 5 },
  { mobId: 'tunnel_rat', count: 8 },
  { mobId: 'vale_bandit', count: 6 },
  { mobId: 'vale_bandit', count: 5 },
  { mobId: 'gorrak', count: 1 },
  { mobId: 'restless_bones', count: 6 },
  { mobId: 'captain_verlan', count: 1 },
];

// The camps this suite governs, pinned by author index so the set can never
// silently shrink when a camp is pushed past the starter band. A packed camp is one
// with at least two mobs (a named rare spawns alone, so it has no intra-camp
// spacing to fix) whose disc reaches into the starter band.
const GOVERNED_INDICES = [0, 1, 3, 4, 6, 7, 8, 9, 12];

// Where each governed camp sat BEFORE this retune, so the fix is provably an
// outward push along the same bearing rather than a relocation. Index-aligned with
// GOVERNED_INDICES.
const SHIPPED_PLACEMENT: { x: number; z: number }[] = [
  { x: -15, z: 55 },
  { x: 20, z: 70 },
  { x: 55, z: 12 },
  { x: 80, z: -15 },
  { x: -60, z: 5 },
  { x: -75, z: 57 },
  { x: -82, z: -62 },
  { x: 65, z: -65 },
  { x: 80, z: 78 },
];

const governed = () => GOVERNED_INDICES.map((i) => ZONE1_CAMPS[i]);
const label = (c: CampDef) => `${c.mobId}@(${c.center.x},${c.center.z})`;

// The ONE camp that cannot reach MIN_NEIGHBOUR_SPACING, and why. The murloc camp
// sits on Mirror Lake, and terrainHeightUnpadded (src/sim/world.ts) flattens a disc
// of radius * 1.8 around every camp center toward the ground height at that center.
// Widening this camp to 11.5 yd spacing drags a ~59 yd flatten across the lake and
// raises its bed from -7.6 to about -2.7, above WATER_LEVEL - PLAYER_SWIM_DEPTH: the
// lake stops needing a swim, fish stop leaping, and the map stops painting it as
// water (tests/water_terrain_awareness.test.ts). Even radius 15.5 reshapes the south
// shore enough to break the mount-versus-swimmer waterline
// (tests/mount_transition.test.ts), so 15 is the measured shore-safe ceiling and the
// COUNT came down instead (8 to 5), lifting spacing from 4.95 to 6.71 yd. Its own
// floor is pinned below and is decisive: it fails if the camp is repacked tighter OR
// if a future change trades the lake away for spacing.
const LAKE_BOUND_MOB_ID = 'mudfin_murloc';
const LAKE_BOUND_MAX_COUNT = 5;
const LAKE_BOUND_MIN_SPACING = 6.5;

// Why (x, z) is not a usable spawn point, or null when it is. Mirrors the floors the
// camp spawn loop applies in sim.ts (minHeight) plus the collider and rideability
// gates. Murlocs are the one family the sim lets wade (Sim.mobCanSpawnInWater keys
// off family 'mudfin'), so they are measured against the swimmer floor instead.
function unspawnableReason(x: number, z: number, amphibious: boolean): string | null {
  const height = groundHeight(x, z, SEED);
  const floor = amphibious ? waterLevel() - 0.5 : waterLevel() + 0.4;
  if (height < floor) return `below the spawn floor (h=${height.toFixed(2)} < ${floor})`;
  const surface = waterLevelAt(x, z, SEED);
  if (!amphibious && surface !== -Infinity && height < surface + 0.4) {
    return `submerged in a lake (h=${height.toFixed(2)} < ${surface + 0.4})`;
  }
  if (isBlocked(SEED, x, z, 0.5)) return 'inside a collider';
  const steepness = rideSteepnessAt(x, z, SEED);
  if (steepness >= 1.5) return `too steep (${steepness.toFixed(2)})`;
  return null;
}

// The camp's real sunflower slots: campSpawnOffset for THIS count and radius, which
// is exactly where the spawn loop puts each mob before jitter. Deliberately scoped to
// the real slots, not a denser synthetic ring and not the full jitter envelope: both
// probe ground no mob reliably occupies, and on this coastline they would fail on the
// beach shelf and push the boars 60+ yd off their meadow for nothing. The spawn loop
// nudges a slot by up to CAMP_SCATTER_JITTER * spacing and findSafePos walks that rare
// bad draw back to land; what must never happen, and what this catches, is a camp
// whose designed slots sit in the sea, in a collider, or on a cliff.
function scatterProbe(camp: CampDef): { x: number; z: number }[] {
  const points: { x: number; z: number }[] = [];
  for (let i = 0; i < camp.count; i++) {
    const offset = campSpawnOffset(i, camp.count, camp.radius, 0, 0);
    points.push({ x: camp.center.x + offset.x, z: camp.center.z + offset.z });
  }
  return points;
}

// Largest single-quest kill requirement against a mobId, across every live quest.
function largestKillRequirement(mobId: string): number {
  let most = 0;
  for (const quest of Object.values(QUESTS)) {
    for (const objective of quest.objectives) {
      if (objective.type === 'kill' && objective.targetMobId === mobId) {
        most = Math.max(most, objective.count);
      }
    }
  }
  return most;
}

describe('eastbrook starter camp spacing', () => {
  it('pins the camp roster: same mobs, deliberate counts, same author order', () => {
    expect(ZONE1_CAMPS.map((c) => ({ mobId: c.mobId, count: c.count }))).toEqual(PINNED_ROSTER);
  });

  it('never thins a named rare or elite below its solo spawn', () => {
    // Thinning is allowed on packs, never on the set-piece mobs a quest sends the
    // player to kill by name.
    for (const mobId of ['old_greyjaw', 'mogger', 'gorrak', 'captain_verlan']) {
      const camp = ZONE1_CAMPS.find((c) => c.mobId === mobId);
      expect(camp, `${mobId} must still be placed`).toBeDefined();
      expect(camp?.count, `${mobId} is a key mob and must stay at exactly 1`).toBe(1);
    }
  });

  it('keeps every camp at or above half of its largest kill quest', () => {
    // Respawns cover the rest, but a camp below half of a single quest's requirement
    // turns that quest into a respawn-camping chore.
    for (const camp of governed()) {
      const required = largestKillRequirement(camp.mobId);
      expect(required, `${camp.mobId} should have a kill quest to measure against`).toBeGreaterThan(
        0,
      );
      expect(
        camp.count,
        `${label(camp)} holds ${camp.count} but a quest asks for ${required} kills`,
      ).toBeGreaterThanOrEqual(Math.ceil(required / 2));
    }
  });

  it('governs every packed camp whose disc reaches the starter band', () => {
    // Derive the set independently and require it to match the pinned indices, so
    // the geometry assertions below can never be weakened by a camp drifting out of
    // the band (or a new dense camp drifting in unchecked).
    const derived = ZONE1_CAMPS.reduce<number[]>((acc, camp, i) => {
      if (camp.count >= 2 && discEdgeToTown(camp) <= STARTER_BAND) acc.push(i);
      return acc;
    }, []);
    expect(derived).toEqual(GOVERNED_INDICES);
  });

  it('spreads mobs at least 11.5 yd apart inside every governed camp', () => {
    const checked = governed().filter((c) => c.mobId !== LAKE_BOUND_MOB_ID);
    // Guard the exemption itself: exactly one camp claims it, so a future retune
    // cannot quietly widen the waiver to whichever camp is inconvenient.
    expect(governed().length - checked.length).toBe(1);
    for (const camp of checked) {
      expect(
        NOMINAL_SPACING(camp),
        `${label(camp)} packs ${camp.count} mobs into r=${camp.radius}`,
      ).toBeGreaterThanOrEqual(MIN_NEIGHBOUR_SPACING);
    }
  });

  it('holds the lake-bound murloc camp to its own thinned floor', () => {
    const murloc = ZONE1_CAMPS.find((c) => c.mobId === LAKE_BOUND_MOB_ID);
    expect(murloc, 'the lake-bound camp must still exist').toBeDefined();
    if (!murloc) return;
    // It cannot reach 11.5 yd without filling the lake, so it buys its spacing with
    // a lower count instead. Both halves of that bargain are pinned.
    expect(murloc.count, 'the murloc camp must stay thinned').toBeLessThanOrEqual(
      LAKE_BOUND_MAX_COUNT,
    );
    expect(NOMINAL_SPACING(murloc), `${label(murloc)} spacing regressed`).toBeGreaterThanOrEqual(
      LAKE_BOUND_MIN_SPACING,
    );
  });

  it('keeps Mirror Lake swimmable rather than trading it for spacing', () => {
    // The exemption above is only legitimate while the camp stays small enough to
    // leave the lake deep. Any widening must re-prove this.
    const swimFloor = WATER_LEVEL - PLAYER_SWIM_DEPTH;
    let deepCells = 0;
    for (let x = LAKE.x - LAKE.radius * 2; x <= LAKE.x + LAKE.radius * 2; x += 4) {
      for (let z = LAKE.z - LAKE.radius * 2; z <= LAKE.z + LAKE.radius * 2; z += 4) {
        if (!isInWaterBody(x, z)) continue;
        if (terrainHeight(x, z, SEED) < swimFloor) deepCells++;
      }
    }
    // The shipped world has ~107 such cells on this 4 yd grid; the floor leaves room
    // for unrelated terrain tuning but fails hard on the ~0 a widened camp produces.
    expect(deepCells, 'Mirror Lake lost its swimmable depth').toBeGreaterThanOrEqual(80);
  });

  it('never lets two different populations overlap', () => {
    // The headline rule: two camps of different mobIds keep clear ground between
    // their discs, so one pull can never wake two families.
    const list = governed();
    let crossPairs = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i], list[j]];
        if (a.mobId === b.mobId) continue;
        crossPairs++;
        const gap = campDistance(a, b) - a.radius - b.radius;
        expect(
          gap,
          `${label(a)} and ${label(b)} are different populations but their discs are only ${gap.toFixed(2)} yd apart`,
        ).toBeGreaterThanOrEqual(CROSS_POPULATION_GAP);
      }
    }
    // 9 governed camps, 2 same-mobId pairs, so 34 cross pairs. If this drops the
    // loop above went partly vacuous.
    expect(crossPairs).toBe(34);
  });

  it('keeps two camps of the same population from interleaving', () => {
    const list = governed();
    let samePairs = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i], list[j]];
        if (a.mobId !== b.mobId) continue;
        samePairs++;
        expect(
          campDistance(a, b),
          `${label(a)} vs ${label(b)} are ${campDistance(a, b).toFixed(2)} apart, need ${requiredSeparation(a, b).toFixed(2)}`,
        ).toBeGreaterThanOrEqual(requiredSeparation(a, b));
      }
    }
    // The wolves and the boars: if this drops to 0 the assertion above went vacuous.
    expect(samePairs).toBe(2);
  });

  it('leaves the road ring out of town calm', () => {
    for (const camp of governed()) {
      expect(
        discEdgeToTown(camp),
        `${label(camp)} disc reaches ${discEdgeToTown(camp).toFixed(2)} yd from the town hub`,
      ).toBeGreaterThanOrEqual(MIN_TOWN_CLEARANCE);
    }
  });

  it('places every governed camp on ground the sim can actually spawn on', () => {
    // If a scatter point is unusable the spawn loop's findSafePos walk rescues it,
    // which bunches mobs back together and undoes the spacing. None should need it.
    for (const camp of governed()) {
      const amphibious = camp.mobId === LAKE_BOUND_MOB_ID;
      expect(
        unspawnableReason(camp.center.x, camp.center.z, amphibious),
        `${label(camp)} center is unusable`,
      ).toBeNull();
      for (const point of scatterProbe(camp)) {
        expect(
          unspawnableReason(point.x, point.z, amphibious),
          `${label(camp)} scatters a mob to (${point.x.toFixed(1)}, ${point.z.toFixed(1)}), which is unusable`,
        ).toBeNull();
      }
    }
  });

  it('pushes each camp outward along its own bearing, not across the map', () => {
    const list = governed();
    for (let i = 0; i < list.length; i++) {
      const camp = list[i];
      const shipped = SHIPPED_PLACEMENT[i];
      const drift = Math.abs(
        ((Math.atan2(camp.center.z, camp.center.x) - Math.atan2(shipped.z, shipped.x)) * 180) /
          Math.PI,
      );
      expect(
        Math.min(drift, 360 - drift),
        `${label(camp)} swung off its shipped bearing`,
      ).toBeLessThanOrEqual(MAX_BEARING_DRIFT_DEG);
    }
  });

  it('keeps Old Greyjaw north of both wolf runs and clear of their packs', () => {
    // q_greyjaw sends the player to "the deep woods north of the wolf runs", and a
    // lone rare elite must not sit inside an enlarged pack's scatter disc.
    const greyjaw = ZONE1_CAMPS[2];
    const wolves = [ZONE1_CAMPS[0], ZONE1_CAMPS[1]];
    for (const wolf of wolves) {
      expect(greyjaw.center.z, `greyjaw must stay north of ${label(wolf)}`).toBeGreaterThan(
        wolf.center.z,
      );
      expect(
        campDistance(greyjaw, wolf) - wolf.radius,
        `greyjaw sits inside ${label(wolf)}`,
      ).toBeGreaterThanOrEqual(10);
    }
  });
});
