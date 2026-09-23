// Faction Quartermasters, Reroll NPC, and standing-gated vendor inventory.
// Deterministic simulation content leaf: pure data structures and gate resolution.
// Zero RNG, zero wall-clock, zero DOM/Three.js imports.

import type { FactionId, StandingTier } from '../factions';
import { STANDING_THRESHOLDS } from '../factions';
import type { ItemDef, NpcDef } from '../types';

export interface FactionVendorGate {
  readonly factionId: FactionId;
  readonly standingTier: StandingTier;
  readonly requiredStanding: number;
}

/** Gate requirements for every faction-stocked item. */
export const FACTION_VENDOR_GATES: Readonly<Record<string, FactionVendorGate>> = Object.freeze({
  // Rift Watch
  rift_watchers_band: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'recognized',
    requiredStanding: STANDING_THRESHOLDS.recognized,
  }),
  rift_surveyors_satchel: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'trusted',
    requiredStanding: STANDING_THRESHOLDS.trusted,
  }),
  riftwalkers_tunic: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
  }),
  riftwarden_voidblade: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'vanguard',
    requiredStanding: STANDING_THRESHOLDS.vanguard,
  }),
  champion_rift_band: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'champion',
    requiredStanding: STANDING_THRESHOLDS.champion,
  }),

  // Church Order
  order_prayer_beads: Object.freeze({
    factionId: 'church_order',
    standingTier: 'recognized',
    requiredStanding: STANDING_THRESHOLDS.recognized,
  }),
  vestments_of_the_acolyte: Object.freeze({
    factionId: 'church_order',
    standingTier: 'trusted',
    requiredStanding: STANDING_THRESHOLDS.trusted,
  }),
  templar_dawn_shield: Object.freeze({
    factionId: 'church_order',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
  }),
  dawnkeeper_consecrated_mace: Object.freeze({
    factionId: 'church_order',
    standingTier: 'vanguard',
    requiredStanding: STANDING_THRESHOLDS.vanguard,
  }),
  champion_dawn_medallion: Object.freeze({
    factionId: 'church_order',
    standingTier: 'champion',
    requiredStanding: STANDING_THRESHOLDS.champion,
  }),

  // Automatons
  automaton_cog_ring: Object.freeze({
    factionId: 'automatons',
    standingTier: 'recognized',
    requiredStanding: STANDING_THRESHOLDS.recognized,
  }),
  clockwork_tinkers_pack: Object.freeze({
    factionId: 'automatons',
    standingTier: 'trusted',
    requiredStanding: STANDING_THRESHOLDS.trusted,
  }),
  artificers_welding_cowl: Object.freeze({
    factionId: 'automatons',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
  }),
  forgemaster_crag_cleaver: Object.freeze({
    factionId: 'automatons',
    standingTier: 'vanguard',
    requiredStanding: STANDING_THRESHOLDS.vanguard,
  }),
  champion_forged_loop: Object.freeze({
    factionId: 'automatons',
    standingTier: 'champion',
    requiredStanding: STANDING_THRESHOLDS.champion,
  }),
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

