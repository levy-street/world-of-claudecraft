// Pure-core tests for the Apply Enchant picker (Professions 2.0):
// the enchants a reagent unlocks with their EFFECT facts and per-reagent
// affordability, the reagent-derived tier classification and the tiered,
// slot-sorted sections built on it, the eligible-target list (slot match,
// already-enchanted exclusion, the masterwork-still-enchantable case, grouping
// by item id), and the enchant name-key contract.

import { describe, expect, it } from 'vitest';
import { ENCHANTS } from '../src/sim/content/enchants';
import { ITEMS } from '../src/sim/data';
import type { InvSlot, ItemSlot } from '../src/sim/types';
import {
  ENCHANT_TIER_ORDER,
  enchantNameKey,
  enchantSectionsForReagent,
  enchantsForReagent,
  enchantTargets,
  enchantTier,
} from '../src/ui/enchant_apply_view';
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

describe('enchant_apply_view: effect facts on the pick row', () => {
  it('carries the enchant stat bonus straight off the content table', () => {
    const rows = enchantsForReagent([{ itemId: 'arcane_dust', count: 99 }], 'arcane_dust');
    const fortitude = rows.find((r) => r.enchantId === 'enchant_helmet_fortitude');
    expect(fortitude?.effects).toEqual([
      { stat: 'sta', value: ENCHANTS.enchant_helmet_fortitude.statBonus.sta },
    ]);
    // Not a hardcoded 3: the row must track the live table.
    expect(fortitude?.effects[0].value).toBe(3);
  });

  it('every listed enchant carries at least one effect, matching its statBonus', () => {
    for (const reagentId of ['arcane_dust', 'arcane_essence', 'arcane_shard', 'resonant_steel']) {
      for (const row of enchantsForReagent([], reagentId)) {
        const bonus = ENCHANTS[row.enchantId].statBonus;
        expect(row.effects.length, `${row.enchantId} effects`).toBeGreaterThan(0);
        expect(Object.fromEntries(row.effects.map((e) => [e.stat, e.value]))).toEqual(bonus);
      }
    }
  });

  it('an armor-axis enchant reports its armor points, not a primary stat', () => {
    const armor = enchantsForReagent([], 'arcane_dust').find(
      (r) => r.enchantId === 'enchant_chest_armor',
    );
    expect(armor?.effects).toEqual([
      { stat: 'armor', value: ENCHANTS.enchant_chest_armor.statBonus.armor },
    ]);
  });
});

describe('enchant_apply_view: tier classification', () => {
  it('a shard-consuming enchant is Greater', () => {
    expect(enchantTier('enchant_weapon_greater_might')).toBe('greater');
    expect(enchantTier('enchant_gloves_greater_agility')).toBe('greater');
  });

  it('a typed resonant secondary marks the Runed tier', () => {
    expect(enchantTier('enchant_weapon_runed_edge')).toBe('runed');
    expect(enchantTier('enchant_helmet_runed_links')).toBe('runed');
  });

  it('dust/essence-only enchants are Base', () => {
    expect(enchantTier('enchant_weapon_might')).toBe('base');
    // essence-consuming but neither shard nor resonant: still Base.
    expect(enchantTier('enchant_chest_stamina')).toBe('base');
  });

  it('classifies every live enchant, and each tier matches its reagents', () => {
    for (const id of Object.keys(ENCHANTS)) {
      const tier = enchantTier(id);
      const reagentIds = ENCHANTS[id].reagents.map((r) => r.itemId);
      if (reagentIds.includes('arcane_shard')) expect(tier).toBe('greater');
      else if (reagentIds.some((r) => r.startsWith('resonant_'))) expect(tier).toBe('runed');
      else expect(tier).toBe('base');
    }
  });

  it('an unknown enchant id falls back to Base rather than throwing', () => {
    expect(enchantTier('not_a_real_enchant')).toBe('base');
  });

  // Review nit (#2404): the tier is inferred from reagent ids rather than an
  // explicit EnchantDef field, so a future reagent that follows neither
  // convention would silently read as Base. Pin the reagent UNIVERSE instead of
  // trusting the convention: adding a reagent that is neither the shard, a
  // resonant, nor a known base material fails HERE, loudly, at the point where
  // the classification would have gone quietly wrong. Extend the list only
  // together with the enchantTier arm that classifies the new material.
  it('every enchant reagent is a material the tier rules actually recognize', () => {
    const KNOWN_BASE_REAGENTS = new Set(['arcane_dust', 'arcane_essence']);
    const unclassifiable: string[] = [];
    for (const enchant of Object.values(ENCHANTS)) {
      for (const { itemId } of enchant.reagents) {
        if (itemId === 'arcane_shard') continue;
        if (itemId.startsWith('resonant_')) continue;
        if (KNOWN_BASE_REAGENTS.has(itemId)) continue;
        unclassifiable.push(`${enchant.id} -> ${itemId}`);
      }
    }
    expect(
      unclassifiable,
      'these reagents match no tier rule and would silently classify as Base:\n' +
        `${unclassifiable.join('\n')}\n` +
        'Add the material to enchantTier (src/ui/enchant_apply_view.ts) and to this list.',
    ).toEqual([]);
  });

  it('the two tier-marker reagents are still real, distinct items', () => {
    // The rules key on these ids, so a rename in content must not leave the
    // classification pointing at nothing.
    expect(ITEMS.arcane_shard).toBeDefined();
    const resonants = Object.keys(ITEMS).filter((id) => id.startsWith('resonant_'));
    expect(resonants.length).toBeGreaterThan(0);
    // And each tier is actually POPULATED, so a rename that silently emptied a
    // tier (every row falling through to Base) fails here too.
    const tiers = Object.keys(ENCHANTS).map(enchantTier);
    expect(tiers).toContain('greater');
    expect(tiers).toContain('runed');
    expect(tiers).toContain('base');
  });
});

