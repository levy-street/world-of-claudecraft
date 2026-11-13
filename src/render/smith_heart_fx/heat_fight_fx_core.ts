// Pure plan of the Guardian of the Heat's fight effects (heat_fight_fx.ts and
// its parts paint them; docs/design/raid/smith_heart.md section 7.4, "the
// well of the first flame"): the first wellspring (calm, overflowing),
// the overflow's rivers of the first flame, the Hearthseeds throbbing toward
// their burst, Wakefire's bands building and igniting, a Rolling Cinder's
// fall, and the burning patches (a cinder's scorch, a Cinder Trail).
// The sim's numbers are read (heat_ids.ts, the layout), never tuned here.
//
// Readability (binding): every footprint (a river's lane, a seed's core and
// its reach, every Wakefire band, a cinder's landing, every burning patch)
// draws at its exact size on EVERY tier; only sparks, embers, haze, smoke
// and spray thin, the shakes go under reduced motion.
//
// The Heat is the Hearth: white-gold fire and molten gold, never volcanic red;
// a footprint's rim is the floor telegraph's threat colour, never these.
// Three-free, DOM-free, deterministic (a hash, never rng).

import { HEARTH_WELL } from '../../sim/content/smith_heart_layout';
import {
  HEAT_CUES,
  HEAT_OBJECTS,
  type HeatRiverState,
  type HeatWellState,
  type HeatZoneState,
  heatTimedOf,
  riverOf,
  swellLaneOf,
  HEAT_TUNING as T,
  WHEEL_ARCS_DEG,
  wellOf,
  wheelOf,
  ZONE_BANDS,
  zoneOf,
} from '../../sim/encounters/smith_heart/heat_ids';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';

export { breathClaimOrigin as heatClaimOrigin } from './breath_fight_fx_core';

/** The palette: the first flame's molten gold (linear 0..1, hex for the
 *  sprites), the threat colours for the rims. */
export const HEAT_FIGHT_COLORS = {
  danger: TELEGRAPH_THREAT_COLORS.danger,
  lethal: TELEGRAPH_THREAT_COLORS.lethal,
  control: TELEGRAPH_THREAT_COLORS.control,
  /** The telegraphs' element accent. */
  accent: 0xffe6a0,
  /** Molten: white-hot core, gold, amber, a deep umber glow, basalt crust. */
  core: [1.0, 0.97, 0.86] as const,
  gold: [1.0, 0.78, 0.36] as const,
  amber: [0.98, 0.55, 0.16] as const,
  deep: [0.55, 0.22, 0.05] as const,
  crust: [0.075, 0.062, 0.055] as const,
  spark: [1.0, 0.88, 0.55] as const,
  ember: [1.0, 0.64, 0.24] as const,
  smoke: [0.27, 0.24, 0.22] as const,
  haze: [0.95, 0.85, 0.66] as const,
  ring: 0xffe6b0,
  ringGold: 0xffb848,
  white: 0xfff8ec,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** The wellspring (instance-local), the Hearth's middle for the scan, and how
 *  far the fight reaches from it. */
export const HEAT_WELL = { x: HEARTH_WELL.x, z: HEARTH_WELL.z, r: HEARTH_WELL.r } as const;
export const HEARTH_CENTRE = { x: -212, z: 0 } as const;
export const HEAT_FIGHT_REACH = 70;

// ---- the objects ---------------------------------------------------------------------

export type HeatObjectKind =
  | 'wheel'
  | 'well'
  | 'fist'
  | 'lane'
  | 'wave'
  | 'river'
  | 'seed'
  | 'zone'
  | 'fall'
  | 'scorch'
  | 'trail';

const O = HEAT_OBJECTS;

/** Which of the fight's objects a template is, or null. */
export function heatObjectKind(templateId: string): HeatObjectKind | null {
  if (templateId.startsWith(HEAT_OBJECTS.wheelPrefix)) return 'wheel';
  if (!templateId.startsWith('sh_heat_')) return null;
  if (wellOf(templateId) !== null) return 'well';
  if (templateId === O.wave) return 'wave';
  if (swellLaneOf(templateId) !== null) return 'lane';
  if (riverOf(templateId) !== null) return 'river';
  if (zoneOf(templateId) !== null) return 'zone';
  if (heatTimedOf(O.fistPrefix, templateId) !== null) return 'fist';
  if (heatTimedOf(O.seedPrefix, templateId) !== null) return 'seed';
  if (heatTimedOf(O.fallPrefix, templateId) !== null) return 'fall';
  if (heatTimedOf(O.scorchPrefix, templateId) !== null) return 'scorch';
  if (heatTimedOf(O.trailPrefix, templateId) !== null) return 'trail';
  return null;
}

/** The cues the fight's painters draw themselves (no generic burst, nova or
 *  beam doubles them). */
const CLAIMED: ReadonlySet<string> = new Set(Object.values(HEAT_CUES));

export function heatFightClaims(ability: string | null | undefined): boolean {
  return ability !== null && ability !== undefined && CLAIMED.has(ability);
}

// ---- the wellspring --------------------------------------------------------------------

export interface WellLook {
  /** The molten pool's heat (its brightness), its surge (it swells up over
   *  its lip, 0..1) and how fast it boils. */
  heat: number;
  surge: number;
  boil: number;
  /** Its glow's breath (0..1): a slow heave at rest, quicker and deeper as
   *  the fight deepens, a hard throb while the guardian is under and the
   *  Hearth overflows. */
  pulse: number;
}

/** The wellspring in `state` with the guardian in `phase` (0 out of the
 *  fight), render time `t`, written into `out`. */
export function wellLook(
  state: HeatWellState,
  phase: number,
  t: number,
  out: WellLook = { heat: 0, surge: 0, boil: 0, pulse: 0 },
): WellLook {
  const deep = clamp01((Math.max(1, phase) - 1) / 3);
  out.heat = phase > 0 ? 0.85 + 0.35 * deep : 0.7;
  out.surge = 0;
  out.boil = 0.35 + 0.4 * deep;
  // A slow breath (one every 4 s out of the fight, every 2.5 s by phase 3).
  const rate = phase > 0 ? 0.25 + 0.15 * deep : 0.18;
  const b = 0.5 + 0.5 * Math.sin(t * rate * Math.PI * 2);
  out.pulse = (phase > 0 ? 0.45 + 0.3 * deep : 0.3) * b * b;
  if (state === 'over') {
    // The Hearth overflows: it heaves over its lip in slow swells.
    out.heat = 1.45;
    out.surge = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 1.7));
    out.boil = 1;
    // Each swell a throb of the glow, on the heave's own clock.
    out.pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.7));
  }
  return out;
}

