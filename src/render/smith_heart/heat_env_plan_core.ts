// Pure plan of the Heat vein's painted rebuild (design doc section 5.25): the Hearth, from
// the casting floor to the Hearth's mouth, redone in the painted style the Hammer's rebuild
// set and the Breath and the Quench followed, from the owner's arena concept (a great hall
// of sooted columnar basalt over a chasm under a smoky dusk), its element kept: dark
// basalt, the first flame's white-gold crystal, and molten rock as an accent only (the
// owner's call of 2026-11-10: "a mix with molten but don't overdo it"), from ChatGPT
// paintings and turnaround sheets built by Tripo P2. The environment sits darker than the
// fiery guardian, so it stands out against it.
//
// What stands in for what:
//   - the mountain's bands that face a Heat walk: basalt cliff stacks and bluffs, each on
//     the old piece's own spot and foot, as tall and as deep, never wider than its old front
//     past the clearance (`fitHeatEnvRock`, the Hammer's own fit); a band is the Heat's only
//     when the surface it faces is a Heat walk and the Heat's basalt holds where it stands
//     (`heatEnvOwnsRock`: by the faced surface's id, never by area, the Quench's blocking
//     finding); one of them, at the chasm's north head, is the molten fall instead
//     (`heatEnvFallHost`: in its host's own volume, out of the guardian's backdrop);
//   - the old kit's props on their own spots and inside their old boxes: the Hearth's
//     mouth, the altar-stone, the crystal, the ember boulders, the hall's column bundles
//     and the low walls over the chasm (`heatEnvSwap`);
//   - the flat ash drifts give way to the painted floor's own ash;
//   - and the arena concept's ring of basalt stacks round the hall on the mountain past its
//     walls (`planHeatEnvRing`), in the sightline plan.
// What it never touches: the fight (the wellspring the guardian stands sunk in, its pool and
// lip, and every footprint are smith_heart_fx/heat_*'s), the pour's channel and spill (the
// set piece's own), the anvil bridge's arch, the seams of fire on the floor (the molten
// accents the old kit lays), the walks and every lip a body can fall from (the lips keep the
// rock kit's sculpts and only take the painting on, heart_rock_cutaway.ts).
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import { HEAT, POUR_CHANNEL, SMITH_HEART_FIELD } from '../../sim/content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import { breathEnvOwnsRock } from './breath_env_plan_core';
import { type EnvRockPaint, type EnvRockTile, envRockPaintGlsl } from './env_rock_paint_core';
import {
  fitEnvRockAs,
  type HammerEnvRockPiece,
  hammerEnvFrontClear,
  hammerEnvOwnsRock,
} from './hammer_env_plan_core';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartMountainHeight } from './heart_mountain_core';
import { HEAT_BRIDGE_CHASM, heartHash } from './heart_plan_core';
import { planHeartGulfWalls } from './heart_rock_gulf_core';
import { planHeartRockUnder } from './heart_rock_hang_core';
import { heartRockPieceOf, planHeartRock } from './heart_rock_plan_core';
import { HEART_WALL_CLEAR, heartFloorClearance, heartOpenAir } from './heart_walls_core';
import { HEAT_WALK_SURFACES } from './heat_kit_plan_core';
import { HEAT_SOOT, heatSootWeight } from './heat_soot_core';
import { quenchEnvOwnsRock } from './quench_env_plan_core';

/** A basalt piece's measures in the shipped kit (yards at scale 1): foot on y 0, front
 *  plane on z 0, centred on x, the body behind. Pinned against the GLB. */
export const HEAT_ENV_ROCK: Readonly<Record<string, HammerEnvRockPiece>> = {
  Env_BasaltTall: { w: 40, h: 72.9, d: 35.6 },
  Env_BasaltWide: { w: 64, h: 26, d: 45.5 },
  Env_SeamTall: { w: 36, h: 70.9, d: 34.5 },
  Env_SeamWide: { w: 64, h: 32.2, d: 46.1 },
  Env_GreatFall: { w: 66.7, h: 100, d: 48.8 },
  Env_CliffWall: { w: 120, h: 68.3, d: 57.7 },
  Env_MoltenShore: { w: 60, h: 17.1, d: 31.4 },
};

