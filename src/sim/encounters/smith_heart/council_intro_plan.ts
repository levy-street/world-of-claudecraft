// Leaf: the Hammer Council's entrance as numbers (docs/design/raid/
// smith_heart.md section 7.1, "The entrance", "The quarry wakes"): the sim's
// timeline (council_intro.ts) and the renderer's scene (render/
// smith_heart_fx/council_entrance_core.ts) read the same clock off the same
// constants, so both members are handed back to the fight exactly as the
// scene ends.
//
// Imports nothing (no SimContext, no rng, no clock).

/** The entrance's timeline, in seconds of the scene (0: the raid woke the
 *  quarry). */
export const COUNCIL_INTRO = {
  /** Yards from the Quarry's middle a living player wakes it: the foot of
   *  the Gallery's last stair, over the pit's rim, so the raid comes down
   *  into the quarry with the whole scene before it. Both members stay held
   *  out of reach through it, so a raider who runs straight in pulls
   *  nothing. */
  reach: 58,
  /** How far over or under the pit's floor a waker may stand (yards): the
   *  stair's last flight counts, the Gallery's landings above do not. */
  band: 16,
  /** The Guardian's line leaves (the columns are lit and the cracks are
   *  racing up the rock round it; its clip's words are counted from here). */
  guardianSpeakAt: 2.4,
  /** The Seam Singer's line leaves (the crystal vein has begun to ring). */
  singerSpeakAt: 8.5,
  /** Both are handed back to the fight: hostile, touchable, their aggro
   *  reach live again (the room's crystals still ringing with her note). */
  seconds: 14,
  /** A dev replay holds them dormant this long before a waker can wake the
   *  quarry again, so every client sees them asleep first (a snapshot or
   *  two). */
  replayHold: 1.5,
  /** The pull within this many seconds of the entrance's end says no pull
   *  lines (the entrance has just said them). */
  pullQuiet: 45,
} as const;

/** The entrance aura's `value` (council_ids.ts COUNCIL_AURAS.intro, on both
 *  members): dormant in the rock and the crystal (permanent), or waking (its
 *  `remaining` and `duration` the scene's clock). No aura: awake (the
 *  entrance played, or was skipped). */
export const COUNCIL_INTRO_STAGES = {
  dormant: 0,
  waking: 1,
} as const;
