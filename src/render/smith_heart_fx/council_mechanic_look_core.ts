// PURE (RENDER_PURE_CORES): the Hammer Council's boss-mechanic looks that
// are read from the bodies rather than painted on the floor, as numbers:
//
//  - each member's real body (`MEMBER_BODY`: its height and where its chest
//    sits), what the fury's swell is anchored on.
//  - Mountain's Rush (encounters/smith_heart/council_rush.ts): where its
//    wind-up and run stand at a moment after the wind-up's cue (`rushPhase`),
//    how far the scar it tears is revealed and how it fades (`rushScar`); the
//    red arrow over the marked player for the whole bar (`rushArrowLook`,
//    `RUSH_ARROW`: where it floats, its size, its bob and its pulse, faster as
//    the bar runs out).
//  - Grieving Fury (encounters/smith_heart/council_fury.ts): the survivor's
//    swell, its waking flash and its heartbeat (`furyLook`).
//
// Every number a player reacts to (the scar along the lane the run took) is
// drawn on every tier; only the dust thins (council_rush_fx.ts).

import { SMITH_HEART_MOBS } from '../../sim/content/smith_heart';
import {
  type CouncilRole,
  COUNCIL_TUNING as T,
} from '../../sim/encounters/smith_heart/council_ids';
import { COUNCIL_BODY_HEIGHTS, COUNCIL_MODEL_HEIGHTS } from './council_bodies_core';

/** The Guardian's model height before its template's scale
 *  (characters/smith_heart_boss_looks.ts smith_heart_hammer_guardian). */
const GUARDIAN_MODEL_HEIGHT = COUNCIL_MODEL_HEIGHTS.guardian;

/** Each member's height feet to crown (yards: the model's height times the
 *  template's scale) and the share of it where its chest sits (the fury's
 *  swell is anchored there, clear of the arms and the raid round its feet). */
export const MEMBER_BODY: Readonly<Record<CouncilRole, { height: number; chest: number }>> = {
  guardian: {
    height: GUARDIAN_MODEL_HEIGHT * (SMITH_HEART_MOBS.heart_hammer_guardian?.scale ?? 3.2),
    chest: 0.7,
  },
  singer: { height: COUNCIL_BODY_HEIGHTS.singer, chest: 0.72 },
};

/** Where a Rush stands `since` seconds after its wind-up's cue, for a run of
 *  `run` seconds: the wind-up (k its share, 0 to 1), the run (k how far
 *  along the line, 0 to 1), or over. */
export type RushPhaseName = 'windup' | 'run' | 'over';

export function rushPhase(
  since: number,
  run: number,
  out: { phase: RushPhaseName; k: number },
): { phase: RushPhaseName; k: number } {
  if (since < 0 || since < T.rushWindup) {
    out.phase = 'windup';
    out.k = Math.max(0, since) / T.rushWindup;
    return out;
  }
  const r = since - T.rushWindup;
  if (run > 0 && r < run) {
    out.phase = 'run';
    out.k = r / run;
    return out;
  }
  out.phase = 'over';
  out.k = 1;
  return out;
}

/** How long the scar the run tears stays (seconds after the stop), and how
 *  long it takes to fade out of that. */
export const RUSH_SCAR = { hold: 3.5, fade: 2 } as const;

/** The scar along the run's line: how much of it is torn (0 to 1, following
 *  the Guardian's body) and how strong it still burns (1 fresh, 0 gone). */
export function rushScar(
  since: number,
  run: number,
  out: { reveal: number; heat: number; fade: number },
): { reveal: number; heat: number; fade: number } {
  const r = since - T.rushWindup;
  if (r <= 0) {
    out.reveal = 0;
    out.heat = 0;
    out.fade = 1;
    return out;
  }
  out.reveal = run > 0 ? Math.min(1, r / run) : 1;
  const after = Math.max(0, r - run);
  // Hot as it is torn, cooling to embers, then fading.
  out.heat = Math.max(0, 1 - after / 1.2);
  out.fade =
    after <= RUSH_SCAR.hold ? 1 : Math.max(0, 1 - (after - RUSH_SCAR.hold) / RUSH_SCAR.fade);
  return out;
}

/** Seconds after the stop by which every trace of a Rush is gone. */
export const RUSH_TRACE_SECONDS = RUSH_SCAR.hold + RUSH_SCAR.fade;

// ---- Mountain's Rush's arrow over the marked player ----------------------------------------

/** The red arrow over the Rush's marked player (council_rush_arrow.ts), in yards: its tip
 *  floats `tip` over the player's feet, clear of the head and nameplate; it is `length`
 *  tall and `width` across the head (a camera-facing card with `margin` all round for its
 *  glow), bobbing `bob` at `bobHz`; it pulses from `pulseHz` at the mark to `pulseHzEnd`
 *  as the bar lands. Every tier: the mark is actionable (who to stay clear of, who must
 *  reach a pillar); reduced motion holds the bob and the pulse. */
