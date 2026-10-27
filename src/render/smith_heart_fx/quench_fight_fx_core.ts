// Pure plan of the Guardian of the Quench's fight effects (quench_fight_fx.ts
// and quench_blades_fx.ts paint them; docs/design/raid/smith_heart.md section
// 7.3): the cold on the players' bodies and the huddle's warmth, the freeze
// and its shatter, the ice cracking under a lingering huddle and the holes of
// freezing water, a trapped player, the shore ice, the Smith's four blades
// (sunk, waking, floating, flying), the echoes' footprints and the safe lee
// behind each blade, heroic's crossing lane. The sim's numbers are read
// (quench_ids.ts, the layout), never tuned here.
//
// Readability (binding): the cold's frost on every body, every crack, hole,
// echo footprint, lee, lane and the splash's ring round a frozen player draw
// at their exact sizes on EVERY tier; only the mist, the motes, the glints,
// the splashes and the shakes thin.
//
// Three-free, DOM-free, deterministic (a hash, never rng).

import {
  QUENCH,
  QUENCH_BLADE_H,
  QUENCH_BLADE_SPOTS,
  QUENCH_RIMEWALL,
} from '../../sim/content/smith_heart_layout';
import {
  bladeStateOf,
  crackOf,
  echoOf,
  laneOf,
  QUENCH_CUES,
  QUENCH_OBJECTS,
  type QuenchBladeState,
  QUENCH_TUNING as T,
} from '../../sim/encounters/smith_heart/quench_ids';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';

export { breathClaimOrigin as quenchClaimOrigin } from './breath_fight_fx_core';

/** The palette. A footprint's rim is a threat colour (the floor telegraph's
 *  rule); the safe lee is a sanctuary's mint (the Breath's calm), the warmth
 *  the one warm gold on the lake, the cold the vein's own pale blue. */
export const QUENCH_FIGHT_COLORS = {
  danger: TELEGRAPH_THREAT_COLORS.danger,
  lethal: TELEGRAPH_THREAT_COLORS.lethal,
  control: TELEGRAPH_THREAT_COLORS.control,
  /** Behind a blade: always safe. */
  safe: 0x7af2c8,
  safeEdge: 0xe8fff4,
  /** The ice's accent on the telegraphs. */
  accent: 0xbfeaff,
  /** The huddle's warmth. */
  warm: 0xffb45a,
  warmCore: [1.0, 0.72, 0.38] as const,
  ember: [1.0, 0.64, 0.3] as const,
  /** The cold creeping over a body. */
  frost: [0.8, 0.92, 1.0] as const,
  frostDeep: [0.3, 0.55, 0.78] as const,
  /** The freezing water. */
  water: [0.03, 0.08, 0.14] as const,
  waterLit: [0.2, 0.42, 0.6] as const,
  /** The cracks' light (the vein's pale light, never a threat colour). */
  crackLight: [0.78, 0.94, 1.0] as const,
  /** The blades' light. */
  bladeLight: 0x7fd4ff,
  bladeCore: 0xe6f8ff,
  mist: [0.72, 0.82, 0.92] as const,
  shard: [0.78, 0.92, 1.0] as const,
} as const;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

/** The lake's floor height (instance-local). */
export const QUENCH_FLOOR_H = QUENCH.lake.h;
/** The lake's middle (instance-local) and how far the fight reaches. */
export const QUENCH_LAKE_CENTRE = { x: QUENCH.lake.x, z: QUENCH.lake.z } as const;
export const QUENCH_FIGHT_REACH = QUENCH.shelf.rx + 30;

// ---- the objects ---------------------------------------------------------------------

export type QuenchObjectKind = 'crack' | 'hole' | 'echo' | 'lane' | 'rim' | 'rimRise' | 'blade';

/** Which of the fight's objects a template is, or null. */
export function quenchObjectKind(templateId: string): QuenchObjectKind | null {
  if (templateId === QUENCH_OBJECTS.hole) return 'hole';
  if (templateId === QUENCH_OBJECTS.rim) return 'rim';
  if (templateId === QUENCH_OBJECTS.rimRise) return 'rimRise';
  if (crackOf(templateId) !== null) return 'crack';
  if (echoOf(templateId) !== null) return 'echo';
  if (laneOf(templateId) !== null) return 'lane';
  if (bladeStateOf(templateId) !== null) return 'blade';
  return null;
}

/** The cues the fight's painter draws itself (no generic burst doubles them). */
const CLAIMED: ReadonlySet<string> = new Set([
  QUENCH_CUES.freeze,
  QUENCH_CUES.shatter,
  QUENCH_CUES.hole,
  QUENCH_CUES.plunge,
  QUENCH_CUES.climb,
  QUENCH_CUES.wake,
  QUENCH_CUES.echo,
  QUENCH_CUES.cross,
  QUENCH_CUES.rim,
  QUENCH_CUES.thaw,
]);