// ---- the overflow's rivers ---------------------------------------------------------------

export interface RiverLook {
  /** The lane telegraph's fill (warn), whether it shows. */
  fill: number;
  lane: boolean;
  /** How far down its length the fire has run (0..1), and its heat. */
  front: number;
  heat: number;
}

/** A river in `state`, `age` seconds into it (that state's `seconds`). */
export function riverLook(
  state: HeatRiverState,
  age: number,
  seconds: number,
  out: RiverLook = { fill: 0, lane: false, front: 0, heat: 0 },
): RiverLook {
  const span = Math.max(0.1, seconds);
  if (state === 'warn') {
    out.fill = clamp01(age / span);
    out.lane = true;
    out.front = 0;
    // The pool's lip lights toward it as it brims.
    out.heat = 0.3 * out.fill;
    return out;
  }
  out.fill = 1;
  out.front = smooth(age / 0.7);
  out.heat = clamp01((span - age) / 0.6);
  out.lane = out.heat > 0;
  return out;
}

// ---- the Hearthseeds ---------------------------------------------------------------------

export interface SeedLook {
  /** 0..1 of its life spent (the telegraph's fill). */
  fill: number;
  /** Its throb (0..1 on the beat; the beat quickens to the burst). */
  beat: number;
  /** Its glow, and how big the seed burns. */
  glow: number;
  size: number;
}

/** A seed `age` seconds after it fell, `life` its template's life. */
export function seedLook(
  age: number,
  life: number,
  out: SeedLook = { fill: 0, beat: 0, glow: 0, size: 0 },
): SeedLook {
  const f = clamp01(age / Math.max(0.1, life));
  out.fill = f;
  // From a slow pulse to a frantic one: the phase is the integral of a rate
  // rising from 1 to 7 beats a second.
  const phase = age * (1 + 3 * f * f);
  const b = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  out.beat = b * b;
  const land = smooth(age / 0.3);
  out.glow = land * (0.6 + 0.9 * f + 0.6 * out.beat);
  out.size = land * (0.55 + 0.45 * f) * (1 + 0.18 * out.beat);
  return out;
}

