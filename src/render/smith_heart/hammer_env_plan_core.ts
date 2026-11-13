// Pure plan of the Hammer vein's painted rebuild (the owner's style guide:
// docs/design/raid/smith_heart.md, section 5.22). Low-poly pieces whose
// paintings carry the look take over the vein's mountain, its terrace risers,
// its walk and its far dressing, and the arena's back wall becomes a ruined
// amphitheatre.
//
// What it never touches: anything a mechanic moves or hangs on. The Council's
// pillars and their sockets, the Slab and its frame, the Pit Mouth and the collapse
// spot's overhang stay the old kit's (`hammerEnvSwap` returns them unchanged). The
// Quarry's colossi were the owner's next update: the statues from their own file
// stand on the old colossi's spots. The old kit's pieces also stay in its GLB: the
// Council's bodies are built from them.
//
// Nothing moves: every swapped piece stands where the old plan stood it, its
// front on the same contour, never wider than its true front past the clearance
// (`fitHammerEnvRock`), so the walks, the open air and the sightline pins keep
// holding. A new solid stands on a terrace nobody reaches.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import {
  GALLERY_LANDINGS,
  HAMMER_PIT,
  HEART_ROOM,
  HEART_ROOM_AREA_R,
  QUARRY_TERRACES,
  RING,
  SMITH_HEART_FIELD,
  smithHeartAreaAt,
} from '../../sim/content/smith_heart_layout';
import { authoredFieldHeight, authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import { planFieldEdgePieces } from '../authored_field/field_edge_plan_core';
import { HAMMER_WALK_HALF } from './hammer_walk_plan_core';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartHash } from './heart_plan_core';
import { heartRockPieceOf } from './heart_rock_plan_core';
import { HEART_WALL_CLEAR, HEART_WALL_PATH_CLEAR, heartFloorClearance } from './heart_walls_core';

/** The vein's floors drawn as its painted paving apart from the layout's own
 *  ground: the Cleft and the stairs the raid walks (the layout keeps its slate). */
export const HAMMER_ENV_PAVED: ReadonlySet<string> = new Set([
  'cleft',
  'pit_descent',
  'slab_stair',
  'balcony_stair_east',
  'balcony_stair_west',
]);

/** A rock piece's measures in the shipped kit (yards at scale 1): its width, its
 *  height, how far its body runs back of its front plane. Foot on y 0, front
 *  plane on z 0, centred on x. Pinned against the GLB. */
export interface HammerEnvRockPiece {
  w: number;
  h: number;
  d: number;
}

export const HAMMER_ENV_ROCK: Readonly<Record<string, HammerEnvRockPiece>> = {
  Env_CliffTall: { w: 40, h: 62.9, d: 33.5 },
  Env_CliffWide: { w: 64, h: 36.5, d: 36.6 },
  Env_Outcrop: { w: 48, h: 40.1, d: 35.5 },
};

/** The arcade (ruined arches on the top terrace), measured the same way. */
export const HAMMER_ENV_ARCADE: HammerEnvRockPiece = { w: 30, h: 20.9, d: 6.4 };

/** The old rock pieces and what stands in each one's place: a wall as a cliff
 *  stack, a great mass as a broad bluff, a prow as an outcrop or a stack. */
const ROCK_SWAPS: Readonly<Record<string, readonly string[]>> = {
  Kit_RockWallA: ['Env_CliffTall', 'Env_CliffTall', 'Env_Outcrop'],
  Kit_RockWallB: ['Env_Outcrop', 'Env_CliffTall'],
  Kit_RockWallC: ['Env_CliffTall'],
  Kit_RockMassA: ['Env_CliffWide'],
  Kit_RockMassB: ['Env_Outcrop', 'Env_CliffWide'],
  Kit_RockProw: ['Env_Outcrop', 'Env_CliffTall'],
};

/** How far past its old true front a piece's width may run: the neighbours
 *  overlap, the crest narrowing reads as separate stacks. */
