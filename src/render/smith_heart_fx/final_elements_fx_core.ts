// The Masterless Strength's OWN elements' look, as numbers (Jose's brief of
// 2026-11-19 (b); the painter is final_elements_fx.ts, a part of FinalKitFx):
//   - which of the fight's objects is which (`elementObjectKind`): a steam
//     cloud, a lava pool, a Firestorm or Avalanche lane, a hailstone's spot, a
//     Storm Spire, Mythic's residue;
//   - Elemental Strike on the tank's body (`strikeAuraLook`): the element's
//     aura growing with the stacks, at its fullest at the swap;
//   - Elemental Fusion in the boss's hands (`fusionOrbLook`): the two
//     elements' orbs swelling through the bar and drawn together at its end;
//   - the combos: the steam's billows (`steamPuff`), the flame wall's run
//     along its lane (`laneFront`, the sim's own speed), a hailstone's fall
//     (`hailFall`), an Avalanche spike's rise and sink behind its front
//     (`spikeRise`), a spire's charge (`spireGlow`), the links' fill;
//   - Opposing Elements: each element's colour and sigil (`POLARITY_LOOKS`:
//     a flame, a snowflake, a mountain, a lightning bolt, told apart by SHAPE).
// Every footprint is the sim's exact size; the timings are the sim's
// (final_elements_ids.ts ELEMENT_TUNING), never tuned here.
//
// Three-free, DOM-free, deterministic.

import type { SmithHeartVein } from '../../sim/content/smith_heart_layout';
import {
  ELEMENT_TUNING as E,
  ELEMENT_CUES,
  ELEMENT_OBJECTS,
  elementLaneOf,
  hailOf,
  type Polarity,
  residueOf,
  spireOf,
  steamOf,
} from '../../sim/encounters/smith_heart/final_elements_ids';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

// ---- the objects ----------------------------------------------------------------------

export type ElementObjectKind =
  | 'steamWarn'
  | 'steam'
  | 'lava'
  | 'fireWarn'
  | 'fireBurn'
  | 'hail'
  | 'avalancheWarn'
  | 'avalancheRun'
  | 'spireCharge'
  | 'spireFire'
  | 'residueFire'
  | 'residueFrost'
  | 'residueStorm'
  | 'residueStone';

/** Which of the elements' objects `templateId` is, or null. */
export function elementObjectKind(templateId: string): ElementObjectKind | null {
  if (!templateId.startsWith('sh_final_')) return null;
  const st = steamOf(templateId);
  if (st) return st === 'warn' ? 'steamWarn' : 'steam';
  if (templateId === ELEMENT_OBJECTS.lava) return 'lava';
  const fire = elementLaneOf(ELEMENT_OBJECTS.firePrefix, templateId);
  if (fire) return fire.state === 'warn' ? 'fireWarn' : 'fireBurn';
  const av = elementLaneOf(ELEMENT_OBJECTS.avalanchePrefix, templateId);
  if (av) return av.state === 'warn' ? 'avalancheWarn' : 'avalancheRun';
  if (hailOf(templateId) !== null) return 'hail';
  const sp = spireOf(templateId);
  if (sp) return sp.state === 'charge' ? 'spireCharge' : 'spireFire';
  const res = residueOf(templateId);
  if (res === 'fire') return 'residueFire';
  if (res === 'frost') return 'residueFrost';
  if (res === 'storm') return 'residueStorm';
  if (res === 'stone') return 'residueStone';
  return null;
}

/** The cues the painter claims (drawn here, sounded by FinalAudio). */
const CLAIMED: ReadonlySet<string> = new Set(Object.values(ELEMENT_CUES));
export function elementFxClaims(ability: string | null | undefined): boolean {
  return ability !== null && ability !== undefined && CLAIMED.has(ability);
}

// ---- the palette ----------------------------------------------------------------------

/** Each element's light (hex) and its rgb for the particles. Fire orange,
 *  frost a cold blue, storm violet, stone ochre: the four read apart. */
