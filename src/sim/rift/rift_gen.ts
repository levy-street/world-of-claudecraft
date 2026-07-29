// The procedural Rift generator: pure, deterministic functions that turn a
// compact descriptor (seed + baseLevel + floorIndex) into a fully-resolved floor
// (geometry + visual style + spawn plan + gate). The authoritative server and
// every client call these identical functions, so no rift geometry is ever
// transmitted, only the descriptor. This mirrors how terrainHeight(x,z,seed) is a
// pure function both the sim and the renderer sample (see src/sim/world.ts).
//
// Sim layer: no DOM/Three imports. Randomness uses a LOCAL Rng seeded from the
// descriptor (NOT the live sim rng), so generation never perturbs the sim's
// global draw order and is reproducible anywhere.

import type { Collider } from '../colliders';
import {
  buildInfernalCitadelFloor,
  INFERNAL_FLOOR_COUNT,
  INFERNAL_THEME_ID,
  infernalCitadelName,
} from '../content/rift/infernal_citadel';
import { RIFT_THEMES, type RiftTheme } from '../content/rift/themes';
import {
  type DungeonLayout,
  type GridPoint,
  layoutColliders,
  type WallStub,
} from '../dungeon_layout';
import { polygonIsStarShaped, polygonSelfIntersects, polygonSignedArea } from '../geometry2d';
import { Rng } from '../rng';
import { authoredLiftAt } from './authored';
import { riftMinSpawnZ } from './entry_clearance';
import { RIFT_RANK_BASE_LEVEL, riftFloorLevel, riftHeroicTuningFor } from './ranks';
import { buildStyle, mixSeed } from './style';
import type {
  RiftFloorPlan,
  RiftGate,
  RiftObjectPlan,
  RiftPlan,
  RiftPlatform,
  RiftPuzzle,
  RiftRoller,
  RiftSpawn,
  RiftUpgradeManifest,
} from './types';
import { applyRiftUpgrade } from './upgrade';

// ---- Tuning -----------------------------------------------------------------
const MIN_FLOORS = 3;
const MAX_FLOORS = 6;

// Mob levels are rank-banded in rift/ranks.ts: C ramps under the classic
// fairness cap (22), B/A hold 22 and get their bite from the heroic stat
// transform, and S-rank floors are a flat 23 by design (re-exported here for
// the callers that historically read the cap off the generator).
export { RIFT_LEVEL_CAP, RIFT_MAX_MOB_LEVEL } from './ranks';

const ENTRY_Z_OFFSET = 8; // player arrival, past the entrance porch
const AISLE_HALF = 5.5; // centre column kept clear of all obstacles (walkable spine)
const BODY_R = 0.6; // player body radius used for clearance checks
const PACK_Z_JITTER = 2; // how far a trash spawn is jittered off its pack line

/** The arrival point's instance-local z. One expression, read by both the spawn planner
 * (which clears it, see entry_clearance.ts) and the plan's `entry`, so moving the porch
 * can never desync the two and silently reintroduce a pull on arrival. */
function entryZFor(layout: DungeonLayout): number {
  return layout.zMin + ENTRY_Z_OFFSET;
}

const RIFT_SUFFIXES = [
  'Abyss',
  'Depths',
  'Descent',
  'Hollow',
  'Labyrinth',
  'Warren',
  'Sanctum',
  'Rift',
] as const;

/** How often a rift seed opens the authored set-piece citadel instead of a
 * procedural descent. Rolled from its OWN Rng stream, so it neither consumes nor
 * shifts any draw the procedural generator makes. */
const SET_PIECE_CHANCE = 0.15;

/** Whether this SEED rolls the hand-authored Infernal Citadel (pure seed
 * property; whether it actually OPENS depends on the rank, see isSetPieceRift). */
export function isSetPieceSeed(seed: number): boolean {
  return new Rng(mixSeed(seed, 0x1f3e)).chance(SET_PIECE_CHANCE);
}

/** Whether this seed+rank opens the citadel. The 2-floor authored set-piece is
 * C content only: B, A and S rank dungeons are heroic scaled and guaranteed
 * 3+ floors, so a heroic-rank portal always runs the procedural descent, even
 * on a set-piece seed. Pure over the descriptor, so every host agrees. */
export function isSetPieceRift(seed: number, baseLevel: number): boolean {
  return isSetPieceSeed(seed) && riftHeroicTuningFor(baseLevel) === null;
}

/** How many floors this rift runs (deterministic from the descriptor). The
 * authored set-piece descends from the citadel halls into the pit; every
 * procedural rift (including any B/A/S run) is 3 to 6 floors. `baseLevel`
 * defaults to the C-rank baseline for legacy seed-only callers. */
export function riftFloorCount(seed: number, baseLevel: number = RIFT_RANK_BASE_LEVEL.C): number {
  if (isSetPieceRift(seed, baseLevel)) return INFERNAL_FLOOR_COUNT;
  return new Rng(mixSeed(seed, 0x510f)).int(MIN_FLOORS, MAX_FLOORS);
}

function themeForFloor(seed: number, floorIndex: number): RiftTheme {
  const rng = new Rng(mixSeed(seed, 0x7000 + floorIndex));
  return rng.pick(RIFT_THEMES as RiftTheme[]);
}

