// The Masterless Strength's rebuild in its own model (Jose's playtest of
// 2026-11-04: when the final boss "rebuilds" it showed the pre-rework body,
// the Heart kit's floating rock pieces, and then snapped to the new model).
// The pure half of the arrival as final_fx.ts now draws it:
//  - the model stands from the arrival's first frame (the heart's waking),
//    dormant: no element aura until the shockwave (final_body_fx.ts);
//  - every rock piece still tears out of the paving and flies in round the
//    heart, but it flies into the MODEL (the anchor its joint names on the
//    rigged body, final_body_core.ts FINAL_BODY_ANCHORS) and is drawn into it
//    as it arrives: shrinking into the stone over the flight's last stretch
//    and gone at its lock, a flash and the cracks' flare marking each; the
//    old body is never assembled;
//  - the heart glides into the model's chest;
//  - at the shockwave the model roars (its Shift clip) and its aura settles.
// The model is whatever SMITH_HEART_BOSS_LOOKS points the boss at (its key,
// smith_heart_placeholder_looks.ts): swapping it swaps the rebuild with it.
// Node-only (RENDER_PURE_CORES): no three.js, no DOM.

import type { FinalBodyAnchor } from './final_body_core';
import type { ColossusJoint } from './final_fx_core';

/** The model's anchor a piece of `joint` on `side` (-1 right, 1 left, 0 the
 *  middle) flies into; the shards spread over the body by their index. */
export function arrivalAnchor(
  joint: ColossusJoint,
  side: -1 | 0 | 1,
  index: number,
): FinalBodyAnchor {
  const left = side >= 0;
  switch (joint) {
    case 'torso':
      return 'heart';
    case 'hip':
      return 'hip';
    case 'head':
      return 'head';
    case 'shoulder':
    case 'upper':
      return left ? 'shoulderL' : 'shoulderR';
    case 'fore':
    case 'fist':
      return left ? 'fistL' : 'fistR';
    default: {
      const spread: FinalBodyAnchor[] = [
        'hip',
        'shoulderL',
        'footL',
        'heart',
        'shoulderR',
        'footR',
        'crown',
        'fistL',
        'fistR',
      ];
      return spread[((index % spread.length) + spread.length) % spread.length];
    }
  }
}

/** From this share of its flight a piece sinks into the model's stone. */
export const ARRIVAL_ABSORB_FROM = 0.62;

/** A flying piece's drawn scale at `k` (0..1 through its flight): whole until
 *  ARRIVAL_ABSORB_FROM, then drawn into the body, gone at the lock. */
export function arrivalPieceScale(k: number): number {
  if (k <= ARRIVAL_ABSORB_FROM) return 1;
  const u = Math.min(1, (k - ARRIVAL_ABSORB_FROM) / (1 - ARRIVAL_ABSORB_FROM));
  return (1 - u) * (1 - u) * (1 + u);
}

/** Is the model shown at arrival time `t` (seconds since the heart woke; -1
 *  asleep)? From the first frame of the waking, a corpse always: the
 *  provisional body is never drawn whole. */
export function arrivalModelShown(t: number, dead: boolean): boolean {
  return dead || t >= 0;
}

/** Is the model still forming (dormant, no element aura) at `t`? Until the
 *  shockwave `waveAt`. */
export function arrivalForming(t: number, waveAt: number, dead: boolean): boolean {
  return !dead && t >= 0 && t < waveAt;
}
