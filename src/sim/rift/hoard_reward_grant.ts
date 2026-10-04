// Apply a reward that was already rolled and durably claimed by the host.
// The online path never draws RNG here, so a retry cannot change its parcel.

import type { TreasureMapRarity } from '../content/treasure_maps';
import type { SimContext } from '../sim_context';
import type { HoardReward } from './hoard_reward_roll';

export function grantHoardReward(
  ctx: SimContext,
  pid: number,
  rarity: TreasureMapRarity,
  reward: HoardReward,
): boolean {
  const meta = ctx.players.get(pid);
  const player = ctx.entities.get(pid);
  if (!meta || !player || meta.leaving) return false;
  if (reward.capped) {
    ctx.emit({ type: 'treasureVaultLooted', rarity, capped: true, pid });
    return true;
  }
  for (const item of reward.items) ctx.addItem(item.itemId, item.count, pid);
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