const ROCK_WIDEN = 1.35;
/** A small turn off the contour per piece, so no two faces read coplanar. */
const ROCK_TURN = 0.09;

/** Does this rock placement belong to the Hammer vein? Everything in its area, and
 *  whatever a neighbour's area holds that faces the vein's own floors: the Quench's
 *  line runs just behind the arena's east wall, so the skyline over the terraces
 *  stands past it. A wall facing a neighbour's own walk stays that vein's. */
export function hammerEnvOwnsRock(p: { x: number; z: number }): boolean {
  const area = smithHeartAreaAt(p.x, p.z);
  if (area === 'hammer') return true;
  if (area === 'heart') return false;
  const c = heartFloorClearance(p.x, p.z);
  if (!Number.isFinite(c.d)) return false;
  // The floor it faces: on past the clearance's own margin, onto the walk.
  const reach = c.d + 4;
  return smithHeartAreaAt(p.x + c.toX * reach, p.z + c.toZ * reach) === 'hammer';
}

function rockHash(p: HeartKitPlacement, salt: number): number {
  return heartHash(Math.round(p.x * 3) + salt, Math.round(p.z * 3));
}

/** Pick the piece standing in for an old rock placement. */
export function hammerEnvRockPiece(old: HeartKitPlacement): string {
  const far = old.piece.endsWith('Far');
  const base = far ? old.piece.slice(0, -3) : old.piece;
  const options = ROCK_SWAPS[base];
  if (!options) throw new Error(`no painted rock for ${old.piece}`);
  const pick = options[Math.floor(rockHash(old, 17) * options.length) % options.length];
  return far ? `${pick}Far` : pick;
}

function rockMeasure(piece: string): HammerEnvRockPiece {
  const m = HAMMER_ENV_ROCK[piece.endsWith('Far') ? piece.slice(0, -3) : piece];
  if (!m) throw new Error(`no measures for ${piece}`);
  return m;
}

/** A placement's three scales for a target box (yards). */
function fitBox(m: HammerEnvRockPiece, w: number, h: number, d: number) {
  const scale = d / m.d;
  return { scale, stretch: w / m.w / scale, rise: h / m.h / scale };
}

/** Is a front of half width `half` at (x, z), turned by `rot`, clear of the
 *  walks by the mountain's own clearance? */
export function hammerEnvFrontClear(x: number, z: number, rot: number, half: number): boolean {
  const ux = Math.cos(rot);
  const uz = -Math.sin(rot);
  for (let k = -4; k <= 4; k++) {
    const a = (k / 4) * half;
    const c = heartFloorClearance(x + ux * a, z + uz * a);
    if (c.d < (c.path ? HEART_WALL_PATH_CLEAR : HEART_WALL_CLEAR)) return false;
  }
  return true;
}

/** An old mountain piece as its painted stand-in: on the same spot and foot,
 *  as tall and as deep, narrowed as far as it takes to keep its whole front clear
 *  of every walk. */
export function fitHammerEnvRock(old: HeartKitPlacement): HeartKitPlacement {
  const piece = hammerEnvRockPiece(old);
  return fitEnvRockAs(old, piece, rockMeasure(piece));
}

/** The same fit for any painted piece of measures `measure` (the Breath's storm rock
 *  rides it too: breath_env_plan_core.ts). */
export function fitEnvRockAs(
  old: HeartKitPlacement,
  piece: string,
  measure: HammerEnvRockPiece,
): HeartKitPlacement {
  const m = heartRockPieceOf(old.piece);
  const k = old.scale ?? 1;
  const rot = old.rot + (rockHash(old, 23) - 0.5) * 2 * ROCK_TURN;
  let w = 2 * m.half * k * ROCK_WIDEN;
  const clearAt = (width: number, turn: number) =>
    hammerEnvFrontClear(old.x, old.z, turn, width / 2);
  let used = rot;
  for (let i = 0; i < 6 && !clearAt(w, used); i++) {
    // Square to the contour first, then narrower.
    if (i === 0) used = old.rot;
    else w *= 0.85;
  }
  return {
    piece,
    x: old.x,
    y: old.y,
    z: old.z,
    rot: used,
    ...fitBox(measure, w, m.height * k * (old.rise ?? 1), m.depth * k),
    noShadow: true,
    ...(old.cosmetic ? { cosmetic: true } : {}),
  };
}