// ---- Geometry ---------------------------------------------------------------

/** Whether (x,z) clears every obstacle by the body radius (walkable). Handles
 * rotated OBBs (polygon-shell wall segments carry a non-zero rot) by testing the
 * point in each box's local frame, matching colliders.ts pushOut. */
function isClear(colliders: readonly Collider[], x: number, z: number, r = BODY_R): boolean {
  for (const c of colliders) {
    if (c.type === 'circle') {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz < (c.r + r) * (c.r + r)) return false;
    } else {
      // Match colliders.ts pushOut exactly: it computes the box-local point via
      // rotY(dx, dz, -c.rot), which expands to (dx*cos(rot) - dz*sin(rot),
      // dx*sin(rot) + dz*cos(rot)) because rotY carries a z-sign flip. Using -rot
      // in cos/sin here (an earlier bug) swapped the dz sign and disagreed with
      // pushOut on tilted polygon-wall segments.
      const dx = x - c.x;
      const dz = z - c.z;
      const cos = Math.cos(c.rot);
      const sin = Math.sin(c.rot);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hd + r) return false;
    }
  }
  return true;
}

/** Nudge a candidate point toward the always-clear centre spine until it clears
 * every obstacle by radius `r`. Deterministic (fixed march), and guaranteed to
 * terminate because |x| <= AISLE_HALF is kept obstacle-free by construction. `r`
 * lets a bulky prop (pylon, rune monolith) demand extra wall clearance so it never
 * renders embedded in a wall. */
function toClear(colliders: readonly Collider[], x: number, z: number, r = BODY_R): GridPoint {
  if (isClear(colliders, x, z, r)) return { x, z };
  const step = x >= 0 ? -1 : 1;
  let cx = x;
  for (let i = 0; i < 40; i++) {
    cx += step;
    if (Math.abs(cx) <= AISLE_HALF) cx = 0;
    if (isClear(colliders, cx, z, r)) return { x: cx, z };
    if (cx === 0) break;
  }
  return { x: 0, z };
}

interface GeneratedGeometry {
  layout: DungeonLayout;
  colliders: Collider[];
  /** Room half-width at instance-local z (the walkable envelope; obstacles + spawns
   * are kept inside it). For a rectangle this is a constant. */
  halfWidthAt: (z: number) => number;
  archetype: string;
}

// Room silhouettes. Each is a symmetric half-width PROFILE over the room length
// (t in [0,1]); the centre spine (x=0) always stays inside and walkable. `hall`
// is the plain rectangle; the rest become star-shaped `shellPolygon` rooms that
// render + collide as their true shape. Boss floors bias to wide-open shapes so
// the giant boss has room to fight.
type Profile = (t: number) => number;
const ROOM_ARCHETYPES = [
  'hall',
  'rotunda',
  'taper',
  'apse',
  'hourglass',
  'chambers',
  'cavern',
  'corridor', // thin winding passage (see makeProfile + baffle walls)
] as const;
// Boss floors only use shapes that are WIDE at the back (where the boss + dais
// sit), so the giant boss always has an open arena.
const BOSS_ARCHETYPES = ['hall', 'taper', 'apse'] as const;

function smoothstep(u: number): number {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
}

function makeProfile(rng: Rng, archetype: string, wMin: number, wMax: number): Profile {
  const span = wMax - wMin;
  switch (archetype) {
    case 'rotunda': // bulging round hall
      return (t) => wMin + span * Math.sin(Math.PI * t);
    case 'taper': // widens toward the boss end
      return (t) => wMin + span * t;
    case 'apse': // narrow nave, then a wide round chamber at the boss end
      return (t) => (t < 0.5 ? wMin : wMin + span * smoothstep((t - 0.5) / 0.5));
    case 'hourglass': // wide ends, a narrow passage at the waist
      return (t) => wMin + span * (1 - Math.sin(Math.PI * t));
    case 'chambers': {
      // Two bulges joined by a passage: cos(4*pi*t) gives wide/narrow/wide/narrow/wide.
      return (t) => wMin + span * (0.5 + 0.5 * Math.cos(4 * Math.PI * t));
    }
    case 'cavern': {
      // Organic wobble from a few fixed-phase harmonics (deterministic per rng).
      const p1 = rng.range(0, Math.PI * 2);
      const p2 = rng.range(0, Math.PI * 2);
      const p3 = rng.range(0, Math.PI * 2);
      return (t) => {
        const w =
          0.55 +
          0.22 * Math.sin(3 * Math.PI * t + p1) +
          0.14 * Math.sin(5 * Math.PI * t + p2) +
          0.09 * Math.sin(8 * Math.PI * t + p3);
        return wMin + span * Math.max(0, Math.min(1, w));
      };
    }
    case 'corridor': // a thin passage the whole way (baffle walls add the weave)
      return () => wMin + Math.min(span, 3);
    default: // 'hall'
      return () => wMax;
  }
}

