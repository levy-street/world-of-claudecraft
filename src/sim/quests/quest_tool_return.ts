// Quest tools a quest hands out for its own duration, and how they go back to the giver.
//
// A quest tool is an item flagged `questTool` whose `questId` names the quest that grants it
// through `requiredItems` (Skerrit's Shardpike, the first: a two-handed weapon the player
// WIELDS, so it can sit in a weapon slot as well as the bags). Such a tool is undiscardable
// and unsellable, so the quest itself has to take it back or it is stuck forever:
//
//   - turn-in and abandon take every carried and worn copy back (stripRequiredItems in
//     quest_commands.ts calls takeBackQuestTool with keep 0);
//   - talking to the giver hands it back too: every copy when the quest is not in the log
//     (already finished, abandoned, or never taken), and every copy past the first while it
//     is active, so a player can never hold more than one.
//
// Bags, worn slots and the bank are all read. The bank refuses quest tools now (bank.ts),
// but a copy banked before that rule landed must still go home. Draws no rng.
import { bumpBankWireRev } from '../bank';
import { ITEMS, QUESTS } from '../data';
import { recalcPlayerStats } from '../entity';
import { refreshModsForEquipmentChange } from '../progression/talents';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { EquipSlot, QuestDef } from '../types';

/** Is `itemId` a tool this quest lends (questTool, owned by this quest)? */
export function isOwnQuestTool(quest: QuestDef, itemId: string): boolean {
  const def = ITEMS[itemId];
  return !!def && def.questTool === true && def.questId === quest.id;
}

/**
 * Take copies of a quest tool off the player until `keep` remain across the bags and worn
 * slots. A worn copy is kept before a carried one (it is the one in use). Returns how many
 * were taken. Ends a live Shardpike brace when the worn copy goes.
 */
export function takeBackQuestTool(
  ctx: SimContext,
  meta: PlayerMeta,
  itemId: string,
  keep: number,
): number {
  const pid = meta.entityId;
  let taken = 0;
  let left = keep;
  const wornSlots = (Object.keys(meta.equipment) as EquipSlot[]).filter(
    (slot) => meta.equipment[slot] === itemId,
  );
  const carried = ctx.countItem(itemId, pid);
  // Worn copies claim the kept count first, then the bags, then the bank.
  const keptWorn = Math.min(left, wornSlots.length);
  left -= keptWorn;
  const keptBags = Math.min(left, carried);
  left -= keptBags;
  const bagTake = carried - keptBags;
  if (bagTake > 0) {
    ctx.removeItem(itemId, bagTake, pid);
    taken += bagTake;
  }
  // A copy banked before the bank refused quest tools (bank.ts) comes back too.
  const bank = meta.bank?.inventory ?? [];
  let bankChanged = false;
  for (let i = bank.length - 1; i >= 0; i--) {
    const slot = bank[i];
    if (slot.itemId !== itemId || slot.count <= 0) continue;
    const keepHere = Math.min(left, slot.count);
    left -= keepHere;
    const drop = slot.count - keepHere;
    if (drop <= 0) continue;
    taken += drop;
    bankChanged = true;
    if (keepHere > 0) slot.count = keepHere;
    else bank.splice(i, 1);
  }
  if (bankChanged) bumpBankWireRev(meta);
  const unwear = wornSlots.slice(keptWorn);
  if (unwear.length === 0) return taken;
  for (const slot of unwear) {
    delete meta.equipment[slot];
    if (meta.equipmentInstance) delete meta.equipmentInstance[slot];
    taken++;
  }
  // A worn copy left without the bag path, so poke the quest-inventory recompute too.
  ctx.onInventoryChangedForQuests(meta);
  const p = ctx.entities.get(pid);
  if (meta.lance) {
    meta.lance = undefined;
    if (p) p.bracing = false;
  }
  refreshModsForEquipmentChange(ctx, meta);
  if (p)
    recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
  ctx.markDeedsDirty(pid);
  return taken;
}

/** The line the giver's hand-back logs (English; re-localized by the client's EXACT
 *  matcher, sim_i18n.ts 'log.questToolReturned'). */
export const QUEST_TOOL_RETURNED_TEXT = 'You hand back a quest item you no longer need.';

/**
 * Talking to a quest giver takes back the tools of that giver's quests the player should
 * not still hold: all of them when the quest is not in the log, extras past one while it is.
 */
export function returnQuestToolsToGiver(
  ctx: SimContext,
  meta: PlayerMeta,
  npcTemplateId: string,
): void {
  let returned = 0;
  for (const quest of Object.values(QUESTS)) {
    if (quest.giverNpcId !== npcTemplateId || !quest.requiredItems) continue;
    const active = meta.questLog.get(quest.id)?.state === 'active';
    for (const itemId of quest.requiredItems) {
      if (!isOwnQuestTool(quest, itemId)) continue;
      returned += takeBackQuestTool(ctx, meta, itemId, active ? 1 : 0);
    }
  }
  if (returned > 0) {
    ctx.emit({ type: 'log', text: QUEST_TOOL_RETURNED_TEXT, color: '#ff0', pid: meta.entityId });
  }
}
