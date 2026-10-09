// Pure plan for the Wildheart Basin's three boss encounters (basin_boss_fx.ts):
// the Fanglord Beastmaster and his Great Jaguar, the Gorgebloom and Zulgar,
// Voice of the Basin. Which cast paints which floor shape and how big (every
// number from the sim's own tuning, so the edge a player dodges is the edge
// the sim tests), the cosmetic charge-ups, how each aura dresses its bearer
// (head marks, glows, motes), the spirit cord's brightness, the seedpods'
// swell, the seeds' arc and the shock rings' timeline.
//
// Three-free, DOM-free, deterministic. PLACEHOLDER looks: the art phase swaps
// the looks, never the sizes (those are the sim's).

import {
  BEAST_CALL_OF_THE_HUNT,
  BEAST_HEEL,
  BEAST_PIT_QUAKE,
  BEAST_RENDING_BITE,
  BEAST_STALKED,
  BEAST_TUNING,
  BEASTMASTER_ID,
  BLOOM_DIGESTING,
  BLOOM_GORGE,
  BLOOM_POLLINATED,
  BLOOM_SEED_RAIN,
  BLOOM_TUNING,
  BLOOM_VINE_LASH,
  bondStrength,
  FANGLORD_JAGUAR_ID,
  GORGEBLOOM_ID,
  THORN_SPROUT_ID,
  ZULGAR_AVATAR,
  ZULGAR_ID,
  ZULGAR_MAULED,
  ZULGAR_PREY,
  ZULGAR_PULSE,
  ZULGAR_SPIRIT_HUNT,
  ZULGAR_SUNSTRUCK,
  ZULGAR_TUNING,
  ZULGAR_VANISHED,
} from '../../sim/encounters/wildheart_basin/ids';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';
import { BASIN_ACCENTS } from './basin_fx_core';
import { BEASTMASTER_MODEL, BEASTMASTER_SIM_SCALE } from './basin_trash_model_core';
import { gorgebloomTopPerScale } from './gorgebloom_model_core';
import { SPROUT_MODEL, SPROUT_SIM_SCALE } from './lasher_model_core';
import type { CrownSpec, RippleSpec } from './saurian_fx_core';

// ---- the boss casts ---------------------------------------------------------------

/** `ring`/`cone`/`lane` are threat telegraphs (the shared kit, every tier, the
 *  threat palette); `charge` is a cosmetic sigil turning under a caster whose
 *  bar is not a floor hazard (its colour is the element's, not a threat). */
export type BossCastShape = 'ring' | 'cone' | 'lane' | 'charge';

export interface BossCastSpec {
  shape: BossCastShape;
  /** Yards: a ring's radius, a cone's reach, a lane's length (0 when it is
   *  measured live to the cast target), a charge sigil's radius. */
  range: number;
  /** Degrees of a cone's arc (360 for a ring). */
  arcDeg: number;
  /** A lane's half width (yards). */
  halfWidth: number;
  /** Where the shape stands: under the caster or under its cast target. */
  anchor: 'caster' | 'target';
  /** Which way a cone or lane points: the caster's facing or at its target. */
  aim: 'facing' | 'target';
  /** The lane runs from the caster to its target, as long as they stand apart. */
  reachToTarget: boolean;
  /** The direction locks when the bar opens (the sim locks it too). */
  lockYaw: boolean;
  /** The threat colour (a charge: its element colour). */
  color: number;
  /** The element accent (motes and the fill front). */
  accent: number;
}

/** A tank-buster's mark under the tank (yards): the bite lands on him alone. */
export const GORGE_MARK_RADIUS = 1.6;
/** Half the jaguar's flank: the width of the Heel! leap's warning lane. */
export const HEEL_LANE_HALF = 1.5;

const BASE: Omit<BossCastSpec, 'shape' | 'range' | 'color' | 'accent'> = {
  arcDeg: 360,
  halfWidth: 0,
  anchor: 'caster',
  aim: 'facing',
  reachToTarget: false,
  lockYaw: false,
};

