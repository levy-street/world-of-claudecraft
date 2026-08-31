// Varkhul's two authored legendaries have separate acquisition routes.
// Emberward drops at 3 percent from the heroic-only shield partition and is
// catalogued on Varkhul's heroic Reliquary page. Forgebreaker remains defined
// for development and item-budget coverage while its crafting route is
// pending; it has no boss-loot or Reliquary row yet.
import type { ItemDef } from '../types';

/** Handover placeholders excluded from whole-catalog gear pickers. Empty on
 *  this release line: Emberward is obtainable from Heroic Varkhul, while
 *  Forgebreaker remains below the live melee-kit winners on score. */
export const IGNIVAR_DROP_PLACEHOLDER_IDS: ReadonlySet<string> = new Set([]);

export const IGNIVAR_DROP_ITEMS: Record<string, ItemDef> = {
  varkhul_forgebreaker: {
    id: 'varkhul_forgebreaker',
    name: 'Forgebreaker, Engine of Varkhul',
    kind: 'weapon',
    slot: 'mainhand',
    hand: 'twohand',
    quality: 'legendary',
    // The new-raid legendary tier (2026-08-30 three-tier ladder): on the
    // ilvl-55 two-hand curve exactly (26.68 at 3.6 speed), stats at the full
    // ilvl-55 legendary 2H budget (95).
    weapon: { min: 77, max: 115, speed: 3.6 },
    stats: { str: 44, sta: 32, agi: 19 },
    sellValue: 26000,
    // Every class that swings a two-handed mace in the era rules: warrior,
    // paladin, shaman, and the feral druid ladder; rogue stays excluded from
    // every two-hander (tests/twohand_itemization_v026.test.ts).
    requiredClass: ['warrior', 'paladin', 'shaman', 'druid'],
  },
  varkhul_emberward: {
    id: 'varkhul_emberward',
    name: 'Emberward, Bulwark of Varkhul',
    kind: 'armor',
    armorType: 'mail',
    slot: 'offhand',
    shield: true,
    quality: 'legendary',
    // Buffed to the legendary band of the 2026-08-30 ilvl-honesty round
    // (maintainer direction: every legendary lives at the Thronebane tier,
    // budget-true at its labeled level; sources in item_level.ts).
    blockValue: 70,
    stats: { armor: 1584, sta: 32, str: 23 },
    sellValue: 20000,
    requiredClass: ['warrior', 'paladin', 'shaman'],
  },
};
