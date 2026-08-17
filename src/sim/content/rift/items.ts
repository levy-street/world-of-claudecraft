import type { ItemDef } from '../../types';

export const RIFT_ESSENCE_ITEM_ID = 'rift_essence';
export const RIFT_GEM_IDS = ['rift_gem_crimson', 'rift_gem_azure', 'rift_gem_verdant'] as const;
export type RiftGemId = (typeof RIFT_GEM_IDS)[number];

export const RIFT_GEAR_ITEM_IDS = [
  'riftbound_band_of_might',
  'riftbound_band_of_insight',
  'riftbound_band_of_guile',
] as const;

/** The clear-time gear ladder above the rares: epics that only a B+ final-boss
 * kill can shed (B already GUARANTEES one, so A does not raise the floor; S
 * adds an independent 35 percent roll for a SECOND epic, which is a separate
 * draw rather than a doubled chance) and the legendary chase items S-rank
 * clears roll for. Granted by rift/progression.ts
 * addRiftClearGearLoot at the moment the clear completes, NEVER from static
 * loot tables, so a C-rank farm can never mint epics and the payout cadence is
 * bound by the ranked portal spawns (the economy stays sane). */
export const RIFT_EPIC_ITEM_IDS = [
  'emberforged_bulwark',
  'stormsunder_hood',
  'voidweave_mantle',
  'abysswrought_band',
  'rimefang',
] as const;
/** The S-rank chase items. Each rolls its OWN independent chance in
 *  addRiftClearGearLoot rather than being picked from this pool, so a clear that
 *  beats both rolls sheds both. One is class-neutral jewelry, the other a caster
 *  main-hand, so the pair covers every archetype without either being a
 *  consolation prize for the other. */
export const RIFT_LEGENDARY_ITEM_IDS = ['heart_of_the_rift', 'voidsong_dirk'] as const;

/** The world-drop rares each rift environment can shed: one signature piece per
 * procedural theme plus the two Infernal Citadel pieces. Trash carries a slim
 * chance and the environment's boss a fat one (loot tables in ./mobs.ts), so a
 * rift run always has real itemisation on the line, ranked runs and dev runs
 * alike. */
export const RIFT_RARE_ITEM_IDS = [
  'hoarfrost_edge',
  'emberforge_gauntlets',
  'broodmother_carapace',
  'bonelord_mantle',
  'graskbreaker_girdle',
  'voidscar_handwraps',
  'stormscale_treads',
  'abyssal_loop',
  'pactbound_vestments',
  'pitlords_cleaver',
] as const;

const HEAVY = ['warrior', 'paladin', 'shaman'] as ItemDef['requiredClass']; // plate/mail
const AGILE = ['rogue', 'hunter'] as ItemDef['requiredClass'];
const AGILE_WILD = ['rogue', 'hunter', 'druid'] as ItemDef['requiredClass'];
const CASTER = ['mage', 'priest', 'warlock', 'druid'] as ItemDef['requiredClass'];
// CASTER above is the CLOTH ARMOR group (shaman and paladin wear mail/plate, so
// they are correctly absent). It is NOT the weapon group: weapons are
// proficiency-based, and equipment_rules.ts CASTER_WEAPON_CLASSES additionally
// admits shaman and paladin. Never reach for CASTER on a weapon.

// Combat-rating allowance for the ilvl-31 clear-time epics: one rating per piece.
// Armor pieces follow the heroic ilvl-31 floor (ARMOR_RATING = 40 in heroic_loot.ts).
// Jewelry (ring) follows the jewelry precedent (JEWELRY_RATING = 25 in heroic_vendor.ts).
// Off the primary-stat budget like spellPower, so stat sums stay budget-enforced.
const RIFT_ARMOR_RATING = 40; // 40 rating = 4.0%, mirrors the heroic ilvl-31 armor floor
const RIFT_JEWELRY_RATING = 25; // 25 rating, matches heroic quartermaster jewelry precedent

/** Static shells. The non-fungible payload carries each drop's source, power,
 * upgrades, enchantment, sockets, gems, and rolled bonus stats. */
