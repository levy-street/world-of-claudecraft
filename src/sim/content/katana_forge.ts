// The Katana Table at the Blossom Temple grove: data only. A katana copy
// carries its own look (blade, guard, wrap and scabbard colors, an engraved
// kanji, and the player-chosen name in ItemInstancePayload.name) plus a kill
// count, and evolves up the existing katana tiers (katana_a -> katana_b ->
// katana_c) at the table. Evolution only ever swaps to an EXISTING item id, so
// stats always come from those defs (content/katanas.ts); the look is cosmetic.
// The rules that read this table live in src/sim/katana_forge.ts.
import { BLOSSOM_TRAINING_MAT } from './blossom_temple';

/** The table stands in the courtyard, beside Swordsmith Ren (content/katanas.ts). */
export const KATANA_TABLE = { x: 316.5, z: 1062 };
/** How close a player must stand to use the table (yards). */
export const KATANA_TABLE_RANGE = 6;

/** Every katana id, lowest tier first. */
export const KATANA_TIER_IDS = ['katana_a', 'katana_b', 'katana_c'] as const;

export interface KatanaEvolution {
  next: string;
  kills: number;
  materials: { itemId: string; count: number }[];
  copper: number;
}

/** What each tier needs to evolve: kills with the blade, gathered petals, gold. */
export const KATANA_EVOLUTIONS: Readonly<Record<string, KatanaEvolution>> = {
  katana_a: {
    next: 'katana_b',
    kills: 100,
    materials: [{ itemId: 'sunpetal_herb', count: 5 }],
    copper: 1000,
  },
  katana_b: {
    next: 'katana_c',
    kills: 300,
    materials: [{ itemId: 'sunpetal_herb', count: 15 }],
    copper: 5000,
  },
};

/** Color choices per part, as RGB hex the renderer applies. The first entry is the default. */
export const KATANA_PALETTES = {
  blade: { steel: 0xd0d6e0, azure: 0xa8c4ec, obsidian: 0x2c2a34, crimson: 0xb3262c },
  guard: { gold: 0xd9a441, silver: 0xb8bcc8, black: 0x2a2626 },
  wrap: { black: 0x16161c, indigo: 0x1c3a8c, crimson: 0x8c1216, ivory: 0xe6dcc4 },
  saya: { black: 0x14141a, lacquer: 0x7a1414, indigo: 0x1a2a5c, ivory: 0xe0d6bc },
} as const;

export type KatanaPart = keyof typeof KATANA_PALETTES;
export const KATANA_PARTS = Object.keys(KATANA_PALETTES) as KatanaPart[];

/** Engravable kanji: a fixed set, never free text (shown on the blade and tooltip). */
export const KATANA_KANJI: Readonly<Record<string, string>> = {
  sakura: '桜', // cherry blossom
  ryu: '龍', // dragon
  kaze: '風', // wind
  hi: '火', // fire
  mizu: '水', // water
  tsuki: '月', // moon
  kage: '影', // shadow
  yuki: '雪', // snow
};

// Keep the table off the training mat (both are courtyard furniture).
if (
  Math.hypot(KATANA_TABLE.x - BLOSSOM_TRAINING_MAT.x, KATANA_TABLE.z - BLOSSOM_TRAINING_MAT.z) < 4
) {
  throw new Error('katana table overlaps the training mat');
}
