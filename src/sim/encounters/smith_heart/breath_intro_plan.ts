// Leaf: the Guardian of the Breath's entrance as numbers (docs/design/raid/
// smith_heart.md section 7.2, "The entrance", "Calm before the storm"): the
// sim's timeline (breath_intro.ts) and the renderer's scene (render/
// smith_heart_fx/breath_entrance_core.ts) read the same clock off the same
// constants, so the guardian is handed back to the fight exactly as the
// scene ends. No voice: wind and thunder only.
//
// Imports nothing (no SimContext, no rng, no clock).

/** The entrance's timeline, in seconds of the scene (0: the raid woke the
 *  Cornice). */
export const BREATH_INTRO = {
  /** Yards from the guardian's spot (content/smith_heart_layout.ts
   *  SMITH_HEART_BOSS_SPOTS.breath, the Cornice's middle) a living player
   *  wakes it: the climb's last flat strides before the rim (the climb tops
   *  out some 64 yd west of it), so the raid steps up onto the plateau with
   *  the whole storm before it. Far past its aggro reach: a raider who runs
   *  straight in pulls nothing until the scene ends. */
  reach: 58,
  /** How far over or under the Cornice's floor a waker may stand (yards):
   *  the climb's top counts, its stairs below and the floating isles (26 yd
   *  and more above) do not. */
  band: 12,
  /** It is handed back to the fight: hostile, touchable, its aggro reach live
   *  again (the last thunderclap has just rolled). */
  seconds: 12,
  /** A dev replay holds it gathered this long before a waker can wake the
   *  Cornice again, so every client sees the calm first (a snapshot or
   *  two). */
  replayHold: 1.5,
} as const;

/** The entrance aura's `value` (breath_ids.ts BREATH_AURAS.intro): gathered
 *  into the still air and waiting (permanent), or waking (its `remaining`
 *  and `duration` the scene's clock). No aura: awake (the entrance played,
 *  or was skipped). */
export const BREATH_INTRO_STAGES = {
  dormant: 0,
  waking: 1,
} as const;
