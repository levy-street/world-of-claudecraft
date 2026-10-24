// The Mirefen hut torch on the client ("Back to the Shallows", q_deepfen_purge):
// which hovered object is a torchable mudfin hut, and whether the player carries
// the firebottle that torches it. The torch itself is the sim's
// (src/sim/interactions/firebottle_hut.ts): a click on the hut (either button),
// the interact key, the gamepad press and the mobile interact button all send the
// ordinary pickUpObject, which the authoritative sim answers by throwing the
// bottle for you. This module only lets the cursor say so (the gear, cursors.ts)
// before anyone has to read the quest text. Pure and DOM-free.

import { FIREBOTTLE_ITEM_ID } from '../sim/interactions/firebottle_hut';
import { MUDFIN_HUT_TEMPLATE_ID } from '../sim/mudfin_huts';
import type { Entity, InvSlot } from '../sim/types';

/** A mudfin hut a player can set alight: the quest's torchable ground object. The
 *  client only ever sees it while on the quest (it is quest-gated). */
export function isTorchableHut(e: Pick<Entity, 'kind' | 'templateId' | 'lootable'>): boolean {
  return e.kind === 'object' && e.templateId === MUDFIN_HUT_TEMPLATE_ID && e.lootable;
}

/** Whether the bags hold the firebottle, the quest item a hut press throws. */
export function carriesFirebottle(
  carried: readonly Pick<InvSlot, 'itemId' | 'count'>[] | undefined,
): boolean {
  if (!carried) return false;
  for (const slot of carried) {
    if (slot.itemId === FIREBOTTLE_ITEM_ID && slot.count > 0) return true;
  }
  return false;
}
