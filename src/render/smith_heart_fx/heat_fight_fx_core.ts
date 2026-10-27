// Pure plan of the Guardian of the Heat's fight effects (heat_fight_fx.ts
// paints them; docs/design/raid/smith_heart.md section 7.4): the Kindled
// Crystals tearing up out of the basalt and burning out, their reach, their
// rays (who is being struck held in a beam until the next ray), a ray sent
// back into the guardian, Crystal Burn climbing a body with its stacks, the
// channel across the Hearth (still, brimming, flowing), heroic's Knell
// Embers, the Hearth Pulse, the overheat's wind-up over the floor and
// Hearthburst's white wave. The sim's numbers are read (heat_ids.ts, the
// layout), never tuned here.
//
// Readability (binding): every rise spot, crystal reach, ray, the channel's
// lane while it brims and flows, every ember patch, the burn on a body and the
// wind-up's floor glow draw at their exact sizes on EVERY tier; only the
// sparks, embers, haze and smoke thin, the shakes go under reduced motion.
//
// The Heat is the Hearth: white-gold fire, never volcanic red; a footprint's
// rim is the floor telegraph's threat colour, never these. Three-free,
// DOM-free, deterministic (a hash, never rng).

import { HEARTH_CHANNEL } from '../../sim/content/smith_heart_layout';
import {
  channelOf,
  crystalOf,
  embersOf,
  HEAT_CUES,
  type HeatChannelState,
  riseOf,
  HEAT_TUNING as T,
} from '../../sim/encounters/smith_heart/heat_ids';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';

export { breathClaimOrigin as heatClaimOrigin } from './breath_fight_fx_core';

/** The palette. The crystals' reach is the soak's gold (the Falling Rock's
 *  precedent: stand in it); the first flame white-gold. */
