// Auto-equip is shared by ordinary and exceptional acquisitions. Profession
// instance grants retain their existing explicit-equip behavior.
import { autoEquipFamilyConflict } from './auto_equip_gate';
import { ITEMS } from './data';
import { canEquipItem, equipCandidateInstance, resolveEquipSlot } from './equipment_rules';
import { itemInstancePayloadsEqual } from './item_instance_merge';
import { activeItemInstanceStats } from './item_instance_stats';
import { itemInstanceLevel } from './item_level';
import { meetsLevelRequirement } from './item_level_req';
import { desiredEquipSlot, equipItem } from './items';
import { lootQualityWeapon } from './loot_quality';
import type { PlayerMeta } from './sim';
import type { SimContext } from './sim_context';
import type { ItemDef, ItemInstancePayload } from './types';

function resolvedArmor(item: ItemDef, instance?: ItemInstancePayload): number {
  return (item.stats?.armor ?? 0) + (activeItemInstanceStats(instance, item)?.armor ?? 0);
}

export function maybeAutoEquip(
  ctx: SimContext,
  itemId: string,
  meta: PlayerMeta,
  granted?: ItemInstancePayload,
): void {
  const def = ITEMS[itemId];
  if (!def?.slot || !canEquipItem(meta.cls, def)) return;
  // Skip silently (no error toast) if the piece is gated above the player's
  // level: auto-equip is a convenience, the explicit equip path is where the
  // "must be level N" message belongs.
  const e = ctx.entities.get(meta.entityId);
  if (e && !meetsLevelRequirement(e.level, def)) return;
  // Payload stacking can merge a grant into an earlier row. Name the exact
  // descriptor instead of assuming the newest matching item id is the grant.
  let index: number | undefined;
  if (granted) {
    index = -1;
    for (let candidate = meta.inventory.length - 1; candidate >= 0; candidate--) {
      const slot = meta.inventory[candidate];
      if (slot.itemId === itemId && itemInstancePayloadsEqual(slot.instance, granted)) {
        index = candidate;
        break;
      }
    }
  }
  if (index === -1) return;
  // Skip silently when an explicit equip would be refused by a worn-family
  // rule (the unique-equipped legendary family, or the Masterwrought counted
  // cap): the refusal toast belongs to the explicit path. Both rules and the
  // reason auto-equip declines rather than displacing live in
  // src/sim/auto_equip_gate.ts.
  if (autoEquipFamilyConflict(def, itemId, meta, (id) => ITEMS[id], index)) return;
  const incoming = equipCandidateInstance(meta.inventory, itemId, index);
  if (def.kind === 'weapon') {
    // No aimed slot on either arm: equipItem routes the hand from the committed
    // spec (items.ts desiredEquipSlot), so a one-hander lands in the offhand of
    // a dual-wielder with a full mainhand whether or not it carries a descriptor.
    // Compare against the copy that hand actually wears: judging against the
    // mainhand while the grant lands in the offhand let a copy that beat the
    // mainhand replace a BETTER offhand weapon. A non-weapon in the routed hand
    // (a shield or held offhand) keeps the mainhand comparison, the existing
    // displacement rule. Only the exact-copy index is new here.
    const routed = desiredEquipSlot(meta, itemId);
    if (!routed) return;
    const routedWornId = meta.equipment[routed];
    const routedWorn = routedWornId ? ITEMS[routedWornId] : undefined;
    const hand = routedWorn && routedWorn.kind !== 'weapon' ? 'mainhand' : routed;
    const wornId = meta.equipment[hand];
    const worn = wornId ? ITEMS[wornId] : undefined;
    const current = worn ? lootQualityWeapon(worn, meta.equipmentInstance[hand]) : undefined;
    const next = lootQualityWeapon(def, incoming);
    if (next && (!current || next.min + next.max > current.min + current.max))
      equipItem(ctx, itemId, meta.entityId, undefined, index);
    return;
  }
  const slot = resolveEquipSlot(def, meta.equipment);
  const wornId = slot ? meta.equipment[slot] : undefined;
  const worn = wornId ? ITEMS[wornId] : undefined;
  const wornInstance = slot ? meta.equipmentInstance[slot] : undefined;
  const betterSameItem =
    granted &&
    wornId === itemId &&
    (itemInstanceLevel(def, incoming) ?? 0) > (itemInstanceLevel(def, wornInstance) ?? 0);
  if (!worn || resolvedArmor(def, incoming) > resolvedArmor(worn, wornInstance) || betterSameItem)
    equipItem(ctx, itemId, meta.entityId, undefined, index);
}
