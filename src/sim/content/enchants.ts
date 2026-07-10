// Enchanting profession content (data-as-code, exempt from module-first size
// rules per root CLAUDE.md: this is a declarative table, not logic). The
// resolution logic lives in ../professions/enchanting.ts behind the
// SimContext seam.
//
// Scope (v1): one simple, always-known enchant per equippable item slot,
// covering the weapon slot plus every armor slot (helmet through ring).
// Each grants a flat primary-stat or armor bonus (the only bonus categories
// recalcPlayerStats reads off an item instance's rolled.stats, see
// src/sim/entity.ts); a weapon-damage enchant is deliberately out of scope
// for v1 since damage rolls read the item DEFINITION's weapon.min/max, not
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
    statBonus: { str: 5 },
  },
  // #1712 round-3 review: str-only weapon/gloves enchants gave casters (int)
  // zero offensive value from either slot. Same magnitude as the sibling
  // physical enchant on the same slot, just the int axis.
  enchant_weapon_intellect: {
    id: 'enchant_weapon_intellect',
    name: 'Enchant Weapon - Spellpower',
    itemSlot: 'mainhand',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { int: 5 },
  },
  enchant_helmet_fortitude: {
    id: 'enchant_helmet_fortitude',
    name: 'Enchant Helmet - Fortitude',
    itemSlot: 'helmet',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { sta: 8 },
  },
  enchant_neck_spirit: {
    id: 'enchant_neck_spirit',
    name: 'Enchant Necklace - Spirit',
    itemSlot: 'neck',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { spi: 5 },
  },
  enchant_shoulder_agility: {
    id: 'enchant_shoulder_agility',
    name: 'Enchant Shoulders - Agility',
    itemSlot: 'shoulder',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { agi: 5 },
  },
  enchant_chest_stamina: {
    id: 'enchant_chest_stamina',
    name: 'Enchant Chest - Stamina',
    itemSlot: 'chest',
    reagents: [
      { itemId: 'arcane_dust', count: 3 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { sta: 10 },
  },
  enchant_waist_stamina: {
    id: 'enchant_waist_stamina',
    name: 'Enchant Belt - Stamina',
    itemSlot: 'waist',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { sta: 6 },
  },
  enchant_legs_stamina: {
    id: 'enchant_legs_stamina',
    name: 'Enchant Legs - Stamina',
    itemSlot: 'legs',
    reagents: [
      { itemId: 'arcane_dust', count: 3 },
      { itemId: 'arcane_essence', count: 2 },
    ],
    statBonus: { sta: 8 },
  },
  enchant_gloves_agility: {
    id: 'enchant_gloves_agility',
    name: 'Enchant Gloves - Agility',
    itemSlot: 'gloves',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { agi: 6 },
  },
  enchant_gloves_intellect: {
    id: 'enchant_gloves_intellect',
    name: 'Enchant Gloves - Spellpower',
    itemSlot: 'gloves',
    reagents: [{ itemId: 'arcane_dust', count: 5 }],
    statBonus: { int: 6 },
  },
  enchant_feet_agility: {
    id: 'enchant_feet_agility',
    name: 'Enchant Boots - Agility',
    itemSlot: 'feet',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { agi: 4 },
  },
  enchant_ring_spirit: {
    id: 'enchant_ring_spirit',
    name: 'Enchant Ring - Spirit',
    itemSlot: 'ring',
    reagents: [{ itemId: 'arcane_dust', count: 3 }],
    statBonus: { spi: 4 },
  },
};
