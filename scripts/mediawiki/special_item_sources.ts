import { MEMBERSHIP_ANNUAL_REINS } from '../../src/membership_annual_contract';
import { drownedLitanyChestItemsForTier } from '../../src/sim/content/delves/drowned_litany_loot';
import { HEROIC_MARK_CURRENCY_ID } from '../../src/sim/content/dungeon_difficulty';
import { FARM_WITHERED_HUSK_ITEM_ID } from '../../src/sim/content/farm_crops';
import {
  GOURDLIGHT_POUCH_SWEETS,
  GOURDLIGHT_SWEET_ID,
  GOURDLIGHT_TREAT_POUCH_ID,
} from '../../src/sim/content/gourdlight_eve';
import { CURSED_CANDLE_ID, PATCH_PUMPKIN_ID } from '../../src/sim/content/gourdlight_eve_dailies';
import {
  GUILD_CONTRACT_SEALS,
  LANTERN_HALL_DESTRIER_REINS_ID,
  LANTERN_HALL_DESTRIER_SEALS,
  LANTERN_SEAL_ITEM_ID,
} from '../../src/sim/content/guild_contracts';
import { RETIRED_HEROIC_ITEMS } from '../../src/sim/content/heroic_loot';
import {
  HOARD_BASE_ITEM_IDS,
  HOARD_BOSS_LOOT_TABLES,
  HOARD_LOOT_CLASS_BIAS,
  hoardLootTierForMap,
  hoardLootVariantId,
} from '../../src/sim/content/hoard_loot';
import { FISHING_TABLES_BY_BAND } from '../../src/sim/content/items';
import { MEMBERSHIP_TOKEN_ID, MEMBERSHIP_WEAPON_ID } from '../../src/sim/content/membership';
import { MUSTER_RACK } from '../../src/sim/content/mirefen_muster';
import { DEVELOPER_MOUNTS } from '../../src/sim/content/mounts';
import {
  REFERRAL_BAG,
  REFERRAL_FOG_TRINKET,
  REFERRAL_HOLLOW_TRINKET,
  REFERRAL_RAPTOR_REINS,
  REFERRAL_SLIME_REINS,
} from '../../src/sim/content/referral_rewards';
import { CAVE_THEMES } from '../../src/sim/content/rift/cave_themes';
import { RIFT_GEM_IDS } from '../../src/sim/content/rift/items';
import { RIFT_THEMES } from '../../src/sim/content/rift/themes';
import { EVENT_SKIN_TOKEN_ID } from '../../src/sim/content/skins';
import {
  TREASURE_MAP_ITEM_IDS,
  TREASURE_MAP_RARITIES,
  VAULT_GUEST_GEAR_CHANCE,
  VAULT_PAYOUTS,
} from '../../src/sim/content/treasure_maps';
import { CLASSES, DUNGEON_LIST, ITEMS } from '../../src/sim/data';
import { MUSTER_SHARDPIKE_ID } from '../../src/sim/lance_balance_core';
import { MARKET_HOUSE_STOCK } from '../../src/sim/market';
import { isMembershipArmour, isReferralArmour } from '../../src/sim/membership_armour';
import {
  MAKERS_EMBER_ITEM_ID,
  SUNDERED_ESSENCE_ITEM_ID,
} from '../../src/sim/professions/masterwrought_materials';
import { SUNDERED_ESSENCE_YIELD } from '../../src/sim/professions/sundering';
import { WORLD_PVP_SKULL_ITEM_ID } from '../../src/sim/pvp/world_pvp_trophy';
import { RETIRED_ZONE1_ITEM_IDS } from '../../src/sim/removed_zone1_content';
import { RIFT_GEM_RATING, RIFT_GEM_RATING_STAT } from '../../src/sim/rift/band_ladder';
import { Rng } from '../../src/sim/rng';
import type { PlayerClass } from '../../src/sim/types';
import { materialHintKey } from '../../src/ui/hud/professions/material_hint_view';
import { t } from '../../src/ui/i18n';
import { type ArticleTools, append, pct, ref, words } from './entity_format';