export const ELEMENT_FX_COLORS = {
  heat: 0xff7a24,
  quench: 0x8fd6ff,
  breath: 0xa98bff,
  hammer: 0xd4a050,
  steam: 0xf4f7fa,
  magma: 0xff5a14,
  crust: 0x1a0d08,
  spireStone: 0x23202a,
  spireVein: 0xa070ff,
  fireRgb: [1.0, 0.55, 0.16] as const,
  fireCoreRgb: [1.0, 0.86, 0.5] as const,
  frostRgb: [0.72, 0.9, 1.0] as const,
  stormRgb: [0.74, 0.6, 1.0] as const,
  stoneRgb: [0.7, 0.55, 0.32] as const,
  steamRgb: [0.94, 0.95, 0.97] as const,
  emberRgb: [1.0, 0.42, 0.1] as const,
} as const;

/** A vein's element light (hex). */
export function veinColor(v: SmithHeartVein): number {
  return ELEMENT_FX_COLORS[v];
}

/** A vein's rgb for the particles. */
export function veinRgb(v: SmithHeartVein): readonly [number, number, number] {
  return v === 'heat'
    ? ELEMENT_FX_COLORS.fireRgb
    : v === 'quench'
      ? ELEMENT_FX_COLORS.frostRgb
      : v === 'breath'
        ? ELEMENT_FX_COLORS.stormRgb
        : ELEMENT_FX_COLORS.stoneRgb;
}

// ---- Opposing Elements ----------------------------------------------------------------

export interface PolarityLook {
  /** The sigil's shape in the sigil shader (0 flame, 1 snowflake, 2
   *  mountain, 3 lightning bolt). */
  shape: number;
  color: number;
  rgb: readonly [number, number, number];
  /** The body's dressing: rising flames, frost crystals and cold mist,
   *  orbiting rocks, crawling sparks. */
  body: 'flames' | 'crystals' | 'rocks' | 'sparks';
}

export const POLARITY_LOOKS: Readonly<Record<Polarity, PolarityLook>> = {
  fire: { shape: 0, color: 0xff7a1e, rgb: [1.0, 0.5, 0.12], body: 'flames' },
  ice: { shape: 1, color: 0x7fd2ff, rgb: [0.6, 0.86, 1.0], body: 'crystals' },
  earth: { shape: 2, color: 0xd09a3c, rgb: [0.82, 0.6, 0.26], body: 'rocks' },
  lightning: { shape: 3, color: 0xb07cff, rgb: [0.74, 0.52, 1.0], body: 'sparks' },
};

/** The sigil over a marked head: its height over the floor, its size, its
 *  bob and its pulse (quicker as the mark runs out). Reduced motion holds it
 *  still and lit. */
export function sigilLook(
  clock: number,
  left: number,
  total: number,
  reduced: boolean,
): { lift: number; size: number; pulse: number } {
  const late = total > 0 ? 1 - clamp01(left / total) : 0;
  if (reduced) return { lift: 3.4, size: 1.35, pulse: 1 };
  const rate = 2.2 + 5 * late;
  return {
    lift: 3.4 + Math.sin(clock * 2.1) * 0.12,
    size: 1.35 + 0.08 * Math.sin(clock * rate),
    pulse: 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(clock * rate * 2)),
  };
}

/** The four orbiting pieces' (rocks, crystals) place round a body: angle,
 *  height and size, the k-th of n. */
export function orbitPiece(
  clock: number,
  k: number,
  n: number,
  speed: number,
): { angle: number; height: number; radius: number; size: number } {
  const a = (k / n) * Math.PI * 2 + clock * speed * (k % 2 === 0 ? 1 : -0.8);
  return {
    angle: a,
    height: 0.4 + 1.6 * ((k * 0.618) % 1) + 0.15 * Math.sin(clock * 1.7 + k),
    radius: 0.95 + 0.25 * ((k * 0.37) % 1),
    size: 0.2 + 0.12 * ((k * 0.53) % 1),
  };
}

