import type { ItemDef, PlayerClass } from '../types';

// Archetype groups for class-locked rewards (REWARD_ARCHETYPE hands warrior
// rewards to paladins/shamans etc., so the lock must admit the whole group).
const WAR: PlayerClass[] = ['warrior', 'paladin', 'shaman'];
const MAG: PlayerClass[] = ['mage', 'priest', 'warlock', 'druid'];
const ROG: PlayerClass[] = ['rogue', 'hunter'];
// Feral druid weapons. A bespoke, druid-only lock: it is NOT one of the three
// weapon-proficiency groups, so weaponArchetypeForItem returns null and
// canEquipItem falls through to this literal list (see src/sim/equipment_rules.ts).
// Bear form swings with the equipped weapon, so these carry real 2H dps + str/agi/sta.
export const FERAL: PlayerClass[] = ['druid'];
// Every caster class, for held-offhand stat sticks (no armor class / weapon
// proficiency: the literal requiredClass list is the whole rule for held_offhand).
export const CASTER_ALL: PlayerClass[] = [
  'mage',
  'priest',
  'warlock',
  'shaman',
  'paladin',
  'druid',
];
// Quivers: the hunter's held-offhand stat sticks. A bespoke, hunter-only lock
// like FERAL above, and deliberately NOT the ROG group: rogues already reach the
// offhand slot by dual wielding, so sharing the lock would hand them a second
// way to fill a slot hunters have no way at all to fill. Like every held_offhand
// this is the whole equip rule (src/sim/equipment_rules.ts canEquipItem).
export const HUNTER_ONLY: PlayerClass[] = ['hunter'];
const CASTER_WEAPON_CLASSES: PlayerClass[] = [
  'mage',
  'priest',
  'warlock',
  'shaman',
  'paladin',
  'druid',
];

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export const BASE_ITEMS: Record<string, ItemDef> = {
  // --- starting gear ---
  worn_sword: {
    id: 'worn_sword',
    name: 'Pitted Shortsword',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 2, max: 5, speed: 2.0 },
    sellValue: 10,
  },
  gnarled_staff: {
    id: 'gnarled_staff',
    name: 'Bogoak Staff',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 3, max: 6, speed: 2.9 },
    stats: { int: 1 },
    sellValue: 12,
  },
  rusty_dagger: {
    id: 'rusty_dagger',
    name: 'Rusty Dagger',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 2, max: 4, speed: 1.8, dagger: true },
    sellValue: 10,
  },
  training_mace: {
    id: 'training_mace',
    name: 'Training Mace',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 2, max: 5, speed: 2.6 },
    sellValue: 10,
  },
  rusty_hatchet: {
    id: 'rusty_hatchet',
    name: 'Rusty Hatchet',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 2, max: 5, speed: 2.2 },
    sellValue: 10,
  },
  recruit_tunic: {
    id: 'recruit_tunic',
    name: "Levyman's Tunic",
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 20 },
    sellValue: 5,
  },
  apprentice_robe: {
    id: 'apprentice_robe',
    name: 'Threadbare Robe',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 8 },
    sellValue: 5,
  },
  footpad_jerkin: {
    id: 'footpad_jerkin',
    name: 'Cutpurse Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 14 },
    sellValue: 5,
  },
  // --- quest reward gear ---
  redbrook_blade: {
    id: 'redbrook_blade',
    name: 'Redbrook Militia Blade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 6, max: 11, speed: 2.2 },
    stats: { str: 2 },
    sellValue: 120,
    requiredClass: WAR,
  },
  apprentice_staff: {
    id: 'apprentice_staff',
    name: 'Vale Apprentice Staff',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 7, max: 12, speed: 3.0 },
    stats: { int: 3, sta: 1 },
    sellValue: 120,
    requiredClass: CASTER_WEAPON_CLASSES,
  },
  keen_dirk: {
    id: 'keen_dirk',
    name: 'Keen Dirk',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 4, max: 8, speed: 1.7, dagger: true },
    stats: { agi: 2 },
    sellValue: 120,
    requiredClass: ROG,
  },
  militia_vest: {
    id: 'militia_vest',
    name: 'Militia Chainvest',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 90, sta: 2 },
    sellValue: 150,
    requiredClass: WAR,
  },
  woven_robe: {
    id: 'woven_robe',
    set: 'vale_arcanist',
    name: 'Valewoven Robe',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 30, int: 3, spi: 2 },
    sellValue: 150,
    requiredClass: MAG,
  },
  shadow_jerkin: {
    id: 'shadow_jerkin',
    set: 'greyjaw_stalker',
    name: 'Shadowstitch Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 55, agi: 3 },
    sellValue: 150,
    requiredClass: ROG,
  },
  oiled_boots: {
    id: 'oiled_boots',
    name: 'Oiled Leather Boots',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 25, agi: 1 },
    sellValue: 80,
  },
  quilted_trousers: {
    id: 'quilted_trousers',
    name: 'Quilted Trousers',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 30, sta: 2 },
    sellValue: 90,
  },
  greyjaw_pelt_cloak: {
    id: 'greyjaw_pelt_cloak',
    name: "Greyjaw's Pelt Leggings",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 35, sta: 1, agi: 1 },
    sellValue: 110,
  },
  greyjaw_hide_boots: {
    id: 'greyjaw_hide_boots',
    set: 'greyjaw_stalker',
    name: 'Greyjaw Hide Boots',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 28, agi: 1, sta: 1 },
    sellValue: 130,
  },
  bristleback_maul: {
    id: 'bristleback_maul',
    name: 'Gallowglass Hammer',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 7, max: 12, speed: 2.8 },
    stats: { str: 2, sta: 1 },
    sellValue: 160,
    requiredClass: WAR,
  },
  sableweb_slippers: {
    id: 'sableweb_slippers',
    name: 'Sableweb Slippers',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 18, int: 2, spi: 1 },
    sellValue: 150,
    requiredClass: MAG,
  },
  gorraks_cruel_chopper: {
    id: 'gorraks_cruel_chopper',
    name: "Gorrak's Cruel Chopper",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 8, max: 13, speed: 2.4 },
    stats: { str: 2, sta: 1 },
    sellValue: 180,
    requiredClass: WAR,
  },
  tunnelkings_spade: {
    id: 'tunnelkings_spade',
    name: "Tunnelking's Spade",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 9, max: 15, speed: 2.7 },
    stats: { str: 3, sta: 2 },
    sellValue: 190,
    requiredClass: WAR,
  },
  moggers_stomper_boots: {
    id: 'moggers_stomper_boots',
    name: "Mogger's Stomper Boots",
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 32, agi: 2, sta: 1 },
    sellValue: 180,
    requiredClass: ROG,
  },
  moggers_copper_cudgel: {
    id: 'moggers_copper_cudgel',
    name: "Mogger's Copper Cudgel",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 9, max: 15, speed: 2.6 },
    stats: { str: 3, sta: 2 },
    sellValue: 850,
    requiredClass: WAR,
  },
  moggers_shiv: {
    id: 'moggers_shiv',
    name: "Mogger's Shiv",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 6, max: 11, speed: 1.7, dagger: true },
    stats: { agi: 4, sta: 2 },
    sellValue: 850,
    requiredClass: ROG,
  },
  valeborn_spellblade: {
    id: 'valeborn_spellblade',
    name: 'Valeborn Spellblade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 8, max: 14, speed: 2.2 },
    stats: { int: 4, spi: 2 },
    sellValue: 850,
    requiredClass: MAG,
  },
  cryptbone_greaves: {
    id: 'cryptbone_greaves',
    name: 'Cryptbone Greaves',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 48, sta: 2 },
    sellValue: 180,
  },
  // --- Inventory 2.0: helmet/shoulder/waist/gloves. ---
  // No documented armor/stat budget exists, so these are balanced to the
  // *empirical* convention of the existing class-neutral mid-tier pieces:
  // armor is slot-weighted off the legs/chest baseline (head≈1.0, shoulder≈0.75,
  // gloves≈0.65, waist≈0.55) and stat points track peers (uncommon ~L10-13 ≈ 2-4
  // pts; class-neutral rare ~L20 ≈ 5-7 pts, cf. cryptbone_greaves / trollhide_leggings
  // / korgaths_chainwraps / stormshard_leggings). Class-neutral on purpose.
  cryptbone_helm: {
    id: 'cryptbone_helm',
    name: 'Cryptbone Helm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 48, sta: 3 },
    sellValue: 185,
  },
  cryptbone_pauldrons: {
    id: 'cryptbone_pauldrons',
    name: 'Cryptbone Pauldrons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 36, sta: 2 },
    sellValue: 140,
  },
  // Riding Training: the stablemaster's service entry. Buying it never puts an
  // item in the bags; items.ts buyItem delegates to learnRiding (80 gold,
  // level 20, once), which sets PlayerMeta.ridingTrained. The buyValue mirrors
  // RIDING_SKILL_FEE_COPPER so the vendor window shows the real price.
  riding_training: {
    id: 'riding_training',
    name: 'Riding Training',
    kind: 'tool',
    quality: 'common',
    teachesRiding: true,
    sellValue: 0,
    buyValue: 800_000, // 80 gold in copper, mirrors RIDING_SKILL_FEE_COPPER
    noMarketList: true,
  },
  // The horse's reins: the ONLY purchasable mount, sold by Stablemaster Marla
  // Hitchen for 10 gold after the player has learned Riding (ridingTrained gate
  // in items.ts buyItem). Not soulbound: owning the item IS owning the horse
  // (src/sim/mounts.ts mountOwned), and like every player reins it can trade
  // hands. The buy path's mountOwned gate therefore only stops duplicates in
  // your own containers: buy, give away, buy again is allowed, making this an
  // elastic market good with a 10g vendor floor (deliberate; no copper mint,
  // since it never sells back). noVendorSell + sellValue 0: an accidental
  // 0-copper sale that buyback rotation could eat would destroy the mount.
  reins_valorsteed: {
    id: 'reins_valorsteed',
    name: 'Reins of the Valorsteed',
    kind: 'mount',
    mount: 'valorsteed',
    quality: 'common',
    noVendorSell: true,
    noDiscard: true,
    sellValue: 0,
    buyValue: 100_000, // 10 gold in copper
  },
  // Collectible mount (Morthen the Gravecaller, The Hollow Crypt). Owning the
  // reins item IS owning the mount (src/sim/mounts.ts mountOwned); it stays
  // valid from the bank too, and it transfers like any other unbound item.
  reins_grag_bear: {
    id: 'reins_grag_bear',
    name: 'Reins of the Goliath Grag-Bear',
    kind: 'mount',
    mount: 'grag_bear',
    quality: 'rare',
    noVendorSell: true,
    noDiscard: true,
    sellValue: 0,
  },
  // Developer-only mount. It is intentionally absent from vendors, quests,
  // creature loot, heroic loot, and Rift reward pools. Use /dev mounts or
  // /dev give reins_terrorspark_groundshaker while the feature remains under development.
  // Unlike the player reins it STAYS soulbound: it has no acquisition path, so
  // tradability would turn a dev grant into an economy leak.
  reins_terrorspark_groundshaker: {
    id: 'reins_terrorspark_groundshaker',
    name: 'Ignition Key: Terrorspark Groundshaker',
    kind: 'mount',
    mount: 'terrorspark_groundshaker',
    quality: 'epic',
    soulbound: true,
    noDiscard: true,
    sellValue: 0,
  },
  mistveil_cord: {
    id: 'mistveil_cord',
    name: 'Mistveil Cord',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'waist',
    quality: 'uncommon',
    stats: { armor: 30, sta: 2, agi: 1 },
    sellValue: 150,
  },
  mistveil_grips: {
    id: 'mistveil_grips',
    name: 'Mistveil Grips',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 36, agi: 2, sta: 1 },
    sellValue: 165,
  },
  boundstone_helm: {
    id: 'boundstone_helm',
    set: 'boundstone_vanguard',
    name: 'Boundstone Helm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 105, sta: 6, str: 5 },
    sellValue: 460,
  },
  boundstone_girdle: {
    id: 'boundstone_girdle',
    set: 'boundstone_vanguard',
    name: 'Boundstone Girdle',
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'rare',
    stats: { armor: 60, sta: 6, str: 3 },
    sellValue: 340,
  },
  gravewyrm_mantle: {
    id: 'gravewyrm_mantle',
    name: 'Gravewyrm Mantle',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 82, agi: 7, sta: 3 },
    sellValue: 410,
  },
  gravewyrm_gauntlets: {
    id: 'gravewyrm_gauntlets',
    set: 'boundstone_vanguard',
    name: 'Gravewyrm Gauntlets',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 72, str: 5, sta: 4 },
    sellValue: 390,
  },
  // --- bags (kind:'bag', equip into one of the 4 bag sockets for +bagSlots
  // pooled inventory capacity; the 16-slot backpack is implicit). Tiered by
  // quality: common bags are vendor goods, uncommon drops from beasts, rare
  // and epic from dungeon bosses. See src/sim/bags.ts for the capacity rules. ---
  linen_pouch: {
    id: 'linen_pouch',
    name: 'Linen Pouch',
    kind: 'bag',
    quality: 'common',
    bagSlots: 6,
    sellValue: 60,
    buyValue: 250,
  },
  travelers_knapsack: {
    id: 'travelers_knapsack',
    name: "Traveler's Knapsack",
    kind: 'bag',
    quality: 'common',
    bagSlots: 8,
    sellValue: 500,
    buyValue: 2000,
  },
  wolfhide_satchel: {
    id: 'wolfhide_satchel',
    name: 'Wolfhide Satchel',
    kind: 'bag',
    quality: 'uncommon',
    bagSlots: 10,
    sellValue: 1200,
  },
  gravewoven_bag: {
    id: 'gravewoven_bag',
    name: 'Gravewoven Bag',
    kind: 'bag',
    quality: 'rare',
    bagSlots: 12,
    sellValue: 3500,
  },
  mistcallers_duffel: {
    id: 'mistcallers_duffel',
    name: "Fogbinder's Duffel",
    kind: 'bag',
    quality: 'epic',
    bagSlots: 14,
    sellValue: 9000,
  },
  // --- food & drink (vendor) ---
  baked_bread: {
    id: 'baked_bread',
    name: 'Cottage Loaf',
    kind: 'food',
    quality: 'common',
    foodHp: 61,
    sellValue: 6,
    buyValue: 25,
  },
  spring_water: {
    id: 'spring_water',
    name: 'Cold Well Water',
    kind: 'drink',
    quality: 'common',
    drinkMana: 76,
    sellValue: 6,
    buyValue: 25,
  },
  simple_fishing_pole: {
    id: 'simple_fishing_pole',
    name: 'Simple Fishing Pole',
    kind: 'tool',
    quality: 'common',
    use: { type: 'fishing' },
    sellValue: 4,
    buyValue: 20,
  },
  // Tiered fishing rods (Professions 2.0): gatherTool items like the
  // picks/axes/sickles below, same tier pricing ladder. Their use still routes
  // to startFishing (src/sim/items.ts useItem), so a rod casts exactly like
  // the simple pole; the tier caps which catch rarity band the cast can land
  // (band b needs tier b + 1, professions/fishing.ts). The simple pole stays
  // `use: { type: 'fishing' }`: effective tier 1 via the bare-hands floor.
  ironreel_fishing_rod: {
    id: 'ironreel_fishing_rod',
    name: 'Ironreel Fishing Rod',
    kind: 'tool',
    quality: 'common',
    use: { type: 'gatherTool', professionId: 'fishing', tier: 2 },
    sellValue: 10,
    buyValue: 60,
  },
  silverstream_fishing_rod: {
    id: 'silverstream_fishing_rod',
    name: 'Silverstream Fishing Rod',
    kind: 'tool',
    quality: 'uncommon',
    use: { type: 'gatherTool', professionId: 'fishing', tier: 3 },
    sellValue: 25,
    buyValue: 150,
  },
  // Base gathering tools (#1123). Each is infinite-durability (this repo has
  // no durability field on ItemDef) and tiered: `use.tier` gates which
  // node/material tiers it can gather (see src/sim/professions/tools.ts).
  //
  // PRICES: 20 / 120 / 400 up the three vendor rungs, pinned as literals in
  // tests/professions_tools.test.ts so a rebalance has to touch that claim
  // rather than drift past it. The two steps up are deliberately steep against
  // a first-zone solo quest income (measured during planning, and the figure
  // itself is not pinned anywhere, so treat it as the reason for the shape
  // rather than as a live number). Tier 1 stays the trivial one-time purchase
  // the #2343 no-strand story rests on; the rungs above it are a real decision
  // rather than pocket change, which is what makes the proficiency gate on them
  // (content/vendor_row_gates.ts) a pace rather than a formality. Thousands
  // would have been a wall instead of a pace.
  //
  // The tiered fishing RODS below deliberately no longer share this ladder:
  // they kept 60 and 150 while the land tools moved, because the reason to
  // raise a price here is the node ladder these three tools gate, and fishing
  // has no nodes. Their pricing belongs with the rest of the fishing work.
  //
  // The three TIER-1 tools carry BOTH noVendorSell and noMarketList, and only
  // those three. The gather quests hand a pick or a sickle over through
  // requiredItems (zone1.ts), re-granting a missing one on accept, and
  // q_prof_hobby_switch is repeatable, so the grant needs both flags:
  //
  // - noVendorSell closes the copper MINT. Without it, accept, sell for 4,
  //   abandon, repeat prints copper out of nothing.
  // - noMarketList closes the market route AND the mail route: the market
  //   refuses the listing and the mail attach path refuses the flag too, so
  //   a minted copy can neither be sold to players nor posted away.
  //
  // Where a minted copy CAN go, stated truthfully: the bank is open (it is
  // the player's own storage), and direct trade is open BY RULING (R10, a
  // deliberate transfer route). Vendor, market, and mail are closed. The
  // accept-time re-grant predicate (quests/quest_item_presence.ts) spans
  // bags, bank, mail, and market escrow, so banking a tool no longer
  // conjures another on re-accept; the quest's repeatCadenceTicks bounds the
  // TURN-IN loop only (the cadence arms at turn-in, never at abandon), so
  // the trade route still mints one copy per accept-abandon cycle, and the
  // flags above are what cap that supply's value at zero copper.
  //
  // handaxe is flagged for SYMMETRY, not because it closes anything: no quest
  // has a wood objective, so no quest ever grants it. Three tier-1 tools that
  // behave alike beat two that do and one that does not. Tiers 2 and 3 are
  // bought, never granted, so they stay sellable and listable.
  copper_mining_pick: {
    id: 'copper_mining_pick',
    name: 'Copper Mining Pick',
    kind: 'tool',
    quality: 'common',
    use: { type: 'gatherTool', professionId: 'mining', tier: 1 },
    sellValue: 4,
    buyValue: 20,
    noVendorSell: true,
    noMarketList: true,
  },
  iron_mining_pick: {
    id: 'iron_mining_pick',
    name: 'Iron Mining Pick',
    kind: 'tool',
    quality: 'common',
    use: { type: 'gatherTool', professionId: 'mining', tier: 2 },
    sellValue: 10,
    buyValue: 120,
  },
  mithril_mining_pick: {
    id: 'mithril_mining_pick',
    name: 'Skysilver Mining Pick',
    kind: 'tool',
    quality: 'uncommon',
    use: { type: 'gatherTool', professionId: 'mining', tier: 3 },
    sellValue: 25,
    buyValue: 400,
  },
  handaxe: {
    id: 'handaxe',
    name: 'Handaxe',
    kind: 'tool',
    quality: 'common',
    use: { type: 'gatherTool', professionId: 'logging', tier: 1 },
    sellValue: 4,
    buyValue: 20,
    noVendorSell: true,
    noMarketList: true,
  },
  felling_axe: {
    id: 'felling_axe',
    name: 'Felling Axe',
    kind: 'tool',
    quality: 'common',
    use: { type: 'gatherTool', professionId: 'logging', tier: 2 },
    sellValue: 10,
    buyValue: 120,
  },
  ironbark_axe: {
    id: 'ironbark_axe',
    name: 'Ironbark Axe',
    kind: 'tool',
    quality: 'uncommon',
    use: { type: 'gatherTool', professionId: 'logging', tier: 3 },
    sellValue: 25,
    buyValue: 400,
  },
  gathering_sickle: {
    id: 'gathering_sickle',
    name: 'Gathering Sickle',
    kind: 'tool',
    quality: 'common',
    use: { type: 'gatherTool', professionId: 'herbalism', tier: 1 },
    sellValue: 4,
    buyValue: 20,
    noVendorSell: true,
    noMarketList: true,
  },
  bronze_sickle: {
    id: 'bronze_sickle',
    name: 'Bronze Sickle',
    kind: 'tool',
    quality: 'common',
    use: { type: 'gatherTool', professionId: 'herbalism', tier: 2 },
    sellValue: 10,
    buyValue: 120,
  },
  silverleaf_sickle: {
    id: 'silverleaf_sickle',
    name: 'Sheenleaf Sickle',
    kind: 'tool',
    quality: 'uncommon',
    use: { type: 'gatherTool', professionId: 'herbalism', tier: 3 },
    sellValue: 25,
    buyValue: 400,
  },
  // Crafted base tools, tier 4 and 5 (#1135). Same shape and gating as the
  // vendor tools above (infinite-durability, `use.tier` gates node AND
  // monster-material tier access via src/sim/professions/tools.ts), but these
  // are produced by a profession (see COMMON_RECIPES in content/recipes.ts) or
  // bought with delve Marks, and NEVER sold for copper: no `buyValue`, and
  // deliberately absent from every NPC `vendorItems` list and from
  // HEROIC_VENDOR_STOCK. The Marks rows live in content/delves/shop.ts and are
  // what gives a non-crafter a route to the top of the ladder.
  //
  // `quality` (rarity) never affects GATING: only `use.tier` is read by the
  // gate, and that is the part which must never change. It is no longer
  // value-only, though. Rarity now buys narrow bonuses that cannot affect
  // access: charges on a slotted effect (professions/tools.ts
  // startingDurabilityFor) and, on a rod, a wider reel window
  // (professions/fishing.ts fishReelWindowSecFor). An epic tool opens no node a
  // common tool of the same tier cannot.
  thorium_mining_pick: {
    id: 'thorium_mining_pick',
    name: 'Osmium Mining Pick',
    kind: 'tool',
    quality: 'rare',
    use: { type: 'gatherTool', professionId: 'mining', tier: 4 },
    sellValue: 60,
  },
  arcanite_mining_pick: {
    id: 'arcanite_mining_pick',
    name: 'Glyphsteel Mining Pick',
    kind: 'tool',
    quality: 'epic',
    use: { type: 'gatherTool', professionId: 'mining', tier: 5 },
    sellValue: 150,
  },
  ashwood_axe: {
    id: 'ashwood_axe',
    name: 'Ashwood Axe',
    kind: 'tool',
    quality: 'rare',
    use: { type: 'gatherTool', professionId: 'logging', tier: 4 },
    sellValue: 60,
  },
  elderwood_axe: {
    id: 'elderwood_axe',
    name: 'Highpine Axe',
    kind: 'tool',
    quality: 'epic',
    use: { type: 'gatherTool', professionId: 'logging', tier: 5 },
    sellValue: 150,
  },
  goldleaf_sickle: {
    id: 'goldleaf_sickle',
    name: 'Goldleaf Sickle',
    kind: 'tool',
    quality: 'rare',
    use: { type: 'gatherTool', professionId: 'herbalism', tier: 4 },
    sellValue: 60,
  },
  sunpetal_sickle: {
    id: 'sunpetal_sickle',
    name: 'Sunpetal Sickle',
    kind: 'tool',
    quality: 'epic',
    use: { type: 'gatherTool', professionId: 'herbalism', tier: 5 },
    sellValue: 150,
  },
  // The crafted rods, tier 4 and 5 (D9). Same shape, pricing and
  // never-vendor-sold rule as the six land tools above, and made at the same
  // toolworks, but their ladder is built out of what a rod CATCHES rather than
  // out of fine gathered grades: fishing has no world nodes, so no fine
  // material exists for it (professions/material_grades.ts owns the nine that
  // do). See ROD_RECIPES in content/recipes.ts for what each rung consumes and
  // why that is a weaker self-gate than the land ladder's.
  //
  // What the top two rungs actually buy: no new catch band (there are three
  // bands and tier 3 already reaches the last one) and no new zone (there are
  // three zones and tier 3 already opens the deepest). They buy the minigame
  // itself, a shorter worst-case wait and a wider reel window, plus the
  // standing they read as. Tier 5 sits flat on the bite-delay floor, which is
  // the ladder ending rather than a rounding error.
  stormreel_fishing_rod: {
    id: 'stormreel_fishing_rod',
    name: 'Stormreel Fishing Rod',
    kind: 'tool',
    quality: 'rare',
    use: { type: 'gatherTool', professionId: 'fishing', tier: 4 },
    sellValue: 60,
  },
  tidewrought_fishing_rod: {
    id: 'tidewrought_fishing_rod',
    name: 'Tidewrought Fishing Rod',
    kind: 'tool',
    quality: 'epic',
    use: { type: 'gatherTool', professionId: 'fishing', tier: 5 },
    sellValue: 150,
  },
  // Tier 4/5 crafting reagents for the tools directly above (#1135's
  // `TOOL_RECIPE_STUBS`, de-stubbed into src/sim/content/recipes.ts once
  // #1127's crafting action existed to consume them). `kind: 'junk'`, same
  // generic-material shape as bone_fragments/linen_scrap/spider_leg below:
  // The ore/log/herb entries are also node-gathered (the
  // mirefen_marsh/thornpeak_heights rows of gathering.ts NODE_MATERIAL_TABLE);
  // arcanite_bar stays vendor-only.
  // Sold by Quartermaster Bree at the Highwatch hub (zone3.ts) so every hub
  // recipe has a live reagent source; buyValue is the trade-goods staple
  // markup already used in this file (4x sellValue, travelers_knapsack's
  // exact ratio, with linen_pouch and spring_water close by at 4.17x), not
  // a new balance number.
  // Crafting materials are common (white): they are reagents, not vendor trash, so
  // they must never fall into the junk sweep (sellAllJunk in src/sim/items.ts vendors
  // every quality 'poor' item). Their tier is read from sellValue/buyValue, not the
  // rarity color. Enforced by tests/crafting_materials_quality.test.ts.
  thorium_ore: {
    id: 'thorium_ore',
    name: 'Osmium Ore',
    kind: 'junk',
    quality: 'common',
    sellValue: 15,
    buyValue: 60,
  },
  arcanite_bar: {
    id: 'arcanite_bar',
    name: 'Glyphsteel Bar',
    kind: 'junk',
    quality: 'common',
    sellValue: 40,
    buyValue: 160,
  },
  ashwood_log: {
    id: 'ashwood_log',
    name: 'Ashwood Log',
    kind: 'junk',
    quality: 'common',
    sellValue: 15,
    buyValue: 60,
  },
  elderwood_log: {
    id: 'elderwood_log',
    name: 'Highpine Log',
    kind: 'junk',
    quality: 'common',
    sellValue: 40,
    buyValue: 160,
  },
  goldleaf_herb: {
    id: 'goldleaf_herb',
    name: 'Goldleaf Herb',
    kind: 'junk',
    quality: 'common',
    sellValue: 15,
    buyValue: 60,
  },
  sunpetal_herb: {
    id: 'sunpetal_herb',
    name: 'Sunpetal Herb',
    kind: 'junk',
    quality: 'common',
    sellValue: 40,
    buyValue: 160,
  },
  // Low-tier gathering-node materials (Professions 2.0): the
  // eastbrook_vale and mirefen_marsh rows of gathering.ts NODE_MATERIAL_TABLE.
  // Node-gathered only, so no buyValue (not vendor-stocked); tier is read from
  // sellValue exactly like the reagents above, and the same common-quality
  // house rule applies (never poor, or sellAllJunk would vendor them).
  copper_ore: {
    id: 'copper_ore',
    name: 'Copper Ore',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
  },
  iron_ore: {
    id: 'iron_ore',
    name: 'Iron Ore',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
  },
  ironbark_log: {
    id: 'ironbark_log',
    name: 'Ironbark Log',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
  },
  silverleaf_herb: {
    id: 'silverleaf_herb',
    name: 'Sheenleaf Herb',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
  },
  // Fine grades of the nine node materials (D8, the fine-material axis). A
  // harvest yields one of these INSTEAD of its base id when the player's tool
  // is strictly above the material's zone tier at a full-grade vein
  // (professions/material_grades.ts); same unit count, same rarity roll, same
  // two rng draws. The six crafted tool recipes consume the fine grade, which
  // is what makes the tool below each rung the only route to it.
  //
  // Priced at twice the base sellValue, with the delisted-material
  // convention's 4x buyValue on top. Both halves are deliberate:
  // - Doubling the sell price is the whole reward for a harvest that a
  //   worse tool would have spent on the plain grade.
  // - buyValue is the ECONOMY BASIS, not a stock row, exactly as
  //   docs/design/professions.md restates the ruling and
  //   tests/professions_master_stock.test.ts pins it for the delisted five.
  //   No NPC stocks any of these. Omitting it would silently drop three
  //   re-specced tool recipes out of the counterfactually-vendor-fed set in
  //   tests/recipe_economy.test.ts, which is the tighter of the two economy
  //   bounds: the loop would keep passing over a smaller set, which is the
  //   failure mode that arm was rewritten to prevent.
  // Common quality like every other reagent, or sellAllJunk would vendor them.
  fine_copper_ore: {
    id: 'fine_copper_ore',
    name: 'Fine Copper Ore',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
    buyValue: 32,
  },
  fine_iron_ore: {
    id: 'fine_iron_ore',
    name: 'Fine Iron Ore',
    kind: 'junk',
    quality: 'common',
    sellValue: 16,
    buyValue: 64,
  },
  fine_thorium_ore: {
    id: 'fine_thorium_ore',
    name: 'Fine Osmium Ore',
    kind: 'junk',
    quality: 'common',
    sellValue: 30,
    buyValue: 120,
  },
  fine_ironbark_log: {
    id: 'fine_ironbark_log',
    name: 'Fine Ironbark Log',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
    buyValue: 32,
  },
  fine_ashwood_log: {
    id: 'fine_ashwood_log',
    name: 'Fine Ashwood Log',
    kind: 'junk',
    quality: 'common',
    sellValue: 30,
    buyValue: 120,
  },
  fine_elderwood_log: {
    id: 'fine_elderwood_log',
    name: 'Fine Highpine Log',
    kind: 'junk',
    quality: 'common',
    sellValue: 80,
    buyValue: 320,
  },
  fine_silverleaf_herb: {
    id: 'fine_silverleaf_herb',
    name: 'Fine Sheenleaf Herb',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
    buyValue: 32,
  },
  fine_goldleaf_herb: {
    id: 'fine_goldleaf_herb',
    name: 'Fine Goldleaf Herb',
    kind: 'junk',
    quality: 'common',
    sellValue: 30,
    buyValue: 120,
  },
  fine_sunpetal_herb: {
    id: 'fine_sunpetal_herb',
    name: 'Fine Sunpetal Herb',
    kind: 'junk',
    quality: 'common',
    sellValue: 80,
    buyValue: 320,
  },
  // Cosmetic event reward: using it rolls a rarity rank (server-side) and opens
  // the skin-select overlay. See src/sim/content/skins.ts. Dev-grant for now.
  event_skin_token: {
    id: 'event_skin_token',
    name: 'Mysterious Cosmetic Cache',
    kind: 'tool',
    quality: 'epic',
    use: { type: 'skinSelect', catalog: 'class' },
    sellValue: 0,
  },
  // Heroic-dungeon participation token: the final boss of a heroic instance
  // directly awards marks to every eligible participant (awardHeroicMarks in
  // src/sim/instances/dungeons.ts). Not vendorable; a spend sink ships later.
  heroic_mark: {
    id: 'heroic_mark',
    name: 'Heroic Mark',
    kind: 'tool',
    quality: 'rare',
    // Currency-like: marks stack so saving toward a 12-16 mark vendor price
    // (content/heroic_vendor.ts) does not eat a bag slot per mark.
    stackSize: 20,
    sellValue: 0,
    // Bound to the earner: marks can only be spent at the Heroic Quartermaster,
    // never traded, mailed, listed, or destroyed.
    soulbound: true,
    noDiscard: true,
  },
  raw_mirror_trout: {
    id: 'raw_mirror_trout',
    name: 'Raw Mirror Trout',
    kind: 'junk',
    quality: 'common',
    sellValue: 3,
  },
  tangled_weed: {
    id: 'tangled_weed',
    name: 'Tangled Weed',
    kind: 'junk',
    quality: 'poor',
    sellValue: 1,
  },
  // --- fishing catches (see FISHING_TABLES below). Every raw catch is a
  // cooking reagent (kind junk, no foodHp); cooked meals and vendor/conjured
  // food are the sit-heal path. Grey junk (weed/boot) just vendors for copper.
  // Zone tier still shapes which catch drops, not a raw heal curve. ---
  raw_river_perch: {
    id: 'raw_river_perch',
    name: 'Raw River Perch',
    kind: 'junk',
    quality: 'common',
    sellValue: 2,
  },
  raw_marsh_pike: {
    id: 'raw_marsh_pike',
    name: 'Raw Marsh Pike',
    kind: 'junk',
    quality: 'common',
    sellValue: 6,
  },
  raw_bog_eel: {
    id: 'raw_bog_eel',
    name: 'Raw Bog Eel',
    kind: 'junk',
    quality: 'common',
    sellValue: 6,
  },
  raw_frostgill_trout: {
    id: 'raw_frostgill_trout',
    name: 'Raw Frostgill Trout',
    kind: 'junk',
    quality: 'common',
    sellValue: 10,
  },
  // The id/name divergence here is permanent: the id shipped in v0.28.0 (ids
  // in live saves are frozen API, see tests/shipped_item_ids.test.ts) while
  // the display name already carried the original Slatefin coin.
  // Ids are never player-visible, so the display name is the one that matters.
  raw_stonescale_carp: {
    id: 'raw_stonescale_carp',
    name: 'Raw Slatefin Carp',
    kind: 'junk',
    quality: 'common',
    sellValue: 10,
  },
  soggy_boot: {
    id: 'soggy_boot',
    name: 'Soggy Boot',
    kind: 'junk',
    quality: 'poor',
    sellValue: 1,
  },
  // The prized rare catch, reelable from any water, a lucky hook. Cooking and
  // rod-ladder reagent, never edible raw.
  glimmerfin_koi: {
    id: 'glimmerfin_koi',
    name: 'Sunglint Koi',
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 75,
  },
  roasted_boar: {
    id: 'roasted_boar',
    name: 'Spitted Boar Haunch',
    kind: 'food',
    quality: 'common',
    foodHp: 117,
    sellValue: 12,
    buyValue: 100,
  },
  // --- combat potions (vendor): instant, usable in combat, 2-minute shared cooldown.
  // Restore less than sitting to eat/drink, the price you pay for not sitting (#103).
  minor_healing_potion: {
    id: 'minor_healing_potion',
    name: 'Minor Healing Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 90,
    sellValue: 8,
    buyValue: 40,
  },
  minor_mana_potion: {
    id: 'minor_mana_potion',
    name: 'Minor Mana Potion',
    kind: 'potion',
    quality: 'common',
    potionMana: 120,
    sellValue: 8,
    buyValue: 40,
  },
  // --- battle elixir: a temporary stat buff on use (classic flask/elixir staple).
  // Drops from the Mirefen brutes; +Stamina helps anyone push deeper into the marsh.
  elixir_of_the_bear: {
    id: 'elixir_of_the_bear',
    name: 'Elixir of the Bear',
    kind: 'elixir',
    quality: 'uncommon',
    elixir: { aura: 'Might of the Bear', kind: 'buff_sta', value: 12, duration: 900 },
    sellValue: 20,
    buyValue: 100,
  },
  // Higher tiers of the combat-potion ladder, keeping pace with the zone-2/3
  // level bands (classic Minor -> Lesser -> standard progression). Same instant,
  // in-combat, 2-minute-shared-cooldown rules as the Minor tier above.
  lesser_healing_potion: {
    id: 'lesser_healing_potion',
    name: 'Lesser Healing Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 150,
    sellValue: 16,
    buyValue: 85,
  },
  lesser_mana_potion: {
    id: 'lesser_mana_potion',
    name: 'Lesser Mana Potion',
    kind: 'potion',
    quality: 'common',
    potionMana: 200,
    sellValue: 16,
    buyValue: 85,
  },
  healing_potion: {
    id: 'healing_potion',
    name: 'Healing Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 280,
    sellValue: 32,
    buyValue: 170,
  },
  mana_potion: {
    id: 'mana_potion',
    name: 'Mana Potion',
    kind: 'potion',
    quality: 'common',
    potionMana: 360,
    sellValue: 32,
    buyValue: 170,
  },
  conjured_water: {
    id: 'conjured_water',
    name: 'Conjured Rainwater',
    kind: 'drink',
    quality: 'common',
    drinkMana: 76,
    sellValue: 0,
  },
  conjured_water2: {
    id: 'conjured_water2',
    name: 'Conjured Wellwater',
    kind: 'drink',
    quality: 'common',
    drinkMana: 288,
    sellValue: 0,
  },
  conjured_water3: {
    id: 'conjured_water3',
    name: 'Conjured Clearwater',
    kind: 'drink',
    quality: 'common',
    drinkMana: 672,
    sellValue: 0,
  },
  conjured_water4: {
    id: 'conjured_water4',
    name: 'Conjured Springwater',
    kind: 'drink',
    quality: 'common',
    drinkMana: 1150,
    sellValue: 0,
  },
  // --- conjured food (mage Conjure Food ranks; foodHp tiers pair with the
  // conjured-water mana tiers above) ---
  conjured_bread: {
    id: 'conjured_bread',
    name: 'Conjured Oatcake',
    kind: 'food',
    quality: 'common',
    foodHp: 61,
    sellValue: 0,
  },
  conjured_bread2: {
    id: 'conjured_bread2',
    name: 'Conjured Black Loaf',
    kind: 'food',
    quality: 'common',
    foodHp: 243,
    sellValue: 0,
  },
  conjured_bread3: {
    id: 'conjured_bread3',
    name: 'Conjured Honeycake',
    kind: 'food',
    quality: 'common',
    foodHp: 552,
    sellValue: 0,
  },
  conjured_bread4: {
    id: 'conjured_bread4',
    name: 'Conjured Feastloaf',
    kind: 'food',
    quality: 'common',
    foodHp: 980,
    sellValue: 0,
  },
  // --- Smith Haldren's stock (common/white, levels 3-7) ---
  eastbrook_arming_sword: {
    id: 'eastbrook_arming_sword',
    name: 'Eastbrook Arming Sword',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 5, max: 9, speed: 2.2 },
    sellValue: 140,
    buyValue: 1400,
  },
  eastbrook_greatsword: {
    id: 'eastbrook_greatsword',
    name: 'Eastbrook Greatsword',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'common',
    weapon: { min: 9, max: 15, speed: 3.4 },
    sellValue: 160,
    buyValue: 1600,
  },
  bronzework_mace: {
    id: 'bronzework_mace',
    name: 'Bronzework Mace',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 6, max: 10, speed: 2.6 },
    sellValue: 140,
    buyValue: 1400,
  },
  vale_carving_knife: {
    id: 'vale_carving_knife',
    name: 'Vale Carving Knife',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 4, max: 7, speed: 1.8, dagger: true },
    sellValue: 120,
    buyValue: 1200,
  },
  hickory_shortstaff: {
    id: 'hickory_shortstaff',
    name: 'Hickory Shortstaff',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 6, max: 11, speed: 3.0 },
    stats: { int: 1 },
    sellValue: 150,
    buyValue: 1500,
  },
  eastbrook_buckler: {
    id: 'eastbrook_buckler',
    name: 'Eastbrook Buckler',
    kind: 'armor',
    armorType: 'mail',
    slot: 'offhand',
    shield: true,
    blockValue: 6,
    quality: 'common',
    stats: { armor: 34, sta: 1 },
    sellValue: 130,
    buyValue: 1300,
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  eastbrook_chain_vest: {
    id: 'eastbrook_chain_vest',
    name: 'Eastbrook Chainmail Vest',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 60 },
    sellValue: 180,
    buyValue: 1800,
  },
  valespun_robe: {
    id: 'valespun_robe',
    name: 'Valespun Robe',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 22 },
    sellValue: 140,
    buyValue: 1400,
  },
  tanned_leather_jerkin: {
    id: 'tanned_leather_jerkin',
    name: 'Tanned Leather Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'common',
    stats: { armor: 40 },
    // Economy invariant: sellValue re-priced below
    // the reworked craft input (88); buyValue is the armorer's shop price and
    // deliberately keeps the old 10x-of-160 figure so the vendor catalog is
    // untouched by the economy fix.
    sellValue: 80,
    buyValue: 1600,
  },
  hobnail_boots: {
    id: 'hobnail_boots',
    name: 'Hobnailed Boots',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'common',
    stats: { armor: 18 },
    sellValue: 90,
    buyValue: 900,
  },
  eastbrook_wool_trousers: {
    id: 'eastbrook_wool_trousers',
    name: 'Eastbrook Wool Trousers',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'common',
    stats: { armor: 24 },
    sellValue: 110,
    buyValue: 1100,
  },
  // --- Crafted caster-stat gear (int/spi): one common-tier piece per
  // tailoring/leatherworking/armorcrafting, filling the gap that every OTHER
  // crafted item is armor-only (see recipes.ts COMMON_RECIPES comment). Stats
  // sized via item_budget.ts primaryStatBudget(level, quality, slot).
  eastbrook_ritual_vestments: {
    id: 'eastbrook_ritual_vestments',
    name: 'Eastbrook Ritual Vestments',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 30, int: 2, spi: 1 },
    // Economy invariant: re-priced below the
    // reworked craft input (85); this also retires the piece as the cheapest
    // disenchant fodder (the evidence review's dust-mill row). Not vendored;
    // buyValue keeps its historical figure, and its one live reader (the
    // market suggested ask, market_view.ts) clamps to 10x sellValue.
    sellValue: 72,
    buyValue: 2100,
  },
  eastbrook_druids_hide: {
    id: 'eastbrook_druids_hide',
    name: "Eastbrook Druid's Hide",
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 52, int: 2, spi: 1 },
    // Economy invariant: re-priced below the
    // reworked craft input (93). Not vendored; buyValue kept, read only by
    // the market suggested ask, which clamps to 10x sellValue.
    sellValue: 84,
    buyValue: 2300,
  },
  eastbrook_warded_leggings: {
    id: 'eastbrook_warded_leggings',
    name: 'Eastbrook Warded Leggings',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 50, int: 2, spi: 1 },
    // Economy invariant: re-priced below the
    // reworked craft input (117). Not vendored; buyValue kept, read only by
    // the market suggested ask, which clamps to 10x sellValue.
    sellValue: 105,
    buyValue: 2200,
  },
  // Hub-tier (level-20, crafting-hub-gated) caster pieces, one per craft,
  // mirroring TOOL_RECIPES' osmium tier. Budgeted at the recipe's resulting ITEM
  // level (source level 20 + the rare QUALITY_ILVL_BONUS of 3 = 23, see
  // item_budget.ts and item_level.ts), matching the level-20 rares in the same
  // slots (boundstone_helm, gravewyrm_gauntlets, gravewyrm_mantle; pinned by
  // tests/item_level.test.ts): helmet 11, gloves 9, shoulder 10.
  wardweave_cowl: {
    id: 'wardweave_cowl',
    name: 'Wardweave Cowl',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 44, int: 7, spi: 4 },
    sellValue: 440,
  },
  duskhide_wraps: {
    id: 'duskhide_wraps',
    name: 'Duskhide Wraps',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'rare',
    stats: { armor: 46, int: 6, spi: 3 },
    sellValue: 420,
  },
  sootscale_mantle: {
    id: 'sootscale_mantle',
    name: 'Kilnscale Mantle',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'rare',
    stats: { armor: 78, int: 6, spi: 4 },
    // Economy invariant, discount-aware arm: both reagents are vendor-stocked
    // at the forge, and a specialized crafter holding a self-signed ore
    // consumes as little as 4 ore + 3 flux = 300c, so the old 470 vendor-back
    // sat gold-positive. Re-priced below that cheapest achievable
    // input (the v0.29.0 output-re-price precedent); the vendor-loop bound is
    // pinned by tests/recipe_economy.test.ts.
    sellValue: 280,
  },
  // --- Hollow Crypt rewards (rare/blue) ---
  // Item-level showcase: these rares are NORMALIZED to the stat budget their item
  // level earns (see src/sim/item_level.ts). The three weapons are the q_hollow
  // reward for felling Morthen (level 10), so item level 13 (rare +3) -> a 7-point
  // primary-stat budget; each keeps its own stat identity (str/sta, agi/sta,
  // int/spi) at the same total. The three archetype chests drop from the level-7
  // chapel elites, so item level 10 -> a 6-point budget. tests/item_level.test.ts
  // pins data == formula. (hollowbone_hauberk and cryptstalker_jerkin already sat
  // at 6, so only the off-budget pieces below moved.)
  gravecaller_blade: {
    id: 'gravecaller_blade',
    name: "Gravecaller's Broadblade",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 9, max: 16, speed: 2.4 },
    stats: { str: 4, sta: 3 },
    sellValue: 800,
  },
  widowfang_dirk: {
    id: 'widowfang_dirk',
    name: 'Widowfang Dirk',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 6, max: 10, speed: 1.7, dagger: true },
    stats: { agi: 4, sta: 3 },
    sellValue: 800,
  },
  gravecaller_staff: {
    id: 'gravecaller_staff',
    name: 'Staff of the Hollow',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 10, max: 17, speed: 3.0 },
    stats: { int: 5, spi: 2 },
    sellValue: 800,
  },
  marrowtread_boots: {
    id: 'marrowtread_boots',
    name: 'Marrowtread Boots',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 45, sta: 2, str: 1 },
    sellValue: 500,
    requiredClass: WAR,
  },
  sextons_slippers: {
    id: 'sextons_slippers',
    name: "Sexton's Slippers",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 20, int: 2, spi: 2 },
    sellValue: 500,
    requiredClass: MAG,
  },
  gravewalker_softboots: {
    id: 'gravewalker_softboots',
    name: 'Gravewalker Softboots',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 32, agi: 3 },
    sellValue: 500,
    requiredClass: ROG,
  },
  hollowbone_hauberk: {
    id: 'hollowbone_hauberk',
    name: 'Hollowbone Hauberk',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 105, str: 3, sta: 3 },
    sellValue: 700,
    requiredClass: WAR,
  },
  gravewoven_raiment: {
    id: 'gravewoven_raiment',
    name: 'Gravewoven Raiment',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 38, int: 3, spi: 3 },
    sellValue: 700,
    requiredClass: MAG,
  },
  cryptstalker_jerkin: {
    id: 'cryptstalker_jerkin',
    name: 'Gravestalker Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'rare',
    stats: { armor: 65, agi: 4, sta: 2 },
    sellValue: 700,
    requiredClass: ROG,
  },
  hollowbound_legguards: {
    id: 'hollowbound_legguards',
    name: 'Hollowbound Legguards',
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'rare',
    stats: { armor: 62, sta: 3 },
    sellValue: 600,
  },
  gravepath_treads: {
    id: 'gravepath_treads',
    name: 'Gravepath Treads',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'rare',
    stats: { armor: 42, sta: 2 },
    sellValue: 600,
  },
  // --- Captain Verlan (ruins rare) drops ---
  // A shared uncommon trophy (any class) plus a mutually-exclusive rare chase
  // group, one item per archetype, mirroring the other zone-1 rare elites.
  oathbound_greaves: {
    id: 'oathbound_greaves',
    name: 'Oathbound Greaves',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 52, sta: 2, str: 1 },
    sellValue: 200,
  },
  verlans_oathblade: {
    id: 'verlans_oathblade',
    name: "Verlan's Oathblade",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 10, max: 16, speed: 2.5 },
    stats: { str: 4, sta: 2 },
    sellValue: 880,
    requiredClass: WAR,
  },
  hollow_vigil_staff: {
    id: 'hollow_vigil_staff',
    name: 'Staff of the Hollow Vigil',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 11, max: 18, speed: 3.0 },
    stats: { int: 5, spi: 2 },
    sellValue: 880,
    requiredClass: CASTER_WEAPON_CLASSES,
  },
  gravewardens_shiv: {
    id: 'gravewardens_shiv',
    name: "Gravewarden's Shiv",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 7, max: 11, speed: 1.7, dagger: true },
    stats: { agi: 4, sta: 2 },
    sellValue: 880,
    requiredClass: ROG,
  },
  maldrecs_soulbinder: {
    id: 'maldrecs_soulbinder',
    name: "Maldrec's Soulbinder",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 11, max: 18, speed: 3.0 },
    stats: { int: 4, spi: 3 },
    sellValue: 850,
  },
  // --- Class/spec gap fill (uncommon/green leveling pieces) ---
  // Budgeted via primaryStatBudget(item level, uncommon, slot); see
  // src/sim/item_budget.ts. The leather int/spi pieces open the druid caster
  // line, the mail int/spi pieces the shaman/paladin caster line, and the
  // FERAL-locked two-handers start the bear-form weapon ladder (bear form
  // swings the equipped weapon, src/sim/combat/form_swing.ts).
  mosshide_vest: {
    id: 'mosshide_vest',
    name: 'Mosshide Vest',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'uncommon',
    // Sableweb Lurkers (level 4) -> item level 5, chest budget 2.
    stats: { armor: 40, int: 1, spi: 1 },
    sellValue: 130,
  },
  thornling_grips: {
    id: 'thornling_grips',
    name: 'Thornling Grips',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'uncommon',
    // Deeprock Diggers (level 6) -> item level 7, gloves budget 2.
    stats: { armor: 24, int: 1, spi: 1 },
    sellValue: 140,
  },
  acolyte_chain_grips: {
    id: 'acolyte_chain_grips',
    name: 'Acolyte Chain Grips',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'uncommon',
    // Old Greyjaw (level 4 rare) -> item level 5, gloves budget 1.
    stats: { armor: 22, int: 1 },
    sellValue: 120,
  },
  votive_chain_belt: {
    id: 'votive_chain_belt',
    name: 'Votive Chain Belt',
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'uncommon',
    // Gorrak (level 6 boss) -> item level 7, waist budget 2.
    stats: { armor: 28, int: 1, spi: 1 },
    sellValue: 150,
  },
  briarroot_staff: {
    id: 'briarroot_staff',
    name: 'Briarroot Staff',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'uncommon',
    // Grix the Tunnelking (level 7 rare elite) -> item level 8: the 2H stat
    // budget round(primaryStatBudget(8, uncommon, mainhand) = 3 x
    // TWOHAND_STAT_MULT) = 4, dps on the weaponDpsBudget(8) x TWOHAND_DPS_MULT
    // curve (~10.47 at speed 3.3).
    weapon: { min: 29, max: 40, speed: 3.3 },
    stats: { str: 2, sta: 2 },
    sellValue: 320,
    requiredClass: FERAL,
  },
  valefire_lantern: {
    id: 'valefire_lantern',
    name: 'Valefire Lantern',
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'uncommon',
    // Mogger (level 6 rare elite) -> item level 7, offhand budget 2. The first
    // low-level held offhand; equips by the literal CASTER_ALL list.
    stats: { int: 1, spi: 1 },
    sellValue: 160,
    requiredClass: CASTER_ALL,
  },
  moggers_hide_quiver: {
    id: 'moggers_hide_quiver',
    name: "Mogger's Hide Quiver",
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'uncommon',
    // The hunter counterpart to valefire_lantern, off the same rare elite:
    // Mogger (level 6) -> item level 7, offhand budget 2. Hunters are the one
    // class no offhand rule admits (equipment_rules canDualWield excludes them,
    // and no shield or held offhand names them), so the slot sat empty and its
    // stat budget went uncollected. Held offhands equip by the literal
    // requiredClass alone, which is what lets a hunter-only list work here.
    stats: { agi: 1, sta: 1 },
    sellValue: 160,
    requiredClass: HUNTER_ONLY,
  },
  // --- quest items ---
  boar_hide: {
    id: 'boar_hide',
    name: 'Bristly Boar Hide',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_boars',
  },
  // Thrown at murloc huts for "Back to the Shallows" (q_deepfen_purge). Reusable:
  // it is not consumed, so a 5s throw cooldown paces the burns instead.
  firebottle: {
    id: 'firebottle',
    name: 'Firebottle',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_deepfen_purge',
    use: { type: 'throw' },
  },
  // Name/label entry for the burnable murloc-hut world objects (q_deepfen_purge).
  murloc_hut: {
    id: 'murloc_hut',
    name: 'Mudfin Hut',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_deepfen_purge',
  },
  gravecaller_sigil: {
    id: 'gravecaller_sigil',
    name: "Gravecaller's Sigil",
    kind: 'quest',
    sellValue: 0,
    questId: 'q_whispers',
  },
  blessed_wax: {
    id: 'blessed_wax',
    name: 'Blessed Tallow',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_rite',
  },
  ghostly_essence: {
    id: 'ghostly_essence',
    name: 'Ghostly Essence',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_rite',
  },
  restless_skull: {
    id: 'restless_skull',
    name: 'Restless Skull',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_bones',
  },
  webwood_silk: {
    id: 'webwood_silk',
    name: 'Sableweb Silk Gland',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_spiders',
  },
  supply_crate: {
    id: 'supply_crate',
    name: 'Stolen Supply Crate',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_supplies',
  },
  greyjaw_fang: {
    id: 'greyjaw_fang',
    name: "Old Greyjaw's Fang",
    kind: 'quest',
    sellValue: 0,
    questId: 'q_greyjaw',
  },
  chunk_of_ore: {
    // Retired profession-intro workaround. Keep the shipped id resolvable for
    // older character saves, but no live acquisition path grants it now that
    // q_prof_intro uses a genuine gather objective.
    id: 'chunk_of_ore',
    name: 'Chunk of Ore',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_prof_intro',
  },
  weathered_ledger_page: {
    id: 'weathered_ledger_page',
    name: 'Weathered Ledger Page',
    kind: 'quest',
    sellValue: 0,
    questId: 'q_names_of_the_dead',
  },
  morthen_grimoire: {
    id: 'morthen_grimoire',
    name: "Morthen's Grimoire",
    kind: 'quest',
    sellValue: 0,
    questId: 'q_gravecallers_trail',
  },
  // --- Brightwood Glade wildlife pack ---
  soft_down: {
    id: 'soft_down',
    name: 'Soft Down Tuft',
    kind: 'junk',
    quality: 'poor',
    sellValue: 4,
  },
  amber_hide: { id: 'amber_hide', name: 'Amber Hide', kind: 'junk', quality: 'poor', sellValue: 9 },
  stag_antler: {
    id: 'stag_antler',
    name: 'Branching Antler',
    kind: 'junk',
    quality: 'poor',
    sellValue: 8,
  },
  brightwood_venison: {
    id: 'brightwood_venison',
    name: 'Brightwood Venison',
    kind: 'food',
    quality: 'common',
    foodHp: 92,
    sellValue: 4,
    buyValue: 35,
  },
  bramblehide_jerkin: {
    id: 'bramblehide_jerkin',
    name: 'Bramblehide Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 40, sta: 2, agi: 1 },
    sellValue: 120,
  },
  monarch_crown_helm: {
    id: 'monarch_crown_helm',
    name: "Monarch's Crown",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 46, sta: 3, agi: 2, str: 1 },
    sellValue: 320,
  },
  // --- junk (gray) ---
  // wolf_fang became a crafting reagent
  // (recipe_eastbrook_arming_sword, recipe_ironbound_warplate_helm), so it
  // follows the same convention as spider_leg/bone_fragments/linen_scrap
  // below: common (white), NOT 'poor', or sellAllJunk would sweep it. Its
  // sellValue is unchanged. See tests/crafting_materials_quality.test.ts.
  wolf_fang: {
    id: 'wolf_fang',
    name: 'Cracked Wolf Fang',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
  },
  bandit_bandana: {
    id: 'bandit_bandana',
    name: 'Red Bandana',
    kind: 'junk',
    quality: 'poor',
    sellValue: 6,
  },
  tough_jerky: {
    id: 'tough_jerky',
    name: 'Salted Jerky',
    kind: 'food',
    quality: 'common',
    foodHp: 61,
    sellValue: 2,
    buyValue: 25,
  },
  mudfin_scale: {
    id: 'mudfin_scale',
    name: 'Slimy Mudfin Scale',
    kind: 'junk',
    quality: 'poor',
    sellValue: 5,
  },
  tallow_candle: {
    id: 'tallow_candle',
    name: 'Greasy Tallow Lump',
    kind: 'junk',
    quality: 'poor',
    sellValue: 5,
  },
  // These three are crafting reagents (COMMON_RECIPES), so they are common (white),
  // NOT quality 'poor', or the junk sweep (sellAllJunk in src/sim/items.ts) would
  // vendor them. See the enchanting materials note below and
  // tests/crafting_materials_quality.test.ts.
  spider_leg: {
    id: 'spider_leg',
    name: 'Twitching Spider Leg',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
  },
  bone_fragments: {
    id: 'bone_fragments',
    name: 'Bone Fragments',
    kind: 'junk',
    quality: 'common',
    sellValue: 7,
  },
  linen_scrap: {
    id: 'linen_scrap',
    name: 'Linen Scrap',
    kind: 'junk',
    quality: 'common',
    sellValue: 3,
  },

  // --- Enchanting materials ------------------------------------------------
  // Disenchant yield (src/sim/professions/enchanting.ts), tiered by the
  // disenchanted item's rarity: common/uncommon -> dust, rare -> essence,
  // epic/legendary -> shard. The material qualities mirror that ladder on
  // purpose (dust white, essence uncommon, shard rare); only quality 'poor' is
  // swept by sellAllJunk, so none of them are at risk. Consumed as reagents by
  // the ENCHANTS table (content/enchants.ts). Reuses the 'junk' kind, same as
  // bone_fragments/linen_scrap/spider_leg above (this repo has no dedicated
  // material kind).
  arcane_dust: {
    id: 'arcane_dust',
    name: 'Chime Dust',
    kind: 'junk',
    quality: 'common',
    sellValue: 6,
  },
  arcane_essence: {
    id: 'arcane_essence',
    name: 'Chime Essence',
    kind: 'junk',
    quality: 'uncommon',
    sellValue: 18,
  },
  arcane_shard: {
    id: 'arcane_shard',
    name: 'Chime Shard',
    kind: 'junk',
    quality: 'rare',
    sellValue: 55,
  },

  // --- Tool-effect charms (the acquisition craft) ---------------------------
  // The item form of the two live TOOL_EFFECTS entries
  // (src/sim/content/professions.ts): Enchanter work, minted by the
  // TOOL_EFFECT_RECIPES (content/recipes.ts) and consumed by the
  // slot_tool_effect command through resolveSlotToolEffect
  // (src/sim/professions/tools.ts). Item id deliberately EQUALS the effect id:
  // one identity, one icon key, one display name. `quality: 'rare'` is
  // load-bearing, not cosmetic: the craft signing rule (crafting.ts, #1149)
  // mints every rare-or-better output as a signed instance carrying
  // `{ signer: crafterName }`, and the slot copies that signer into the slot's
  // `craftedBy`, which is what the original-crafter recharge discount reads. A
  // signed instance kept charms hand-to-hand under the pre-v0.33.0 exchange
  // rules; since the v0.33.0 instanced exchange pipes (#2507) a signed copy
  // lists on the World Market and mails like any instanced item, so restoring
  // R45's hand-to-hand-only intent would need an explicit noMarketList or
  // soulbound flag here (maintainer decision, flagged by the v0.33.0 merge
  // audit). No Springback (quickening_charm)
  // item exists ON PURPOSE: the R9 slot policy refuses that effect everywhere,
  // and no path may mint what another path refuses (the craftable set is
  // derived from these defs against the policy in
  // tests/professions_tool_effect_craft.test.ts). `kind: 'tool'` (not 'junk'):
  // a charm is an implement accessory, and the tool kind's stack size of 1
  // keeps each signed copy its own provenance-carrying slot entry.
  gatherers_cache: {
    id: 'gatherers_cache',
    name: "Gatherer's Cache",
    kind: 'tool',
    quality: 'rare',
    use: { type: 'toolEffect', effectId: 'gatherers_cache' },
    sellValue: 60,
  },
  artisans_eye: {
    id: 'artisans_eye',
    name: "Artisan's Eye",
    kind: 'tool',
    quality: 'rare',
    use: { type: 'toolEffect', effectId: 'artisans_eye' },
    sellValue: 60,
  },

  // --- Typed disenchant secondaries (Professions 2.0) -------------
  // A rare-or-better disenchant yields, alongside the universal ladder material
  // above, exactly one typed secondary keyed by the salvaged piece's material
  // (src/sim/professions/disenchant_reagents.ts): armor by its armor class,
  // weapons by family. Each is the sole reagent of one always-known ENCHANTS
  // row (content/enchants.ts), so none is a dead-end currency. They are granted
  // bind-on-trade (ItemInstancePayload.bindOnTrade), so a disenchant windfall
  // stays with the disenchanter rather than being freely resold. Same 'junk'
  // reuse as the arcane materials (this repo has no dedicated material kind);
  // all quality 'rare', so sellAllJunk (poor-only) never sweeps them.
  resonant_thread: {
    id: 'resonant_thread',
    name: 'Resonant Thread',
    kind: 'junk',
    quality: 'rare',
    sellValue: 40,
  },
  resonant_hide: {
    id: 'resonant_hide',
    name: 'Resonant Hide',
    kind: 'junk',
    quality: 'rare',
    sellValue: 40,
  },
  resonant_links: {
    id: 'resonant_links',
    name: 'Resonant Links',
    kind: 'junk',
    quality: 'rare',
    sellValue: 40,
  },
  resonant_steel: {
    id: 'resonant_steel',
    name: 'Resonant Steel',
    kind: 'junk',
    quality: 'rare',
    sellValue: 40,
  },
  resonant_timber: {
    id: 'resonant_timber',
    name: 'Resonant Timber',
    kind: 'junk',
    quality: 'rare',
    sellValue: 40,
  },

  // --- Quartermaster's Consignment ---------------------------------------
  // A standing line of practical adventuring gear. The Merchant keeps eight
  // pieces stocked on the World Market (see seedHouseListings); four more are
  // looted from threats around the Vale. All uncommon, Eastbrook-tier (~L5-9),
  // filling the helmet/shoulder/waist/gloves slots the early game leaves thin.
  roadwardens_helm: {
    id: 'roadwardens_helm',
    name: "Roadwarden's Helm",
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 45, sta: 2 },
    sellValue: 130,
    requiredClass: WAR,
  },
  wayfarers_hood: {
    id: 'wayfarers_hood',
    name: "Wayfarer's Hood",
    kind: 'armor',
    armorType: 'leather',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 30, agi: 2 },
    sellValue: 120,
    requiredClass: ROG,
  },
  acolytes_circlet: {
    id: 'acolytes_circlet',
    set: 'vale_arcanist',
    name: "Acolyte's Circlet",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 16, int: 2, spi: 1 },
    sellValue: 120,
    requiredClass: MAG,
  },
  reinforced_pauldrons: {
    id: 'reinforced_pauldrons',
    name: 'Reinforced Pauldrons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 50, str: 1, sta: 1 },
    sellValue: 140,
    requiredClass: WAR,
  },
  embroidered_mantle: {
    id: 'embroidered_mantle',
    name: 'Embroidered Mantle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 14, int: 2 },
    sellValue: 110,
    requiredClass: MAG,
  },
  sturdy_belt: {
    id: 'sturdy_belt',
    name: "Sturdy Traveler's Belt",
    kind: 'armor',
    armorType: 'leather',
    slot: 'waist',
    quality: 'uncommon',
    stats: { armor: 35, sta: 2 },
    sellValue: 100,
  },
  silk_sash: {
    id: 'silk_sash',
    set: 'vale_arcanist',
    name: 'Woven Silk Sash',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'waist',
    quality: 'uncommon',
    stats: { armor: 10, int: 2, spi: 1 },
    sellValue: 100,
    requiredClass: MAG,
  },
  roughspun_gloves: {
    id: 'roughspun_gloves',
    name: 'Roughspun Gloves',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 28, agi: 1, sta: 1 },
    sellValue: 95,
  },
  // looted pieces
  bristlehide_spaulders: {
    id: 'bristlehide_spaulders',
    name: 'Bristlehide Spaulders',
    kind: 'armor',
    armorType: 'leather',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 40, agi: 1, sta: 2 },
    sellValue: 150,
    requiredClass: ROG,
  },
  sableweb_cord: {
    id: 'sableweb_cord',
    name: 'Sableweb Cord',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'waist',
    quality: 'uncommon',
    stats: { armor: 11, agi: 1, int: 2 },
    sellValue: 150,
  },
  gorraks_cleaver: {
    id: 'gorraks_cleaver',
    name: "Gorrak's Cleaver",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 8, max: 14, speed: 2.5 },
    stats: { str: 3 },
    sellValue: 180,
    requiredClass: WAR,
  },
  mossy_handwraps: {
    id: 'mossy_handwraps',
    name: 'Mossgrown Handwraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 12, int: 1, spi: 2 },
    sellValue: 140,
    requiredClass: MAG,
  },
  // --- Crossroads Outfitters ----------------------------------------------
  // A travelling caravan quartermaster's standing stock, filling the slots the
  // Quartermaster's Consignment left thin: mainhand weapons plus chest, legs and
  // feet. All uncommon, Eastbrook-tier (~L8-12); most are unrestricted so any
  // melee adventurer can outfit a full set. The Merchant keeps eight on the
  // World Market (see seedHouseListings); four more drop around the Vale.
  crossroads_saber: {
    id: 'crossroads_saber',
    name: 'Crossroads Saber',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 8, max: 14, speed: 2.5 },
    stats: { str: 2 },
    sellValue: 170,
  },
  tradesman_hatchet: {
    id: 'tradesman_hatchet',
    name: "Tradesman's Hatchet",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 7, max: 13, speed: 2.3 },
    stats: { str: 1, sta: 1 },
    sellValue: 160,
  },
  drovers_staff: {
    id: 'drovers_staff',
    name: "Drover's Staff",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 9, max: 15, speed: 3.0 },
    stats: { int: 3, spi: 2 },
    sellValue: 175,
    requiredClass: CASTER_WEAPON_CLASSES,
  },
  caravan_warden_dirk: {
    id: 'caravan_warden_dirk',
    name: 'Caravan Warden Dirk',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 5, max: 9, speed: 1.7, dagger: true },
    stats: { agi: 3 },
    sellValue: 170,
    requiredClass: ROG,
  },
  outrider_brigandine: {
    id: 'outrider_brigandine',
    name: 'Outrider Brigandine',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 95, str: 1, sta: 2 },
    sellValue: 165,
  },
  caravan_quilted_vest: {
    id: 'caravan_quilted_vest',
    name: 'Caravan Quilted Vest',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 40, sta: 2 },
    sellValue: 130,
  },
  wanderers_chestguard: {
    id: 'wanderers_chestguard',
    name: "Wanderer's Chestguard",
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 60, agi: 2, sta: 1 },
    sellValue: 150,
  },
  outrider_legguards: {
    id: 'outrider_legguards',
    name: 'Outrider Legguards',
    kind: 'armor',
    armorType: 'mail',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 70, sta: 2 },
    sellValue: 150,
  },
  trail_leggings: {
    id: 'trail_leggings',
    set: 'greyjaw_stalker',
    name: 'Trailworn Leggings',
    kind: 'armor',
    armorType: 'leather',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 45, agi: 2 },
    sellValue: 120,
  },
  pilgrims_leggings: {
    id: 'pilgrims_leggings',
    name: "Pilgrim's Leggings",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 24, int: 2, spi: 1 },
    sellValue: 120,
  },
  outrider_sabatons: {
    id: 'outrider_sabatons',
    name: 'Outrider Sabatons',
    kind: 'armor',
    armorType: 'mail',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 55, sta: 2 },
    sellValue: 130,
  },
  milepost_boots: {
    id: 'milepost_boots',
    name: 'Milepost Boots',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'uncommon',
    stats: { armor: 30, agi: 1, sta: 1 },
    sellValue: 110,
  },
};