export function quenchFightClaims(ability: string | null | undefined): boolean {
  return ability !== null && ability !== undefined && CLAIMED.has(ability);
}

// ---- the cold on a body --------------------------------------------------------------

/** How the cold dresses a body at `cold` (0..100): how much of it the frost
 *  covers (0..1, creeping up from the feet: `height` the share of the body),
 *  the crystals' count of `max`, and the urgent pulse past three quarters. */
export interface FrostLook {
  cover: number;
  height: number;
  crystals: number;
  pulse: number;
}

export function frostLook(
  cold: number,
  t: number,
  max: number,
  out: FrostLook = { cover: 0, height: 0, crystals: 0, pulse: 0 },
): FrostLook {
  const c = clamp01(cold / T.coldMax);
  out.cover = c;
  out.height = 0.12 + 0.88 * smooth(c);
  out.crystals = Math.round(max * Math.min(1, c * 1.15));
  out.pulse = c >= 0.75 ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
  return out;
}

/** One frost crystal on a body (its frame: y up from the feet), deterministic
 *  per crystal index: where round the body, how high a share of the frost's
 *  reach, its size and lean. */
export function frostCrystal(
  i: number,
  out: { a: number; r: number; y: number; size: number; lean: number } = {
    a: 0,
    r: 0,
    y: 0,
    size: 0,
    lean: 0,
  },
): { a: number; r: number; y: number; size: number; lean: number } {
  out.a = fightHash(i, 3) * Math.PI * 2;
  out.r = 0.32 + 0.22 * fightHash(i, 5);
  out.y = fightHash(i, 7);
  out.size = 0.18 + 0.28 * fightHash(i, 11);
  out.lean = 0.3 + 0.6 * fightHash(i, 13);
  return out;
}

// ---- the freeze ----------------------------------------------------------------------

/** The ice block round a frozen player `elapsed` seconds into the freeze:
 *  how far it has grown up the body (0..1) and its cracks (0..1, the
 *  shatter close at 1). */
export function frozenLook(elapsed: number): { grow: number; crack: number } {
  return {
    grow: smooth(elapsed / 0.35),
    crack: smooth((elapsed - 1.2) / (T.freezeSeconds - 1.2)),
  };
}

// ---- the ice: cracks and holes -------------------------------------------------------

/** A crack `elapsed` seconds into its `warn`: the crack web's spread (0..1
 *  of the hole's radius), its light, and the telegraph's fill. */
export function crackLook(
  elapsed: number,
  warn: number,
): { spread: number; light: number; fill: number } {
  const f = clamp01(warn > 0 ? elapsed / warn : 1);
  return {
    spread: 0.25 + 0.75 * smooth(f * 1.1),
    light: 0.4 + 0.6 * f + (f > 0.8 ? 0.4 * Math.sin(elapsed * 30) : 0),
    fill: f,
  };
}

/** A hole `elapsed` seconds after it opened: the water's churn (the burst of
 *  the breaking ice settling) and the rim's fresh white. */
export function holeLook(elapsed: number): { churn: number; fresh: number } {
  return {
    churn: 0.25 + 0.75 * (1 - smooth(elapsed / 3)),
    fresh: 1 - smooth(elapsed / 8),
  };
}

// ---- the blades ----------------------------------------------------------------------

/** How far a blade has risen out of the lake, and how upright it stands: the
 *  sunk pose (0), the tearing free over the awakening's bar (rise 0..1 as
 *  `wakeFill` runs), floating (1). */
export interface BladeLook {
  /** Lift of its foot over the ice (yards). */
  lift: number;
  /** 0 its sunk lean (the kit's), 1 upright. */
  upright: number;
  /** Its light (0..1, more while an echo is held). */
  light: number;
  /** A tremble while it tears free. */
  shake: number;
}

/** Seconds a blade takes to settle into its float once awake. */
export const BLADE_SETTLE_SECONDS = 0.8;
/** How high a floating blade's foot hangs over the ice (yards). */
export const BLADE_FLOAT_LIFT = 1.6;
/** The tip a floating blade shows under its kit piece (the sunk piece is
 *  cut at the ice): its length below the cut (yards). */
export const BLADE_TIP = 3.2;

export function bladeLook(
  state: QuenchBladeState,
  since: number,
  wakeFill: number,
  t: number,
  index: number,
  out: BladeLook = { lift: 0, upright: 0, light: 0, shake: 0 },
): BladeLook {
  const bob = 0.25 * Math.sin(t * 1.3 + index * 1.7);
  switch (state) {
    case 'sunk':
      out.lift = 0;
      out.upright = 0;
      out.light = 0.15;
      out.shake = 0;
      break;
    case 'wake': {
      // Tearing free: trembling first, then wrenched up out of the ice.
      const f = clamp01(wakeFill);
      const up = smooth((f - 0.35) / 0.65);
      out.lift = (BLADE_TIP + BLADE_FLOAT_LIFT) * up;
      out.upright = up;
      out.light = 0.2 + 0.8 * f;
      out.shake = f < 0.4 ? f / 0.4 : 1 - up * 0.8;
      break;
    }
    case 'float':
    case 'fly': {
      const settle = smooth(since / BLADE_SETTLE_SECONDS);
      out.lift = BLADE_TIP + BLADE_FLOAT_LIFT + bob * settle;
      out.upright = 1;
      out.light = 0.75;
      out.shake = 0;
      break;
    }
  }
  return out;
}

