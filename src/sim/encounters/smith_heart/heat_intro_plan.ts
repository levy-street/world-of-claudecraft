// Leaf: the Guardian of the Heat's entrance as numbers (docs/design/raid/
// smith_heart.md section 7.4, "The entrance"): the sim's timeline
// (heat_intro.ts) and the renderer's scene (render/smith_heart_fx/
// heat_entrance_core.ts) read the same clock off the same constants, so the
// guardian is handed back to the fight exactly as its scene ends.
//
// Imports nothing (no SimContext, no rng, no clock).

/** The entrance's timeline, in seconds of the scene (0: the raid woke it). */
export const HEAT_INTRO = {
  /** Yards from the wellspring's middle a living player wakes it: the anvil
   *  bridge's east end, so the raid crosses the bridge with the scene before
   *  it and is still short of the guardian's aggro reach when it ends. */
  reach: 58,
  /** How far over or under the Hearth's floor a waker may stand (yards). */
  band: 12,
  /** The yell leaves (the embers have spiralled in and its body is alight
   *  to the chest; the voice clip's beats are counted from here). */
  speakAt: 1.8,
  /** The guardian is handed back to the fight: hostile, touchable, its
   *  aggro reach live again (the column of fire is still falling). */
  seconds: 13,
  /** A dev replay holds it cold this long before a waker can wake it again,
   *  so every client sees it cold first (a snapshot or two). */
  replayHold: 1.5,
  /** The pull within this many seconds of the entrance's end says no pull
   *  line (the entrance has just said it). */
  pullQuiet: 45,
} as const;

/** The entrance aura's `value` (heat_ids.ts HEAT_AURAS.intro): cold and
 *  waiting (permanent), or waking (its `remaining` and `duration` the
 *  scene's clock). No aura: awake (the entrance played, or was skipped). */
export const HEAT_INTRO_STAGES = {
  dormant: 0,
  waking: 1,
} as const;
