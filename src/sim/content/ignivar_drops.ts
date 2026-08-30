// The two legendary drops from the Ignivar raid (Varkhul the Forgefather),
// LIVE on Varkhul's normal table (dungeons.ts, 3 percent each, the
// kingsbane_last_oath precedent) since the loot PR's launch wiring. Their
// realized item level from Varkhul's own boss level is 33 (source 20 +
// legendary 10 + raid 3), the same kingsbane tier the handover authored
// against, so the numbers below stand re-derived and budget-true as
// written:
// - forgebreaker: primary stats round(44 * TWOHAND_STAT_MULT 1.3) = 57; the
//   authored 55-82 at speed 3.6 is 19.03 dps, within rounding of the
//   weaponDpsBudget(33) * TWOHAND_DPS_MULT 1.15 target (19.09).
// - emberward: primary stats round(33 * 1.9 * SLOT_STAT_MULT.offhand 0.75 *
//   STAT_PER_ILVL 0.7) = 33; blockValue/armor extrapolate the shield ladder
//   (buckler 6 / wallshield 14 / bonewrought 30 at epic ilvl 29) one tier up.
// With the wiring live, itemLevel() resolves 33 for both, the budget sweeps
// cover them, and their Reliquary rows sit on the conquerors_varkhul page
// (the same-change unit the old tripwire pin enforced).
import type { ItemDef } from '../types';

/** Handover placeholders not yet on any loot table, as a set: gear pickers
 *  that argmax over the whole ITEMS table (the PBE boost BiS kit) must skip
 *  anything a player cannot actually obtain yet, and table membership is the
 *  reliable test for that (the source index misses vendor/quest paths, so
 *  "no derivable source" is not). EMPTY today: the Varkhul pair went live
 *  with the launch wiring; the next handover item stages here the same
 *  way. */
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