/** Every boss cast of the basin that draws while its bar runs. */
export function basinBossCastSpecs(): Readonly<Record<string, BossCastSpec>> {
  return {
    // Beast Pit Quake: the ring round the Beastmaster (avoidable damage).
    [BEAST_PIT_QUAKE]: {
      ...BASE,
      shape: 'ring',
      range: BEAST_TUNING.quakeRadius,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: BASIN_ACCENTS.physical,
    },
    // Heroic Heel!: the leap's line from the crouching jaguar to its master.
    // A stun on the jaguar stops it, so it reads as the interrupt colour.
    [BEAST_HEEL]: {
      ...BASE,
      shape: 'lane',
      range: 0,
      halfWidth: HEEL_LANE_HALF,
      aim: 'target',
      reachToTarget: true,
      color: TELEGRAPH_THREAT_COLORS.interrupt,
      accent: BASIN_ACCENTS.physical,
    },
    // Seed Rain: the bloom gathers its seeds (the pods are the hazard). The
    // sigil turns round its root crown, outside the bulb.
    [BLOOM_SEED_RAIN]: {
      ...BASE,
      shape: 'charge',
      range: 7,
      color: BASIN_ACCENTS.pollen,
      accent: 0xff5a3a,
    },
    // Vine Lash: the locked lane that roots (control).
    [BLOOM_VINE_LASH]: {
      ...BASE,
      shape: 'lane',
      range: BLOOM_TUNING.lashLength,
      halfWidth: BLOOM_TUNING.lashHalfWidth,
      lockYaw: true,
      color: TELEGRAPH_THREAT_COLORS.control,
      accent: BASIN_ACCENTS.vine,
    },
    // Gorge: the tank-buster mark under the tank (the signature hit).
    [BLOOM_GORGE]: {
      ...BASE,
      shape: 'ring',
      range: GORGE_MARK_RADIUS,
      anchor: 'target',
      color: TELEGRAPH_THREAT_COLORS.lethal,
      accent: BASIN_ACCENTS.pollen,
    },
    // Wildheart Pulse: the ring round Zulgar (avoidable damage).
    [ZULGAR_PULSE]: {
      ...BASE,
      shape: 'ring',
      range: ZULGAR_TUNING.pulseRadius,
      color: TELEGRAPH_THREAT_COLORS.danger,
      accent: BASIN_ACCENTS.spirit,
    },
    // Spirit of the Hunt: the jade sigil as the jaguar spirit takes him.
    [ZULGAR_SPIRIT_HUNT]: {
      ...BASE,
      shape: 'charge',
      range: 5.5,
      color: BASIN_ACCENTS.spirit,
      accent: 0xd8fff0,
    },
  };
}

/** Which way a cast's cone or lane points (radians, the sim's facing). */
export function bossCastYaw(
  spec: BossCastSpec,
  caster: { x: number; z: number; facing: number },
  target: { x: number; z: number } | null,
  lockedYaw: number | null,
): number {
  if (spec.lockYaw && lockedYaw !== null) return lockedYaw;
  if (spec.aim === 'target' && target) {
    const dx = target.x - caster.x;
    const dz = target.z - caster.z;
    if (dx * dx + dz * dz > 1e-6) return Math.atan2(dx, dz);
  }
  return caster.facing;
}

/** A lane's length: its fixed reach, or the live gap to its target. */
export function bossLaneLength(spec: BossCastSpec, distance: number): number {
  if (!spec.reachToTarget) return spec.range;
  return Math.max(0.5, Number.isFinite(distance) ? distance : 0);
}

/** A charge sigil's look at `fill` of its bar, `t` seconds on the clock. */
export function chargeLook(fill: number, t: number): { alpha: number; spin: number; glow: number } {
  const f = Math.min(1, Math.max(0, fill));
  return {
    alpha: 0.55 + 0.45 * f,
    spin: t * (0.6 + 2.4 * f),
    glow: 0.35 + 0.65 * f * f,
  };
}

// ---- the bodies -----------------------------------------------------------------

/** Drawn height per unit of sim scale (characters/manifest.ts and
 *  wildheart_creature_looks.ts: the base rig's height times its grow). */
export const BOSS_BODY_HEIGHT: Readonly<Record<string, number>> = {
  // His Blender body (basin_trash_model_core.ts), drawn at its authored 6.3 yd.
  [BEASTMASTER_ID]: (BEASTMASTER_MODEL.idleTop - BEASTMASTER_MODEL.idleMin) / BEASTMASTER_SIM_SCALE,
  [FANGLORD_JAGUAR_ID]: 1.92,
  // Its Blender body to the top of the raised petal (gorgebloom_model_core.ts).
  [GORGEBLOOM_ID]: gorgebloomTopPerScale(),
  [ZULGAR_ID]: 3.2,
  // Its Blender body (lasher_model_core.ts), drawn at its authored 3 yd.
  [THORN_SPROUT_ID]: SPROUT_MODEL.idleTop / SPROUT_SIM_SCALE,
};
/** A player's drawn height (yards at scale 1). */
export const PLAYER_BODY_HEIGHT = 2.6;

