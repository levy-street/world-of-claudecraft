// Which authored clip a seated body plays (render/seated_pose_core.ts decides WHEN it sits,
// gets up and what it does in the seat; the clips themselves are sit_anims.glb, see
// manifest.ts `seats()`). Pure: clip NAMES only, so a Vitest drives the choice directly.

import type { SeatAnimInfo } from '../seated_pose_core';

/** A rig's chair-sitting clips (every body on the shared Rig_Medium carries the set). */
export interface SeatClipSet {
  /** Upright and relaxed seats (a 0.9 yd seat, feet on the floor). */
  chairDown: string;
  chairIdle: string;
  chairUp: string;
  /** Leaning back against a high back (settles, chairs). */
  relaxedIdle: string;
  /** In conversation with the body beside. */
  talkIdle: string;
  /** Eating or drinking in the seat (hand to mouth). */
  drinkIdle: string;
  /** A bar stool (a 1.0 yd seat, feet on its ring). */
  highDown: string;
  highIdle: string;
  highUp: string;
}

export type SeatClipPhase = 'down' | 'idle' | 'up';

/** The clip for a seated body's phase. */
export function seatClip(set: SeatClipSet, seat: SeatAnimInfo, phase: SeatClipPhase): string {
  const high = seat.pose === 'high';
  if (phase === 'down') return high ? set.highDown : set.chairDown;
  if (phase === 'up') return high ? set.highUp : set.chairUp;
  if (seat.idle === 'talk') return set.talkIdle;
  if (seat.idle === 'drink') return set.drinkIdle;
  if (high) return set.highIdle;
  return seat.pose === 'relaxed' ? set.relaxedIdle : set.chairIdle;
}

/** Every clip in a set (the action list a rig builds). */
export function seatClipNames(set: SeatClipSet | undefined): string[] {
  if (!set) return [];
  return [
    set.chairDown,
    set.chairIdle,
    set.chairUp,
    set.relaxedIdle,
    set.talkIdle,
    set.drinkIdle,
    set.highDown,
    set.highIdle,
    set.highUp,
  ];
}