export const RUSH_ARROW = {
  tip: 3.8,
  length: 3.2,
  width: 2.6,
  /** Past this many yards from the camera the card grows with the distance, so a far
   *  arrow keeps its size on screen (a nameplate's rule); nearer it is its true size. */
  holdFrom: 22,
  margin: 0.45,
  bob: 0.3,
  bobHz: 1.4,
  pulseHz: 1.6,
  pulseHzEnd: 5,
  /** The glow never falls below this (always readable), up to 1 on the pulse. */
  glowFloor: 0.7,
  /** The extra size on the pulse's crest, growing to its whole as the bar runs out. */
  swell: 0.14,
} as const;

/** One frame of the arrow, written into `out` (no allocation). */
export interface RushArrowLook {
  /** Height of the tip over the player's feet (yards). */
  y: number;
  /** Brightness 0..1 (never under RUSH_ARROW.glowFloor). */
  glow: number;
  /** Size multiplier (1 at rest). */
  scale: number;
}

/** The arrow at `clock` (seconds, the bob's) with `remaining` of the mark's `duration`
 *  left (the pulse's). Pure. */
export function rushArrowLook(
  remaining: number,
  duration: number,
  clock: number,
  reducedMotion: boolean,
  out: RushArrowLook,
): RushArrowLook {
  if (reducedMotion) {
    out.y = RUSH_ARROW.tip;
    out.glow = 1;
    out.scale = 1;
    return out;
  }
  const left = duration > 0 ? Math.max(0, Math.min(1, remaining / duration)) : 0;
  const urgency = 1 - left;
  // The pulse's phase is the mark's own time integrated (its rate climbing from pulseHz
  // to pulseHzEnd over the bar), never the host's running clock times a rate: that would
  // speed up without bound over a long session and flicker.
  const e = Math.max(0, duration * urgency);
  const span = Math.max(1e-6, duration);
  const cycles =
    RUSH_ARROW.pulseHz * e + ((RUSH_ARROW.pulseHzEnd - RUSH_ARROW.pulseHz) * e * e) / (2 * span);
  const pulse = 0.5 + 0.5 * Math.sin(cycles * Math.PI * 2);
  const bob = 0.5 + 0.5 * Math.sin(clock * RUSH_ARROW.bobHz * Math.PI * 2);
  out.y = RUSH_ARROW.tip + RUSH_ARROW.bob * bob;
  out.glow = RUSH_ARROW.glowFloor + (1 - RUSH_ARROW.glowFloor) * pulse;
  out.scale = 1 + RUSH_ARROW.swell * pulse * (0.35 + 0.65 * urgency);
  return out;
}

// ---- Grieving Fury (encounters/smith_heart/council_fury.ts) ----------------------------------

/** The fury's look on the survivor: how long the waking flash and the swell
 *  take (seconds), the swell's overshoot, and the heartbeat's period. */
export const FURY_LOOK = { wake: 1.4, grow: 0.9, overshoot: 0.06, beat: 1.05 } as const;

export interface FuryLook {
  /** The body's size against its own (1 to COUNCIL_TUNING.furySwell, a
   *  breath past it as it grows). */
  swell: number;
  /** The column's and the sigil's light (about 1; up to 3 at the wake). */
  glow: number;
  /** 0 to 1: the waking flash, gone after FURY_LOOK.wake. */
  flash: number;
  /** 0 to 1: the double heartbeat that throbs through it. */
  beat: number;
}

/** The fury's look `age` seconds after it woke on the survivor (a negative
 *  age: not yet). Pure; fills `out`. */
export function furyLook(
  age: number,
  out: FuryLook = { swell: 1, glow: 0, flash: 0, beat: 0 },
): FuryLook {
  if (!(age >= 0)) {
    out.swell = 1;
    out.glow = 0;
    out.flash = 0;
    out.beat = 0;
    return out;
  }
  const g = Math.min(1, age / FURY_LOOK.grow);
  // Ease out with a small overshoot that settles back to the full swell.
  const ease = 1 - (1 - g) ** 3;
  const over = Math.sin(g * Math.PI) * FURY_LOOK.overshoot;
  out.swell = 1 + (T.furySwell - 1) * ease + over;
  out.flash = Math.max(0, 1 - age / FURY_LOOK.wake);
  const phase = (age % FURY_LOOK.beat) / FURY_LOOK.beat;
  // Two quick throbs and a rest: lub-dub.
  const lub = Math.exp(-(((phase - 0.08) / 0.06) ** 2));
  const dub = 0.6 * Math.exp(-(((phase - 0.3) / 0.07) ** 2));
  out.beat = Math.min(1, lub + dub);
  out.glow = 0.85 + 0.35 * out.beat + 2.2 * out.flash * out.flash;
  return out;
}
