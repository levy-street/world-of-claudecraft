import { describe, expect, it } from 'vitest';
import { findUpgrades } from '../farmbot/gear';
import type { Entity, InvSlot, ItemDef } from '../src/sim/types';

// Minimal gear def: id, slot, kind and just enough stats to score.
function gear(id: string, over: Partial<ItemDef> = {}): ItemDef {
  return {
    id,
    name: id,
    kind: 'armor',
    slot: 'chest',
    sellValue: 5,
    quality: 'uncommon',
    ...over,
  } as ItemDef;
}

const DEFS: Record<string, ItemDef> = {
  new_sword: gear('new_sword', {
    kind: 'weapon',
    slot: 'mainhand',
    weapon: { min: 10, max: 20, speed: 2 },
  }),
  old_chest: gear('old_chest', { stats: { armor: 10 } }),
  new_chest: gear('new_chest', { stats: { armor: 30 } }),
  same_chest: gear('same_chest', { stats: { armor: 10 } }),
  gated_chest: gear('gated_chest', { stats: { armor: 50 }, requiredLevel: 10 }),
  mage_chest: gear('mage_chest', { stats: { armor: 50 }, requiredClass: ['mage'] }),
  weak_ring: gear('weak_ring', { slot: 'ring', stats: { str: 2 } }),
  mid_ring: gear('mid_ring', { slot: 'ring', stats: { str: 3 } }),
  strong_ring: gear('strong_ring', { slot: 'ring', stats: { str: 20 } }),
  ring_x: gear('ring_x', { slot: 'ring', stats: { str: 10 } }),
  ring_y: gear('ring_y', { slot: 'ring', stats: { str: 15 } }),
  big_bag: gear('big_bag', { kind: 'bag', slot: 'chest', stats: { armor: 99 } }),
  reins: gear('reins', { kind: 'mount', slot: 'chest', stats: { armor: 99 } }),
};

const itemDef = (id: string): ItemDef | undefined => DEFS[id];
const player = (over: Partial<Entity> = {}) =>
  ({ level: 5, templateId: 'paladin', ...over }) as Entity;
const bag = (...ids: string[]): InvSlot[] => ids.map((itemId) => ({ itemId, count: 1 }));

describe('farmbot gear findUpgrades (phase 14)', () => {
  it('fills an empty slot with anything equippable', () => {
    expect(findUpgrades(bag('new_sword'), {}, itemDef, player())).toEqual([
      { itemId: 'new_sword', slot: 'mainhand' },
    ]);
  });

  it('swaps only on a strictly better score, never equal or worse', () => {
    const equipment = { chest: 'old_chest' };
    expect(findUpgrades(bag('new_chest'), equipment, itemDef, player())).toEqual([
      { itemId: 'new_chest', slot: 'chest' },
    ]);
    expect(findUpgrades(bag('same_chest'), equipment, itemDef, player())).toEqual([]);
    expect(findUpgrades(bag('old_chest'), { chest: 'new_chest' }, itemDef, player())).toEqual([]);
  });

  it('gates on required level and required class', () => {
    expect(findUpgrades(bag('gated_chest'), {}, itemDef, player())).toEqual([]); // level 5 < 10
    expect(findUpgrades(bag('gated_chest'), {}, itemDef, player({ level: 10 }))).toEqual([
      { itemId: 'gated_chest', slot: 'chest' },
    ]);
    expect(findUpgrades(bag('mage_chest'), {}, itemDef, player())).toEqual([]); // paladin
    expect(findUpgrades(bag('mage_chest'), {}, itemDef, player({ templateId: 'mage' }))).toEqual([
      { itemId: 'mage_chest', slot: 'chest' },
    ]);
  });

  it('rings land in the weaker of ring1/ring2, two rings split across both', () => {
    const equipment = { ring1: 'strong_ring', ring2: 'weak_ring' };
    expect(findUpgrades(bag('ring_x'), equipment, itemDef, player())).toEqual([
      { itemId: 'ring_x', slot: 'ring2' },
    ]);
    // two new rings, both slots weak: each lands once, better score wins ties
    const bothWeak = { ring1: 'weak_ring', ring2: 'mid_ring' };
    expect(findUpgrades(bag('ring_x', 'ring_y'), bothWeak, itemDef, player())).toEqual([
      { itemId: 'ring_x', slot: 'ring1' },
      { itemId: 'ring_y', slot: 'ring2' },
    ]);
  });

  it('skips bags, mount reins, and unknown items entirely', () => {
    expect(findUpgrades(bag('big_bag', 'reins', 'mystery'), {}, itemDef, player())).toEqual([]);
  });

  it('keeps only the better of two upgrades for one slot', () => {
    const equipment = { chest: 'old_chest' };
    // new_chest (armor 30) beats same_chest (armor 10) for the single slot
    expect(findUpgrades(bag('same_chest', 'new_chest'), equipment, itemDef, player())).toEqual([
      { itemId: 'new_chest', slot: 'chest' },
    ]);
  });
});
