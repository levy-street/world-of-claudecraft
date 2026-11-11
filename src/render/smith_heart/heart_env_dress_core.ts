// PURE: the Heart's crown dressed with the four veins' painted rock (the owner's Heart
// concept of 2026-11-11, docs/design/raid/kit/heart_env_src/: all four elements of the
// mountain come together round the Anvil of the World). Behind each quarter's wall landmark
// (heart_landmarks_core.ts, which keep their place and their eruption: which quarter is
// awake is read off them), rising out of the chasm round the platform, the great cliffs of
// that landmark's element: the Breath's storm spires to the north, the Quench's glacier to
// the east, the Hammer's golden quarry cliffs to the south, the Heat's seamed basalt and its
// great fall to the west. Two tiers, the far one taller, so the four meet in a crown open to
// the sky. Every piece is a kit's own (no new model), drawn only from the Heart
// (env_area_clip.ts `heart`), clear of every walk (the Heart Bridge, the Arrival Terrace).
// Three-free, DOM-free, deterministic.

import {
  HEART_ROOM,
  HEART_ROOM_AREA_R,
  HEART_ROOM_CHASM_R,
  type SmithHeartVein,
} from '../../sim/content/smith_heart_layout';
import { BREATH_ENV_ROCK } from './breath_env_plan_core';
import { HAMMER_ENV_ROCK, type HammerEnvRockPiece } from './hammer_env_plan_core';
import type { HeartKitPlacement } from './heart_kit_core';
import { HEART_LANDMARK_FRAME } from './heart_landmarks_core';
import { heartHash } from './heart_plan_core';
import { heartFloorClearance } from './heart_walls_core';
import { HEAT_ENV_ROCK } from './heat_env_plan_core';
import { QUENCH_ENV_ROCK } from './quench_env_plan_core';

/** Each vein's kit measures (yards at scale 1). */
const MEASURES: Readonly<Record<SmithHeartVein, Readonly<Record<string, HammerEnvRockPiece>>>> = {
  hammer: HAMMER_ENV_ROCK,
  breath: BREATH_ENV_ROCK,
  quench: QUENCH_ENV_ROCK,
  heat: HEAT_ENV_ROCK,
};

/** Each element's pieces: the near tier's cycle (its hero, when it has one, standing square
 *  behind the landmark) and the far tier's. */
export const HEART_ENV_PIECES: Readonly<
  Record<SmithHeartVein, { hero?: string; near: readonly string[]; far: readonly string[] }>
> = {
  breath: {
    near: ['Env_StormSpire', 'Env_StormArch', 'Env_StormSpire', 'Env_StormBluff'],
    far: ['Env_StormSpire'],
  },
  quench: {
    near: ['Env_GlacierTall', 'Env_IceSpires', 'Env_GlacierTall', 'Env_GlacierWide'],
    far: ['Env_GlacierTall'],
  },
  hammer: {
    near: ['Env_CliffTall', 'Env_Outcrop', 'Env_CliffTall', 'Env_CliffWide'],
    far: ['Env_CliffTall'],
  },
  heat: {
    hero: 'Env_GreatFall',
    near: ['Env_SeamTall', 'Env_CliffWall', 'Env_SeamTall'],
    far: ['Env_SeamTall'],
  },
};

/** The dressing's layout: `arc` degrees either side of each landmark's bearing; each tier
 *  a piece every `step` degrees from `offset`, its front `r` out from the platform's middle,
 *  its foot at `foot` (down in the chasm) and its crest `crest` over the platform; the hand
 *  (`jitter`: bearing degrees, scale share, turn radians); `clear` yards every footprint
 *  keeps from the Heart's walks (the main map's lie past the crown, and these are drawn only
 *  from the Heart); no piece wider than `maxWidth` yards nor scaled past `maxScale` (a low
 *  bluff stays a bluff: the tall pieces carry the crest). */
export const HEART_ENV_DRESS = {
  arc: 40,
  tiers: [
    { r: 100, step: 11, offset: 0, foot: -45, crest: 58 },
    { r: 124, step: 9, offset: 4.5, foot: -30, crest: 98 },
  ],
  jitter: { deg: 3, scale: 0.1, rot: 0.2 },
  clear: 10,
  maxScale: 2.2,
  maxWidth: 96,
} as const;

/** A piece's measures in its vein's kit. */
export function heartEnvMeasure(vein: SmithHeartVein, piece: string): HammerEnvRockPiece {
  const m = MEASURES[vein][piece];
  if (!m) throw new Error(`no measures for ${piece} in the ${vein} kit`);
  return m;
}

/** Does a piece of measures `m` at (x, z) facing `rot` with `scale` keep `clear` yards from
 *  every walk at its front corners, its middle and its back? */
