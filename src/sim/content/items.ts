import type { ItemDef, PlayerClass } from '../types';

// Archetype groups for class-locked rewards (REWARD_ARCHETYPE hands warrior
// rewards to paladins/shamans etc., so the lock must admit the whole group).
const WAR: PlayerClass[] = ['warrior', 'paladin', 'shaman'];
const MAG: PlayerClass[] = ['mage', 'priest', 'warlock', 'druid'];
const ROG: PlayerClass[] = ['rogue', 'hunter'];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const BASE_ITEMS: Record<string, ItemDef> = {
  // --- starting gear ---
  worn_sword: {
    id: 'worn_sword', name: 'Worn Shortsword', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 2, max: 5, speed: 2.0 }, sellValue: 10,
  },
  gnarled_staff: {
    id: 'gnarled_staff', name: 'Gnarled Staff', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 3, max: 6, speed: 2.9 }, stats: { int: 1 }, sellValue: 12,
  },
  rusty_dagger: {
    id: 'rusty_dagger', name: 'Rusty Dagger', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 2, max: 4, speed: 1.8, dagger: true }, sellValue: 10,
  },
  training_mace: {
    id: 'training_mace', name: 'Training Mace', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 2, max: 5, speed: 2.6 }, sellValue: 10,
  },
  rusty_hatchet: {
    id: 'rusty_hatchet', name: 'Rusty Hatchet', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 2, max: 5, speed: 2.2 }, sellValue: 10,
  },
  recruit_tunic: {
    id: 'recruit_tunic', name: "Recruit's Tunic", kind: 'armor', slot: 'chest', quality: 'common',
    stats: { armor: 20 }, sellValue: 5,
  },
  apprentice_robe: {
    id: 'apprentice_robe', name: "Apprentice's Robe", kind: 'armor', slot: 'chest', quality: 'common',
    stats: { armor: 8 }, sellValue: 5,
  },
  footpad_jerkin: {
    id: 'footpad_jerkin', name: "Footpad's Jerkin", kind: 'armor', slot: 'chest', quality: 'common',
    stats: { armor: 14 }, sellValue: 5,
  },
  // --- quest reward gear ---
  redbrook_blade: {
    id: 'redbrook_blade', name: 'Redbrook Militia Blade', kind: 'weapon', slot: 'mainhand', quality: 'uncommon',
    weapon: { min: 6, max: 11, speed: 2.2 }, stats: { str: 2 }, sellValue: 120, requiredClass: WAR,
  },
  apprentice_staff: {
    id: 'apprentice_staff', name: 'Vale Apprentice Staff', kind: 'weapon', slot: 'mainhand', quality: 'uncommon',
    weapon: { min: 7, max: 12, speed: 3.0 }, stats: { int: 3, sta: 1 }, sellValue: 120, requiredClass: MAG,
  },
  keen_dirk: {
    id: 'keen_dirk', name: 'Keen Dirk', kind: 'weapon', slot: 'mainhand', quality: 'uncommon',
    weapon: { min: 4, max: 8, speed: 1.7, dagger: true }, stats: { agi: 2 }, sellValue: 120, requiredClass: ROG,
  },
  militia_vest: {
    id: 'militia_vest', name: 'Militia Chainvest', kind: 'armor', slot: 'chest', quality: 'uncommon',
    stats: { armor: 90, sta: 2 }, sellValue: 150, requiredClass: WAR,
  },
  woven_robe: {
    id: 'woven_robe', name: 'Valewoven Robe', kind: 'armor', slot: 'chest', quality: 'uncommon',
    stats: { armor: 30, int: 3, spi: 2 }, sellValue: 150, requiredClass: MAG,
  },
  shadow_jerkin: {
    id: 'shadow_jerkin', name: 'Shadowstitch Jerkin', kind: 'armor', slot: 'chest', quality: 'uncommon',
    stats: { armor: 55, agi: 3 }, sellValue: 150, requiredClass: ROG,
  },
  oiled_boots: {
    id: 'oiled_boots', name: 'Oiled Leather Boots', kind: 'armor', slot: 'feet', quality: 'uncommon',
    stats: { armor: 25, agi: 1 }, sellValue: 80,
  },
  quilted_trousers: {
    id: 'quilted_trousers', name: 'Quilted Trousers', kind: 'armor', slot: 'legs', quality: 'uncommon',
    stats: { armor: 30, sta: 2 }, sellValue: 90,
  },
  greyjaw_pelt_cloak: {
    id: 'greyjaw_pelt_cloak', name: "Greyjaw's Pelt Leggings", kind: 'armor', slot: 'legs', quality: 'uncommon',
    stats: { armor: 35, sta: 1, agi: 1 }, sellValue: 110,
  },
  greyjaw_hide_boots: {
    id: 'greyjaw_hide_boots', name: 'Greyjaw Hide Boots', kind: 'armor', slot: 'feet', quality: 'uncommon',
    stats: { armor: 28, agi: 1, sta: 1 }, sellValue: 130,
  },
  bristleback_maul: {
    id: 'bristleback_maul', name: 'Bristleback Maul', kind: 'weapon', slot: 'mainhand', quality: 'uncommon',
    weapon: { min: 7, max: 12, speed: 2.8 }, stats: { str: 2, sta: 1 }, sellValue: 160, requiredClass: WAR,
  },
  sableweb_slippers: {
    id: 'sableweb_slippers', name: 'Sableweb Slippers', kind: 'armor', slot: 'feet', quality: 'uncommon',
    stats: { armor: 18, int: 2, spi: 1 }, sellValue: 150, requiredClass: MAG,
  },
  gorraks_cruel_chopper: {
    id: 'gorraks_cruel_chopper', name: "Gorrak's Cruel Chopper", kind: 'weapon', slot: 'mainhand', quality: 'uncommon',
    weapon: { min: 8, max: 13, speed: 2.4 }, stats: { str: 2, sta: 1 }, sellValue: 180, requiredClass: WAR,
  },
  moggers_stomper_boots: {
    id: 'moggers_stomper_boots', name: "Mogger's Stomper Boots", kind: 'armor', slot: 'feet', quality: 'uncommon',
    stats: { armor: 32, agi: 2, sta: 1 }, sellValue: 180, requiredClass: ROG,
  },
  moggers_copper_cudgel: {
    id: 'moggers_copper_cudgel', name: "Mogger's Copper Cudgel", kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 9, max: 15, speed: 2.6 }, stats: { str: 3, sta: 2 }, sellValue: 850, requiredClass: WAR,
  },
  moggers_shiv: {
    id: 'moggers_shiv', name: "Mogger's Shiv", kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 6, max: 11, speed: 1.7, dagger: true }, stats: { agi: 4, sta: 2 }, sellValue: 850, requiredClass: ROG,
  },
  valeborn_spellblade: {
    id: 'valeborn_spellblade', name: 'Valeborn Spellblade', kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 8, max: 14, speed: 2.2 }, stats: { int: 4, spi: 2 }, sellValue: 850, requiredClass: MAG,
  },
  cryptbone_greaves: {
    id: 'cryptbone_greaves', name: 'Cryptbone Greaves', kind: 'armor', slot: 'legs', quality: 'uncommon',
    stats: { armor: 48, sta: 2 }, sellValue: 180,
  },
  // --- food & drink (vendor) ---
  baked_bread: {
    id: 'baked_bread', name: 'Freshly Baked Bread', kind: 'food', quality: 'common',
    foodHp: 61, sellValue: 6, buyValue: 25,
  },
  spring_water: {
    id: 'spring_water', name: 'Refreshing Spring Water', kind: 'drink', quality: 'common',
    drinkMana: 76, sellValue: 6, buyValue: 25,
  },
  simple_fishing_pole: {
    id: 'simple_fishing_pole', name: 'Simple Fishing Pole', kind: 'tool', quality: 'common',
    use: { type: 'fishing' }, sellValue: 4, buyValue: 20,
  },
  raw_mirror_trout: {
    id: 'raw_mirror_trout', name: 'Raw Mirror Trout', kind: 'food', quality: 'common',
    foodHp: 61, sellValue: 3,
  },
  tangled_weed: {
    id: 'tangled_weed', name: 'Tangled Weed', kind: 'junk', quality: 'poor',
    sellValue: 1,
  },
  roasted_boar: {
    id: 'roasted_boar', name: 'Roasted Boar Meat', kind: 'food', quality: 'common',
    foodHp: 117, sellValue: 12, buyValue: 100,
  },
  // --- combat potions (vendor): instant, usable in combat, 60s shared cooldown.
  // Restore less than sitting to eat/drink, the price you pay for not sitting (#103).
  minor_healing_potion: {
    id: 'minor_healing_potion', name: 'Minor Healing Potion', kind: 'potion', quality: 'common',
    potionHp: 90, sellValue: 8, buyValue: 40,
  },
  minor_mana_potion: {
    id: 'minor_mana_potion', name: 'Minor Mana Potion', kind: 'potion', quality: 'common',
    potionMana: 120, sellValue: 8, buyValue: 40,
  },
  conjured_water: {
    id: 'conjured_water', name: 'Conjured Spring Water', kind: 'drink', quality: 'common',
    drinkMana: 76, sellValue: 0,
  },
  conjured_water2: {
    id: 'conjured_water2', name: 'Conjured Mineral Water', kind: 'drink', quality: 'common',
    drinkMana: 288, sellValue: 0,
  },
  conjured_water3: {
    id: 'conjured_water3', name: 'Conjured Sparkling Water', kind: 'drink', quality: 'common',
    drinkMana: 672, sellValue: 0,
  },
  // --- Smith Haldren's stock (common/white, levels 3-7) ---
  eastbrook_arming_sword: {
    id: 'eastbrook_arming_sword', name: 'Eastbrook Arming Sword', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 5, max: 9, speed: 2.2 }, sellValue: 140, buyValue: 1400,
  },
  bronzework_mace: {
    id: 'bronzework_mace', name: 'Bronzework Mace', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 6, max: 10, speed: 2.6 }, sellValue: 140, buyValue: 1400,
  },
  vale_carving_knife: {
    id: 'vale_carving_knife', name: 'Vale Carving Knife', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 4, max: 7, speed: 1.8, dagger: true }, sellValue: 120, buyValue: 1200,
  },
  hickory_shortstaff: {
    id: 'hickory_shortstaff', name: 'Hickory Shortstaff', kind: 'weapon', slot: 'mainhand', quality: 'common',
    weapon: { min: 6, max: 11, speed: 3.0 }, stats: { int: 1 }, sellValue: 150, buyValue: 1500,
  },
  eastbrook_chain_vest: {
    id: 'eastbrook_chain_vest', name: 'Eastbrook Chainmail Vest', kind: 'armor', slot: 'chest', quality: 'common',
    stats: { armor: 60 }, sellValue: 180, buyValue: 1800,
  },
  valespun_robe: {
    id: 'valespun_robe', name: 'Valespun Robe', kind: 'armor', slot: 'chest', quality: 'common',
    stats: { armor: 22 }, sellValue: 140, buyValue: 1400,
  },
  tanned_leather_jerkin: {
    id: 'tanned_leather_jerkin', name: 'Tanned Leather Jerkin', kind: 'armor', slot: 'chest', quality: 'common',
    stats: { armor: 40 }, sellValue: 160, buyValue: 1600,
  },
  hobnail_boots: {
    id: 'hobnail_boots', name: 'Hobnailed Boots', kind: 'armor', slot: 'feet', quality: 'common',
    stats: { armor: 18 }, sellValue: 90, buyValue: 900,
  },
  eastbrook_wool_trousers: {
    id: 'eastbrook_wool_trousers', name: 'Eastbrook Wool Trousers', kind: 'armor', slot: 'legs', quality: 'common',
    stats: { armor: 24 }, sellValue: 110, buyValue: 1100,
  },
  // --- Hollow Crypt rewards (rare/blue) ---
  gravecaller_blade: {
    id: 'gravecaller_blade', name: "Gravecaller's Broadblade", kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 9, max: 16, speed: 2.4 }, stats: { str: 3, sta: 2 }, sellValue: 800,
  },
  widowfang_dirk: {
    id: 'widowfang_dirk', name: 'Widowfang Dirk', kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 6, max: 10, speed: 1.7, dagger: true }, stats: { agi: 3, sta: 2 }, sellValue: 800,
  },
  gravecaller_staff: {
    id: 'gravecaller_staff', name: 'Staff of the Hollow', kind: 'weapon', slot: 'mainhand', quality: 'rare',
    weapon: { min: 10, max: 17, speed: 3.0 }, stats: { int: 4, spi: 2 }, sellValue: 800,
  },
  marrowtread_boots: {
    id: 'marrowtread_boots', name: 'Marrowtread Boots', kind: 'armor', slot: 'feet', quality: 'rare',
    stats: { armor: 45, sta: 2, str: 1 }, sellValue: 500, requiredClass: WAR,
  },
  sextons_slippers: {
    id: 'sextons_slippers', name: "Sexton's Slippers", kind: 'armor', slot: 'feet', quality: 'rare',
    stats: { armor: 20, int: 2, spi: 2 }, sellValue: 500, requiredClass: MAG,
  },
  gravewalker_softboots: {
    id: 'gravewalker_softboots', name: 'Gravewalker Softboots', kind: 'armor', slot: 'feet', quality: 'rare',
    stats: { armor: 32, agi: 3 }, sellValue: 500, requiredClass: ROG,
  },
  hollowbone_hauberk: {
    id: 'hollowbone_hauberk', name: 'Hollowbone Hauberk', kind: 'armor', slot: 'chest', quality: 'rare',
    stats: { armor: 105, str: 3, sta: 3 }, sellValue: 700, requiredClass: WAR,
  },
  gravewoven_raiment: {
    id: 'gravewoven_raiment', name: 'Gravewoven Raiment', kind: 'armor', slot: 'chest', quality: 'rare',
    stats: { armor: 38, int: 4, spi: 3 }, sellValue: 700, requiredClass: MAG,
  },
  cryptstalker_jerkin: {
    id: 'cryptstalker_jerkin', name: 'Cryptstalker Jerkin', kind: 'armor', slot: 'chest', quality: 'rare',
    stats: { armor: 65, agi: 4, sta: 2 }, sellValue: 700, requiredClass: ROG,
  },
  hollowbound_legguards: {
    id: 'hollowbound_legguards', name: 'Hollowbound Legguards', kind: 'armor', slot: 'legs', quality: 'rare',
    stats: { armor: 62, sta: 3 }, sellValue: 600,
  },
  gravepath_treads: {
    id: 'gravepath_treads', name: 'Gravepath Treads', kind: 'armor', slot: 'feet', quality: 'rare',
    stats: { armor: 42, sta: 2 }, sellValue: 600,
  },
  // --- quest items ---
  boar_hide: { id: 'boar_hide', name: 'Bristly Boar Hide', kind: 'quest', sellValue: 0, questId: 'q_boars' },
  gravecaller_sigil: { id: 'gravecaller_sigil', name: "Gravecaller's Sigil", kind: 'quest', sellValue: 0, questId: 'q_whispers' },
  blessed_wax: { id: 'blessed_wax', name: 'Blessed Tallow', kind: 'quest', sellValue: 0, questId: 'q_rite' },
  ghostly_essence: { id: 'ghostly_essence', name: 'Ghostly Essence', kind: 'quest', sellValue: 0, questId: 'q_rite' },
  webwood_silk: { id: 'webwood_silk', name: 'Webwood Silk Gland', kind: 'quest', sellValue: 0, questId: 'q_spiders' },
  supply_crate: { id: 'supply_crate', name: 'Stolen Supply Crate', kind: 'quest', sellValue: 0, questId: 'q_supplies' },
  greyjaw_fang: { id: 'greyjaw_fang', name: "Old Greyjaw's Fang", kind: 'quest', sellValue: 0, questId: 'q_greyjaw' },
  weathered_ledger_page: { id: 'weathered_ledger_page', name: 'Weathered Ledger Page', kind: 'quest', sellValue: 0, questId: 'q_names_of_the_dead' },
  morthen_grimoire: { id: 'morthen_grimoire', name: "Morthen's Grimoire", kind: 'quest', sellValue: 0, questId: 'q_gravecallers_trail' },
  // --- junk (gray) ---
  wolf_fang: { id: 'wolf_fang', name: 'Cracked Wolf Fang', kind: 'junk', quality: 'poor', sellValue: 4 },
  bandit_bandana: { id: 'bandit_bandana', name: 'Red Bandana', kind: 'junk', quality: 'poor', sellValue: 6 },
  tough_jerky: { id: 'tough_jerky', name: 'Tough Jerky', kind: 'food', quality: 'common', foodHp: 61, sellValue: 2, buyValue: 25 },
  mudfin_scale: { id: 'mudfin_scale', name: 'Slimy Murloc Scale', kind: 'junk', quality: 'poor', sellValue: 5 },
  tallow_candle: { id: 'tallow_candle', name: 'Tallow Candle', kind: 'junk', quality: 'poor', sellValue: 5 },
  spider_leg: { id: 'spider_leg', name: 'Twitching Spider Leg', kind: 'junk', quality: 'poor', sellValue: 4 },
  bone_fragments: { id: 'bone_fragments', name: 'Bone Fragments', kind: 'junk', quality: 'poor', sellValue: 7 },
  linen_scrap: { id: 'linen_scrap', name: 'Linen Scrap', kind: 'junk', quality: 'poor', sellValue: 3 },
};
