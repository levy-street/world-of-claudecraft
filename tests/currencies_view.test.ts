import { describe, expect, it } from 'vitest';
import { FACTION_IDS } from '../src/sim/factions';
import { buildCurrenciesView, heroicMarkCount } from '../src/ui/hud/currencies/currencies_view';

const woc = { enabled: true, balance: 12, verified: true };

describe('currencies view', () => {
  it('counts Heroic Marks across every stack in the bags', () => {
    expect(
      heroicMarkCount([
        { itemId: 'heroic_mark', count: 5 },
        { itemId: 'copper_ore', count: 3 },
        { itemId: 'heroic_mark', count: 7.9 },
      ]),
    ).toBe(12);
    expect(heroicMarkCount([])).toBe(0);
  });

  it('lists the four activity balances in a fixed order with Honor carrying its lifetime total', () => {
    const view = buildCurrenciesView({
      inventory: [{ itemId: 'heroic_mark', count: 3 }],
      honor: 340,
      lifetimeHonor: 1_200,
      delveMarks: 5,
      woc,
    });
    expect(view.activities.map((row) => row.id)).toEqual([
      'heroic_mark',
      'honor',
      'delve_mark',
      'woc_token',
    ]);
    expect(view.activities[0].amount).toBe(3);
    expect(view.activities[1]).toMatchObject({ amount: 340, lifetime: 1_200 });
    expect(view.activities[2].amount).toBe(5);
    expect(view.activities[3]).toMatchObject({ amount: 12, verified: true });
  });

  it('omits the token when the wallet UI is off and reports null when no wallet is linked', () => {
    const off = buildCurrenciesView({
      inventory: [],
      honor: 0,
      lifetimeHonor: 0,
      delveMarks: 0,
      woc: { enabled: false, balance: 40, verified: true },
    });
    expect(off.activities.map((row) => row.id)).not.toContain('woc_token');
    const unlinked = buildCurrenciesView({
      inventory: [],
      honor: 0,
      lifetimeHonor: 0,
      delveMarks: 0,
      woc: { enabled: true, balance: null, verified: false },
    });
    expect(unlinked.activities.at(-1)).toMatchObject({ id: 'woc_token', amount: null });
  });

  it('clamps corrupt balances to zero instead of painting a negative', () => {
    const view = buildCurrenciesView({
      inventory: [],
      honor: -5,
      lifetimeHonor: Number.NaN,
      delveMarks: -1,
      woc,
    });
    expect(view.activities[1]).toMatchObject({ amount: 0, lifetime: 0 });
    expect(view.activities[2].amount).toBe(0);
  });

  it('prepares one pending row per allied faction, never a fake balance', () => {
    const view = buildCurrenciesView({
      inventory: [],
      honor: 0,
      lifetimeHonor: 0,
      delveMarks: 0,
      woc,
    });
    expect(view.factions.map((row) => row.factionId)).toEqual([...FACTION_IDS]);
    expect(view.factions.every((row) => row.pending && row.amount === 0)).toBe(true);
  });
});
