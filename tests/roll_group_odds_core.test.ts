// Exact per-kill odds for exclusive roll groups (src/ui/hud/mob_inspect/
// roll_group_odds_core.ts), the mob inspect window's answer to pools that
// share items. rollLoot rolls each group once, in order, and
// pickRollGroupWinner falls forward past an item an earlier group already
// awarded, so overlapping pools (shipped: Nythraxis's nythraxis_drop_1 and
// nythraxis_drop_2) can award two items from one shared list and an entry's
// authored chance is not its per-kill odds.

import { describe, expect, it } from 'vitest';
import { NYTHRAXIS_EQUIPMENT_LOOT } from '../src/sim/content/nythraxis_loot';
import { MOBS } from '../src/sim/data';
import { pickRollGroupWinner } from '../src/sim/loot/loot_roll';
import type { LootEntry } from '../src/sim/types';
import { mobHeroicLootEntries, mobLootTable } from '../src/ui/hud/mob_inspect';
import {
  rollGroupClusters,
  rollGroupItemOdds,
} from '../src/ui/hud/mob_inspect/roll_group_odds_core';

function groupsOf(entries: readonly LootEntry[]): Map<string, LootEntry[]> {
  const out = new Map<string, LootEntry[]>();
  for (const e of entries) {
    if (!e.rollGroup) continue;
    const g = out.get(e.rollGroup);
    if (g) g.push(e);
    else out.set(e.rollGroup, [e]);
  }
  return out;
}

/** Brute force through the PRODUCTION picker over a midpoint grid of roll
 *  pairs: two groups rolled in order, the second deduped against the first. */
function bruteForceTwoGroups(a: LootEntry[], b: LootEntry[], steps: number) {
  const counts = new Map<string, number>();
  for (let i = 0; i < steps; i++) {
    const first = pickRollGroupWinner((i + 0.5) / steps, a, new Set());
    const awarded = new Set(first?.itemId ? [first.itemId] : []);
    for (let j = 0; j < steps; j++) {
      const second = pickRollGroupWinner((j + 0.5) / steps, b, awarded);
      for (const id of new Set([...awarded, ...(second?.itemId ? [second.itemId] : [])])) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
  }
  const odds = new Map<string, number>();
  for (const [id, n] of counts) odds.set(id, n / (steps * steps));
  return odds;
}

describe('rollGroupItemOdds', () => {
  it('a lone group: each item drops at its authored chance', () => {
    const odds = rollGroupItemOdds([
      [
        { itemId: 'a', chance: 0.25, rollGroup: 'g' },
        { itemId: 'b', chance: 0.5, rollGroup: 'g' },
      ],
    ]);
    expect(odds?.get('a')).toBeCloseTo(0.25, 12);
    expect(odds?.get('b')).toBeCloseTo(0.5, 12);
  });

  it('two rolls over a shared two-item list always award both items', () => {
    const pool = (g: string): LootEntry[] => [
      { itemId: 'a', chance: 0.5, rollGroup: g },
      { itemId: 'b', chance: 0.5, rollGroup: g },
    ];
    const odds = rollGroupItemOdds([pool('g1'), pool('g2')]);
    // The second roll falls forward past whichever item the first won.
    expect(odds?.get('a')).toBeCloseTo(1, 12);
    expect(odds?.get('b')).toBeCloseTo(1, 12);
  });

  it('a roll past every entry awards nothing', () => {
    const odds = rollGroupItemOdds([[{ itemId: 'a', chance: 0.1, rollGroup: 'g' }]]);
    expect(odds?.get('a')).toBeCloseTo(0.1, 12);
  });
});

describe('the shipped Nythraxis pools (two rolls over the same epics)', () => {
  const groups = groupsOf(NYTHRAXIS_EQUIPMENT_LOOT);
  const drop1 = groups.get('nythraxis_drop_1') ?? [];
  const drop2 = groups.get('nythraxis_drop_2') ?? [];

  it('the two pools really do share items (the case the box label must handle)', () => {
    const shared = drop2.filter((e) => drop1.some((d) => d.itemId === e.itemId));
    expect(shared.length).toBeGreaterThan(0);
  });

  it('solves them as ONE two-roll cluster, matching the production picker', () => {
    const clusters = rollGroupClusters(groups);
    expect(clusters).toHaveLength(1);
    const [cluster] = clusters;
    expect(cluster.groups).toEqual(['nythraxis_drop_1', 'nythraxis_drop_2']);
    expect(cluster.exact).toBe(true);
    const brute = bruteForceTwoGroups(drop1, drop2, 600);
    for (const id of cluster.itemIds) {
      expect(cluster.odds.get(id) ?? 0, id).toBeCloseTo(brute.get(id) ?? 0, 2);
    }
    // Both slots always pay (each pool's chances sum to 1, the list is deep):
    // two different items per kill.
    const total = [...cluster.odds.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(2, 9);
  });

  it('a shared epic is likelier per kill than its single-pool chance', () => {
    const shared = drop1.find((e) => drop2.some((d) => d.itemId === e.itemId)) as LootEntry & {
      itemId: string;
    };
    const [cluster] = rollGroupClusters(groups);
    expect(cluster.odds.get(shared.itemId) ?? 0).toBeGreaterThan(shared.chance);
  });

  it('the window model shows one two-roll box of distinct items for the Normal table', () => {
    const boss = Object.values(MOBS).find((m) =>
      m.loot.some((e) => e.rollGroup === 'nythraxis_drop_2'),
    );
    if (!boss) throw new Error('a mob rolls the Nythraxis pools');
    const boxes = mobLootTable(boss.loot).groups.filter((g) => g.exclusive);
    const box = boxes.find((g) => g.rows.some((r) => drop2.some((d) => d.itemId === r.itemId)));
    expect(box?.rolls).toBe(2);
    const ids = box?.rows.map((r) => r.itemId) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('every shipped loot table enumerates exactly', () => {
  it('no cluster falls back to summed chances (the window never shows an estimate)', () => {
    for (const mob of Object.values(MOBS)) {
      for (const [entries, heroic] of [
        [mob.loot, false],
        [mobHeroicLootEntries(mob), true],
      ] as const) {
        if (!entries) continue;
        for (const g of mobLootTable(entries, heroic).groups) {
          expect(g.exact, mob.id).toBe(true);
          for (const r of g.rows) {
            expect(r.chance, `${mob.id}:${r.itemId}`).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
      }
    }
  });
});
