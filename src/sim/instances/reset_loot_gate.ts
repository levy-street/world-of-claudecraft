// The "loot remains inside" half of an instance reset (resetDungeonInstances in
// dungeons.ts, shared by the difficulty toggle, its queued retry, and Reset All
// Instances).
//
// The gate exists so a reset never wipes loot the group still means to take: an
// open need-greed roll, a shared drop of common quality or better, or a personal
// slot (a held roll award, a Heroic Marks token) whose recipient is online to
// take it (a held award's winner counts even while offline: the hold re-points
// the slot when they relog). Everything else is loot nobody can or will take
// before the empty-instance reaper frees the claim anyway, so it no longer
// blocks: leftover copper, a poor-quality (grey) drop, an unclaimed harvest, and
// a personal slot whose every recipient has gone offline (a relog mints a new
// entity id, so the slot no longer names them). Before this, any one of those on
// any corpse in the claim held the group's difficulty change until the reaper ran.
//
// A personal QUEST slot never blocks either. It names specific players (the
// guaranteed Forgefather's Ember on Varkhul in the Crucible, say), nobody else
// can take it, and instance corpses never decay, so a recipient who walked away
// or relogged left the whole raid unable to change difficulty at all (owner
// report 2026-11-05). Instead the reset delivers it to each recipient who is
// still online and has room, the same capacity check the corpse take path uses,
// and only an undeliverable copy is lost with the instance.
//
// `src/sim`-pure: no DOM/Three, no wall clock, no rng.

import { ITEMS, MOBS } from '../data';
import { mobLootSource } from '../loot/awarded_loot_hold';
import { hasPendingLootRollForMob } from '../loot/loot_roll';
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

/** Can a recipient named on a personal slot still take it: an online player who
 *  is not logging out, or the winner of a held roll award, whose durable
 *  character the corpse records (heldLootOwners) so rebindHeldAwardsOnJoin
 *  re-points the slot when they relog. Any other stale id cannot. */
function recipientCanTake(
  ctx: SimContext,
  mob: Pick<Entity, 'heldLootOwners'>,
  pid: number,
): boolean {
  if (mob.heldLootOwners?.has(pid)) return true;
  const meta = ctx.players.get(pid);
  return meta !== undefined && !meta.leaving;
}

/** Does this one live slot hold loot someone may still take before the claim
 *  is freed: a personal slot (other than a quest slot, which the reset
 *  delivers) with a recipient who can still take it, or a shared drop above
 *  poor quality. */
export function lootSlotBlocksInstanceReset(
  ctx: SimContext,
  mob: Pick<Entity, 'templateId' | 'heldLootOwners'>,
  slot: LootSlot,
): boolean {
  if (slot.count <= 0) return false;
  if (slot.personalFor) {
    if (isPersonalQuestSlot(mob, slot)) return false;
    return slot.personalFor.some((pid) => recipientCanTake(ctx, mob, pid));
  }
  return ITEMS[slot.itemId]?.quality !== 'poor';
}

/** Does this corpse hold loot that must stop a reset? Any slot
 *  lootSlotBlocksInstanceReset keeps does, and so does an open need-greed roll
 *  (checked last: it scans the realm's open rolls, and the queued retry asks
 *  every second). Copper, an unclaimed harvest, and a body with no loot left
 *  (the harvest grace window) do not: nothing on them is worth stranding the
 *  group's reset. */
export function corpseBlocksInstanceReset(ctx: SimContext, mob: Entity | undefined): boolean {
  if (!mob?.lootable) return false;
  if (mob.loot?.items.some((slot) => lootSlotBlocksInstanceReset(ctx, mob, slot))) return true;
  return hasPendingLootRollForMob(ctx, mob.id);
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
