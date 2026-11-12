// The nine world-quest class loot tables (src/sim/content/world_quest_loot.ts).
// Every entry must be something the class can wear AND would want: legal under
// the equipment rules, the class's own armor weight, scoring for at least one of
// its specs, and for a necklace or ring a lead stat one of its specs values.
// The slot coverage matrix is pinned so a thin cell is a visible authoring
// decision (docs/prd/world-quests/rewards-brief.md, section 9).
import { describe, expect, it } from 'vitest';
import { DEV_KIT_ROLES } from '../src/sim/content/dev_kit_roles';
import { WORLD_QUEST_CLASS_LOOT } from '../src/sim/content/world_quest_loot';
import { ITEMS } from '../src/sim/data';
import { roleItemScore } from '../src/sim/dev_kit';
import { armorTypeForItem, canEquipItem, maxArmorTypeForClass } from '../src/sim/equipment_rules';
import { itemLevel } from '../src/sim/item_level';
import { ALL_CLASSES, type ItemDef, type PlayerClass } from '../src/sim/types';

// The catch-up shelf the daily item draws from (the vault's world row pays the
// previous raid tier at 29 above it; the lucky heroic set at 31 is a later rung).
const SHELF_MIN_ITEM_LEVEL = 20;
const SHELF_MAX_ITEM_LEVEL = 26;

// The non-stamina primary stats. Every spec weights stamina, and every
// necklace and ring carries some, so a score that stamina alone props up says
// nothing about whether the class wants the piece.
const LEAD_STATS = ['str', 'agi', 'int', 'spi'] as const;

/** The piece's lead stats: the non-stamina primary stats at its highest value
 *  (two on a tie). Empty when it carries none. */
function leadStats(item: ItemDef): (typeof LEAD_STATS)[number][] {
  const top = Math.max(0, ...LEAD_STATS.map((stat) => item.stats?.[stat] ?? 0));
  if (top === 0) return [];
  return LEAD_STATS.filter((stat) => (item.stats?.[stat] ?? 0) === top);
}

/** Jewelry carries no armor weight, so the weight check never narrows it: the
 *  piece's lead stat must be one at least one of the class's specs values. This
 *  closes caster and physical jewelry crossing over, and deliberately stops
 *  there: Agility adds crit for every class and rogue attack power reads
 *  Strength (src/sim/entity.ts), so a physical class's off-stat piece is a
 *  secondary pick, not a wrong one. The stricter SPEC_PRIMARY_STAT rule would
 *  leave hunter and rogue the same three agility pieces the shelf holds. */
function jewelryFitsClass(cls: PlayerClass, item: ItemDef): boolean {
  const lead = leadStats(item);
  if (lead.length === 0) return true;
  return DEV_KIT_ROLES[cls].some((role) => lead.some((stat) => (role.weights[stat] ?? 0) > 0));
}

function isJewelry(item: ItemDef): boolean {
  return item.slot === 'neck' || item.slot === 'ring';
}

function isAppropriate(cls: PlayerClass, item: ItemDef): boolean {
  if (!canEquipItem(cls, item)) return false;
  if (item.requiredClass && !item.requiredClass.includes(cls)) return false;
  const weight = armorTypeForItem(item);
  if (weight && weight !== maxArmorTypeForClass(cls)) return false;
  if (isJewelry(item) && !jewelryFitsClass(cls, item)) return false;
  return DEV_KIT_ROLES[cls].some((role) => roleItemScore(role, item) > 0);
}