export function indexSpecialItemSources(w: ArticleTools, sources: Map<string, Set<string>>) {
  const add = (id: string, s: string) => append(sources, id, s);
  add(MEMBERSHIP_TOKEN_ID, 'Buy the 30-day membership token in the membership token shop.');
  add(
    MEMBERSHIP_WEAPON_ID,
    'While your membership is active, claim the weapon. It grows stronger as you level up.',
  );
  add(
    MEMBERSHIP_ANNUAL_REINS,
    'You get this when you buy the paid annual (yearly) membership bundle.',
  );
  add(
    MAKERS_EMBER_ITEM_ID,
    'Each reset week, finish your first raid boss, Heroic final boss or rank A or S rift that counts. Weeks you miss are saved up for later.',
  );
  add(
    SUNDERED_ESSENCE_ITEM_ID,
    'Sunder an epic piece of raid gear from Normal or Heroic. The piece is used up and gives you ' +
      SUNDERED_ESSENCE_YIELD +
      ' Sundered Essence.',
  );
  add(
    WORLD_PVP_SKULL_ITEM_ID,
    'In world PvP, with your flag on, land the killing blow on another player whose flag is on. Loot the trophy from their body.',
  );
  add(
    'clue_scroll',
    'Scrolls you already have can start a clue hunt. The quests on offer right now give treasure maps instead. A developer command can give a scroll.',
  );
  for (const id of [
    'reins_mech_bird',
    'reins_rallycart_rxt',
    'reins_goblin_rocket_sled',
    'reins_chimeglass_tortoise',
    'reins_rickshaw_mount',
  ])
    add(
      id,
      'Legacy souvenir: players who already have it can keep it. The mount skin is a separate unlock on your account. These reins do not unlock it.',
    );
  for (const id of RIFT_GEM_IDS)
    add(
      id,
      'Personal loot on the body for the first group to clear a natural rift that is rank A or S, or that has a crafting material bias of at least 0.5. Each player in turn gets the next gem color. Put it in a Riftbound ring socket for ' +
        RIFT_GEM_RATING +
        ' ' +
        words(RIFT_GEM_RATING_STAT[id]) +
        '.',
    );
  // The medium chest selects exactly one of two uncommon pieces with its first
  // 50/50 roll. Visit both branches of that resolver instead of copying its class tables.
  for (const cls of Object.keys(CLASSES) as PlayerClass[]) {
    for (const side of [true, false]) {
      const rng = new Rng(1);
      rng.chance = (p) => p > 0 && side;
      const piece = drownedLitanyChestItemsForTier('medium', cls, rng)[0].itemId;
      add(
        piece,
        'Open the Drowned Litany chest as ' +
          ref(w, 'class', cls) +
          '. A medium, premium or bountiful chest gives one of two uncommon pieces, with equal odds for each. A low chest gives an uncommon piece only half the time.',
      );
    }
  }
  add(
    EVENT_SKIN_TOKEN_ID,
    'A developer can give this out on realms where developer commands are turned on. We have not confirmed an ordinary way to get it in this release.',
  );
  add(
    'chunk_of_ore',
    'An old profession tutorial item that is no longer used. Characters who already have copies keep them.',
  );
  for (const [boss, items] of Object.entries(HOARD_BOSS_LOOT_TABLES))
    for (const rarity of TREASURE_MAP_RARITIES) {
      const themes = rarity === 'common' || rarity === 'rare' ? CAVE_THEMES : RIFT_THEMES;
      if (!themes.some((theme) => theme.boss === boss)) continue;
      const tier = hoardLootTierForMap(rarity);
      for (const base of items) {
        const item = hoardLootVariantId(base, tier);
        add(
          item,
          'Defeat ' +
            ref(w, 'mob', boss) +
            ' in a ' +
            ref(w, 'item', TREASURE_MAP_ITEM_IDS[rarity]) +
            ' hoard. The map owner has a ' +
            pct(VAULT_PAYOUTS[rarity].gearChance) +
            ' chance to get gear. A guest who can get loot has a ' +
            pct(VAULT_GUEST_GEAR_CHANCE[rarity]) +
            ' chance. When a piece drops, ' +
            pct(HOARD_LOOT_CLASS_BIAS) +
            ' of the time it is picked at random from this boss’s pieces made for your class, if there are any. The rest of the time, or if there are none, it is picked at random from all ' +
            items.length +
            '.',
        );
      }
    }
  for (const rarity of ['common', 'rare'] as const)
    for (const base of HOARD_BASE_ITEM_IDS)
      add(
        hoardLootVariantId(base, 'rare'),
        'Open a ' +
          ref(w, 'item', TREASURE_MAP_ITEM_IDS[rarity]) +
          ' cave hoard reward chest. Its cave guardian shares one pool of all ' +
          HOARD_BASE_ITEM_IDS.length +
          ' hoard pieces. The map owner has a ' +
          pct(VAULT_PAYOUTS[rarity].gearChance) +
          ' chance to get gear, and a guest has a ' +
          pct(VAULT_GUEST_GEAR_CHANCE[rarity]) +
          ' chance. When gear drops, it is a piece made for your class ' +
          pct(HOARD_LOOT_CLASS_BIAS) +
          ' of the time, if there is one.',
      );
  for (const row of MARKET_HOUSE_STOCK)
    add(
      row.itemId,
      'The Merchant stocks ' +
        row.count +
        ' for ' +
        w.money(row.price) +
        ' on the world market that comes with the game.',
    );
  for (const d of DUNGEON_LIST)
    for (const o of d.objects ?? [])
      add(
        o.itemId,
        'Find ' +
          o.name +
          ' inside ' +
          ref(w, 'dungeon', d.id) +
          ' at (' +
          o.x +
          ', ' +
          o.z +
          '). These coordinates are measured inside that room.',
      );
  for (const item of Object.values(ITEMS)) {
    if (isMembershipArmour(item.id))
      add(
        item.id,
        'While your membership is active, claim this armor. It grows stronger as you level up.',
      );
    if (isReferralArmour(item.id))
      add(
        item.id,
        'Claim this armor on a character whose account has earned the referral armor. It grows stronger as you level up.',
      );
    if (item.kind === 'mount' && DEVELOPER_MOUNTS.includes(item.mount))
      add(item.id, 'Developer mount. Only a developer can give it out.');
    const key = materialHintKey(item.id);
    if (key) add(item.id, t(key));
  }
  for (const id of [...RETIRED_ZONE1_ITEM_IDS, ...Object.keys(RETIRED_HEROIC_ITEMS)])
    add(id, 'Retired. You cannot get new copies, but copies people already have still work.');
  for (const [id, stage] of [
    [REFERRAL_BAG, 'tutorial'],
    [REFERRAL_HOLLOW_TRINKET, 'Hollow Crypt'],
    [REFERRAL_FOG_TRINKET, 'Fogbinder (upgrades the Hollow charm)'],
    [REFERRAL_SLIME_REINS, 'raid'],
  ])
    add(id, 'Redeem the ' + stage + ' stamp on the invited friend’s referral card.');
  add(
    REFERRAL_RAPTOR_REINS,
    'The inviting player gets this when the first friend they invited finishes their referral card.',
  );
  add(FARM_WITHERED_HUSK_ITEM_ID, 'Harvest a failed crop from your farm bed.');
  add(
    LANTERN_SEAL_ITEM_ID,
    'Finish guild contracts. Seals for each type of contract: ' +
      Object.entries(GUILD_CONTRACT_SEALS)
        .map(([kind, count]) => words(kind) + ' ' + count)
        .join(', ') +
      '.',
  );
  add(
    LANTERN_HALL_DESTRIER_REINS_ID,
    'Spend ' +
      LANTERN_HALL_DESTRIER_SEALS +
      ' ' +
      ref(w, 'item', LANTERN_SEAL_ITEM_ID) +
      ' at the guild hall quartermaster to buy it.',
  );
  add(
    HEROIC_MARK_CURRENCY_ID,
    'You get these for clearing Heroic dungeons, and as a currency reward in ' +
      ref(w, 'item', 'emissary_cache') +
      '. They are added to your currency total.',
  );
  add(
    GOURDLIGHT_SWEET_ID,
    'Open ' +
      ref(w, 'item', GOURDLIGHT_TREAT_POUCH_ID) +
      ' to receive ' +
      GOURDLIGHT_POUCH_SWEETS +
      '.',
  );
  add(
    CURSED_CANDLE_ID,
    'Put out the candles shown on the map during Hester’s Gourdlight daily quest: ' +
      ref(w, 'quest', 'q_gourdlight_daily_wicks') +
      '.',
  );
  add(
    PATCH_PUMPKIN_ID,
    'Pick up pumpkins during Hester’s Gourdlight daily quest: ' +
      ref(w, 'quest', 'q_gourdlight_daily_patch') +
      '.',
  );
  add(
    MUSTER_SHARDPIKE_ID,
    'Borrow from the muster weapon rack at (' +
      MUSTER_RACK.x +
      ', ' +
      MUSTER_RACK.z +
      ') during the drill. You only borrow it.',
  );
  add(
    'the_codfather',
    'Land a catch at Deepfen Shallows during ' +
      ref(w, 'quest', 'q_the_codfather') +
      ' while you are not already carrying the quest fish.',
  );
  add('soul_stone', 'Take a Soul Stone from a Soulwell that a Warlock makes.');
  for (const [band, zones] of FISHING_TABLES_BY_BAND.entries())
    for (const [zone, entries] of Object.entries(zones)) {
      const weight = entries.reduce((n, e) => n + e.weight, 0);
      for (const e of entries)
        if (e.itemId)
          add(
            e.itemId,
            'Fishing band ' +
              band +
              ' in ' +
              ref(w, 'zone', zone) +
              ': ' +
              pct(e.weight / weight) +
              ' of results on the base catch table.',
          );
    }
}
