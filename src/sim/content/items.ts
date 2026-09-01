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
    name: 'Ignition Key: Dreadspark Groundshaker',
    kind: 'mount',
    mount: 'terrorspark_groundshaker',
    quality: 'epic',
    soulbound: true,
    noDiscard: true,
    sellValue: 0,
  },
  // Developer-only, same treatment as the tank above: no acquisition path, so
  // it stays soulbound rather than tradable. Use /dev give reins_rickshaw_mount
  // while the feature remains under development.
  reins_rickshaw_mount: {
    id: 'reins_rickshaw_mount',
    name: 'Bound Reins: Bonebound Rickshaw',
    kind: 'mount',
    mount: 'rickshaw_mount',
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
  // quality: common bags are vendor goods, uncommon drop from beasts, rare
  // and epic come from dungeon bosses and world drops, and the materials-only
  // satchels (materialsOnly: true, feeding the second pool; see their own
  // section below) run a parallel ladder. Two deliberate tiering calls, not
  // drift: the 16-slot rare wayfarers_backpack out-slots the 14-slot epic
  // mistcallers_duffel, the classic-era rare-large-bag shape, kept
  // intentionally alongside the epic; and sellValue follows QUALITY tier,
  // not slot count, so the epic duffel vendors above the larger rare, also
  // intentional. See src/sim/bags.ts for the capacity rules. ---
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
  // The one rare world-drop bag, and the joint-largest general bag at 16 slots
  // (the crafted Resonantweave Bag is the deterministic route to the same
  // ceiling). Drop-only, so no buyValue and no market seed row: it stays
  // player-listed the way every other drop does.
  wayfarers_backpack: {
    id: 'wayfarers_backpack',
    name: "Wayfarer's Backpack",
    kind: 'bag',
    quality: 'rare',
    bagSlots: 16,
    sellValue: 3800,
  },
  // --- materials-only satchels (materialsOnly: true). Their bagSlots feed the
  // second, materials-only pool instead of the general one, so the capacity
  // they add is usable only by items in the derived material taxonomy. The
  // trade is the point: more total room, but the extra room is specialized.
  // See src/sim/bag_pools.ts for the pool arithmetic. ---
  // The entry rung, and the only materials satchel a vendor stocks. Priced
  // under the general 8-slot Traveler's Knapsack (2000) because it carries
  // strictly less: same slot count, restricted contents.
  burlap_reagent_pouch: {
    id: 'burlap_reagent_pouch',
    name: 'Burlap Reagent Pouch',
    kind: 'bag',
    quality: 'common',
    bagSlots: 8,
    materialsOnly: true,
    sellValue: 250,
    buyValue: 1000,
  },
  // The dungeon rung: Grand Necromancer Velkhar's hoard in the Gravewyrm
  // Sanctum. Same drop shape as the Gravewoven Bag on Morthen.
  necromancers_reagent_satchel: {
    id: 'necromancers_reagent_satchel',
    name: "Necromancer's Reagent Satchel",
    kind: 'bag',
    quality: 'rare',
    bagSlots: 20,
    materialsOnly: true,
    sellValue: 4200,
  },
  // --- food & drink (vendor, fished, conjured; see also zone2.ts/zone3.ts and
  // profession_items.ts for the higher zone-bracket and crafted-cooking tiers).
  // #1608: eating now STACKS with natural hp regen instead of replacing it
  // (combat/auras.ts updateRegen), matching how drinking already stacks with
  // mana regen, so every tier below is worth sitting down for at any stamina:
  // there is no longer a crossover stamina past which it loses to standing
  // still. The vendor food line after 11n sits each rung the crafted margin
  // below its cooking counterpart (10/15/20 percent by tercile, 11n-D-13):
  // bread 61, venison 81, boar 106 here, continuing to rye 220 and eel 375 in
  // zone2 and hardtack 480 and goat 816 in zone3, and the stacking fix is what
  // makes every rung of it worth the bag slot.
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
  // those three among the land tools (garden_hoe, the farming rung-one tool
  // below, joined them at the farming go-live for the same reason: q_farm_intro
  // hands it over through requiredItems). The gather quests hand a pick or a
  // sickle over through requiredItems (zone1.ts), re-granting a missing one
  // on accept, and q_prof_hobby_switch is repeatable, so the grant needs both
  // flags:
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
  // WHAT THE TOP RUNGS BUY, REWRITTEN AT masterwrought Phase 11i because the
  // paragraph here had become false. It used to say the top two rungs buy no
  // new catch band, and that was the measured defect the phase existed to fix:
  // there were three bands and tier 3 already reached the last one, so both
  // crafted rods opened nothing in the catch table. The ladder is SIX bands now
  // (professions/fishing_bands.ts), riding the same band-b-takes-tier-b-plus-1
  // gate, so every rung above tier 1 opens a band of its own: stormreel band 3,
  // tidewrought band 4, clockreel band 5.
  //
  // They still buy no new ZONE (there are three zones and tier 3 already opens
  // the deepest), and they still buy the minigame itself, a shorter worst-case
  // wait and a wider reel window. Tier 5 sits flat on the bite-delay floor,
  // which is the ladder ending rather than a rounding error, and tier 6 sits on
  // that same floor: the clockreel's gain over the tidewrought is the band and
  // the reel window, never the wait.
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
  // The apex rung (masterwrought Phase 11i): the tier-6 rod that opens catch
  // band 5, the only band a proficiency-200 angler cannot reach without it.
  //
  // MARKET-LISTABLE, AND THAT IS A RULING RATHER THAN A DEFAULT (R18). This rod
  // is the gate on band 5, so binding it would make having TAKEN engineering a
  // precondition for a FISHING band. It stays a plain tradable tool with no
  // soulbound and no noMarketList flag, exactly like the four rods above, so an
  // angler who never touched engineering reaches band 5 by buying one.
  //
  // EPIC, NOT LEGENDARY, and the reason is mechanical: rod rarity feeds
  // FISH_REEL_WINDOW_RARITY_BONUS_SEC at a quarter second per rung, so a
  // legendary rung would be a silent throughput change and would widen the
  // worst legal session against FISHING_SESSION_CAP_SEC. Epic also keeps the
  // rung inside the shipped apex-tool rarity line.
  //
  // sellValue 375 is the rod ladder's own step, not a new number: 10, 25, 60,
  // 150 climbs by about 2.5x a rung (2.5, 2.4, 2.5), and 150 x 2.5 is 375,
  // which lands this rung beside the packet's other apex tools at 380.
  clockreel_fishing_rod: {
    id: 'clockreel_fishing_rod',
    name: 'Clockreel Fishing Rod',
    kind: 'tool',
    quality: 'epic',
    use: { type: 'gatherTool', professionId: 'fishing', tier: 6 },
    sellValue: 375,
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
  // Farming's tier-1 crop, the minimal end-to-end slice (the growth-engine
  // phase): one seed, its produce, the fine twin a skill-scaled harvest roll
  // upgrades a pick into, and the withered husks a failed crop pays out.
  //
  // VALUES ARE PROVISIONAL and flagged for the maintainer. The crop-ladder
  // phase authors the other seven crops against this row's pricing and may
  // re-tune it; the farm dishes are priced against what this produce cooks
  // into.
  //
  // CONSUMERS ARE ALL LIVE NOW: husks feed convert_husks, and vale_wheat is
  // the grain of recipe_vale_hearth_loaf, the thickener in
  // recipe_eastbrook_root_pottage, and the crust of
  // recipe_evergarden_sunmelon_tart (the deferral this block used to carry
  // closed in the economy-hooks phase). Everything here stays
  // market-listable and vendor-sellable on top.
  //
  // Husks carry NO buyValue on purpose: a vendor row without one renders and
  // then refuses, and they are not meant to be vendor-obtainable. Tier 1 and
  // 2 seeds carry a positive buyValue per the locked pricing table and sit
  // on the farmer NPCs' counters (the go-live: farmer_jessica and
  // farmer_teasel, where their tier is farmed). Tier 3 and 4 seeds ALSO carry
  // one now: GATE 1 (Phase 11e, masterwrought DECISION D) stocked all eight at
  // farmer_hollis and farmer_verbena at the bootstrap rung, sell x 4 x 2, so
  // 32 at tier 3 and 64 at tier 4. This comment previously said they were
  // "deliberately never vendor-obtainable (seed-back and market supply only)",
  // which was the pre-GATE-1 contract and is exactly the dormancy that left
  // three recipes uncompletable and two deeds unearnable.
  // Produce follows the node materials' convention exactly (kind junk so it
  // browses under the market's material filter, common quality so
  // sellAllJunk never vendors it).
  //
  // vale_wheat_seed ALONE carries noVendorSell and noMarketList: q_farm_intro
  // (zone1.ts) hands one over through requiredItems and re-grants a missing
  // one on every giver talk while the quest is active, so like the
  // quest-granted tier-1 tools the grant needs the copper mint (sell for 1,
  // talk, sell again) and the market/mail route closed (the requiredItems
  // fence in tests/professions_starter_tools.test.ts). Its value is spent by
  // sowing it, which is the only thing the grant is for; the other seeds are
  // bought or grown, never granted, and stay sellable and listable.
  vale_wheat_seed: {
    id: 'vale_wheat_seed',
    name: 'Vale Wheat Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 1,
    buyValue: 4,
    noVendorSell: true,
    noMarketList: true,
  },
  vale_wheat: {
    id: 'vale_wheat',
    name: 'Vale Wheat',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
  },
  // The fine twin, priced on the fine-material convention below: twice the
  // base sellValue, with the 4x buyValue economy basis on top. It is NOT a
  // MATERIAL_GRADES row (that table is the nine node yields and its suites pin
  // it to exactly those); farming mints this through its own harvest roll.
  // Farming fine twins get NO downward grade substitution: materialGradeIds
  // walks MATERIAL_GRADES only, so a recipe asking for base produce (the farm
  // dishes included) is NOT satisfied by the fine twin. Consumed by
  // recipe_bronze_hoe, the tier-1 slot of the hoe ladder.
  fine_vale_wheat: {
    id: 'fine_vale_wheat',
    name: 'Fine Vale Wheat',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
    buyValue: 32,
  },
  // The failure payout: a crop that loses its survival roll pays these instead
  // of produce, so a failed plot is a smaller reward rather than a punishment
  // (the anti-chore thesis). The knobs phase turns them into the next
  // attempt's insurance.
  withered_husks: {
    id: 'withered_husks',
    name: 'Withered Husks',
    kind: 'junk',
    quality: 'common',
    sellValue: 1,
  },
  // The two plant-time knob supplies (the knobs phase, D6/D7/D9). Both are
  // PLAIN ITEMS CONSUMED BY COMMAND, deliberately without an ItemDef.use arm:
  // the plant_crop payload names which knobs to apply and the sim consumes
  // them from bags at plant time (compost and the tonic), and convert_husks
  // consumes husks to mint compost. Wiring either through the use path would
  // invent a second consumption route the command already owns.
  //
  // VALUES ARE PROVISIONAL and flagged for the maintainer. Compost carries a
  // vendor buyValue per D9 (priced when the item landed; the farmer NPCs in
  // all four zones stock it today, see their vendorItems arrays) at the
  // four-times-sell convention, and
  // sits at twice a husk's value so the husk conversion (2 husks to 1
  // compost) is value-neutral at the vendor. The growth tonic is NEVER
  // vendor-stocked: its one faucet is recipe_growth_tonic, brewed by an
  // ALCHEMIST out of wild Sheenleaf (D7, the cross-profession trade), so it
  // carries sellValue only. A buyValue here would be the dead-row trap's
  // opposite, a price for a faucet that must not exist.
  compost: {
    id: 'compost',
    name: 'Compost',
    kind: 'junk',
    quality: 'common',
    sellValue: 2,
    buyValue: 8,
  },
  growth_tonic: {
    id: 'growth_tonic',
    name: 'Growth Tonic',
    kind: 'junk',
    quality: 'common',
    sellValue: 6,
  },
  // The crop-ladder phase's seven remaining crops (ids locked by D11), in
  // tier order, each the same three-row family as vale_wheat above: seed,
  // produce, fine twin. VALUES ARE PROVISIONAL and flagged for the
  // maintainer, following the locked pricing table.
  //
  // Vendor status follows the vale_wheat block's model: tier 1 and 2 seeds
  // carry their buyValue and sit on the farmer NPCs' counters (the go-live:
  // farmer_jessica and farmer_teasel, where their tier is farmed), tier 3
  // and 4 seeds carry none (supply is drop and market side by design), and
  // produce carries none, with ONE exception: brook_carrot, the D9 starter
  // fee vegetable, is vendor-priced so the watch-fee loop can be paid from
  // vendor stock before a first harvest lands. Every fine twin's buyValue
  // is the ECONOMY BASIS for the recipe_economy counterfactual, never a
  // stock row, the fine-material convention below; no NPC stocks any fine
  // twin. The no-downward-substitution rule on the fine_vale_wheat comment
  // above covers every fine twin in this block too.
  //
  // CONSUMERS (the wolf_fang rule), and the loop is CLOSED as of the
  // economy-hooks phase: every row here has a live consumer today, through
  // commands (plant_crop spends every seed, the watch fee sinks produce) or
  // through recipes (the hoe ladder's HOE_RECIPES and the farm dishes in
  // FARM_RECIPES, both in content/recipes.ts). The per-row comments below name
  // each produce and fine twin's REAL consumers; nothing here is deferred.
  // The closure itself is pinned by the consumer-closure arm in
  // tests/professions_zone_rollout.test.ts, which sweeps every farming
  // material against the merged ALL_RECIPES reagent set plus the command
  // sinks, so a row that loses its last consumer reds there.
  brook_carrot_seed: {
    id: 'brook_carrot_seed',
    name: 'Brook Carrot Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 1,
    buyValue: 4,
  },
  // The D9 fee vegetable, the one produce row with a buyValue: priced at the
  // 4x-sell convention so the watch fee is payable from vendor stock before
  // a player's first harvest. Consumed by the watch fee AND by
  // recipe_eastbrook_root_pottage, which takes it as the pottage's body.
  // NOT AN EXHAUSTIVE CONSUMER LIST, and deliberately not one: the live set
  // is derived (craftIdsForMaterialItem sweeps ALL_RECIPES, and the tooltip
  // renders from that), so an enumeration here only records what was true the
  // day it was written. masterwrought Phase 11g is the proof: it put this crop
  // on shipped cooking and alchemy ladder rows and every one of these comments
  // silently became a subset. Read the sweep, not the sentence.
  brook_carrot: {
    id: 'brook_carrot',
    name: 'Brook Carrot',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
    buyValue: 16,
  },
  // The fine cooking-grade twin the skill-scaled harvest roll upgrades a pick
  // into. Consumed by recipe_eastbrook_root_pottage, which takes one whole for
  // its sweetness: the dish set's tier-1 fine-twin slot. Not a hoe reagent:
  // the shipped HOE_RECIPES draft ONE fine twin per tier from tiers 1 to 3
  // (each rung consumes the twin one tier below it, deviation (ad)), and the
  // tier-1 slot went to fine_vale_wheat.
  fine_brook_carrot: {
    id: 'fine_brook_carrot',
    name: 'Fine Brook Carrot',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
    buyValue: 32,
  },
  marsh_rice_seed: {
    id: 'marsh_rice_seed',
    name: 'Marsh Rice Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 2,
    buyValue: 8,
  },
  // Watch-fee sink plus vendor sell, and the bulk of
  // recipe_fenbridge_rice_bowl (4 per bowl, the heaviest single-reagent count
  // in the dish set). No buyValue (the brook_carrot D9 exception does not
  // apply here).
  // NOT AN EXHAUSTIVE CONSUMER LIST, and deliberately not one: the live set
  // is derived (craftIdsForMaterialItem sweeps ALL_RECIPES, and the tooltip
  // renders from that), so an enumeration here only records what was true the
  // day it was written. masterwrought Phase 11g is the proof: it put this crop
  // on shipped cooking and alchemy ladder rows and every one of these comments
  // silently became a subset. Read the sweep, not the sentence.
  marsh_rice: {
    id: 'marsh_rice',
    name: 'Marsh Rice',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
  },
  // A hoe reagent, and ONLY that: recipe_skysilver_hoe consumes it (the rung
  // one tier above its crop, deviation (ad); pinned in
  // tests/professions_hoe_recipes.test.ts). It gained NO dish in the
  // economy-hooks phase, deliberately: the eight dishes took the five twins
  // the hoe ladder had left unconsumed, and this one was already accounted.
  fine_marsh_rice: {
    id: 'fine_marsh_rice',
    name: 'Fine Marsh Rice',
    kind: 'junk',
    quality: 'common',
    sellValue: 16,
    buyValue: 64,
  },
  bog_beet_seed: {
    id: 'bog_beet_seed',
    name: 'Bog Beet Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 2,
    buyValue: 8,
  },
  // Watch-fee sink, and the base of recipe_fenbridge_beet_braise (3 braised
  // down per plate). No buyValue per the produce rule.
  // NOT AN EXHAUSTIVE CONSUMER LIST, and deliberately not one: the live set
  // is derived (craftIdsForMaterialItem sweeps ALL_RECIPES, and the tooltip
  // renders from that), so an enumeration here only records what was true the
  // day it was written. masterwrought Phase 11g is the proof: it put this crop
  // on shipped cooking and alchemy ladder rows and every one of these comments
  // silently became a subset. Read the sweep, not the sentence.
  bog_beet: {
    id: 'bog_beet',
    name: 'Bog Beet',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
  },
  // Consumed by recipe_fenbridge_beet_braise, which takes one whole for the
  // colour: the dish set's tier-2 fine-twin slot. Not a hoe reagent: the hoe
  // ladder's tier-2 slot went to its sibling fine_marsh_rice.
  fine_bog_beet: {
    id: 'fine_bog_beet',
    name: 'Fine Bog Beet',
    kind: 'junk',
    quality: 'common',
    sellValue: 16,
    buyValue: 64,
  },
  highland_barley_seed: {
    id: 'highland_barley_seed',
    name: 'Highland Barley Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
    buyValue: 32,
  },
  // Watch-fee sink, and the grain of recipe_highwatch_barley_bannock, where the
  // base tier-3 grain carries a demand of its own at 4 per bannock. It used to
  // be the one dish with no fine twin in it; Phase 11e added the cabbage pair
  // alongside, which changed the bill but not this row's 4.
  // NOT AN EXHAUSTIVE CONSUMER LIST, and deliberately not one: the live set
  // is derived (craftIdsForMaterialItem sweeps ALL_RECIPES, and the tooltip
  // renders from that), so an enumeration here only records what was true the
  // day it was written. masterwrought Phase 11g is the proof: it put this crop
  // on shipped cooking and alchemy ladder rows and every one of these comments
  // silently became a subset. Read the sweep, not the sentence. Phase 11h then
  // took it to SEVEN consuming recipes, level with vale_wheat and ahead of every
  // other crop: the physical role plate at cooking 100 takes 2, and all three
  // apex flasks take 1 each, which is what gives the grain an alchemy consumer
  // for the first time. (The line read "the busiest crop on the roster" until
  // the Phase 11h QA counted them and found a tie rather than a lead.)
  highland_barley: {
    id: 'highland_barley',
    name: 'Highland Barley',
    kind: 'junk',
    quality: 'common',
    sellValue: 15,
  },
  // A hoe reagent, and ONLY that: recipe_osmium_hoe consumes it (deviation
  // (ad); pinned in tests/professions_hoe_recipes.test.ts). Like
  // fine_marsh_rice it gained NO dish in the economy-hooks phase, for the
  // same reason: the dishes closed the twins the hoe ladder had left over.
  fine_highland_barley: {
    id: 'fine_highland_barley',
    name: 'Fine Highland Barley',
    kind: 'junk',
    quality: 'common',
    sellValue: 30,
    buyValue: 120,
  },
  frost_gourd_seed: {
    id: 'frost_gourd_seed',
    name: 'Frost Gourd Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
    buyValue: 32,
  },
  // Watch-fee sink, and the body of recipe_highwatch_gourd_soup (3 simmered
  // down per pot).
  // NOT AN EXHAUSTIVE CONSUMER LIST, and deliberately not one: the live set
  // is derived (craftIdsForMaterialItem sweeps ALL_RECIPES, and the tooltip
  // renders from that), so an enumeration here only records what was true the
  // day it was written. masterwrought Phase 11g is the proof: it put this crop
  // on shipped cooking and alchemy ladder rows and every one of these comments
  // silently became a subset. Read the sweep, not the sentence. Phase 11h made
  // it the TANK plate's accent: recipe_stonepot_stew at cooking 100 takes 2.
  // (Added at the Phase 11h QA. Six of the seven ids that phase put on a new
  // bill carried this note already; the gourd alone was left without one.)
  frost_gourd: {
    id: 'frost_gourd',
    name: 'Frost Gourd',
    kind: 'junk',
    quality: 'common',
    sellValue: 15,
  },
  // Consumed by recipe_highwatch_gourd_soup, which takes one for the
  // sweetness the base gourds lack: the dish set's tier-3 fine-twin slot. Not
  // a hoe reagent: the hoe ladder's tier-3 slot went to its sibling
  // fine_highland_barley.
  fine_frost_gourd: {
    id: 'fine_frost_gourd',
    name: 'Fine Frost Gourd',
    kind: 'junk',
    quality: 'common',
    sellValue: 30,
    buyValue: 120,
  },
  // The two crops Phase 11e added to tier 3, taking the tier from two crops to
  // four so a farmer living in the 50-to-75 band has real variety. NO new price
  // point: every row below takes the value its tier already uses (seed 4,
  // produce 15, fine twin exactly twice the base at 30, and the fine twin's
  // buyValue the same four-times-sell staple its siblings carry).
  //
  // The seed buyValue is the go-live faucet (masterwrought DECISION D): 32 is
  // the shipped four-times-sell convention on sellValue 4, doubled as a
  // bootstrap premium, because the vendor is the bootstrap and not the
  // steady-state supply. A tier-3 harvest expects only 0.48 seeds back, so an
  // at-convention 16 would make the counter the cheaper permanent source and
  // kill the seed-back loop the thrift path exists for.
  thornpeak_cabbage_seed: {
    id: 'thornpeak_cabbage_seed',
    name: 'Thornpeak Cabbage Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
    buyValue: 32,
  },
  // Watch-fee sink, and the leaf folded into recipe_highwatch_barley_bannock
  // (2 per bannock), which is what gives the tier's LEAF a demand of its own.
  // NOT AN EXHAUSTIVE CONSUMER LIST, and deliberately not one: the live set
  // is derived (craftIdsForMaterialItem sweeps ALL_RECIPES, and the tooltip
  // renders from that), so an enumeration here only records what was true the
  // day it was written. masterwrought Phase 11h is the proof: it made this
  // crop the caster plate's accent in recipe_sageleaf_chowder at cooking 100.
  // Read the sweep, not the sentence.
  thornpeak_cabbage: {
    id: 'thornpeak_cabbage',
    name: 'Thornpeak Cabbage',
    kind: 'junk',
    quality: 'common',
    sellValue: 15,
  },
  // Consumed by recipe_highwatch_barley_bannock, the dish that until Phase 11e
  // was the one rung-50 plate with no fine twin in it. Not a hoe reagent: the
  // tier-3 hoe slot belongs to fine_highland_barley (deviation (ad)).
  fine_thornpeak_cabbage: {
    id: 'fine_thornpeak_cabbage',
    name: 'Fine Thornpeak Cabbage',
    kind: 'junk',
    quality: 'common',
    sellValue: 30,
    buyValue: 120,
  },
  frost_lentils_seed: {
    id: 'frost_lentils_seed',
    name: 'Frost Lentils Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 4,
    buyValue: 32,
  },
  // Watch-fee sink, and the pulse simmered into recipe_highwatch_gourd_soup
  // (2 per pot) to give the tier's LEGUME its own buyer.
  frost_lentils: {
    id: 'frost_lentils',
    name: 'Frost Lentils',
    kind: 'junk',
    quality: 'common',
    sellValue: 15,
  },
  // Consumed by recipe_highwatch_gourd_soup alongside the fine gourd already
  // in that bill. Not a hoe reagent, same reason as its cabbage sibling.
  fine_frost_lentils: {
    id: 'fine_frost_lentils',
    name: 'Fine Frost Lentils',
    kind: 'junk',
    quality: 'common',
    sellValue: 30,
    buyValue: 120,
  },
  gilded_sunmelon_seed: {
    id: 'gilded_sunmelon_seed',
    name: 'Gilded Sunmelon Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
    buyValue: 64,
  },
  // Watch-fee sink, and the fruit of recipe_evergarden_sunmelon_tart, the
  // tier-4 dish line (3 per tart). masterwrought Phase 11h added its FIRST
  // consumer outside farming: recipe_grand_cauldron, alchemy's skill-125
  // capstone, takes 2. (That is the claim worth making. This line read "the
  // second consumer" until the Phase 11h QA counted them: the tart and
  // recipe_harvest_feast both already took the melon, so the cauldron is its
  // THIRD consumer and only the outside-farming half is a first.)
  // NOT AN EXHAUSTIVE CONSUMER LIST; the live set
  // is derived through craftIdsForMaterialItem and the tooltip renders from
  // that, so read the sweep rather than this sentence.
  gilded_sunmelon: {
    id: 'gilded_sunmelon',
    name: 'Gilded Sunmelon',
    kind: 'junk',
    quality: 'common',
    sellValue: 40,
  },
  // The dish set's tier-4 fine-twin slot (recipe_evergarden_sunmelon_tart), and
  // since masterwrought Phase 11h ALSO the alchemy capstone's showcase reagent:
  // recipe_grand_cauldron at skillReq 125 takes one, which is this twin's first
  // consumer outside farming and the top rung of the CONSUMABLE catalog.
  // (Scoped at the Phase 11h QA. 125 is where cooking and alchemy top out;
  // the table itself topped out at 150 at that scoping's runtime, the apex
  // gathering-tool family that is Phase 11j's, so "the whole catalog" was
  // wrong by three rows; masterwrought Phase 11o later re-tiered those three
  // to 125, the reachable cap; AMENDED 2026-08-31, masterwrought qr-11o-150.)
  //
  // CORRECTED BY masterwrought Phase 11h (11h-GATE-D, packet row N15), which
  // owns this correction because it runs before 11j and 11k. The line below is
  // still TRUE and is kept, but it used to be the whole story here and a reader
  // took "structurally never a reagent above the dish set" out of it: it scopes
  // to the HOE ladder only. A tier-4 twin can be any other kind of reagent, and
  // now is one.
  // NOT A HOE REAGENT, and masterwrought Phase 11j re-reasoned this rather than
  // re-asserting it: the ladder no longer tops at 4, so "there is no tier-5
  // hoe" has stopped being the reason. The reason now is that the tier-5 rung
  // takes exactly ONE tier-4 twin and it takes fine_evergarden_greens, which
  // the hoe's own name follows. All four tier-4 twins satisfy the ladder's
  // one-tier-below invariant equally, so the name is what PICKED between them
  // rather than a rule that forced the pick (narrowed at the masterwrought
  // Phase 11j QA: two of the four shipped tier-5 tools are not named for a
  // fine reagent at all). This twin stays a dish reagent, which it already was.
  fine_gilded_sunmelon: {
    id: 'fine_gilded_sunmelon',
    name: 'Fine Gilded Sunmelon',
    kind: 'junk',
    quality: 'common',
    sellValue: 80,
    buyValue: 320,
  },
  evergarden_greens_seed: {
    id: 'evergarden_greens_seed',
    name: 'Evergarden Greens Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
    buyValue: 64,
  },
  // Watch-fee sink, and the greens dressed into
  // recipe_evergarden_harvest_platter, the capstone plate of the dish set
  // (3 per platter). masterwrought Phase 11h added its FIRST consumer outside
  // farming: recipe_laden_hearth, cooking's skill-125 capstone, takes 2. (This
  // line read "the second consumer" until the Phase 11h QA counted them: the
  // platter, recipe_evergarden_braised_greens and recipe_harvest_feast all
  // already took the greens, so the hearth is its FOURTH consumer and only the
  // outside-farming half is a first.)
  // NOT AN EXHAUSTIVE CONSUMER LIST; the live set is derived through
  // craftIdsForMaterialItem and the tooltip renders from that, so read the
  // sweep rather than this sentence.
  evergarden_greens: {
    id: 'evergarden_greens',
    name: 'Evergarden Greens',
    kind: 'junk',
    quality: 'common',
    sellValue: 40,
  },
  // The last of the five fine-twin dish slots, the one that closed the
  // crop-ladder phase's deferral (recipe_evergarden_harvest_platter), and since
  // masterwrought Phase 11h ALSO the cooking capstone's showcase reagent:
  // recipe_laden_hearth at skillReq 125 takes one, this twin's first consumer
  // outside farming and the top rung of the CONSUMABLE catalog
  // (125 is cooking and alchemy's ceiling, and since masterwrought Phase 11o
  // the whole table's: the three engineering rows that shipped at 150 were
  // re-tiered to the cap; AMENDED 2026-08-31, masterwrought qr-11o-150.
  // Scoped at the Phase 11h QA).
  //
  // CORRECTED BY masterwrought Phase 11h (11h-GATE-D, packet row N15), same as
  // its sunmelon sibling above and for the same reason: the line below is true
  // and kept, but it scopes to the HOE ladder alone and was being read as a
  // claim that a tier-4 twin can never be a reagent at all.
  // AND THE HOE LINE IS NOW FALSE OF THIS TWIN, corrected by masterwrought
  // Phase 11j, which is the rung that falsified it. 11h's scope correction
  // above still stands and is untouched; what changed is the premise under it.
  // The ladder no longer tops at 4, and deviation (ad)'s one-tier-below
  // invariant therefore points the tier-5 rung straight at a tier-4 twin: THIS
  // twin is recipe_evergarden_hoe's gathered reagent, at count 2. The tool is
  // named for it (Evergarden Hoe from Fine Evergarden Greens), which is what
  // chose this twin over the other three the invariant admits, on the pattern
  // the Highpine Axe and the Sunpetal Sickle set. It is a convention rather
  // than a rule: the Glyphsteel Mining Pick is named for its bar and the
  // Tidewrought Fishing Rod takes no fine grade at all.
  fine_evergarden_greens: {
    id: 'fine_evergarden_greens',
    name: 'Fine Evergarden Greens',
    kind: 'junk',
    quality: 'common',
    sellValue: 80,
    buyValue: 320,
  },
  // The two crops Phase 11e added to tier 4, the same widening the tier-3 block
  // above got and for the same reason. NO new price point: seed 8, produce 40,
  // fine twin 80 with the four-times-sell buyValue of 320, every one of them a
  // value this tier already uses.
  //
  // The seed buyValue is masterwrought DECISION D's tier-4 rung: 8 x 4 is the
  // shipped convention's 32, doubled to 64 as the bootstrap premium. The
  // premium is measured, not felt: a tier-4 harvest expects only 0.41 seeds
  // back, the thinnest return on the ladder, so the counter must stay the
  // expensive way in.
  gilded_yam_seed: {
    id: 'gilded_yam_seed',
    name: 'Gilded Yam Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
    buyValue: 64,
  },
  // Watch-fee sink, and the root roasted under recipe_evergarden_sunmelon_tart
  // (2 per tart), which gives the tier's TUBER a buyer of its own.
  gilded_yam: {
    id: 'gilded_yam',
    name: 'Gilded Yam',
    kind: 'junk',
    quality: 'common',
    sellValue: 40,
  },
  // Consumed by recipe_evergarden_sunmelon_tart beside the fine sunmelon
  // already in that bill. Not a hoe reagent: masterwrought Phase 11j shipped
  // the tier-5 rung, so the old reason (no tier-5 hoe exists) is retired, and
  // the live one is that the apex rung consumes a single tier-4 twin, the
  // greens it is named for.
  fine_gilded_yam: {
    id: 'fine_gilded_yam',
    name: 'Fine Gilded Yam',
    kind: 'junk',
    quality: 'common',
    sellValue: 80,
    buyValue: 320,
  },
  evergarden_pumpkin_seed: {
    id: 'evergarden_pumpkin_seed',
    name: 'Evergarden Pumpkin Seed',
    kind: 'junk',
    quality: 'common',
    sellValue: 8,
    buyValue: 64,
  },
  // Watch-fee sink, and the gourd cut onto
  // recipe_evergarden_harvest_platter (2 per platter), the tier's second
  // GOURD-class crop and the capstone plate's new body.
  evergarden_pumpkin: {
    id: 'evergarden_pumpkin',
    name: 'Evergarden Pumpkin',
    kind: 'junk',
    quality: 'common',
    sellValue: 40,
  },
  // Consumed by recipe_evergarden_harvest_platter beside the fine greens
  // already in that bill. Not a hoe reagent, on the same re-reasoned ground as
  // the fine yam above: the tier-5 rung exists now and takes the greens.
  fine_evergarden_pumpkin: {
    id: 'fine_evergarden_pumpkin',
    name: 'Fine Evergarden Pumpkin',
    kind: 'junk',
    quality: 'common',
    sellValue: 80,
    buyValue: 320,
  },
  // The farming hoe ladder (the crop-ladder phase's tool half): the fifth
  // gathering profession's gatherTool items, mirroring the pick/axe/sickle
  // shape exactly (kind tool, infinite durability, `use.tier` read by the
  // step-12 hoe gate in professions/farming.ts through the R22 wield-filtered
  // scan, so `use.tier` gates which CROP tiers may be planted).
  //
  // PRICES: garden_hoe joins the 20-copper tier-1 rung (the trivial one-time
  // purchase, pinned as a literal in tests/professions_tools.test.ts) and is
  // the ONLY vendor-priced rung: the 120/400 rungs deliberately gain NO
  // farming member, because rungs 2 to 4 are CRAFT-ONLY (HOE_RECIPES in
  // content/recipes.ts, engineering at the toolworks), so a non-engineer
  // farmer buys them from players via market or trade. osmium_hoe is
  // unpriced-for-buy AND craftable (the R23 shape), absent from every
  // vendorItems list and from HEROIC_VENDOR_STOCK like the tier-4/5 land
  // tools above.
  //
  // THE MARKS FLAG IS CLOSED (masterwrought Phase 11j, decision B). The line
  // here used to flag for the maintainer whether the Marks shop should gain a
  // hoe row as the non-crafter route; it now does, at BOTH rungs, beside the
  // land and rod siblings in content/delves/shop.ts (osmium_hoe 24 Marks on
  // clears:3, evergarden_hoe 56 on heroicClear). The counter already carried
  // all four tier-4 tools at 24 and all four tier-5 at 56, masterwrought R18
  // says nobody must have TAKEN a profession to get a thing, and leaving
  // farming half-in made it the only gathering profession with no non-crafter
  // route at the tier-4 rung. A hoe carries no combat power, so there is no
  // masterwrought R5 interaction to weigh, and five-and-five is a more
  // drift-resistant pin than four-and-five.
  //
  // garden_hoe carries BOTH noVendorSell and noMarketList since the farming
  // go-live: q_farm_intro (zone1.ts) hands it over through requiredItems,
  // re-granting a missing one on accept and on every giver talk, so like the
  // three quest-granted tier-1 tools (the banner above) the grant needs the
  // copper mint and the market/mail route closed (tests/
  // professions_starter_tools.test.ts sweeps every requiredItems quest for
  // exactly this fence). The crafted rungs below are never granted and stay
  // sellable and listable.
  garden_hoe: {
    id: 'garden_hoe',
    name: 'Garden Hoe',
    kind: 'tool',
    quality: 'common',
    use: { type: 'gatherTool', professionId: 'farming', tier: 1 },
    sellValue: 4,
    buyValue: 20,
    noVendorSell: true,
    noMarketList: true,
  },
  bronze_hoe: {
    id: 'bronze_hoe',
    name: 'Bronze Hoe',
    kind: 'tool',
    quality: 'common',
    use: { type: 'gatherTool', professionId: 'farming', tier: 2 },
    sellValue: 10,
  },
  skysilver_hoe: {
    id: 'skysilver_hoe',
    name: 'Skysilver Hoe',
    kind: 'tool',
    quality: 'uncommon',
    use: { type: 'gatherTool', professionId: 'farming', tier: 3 },
    sellValue: 25,
  },
  osmium_hoe: {
    id: 'osmium_hoe',
    name: 'Osmium Hoe',
    kind: 'tool',
    quality: 'rare',
    use: { type: 'gatherTool', professionId: 'farming', tier: 4 },
    sellValue: 60,
  },
  // The apex rung (masterwrought Phase 11j): farming was the only gathering
  // profession with no tier-5 base tool, so this is the fifth member of a
  // family whose other four already ship, not a new rung invented here. It
  // matches them exactly: epic, use.tier 5, sellValue 150, no buyValue, and
  // neither noVendorSell nor noMarketList (those two belong to the tier-1
  // quest-granted rung alone).
  //
  // WHAT IT ACTUALLY BUYS, stated plainly because a player will ask: no new
  // crop tier. Four crop tiers exist and the tier-4 hoe already reaches the
  // last one, so this rung opens no ground.
  //
  // THE ROD IS NOT THE ANALOGY, corrected at the masterwrought Phase 11j QA,
  // where an earlier draft of this comment said the tier-5 rod opens no catch
  // band the tier-4 rod does not. It does: professions/fishing_bands.ts
  // `fishingRodBandFor` runs band b off tool tier b + 1, so band 3 takes the
  // tier-4 stormreel and band 4 the tier-5 tidewrought. Fishing is the ONE
  // gathering profession whose apex rungs buy access, which is exactly why the
  // hoe cannot lean on it: the honest comparison is the three land apex tools,
  // whose deepest node tier is 3. What this rung buys is the EPIC rung on the
  // tool-effect economy.
  // professions/tools.ts startingDurabilityFor pays RARITY_DURABILITY_BONUS
  // more charges per rarity rung and ratchetCeilingForUse prices the refill
  // ceiling off the same rarity, so rare to epic is one rung on both, and a
  // farmer running the Maker's Charm was until now the only gatherer paying
  // it at the rare ceiling. That is the gap this closes: the charm is an
  // EFFECT slot and a base tool is a base tool, complements rather than
  // substitutes.
  //
  // IT NEEDS NO WIELD TABLE CHANGE. WIELD_REQUIREMENT_BY_TIER already carries
  // a tier-5 row at TIER5_TOOL_WIELD_PROFICIENCY (100) and it applies to every
  // land profession, fishing being the one structural exemption. Farming's cap
  // is 100, so this wields at the cap and nowhere below it, which is the same
  // knife edge the other three land apex tools already sit on.
  evergarden_hoe: {
    id: 'evergarden_hoe',
    name: 'Evergarden Hoe',
    kind: 'tool',
    quality: 'epic',
    use: { type: 'gatherTool', professionId: 'farming', tier: 5 },
    sellValue: 150,
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
  // The three HIGH-BAND catches (masterwrought Phase 11i). Like the koi they
  // read SKILL alone: each is present in every zone's cell for its band at the
  // same weight, so a recipe names one reagent id whatever water it came out
  // of. Unlike the koi they are not lucky finds but band rewards, which is why
  // they are common rather than uncommon: the koi's uncommon rung goes with
  // FISHING_RARE_ID (the celebratory shout) and its Reliquary profession hint,
  // and a catch with neither should not wear the colour.
  //
  // SELLVALUE IS DERIVED FROM THE SHIPPED RAW-CATCH CURVE, not chosen. That
  // curve is keyed to the water's zone tier: eastbrook (tier 1) pays 2 and 3,
  // mirefen (tier 2) pays 6 and 6, thornpeak (tier 3) pays 10 and 10, a step of
  // +4 per zone tier above the first. These three are keyed to the BAND
  // instead, and bands 3, 4 and 5 all sit above every zone, so the same +4 step
  // continues off thornpeak's 10: 14, 18, 22.
  //
  // THE KOI'S 75 IS DELIBERATELY NOT THE ANCHOR. It is priced as a lucky-hook
  // trophy and as the ROD ladder's reagent, not as a place on the food curve,
  // so anchoring a food reagent to it would import a trophy premium into every
  // dish these three feed.
  //
  // NO buyValue on any of them, which is load-bearing rather than an omission:
  // no counter stocks a catch, so none of the three can join the
  // counterfactually-vendor-fed set in tests/recipe_economy.test.ts and that
  // membership literal stays still (the same property the koi has).
  raw_deepbarb_catfish: {
    id: 'raw_deepbarb_catfish',
    name: 'Raw Deepbarb Catfish',
    kind: 'junk',
    quality: 'common',
    sellValue: 14,
  },
  raw_hollowgill_sturgeon: {
    id: 'raw_hollowgill_sturgeon',
    name: 'Raw Hollowgill Sturgeon',
    kind: 'junk',
    quality: 'common',
    sellValue: 18,
  },
  raw_stillmere_salmon: {
    id: 'raw_stillmere_salmon',
    name: 'Raw Stillmere Salmon',
    kind: 'junk',
    quality: 'common',
    sellValue: 22,
  },
  // Vendor food nerf (11n-D-13): crafted 117 tier (hunters_game_skewer,
  // herbed_marsh_pike, eastbrook_root_pottage) / 1.10, the bottom food
  // tercile's 10 percent margin, floored; crafted margin +10.4 percent.
  roasted_boar: {
    id: 'roasted_boar',
    name: 'Spitted Boar Haunch',
    kind: 'food',
    quality: 'common',
    foodHp: 106,
    sellValue: 12,
    buyValue: 100,
  },
  // --- combat potions (vendor): instant, usable in combat, 2-minute shared cooldown.
  // Restore less than sitting to eat/drink, the price you pay for not sitting (#103).
  //
  // Target fraction (#1608): each tier is sized against the LEAST tanky class for
  // its resource (priest for potionHp, paladin for potionMana on this line; see
  // tests/consumables.test.ts) at BASE stats (no gear) at the TOP level of its
  // intended zone bracket (ZONE1/2/3_ZONE.levelRange[1] in content/zone{1,2,3}.ts:
  // 7/13/20), the hardest point in the bracket for the tier to still feel worth
  // the cooldown. That lands potionHp around 72-90% and potionMana around 53-66%
  // of the reference pool: a real, meaningful topper-upper rather than a sliver,
  // with headroom against a geared character's larger pool (gear only grows the
  // pool from here, so a geared cast of the same level sees a SMALLER fraction
  // than the pinned floor, same as any flat-value consumable; the fix is that the
  // floor itself is now generous, not that it tracks gear). Every tier in this
  // ladder must stay BELOW the matching profession_items.ts alchemy draught (the
  // crafted line is a strict upgrade over the vendor equivalent): keep the two in
  // lockstep if either changes. Since the 11n vendor floor, this line sits the
  // margin ladder (10/15/20 percent by rung) below the crafted draughts, so the
  // crafted line is the generous fraction and the vendor line is the floor.
  // Both-sourced (also crafted by recipe), magnitude-exempt per 11n-BOTH /
  // qr-11n-NINE: a nerf would hit the crafted arm. The bottom hp rung's
  // +9.1 percent vs silverleaf_healing_draught 120 is recorded EXEMPT, not a
  // miss.
  minor_healing_potion: {
    id: 'minor_healing_potion',
    name: 'Minor Healing Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 110,
    sellValue: 8,
    buyValue: 40,
  },
  // Already clears the bottom rung's 10 percent margin vs
  // silverleaf_mana_draught 160 (+10.3 percent); no move (11n-D-13).
  minor_mana_potion: {
    id: 'minor_mana_potion',
    name: 'Minor Mana Potion',
    kind: 'potion',
    quality: 'common',
    potionMana: 145,
    sellValue: 8,
    buyValue: 40,
  },
  // --- battle elixir: a temporary stat buff on use (classic flask/elixir staple).
  // Drops from the Mirefen brutes; +Stamina helps anyone push deeper into the marsh.
  // Both-sourced (combo recipe), magnitude-exempt per 11n-BOTH; its
  // alchemist_verane stock row was pulled by 11n (see zone3.ts), the item, its
  // 0.8 percent Mirefen drop, its recipe and its buyValue all stay.
  elixir_of_the_bear: {
    id: 'elixir_of_the_bear',
    name: 'Elixir of the Bear',
    kind: 'elixir',
    quality: 'uncommon',
    elixir: {
      aura: 'Might of the Bear',
      kind: 'buff_sta',
      value: 12,
      duration: 900,
    },
    sellValue: 20,
    buyValue: 100,
  },
  // Higher tiers of the combat-potion ladder, keeping pace with the zone-2/3
  // level bands (classic Minor -> Lesser -> standard progression). Same instant,
  // in-combat, 2-minute-shared-cooldown rules as the Minor tier above.
  // Both-sourced since the 11l QA re-pick (recipe_lesser_healing_potion),
  // magnitude-exempt per qr-11n-NINE, exactly like minor_healing_potion above.
  lesser_healing_potion: {
    id: 'lesser_healing_potion',
    name: 'Lesser Healing Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 190,
    sellValue: 16,
    buyValue: 85,
  },
  // Vendor nerf (11n-D-13): computed as goldleaf_mana_draught 260 / 1.15 (the
  // lesser rung's 15 percent margin), floored; crafted margin +15.0 percent.
  lesser_mana_potion: {
    id: 'lesser_mana_potion',
    name: 'Lesser Mana Potion',
    kind: 'potion',
    quality: 'common',
    potionMana: 226,
    sellValue: 16,
    buyValue: 85,
  },
  // Vendor nerf (11n-D-13): sunpetal_healing_draught 335 / 1.20 (top rung,
  // 20 percent), floored; crafted margin +20.1 percent.
  healing_potion: {
    id: 'healing_potion',
    name: 'Healing Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 279,
    sellValue: 32,
    buyValue: 170,
  },
  // Vendor nerf (11n-D-13): sunpetal_mana_draught 425 / 1.20 (top rung,
  // 20 percent), floored; crafted margin +20.1 percent.
  mana_potion: {
    id: 'mana_potion',
    name: 'Mana Potion',
    kind: 'potion',
    quality: 'common',
    potionMana: 354,
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
  soul_stone: {
    id: 'soul_stone',
    name: 'Soul Stone',
    kind: 'potion',
    quality: 'uncommon',
    potionHpPctMax: 0.25,
    stackSize: 3,
    sellValue: 0,
    soulbound: true,
    noVendorSell: true,
    noMarketList: true,
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
  // Hub-tier caster pieces, one per craft, mirroring TOOL_RECIPES' osmium
  // tier. Budgeted at authoring (2026 pre-11o) against ITEM level 23 (the then
  // recipe level 20 + the rare QUALITY_ILVL_BONUS of 3, see item_budget.ts and
  // item_level.ts), matching the level-20 rares in the same slots
  // (boundstone_helm, gravewyrm_gauntlets, gravewyrm_mantle; pinned by
  // tests/item_level.test.ts): helmet 11, gloves 9, shoulder 10.
  // AMENDED 2026-08-25 (masterwrought Phase 11o, qr-11o-WEAR): the recipes now
  // carry level 17 (cowl, mantle) and 15 (wraps), so the derived item levels
  // read 20/20/18 and the gates 17/17/15, while these stats stay authored at
  // the original ilvl-23 budget. The over-budget is the point: crafted rares
  // top the 14-19 band tables instead of arriving pre-obsolete at 20.
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
    // Mogger (level 6) -> item level 7, worn-offhand budget 1. Hunters are the
    // one class no offhand rule admits (equipment_rules canDualWield excludes
    // them, and no shield or held offhand names them), so the slot sat empty and
    // its stat budget went uncollected. Held offhands equip by the literal
    // requiredClass alone, which is what lets a hunter-only list work here.
    // The opening rung's budget is a single point, so it is agility alone.
    occupiesHand: false,
    stats: { agi: 1 },
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
  amber_hide: {
    id: 'amber_hide',
    name: 'Amber Hide',
    kind: 'junk',
    quality: 'poor',
    sellValue: 9,
  },
  stag_antler: {
    id: 'stag_antler',
    name: 'Branching Antler',
    kind: 'junk',
    quality: 'poor',
    sellValue: 8,
  },
  // Vendor food nerf (11n-D-13): was ABOVE crafted pan_seared_perch 90 (a
  // negative margin); 90 / 1.10, bottom tercile, floored; crafted margin
  // +11.1 percent.
  brightwood_venison: {
    id: 'brightwood_venison',
    name: 'Brightwood Venison',
    kind: 'food',
    quality: 'common',
    foodHp: 81,
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
  // Reagent now (TROPHY_RECIPES, Masterwrought phase 11l), same convention as
  // wolf_fang above: common NOT poor so sellAllJunk never sweeps it; sellValue
  // unchanged.
  bandit_bandana: {
    id: 'bandit_bandana',
    name: 'Red Bandana',
    kind: 'junk',
    quality: 'common',
    sellValue: 6,
  },
  // Both-sourced, magnitude-exempt per 11n-BOTH.
  tough_jerky: {
    id: 'tough_jerky',
    name: 'Salted Jerky',
    kind: 'food',
    quality: 'common',
    foodHp: 61,
    sellValue: 2,
    buyValue: 25,
  },
  // Reagent now (TROPHY_RECIPES, Masterwrought phase 11l), same convention as
  // wolf_fang above: common NOT poor so sellAllJunk never sweeps it; sellValue
  // unchanged.
  mudfin_scale: {
    id: 'mudfin_scale',
    name: 'Slimy Mudfin Scale',
    kind: 'junk',
    quality: 'common',
    sellValue: 5,
  },
  // Reagent now (TROPHY_RECIPES, Masterwrought phase 11l), same convention as
  // wolf_fang above: common NOT poor so sellAllJunk never sweeps it; sellValue
  // unchanged.
  tallow_candle: {
    id: 'tallow_candle',
    name: 'Greasy Tallow Lump',
    kind: 'junk',
    quality: 'common',
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

  // --- Masterwrought shared chase materials (Masterwrought phase 04) ------
  // The three materials every apex craft chain consumes. Faucets and gates
  // live in src/sim/professions/masterwrought_materials.ts; the extraction
  // that yields Sundered Essence is src/sim/professions/sundering.ts.
  // The tradable making-catalyst: 1 to 3 drop per final-boss kill in the raid
  // (either difficulty) and the heroic five-mans, per participant; rift A/S
  // first clears grant deterministically; the Heroic Quartermaster sells it
  // for Heroic Marks. Freely tradable and market-listable by ruling R2's
  // tradable-catalyst design: same 'junk' reuse as the arcane materials, and
  // quality 'rare' keeps sellAllJunk (poor-only) away from it.
  wyrmfall_core: {
    id: 'wyrmfall_core',
    name: 'Wyrmfall Core',
    kind: 'junk',
    quality: 'rare',
    stackSize: 20,
    sellValue: 50,
  },
  // The bound ceiling material: sundering any raid-sourced epic of the tier
  // (a cast-paced extraction, disenchant-adjacent) breaks it into essence.
  // Token shape follows heroic_mark (tool + explicit stackSize + soulbound +
  // noDiscard: a chase material is never lost to a stray discard; it is spent
  // by the Perfecting stage).
  sundered_essence: {
    id: 'sundered_essence',
    name: 'Sundered Essence',
    kind: 'tool',
    quality: 'epic',
    stackSize: 20,
    sellValue: 0,
    soulbound: true,
    noDiscard: true,
  },
  // The weekly keystone (ruling R4): 1 per week per character, bankable
  // (missed weeks accrue), granted on the first eligible endgame completion
  // of the week. Same token shape as the essence above.
  makers_ember: {
    id: 'makers_ember',
    name: "Maker's Ember",
    kind: 'tool',
    quality: 'epic',
    stackSize: 20,
    sellValue: 0,
    soulbound: true,
    noDiscard: true,
  },

  // --- Masterwrought apex gear (Phase 09, R6/R13/R14) ----------------------
  // The skill-100 rung for weaponcrafting, jewelcrafting, engineering, and
  // inscription: eight ilvl-31 epics (recipe level 25 + epic bonus 6, via the
  // APEX_GEAR_RECIPES source registration) plus the two unflagged tools (the
  // field forge and the apex charm). Weapon dps sits on weaponDpsBudget(31)
  // = 16.0 (x TWOHAND_DPS_MULT for the two-hander); primary sums EQUAL
  // primaryStatBudget; each combat rating follows its family band
  // (FIVE_MAN_WEAPON_RATING 50 on weapons, the held/shield 20, the
  // heroic-vendor JEWELRY_RATING 25 on jewelry), off the stat budget like
  // spellPower. Class gating mirrors each family reference row; jewelry
  // carries no requiredClass and no armorType (the heroic-vendor family
  // precedent). The level-20 equip gate is DERIVED (item_level_req.ts),
  // never hand-authored, exactly like the phase 08 apex armor; every piece
  // is tradable per R2 with standard disenchant (R12: the epic-quality
  // ladder yield, no special fields). masterwrought: true on the eight
  // counted pieces; the forge and the charm are deliberately unflagged
  // (tools, never counted combat power). Pure stats per R14: no procs, no
  // combat effects anywhere in this block. sellValues sit strictly below
  // each recipe's reagent input value, inputs valued as buyValue when the
  // def carries a positive one, else sellValue (the recipe_economy suite
  // basis; the recipes.ts economy comments).
  duskforged_warblade: {
    id: 'duskforged_warblade',
    name: 'Duskforged Warblade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    // weaponDpsBudget(31) = 16.0 exactly: (30 + 50) / 2 / 2.5. Speed sits in
    // the ilvl-31 1H family band (mistcallers_fang 1.8 to lunar_tide 3.0).
    weapon: { min: 30, max: 50, speed: 2.5 },
    // ilvl-31 mainhand epic budget = 22; str:13+sta:9 = 22 (the
    // gravewyrm_cleaver split).
    stats: { str: 13, sta: 9 },
    hitRating: 50,
    sellValue: 320,
    masterwrought: true,
    // The gravewyrm_cleaver gate: the HEAVY plate/mail melee group.
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  ridgebreaker: {
    id: 'ridgebreaker',
    name: 'Ridgebreaker',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'epic',
    // 2H dps premium: weaponDpsBudget(31) = 16.0 x TWOHAND_DPS_MULT -> 18.4;
    // (49 + 76) / 2 / 3.4 = 18.38. Speed sits in the ilvl-31 2H family band
    // (greatfang_of_the_basin 3.4, wildsoul_maul 3.6).
    weapon: { min: 49, max: 76, speed: 3.4 },
    // round(22 x TWOHAND_STAT_MULT) = 29; str:17+sta:12 = 29 (the
    // greatfang_of_the_basin shape; the dps premium is the 2H's
    // compensation).
    stats: { str: 17, sta: 12 },
    hitRating: 50,
    sellValue: 340,
    masterwrought: true,
    // The greatfang_of_the_basin gate: HEAVY (rogues never equip
    // two-handers, equipment_rules).
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  duskforged_bulwark: {
    id: 'duskforged_bulwark',
    name: 'Duskforged Bulwark',
    kind: 'armor',
    armorType: 'mail',
    slot: 'offhand',
    shield: true,
    quality: 'epic',
    // MITIGATION MATCHES THE REFERENCE, it does not extrapolate past it, and
    // Phase 15 moved both numbers here. They read 32 and 732 before, from the
    // ilvl-29 bonewrought_bulwark's 30 and 680 carried up two item levels at
    // the shield line's 26 armor per ilvl. That derivation is internally
    // sound and it produced the game's single best mitigation item: the
    // heroic variant generator passes armor and blockValue through untouched
    // (heroic_variants.ts, normalizePrimaryStats), so heroic_bonewrought_
    // bulwark still reads 680 and 30 at ilvl 33, which means the ilvl-33 raid
    // shield could never even MATCH a crafted one, let alone beat it. It now
    // TIES it exactly on both numbers, and the two are separated by their
    // ratings (the raid shield's hit 55 plus crit 20 against this piece's hit
    // 20) and by strength. Measured, that inversion was worth 1.02 percent less
    // physical damage taken on the reference tank at heroic and S-rift attacker
    // levels, on the axis R5's protected asset is priced in, with nothing
    // measuring or pinning it. The other nine apex armour pieces already pin
    // armor EQUAL to their reference drop's; the shield was the only one that
    // extrapolated, so it joins that rule here. 680/30 is therefore the MAXIMUM
    // permitted value, not a chosen one: anything above re-creates the
    // inversion against a frozen heroic def.
    // KNOWN COST, recorded in power-verification.md section 10.3: at the tie
    // this piece is DOMINATED by the raid drop it matches, which carries the
    // same 680/30 plus hit 55, crit 20 and one more strength. Even Perfected
    // it trades 35 hit and 20 crit for +1 primary, so a tank holding the
    // heroic shield has no reason to craft it. That is an R21 demand risk for
    // a future pass, not a number R5 will let us raise.
    blockValue: 30,
    // ilvl-31 offhand epic budget = 16; sta:11+str:5 = 16, sta-lead for the
    // tank identity. The primary budget still reads at ilvl 31 (the budget is
    // the item-level axis); only the two mitigation numbers match the
    // reference, which is what keeps a crafted shield off the raid line.
    stats: { armor: 680, sta: 11, str: 5 },
    // The held/shield family band: one rating at 20; physical tank identity
    // is Hit (threat), like bonewrought_bulwark.
    hitRating: 20,
    sellValue: 300,
    masterwrought: true,
    // The bonewrought_bulwark gate.
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  wyrmfall_pendant: {
    id: 'wyrmfall_pendant',
    name: 'Wyrmfall Pendant',
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    // ilvl-31 neck epic budget = 14; int:8+sta:6 = 14. Two stats only (a
    // primary plus stamina), the heroic-vendor jewelry shape law.
    stats: { int: 8, sta: 6 },
    // Exactly one rating at the jewelry band's 25. Caster haste WITH
    // stamina complements the vendor necks: zense_meridian is the int/spi
    // CRIT neck and no vendor neck carries a caster haste line.
    hasteRating: 25,
    sellValue: 320,
    masterwrought: true,
  },
  warhewn_signet: {
    id: 'warhewn_signet',
    name: 'Warhewn Signet',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    // ilvl-31 ring epic budget = 13; str:8+sta:5 = 13.
    stats: { str: 8, sta: 5 },
    // Melee str identity: Hit, the seal_of_the_nine_oaths line.
    hitRating: 25,
    sellValue: 300,
    masterwrought: true,
  },
  prismglass_loop: {
    id: 'prismglass_loop',
    name: 'Prismglass Loop',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    // ilvl-31 ring epic budget = 13; int:8+sta:5 = 13.
    stats: { int: 8, sta: 5 },
    // Caster int identity: haste. The vendor haste rings are spi/int splits
    // (zyzzs_deathless_signet, architects_cornerstone); an int-lead haste
    // ring with stamina is the missing line.
    hasteRating: 25,
    sellValue: 300,
    masterwrought: true,
  },
  gyrelens_array: {
    id: 'gyrelens_array',
    name: 'Gyrelens Array',
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'epic',
    // Held-in-offhand engineering stat stick on the wraithfire_orb line
    // (occupiesHand defaults true: the 0.75 held budget line, kept). NO use
    // field: R14 forbids new proc/effect mechanics and the codebase ships
    // no cosmetic-only item-use family to reuse, so the gadget is pure
    // stats. ilvl-31 offhand epic budget = 16; int:10+sta:6 = 16, the
    // dps-caster identity.
    stats: { int: 10, sta: 6 },
    // The held/shield family band: one rating at 20; dps-caster throughput
    // is crit, like wraithfire_orb.
    critRating: 20,
    sellValue: 340,
    masterwrought: true,
    // The wraithfire_orb gate: the caster weapon-proficiency group; kind
    // held_offhand equips by the literal requiredClass.
    requiredClass: ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'],
  },
  voidbound_grimoire: {
    id: 'voidbound_grimoire',
    name: 'Voidbound Grimoire',
    kind: 'held_offhand',
    slot: 'offhand',
    quality: 'epic',
    // ilvl-31 offhand epic budget = 16; int:8+spi:5+sta:3 = 16, the
    // wraithfire_orb three-stat healer-leaning distribution rescaled to the
    // ilvl-31 budget.
    stats: { int: 8, spi: 5, sta: 3 },
    // Healer-inclusive throughput: haste, never Hit (heals are not
    // resisted; the healer-facing rule at wraithfire_orb).
    hasteRating: 20,
    sellValue: 340,
    masterwrought: true,
    requiredClass: ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'],
  },
  masters_field_forge: {
    id: 'masters_field_forge',
    name: "Master's Field Forge",
    kind: 'tool',
    quality: 'epic',
    // The apex mobile station (mobile_station.ts placeMobileStationFromItem):
    // party-shared, never consumed (the mount-reins convention), holding it
    // is the credential (no specialization gate). stationCraftId is a CRAFT
    // id, so stationTypeForCraft('weaponcrafting') resolves the FORGE.
    // Deliberately NOT masterwrought: a tool, never counted combat power.
    use: { type: 'placeMobileStation', stationCraftId: 'weaponcrafting' },
    sellValue: 380,
  },
  makers_charm: {
    id: 'makers_charm',
    name: "Maker's Charm",
    kind: 'tool',
    quality: 'epic',
    // The apex tool-effect charm (the gatherers_cache shape, one rung over
    // it: TOOL_EFFECTS makers_charm, quantity +2). Item id EQUALS the
    // effect id (one identity, one icon key, one display name). quality
    // 'epic' keeps the rare-or-better craft signing rule minting signed
    // copies, whose signer feeds the original-crafter recharge discount.
    // Deliberately NOT masterwrought.
    use: { type: 'toolEffect', effectId: 'makers_charm' },
    sellValue: 150,
  },
  grand_cauldron: {
    id: 'grand_cauldron',
    name: 'Grand Cauldron',
    kind: 'tool',
    quality: 'epic',
    // The alchemy skill-125 capstone placement: pure masters_field_forge
    // reuse, no new machinery. stationCraftId is a CRAFT id, so
    // stationTypeForCraft('alchemy') resolves the APOTHECARY, and the tool
    // inherits the shared party radius, the 10-minute duration, and the
    // never-consumed rule from that one implementation. A player owns ONE
    // mobile station slot, so placing this clobbers their own field forge;
    // that is deliberate and the replace tooltip line already says so.
    // Deliberately NOT masterwrought: a tool, never counted combat power.
    use: { type: 'placeMobileStation', stationCraftId: 'alchemy' },
    sellValue: 380,
  },
  laden_hearth: {
    id: 'laden_hearth',
    name: 'The Laden Hearth',
    kind: 'tool',
    quality: 'epic',
    // The cooking skill-125 capstone placement, the Grand Cauldron's twin:
    // stationTypeForCraft('cooking') resolves the KITCHENS. Same one-slot
    // replace rule, same duration, same price, because they are the same tool
    // pointed at a different station.
    use: { type: 'placeMobileStation', stationCraftId: 'cooking' },
    sellValue: 380,
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

// Catch rarity ladder: fishing proficiency and the carried ROD together select
// one of SIX per-zone tables (bands; three until masterwrought Phase 11i). As proficiency rises the weight shifts
// out of the grey-junk rows (tangled_weed / soggy_boot) and the empty-hook null
// row and into the zone's cooking-catch rows (raw fish reagents). The moves are
// MONOTONIC BUT NOT STRICT per band step (each cooking catch non-decreasing,
// each grey junk / null row non-increasing) and the flat steps are authored
// rather than incidental: the koi holds at 6 from band 2 up because both rod
// rungs that consume it sit at or below tier 5, and a junk row floors at one
// weight per junk row the zone carries so Mirefen's two-row flavor never
// collapses to one. Every band still sums to exactly 100,
// and the empty-hook null row is always present with weight >= 1. Band
// boundaries and selection live in src/sim/professions/fishing_bands.ts
// (FISHING_CATCH_BAND_THRESHOLDS, fishingCatchBandFor and fishingRodBandFor;
// fishing.ts re-exports fishingBandFor from there and is the thin consumer); FISHING_TABLES_BY_BAND[band][zoneId] is the resolved table,
// with the eastbrook_vale row as the fallback for any zone without its own.
//
// THE AXIS THESE EIGHTEEN CELLS ARE AUTHORED AGAINST (D9). A cell is not "how
// good is this angler", it is "how far is this angler from what this water
// asks".
// Each zone names a required band (professions/fishing_zones.ts, derived from
// the rod tier its water takes), and a cell's whole character follows from the
// distance between that and the band the cell is for:
//
//   empty hook   at the requirement 10, then -2 per band above it, floored at
//                1: 10 / 8 / 6 / 4 / 2 / 1 by surplus; one band SHORT 35, two
//                short 55
//   rare koi     1 / 3 / 6 by band and then FLAT at 6, in every zone: the row
//                that reads skill alone, because it is the rod ladder's reagent
//                and a seasoned angler should be the one who farms it. The
//                three high-band catches read skill alone the same way; the
//                high-band block below carries their own derivation
//   grey junk    carries the zone's own flavor (the marsh keeps its boots) and
//                swells with the shortfall, roughly doubling or worse against
//                the same zone's at-requirement cell
//   cooking catch whatever is left, split in each zone's shipped proportion
//
// So Eastbrook, which asks for nothing, keeps its shipped shape at band 0, and
// Thornpeak at band 0 pays 55 empty hooks and 28 grey junk out of 100 to a
// level-1 angler who borrowed a rod good enough to cast there. That is the whole point: the
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
  // ---- The three HIGH BANDS (masterwrought Phase 11i) ----------------------
  //
  // Bands 3, 4 and 5 all gate at proficiency 200
  // (professions/fishing_bands.ts), so the ROD is the only axis that separates
  // them: band 3 takes the shipped stormreel (tier 4), band 4 the shipped
  // tidewrought (tier 5), band 5 the clockreel this phase mints (tier 6). That
  // is the whole point of the phase, and it is why the two crafted rods that
  // shipped opening nothing now open a table each.
  //
  // THE SCHEDULE EXTENDS, IT DOES NOT RESTART. Every number below is derived by
  // the same D9 rules the nine shipped cells obey, with the surplus clamp moved
  // off 2 (eastbrook at band 5 is FIVE bands above its requirement):
  //
  //   empty hook   the shipped -2 per surplus step, floored at the standing
  //                weight-1 minimum: 10 / 8 / 6 / 4 / 2 / 1 by surplus
  //   grey junk    the zone's at-requirement total minus 4 per surplus band
  //                (the step the shipped cells already walk: eastbrook 12 / 8 /
  //                4, mirefen 13 / 9), floored at one weight per junk row the
  //                zone carries, so a zone never loses a flavor row entirely
  //   rare koi     FLAT at 6 from band 2 up. Non-decreasing is satisfied, and
  //                the row has nowhere useful left to climb: it is already the
  //                second-heaviest thing in a top-band cell, and its demand is
  //                the rod ladder's, which is bounded at three rungs. Growing
  //                it further would only crowd out the three new catches
  //   new catches  each enters at the band its rod opens, at exactly the weight
  //                eastbrook's empty-hook and junk rows GIVE UP at that band.
  //                Eastbrook's empty+junk runs 22 / 16 / 10 / 5 / 3 / 2 by
  //                band, so the deltas at bands 3, 4 and 5 are 5, 2 and 1, and
  //                those are the three weights. Eastbrook funds the least of
  //                the three zones (its cells were already the most fish-heavy
  //                shipped), so sizing on it is what lets the row be UNIFORM
  //                across every zone
  //   shipped fish whatever is left, split in the zone's BAND-2 proportion
  //                (the last shipped cell, the one these continue from), by
  //                largest remainder
  //
  // NOT ONE SHIPPED FISH ROW MOVES DOWN ANYWHERE, at any band, and that is a
  // consequence of the sizing rule rather than a coincidence: the new catches
  // are funded entirely out of what the empty-hook and junk rows release, so
  // eastbrook's pair holds at 50/34 across bands 2 to 5 while mirefen and
  // thornpeak, which release more, climb. The phase file allowed a proportional
  // trim of the shipped rows as a second funding source; it was not needed and
  // was not taken.
  //
  // ROW ORDER IS BEHAVIOR, not formatting: the table draw walks a running
  // weight total. The shipped prefix keeps its exact order and the three new
  // rows sit with the koi, after the junk, because they read SKILL alone the
  // way it does.
  //
  // Band 3 (proficiency 200 with a tier-4 rod): the Deepbarb Catfish arrives,
  // and it is the workhorse of the three, the reagent four apex bills take at
  // count 4.
  {
    eastbrook_vale: [
      { itemId: 'raw_mirror_trout', weight: 50 },
      { itemId: 'raw_river_perch', weight: 34 },
      { itemId: 'tangled_weed', weight: 1 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: 'raw_deepbarb_catfish', weight: 5 },
      { itemId: null, weight: 4 },
    ],
    mirefen_marsh: [
      { itemId: 'raw_marsh_pike', weight: 44 },
      { itemId: 'raw_bog_eel', weight: 34 },
      { itemId: 'soggy_boot', weight: 2 },
      { itemId: 'tangled_weed', weight: 3 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: 'raw_deepbarb_catfish', weight: 5 },
      { itemId: null, weight: 6 },
    ],
    thornpeak_heights: [
      { itemId: 'raw_frostgill_trout', weight: 45 },
      { itemId: 'raw_stonescale_carp', weight: 34 },
      { itemId: 'tangled_weed', weight: 2 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: 'raw_deepbarb_catfish', weight: 5 },
      { itemId: null, weight: 8 },
    ],
  },
  // Band 4 (proficiency 200 with a tier-5 rod): the Hollowgill Sturgeon joins,
  // the keystone of the cooking-100 row.
  {
    eastbrook_vale: [
      { itemId: 'raw_mirror_trout', weight: 50 },
      { itemId: 'raw_river_perch', weight: 34 },
      { itemId: 'tangled_weed', weight: 1 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: 'raw_deepbarb_catfish', weight: 5 },
      { itemId: 'raw_hollowgill_sturgeon', weight: 2 },
      { itemId: null, weight: 2 },
    ],
    mirefen_marsh: [
      { itemId: 'raw_marsh_pike', weight: 45 },
      { itemId: 'raw_bog_eel', weight: 36 },
      { itemId: 'soggy_boot', weight: 1 },
      { itemId: 'tangled_weed', weight: 1 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: 'raw_deepbarb_catfish', weight: 5 },
      { itemId: 'raw_hollowgill_sturgeon', weight: 2 },
      { itemId: null, weight: 4 },
    ],
    thornpeak_heights: [
      { itemId: 'raw_frostgill_trout', weight: 45 },
      { itemId: 'raw_stonescale_carp', weight: 35 },
      { itemId: 'tangled_weed', weight: 1 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: 'raw_deepbarb_catfish', weight: 5 },
      { itemId: 'raw_hollowgill_sturgeon', weight: 2 },
      { itemId: null, weight: 6 },
    ],
  },
  // Band 5 (proficiency 200 with the tier-6 clockreel): the Stillmere Salmon,
  // the rarest catch in the game at one cast in a hundred, and the keystone of
  // the cooking-125 capstone. It shares its weight with the empty hook in the
  // Vale, which is the plainest way to say what a band-5 angler is fishing for.
  {
    eastbrook_vale: [
      { itemId: 'raw_mirror_trout', weight: 50 },
      { itemId: 'raw_river_perch', weight: 34 },
      { itemId: 'tangled_weed', weight: 1 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: 'raw_deepbarb_catfish', weight: 5 },
      { itemId: 'raw_hollowgill_sturgeon', weight: 2 },
      { itemId: 'raw_stillmere_salmon', weight: 1 },
      { itemId: null, weight: 1 },
    ],
    mirefen_marsh: [
      { itemId: 'raw_marsh_pike', weight: 46 },
      { itemId: 'raw_bog_eel', weight: 36 },
      { itemId: 'soggy_boot', weight: 1 },
      { itemId: 'tangled_weed', weight: 1 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: 'raw_deepbarb_catfish', weight: 5 },
      { itemId: 'raw_hollowgill_sturgeon', weight: 2 },
      { itemId: 'raw_stillmere_salmon', weight: 1 },
      { itemId: null, weight: 2 },
    ],
    thornpeak_heights: [
      { itemId: 'raw_frostgill_trout', weight: 46 },
      { itemId: 'raw_stonescale_carp', weight: 35 },
      { itemId: 'tangled_weed', weight: 1 },
      { itemId: 'glimmerfin_koi', weight: 6 },
      { itemId: 'raw_deepbarb_catfish', weight: 5 },
      { itemId: 'raw_hollowgill_sturgeon', weight: 2 },
      { itemId: 'raw_stillmere_salmon', weight: 1 },
      { itemId: null, weight: 4 },
    ],
  },
];

// The band-0 tables, kept under the original export name so existing
// consumers (the deeds zone-key guard in tests/deeds_content.test.ts) resolve
// unchanged. The SAME object as FISHING_TABLES_BY_BAND[0], never a copy.
export const FISHING_TABLES: Record<string, FishingEntry[]> = FISHING_TABLES_BY_BAND[0];

// The rare catch worth a celebratory shout in the combat log.
export const FISHING_RARE_ID = 'glimmerfin_koi';

/**
 * The rule behind FISHING_BAND_INTRODUCED_CATCH, as a pure function of a table
 * set rather than of the shipped one.
 *
 * IT IS A PARAMETERIZED LEAF ON PURPOSE. The export below is a module-scope
 * constant over the live tables, which means a test can only ever observe the
 * ANSWER it produced for real content: the ambiguity branch (a band adding two
 * ids, which no shipped table does) is unreachable from the outside, so a suite
 * wanting to cover it has to build a fixture, and a fixture had nothing to
 * drive. rv-tests proved the cost during Phase 11i: the ambiguity arm in
 * tests/professions_fishing.test.ts had re-typed this body as a local helper
 * and was asserting against its own copy, so deleting the `size === 1` rule
 * here left the whole suite green. Taking the tables as a parameter is what
 * makes that fixture decisive over the shipped code.
 *
 * Band 0 is null by definition (introducing the whole starter table is the
 * normal case there, not an error). Above it, MORE THAN ONE new id is a content
 * error and this returns null rather than papering over it by picking a winner:
 * the tooltip then falls back to its generic line, and the pin in
 * tests/professions_fishing.test.ts reds on the table.
 */
export function introducedCatchFor(
  tables: readonly Record<string, FishingEntry[]>[],
  band: number,
): string | null {
  if (band === 0) return null;
  const below = new Set<string>();
  for (let b = 0; b < band; b++) {
    for (const rows of Object.values(tables[b])) {
      for (const row of rows) if (row.itemId) below.add(row.itemId);
    }
  }
  const introduced = new Set<string>();
  for (const rows of Object.values(tables[band])) {
    for (const row of rows) if (row.itemId && !below.has(row.itemId)) introduced.add(row.itemId);
  }
  return introduced.size === 1 ? [...introduced][0] : null;
}

/**
 * The catch each band INTRODUCES, or null where a band introduces none.
 *
 * DERIVED, never hand-listed: a band introduces an id when that id appears in
 * the band's cells and in none below it, and reads null unless it introduces
 * EXACTLY one.
 *
 * BAND 0 READS NULL BECAUSE IT INTRODUCES EVERYTHING, not because it introduces
 * nothing, and the difference is worth stating because the two look identical
 * from the outside: nothing sits below band 0, so by the rule above it
 * introduces all nine of its rows and falls through the exactly-one arm. Bands
 * 1 and 2 introduce nothing at all (they move WEIGHT, not membership), and each
 * of the three high bands introduces exactly one catch, which is the only case
 * a caller can use.
 *
 * IT EXISTS FOR THE ROD TOOLTIP (masterwrought Phase 11i). Bands 3, 4 and 5 all
 * gate at proficiency 200, so a tooltip that quotes only the skill threshold
 * says "at fishing skill 200 and above" for three different rods, which is the
 * exact defect the rod block in this file already documents against itself: a
 * line true of the rod BELOW telling the owner of a crafted rod they bought
 * something they already had. Naming the catch is what makes each rung's line
 * say something only that rung can say.
 */
export const FISHING_BAND_INTRODUCED_CATCH: readonly (string | null)[] = FISHING_TABLES_BY_BAND.map(
  (_byZone, band) => introducedCatchFor(FISHING_TABLES_BY_BAND, band),
);

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
  // The three high-band catches (masterwrought Phase 11i). Membership here is
  // what refuses eating one raw and what makes the material labels and icons
  // resolve; leaving one out would ship a fish the useItem path treats as
  // ordinary junk.
  'raw_deepbarb_catfish',
  'raw_hollowgill_sturgeon',
  'raw_stillmere_salmon',
]);

/** True when `itemId` is a raw fishing catch (cooking reagent, refuse-use). */
export function isRawCookingCatch(itemId: string): boolean {
  return RAW_COOKING_CATCH_IDS.has(itemId);
}
