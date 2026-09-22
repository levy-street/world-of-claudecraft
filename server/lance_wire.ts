// Wire rounding for the Shardpike trial's guidance view (src/sim/lance_guidance.ts).
//
// Its own leaf rather than a helper on game.ts: a pure function of one view object, with no
// GameServer state, no clock and no rng, so a Vitest imports it directly and the broadcast
// pass stays a thin consumer (the monolith ratchet, same rule as interest_policy.ts).

/**
 * Round the guidance view's target distance to whole yards.
 *
 * The raw distance moves with the player's own footsteps, so it changes every tick by a few
 * thousandths. The `maybe` delta compares JSON, so an unrounded distance makes this "changed"
 * on literally every tick of every pike-carrying session, which is the exact shape of the
 * per-tick re-ship the delta registry exists to prevent. Whole yards: the prompt says "walk
 * closer", it does not need centimetres.
 */
export function roundLanceGuidance<T extends { targetDistance: number | null }>(
  view: T | null,
): T | null {
  if (!view) return null;
  const d = view.targetDistance;
  return d === null ? view : { ...view, targetDistance: Math.round(d) };
}
