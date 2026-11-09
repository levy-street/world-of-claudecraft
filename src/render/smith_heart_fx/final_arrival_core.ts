// The Masterless Strength's arrival (Jose's approved concept, 2026-11-09),
// the pure half: final_arrival_beam.ts paints it, final_fx.ts and
// final_body_fx.ts drive the model by it. The scene plays by itself the first
// time a living player stands in the Heart (the seal markers' arrival bit,
// heart_seal_core.ts `awakeSince`), seen from the arrival terrace, with no
// camera takeover:
//  1. dormant: the boss kneels on the Anvil like a cracked stone statue, its
//     cracks black (a still clip, its glow held at nothing);
//  2. the veins: each altar's vein lights in its element's colour and the
//     light runs down its channel across the floor toward the boss;
//  3. the beam: the four streams meet under its heart and fuse into one giant
//     column of light shooting up into the sky, swirling with the four
//     colours round a white core; the floor's shockwave, the camera's thud,
//     the sky flaring;
//  4. the collapse: the beam falls back down into the boss, its cracks fill
//     with the colours and its eyes ignite;
//  5. it stands (its Rise clip, scripts/build_masterless_strength_arrival_
//     anims.mjs) and roars (its Shift clip) with a four-colour shockwave out
//     over the raid.
// A pull during it runs the scene on to its end in under a second (the fight
// never waits on a show); a raid that first sees the heart already awake (a
// late arrival, a reconnect) sees the boss standing.
//
// The sim speaks two of the boss's lines over it (final_voice.ts
// ARRIVAL_LINE_AT: the waking whisper as it opens, the roar's line on the
// roar); ARRIVAL_VOICE here names the same beats and a test pins the two.
//
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic.

import type { SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { HEART_ALTARS, HEART_ROOM } from '../../sim/content/smith_heart_layout';
import { FINAL_BODY_CLIP, FINAL_ELEMENT_LOOK } from './final_body_core';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};
const easeOut = (v: number) => 1 - (1 - clamp01(v)) ** 3;
const easeIn = (v: number) => clamp01(v) ** 2;

/** The scene's spacing (seconds). */
export const ARRIVAL = {
  /** The statue alone while the hop's wash clears. */
  hold: 0.9,
  /** Each vein lights this long after the one before. */
  veinStep: 0.25,
  /** A vein's light runs from its altar to the boss in this long. */
  veinRun: 2.0,
  /** The beam shoots up, stands, then falls back into the boss. */
  beamRise: 0.4,
  beamHold: 2.0,
  beamFall: 0.7,
  /** The cracks lit, a breath before it pushes up off its knee. */
  riseDelay: 0.3,
  /** The Rise clip's length (the arrival anims' build script). */
  riseSeconds: 2.4,
  /** The roar's shockwave rides out this long; then the scene settles. */
  waveSeconds: 1.5,
  settle: 0.2,
} as const;

/** The veins in the order they light (each in its element's colour: the
 *  boss's own body colours, final_body_core.ts FINAL_ELEMENT_LOOK). */
export const ARRIVAL_VEINS: readonly SmithHeartVein[] = ['hammer', 'breath', 'quench', 'heat'];

/** A vein's colour in the scene (hex). */
export function arrivalVeinColor(vein: SmithHeartVein): number {
  return FINAL_ELEMENT_LOOK[vein].light;
}

/** When vein `i` (ARRIVAL_VEINS' index) lights at its altar. */
export function arrivalVeinStart(i: number): number {
  return ARRIVAL.hold + i * ARRIVAL.veinStep;
}

/** When vein `i`'s light reaches the boss. */
export function arrivalVeinArrive(i: number): number {
  return arrivalVeinStart(i) + ARRIVAL.veinRun;
}

/** The beats, seconds after the heart woke. */
export const ARRIVAL_CONVERGE = arrivalVeinArrive(ARRIVAL_VEINS.length - 1);
export const ARRIVAL_BEAM_PEAK = ARRIVAL_CONVERGE + ARRIVAL.beamRise;
export const ARRIVAL_BEAM_FALL = ARRIVAL_BEAM_PEAK + ARRIVAL.beamHold;
export const ARRIVAL_IGNITE = ARRIVAL_BEAM_FALL + ARRIVAL.beamFall;
export const ARRIVAL_RISE_AT = ARRIVAL_IGNITE + ARRIVAL.riseDelay;
export const ARRIVAL_ROAR_AT = ARRIVAL_RISE_AT + ARRIVAL.riseSeconds;
/** The roar bursts open (its Shift clip's burst beat): the shockwave. */
export const ARRIVAL_WAVE_AT = ARRIVAL_ROAR_AT + FINAL_BODY_CLIP.shiftBurst;
export const ARRIVAL_END = ARRIVAL_WAVE_AT + ARRIVAL.waveSeconds + ARRIVAL.settle;

