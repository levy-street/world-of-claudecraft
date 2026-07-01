import { describe, expect, it } from 'vitest';
import type { ItemDef } from '../src/sim/types';
import { VENDOR_STACK_SIZE, vendorStackSize } from '../src/sim/vendor_stack';

const item = (over: Partial<ItemDef>): ItemDef =>
  ({
    id: 'x',
    name: 'X',
    kind: 'junk',
    sellValue: 1,
    ...over,
  }) as ItemDef;

describe('vendorStackSize', () => {
  it('sells food in a stack of VENDOR_STACK_SIZE', () => {
    expect(vendorStackSize(item({ kind: 'food', foodHp: 60 }))).toBe(VENDOR_STACK_SIZE);
  });

  it('sells drink in a stack of VENDOR_STACK_SIZE', () => {
    expect(vendorStackSize(item({ kind: 'drink', drinkMana: 60 }))).toBe(VENDOR_STACK_SIZE);
  });

  it('sells everything else one at a time', () => {
    expect(vendorStackSize(item({ kind: 'potion', potionHp: 100 }))).toBe(1);
    expect(vendorStackSize(item({ kind: 'weapon' }))).toBe(1);
    expect(vendorStackSize(item({ kind: 'junk' }))).toBe(1);
    expect(vendorStackSize(item({ kind: 'elixir' }))).toBe(1);
  });

  it('VENDOR_STACK_SIZE is the classic staple stack of 5', () => {
    expect(VENDOR_STACK_SIZE).toBe(5);
  });
});
