import type { ProfessionDef, ProfessionId, HarvestNodeDef, RecipeDef } from '../types';

// ---------------------------------------------------------------------------
// Professions: the declarative data for the gathering + crafting system. Two
// gathering professions feed two crafting ones (Mining -> Blacksmithing,
// Herbalism -> Alchemy); smelting ore into bars is itself a Mining recipe.
// reqSkill is the orange (guaranteed skill-up) threshold; grey is where the
// node/recipe stops granting points. Every itemId referenced here (node yield,
// recipe reagent, recipe output) is defined in PROFESSION_ITEMS. Skill range is
// 1..PROFESSION_SKILL_MAX (=225). No engine logic lives here (see CLAUDE.md).
//
// Node positions mirror existing camp coordinates per zone so they land on
// walkable terrain: zone 1 (Eastbrook) z 0..180, zone 2 (Mirefen) z 180..540,
// zone 3 (Thornpeak) z 540..900; x roughly -150..150.
// ---------------------------------------------------------------------------

export const PROFESSIONS: Record<ProfessionId, ProfessionDef> = {
  mining: {
    id: 'mining',
    name: 'Mining',
    kind: 'gathering',
    blurb: 'Prospect ore veins and smelt the metal into bars for the smiths.',
  },
  herbalism: {
    id: 'herbalism',
    name: 'Herbalism',
    kind: 'gathering',
    blurb: 'Gather wild herbs and reagents for the alchemists of the realm.',
  },
  blacksmithing: {
    id: 'blacksmithing',
    name: 'Blacksmithing',
    kind: 'crafting',
    blurb: 'Forge bars into weapons and mail armor at the anvil.',
    feedsFrom: 'mining',
  },
  alchemy: {
    id: 'alchemy',
    name: 'Alchemy',
    kind: 'crafting',
    blurb: 'Brew herbs into healing potions and battle elixirs.',
    feedsFrom: 'herbalism',
  },
};

