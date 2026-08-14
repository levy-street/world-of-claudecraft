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
      ['husk_flask', 'flask'],
      ['boar_scroll', 'scroll'],
      ['serpent_scroll', 'scroll'],
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
  it('keeps only the six consumable kinds and drops gear/junk/tools/unknowns', () => {
    const got = consumableBarItems(
      inv(
        'sword',
        'bread',
        'pelt',
        'healing_potion',
        'husk_flask',
        'boar_scroll',
        'fishing_rod',
        'no_such_item',
      ),
      lookup,
      [],
    );
    expect(got).toEqual(['healing_potion', 'husk_flask', 'boar_scroll', 'bread']);
  });

  it('orders by combat priority (potion, elixir, flask, scroll, food, drink), id-sorted within a kind', () => {
    // deliberately scrambled bag order; the row must not follow it. The buff
    // family sits between the potions and the food, in the order a player
    // reaches for it: elixir, then the flask that replaces it (phase 10), then
    // the scroll that is the elixir's alternative source (phase 06).
    const got = consumableBarItems(
      inv(
        'water',
        'boar_meat',
        'mana_potion',
        'boar_scroll',
        'husk_flask',
        'bear_elixir',
        'healing_potion',
      ),
      lookup,
      [],
      // An explicit cap above CONSUMABLE_BAR_SLOTS: this case is about ORDER,
      // and with six kinds plus a second potion the default cap would truncate
      // the drink off the tail and stop pinning the end of the ladder. The cap
      // itself has its own case below.
      7,
    );
    expect(got).toEqual([
      'healing_potion',
      'mana_potion',
      'bear_elixir',
      'husk_flask',
      'boar_scroll',
      'boar_meat',
      'water',
    ]);
    // the priority table itself is the load-bearing order; pin it
    expect(CONSUMABLE_KIND_ORDER).toEqual(['potion', 'elixir', 'flask', 'scroll', 'food', 'drink']);
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

  it('a combat-buff-heavy bag evicts food and drink at the cap (the recorded trade)', () => {
    // Two potions + one elixir + two scrolls + two foods + a drink is eight
    // distinct consumables for six slots: the tail sheds first (the drink,
    // then the id-later food), never the combat items at the head. This
    // is the deliberate consequence of the combat-priority order, recorded in
    // the Phase 06 QA ledger: mid-fight consumables outrank regen at the cap,
    // and food/drink stay reachable from the bags.
    const got = consumableBarItems(
      inv(
        'water',
        'bread',
        'boar_meat',
        'bear_elixir',
        'boar_scroll',
        'serpent_scroll',
        'healing_potion',
        'mana_potion',
      ),
      lookup,
      [],
    );
    expect(got).toEqual([
      'healing_potion',
      'mana_potion',
      'bear_elixir',
      'boar_scroll',
      'serpent_scroll',
      'boar_meat',
    ]);
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
