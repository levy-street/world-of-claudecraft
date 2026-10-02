import type { ItemDef } from '../types';

// Katanas: one-handed curved swords sold by Armorer Hode in Highwatch
// (zone3.ts). Held models are the procedural
// scripts/assets/katana/build_katana.mjs set, mapped in
// src/ui/weapon_variants.ts. Numbers are copied from existing swords of the
// same tier rather than invented: the white from Highwatch Warblade, the blue
// from Fogbinder's Edge (re-statted to agility), the purple from Riftwarden's
// Voidblade.
export const KATANA_ITEMS: Record<string, ItemDef> = {
  katana_a: {
    id: 'katana_a',
    name: 'Blossom Katana',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'common',
    weapon: { min: 15, max: 24, speed: 2.3 },
    sellValue: 600,
    buyValue: 6000,
  },
  katana_b: {
    id: 'katana_b',
    name: 'Moonsteel Katana',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'rare',
    weapon: { min: 14, max: 23, speed: 2.3 },
    stats: { agi: 4, sta: 3 },
    sellValue: 1200,
    buyValue: 12000,
  },
  katana_c: {
    id: 'katana_c',
    name: 'Crimson Petal Katana',
    kind: 'weapon',
    slot: 'mainhand',
    quality: 'epic',
    weapon: { min: 22, max: 33, speed: 1.6 },
    stats: { agi: 13, sta: 8 },
    critRating: 50,
    requiredLevel: 20,
    soulbound: true,
    sellValue: 2500,
    buyValue: 50000,
    requiredClass: ['warrior', 'rogue', 'hunter', 'shaman'],
  },
};

