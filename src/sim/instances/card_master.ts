// Range gate for the Card Master NPC (src/sim/content/card_master.ts): joining
// the Card Duel queue requires standing at the NPC, same reach as the
// copper-vendor family (items.ts vendorInRange) and the heroic quartermaster
// (src/sim/instances/heroic_vendor.ts). Leaving the queue, and playing cards
// once matched, do not require proximity: a match can be played from anywhere.

import { CARD_MASTER_NPC_ID } from '../content/card_master';
import type { SimContext } from '../sim_context';
import { dist2d, type Entity, INTERACT_RANGE } from '../types';

export function cardMasterInRange(ctx: SimContext, p: Entity): boolean {
  return [...ctx.entities.values()].some(
    (e) =>
      e.kind === 'npc' &&
      e.templateId === CARD_MASTER_NPC_ID &&
      dist2d(p.pos, e.pos) <= INTERACT_RANGE + 2,
  );
}