function buildLayout(rng: Rng, _floorIndex: number, isBoss: boolean): GeneratedGeometry {
  const zMin = -19;
  // Bigger, more spread-out floors: a longer nave and a wider envelope so a run
  // feels grand and exploratory rather than a short cramped corridor. Kept within
  // the rift region bounds (data.ts RIFT_REGION_HALF_Z 160 / HALF_X 40): the dais +
  // descent at the far end must stay inside HALF_Z, and the side walls inside HALF_X,
  // or the region's trigger/collision checks stop firing there.
  const length = isBoss ? rng.int(120, 146) : rng.int(130, 168);
  const zMax = zMin + length;
  const midZ = (zMin + zMax) / 2;
  const range = zMax - zMin;

  const archetype = isBoss
    ? rng.pick(BOSS_ARCHETYPES as unknown as string[])
    : rng.pick(ROOM_ARCHETYPES as unknown as string[]);
  // Narrowest half-width keeps the spine + a walkable margin (>= AISLE_HALF + ~4);
  // widest drives how grand the room feels (capped so wallX stays < HALF_X 40).
  const wMin = rng.range(11, 15);
  const wMax = isBoss ? rng.range(28, 37) : rng.range(22, 36);
  const profile = makeProfile(rng, archetype, wMin, Math.max(wMin + 4, wMax));
  const halfWidthAt = (z: number): number =>
    Math.max(wMin, profile(Math.max(0, Math.min(1, (z - zMin) / range))));

  // Assemble the shell polygon for non-rectangular archetypes; validate it is
  // simple + star-shaped from the centre pole (so render/collision/pathing all
  // behave), else fall back to a plain rectangle.
  let shellPolygon: Array<{ x: number; z: number }> | undefined;
  let shellPole: { x: number; z: number } | undefined;
  let wallX: number;
  if (archetype === 'hall') {
    wallX = Math.round(wMax);
  } else {
    const zs: number[] = [];
    for (let z = zMin; z <= zMax; z += 6) zs.push(z);
    if (zs[zs.length - 1] !== zMax) zs.push(zMax);
    const right = zs.map((z) => ({ x: Math.round(halfWidthAt(z) * 10) / 10, z }));
    const left = zs.map((z) => ({ x: -Math.round(halfWidthAt(z) * 10) / 10, z })).reverse();
    let poly = [...right, ...left];
    if (polygonSignedArea(poly) < 0) poly = poly.slice().reverse();
    const pole = { x: 0, z: midZ };
    if (!polygonSelfIntersects(poly) && polygonIsStarShaped(poly, pole)) {
      shellPolygon = poly;
      shellPole = pole;
      wallX = Math.ceil(Math.max(...poly.map((p) => Math.abs(p.x)))) + 2;
    } else {
      wallX = Math.round(wMax); // fall back to a rectangle
    }
  }
  const isPoly = shellPolygon !== undefined;

  const daisR = Math.min(
    isBoss ? rng.range(12, 15) : rng.range(8, 10.5),
    halfWidthAt(zMax - 12) - 2,
  );
  const dais = { x: 0, z: zMax - Math.round(daisR + 5), r: Math.max(6, daisR) };

  // Pillar rows down the nave, off the centre spine but inside the local width.
  const pillars: GridPoint[] = [];
  const pillarBase = rng.pick([12, 14, 16]);
  const rowGap = rng.pick([14, 16, 18, 20]);
  for (let z = zMin + rng.int(22, 30); z <= dais.z - 16; z += rowGap) {
    const inset = Math.min(pillarBase, halfWidthAt(z) - 3);
    if (inset < AISLE_HALF + 2) continue; // too narrow here for flanking pillars
    if (rng.chance(0.25)) pillars.push({ x: rng.chance(0.5) ? -inset : inset, z });
    else pillars.push({ x: -inset, z }, { x: inset, z });
  }

  // Wall-side obstacles hugging the (possibly curved) walls.
  const tombs: GridPoint[] = [];
  if (rng.chance(0.8)) {
    const tombGap = rng.pick([20, 24, 28]);
    for (let z = zMin + rng.int(16, 24); z <= dais.z - 20; z += tombGap) {
      const inset = halfWidthAt(z) - 4;
      if (inset < AISLE_HALF + 2) continue;
      if (rng.chance(0.85)) tombs.push({ x: -inset, z });
      if (rng.chance(0.85)) tombs.push({ x: inset, z });
    }
  }

  // Chamber-waist stubs only for the rectangular hall (polygon rooms get their
  // structure from the shell itself; a stub could poke outside a narrow section).
  const stubs: WallStub[] = [];
  if (!isPoly && rng.chance(0.5)) {
    const waistCount = rng.pick([1, 2]);
    for (let i = 0; i < waistCount; i++) {
      const wz = zMin + Math.round(((i + 1) / (waistCount + 1)) * (dais.z - 20 - zMin)) + 20;
      const passageHalf = AISLE_HALF + rng.range(1.5, 3);
      const hw = (wallX - passageHalf) / 2;
      if (hw <= 0.5) continue;
      const centerMag = (wallX + passageHalf) / 2;
      const hd = rng.pick([3, 4, 5]);
      stubs.push({ x: -centerMag, z: wz, hw, hd }, { x: centerMag, z: wz, hw, hd });
    }
  }

  // Baffle walls: alternating one-sided wall fins that reach in from the (possibly
  // curved) wall. These used to be long one-sided fins that walled off most of a
  // half (reading as full walls); now they are SHORT stubs that jut only a little
  // way in from the wall, so both the spine AND the far side stay open and you weave
  // AROUND small obstacle bits rather than through a corridor of walls. The inner
  // edge stays >= AISLE_HALF + margin (x=0 always clear, playability spine check
  // holds). Always on for the thin `corridor` archetype; a common garnish elsewhere.
  if (!isBoss && (archetype === 'corridor' || rng.chance(0.4))) {
    const bafGap = rng.pick([10, 12, 14]);
    let side = rng.chance(0.5) ? -1 : 1;
    for (let z = zMin + rng.int(24, 32); z <= dais.z - 18; z += bafGap) {
      const w = halfWidthAt(z);
      if (w < AISLE_HALF + 5) {
        side = -side;
        continue; // too narrow here for a fin that still leaves a passage
      }
      // Short fin hugging the wall: hw capped so the inner edge stays >= AISLE_HALF+1.5.
      const hw = Math.min(rng.range(2, 3.5), (w - AISLE_HALF - 2) / 2);
      const cx = side * (w - hw - 0.5);
      stubs.push({ x: cx, z, hw, hd: rng.pick([1.5, 2, 2.5]) });
      side = -side;
    }
  }

  // Floor clutter, scattered off-centre, inside the local width.
  const clutter: GridPoint[] = [];
  const clutterCount = rng.int(4, 10);
  for (let i = 0; i < clutterCount; i++) {
    const z = zMin + rng.range(14, dais.z - 18 - zMin);
    const hw = halfWidthAt(z);
    if (hw - AISLE_HALF < 4) continue;
    const side = rng.chance(0.5) ? -1 : 1;
    const x = side * rng.range(AISLE_HALF + 2, hw - 2);
    clutter.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
  }

  const layout: DungeonLayout = {
    zMin,
    zMax,
    sideWallZ: midZ,
    sideWallHd: range / 2 + 1,
    wallX,
    endWallHw: wallX + 1,
    floorHalfX: wallX,
    doorZ: zMin + 2,
    pillars,
    tombs,
    stubs,
    dais,
    clutter,
    shellPolygon,
    shellPole,
  };
  return { layout, colliders: layoutColliders(layout), halfWidthAt, archetype };
}

