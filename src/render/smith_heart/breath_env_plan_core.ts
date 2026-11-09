// Pure plan of the Breath vein's painted rebuild (design doc section 5.23): the vein
// redone in the painted style the Hammer's rebuild set (section 5.22), its element
// kept: storm granite carved by the gale, sky-blue crystal, pale lichen and a painted
// storm sky, from ChatGPT paintings and turnaround sheets built by Tripo P2.
//
// What stands in for what:
//   - the mountain's bands (walls, masses, prows, near and far), its crest needles and
//     the Cornice's far peaks: wind-carved spires, bluffs and arched crags, each on the
//     old piece's own spot and foot, as tall and as deep, never wider than its old
//     front past the clearance (`fitBreathEnvRock`, the Hammer's own fit);
//   - the landings' standing stones (and the chips of them at the Cornice's gaps):
//     wind-carved stones crowned with crystal, as tall as the old, inside their
//     colliders (`BREATH_ENV_STONE`);
//   - the low walls over the void and the bridge's shelters: dry-laid storm granite in
//     the masonry painting, on the old modules' own lip frame;
//   - the plateau's flat crack inlays and the Cornice's wind grooves give way to the
//     painted floor's own cracks.
// What it never touches: the walks and every lip a body can fall from. The lips and
// the great hung faces under the walks keep the rock kit's sculpts (their brinks tucked
// under the Cornice's open rim, Jose's playtest of 2026-11-04) and only take the
// painting on (heart_rock_cutaway.ts); the Wind Bridge's arch stands as it is (the
// field keeps a shallow keel under its deck); the floating isles are the fight's own.
// No mechanic hangs on anything here: nothing in the Breath kit is frozen.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import { HEART_ROOM, RING, smithHeartAreaAt } from '../../sim/content/smith_heart_layout';
import { BREATH_ROCK_STORM, breathRockStormWeight } from './breath_rock_storm_core';
import { type EnvRockPaint, type EnvRockTile, envRockPaintGlsl } from './env_rock_paint_core';
import { fitEnvRockAs, type HammerEnvRockPiece, hammerEnvOwnsRock } from './hammer_env_plan_core';
import type { HeartKitPlacement } from './heart_kit_core';
import { heartHash } from './heart_plan_core';
import { HEART_ROCK_NEEDLES } from './heart_rock_plan_core';
import { heartFloorClearance } from './heart_walls_core';

/** A storm piece's measures in the shipped kit (yards at scale 1): foot on y 0, front
 *  plane on z 0, centred on x, the body behind. Pinned against the GLB. */
export const BREATH_ENV_ROCK: Readonly<Record<string, HammerEnvRockPiece>> = {
  Env_StormSpire: { w: 40, h: 74.2, d: 34.3 },
  Env_StormBluff: { w: 64, h: 32.6, d: 37.1 },
  Env_StormArch: { w: 48, h: 37.9, d: 23.8 },
};

/** The standing stone's height at scale 1 (yards), its foot on y 0, centred. */
export const BREATH_ENV_STONE_H = 8;

/** The old rock pieces and what stands in each one's place: a wall as a spire or an
 *  arched crag, a great mass as a bluff, a prow as a crag or a spire. */
const ROCK_SWAPS: Readonly<Record<string, readonly string[]>> = {
  Kit_RockWallA: ['Env_StormSpire', 'Env_StormSpire', 'Env_StormArch'],
  Kit_RockWallB: ['Env_StormArch', 'Env_StormSpire'],
  Kit_RockWallC: ['Env_StormSpire'],
  Kit_RockMassA: ['Env_StormBluff'],
  Kit_RockMassB: ['Env_StormArch', 'Env_StormBluff'],
  Kit_RockProw: ['Env_StormArch', 'Env_StormSpire'],
};

/** Does this rock placement belong to the Breath? Everything in its area, and
 *  whatever a neighbour's area holds that faces the Breath's own floors; never what
 *  the Hammer's painted rebuild already takes (`hammerEnvOwnsRock`), never the Heart. */
export function breathEnvOwnsRock(p: { x: number; z: number }): boolean {
  if (hammerEnvOwnsRock(p)) return false;
  const area = smithHeartAreaAt(p.x, p.z);
  if (area === 'heart') return false;
  if (area === 'breath') return true;
  const c = heartFloorClearance(p.x, p.z);
  if (!Number.isFinite(c.d)) return false;
  // The floor it faces: on past the clearance's own margin, onto the walk.
  const reach = c.d + 4;
  return smithHeartAreaAt(p.x + c.toX * reach, p.z + c.toZ * reach) === 'breath';
}

/** Pick the piece standing in for an old rock placement (a far build for a far one). */
export function breathEnvRockPiece(old: HeartKitPlacement): string {
  const far = old.piece.endsWith('Far');
  const base = far ? old.piece.slice(0, -3) : old.piece;
  const options = ROCK_SWAPS[base];
  if (!options) throw new Error(`no storm rock for ${old.piece}`);
  const h = heartHash(Math.round(old.x * 3) + 37, Math.round(old.z * 3));
  const pick = options[Math.floor(h * options.length) % options.length];
  return far ? `${pick}Far` : pick;
}

/** A piece's measures (a far build shares its near build's). */
export function breathEnvRockMeasure(piece: string): HammerEnvRockPiece {
  const m = BREATH_ENV_ROCK[piece.endsWith('Far') ? piece.slice(0, -3) : piece];
  if (!m) throw new Error(`no measures for ${piece}`);
  return m;
}

/** An old mountain piece as its storm stand-in: the Hammer's fit (the same spot and
 *  foot, as tall and as deep, narrowed until its whole front is clear of every walk),
 *  with the storm's pieces and their measures. */
