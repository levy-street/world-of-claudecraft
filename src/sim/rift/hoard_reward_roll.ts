// The vault's one payout decision. It consumes only a captured entrant snapshot
// and the shared deterministic RNG, so a disconnected entrant can receive the
// same frozen reward parcel an online entrant would have received at boss death.

import { treasureCasketCopper } from '../clue_casket';
import { HEROIC_MARK_ITEM_ID } from '../content/dungeon_difficulty';
import { rollHoardBossDrop } from '../content/hoard_loot';
import {
  nextTreasureMapRarity,
  TREASURE_MAP_ITEM_IDS,
  type TreasureMapRarity,
  VAULT_GUEST_GEAR_CHANCE,
  VAULT_OWNER_COPPER_BONUS,
  VAULT_PAYOUTS,
} from '../content/treasure_maps';
import type { Rng } from '../rng';
import type { PlayerClass } from '../types';

const CASKET_MATERIAL_POOL = ['thorium_ore', 'elderwood_log', 'sunpetal_herb'] as const;
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

export interface HoardReward {
  readonly items: readonly Readonly<{ itemId: string; count: number }>[];
  readonly copper: number;
  readonly capped: boolean;
}

/** Preserve the old draw order even for already-owned mounts and top-tier maps.
 * A capped guest takes no draws; the owner is exempt from that cap. */
export function rollHoardReward(
  rng: Pick<Rng, 'int' | 'chance'>,
  input: HoardRewardInput,
): HoardReward {
  if (!input.owner && input.guestCapped)
    return Object.freeze({ items: Object.freeze([]), copper: 0, capped: true });

  const def = VAULT_PAYOUTS[input.rarity];
  const items: Array<{ itemId: string; count: number }> = [];
  const material = CASKET_MATERIAL_POOL[rng.int(0, CASKET_MATERIAL_POOL.length - 1)];
  items.push({ itemId: material, count: def.materials });
  if (rng.chance(input.owner ? def.gearChance : VAULT_GUEST_GEAR_CHANCE[input.rarity])) {
    items.push({
      itemId: rollHoardBossDrop(rng, input.bossTemplateId, input.rarity, input.cls),
      count: 1,
    });
  }
  if (rng.chance(def.markChance)) items.push({ itemId: HEROIC_MARK_ITEM_ID, count: def.marks });
  if (rng.chance(def.mountChance) && !input.mountOwned)
    items.push({ itemId: VAULT_MOUNT_REINS_ITEM_ID, count: 1 });
  const next = nextTreasureMapRarity(input.rarity);
  if (rng.chance(def.nextMapChance) && next)
    items.push({ itemId: TREASURE_MAP_ITEM_IDS[next], count: 1 });

  const base = treasureCasketCopper(input.level) * def.copperMult;
  const copper = Math.round(input.owner ? base * (1 + VAULT_OWNER_COPPER_BONUS) : base);
  return Object.freeze({
    items: Object.freeze(items.map((item) => Object.freeze(item))),
    copper,
    capped: false,
  });
}