// ---- Spawns + objects -------------------------------------------------------

function planSpawns(
  rng: Rng,
  theme: RiftTheme,
  geo: GeneratedGeometry,
  floorLevel: number,
  isBoss: boolean,
): RiftSpawn[] {
  const { layout, colliders, halfWidthAt } = geo;
  const out: RiftSpawn[] = [];

  // Nothing may spawn within the arrival clearance, or walking in pulls the front pack
  // before the player has done anything (rift/entry_clearance.ts explains the radius).
  // The band start absorbs the per-spawn jitter so the whole first pack sits beyond it.
  const minSpawnZ = riftMinSpawnZ(entryZFor(layout));
  const rawStartZ = layout.zMin + 22;
  const packStartZ = Math.max(rawStartZ, minSpawnZ + PACK_Z_JITTER);
  const packEndZ = layout.dais.z - (isBoss ? 22 : 14);
  const packGap = rng.pick([16, 18, 20]);
  // packCount stays keyed to the ORIGINAL band start, so pushing the packs back off the
  // entry neither adds nor drops an rng draw: the same number of packs is spread across
  // the shorter band instead. Changing the draw COUNT here would shift every downstream
  // object, hazard and roller on every procedural floor as a side effect.
  const packCount = Math.max(2, Math.floor((packEndZ - rawStartZ) / packGap));
  const packStride = packCount > 1 ? Math.max(0, (packEndZ - packStartZ) / (packCount - 1)) : 0;

  for (let i = 0; i < packCount; i++) {
    const z = packStartZ + i * packStride;
    const size = isBoss ? rng.int(1, 2) : rng.int(2, 3);
    for (let j = 0; j < size; j++) {
      const templateId = rng.pick(theme.trash as string[]);
      // Spread the pack across the aisle within the local width, then pull any
      // blocked spawn to a clear tile. Round BEFORE the clearance march so the
      // stored point is exactly the one validated as clear (no rounding drift).
      const spread = Math.max(2, halfWidthAt(z) - 4);
      const rawX = Math.round(rng.range(-spread, spread) * 10) / 10;
      // Floored at the arrival clearance. packStartZ already guarantees this for the
      // current jitter, but keeping the clamp on the write is what makes the invariant
      // local: a later band or jitter retune cannot quietly walk a pack back onto the
      // entry. Clamping z BEFORE the march is safe because toClear only slides x.
      const rawZ = Math.max(
        minSpawnZ,
        Math.round((z + rng.range(-PACK_Z_JITTER, PACK_Z_JITTER)) * 10) / 10,
      );
      const p = toClear(colliders, rawX, rawZ);
      // color/scale left undefined: the base template's (theme-appropriate) values
      // are used, then lightly jittered per-entity at spawn time (rift/runs.ts).
      out.push({ templateId, x: p.x, z: p.z, level: floorLevel });
    }
  }

  if (isBoss) {
    const boss: RiftSpawn = {
      templateId: theme.boss,
      x: 0,
      z: layout.dais.z,
      level: floorLevel,
      boss: true,
    };
    out.push(boss);
    // The boss stays ON the dais, unclamped: the dais is at the far end of a 120 yd-plus
    // nave, so it is never within the arrival clearance (the guard test pins that).
    // Two dais guards flanking the boss.
    for (const gx of [-6, 6]) {
      const p = toClear(colliders, gx, Math.max(minSpawnZ, layout.dais.z - 6));
      out.push({
        templateId: rng.pick(theme.trash as string[]),
        x: p.x,
        z: p.z,
        level: floorLevel,
      });
    }
  }
  return out;
}