// ---- Elemental Strike -----------------------------------------------------------------

/** The tank's element aura at `stacks`: its strength 0..1 (full at the
 *  swap and past it), its reach round the body, the pieces it wears
 *  (crystals, plates), and its emission rate (particles a second). */
export function strikeAuraLook(stacks: number): {
  strength: number;
  radius: number;
  pieces: number;
  rate: number;
  danger: boolean;
} {
  const s = Math.max(0, stacks);
  const strength = clamp01(s / E.swapAt);
  return {
    strength,
    radius: 0.9 + 0.12 * Math.min(s, 8),
    pieces: Math.min(8, Math.round(s * 1.5)),
    rate: 6 + 9 * Math.min(s, 8),
    danger: s >= E.swapAt,
  };
}

// ---- Elemental Fusion -----------------------------------------------------------------

/** The two orbs in its hands through the bar (`fill` 0..1): their size,
 *  their glow, and how far they are drawn in toward each other (1 meeting at
 *  the bar's end). */
export function fusionOrbLook(fill: number): { size: number; glow: number; draw: number } {
  const f = clamp01(fill);
  return {
    size: 0.6 + 1.5 * smooth(f / 0.8),
    glow: 0.45 + 0.55 * f,
    draw: smooth((f - 0.72) / 0.28),
  };
}

// ---- the combos -----------------------------------------------------------------------

/** The height a hailstone drops from (yards): low enough to cross a raid
 *  camera's frame for most of its fall. */
export const HAIL_DROP = 20;

/** A steam cloud's k-th billow (of n): its offset from the cloud's middle,
 *  its height, its size, all turning slowly. Three tiers: a wide churning
 *  foot hugging the floor, a body, and a crown rolling over the top, so the
 *  cloud stands as a thick column of steam, never a flat puff. */
export function steamPuff(
  clock: number,
  k: number,
  n: number,
  radius: number,
  seed: number,
): { x: number; y: number; z: number; size: number } {
  // Three tiers sitting ON the scald: a wide dense foot of small billows
  // over the whole circle, a body, a crown; each rises a little and is
  // reborn at its foot (the painter keeps every foot over the floor).
  const tier = k < n * 0.5 ? 0 : k < n * 0.82 ? 1 : 2;
  // Each billow rolls up its tier and is reborn at its foot (the churn of
  // boiling steam): its own phase, swelling then thinning as it climbs.
  const t = (clock * (0.09 + 0.03 * tier) + k * 0.618 + seed) % 1;
  const swell = 0.55 + 0.45 * Math.sin(Math.PI * t);
  const a =
    (k / n) * Math.PI * 2 * 2.3 + seed + clock * (0.22 - tier * 0.06) * (k % 2 === 0 ? 1 : -1);
  const spread = tier === 0 ? 0.8 : tier === 1 ? 0.5 : 0.24;
  const ring = radius * spread * (0.55 + 0.45 * ((k * 0.61 + seed) % 1));
  const lift = tier === 0 ? 0 : tier === 1 ? 2.4 : 4.2;
  return {
    x: Math.cos(a) * ring,
    y: lift + 0.5 * ((k * 0.43 + seed * 0.3) % 1) + 1.6 * t,
    z: Math.sin(a) * ring,
    size:
      swell *
      radius *
      (tier === 0 ? 0.5 : tier === 1 ? 0.62 : 0.52) *
      (0.85 + 0.3 * ((k * 0.29 + seed * 0.7) % 1)),
  };
}

/** A lane's front (yards from its start) `age` seconds after it set off,
 *  on the sim's own run, and the share of its length run. */
export function laneFront(age: number, length: number, run: number): number {
  if (age <= 0) return 0;
  return Math.min(length, (length / Math.max(0.1, run)) * age);
}