/** A body's drawn height (yards). */
export function bossBodyHeight(templateId: string, scale: number): number {
  return (BOSS_BODY_HEIGHT[templateId] ?? PLAYER_BODY_HEIGHT) * (scale > 0 ? scale : 1);
}

/** Every template whose presence means the party fights in the basin. */
export const BASIN_BOSS_TEMPLATES: ReadonlySet<string> = new Set([
  BEASTMASTER_ID,
  FANGLORD_JAGUAR_ID,
  GORGEBLOOM_ID,
  THORN_SPROUT_ID,
  ZULGAR_ID,
]);

// ---- the auras ----------------------------------------------------------------------

export interface BasinAuraGlow {
  color: number;
  /** Sprite size as a share of the body's height. */
  size: number;
  /** Centre height as a share of the body's height. */
  lift: number;
  alpha: number;
  /** Breathing: depth (0..1) and rate (Hz). */
  pulse: number;
  pulseHz: number;
}

export interface BasinAuraMotes {
  /** Motes a second at the full effects tier. */
  rate: number;
  color: readonly [number, number, number];
  size: readonly [number, number];
  life: number;
  up: number;
  gravity: number;
  glow: boolean;
  alpha: number;
  /** Spawn radius as a share of the body's height. */
  spread: number;
  /** Shed only while the bearer moves (a trail). */
  trail: boolean;
}

export interface BasinAuraLook {
  glow?: BasinAuraGlow;
  motes?: BasinAuraMotes;
}

const MOTES: Omit<BasinAuraMotes, 'rate' | 'color' | 'size' | 'life'> = {
  up: 0.6,
  gravity: 0,
  glow: true,
  alpha: 0.85,
  spread: 0.3,
  trail: false,
};

/** How every boss aura dresses its bearer (cosmetic: thins on the low tier). */
export const BASIN_AURA_LOOKS: Readonly<Record<string, BasinAuraLook>> = {
  // Pollinated: a golden haze and pollen drifting off the player.
  [BLOOM_POLLINATED]: {
    // A golden haze of pollen hanging round them, drifting thick.
    glow: { color: 0xffd860, size: 1.9, lift: 0.5, alpha: 0.58, pulse: 0.25, pulseHz: 1.6 },
    motes: { ...MOTES, rate: 26, color: [1, 0.86, 0.35], size: [0.34, 0.1], life: 2.2 },
  },
  // Call of the Hunt: both beasts burn red while it holds.
  [BEAST_CALL_OF_THE_HUNT]: {
    glow: { color: 0xff3a24, size: 1.25, lift: 0.55, alpha: 0.42, pulse: 0.35, pulseHz: 5 },
    motes: { ...MOTES, rate: 8, color: [1, 0.35, 0.18], size: [0.35, 0.1], life: 1, up: 1.6 },
  },
  // The Jaguar Avatar: a jade spirit round Zulgar and a jade trail behind him.
  [ZULGAR_AVATAR]: {
    glow: { color: 0x5fe0a0, size: 1.6, lift: 0.5, alpha: 0.6, pulse: 0.25, pulseHz: 1.6 },
    motes: {
      ...MOTES,
      rate: 45,
      color: [0.4, 1, 0.66],
      size: [1.2, 0.25],
      life: 0.75,
      up: 0.3,
      spread: 0.12,
      trail: true,
    },
  },
  // Sunstruck: a gold flare on the slowed avatar.
  [ZULGAR_SUNSTRUCK]: {
    glow: { color: 0xfff0a0, size: 1.1, lift: 0.6, alpha: 0.75, pulse: 0.4, pulseHz: 9 },
    motes: { ...MOTES, rate: 16, color: [1, 0.92, 0.55], size: [0.3, 0.08], life: 0.9, up: 2 },
  },
  // Vanished: dark jade smoke where he stood (the art phase hides the model).
  [ZULGAR_VANISHED]: {
    motes: {
      ...MOTES,
      rate: 22,
      color: [0.16, 0.24, 0.2],
      size: [2, 5],
      life: 1.4,
      up: 1.5,
      glow: false,
      alpha: 0.5,
      spread: 0.2,
    },
  },
  // Mauled: a red daze and blood on the knocked-down prey.
  [ZULGAR_MAULED]: {
    glow: { color: 0xff2a2a, size: 0.7, lift: 0.4, alpha: 0.38, pulse: 0.3, pulseHz: 3 },
    motes: {
      ...MOTES,
      rate: 7,
      color: [0.7, 0.05, 0.05],
      size: [0.18, 0.1],
      life: 0.9,
      up: 0.4,
      gravity: 9,
      glow: false,
      alpha: 1,
    },
  },
  // Rending Bite's bleed: a few drops.
  [BEAST_RENDING_BITE]: {
    motes: {
      ...MOTES,
      rate: 4,
      color: [0.65, 0.04, 0.05],
      size: [0.16, 0.1],
      life: 0.9,
      up: 0.3,
      gravity: 9,
      glow: false,
      alpha: 1,
    },
  },
  // Digesting: acid bubbling off the tank.
  [BLOOM_DIGESTING]: {
    motes: { ...MOTES, rate: 6, color: [0.6, 0.95, 0.25], size: [0.3, 0.12], life: 1.2, up: 1 },
  },
};

