// Apply a reward that was already rolled and durably claimed by the host.
// The online path never draws RNG here, so a retry cannot change its parcel.

import { isAutoEquipGearKind, maybeAutoEquip } from '../auto_equip';
import type { TreasureMapRarity } from '../content/treasure_maps';
import { ITEMS } from '../data';
import { grantEarnedHeroicMarks } from '../earned_heroic_marks';
import { assertHeroicMarksGrantsFit, isHeroicMarkGrantId } from '../heroic_marks';
import type { SimContext } from '../sim_context';
import { cloneItemInstancePayload, type InvSlot } from '../types';
import { hoardRewardGrantItems } from './hoard_reward_items';
import type { HoardReward } from './hoard_reward_roll';

export function grantHoardReward(
  ctx: SimContext,
  pid: number,
  rarity: TreasureMapRarity,
  reward: HoardReward,
  reservedAtClear = false,
  preparedItems?: readonly InvSlot[],
): boolean {
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  if (!meta || !player || meta.leaving) return false;
  if (reward.capped) {
    ctx.emit({ type: 'treasureVaultLooted', rarity, capped: true, pid });
    return true;
  }
  // Online projection follows a durable preflighted claim. Local rewards have
  // already been earned, so overflow must enter authored mail instead of
  // refusing a chest click, zone-out or teardown after the boss died.
  assertHeroicMarksGrantsFit(reservedAtClear ? meta : { heroicMarks: 0 }, reward.items);
  const grants = preparedItems ?? hoardRewardGrantItems(reward.items);
  for (const item of grants) {
    if (isHeroicMarkGrantId(item.itemId)) {
      if (reservedAtClear) ctx.addItem(item.itemId, item.count, pid);
      else grantEarnedHeroicMarks(ctx, pid, item.count);
    } else {
      // A stored descriptor is re-validated: a malformed one grants the plain copy.
      if (item.instance) {
        ctx.addItemInstance(item.itemId, cloneItemInstancePayload(item.instance), pid, item.count);
        // Preparing a plain reward's identity must retain addItem's auto-equip
        // behavior. Quality-bearing rewards already auto-equip in the hub.
        if (
          preparedItems &&
          !item.instance.lootQuality &&
          meta.autoEquip &&
          isAutoEquipGearKind(ITEMS[item.itemId])
        )
          maybeAutoEquip(ctx, item.itemId, meta, item.instance);
      } else ctx.addItem(item.itemId, item.count, pid);
    }
  }
  meta.copper += reward.copper;
  meta.clueCasketsOpened = (meta.clueCasketsOpened ?? 0) + 1;
  ctx.markDeedsDirty(pid);
  ctx.emit({
    type: 'treasureVaultLooted',
    rarity,
    capped: false,
    itemIds: reward.items.map((item) => item.itemId),
    copper: reward.copper,
    pid,
  });
  return true;
}