/** A hailstone `left` seconds before it lands (of `warn`): its height over
 *  the floor (it drops in the last stretch of the warning), and whether it
 *  shows yet. */
export function hailFall(left: number, warn: number): { height: number; shown: boolean } {
  // The stone falls the last 0.9 s of its warning from 34 yd (seen
  // coming), accelerating into its circle.
  const drop = Math.min(warn, 1.1);
  if (left > drop) return { height: HAIL_DROP, shown: false };
  const t = clamp01(1 - left / drop);
  return { height: HAIL_DROP * (1 - t * t), shown: true };
}

/** An Avalanche spike `d` yards along its lane once the front is at
 *  `front` and the run began `age` seconds ago: its height share 0..1
 *  (bursting up as the front passes, holding, sinking back). */
export function spikeRise(d: number, front: number, sinceFront: number): number {
  if (front < d) return 0;
  if (sinceFront < 0.12) return smooth(sinceFront / 0.12);
  if (sinceFront < 0.9) return 1;
  return clamp01(1 - (sinceFront - 0.9) / 0.6);
}

/** A Storm Spire's charge `age` seconds into its life: its rise out of the
 *  floor (0..1), its veins' light (0..1, flickering hotter toward the
 *  discharge), whether the links show on the floor. */
export function spireGlow(age: number): { rise: number; veins: number; links: boolean } {
  const rise = smooth(age / 0.7);
  const charge = clamp01(age / E.spireCharge);
  return {
    rise,
    veins: 0.15 + 0.85 * charge * charge,
    links: age >= E.spireShowAt,
  };
}

/** The links' fill through the charge (0 as they show, 1 at the
 *  discharge). */
export function linkFill(age: number): number {
  return clamp01((age - E.spireShowAt) / Math.max(0.1, E.spireCharge - E.spireShowAt));
}

/** The flame wall's height and its flicker at `t` seconds of its run. */
export function flameWall(t: number): { height: number; alpha: number } {
  // About three times a player's height, licking higher and lower.
  return { height: 8.5 + 1.2 * Math.sin(t * 9), alpha: smooth(t / 0.15) };
}

/** The stack count's pips round a tank (one gem per stack, up to the cap):
 *  the k-th of n's angle and height at `clock`, so the count reads at a
 *  glance whatever the element (a shape, not only a colour). */
export function stackPip(clock: number, k: number, n: number): { angle: number; height: number } {
  return {
    angle: (k / Math.max(1, n)) * Math.PI * 2 + clock * 1.6,
    height: 2.35 + 0.08 * Math.sin(clock * 3 + k),
  };
}

/** The pips' bright colour per element (white-gold for the Heat, so it
 *  stands out of the Heat quarter's own orange). */
export const STACK_PIP_COLORS = {
  heat: 0xfff0b8,
  quench: 0xd2f4ff,
  breath: 0xe6d8ff,
  hammer: 0xffe0a0,
} as const;

/** The painter's fixed pools. */
export const ELEMENT_FX_POOLS = {
  /** Tanks wearing strike stacks (two, a third for a late swap). */
  tanks: 3,
  /** Stack pips a tank shows (the strike's cap). */
  pips: 9,
  /** Pieces worn per tank (crystals, plates). */
  tankPieces: 8,
  /** Marked players (Mythic marks eight) and their orbiting pieces. */
  marks: 10,
  markPieces: 6,
  /** Steam clouds (Mythic five) and their billows. */
  clouds: 6,
  billows: 30,
  /** Flame walls (two lanes on Heroic and Mythic). */
  walls: 3,
  /** Hailstones in the air (four a wave, overlapping waves). */
  hail: 14,
  /** The frost splats hailstones leave (fading). */
  splats: 10,
  /** Avalanche spikes: lanes (two waves of six) times spikes a lane. */
  spikeLanes: 12,
  spikesPerLane: 12,
  /** Storm Spires (two groups can overlap). */
  spires: 8,
  /** Lava pools' bubbling. */
  lava: 8,
} as const;