/** A lip hanging under a walk as a cliff stack: its crest under the brink, its
 *  foot leaning out as far as the lip's did. */
export function fitHammerEnvLip(old: HeartKitPlacement): HeartKitPlacement {
  const k = old.scale ?? 1;
  const piece = rockHash(old, 29) < 0.5 ? 'Env_CliffTallFar' : 'Env_OutcropFar';
  const out = 14.4 * k;
  // A breath under the brink: an atlas's top can stand proud of its build's foot.
  const brink = 0.6;
  const drop = 40 * k * (old.rise ?? 1) - brink;
  const width = 18 * (old.stretch ?? 1) * k;
  return {
    piece,
    x: old.x + Math.sin(old.rot) * out,
    y: old.y - brink - drop,
    z: old.z + Math.cos(old.rot) * out,
    rot: old.rot,
    ...fitBox(rockMeasure(piece), width, drop, 18.4 * k),
    noShadow: true,
    ...(old.cosmetic ? { cosmetic: true } : {}),
  };
}

/** A crest needle as a pillar cluster on the same foot. */
export function fitHammerEnvNeedle(old: HeartKitPlacement): HeartKitPlacement {
  const k = old.scale ?? 1;
  const out = 12 * k;
  return {
    piece: 'Env_CliffTall',
    x: old.x + Math.sin(old.rot) * out,
    y: old.y,
    z: old.z + Math.cos(old.rot) * out,
    rot: old.rot,
    ...fitBox(HAMMER_ENV_ROCK.Env_CliffTall, 34 * k, 64 * k * (old.rise ?? 1), 24 * k),
    noShadow: true,
    ...(old.cosmetic ? { cosmetic: true } : {}),
  };
}

/** The old kit's pieces this rebuild stands in for, by swap. */
const KIT_SWAPS: Readonly<Record<string, string>> = {
  Kit_QuarryFaceA: 'Env_TierA',
  Kit_QuarryFaceB: 'Env_TierA',
  Kit_QuarryFaceC: 'Env_TierC',
  Kit_QuarryRimA: 'Env_RimA',
  Kit_QuarryRimB: 'Env_RimB',
  Kit_WalkCurbA: 'Env_KerbA',
  Kit_WalkCurbB: 'Env_KerbB',
  Kit_WalkRail: 'Env_ChainRail',
  Kit_RubblePile: 'Env_RubbleA',
  Kit_FallenBlockA: 'Env_BoulderA',
  Kit_FallenBlockB: 'Env_BoulderB',
  // The Quarry's colossi, from their own kit (hammer_env_kit.ts SMITH_HEART_HAMMER_COLOSSI_URL):
  // the Keeper stands in for the Vigil.
  Kit_ColossusVigil: 'Env_ColossusKeeper',
  Kit_ColossusWaking: 'Env_ColossusWaking',
  Kit_ColossusBearer: 'Env_ColossusBearer',
};

/** The old kit's pieces with no one piece in their place: the great cliffs give
 *  way to the arcades (`planHammerEnvArena`). */
const KIT_DROPS: ReadonlySet<string> = new Set([
  'Kit_GreatCliffA',
  'Kit_GreatCliffB',
  'Kit_GreatCliffC',
]);

/** Pieces a mechanic hangs on: never swapped. (The colossi round the pit were frozen too
 *  until they had painted models of their own.) */
export const HAMMER_ENV_FROZEN: ReadonlySet<string> = new Set([
  'Kit_PitColumnSocket',
  'Kit_SlabFrame',
  'Kit_CollapseOverhang',
]);

