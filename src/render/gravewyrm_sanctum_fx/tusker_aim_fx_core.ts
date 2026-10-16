// Pure plan for the Sledge Tusker's Trample readability pass (tusker_aim_fx.ts,
// and the lane paint in sanctum_fx.ts): what the aiming lane says about
// itself, what each ice outcrop's floor circle says about the bait it still
// offers, and what the marker over the Trample's target says.
//
//   The lane       ICE BLUE with an ice-shard burst at its end while it would
//                  end in an intact outcrop, RED with a plain arrowhead while
//                  it would not; it follows its target until the lock
//                  (sim: tusker_road.ts trampleAimLocked), then holds.
//   The circles    every intact outcrop glows on an ice-blue circle for the
//                  whole fight; through a Trample's aim they all pulse and
//                  the one the lane runs into pulses hardest; a struck one
//                  burns white-blue while it holds the beast; a burst one goes
//                  out (no glow: a dark dead disc, cracked, inside a cold
//                  grey ring broken in five), so a player counts the baits
//                  left.
//   The marker     over the target for the whole bar: a down arrow while the
//                  lane follows them (lead it), two arrows pointing out to
//                  either side once it locks (step aside). Always GOLD inside
//                  a white and a dark rim, never the lane's colour, so it
//                  never melts into an ice-blue lane or the ice under it.
//
// Never colour-only: every state change is also a change of shape (shard
// burst or arrowhead, whole ring or broken dark ring, down arrow or side
// arrows). Every look is a mesh drawn on every graphics tier.
//
// Three-free, DOM-free, deterministic.