// Every non-boss floor rolls a gate mechanic, layered on top of clearing the room.
// Only kinds fully wired end-to-end (generator + runs.ts + render) are rolled.
// `pylonCount` doubles as the node count for rune_pylons and sequence.
function planPuzzle(rng: Rng, isBoss: boolean): RiftPuzzle {
  const none: RiftPuzzle = { kind: 'none', pylonCount: 0 };
  if (isBoss) return none;
  const roll = rng.next();
  if (roll < 0.18) return { kind: 'rune_pylons', pylonCount: rng.int(3, 4) };
  if (roll < 0.36) return { kind: 'ice_slide', pylonCount: 0 };
  if (roll < 0.54) return { kind: 'boulder_push', pylonCount: 0 };
  if (roll < 0.72) return { kind: 'sequence', pylonCount: rng.int(3, 5) };
  return none;
}

/** The frictionless ice sheet for an ice_slide floor: a wide box in the middle of
 * the nave. The goal tile sits at the far (north) end on the centre spine, so a
 * straight northward slide always solves it (harder attempts stop against pillars). */
function iceZoneFor(geo: GeneratedGeometry): { x: number; z: number; hw: number; hd: number } {
  const { layout } = geo;
  const zC = (layout.zMin + layout.dais.z) / 2;
  // Cap the depth so a single north slide crosses it in a couple of seconds (a
  // full-room rink made the glide drag on); keep it wide enough to read as a rink.
  const hd = Math.max(10, Math.min(24, (layout.dais.z - 20 - (layout.zMin + 16)) / 2));
  const hw = Math.max(6, Math.min(layout.wallX ?? 20, geo.halfWidthAt(zC)) - 2);
  return { x: 0, z: zC, hw, hd };
}

function planObjects(
  rng: Rng,
  geo: GeneratedGeometry,
  isBoss: boolean,
  puzzle: RiftPuzzle,
  iceZone: { x: number; z: number; hw: number; hd: number } | null,
): RiftObjectPlan[] {
  const { layout, colliders, halfWidthAt } = geo;
  const out: RiftObjectPlan[] = [];
  if (isBoss) {
    // The reward chest sits on the dais; the exit portal is spawned by runs.ts
    // only after the boss dies (so it can't be used to skip the fight).
    out.push({
      kind: 'chest',
      x: 0,
      z: layout.dais.z + Math.round(layout.dais.r * 0.6),
      name: 'Rift Cache',
    });
    return out;
  }

  // Descent portal centred just past the dais, always on the clear spine.
  out.push({
    kind: 'descent',
    x: 0,
    z: layout.dais.z + Math.round(layout.dais.r + 2),
    name: 'Rift Descent',
  });

  if (puzzle.kind === 'rune_pylons') {
    // Fit the pylons BETWEEN the entry and the dais so none lands in the back wall.
    const n = puzzle.pylonCount;
    const z0 = layout.zMin + 40;
    const z1 = Math.max(z0, layout.dais.z - 14);
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = n > 1 ? z0 + ((z1 - z0) * i) / (n - 1) : (z0 + z1) / 2;
      // Sit each pylon well inside the wall (a good fraction of the local width,
      // clamped off the spine) and clear it by the prop radius so its flaming
      // brazier never renders embedded in the wall.
      const x =
        side * Math.max(AISLE_HALF + 2.5, Math.min(halfWidthAt(z) - 6, halfWidthAt(z) * 0.6));
      const p = toClear(colliders, x, z, 1.7);
      out.push({ kind: 'rune_pylon', x: p.x, z: p.z, name: 'Rune Pylon' });
    }
  } else if (puzzle.kind === 'ice_slide' && iceZone) {
    // Goal on the spine at the north edge of the sheet: a straight slide reaches it.
    out.push({
      kind: 'ice_goal',
      x: 0,
      z: Math.round(iceZone.z + iceZone.hd - 1.5),
      name: 'Frost Sigil',
    });
  } else if (puzzle.kind === 'boulder_push') {
    // Colinear boulder+pad pairs just off dead-centre (inside the always-clear
    // spine, so always placeable + solvable): shove the boulder straight north
    // onto its socket. x = +-3.5 leaves an x=0 gap so the descent path stays open.
    const count = rng.int(1, 2);
    for (let i = 0; i < count; i++) {
      const bx = (i % 2 === 0 ? -1 : 1) * 3.5;
      const bz = layout.zMin + 34 + i * 16;
      const padZ = Math.min(bz + 10, layout.dais.z - 6);
      if (padZ <= bz + 3) continue;
      out.push({ kind: 'boulder_pad', x: bx, z: padZ, name: 'Socket' });
      out.push({ kind: 'boulder', x: bx, z: bz, name: 'Heavy Boulder' });
    }
  } else if (puzzle.kind === 'sequence') {
    // N runes spread across the nave; step them in south-to-north order (runs.ts
    // sorts by z and enforces it; a wrong step resets). `slot` is the placement id.
    const n = puzzle.pylonCount;
    const zBase = layout.zMin + 34;
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const z = zBase + Math.floor(i / 2) * 16 + (i % 2) * 8;
      const x =
        side * Math.max(AISLE_HALF + 2.5, Math.min(halfWidthAt(z) - 6, halfWidthAt(z) * 0.6));
      const p = toClear(colliders, x, z, 1.5);
      out.push({ kind: 'seq_rune', x: p.x, z: p.z, name: 'Sequence Rune', slot: i });
    }
  }

  // Off-path treasure: ~45% of non-boss floors tuck a reward chest against a wall
  // off the main aisle. It used to hide behind an illusion (fake) wall, but every
  // rift wall is solid now (phantom walls confused more than they delighted and
  // could visually swallow objectives), so the chest simply sits in the open as a
  // reward for hugging the walls.
  if (rng.chance(0.45)) {
    const side = rng.chance(0.5) ? -1 : 1;
    const zT = Math.round(layout.zMin + rng.range(32, Math.max(32, layout.dais.z - 26)));
    const localW = halfWidthAt(zT);
    if (localW >= AISLE_HALF + 8) {
      // toClear guarantees the chest is off the wall (and every other collider).
      const chest = toClear(colliders, side * (localW - 4), zT, 1.0);
      out.push({ kind: 'treasure', x: chest.x, z: chest.z, name: 'Hidden Cache' });
    }
  }
  return out;
}