export const RIFT_ITEMS: Record<string, ItemDef> = {
  // Rogue dagger (Rift epic, B+ clear). A frost-bolt on-hit gives the fast
  // dagger a proc that actually helps a DPS rogue: an attack-speed chill would
  // not (it slows the target's swing, useless to a rogue; A/B-confirmed).
  rimefang: {
    id: 'rimefang',
    name: 'Rimefang',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 19, max: 31, speed: 1.6, dagger: true },
    // ilvl-31 mainhand budget (22), on the same ~12:7 agi:sta identity the
    // dungeon daggers carry.
    stats: { agi: 14, sta: 8 },
    // The clear-time allowance (one rating per ilvl-31 piece, see the constants
    // above): an agility dagger takes crit per the agi-to-crit pattern the
    // rating ladder pins, at the same 40-rating floor the armor pieces mirror.
    critRating: RIFT_ARMOR_RATING,
    sellValue: 9000,
    requiredClass: ['rogue', 'hunter'],
    requiredLevel: 20,
    weaponProcs: [
      {
        id: 'rimefang_frostbite',
        name: 'Frostbite',
        trigger: 'weaponHit',
        chance: 0.08,
        effects: [
          { kind: 'chainArc', school: 'frost', damage: 20, jumps: 0, falloff: 0.6, radius: 8 },
        ],
      },
    ],
  },
  rift_essence: {
    id: 'rift_essence',
    name: 'Rift Essence',
    kind: 'tool',
    quality: 'rare',
    stackSize: 20,
    sellValue: 0,
    noMarketList: true,
  },
  rift_gem_crimson: {
    id: 'rift_gem_crimson',
    name: 'Crimson Rift Gem',
    kind: 'tool',
    quality: 'epic',
    stackSize: 20,
    sellValue: 0,
    noMarketList: true,
  },
  rift_gem_azure: {
    id: 'rift_gem_azure',
    name: 'Azure Rift Gem',
    kind: 'tool',
    quality: 'epic',
    stackSize: 20,
    sellValue: 0,
    noMarketList: true,
  },
  rift_gem_verdant: {
    id: 'rift_gem_verdant',
    name: 'Verdant Rift Gem',
    kind: 'tool',
    quality: 'epic',
    stackSize: 20,
    sellValue: 0,
    noMarketList: true,
  },
  riftbound_band_of_might: {
    id: 'riftbound_band_of_might',
    name: 'Riftbound Band of Might',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { str: 6, sta: 5 },
    sellValue: 5000,
    noMarketList: true,
  },
  riftbound_band_of_insight: {
    id: 'riftbound_band_of_insight',
    name: 'Riftbound Band of Insight',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { int: 6, spi: 5 },
    sellValue: 5000,
    noMarketList: true,
  },
  riftbound_band_of_guile: {
    id: 'riftbound_band_of_guile',
    name: 'Riftbound Band of Guile',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    stats: { agi: 6, sta: 5 },
    sellValue: 5000,
    noMarketList: true,
  },
  // ---- Themed world-drop rares (one per rift environment) ----
  // Stat lines sit at the ilvl-26 rare budget (source 23 + rare bonus 3).
  // ilvl-26 slot budgets (round(26 * 0.8 * slot_mult * 0.7)):
  //   mainhand 1.0 = 15, chest 1.0 = 15, gloves 0.7 = 10,
  //   shoulder 0.75 = 11, waist 0.7 = 10, feet 0.65 = 9, ring 0.6 = 9.
  hoarfrost_edge: {
    id: 'hoarfrost_edge',
    name: 'Hoarfrost Edge',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    requiredLevel: 20,
    weapon: { min: 28, max: 42, speed: 2.4 },
    // ilvl-26 mainhand rare budget = 15; str:10+sta:5 = 15
    stats: { str: 10, sta: 5 },
    sellValue: 7500,
    requiredClass: HEAVY,
  },
  emberforge_gauntlets: {
    id: 'emberforge_gauntlets',
    name: 'Emberforge Gauntlets',
    kind: 'armor',
    armorType: 'mail',
    slot: 'gloves',
    quality: 'rare',
    requiredLevel: 20,
    // ilvl-26 gloves rare budget = 10; str:6+sta:4 = 10
    stats: { armor: 165, str: 6, sta: 4 },
    sellValue: 5000,
    requiredClass: HEAVY,
  },
  broodmother_carapace: {
    id: 'broodmother_carapace',
    name: 'Broodmother Carapace',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'rare',
    requiredLevel: 20,
    // ilvl-26 chest rare budget = 15; agi:9+sta:6 = 15
    stats: { armor: 165, agi: 9, sta: 6 },
    sellValue: 6000,
    requiredClass: AGILE_WILD,
  },
  bonelord_mantle: {
    id: 'bonelord_mantle',
    name: 'Bonelord Mantle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'rare',
    requiredLevel: 20,
    // ilvl-26 shoulder rare budget = 11; int:7+spi:4 = 11
    stats: { armor: 38, int: 7, spi: 4 },
    sellValue: 5000,
    requiredClass: CASTER,
  },
  graskbreaker_girdle: {
    id: 'graskbreaker_girdle',
    name: 'Graskbreaker Girdle',
    kind: 'armor',
    armorType: 'mail',
    slot: 'waist',
    quality: 'rare',
    requiredLevel: 20,
    // ilvl-26 waist rare budget = 10; str:6+sta:4 = 10
    stats: { armor: 140, str: 6, sta: 4 },
    sellValue: 5000,
    requiredClass: HEAVY,
  },
  voidscar_handwraps: {
    id: 'voidscar_handwraps',
    name: 'Voidscar Handwraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'gloves',
    quality: 'rare',
    requiredLevel: 20,
    // ilvl-26 gloves rare budget = 10; int:6+spi:4 = 10
    stats: { armor: 42, int: 6, spi: 4 },
    sellValue: 5000,
    requiredClass: CASTER,
  },
  stormscale_treads: {
    id: 'stormscale_treads',
    name: 'Stormscale Treads',
    kind: 'armor',
    armorType: 'leather',
    slot: 'feet',
    quality: 'rare',
    requiredLevel: 20,
    // ilvl-26 feet rare budget = 9; agi:6+sta:3 = 9
    stats: { armor: 85, agi: 6, sta: 3 },
    sellValue: 5000,
    requiredClass: AGILE,
  },
  abyssal_loop: {
    id: 'abyssal_loop',
    name: 'Abyssal Loop',
    kind: 'armor',
    slot: 'ring',
    quality: 'rare',
    requiredLevel: 20,
    // ilvl-26 ring rare budget = 9; sta:5+spi:4 = 9 (unchanged from ilvl-28: same budget)
    stats: { sta: 5, spi: 4 },
    sellValue: 5000,
  },
  // ---- The Infernal Citadel set-piece drops ----
  pactbound_vestments: {
    id: 'pactbound_vestments',
    name: 'Pactbound Vestments',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'rare',
    requiredLevel: 20,
    // ilvl-26 chest rare budget = 15; int:9+spi:6 = 15
    stats: { armor: 55, int: 9, spi: 6 },
    sellValue: 6500,
    requiredClass: CASTER,
  },
  pitlords_cleaver: {
    id: 'pitlords_cleaver',
    name: "Pit Lord's Cleaver",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    requiredLevel: 20,
    weapon: { min: 34, max: 50, speed: 2.9 },
    // ilvl-26 mainhand rare budget = 15; str:9+sta:6 = 15
    stats: { str: 9, sta: 6 },
    sellValue: 8500,
    requiredClass: HEAVY,
  },
  // ---- Clear-time epics (B+ final-boss kills only; see addRiftClearGearLoot) ----
  // Stat lines sit in the ilvl-31 band (source level 25 + epic bonus 6), registered
  // in item_level.buildSourceIndex. Armor pieces carry RIFT_ARMOR_RATING = 40
  // (matching the heroic ilvl-31 five-man floor). The ring follows the jewelry
  // precedent (RIFT_JEWELRY_RATING = 25, matching heroic quartermaster rings).
  // All ratings are off the primary-stat budget like spellPower so stat sums stay
  // budget-enforced. Rating choices follow the stat identity: str/tank -> hit,
  // agi -> crit, int/spi (healer-facing) -> haste (healers are not level-resisted).
  // See heroic_loot.ts for the ilvl-31 armor template these mirror.
  emberforged_bulwark: {
    id: 'emberforged_bulwark',
    name: 'Emberforged Bulwark',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'epic',
    requiredLevel: 20,
    // ilvl-31 chest epic budget = 22; str:13+sta:9 = 22
    stats: { armor: 360, str: 13, sta: 9 },
    hitRating: RIFT_ARMOR_RATING,
    sellValue: 16000,
    requiredClass: HEAVY,
  },
  stormsunder_hood: {
    id: 'stormsunder_hood',
    name: 'Stormsunder Hood',
    kind: 'armor',
    armorType: 'leather',
    slot: 'helmet',
    quality: 'epic',
    requiredLevel: 20,
    // ilvl-31 helmet epic budget = 18; agi:11+sta:7 = 18
    stats: { armor: 118, agi: 11, sta: 7 },
    critRating: RIFT_ARMOR_RATING,
    sellValue: 13000,
    requiredClass: AGILE_WILD,
  },
  voidweave_mantle: {
    id: 'voidweave_mantle',
    name: 'Voidweave Mantle',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'shoulder',
    quality: 'epic',
    requiredLevel: 20,
    // ilvl-31 shoulder epic budget = 16; int:10+spi:6 = 16
    stats: { armor: 48, int: 10, spi: 6 },
    hasteRating: RIFT_ARMOR_RATING,
    sellValue: 13000,
    requiredClass: CASTER,
  },
  abysswrought_band: {
    id: 'abysswrought_band',
    name: 'Abysswrought Band',
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    requiredLevel: 20,
    // ilvl-31 ring epic budget = 13; sta:8+spi:5 = 13.
    // Rating follows the jewelry precedent (25, not the 40 armor-piece floor).
    // Haste suits the sta/spi (healer-facing) stat identity; healers are not
    // resisted by level so Hit would be wasted.
    stats: { sta: 8, spi: 5 },
    hasteRating: RIFT_JEWELRY_RATING,
    sellValue: 12000,
  },
  // The one legendary chase item: an S-rank clear rolls a slim chance at it.
  // Class-neutral jewelry so it is a chase for every archetype without
  // touching any class's weapon dps ladder.
  heart_of_the_rift: {
    id: 'heart_of_the_rift',
    name: 'Heart of the Rift',
    kind: 'armor',
    slot: 'neck',
    quality: 'legendary',
    requiredLevel: 20,
    stats: { sta: 14, str: 6, agi: 6, int: 6 },
    sellValue: 50000,
  },
  // The caster half of the S-rank chase. Deliberately a DAGGER: the only other
  // spell-facing legendary is a two-handed staff (deathless_heartwood), so this
  // is the first main-hand option for a caster who wants an offhand, and it does
  // not touch any melee dps ladder. Rolls on its own independent 0.3%, so an S
  // clear can shed both legendaries.
  //
  // Stats are the ilvl-37 legendary main-hand budget exactly (49 = 37 * 0.7 *
  // SLOT_STAT_MULT.mainhand * QUALITY_STAT_MULT.legendary), weighted to
  // Intellect for throughput with Spirit behind it, matching how the Heartwood
  // staff splits.
  //
  // The weapon LINE is deliberately weak (15-25 at 1.8 = ~11.1 dps, the ilvl-20
  // rare-dagger band) even though the item is ilvl 37. This is a spell focus, not
  // a fighting knife: a caster's damage comes off the primary-stat block, which is
  // at full ilvl-37 legendary budget, so the low dps costs its intended owners
  // essentially nothing. It exists to keep MELEE classes away. The item carries no
  // class lock (see below), so the weapon line is the only thing standing between a
  // rogue and the best Craven Thrust weapon in the game, and it has to be decisive:
  // every EPIC dagger starts at 14.4 dps / 30 max, so this sits a full tier under
  // the floor rather than just under the ceiling. Pinned by tests/rift_loot_pools.
  // Carries NO combat ratings by design, like heart_of_the_rift: rift chase
  // items differentiate on the primary-stat block (tests/combat_rating.test.ts).
  voidsong_dirk: {
    id: 'voidsong_dirk',
    name: 'Voidsong, Dirk of the Sundered Veil',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'legendary',
    requiredLevel: 20,
    // dagger: true keeps the skin and the gameplay notion of "dagger" in step
    // (tests/weapon_skins.test.ts). With no class lock a rogue MAY equip this and
    // it does count for Craven Thrust / Ambush (weaponStrike + requiresBehind);
    // the weak damage line is what makes that a downgrade rather than a lure.
    weapon: { min: 15, max: 25, speed: 1.8, dagger: true },
    stats: { int: 19, spi: 17, sta: 13 },
    // NO requiredClass, deliberately: a class lock is a nerf, and the stat line
    // already decides who wants this (19 int / 17 spi / 0 agi / 0 str). A paladin
    // or shaman healer has a real case for it, which the cloth-armor CASTER group
    // would have wrongly denied. A warrior may equip it and simply never will.
    // The melee incentive is removed by the weak weapon line above, NOT by a rule.
    sellValue: 50000,
    weaponProcs: [
      {
        id: 'voidsong_echo',
        name: 'Voidsong',
        trigger: 'spellDamage',
        chance: 0.15,
        effects: [
          {
            kind: 'dot',
            name: 'Voidsong',
            school: 'shadow',
            perTick: 12,
            interval: 2,
            duration: 8,
          },
        ],
      },
    ],
  },
};
