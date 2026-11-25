// Leaf: the Gale Crossing's ids and tuning (breath_crossing.ts; the owner's
// playtest of 2026-11-25). The crossing is the wind's road from the landing
// at the climb's head over the chasm to the Storm Cornice, and home again out
// of the fight: a pad on each side, a FIXED arc between (breath_isle_geometry.ts
// rideArc, its apex this row's). Its player-visible names are the shipped
// Updraft (the pads) and Riding the Gale (the ride's aura): no new noun.
// Imports nothing.

export const CROSSING_OBJECTS = {
  /** The landing's pad (always up). */
  out: 'sh_breath_crossing_out',
  /** The Cornice's pad home (up only while the guardian is not fighting). */
  home: 'sh_breath_crossing_home',
  /** The carrier of a ride (its state on the object: Entity.breathCrossing). */
  ride: 'sh_breath_crossing_ride',
} as const;

export const CROSSING_TUNING = {
  /** A ride's whole length (seconds) and its apex over the higher end
   *  (yards): a long glide on a current, never a hop. */
  seconds: 2.6,
  apex: 5,
} as const;