// --- Zone-aware fishing loot ----------------------------------------------
// A cast resolves to one weighted draw from the table for the zone the angler
// is standing in. `itemId: null` means "no fish are biting" (an empty hook).
// The engine (completeFishing, src/sim/professions/fishing.ts) rolls a single
// rng draw against the running weight total, so catches stay
// replay-deterministic.
export interface FishingEntry {
  itemId: string | null;
  weight: number;
}

// Catch rarity ladder (Professions 2.0): fishing proficiency selects
// one of three per-zone tables (bands). As proficiency rises the weight shifts
// out of the grey-junk rows (tangled_weed / soggy_boot) and the empty-hook null
// row and into the zone's cooking-catch rows (raw fish reagents). The moves are
// strictly monotonic per band step (each cooking catch non-decreasing, each
// grey junk / null row non-increasing), every band still sums to exactly 100,
// and the empty-hook null row is always present with weight >= 1. Band
// boundaries and selection live in src/sim/professions/fishing.ts
// (fishingBandFor); FISHING_TABLES_BY_BAND[band][zoneId] is the resolved table,
// with the eastbrook_vale row as the fallback for any zone without its own.
//
// THE AXIS THESE NINE CELLS ARE AUTHORED AGAINST (D9). A cell is not "how good
// is this angler", it is "how far is this angler from what this water asks".
// Each zone names a required band (professions/fishing_zones.ts, derived from
// the rod tier its water takes), and a cell's whole character follows from the
// distance between that and the band the cell is for:
//
//   empty hook   at the requirement 10, one band above 8, two above 6;
//                one band SHORT 35, two short 55
//   rare koi     1 / 3 / 6 by band, in every zone: the one row that reads
//                skill alone, because it is the rod ladder's reagent and a
//                seasoned angler should be the one who farms it
//   grey junk    carries the zone's own flavor (the marsh keeps its boots) and
//                swells with the shortfall, roughly doubling or worse against
//                the same zone's at-requirement cell
//   cooking catch whatever is left, split in each zone's shipped proportion
//
// So Eastbrook, which asks for nothing, keeps its shipped shape, and Thornpeak
// at band 0 pays 55 empty hooks and 28 grey junk out of 100 to a level-1 angler
// who borrowed a rod good enough to cast there. That is the whole point: the
// water is the difficulty, not the reel click. tests/fishing_zones.test.ts
// derives every number above from the schedule and fails on a cell edited past
// it.
export const FISHING_TABLES_BY_BAND: Record<string, FishingEntry[]>[] = [
  // Band 0 (proficiency 0-99). Eastbrook asks for band 0, so its cell is the
  // shipped starter table with the koi row moved onto the skill scale; the two
  // zones above it are where a band-0 angler pays for fishing over their head.
  {
    eastbrook_vale: [
      { itemId: 'raw_mirror_trout', weight: 46 },
      { itemId: 'raw_river_perch', weight: 31 },
      { itemId: 'tangled_weed', weight: 12 },
      { itemId: 'glimmerfin_koi', weight: 1 },
      { itemId: null, weight: 10 },
    ],
    mirefen_marsh: [
      { itemId: 'raw_marsh_pike', weight: 22 },
      { itemId: 'raw_bog_eel', weight: 17 },
      { itemId: 'soggy_boot', weight: 12 },
      { itemId: 'tangled_weed', weight: 13 },
      { itemId: 'glimmerfin_koi', weight: 1 },
      { itemId: null, weight: 35 },
    ],
    thornpeak_heights: [
      { itemId: 'raw_frostgill_trout', weight: 9 },
      { itemId: 'raw_stonescale_carp', weight: 7 },
      { itemId: 'tangled_weed', weight: 28 },
      { itemId: 'glimmerfin_koi', weight: 1 },
      { itemId: null, weight: 55 },
    ],
  },
  // Band 1 (proficiency 100-199): Mirefen's own band. Its water fishes
  // normally now, Eastbrook is one band over and thins further, and Thornpeak
  // is still one band short.
  {
    eastbrook_vale: [
      { itemId: 'raw_mirror_trout', weight: 49 },
      { itemId: 'raw_river_perch', weight: 32 },
      { itemId: 'tangled_weed', weight: 8 },
      { itemId: 'glimmerfin_koi', weight: 3 },
      { itemId: null, weight: 8 },
    ],
    mirefen_marsh: [
      { itemId: 'raw_marsh_pike', weight: 42 },
      { itemId: 'raw_bog_eel', weight: 32 },
      { itemId: 'soggy_boot', weight: 6 },
      { itemId: 'tangled_weed', weight: 7 },
      { itemId: 'glimmerfin_koi', weight: 3 },
      { itemId: null, weight: 10 },
    ],
    thornpeak_heights: [
      { itemId: 'raw_frostgill_trout', weight: 27 },
      { itemId: 'raw_stonescale_carp', weight: 20 },
      { itemId: 'tangled_weed', weight: 15 },
      { itemId: 'glimmerfin_koi', weight: 3 },
      { itemId: null, weight: 35 },
    ],
  },
  // Band 2 (proficiency 200, fishing's cap): Thornpeak's own band, and the
  // only place every zone fishes at or above what it asks. Cooking catches
  // dominate, an empty hook is rare but never impossible, and the koi finally
  // pays out at the rate its recipes are priced against.
  {
    eastbrook_vale: [
      { itemId: 'raw_mirror_trout', weight: 50 },
      { itemId: 'raw_river_perch', weight: 34 },
      { itemId: 'tangled_weed', weight: 4 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: null, weight: 6 },
    ],
    mirefen_marsh: [
      { itemId: 'raw_marsh_pike', weight: 43 },
      { itemId: 'raw_bog_eel', weight: 34 },
      { itemId: 'soggy_boot', weight: 4 },
      { itemId: 'tangled_weed', weight: 5 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: null, weight: 8 },
    ],
    thornpeak_heights: [
      { itemId: 'raw_frostgill_trout', weight: 44 },
      { itemId: 'raw_stonescale_carp', weight: 34 },
      { itemId: 'tangled_weed', weight: 6 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: null, weight: 10 },
    ],
  },
];

