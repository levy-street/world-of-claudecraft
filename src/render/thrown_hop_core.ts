// The hop of a body an encounter THROWS (render-only): the Guardian of the
// Breath's Summit Roar and its loose gales slide a struck body along the floor
// (sim/encounters/smith_heart/breath_shove.ts, an ease that starts fast and
// settles), and the sim keeps that body on the floor the whole way. Drawn
// flat it read as a sled, not a blow (Jose's playtest of 2026-11-07), so the
// renderer lifts the drawn body on a short arc while the throw's hold aura
// is on it: up fast off the blow, a hang, down onto its feet as the slide
// settles. The renderer also treats the lifted body as airborne, so the rig
// takes its airborne pose and plays its landing on touchdown.
//
// Gameplay-neutral: the arc is a few yards of drawn height over the sim's own
// position, never a change to where the body is (hit-tests, range, nameplates
// and the camera read the sim). It starts the frame the hold aura first shows
// on the body (offline the tick the throw begins, online the snapshot that
// carries it, the same snapshot that starts the drawn slide), and it runs its
// whole arc once started, so a throw a wall stops short still comes down
// softly. Pure: no three.js, no DOM, no clock of its own (`now` is passed in).

import { BREATH_AURAS, BREATH_TUNING as T } from '../sim/encounters/smith_heart/breath_ids';

/** Each throwing hold aura's hop: its seconds (its slide's) and its height (yards). */
export const THROWN_HOPS: Readonly<Record<string, { seconds: number; height: number }>> = {
  [BREATH_AURAS.thrown]: { seconds: T.roarSlide, height: 1.6 },
  [BREATH_AURAS.tossed]: { seconds: T.galeSlide, height: 0.7 },
};

/** The arc's shape over its time `u` (0 to 1): 0 at both ends, 1 at its
 *  peak a little before the middle (u about 0.37), so the body leaves the
 *  floor fast with the blow and comes down slower as the slide settles. */
export function hopArc(u: number): number {
  if (!(u > 0) || u >= 1) return 0;
  const w = u ** 0.7;
  return 4 * w * (1 - w);
}

/** One body's hop in flight (owned by its view). */
export interface ThrownHopState {
  /** Was a throwing aura on the body last frame (its onset is the edge)? */
  seen: boolean;
  /** The hop under way: its start (render seconds), length and height; 0
   *  seconds when none. */
  start: number;
  seconds: number;
  height: number;
}

export function newThrownHop(): ThrownHopState {
  return { seen: false, start: 0, seconds: 0, height: 0 };
}

/** The drawn lift (yards) of a body wearing `auras` at render time `now`;
 *  0 when it is not in a hop. Advances `st` in place. */
export function stepThrownHop(
  st: ThrownHopState,
  auras: readonly { id: string }[],
  now: number,
): number {
  let hop: { seconds: number; height: number } | undefined;
  for (const a of auras) {
    hop = THROWN_HOPS[a.id];
    if (hop) break;
  }
  if (hop && !st.seen) {
    st.start = now;
    st.seconds = hop.seconds;
    st.height = hop.height;
  }
  st.seen = hop !== undefined;
  if (st.seconds <= 0) return 0;
  const u = (now - st.start) / st.seconds;
  if (u >= 1 || u < 0) {
    st.seconds = 0;
    return 0;
  }
  return st.height * hopArc(u);
}
