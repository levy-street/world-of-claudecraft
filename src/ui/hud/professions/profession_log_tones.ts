// The chat-log tones the professions family writes with, named once (the
// woc_log_tones.ts precedent, applied to this family by the Masterwrought
// phase 14 unification).
//
// A chat line is written as an inline colour on a span the log owns, so a
// stylesheet token cannot reach it; naming the values here is what keeps a
// retune a one-file change instead of a sweep with misses that read as
// deliberate differences. farm_event_feedback.ts previously spelled three of
// these across ten call sites; craft_celebration_text_view.ts spelled the
// toast gold as its own local constant (kept as a re-export for its callers).
//
// The values deliberately match the HUD's own log registers: GRANT is the
// loot-family green (--color-text-success), MISS the gathering got-away grey,
// TOAST the house gold, DENY the HUD's refusal red. hud.ts's own pre-existing
// log calls still spell these inline (its ratchet freezes it this phase); the
// craftResult deny arm at hud.ts is the recorded consumer of DENY once a
// wiring change is allowed there.
//
// DOM-free and deterministic (registered in tests/architecture.test.ts
// UI_PURE_CORES): five constants, no behavior.

/** An item the player received (harvest produce, the fine twin, seed-back,
 *  the golden bonus, the husk-trade compost, a crafted output). */
export const PROF_LOG_GRANT = '#7fdc4f';
/** News about the player's own things with nothing granted (a seed going
 *  into a bed, the ready notice). */
export const PROF_LOG_NEWS = '#c8f7c5';
/** A no-cost miss (a withered crop: the seed and the wait were lost, the
 *  bed was not). */
export const PROF_LOG_MISS = '#a8a8a8';
/** A celebration toast line (the masterwork and tier-up toasts). */
export const PROF_LOG_TOAST = '#ffd100';
/** An action refused with a reason the player must read (the craft denial
 *  chat line). */
export const PROF_LOG_DENY = '#ff6b6b';