/** The two lines the sim says over the scene (final_voice.ts
 *  ARRIVAL_LINE_AT, pinned equal by tests/smith_heart_final_arrival.test.ts):
 *  the waking whisper over the statue, the roar's line on the roar. */
export const ARRIVAL_VOICE = { wake: 0.3, roar: ARRIVAL_ROAR_AT } as const;

/** A pull during the arrival runs it on to its end over this long. */
export const ARRIVAL_SKIP_SECONDS = 0.8;

/** The camera's thuds (shake amounts at the boss, felt to `reach` yards). */
export const ARRIVAL_SHAKES = {
  beam: { amount: 0.9, reach: 170 },
  collapse: { amount: 0.45, reach: 120 },
  wave: { amount: 1.0, reach: 150 },
} as const;

// ---- the veins --------------------------------------------------------------------------------

/** Where vein `vein`'s stream runs (room-local yards): from its altar's foot
 *  down its channel to the boss's feet at the platform's centre. */
export function arrivalStreamPath(vein: SmithHeartVein): {
  from: { x: number; z: number };
  to: { x: number; z: number };
} {
  const a = HEART_ALTARS.find((q) => q.vein === vein) ?? HEART_ALTARS[0];
  const dx = a.x - HEART_ROOM.x;
  const dz = a.z - HEART_ROOM.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d;
  const uz = dz / d;
  // Off the altar's collider (r 3) and short of the boss's own footprint.
  const start = d - 3.5;
  const end = 2.4;
  return {
    from: { x: HEART_ROOM.x + ux * start, z: HEART_ROOM.z + uz * start },
    to: { x: HEART_ROOM.x + ux * end, z: HEART_ROOM.z + uz * end },
  };
}

/** How far vein `i`'s light has run down its channel at `t` (0 at its altar,
 *  1 at the boss; -1 before it lights). It gathers pace as it runs. */
export function arrivalVeinFront(t: number, i: number): number {
  const k = (t - arrivalVeinStart(i)) / ARRIVAL.veinRun;
  if (k < 0) return -1;
  return clamp01(k) ** 1.35;
}

/** How bright vein `i`'s stream burns at `t` (0 to 1): lit as it starts,
 *  full while the beam stands, drawn out of the floor as the beam falls into
 *  the boss. */
export function arrivalStreamLevel(t: number, i: number): number {
  const s = arrivalVeinStart(i);
  if (t < s) return 0;
  const on = smooth((t - s) / 0.35);
  const off = 1 - smooth((t - ARRIVAL_BEAM_FALL) / (ARRIVAL.beamFall + 0.4));
  return on * off;
}

/** The altar's own vein glow in the room (heart_room_kit.ts `setVein`) at
 *  `t`: dim while the statue sleeps (and asleep, `t` < 0), burning from the
 *  moment its light starts to run. */
export function arrivalAltarLevel(t: number, i: number): number {
  const dim = 0.18;
  if (t < 0) return dim;
  return dim + (1 - dim) * smooth((t - arrivalVeinStart(i) + 0.15) / 0.5);
}

// ---- the beam ---------------------------------------------------------------------------------

/** The beam's size (yards): its full height over the floor, the white core's
 *  and the swirl's radii, the floor's pool of light. */
export const ARRIVAL_BEAM = {
  height: 260,
  coreR: 3,
  swirlR: 12,
  sheathR: 34,
  poolR: 18,
} as const;

export type ArrivalBeamPhase = 'off' | 'rise' | 'peak' | 'fall';

/** The beam at `t`: its phase and share through it, its top (0 to 1 of its
 *  full height; while it falls the top sinks to `chest`, the boss's heart as
 *  a share of the full height), its width (share of its radii) and how hot
 *  it burns. */
export interface ArrivalBeamLook {
  phase: ArrivalBeamPhase;
  k: number;
  top: number;
  width: number;
  glow: number;
}

