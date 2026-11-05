// The "loot remains inside" half of an instance reset (resetDungeonInstances in
// dungeons.ts, shared by the difficulty toggle and Reset All Instances).
//
// The gate exists so a reset never wipes loot the group still means to take:
// copper, a shared drop, a held roll award, or an open need-greed roll. A
// personal QUEST slot is different. It names specific players (the guaranteed
// Forgefather's Ember on Varkhul in the Crucible, say), nobody else can take
// it, and a recipient who walks away or relogs (a relog mints a new entity id,
// so the slot no longer names them) left the whole raid unable to change
// difficulty until the corpse decayed (owner report 2026-11-05). So a personal
// quest slot never blocks; instead the reset delivers it to each recipient who
// is still online and has room, the same capacity check the corpse take path
// uses, and only an undeliverable copy is lost with the instance.
//
// `src/sim`-pure: no DOM/Three, no wall clock, no rng.

import { ITEMS } from '../data';
import { mobLootSource } from '../loot/awarded_loot_hold';
import { hasPendingLootRollForMob } from '../loot/loot_roll';
import type { SimContext } from '../sim_context';
import { cloneItemInstancePayload, type Entity, type LootSlot } from '../types';

/** A live slot only its listed players may take, holding a quest item. A
 *  shared-personal token slot (Heroic Marks) is not one: it pays everyone. */
export function isPersonalQuestSlot(slot: LootSlot): boolean {
  return (
    slot.count > 0 &&
    !!slot.personalFor &&
    slot.personalFor.length > 0 &&
    !slot.sharedPersonal &&
    ITEMS[slot.itemId]?.kind === 'quest'
  );
}

/** Does this corpse hold loot that must stop a reset? A lootable body with no
 *  loot table still blocks (an open roll or a harvest grace window), as does
 *  copper or any live slot other than a personal quest slot. */
export function corpseBlocksInstanceReset(ctx: SimContext, mob: Entity | undefined): boolean {
  if (!mob?.lootable) return false;
  if (!mob.loot || hasPendingLootRollForMob(ctx, mob.id)) return true;
  if (mob.loot.copper > 0) return true;
  return mob.loot.items.some(
    (slot) =>
      slot.count > 0 &&
      (!slot.personalFor || slot.personalFor.length > 0) &&
      !isPersonalQuestSlot(slot),
  );
}

/** Hand each unclaimed personal quest slot on the claim's corpses to its
 *  recipients before the claim is freed. Only an online recipient whose bags
 *  fit it receives a copy; the slot is then emptied so nothing is granted
 *  twice. Iterates the claim's fixed mob list in order (deterministic). */
export function deliverPersonalQuestLoot(ctx: SimContext, mobIds: readonly number[]): void {
  for (const id of mobIds) {
    const mob = ctx.entities.get(id);
    if (!mob?.dead || !mob.loot) continue;
    for (const slot of mob.loot.items) {
      if (!isPersonalQuestSlot(slot)) continue;
      const lootOpts = { source: mobLootSource(mob) };
      for (const pid of slot.personalFor ?? []) {
        if (!ctx.players.has(pid) || !ctx.entities.has(pid)) continue;
        if (!ctx.canAddItem(slot.itemId, slot.count, pid, slot.instance)) continue;
        if (slot.instance) {
          ctx.addItemInstance(
            slot.itemId,
            cloneItemInstancePayload(slot.instance),
            pid,
            slot.count,
            lootOpts,
          );
        } else {
          ctx.addItem(slot.itemId, slot.count, pid, lootOpts);
        }
      }
      slot.personalFor = [];
      slot.count = 0;
    }
  }
}
