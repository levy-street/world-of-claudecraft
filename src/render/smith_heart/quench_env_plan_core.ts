// Pure plan of the Quench vein's painted rebuild (design doc section 5.24): the whole ice
// realm, from the Ring's mouth down both landings and the Singing Ice to the Frozen Lake,
// redone in the painted style the Hammer's rebuild set (section 5.22), from the owner's
// arena concept (a dark frozen lake ringed by glacier under an aurora night), its
// element kept: frozen slate, glacier ice, cyan crystal and snow, from ChatGPT paintings
// and turnaround sheets built by Tripo P2. The environment sits darker and more saturated
// than the pale frost guardian and its adds, so they stand out against it.
//
// What stands in for what:
//   - the mountain's bands in the Quench and facing its walks, and its crest needles:
//     glacier stacks, glacier bluffs and spires of ice crystal, each on the old piece's
//     own spot and foot, as tall and as deep, never wider than its old front past the
//     clearance (`fitQuenchEnvRock`, the Hammer's own fit);
//   - the old kit's props on their own spots and inside their old boxes: the fire bowls
//     (the flame still burns at QUENCH_BRAZIER_FIRE), the vents, the heaped ice, the
//     Singing Ice's crystal, the landings' standing stones, the low walls over the void,
//     the frozen falls (`quenchEnvSwap`);
//   - the flat crack inlays and the drifts give way to the painted floors' own cracks
//     and snow;
//   - and new pieces from the arena concept: its centrepiece, a colossal frozen fall hung
//     on the rock across the lake from the way in (`planQuenchEnvGreatFall`), its front
//     behind the rock's own, and a ring of snow-capped glacier bluffs round the basin's
//     outside on the mountain past the shelf (`planQuenchEnvRing`), both in the sightline
//     plan.
// What it never touches: the walks and every lip a body can fall from (the lips and the
// hung faces keep the rock kit's sculpts and only take the painting on,
// heart_rock_cutaway.ts), and every mechanic: the fight's four swords stay the fight's
// (smith_heart_fx/quench_blades_fx.ts draws the painted sword in the old one's frame),
// the shore ice it raises is its own.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import { QUENCH, SMITH_HEART_FIELD, smithHeartAreaAt } from '../../sim/content/smith_heart_layout';
import { authoredFieldSurfaceAt } from '../../sim/instances/authored_field';
import { breathEnvOwnsRock } from './breath_env_plan_core';
import { type EnvRockPaint, type EnvRockTile, envRockPaintGlsl } from './env_rock_paint_core';
import {
  fitEnvRockAs,
  type HammerEnvRockPiece,
  hammerEnvFrontClear,
  hammerEnvOwnsRock,
  hammerEnvWeight,
  hammerEnvWeightGlsl,
} from './hammer_env_plan_core';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartMountainHeight } from './heart_mountain_core';
import { heartHash } from './heart_plan_core';
import { HEART_ROCK_NEEDLES, heartRockPieceOf, planHeartRock } from './heart_rock_plan_core';
import { HEART_WALL_CLEAR, heartFloorClearance, heartOpenAir } from './heart_walls_core';
import { QUENCH_FROST, quenchFrostWeight } from './quench_frost_core';

/** A glacier piece's measures in the shipped kit (yards at scale 1): foot on y 0, front
 *  plane on z 0, centred on x, the body behind. Pinned against the GLB. */
export const QUENCH_ENV_ROCK: Readonly<Record<string, HammerEnvRockPiece>> = {
  Env_GlacierTall: { w: 40, h: 71, d: 35.7 },
  Env_GlacierWide: { w: 64, h: 32.9, d: 33.3 },
  Env_IceSpires: { w: 30, h: 51.6, d: 24.2 },
};

/** The props' heights at scale 1 (yards, their feet on y 0, centred): pinned against the
 *  GLB. */
export const QUENCH_ENV_PROPS = {
  Env_FireBowl: 2.32,
  Env_ChevronStone: 5.8,
  Env_IceCluster: 4,
} as const;

/** The old kit's props' heights at scale 1 (yards, read off the old kit's GLB): a painted
 *  prop stands as tall as the one it replaces. */
export const QUENCH_OLD_PROPS = {
  Kit_LakeBrazier: 2.32,
  Kit_FrostStone: 5.83,
  Kit_IceBlade: 4.0,
} as const;