/** One aisle down the terraces in this many riser modules. */
const TIER_AISLE_EVERY = 9;

function nearPillar(p: { x: number; z: number }): boolean {
  return SMITH_HEART_FIELD.props.some(
    (c) => c.kind === 'sh_pit_column' && Math.hypot(p.x - c.x, p.z - c.z) < 8,
  );
}

/** The old kit's plan split: `keep` draws as it did, `swap` draws painted. With `has`, a
 *  swap whose painted piece did not bake keeps the old kit's (the colossi's own kit can fail
 *  to land on its own). */
export function hammerEnvSwap(
  plan: readonly HeartKitPlacement[],
  has?: (piece: string) => boolean,
): {
  keep: HeartKitPlacement[];
  swap: HeartKitPlacement[];
} {
  const keep: HeartKitPlacement[] = [];
  const swap: HeartKitPlacement[] = [];
  let riser = 0;
  let rubble = 0;
  for (const p of plan) {
    if (KIT_DROPS.has(p.piece)) continue;
    // The pale chips stay at the Council's pillars; on the Gallery's painted flags
    // they read as litter.
    if (p.piece === 'Kit_ChipScatter' && !nearPillar(p)) continue;
    const to = KIT_SWAPS[p.piece];
    if (!to) {
      keep.push(p);
      continue;
    }
    let piece = to;
    if (to === 'Env_TierA' && ++riser % TIER_AISLE_EVERY === 0) piece = 'Env_TierB';
    if (to === 'Env_RubbleA' && ++rubble % 2) piece = 'Env_RubbleB';
    if (has && !has(piece)) {
      keep.push(p);
      continue;
    }
    swap.push({ ...p, piece });
    // The arena's floor takes a border of laid stone at its wall's foot: flat, under
    // the telegraphs' lift.
    if (to === 'Env_RimA' || to === 'Env_RimB')
      swap.push({ ...p, piece: 'Env_ArenaBorder', noShadow: true, cosmetic: true });
  }
  return { keep, swap };
}

/** A point on the terraces: `out` yards past the pit's rim at bearing `deg`. */
function terracePoint(deg: number, out: number): { x: number; z: number; rot: number } {
  const a = (deg * Math.PI) / 180;
  const x = HAMMER_PIT.x + Math.sin(a) * (HAMMER_PIT.rx + out);
  const z = HAMMER_PIT.z + Math.cos(a) * (HAMMER_PIT.rz + out);
  return { x, z, rot: Math.atan2(HAMMER_PIT.x - x, HAMMER_PIT.z - z) };
}

/** The bearings the colossi kneel at (the arena's dressing keeps off them). */
function colossusClear(x: number, z: number, r: number): boolean {
  return SMITH_HEART_FIELD.props
    .filter((p) => p.kind === 'sh_quarry_colossus')
    .every((c) => Math.hypot(x - c.x, z - c.z) > 14 + r);
}

/** How far past the rim the arcades stand (the top step's own band), at what
 *  scale, and every how many degrees. */
export const HAMMER_ENV_ARCADE_RING = { out: 27, scale: 0.92, fromDeg: 44, toDeg: 208, step: 23.5 };

/** The ruined amphitheatre round the arena (terraces nobody reaches): a ring of
 *  broken arcades on the top step, banners hung on their piers, standing and
 *  broken columns, fallen drums and rubble, fire bowls on the first step. */
