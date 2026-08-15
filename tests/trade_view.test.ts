// Pure view-core tests for the Trade window (src/ui/trade_view.ts).
//
// Reproduces the reported bug: a fungible item split across multiple bag
// slots (bags.ts's DEFAULT_STACK caps a stack at 20, so 45 held units land
// in 3 slots: 20 + 20 + 5) must offer up to the TOTAL held, not just
// whichever single slot the old Array.find()-based lookup happened to hit.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ITEMS } from '../src/sim/data';
import type { InvSlot } from '../src/sim/types';
import { itemDisplayName } from '../src/ui/entity_i18n';
import { buildTradeItemRow, tradeOfferCeiling, tradeRowTooltipTarget } from '../src/ui/trade_view';

describe('tradeOfferCeiling (trade offer stepper cap)', () => {
  it('sums an item split across multiple bag slots instead of capping at one slot', () => {
    const inventory: InvSlot[] = [
      { itemId: 'mat_linen_cloth', count: 20 },
      { itemId: 'mat_linen_cloth', count: 20 },
      { itemId: 'mat_linen_cloth', count: 5 },
    ];
    // The old addItemToTrade used `.find(...)?.count ?? 0`, which would have
    // returned 20 here (the first matching slot), not the true total of 45.
    expect(tradeOfferCeiling(inventory, 'mat_linen_cloth')).toBe(45);
  });

  it('is unaffected by other item ids in the same bag', () => {
    const inventory: InvSlot[] = [
      { itemId: 'mat_linen_cloth', count: 20 },
      { itemId: 'mat_wool_cloth', count: 12 },
      { itemId: 'mat_linen_cloth', count: 5 },
    ];
    expect(tradeOfferCeiling(inventory, 'mat_linen_cloth')).toBe(25);
    expect(tradeOfferCeiling(inventory, 'mat_wool_cloth')).toBe(12);
  });

  it('returns the single slot count unchanged when the item is not split', () => {
    const inventory: InvSlot[] = [{ itemId: 'mat_linen_cloth', count: 7 }];
    expect(tradeOfferCeiling(inventory, 'mat_linen_cloth')).toBe(7);
  });

  it('returns 0 when the item is not held at all', () => {
    const inventory: InvSlot[] = [{ itemId: 'mat_linen_cloth', count: 20 }];
    expect(tradeOfferCeiling(inventory, 'mat_wool_cloth')).toBe(0);
  });
});

describe('buildTradeItemRow (stale-client guard, R34)', () => {
  // A real content id, resolved from the table rather than hardcoded, so a
  // content rename cannot leave this file pinning a phantom.
  const KNOWN_ID = Object.keys(ITEMS)[0];

  it('resolves a known id to its def and localized name', () => {
    const row = buildTradeItemRow({ itemId: KNOWN_ID, count: 1 }, ITEMS);
    expect(row.item).toBe(ITEMS[KNOWN_ID]);
    expect(row.label).toBe(itemDisplayName(ITEMS[KNOWN_ID]));
  });

  it('appends the stack count past one unit', () => {
    const row = buildTradeItemRow({ itemId: KNOWN_ID, count: 3 }, ITEMS);
    expect(row.label).toBe(`${itemDisplayName(ITEMS[KNOWN_ID])} x3`);
  });

  it('falls back to the raw id for an id the bundle cannot resolve, never a throw', () => {
    // The other side's offer is server truth: it can carry ids minted by
    // content this bundle predates. The shipped failure shape dereferenced
    // the missing def and froze the offer display.
    const row = buildTradeItemRow({ itemId: 'no_such_item_id', count: 1 }, ITEMS);
    expect(row.item).toBeUndefined();
    expect(row.label).toBe('no_such_item_id');
  });

  it('keeps a PROTOTYPE-KEY id on the unknown arm (the adversarial counter-example)', () => {
    // ITEMS is a prototype-bearing Record, so a bare items[id] resolves
    // 'constructor' to a truthy FUNCTION and the known arm throws in the
    // display-name sink; knownItemDef is what keeps these on the fallback.
    for (const key of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      const row = buildTradeItemRow({ itemId: key, count: 1 }, ITEMS);
      expect(row.item, key).toBeUndefined();
      expect(row.label, key).toBe(key);
    }
  });

  it('keeps the stack count on an unknown-id row', () => {
    const row = buildTradeItemRow({ itemId: 'no_such_item_id', count: 5 }, ITEMS);
    expect(row.item).toBeUndefined();
    expect(row.label).toBe('no_such_item_id x5');
  });

  it('resolves the label through itemDisplayName, never the raw item.name', () => {
    // A def with a REAL id but a sentinel raw name: itemDisplayName resolves
    // the localized name by id, so the two paths disagree here and a
    // regression to `item.name` fails on the sentinel arm. (The known-id
    // tests above compare against itemDisplayName itself, which a raw-name
    // swap would satisfy whenever the two strings coincide in English.)
    const items = { sentinel_slot: { ...ITEMS[KNOWN_ID], name: 'RAW_NAME_SENTINEL' } };
    const row = buildTradeItemRow({ itemId: 'sentinel_slot', count: 1 }, items);
    expect(row.label).toBe(itemDisplayName(ITEMS[KNOWN_ID]));
    expect(row.label).not.toBe('RAW_NAME_SENTINEL');
  });
});

