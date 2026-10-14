// Pure decision for the gossip dialog's Allied Hearthstone attune row: a
// faction quartermaster offers to bind the stone to its hub, which is the
// "Speak with an allied quartermaster" route the stone's not-attuned error
// names. The sim re-validates everything (src/sim/content/faction_rewards.ts
// attuneAlliedHearthstoneAtNpc); this only decides whether the row renders.
//
// DOM-free and i18n-free (quest_dialog_controller localizes the row); the
// inputs are mirrored IWorld reads, so both hosts resolve identically.

import { vendorFactionForNpc } from '../../../sim/content/faction_vendors';
import type { FactionId } from '../../../sim/factions';
import type { InvSlot } from '../../../sim/types';

export const ALLIED_HEARTHSTONE_ITEM_ID = 'allied_hearthstone';

/**
 * The hub the row would bind the stone to, or null when it never renders:
 * the NPC is not a faction quartermaster, the viewer carries no stone in
 * their bags, or the stone is already bound to this quartermaster's hub.
 */
export function hearthstoneAttuneRowFaction(
  npcTemplateId: string | undefined,
  attunement: FactionId | null,
  inventory: readonly InvSlot[],
): FactionId | null {
  const factionId = vendorFactionForNpc(npcTemplateId);
  if (!factionId || factionId === attunement) return null;
  return inventory.some((slot) => slot.itemId === ALLIED_HEARTHSTONE_ITEM_ID) ? factionId : null;
}