export const HEAT_FIGHT_COLORS = {
  danger: TELEGRAPH_THREAT_COLORS.danger,
  lethal: TELEGRAPH_THREAT_COLORS.lethal,
  /** A crystal's reach: a gold to stand in. */
  soak: 0xffc94a,
  soakEdge: 0xfff2c4,
  /** The telegraphs' element accent. */
  accent: 0xffe6a0,
  core: [1.0, 0.96, 0.84] as const,
  fire: [1.0, 0.74, 0.32] as const,
  deep: [0.78, 0.42, 0.12] as const,
  crust: [0.09, 0.075, 0.065] as const,
  spark: [1.0, 0.86, 0.52] as const,
  ember: [1.0, 0.62, 0.24] as const,
  smoke: [0.3, 0.27, 0.25] as const,
  haze: [0.95, 0.85, 0.66] as const,
  /** A ray sent back into the guardian burns deeper gold. */
  back: [1.0, 0.56, 0.16] as const,
  ring: 0xffe6b0,
  ringGold: 0xffb848,
  white: 0xfff8ec,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** The Hearth's floor height and middle (instance-local), and how far the
 *  fight reaches from it. */
export const HEAT_FLOOR_H = 0;
export const HEARTH_CENTRE = { x: -215, z: 0 } as const;
export const HEAT_FIGHT_REACH = 70;
/** The channel's line (instance-local) and its length. */
export const CHANNEL_LINE = {
  x: HEARTH_CHANNEL.x,
  z0: HEARTH_CHANNEL.z0,
  z1: HEARTH_CHANNEL.z1,
  length: HEARTH_CHANNEL.z1 - HEARTH_CHANNEL.z0,
} as const;

// ---- the objects ---------------------------------------------------------------------

export type HeatObjectKind = 'rise' | 'crystal' | 'channel' | 'embers';

/** Which of the fight's objects a template is, or null. */
export function heatObjectKind(templateId: string): HeatObjectKind | null {
  if (riseOf(templateId) !== null) return 'rise';
  if (crystalOf(templateId) !== null) return 'crystal';
  if (channelOf(templateId) !== null) return 'channel';
  if (embersOf(templateId) !== null) return 'embers';
  return null;
}

/** The cues the fight's painter draws itself (no generic burst, nova or
 *  beam doubles them). */
const CLAIMED: ReadonlySet<string> = new Set(Object.values(HEAT_CUES));

export function heatFightClaims(ability: string | null | undefined): boolean {
  return ability !== null && ability !== undefined && CLAIMED.has(ability);
}

// ---- the crystals --------------------------------------------------------------------

/** Seconds a crystal takes to tear up out of the basalt. */
export const CRYSTAL_RISE_SECONDS = 0.7;
/** The last seconds of its life it flickers, failing. */
export const CRYSTAL_FAIL_SECONDS = 2.5;

/** A rise spot's warning `age` seconds in (its template's `seconds`): how far
 *  its footprint has filled, how far the cracks in the basalt have run. */
export function riseLook(
  age: number,
  seconds: number,
  out: { fill: number; crack: number } = { fill: 0, crack: 0 },
): { fill: number; crack: number } {
  const f = clamp01(age / Math.max(0.1, seconds));
  out.fill = f;
  out.crack = smooth(f * 1.2);
  return out;
}

export interface CrystalLook {
  /** 0 sunk under the floor, 1 standing. */
  rise: number;
  /** The light's strength (a swell before each ray, a flicker as it fails). */
  light: number;
  /** 0..1 of the way to its next ray (the reach ring fills to it). */
  charge: number;
  /** 0..1 of its life left. */
  left: number;
}

/** A crystal `age` seconds after it was first seen, `life` its template's
 *  life, written into `out`. Its rays fall `rayFirst` after it rises, then
 *  every `rayEvery` (the sim's own clock: what the charge fills to). */
export function crystalLook(
  age: number,
  life: number,
  out: CrystalLook = { rise: 0, light: 0, charge: 0, left: 1 },
): CrystalLook {
  out.rise = smooth(age / CRYSTAL_RISE_SECONDS);
  const left = Math.max(0, life - age);
  out.left = life > 0 ? clamp01(left / life) : 0;
  let charge: number;
  if (age < T.rayFirst) charge = age / T.rayFirst;
  else charge = ((age - T.rayFirst) % T.rayEvery) / T.rayEvery;
  out.charge = clamp01(charge);
  // A swell toward each ray, a flash just past it.
  const swell = 0.75 + 0.6 * out.charge * out.charge;
  let light = swell;
  if (left < CRYSTAL_FAIL_SECONDS) {
    const k = left / CRYSTAL_FAIL_SECONDS;
    light *= 0.45 + 0.55 * k * (0.6 + 0.4 * Math.abs(Math.sin(age * 23)));
  }
  out.light = light * (0.3 + 0.7 * out.rise);
  return out;
}

export interface BeamLook {
  /** The beam's width (yards) and strength, `since` seconds after the ray. */
  width: number;
  alpha: number;
}

/** Seconds a ray's beam stays on its target: until the next ray. */
export const BEAM_HOLD = T.rayEvery;

/** A ray's beam `since` seconds after it struck: a fat flash at the hit, a
 *  steady held beam to the next ray (who is struck stays obvious), fading at
 *  the very end; a ray sent back flashes and goes. */
export function beamLook(
  since: number,
  back: boolean,
  out: BeamLook = { width: 0, alpha: 0 },
): BeamLook {
  if (since < 0) {
    out.width = 0;
    out.alpha = 0;
    return out;
  }
  if (back) {
    const k = clamp01(since / 0.7);
    out.width = 0.7 * (1 - k * 0.6);
    out.alpha = 1 - k;
    return out;
  }
  const flash = 1 - clamp01(since / 0.25);
  const end = clamp01((BEAM_HOLD - since) / 0.3);
  out.width = 0.5 + 0.6 * flash;
  out.alpha = (0.8 + 0.2 * flash) * end;
  return out;
}

// ---- Crystal Burn on a body ------------------------------------------------------------

export interface BurnLook {
  /** How far up the body the burn has climbed (0..1 of its height). */
  cover: number;
  /** The flames' strength. */
  heat: number;
  /** A hard pulse past half the cap (0..1). */
  pulse: number;
}

/** How Crystal Burn dresses a body at `stacks`, render time `t`. */
export function burnLook(
  stacks: number,
  t: number,
  out: BurnLook = { cover: 0, heat: 0, pulse: 0 },
): BurnLook {
  const s = Math.max(0, Math.min(T.burnMax, stacks));
  if (s <= 0) {
    out.cover = 0;
    out.heat = 0;
    out.pulse = 0;
    return out;
  }
  // Ten stacks reach the shoulders; past it the flames burn hotter.
  out.cover = clamp01(0.18 + (s / 10) * 0.72);
  out.heat = clamp01(0.35 + s / 12);
  const urgent = s >= 8;
  out.pulse = urgent ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
  return out;
}

// ---- the channel -----------------------------------------------------------------------

export interface ChannelLook {
  /** The bed's own dull glow (0..1). */
  bed: number;
  /** While it brims, how far down from its head the bed has lit (0..1). */
  lit: number;
  /** While it flows, how far down the fire has run (0..1), and its heat. */
  front: number;
  fire: number;
  /** The lane telegraph: shown, and its fill. */
  lane: boolean;
  fill: number;
}

/** The channel in `state` `age` seconds into it (that state's `seconds`). */
export function channelLook(
  state: HeatChannelState,
  age: number,
  seconds: number,
  out: ChannelLook = { bed: 0, lit: 0, front: 0, fire: 0, lane: false, fill: 0 },
): ChannelLook {
  const span = Math.max(0.1, seconds);
  const k = clamp01(age / span);
  out.bed = 0.3;
  out.lit = 0;
  out.front = 0;
  out.fire = 0;
  out.lane = false;
  out.fill = 0;
  if (state === 'warn') {
    out.lit = smooth(k * 1.1);
    out.bed = 0.3 + 0.7 * out.lit;
    out.lane = true;
    out.fill = k;
  } else if (state === 'flow') {
    // The fire runs the channel's length in its first second, then burns,
    // dying down in its last.
    out.front = smooth(age / 0.9);
    out.fire = clamp01((span - age) / 0.8);
    out.bed = 1;
    out.lit = 1;
    out.lane = out.fire > 0;
    out.fill = 1;
  }
  return out;
}

// ---- Knell Embers ------------------------------------------------------------------------

/** Embers `age` seconds into their `life`: their burn (0..1, catching, then
 *  dying in the last two seconds). */
export function embersLook(age: number, life: number): number {
  const catchUp = smooth(age / 0.4);
  const die = clamp01((life - age) / 2);
  return catchUp * die;
}

// ---- the heat over the floor ---------------------------------------------------------------

/** The Hearth Pulse's ring at `heat` (0..1): its reach and its strength. */
export function pulseRing(heat: number): { radius: number; strength: number } {
  const h = clamp01(heat);
  return { radius: 9 + 13 * h, strength: 0.25 + 0.75 * h };
}

/** The floor's heat glow under the wind-up: `overheating` and the heat
 *  (0..1), render time `t`: its strength (0..1). Never brighter than a
 *  telegraph's rim. */
export function windupGlow(overheating: boolean, heat: number, t: number): number {
  if (!overheating) return 0.12 * clamp01((heat - 0.6) / 0.4);
  // Harder and faster the nearer the heat is to the top (90 to 100).
  const u = windupUrgency(heat);
  const beat = 0.5 + 0.5 * Math.sin(t * (9 + 9 * u));
  return 0.3 + 0.15 * u + 0.3 * beat * beat;
}

/** How near the overheat is through the wind-up: 0 at 90 heat, 1 at 100. */
export function windupUrgency(heat: number): number {
  return clamp01((clamp01(heat) - 0.9) / 0.1);
}

/** The wind-up's gathering: rings of heat drawn in over the floor into the
 *  guardian, one a beat, the beat quicker as the heat nears the top. Its
 *  radius (yards) and strength at render time `t`. Cosmetic, the floor glow
 *  and the gauge carry the warning. */
export function windupGather(
  t: number,
  heat: number,
  out: { radius: number; alpha: number } = { radius: 0, alpha: 0 },
): { radius: number; alpha: number } {
  const u = windupUrgency(heat);
  const period = 1.3 - 0.75 * u;
  const k = (((t / period) % 1) + 1) % 1;
  out.radius = 3 + 33 * (1 - k) ** 1.6;
  out.alpha = (0.35 + 0.45 * u) * Math.sin(Math.PI * k);
  return out;
}

/** Hearthburst's white wave `age` seconds in: its radius (yards) and
 *  strength; gone after a second and a half. */
export const BURST_WAVE_SECONDS = 1.5;
export function burstWave(
  age: number,
  out: { radius: number; alpha: number } = { radius: 0, alpha: 0 },
): { radius: number; alpha: number } {
  const k = clamp01(age / BURST_WAVE_SECONDS);
  out.radius = 4 + 48 * (1 - (1 - k) ** 3);
  out.alpha = (1 - k) ** 1.4;
  return out;
}

/** A small integer hash in [0, 1). */
export function heatFightHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2d7a3f91) ^ Math.imul(b | 0, 0x1b873593)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Pools at full density (heroic raises three crystals; a ray per crystal;
 *  every ember the sim may keep; ten raiders). */
export const HEAT_FIGHT_POOLS = {
  crystals: 4,
  rises: 4,
  beams: 4,
  embers: T.embersCap,
  bodies: 12,
} as const;