/** The 15 faction vendor items (5 tiers × 3 factions). */
export const FACTION_VENDOR_ITEMS: Record<string, ItemDef> = {
  // --- Rift Watch ---
  rift_watchers_band: {
    id: 'rift_watchers_band',
    name: "Rift Watcher's Band",
    kind: 'armor',
    slot: 'ring',
    quality: 'uncommon',
    stats: { agi: 1, sta: 1 },
    sellValue: 1250,
    buyValue: 5000,
  },
  rift_surveyors_satchel: {
    id: 'rift_surveyors_satchel',
    name: "Rift Surveyor's Satchel",
    kind: 'bag',
    bagSlots: 12,
    quality: 'uncommon',
    sellValue: 3750,
    buyValue: 15000,
  },
  riftwalkers_tunic: {
    id: 'riftwalkers_tunic',
    name: "Riftwalker's Tunic",
    kind: 'armor',
    slot: 'chest',
    armorType: 'leather',
    quality: 'rare',
    stats: { armor: 48, sta: 6, agi: 5, str: 4 },
    sellValue: 8750,
    buyValue: 35000,
  },
  riftwarden_voidblade: {
    id: 'riftwarden_voidblade',
    name: "Riftwarden's Voidblade",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 26, max: 48, speed: 2.4 },
    stats: { sta: 8, agi: 7 },
    critRating: 12,
    sellValue: 20000,
    buyValue: 80000,
    requiredClass: ['warrior', 'rogue', 'hunter', 'shaman', 'paladin'],
  },
  champion_rift_band: {
    id: 'champion_rift_band',
    name: "Champion's Rift Band",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    stats: { sta: 6, int: 6 },
    spellPower: 12,
    critRating: 6,
    sellValue: 37500,
    buyValue: 150000,
  },

  // --- Church Order ---
  order_prayer_beads: {
    id: 'order_prayer_beads',
    name: 'Order Prayer Beads',
    kind: 'armor',
    slot: 'neck',
    quality: 'uncommon',
    stats: { spi: 1, sta: 1 },
    sellValue: 1250,
    buyValue: 5000,
  },
  vestments_of_the_acolyte: {
    id: 'vestments_of_the_acolyte',
    name: 'Vestments of the Acolyte',
    kind: 'armor',
    slot: 'chest',
    armorType: 'cloth',
    quality: 'rare',
    stats: { armor: 42, sta: 5, int: 5, spi: 4 },
    sellValue: 3750,
    buyValue: 15000,
  },
  templar_dawn_shield: {
    id: 'templar_dawn_shield',
    name: "Templar's Dawn Shield",
    kind: 'armor',
    slot: 'offhand',
    armorType: 'mail',
    shield: true,
    blockValue: 24,
    quality: 'rare',
    stats: { armor: 110, sta: 7, str: 5 },
    sellValue: 8750,
    buyValue: 35000,
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  dawnkeeper_consecrated_mace: {
    id: 'dawnkeeper_consecrated_mace',
    name: "Dawnkeeper's Consecrated Mace",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 25, max: 47, speed: 2.3 },
    stats: { sta: 8, spi: 7 },
    spellPower: 15,
    healPower: 15,
    sellValue: 20000,
    buyValue: 80000,
    requiredClass: ['mage', 'priest', 'warlock', 'shaman', 'paladin', 'druid'],
  },
  champion_dawn_medallion: {
    id: 'champion_dawn_medallion',
    name: "Champion's Dawn Medallion",
    kind: 'armor',
    slot: 'neck',
    quality: 'epic',
    stats: { sta: 6, spi: 6 },
    spellPower: 12,
    hasteRating: 6,
    sellValue: 37500,
    buyValue: 150000,
  },

  // --- Automatons ---
  automaton_cog_ring: {
    id: 'automaton_cog_ring',
    name: 'Automaton Cog Ring',
    kind: 'armor',
    slot: 'ring',
    quality: 'uncommon',
    stats: { str: 1, sta: 1 },
    sellValue: 1250,
    buyValue: 5000,
  },
  clockwork_tinkers_pack: {
    id: 'clockwork_tinkers_pack',
    name: "Clockwork Tinker's Pack",
    kind: 'bag',
    bagSlots: 12,
    quality: 'uncommon',
    sellValue: 3750,
    buyValue: 15000,
  },
  artificers_welding_cowl: {
    id: 'artificers_welding_cowl',
    name: "Artificer's Welding Cowl",
    kind: 'armor',
    slot: 'helmet',
    armorType: 'mail',
    quality: 'rare',
    stats: { armor: 60, sta: 6, agi: 6 },
    critRating: 6,
    sellValue: 8750,
    buyValue: 35000,
  },
  forgemaster_crag_cleaver: {
    id: 'forgemaster_crag_cleaver',
    name: "Forgemaster's Crag Cleaver",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 28, max: 52, speed: 2.6 },
    stats: { sta: 8, str: 8 },
    critRating: 10,
    sellValue: 20000,
    buyValue: 80000,
    requiredClass: ['warrior', 'rogue', 'hunter', 'shaman', 'paladin'],
  },
  champion_forged_loop: {
    id: 'champion_forged_loop',
    name: "Champion's Forged Loop",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    stats: { sta: 6, str: 6 },
    critRating: 8,
    hasteRating: 6,
    sellValue: 37500,
    buyValue: 150000,
  },
};

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
    vendorItems: [
      'rift_watchers_band',
      'rift_surveyors_satchel',
      'riftwalkers_tunic',
      'riftwarden_voidblade',
      'champion_rift_band',
    ],
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
    vendorItems: [
      'order_prayer_beads',
      'vestments_of_the_acolyte',
      'templar_dawn_shield',
      'dawnkeeper_consecrated_mace',
      'champion_dawn_medallion',
    ],
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
    vendorItems: [
      'automaton_cog_ring',
      'clockwork_tinkers_pack',
      'artificers_welding_cowl',
      'forgemaster_crag_cleaver',
      'champion_forged_loop',
    ],
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