/** Lava/blackwater bands for a subset of floors, themed by kit tint. Never blocks
 * completion (a hazard is not a collider: you can jump across, skirt the edge, or
 * tank the damage). Placed as a band across the nave, off the entry/dais. */
function planHazards(
  rng: Rng,
  geo: GeneratedGeometry,
  isBoss: boolean,
  hasIce: boolean,
): import('../types').DelveHazardZone[] {
  if (isBoss || hasIce) return []; // don't drown the boss arena or freeze+burn one floor
  if (!rng.chance(0.34)) return [];
  const { layout, halfWidthAt } = geo;
  const out: import('../types').DelveHazardZone[] = [];
  const bands = rng.int(1, 2);
  for (let i = 0; i < bands; i++) {
    const z = layout.zMin + 42 + i * rng.int(20, 30);
    if (z > layout.dais.z - 16) break;
    const hw = Math.max(5, halfWidthAt(z) - 1);
    // A shallow band ~4yd deep along z: reachable by a running jump (apex clears it).
    out.push({
      x: 0,
      z,
      r: hw,
      rx: hw,
      rz: rng.range(3.5, 5),
      tier: rng.chance(0.4) ? 'deep' : 'shallow',
    });
  }
  return out;
}

/** Rolling-boulder lanes for a subset of non-boss floors that carry no lava/ice
 * (one headline traversal hazard per floor, so a floor never reads as chaos). A
 * boulder rolls down the always-clear central spine from near the entry to just
 * shy of the dais, then wraps; the player dodges into the flanking aisle or jumps
 * it. It is a moving ENTITY, never a collider, so it never blocks pathing. */
function planRollers(
  rng: Rng,
  geo: GeneratedGeometry,
  isBoss: boolean,
  hasIce: boolean,
  hasHazards: boolean,
): RiftRoller[] {
  if (isBoss || hasIce || hasHazards) return [];
  if (!rng.chance(0.3)) return [];
  const { layout } = geo;
  const z0 = layout.zMin + 16;
  const z1 = layout.dais.z - 4;
  if (z1 - z0 < 24) return []; // too short a run to be fair or fun
  const count = rng.int(1, 2);
  const out: RiftRoller[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: 0, z0, z1, r: 1.4, speed: rng.range(7, 10), phase: count > 1 ? i / count : 0 });
  }
  return out;
}

/** Verticality: a raised rear "sanctum" tier reached by a full-width staircase.
 * The floor steps UP toward the dais so the boss/descent stand elevated. Boss
 * floors get one when the room is long enough; other floors ~30% (but never with a
 * rolling boulder, lava, or ice, whose lane/zone would fight the stairs). The stair
 * band sits just south of the dais so the dais + descent land on the platform. */
function planPlatform(
  rng: Rng,
  geo: GeneratedGeometry,
  isBoss: boolean,
  hasOtherHazard: boolean,
): RiftPlatform | null {
  if (hasOtherHazard) return null;
  // Boss floors now get an elevated sanctum only ~55% of the time (a flush arena is
  // a welcome change of pace instead of EVERY boss on a dais); non-boss floors ~50%,
  // so elevation reads throughout a run, not just at the boss.
  if (isBoss ? !rng.chance(0.55) : !rng.chance(0.5)) return null;
  const { layout } = geo;
  const rampZ1 = Math.round(layout.dais.z - layout.dais.r - 4); // top of the climb, south of the dais
  // Two flavours of elevation: a STEEP rear sanctum (short stair band near the dais)
  // or a LONG gentle climb that lifts most of the nave, so floors get real
  // incline variety and read bigger. Boss floors always use the steep sanctum.
  const gentle = !isBoss && rng.chance(0.5);
  const rampZ0 = gentle ? layout.zMin + rng.int(24, 32) : rampZ1 - rng.int(8, 13);
  if (rampZ0 <= layout.zMin + 20 || rampZ1 - rampZ0 < 6) return null;
  const height = isBoss ? rng.range(2.8, 3.6) : rng.range(1.8, 3.0);
  return { rampZ0, rampZ1, height };
}

