// Faction Quartermasters, the World Quest Taskmaster, and the standing-gated
// vendor ladder. Deterministic simulation content leaf: pure data structures
// and gate resolution. Zero RNG, zero wall-clock, zero DOM/Three.js imports.
//
// THE LADDER (docs/design/factions.md, "What standing unlocks"). Factions own
// the PERIPHERY the raid never fills, the way classic reputation gear did:
// the five set slots (helmet, shoulder, chest, gloves, legs) and the top
// weapons stay raid prestige, and every faction tier sells something a player
// uses the day it opens.
//   Recognized  a neck at the heroic five-man vendor's budget (one 25 rating)
//   Trusted     a ring at the same budget, plus the faction's bag
//   Proven      the two thinnest armor slots (waist, feet) at the raid OFFSET
//               budget, a pre-raid set-slot piece at the heroic five-man
//               budget, and the faction's learned enchant formula(s)
//   Vanguard    a proc weapon at the heroic five-man weapon bar (the only
//               non-legendary proc weapons outside the two 1.7 daggers)
//   Champion    the jewelry gaps: Agility jewels, stamina-line tank jewels,
//               a SECOND caster and healer ring, each carrying the raid
//               jewel's 25 rating with its primary line ONE point under the
//               raid row it mirrors (a rival, never a tie: dev/bis_gear.ts
//               orders epics by line total, so an exact tie would silently
//               swap every dev kit and DPS fixture onto faction stock)
// Each faction serves one role family across its whole ladder (the three
// factions progress in parallel, so every character walks all three):
//   Rift Watch    Agility (rogue, hunter, feral, enhancement)
//   Church Order  casters and healers
//   Automatons    Strength and the stamina line (warrior, paladin, shaman)
// Budgets are COPIED from the live raid and heroic tables, never invented:
// jewelry mirrors content/ignivar_loot.ts IGNIVAR_JEWELRY_ITEMS (one 25
// rating, 15 to 16 primary) and content/heroic_vendor.ts; waist and feet
// mirror IGNIVAR_OFFSET_ITEMS (25 + 60 ratings; untiered feet carry one more
// stamina than the tiered row so they meet the proxy floor); set-slot pieces mirror the
// heroic five-man drops (one 40 rating); weapons sit on the heroic five-man
// weapon bar (FIVE_MAN_WEAPON_RATING). Faction stock is UNTIERED in
// item_level.ts (no source registers it), so tests/faction_vendors.test.ts
// pins each row against the raid or heroic row it mirrors.
// Item ids shipped in the golden (tests/shipped_item_ids.golden.json) are
// never deleted: the first-cut ids keep their slot and were re-statted.

import type { FactionId, StandingTier } from '../factions';
import { STANDING_THRESHOLDS } from '../factions';
import type { ItemDef, NpcDef } from '../types';

export interface FactionVendorGate {
  readonly factionId: FactionId;
  readonly standingTier: StandingTier;
  readonly requiredStanding: number;
}

function gate(factionId: FactionId, standingTier: StandingTier): FactionVendorGate {
  return Object.freeze({
    factionId,
    standingTier,
    requiredStanding: STANDING_THRESHOLDS[standingTier],
  });
}

/** Gate requirements for every faction-stocked row, by item id. */
export const FACTION_VENDOR_GATES: Readonly<Record<string, FactionVendorGate>> = Object.freeze({
  // Rift Watch
  tidewatchers_locket: gate('rift_watch', 'recognized'),
  rift_watchers_band: gate('rift_watch', 'trusted'),
  rift_surveyors_satchel: gate('rift_watch', 'trusted'),
  riftwalkers_tunic: gate('rift_watch', 'proven'),
  riftwalkers_cord: gate('rift_watch', 'proven'),
  riftwalkers_treads: gate('rift_watch', 'proven'),
  formula_riftwalkers_grace: gate('rift_watch', 'proven'),
  riftwarden_voidblade: gate('rift_watch', 'vanguard'),
  champion_rift_band: gate('rift_watch', 'champion'),
  riftwardens_pendant: gate('rift_watch', 'champion'),

  // Church Order
  order_prayer_beads: gate('church_order', 'recognized'),
  acolytes_signet: gate('church_order', 'trusted'),
  vestments_of_the_acolyte: gate('church_order', 'proven'),
  cord_of_the_dawn: gate('church_order', 'proven'),
  dawnlit_slippers: gate('church_order', 'proven'),
  formula_dawnfire_etching: gate('church_order', 'proven'),
  formula_dawns_benediction: gate('church_order', 'proven'),
  dawnkeeper_consecrated_mace: gate('church_order', 'vanguard'),
  templar_dawn_shield: gate('church_order', 'vanguard'),
  champion_dawn_medallion: gate('church_order', 'champion'),
  champions_dawn_loop: gate('church_order', 'champion'),
  dawnkeepers_circle: gate('church_order', 'champion'),

  // Automatons
  cogwork_choker: gate('automatons', 'recognized'),
  automaton_cog_ring: gate('automatons', 'trusted'),
  clockwork_tinkers_pack: gate('automatons', 'trusted'),
  artificers_welding_cowl: gate('automatons', 'proven'),
  forgemasters_girdle: gate('automatons', 'proven'),
  forgemasters_sabatons: gate('automatons', 'proven'),
  formula_piston_drive: gate('automatons', 'proven'),
  forgemaster_crag_cleaver: gate('automatons', 'vanguard'),
  champion_forged_loop: gate('automatons', 'champion'),
  forgewall_gorget: gate('automatons', 'champion'),
});