/** The guardian's own backdrop: within `westCone` degrees of due west of the Forge's
 *  middle (the Hearth's mouth behind him). Its rock stays plain dark basalt and no fall
 *  pours there, so the red-orange guardian pops on it (the owner's note of 2026-11-10). */
export const HEAT_ENV_BACKDROP = { westCone: 30 } as const;

/** Does (x, z) stand in the guardian's backdrop? */
export function inHeatGuardianBackdrop(x: number, z: number): boolean {
  const west = (Math.atan2(x - HEAT.forge.x, z - HEAT.forge.z) * 180) / Math.PI + 90;
  return Math.abs(west) < HEAT_ENV_BACKDROP.westCone;
}

/** The seamed basalt's plain twin (the guardian's backdrop keeps the plain). */
const PLAIN_OF: Readonly<Record<string, string>> = {
  Env_SeamTall: 'Env_BasaltTall',
  Env_SeamWide: 'Env_BasaltWide',
};

/** The crystal's height at scale 1 (yards, its foot on y 0, centred): pinned against the
 *  GLB. The other props stand on their old pieces' frames at the old scale. */
export const HEAT_ENV_CRYSTAL_HEIGHT = 6.8;

/** The old kit's crystals' heights at scale 1 (yards, read off the old kit's GLB): the
 *  painted crystal stands as tall as the one it replaces. */
export const HEAT_OLD_CRYSTALS: Readonly<Record<string, number>> = {
  Kit_FireCrystalA: 6.78,
  Kit_FireCrystalB: 4.7,
};

/** The old rock pieces and what stands in each one's place: a wall as a tall stack or a
 *  bluff, a great mass as a bluff, a prow as a tall stack; most of them seamed with molten
 *  (the dressed concept of 2026-11-10), a few plain between. */
const ROCK_SWAPS: Readonly<Record<string, readonly string[]>> = {
  Kit_RockWallA: ['Env_SeamTall', 'Env_BasaltTall', 'Env_SeamWide'],
  Kit_RockWallB: ['Env_SeamWide', 'Env_SeamTall', 'Env_BasaltWide'],
  Kit_RockWallC: ['Env_SeamTall', 'Env_SeamTall', 'Env_BasaltTall'],
  Kit_RockMassA: ['Env_SeamWide', 'Env_BasaltWide'],
  Kit_RockMassB: ['Env_SeamWide', 'Env_SeamTall', 'Env_BasaltWide'],
  Kit_RockProw: ['Env_SeamTall', 'Env_BasaltTall'],
};

/** The least of the Heat's basalt (heat_soot_core.ts) a band must stand in to be the
 *  Heat's: a band facing a Heat walk from outside the vein (the Ring's side) keeps the rock
 *  kit, which takes the painting through the rock's material. */
export const HEAT_ENV_MIN_WEIGHT = 0.5;

/** The Heat walk a rock placement faces (on past the clearance's own margin, onto the
 *  walk), or null when it faces none. */
function facedHeatWalk(p: { x: number; z: number }): string | null {
  const c = heartFloorClearance(p.x, p.z);
  if (!Number.isFinite(c.d)) return null;
  const reach = c.d + 4;
  const id = authoredFieldSurfaceAt(
    SMITH_HEART_FIELD,
    p.x + c.toX * reach,
    p.z + c.toZ * reach,
  )?.id;
  return id !== undefined && HEAT_WALK_SURFACES.has(id) ? id : null;
}

