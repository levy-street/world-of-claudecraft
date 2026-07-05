import type { ItemDef, PlayerClass } from '../../types';

// Archetype groups, mirrors the pattern in content/items.ts so class-locked
// delve rewards admit the whole archetype (warrior/paladin/shaman etc.).
const WAR: PlayerClass[] = ['warrior', 'paladin', 'shaman'];
const MAG: PlayerClass[] = ['mage', 'priest', 'warlock', 'druid'];
const ROG: PlayerClass[] = ['rogue', 'hunter'];

// ---------------------------------------------------------------------------
// Delve items, Collapsed Reliquary loot & Marks vendor stock
// ---------------------------------------------------------------------------
//
// Tuned to sit a clear notch ABOVE the silver-vendor armor of the same tier so
// running the delve is worth it. Smith Haldren's commons (levels 3-7) are the
// baseline: chainmail vest 60 armor / leather jerkin 40 / cloth robe 22 / wool
// trousers 24, all plain white with no stats. Each delve piece below is the
// uncommon-or-rare upgrade in that slot: more armor PLUS stat bonuses, and a
// higher sellValue than the common it replaces (greens are worth more silver
// than the whites they outclass). Marks prices live in shop.ts.
// ---------------------------------------------------------------------------

export const DELVE_ITEMS: Record<string, ItemDef> = {
  // --- uncommon (green) drops ---
  reliquary_plate_chest: {
    id: 'reliquary_plate_chest',
    name: 'Reliquary Guard Hauberk',
    kind: 'armor',
    armorType: 'mail',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 90, sta: 2, str: 1 },
    sellValue: 240,
    requiredClass: WAR,
  },
  reliquary_leather_chest: {
    id: 'reliquary_leather_chest',
    name: 'Dustwarden Jerkin',
    kind: 'armor',
    armorType: 'leather',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 55, agi: 2, sta: 1 },
    sellValue: 215,
    requiredClass: ROG,
  },
  reliquary_cloth_chest: {
    id: 'reliquary_cloth_chest',
    name: 'Shroud of the Reliquary',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'chest',
    quality: 'uncommon',
    stats: { armor: 30, int: 2, spi: 1 },
    sellValue: 205,
    requiredClass: MAG,
  },
  reliquary_legs: {
    id: 'reliquary_legs',
    name: 'Vaultbound Legwraps',
    kind: 'armor',
    armorType: 'cloth',
    slot: 'legs',
    quality: 'uncommon',
    stats: { armor: 48, sta: 2 },
    sellValue: 195,
  },
  reliquary_helm: {
    id: 'reliquary_helm',
    name: 'Ossuary Watch Helm',
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'uncommon',
    stats: { armor: 48, sta: 2, str: 1 },
    sellValue: 220,
    requiredClass: WAR,
  },
  reliquary_shoulder: {
    id: 'reliquary_shoulder',
    name: 'Crumbled Spaulders',
    kind: 'armor',
    armorType: 'mail',
    slot: 'shoulder',
    quality: 'uncommon',
    stats: { armor: 36, sta: 2 },
    sellValue: 175,
  },
  reliquary_gloves_rog: {
    id: 'reliquary_gloves_rog',
    name: 'Bonewarden Grips',
    kind: 'armor',
    armorType: 'leather',
    slot: 'gloves',
    quality: 'uncommon',
    stats: { armor: 36, agi: 2, sta: 1 },
    sellValue: 190,
    requiredClass: ROG,
  },
  // --- rare (blue) signature drops, Heroic-gated ---
  deacon_reliquary_helm: {
    id: 'deacon_reliquary_helm',
    name: "Deacon's Reliquary Helm",
    kind: 'armor',
    armorType: 'mail',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 105, sta: 4, str: 3 },
    sellValue: 540,
    requiredClass: WAR,
  },
  varric_shadow_cowl: {
    id: 'varric_shadow_cowl',
    name: "Varric's Shadow Cowl",
    kind: 'armor',
    armorType: 'cloth',
    slot: 'helmet',
    quality: 'rare',
    stats: { armor: 42, int: 4, spi: 3 },
    sellValue: 540,
    requiredClass: MAG,
  },
};