export interface FactionVendorRowGateState {
  readonly locked: boolean;
  readonly requirement?: FactionVendorGate;
  readonly currentStanding?: number;
}

/** Check if an item has a faction standing requirement and whether the player meets it. */
export function resolveFactionVendorRowGate(
  itemId: string,
  factions: Readonly<Record<FactionId, number>> | undefined,
): FactionVendorRowGateState {
  if (!Object.hasOwn(FACTION_VENDOR_GATES, itemId)) {
    return { locked: false };
  }
  const requirement = FACTION_VENDOR_GATES[itemId];
  const currentStanding = factions?.[requirement.factionId] ?? 0;
  const locked = currentStanding < requirement.requiredStanding;
  return { locked, requirement, currentStanding };
}

// Tier prices, one per standing tier, in copper (50s, 1g50, 3g50, 8g, 15g).
const PRICE: Readonly<Record<StandingTier, number>> = Object.freeze({
  unknown: 0,
  recognized: 5_000,
  trusted: 15_000,
  proven: 35_000,
  vanguard: 80_000,
  champion: 150_000,
});
const sell = (tier: StandingTier) => PRICE[tier] / 4;

/** The faction vendor stock (32 rows: 28 equipment and bag rows + 4 formulas). */
export const FACTION_VENDOR_ITEMS: Record<string, ItemDef> = {
  // ------------------------------------------------------------------ Rift Watch
  // Recognized: the heroic vendor's Agility neck shape (Yumi's Keepsake Locket).
  tidewatchers_locket: {
    id: 'tidewatchers_locket',
    name: "Tidewatcher's Locket",
    kind: 'armor',
    slot: 'neck',
    quality: 'rare',
    stats: { agi: 7, sta: 5 },
    hasteRating: 25,
    sellValue: sell('recognized'),
    buyValue: PRICE.recognized,
  },
  // Trusted: the heroic vendor's Agility ring shape (Sutil's Gambit).
  rift_watchers_band: {
    id: 'rift_watchers_band',
    name: "Rift Watcher's Band",
    kind: 'armor',
    slot: 'ring',
    quality: 'rare',
    stats: { agi: 7, sta: 4 },
    critRating: 25,
    sellValue: sell('trusted'),
    buyValue: PRICE.trusted,
  },
  rift_surveyors_satchel: {
    id: 'rift_surveyors_satchel',
    name: "Rift Surveyor's Satchel",
    kind: 'bag',
    bagSlots: 14,
    quality: 'uncommon',
    sellValue: sell('trusted'),
    buyValue: PRICE.trusted,
  },
  // Proven: the heroic five-man leather Agility chest (Basin Stalker's Tunic).
  riftwalkers_tunic: {
    id: 'riftwalkers_tunic',
    name: "Riftwalker's Tunic",
    kind: 'armor',
    slot: 'chest',
    armorType: 'leather',
    quality: 'rare',
    stats: { armor: 172, agi: 13, sta: 9 },
    hitRating: 40,
    sellValue: sell('proven'),
    buyValue: PRICE.proven,
  },
  // Proven: the raid offset leather Agility waist and feet (Slagstalker Belt,
  // Ashrunner Boots).
  riftwalkers_cord: {
    id: 'riftwalkers_cord',
    name: "Riftwalker's Cord",
    kind: 'armor',
    slot: 'waist',
    armorType: 'leather',
    quality: 'epic',
    stats: { armor: 150, agi: 11, sta: 6 },
    critRating: 25,
    hitRating: 60,
    sellValue: sell('proven'),
    buyValue: PRICE.proven,
  },
  riftwalkers_treads: {
    id: 'riftwalkers_treads',
    name: "Riftwalker's Treads",
    kind: 'armor',
    slot: 'feet',
    armorType: 'leather',
    quality: 'epic',
    stats: { armor: 145, agi: 11, sta: 6 },
    critRating: 60,
    hasteRating: 25,
    sellValue: sell('proven'),
    buyValue: PRICE.proven,
  },
  formula_riftwalkers_grace: {
    id: 'formula_riftwalkers_grace',
    name: "Formula: Riftwalker's Grace",
    kind: 'recipe',
    teachesRecipeId: 'enchant_weapon_riftwalkers_grace',
    teachesEnchantId: 'enchant_weapon_riftwalkers_grace',
    quality: 'epic',
    sellValue: 0,
    buyValue: PRICE.proven,
    noVendorSell: true,
  },
  // Vanguard: the game's first fast (1.6) non-dagger one-hander, on the heroic
  // five-man weapon bar (17.2 dps, FIVE_MAN_WEAPON_RATING 50), with a
  // chance-on-hit slow sized like Thronebane's Thunderclap.
  riftwarden_voidblade: {
    id: 'riftwarden_voidblade',
    name: "Riftwarden's Voidblade",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 22, max: 33, speed: 1.6 },
    stats: { agi: 13, sta: 8 },
    critRating: 50,
    sellValue: sell('vanguard'),
    buyValue: PRICE.vanguard,
    requiredClass: ['warrior', 'rogue', 'hunter', 'shaman'],
    weaponProcs: [
      {
        id: 'riftwarden_drag',
        name: 'Rift Drag',
        trigger: 'weaponHit',
        chance: 0.08,
        effects: [{ kind: 'attackSlow', name: 'Rift Drag', mult: 1.2, duration: 6 }],
      },
    ],
  },
  // Champion: the Agility jewels the raid never drops, at the raid jewel
  // budget (Seal of the Forgewall / Pendant of the First Tempering shapes).
  champion_rift_band: {
    id: 'champion_rift_band',
    name: "Champion's Rift Band",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    stats: { agi: 7, sta: 7 },
    hitRating: 25,
    sellValue: sell('champion'),
    buyValue: PRICE.champion,
  },
  riftwardens_pendant: {
    id: 'riftwardens_pendant',
    name: "Riftwarden's Pendant",
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    stats: { agi: 7, sta: 8 },
    critRating: 25,
    sellValue: sell('champion'),
    buyValue: PRICE.champion,
  },

  // ---------------------------------------------------------------- Church Order
  // Recognized: a caster-and-healer neck at the heroic vendor budget (the
  // Architect's Cornerstone shape with the line split evenly).
  order_prayer_beads: {
    id: 'order_prayer_beads',
    name: 'Order Prayer Beads',
    kind: 'armor',
    slot: 'neck',
    quality: 'rare',
    stats: { int: 6, spi: 5, sta: 4 },
    hasteRating: 25,
    sellValue: sell('recognized'),
    buyValue: PRICE.recognized,
  },
  // Trusted: the heroic vendor's caster ring shape (Zense Meridian).
  acolytes_signet: {
    id: 'acolytes_signet',
    name: "Acolyte's Signet",
    kind: 'armor',
    slot: 'ring',
    quality: 'rare',
    stats: { int: 7, spi: 5, sta: 4 },
    critRating: 25,
    sellValue: sell('trusted'),
    buyValue: PRICE.trusted,
  },
  // Proven: the heroic five-man cloth healer chest (Shroud of the Gravewyrm).
  vestments_of_the_acolyte: {
    id: 'vestments_of_the_acolyte',
    name: 'Vestments of the Acolyte',
    kind: 'armor',
    slot: 'chest',
    armorType: 'cloth',
    quality: 'rare',
    stats: { armor: 90, int: 12, spi: 10, sta: 7 },
    critRating: 40,
    sellValue: sell('proven'),
    buyValue: PRICE.proven,
  },
  // Proven: the raid offset cloth caster waist (Cord of the Last Flame) and
  // healer feet (Steps of Quiet Water).
  cord_of_the_dawn: {
    id: 'cord_of_the_dawn',
    name: 'Cord of the Dawn',
    kind: 'armor',
    slot: 'waist',
    armorType: 'cloth',
    quality: 'epic',
    stats: { armor: 75, int: 11, spi: 6, sta: 6 },
    spellPower: 4,
    critRating: 25,
    hitRating: 60,
    sellValue: sell('proven'),
    buyValue: PRICE.proven,
  },
  dawnlit_slippers: {
    id: 'dawnlit_slippers',
    name: 'Dawnlit Slippers',
    kind: 'armor',
    slot: 'feet',
    armorType: 'cloth',
    quality: 'epic',
    stats: { armor: 70, int: 8, spi: 8, sta: 5 },
    healPower: 8,
    critRating: 25,
    hasteRating: 60,
    sellValue: sell('proven'),
    buyValue: PRICE.proven,
  },
  formula_dawnfire_etching: {
    id: 'formula_dawnfire_etching',
    name: 'Formula: Dawnfire Etching',
    kind: 'recipe',
    teachesRecipeId: 'enchant_weapon_dawnfire_etching',
    teachesEnchantId: 'enchant_weapon_dawnfire_etching',
    quality: 'epic',
    sellValue: 0,
    buyValue: PRICE.proven,
    noVendorSell: true,
  },
  formula_dawns_benediction: {
    id: 'formula_dawns_benediction',
    name: "Formula: Dawn's Benediction",
    kind: 'recipe',
    teachesRecipeId: 'enchant_weapon_dawns_benediction',
    teachesEnchantId: 'enchant_weapon_dawns_benediction',
    quality: 'epic',
    sellValue: 0,
    buyValue: PRICE.proven,
    noVendorSell: true,
  },
  // Vanguard: a healer mace on the Springtouched Crozier's damage line with a
  // heal-triggered heal-over-time sized like Heartwood's Lifebloom, and a
  // healer shield one step under the Ember Warden's Barrier.
  dawnkeeper_consecrated_mace: {
    id: 'dawnkeeper_consecrated_mace',
    name: "Dawnkeeper's Consecrated Mace",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 33, max: 50, speed: 2.4 },
    stats: { int: 12, spi: 10, sta: 8 },
    healPower: 32,
    hasteRating: 50,
    sellValue: sell('vanguard'),
    buyValue: PRICE.vanguard,
    requiredClass: ['priest', 'paladin', 'shaman', 'druid'],
    weaponProcs: [
      {
        id: 'dawnkeeper_lingering_light',
        name: 'Lingering Light',
        trigger: 'heal',
        chance: 0.15,
        effects: [{ kind: 'hot', name: 'Lingering Light', perTick: 10, interval: 2, duration: 8 }],
      },
    ],
  },
  templar_dawn_shield: {
    id: 'templar_dawn_shield',
    name: "Templar's Dawn Shield",
    kind: 'armor',
    slot: 'offhand',
    armorType: 'mail',
    shield: true,
    blockValue: 22,
    quality: 'epic',
    stats: { armor: 680, int: 8, spi: 7, sta: 5 },
    healPower: 18,
    hasteRating: 20,
    sellValue: sell('vanguard'),
    buyValue: PRICE.vanguard,
    requiredClass: ['paladin', 'shaman'],
  },
  // Champion: a haste caster neck, and the SECOND caster and healer rings the
  // raid tier lacks (Circle of Cinders / Loop of Quiet Springs shapes).
  champion_dawn_medallion: {
    id: 'champion_dawn_medallion',
    name: "Champion's Dawn Medallion",
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    stats: { int: 9, spi: 6, sta: 5 },
    spellPower: 4,
    hasteRating: 25,
    sellValue: sell('champion'),
    buyValue: PRICE.champion,
  },
  champions_dawn_loop: {
    id: 'champions_dawn_loop',
    name: "Champion's Dawn Loop",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    stats: { int: 9, spi: 5, sta: 5 },
    spellPower: 4,
    critRating: 25,
    sellValue: sell('champion'),
    buyValue: PRICE.champion,
  },
  dawnkeepers_circle: {
    id: 'dawnkeepers_circle',
    name: "Dawnkeeper's Circle",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    stats: { int: 8, spi: 6, sta: 5 },
    healPower: 8,
    hasteRating: 25,
    sellValue: sell('champion'),
    buyValue: PRICE.champion,
  },

  // ------------------------------------------------------------------ Automatons
  // Recognized: the heroic vendor's Strength neck shape (Medallion of Endless Profit).
  cogwork_choker: {
    id: 'cogwork_choker',
    name: 'Cogwork Choker',
    kind: 'armor',
    slot: 'neck',
    quality: 'rare',
    stats: { str: 7, sta: 5 },
    critRating: 25,
    sellValue: sell('recognized'),
    buyValue: PRICE.recognized,
  },
  // Trusted: the heroic vendor's Strength ring shape (Seal of the Nine Oaths).
  automaton_cog_ring: {
    id: 'automaton_cog_ring',
    name: 'Automaton Cog Ring',
    kind: 'armor',
    slot: 'ring',
    quality: 'rare',
    stats: { str: 7, sta: 4 },
    hitRating: 25,
    sellValue: sell('trusted'),
    buyValue: PRICE.trusted,
  },
  clockwork_tinkers_pack: {
    id: 'clockwork_tinkers_pack',
    name: "Clockwork Tinker's Pack",
    kind: 'bag',
    bagSlots: 14,
    quality: 'uncommon',
    sellValue: sell('trusted'),
    buyValue: PRICE.trusted,
  },
  // Proven: the heroic five-man mail Strength helm (Cryptplate Helm).
  artificers_welding_cowl: {
    id: 'artificers_welding_cowl',
    name: "Artificer's Welding Cowl",
    kind: 'armor',
    slot: 'helmet',
    armorType: 'mail',
    quality: 'rare',
    stats: { armor: 292, str: 10, sta: 8 },
    hitRating: 40,
    sellValue: sell('proven'),
    buyValue: PRICE.proven,
  },
  // Proven: the raid offset mail Strength waist and feet (Warforged
  // Waistguard, Furnace March Greaves).
  forgemasters_girdle: {
    id: 'forgemasters_girdle',
    name: "Forgemaster's Girdle",
    kind: 'armor',
    slot: 'waist',
    armorType: 'mail',
    quality: 'epic',
    stats: { armor: 270, str: 11, sta: 6 },
    critRating: 25,
    hitRating: 60,
    sellValue: sell('proven'),
    buyValue: PRICE.proven,
  },
  forgemasters_sabatons: {
    id: 'forgemasters_sabatons',
    name: "Forgemaster's Sabatons",
    kind: 'armor',
    slot: 'feet',
    armorType: 'mail',
    quality: 'epic',
    stats: { armor: 255, str: 11, sta: 6 },
    critRating: 60,
    hasteRating: 25,
    sellValue: sell('proven'),
    buyValue: PRICE.proven,
  },
  formula_piston_drive: {
    id: 'formula_piston_drive',
    name: 'Formula: Piston Drive',
    kind: 'recipe',
    teachesRecipeId: 'enchant_weapon_piston_drive',
    teachesEnchantId: 'enchant_weapon_piston_drive',
    quality: 'epic',
    sellValue: 0,
    buyValue: PRICE.proven,
    noVendorSell: true,
  },
  // Vanguard: a two-hander on the heroic five-man two-hander bar (Deathless
  // Greatblade: 18.5 dps, 3.4 speed, str 18 sta 12) with a chance-on-hit
  // chain arc sized like Rimefang's Frostbite. Two-handed so the faction's
  // own Piston Drive formula has a home.
  forgemaster_crag_cleaver: {
    id: 'forgemaster_crag_cleaver',
    name: "Forgemaster's Crag Cleaver",
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'epic',
    weapon: { min: 50, max: 76, speed: 3.4 },
    stats: { str: 17, sta: 12 },
    critRating: 50,
    sellValue: sell('vanguard'),
    buyValue: PRICE.vanguard,
    requiredClass: ['warrior', 'paladin', 'shaman', 'hunter'],
    weaponProcs: [
      {
        id: 'forgemaster_piston_spark',
        name: 'Piston Spark',
        trigger: 'weaponHit',
        chance: 0.08,
        effects: [
          { kind: 'chainArc', school: 'fire', damage: 20, jumps: 0, falloff: 0.6, radius: 8 },
        ],
      },
    ],
  },
  // Champion: the stamina-line tank jewels no source drops (Stamina-first with
  // the raid jewel's one rating; blockValue is a shield-only field and armor
  // on jewelry would skew the /dev bis picker, so neither is used).
  champion_forged_loop: {
    id: 'champion_forged_loop',
    name: "Champion's Forged Loop",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    stats: { str: 4, sta: 10 },
    hitRating: 25,
    sellValue: sell('champion'),
    buyValue: PRICE.champion,
  },
  forgewall_gorget: {
    id: 'forgewall_gorget',
    name: 'Forgewall Gorget',
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    stats: { str: 3, sta: 12 },
    critRating: 25,
    sellValue: sell('champion'),
    buyValue: PRICE.champion,
  },
};

