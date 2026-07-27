// Pure-core tests for src/sim/professions/harvest_yields.ts (#2457): the
// append-or-merge rule that turns a corpse harvest's six possible grant calls
// into ONE ledger entry per distinct granted item, which is what makes the
// client's line count match the item count.
//
// Pinned directly rather than only through harvestCorpse because the merge arm
// is not reachable from shipped content: no mob today tags two components that
// map to the same item id, and since #2474 a repeated tag in the request cannot
// reach it either (effectiveFocusComponents collapses the pick to a set before
// anything rolls). The rule exists because the command boundary's own
// pre-claim capacity gate already folds that case when it reserves stack room
// (interaction.ts `wanted.find((w) => w.itemId === wantedItemId)`), so a ledger
// that disagreed would reserve one stack and then print two lines for it.

import { describe, expect, it } from 'vitest';
import type { HarvestYield } from '../src/sim/professions/harvest_yields';
import { recordHarvestYield } from '../src/sim/professions/harvest_yields';

const plain = (itemId: string, qty: number, rarity: HarvestYield['rarity'] = 'common') =>
  ({ itemId, qty, rarity, kind: 'plain' }) as const;

describe('recordHarvestYield', () => {
  it('appends the first entry verbatim', () => {
    const ledger: HarvestYield[] = [];
    recordHarvestYield(ledger, plain('rough_hide', 3));
    expect(ledger).toEqual([{ itemId: 'rough_hide', qty: 3, rarity: 'common', kind: 'plain' }]);
  });

  it('keeps distinct items as distinct entries, in grant order', () => {
    // Grant order is the order the lines print in, so it is load-bearing: the
    // plain component of a specimen family must read before its jackpot.
    const ledger: HarvestYield[] = [];
    recordHarvestYield(ledger, plain('rough_hide', 1));
    recordHarvestYield(ledger, plain('wolf_fang', 2));
    expect(ledger.map((e) => e.itemId)).toEqual(['rough_hide', 'wolf_fang']);
  });

  it('merges two grants of the same item into one entry with the summed quantity', () => {
    const ledger: HarvestYield[] = [];
    recordHarvestYield(ledger, plain('rough_hide', 3));
    recordHarvestYield(ledger, plain('rough_hide', 2));
    expect(ledger).toEqual([{ itemId: 'rough_hide', qty: 5, rarity: 'common', kind: 'plain' }]);
  });

  it('merges in place, without moving the merged entry to the end', () => {
    // A merge that re-appended would reorder the lines a later grant call
    // produced, which is exactly what the grant-order comment forbids.
    const ledger: HarvestYield[] = [];
    recordHarvestYield(ledger, plain('rough_hide', 1));
    recordHarvestYield(ledger, plain('wolf_fang', 1));
    recordHarvestYield(ledger, plain('rough_hide', 1));
    expect(ledger.map((e) => e.itemId)).toEqual(['rough_hide', 'wolf_fang']);
    expect(ledger[0].qty).toBe(2);
  });

  it('never merges across a difference the rendered line would have shown', () => {
    // Each of the three merge-key fields gets its own negative case: a merge
    // that ignored any one of them would silently drop a line the player is
    // owed (a different color, a different wording) or invent a quantity that
    // spans two different rolls.
    const byRarity: HarvestYield[] = [];
    recordHarvestYield(byRarity, plain('rough_hide', 1, 'common'));
    recordHarvestYield(byRarity, plain('rough_hide', 1, 'rare'));
    expect(byRarity).toHaveLength(2);
    expect(byRarity.map((e) => e.rarity)).toEqual(['common', 'rare']);

    const byKind: HarvestYield[] = [];
    recordHarvestYield(byKind, { itemId: 'wolf_fang', qty: 1, rarity: 'rare', kind: 'plain' });
    recordHarvestYield(byKind, { itemId: 'wolf_fang', qty: 1, rarity: 'rare', kind: 'signed' });
    expect(byKind).toHaveLength(2);
    expect(byKind.map((e) => e.kind)).toEqual(['plain', 'signed']);

    const byItem: HarvestYield[] = [];
    recordHarvestYield(byItem, plain('rough_hide', 1));
    recordHarvestYield(byItem, plain('pristine_hide', 1));
    expect(byItem).toHaveLength(2);
  });

  it('does not mutate the entry object the caller passed in', () => {
    // The caller builds each entry as a fresh literal today, but a merge that
    // wrote through to the argument would corrupt a shared one.
    const ledger: HarvestYield[] = [];
    const first = plain('rough_hide', 3);
    recordHarvestYield(ledger, first);
    recordHarvestYield(ledger, plain('rough_hide', 4));
    expect(first.qty).toBe(3);
    expect(ledger[0].qty).toBe(7);
  });
});
