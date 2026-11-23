// Grant a freshly minted reward with its permanent loot-quality roll: the
// non-enemy twin of enemy_quality.ts for crafts, quest and world-quest
// rewards, weekly vault choices, caches and chests. Call it only where a copy
// first enters the world, never on a transfer (mail, trade, bank, buyback,
// market) and never on a vendor purchase, so a copy is rolled exactly once.
// An ineligible item takes no draw, so material and consumable grants keep
// their rng sequence; an eligible one takes one createLootQuality draw per copy.

import { ITEMS } from '../data';
import type { InventoryGrantOptions } from '../inventory_grant';
import {
  createLootQuality,
  isEligibleLootQualityItem,
  type LootQualityDescriptor,
} from '../loot_quality';
import type { Rng } from '../rng';
import type { SimContext } from '../sim_context';
import { cloneItemInstancePayload, type ItemInstancePayload } from '../types';

/** One quality draw per copy of an eligible item; an ineligible item draws nothing. */
export function rollFreshLootQualities(
  rng: Pick<Rng, 'int'>,
  itemId: string,
  count: number,
): (LootQualityDescriptor | undefined)[] {
  const item = Object.hasOwn(ITEMS, itemId) ? ITEMS[itemId] : undefined;
  if (!item || !isEligibleLootQualityItem(item) || !(count >= 1)) return [];
  return Array.from({ length: Math.floor(count) }, () => createLootQuality(rng));
}

/** Returns a clone of the first enhanced copy's whole payload (undefined when
 *  every copy is Ordinary), so a caller that owns the player line can link it. */
export function grantFreshLoot(
  ctx: Pick<SimContext, 'rng' | 'addItem' | 'addItemInstance'>,
  itemId: string,
  count: number,
  pid?: number,
  opts?: InventoryGrantOptions,
  instance?: ItemInstancePayload,
): ItemInstancePayload | undefined {
  const rolls = instance?.lootQuality ? [] : rollFreshLootQualities(ctx.rng, itemId, count);
  let ordinary = rolls.length ? 0 : count;
  let first: ItemInstancePayload | undefined;
  for (const lootQuality of rolls) {
    if (!lootQuality) {
      ordinary++;
      continue;
    }
    const base = instance ? cloneItemInstancePayload(instance) : {};
    const copy: ItemInstancePayload = { ...base, lootQuality };
    // The hub hands back the payload the copy landed with (a tracked copy's
    // minted guid and provenance included), so the caller links that copy.
    // The grant runs on its own line: a `??=` would skip it after the first.
    const landed = ctx.addItemInstance(itemId, copy, pid, 1, opts);
    first ??= landed || copy;
  }
  if (ordinary > 0) {
    if (instance) ctx.addItemInstance(itemId, instance, pid, ordinary, opts);
    else ctx.addItem(itemId, ordinary, pid, opts);
  }
  return first && cloneItemInstancePayload(first);
}