describe('enchant_apply_view: enchantSectionsForReagent', () => {
  it('groups essence enchants into the ladder order, base then runed then greater', () => {
    // arcane_essence is the one reagent that reaches all three tiers, which is
    // exactly the wall this grouping exists for.
    const sections = enchantSectionsForReagent([], 'arcane_essence');
    expect(sections.map((s) => s.tier)).toEqual(['base', 'runed', 'greater']);
    for (const section of sections) {
      expect(section.titleKey).toBe(`hudChrome.enchanting.tier.${section.tier}`);
      expect(section.rows.length).toBeGreaterThan(0);
      for (const row of section.rows) expect(enchantTier(row.enchantId)).toBe(section.tier);
    }
    // Every row the flat list would have shown is still shown, none duplicated.
    const flat = enchantsForReagent([], 'arcane_essence').map((r) => r.enchantId);
    const grouped = sections.flatMap((s) => s.rows.map((r) => r.enchantId));
    expect(grouped.slice().sort()).toEqual(flat.slice().sort());
  });

  it('omits an empty section: a dust reagent paints only the Base header', () => {
    const sections = enchantSectionsForReagent([], 'arcane_dust');
    expect(sections.map((s) => s.tier)).toEqual(['base']);
  });

  it('a typed secondary paints only the Runed section', () => {
    expect(enchantSectionsForReagent([], 'resonant_steel').map((s) => s.tier)).toEqual(['runed']);
  });

  it('sorts each section by paperdoll slot, then by name key', () => {
    const PAPERDOLL: readonly string[] = [
      'mainhand',
      'helmet',
      'neck',
      'shoulder',
      'chest',
      'waist',
      'legs',
      'gloves',
      'feet',
      'ring',
    ];
    for (const section of enchantSectionsForReagent([], 'arcane_essence')) {
      const slots = section.rows.map((r) => PAPERDOLL.indexOf(r.itemSlot));
      expect(slots, `${section.tier} slots resolvable`).not.toContain(-1);
      expect(slots.slice().sort((a, b) => a - b)).toEqual(slots);
      // Ties on a slot break by name key, so two enchants on one slot keep a
      // stable, alphabetical order rather than table declaration order.
      for (let i = 1; i < section.rows.length; i++) {
        if (slots[i] !== slots[i - 1]) continue;
        expect(
          enchantNameKey(section.rows[i].enchantId) > enchantNameKey(section.rows[i - 1].enchantId),
        ).toBe(true);
      }
    }
  });

  it('the Base section really does re-order the raw table (the sort is load-bearing)', () => {
    const base = enchantSectionsForReagent([], 'arcane_dust')[0];
    const raw = enchantsForReagent([], 'arcane_dust').map((r) => r.enchantId);
    expect(base.rows.map((r) => r.enchantId)).not.toEqual(raw);
  });

  it('carries affordability through the grouping unchanged', () => {
    const inventory: InvSlot[] = [
      { itemId: 'arcane_shard', count: 1 },
      { itemId: 'arcane_essence', count: 2 },
    ];
    const greater = enchantSectionsForReagent(inventory, 'arcane_shard').find(
      (s) => s.tier === 'greater',
    );
    const might = greater?.rows.find((r) => r.enchantId === 'enchant_weapon_greater_might');
    expect(might?.affordable).toBe(true);
    const chest = greater?.rows.find((r) => r.enchantId === 'enchant_chest_greater_stamina');
    // Chest Greater needs 3 essence; only 2 are held.
    expect(chest?.affordable).toBe(false);
  });

  it('returns nothing for an id no enchant consumes', () => {
    expect(enchantSectionsForReagent([], 'bone_fragments')).toEqual([]);
  });

  it('pins the English header wording for every tier', () => {
    const headers = hudChromeStrings.enchanting.tier as Record<string, string>;
    // Literal English, not a length check: the headers ARE the ladder the
    // player reads, so a reword has to be a deliberate edit here.
    expect(headers).toEqual({
      base: 'Base Enchants',
      runed: 'Runed Enchants',
      greater: 'Greater Enchants',
    });
    // And every tier the core can return has a row, so a fourth tier cannot
    // ship header-less.
    for (const tier of ENCHANT_TIER_ORDER) expect(headers[tier]).toBeTruthy();
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
