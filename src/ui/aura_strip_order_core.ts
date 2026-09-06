// Pure urgency bucketing for the PLAYER's own aura strips (#buff-bar, #debuff-bar).
//
// The strips used to render in sim application order, which is the order auras
// happened to land, not the order a player reads them in. Raid buffs are applied
// first and last for half an hour, so they permanently hold the slots nearest the
// anchor while the sub-minute cooldown you are actually timing sits at the far end
// of the wrap. WoW anchors the hot end: what is about to expire reads first, long
// upkeep drifts away, and modes (a stance, a form, stealth) sit last because they
// have no meaningful timer at all.
//
// This module answers only "which band does this aura belong in". The view
// (auras_view.ts) turns the answer into slot order by filling the pool in one pass
// per band, the same shape the `ownFirst` option already uses, so the ordering costs
// no sort and no per-frame allocation.
//
// BUCKETS, NOT A SORT. A true sort by remaining time would reshuffle icons on every
// tick as timers cross each other, which reads busier than the unordered strip it
// replaces, and it would need a comparator over the preallocated slot pool that the
// allocation probe (tests/util/alloc_probe.ts) forbids. Bucketing moves an icon only
// when it crosses a band boundary, so a steady-state frame moves no nodes and the
// painter's reconcileOrder stays a no-op.
//
// This is display order, and the low graphics tier's shed COUNT is untouched by it:
// how many buffs the cap sheds has its own rules and its own module
// (aura_overflow_priority.ts), keyed on authored duration rather than remaining
// time, so a display-order change can never widen or narrow what a tier hides.
// The shed PICK does follow this order, on purpose: selectShedSlots breaks ties by
// slot index, and slot index on the player strips is now band order, so among the
// long buffs that lose their budget the ones nearest expiry survive over
// earlier-applied ones, which is the one a player would rather keep in view.

/**
 * Upper bounds, in seconds of REMAINING time, for each urgency band below the
 * long-upkeep band. An aura falls in the first band whose bound it is under.
 *
 * The bounds are read-a-glance bands, not balance numbers: under a minute is a
 * cooldown you are actively timing, under five minutes is a shout or a short
 * consumable you re-apply within a pull, under thirty minutes is a food or an
 * elixir, and anything longer is upkeep you set once and forget.
 */
export const AURA_URGENCY_BUCKET_SECONDS: readonly number[] = [60, 300, 1800];

/** The long-upkeep band: everything with a finite remaining time past the last bound. */
export const AURA_URGENCY_BUCKET_UPKEEP = AURA_URGENCY_BUCKET_SECONDS.length;

/**
 * The mode band, always last. A toggle (a stance, a druid form, stealth, Ghost Wolf,
 * the carried flag) shows no countdown because the long finite duration the sim backs
 * it with is scaffolding rather than information, so it has no urgency to sort by and
 * belongs at the far end. A non-finite remaining lands here too: it reads as permanent
 * for exactly the same reason (compactAuraDuration prints nothing for it either).
 */
export const AURA_URGENCY_BUCKET_MODE = AURA_URGENCY_BUCKET_SECONDS.length + 1;

/** How many passes a caller must make to cover every band. */
export const AURA_URGENCY_BUCKET_COUNT = AURA_URGENCY_BUCKET_MODE + 1;

/**
 * The urgency band for one aura: 0 is the most urgent (nearest the strip's anchor),
 * `AURA_URGENCY_BUCKET_MODE` the least.
 *
 * `toggle` is the view's own mode classification (auras_view `isToggleAura`), passed in
 * rather than recomputed so the band and the suppressed countdown can never disagree
 * about what counts as a mode.
 *
 * A negative or zero remaining is treated as maximally urgent rather than clamped away:
 * an aura in its final tick is the last thing that should be pushed down the strip.
 */
export function auraUrgencyBucket(remaining: number, toggle: boolean): number {
  if (toggle || !Number.isFinite(remaining)) return AURA_URGENCY_BUCKET_MODE;
  for (let i = 0; i < AURA_URGENCY_BUCKET_SECONDS.length; i++) {
    if (remaining < AURA_URGENCY_BUCKET_SECONDS[i]) return i;
  }
  return AURA_URGENCY_BUCKET_UPKEEP;
}
