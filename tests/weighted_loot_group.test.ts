import { describe, expect, it } from 'vitest';
import { pickRollGroupWinner } from '../src/sim/loot/loot_roll';
import { weightedLootGroup } from '../src/sim/loot/weighted_loot_group';

describe('guaranteed equipment partitions', () => {
  it('preserves fixed legendary odds, proportional epics and the final RNG boundary', () => {
    const weights = [
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ] as const;
    const reserved = [{ itemId: 'legendary', chance: 0.03 }];
    const rows = weightedLootGroup('gear', weights, reserved);
    expect(rows.map((row) => row.chance)).toEqual([
      0.03,
      0.97 / 6,
      (0.97 * 2) / 6,
      1 - (0.03 + 0.97 / 6 + (0.97 * 2) / 6),
    ]);
    expect(rows.reduce((sum, row) => sum + row.chance, 0)).toBe(1);
    expect(pickRollGroupWinner(0, rows, new Set())?.itemId).toBe('legendary');
    expect(pickRollGroupWinner(0.03, rows, new Set())?.itemId).toBe('a');
    expect(pickRollGroupWinner(1 - 2 ** -32, rows, new Set())?.itemId).toBe('c');
    expect(reserved).toEqual([{ itemId: 'legendary', chance: 0.03 }]);
    expect(weights).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  it('rejects empty or nonpositive equipment weights', () => {
    expect(() => weightedLootGroup('gear', [])).toThrow();
    expect(() => weightedLootGroup('gear', [['a', 0]])).toThrow();
    expect(() => weightedLootGroup('gear', [['a', -1]])).toThrow();
    expect(() => weightedLootGroup('gear', [['a', 1]], [{ chance: Number.NaN }])).toThrow();
    expect(() =>
      weightedLootGroup('gear', [['a', 1]], [{ chance: -0.1 }, { chance: 0.2 }]),
    ).toThrow();
    expect(() =>
      weightedLootGroup('gear', [
        ['a', Number.MAX_VALUE],
        ['b', Number.MAX_VALUE],
      ]),
    ).toThrow();
  });
});