export const HARVEST_NODES: HarvestNodeDef[] = [
  // --- Mining: ore veins ---------------------------------------------------
  {
    id: 'copper_vein',
    name: 'Copper Vein',
    profession: 'mining',
    reqSkill: 1,
    grey: 75,
    look: 'vein',
    yields: [{ itemId: 'copper_ore', min: 1, max: 2 }],
    respawnSec: 60,
    // Zone 1 (Eastbrook), near the boar/bandit/wolf camps.
    positions: [
      { x: 60, z: 18 },
      { x: 85, z: -10 },
      { x: 70, z: -60 },
      { x: 95, z: -85 },
      { x: -55, z: 10 },
      { x: -80, z: -55 },
    ],
  },
  {
    id: 'tin_vein',
    name: 'Tin Vein',
    profession: 'mining',
    reqSkill: 50,
    grey: 125,
    look: 'vein',
    yields: [{ itemId: 'tin_ore', min: 1, max: 2 }],
    respawnSec: 60,
    // Zone 2 (Mirefen), near the prowler and murloc camps.
    positions: [
      { x: -38, z: 232 },
      { x: 38, z: 226 },
      { x: -78, z: 270 },
      { x: 68, z: 302 },
      { x: -118, z: 352 },
      { x: 92, z: 342 },
    ],
  },
  {
    id: 'iron_vein',
    name: 'Iron Deposit',
    profession: 'mining',
    reqSkill: 100,
    grey: 175,
    look: 'vein',
    yields: [{ itemId: 'iron_ore', min: 1, max: 2 }],
    respawnSec: 75,
    // Zone 2 (Mirefen), deeper marsh near the troll and drowned camps.
    positions: [
      { x: -82, z: 422 },
      { x: -104, z: 456 },
      { x: 90, z: 422 },
      { x: 114, z: 452 },
      { x: 14, z: 470 },
      { x: -120, z: 480 },
    ],
  },
  {
    id: 'silver_vein',
    name: 'Silver Vein',
    profession: 'mining',
    reqSkill: 125,
    grey: 200,
    look: 'vein',
    // Silver occasionally yields a small bonus nugget.
    yields: [
      { itemId: 'silver_ore', min: 1, max: 2 },
      { itemId: 'silver_ore', min: 1, max: 1, chance: 0.2 },
    ],
    respawnSec: 80,
    // Zone 3 (Thornpeak), near the kobold and stalker camps.
    positions: [
      { x: -48, z: 592 },
      { x: 46, z: 602 },
      { x: 76, z: 624 },
      { x: 104, z: 600 },
      { x: -80, z: 576 },
    ],
  },
  {
    id: 'mithril_vein',
    name: 'Mithril Deposit',
    profession: 'mining',
    reqSkill: 175,
    grey: 225,
    look: 'vein',
    // Mithril occasionally yields a small bonus chunk.
    yields: [
      { itemId: 'mithril_ore', min: 1, max: 2 },
      { itemId: 'mithril_ore', min: 1, max: 1, chance: 0.2 },
    ],
    respawnSec: 90,
    // Zone 3 (Thornpeak), high near the elemental, ogre and revenant camps.
    positions: [
      { x: 110, z: 762 },
      { x: 134, z: 794 },
      { x: -88, z: 700 },
      { x: -62, z: 730 },
      { x: -40, z: 830 },
      { x: 56, z: 820 },
    ],
  },

  // --- Herbalism: herbs ----------------------------------------------------
  {
    id: 'peacebloom',
    name: 'Peacebloom',
    profession: 'herbalism',
    reqSkill: 1,
    grey: 50,
    look: 'herb',
    yields: [{ itemId: 'peacebloom', min: 1, max: 2 }],
    respawnSec: 45,
    // Zone 1 (Eastbrook), open meadows near the wolf camps.
    positions: [
      { x: -12, z: 52 },
      { x: 22, z: 68 },
      { x: -40, z: 35 },
      { x: 40, z: 40 },
      { x: 5, z: 90 },
    ],
  },
  {
    id: 'silverleaf',
    name: 'Silverleaf',
    profession: 'herbalism',
    reqSkill: 1,
    grey: 50,
    look: 'herb',
    yields: [{ itemId: 'silverleaf', min: 1, max: 2 }],
    respawnSec: 45,
    // Zone 1 (Eastbrook), wooded edges near the spider and rat camps.
    positions: [
      { x: -58, z: 8 },
      { x: -78, z: -58 },
      { x: -72, z: 54 },
      { x: 18, z: 72 },
      { x: 52, z: 14 },
    ],
  },
  {
    id: 'earthroot',
    name: 'Earthroot',
    profession: 'herbalism',
    reqSkill: 15,
    grey: 75,
    look: 'herb',
    yields: [{ itemId: 'earthroot', min: 1, max: 2 }],
    respawnSec: 50,
    // Zone 1 (Eastbrook), rocky ground near the boar and bandit camps.
    positions: [
      { x: 58, z: -56 },
      { x: 88, z: -88 },
      { x: 78, z: 12 },
      { x: 82, z: 76 },
      { x: -82, z: -60 },
    ],
  },
  {
    id: 'mageroyal',
    name: 'Mageroyal',
    profession: 'herbalism',
    reqSkill: 50,
    grey: 125,
    look: 'herb',
    yields: [{ itemId: 'mageroyal', min: 1, max: 2 }],
    respawnSec: 55,
    // Zone 2 (Mirefen), near the prowler and widow camps.
    positions: [
      { x: -42, z: 228 },
      { x: 34, z: 224 },
      { x: 72, z: 298 },
      { x: 94, z: 338 },
      { x: -84, z: 272 },
    ],
  },
  {
    id: 'briarthorn',
    name: 'Briarthorn',
    profession: 'herbalism',
    reqSkill: 70,
    grey: 150,
    look: 'herb',
    yields: [{ itemId: 'briarthorn', min: 1, max: 2 }],
    respawnSec: 60,
    // Zone 2 (Mirefen), thorny banks near the troll and cultist camps.
    positions: [
      { x: -78, z: 418 },
      { x: -106, z: 454 },
      { x: 16, z: 468 },
      { x: -24, z: 488 },
      { x: 112, z: 442 },
    ],
  },
  {
    id: 'kingsblood',
    name: 'Kingsblood',
    profession: 'herbalism',
    reqSkill: 125,
    grey: 200,
    look: 'herb',
    yields: [{ itemId: 'kingsblood', min: 1, max: 2 }],
    respawnSec: 70,
    // Zone 3 (Thornpeak), near the stalker and ogre camps.
    positions: [
      { x: -52, z: 588 },
      { x: 44, z: 598 },
      { x: -90, z: 702 },
      { x: -58, z: 728 },
      { x: 74, z: 622 },
    ],
  },
  {
    id: 'liferoot',
    name: 'Liferoot',
    profession: 'herbalism',
    reqSkill: 150,
    grey: 225,
    look: 'herb',
    yields: [{ itemId: 'liferoot', min: 1, max: 2 }],
    respawnSec: 80,
    // Zone 3 (Thornpeak), high near the elemental, zealot and revenant camps.
    positions: [
      { x: 108, z: 758 },
      { x: 132, z: 792 },
      { x: 54, z: 822 },
      { x: 26, z: 844 },
      { x: -42, z: 828 },
    ],
  },
];