function clearOfWalks(
  x: number,
  z: number,
  rot: number,
  m: HammerEnvRockPiece,
  scale: number,
): boolean {
  const half = (m.w * scale) / 2;
  const depth = m.d * scale;
  const ux = Math.cos(rot);
  const uz = -Math.sin(rot);
  const bx = -Math.sin(rot);
  const bz = -Math.cos(rot);
  for (const [s, b] of [
    [-1, 0],
    [0, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
    [0, 0.5],
  ]) {
    const px = x + ux * half * s + bx * depth * b;
    const pz = z + uz * half * s + bz * depth * b;
    if (Math.hypot(px - HEART_ROOM.x, pz - HEART_ROOM.z) > HEART_ROOM_AREA_R) continue;
    if (heartFloorClearance(px, pz).d < HEART_ENV_DRESS.clear) return false;
  }
  return true;
}

/** Each element's dressing (instance-local placements, render only). */
export function planHeartEnvDress(): Record<SmithHeartVein, HeartKitPlacement[]> {
  const D = HEART_ENV_DRESS;
  const out = { hammer: [], breath: [], quench: [], heat: [] } as Record<
    SmithHeartVein,
    HeartKitPlacement[]
  >;
  const veins = Object.keys(HEART_ENV_PIECES) as SmithHeartVein[];
  veins.forEach((vein, vi) => {
    const set = HEART_ENV_PIECES[vein];
    const b0 = HEART_LANDMARK_FRAME.bearing[vein];
    D.tiers.forEach((T, ti) => {
      let i = 0;
      for (let d = -D.arc + T.offset; d <= D.arc; d += T.step, i++) {
        const h = (k: number) => heartHash(vi * 997 + ti * 131 + i, k + 5200) * 2 - 1;
        const a = ((b0 + d + h(1) * D.jitter.deg) * Math.PI) / 180;
        const x = HEART_ROOM.x + Math.sin(a) * T.r;
        const z = HEART_ROOM.z + Math.cos(a) * T.r;
        if (Math.hypot(x - HEART_ROOM.x, z - HEART_ROOM.z) < HEART_ROOM_CHASM_R) continue;
        const rot = Math.atan2(HEART_ROOM.x - x, HEART_ROOM.z - z) + h(2) * D.jitter.rot;
        const hero = ti === 0 && set.hero && Math.abs(d) < T.step / 2;
        const list = ti === 0 ? set.near : set.far;
        const piece = hero && set.hero ? set.hero : list[i % list.length];
        const m = heartEnvMeasure(vein, piece);
        const y = HEART_ROOM.h + T.foot;
        let scale = Math.min(
          ((HEART_ROOM.h + T.crest - y) / m.h) * (1 + h(3) * D.jitter.scale),
          D.maxScale,
          D.maxWidth / m.w,
        );
        while (scale > 0.4 && !clearOfWalks(x, z, rot, m, scale)) scale *= 0.85;
        if (scale <= 0.4) continue;
        out[vein].push({ piece, x, y, z, rot, scale, noShadow: true });
      }
    });
  });
  return out;
}

/** The mountain opened round the Heart, seen from inside it (the concept's four cliffs are
 *  the crown: the old heightfield stood over them and buried them): between the chasm's
 *  edge (`r0` yards from the platform's middle, where no rock stands anyway) and `r1`, the
 *  dressing's far tier and a margin behind it, above `y0` (the dressing's feet far down in
 *  the chasm: the walls under them stay), each edge eased over `edge` yards. Only the
 *  mountain's heightfield (heart_env_dress.ts `heartOpenMountainLayer`): never a walk's
 *  cliff face (the Arrival Terrace's, the Heart Bridge's), never the rock kit. The crown
 *  past `r1` stands as it was. From anywhere but the Heart the mountain stands whole. */
export const HEART_ENV_OPEN = {
  r0: HEART_ROOM_CHASM_R,
  r1: 150,
  y0: HEART_ROOM.h + HEART_ENV_DRESS.tiers[0].foot + 4,
  edge: 1,
} as const;

const g1 = (v: number) => v.toFixed(1);

/** The open region's GLSL: `float heartEnvOpen( vec3 p )` (p slot space, yards). */
export function heartEnvOpenGlsl(): string {
  const O = HEART_ENV_OPEN;
  return `float heartEnvOpen( vec3 p ) {
    float hrR = length( p.xz - vec2( ${g1(HEART_ROOM.x)}, ${g1(HEART_ROOM.z)} ) );
    return smoothstep( ${g1(O.r0)}, ${g1(O.r0 + O.edge)}, hrR )
      * ( 1.0 - smoothstep( ${g1(O.r1 - O.edge)}, ${g1(O.r1)}, hrR ) )
      * smoothstep( ${g1(O.y0)}, ${g1(O.y0 + O.edge)}, p.y );
  }`;
}