/** The frozen fall's frame (yards at scale 1): its head at the origin, the notch of rock
 *  `over` it, hanging `height` down; the old falls' lengths from their heads, so each
 *  hangs as far as the one it replaces. */
export const QUENCH_ENV_FALL = { height: 27, over: 1.5 } as const;
export const QUENCH_OLD_FALLS: Readonly<Record<string, number>> = {
  Kit_FrozenFallA: 27,
  Kit_FrozenFallB: 19,
};

/** The old rock pieces and what stands in each one's place: a wall as a glacier stack or
 *  a spire of crystal, a great mass as a glacier bluff, a prow as a stack or spires. */
const ROCK_SWAPS: Readonly<Record<string, readonly string[]>> = {
  Kit_RockWallA: ['Env_GlacierTall', 'Env_GlacierTall', 'Env_GlacierWide'],
  Kit_RockWallB: ['Env_GlacierWide', 'Env_GlacierTall'],
  Kit_RockWallC: ['Env_GlacierTall'],
  Kit_RockMassA: ['Env_GlacierWide'],
  Kit_RockMassB: ['Env_GlacierWide', 'Env_GlacierTall'],
  Kit_RockProw: ['Env_IceSpires', 'Env_GlacierTall'],
};

/** Does this rock placement belong to the Quench? Everything in its area and whatever a
 *  neighbour's area holds that faces the Quench's own floors (the walls north of the lake
 *  stand in the Heart's area, the far side of the mountain from the Heart's own room:
 *  left bare they read as a naked wall round the arena); never what the Hammer's or the
 *  Breath's painted rebuild already takes, never rock facing the Heart's own floors (its
 *  crown's paint, wherever it stands). */
export function quenchEnvOwnsRock(p: { x: number; z: number }): boolean {
  if (hammerEnvOwnsRock(p) || breathEnvOwnsRock(p)) return false;
  const c = heartFloorClearance(p.x, p.z);
  // The floor it faces: on past the clearance's own margin, onto the walk.
  const reach = c.d + 4;
  const faced = Number.isFinite(c.d)
    ? smithHeartAreaAt(p.x + c.toX * reach, p.z + c.toZ * reach)
    : null;
  if (faced === 'heart') return false;
  return faced === 'quench' || smithHeartAreaAt(p.x, p.z) === 'quench';
}

/** Pick the piece standing in for an old rock placement (a far build for a far one). */
export function quenchEnvRockPiece(old: HeartKitPlacement): string {
  const far = old.piece.endsWith('Far');
  const base = far ? old.piece.slice(0, -3) : old.piece;
  const options = ROCK_SWAPS[base];
  if (!options) throw new Error(`no glacier for ${old.piece}`);
  const h = heartHash(Math.round(old.x * 3) + 53, Math.round(old.z * 3));
  const pick = options[Math.floor(h * options.length) % options.length];
  return far ? `${pick}Far` : pick;
}

/** A piece's measures (a far build shares its near build's). */
export function quenchEnvRockMeasure(piece: string): HammerEnvRockPiece {
  const m = QUENCH_ENV_ROCK[piece.endsWith('Far') ? piece.slice(0, -3) : piece];
  if (!m) throw new Error(`no measures for ${piece}`);
  return m;
}

/** An old mountain piece as its glacier stand-in: the Hammer's fit (the same spot and
 *  foot, as tall and as deep, narrowed until its whole front is clear of every walk). */
export function fitQuenchEnvRock(old: HeartKitPlacement): HeartKitPlacement {
  const piece = quenchEnvRockPiece(old);
  return fitEnvRockAs(old, piece, quenchEnvRockMeasure(piece));
}

/** A crest needle in the Quench as spires of ice on the same foot: as tall as the needle
 *  stood and as broad as its foot, its front set back half its depth so the spires stand
 *  centred where the needle stood. */
export function fitQuenchEnvNeedle(old: HeartKitPlacement): HeartKitPlacement {
  const k = old.scale ?? 1;
  const n = HEART_ROCK_NEEDLES[old.piece];
  if (!n) throw new Error(`no needle ${old.piece}`);
  const m = QUENCH_ENV_ROCK.Env_IceSpires;
  const width = 2 * n.half * k;
  const depth = 2 * n.half * k;
  const scale = depth / m.d;
  return {
    piece: 'Env_IceSpiresFar',
    x: old.x + Math.sin(old.rot) * (depth / 2),
    y: old.y,
    z: old.z + Math.cos(old.rot) * (depth / 2),
    rot: old.rot,
    scale,
    stretch: width / m.w / scale,
    rise: (n.height * k * (old.rise ?? 1)) / m.h / scale,
    noShadow: true,
    ...(old.cosmetic ? { cosmetic: true } : {}),
  };
}