/** The mark over a hunted player's head. */
export interface BasinHeadMark {
  color: number;
  /** The colour while he chases THIS prey (the aura's value2 is 1). */
  chasedColor: number;
}

export const BASIN_HEAD_MARKS: Readonly<Record<string, BasinHeadMark>> = {
  // Stalked: the jaguar's red fang mark.
  [BEAST_STALKED]: { color: 0xff3030, chasedColor: 0xff3030 },
  // Prey: Zulgar's jade claw, burning brighter on the one he chases now.
  [ZULGAR_PREY]: { color: 0x3f9a70, chasedColor: 0x7dffc0 },
};

/** A head mark's look: `chased` is the aura's value2 === 1. */
export function headMarkLook(
  auraId: string,
  chased: boolean,
  t: number,
): { color: number; alpha: number; size: number } {
  const m = BASIN_HEAD_MARKS[auraId];
  if (!m) return { color: 0xffffff, alpha: 0, size: 0 };
  // Stalked and the chased prey throb; a waiting prey only glows.
  const hot = auraId === BEAST_STALKED || chased;
  const beat = hot ? 0.5 + 0.5 * Math.sin(t * 7) : 0.5 + 0.5 * Math.sin(t * 2.2);
  return {
    color: chased ? m.chasedColor : m.color,
    alpha: hot ? 0.82 + 0.18 * beat : 0.5 + 0.1 * beat,
    size: hot ? 1.45 + 0.15 * beat : 1.05,
  };
}

/** Pack Bond's spirit cord: 0 when broken, brighter as master and jaguar
 *  close. The renderer cannot know the difficulty; the aura only stands while
 *  the bond holds, so the reach is at least the distance (a heroic bond past
 *  the normal reach still draws, at its faintest). */
export function bondCordStrength(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return bondStrength(distance, Math.max(distance, BEAST_TUNING.bondReach));
}

/** The stone jaguar head's eyes over the basin. */
export type JaguarEyesState = 'idle' | 'fight' | 'hunt';

// ---- the seedpods -------------------------------------------------------------------

/** A seedpod's swell: it fattens and its glow climbs as it nears sprouting;
 *  ripe, it throbs hard. `elapsed` is seconds since it landed (or ripened). */
export function podSwell(
  ripe: boolean,
  elapsed: number,
  t: number,
): { scale: number; glow: number } {
  const e = Math.max(0, elapsed);
  if (ripe) {
    const urgency = Math.min(1, e / BLOOM_TUNING.podRipeFor);
    const beat = Math.abs(Math.sin(t * (6 + 6 * urgency)));
    return { scale: 1.1 + 0.12 * beat + 0.1 * urgency, glow: 0.75 + 0.5 * beat };
  }
  const grow = Math.min(1, e / (BLOOM_TUNING.podSprout - BLOOM_TUNING.podRipeFor));
  const beat = 0.5 + 0.5 * Math.sin(t * 2.4);
  return { scale: 0.8 + 0.25 * grow + 0.03 * beat, glow: 0.25 + 0.35 * grow + 0.1 * beat };
}

/** Seconds a Seed Rain seed flies from the bloom to its pod, and a spit. */
export const SEED_FLIGHT_SECONDS = 0.8;
export const SPIT_FLIGHT_SECONDS = 0.35;