export function planHammerEnvArena(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  const steps = QUARRY_TERRACES.steps;
  const R = HAMMER_ENV_ARCADE_RING;
  let i = 0;
  for (let deg = R.fromDeg; deg <= R.toDeg; deg += R.step, i++) {
    const p = terracePoint(deg, R.out);
    out.push({
      piece: 'Env_Arcade',
      x: p.x,
      y: steps[3].h,
      z: p.z,
      rot: p.rot,
      scale: R.scale,
      cosmetic: true,
    });
    if (i % 2 === 0) continue;
    // A banner on a pier, hung just proud of the arcade's front.
    const ux = Math.cos(p.rot);
    const uz = -Math.sin(p.rot);
    const across = 5 * R.scale * (i % 4 === 1 ? -1 : 1);
    const proud = 1.1;
    out.push({
      piece: i % 4 === 1 ? 'Env_BannerTall' : 'Env_BannerShort',
      x: p.x + ux * across + Math.sin(p.rot) * proud,
      y: steps[3].h + HAMMER_ENV_ARCADE.h * R.scale * 0.82,
      z: p.z + uz * across + Math.cos(p.rot) * proud,
      rot: p.rot,
      noShadow: true,
      cosmetic: true,
    });
  }
  const stand = (piece: string, stepIndex: number, deg: number, past: number, cosmetic = true) => {
    const p = terracePoint(deg, steps[stepIndex].out + past);
    if (!colossusClear(p.x, p.z, 3)) return;
    if (!authoredFieldSurfaceAt(SMITH_HEART_FIELD, p.x, p.z)?.id.startsWith('quarry_step_')) return;
    out.push({
      piece,
      x: p.x,
      y: steps[stepIndex].h,
      z: p.z,
      rot: p.rot + (heartHash(Math.round(deg), stepIndex) - 0.5) * 0.5,
      ...(cosmetic ? { cosmetic: true } : {}),
    });
  };
  // The columns step up with the seats: broken low, whole high.
  for (const deg of [50, 86, 122, 158, 192]) stand('Env_ColumnWhole', 2, deg, -5.2);
  for (const deg of [66, 104, 140, 176, 206]) stand('Env_ColumnBrokenA', 1, deg, -5.2);
  for (const deg of [76, 112, 150, 184]) stand('Env_ColumnBrokenB', 0, deg, -4.6);
  // Fallen drums and rubble where the seats broke.
  for (const deg of [58, 96, 132, 168, 200]) stand('Env_ColumnFallen', 1, deg, -4.6);
  for (const deg of [44, 72, 118, 154, 188]) stand('Env_RubbleB', 2, deg, -4.8);
  for (const deg of [54, 92, 126, 162, 196]) stand('Env_RubbleA', 0, deg, -5);
  // The masons' iron rings on the first step, the chains' old anchors.
  for (const deg of [62, 146]) stand('Env_Anchor', 0, deg, -5.2);
  return out;
}

/** The fire bowls' spots on the first step (flame and coals: hammer_env_kit.ts). */
export const HAMMER_ENV_BRAZIER_BEARINGS: readonly number[] = [46, 120, 168, 212];
/** The height of a fire bowl's coals over its foot. */
export const HAMMER_ENV_BRAZIER_TOP = 1.9;

export function planHammerEnvBraziers(): HeartKitPlacement[] {
  const step = QUARRY_TERRACES.steps[0];
  const out: HeartKitPlacement[] = [];
  for (const deg of HAMMER_ENV_BRAZIER_BEARINGS) {
    const p = terracePoint(deg, 1.8);
    if (!colossusClear(p.x, p.z, 2)) continue;
    if (authoredFieldSurfaceAt(SMITH_HEART_FIELD, p.x, p.z)?.id !== 'quarry_step_1') continue;
    out.push({ piece: 'Env_Brazier', x: p.x, y: step.h, z: p.z, rot: p.rot, noShadow: true });
    out.push({ piece: 'Env_BrazierCoals', x: p.x, y: step.h, z: p.z, rot: p.rot, noShadow: true });
  }
  return out;
}

/** Stone piers with iron rings past the Gallery's landings: past the lip, over
 *  the drop, where no body walks. */