/** The old Quench kit's pieces this rebuild stands in for. */
const KIT_SWAPS: Readonly<Record<string, string>> = {
  Kit_LakeBrazier: 'Env_FireBowl',
  Kit_FrostStone: 'Env_ChevronStone',
  Kit_IceShelfA: 'Env_IcePlates',
  Kit_IceShelfB: 'Env_IcePlates',
  Kit_IceBlade: 'Env_IceCluster',
  Kit_SteamVent: 'Env_SteamVent',
  Kit_QuenchWallA: 'Env_QuenchWallA',
  Kit_QuenchWallB: 'Env_QuenchWallB',
  Kit_FrozenFallA: 'Env_FrozenFall',
  Kit_FrozenFallB: 'Env_FrozenFall',
};

/** The old kit's pieces with nothing in their place: the painted lake and the Singing
 *  Ice carry their own cracks, and the painted floors and the lake's edge their own snow
 *  (a drift laid over the painted flagstones read as a white bar). */
export const QUENCH_ENV_DROPS: ReadonlySet<string> = new Set([
  'Kit_IceCrackA',
  'Kit_IceCrackB',
  'Kit_SnowDriftA',
  'Kit_SnowDriftB',
]);

/** A swapped placement's scale: as tall as the old piece (a prop, the Singing Ice's
 *  crystal) or hanging as far (a fall); the rest keep the old frame's own size. */
function swapScale(p: HeartKitPlacement, to: string): number {
  const k = p.scale ?? 1;
  if (to === 'Env_FireBowl')
    return (k * QUENCH_OLD_PROPS.Kit_LakeBrazier) / QUENCH_ENV_PROPS.Env_FireBowl;
  if (to === 'Env_ChevronStone')
    return (k * QUENCH_OLD_PROPS.Kit_FrostStone) / QUENCH_ENV_PROPS.Env_ChevronStone;
  if (to === 'Env_IceCluster')
    return (k * QUENCH_OLD_PROPS.Kit_IceBlade) / QUENCH_ENV_PROPS.Env_IceCluster;
  if (to === 'Env_FrozenFall')
    return (k * (QUENCH_OLD_FALLS[p.piece] ?? 27)) / QUENCH_ENV_FALL.height;
  return k;
}

/** The old kit's plan split: `keep` draws as it did, `swap` draws painted. With `has`, a
 *  swap whose painted piece did not bake keeps the old kit's. */
export function quenchEnvSwap(
  plan: readonly HeartKitPlacement[],
  has?: (piece: string) => boolean,
): { keep: HeartKitPlacement[]; swap: HeartKitPlacement[] } {
  const keep: HeartKitPlacement[] = [];
  const swap: HeartKitPlacement[] = [];
  for (const p of plan) {
    if (QUENCH_ENV_DROPS.has(p.piece)) continue;
    const to = KIT_SWAPS[p.piece];
    if (!to || (has && !has(to))) {
      keep.push(p);
      continue;
    }
    swap.push({ ...p, piece: to, scale: swapScale(p, to) });
  }
  return { keep, swap };
}

/** The great frozen fall: the frozen fall's piece `scale` times over, hung on the first
 *  band of rock behind the basin's shelf nearest `bearing` (degrees from north, from the
 *  lake's centre: east, across the lake from the way in) that climbs past its head, at
 *  most `maxBack` past the shelf, its head `head` over the shelf (or 4 under the rock's
 *  crest), its front `out` behind the rock's front plane. */
export const QUENCH_ENV_GREAT_FALL = {
  bearing: 90,
  scale: 2.1,
  maxBack: 18,
  head: 52,
  out: -6.5,
} as const;

/** The frozen fall's piece's box in its own frame (yards at scale 1): x half its span, y
 *  from its foot to its notch, z from its back in the rock to its front. */
export const QUENCH_ENV_FALL_BOX = { hw: 4.8, y0: -25.5, y1: 1.5, z0: -3, z1: 2.6 } as const;

