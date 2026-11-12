// The "loot remains inside" half of an instance reset (resetDungeonInstances in
// dungeons.ts, shared by the difficulty toggle, its queued retry, and Reset All
// Instances).
//
// The gate exists so a reset never wipes loot the group still means to take:
// copper, a shared drop, a held roll award, an open need-greed roll, or an
// unclaimed harvest. A personal QUEST slot is different. It names specific
// players (the guaranteed Forgefather's Ember on Varkhul in the Crucible, say),
// nobody else can take it, and instance corpses never decay, so a recipient who
// walked away or relogged (a relog mints a new entity id, so the slot no longer
// names them) left the whole raid unable to change difficulty at all (owner
// report 2026-11-05). So a personal quest slot never blocks; instead the reset
// delivers it to each recipient who is still online and has room, the same
// capacity check the corpse take path uses, and only an undeliverable copy is
// lost with the instance.
//
// `src/sim`-pure: no DOM/Three, no wall clock, no rng.

import { MOBS } from '../data';
import { mobLootSource } from '../loot/awarded_loot_hold';
import { hasPendingLootRollForMob } from '../loot/loot_roll';
import { isHarvestableCorpse } from '../professions/gathering';
import type { SimContext } from '../sim_context';
import type { Entity, LootSlot } from '../types';

/** A live slot only its listed players may take, rolled by one of this mob's
 *  quest-gated loot entries (the questId branch of rollLoot). Classified from
 *  the mob's own loot table, not the item kind, so a held roll award or any
 *  other personal slot never reads as a quest slot. A shared-personal token
 *  slot (Heroic Marks) is not one either: it pays everyone. */
export function isPersonalQuestSlot(mob: Pick<Entity, 'templateId'>, slot: LootSlot): boolean {
  return (
    slot.count > 0 &&
    !!slot.personalFor &&
    slot.personalFor.length > 0 &&
    !slot.sharedPersonal &&
    (MOBS[mob.templateId]?.loot?.some((e) => !!e.questId && e.itemId === slot.itemId) ?? false)
  );
}

/** Does this corpse hold loot that must stop a reset? A lootable body with no
 *  loot table still blocks (an open roll or a harvest grace window), as do an
 *  open roll, an unclaimed harvest, copper, and any live slot other than a
 *  personal quest slot. */
export function corpseBlocksInstanceReset(ctx: SimContext, mob: Entity | undefined): boolean {
  if (!mob?.lootable) return false;
  if (!mob.loot || hasPendingLootRollForMob(ctx, mob.id)) return true;
  if (mob.loot.copper > 0) return true;
  if (isHarvestableCorpse(MOBS[mob.templateId]?.componentTags) && mob.harvestClaimedBy === null) {
    return true;
  }
  return mob.loot.items.some(
    (slot) =>
      slot.count > 0 &&
      (!slot.personalFor || slot.personalFor.length > 0) &&
      !isPersonalQuestSlot(mob, slot),
  );
}

/** Hand each unclaimed personal quest slot on the claim's lootable corpses to
 *  its recipients before the claim is freed. Only an online recipient (not
 *  logging out) whose bags fit it receives a copy; the slot is then emptied so
 *  nothing is granted twice. Iterates the claim's fixed mob list in order. */
export function deliverPersonalQuestLoot(ctx: SimContext, mobIds: readonly number[]): void {
  for (const id of mobIds) {
    const mob = ctx.entities.get(id);
    // The same corpse condition the gate reads, so every slot it let through is
    // a slot delivered here.
    if (!mob?.lootable || !mob.loot) continue;
    for (const slot of mob.loot.items) {
      if (!isPersonalQuestSlot(mob, slot) || !slot.personalFor) continue;
      const lootOpts = { source: mobLootSource(mob) };
      // Quest slots never carry an item instance (rollLoot builds them bare and
      // the quality roll excludes them), so a plain grant is the whole job.
      // canAddItem also refuses an id that no longer resolves to a player.
      for (const pid of slot.personalFor) {
        if (ctx.players.get(pid)?.leaving) continue;
        if (!ctx.canAddItem(slot.itemId, slot.count, pid)) continue;
        ctx.addItem(slot.itemId, slot.count, pid, lootOpts);
      }
      slot.personalFor = [];
      slot.count = 0;
    }
  }
}