export function fitBreathEnvRock(old: HeartKitPlacement): HeartKitPlacement {
  const piece = breathEnvRockPiece(old);
  return fitEnvRockAs(old, piece, breathEnvRockMeasure(piece));
}

/** A crest needle (round the Ring, or one of the Cornice's far peaks) as a spire on the
 *  same foot: as tall as the needle stood and as broad as its foot, its front set back
 *  half its depth so the spire stands centred where the needle stood. */
export function fitBreathEnvNeedle(old: HeartKitPlacement): HeartKitPlacement {
  const k = old.scale ?? 1;
  const n = HEART_ROCK_NEEDLES[old.piece];
  if (!n) throw new Error(`no needle ${old.piece}`);
  const m = BREATH_ENV_ROCK.Env_StormSpire;
  const width = 2 * n.half * k;
  const depth = 2 * n.half * k;
  const scale = depth / m.d;
  return {
    piece: 'Env_StormSpireFar',
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

/** The old Breath kit's pieces this rebuild stands in for. */
const KIT_SWAPS: Readonly<Record<string, string>> = {
  Kit_BreathWallA: 'Env_BreathWallA',
  Kit_BreathWallB: 'Env_BreathWallB',
  Kit_WindShelter: 'Env_WindShelter',
  Kit_StormStone: 'Env_StormStone',
};

/** The old kit's pieces with nothing in their place: the painted floor carries its own
 *  cracks, and the grooves the Smith cut to lead the updraft to the horns (gone with the
 *  open rim) read as black bars across the painted slabs. */
export const BREATH_ENV_DROPS: ReadonlySet<string> = new Set([
  'Kit_PlateauCrackA',
  'Kit_PlateauCrackB',
  'Kit_WindGroove',
]);

/** The old Kit_StormStone's height at scale 1 (yards, read off the old kit's GLB): the
 *  chips at the Cornice's gaps are the same piece scaled to a hand. */
export const BREATH_OLD_STONE_H = 7.7;

/** The old kit's plan split: `keep` draws as it did, `swap` draws painted. With `has`, a
 *  swap whose painted piece did not bake keeps the old kit's. */
export function breathEnvSwap(
  plan: readonly HeartKitPlacement[],
  has?: (piece: string) => boolean,
): { keep: HeartKitPlacement[]; swap: HeartKitPlacement[] } {
  const keep: HeartKitPlacement[] = [];
  const swap: HeartKitPlacement[] = [];
  for (const p of plan) {
    if (BREATH_ENV_DROPS.has(p.piece)) continue;
    const to = KIT_SWAPS[p.piece];
    if (!to || (has && !has(to))) {
      keep.push(p);
      continue;
    }
    if (to === 'Env_StormStone') {
      // As tall as the old stone (a chip as small as its chip), turned the same way.
      swap.push({
        ...p,
        piece: to,
        scale: ((p.scale ?? 1) * BREATH_OLD_STONE_H) / BREATH_ENV_STONE_H,
      });
      continue;
    }
    swap.push({ ...p, piece: to });
  }
  return { keep, swap };
}

/** Yards one repeat of each scale of the painted rock covers (the heightfield, the field's
 *  cliff faces and the rock kit's lips and hung faces all read the cliff painting so). */
export const BREATH_ENV_ROCK_TILE: EnvRockTile = { a: 21, b: 53, steer: 97 };

/** How the painted rock takes the cliff painting over a surface's own paint
 *  (env_rock_paint_core.ts): its hue (a share of the painting's blue taken back toward
 *  grey), a share of the painting's value strokes, the surface's own value (a painting
 *  laid triplanar over a sculpt put its painted light on faces turned every way, and read
 *  as ice), its ledges scoured pale and its undersides cool. */
export const BREATH_ENV_ROCK_PAINT: EnvRockPaint = {
  hue: 0.7,
  strokes: 0.45,
  value: 0.92,
  mean: 0.252,
  scour: [1.12, 1.11, 1.08],
  down: [0.82, 0.84, 0.98],
};

/** The painted rock's GLSL, `vec3 breathEnvRock( sampler2D paint, vec3 p, vec3 n, vec3 dx,
 *  vec3 dy, vec3 base )` (env_rock_paint_core.ts: every read with explicit gradients, so
 *  it may sit behind a per-fragment weight). */
export function breathEnvRockGlsl(): string {
  return envRockPaintGlsl('breathEnvRock', BREATH_ENV_ROCK_TILE, BREATH_ENV_ROCK_PAINT);
}

/** The Breath's share of the painted rock at instance-local (x, z): where the storm
 *  granite held (breath_rock_storm_core.ts), the painting holds now. */
export function breathEnvWeight(x: number, z: number): number {
  return breathRockStormWeight(x, z);
}

const g = (v: number) => v.toFixed(2);

/** The GLSL twin of `breathEnvWeight`: `float breathEnvWeight( vec2 p )`, p
 *  instance-local. */
export function breathEnvWeightGlsl(): string {
  const B = BREATH_ROCK_STORM;
  return `float breathEnvWeight( vec2 p ) {
    return smoothstep( ${g(B.z0)}, ${g(B.z1)}, p.y )
      * ( 1.0 - smoothstep( ${g(B.x0)}, ${g(B.x1)}, p.x ) )
      * smoothstep( ${g(B.ring0)}, ${g(B.ring1)}, length( p - vec2( ${g(RING.x)}, ${g(RING.z)} ) ) - ${g(RING.outerR)} )
      * smoothstep( ${g(B.heart0)}, ${g(B.heart1)}, length( p - vec2( ${g(HEART_ROOM.x)}, ${g(HEART_ROOM.z)} ) ) );
  }`;
}
