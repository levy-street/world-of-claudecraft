import { describe, expect, it } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import {
  CONSUMABLE_BAR_SLOTS,
  CONSUMABLE_KIND_ORDER,
  consumableBarItems,
} from '../src/ui/hud/action_bar/consumable_bar_view';

// Minimal synthetic item table: the core reads only `kind` off the def, so a
// cast keeps the fixture small (same trick as tests/bag_filter.test.ts).
const DEFS: Record<string, ItemDef> = Object.fromEntries(
  (
    [
      ['healing_potion', 'potion'],
      ['mana_potion', 'potion'],
      ['bear_elixir', 'elixir'],
      ['bread', 'food'],
      ['boar_meat', 'food'],
      ['water', 'drink'],
      ['sword', 'weapon'],
      ['pelt', 'junk'],
      ['fishing_rod', 'tool'],
    ] as const
  ).map(([id, kind]) => [id, { id, kind } as unknown as ItemDef]),
);
const lookup = (id: string) => DEFS[id];
const inv = (...ids: string[]) => ids.map((itemId) => ({ itemId, count: 1 }));

describe('consumableBarItems', () => {
  it('keeps only the four consumable kinds and drops gear/junk/tools/unknowns', () => {
    const got = consumableBarItems(
      inv('sword', 'bread', 'pelt', 'healing_potion', 'fishing_rod', 'no_such_item'),
      lookup,
      [],
    );
    expect(got).toEqual(['healing_potion', 'bread']);
  });

  it('orders by combat priority (potion, elixir, food, drink), id-sorted within a kind', () => {
    // deliberately scrambled bag order; the row must not follow it
    const got = consumableBarItems(
      inv('water', 'boar_meat', 'mana_potion', 'bear_elixir', 'bread', 'healing_potion'),
      lookup,
      [],
    );
    expect(got).toEqual([
      'healing_potion',
      'mana_potion',
      'bear_elixir',
      'boar_meat',
      'bread',
      'water',
    ]);
    // the priority table itself is the load-bearing order; pin it
    expect(CONSUMABLE_KIND_ORDER).toEqual(['potion', 'elixir', 'food', 'drink']);
  });

  it('collapses multiple stacks of one item into a single slot', () => {
    const got = consumableBarItems(
      inv('bread', 'healing_potion', 'bread', 'bread', 'healing_potion'),
      lookup,
      [],
    );
    expect(got).toEqual(['healing_potion', 'bread']);
  });

  it('caps at the slot count, shedding the lowest-priority tail (never a potion)', () => {
    const got = consumableBarItems(
      inv('water', 'bread', 'boar_meat', 'bear_elixir', 'healing_potion', 'mana_potion', 'water'),
      lookup,
      [],
    );
    expect(got).toHaveLength(CONSUMABLE_BAR_SLOTS);
    // 6 distinct consumables fit exactly; a 7th distinct food would push out
    // the drink, never the potions at the head
    expect(got[0]).toBe('healing_potion');
    expect(got[1]).toBe('mana_potion');
    const capped = consumableBarItems(
      inv('water', 'bread', 'boar_meat', 'bear_elixir', 'healing_potion', 'mana_potion'),
      lookup,
      [],
      2,
    );
    expect(capped).toEqual(['healing_potion', 'mana_potion']);
  });

  it('reuses the caller array across calls (allocation-light per-frame contract)', () => {
    const out: string[] = [];
    const first = consumableBarItems(inv('bread'), lookup, out);
    expect(first).toBe(out);
    const second = consumableBarItems(inv('healing_potion', 'water'), lookup, out);
    expect(second).toBe(out);
    expect(out).toEqual(['healing_potion', 'water']);
  });

  it('accepts both hosts inventory shapes (InvSlot needs only itemId)', () => {
    // Sim-side slots can carry an instance payload; ClientWorld mirrors plain
    // {itemId, count} rows. The core reads itemId only, so both satisfy it.
    const simShaped = [
      { itemId: 'healing_potion', count: 3, instance: { crafterName: 'Bob' } },
      { itemId: 'bread', count: 5 },
    ];
    expect(consumableBarItems(simShaped, lookup, [])).toEqual(['healing_potion', 'bread']);
  });

  it('returns empty for an empty or consumable-free inventory', () => {
    expect(consumableBarItems([], lookup, ['stale'])).toEqual([]);
    expect(consumableBarItems(inv('sword', 'pelt'), lookup, [])).toEqual([]);
  });
});