export function arrivalBeam(
  t: number,
  chest: number,
  out: ArrivalBeamLook = { phase: 'off', k: 0, top: 0, width: 0, glow: 0 },
): ArrivalBeamLook {
  const set = (phase: ArrivalBeamPhase, k: number, top: number, width: number, glow: number) => {
    out.phase = phase;
    out.k = k;
    out.top = top;
    out.width = width;
    out.glow = glow;
    return out;
  };
  if (t < ARRIVAL_CONVERGE || t >= ARRIVAL_IGNITE) return set('off', 0, 0, 0, 0);
  if (t < ARRIVAL_BEAM_PEAK) {
    const k = (t - ARRIVAL_CONVERGE) / ARRIVAL.beamRise;
    return set('rise', k, easeOut(k), 0.35 + 0.65 * easeOut(k), 1.3);
  }
  if (t < ARRIVAL_BEAM_FALL)
    return set('peak', (t - ARRIVAL_BEAM_PEAK) / ARRIVAL.beamHold, 1, 1, 1);
  const k = (t - ARRIVAL_BEAM_FALL) / ARRIVAL.beamFall;
  const e = easeIn(k);
  return set('fall', k, 1 + (clamp01(chest) - 1) * e, 1 - 0.75 * e, 1 + 0.6 * e);
}

/** The sky's flare (0 to 1): it blazes as the beam erupts, holds while it
 *  stands, dims as it falls and lingers a breath after. */
export function arrivalSkyFlare(t: number): number {
  if (t < ARRIVAL_CONVERGE) return 0;
  if (t < ARRIVAL_BEAM_PEAK) return easeOut((t - ARRIVAL_CONVERGE) / ARRIVAL.beamRise);
  if (t < ARRIVAL_BEAM_FALL) return 1 - 0.12 * smooth((t - ARRIVAL_BEAM_PEAK) / ARRIVAL.beamHold);
  return 0.88 * (1 - smooth((t - ARRIVAL_BEAM_FALL) / (ARRIVAL.beamFall + 1.4)));
}

// ---- the body -----------------------------------------------------------------------------------

/** Kneeling, the model's anchors stand this share of its height. */
export const ARRIVAL_KNEEL_HEIGHT = 0.72;

/** Where the body is in the scene at `t` (asleep, `t` < 0, is dormant). */
export type ArrivalBodyStage = 'dormant' | 'waking' | 'rising' | 'roaring' | 'awake';

export function arrivalBodyStage(t: number): ArrivalBodyStage {
  if (t < ARRIVAL_IGNITE) return 'dormant';
  if (t < ARRIVAL_RISE_AT) return 'waking';
  if (t < ARRIVAL_ROAR_AT) return 'rising';
  if (t < ARRIVAL_END) return 'roaring';
  return 'awake';
}

/** The stance the rig holds (final_body_core.ts FINAL_BODY_GESTURES): the
 *  still knee until it pushes up, the push (its Rise clip), standing; the
 *  false death's kneel (Mythic) wins over all of it; a corpse stands (its
 *  Death clip has the body). */
export type ArrivalStance = 'dormant' | 'rise' | 'stand' | 'kneel';

export function arrivalStance(t: number, dead: boolean, falseDeath: boolean): ArrivalStance {
  if (dead) return 'stand';
  if (falseDeath) return 'kneel';
  if (t < ARRIVAL_RISE_AT) return 'dormant';
  if (t < ARRIVAL_ROAR_AT) return 'rise';
  return 'stand';
}

/** Is the stone dark (its cracks black) at `t`? Until the beam falls in. */
export function arrivalDark(t: number, dead: boolean): boolean {
  return !dead && t < ARRIVAL_IGNITE;
}

/** Is the body still forming (no element aura round it) at `t`? Until it
 *  roars: the roar opens its first element (final_body_fx.ts). */
export function arrivalForming(t: number, dead: boolean): boolean {
  return !dead && t < ARRIVAL_ROAR_AT;
}

/** The model's height share at `t` for its anchors (the heart, the eyes):
 *  kneeling until the push, standing by the roar. */
export function arrivalHeightShare(t: number, dead: boolean): number {
  if (dead || t >= ARRIVAL_ROAR_AT) return 1;
  if (t < ARRIVAL_RISE_AT) return ARRIVAL_KNEEL_HEIGHT;
  const k = smooth((t - ARRIVAL_RISE_AT - 0.35) / (ARRIVAL.riseSeconds - 0.8));
  return ARRIVAL_KNEEL_HEIGHT + (1 - ARRIVAL_KNEEL_HEIGHT) * k;
}

/** How bright the heart in its chest burns at `t` (dim asleep, waking as the
 *  beam stands, a flare over 1 as the beam lands in it, then 1). */
export function arrivalHeartLevel(t: number): number {
  if (t < ARRIVAL_CONVERGE) return 0.08;
  if (t < ARRIVAL_IGNITE) return 0.08 + 0.4 * smooth((t - ARRIVAL_CONVERGE) / 1.2);
  return 1 + 1.4 * Math.max(0, 1 - (t - ARRIVAL_IGNITE) / 1.1);
}
