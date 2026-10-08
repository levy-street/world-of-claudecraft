/** How long a rig holds its battle stance after it last fought.
 *
 * The standing-still base state picks the braced loop (ClipMap.combatIdle) while the rig is
 * engaged. For mobs "engaged" is their live aggro target (anim_state_entity_core). Players
 * carry no such fact on the wire (their `inCombat` is server-only), so a player rig braces from
 * what it DOES: every swing, released hostile cast and hit reaction it plays extends the brace,
 * and it relaxes into its idle only once it has been quiet this long (about the classic
 * out-of-combat window). Render-only and driven by the events every host already delivers, so
 * peers brace the same way with no new wire traffic.
 *
 * Node-only (RENDER_PURE_CORES): no three.js, no DOM.
 */

/** Seconds the stance is held after the last swing, release or hit. */
export const BRACE_SECONDS = 6;

/** The new brace deadline after fighting at `now` (never shortens a longer one). */
export function extendBrace(until: number, now: number, seconds = BRACE_SECONDS): number {
  return Math.max(until, now + seconds);
}

export function isBraced(until: number, now: number): boolean {
  return now < until;
}
