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
  // --- Inventory 2.0: helmet/shoulder/waist/gloves. ---
  // No documented armor/stat budget exists, so these are balanced to the
  // *empirical* convention of the existing class-neutral mid-tier pieces:
  // armor is slot-weighted off the legs/chest baseline (head≈1.0, shoulder≈0.75,
  // gloves≈0.65, waist≈0.55) and stat points track peers (uncommon ~L10-13 ≈ 2-4
  // pts; class-neutral rare ~L20 ≈ 5-7 pts, cf. cryptbone_greaves / trollhide_leggings
  // / korgaths_chainwraps / stormshard_leggings). Class-neutral on purpose.
  cryptbone_helm: {
    id: 'cryptbone_helm', name: 'Cryptbone Helm', kind: 'armor', slot: 'helmet', quality: 'uncommon',
    stats: { armor: 48, sta: 3 }, sellValue: 185,
  },
  cryptbone_pauldrons: {
    id: 'cryptbone_pauldrons', name: 'Cryptbone Pauldrons', kind: 'armor', slot: 'shoulder', quality: 'uncommon',
    stats: { armor: 36, sta: 2 }, sellValue: 140,
  },
  mistveil_cord: {
    id: 'mistveil_cord', name: 'Mistveil Cord', kind: 'armor', slot: 'waist', quality: 'uncommon',
    stats: { armor: 30, sta: 2, agi: 1 }, sellValue: 150,
  },
  mistveil_grips: {
    id: 'mistveil_grips', name: 'Mistveil Grips', kind: 'armor', slot: 'gloves', quality: 'uncommon',
    stats: { armor: 36, agi: 2, sta: 1 }, sellValue: 165,
  },
  boundstone_helm: {
    id: 'boundstone_helm', name: 'Boundstone Helm', kind: 'armor', slot: 'helmet', quality: 'rare',
    stats: { armor: 105, sta: 4, str: 3 }, sellValue: 460,
  },
  boundstone_girdle: {
    id: 'boundstone_girdle', name: 'Boundstone Girdle', kind: 'armor', slot: 'waist', quality: 'rare',
    stats: { armor: 60, sta: 4, str: 2 }, sellValue: 340,
  },
  gravewyrm_mantle: {
    id: 'gravewyrm_mantle', name: 'Gravewyrm Mantle', kind: 'armor', slot: 'shoulder', quality: 'rare',
    stats: { armor: 82, agi: 4, sta: 2 }, sellValue: 410,
  },
  gravewyrm_gauntlets: {
    id: 'gravewyrm_gauntlets', name: 'Gravewyrm Gauntlets', kind: 'armor', slot: 'gloves', quality: 'rare',
    stats: { armor: 72, str: 3, sta: 2 }, sellValue: 390,
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
  wool_scrap: { id: 'wool_scrap', name: 'Wool Scrap', kind: 'junk', quality: 'poor', sellValue: 5 },
  silk_scrap: { id: 'silk_scrap', name: 'Silk Scrap', kind: 'junk', quality: 'poor', sellValue: 8 },
  // Professions — cloth materials (level-banded humanoid drops) + First Aid bandages.
  // Cloth and bandages stack to 20 (vanilla cloth stack size).
  linen_cloth: { id: 'linen_cloth', name: 'Linen Cloth', kind: 'reagent', quality: 'common', sellValue: 4, stackSize: 20 },
  wool_cloth: { id: 'wool_cloth', name: 'Wool Cloth', kind: 'reagent', quality: 'common', sellValue: 8, stackSize: 20 },
  silk_cloth: { id: 'silk_cloth', name: 'Silk Cloth', kind: 'reagent', quality: 'common', sellValue: 14, stackSize: 20 },
  // Bandage heal totals = ~2/3 of AVERAGE unequipped player HP at the level
  // matching each cloth's mob band (you bandage near the mobs you farm), so a
  // bandage restores a solid chunk (~65% of an average bar, less for plate) rather
  // than a full heal. Classic uniform 8s channel, stack to 20. PRD §17.1a has the
  // HP reference tables. (Reduced 1/3 from the full-bar baseline.)
  linen_bandage: {        // band lvl ~5 (avg HP ~165)
    id: 'linen_bandage', name: 'Linen Bandage', kind: 'tool', quality: 'common',
    use: { type: 'bandage', totalHeal: 105, channelTime: 8 }, sellValue: 1, stackSize: 20, requiredLevel: 1,
  },
  heavy_linen_bandage: {  // band lvl ~8 (avg HP ~250)
    id: 'heavy_linen_bandage', name: 'Heavy Linen Bandage', kind: 'tool', quality: 'common',
    use: { type: 'bandage', totalHeal: 175, channelTime: 8 }, sellValue: 2, stackSize: 20, requiredLevel: 3,
  },
  wool_bandage: {         // band lvl ~11 (avg HP ~310)
    id: 'wool_bandage', name: 'Wool Bandage', kind: 'tool', quality: 'common',
    use: { type: 'bandage', totalHeal: 240, channelTime: 8 }, sellValue: 3, stackSize: 20, requiredLevel: 6,
  },
  heavy_wool_bandage: {   // band lvl ~14 (avg HP ~400)
    id: 'heavy_wool_bandage', name: 'Heavy Wool Bandage', kind: 'tool', quality: 'common',
    use: { type: 'bandage', totalHeal: 305, channelTime: 8 }, sellValue: 4, stackSize: 20, requiredLevel: 8,
  },
  silk_bandage: {         // band lvl ~17 (avg HP ~490)
    id: 'silk_bandage', name: 'Silk Bandage', kind: 'tool', quality: 'common',
    use: { type: 'bandage', totalHeal: 385, channelTime: 8 }, sellValue: 6, stackSize: 20, requiredLevel: 10,
  },
  heavy_silk_bandage: {   // band lvl ~20 (avg HP ~610)
    id: 'heavy_silk_bandage', name: 'Heavy Silk Bandage', kind: 'tool', quality: 'common',
    use: { type: 'bandage', totalHeal: 480, channelTime: 8 }, sellValue: 8, stackSize: 20, requiredLevel: 12,
  },

  // -------------------------------------------------------------------------
  // Professions PR 2 — Skinning materials + Leatherworking/Tailoring chain.
  // Leather/cloth stack to 20 like vanilla trade materials. Stats on crafted
  // armor are authored fixed (no roll system) and sit at/below same-level drops.
  // -------------------------------------------------------------------------

  // Leather (level-banded Skinning yield, parallel to cloth tiers).
  light_leather: { id: 'light_leather', name: 'Light Leather', kind: 'reagent', quality: 'common', sellValue: 5, stackSize: 20 },
  medium_leather: { id: 'medium_leather', name: 'Medium Leather', kind: 'reagent', quality: 'common', sellValue: 10, stackSize: 20 },
  heavy_leather: { id: 'heavy_leather', name: 'Heavy Leather', kind: 'reagent', quality: 'common', sellValue: 18, stackSize: 20 },
  // Skin failure consolation (scales with difficulty/tier); the LW free starter
  // recipe turns 3 of these back into 1 light_leather, so it's never dead weight.
  ruined_leather_scraps: { id: 'ruined_leather_scraps', name: 'Ruined Leather Scraps', kind: 'junk', quality: 'poor', sellValue: 2, stackSize: 20 },
  // Hides — rare skin drop, premium LW input. Raw hides are unusable until cured.
  light_hide: { id: 'light_hide', name: 'Light Hide', kind: 'reagent', quality: 'uncommon', sellValue: 20, stackSize: 20 },
  medium_hide: { id: 'medium_hide', name: 'Medium Hide', kind: 'reagent', quality: 'uncommon', sellValue: 40, stackSize: 20 },
  heavy_hide: { id: 'heavy_hide', name: 'Heavy Hide', kind: 'reagent', quality: 'uncommon', sellValue: 70, stackSize: 20 },
  cured_light_hide: { id: 'cured_light_hide', name: 'Cured Light Hide', kind: 'reagent', quality: 'uncommon', sellValue: 28, stackSize: 20 },
  cured_medium_hide: { id: 'cured_medium_hide', name: 'Cured Medium Hide', kind: 'reagent', quality: 'uncommon', sellValue: 52, stackSize: 20 },
  cured_heavy_hide: { id: 'cured_heavy_hide', name: 'Cured Heavy Hide', kind: 'reagent', quality: 'uncommon', sellValue: 90, stackSize: 20 },

  // Crafted intermediates — bolts of cloth (Tailoring) and leather straps (LW).
  bolt_of_linen: { id: 'bolt_of_linen', name: 'Bolt of Linen Cloth', kind: 'reagent', quality: 'common', sellValue: 14, stackSize: 20 },
  bolt_of_woolen: { id: 'bolt_of_woolen', name: 'Bolt of Woolen Cloth', kind: 'reagent', quality: 'common', sellValue: 34, stackSize: 20 },
  bolt_of_silk: { id: 'bolt_of_silk', name: 'Bolt of Silk Cloth', kind: 'reagent', quality: 'common', sellValue: 72, stackSize: 20 },
  light_leather_straps: { id: 'light_leather_straps', name: 'Light Leather Straps', kind: 'reagent', quality: 'common', sellValue: 16, stackSize: 20 },
  heavy_leather_straps: { id: 'heavy_leather_straps', name: 'Heavy Leather Straps', kind: 'reagent', quality: 'common', sellValue: 56, stackSize: 20 },

  // Trade goods — vendor-bought (gold sink), spread into Provisioners via TRADE_GOODS.
  coarse_thread: { id: 'coarse_thread', name: 'Coarse Thread', kind: 'reagent', quality: 'common', sellValue: 2, buyValue: 20, stackSize: 20 },
  rough_thread: { id: 'rough_thread', name: 'Rough Thread', kind: 'reagent', quality: 'common', sellValue: 6, buyValue: 60, stackSize: 20 },
  fine_thread: { id: 'fine_thread', name: 'Fine Thread', kind: 'reagent', quality: 'common', sellValue: 15, buyValue: 150, stackSize: 20 },
  salt: { id: 'salt', name: 'Refined Salt', kind: 'reagent', quality: 'common', sellValue: 2, buyValue: 25, stackSize: 20 },

  // Tailoring armor (caster cloth — MAG archetype, int/spi). linen common, wool/silk uncommon, one rare capstone.
  linen_boots: { id: 'linen_boots', name: 'Linen Boots', kind: 'armor', slot: 'feet', quality: 'common', stats: { armor: 14 }, requiredClass: MAG, requiredLevel: 6, sellValue: 18 },
  linen_pants: { id: 'linen_pants', name: 'Linen Pants', kind: 'armor', slot: 'legs', quality: 'common', stats: { armor: 20 }, requiredClass: MAG, requiredLevel: 8, sellValue: 26 },
  linen_robe: { id: 'linen_robe', name: 'Linen Robe', kind: 'armor', slot: 'chest', quality: 'common', stats: { armor: 24 }, requiredClass: MAG, requiredLevel: 10, sellValue: 34 },
  woolen_slippers: { id: 'woolen_slippers', name: 'Woolen Slippers', kind: 'armor', slot: 'feet', quality: 'uncommon', stats: { armor: 24, int: 2, spi: 1 }, requiredClass: MAG, requiredLevel: 12, sellValue: 70 },
  woolen_leggings: { id: 'woolen_leggings', name: 'Woolen Leggings', kind: 'armor', slot: 'legs', quality: 'uncommon', stats: { armor: 40, int: 3, spi: 2 }, requiredClass: MAG, requiredLevel: 13, sellValue: 96 },
  woolen_tunic: { id: 'woolen_tunic', name: 'Woolen Tunic', kind: 'armor', slot: 'chest', quality: 'uncommon', stats: { armor: 42, int: 4, spi: 2 }, requiredClass: MAG, requiredLevel: 14, sellValue: 110 },
  silk_slippers: { id: 'silk_slippers', name: 'Silk Slippers', kind: 'armor', slot: 'feet', quality: 'uncommon', stats: { armor: 38, int: 4, spi: 2 }, requiredClass: MAG, requiredLevel: 16, sellValue: 140 },
  silk_leggings: { id: 'silk_leggings', name: 'Silk Leggings', kind: 'armor', slot: 'legs', quality: 'uncommon', stats: { armor: 52, int: 5, spi: 3 }, requiredClass: MAG, requiredLevel: 17, sellValue: 175 },
  silk_brocade_robe: { id: 'silk_brocade_robe', name: 'Silk Brocade Robe', kind: 'armor', slot: 'chest', quality: 'rare', stats: { armor: 68, int: 9, spi: 5, sta: 3 }, requiredClass: MAG, requiredLevel: 18, sellValue: 420 },

  // Leatherworking armor (leather — ROG archetype, agi/sta). No mail (Blacksmithing, PR 3). One rare capstone.
  light_leather_boots: { id: 'light_leather_boots', name: 'Light Leather Boots', kind: 'armor', slot: 'feet', quality: 'common', stats: { armor: 18 }, requiredClass: ROG, requiredLevel: 5, sellValue: 18 },
  light_leather_vest: { id: 'light_leather_vest', name: 'Light Leather Vest', kind: 'armor', slot: 'chest', quality: 'common', stats: { armor: 38 }, requiredClass: ROG, requiredLevel: 8, sellValue: 34 },
  cured_leather_pants: { id: 'cured_leather_pants', name: 'Cured Leather Pants', kind: 'armor', slot: 'legs', quality: 'common', stats: { armor: 30 }, requiredClass: ROG, requiredLevel: 10, sellValue: 30 },
  medium_leather_boots: { id: 'medium_leather_boots', name: 'Medium Leather Boots', kind: 'armor', slot: 'feet', quality: 'uncommon', stats: { armor: 36, agi: 2, sta: 1 }, requiredClass: ROG, requiredLevel: 12, sellValue: 88 },
  medium_leather_vest: { id: 'medium_leather_vest', name: 'Medium Leather Vest', kind: 'armor', slot: 'chest', quality: 'uncommon', stats: { armor: 70, agi: 4, sta: 1 }, requiredClass: ROG, requiredLevel: 13, sellValue: 120 },
  medium_leather_pants: { id: 'medium_leather_pants', name: 'Medium Leather Pants', kind: 'armor', slot: 'legs', quality: 'uncommon', stats: { armor: 60, agi: 4, sta: 2 }, requiredClass: ROG, requiredLevel: 14, sellValue: 115 },
  studded_leather_vest: { id: 'studded_leather_vest', name: 'Studded Leather Vest', kind: 'armor', slot: 'chest', quality: 'uncommon', stats: { armor: 90, agi: 5, sta: 3 }, requiredClass: ROG, requiredLevel: 15, sellValue: 150 },
  heavy_leather_vest: { id: 'heavy_leather_vest', name: 'Heavy Leather Vest', kind: 'armor', slot: 'chest', quality: 'uncommon', stats: { armor: 100, agi: 6, sta: 3 }, requiredClass: ROG, requiredLevel: 16, sellValue: 175 },
  direhide_legguards: { id: 'direhide_legguards', name: 'Direhide Legguards', kind: 'armor', slot: 'legs', quality: 'rare', stats: { armor: 120, agi: 8, sta: 5 }, requiredClass: ROG, requiredLevel: 18, sellValue: 460 },
};