/** Every row a faction sells, in ladder order (the vendor window lists them so). */
export const FACTION_VENDOR_STOCK: Readonly<Record<FactionId, readonly string[]>> = Object.freeze({
  rift_watch: Object.freeze([
    'tidewatchers_locket',
    'rift_watchers_band',
    'rift_surveyors_satchel',
    'riftwalkers_tunic',
    'riftwalkers_cord',
    'riftwalkers_treads',
    'formula_riftwalkers_grace',
    'riftwarden_voidblade',
    'champion_rift_band',
    'riftwardens_pendant',
  ]),
  church_order: Object.freeze([
    'order_prayer_beads',
    'acolytes_signet',
    'vestments_of_the_acolyte',
    'cord_of_the_dawn',
    'dawnlit_slippers',
    'formula_dawnfire_etching',
    'formula_dawns_benediction',
    'dawnkeeper_consecrated_mace',
    'templar_dawn_shield',
    'champion_dawn_medallion',
    'champions_dawn_loop',
    'dawnkeepers_circle',
  ]),
  automatons: Object.freeze([
    'cogwork_choker',
    'automaton_cog_ring',
    'clockwork_tinkers_pack',
    'artificers_welding_cowl',
    'forgemasters_girdle',
    'forgemasters_sabatons',
    'formula_piston_drive',
    'forgemaster_crag_cleaver',
    'champion_forged_loop',
    'forgewall_gorget',
  ]),
});

