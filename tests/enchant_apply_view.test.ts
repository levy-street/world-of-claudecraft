// Pure-core tests for the Apply Enchant picker (Professions 2.0):
// the enchants a reagent unlocks with their per-reagent affordability, the
// eligible-target list (slot match, already-enchanted exclusion, the
// masterwork-still-enchantable case, grouping by item id), and the enchant
// name-key contract.

import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import type { InvSlot, ItemSlot } from '../src/sim/types';
import { enchantNameKey, enchantsForReagent, enchantTargets } from '../src/ui/enchant_apply_view';
import { hudChromeStrings } from '../src/ui/i18n.catalog/hud_chrome';

// A real item id for a slot, taken from live content so the def.slot match is
// exercised against ITEMS exactly as the runtime picker reads it.
function itemForSlot(slot: ItemSlot, skip = new Set<string>()): string {
  const id = Object.keys(ITEMS).find(
    (candidate) => ITEMS[candidate].slot === slot && !skip.has(candidate),
  );
  if (!id) throw new Error(`no item found for slot ${slot}`);
  return id;
}

describe('enchant_apply_view: enchantNameKey', () => {
  it('names the hudChrome.enchantName.<id> render sink for every enchant', () => {
    expect(enchantNameKey('enchant_weapon_might')).toBe(
      'hudChrome.enchantName.enchant_weapon_might',
    );
    for (const id of Object.keys(ENCHANTS)) {
      expect(enchantNameKey(id)).toBe(`hudChrome.enchantName.${id}`);
    }
    // Review should-fix: the key CONSTRUCTION alone would pass over an empty
    // catalog. The render sink is only real if every id resolves to a non-empty
    // English row, and every row still names a live enchant (no orphans).
    const table = hudChromeStrings.enchantName as Record<string, string>;
    for (const id of Object.keys(ENCHANTS)) {
      expect(typeof table[id], `catalog row for ${id}`).toBe('string');
      expect(table[id].length, `non-empty name for ${id}`).toBeGreaterThan(0);
    }
    for (const key of Object.keys(table)) {
      expect(ENCHANTS[key], `orphaned enchantName row ${key}`).toBeDefined();
    }
    // The catalog English and the table's own name field are two copies of one
    // string (the UI renders the catalog; the table name feeds the wiki
    // generator), so a rename touching only one side must fail loudly here.
    for (const id of Object.keys(ENCHANTS)) {
      expect(table[id], `catalog/table name drift for ${id}`).toBe(ENCHANTS[id].name);
    }
  });
});

describe('enchant_apply_view: enchantsForReagent', () => {
  it('lists only the enchants that consume the reagent, with affordability', () => {
    // arcane_shard is consumed only by the Greater tier; enchant_weapon_greater_might
    // needs 1 shard + 2 essence.
    const inventory: InvSlot[] = [
      { itemId: 'arcane_shard', count: 1 },
      { itemId: 'arcane_essence', count: 5 },
    ];
    const rows = enchantsForReagent(inventory, 'arcane_shard');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(ENCHANTS[row.enchantId].reagents.some((r) => r.itemId === 'arcane_shard')).toBe(true);
    }
    const might = rows.find((r) => r.enchantId === 'enchant_weapon_greater_might');
    expect(might).toBeDefined();
    expect(might?.affordable).toBe(true);
    expect(might?.itemSlot).toBe('mainhand');
    const shardReagent = might?.reagents.find((r) => r.itemId === 'arcane_shard');
    expect(shardReagent).toEqual({ itemId: 'arcane_shard', required: 1, have: 1 });
  });

  it('marks an enchant unaffordable when a reagent is short', () => {
    const inventory: InvSlot[] = [{ itemId: 'arcane_shard', count: 1 }]; // no essence held
    const might = enchantsForReagent(inventory, 'arcane_shard').find(
      (r) => r.enchantId === 'enchant_weapon_greater_might',
    );
    expect(might?.affordable).toBe(false);
    expect(might?.reagents.find((r) => r.itemId === 'arcane_essence')?.have).toBe(0);
  });

  it('returns nothing for an id no enchant consumes', () => {
    expect(enchantsForReagent([{ itemId: 'arcane_dust', count: 9 }], 'bone_fragments')).toEqual([]);
  });
});

describe('enchant_apply_view: enchantTargets', () => {
  const chestId = itemForSlot('chest');
  const otherChestId = itemForSlot('chest', new Set([chestId]));
  const helmetId = itemForSlot('helmet');

  it('lists held items whose slot matches the enchant', () => {
    const inventory: InvSlot[] = [
      { itemId: chestId, count: 2 },
      { itemId: helmetId, count: 1 }, // wrong slot for a chest enchant
    ];
    const targets = enchantTargets(inventory, 'enchant_chest_stamina');
    expect(targets).toEqual([{ itemId: chestId, count: 2 }]);
  });

  it('excludes an already-enchanted copy but keeps a masterwork copy', () => {
    const inventory: InvSlot[] = [
      { itemId: chestId, count: 1, instance: { enchant: 'enchant_chest_stamina' } },
      { itemId: otherChestId, count: 1, instance: { rolled: { masterwork: true } } },
    ];
    const targets = enchantTargets(inventory, 'enchant_chest_stamina');
    // The enchanted chest is gone (double-enchant blocked); the masterwork one stays.
    expect(targets).toEqual([{ itemId: otherChestId, count: 1 }]);
  });

  it('groups multiple enchantable stacks of one item id by count', () => {
    const inventory: InvSlot[] = [
      { itemId: chestId, count: 2 },
      { itemId: chestId, count: 1, instance: { rolled: { masterwork: true } } },
      { itemId: chestId, count: 1, instance: { enchant: 'x' } }, // excluded
    ];
    const targets = enchantTargets(inventory, 'enchant_chest_stamina');
    expect(targets).toEqual([{ itemId: chestId, count: 3 }]);
  });

  it('returns nothing for an unknown enchant id', () => {
    expect(enchantTargets([{ itemId: chestId, count: 1 }], 'not_a_real_enchant')).toEqual([]);
  });
});