/** Does this rock placement belong to the Heat? Only a band whose faced surface is a Heat
 *  walk (by its id: the Quench's rule asked the faced point's area and took the Hammer's
 *  skyline where a surface crossed an area line, the review's blocking finding) and that
 *  stands where the Heat's basalt holds; never what another painted rebuild already takes. */
export function heatEnvOwnsRock(p: { x: number; z: number }): boolean {
  if (hammerEnvOwnsRock(p) || breathEnvOwnsRock(p) || quenchEnvOwnsRock(p)) return false;
  if (heatSootWeight(p.x, p.z) < HEAT_ENV_MIN_WEIGHT) return false;
  return facedHeatWalk(p) !== null;
}

/** Is this old rock piece one the Heat stands basalt in for (a band: never a crest needle,
 *  a lip or a hung face, which keep their sculpts)? */
export function heatEnvTakesRockPiece(piece: string): boolean {
  return ROCK_SWAPS[piece.endsWith('Far') ? piece.slice(0, -3) : piece] !== undefined;
}

/** Pick the piece standing in for an old rock placement (a far build for a far one): the
 *  molten fall for its host, basalt for the rest (plain in the guardian's backdrop). */
export function heatEnvRockPiece(old: HeartKitPlacement): string {
  const far = old.piece.endsWith('Far');
  if (isHeatEnvFallHost(old)) return far ? 'Env_MoltenFallFar' : 'Env_MoltenFall';
  const base = far ? old.piece.slice(0, -3) : old.piece;
  const options = ROCK_SWAPS[base];
  if (!options) throw new Error(`no basalt for ${old.piece}`);
  const h = heartHash(Math.round(old.x * 3) + 71, Math.round(old.z * 3));
  const drawn = options[Math.floor(h * options.length) % options.length];
  const pick = inHeatGuardianBackdrop(old.x, old.z) ? (PLAIN_OF[drawn] ?? drawn) : drawn;
  return far ? `${pick}Far` : pick;
}

/** A piece's measures (a far build shares its near build's). */
export function heatEnvRockMeasure(piece: string): HammerEnvRockPiece {
  const base = piece.endsWith('Far') ? piece.slice(0, -3) : piece;
  const m = base === 'Env_MoltenFall' ? HEAT_ENV_FALL_PIECE : HEAT_ENV_ROCK[base];
  if (!m) throw new Error(`no measures for ${piece}`);
  return m;
}

/** An old mountain piece as its basalt stand-in: the Hammer's fit (the same spot and foot,
 *  as tall and as deep, narrowed until its whole front is clear of every walk). */
export function fitHeatEnvRock(old: HeartKitPlacement): HeartKitPlacement {
  const piece = heatEnvRockPiece(old);
  return fitEnvRockAs(old, piece, heatEnvRockMeasure(piece));
}

/** The old Heat kit's pieces this rebuild stands in for. */
const KIT_SWAPS: Readonly<Record<string, string>> = {
  Kit_HearthMouth: 'Env_HearthMouth',
  Kit_AltarStone: 'Env_AltarStone',
  Kit_EmberBoulder: 'Env_EmberBoulder',
  Kit_FireCrystalA: 'Env_FireCrystal',
  Kit_FireCrystalB: 'Env_FireCrystal',
  Kit_HearthPillar: 'Env_ColumnBundle',
  Kit_HeatWallA: 'Env_HeatWallA',
  Kit_HeatWallB: 'Env_HeatWallB',
};

/** The old kit's pieces with nothing in their place: the painted floor carries its own ash
 *  in its joints. */
export const HEAT_ENV_DROPS: ReadonlySet<string> = new Set(['Kit_AshDriftA', 'Kit_AshDriftB']);

/** The old kit's pieces the rebuild never touches: the fight's wellspring, the pour's
 *  channel and spill, the bridge's arch, and the seams of fire (the molten accents). */
export const HEAT_ENV_KEEPS: ReadonlySet<string> = new Set([
  'Kit_Wellspring',
  'Kit_PourChannel',
  'Kit_PourSpill',
  'Kit_HeatBridge',
  'Kit_FireCrackA',
  'Kit_FireCrackB',
]);