export function planHammerEnvGallery(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  const pier = 8 + HAMMER_WALK_HALF;
  const F = SMITH_HEART_FIELD;
  for (const [i, l] of Object.values(GALLERY_LANDINGS).entries()) {
    for (let k = 0; k < 16; k++) {
      const a = heartHash(i + 3, k + 5) * Math.PI * 2;
      const r = l.r + pier - HAMMER_WALK_HALF - 4 + 1.8;
      const x = l.x + Math.sin(a) * r;
      const z = l.z + Math.cos(a) * r;
      if (authoredFieldSurfaceAt(F, x, z)) continue;
      out.push({
        piece: 'Env_Anchor',
        x,
        y: l.h - 1.2,
        z,
        rot: Math.atan2(l.x - x, l.z - z),
        noShadow: true,
        cosmetic: true,
      });
      break;
    }
  }
  return out;
}

/** Every render-only solid the rebuild adds, for the sightline pin. */
export function hammerEnvNewSolids(): HeartKitPlacement[] {
  return [...planHammerEnvArena(), ...planHammerEnvBraziers(), ...planHammerEnvGallery()];
}

/** How soft (yards) the vein's painted rock fades into its neighbours' paint. */
export const HAMMER_ENV_ROCK_EDGE = 14;
/** South of this the mountain past the Quench's line is the arena's skyline: the
 *  Singing Ice's own south wall (its floor ends at z -100) stays north of it. */
export const HAMMER_ENV_QUENCH_SOUTH = -118;

/** The vein's share of the painted rock at instance-local (x, z): the shape of
 *  `smithHeartAreaAt`, softened at its edges. Its GLSL twin is
 *  `hammerEnvWeightGlsl`, on the same numbers. */
export function hammerEnvWeight(x: number, z: number): number {
  const e = HAMMER_ENV_ROCK_EDGE;
  const ss = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const ring = ss(RING.outerR + 6, RING.outerR + 6 + e, Math.hypot(x, z));
  const room = ss(
    HEART_ROOM_AREA_R,
    HEART_ROOM_AREA_R + e,
    Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z),
  );
  const breath = 1 - ss(80 - e, 80, z) * (1 - ss(90, 90 + e, x));
  // Past the Quench's line only where the rock faces it: south of here it is the
  // arena's skyline (`hammerEnvOwnsRock`).
  const quench =
    1 - ss(80 - e, 80, x) * ss(HAMMER_ENV_QUENCH_SOUTH - e, HAMMER_ENV_QUENCH_SOUTH, z);
  const heat = 1 - (1 - ss(-76, -76 + e, x)) * ss(-80 - e, -80, z);
  return ring * room * breath * quench * heat;
}

/** The GLSL twin of `hammerEnvWeight`: `float hammerEnvWeight(vec2 p)`. */
/** The far skyline's fall (only the neighbours' rock behind the vein, heart_rock_cutaway.ts): a
 *  face keeps its full light up to `near` yards from the camera and falls to `dark` by `far`, so
 *  the mountains behind read as further away. The vein's own rock keeps its full paint. */
export const HAMMER_ENV_DEPTH = {
  near: 26,
  far: 160,
  dark: [0.36, 0.37, 0.43] as const,
} as const;

/** The light left on a face `d` yards from the camera, per channel (`hammerEnvDepthGlsl`). */
export function hammerEnvDepth(d: number): [number, number, number] {
  const D = HAMMER_ENV_DEPTH;
  const t = Math.min(1, Math.max(0, (d - D.near) / (D.far - D.near)));
  const k = t * t * (3 - 2 * t);
  return [0, 1, 2].map((i) => 1 + (D.dark[i] - 1) * k) as [number, number, number];
}

export function hammerEnvDepthGlsl(): string {
  const D = HAMMER_ENV_DEPTH;
  return `vec3 hammerEnvDepth( float d ) {
    float k = smoothstep( ${D.near.toFixed(1)}, ${D.far.toFixed(1)}, d );
    return mix( vec3( 1.0 ), vec3( ${D.dark.map((v) => v.toFixed(3)).join(', ')} ), k );
  }`;
}