/** Scatter blocker pillars across the ice sheet (Pokemon-style obstacles that stop a
 * slide), while keeping a clear central north corridor (|x| < ICE_CORRIDOR) so the
 * player can always reach the Frost Sigil by centering up and sliding straight north
 * (the goal is solved by SLIDING THROUGH it, radius 4, so no stopper is needed).
 * Off the corridor, the rocks force you to navigate the rink slide by slide. Pushes
 * the blockers into `geo.layout.pillars` and recomputes `geo.colliders`, so they are
 * live for the runtime region, the renderer, and the spawn-clearance checks. */
function addIceBlockers(
  rng: Rng,
  geo: GeneratedGeometry,
  ice: { x: number; z: number; hw: number; hd: number },
): void {
  const ICE_CORRIDOR = 4.5;
  const zS = ice.z - ice.hd;
  const zN = ice.z + ice.hd;
  const maxX = Math.max(ICE_CORRIDOR + 2, ice.hw - 2);
  if (maxX <= ICE_CORRIDOR + 1.5) return; // rink too narrow for off-corridor rocks
  const n = rng.int(4, 7);
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * rng.range(ICE_CORRIDOR + 1.5, maxX);
    const z = rng.range(zS + 6, zN - 6);
    geo.layout.pillars.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
  }
  geo.colliders = layoutColliders(geo.layout);
}

/** A Pokemon-style switch-gate for an otherwise-plain floor: a portcullis spanning
 * the nave (a runtime clamp, never a static collider) with a pressure plate on the
 * spine to its south. Step the plate to raise the gate, then proceed. Null if the
 * nave is too short to fit a fair "plate, then gate, then room" sequence. */
function planGate(rng: Rng, geo: GeneratedGeometry): RiftGate | null {
  const { layout, halfWidthAt } = geo;
  const zGate = Math.round(layout.zMin + rng.range(50, Math.max(50, layout.dais.z - 32)));
  if (zGate >= layout.dais.z - 22) return null;
  const switchZ = zGate - rng.int(12, 18); // plate south of the gate (reached first)
  if (switchZ <= layout.zMin + 18) return null;
  const hw = Math.max(AISLE_HALF + 3, halfWidthAt(zGate)); // span the full walkable width
  return { x: 0, z: zGate, hw, hd: 1.6, switchX: 0, switchZ };
}

/** The raised-tier Y lift at instance-local z (0 in the nave, ramps up the stairs,
 * flat `height` on the rear platform). Pure + single-valued, so the authoritative
 * Sim and the render regenerate identical verticality from the descriptor. */
export function riftPlatformLift(platform: RiftPlatform | null, localZ: number): number {
  if (!platform || localZ <= platform.rampZ0) return 0;
  if (localZ >= platform.rampZ1) return platform.height;
  return (platform.height * (localZ - platform.rampZ0)) / (platform.rampZ1 - platform.rampZ0);
}

/** Vertical floor lift at instance-local (x, z): authored layouts use per-room
 * lifts with door ramps (authoredLiftAt); procedural floors use the z-band
 * platform. The one entry point every lift consumer (player/mob/object lift,
 * the movement kernel strip, the renderer's ground reference and camera clamp)
 * reads, so all hosts regenerate identical verticality. */
export function riftLiftAt(floor: RiftFloorPlan, localX: number, localZ: number): number {
  const rooms = floor.layout.rooms;
  if (rooms && rooms.length > 0) {
    return authoredLiftAt(rooms, floor.layout.doors ?? [], localX, localZ);
  }
  return riftPlatformLift(floor.platform, localZ);
}

// ---- Public generation ------------------------------------------------------

const FLOOR_CACHE = new Map<string, RiftFloorPlan>();

// applyRiftUpgrade builds a FRESH floor object (deep-ish clone) on every call;
// the renderer regenerates the floor per frame (camera clamp, ground-reference
// heuristic), so an upgraded floor would otherwise allocate a full spawn-mapped
// clone per read. Manifests are stable per event, so memoise by identity.
const UPGRADED_CACHE = new WeakMap<RiftFloorPlan, WeakMap<RiftUpgradeManifest, RiftFloorPlan>>();

function upgradedFloor(base: RiftFloorPlan, upgrade?: RiftUpgradeManifest | null): RiftFloorPlan {
  if (!upgrade) return applyRiftUpgrade(base, upgrade);
  let per = UPGRADED_CACHE.get(base);
  if (!per) {
    per = new WeakMap();
    UPGRADED_CACHE.set(base, per);
  }
  const hit = per.get(upgrade);
  if (hit) return hit;
  const built = applyRiftUpgrade(base, upgrade);
  per.set(upgrade, built);
  return built;
}
const CACHE_LIMIT = 128;

function floorLevelFor(baseLevel: number, floorIndex: number): number {
  return riftFloorLevel(baseLevel, floorIndex);
}