/** A swapped placement's scale: the crystal as tall as the old one; the rest keep the old
 *  frame's own size (their painted pieces were built on it). */
function swapScale(p: HeartKitPlacement, to: string): number {
  const k = p.scale ?? 1;
  if (to === 'Env_FireCrystal')
    return (k * (HEAT_OLD_CRYSTALS[p.piece] ?? HEAT_ENV_CRYSTAL_HEIGHT)) / HEAT_ENV_CRYSTAL_HEIGHT;
  return k;
}

/** The old kit's plan split: `keep` draws as it did, `swap` draws painted. With `has`, a
 *  swap whose painted piece did not bake keeps the old kit's. */
export function heatEnvSwap(
  plan: readonly HeartKitPlacement[],
  has?: (piece: string) => boolean,
): { keep: HeartKitPlacement[]; swap: HeartKitPlacement[] } {
  const keep: HeartKitPlacement[] = [];
  const swap: HeartKitPlacement[] = [];
  for (const p of plan) {
    if (HEAT_ENV_DROPS.has(p.piece)) continue;
    const to = KIT_SWAPS[p.piece];
    if (!to || (has && !has(to))) {
      keep.push(p);
      continue;
    }
    swap.push({ ...p, piece: to, scale: swapScale(p, to) });
  }
  return { keep, swap };
}

// ---- the arena concept's new pieces ----------------------------------------------------

/** The molten fall's piece (yards at scale 1): a cliff of basalt `h` tall with its fall
 *  down its front, `w` across and `d` deep, its foot on y 0 and its front plane on z 0. */
export const HEAT_ENV_FALL_PIECE: HammerEnvRockPiece = { w: 31.3, h: 60, d: 29.6 };

/** The molten fall's host: one band of the mountain at the chasm's north head, the arena
 *  concept's far fall swapped in place for it (inside its host's own volume, so no new
 *  solid in a sightline). The band nearest `bearing` (degrees from north round the chasm
 *  the anvil bridge crosses, `HEAT_BRIDGE_CHASM`) of those the Heat owns that stand on the
 *  first band (`maxBack` past the floor), crest at least `crest` over it and stand at least
 *  `spill` from the pour's fall off the casting floor: seen from the bridge, out of the red
 *  guardian's backdrop. The dressed concept's further falls stand on the tiers
 *  (`HEAT_ENV_TIERS`). */
export const HEAT_ENV_FALL = { bearing: 10, maxBack: 18, crest: 60, spill: 60 } as const;

/** The mountain's bands the rock painter draws (heart_rock.ts buildHeartRock). */
function heartRockBands(): HeartKitPlacement[] {
  return [...planHeartRock(), ...planHeartRockUnder(), ...planHeartGulfWalls()];
}

let fallHost: { x: number; z: number } | null | undefined;

/** The molten fall's host band's spot (null if no band qualifies). */
export function heatEnvFallHost(): { x: number; z: number } | null {
  if (fallHost !== undefined) return fallHost;
  const F = HEAT_ENV_FALL;
  const C = HEAT_BRIDGE_CHASM;
  let best: { x: number; z: number; off: number } | null = null;
  for (const p of heartRockBands()) {
    if (!heatEnvTakesRockPiece(p.piece) || !heatEnvOwnsRock(p)) continue;
    const c = heartFloorClearance(p.x, p.z);
    if (!Number.isFinite(c.d) || c.d > F.maxBack) continue;
    const m = heartRockPieceOf(p.piece);
    const crest = p.y + m.height * (p.scale ?? 1) * (p.rise ?? 1);
    if (crest < c.floor + F.crest) continue;
    if (Math.hypot(p.x - POUR_CHANNEL.x, p.z - POUR_CHANNEL.z0) < F.spill) continue;
    const bearing = (Math.atan2(p.x - C.x, p.z - C.z) * 180) / Math.PI;
    let off = Math.abs(bearing - F.bearing) % 360;
    if (off > 180) off = 360 - off;
    if (best && off >= best.off) continue;
    best = { x: p.x, z: p.z, off };
  }
  fallHost = best ? { x: best.x, z: best.z } : null;
  return fallHost;
}