export function hammerEnvWeightGlsl(): string {
  const e = HAMMER_ENV_ROCK_EDGE.toFixed(1);
  const n = (v: number) => v.toFixed(1);
  return `float hammerEnvWeight( vec2 p ) {
    float ring = smoothstep( ${n(RING.outerR + 6)}, ${n(RING.outerR + 6)} + ${e}, length( p ) );
    float room = smoothstep( ${n(HEART_ROOM_AREA_R)}, ${n(HEART_ROOM_AREA_R)} + ${e}, length( p - vec2( ${n(HEART_ROOM.x)}, ${n(HEART_ROOM.z)} ) ) );
    float breath = 1.0 - smoothstep( 80.0 - ${e}, 80.0, p.y ) * ( 1.0 - smoothstep( 90.0, 90.0 + ${e}, p.x ) );
    float quench = 1.0 - smoothstep( 80.0 - ${e}, 80.0, p.x ) * smoothstep( ${n(HAMMER_ENV_QUENCH_SOUTH)} - ${e}, ${n(HAMMER_ENV_QUENCH_SOUTH)}, p.y );
    float heat = 1.0 - ( 1.0 - smoothstep( -76.0, -76.0 + ${e}, p.x ) ) * smoothstep( -80.0 - ${e}, -80.0, p.y );
    return ring * room * breath * quench * heat;
  }`;
}

/** The walks' lines, for laying their flags along the way they run: each path's own
 *  polyline, in yards along the walk (slope included, so a ramp's flags never stretch). */
interface HammerEnvLine {
  points: readonly (readonly [number, number, number])[];
  /** Cumulative length at each point. */
  at: number[];
}
let lines: Map<string, HammerEnvLine> | null = null;

function envLines(): Map<string, HammerEnvLine> {
  if (lines) return lines;
  lines = new Map();
  for (const s of SMITH_HEART_FIELD.surfaces) {
    if (s.kind !== 'path') continue;
    const at = [0];
    for (let i = 1; i < s.points.length; i++) {
      const [ax, az, ah] = s.points[i - 1];
      const [bx, bz, bh] = s.points[i];
      at.push(at[i - 1] + Math.hypot(bx - ax, bz - az, bh - ah));
    }
    lines.set(s.id, { points: s.points, at });
  }
  return lines;
}

/** A landing or the Cleft takes the heading of the walk that reaches it. */
const HAMMER_ENV_LANDING_HEADINGS: Readonly<Record<string, readonly [string, number]>> = {
  cleft: ['gallery_upper', 0],
  gallery_h1: ['gallery_upper', 2],
  gallery_h2: ['gallery_middle', 2],
  gallery_h3: ['gallery_lower', 2],
};

/** The walks whose flags run along them. */
const HAMMER_ENV_ALONG: ReadonlySet<string> = new Set([
  'gallery_upper',
  'gallery_middle',
  'gallery_lower',
  'balcony_stair_east',
  'balcony_stair_west',
]);

/** A walk's texture coordinates in yards: u along the way it runs, v across it, so
 *  the painted courses run down the walk as the style guide's do. Null elsewhere. */
export function hammerEnvPathUv(
  id: string,
  x: number,
  z: number,
): readonly [number, number] | null {
  const landing = HAMMER_ENV_LANDING_HEADINGS[id];
  if (landing) {
    const line = envLines().get(landing[0]);
    if (!line) return null;
    const a = line.points[landing[1]];
    const b = line.points[landing[1] + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    return [x * ux + z * uz, -x * uz + z * ux];
  }
  if (id === 'balcony') return [z, x];
  if (!HAMMER_ENV_ALONG.has(id)) return null;
  const line = envLines().get(id);
  if (!line) return null;
  let best = Number.POSITIVE_INFINITY;
  let u = 0;
  let v = 0;
  for (let i = 1; i < line.points.length; i++) {
    const a = line.points[i - 1];
    const b = line.points[i];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len2));
    const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
    if (d < best) {
      best = d;
      u = line.at[i - 1] + (line.at[i] - line.at[i - 1]) * t;
      const len = Math.sqrt(len2);
      v = ((x - a[0]) * -dz + (z - a[1]) * dx) / len;
    }
  }
  return [u, v];
}