/** The 3 Faction Quartermasters and the World Quest Taskmaster. */
export const FACTION_VENDOR_NPCS: Record<string, NpcDef> = {
  // Rift Watch Quartermaster: Drifthaven (palmreach)
  npc_rift_watch_quartermaster: {
    id: 'npc_rift_watch_quartermaster',
    name: 'Quartermaster Vaelen',
    title: 'Rift Watch Provisioner',
    pos: { x: -302, z: 812 },
    facing: 0.8,
    color: 0x4a7a9a,
    questIds: [],
    greeting:
      'The Rift Watch protects the shore and watches the deep tears. Our stores are open to those of recognized standing.',
    vendorItems: [...FACTION_VENDOR_STOCK.rift_watch],
  },

  // Church Order Quartermaster: Eastbrook Vale chapel (eastbrook_vale)
  npc_church_order_quartermaster: {
    id: 'npc_church_order_quartermaster',
    name: 'Templar Althea',
    title: 'Church Order Quartermaster',
    pos: { x: 8, z: -80 },
    facing: 3.14,
    color: 0xecd57a,
    questIds: [],
    greeting:
      'Walk in the Light of the Dawn. The Church Order supplies those who stand with us in service.',
    vendorItems: [...FACTION_VENDOR_STOCK.church_order],
  },

  // Automaton Quartermaster: Wyrmwatch (drakelands)
  npc_automaton_quartermaster: {
    id: 'npc_automaton_quartermaster',
    name: 'Artificer Tobrin',
    title: 'Automaton Requisitioner',
    pos: { x: 402, z: 1912 },
    facing: -0.4,
    color: 0xb87333,
    questIds: [],
    greeting:
      'Precision gears, forged steel, and calibrated power. Authorized operators may draw from our inventory.',
    vendorItems: [...FACTION_VENDOR_STOCK.automatons],
  },

  // World Quest Taskmaster: Eastbrook Vale central hub
  npc_wq_taskmaster: {
    id: 'npc_wq_taskmaster',
    name: 'Taskmaster Kaelen',
    title: 'World Quest Taskmaster',
    pos: { x: -5, z: -95 },
    facing: -2.1,
    color: 0x8a6a50,
    questIds: [],
    worldQuestBoard: true,
    greeting:
      'The allied factions post assignments across the realm every day. If an assignment does not suit your skills, you may request one daily reassignment.',
  },
};
