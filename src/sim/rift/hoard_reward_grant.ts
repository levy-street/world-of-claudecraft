// Apply a reward that was already rolled and durably claimed by the host.
// The online path never draws RNG here, so a retry cannot change its parcel.

import { type TreasureMapRarity, VAULT_GUEST_PAYOUTS_PER_CYCLE } from '../content/treasure_maps';
import { grantEarnedHeroicMarks } from '../earned_heroic_marks';
import { assertHeroicMarksGrantsFit, isCurrencyGrantId } from '../heroic_marks';
import { cloneLootQuality } from '../loot_quality';
import type { SimContext } from '../sim_context';
import type { HoardReward } from './hoard_reward_roll';

export function grantHoardReward(
  ctx: SimContext,
  pid: number,
  rarity: TreasureMapRarity,
  reward: HoardReward,
  owner: boolean,
  guestCycle?: string,
  reservedAtClear = false,
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
  if (
    !owner &&
    !reservedAtClear &&
    (guestCycle === undefined || guestCycle === meta.worldQuestCycle)
  ) {
    if (meta.vaultGuestCycle !== meta.worldQuestCycle) {
      meta.vaultGuestCycle = meta.worldQuestCycle;
      meta.vaultGuestPayouts = 0;
    }
    meta.vaultGuestPayouts = Math.min(
      VAULT_GUEST_PAYOUTS_PER_CYCLE,
      (meta.vaultGuestPayouts ?? 0) + 1,
    );
  }
  for (const item of reward.items) {
    if (isCurrencyGrantId(item.itemId)) {
      if (reservedAtClear) ctx.addItem(item.itemId, item.count, pid);
      else grantEarnedHeroicMarks(ctx, pid, item.count);
    } else {
      // A stored descriptor is re-validated: a malformed one grants the plain copy.
      const lootQuality = cloneLootQuality(item.lootQuality);
      if (lootQuality) ctx.addItemInstance(item.itemId, { lootQuality }, pid, item.count);
      else ctx.addItem(item.itemId, item.count, pid);
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