/** Is this band the molten fall's host? */
export function isHeatEnvFallHost(p: { x: number; z: number }): boolean {
  const h = heatEnvFallHost();
  return h !== null && Math.abs(p.x - h.x) < 1e-6 && Math.abs(p.z - h.z) < 1e-6;
}

/** Does a piece of measures `m` at (x, z) facing `rot` with `scale` stand wholly on the
 *  mountain: no walk under it, never the open air, its front clear of every walk? */
function onRock(x: number, z: number, rot: number, m: HammerEnvRockPiece, scale: number): boolean {
  const half = (m.w * scale) / 2;
  const depth = m.d * scale;
  if (!hammerEnvFrontClear(x, z, rot, half)) return false;
  const ux = Math.cos(rot);
  const uz = -Math.sin(rot);
  const bx = -Math.sin(rot);
  const bz = -Math.cos(rot);
  for (const [s, b] of [
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
    [0, 0.5],
    [0, 1],
  ]) {
    const px = x + ux * half * s + bx * depth * b;
    const pz = z + uz * half * s + bz * depth * b;
    if (heartOpenAir(px, pz, 0) || heartFloorClearance(px, pz).d < HEART_WALL_CLEAR) return false;
  }
  return true;
}

/** The rings' common frame: their middle (the Forge's), the way in left open (never
 *  within `eastDeg` of due east: the casting floor, the bridge, the molten fall at the
 *  chasm's north head), the plain basalt the guardian's backdrop keeps (`piece`) and the
 *  seamed basalt everywhere else (`seamed`). */
export const HEAT_ENV_RING = {
  piece: 'Env_BasaltTall',
  seamed: 'Env_SeamTall',
  x: HEAT.forge.x,
  z: HEAT.forge.z,
  eastDeg: 55,
} as const;

/** One tier of stacks round the hall: one every `step` degrees from `offset` at `r`,
 *  facing the hall, its foot at `foot`, `scale` its nominal scale (jittered,
 *  `HEAT_ENV_TIER_JITTER`, and stepped down where its footprint would leave the rock, never
 *  under `minScale`), the plain piece (`piece`) or the seamed one (`seamed`); only within
 *  `sector` (bearings from north round the Forge's middle, degrees) when given, and never
 *  in the guardian's backdrop when `shunBackdrop`. */
export interface HeatTier {
  r: number;
  step: number;
  offset: number;
  piece: string;
  seamed: string;
  foot: number;
  scale: number;
  minScale: number;
  sector?: readonly [number, number];
  shunBackdrop?: boolean;
}

/** The tiers round the hall (the dressed concept of 2026-11-10: the hall an island over
 *  its magma lake): a few pillars standing in the lake (never a ring of them: the
 *  concept's pieces stand behind), the molten shore just past the hall's rim, the plain cliffs behind the guardian, the crown, and the far crown going into
 *  the haze behind it, both low enough that the sky shows over them. Render only, in the sightline plan, drawn only from the
 *  Heat (env_area_clip.ts). */
