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
      ['arcane_potion', 'potion'],
      ['swiftness_potion', 'potion'],
      ['bear_elixir', 'elixir'],
      ['serpent_elixir', 'elixir'],
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

  it('caps at the slot count, and a cap under the kind count truncates down the priority ladder', () => {
    const got = consumableBarItems(
      inv('water', 'bread', 'boar_meat', 'bear_elixir', 'healing_potion', 'mana_potion', 'water'),
      lookup,
      [],
    );
    expect(got).toHaveLength(CONSUMABLE_BAR_SLOTS);
    // 6 distinct consumables fit exactly; the potions keep the head.
    expect(got[0]).toBe('healing_potion');
    expect(got[1]).toBe('mana_potion');
    // At cap 2 the kind-fair guarantee itself truncates in kind order: one
    // potion, one elixir. The second potion no longer rides ahead of a whole
    // present kind (the phase 14 rule), and food/drink shed entirely.
    const capped = consumableBarItems(
      inv('water', 'bread', 'boar_meat', 'bear_elixir', 'healing_potion', 'mana_potion'),
      lookup,
      [],
      2,
    );
    expect(capped).toEqual(['healing_potion', 'bear_elixir']);
    expect(capped, 'a second potion never outranks a present kind').not.toContain('mana_potion');
    expect(capped, 'kinds past the cap shed whole').not.toContain('bread');
  });

  it('all six kinds present take one seat each at the cap (the phase 14 kind-fair guarantee)', () => {
    // Nine distinct consumables across all six kinds for six seats: every
    // present kind seats its id-sorted first item, in kind order, and the
    // duplicate potion/scroll/food are what shed. This REPLACES the recorded
    // Phase 06/10 trade (the tail kinds shed whole while the head stacked
    // seconds): farming's dishes, feast, and tonic made multi-kind bags the
    // common case, so the tray now guarantees a seat per kind first.
    const got = consumableBarItems(
      inv(
        'water',
        'bread',
        'boar_meat',
        'bear_elixir',
        'husk_flask',
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
      'bear_elixir',
      'husk_flask',
      'boar_scroll',
      'boar_meat',
      'water',
    ]);
    expect(got, 'the second potion sheds, not a whole kind').not.toContain('mana_potion');
    expect(got, 'the second scroll sheds, not a whole kind').not.toContain('serpent_scroll');
  });

  it('a potion-and-elixir-heavy bag no longer starves the flask (the phase 14 fix)', () => {
    // The old head-first truncation let four potion ids and two elixir ids
    // fill all six seats, so a player carrying a flask too got no flask
    // button (the recorded phase 14 residual). The kind-fair guarantee seats
    // the flask first; the leftover seats then follow the old priority order
    // (all remaining potions before a second elixir), so the second elixir is
    // what sheds.
    expect(CONSUMABLE_BAR_SLOTS, 'the tray is six buttons wide').toBe(6);
    const got = consumableBarItems(
      inv(
        'husk_flask',
        'healing_potion',
        'mana_potion',
        'arcane_potion',
        'swiftness_potion',
        'bear_elixir',
        'serpent_elixir',
      ),
      lookup,
      [],
    );
    expect(got).toEqual([
      'arcane_potion',
      'healing_potion',
      'mana_potion',
      'swiftness_potion',
      'bear_elixir',
      'husk_flask',
    ]);
    expect(got, 'the flask keeps its guaranteed seat').toContain('husk_flask');
    expect(got, 'the leftover pass stays priority-ordered: the second elixir sheds').not.toContain(
      'serpent_elixir',
    );
  });

  it('a missing kind frees its seat to the leftover pass in priority order', () => {
    // Five kinds present (no drink) with eight distinct items: the guarantee
    // seats five, and the ONE leftover seat goes to the highest-priority
    // extra (the second potion), never to the second food further down.
    const got = consumableBarItems(
      inv(
        'bread',
        'boar_meat',
        'bear_elixir',
        'husk_flask',
        'boar_scroll',
        'healing_potion',
        'mana_potion',
        'serpent_scroll',
      ),
      lookup,
      [],
    );
    expect(got).toEqual([
      'healing_potion',
      'mana_potion',
      'bear_elixir',
      'husk_flask',
      'boar_scroll',
      'boar_meat',
    ]);
    expect(
      got,
      'the freed seat went to the potion extra, not the scroll or food one',
    ).not.toContain('serpent_scroll');
    expect(got).not.toContain('bread');
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
