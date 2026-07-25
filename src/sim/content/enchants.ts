// Enchanting profession content (data-as-code, exempt from module-first size
// rules per root CLAUDE.md: this is a declarative table, not logic). The
// resolution logic lives in ../professions/enchanting.ts behind the
// SimContext seam.
//
// Scope: a two-tier enchant table, always known (no recipe learning; the
// free-floor rule in ../professions/enchanting.ts applies to both tiers):
//   1. Base enchants (arcane_dust, some arcane_essence): the per-slot basics.
//      They cover the weapon slot plus every armor slot (helmet through ring),
//      with several stat-axis options per slot so every build (str/agi/int
//      melee/caster, sta/armor tank, spi healer) has a reachable, cheap
//      enchant for each of its slots.
//   2. Greater enchants (arcane_shard + arcane_essence): a stronger,
//      shard-consuming top tier on the highest-impact slots (weapon, helmet,
//      chest, legs, gloves). These are the ONLY consumer of arcane_shard, the
//      material an epic/legendary disenchant yields
//      (DISENCHANT_MATERIAL_BY_QUALITY in ../professions/enchanting.ts);
//      without them a shard would be a dead-end currency with nothing to
//      spend it on.
// Magnitude convention (the finishing-bonus sizing, tuned against the level-20
// BiS gear budgets): a full set of enchants is roughly the last 15 to 25
// percent on top of best gear per stat axis, never a gear tier of its own
// (spirit, carried by only three slot types, sits just below that band, and
// armor rides its own point scale, halved alongside the rest). Base tier
// grants 2 to 4 primary points per slot (it is the aggregate driver, so it
// carries the tightest values; stamina sits at the low end because every
// point past 20 converts to 10 HP, see hpFromStamina in ../entity.ts).
// Greater is at least base+3 on the same slot and axis, today exactly +3
// everywhere (the arcane_shard premium has to stay a visible step or epics
// stop being worth disenchanting). Runed sits strictly between the base and
// Greater values where its slot and axis has both, and never reaches the
// Greater tier. Post-launch drift is tuned via reagent costs, never by
// re-touching these magnitudes (applied enchants bake their bonus into the
// item instance, so a magnitude nerf would not retro-apply).
// tests/enchants_magnitude_invariants.test.ts pins the per-axis stacks and the
// tier ladder shape.
//
// Every enchant grants a flat primary-stat or armor bonus (the only bonus
// categories recalcPlayerStats reads off an item instance's rolled.stats, see
// src/sim/entity.ts); a weapon-damage enchant is deliberately out of scope
// since damage rolls read the item DEFINITION's weapon.min/max, not
// per-instance data, and wiring that is a larger, separate change. `itemSlot`
// matches ItemDef['slot'] (see src/sim/types.ts): rings declare slot 'ring',
// every other slot names its EquipSlot directly, exactly as items do.
import type { ItemSlot } from '../types';

export interface EnchantReagent {
  itemId: string;
  count: number;
}

export interface EnchantDef {
  id: string;
  name: string;
  itemSlot: ItemSlot;
  reagents: readonly EnchantReagent[];
  statBonus: Partial<Record<'str' | 'agi' | 'sta' | 'int' | 'spi' | 'armor', number>>;
}