/** The rift as a whole: name + floor count (derived from seed + baseLevel). */
export function generateRiftPlan(seed: number, baseLevel: number): RiftPlan {
  if (isSetPieceRift(seed, baseLevel)) {
    return {
      seed,
      baseLevel,
      name: infernalCitadelName(seed),
      themeId: INFERNAL_THEME_ID,
      floorCount: INFERNAL_FLOOR_COUNT,
    };
  }
  const floorCount = riftFloorCount(seed, baseLevel);
  const bossTheme = themeForFloor(seed, floorCount - 1);
  const nameRng = new Rng(mixSeed(seed, 0x9a3e));
  const noun = nameRng.pick(bossTheme.nouns as string[]);
  const suffix = nameRng.pick(RIFT_SUFFIXES as unknown as string[]);
  return {
    seed,
    baseLevel,
    name: `The ${noun} ${suffix}`,
    themeId: bossTheme.id,
    floorCount,
  };
}

/** A fully-resolved floor. Memoised (bounded) since both the sim spawn path and
 * the renderer regenerate the same floor repeatedly. */
export function generateRiftFloor(
  seed: number,
  baseLevel: number,
  floorIndex: number,
  upgrade?: RiftUpgradeManifest | null,
): RiftFloorPlan {
  const key = `${seed >>> 0}:${Math.round(baseLevel)}:${floorIndex}`;
  const cached = FLOOR_CACHE.get(key);
  if (cached) return upgradedFloor(cached, upgrade);

  // Authored set-piece runs short-circuit the whole procedural chain BEFORE any
  // draw is made, so the procedural draw order for every other run is untouched.
  if (isSetPieceRift(seed, baseLevel)) {
    const setIndex = Math.max(0, Math.min(INFERNAL_FLOOR_COUNT - 1, floorIndex));
    const setPiece = buildInfernalCitadelFloor(
      seed,
      baseLevel,
      floorLevelFor(baseLevel, setIndex),
      setIndex,
    );
    if (FLOOR_CACHE.size >= CACHE_LIMIT) FLOOR_CACHE.clear();
    FLOOR_CACHE.set(key, setPiece);
    return upgradedFloor(setPiece, upgrade);
  }

  const floorCount = riftFloorCount(seed, baseLevel);
  const clampedIndex = Math.max(0, Math.min(floorCount - 1, floorIndex));
  const isBoss = clampedIndex === floorCount - 1;
  const theme = themeForFloor(seed, clampedIndex);
  const rng = new Rng(mixSeed(seed, 0xf100 + clampedIndex));

  const geo = buildLayout(rng, clampedIndex, isBoss);
  const style = buildStyle(rng, theme);
  const floorLevel = floorLevelFor(baseLevel, clampedIndex);
  const puzzle = planPuzzle(rng, isBoss);
  const iceZone = puzzle.kind === 'ice_slide' ? iceZoneFor(geo) : null;
  // Ice-maze rocks go in BEFORE spawns/objects so both place onto clear tiles.
  if (iceZone) addIceBlockers(rng, geo, iceZone);
  const spawns = planSpawns(rng, theme, geo, floorLevel, isBoss);
  const objects = planObjects(rng, geo, isBoss, puzzle, iceZone);
  const hazards = planHazards(rng, geo, isBoss, iceZone !== null);
  const rollers = planRollers(rng, geo, isBoss, iceZone !== null, hazards.length > 0);
  const platform = planPlatform(
    rng,
    geo,
    isBoss,
    rollers.length > 0 || iceZone !== null || hazards.length > 0,
  );
  // A switch-gate is the mechanic for a subset of otherwise-plain floors (no puzzle,
  // hazard, roller, ice, or platform), so exactly one headline mechanic reads.
  const gate =
    !isBoss &&
    puzzle.kind === 'none' &&
    rollers.length === 0 &&
    hazards.length === 0 &&
    iceZone === null &&
    platform === null &&
    rng.chance(0.5)
      ? planGate(rng, geo)
      : null;
  if (gate) {
    objects.push({ kind: 'gate', x: gate.x, z: gate.z, name: 'Rift Gate' });
    objects.push({ kind: 'switch', x: gate.switchX, z: gate.switchZ, name: 'Rune Switch' });
  }

  const plan: RiftFloorPlan = {
    seed: seed >>> 0,
    baseLevel: Math.round(baseLevel),
    floorIndex: clampedIndex,
    floorCount,
    isBoss,
    name: `${theme.name} ${isBoss ? 'Sanctum' : 'Reaches'}: Depth ${clampedIndex + 1}`,
    themeName: theme.name,
    layout: geo.layout,
    style,
    entry: { x: 0, z: entryZFor(geo.layout) },
    spawns,
    objects,
    puzzle,
    hazards,
    iceZone,
    rollers,
    platform,
    gate,
  };

  if (FLOOR_CACHE.size >= CACHE_LIMIT) FLOOR_CACHE.clear();
  FLOOR_CACHE.set(key, plan);
  return upgradedFloor(plan, upgrade);
}

/** Instance-local collider set for a rift floor (pure, from the generated layout). */
export function riftFloorColliders(
  seed: number,
  baseLevel: number,
  floorIndex: number,
): Collider[] {
  return layoutColliders(generateRiftFloor(seed, baseLevel, floorIndex).layout);
}