describe('trade window painter wiring (source pins, hud.ts updateTradeWindow)', () => {
  // The pure core decides; these pins hold the painter to consuming it. The
  // method body is comment-stripped first so a comment naming the assignment
  // cannot satisfy an ordering pin.
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  const start = hud.indexOf('private updateTradeWindow(');
  const end = hud.indexOf('attachOptions(hooks: OptionsHooks)');
  const body = hud
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('brackets the method slice it pins', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('resolves offer rows through buildTradeItemRow and guards the icon', () => {
    expect(body).toContain('buildTradeItemRow(s, ITEMS)');
    expect(body).toContain('item ? this.itemIcon(item) : unknownItemIconHtml(s.itemId)');
  });

  it('commits the repaint signature in a finally behind the render try', () => {
    // The shipped failure shape set lastTradeSig BEFORE the render outside
    // any try, so each data change re-threw into the band and every other
    // frame skipped the repaint. The structure pinned here bounds an unknown
    // future throw instead: the panel shows its last complete paint until
    // the offer data next changes, and the callers banded after the trade
    // window keep running.
    const compare = body.indexOf('if (sig === this.lastTradeSig) return;');
    const render = body.indexOf('el.innerHTML');
    const commit = body.indexOf('this.lastTradeSig = sig;');
    expect(compare).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(compare);
    expect(commit).toBeGreaterThan(render);
    // The commit sits in a finally behind the render's try: the bound that
    // keeps an unknown future throw from aborting the update() calls banded
    // after the trade window, while still committing once per data change.
    const fin = body.indexOf('} finally {');
    expect(fin).toBeGreaterThan(render);
    expect(commit).toBeGreaterThan(fin);
  });
});

// Issue #2693: hovering an item in the trade window showed no stats tooltip
// because updateTradeWindow (hud.ts) never wired the trade slots to the
// shared attachTooltip/itemTooltip infrastructure bag slots use.
// tradeRowTooltipTarget is the pure lookup hud.ts's wiring resolves through:
// same InvSlot shape as a bag row (both offer sides carry it, per
// src/world_api/trade.ts's TradeOffer), so it must expose the exact item def
// plus per-instance payload (enchant/masterwork/signature) the bag tooltip
// itself reads.
describe('tradeRowTooltipTarget (trade slot tooltip wiring, #2693)', () => {
  it('resolves the item def for a plain trade slot', () => {
    const items: InvSlot[] = [{ itemId: 'worn_sword', count: 1 }];
    const target = tradeRowTooltipTarget(items, 0);
    expect(target?.item).toBe(ITEMS.worn_sword);
    expect(target?.instance).toBeUndefined();
  });

  it('carries the per-instance payload (enchant/masterwork/signature) through, matching the bag tooltip', () => {
    const items: InvSlot[] = [
      {
        itemId: 'worn_sword',
        count: 1,
        instance: { signer: 'Anna', rolled: { masterwork: true, stats: { str: 2 } } },
      },
    ];
    const target = tradeRowTooltipTarget(items, 0);
    expect(target?.instance).toEqual({
      signer: 'Anna',
      rolled: { masterwork: true, stats: { str: 2 } },
    });
  });

  it('resolves each offer row positionally, so the second slot does not pick up the first slot instance', () => {
    const items: InvSlot[] = [
      { itemId: 'worn_sword', count: 1 },
      { itemId: 'gnarled_staff', count: 1, instance: { signer: 'Bob' } },
    ];
    expect(tradeRowTooltipTarget(items, 0)?.item).toBe(ITEMS.worn_sword);
    expect(tradeRowTooltipTarget(items, 0)?.instance).toBeUndefined();
    expect(tradeRowTooltipTarget(items, 1)?.item).toBe(ITEMS.gnarled_staff);
    expect(tradeRowTooltipTarget(items, 1)?.instance).toEqual({ signer: 'Bob' });
  });

  it('returns null out of range (the trade-empty placeholder row) and for an unrecognized item id', () => {
    const items: InvSlot[] = [{ itemId: 'worn_sword', count: 1 }];
    expect(tradeRowTooltipTarget(items, 1)).toBeNull();
    expect(tradeRowTooltipTarget([{ itemId: 'not_a_real_item', count: 1 }], 0)).toBeNull();
  });

  it('returns null for a PROTOTYPE-KEY id (R34 family), never a tooltip target', () => {
    // ITEMS is a prototype-bearing Record: a bare ITEMS[id] truthiness test
    // resolves 'constructor' to a FUNCTION and the tooltip sink would
    // dereference it as an ItemDef. The merge resolution routes this lookup
    // through knownItemDef so these stay on the null arm.
    for (const key of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(tradeRowTooltipTarget([{ itemId: key, count: 1 }], 0), key).toBeNull();
    }
  });
});
