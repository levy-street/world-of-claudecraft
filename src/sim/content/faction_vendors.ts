// Faction Quartermasters, Reroll NPC, and standing-gated vendor inventory.
// Deterministic simulation content leaf: pure data structures and gate resolution.
// Zero RNG, zero wall-clock, zero DOM/Three.js imports.

import type { FactionId, StandingTier } from '../factions';
import { STANDING_THRESHOLDS } from '../factions';
import type { ItemDef, NpcDef } from '../types';

export interface FactionVendorGate {
  readonly factionId?: FactionId;
  readonly standingTier: StandingTier;
  readonly requiredStanding: number;
  readonly currencyCost: number;
}

/** Gate requirements for every faction-stocked item. */
export const FACTION_VENDOR_GATES: Readonly<Record<string, FactionVendorGate>> = Object.freeze({
  // Rift Watch
  rift_watchers_band: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'recognized',
    requiredStanding: STANDING_THRESHOLDS.recognized,
    currencyCost: 15,
  }),
  rift_surveyors_satchel: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'trusted',
    requiredStanding: STANDING_THRESHOLDS.trusted,
    currencyCost: 35,
  }),
  rift_feather_glider: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'trusted',
    requiredStanding: STANDING_THRESHOLDS.trusted,
    currencyCost: 40,
  }),
  riftwalkers_tunic: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
    currencyCost: 75,
  }),
  formula_enchant_feet_shadowstride: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
    currencyCost: 50,
  }),
  recipe_potion_of_invisibility: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
    currencyCost: 50,
  }),
  pattern_reinforced_armor_kit: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
    currencyCost: 50,
  }),
  riftwarden_voidblade: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'vanguard',
    requiredStanding: STANDING_THRESHOLDS.vanguard,
    currencyCost: 150,
  }),
  champion_rift_band: Object.freeze({
    factionId: 'rift_watch',
    standingTier: 'champion',
    requiredStanding: STANDING_THRESHOLDS.champion,
    currencyCost: 200,
  }),

  // Church Order
  order_prayer_beads: Object.freeze({
    factionId: 'church_order',
    standingTier: 'recognized',
    requiredStanding: STANDING_THRESHOLDS.recognized,
    currencyCost: 15,
  }),
  vestments_of_the_acolyte: Object.freeze({
    factionId: 'church_order',
    standingTier: 'trusted',
    requiredStanding: STANDING_THRESHOLDS.trusted,
    currencyCost: 35,
  }),
  dawn_battle_standard: Object.freeze({
    factionId: 'church_order',
    standingTier: 'trusted',
    requiredStanding: STANDING_THRESHOLDS.trusted,
    currencyCost: 40,
  }),
  templar_dawn_shield: Object.freeze({
    factionId: 'church_order',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
    currencyCost: 75,
  }),
  formula_enchant_offhand_spirit: Object.freeze({
    factionId: 'church_order',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
    currencyCost: 50,
  }),
  recipe_elixir_of_mana_regeneration: Object.freeze({
    factionId: 'church_order',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
    currencyCost: 50,
  }),
  dawnkeeper_consecrated_mace: Object.freeze({
    factionId: 'church_order',
    standingTier: 'vanguard',
    requiredStanding: STANDING_THRESHOLDS.vanguard,
    currencyCost: 150,
  }),
  champion_dawn_medallion: Object.freeze({
    factionId: 'church_order',
    standingTier: 'champion',
    requiredStanding: STANDING_THRESHOLDS.champion,
    currencyCost: 200,
  }),

  // Automatons
  automaton_cog_ring: Object.freeze({
    factionId: 'automatons',
    standingTier: 'recognized',
    requiredStanding: STANDING_THRESHOLDS.recognized,
    currencyCost: 15,
  }),
  clockwork_tinkers_pack: Object.freeze({
    factionId: 'automatons',
    standingTier: 'trusted',
    requiredStanding: STANDING_THRESHOLDS.trusted,
    currencyCost: 35,
  }),
  clockwork_target_dummy: Object.freeze({
    factionId: 'automatons',
    standingTier: 'trusted',
    requiredStanding: STANDING_THRESHOLDS.trusted,
    currencyCost: 40,
  }),
  artificers_welding_cowl: Object.freeze({
    factionId: 'automatons',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
    currencyCost: 75,
  }),
  schematic_clockwork_shock_bomb: Object.freeze({
    factionId: 'automatons',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
    currencyCost: 50,
  }),
  plans_dense_sharpening_stone: Object.freeze({
    factionId: 'automatons',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
    currencyCost: 50,
  }),
  formula_enchant_gloves_forged_might: Object.freeze({
    factionId: 'automatons',
    standingTier: 'proven',
    requiredStanding: STANDING_THRESHOLDS.proven,
    currencyCost: 50,
  }),
  forgemaster_crag_cleaver: Object.freeze({
    factionId: 'automatons',
    standingTier: 'vanguard',
    requiredStanding: STANDING_THRESHOLDS.vanguard,
    currencyCost: 150,
  }),
  champion_forged_loop: Object.freeze({
    factionId: 'automatons',
    standingTier: 'champion',
    requiredStanding: STANDING_THRESHOLDS.champion,
    currencyCost: 200,
  }),

  // Allied Cross-Faction Vanguard Rewards
  // Cartographer's Ink (content/treasure_maps.ts): stocked by all three, paid
  // in the active quartermaster's currency, open from the first standing tier.
  cartographers_ink: Object.freeze({
    standingTier: 'recognized',
    requiredStanding: STANDING_THRESHOLDS.recognized,
    currencyCost: 60,
  }),
  allied_hearthstone: Object.freeze({
    standingTier: 'vanguard',
    requiredStanding: STANDING_THRESHOLDS.vanguard,
    currencyCost: 100,
  }),
  allied_vanguard_duffel: Object.freeze({
    standingTier: 'vanguard',
    requiredStanding: STANDING_THRESHOLDS.vanguard,
    currencyCost: 120,
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
  const currentStanding = requirement.factionId
    ? (factions?.[requirement.factionId] ?? 0)
    : Math.max(0, ...(Object.values(factions ?? {}) as number[]));
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
    buyValue: 0,
  },
  rift_surveyors_satchel: {
    id: 'rift_surveyors_satchel',
    name: "Rift Surveyor's Satchel",
    kind: 'bag',
    bagSlots: 12,
    quality: 'uncommon',
    sellValue: 3750,
    buyValue: 0,
  },
  rift_feather_glider: {
    id: 'rift_feather_glider',
    name: 'Rift Feather Glider',
    kind: 'tool',
    quality: 'rare',
    unique: true,
    use: { type: 'riftGlider' },
    sellValue: 6250,
    buyValue: 0,
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
    buyValue: 0,
  },
  formula_enchant_feet_shadowstride: {
    id: 'formula_enchant_feet_shadowstride',
    name: 'Formula: Enchant Boots - Shadowstride',
    kind: 'recipe',
    quality: 'uncommon',
    teachesRecipeId: 'enchant_feet_shadowstride',
    teachesEnchantId: 'enchant_feet_shadowstride',
    sellValue: 10000,
    buyValue: 0,
  },
  recipe_potion_of_invisibility: {
    id: 'recipe_potion_of_invisibility',
    name: 'Recipe: Potion of Invisibility',
    kind: 'recipe',
    quality: 'rare',
    teachesRecipeId: 'recipe_potion_of_invisibility',
    sellValue: 10000,
    buyValue: 0,
  },
  potion_of_invisibility: {
    id: 'potion_of_invisibility',
    name: 'Potion of Invisibility',
    kind: 'potion',
    quality: 'rare',
    use: { type: 'invisibility' },
    stackSize: 20,
    sellValue: 35,
    buyValue: 150,
  },
  pattern_reinforced_armor_kit: {
    id: 'pattern_reinforced_armor_kit',
    name: 'Pattern: Reinforced Armor Kit',
    kind: 'recipe',
    quality: 'uncommon',
    teachesRecipeId: 'pattern_reinforced_armor_kit',
    sellValue: 10000,
    buyValue: 0,
  },
  reinforced_armor_kit: {
    id: 'reinforced_armor_kit',
    name: 'Reinforced Armor Kit',
    kind: 'tool',
    quality: 'uncommon',
    use: { type: 'armorKit' },
    stackSize: 20,
    sellValue: 30,
    buyValue: 120,
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
    buyValue: 0,
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
    buyValue: 0,
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
    buyValue: 0,
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
    buyValue: 0,
  },
  dawn_battle_standard: {
    id: 'dawn_battle_standard',
    name: 'Dawn Battle Standard',
    kind: 'tool',
    quality: 'rare',
    unique: true,
    use: { type: 'dawnStandard' },
    sellValue: 6250,
    buyValue: 0,
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
    buyValue: 0,
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
  formula_enchant_offhand_spirit: {
    id: 'formula_enchant_offhand_spirit',
    name: 'Formula: Enchant Off-Hand - Spirit',
    kind: 'recipe',
    quality: 'uncommon',
    teachesRecipeId: 'enchant_offhand_spirit',
    teachesEnchantId: 'enchant_offhand_spirit',
    sellValue: 10000,
    buyValue: 0,
  },
  recipe_elixir_of_mana_regeneration: {
    id: 'recipe_elixir_of_mana_regeneration',
    name: 'Recipe: Elixir of Mana Regeneration',
    kind: 'recipe',
    quality: 'uncommon',
    teachesRecipeId: 'recipe_elixir_of_mana_regeneration',
    sellValue: 10000,
    buyValue: 0,
  },
  elixir_of_mana_regeneration: {
    id: 'elixir_of_mana_regeneration',
    name: 'Elixir of Mana Regeneration',
    kind: 'potion',
    quality: 'uncommon',
    use: { type: 'manaElixir' },
    stackSize: 20,
    sellValue: 20,
    buyValue: 100,
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
    buyValue: 0,
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
    buyValue: 0,
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
    buyValue: 0,
  },
  clockwork_tinkers_pack: {
    id: 'clockwork_tinkers_pack',
    name: "Clockwork Tinker's Pack",
    kind: 'bag',
    bagSlots: 12,
    quality: 'uncommon',
    sellValue: 3750,
    buyValue: 0,
  },
  clockwork_target_dummy: {
    id: 'clockwork_target_dummy',
    name: 'Clockwork Target Dummy',
    kind: 'tool',
    quality: 'rare',
    unique: true,
    use: { type: 'targetDummy' },
    sellValue: 6250,
    buyValue: 0,
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
    buyValue: 0,
  },
  schematic_clockwork_shock_bomb: {
    id: 'schematic_clockwork_shock_bomb',
    name: 'Schematic: Clockwork Shock Bomb',
    kind: 'recipe',
    quality: 'rare',
    teachesRecipeId: 'schematic_clockwork_shock_bomb',
    sellValue: 10000,
    buyValue: 0,
  },
  clockwork_shock_bomb: {
    id: 'clockwork_shock_bomb',
    name: 'Clockwork Shock Bomb',
    kind: 'tool',
    quality: 'rare',
    use: { type: 'shockBomb' },
    stackSize: 10,
    sellValue: 25,
    buyValue: 100,
  },
  plans_dense_sharpening_stone: {
    id: 'plans_dense_sharpening_stone',
    name: 'Plans: Dense Sharpening Stone',
    kind: 'recipe',
    quality: 'uncommon',
    teachesRecipeId: 'plans_dense_sharpening_stone',
    sellValue: 10000,
    buyValue: 0,
  },
  dense_sharpening_stone: {
    id: 'dense_sharpening_stone',
    name: 'Dense Sharpening Stone',
    kind: 'tool',
    quality: 'common',
    use: { type: 'sharpeningStone' },
    stackSize: 20,
    sellValue: 20,
    buyValue: 80,
  },
  formula_enchant_gloves_forged_might: {
    id: 'formula_enchant_gloves_forged_might',
    name: 'Formula: Enchant Gloves - Forged Might',
    kind: 'recipe',
    quality: 'uncommon',
    teachesRecipeId: 'enchant_gloves_forged_might',
    teachesEnchantId: 'enchant_gloves_forged_might',
    sellValue: 10000,
    buyValue: 0,
  },
  forgemaster_crag_cleaver: {
    id: 'forgemaster_crag_cleaver',
    name: "Forgemaster's Crag Cleaver",
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 26, max: 48, speed: 2.4 },
    stats: { sta: 6, str: 6 },
    critRating: 7,
    sellValue: 25000,
    buyValue: 0,
  },
  champion_forged_loop: {
    id: 'champion_forged_loop',
    name: "Champion's Forged Loop",
    kind: 'armor',
    slot: 'ring',
    quality: 'epic',
    stats: { sta: 7, str: 7 },
    critRating: 8,
    hasteRating: 6,
    sellValue: 37500,
    buyValue: 0,
  },

  // --- Allied Cross-Faction Vanguard Rewards ---
  allied_hearthstone: {
    id: 'allied_hearthstone',
    name: 'Allied Hearthstone',
    kind: 'tool',
    quality: 'rare',
    unique: true,
    use: { type: 'alliedHearthstone' },
    sellValue: 20000,
    buyValue: 0,
  },
  allied_vanguard_duffel: {
    id: 'allied_vanguard_duffel',
    name: 'Allied Vanguard Duffel',
    kind: 'bag',
    bagSlots: 16,
    quality: 'epic',
    unique: true,
    sellValue: 20000,
    buyValue: 0,
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
      'rift_feather_glider',
      'riftwalkers_tunic',
      'formula_enchant_feet_shadowstride',
      'recipe_potion_of_invisibility',
      'pattern_reinforced_armor_kit',
      'riftwarden_voidblade',
      'cartographers_ink',
      'allied_hearthstone',
      'allied_vanguard_duffel',
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
      'dawn_battle_standard',
      'templar_dawn_shield',
      'formula_enchant_offhand_spirit',
      'recipe_elixir_of_mana_regeneration',
      'dawnkeeper_consecrated_mace',
      'cartographers_ink',
      'allied_hearthstone',
      'allied_vanguard_duffel',
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
      'clockwork_target_dummy',
      'artificers_welding_cowl',
      'schematic_clockwork_shock_bomb',
      'plans_dense_sharpening_stone',
      'formula_enchant_gloves_forged_might',
      'forgemaster_crag_cleaver',
      'cartographers_ink',
      'allied_hearthstone',
      'allied_vanguard_duffel',
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

/** Teleport arrival destinations for the Allied Hearthstone. */
export const FACTION_HUB_LANDINGS: Readonly<
  Record<
    FactionId,
    {
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly facing: number;
      readonly name: string;
    }
  >
> = Object.freeze({
  church_order: Object.freeze({ x: 8, y: 0, z: -80, facing: 3.14, name: 'Eastbrook Vale' }),
  rift_watch: Object.freeze({ x: -302, y: 0, z: 812, facing: 0.8, name: 'Drifthaven' }),
  automatons: Object.freeze({ x: 402, y: 0, z: 1912, facing: -0.4, name: 'Wyrmwatch' }),
});

/** Return the faction associated with a quartermaster NPC template, if any. */
export function vendorFactionForNpc(templateId?: string): FactionId | undefined {
  if (templateId === 'npc_rift_watch_quartermaster') return 'rift_watch';
  if (templateId === 'npc_church_order_quartermaster') return 'church_order';
  if (templateId === 'npc_automaton_quartermaster') return 'automatons';
  return undefined;
}