/** The great frozen fall's placement (none if no band of rock faces the shelf there). */
export function planQuenchEnvGreatFall(): HeartKitPlacement[] {
  const G = QUENCH_ENV_GREAT_FALL;
  const L = QUENCH.lake;
  let best: { p: HeartKitPlacement; floor: number; crest: number; off: number } | null = null;
  for (const p of planHeartRock()) {
    if (p.cosmetic || smithHeartAreaAt(p.x, p.z) !== 'quench') continue;
    const c = heartFloorClearance(p.x, p.z);
    if (!Number.isFinite(c.d) || c.d > G.maxBack) continue;
    const reach = c.d + 3;
    const faced = authoredFieldSurfaceAt(
      SMITH_HEART_FIELD,
      p.x + c.toX * reach,
      p.z + c.toZ * reach,
    );
    if (faced?.id !== 'lake_shelf') continue;
    // Only a mass that climbs past the fall's head: the fall hangs on rock, never over
    // its crest.
    const m = heartRockPieceOf(p.piece);
    const crest = p.y + m.height * (p.scale ?? 1) * (p.rise ?? 1);
    if (crest < c.floor + G.head + 4) continue;
    const bearing = (Math.atan2(p.x - L.x, p.z - L.z) * 180) / Math.PI;
    let off = Math.abs(bearing - G.bearing) % 360;
    if (off > 180) off = 360 - off;
    if (best && off >= best.off) continue;
    best = { p, floor: c.floor, crest, off };
  }
  if (!best) return [];
  const { p, floor, crest } = best;
  return [
    {
      piece: 'Env_FrozenFall',
      x: p.x + Math.sin(p.rot) * G.out,
      y: Math.min(crest - 4, floor + G.head),
      z: p.z + Math.cos(p.rot) * G.out,
      rot: p.rot,
      scale: G.scale,
      noShadow: true,
    },
  ];
}

/** The ring of snow-capped glacier stacks round the basin (the arena concept's near tier of
 *  stacked, snow-topped ledges and frozen falls round the lake's shore, in front of the
 *  mountain): one every `step` degrees round the lake at `r` from its centre, facing it, its
 *  foot `sink` into the mountain and its crest `rise` over the shelf (its scale between
 *  `minScale` and `maxScale`), wherever its whole footprint stands on rock clear of every
 *  walk; never within `fallGap` degrees of the great frozen fall (nothing stands in front of
 *  the concept's centrepiece). */
export const QUENCH_ENV_RING = {
  piece: 'Env_GlacierTall',
  r: 59,
  step: 13,
  sink: 4,
  rise: 24,
  minScale: 0.35,
  maxScale: 0.7,
  fallGap: 22,
} as const;

/** The ring's placements (render only, in the sightline plan). */
export function planQuenchEnvRing(): HeartKitPlacement[] {
  const R = QUENCH_ENV_RING;
  const L = QUENCH.lake;
  const m = QUENCH_ENV_ROCK[R.piece];
  const fall = planQuenchEnvGreatFall()[0];
  const fallDeg = fall ? (Math.atan2(fall.x - L.x, fall.z - L.z) * 180) / Math.PI : null;
  const out: HeartKitPlacement[] = [];
  for (let deg = 0; deg < 360; deg += R.step) {
    if (fallDeg !== null) {
      let off = Math.abs(deg - fallDeg) % 360;
      if (off > 180) off = 360 - off;
      if (off < R.fallGap) continue;
    }
    const a = (deg * Math.PI) / 180;
    const x = L.x + Math.sin(a) * R.r;
    const z = L.z + Math.cos(a) * R.r;
    // Its face (local +Z) to the lake.
    const rot = Math.atan2(L.x - x, L.z - z);
    const ground = heartMountainHeight(x, z);
    const y = Math.min(ground, QUENCH.shelf.h) - R.sink;
    const scale = Math.min(R.maxScale, Math.max(R.minScale, (QUENCH.shelf.h + R.rise - y) / m.h));
    const half = (m.w * scale) / 2;
    const depth = m.d * scale;
    if (!hammerEnvFrontClear(x, z, rot, half)) continue;
    // Its whole footprint on the mountain: no walk under it, never the open air.
    const ux = Math.cos(rot);
    const uz = -Math.sin(rot);
    const bx = -Math.sin(rot);
    const bz = -Math.cos(rot);
    let clear = true;
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
      if (heartOpenAir(px, pz, 0) || heartFloorClearance(px, pz).d < HEART_WALL_CLEAR) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    out.push({ piece: R.piece, x, y, z, rot, scale, noShadow: true });
  }
  return out;
}