/** The blades' homes and their sunk yaws (the layout's). */
export const BLADE_HOMES = QUENCH_BLADE_SPOTS;
export const BLADE_HEIGHT = QUENCH_BLADE_H;

// ---- the echoes and the lee ----------------------------------------------------------

/** An echo's footprint: its arc and reach (the attack it repeats). */
export function echoShape(kind: 'breath' | 'strike'): { arcDeg: number; range: number } {
  return kind === 'breath'
    ? { arcDeg: T.breathArcDeg, range: T.breathRange }
    : { arcDeg: T.strikeArcDeg, range: T.strikeRange };
}

/** The lee's footprint behind a blade: a half disc of the sim's radius,
 *  turned away from the attack (`facing` + pi). */
export const LEE_SHAPE = { arcDeg: 180, range: T.leeR } as const;

/** An echo's telegraph `elapsed` seconds after it showed, `total` to its
 *  landing: the fill (0..1). */
export function echoFill(elapsed: number, total: number): number {
  return clamp01(total > 0 ? elapsed / total : 1);
}

// ---- the warmth ----------------------------------------------------------------------

/** A warm body as the painter reads it. */
export interface WarmBody {
  id: number;
  x: number;
  z: number;
}

/** The threads of warmth between warm bodies within the sim's reach of each
 *  other (index pairs into `bodies`, written into `out`, at most `cap`).
 *  Returns how many. */
export function warmthLinks(
  bodies: readonly WarmBody[],
  out: Int16Array,
  cap: number,
  reach: number = T.warmR,
): number {
  let n = 0;
  for (let i = 0; i < bodies.length && n < cap; i++)
    for (let j = i + 1; j < bodies.length && n < cap; j++) {
      if (Math.hypot(bodies[i].x - bodies[j].x, bodies[i].z - bodies[j].z) > reach) continue;
      out[n * 2] = i;
      out[n * 2 + 1] = j;
      n++;
    }
  return n;
}

// ---- the shore ice -------------------------------------------------------------------

/** The shore ice's rise `elapsed` seconds after its slabs appeared (0 under
 *  the ice, 1 standing). */
export function rimRise(elapsed: number): number {
  const f = clamp01(elapsed / T.rimRise);
  return 1 - (1 - f) ** 3;
}

/** One shard of a shore-ice slab (the slab's frame: x along the ring, z out
 *  from the lake), deterministic per slab and shard. */
export function rimShard(
  slab: number,
  k: number,
  out: { x: number; z: number; h: number; w: number; lean: number; yaw: number } = {
    x: 0,
    z: 0,
    h: 0,
    w: 0,
    lean: 0,
    yaw: 0,
  },
): { x: number; z: number; h: number; w: number; lean: number; yaw: number } {
  const R = QUENCH_RIMEWALL;
  // Spread along the slab's length, overlapping their neighbours; the back
  // row taller, leaning out from the lake (local +z is outward).
  const back = k % 2 === 1;
  out.x = (k / (RIM_SHARDS - 1) - 0.5) * R.hw * 2.1 + (fightHash(slab, k * 3) - 0.5) * 0.9;
  out.z = (back ? 0.35 : -0.25) * R.hd * 2 + (fightHash(slab, k * 3 + 1) - 0.5) * 0.4;
  out.h =
    R.h *
    (back ? 0.95 + 0.6 * fightHash(slab, k * 3 + 2) : 0.55 + 0.45 * fightHash(slab, k * 3 + 2));
  out.w = 1.0 + 0.9 * fightHash(slab + 7, k);
  out.lean = (back ? 0.28 : 0.12) + 0.3 * fightHash(slab + 11, k);
  out.yaw = (fightHash(slab + 13, k) - 0.5) * 1.1;
  return out;
}
/** Shards per shore-ice slab. */
export const RIM_SHARDS = 6;

// ---- pools ---------------------------------------------------------------------------

/** Pools at full density. */
export const QUENCH_FIGHT_POOLS = {
  /** Players dressed in frost (a raid and room to spare). */
  bodies: 14,
  /** Frost crystals on one body at full cold. */
  crystalsPer: 16,
  frozen: 10,
  trapped: 10,
  warm: 14,
  links: 24,
  cracks: 16,
  holes: T.holeMax,
  echoes: 8,
  lees: 4,
  rimSlabs: QUENCH_RIMEWALL.segments,
  splashRings: 10,
} as const;

/** A small integer hash in [0, 1). */
export function fightHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x3c6ef372) ^ Math.imul(b | 0, 0x2c1b3c6d)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
