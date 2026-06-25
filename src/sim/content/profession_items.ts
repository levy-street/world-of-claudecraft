import type { ItemDef } from '../types';

// ---------------------------------------------------------------------------
// Profession items: gathering materials (ores, bars, herbs) plus the gear and
// consumables the crafting professions produce. Materials are kind:'material'
// (stackable, vendorable, never equippable). Crafted gear is uncommon and not
// vendor-bought (no buyValue); crafted consumables mirror the BASE_ITEMS
// potion/elixir budgets. sellValue (copper) scales with tier. No engine logic
// lives here, just declarative data (see content/CLAUDE.md).
// ---------------------------------------------------------------------------

export const PROFESSION_ITEMS: Record<string, ItemDef> = {
  // --- Mining: ores (raw vein yield) ---------------------------------------
  copper_ore: {
    id: 'copper_ore',
    name: 'Copper Ore',
    kind: 'material',
    quality: 'common',
    sellValue: 2,
  },
  tin_ore: {
    id: 'tin_ore',
    name: 'Tin Ore',
    kind: 'material',
    quality: 'common',
    sellValue: 3,
  },
  iron_ore: {
    id: 'iron_ore',
    name: 'Iron Ore',
    kind: 'material',
    quality: 'common',
    sellValue: 5,
  },
  silver_ore: {
    id: 'silver_ore',
    name: 'Silver Ore',
    kind: 'material',
    quality: 'common',
    sellValue: 6,
  },
  mithril_ore: {
    id: 'mithril_ore',
    name: 'Mithril Ore',
    kind: 'material',
    quality: 'common',
    sellValue: 8,
  },
  // --- Mining: bars (smelted from ore) -------------------------------------
  copper_bar: {
    id: 'copper_bar',
    name: 'Copper Bar',
    kind: 'material',
    quality: 'common',
    sellValue: 5,
  },
  tin_bar: {
    id: 'tin_bar',
    name: 'Tin Bar',
    kind: 'material',
    quality: 'common',
    sellValue: 6,
  },
  bronze_bar: {
    id: 'bronze_bar',
    name: 'Bronze Bar',
    kind: 'material',
    quality: 'common',
    sellValue: 8,
  },
  iron_bar: {
    id: 'iron_bar',
    name: 'Iron Bar',
    kind: 'material',
    quality: 'common',
    sellValue: 10,
  },
  silver_bar: {
    id: 'silver_bar',
    name: 'Silver Bar',
    kind: 'material',
    quality: 'common',
    sellValue: 12,
  },
  mithril_bar: {
    id: 'mithril_bar',
    name: 'Mithril Bar',
    kind: 'material',
    quality: 'common',
    sellValue: 15,
  },
  // --- Herbalism: herbs (raw plant yield) ----------------------------------
  peacebloom: {
    id: 'peacebloom',
    name: 'Peacebloom',
    kind: 'material',
    quality: 'common',
    sellValue: 2,
  },
  silverleaf: {
    id: 'silverleaf',
    name: 'Silverleaf',
    kind: 'material',
    quality: 'common',
    sellValue: 2,
  },
  earthroot: {
    id: 'earthroot',
    name: 'Earthroot',
    kind: 'material',
    quality: 'common',
    sellValue: 3,
  },
  mageroyal: {
    id: 'mageroyal',
    name: 'Mageroyal',
    kind: 'material',
    quality: 'common',
    sellValue: 5,
  },
  briarthorn: {
    id: 'briarthorn',
    name: 'Briarthorn',
    kind: 'material',
    quality: 'common',
    sellValue: 6,
  },
  kingsblood: {
    id: 'kingsblood',
    name: 'Kingsblood',
    kind: 'material',
    quality: 'common',
    sellValue: 8,
  },
  liferoot: {
    id: 'liferoot',
    name: 'Liferoot',
    kind: 'material',
    quality: 'common',
    sellValue: 10,
  },

  // --- Blacksmithing: crafted weapons + mail armor -------------------------
  // Stats track the same-tier dropped/vendor budgets in items.ts: copper sits
  // at worn/eastbrook common tier, bronze at the Eastbrook-uncommon band, iron
  // at the zone-2 uncommon band, mithril at the zone-3 rare-adjacent band. Mail
  // armor uses the chest~60-95 / legs~70 / helm~45 empirical convention.
  rough_copper_dagger: {
    id: 'rough_copper_dagger',
    name: 'Rough Copper Dagger',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 3, max: 6, speed: 1.8, dagger: true },
    stats: { agi: 1 },
    sellValue: 40,
  },
  copper_mace: {
    id: 'copper_mace',
    name: 'Copper Mace',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 5, max: 9, speed: 2.6 },
    stats: { str: 1 },
    sellValue: 50,
  },
  copper_chainmail: {
    id: 'copper_chainmail',
    name: 'Copper Chainmail',
    kind: 'armor',
    slot: 'chest',
    armorType: 'mail',
    quality: 'uncommon',
    stats: { armor: 60, sta: 2 },
    sellValue: 60,
  },
  bronze_axe: {
    id: 'bronze_axe',
    name: 'Bronze Battle Axe',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 8, max: 14, speed: 2.5 },
    stats: { str: 2, sta: 1 },
    sellValue: 110,
  },
  bronze_greaves: {
    id: 'bronze_greaves',
    name: 'Bronze Greaves',
    kind: 'armor',
    slot: 'legs',
    armorType: 'mail',
    quality: 'uncommon',
    stats: { armor: 70, sta: 2, str: 1 },
    sellValue: 120,
  },
  iron_sword: {
    id: 'iron_sword',
    name: 'Iron Longsword',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 10, max: 16, speed: 2.4 },
    stats: { str: 3, sta: 1 },
    sellValue: 180,
  },
  iron_helm: {
    id: 'iron_helm',
    name: 'Iron Helm',
    kind: 'armor',
    slot: 'helmet',
    armorType: 'mail',
    quality: 'uncommon',
    stats: { armor: 55, sta: 3 },
    sellValue: 160,
  },
  mithril_blade: {
    id: 'mithril_blade',
    name: 'Mithril Blade',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'uncommon',
    weapon: { min: 12, max: 19, speed: 2.5 },
    stats: { str: 4, sta: 2 },
    sellValue: 280,
  },
  mithril_breastplate: {
    id: 'mithril_breastplate',
    name: 'Mithril Breastplate',
    kind: 'armor',
    slot: 'chest',
    armorType: 'mail',
    quality: 'uncommon',
    stats: { armor: 110, sta: 4, str: 2 },
    sellValue: 300,
  },
  mithril_greaves: {
    id: 'mithril_greaves',
    name: 'Mithril Greaves',
    kind: 'armor',
    slot: 'legs',
    armorType: 'mail',
    quality: 'uncommon',
    stats: { armor: 90, sta: 3, str: 2 },
    sellValue: 260,
  },

  // --- Alchemy: crafted healing/mana potions -------------------------------
  // potionHp/potionMana mirror the BASE_ITEMS combat-potion ladder (minor 90,
  // lesser 150, standard 280, greater 420). Instant, in-combat, shared cooldown
  // rules are engine-side; this is just the item def.
  minor_healing_potion_crafted: {
    id: 'minor_healing_potion_crafted',
    name: 'Crafted Minor Healing Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 90,
    sellValue: 6,
  },
  minor_mana_potion_crafted: {
    id: 'minor_mana_potion_crafted',
    name: 'Crafted Minor Mana Potion',
    kind: 'potion',
    quality: 'common',
    potionMana: 120,
    sellValue: 6,
  },
  lesser_healing_potion_crafted: {
    id: 'lesser_healing_potion_crafted',
    name: 'Crafted Lesser Healing Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 150,
    sellValue: 14,
  },
  healing_potion_crafted: {
    id: 'healing_potion_crafted',
    name: 'Crafted Healing Potion',
    kind: 'potion',
    quality: 'common',
    potionHp: 280,
    sellValue: 28,
  },
  greater_healing_potion: {
    id: 'greater_healing_potion',
    name: 'Greater Healing Potion',
    kind: 'potion',
    quality: 'uncommon',
    potionHp: 420,
    sellValue: 40,
  },

  // --- Alchemy: crafted battle elixirs -------------------------------------
  // Temporary stat-buff auras on use (see ItemDef.elixir), modeled on
  // elixir_of_the_bear (buff_sta 12 / 900s). Stat buffs map to the matching
  // AuraKind: buff_sta, buff_agi, buff_int. There is no dedicated strength
  // AuraKind, so Lion's Strength grants the all-stats buff at a small value.
  elixir_of_minor_fortitude: {
    id: 'elixir_of_minor_fortitude',
    name: 'Elixir of Minor Fortitude',
    kind: 'elixir',
    quality: 'common',
    elixir: { aura: 'Minor Fortitude', kind: 'buff_sta', value: 6, duration: 600 },
    sellValue: 10,
  },
  elixir_of_lions_strength: {
    id: 'elixir_of_lions_strength',
    name: "Elixir of Lion's Strength",
    kind: 'elixir',
    quality: 'common',
    elixir: { aura: "Lion's Strength", kind: 'buff_allstats', value: 4, duration: 900 },
    sellValue: 14,
  },
  elixir_of_agility: {
    id: 'elixir_of_agility',
    name: 'Elixir of Agility',
    kind: 'elixir',
    quality: 'common',
    elixir: { aura: 'Agility', kind: 'buff_agi', value: 8, duration: 900 },
    sellValue: 18,
  },
  elixir_of_wisdom: {
    id: 'elixir_of_wisdom',
    name: 'Elixir of Wisdom',
    kind: 'elixir',
    quality: 'common',
    elixir: { aura: 'Wisdom', kind: 'buff_int', value: 8, duration: 900 },
    sellValue: 22,
  },
  elixir_of_fortitude: {
    id: 'elixir_of_fortitude',
    name: 'Elixir of Fortitude',
    kind: 'elixir',
    quality: 'uncommon',
    elixir: { aura: 'Fortitude', kind: 'buff_sta', value: 14, duration: 1800 },
    sellValue: 32,
  },
};