export const HEAT_ENV_TIERS: readonly HeatTier[] = [
  {
    r: 72,
    step: 34,
    offset: 10,
    piece: 'Env_BasaltTall',
    seamed: 'Env_SeamTall',
    foot: -9,
    scale: 0.6,
    minScale: 0.35,
  },
  {
    r: 63,
    step: 15,
    offset: 4,
    piece: 'Env_MoltenShore',
    seamed: 'Env_MoltenShore',
    foot: -6,
    scale: 1.05,
    minScale: 0.5,
    shunBackdrop: true,
  },
  {
    r: 100,
    step: 11,
    offset: 0,
    piece: 'Env_BasaltTall',
    seamed: 'Env_BasaltTall',
    foot: -9,
    scale: 1.0,
    minScale: 0.6,
    sector: [-122, -58],
  },
  {
    r: 130,
    step: 10,
    offset: 5,
    piece: 'Env_BasaltTall',
    seamed: 'Env_SeamTall',
    foot: -4,
    scale: 0.95,
    minScale: 0.6,
  },
  {
    r: 168,
    step: 7,
    offset: 3,
    piece: 'Env_BasaltTall',
    seamed: 'Env_SeamTall',
    foot: -4,
    scale: 0.8,
    minScale: 0.5,
  },
];

/** The tiers' hand: each stack's bearing off its grid (degrees), its scale (a share either
 *  way) and its turn off square to the hall (radians), and the share of the seamed stacks
 *  left plain, so no tier reads as a ring. */
export const HEAT_ENV_TIER_JITTER = { deg: 3.5, scale: 0.12, rot: 0.22, plain: 0.25 } as const;

/** One tier's placements. */
function planTier(T: HeatTier, ti: number): HeartKitPlacement[] {
  const R = HEAT_ENV_RING;
  const J = HEAT_ENV_TIER_JITTER;
  const out: HeartKitPlacement[] = [];
  let i = 0;
  for (let deg = -180 + T.offset; deg < 180; deg += T.step, i++) {
    // East of the Forge (bearings round +90) is the way in.
    if (Math.abs(deg - 90) < R.eastDeg) continue;
    if (T.sector && (deg < T.sector[0] || deg > T.sector[1])) continue;
    const h = (k: number) => heartHash(ti * 131 + i, k + 4400) * 2 - 1;
    // The hand never carries a stack into the way in.
    let jd = deg + h(1) * J.deg;
    if (Math.abs(jd - 90) < R.eastDeg) jd = 90 + Math.sign(deg - 90) * R.eastDeg;
    const at = (jd * Math.PI) / 180;
    const x = R.x + Math.sin(at) * T.r;
    const z = R.z + Math.cos(at) * T.r;
    if (T.shunBackdrop && inHeatGuardianBackdrop(x, z)) continue;
    // Its face (local +Z) to the hall, turned a little off square.
    const rot = Math.atan2(R.x - x, R.z - z) + h(2) * J.rot;
    const plain = inHeatGuardianBackdrop(x, z) || h(3) * 0.5 + 0.5 < J.plain;
    const piece = plain ? T.piece : T.seamed;
    const m = heatEnvRockMeasure(piece);
    let scale = T.scale * (1 + h(4) * J.scale);
    while (scale >= T.minScale && !onRock(x, z, rot, m, scale)) scale *= 0.85;
    if (scale < T.minScale) continue;
    out.push({ piece, x, y: T.foot, z, rot, scale, noShadow: true });
  }
  return out;
}

/** The concept's own backdrop round the hall (its pieces built from the dressed concept:
 *  the great fall cliff, the tiered cliff wall with its thin falls): each at `bearing`
 *  (degrees from north round the Forge's middle) `r` out, facing the hall, `scale`, its
 *  foot at `foot`. From the way in the great fall stands on the left as the concept
 *  paints it, a second frames the right, the walls fill the arcs between; nothing seamed
 *  in the guardian's backdrop. */
export interface HeatBackdropPiece {
  piece: string;
  bearing: number;
  r: number;
  scale: number;
  foot: number;
}

