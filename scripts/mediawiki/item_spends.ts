// "What it buys" for items the game takes as payment: shop tokens, Heroic Marks, Lantern
// Seals, Rift Essence and gems at the Rift Forge, the Perfecting materials and
// Cartographer's Ink. Shop stock comes from item_vendor_craft.ts (the same tables the "How
// to get" routes read); the other spends are read here from their sim modules.
import { DEEDS } from '../../src/sim/content/deeds';
import {
  GUILD_QUARTERMASTER_STOCK,
  type GuildQuartermasterOffer,
  LANTERN_SEAL_ITEM_ID,
} from '../../src/sim/content/guild_contracts';
import { GUILD_QUARTERMASTER_NPC_ID } from '../../src/sim/content/highwatch_guild';
import { RIFT_ESSENCE_ITEM_ID, RIFT_GEM_IDS } from '../../src/sim/content/rift/items';
import {
  CARTOGRAPHERS_INK_ITEM_ID,
  nextTreasureMapRarity,
  TREASURE_MAP_ITEM_IDS,
  TREASURE_MAP_RARITIES,
  TREASURE_MAP_UPGRADE_INKS,
} from '../../src/sim/content/treasure_maps';
import { NPCS } from '../../src/sim/data';
import {
  LEGENDARY_PROMOTION_COST,
  PERFECTING_ATTEMPT_COST,
} from '../../src/sim/professions/perfecting';
import { RIFT_BAND_MAX_UPGRADE } from '../../src/sim/rift/band_ladder';
import { riftUpgradeCost } from '../../src/sim/rift/progression';
import { armorySkinStrings } from '../../src/ui/i18n.catalog/armory';
import { type ArticleTools, ref } from './entity_format';
import { lootTable } from './item_contents';
import { type CurrencySpend, vendorCurrencySpends } from './item_vendor_craft';

function guildOfferText(w: ArticleTools, offer: GuildQuartermasterOffer): string {
  switch (offer.kind) {
    case 'title': {
      const reward = DEEDS[offer.deedId]?.reward;
      return (
        'The title "' + (reward?.kind === 'title' ? reward.text : DEEDS[offer.deedId]?.name) + '"'
      );
    }
    case 'mount':
      return ref(w, 'item', offer.itemId);
    case 'weaponSkin':
      return (
        (armorySkinStrings[offer.skinId as keyof typeof armorySkinStrings]?.name ?? offer.skinId) +
        ' (a weapon look for your whole account)'
      );
  }
}

/** Every currency item and what it can be spent on. */
export function currencySpendIndex(w: ArticleTools): Map<string, CurrencySpend[]> {
  const index = vendorCurrencySpends(w);
  const add = (currency: string, spend: CurrencySpend) =>
    index.set(currency, [...(index.get(currency) ?? []), spend]);
  const item = (id: string) => ref(w, 'item', id);

  for (const offer of GUILD_QUARTERMASTER_STOCK)
    add(LANTERN_SEAL_ITEM_ID, {
      buys: guildOfferText(w, offer),
      cost: offer.seals,
      where: ref(w, 'npc', GUILD_QUARTERMASTER_NPC_ID),
      notes: 'Cosmetic only. It gives no power.',
    });

  const forge = Object.values(NPCS)
    .filter((npc) => npc.riftForge)
    .map((npc) => ref(w, 'npc', npc.id))
    .join(' or ');
  for (let rank = 0; rank < RIFT_BAND_MAX_UPGRADE; rank++)
    add(RIFT_ESSENCE_ITEM_ID, {
      buys: 'Upgrade a Riftbound band from rank ' + rank + ' to rank ' + (rank + 1),
      cost: riftUpgradeCost(rank),
      where: forge,
      notes: 'See [[Rifts]] for the item level at each rank.',
    });
  for (const gem of RIFT_GEM_IDS)
    add(gem, {
      buys: 'Put this gem in a gem slot of a Riftbound band',
      cost: 1,
      where: forge,
      notes: 'If every slot is full, the new gem replaces the oldest one, which is destroyed.',
    });

  const bill = (cost: readonly { itemId: string; count: number }[]) =>
    cost.map((c) => c.count + ' ' + item(c.itemId)).join(', ');
  for (const c of PERFECTING_ATTEMPT_COST)
    add(c.itemId, {
      buys: 'One Perfecting try on a Masterwrought item',
      cost: c.count,
      where: '[[Perfecting and promotion]]',
      notes:
        'Each try needs all of these: ' +
        bill(PERFECTING_ATTEMPT_COST) +
        '. They are used up even if the try fails.',
    });
  for (const c of LEGENDARY_PROMOTION_COST)
    add(c.itemId, {
      buys: 'Promote a Perfected item to legendary and give it a name',
      cost: c.count,
      where: '[[Perfecting and promotion]]',
      notes: 'This always works. There is no roll.',
    });

  for (const rarity of TREASURE_MAP_RARITIES) {
    const next = nextTreasureMapRarity(rarity);
    const inks = TREASURE_MAP_UPGRADE_INKS[rarity];
    if (!next || !inks) continue;
    add(CARTOGRAPHERS_INK_ITEM_ID, {
      buys:
        'Redraw ' +
        item(TREASURE_MAP_ITEM_IDS[rarity]) +
        ' as ' +
        item(TREASURE_MAP_ITEM_IDS[next]),
      cost: inks,
      where: 'Use the ink from your bags',
      notes: 'Works on a map in your bags or on the map you have already read.',
    });
  }
  return index;
}

/** The "What it buys" section for one item, or '' when nothing takes it as payment. */
export function whatItBuysSection(
  w: ArticleTools,
  itemId: string,
  spends: Map<string, CurrencySpend[]>,
): string {
  const rows = spends.get(itemId);
  if (!rows?.length) return '';
  return w.section(
    'What it buys',
    'Each row is one thing you can spend ' +
      ref(w, 'item', itemId) +
      ' on, and how many one purchase costs.\n\n' +
      lootTable(
        ['Buys', 'Cost', 'Where', 'Notes'],
        rows.map((r) => [r.buys, String(r.cost), r.where, r.notes]),
      ),
  );
}