describe('world quest class loot tables', () => {
  it('has a non-empty, duplicate-free table for every class', () => {
    for (const cls of ALL_CLASSES) {
      const table = WORLD_QUEST_CLASS_LOOT[cls];
      expect(table.length, cls).toBeGreaterThan(0);
      expect(new Set(table).size, `${cls} duplicates`).toBe(table.length);
      expect([...table].sort(), `${cls} sorted`).toEqual([...table]);
    }
  });

  it('holds only shelf-band equipment the class can wear and would want', () => {
    for (const cls of ALL_CLASSES) {
      for (const id of WORLD_QUEST_CLASS_LOOT[cls]) {
        const item = ITEMS[id];
        expect(item, `${cls} ${id} exists`).toBeDefined();
        expect(item.slot, `${cls} ${id} has a slot`).toBeDefined();
        expect(['weapon', 'armor', 'held_offhand'], `${cls} ${id} kind`).toContain(item.kind);
        expect(item.heroicOf, `${cls} ${id} is not a heroic variant`).toBeUndefined();
        const level = itemLevel(item) ?? 0;
        expect(level, `${cls} ${id} item level`).toBeGreaterThanOrEqual(SHELF_MIN_ITEM_LEVEL);
        expect(level, `${cls} ${id} item level`).toBeLessThanOrEqual(SHELF_MAX_ITEM_LEVEL);
        expect(isAppropriate(cls, item), `${cls} would wear ${id}`).toBe(true);
      }
    }
  });

  it('rejects jewelry that only stamina makes appropriate', () => {
    // The regression this pins: every class once drew all four necklaces, so a
    // mage could be paid a strength necklace and a warrior an intellect one.
    const strengthNeck = ITEMS.medallion_of_endless_profit;
    const intellectNeck = ITEMS.zense_meridian;
    const agilityRing = ITEMS.sutils_gambit;
    const spiritRing = ITEMS.abyssal_loop;
    expect(isAppropriate('mage', strengthNeck)).toBe(false);
    expect(isAppropriate('warrior', strengthNeck)).toBe(true);
    expect(isAppropriate('warrior', intellectNeck)).toBe(false);
    expect(isAppropriate('mage', intellectNeck)).toBe(true);
    expect(isAppropriate('warlock', agilityRing)).toBe(false);
    expect(isAppropriate('rogue', agilityRing)).toBe(true);
    expect(isAppropriate('hunter', spiritRing)).toBe(false);
    expect(isAppropriate('priest', spiritRing)).toBe(true);
    // Stamina still scores for every spec, so the old score-only check would
    // have passed every one of the rejected pieces above.
    expect(DEV_KIT_ROLES.mage.some((role) => roleItemScore(role, strengthNeck) > 0)).toBe(true);
  });

  it('keeps the three tables of each armor weight distinct by a real margin', () => {
    // Measured at the first cut: the closest pair (hunter and rogue, who share
    // the leather shelf) differed by nine entries; every other pair by sixteen
    // or more. The jewelry fix (2026-11-12) left hunter and rogue at exactly six,
    // so the next shared edit to the leather tables needs a distinct piece.
    // Identity or a one-entry difference would make the nine tables a fiction,
    // so the bound is a symmetric difference, not a mere inequality.
    const MIN_SYMMETRIC_DIFFERENCE = 6;
    const trios: PlayerClass[][] = [
      ['priest', 'mage', 'warlock'],
      ['warrior', 'paladin', 'shaman'],
      ['hunter', 'rogue', 'druid'],
    ];
    for (const trio of trios) {
      for (let a = 0; a < trio.length; a++)
        for (let b = a + 1; b < trio.length; b++) {
          const left = WORLD_QUEST_CLASS_LOOT[trio[a]];
          const right = new Set(WORLD_QUEST_CLASS_LOOT[trio[b]]);
          const shared = left.filter((id) => right.has(id)).length;
          const symmetricDifference = left.length - shared + (right.size - shared);
          expect(symmetricDifference, `${trio[a]} vs ${trio[b]}`).toBeGreaterThanOrEqual(
            MIN_SYMMETRIC_DIFFERENCE,
          );
        }
    }
  });

  it('pins the slot coverage matrix, so a thin cell is a decision and not an accident', () => {
    const matrix: Record<string, Record<string, number>> = {};
    for (const cls of ALL_CLASSES) {
      matrix[cls] = {};
      for (const id of WORLD_QUEST_CLASS_LOOT[cls]) {
        const slot = ITEMS[id].slot as string;
        matrix[cls][slot] = (matrix[cls][slot] ?? 0) + 1;
      }
    }
    // Every class covers the eleven equipment slots the shelf offers, except the
    // offhand, which the shelf barely has (one hunter quiver). Re-pin when the
    // tables change; the brief's section 9 explains each thin cell.
    const slots = [
      'chest',
      'feet',
      'gloves',
      'helmet',
      'legs',
      'mainhand',
      'neck',
      'ring',
      'shoulder',
      'waist',
    ];
    for (const cls of ALL_CLASSES) {
      for (const slot of slots) {
        expect(matrix[cls][slot] ?? 0, `${cls} ${slot}`).toBeGreaterThan(0);
      }
    }
    // Table sizes, the first cut from the measured shelf (2026-09-19), less the
    // off-role jewelry the stamina-only score once let through (2026-11-12). A
    // table that grows or shrinks re-pins this line deliberately.
    expect(
      Object.fromEntries(ALL_CLASSES.map((cls) => [cls, WORLD_QUEST_CLASS_LOOT[cls].length])),
    ).toEqual({
      warrior: 29,
      paladin: 36,
      hunter: 45,
      rogue: 41,
      priest: 26,
      shaman: 38,
      mage: 24,
      warlock: 23,
      druid: 28,
    });
  });
});