/** Yards one repeat of each scale of the painted rock covers (the heightfield, the field's
 *  cliff faces and the rock kit's lips and hung faces all read the cliff painting so). */
export const QUENCH_ENV_ROCK_TILE: EnvRockTile = { a: 19, b: 47, steer: 89 };

/** How the painted rock takes the frozen cliff painting over a surface's own paint
 *  (env_rock_paint_core.ts): most of the painting's slate-blue and teal, a calm share of
 *  its strokes (a sixty yard face read as stripes at more), the surface's own value
 *  brought down (the realm's rock a dark mass the luminous ice and the pale frost
 *  guardian stand out against), the faces turned down a deeper blue, and snow on the
 *  ledges. */
export const QUENCH_ENV_ROCK_PAINT: EnvRockPaint = {
  hue: 0.65,
  strokes: 0.38,
  value: 0.5,
  mean: 0.2,
  scour: [1.04, 1.06, 1.1],
  down: [0.74, 0.8, 1.0],
  ledge: { color: [0.62, 0.7, 0.84], share: 0.35 },
};

/** The base the heightfield and the field's cliff faces hand the painted rock (linear): a
 *  plain mid slate, so they wear the painting's own value. They are smooth low-poly
 *  surfaces with no carved form to keep, and their own tint by the Heart is the crown's
 *  near-black (the walls north of the lake read as a black band under the glacier). */
export const QUENCH_ENV_FIELD_BASE = [0.3, 0.32, 0.36] as const;

/** The painted rock's GLSL, `vec3 quenchEnvRock( sampler2D paint, vec3 p, vec3 n, vec3 dx,
 *  vec3 dy, vec3 base )` (every read with explicit gradients). */
export function quenchEnvRockGlsl(): string {
  return envRockPaintGlsl('quenchEnvRock', QUENCH_ENV_ROCK_TILE, QUENCH_ENV_ROCK_PAINT);
}

/** The Quench's share of the painted rock at instance-local (x, z): where the frost held
 *  (quench_frost_core.ts), the painting holds now, but for the Quench's south side, the
 *  skyline over the Hammer's arena, which the Hammer's own painted rebuild paints
 *  (`hammerEnvWeight`): two veins' paints never both hold. */
export function quenchEnvWeight(x: number, z: number): number {
  return quenchFrostWeight(x, z) * (1 - hammerEnvWeight(x, z));
}

const g = (v: number) => v.toFixed(1);

/** The GLSL twin of `quenchEnvWeight`: `float quenchEnvWeight( vec2 p, float core )`, p
 *  instance-local; the Heart's side fades by `core`, how far the camera is in the Heart
 *  (the rock kit's material and the heightfield's paint both pass it, so from the Quench
 *  its walls hold the paint all the way round). The Hammer's share rides along under its own name here
 *  (`quenchHammerShare`): the veins' layers sit on one shader, and the Hammer's layer
 *  declares its own `hammerEnvWeight`. */
export function quenchEnvWeightGlsl(): string {
  const F = QUENCH_FROST;
  const hammer = hammerEnvWeightGlsl().replace(
    'float hammerEnvWeight(',
    'float quenchHammerShare(',
  );
  return `${hammer}
  float quenchEnvWeight( vec2 p, float core ) {
    float w = smoothstep( ${g(F.x0)}, ${g(F.x1)}, p.x )
      * smoothstep( ${g(F.ring0)}, ${g(F.ring1)}, length( p ) )
      * mix( 1.0, smoothstep( ${g(F.heart0)}, ${g(F.heart1)}, length( p - vec2( ${g(F.heartX)}, ${g(F.heartZ)} ) ) ), core );
    return w * ( 1.0 - smoothstep( ${g(F.breathZ0)}, ${g(F.breathZ1)}, p.y )
      * ( 1.0 - smoothstep( ${g(F.breathX0)}, ${g(F.breathX1)}, p.x ) ) )
      * ( 1.0 - quenchHammerShare( p ) );
  }`;
}
