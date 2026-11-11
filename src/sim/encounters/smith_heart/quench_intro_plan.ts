// Leaf: the Guardian of the Quench's entrance as numbers (docs/design/raid/
// smith_heart.md section 7.3, "The entrance"): the sim's timeline
// (quench_intro.ts) and the renderer's scene (render/smith_heart_fx/
// quench_entrance_core.ts) read the same clock off the same constants, so the
// guardian is handed back to the fight exactly as her scene ends.
//
// Imports nothing (no SimContext, no rng, no clock).

/** The entrance's timeline, in seconds of the scene (0: the raid woke her). */
export const QUENCH_INTRO = {
  /** A living player wakes her by stepping onto the lake's ice: inside the
   *  lake's ellipse (content/smith_heart_layout.ts QUENCH.lake, 37 by 35 yd)
   *  grown by this many yards. Off the rock shelf and onto the ice is the
   *  moment the raid enters her domain; it is some 35 yd from her (the
   *  web of cracks races the whole way to the raid), more than twice her
   *  16 yd aggro reach, so the scene plays out before anyone could pull. */
  reach: 1,
  /** How far over or under the lake's floor a waker may stand (yards). */
  band: 8,
  /** The line leaves (her eyes have just opened under the ice; the voice
   *  clip's beats are counted from here). */
  speakAt: 0.5,
  /** She is handed back to the fight: hostile, touchable, her aggro reach
   *  live again (her blades have just turned on the raid). */
  seconds: 11.9,
  /** A dev replay holds her frozen this long before a waker can wake her
   *  again, so every client sees her under the ice first (a snapshot or
   *  two). */
  replayHold: 1.5,
  /** The pull within this many seconds of the entrance's end says no pull
   *  line (the entrance has just spoken). */
  pullQuiet: 45,
} as const;

/** The entrance aura's `value` (quench_ids.ts QUENCH_AURAS.intro): frozen
 *  under the ice and waiting (permanent), or waking (its `remaining` and
 *  `duration` the scene's clock). No aura: awake (the entrance played, or
 *  was skipped). */
export const QUENCH_INTRO_STAGES = {
  dormant: 0,
  waking: 1,
} as const;
