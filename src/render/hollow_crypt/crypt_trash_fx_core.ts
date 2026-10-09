// Pure plan for the Hollow Crypt trash telegraphs (crypt_trash_fx.ts): which
// cast draws which floor shape, how big, in what colour, and how it fills, all
// derived from the sim's own templates so the edge a player dodges is the edge
// the sim tests (src/sim/content/hollow_crypt_trash.ts, mob/trash_kit).
//
// Three-free, DOM-free, deterministic.

import { MOBS } from '../../sim/data';
import {
  CRYPT_BARROW_EMBERS,
  CRYPT_BARROWFLAME_BREATH,
  CRYPT_CARRION_EYE,
  CRYPT_GRAVE_CLEAVE,
  CRYPT_GRAVE_RUPTURE,
  CRYPT_MARROW_CRUSH,
  CRYPT_MURDER_CALL,
  CRYPT_RAISE_BONES,
  CRYPT_RIMESILK_SPIT,
  CRYPT_RUPTURE_POOL,
  CRYPT_RUPTURE_RING,
  CRYPT_STONE_SHRIEK,
  CRYPT_TAIL_LASH,
  CRYPT_WING_GUST,
} from '../../sim/mob/trash_kit/cast_ids';
import { TELEGRAPH_ACCENTS, TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';

export type CryptTelegraphShape = 'cone' | 'rearCone' | 'ring' | 'sigil' | 'lane';

export interface CryptTelegraphSpec {
  shape: CryptTelegraphShape;
  /** Yards: the cone's reach, the ring's radius or the lane's length. */
  range: number;
  /** A lane's half width (yards). */
  halfWidth?: number;
  /** Degrees of the cone's arc (360 for a ring). */
  arcDeg: number;
  /** The threat colour (floor_telegraph TELEGRAPH_THREAT_COLORS). */
  color: number;
  /** The element accent of the motes and the fill front. */
  accent?: number;
  /** A sigil sits this far ahead of the caster (the Raise Bones grave). */
  ahead?: number;
}

/** The crypt's telegraphs in the shared threat palette: the colour says what
 *  standing in it costs (damage, a stun, a kick call), the accent carries the
 *  element. */
export const CRYPT_TELEGRAPH_COLORS = {
  physical: TELEGRAPH_THREAT_COLORS.danger,
  stun: TELEGRAPH_THREAT_COLORS.control,
  shadow: TELEGRAPH_THREAT_COLORS.interrupt,
  bone: TELEGRAPH_THREAT_COLORS.danger,
  /** The drake's spectral Barrowflame: avoidable damage; its green-white
   *  ghost fire rides the accent (TELEGRAPH_ACCENTS.ghostfire). */
  ghostfire: TELEGRAPH_THREAT_COLORS.danger,
  /** A corpse the Grave Rupture will burst, and the pool it leaves: damage. */
  shadowBurst: TELEGRAPH_THREAT_COLORS.danger,
  /** The Rimesilk web lane: it roots, so it is crowd control. */
  web: TELEGRAPH_THREAT_COLORS.control,
} as const;

/** The Crow Caller's carrion violet, on the Carrion Eye glyph's motes. */
const CARRION_ACCENT = 0xd29bff;

function breath(templateId: string) {
  const b = MOBS[templateId]?.breathCone;
  return { range: b?.range ?? 0, arcDeg: b?.arcDeg ?? 0 };
}

/** Every trash cast that paints the floor while its bar runs. */
export function cryptTelegraphSpecs(): Readonly<Record<string, CryptTelegraphSpec>> {
  const drakeKit = MOBS.crypt_ossuary_drake?.trashKit;
  const shriek = MOBS.crypt_chapel_gargoyle?.trashKit?.screech;
  const spit = MOBS.bonechill_widow?.trashKit?.line;
  return {
    [CRYPT_GRAVE_CLEAVE]: {
      shape: 'cone',
      ...breath('crypt_ossuary_warrior'),
      color: CRYPT_TELEGRAPH_COLORS.physical,
    },
    [CRYPT_BARROWFLAME_BREATH]: {
      shape: 'cone',
      ...breath('crypt_ossuary_drake'),
      color: CRYPT_TELEGRAPH_COLORS.ghostfire,
      accent: TELEGRAPH_ACCENTS.ghostfire,
    },
    [CRYPT_TAIL_LASH]: {
      shape: 'rearCone',
      range: drakeKit?.tailLash?.range ?? 0,
      arcDeg: drakeKit?.tailLash?.arcDeg ?? 0,
      color: CRYPT_TELEGRAPH_COLORS.physical,
    },
    [CRYPT_WING_GUST]: {
      shape: 'ring',
      range: drakeKit?.wingGust?.radius ?? 0,
      arcDeg: 360,
      color: CRYPT_TELEGRAPH_COLORS.physical,
    },
    [CRYPT_STONE_SHRIEK]: {
      shape: 'ring',
      range: shriek?.radius ?? 0,
      arcDeg: 360,
      color: CRYPT_TELEGRAPH_COLORS.stun,
    },
    [CRYPT_RAISE_BONES]: {
      shape: 'sigil',
      range: 1.6,
      arcDeg: 360,
      color: CRYPT_TELEGRAPH_COLORS.shadow,
      accent: TELEGRAPH_ACCENTS.shadow,
      ahead: 2.5,
    },
    [CRYPT_MURDER_CALL]: {
      shape: 'sigil',
      range: 2.6,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: TELEGRAPH_ACCENTS.shadow,
    },
    // The trash mechanics pass (mob/trash_kit/crypt_kit.ts).
    // The Bone Brute's narrow smash: face it away, or brace.
    [CRYPT_MARROW_CRUSH]: {
      shape: 'cone',
      ...breath('crypt_bone_brute'),
      color: CRYPT_TELEGRAPH_COLORS.physical,
      accent: TELEGRAPH_ACCENTS.bone,
    },
    // The Bonechill Widow's web lane, locked on her aim: it roots whoever it
    // catches, so it reads as crowd control with a frost-white accent.
    [CRYPT_RIMESILK_SPIT]: {
      shape: 'lane',
      range: spit?.length ?? 0,
      halfWidth: spit?.halfWidth ?? 0,
      arcDeg: 0,
      color: CRYPT_TELEGRAPH_COLORS.web,
      accent: TELEGRAPH_ACCENTS.frost,
    },
    // Kick glyphs under the casters of the two kickable marks (the ring the
    // rupture paints on its corpse is an object telegraph, below).
    [CRYPT_GRAVE_RUPTURE]: {
      shape: 'sigil',
      range: 2.8,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: TELEGRAPH_ACCENTS.shadow,
    },
    [CRYPT_CARRION_EYE]: {
      shape: 'sigil',
      range: 2.6,
      arcDeg: 360,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: CARRION_ACCENT,
    },
  };
}

/** A floor object the trash kit lays (crypt_kit.ts): the shape it paints and
 *  what drives its fill. `cast` fills with the bar of the nearest caster of
 *  `castId` (the Grave Rupture ring); `hazard` burns full and pulsing while the
 *  object stands (the rupture pool, the Barrow Embers). */
export interface CryptObjectTelegraph {
  shape: 'ring' | 'cone';
  color: number;
  accent: number;
  drive: 'cast' | 'hazard';
  /** The cast whose bar fills a `cast` ring. */
  castId?: string;
  /** A cone's arc (degrees); its reach is the object's scale, its yaw the
   *  object's facing. A ring's radius is the object's scale. */
  arcDeg?: number;
}

/** Every trash floor object, keyed by its template (CRYPT_TRASH_OBJECT_TEMPLATES). */
export function cryptObjectTelegraphs(): Readonly<Record<string, CryptObjectTelegraph>> {
  return {
    [CRYPT_RUPTURE_RING]: {
      shape: 'ring',
      color: CRYPT_TELEGRAPH_COLORS.shadowBurst,
      accent: TELEGRAPH_ACCENTS.shadow,
      drive: 'cast',
      castId: CRYPT_GRAVE_RUPTURE,
    },
    [CRYPT_RUPTURE_POOL]: {
      shape: 'ring',
      color: CRYPT_TELEGRAPH_COLORS.shadowBurst,
      accent: TELEGRAPH_ACCENTS.shadow,
      drive: 'hazard',
    },
    [CRYPT_BARROW_EMBERS]: {
      shape: 'cone',
      color: CRYPT_TELEGRAPH_COLORS.ghostfire,
      accent: TELEGRAPH_ACCENTS.ghostfire,
      drive: 'hazard',
      arcDeg: MOBS.crypt_ossuary_drake?.breathCone?.arcDeg ?? 0,
    },
  };
}

/** How far from a rupture ring its caster may stand (the cast's reach plus a
 *  margin for the caster's drift). */
export function ruptureCasterReach(): number {
  return (MOBS.crypt_gravecaller_necromancer?.trashKit?.rupture?.range ?? 0) + 4;
}

/** Fill of a telegraph in [0, 1]: 0 as the bar opens, 1 as it lands. */
export function telegraphFill(castRemaining: number, castTotal: number): number {
  if (castTotal <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - castRemaining / castTotal));
}

