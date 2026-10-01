// Exact per-kill drop odds for a mob's exclusive roll groups, for the mob
// inspect window. The loot roller (src/sim/loot/loot_roll.ts rollLoot) draws
// ONE roll per rollGroup, in table order, and resolves it with
// pickRollGroupWinner, which falls forward past an item an EARLIER group of the
// same kill already awarded. So when two groups share items (Nythraxis rolls
// two pools over the same epics), one kill can award two items from the shared
// list, and an entry's authored chance is NOT its per-kill odds.
//
// This enumerates every outcome instead of re-deriving the rule: within one
// group the winner is constant across each entry's slice of the [0, 1) roll,
// so asking the PRODUCTION pickRollGroupWinner once per slice (at its
// midpoint) is exact, and carrying the awarded set forward group by group
// gives the exact joint distribution. Groups that share no item are
// independent and are solved separately, which keeps the state count to the
// size of one overlapping cluster.
//
// Pure: no DOM, no rng; the roller itself is only CALLED, never re-implemented.

import { pickRollGroupWinner } from '../../../sim/loot/loot_roll';
import type { LootEntry } from '../../../sim/types';

/** A cluster's distinct awarded-set outcomes beyond this fall back to the
 *  authored per-roll chances (flagged `exact: false`) rather than stall the UI. */
export const ROLL_GROUP_ODDS_MAX_STATES = 50_000;

export interface RollGroupCluster {
  /** The groups' names in roll order. */
  readonly groups: readonly string[];
  /** Distinct item ids in first-appearance order. */
  readonly itemIds: readonly string[];
  /** Per-kill probability that each item drops from this cluster. */
  readonly odds: ReadonlyMap<string, number>;
  /** False when the cluster was too large to enumerate. */
  readonly exact: boolean;
}

/** The exact per-kill odds of one cluster of groups rolled in order. Returns
 *  null if enumeration would exceed ROLL_GROUP_ODDS_MAX_STATES. */
export function rollGroupItemOdds(
  groups: readonly (readonly LootEntry[])[],
): Map<string, number> | null {
  // Each state is one possible awarded set (sorted ids) with its probability.
  let states = new Map<string, { awarded: Set<string>; p: number }>([
    ['', { awarded: new Set(), p: 1 }],
  ]);
  for (const group of groups) {
    const next = new Map<string, { awarded: Set<string>; p: number }>();
    const add = (awarded: Set<string>, p: number) => {
      if (p <= 0) return;
      const key = [...awarded].sort().join('\n');
      const hit = next.get(key);
      if (hit) hit.p += p;
      else next.set(key, { awarded, p });
    };
    for (const { awarded, p } of states.values()) {
      let cumulative = 0;
      for (const entry of group) {
        const lo = Math.min(cumulative, 1);
        cumulative += entry.chance;
        const hi = Math.min(cumulative, 1);
        if (hi <= lo) continue;
        const winner = pickRollGroupWinner((lo + hi) / 2, group as LootEntry[], awarded);
        if (winner?.itemId) add(new Set([...awarded, winner.itemId]), p * (hi - lo));
        else add(awarded, p * (hi - lo));
      }
      // The roll landed past every entry: this group awards nothing.
      add(awarded, p * (1 - Math.min(cumulative, 1)));
    }
    if (next.size > ROLL_GROUP_ODDS_MAX_STATES) return null;
    states = next;
  }
  const odds = new Map<string, number>();
  for (const { awarded, p } of states.values()) {
    for (const id of awarded) odds.set(id, (odds.get(id) ?? 0) + p);
  }
  return odds;
}

/** Partition the named groups (in roll order) into clusters that share item
 *  ids, and solve each cluster's per-kill odds. */
export function rollGroupClusters(
  groups: ReadonlyMap<string, readonly LootEntry[]>,
): RollGroupCluster[] {
  const names = [...groups.keys()];
  // Union-find over group names, joined whenever two groups list one item.
  const parent = new Map(names.map((n) => [n, n]));
  const find = (n: string): string => {
    let root = n;
    while (parent.get(root) !== root) root = parent.get(root) as string;
    parent.set(n, root);
    return root;
  };
  const ownerOfItem = new Map<string, string>();
  for (const name of names) {
    for (const entry of groups.get(name) ?? []) {
      if (!entry.itemId) continue;
      const owner = ownerOfItem.get(entry.itemId);
      if (owner === undefined) ownerOfItem.set(entry.itemId, name);
      else parent.set(find(name), find(owner));
    }
  }
  const byRoot = new Map<string, string[]>();
  for (const name of names) {
    const root = find(name);
    const members = byRoot.get(root);
    if (members) members.push(name);
    else byRoot.set(root, [name]);
  }
  const clusters: RollGroupCluster[] = [];
  for (const members of byRoot.values()) {
    const tables = members.map((n) => groups.get(n) ?? []);
    const itemIds: string[] = [];
    for (const table of tables) {
      for (const entry of table) {
        if (entry.itemId && !itemIds.includes(entry.itemId)) itemIds.push(entry.itemId);
      }
    }
    const exactOdds = rollGroupItemOdds(tables);
    let odds: Map<string, number>;
    if (exactOdds) {
      odds = exactOdds;
    } else {
      // Too large to enumerate: the summed authored chances, capped at 1.
      odds = new Map();
      for (const table of tables) {
        for (const entry of table) {
          if (entry.itemId) {
            odds.set(entry.itemId, Math.min(1, (odds.get(entry.itemId) ?? 0) + entry.chance));
          }
        }
      }
    }
    clusters.push({ groups: members, itemIds, odds, exact: exactOdds !== null });
  }
  return clusters;
}
