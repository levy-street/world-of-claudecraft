// World PvP bounties: the system half, behind the SimContext seam.
//
// A FLAGGED player paid for WORLD_PVP_BOUNTY_STREAK world kills in a row
// without dying earns a bounty (world_pvp_bounty_rules.ts). The realm is told
// whose head carries one, the holder's name tag turns blood red on every
// client (`Entity.bounty`, the display mirror that rides the entity wire as
// `bty`), the holder's own kills pay on the gentler bounty curve, and whoever
// kills the holder shares a doubled honor pool. Any death ends the bounty and
// the streak (a world kill announces who collected it; any other death, and the
// flag dropping, tells only the holder it lapsed).
//
// Every player can carry a bounty at once: there is no realm-wide prize to
// hand over, so a bounty never passes to the killer, the killer earns their
// own by streaking.
//
// State: the streak and the bounty live on the authoritative per-character
// record (`PlayerMeta.worldPvp`, WorldPvpMetaState.streak / .bounty), and
// `Entity.bounty` is its display mirror, written ONLY here (the pvpFlag
// precedent in world_pvp.ts). Session-only and never persisted: a relog ends a
// streak the way a death does, which only ever costs the holder. The death
// hook and the disarm pass in world_pvp.ts are the two callers.
//
// Host-agnostic: no DOM, no rng, no wall clock. Every line is sim English with
// a matcher row in src/ui/sim_i18n.ts (the `worldPvp.bounty*` block).

import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import type { WorldPvpMetaState } from './world_pvp';
import { worldPvpStreakEarnsBounty } from './world_pvp_bounty_rules';

/** The bounty's chat colour: the same blood red the name tag wears
 *  (src/render/nameplate_tag_fill_core.ts NAMEPLATE_BOUNTY_FILL, pinned equal
 *  by tests/nameplate_bounty.test.ts; the sim cannot import from render). */
export const WORLD_PVP_BOUNTY_COLOR = '#c41e1e';
const BOUNTY_COLOR = WORLD_PVP_BOUNTY_COLOR;
const NOTICE_COLOR = '#ffd100';

/** What the holder is told the moment their streak earns the bounty. */
export const WORLD_PVP_BOUNTY_EARNED_LINE =
  'A bounty is on your head: your kills pay more Honor, and whoever slays you earns double.';
/** What the holder is told when the bounty ends without a world kill (a death
 *  to anything else, or the flag dropping). */
export const WORLD_PVP_BOUNTY_LAPSED_LINE = 'Your bounty has lapsed.';

/** The realm announcement when a streak earns a bounty. */
export function worldPvpBountyPlacedLine(holderName: string): string {
  return `A bounty has been placed on ${holderName}! Slay them for double Honor.`;
}

/** The realm announcement when a world kill ends a bounty. */
export function worldPvpBountyCollectedLine(killerName: string, holderName: string): string {
  return `${killerName} has collected the bounty on ${holderName}.`;
}

/** Does this record carry a bounty right now? */
export function hasWorldPvpBounty(state: WorldPvpMetaState | undefined): boolean {
  return state?.bounty === true;
}

/** End the streak and the bounty on this record, silently, and return whether
 *  a bounty was standing. The caller decides what to announce, because only
 *  the death hook knows whether a world kill ended it. */
export function clearWorldPvpBounty(state: WorldPvpMetaState | undefined, e: Entity): boolean {
  const had = hasWorldPvpBounty(state);
  if (state) {
    if (state.streak !== undefined) state.streak = 0;
    if (state.bounty !== undefined) state.bounty = false;
  }
  if (e.bounty) e.bounty = false;
  return had;
}

/** Tell the holder alone that their bounty lapsed. */
export function noticeWorldPvpBountyLapsed(ctx: SimContext, pid: number): void {
  ctx.emit({ type: 'log', text: WORLD_PVP_BOUNTY_LAPSED_LINE, color: NOTICE_COLOR, pid });
}

/** Tell the realm a world kill collected a bounty. */
export function announceWorldPvpBountyCollected(
  ctx: SimContext,
  killerName: string,
  holderName: string,
): void {
  ctx.emit({
    type: 'log',
    text: worldPvpBountyCollectedLine(killerName, holderName),
    color: BOUNTY_COLOR,
  });
}

/**
 * One paid world kill for this contributor. Only a FLAGGED contributor builds
 * a streak (an unflagged player never carries the stake, and a bounty they
 * could walk out of a free-for-all zone with would be unreachable on contested
 * ground), and only a LIVING one: an assist credited after the contributor
 * already fell (the assist window outlives them) never restarts a streak their
 * own death just ended. The kill that completes the streak places the bounty and tells the
 * realm; later kills keep it standing without re-announcing it.
 */
export function noteWorldPvpStreakKill(ctx: SimContext, e: Entity, state: WorldPvpMetaState): void {
  if (!e.pvpFlag || e.dead) return;
  state.streak = (state.streak ?? 0) + 1;
  if (state.bounty || !worldPvpStreakEarnsBounty(state.streak)) return;
  state.bounty = true;
  e.bounty = true;
  ctx.emit({ type: 'log', text: worldPvpBountyPlacedLine(e.name), color: BOUNTY_COLOR });
  ctx.emit({ type: 'log', text: WORLD_PVP_BOUNTY_EARNED_LINE, color: BOUNTY_COLOR, pid: e.id });
}