export const HEAT_ENV_CONCEPT_PIECES: readonly HeatBackdropPiece[] = [
  { piece: 'Env_GreatFall', bearing: -30, r: 90, scale: 1.3, foot: -9 },
  { piece: 'Env_GreatFall', bearing: -150, r: 92, scale: 1.15, foot: -9 },
  { piece: 'Env_CliffWall', bearing: 12, r: 92, scale: 1.25, foot: -9 },
  { piece: 'Env_CliffWall', bearing: -8, r: 112, scale: 1.1, foot: -9 },
  { piece: 'Env_CliffWall', bearing: -176, r: 94, scale: 1.25, foot: -9 },
  { piece: 'Env_CliffWall', bearing: 154, r: 92, scale: 1.2, foot: -9 },
];

/** The backdrop's placements. */
function planBackdrop(): HeartKitPlacement[] {
  const R = HEAT_ENV_RING;
  const out: HeartKitPlacement[] = [];
  for (const b of HEAT_ENV_CONCEPT_PIECES) {
    const at = (b.bearing * Math.PI) / 180;
    const x = R.x + Math.sin(at) * b.r;
    const z = R.z + Math.cos(at) * b.r;
    const rot = Math.atan2(R.x - x, R.z - z);
    const m = heatEnvRockMeasure(b.piece);
    let scale = b.scale;
    while (scale >= b.scale * 0.5 && !onRock(x, z, rot, m, scale)) scale *= 0.9;
    if (scale < b.scale * 0.5) continue;
    out.push({ piece: b.piece, x, y: b.foot, z, rot, scale, noShadow: true });
  }
  return out;
}

/** The rock opened round the hall, seen from the Heat (the dressed concept of 2026-11-10):
 *  the old mountain's mass, the rock kit and every vein's painted rock between the hall
 *  (`r0` yards from the Forge's middle) and past the outer ring's tiers as they step back
 *  (`r1`; no walk lies anywhere between the two, so nothing is left floating), above `y0`
 *  over the floor and never within `eastDeg` of due east (the way in, where the rings stand back),
 *  each edge eased over `edge` yards (any softer stipples whatever straddles it).
 *  Fragments there dissolve (the rock's own camera dither) as the camera comes into the
 *  Heat's light (`setHeartRockHeatOpen`), so the two rings of basalt stand free against the
 *  sky as the concept paints them; from anywhere else the mountain stands whole and the
 *  rings, drawn only from the Heat, are not there. Everything under `y0` stays, a breath
 *  over the magma lake (heat_env_set_core.ts `HEAT_ENV_LAKE`) that closes the cut. */
export const HEAT_ENV_OPEN = {
  r0: 54,
  r1: 150,
  y0: -4,
  eastDeg: 52,
  edge: 1,
  /** Round the hall's far side (bearings `far[0]` to `far[1]`, from the south-south-west
   *  round the west to the north) no walk lies for hundreds of yards: open out to `farR`
   *  there, so over the tiers there is only the sky, as the concept paints it. */
  far: [-145, 15],
  farR: 400,
} as const;

/** The open region's GLSL: `float heatEnvOpen( vec3 p )` (p slot space, yards): 1 inside,
 *  0 outside, eased at each edge. */
export function heatEnvOpenGlsl(): string {
  const O = HEAT_ENV_OPEN;
  return `float heatEnvOpen( vec3 p ) {
    vec2 hoD = p.xz - vec2( ${g(HEAT.forge.x)}, ${g(HEAT.forge.z)} );
    float hoR = length( hoD );
    float hoBearing = degrees( atan( hoD.x, hoD.y ) );
    float hoB = abs( hoBearing - 90.0 );
    hoB = min( hoB, 360.0 - hoB );
    float hoR1 = hoBearing > ${g(O.far[0])} && hoBearing < ${g(O.far[1])} ? ${g(O.farR)} : ${g(O.r1)};
    return smoothstep( ${g(O.r0)}, ${g(O.r0 + O.edge)}, hoR )
      * ( 1.0 - smoothstep( hoR1 - ${g(O.edge)}, hoR1, hoR ) )
      * smoothstep( ${g(HEAT.floor.h + O.y0)}, ${g(HEAT.floor.h + O.y0 + O.edge)}, p.y )
      * smoothstep( ${g(O.eastDeg)}, ${g(O.eastDeg + O.edge * 0.5)}, hoB );
  }`;
}

