// The portal toll (PortalDef.tollCopper): the one coin-taking step of an
// overworld crossing, settled BEFORE portals.ts moves anyone. A traveler who
// can pay is charged and waved through; one who cannot, or who is in combat,
// is refused once per approach (Entity.portalHoldId latches the refusal until
// they step out of the trigger, portals.ts clears it) and never moved, so
// standing in a dark waystone costs nothing and spams nothing, and a tolled
// arch in a town yard is never a fight exit. A portal without a toll is the
// Duskfall cave: always open, in combat too (its shipped rule).
//
// Caller contract: a LIVE player entity (portals.ts runs inside the tick's
// `!p.dead` arm); a corpse is never charged. Draws ZERO rng and touches only
// the player's own purse, so it runs byte-identically in the offline browser,
// the server, and the headless env. The paid crossing emits a text-free
// `portalToll` event the server books as a 'travel' copper flow.

import type { SimContext } from './sim_context';
import type { Entity, PortalDef } from './types';

export const PORTAL_TOLL_REFUSAL = 'Not enough money.';
export const PORTAL_TOLL_COMBAT_REFUSAL = "You can't do that while in combat.";

function refuseOnce(ctx: SimContext, p: Entity, portal: PortalDef, text: string): false {
  if (p.portalHoldId !== portal.id) {
    p.portalHoldId = portal.id;
    ctx.error(p.id, text);
  }
  return false;
}

/** Whether `p` may cross `portal` right now. Charges the toll when it can be
 *  paid; emits the refusal (once per approach) when it cannot. */
export function settlePortalToll(ctx: SimContext, p: Entity, portal: PortalDef): boolean {
  const toll = portal.tollCopper ?? 0;
  if (toll <= 0) return true;
  if (p.inCombat) return refuseOnce(ctx, p, portal, PORTAL_TOLL_COMBAT_REFUSAL);
  // No purse to charge (an entity without PlayerMeta): a tolled arch is a
  // wall for it, silently, since there is nobody to toast. Unreachable from
  // the live tick, which only walks players with meta.
  const meta = ctx.players.get(p.id);
  if (!meta) return false;
  if (meta.copper < toll) return refuseOnce(ctx, p, portal, portal.tollText ?? PORTAL_TOLL_REFUSAL);
  meta.copper -= toll;
  ctx.emit({ type: 'portalToll', pid: p.id, copper: toll });
  return true;
}