/** The world-space yaw (sim convention, 0 = +z) a shape points along. */
export function telegraphYaw(shape: CryptTelegraphShape, facing: number): number {
  return shape === 'rearCone' ? facing + Math.PI : facing;
}

/**
 * Local (x, z) points of a cone fan about +z, `segments` wedges: the apex
 * first, then the arc from one edge to the other. A ring is the full circle.
 */
export function coneFan(range: number, arcDeg: number, segments: number): [number, number][] {
  const half = (Math.min(360, arcDeg) * Math.PI) / 180 / 2;
  const out: [number, number][] = [[0, 0]];
  for (let i = 0; i <= segments; i++) {
    const a = -half + (2 * half * i) / segments;
    out.push([Math.sin(a) * range, Math.cos(a) * range]);
  }
  return out;
}

/** The Bone Minion's burst ring: its radius and fuse, from the template. */
export function boneBurstSpec(): { radius: number; delay: number } {
  const d = MOBS.crypt_bone_minion?.deathThroes;
  return { radius: d?.radius ?? 0, delay: d?.delay ?? 0 };
}

/** The burst's phase `elapsed` seconds after the minion fell: the warning
 *  fills over the fuse, then a short flash, then nothing. */
export function boneBurstPhase(
  elapsed: number,
  delay: number,
): { stage: 'fuse' | 'flash' | 'done'; fill: number } {
  if (elapsed < delay) return { stage: 'fuse', fill: delay > 0 ? elapsed / delay : 1 };
  if (elapsed < delay + BONE_BURST_FLASH)
    return { stage: 'flash', fill: (elapsed - delay) / BONE_BURST_FLASH };
  return { stage: 'done', fill: 1 };
}

/** Seconds the burst flash lingers after the fuse. */
export const BONE_BURST_FLASH = 0.45;