/** Every tier's placements and the backdrop's (render only, in the sightline plan). */
export function planHeatEnvRing(): HeartKitPlacement[] {
  return [...HEAT_ENV_TIERS.flatMap((t, i) => planTier(t, i)), ...planBackdrop()];
}

/** Every molten fall standing round the hall, as placed: the great falls of the backdrop
 *  and the one at the chasm's north head (its band, fitted). */
export function heatEnvFallPlacements(): HeartKitPlacement[] {
  const falls = planHeatEnvRing().filter((p) => p.piece === 'Env_GreatFall');
  const host = heartRockBands().find(
    (p) => heatEnvTakesRockPiece(p.piece) && heatEnvOwnsRock(p) && isHeatEnvFallHost(p),
  );
  return host ? [...falls, fitHeatEnvRock(host)] : falls;
}

// ---- the painted rock on what the kit does not cover ---------------------------------

/** Yards one repeat of each scale of the painted rock covers (the heightfield, the field's
 *  cliff faces and the rock kit's lips all read the basalt cliff painting so). */
export const HEAT_ENV_ROCK_TILE: EnvRockTile = { a: 17, b: 43, steer: 79 };

/** How the painted rock takes the basalt cliff painting over a surface's own paint
 *  (env_rock_paint_core.ts): most of the painting's charcoal and slate, a calm share of its
 *  column strokes, the surface's own value brought down (the hall's rock a dark mass the
 *  fiery guardian stands out against), the faces turned down a warm umber, and ash on the
 *  ledges. `mean` is the graded painting's mean linear luminance. */
export const HEAT_ENV_ROCK_PAINT: EnvRockPaint = {
  hue: 0.6,
  strokes: 0.34,
  value: 0.62,
  mean: 0.043,
  scour: [1.03, 1.02, 1.01],
  down: [0.84, 0.78, 0.76],
  ledge: { color: [0.34, 0.33, 0.32], share: 0.28 },
};

/** The base the heightfield and the field's cliff faces hand the painted rock (linear): a
 *  plain dark slate, so they wear the painting's own value and sit with the basalt
 *  stacks (a mid slate read as pale grey slabs between them). */
export const HEAT_ENV_FIELD_BASE = [0.06, 0.057, 0.057] as const;

/** The painted rock's GLSL, `vec3 heatEnvRock( sampler2D paint, vec3 p, vec3 n, vec3 dx,
 *  vec3 dy, vec3 base )` (every read with explicit gradients). */
export function heatEnvRockGlsl(): string {
  return envRockPaintGlsl('heatEnvRock', HEAT_ENV_ROCK_TILE, HEAT_ENV_ROCK_PAINT);
}

/** The Heat's share of the painted rock at instance-local (x, z): where the basalt soot
 *  held (heat_soot_core.ts), the painting holds now. The soot already yields to the other
 *  veins' paints (with theirs it sums to at most one over the whole main map), so no share
 *  of another vein's is taken out. */
export function heatEnvWeight(x: number, z: number): number {
  return heatSootWeight(x, z);
}

const g = (v: number) => v.toFixed(1);

/** The GLSL twin of `heatEnvWeight`: `float heatEnvWeight( vec2 p )`, p instance-local. */
export function heatEnvWeightGlsl(): string {
  const S = HEAT_SOOT;
  return `float heatEnvWeight( vec2 p ) {
    return smoothstep( ${g(S.x0)}, ${g(S.x1)}, -p.x )
      * smoothstep( ${g(S.ring0)}, ${g(S.ring1)}, length( p ) )
      * ( 1.0 - smoothstep( ${g(S.south0)}, ${g(S.south1)}, -p.y ) )
      * ( 1.0 - smoothstep( ${g(S.north0)}, ${g(S.north1)}, p.y ) );
  }`;
}