/** The floors the vein's stair treads draw in place of (`planHammerEnvStairs`). */
export const HAMMER_ENV_STAIRS: ReadonlySet<string> = new Set(['pit_descent', 'slab_stair']);

/** A tread's rise (yards), and its piece's measures at scale 1: its run, its width. */
export const HAMMER_ENV_TREAD = { rise: 0.42, run: 1.3, width: 14 } as const;
const HAMMER_ENV_FLAT_TREAD_SINK = 0.12;

/** The ramps the raid walks, drawn tread by tread: each tread's top on the walked ramp
 *  at its middle (the sim's own height), so a foot is never more than half a rise off
 *  the step it stands on. A flat run is one long tread. */
export function planHammerEnvStairs(): HeartKitPlacement[] {
  const out: HeartKitPlacement[] = [];
  const T = HAMMER_ENV_TREAD;
  for (const s of SMITH_HEART_FIELD.surfaces) {
    if (s.kind !== 'path' || !HAMMER_ENV_STAIRS.has(s.id)) continue;
    const width = (s.halfWidth ?? 7) * 2;
    for (let i = 1; i < s.points.length; i++) {
      const [ax, az, ah] = s.points[i - 1];
      const [bx, bz, bh] = s.points[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const drop = Math.abs(bh - ah);
      const steps = drop < 0.01 ? 1 : Math.max(1, Math.round(drop / T.rise));
      const run = len / steps;
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      // Local +Z runs toward the low end, so a tread's nose faces down the stair.
      const rot = bh <= ah ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz);
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps;
        const scale = run / T.run;
        out.push({
          piece: 'Env_StairTread',
          x: ax + (bx - ax) * t,
          // A flat run's one long slab lands in the floor it meets: only what is past
          // that floor's lip shows, so it never lies over the floor as a sliver.
          y: ah + (bh - ah) * t - (drop < 0.01 ? HAMMER_ENV_FLAT_TREAD_SINK : 0),
          z: az + (bz - az) * t,
          rot,
          scale,
          stretch: width / T.width / scale,
          rise: 1 / scale,
          noShadow: true,
        });
      }
    }
  }
  return out;
}

/** The layer of stone under the walks' lips: dressed courses stepping out under the
 *  brink, so a walk reads as laid stone with a thickness, never a sheet on a cliff.
 *  Past the lip and under the walk's height: nothing a body stands on or walks into. */
export function planHammerEnvWalkLayer(): HeartKitPlacement[] {
  const SURFACES = new Set([
    'cleft',
    'gallery_upper',
    'gallery_h1',
    'gallery_middle',
    'gallery_h2',
    'gallery_lower',
    'gallery_h3',
    'hammer_pit',
    'pit_descent',
    'slab_stair',
  ]);
  const F = SMITH_HEART_FIELD;
  const out: HeartKitPlacement[] = [];
  const edges = planFieldEdgePieces(F, {
    segment: HAMMER_WALK_HALF * 2,
    minDrop: 1.5,
    kindFor(run) {
      if (!SURFACES.has(run.surface)) return null;
      return { piece: 'Env_WalkLayer', inset: 0, halfLength: HAMMER_WALK_HALF, halfDepth: 0.6 };
    },
  });
  for (const e of edges) {
    if (e.stretch < 0.35 || e.stretch > 1.6) continue;
    out.push({
      piece: e.piece,
      x: e.x,
      y: e.y,
      z: e.z,
      rot: e.rot,
      stretch: e.stretch,
      shear: e.shear,
      noShadow: true,
      cosmetic: true,
    });
  }
  return out;
}

/** The height a tread's plan is held to (for the pin). */
export function hammerEnvWalkedHeight(x: number, z: number): number {
  return authoredFieldHeight(SMITH_HEART_FIELD, x, z);
}