/** A point on a lobbed seed's arc at `u` (0..1), written into `out`. */
export function seedArcInto(
  out: { x: number; y: number; z: number },
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  u: number,
  apex: number,
): { x: number; y: number; z: number } {
  const k = Math.min(1, Math.max(0, u));
  out.x = from.x + (to.x - from.x) * k;
  out.z = from.z + (to.z - from.z) * k;
  out.y = from.y + (to.y - from.y) * k + apex * 4 * k * (1 - k);
  return out;
}

// ---- the sun glyphs -----------------------------------------------------------------

/** A sun glyph's overlay: lit burns gold, dark smoulders as an ember. */
export function glyphLook(lit: boolean, t: number): { lit: number; alpha: number; halo: number } {
  if (lit) return { lit: 1, alpha: 0.8 + 0.2 * Math.sin(t * 1.7), halo: 0.55 };
  return { lit: 0, alpha: 0.55 + 0.15 * Math.sin(t * 1.1), halo: 0.12 };
}

// ---- shock rings --------------------------------------------------------------------

/** A shock ring racing out to `radius` over `seconds`, fading. */
export function shockRingLook(
  elapsed: number,
  radius: number,
  seconds: number,
): { radius: number; alpha: number } {
  const t = Math.max(0, Math.min(1, seconds > 0 ? elapsed / seconds : 1));
  const ease = 1 - (1 - t) ** 3;
  return { radius: radius * (0.12 + 1.0 * ease), alpha: (1 - t) ** 1.3 };
}

/** The ward's shimmer on the jaguar (0..1) at clock `t`. */
export function wardShimmer(t: number): number {
  return 0.55 + 0.25 * Math.sin(t * 3.3) + 0.2 * Math.sin(t * 7.9);
}

// ---- the bosses' splashes (basin_splash.ts crowns and ripples, tinted) ----------

/** One burst's crown and its rings. */
export interface BossSplash {
  crown: CrownSpec;
  ripple?: RippleSpec;
  tint: number;
}

/** Every boss burst that throws the floor up: sand, pulp, thorns, acid, gold,
 *  spirit. Reaches stay inside each mechanic's own telegraphed radius. */
export const BOSS_SPLASH = {
  quake: {
    crown: { r0: 1.8, r1: BEAST_TUNING.quakeRadius, height: 2.8, life: 1.0 },
    ripple: { reach: BEAST_TUNING.quakeRadius, life: 1.3, rings: 3 },
    tint: 0xe2c49a,
  },
  landing: {
    crown: { r0: 1.0, r1: 3.6, height: 1.8, life: 0.8 },
    ripple: { reach: 4.5, life: 1.1, rings: 2 },
    tint: 0xd8c4a0,
  },
  podStomp: {
    crown: { r0: 0.35, r1: 1.7, height: 1.8, life: 0.65 },
    tint: 0xd6e05a,
  },
  /** A seed thumping into the loam (inside its pod's touch ring). */
  podLand: {
    crown: { r0: 0.3, r1: 1.4, height: 1.2, life: 0.55 },
    ripple: { reach: 1.6, life: 0.7, rings: 2 },
    tint: 0xb8a070,
  },
  sprout: {
    crown: { r0: 0.5, r1: 2.6, height: 3.4, life: 0.9 },
    ripple: { reach: 3.5, life: 1.0, rings: 2 },
    tint: 0x6f9a3a,
  },
  lash: {
    crown: { r0: 0.4, r1: 1.6, height: 2.6, life: 0.75 },
    tint: 0x7aa84a,
  },
  gorge: {
    crown: { r0: 0.8, r1: 2.6, height: 2.6, life: 0.85 },
    ripple: { reach: 3.2, life: 1.0, rings: 2 },
    tint: 0xb6ff5a,
  },
  pulse: {
    crown: { r0: 2.0, r1: ZULGAR_TUNING.pulseRadius, height: 2.4, life: 0.9 },
    ripple: { reach: ZULGAR_TUNING.pulseRadius, life: 1.2, rings: 3 },
    tint: 0x9affd0,
  },
  sunstruck: {
    crown: { r0: 0.8, r1: 4.0, height: 4.6, life: 0.85 },
    ripple: { reach: 5, life: 1.0, rings: 2 },
    tint: 0xffd870,
  },
  ambush: {
    crown: { r0: 1.2, r1: ZULGAR_TUNING.ambushRadius, height: 3.2, life: 0.9 },
    ripple: { reach: ZULGAR_TUNING.ambushRadius + 1, life: 1.2, rings: 3 },
    tint: 0xd8c4a0,
  },
} as const satisfies Record<string, BossSplash>;