/** The ring a seed draws at its reach: faint at first, brighter to the burst
 *  (the falloff's whole reach, every tier), and the hot core's radius (where
 *  the burst nearly kills). */
export const SEED_CORE_R = 7;

// ---- Wakefire ------------------------------------------------------------------------------

export interface ZoneLook {
  /** 0..1 of the warning built (the telegraph's fill), its burn (0..1). */
  build: number;
  burn: number;
}

/** A band in `state`, `age` seconds into it (that state's `seconds`). */
export function zoneLook(
  state: HeatZoneState,
  age: number,
  seconds: number,
  out: ZoneLook = { build: 0, burn: 0 },
): ZoneLook {
  const span = Math.max(0.1, seconds);
  if (state === 'warn') {
    out.build = clamp01(age / span);
    out.burn = 0;
    return out;
  }
  out.build = 1;
  // It erupts at once, then dies down over its burn.
  out.burn = smooth(age / 0.12) * (0.45 + 0.55 * clamp01((span - age) / span));
  return out;
}

/** A Wheel slice's bearings (radians, sim facing), for the shader's clip. */
export function wheelArc(slice: number): { from: number; to: number } {
  const a = WHEEL_ARCS_DEG[Math.max(0, Math.min(WHEEL_ARCS_DEG.length - 1, slice))];
  return { from: (a[0] * Math.PI) / 180, to: (a[1] * Math.PI) / 180 };
}

/** A band's inner and outer radius (yards). */
export function zoneRadii(band: number): readonly [number, number] {
  return ZONE_BANDS[Math.max(0, Math.min(ZONE_BANDS.length - 1, band))];
}

// ---- a Rolling Cinder's fall, the burning patches ------------------------------------------

/** A fall `age` seconds into its `seconds` of warning: the fireball's height
 *  over the floor (yards), the telegraph's fill. */
export function fallLook(
  age: number,
  seconds: number,
  out: { height: number; fill: number } = { height: 0, fill: 0 },
): { height: number; fill: number } {
  const k = clamp01(age / Math.max(0.1, seconds));
  out.fill = k;
  // Accelerating down out of the smoke overhead.
  out.height = 40 * (1 - k * k);
  return out;
}

/** A burning patch `age` seconds into its `life`: its burn (0..1, catching,
 *  then dying in its last two seconds). */
export function patchLook(age: number, life: number): number {
  const catchUp = smooth(age / 0.4);
  const die = clamp01((life - age) / 2);
  return catchUp * die;
}

// ---- the template decoders, memoized for the frame path ----------------------------------

/** A decoder's results by template id: a fight's templates are a bounded
 *  set (states and tenths of fixed times), so after a template's first sight
 *  the frame path decodes without allocating. Cleared if it ever grows past
 *  a few hundred (a guard, never expected). */
function memo<T>(decode: (id: string) => T): (id: string) => T {
  const cache = new Map<string, T>();
  return (id) => {
    let v = cache.get(id);
    if (v === undefined) {
      if (cache.size > 512) cache.clear();
      v = decode(id);
      cache.set(id, v);
    }
    return v;
  };
}

/** riverOf, zoneOf and heatTimedOf for the painters' frame paths. */
export const riverOfCached = memo(riverOf);
export const zoneOfCached = memo(zoneOf);
export const wheelOfCached = memo(wheelOf);
export const wellOfCached = memo(wellOf);
const timedCaches = new Map<string, (id: string) => number | null>();
export function heatTimedOfCached(prefix: string, templateId: string): number | null {
  let f = timedCaches.get(prefix);
  if (!f) {
    f = memo((id) => heatTimedOf(prefix, id));
    timedCaches.set(prefix, f);
  }
  return f(templateId);
}

/** A small integer hash in [0, 1). */
export function heatFightHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x2d7a3f91) ^ Math.imul(b | 0, 0x1b873593)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Pools at full density (the sim's own caps; ten raiders). */
export const HEAT_FIGHT_POOLS = {
  rivers: T.riverCount * 2,
  seeds: T.seedCap,
  zones: ZONE_BANDS.length,
  falls: T.cinderCap,
  patches: T.trailCap + T.scorchCap,
  cinders: T.cinderCap,
  adds: 16,
  bodies: 12,
} as const;