import { TUSKER_TUNING } from '../../sim/encounters/gravewyrm_sanctum/ids';
import { trampleAimLocked } from '../../sim/encounters/gravewyrm_sanctum/tusker_road';
import type { TuskerLane } from '../../sim/types';
import { TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';
import type { OutcropPhase } from './tusker_bait_fx_core';

// ---- the lane --------------------------------------------------------------------

/** The two answers the lane gives: it ends in the ice (blue), or it does not
 *  (red, the threat palette's own lethal hue). */
export const TRAMPLE_AIM_COLORS = {
  bait: 0x5cd4ff,
  miss: TELEGRAPH_THREAT_COLORS.lethal,
} as const;

/** The motes and fill fronts on the two lanes. */
export const TRAMPLE_AIM_ACCENTS = {
  bait: 0xe6fbff,
  miss: 0xffc2b0,
} as const;

/** The end cap's two shapes: an ice-shard burst into the outcrop, or a plain
 *  arrowhead where the charge runs out. */
export type TrampleCap = 'shard' | 'arrow';

export interface TrampleAimLook {
  /** The lane ends in an intact outcrop. */
  baited: boolean;
  /** The lane has stopped following its target (the bar's last seconds). */
  locked: boolean;
  color: number;
  accent: number;
  cap: TrampleCap;
}

/** The lane's look off the plan the sim makes and the bar's seconds left. */
export function trampleAimLook(
  outcropId: number | null,
  castRemaining: number,
  out: TrampleAimLook = {
    baited: false,
    locked: false,
    color: TRAMPLE_AIM_COLORS.miss,
    accent: TRAMPLE_AIM_ACCENTS.miss,
    cap: 'arrow',
  },
): TrampleAimLook {
  const baited = outcropId !== null;
  out.baited = baited;
  out.locked = trampleAimLocked(castRemaining);
  out.color = baited ? TRAMPLE_AIM_COLORS.bait : TRAMPLE_AIM_COLORS.miss;
  out.accent = baited ? TRAMPLE_AIM_ACCENTS.bait : TRAMPLE_AIM_ACCENTS.miss;
  out.cap = baited ? 'shard' : 'arrow';
  return out;
}

/** The cap's size (yards across): wider than the lane, so its shape reads
 *  past the lane's own rim. */
export const TRAMPLE_CAP_SIZE = 7;

/** Where the cap stands along the lane (yards from the beast's centre): on
 *  the outcrop's face for a bait (where the shards fly), at the end of the
 *  strike for a plain lane (its point on the last yard the charge reaches). */
export function trampleCapAlong(lane: Pick<TuskerLane, 'length' | 'reach' | 'outcropId'>): number {
  if (lane.outcropId !== null) return lane.length + TUSKER_TUNING.tuskReach;
  return Math.max(0, lane.reach - TRAMPLE_CAP_SIZE * 0.5);
}

// ---- the outcrops' floor circles --------------------------------------------------------

/** The circle under an outcrop (yards): just outside the fangs' feet. */
export const OUTCROP_CIRCLE_RADIUS = TUSKER_TUNING.outcropRadius + 1.3;

export interface OutcropCircleLook {
  /** 0..~1.6: how brightly the circle glows (0: dark). */
  glow: number;
  /** 1: the dark, broken ring of a spent outcrop. */
  spent: number;
  /** Hex colour of the glow. */
  color: number;
}

const CIRCLE_ICE = 0x6ad8ff;
const CIRCLE_HELD = 0xdff8ff;
// Spent: an unlit cold grey for the broken ring's pieces and the cracks,
// drawn inside dark rims on a dark dead disc (tusker_aim_fx.ts), so it reads
// on the dark road and on white snow alike and never as the glow of a live
// one.
const CIRCLE_SPENT = 0xa4b0bf;

/**
 * An outcrop's floor circle: its phase, whether a Trample is aiming now and
 * whether that lane runs into this one, at the painter's `clock`. Intact:
 * a steady glow with a slow breath; through an aim every intact one pulses,
 * the aimed one fastest and brightest. Struck: white-blue, steady (it is
 * holding the beast). Broken: dark.
 */
export function outcropCircleLook(
  phase: OutcropPhase,
  aiming: boolean,
  aimed: boolean,
  clock: number,
  out: OutcropCircleLook = { glow: 0, spent: 0, color: CIRCLE_ICE },
): OutcropCircleLook {
  if (phase === 'broken') {
    out.glow = 0;
    out.spent = 1;
    out.color = CIRCLE_SPENT;
    return out;
  }
  out.spent = 0;
  if (phase === 'struck') {
    out.glow = 1.3;
    out.color = CIRCLE_HELD;
    return out;
  }
  out.color = CIRCLE_ICE;
  if (aimed) out.glow = 1.4 + 0.3 * Math.sin(clock * 11);
  else if (aiming) out.glow = 0.95 + 0.2 * Math.sin(clock * 6);
  else out.glow = 0.6 + 0.08 * Math.sin(clock * 1.6);
  return out;
}

// ---- the marker over the target ---------------------------------------------------------

/** The marker's own colour (and its feet reticle's): a hot gold that is
 *  neither of the lane's two answers (ice blue, lethal red) nor the ice and
 *  snow it is seen against, so "this one is you" never reads as part of the
 *  lane. The lane, its cap and the outcrops' circles carry the bait answer. */
export const TARGET_MARKER_COLOR = 0xffd23f;

/** 0: the lane follows you (a down arrow: lead it); 1: it has locked (two
 *  arrows out to either side: step aside). */
export type TargetMarkerMode = 0 | 1;

/** The marker's mode off the bar's seconds left. */
export function targetMarkerMode(castRemaining: number): TargetMarkerMode {
  return trampleAimLocked(castRemaining) ? 1 : 0;
}

/** Yards over the target's feet the marker floats (a player stands 2.6). */
export const TARGET_MARKER_HEIGHT = 4.4;
/** Its size up close (yards). */
export const TARGET_MARKER_SIZE = 2.6;

/** Past this many yards from the camera the marker grows with distance... */
export const MARKER_FAR_YARDS = 26;
/** ...up to this many times its size up close. */
export const MARKER_MAX_SCALE = 3;

/** How much bigger the marker draws at `distance` yards from the camera, so
 *  it stays a readable size from across the road (never smaller than up
 *  close, never more than three times it). The marker's vertex shader
 *  (tusker_aim_fx.ts) is built from the same two constants. */
export function targetMarkerScale(distance: number): number {
  return Math.min(MARKER_MAX_SCALE, Math.max(1, distance / MARKER_FAR_YARDS));
}

/** The marker's bob (yards): it bounces while the lane follows, and holds
 *  still and flashes once it locks. */
export function targetMarkerBob(mode: TargetMarkerMode, clock: number): number {
  return mode === 0 ? 0.35 * Math.abs(Math.sin(clock * 4.2)) : 0;
}
