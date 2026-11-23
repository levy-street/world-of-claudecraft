// PURE plan of Morthen's fight on the Rite Ring and the Knellwyrm's heroic
// Burning Knell (morthen_rite_fx.ts and its painters): the telegraph specs,
// the shape tests (each agreeing with the sim's own), the candle looks, the
// ward's cracks and shards, the Grasp's hands, the Knell's half and its fire,
// and the kit spots measured off the shipped Blender kit. No three, no DOM, no
// clock of its own; in RENDER_PURE_CORES, tested by
// tests/morthen_rite_fx_core.test.ts.
//
// Presentation only: every timing a player reacts to is the sim's (cast bars,
// aura clocks, encounter objects and their template ids); this decides only
// how bright, how big and where.

import { KNELL_TUNING, RITE_RING } from '../../sim/encounters/hollow_crypt/ids';
import {
  MORTHEN_TUNING,
  RITE_CANDLE_DARK,
  RITE_CANDLE_LIT,
  RITE_CANDLE_NAMED,
  RITE_CANDLE_SPOTS,
} from '../../sim/encounters/hollow_crypt/morthen_ids';
import { TELEGRAPH_ACCENTS, TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';

const T = MORTHEN_TUNING;

// ---- the telegraphs (threat colour per the shared palette) -------------------------------

export interface RiteTelegraphSpec {
  color: number;
  accent: number;
  /** Yards: a ring's or a fan's radius. */
  radius: number;
  arcDeg: number;
}

/** Every floor telegraph of the fight. The colour is the THREAT (the shared
 *  palette, tests/floor_telegraph_look.test.ts), the element rides the accent. */
export const MORTHEN_TELEGRAPHS: Readonly<
  Record<'pulse' | 'reap' | 'grasp' | 'knell', RiteTelegraphSpec>
> = {
  // Shadow Pulse: avoidable damage round him (step out).
  pulse: {
    color: TELEGRAPH_THREAT_COLORS.danger,
    accent: TELEGRAPH_ACCENTS.shadow,
    radius: T.pulseRadius,
    arcDeg: 360,
  },
  // Reap the Unquiet: his signature hit, the one that kills if you stay.
  reap: {
    color: TELEGRAPH_THREAT_COLORS.lethal,
    accent: TELEGRAPH_THREAT_COLORS.lethal,
    radius: T.reapRange,
    arcDeg: T.reapArcDeg,
  },
  // Grasp of the Grave: the hands root (control), then bite.
  grasp: {
    color: TELEGRAPH_THREAT_COLORS.control,
    accent: TELEGRAPH_ACCENTS.bone,
    radius: T.graspRadius,
    arcDeg: 360,
  },
  // The Burning Knell: the heroic wipe check, clearly red.
  knell: {
    color: TELEGRAPH_THREAT_COLORS.lethal,
    accent: TELEGRAPH_THREAT_COLORS.lethal,
    radius: KNELL_TUNING.reach,
    arcDeg: 180,
  },
};

/** Is a point (dx, dz from his centre) inside the Reap's sweep for `facing`?
 *  The sim's own test (mob/trash_kit/targets.ts inCone): reach past his centre
 *  and the arc about his locked facing. Pure. */
export function inReapSweep(dx: number, dz: number, facing: number): boolean {
  if (Math.hypot(dx, dz) > T.reapRange) return false;
  if (dx === 0 && dz === 0) return true;
  let d = Math.atan2(dx, dz) - facing;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= (T.reapArcDeg * Math.PI) / 360;
}

/** The Reap's crescent after it lands: how far round the 120 degree arc the
 *  blade has cut `t` seconds in (right edge 0 to left edge 1), the fading
 *  tail, and the trail's strength (null before it starts and once it fades). */
export const REAP_SWEEP_SEC = 0.34;
export function reapSweep(t: number): { head: number; tail: number; alpha: number } | null {
  const k = t / REAP_SWEEP_SEC;
  if (k < 0 || k > 2.2) return null;
  const e = Math.min(1, k);
  const head = e * e * (3 - 2 * e);
  const tail = Math.max(0, Math.min(1, (k - 0.3) / 1.1));
  const alpha = k <= 1 ? 1 : Math.max(0, 1 - (k - 1) / 1.2);
  return { head, tail: Math.min(tail, head), alpha };
}

/** The Shadow Pulse's charge over its bar (0..1): the rim's glow and the
 *  shadow drawn in toward him, swelling as it nears the toll. */
export function pulseCharge(fill: number): number {
  const f = Math.min(1, Math.max(0, fill));
  return 0.35 + 0.65 * f * f;
}

// ---- the Remembrance Candles ----------------------------------------------------------------

/** Measured off the shipped kit (public/models/props/hollow_crypt_kit.glb,
 *  Kit_RemembranceCandle: the tallow pillar tops out at 3.55 yd, its baked
 *  flame burns from there to 5.22). */
export const CANDLE_WICK_Y = 3.55;
export const CANDLE_FLAME_TIP_Y = 5.22;
/** The tallow pillar's radius (the kit's `candle(..., 3.1, 0.95)`). */
export const CANDLE_TALLOW_RADIUS = 0.95;

/** The Ledger of Names on the altar's lectern (instance-local), measured off
 *  the kit's Kit_RiteAltar glow (the altar at (0, 207), rot 0: the open book
 *  lies 1.35 yd to its -z side, toward the ring's centre, at about 1.95). */
export const RITE_LEDGER = { x: 0, z: 207 - 1.35, y: 1.95 } as const;

export type CandleState = 'default' | 'dark' | 'named' | 'lit';

/** A candle's state from its encounter object's template (null: no object,
 *  the Rite is not on: the decor's own look). */
export function candleStateOf(templateId: string | null | undefined): CandleState {
  if (templateId === RITE_CANDLE_LIT) return 'lit';
  if (templateId === RITE_CANDLE_NAMED) return 'named';
  if (templateId === RITE_CANDLE_DARK) return 'dark';
  return 'default';
}

export interface CandleLook {
  /** The kit's baked flame and the crypt lights' flame cone and halo. */
  decorFlame: boolean;
  /** The candle's point light, as a share of its authored intensity. */
  light: number;
  /** The dim cold glow at a snuffed wick (so a dark candle is still found). */
  ember: number;
  /** The thread of smoke off a snuffed wick. */
  smoke: number;
  /** The guiding glow the Ledger names (heroic, 0..1). */
  guide: number;
  /** The column of remembrance light over a relit candle. */
  column: number;
  /** The tall bright flame of a relit candle (its strength). */
  flame: number;
}

/** The look of a candle in `state`, `clock` seconds in, written into `out`. */
export function candleLook(
  state: CandleState,
  clock: number,
  out: CandleLook = {
    decorFlame: true,
    light: 1,
    ember: 0,
    smoke: 0,
    guide: 0,
    column: 0,
    flame: 0,
  },
): CandleLook {
  out.decorFlame = state === 'default' || state === 'lit';
  out.light = state === 'lit' ? 1.8 : state === 'default' ? 1 : 0.12;
  out.ember = state === 'dark' || state === 'named' ? 0.55 : 0;
  out.smoke = state === 'dark' || state === 'named' ? 1 : 0;
  // A named candle's guide never drops below a readable floor.
  out.guide = state === 'named' ? 0.72 + 0.28 * Math.sin(clock * 4.2) : 0;
  out.column = state === 'lit' ? 1 : 0;
  out.flame = state === 'lit' ? 1 : 0;
  return out;
}

/** Which Remembrance Candle stands at an instance-local spot (-1: none). */
export function candleIndexAt(lx: number, lz: number): number {
  let best = -1;
  let bestD = 3;
  for (let i = 0; i < RITE_CANDLE_SPOTS.length; i++) {
    const c = RITE_CANDLE_SPOTS[i];
    const d = Math.hypot(lx - c.x, lz - c.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The relight's flame swelling as the channel runs (0..1 of the bar). */
export function relightFill(castRemaining: number, castTotal: number): number {
  if (!(castTotal > 0)) return 0;
  return Math.min(1, Math.max(0, 1 - castRemaining / castTotal));
}

/** Drain motes a second pulled out of a lighter: thicker as the price mounts. */
export function drainMoteRate(fill: number): number {
  return 26 + 34 * Math.min(1, Math.max(0, fill));
}

/** A candle catching: the burst's strength `age` seconds after it lit. */
export function igniteFlash(age: number): number {
  if (age < 0 || age > 1.6) return 0;
  return age < 0.08 ? age / 0.08 : (1 - (age - 0.08) / 1.52) ** 2;
}

// ---- the Unquiet Ward -----------------------------------------------------------------------

/** The ward's dome over him at the altar (yards: a half-ellipsoid that holds
 *  his whole drawn body). */
export const WARD_RADIUS = 6.4;
export const WARD_HEIGHT = 11.5;

/** How much of the ward still holds with `lit` candles relit (1 whole, 0 gone). */
export function wardIntegrity(lit: number): number {
  return 1 - Math.min(4, Math.max(0, Math.floor(lit))) / 4;
}

/** A crack's growth `age` seconds after its candle caught (0..1, eased). */
export function crackGrowth(age: number): number {
  if (!(age > 0)) return 0;
  const k = Math.min(1, age / 0.55);
  return 1 - (1 - k) ** 3;
}

/** The shard plan of the ward's shattering: `n` plates over the dome
 *  (golden-angle spiral, deterministic), each with its outward direction, a
 *  launch speed and a spin. Unit directions; y up. */
export function wardShards(
  n: number,
): { x: number; y: number; z: number; speed: number; spin: number }[] {
  const out: { x: number; y: number; z: number; speed: number; spin: number }[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    // Upper hemisphere: y from about 0.05 to 0.98.
    const y = 0.05 + 0.93 * ((i + 0.5) / n);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * golden;
    const h = (((Math.sin(i * 91.7 + 3.1) * 43758.5453) % 1) + 1) % 1;
    out.push({ x: Math.sin(a) * r, y, z: Math.cos(a) * r, speed: 7 + 7 * h, spin: 2 + 6 * h });
  }
  return out;
}

/** The Rite Broken's stun read `remaining` seconds from its end (0..1): the
 *  holy bands bind him hard as it lands and loosen at its end. */
export function brokenBind(remaining: number, duration: number): number {
  if (!(duration > 0) || !(remaining > 0)) return 0;
  const age = duration - remaining;
  const inK = Math.min(1, age / 0.35);
  const outK = Math.min(1, remaining / 0.8);
  return inK * outK;
}

/** Grave Chill's mist density for the Rite's bite (value2: shadow a second,
 *  rising as the Rite goes on). Light by design: it never hides a telegraph. */
export function chillMist(bite: number): number {
  if (!(bite > 0)) return 0;
  return Math.min(1, 0.45 + 0.08 * (bite - T.chillBase));
}

// ---- Grasp of the Grave ---------------------------------------------------------------------

/** The ring's fill `age` seconds after it appeared (1: the hands erupt). */
export function graspFill(age: number): number {
  return Math.min(1, Math.max(0, age / T.graspFuse));
}

/** The hands bursting up out of the floor `age` seconds after they erupt
 *  (0 under the floor, 1 risen; a short overshoot as they claw up). */
export function handsRise(age: number): number {
  if (!(age > 0)) return 0;
  if (age < 0.18) {
    const k = age / 0.18;
    return 1.12 * (1 - (1 - k) ** 3);
  }
  const k = Math.min(1, (age - 0.18) / 0.2);
  return 1.12 - 0.12 * k;
}

/** The hands sinking back once they let go (`age` after the ring left). */
export const HANDS_SINK_SEC = 0.5;
export function handsSink(age: number): number {
  if (!(age > 0)) return 1;
  const k = Math.min(1, age / HANDS_SINK_SEC);
  return 1 - k * k;
}

/** Where the hands of one ring stand (unit radius, deterministic): a ring
 *  clawing up round the rim and a few inside it, each turned inward. */
export function graspHandSpots(
  count: number,
): { x: number; z: number; yaw: number; scale: number }[] {
  const out: { x: number; z: number; yaw: number; scale: number }[] = [];
  const rim = Math.max(1, count - 2);
  for (let i = 0; i < count; i++) {
    const inner = i >= rim;
    const a = inner ? (i - rim) * Math.PI + 0.7 : (i / rim) * Math.PI * 2 + 0.3 * Math.sin(i * 1.7);
    const r = inner ? 0.32 : 0.78 + 0.08 * Math.sin(i * 2.3);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    // Turned to face the ring's centre, leaning in over it.
    out.push({
      x,
      z,
      yaw: Math.atan2(-x, -z),
      scale: inner ? 1.15 : 0.9 + 0.15 * Math.cos(i * 1.3),
    });
  }
  return out;
}

// ---- the Burning Knell ----------------------------------------------------------------------

/** The marked half's index from its object's facing (knellHalfYaw: 0 north
 *  +z, 1 east +x, 2 south, 3 west). */
export function knellHalfIndex(facing: number): number {
  const q = Math.round(facing / (Math.PI / 2));
  return ((q % 4) + 4) % 4;
}

/** Is a point (dx, dz from the ring's centre) inside the half the object's
 *  `facing` marks? The sim's own test (ids.ts inKnellHalf): within the fire's
 *  reach, on the facing's side of the diameter. Pure. */
export function inMarkedHalf(
  facing: number,
  dx: number,
  dz: number,
  reach = KNELL_TUNING.reach,
): boolean {
  if (Math.hypot(dx, dz) > reach) return false;
  return dx * Math.sin(facing) + dz * Math.cos(facing) >= 0;
}

/** The mark's layers over its bar (0..1): the red edge brightens and the
 *  embers thicken as the fire nears. */
export function knellMarkLook(fill: number): { edge: number; embers: number } {
  const f = Math.min(1, Math.max(0, fill));
  return { edge: 0.55 + 0.45 * f * f, embers: 0.15 + 0.85 * f ** 1.5 };
}

/** The ghost fire on the half `age` seconds after it landed: a flare, the
 *  pour held through the breath, then the flames playing out. */
export function knellFire(age: number): number {
  const hold = KNELL_TUNING.breathSeconds;
  if (age < 0 || age > hold + 0.7) return 0;
  if (age < 0.06) return age / 0.06;
  if (age <= hold) return 1;
  return 1 - (age - hold) / 0.7;
}

/** The scorch the fire leaves: char and embers fading over this long. */
export const KNELL_SCORCH_SEC = 6;
export function knellScorch(age: number): { char: number; embers: number } {
  if (age < 0 || age > KNELL_SCORCH_SEC) return { char: 0, embers: 0 };
  const char =
    age < 0.4 ? age / 0.4 : Math.max(0, 1 - (age - 0.4) / (KNELL_SCORCH_SEC - 0.4)) ** 0.8;
  const embers = Math.max(0, 1 - age / (KNELL_SCORCH_SEC * 0.7));
  return { char, embers };
}

/** The ring the Knell burns (instance-local centre and the fire's reach). */
export const KNELL_RING = { x: RITE_RING.x, z: RITE_RING.z, reach: KNELL_TUNING.reach } as const;

// ---- the Bound Souls ------------------------------------------------------------------------

/** A Bound Soul's own look on the trash engine's walker orb (WALKER_LOOKS):
 *  his soul-green, floating at a tall man's head, drawn big. */
export const BOUND_SOUL_LOOK = { tint: 0x9dff7a, hover: 2.3, size: 1.9 } as const;

/** The soul tearing out of its alcove: the column's strength `age` seconds
 *  after the Gravecall. */
export function soulRise(age: number): number {
  if (age < 0 || age > 1.4) return 0;
  return age < 0.12 ? age / 0.12 : (1 - (age - 0.12) / 1.28) ** 1.5;
}

/** Gorged on the Dead deepening his soul fire: the rib fire's rate and size
 *  for `stacks` (1 with none, rising and capped at the sim's max stacks). */
export function gorgedFire(stacks: number): number {
  const s = Math.min(T.gorgedMaxStacks, Math.max(0, Math.floor(stacks)));
  return 1 + 0.12 * s;
}

// ---- rig gestures (VisualDef attackByAbility keys, never casts) ----------------------------

/** The Knellwyrm calls the fire over the marked half: its SkyRoar one-shot
 *  (a flier's cast clip never plays aloft: its `jump` flight loop owns the
 *  rig while it is up, so the knell's beats ride one-shots). */
export const KNELL_GESTURE_SKY_ROAR = 'crypt_knell_sky_roar';
/** It pours the ghost fire: the Strafe dive, neck plunged and jaws wide. */
export const KNELL_GESTURE_POUR = 'crypt_knell_pour';

// ---- the remembrance flame ------------------------------------------------------------------

/** The relit candles' holy fire as (heat, r, g, b) stops: the warm tallow
 *  flame of the living, soot to deep amber to gold to a white-hot heart, the
 *  answer to his soul-green ghost fire. */
export const REMEMBRANCE_FIRE_RAMP: readonly (readonly [number, number, number, number])[] = [
  [0.15, 0.05, 0.02, 0.01],
  [0.35, 0.45, 0.12, 0.02],
  [0.55, 0.95, 0.45, 0.08],
  [0.75, 1.0, 0.78, 0.36],
  [0.9, 1.0, 0.94, 0.72],
  [1.0, 1.0, 1.0, 0.95],
];

/** GLSL for the crypt particle kit's fire shader (crypt_fx_particles.ts
 *  FIRE_FRAG) with this ramp in place of the ghost fire's: the same
 *  `vec3 ghostRamp(float h)` signature, warm stops. */
export function remembranceRampGlsl(): string {
  const f = (v: number) => v.toFixed(3);
  let prev = 0;
  const lines = REMEMBRANCE_FIRE_RAMP.map(([h, r, g, b], i) => {
    const from = i === 0 ? 'vec3(0.0)' : 'c';
    const line = `  ${i === 0 ? 'vec3 c' : 'c'} = mix(${from}, vec3(${f(r)}, ${f(g)}, ${f(b)}), smoothstep(${f(prev)}, ${f(h)}, h));`;
    prev = h;
    return line;
  });
  return `vec3 ghostRamp(float h) {\n${lines.join('\n')}\n  return c;\n}\n`;
}

// ---- the crag top ---------------------------------------------------------------------------

/** How far under the ring floor a spot still counts as the crag top (the sim's
 *  own band for the Knell: KNELL_TUNING.floorBand). The Choir Loft and the
 *  Bone Stair lie inside the fire's reach on the map but far under the rim:
 *  nothing of the fight paints them or the cliff face. */
export const CRAG_FLOOR_BAND = KNELL_TUNING.floorBand;

/** Is a floor height `gy` on the crag top whose floor is `refY`? */
export function onCragFloor(gy: number, refY: number, band = CRAG_FLOOR_BAND): boolean {
  return gy >= refY - band;
}

/**
 * How far from (cx, cz) along the unit direction (dx, dz) the crag top runs
 * before its floor drops more than `band` under `refY` (the rim), capped at
 * `maxR`: a coarse march then a bisection, so a telegraph draped out to it
 * stops on the rim instead of draping down the cliff onto the floor below.
 */
export function cragRimRadius(
  groundY: (x: number, z: number) => number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
  refY: number,
  maxR: number,
  band = CRAG_FLOOR_BAND,
  step = 0.75,
): number {
  let inside = 0;
  for (let r = step; r < maxR + step; r += step) {
    const rr = Math.min(r, maxR);
    if (!onCragFloor(groundY(cx + dx * rr, cz + dz * rr), refY, band)) {
      let lo = inside;
      let hi = rr;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        if (onCragFloor(groundY(cx + dx * mid, cz + dz * mid), refY, band)) lo = mid;
        else hi = mid;
      }
      return lo;
    }
    inside = rr;
    if (rr >= maxR) break;
  }
  return maxR;
}