export const RECIPES: RecipeDef[] = [
  // --- Smelting (profession:'mining'): ore -> bar --------------------------
  {
    id: 'smelt_copper_bar',
    profession: 'mining',
    reqSkill: 1,
    grey: 75,
    output: { itemId: 'copper_bar', count: 1 },
    reagents: [{ itemId: 'copper_ore', count: 1 }],
  },
  {
    id: 'smelt_tin_bar',
    profession: 'mining',
    reqSkill: 50,
    grey: 125,
    output: { itemId: 'tin_bar', count: 1 },
    reagents: [{ itemId: 'tin_ore', count: 1 }],
  },
  {
    id: 'smelt_bronze_bar',
    profession: 'mining',
    reqSkill: 65,
    grey: 140,
    output: { itemId: 'bronze_bar', count: 2 },
    reagents: [
      { itemId: 'copper_bar', count: 1 },
      { itemId: 'tin_bar', count: 1 },
    ],
  },
  {
    id: 'smelt_iron_bar',
    profession: 'mining',
    reqSkill: 100,
    grey: 175,
    output: { itemId: 'iron_bar', count: 1 },
    reagents: [{ itemId: 'iron_ore', count: 1 }],
  },
  {
    id: 'smelt_silver_bar',
    profession: 'mining',
    reqSkill: 125,
    grey: 200,
    output: { itemId: 'silver_bar', count: 1 },
    reagents: [{ itemId: 'silver_ore', count: 1 }],
  },
  {
    id: 'smelt_mithril_bar',
    profession: 'mining',
    reqSkill: 175,
    grey: 225,
    output: { itemId: 'mithril_bar', count: 1 },
    reagents: [{ itemId: 'mithril_ore', count: 1 }],
  },

  // --- Blacksmithing (profession:'blacksmithing'): bars -> gear ------------
  // reqSkill matches each item's tier; grey = reqSkill + 50 (capped at 225);
  // more bars per item at higher tiers.
  {
    id: 'craft_rough_copper_dagger',
    profession: 'blacksmithing',
    reqSkill: 1,
    grey: 51,
    output: { itemId: 'rough_copper_dagger', count: 1 },
    reagents: [{ itemId: 'copper_bar', count: 4 }],
  },
  {
    id: 'craft_copper_mace',
    profession: 'blacksmithing',
    reqSkill: 15,
    grey: 65,
    output: { itemId: 'copper_mace', count: 1 },
    reagents: [{ itemId: 'copper_bar', count: 5 }],
  },
  {
    id: 'craft_copper_chainmail',
    profession: 'blacksmithing',
    reqSkill: 30,
    grey: 80,
    output: { itemId: 'copper_chainmail', count: 1 },
    reagents: [{ itemId: 'copper_bar', count: 6 }],
  },
  {
    id: 'craft_bronze_axe',
    profession: 'blacksmithing',
    reqSkill: 65,
    grey: 115,
    output: { itemId: 'bronze_axe', count: 1 },
    reagents: [{ itemId: 'bronze_bar', count: 6 }],
  },
  {
    id: 'craft_bronze_greaves',
    profession: 'blacksmithing',
    reqSkill: 85,
    grey: 135,
    output: { itemId: 'bronze_greaves', count: 1 },
    reagents: [{ itemId: 'bronze_bar', count: 8 }],
  },
  {
    id: 'craft_iron_sword',
    profession: 'blacksmithing',
    reqSkill: 100,
    grey: 150,
    output: { itemId: 'iron_sword', count: 1 },
    reagents: [{ itemId: 'iron_bar', count: 8 }],
  },
  {
    id: 'craft_iron_helm',
    profession: 'blacksmithing',
    reqSkill: 120,
    grey: 170,
    output: { itemId: 'iron_helm', count: 1 },
    reagents: [{ itemId: 'iron_bar', count: 8 }],
  },
  {
    id: 'craft_mithril_blade',
    profession: 'blacksmithing',
    reqSkill: 175,
    grey: 225,
    output: { itemId: 'mithril_blade', count: 1 },
    reagents: [{ itemId: 'mithril_bar', count: 10 }],
  },
  {
    id: 'craft_mithril_breastplate',
    profession: 'blacksmithing',
    reqSkill: 195,
    grey: 225,
    output: { itemId: 'mithril_breastplate', count: 1 },
    reagents: [{ itemId: 'mithril_bar', count: 10 }],
  },
  {
    id: 'craft_mithril_greaves',
    profession: 'blacksmithing',
    reqSkill: 210,
    grey: 225,
    output: { itemId: 'mithril_greaves', count: 1 },
    reagents: [{ itemId: 'mithril_bar', count: 10 }],
  },

  // --- Alchemy (profession:'alchemy'): herbs -> consumables ----------------
  // reqSkill by tier; grey = reqSkill + 50 (capped at 225); 1-2 herbs each.
  {
    id: 'craft_minor_healing_potion',
    profession: 'alchemy',
    reqSkill: 1,
    grey: 51,
    output: { itemId: 'minor_healing_potion_crafted', count: 1 },
    reagents: [{ itemId: 'peacebloom', count: 1 }],
  },
  {
    id: 'craft_minor_mana_potion',
    profession: 'alchemy',
    reqSkill: 1,
    grey: 51,
    output: { itemId: 'minor_mana_potion_crafted', count: 1 },
    reagents: [{ itemId: 'silverleaf', count: 1 }],
  },
  {
    id: 'craft_lesser_healing_potion',
    profession: 'alchemy',
    reqSkill: 50,
    grey: 100,
    output: { itemId: 'lesser_healing_potion_crafted', count: 1 },
    reagents: [
      { itemId: 'mageroyal', count: 1 },
      { itemId: 'silverleaf', count: 1 },
    ],
  },
  {
    id: 'craft_healing_potion',
    profession: 'alchemy',
    reqSkill: 100,
    grey: 150,
    output: { itemId: 'healing_potion_crafted', count: 1 },
    reagents: [
      { itemId: 'briarthorn', count: 1 },
      { itemId: 'mageroyal', count: 1 },
    ],
  },
  {
    id: 'craft_greater_healing_potion',
    profession: 'alchemy',
    reqSkill: 150,
    grey: 200,
    output: { itemId: 'greater_healing_potion', count: 1 },
    reagents: [
      { itemId: 'liferoot', count: 1 },
      { itemId: 'kingsblood', count: 1 },
    ],
  },
  {
    id: 'craft_elixir_of_minor_fortitude',
    profession: 'alchemy',
    reqSkill: 30,
    grey: 80,
    output: { itemId: 'elixir_of_minor_fortitude', count: 1 },
    reagents: [{ itemId: 'earthroot', count: 1 }],
  },
  {
    id: 'craft_elixir_of_lions_strength',
    profession: 'alchemy',
    reqSkill: 70,
    grey: 120,
    output: { itemId: 'elixir_of_lions_strength', count: 1 },
    reagents: [{ itemId: 'briarthorn', count: 1 }],
  },
  {
    id: 'craft_elixir_of_agility',
    profession: 'alchemy',
    reqSkill: 125,
    grey: 175,
    output: { itemId: 'elixir_of_agility', count: 1 },
    reagents: [{ itemId: 'kingsblood', count: 1 }],
  },
  {
    id: 'craft_elixir_of_wisdom',
    profession: 'alchemy',
    reqSkill: 140,
    grey: 190,
    output: { itemId: 'elixir_of_wisdom', count: 1 },
    reagents: [
      { itemId: 'mageroyal', count: 1 },
      { itemId: 'kingsblood', count: 1 },
    ],
  },
  {
    id: 'craft_elixir_of_fortitude',
    profession: 'alchemy',
    reqSkill: 175,
    grey: 225,
    output: { itemId: 'elixir_of_fortitude', count: 1 },
    reagents: [{ itemId: 'liferoot', count: 1 }],
  },
];
