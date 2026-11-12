import { describe, expect, it } from 'vitest';
import type { PlayerClass } from '../src/sim/types';
import { masterLootPreselectedPids } from '../src/ui/hud/loot/master_loot_preselect_core';

const classes: Record<number, PlayerClass> = { 1: 'warrior', 2: 'mage', 3: 'paladin' };
const classOf = (pid: number): PlayerClass | undefined => classes[pid];
const candidates = [{ pid: 1 }, { pid: 2 }, { pid: 3 }, { pid: 4 }];

describe('masterLootPreselectedPids', () => {
  it('returns the candidates whose class the item names, in roster order', () => {
    const item = { requiredClass: ['paladin', 'warrior'] as PlayerClass[] };
    expect(masterLootPreselectedPids(item, candidates, classOf)).toEqual([1, 3]);
  });

  it('returns nothing for an item without a class list', () => {
    expect(masterLootPreselectedPids({}, candidates, classOf)).toEqual([]);
    expect(masterLootPreselectedPids({ requiredClass: [] }, candidates, classOf)).toEqual([]);
  });

  it('returns nothing for an unknown item (stale client)', () => {
    expect(masterLootPreselectedPids(undefined, candidates, classOf)).toEqual([]);
  });

  it('never preselects a candidate whose class is unknown', () => {
    const item = { requiredClass: ['warrior'] as PlayerClass[] };
    expect(masterLootPreselectedPids(item, [{ pid: 4 }], classOf)).toEqual([]);
  });
});
