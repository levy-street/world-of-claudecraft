// The vault's one payout decision. It consumes only a captured entrant snapshot
// and the shared deterministic RNG, so a disconnected entrant can receive the
// same frozen reward parcel an online entrant would have received at boss death.

import { treasureCasketCopper } from '../clue_casket';
import { HEROIC_MARK_CURRENCY_ID } from '../content/dungeon_difficulty';
import { rollHoardBossDrop } from '../content/hoard_loot';
import {
  nextTreasureMapRarity,
  TREASURE_MAP_ITEM_IDS,
  type TreasureMapRarity,
  VAULT_GUEST_GEAR_CHANCE,
  VAULT_MATERIAL_POOL,
  VAULT_OWNER_COPPER_BONUS,
  VAULT_PAYOUTS,
} from '../content/treasure_maps';
import { rollFreshLootQualities } from '../loot/fresh_quality_grant';
import type { LootQualityDescriptor } from '../loot_quality';
import type { Rng } from '../rng';
import type { PlayerClass } from '../types';

const VAULT_MOUNT_REINS_ITEM_ID = 'reins_lanternback_troll';

export interface HoardRewardInput {
  rarity: TreasureMapRarity;
  bossTemplateId?: string;
  cls: PlayerClass;
  level: number;
  owner: boolean;
  guestCapped: boolean;
  mountOwned: boolean;
}

/** One parcel line. `lootQuality` is set only on an enhanced one-copy gear line. */
export interface HoardRewardItem {
  itemId: string;
  count: number;
  lootQuality?: LootQualityDescriptor;
}

export interface HoardReward {
  readonly items: readonly Readonly<HoardRewardItem>[];
  readonly copper: number;
  readonly capped: boolean;
}

/** Fixed draw order: material, gear, marks, mount, next map. Every
 * chance is drawn even for an already-owned mount or a top-tier map. A capped
 * guest takes no draws; the owner is exempt from that cap. */
export function rollHoardReward(
  rng: Pick<Rng, 'int' | 'chance'>,
  input: HoardRewardInput,
): HoardReward {
  if (!input.owner && input.guestCapped)
    return Object.freeze({ items: Object.freeze([]), copper: 0, capped: true });

  const def = VAULT_PAYOUTS[input.rarity];
  const items: HoardRewardItem[] = [];
  const material = VAULT_MATERIAL_POOL[rng.int(0, VAULT_MATERIAL_POOL.length - 1)];
  items.push({ itemId: material, count: def.materials });
  let gear: HoardRewardItem | undefined;
  if (rng.chance(input.owner ? def.gearChance : VAULT_GUEST_GEAR_CHANCE[input.rarity])) {
    gear = {
      itemId: rollHoardBossDrop(rng, input.bossTemplateId, input.rarity, input.cls),
      count: 1,
    };
    items.push(gear);
  }
  if (rng.chance(def.markChance)) items.push({ itemId: HEROIC_MARK_CURRENCY_ID, count: def.marks });
  if (rng.chance(def.mountChance) && !input.mountOwned)
    items.push({ itemId: VAULT_MOUNT_REINS_ITEM_ID, count: 1 });
  const next = nextTreasureMapRarity(input.rarity);
  if (rng.chance(def.nextMapChance) && next)
    items.push({ itemId: TREASURE_MAP_ITEM_IDS[next], count: 1 });

  // The gear piece's permanent quality draws LAST, so every earlier draw keeps
  // its old position; it is frozen into the parcel like the rest of the roll.
  const [lootQuality] = gear ? rollFreshLootQualities(rng, gear.itemId, 1) : [];
  if (gear && lootQuality) gear.lootQuality = lootQuality;

  const base = treasureCasketCopper(input.level) * def.copperMult;
  const copper = Math.round(input.owner ? base * (1 + VAULT_OWNER_COPPER_BONUS) : base);
  return Object.freeze({
    items: Object.freeze(items.map((item) => Object.freeze(item))),
    copper,
    capped: false,
  });
}
