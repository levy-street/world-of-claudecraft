import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { InvSlot } from '../src/sim/types';
import { totalHeldCount } from '../src/ui/vendor_sell_quantity';

// Regression for the "sell amount to NPC" bug (Discord #bug-reports, Corotexus):
// shift+click/shift+i on a stackable item opens a sell-amount dialog whose cap was
// the SINGLE clicked slot's count (a stack, capped at its stackSize, commonly 20),
// not the total the player actually holds across every bag slot. Typing a custom
// amount above one stack's worth (e.g. 100 while holding five 20-stacks) silently
// clamped down to 20, so only 20 or the full clicked stack ever sold.
describe('totalHeldCount', () => {
  it('sums an item across every bag slot, not just one', () => {
    const inventory: InvSlot[] = [
      { itemId: 'wolf_fang', count: 20 },
      { itemId: 'apprentice_staff', count: 1 },
      { itemId: 'wolf_fang', count: 20 },
      { itemId: 'wolf_fang', count: 20 },
      { itemId: 'wolf_fang', count: 20 },
      { itemId: 'wolf_fang', count: 20 },
    ];
    // 5 stacks of 20 = 100 held, well past what any single slot alone reports.
    expect(totalHeldCount(inventory, 'wolf_fang')).toBe(100);
  });

  it('returns 0 for an item the player does not hold', () => {
    const inventory: InvSlot[] = [{ itemId: 'wolf_fang', count: 20 }];
    expect(totalHeldCount(inventory, 'apprentice_staff')).toBe(0);
  });

  it('matches a single slot when only one stack exists', () => {
    const inventory: InvSlot[] = [{ itemId: 'wolf_fang', count: 7 }];
    expect(totalHeldCount(inventory, 'wolf_fang')).toBe(7);
  });
});

// Source-level pin: the sell-quantity prompt's cap must come from totalHeldCount
// across the whole bag, never the clicked slot's count alone.
describe('bags_window: sell-quantity prompt cap uses total held, not one slot', () => {
  const painter = readFileSync(new URL('../src/ui/bags_window.ts', import.meta.url), 'utf8');

  it('imports totalHeldCount from vendor_sell_quantity', () => {
    expect(painter).toContain("import { totalHeldCount } from './vendor_sell_quantity';");
  });

  it('passes the total-held cap, not slot.count, into showSellQuantityPrompt', () => {
    expect(painter).toContain(
      'const heldTotal = Math.max(count, totalHeldCount(this.deps.world().inventory, slot.itemId));',
    );
    expect(painter).toContain('this.showSellQuantityPrompt(slot.itemId, heldTotal);');
  });
});