// The band-0 tables, kept under the original export name so existing
// consumers (the deeds zone-key guard in tests/deeds_content.test.ts) resolve
// unchanged. The SAME object as FISHING_TABLES_BY_BAND[0], never a copy.
export const FISHING_TABLES: Record<string, FishingEntry[]> = FISHING_TABLES_BY_BAND[0];

// The rare catch worth a celebratory shout in the combat log.
export const FISHING_RARE_ID = 'glimmerfin_koi';

// Every raw fishing catch that is a cooking (and rod-ladder) reagent, never
// edible. Pure id set for useItem refuse, material/UI reuse (Phase 2 labels
// and icons), and tests that must not detect catches via kind === 'food'.
// Locked ids: docs/raw-fish-cooking-reagents/state.md.
export const RAW_COOKING_CATCH_IDS: ReadonlySet<string> = new Set([
  'raw_mirror_trout',
  'raw_river_perch',
  'raw_marsh_pike',
  'raw_bog_eel',
  'raw_frostgill_trout',
  'raw_stonescale_carp',
  'glimmerfin_koi',
]);

/** True when `itemId` is a raw fishing catch (cooking reagent, refuse-use). */
export function isRawCookingCatch(itemId: string): boolean {
  return RAW_COOKING_CATCH_IDS.has(itemId);
}