export const ENCHANTS: Record<string, EnchantDef> = {
  enchant_weapon_might: {
    id: 'enchant_weapon_might',
    name: 'Enchant Weapon - Might',
    itemSlot: 'mainhand',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { str: 2 },
  },
  // #1712 round-3 review: str-only weapon/gloves enchants gave casters (int)
  // zero offensive value from either slot. Same magnitude as the sibling
  // physical enchant on the same slot, just the int axis.
  enchant_weapon_intellect: {
    id: 'enchant_weapon_intellect',
    name: 'Enchant Weapon - Spellpower',
    itemSlot: 'mainhand',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { int: 2 },
  },
  enchant_helmet_fortitude: {
    id: 'enchant_helmet_fortitude',
    name: 'Enchant Helmet - Fortitude',
    itemSlot: 'helmet',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { sta: 3 },
  },
  enchant_neck_spirit: {
    id: 'enchant_neck_spirit',
    name: 'Enchant Necklace - Spirit',
    itemSlot: 'neck',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { spi: 3 },
  },
  enchant_shoulder_agility: {
    id: 'enchant_shoulder_agility',
    name: 'Enchant Shoulders - Agility',
    itemSlot: 'shoulder',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { agi: 2 },
  },
  enchant_chest_stamina: {
    id: 'enchant_chest_stamina',
    name: 'Enchant Chest - Stamina',
    itemSlot: 'chest',
    reagents: [
      { itemId: 'arcane_dust', count: 3 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { sta: 4 },
  },
  enchant_waist_stamina: {
    id: 'enchant_waist_stamina',
    name: 'Enchant Belt - Stamina',
    itemSlot: 'waist',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { sta: 3 },
  },
  enchant_legs_stamina: {
    id: 'enchant_legs_stamina',
    name: 'Enchant Legs - Stamina',
    itemSlot: 'legs',
    reagents: [
      { itemId: 'arcane_dust', count: 3 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { sta: 3 },
  },
  enchant_gloves_agility: {
    id: 'enchant_gloves_agility',
    name: 'Enchant Gloves - Agility',
    itemSlot: 'gloves',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { agi: 3 },
  },
  enchant_gloves_intellect: {
    id: 'enchant_gloves_intellect',
    name: 'Enchant Gloves - Spellpower',
    itemSlot: 'gloves',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { int: 3 },
  },
  enchant_feet_agility: {
    id: 'enchant_feet_agility',
    name: 'Enchant Boots - Agility',
    itemSlot: 'feet',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { agi: 2 },
  },
  enchant_ring_spirit: {
    id: 'enchant_ring_spirit',
    name: 'Enchant Ring - Spirit',
    itemSlot: 'ring',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { spi: 2 },
  },

  // --- Base-tier variety: extra stat-axis options so every build has a
  // reachable enchant for each of its slots (see the two-layer note above). ---

  // Weapon: an agility option alongside the existing str (Might) and int
  // (Spellpower), so a rogue/hunter weapon is not stuck taking a str enchant.
  enchant_weapon_agility: {
    id: 'enchant_weapon_agility',
    name: 'Enchant Weapon - Agility',
    itemSlot: 'mainhand',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { agi: 2 },
  },
  // Helmet: a caster (int) option and a tank (armor) option beside Fortitude.
  enchant_helmet_intellect: {
    id: 'enchant_helmet_intellect',
    name: 'Enchant Helmet - Intellect',
    itemSlot: 'helmet',
    reagents: [
      { itemId: 'arcane_dust', count: 3 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { int: 4 },
  },
  enchant_helmet_armor: {
    id: 'enchant_helmet_armor',
    name: 'Enchant Helmet - Reinforcement',
    itemSlot: 'helmet',
    reagents: [
      { itemId: 'arcane_dust', count: 3 },
      { itemId: 'arcane_essence', count: 1 },
    ],
    statBonus: { armor: 15 },
  },
  // Necklace: caster (int) and physical (agi) options beside Spirit.
  enchant_neck_intellect: {
    id: 'enchant_neck_intellect',
    name: 'Enchant Necklace - Intellect',
    itemSlot: 'neck',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { int: 2 },
  },
  enchant_neck_agility: {
    id: 'enchant_neck_agility',
    name: 'Enchant Necklace - Agility',
    itemSlot: 'neck',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { agi: 2 },
  },
  // Shoulders: melee (str) and caster (int) options beside Agility.
  enchant_shoulder_strength: {
    id: 'enchant_shoulder_strength',
    name: 'Enchant Shoulders - Strength',
    itemSlot: 'shoulder',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { str: 2 },
  },
  enchant_shoulder_intellect: {
    id: 'enchant_shoulder_intellect',
    name: 'Enchant Shoulders - Intellect',
    itemSlot: 'shoulder',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { int: 2 },
  },
  // Chest: a healer (spi) option and a tank (armor) option beside Stamina.
  enchant_chest_spirit: {
    id: 'enchant_chest_spirit',
    name: 'Enchant Chest - Spirit',
    itemSlot: 'chest',
    reagents: [
      { itemId: 'arcane_dust', count: 3 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { spi: 4 },
  },
  enchant_chest_armor: {
    id: 'enchant_chest_armor',
    name: 'Enchant Chest - Reinforcement',
    itemSlot: 'chest',
    reagents: [
      { itemId: 'arcane_dust', count: 3 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { armor: 20 },
  },
  // Belt: melee (str) and physical (agi) options beside Stamina.
  enchant_waist_strength: {
    id: 'enchant_waist_strength',
    name: 'Enchant Belt - Strength',
    itemSlot: 'waist',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { str: 3 },
  },
  enchant_waist_agility: {
    id: 'enchant_waist_agility',
    name: 'Enchant Belt - Agility',
    itemSlot: 'waist',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { agi: 3 },
  },
  // Legs: a caster (int) option beside Stamina.
  enchant_legs_intellect: {
    id: 'enchant_legs_intellect',
    name: 'Enchant Legs - Intellect',
    itemSlot: 'legs',
    reagents: [
      { itemId: 'arcane_dust', count: 3 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { int: 4 },
  },
  // Gloves: a melee (str) option beside the existing agi and int.
  enchant_gloves_strength: {
    id: 'enchant_gloves_strength',
    name: 'Enchant Gloves - Strength',
    itemSlot: 'gloves',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { str: 3 },
  },
  // Boots: a melee (str) option and a tank (sta) option beside Agility.
  enchant_feet_strength: {
    id: 'enchant_feet_strength',
    name: 'Enchant Boots - Strength',
    itemSlot: 'feet',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { str: 2 },
  },
  enchant_feet_stamina: {
    id: 'enchant_feet_stamina',
    name: 'Enchant Boots - Stamina',
    itemSlot: 'feet',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { sta: 2 },
  },
  // Ring: str/agi/int options beside Spirit (a ring takes exactly one, and
  // ItemDef.slot 'ring' covers both ring1 and ring2 via resolveEquipSlot).
  enchant_ring_strength: {
    id: 'enchant_ring_strength',
    name: 'Enchant Ring - Strength',
    itemSlot: 'ring',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { str: 2 },
  },
  enchant_ring_agility: {
    id: 'enchant_ring_agility',
    name: 'Enchant Ring - Agility',
    itemSlot: 'ring',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { agi: 2 },
  },
  enchant_ring_intellect: {
    id: 'enchant_ring_intellect',
    name: 'Enchant Ring - Intellect',
    itemSlot: 'ring',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { int: 2 },
  },

  // --- Greater tier: the top-end enchants on the highest-impact slots, and the
  // ONLY sink for arcane_shard (the epic/legendary disenchant yield). Each costs
  // 1 shard plus arcane_essence; a modest step up on the same axis as its base. ---
  enchant_weapon_greater_might: {
    id: 'enchant_weapon_greater_might',
    name: 'Enchant Weapon - Greater Might',
    itemSlot: 'mainhand',
    reagents: [
      { itemId: 'arcane_shard', count: 1 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { str: 5 },
  },
  enchant_weapon_greater_spellpower: {
    id: 'enchant_weapon_greater_spellpower',
    name: 'Enchant Weapon - Greater Spellpower',
    itemSlot: 'mainhand',
    reagents: [
      { itemId: 'arcane_shard', count: 1 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { int: 5 },
  },
  enchant_helmet_greater_fortitude: {
    id: 'enchant_helmet_greater_fortitude',
    name: 'Enchant Helmet - Greater Fortitude',
    itemSlot: 'helmet',
    reagents: [
      { itemId: 'arcane_shard', count: 1 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { sta: 6 },
  },
  enchant_chest_greater_stamina: {
    id: 'enchant_chest_greater_stamina',
    name: 'Enchant Chest - Greater Stamina',
    itemSlot: 'chest',
    reagents: [
      { itemId: 'arcane_shard', count: 1 },
      { itemId: 'arcane_essence', count: 3 },
    ],
    statBonus: { sta: 7 },
  },
  enchant_legs_greater_stamina: {
    id: 'enchant_legs_greater_stamina',
    name: 'Enchant Legs - Greater Stamina',
    itemSlot: 'legs',
    reagents: [
      { itemId: 'arcane_shard', count: 1 },
      { itemId: 'arcane_essence', count: 3 },
    ],
    statBonus: { sta: 6 },
  },
  enchant_gloves_greater_agility: {
    id: 'enchant_gloves_greater_agility',
    name: 'Enchant Gloves - Greater Agility',
    itemSlot: 'gloves',
    reagents: [
      { itemId: 'arcane_shard', count: 1 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { agi: 6 },
  },

  // --- Runed tier (Professions 2.0): the ONLY sink for the typed
  // disenchant secondaries (resonant_steel/timber/thread/hide/links,
  // src/sim/professions/disenchant_reagents.ts), so no typed material is a
  // dead-end currency. Each costs arcane_essence x2 plus one typed reagent and
  // sits BETWEEN the base and Greater magnitude on its slot+axis, never above
  // the Greater value there (a rare-sourced step, not the shard-sourced top
  // tier). One consumer per material: steel->runed_edge, timber->runed_focus,
  // thread->runeweave, hide->runed_hide, links->runed_links. ---
  enchant_weapon_runed_edge: {
    id: 'enchant_weapon_runed_edge',
    name: 'Enchant Weapon - Runed Edge',
    itemSlot: 'mainhand',
    reagents: [
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'resonant_steel', count: 1 },
    ],
    statBonus: { str: 3 },
  },
  enchant_weapon_runed_focus: {
    id: 'enchant_weapon_runed_focus',
    name: 'Enchant Weapon - Runed Sigil',
    itemSlot: 'mainhand',
    reagents: [
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'resonant_timber', count: 1 },
    ],
    statBonus: { int: 3 },
  },
  enchant_chest_runeweave: {
    id: 'enchant_chest_runeweave',
    name: 'Enchant Chest - Runed Weave',
    itemSlot: 'chest',
    reagents: [
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'resonant_thread', count: 1 },
    ],
    statBonus: { spi: 5 },
  },
  enchant_legs_runed_hide: {
    id: 'enchant_legs_runed_hide',
    name: 'Enchant Legs - Runed Hide',
    itemSlot: 'legs',
    reagents: [
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'resonant_hide', count: 1 },
    ],
    statBonus: { agi: 4 },
  },
  enchant_helmet_runed_links: {
    id: 'enchant_helmet_runed_links',
    name: 'Enchant Helmet - Runed Links',
    itemSlot: 'helmet',
    reagents: [
      { itemId: 'arcane_essence', count: 2 },
      { itemId: 'resonant_links', count: 1 },
    ],
    statBonus: { sta: 5 },
  },
};
