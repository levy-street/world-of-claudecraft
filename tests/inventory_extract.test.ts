// Exact-copy escrow extraction (src/sim/inventory_extract.ts): the pure leaf
// the server's $WOC marketplace listing flow uses to pull one unit of a
// specific slot out of a player's bags, plus the thin Sim facade delegate.
// Transfer legality (soulbound / quest / noMarketList / the explicit boundTo
// lock) and stale-reference refusals are the load-bearing behavior: a refusal
// here is what keeps an ineligible or already-moved copy out of escrow.

import { describe, expect, it } from 'vitest';
import { extractTradableCopy } from '../src/sim/inventory_extract';
import type { InvSlot, ItemDef } from '../src/sim/types';

const def = (over: Partial<ItemDef> = {}): ItemDef =>
  ({ kind: 'weapon', name: 'Test Blade', sellValue: 100, ...over }) as ItemDef;

const inv = (...slots: InvSlot[]): InvSlot[] => slots;

describe('extractTradableCopy (pure leaf)', () => {
  it('extracts a plain single-unit slot and removes it from the inventory', () => {
    const inventory = inv({ itemId: 'blade', count: 1 });
    const out = extractTradableCopy(inventory, { index: 0, itemId: 'blade' }, def());
    expect(out).toEqual({ ok: true, extracted: { itemId: 'blade', count: 1 } });
    expect(inventory).toHaveLength(0);
  });

  it('decrements a multi-unit stack and leaves the survivors in place', () => {
    const inventory = inv({ itemId: 'blade', count: 3 });
    const out = extractTradableCopy(inventory, { index: 0, itemId: 'blade' }, def());
    expect(out.ok).toBe(true);
    expect(inventory).toEqual([{ itemId: 'blade', count: 3 - 1 }]);
  });

  it('moves the original payload object out with the final unit of a slot', () => {
    const payload = { signer: 'Aldric', rolled: { stats: { str: 3 } } };
    const inventory = inv({ itemId: 'blade', count: 1, instance: payload });
    const out = extractTradableCopy(inventory, { index: 0, itemId: 'blade' }, def());
    if (!out.ok) throw new Error('expected ok');
    expect(out.extracted.instance).toBe(payload);
  });

  it('clones the payload when the stack survives, so the two copies never alias', () => {
    const payload = { signer: 'Aldric', charges: undefined, rolled: { stats: { str: 3 } } };
    const inventory = inv({ itemId: 'blade', count: 2, instance: payload });
    const out = extractTradableCopy(inventory, { index: 0, itemId: 'blade' }, def());
    if (!out.ok) throw new Error('expected ok');
    expect(out.extracted.instance).not.toBe(payload);
    expect(out.extracted.instance?.rolled).not.toBe(payload.rolled);
    expect(out.extracted.instance?.rolled?.stats).toEqual({ str: 3 });
    if (out.extracted.instance?.rolled?.stats) out.extracted.instance.rolled.stats.str = 99;
    expect(inventory[0].instance?.rolled?.stats?.str).toBe(3);
  });

  it('carries craftedRecipeId with the extracted copy', () => {
    const inventory = inv({ itemId: 'blade', count: 1, craftedRecipeId: 'r_blade' });
    const out = extractTradableCopy(inventory, { index: 0, itemId: 'blade' }, def());
    if (!out.ok) throw new Error('expected ok');
    expect(out.extracted.craftedRecipeId).toBe('r_blade');
  });

  it('drops the advisory bag cell: the copy is leaving the bags', () => {
    const inventory = inv({ itemId: 'blade', count: 1, slot: 7 });
    const out = extractTradableCopy(inventory, { index: 0, itemId: 'blade' }, def());
    if (!out.ok) throw new Error('expected ok');
    expect('slot' in out.extracted).toBe(false);
  });

  describe('refusals', () => {
    it.each([
      ['a negative index', { index: -1, itemId: 'blade' }],
      ['a fractional index', { index: 0.5, itemId: 'blade' }],
      ['an out-of-range index', { index: 1, itemId: 'blade' }],
      ['an itemId mismatch', { index: 0, itemId: 'other' }],
    ])('refuses %s as not_found', (_label, ref) => {
      const inventory = inv({ itemId: 'blade', count: 1 });
      expect(extractTradableCopy(inventory, ref, def())).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(inventory).toHaveLength(1);
    });

    it('refuses a missing def as not_found', () => {
      const inventory = inv({ itemId: 'blade', count: 1 });
      expect(extractTradableCopy(inventory, { index: 0, itemId: 'blade' }, undefined)).toEqual({
        ok: false,
        reason: 'not_found',
      });
    });

    it('refuses a soulbound def', () => {
      const inventory = inv({ itemId: 'blade', count: 1 });
      const out = extractTradableCopy(
        inventory,
        { index: 0, itemId: 'blade' },
        def({ soulbound: true }),
      );
      expect(out).toEqual({ ok: false, reason: 'soulbound' });
      expect(inventory).toHaveLength(1);
    });

    it('EXTRACTS a soulbound mount: escrow must not re-refuse what policy cleared', () => {
      // The gate that would otherwise have made every mount unlistable no matter
      // what the server's policy said. Every reins item is soulbound by content
      // design (holding the reins IS owning the mount), so a local soulbound
      // refusal here beat the policy silently, at escrow, after the listing had
      // already been accepted.
      const inventory = inv({ itemId: 'reins', count: 1 });
      const out = extractTradableCopy(
        inventory,
        { index: 0, itemId: 'reins' },
        def({ kind: 'mount', soulbound: true, slot: undefined }),
      );
      expect(out).toEqual({ ok: true, extracted: { itemId: 'reins', count: 1 } });
      expect(inventory).toHaveLength(0);
    });

    it('EXTRACTS a noMarketList chroma plate, and still refuses a bound one', () => {
      const inventory = inv({ itemId: 'plate', count: 1 });
      // `def` is typed against the weapon arm of the ItemDef union, so a
      // consumable's shape needs the same unknown hop the helper itself uses.
      const plateDef = {
        kind: 'consumable',
        name: 'Test Plate',
        sellValue: 100,
        noMarketList: true,
        use: { type: 'mechChroma', chromaId: 'onyx_gold' },
      } as unknown as ItemDef;
      expect(extractTradableCopy(inventory, { index: 0, itemId: 'plate' }, plateDef)).toEqual({
        ok: true,
        extracted: { itemId: 'plate', count: 1 },
      });
      // The tolerance is one flag, not a blanket pass: a bound copy still stays.
      const bound = inv({ itemId: 'plate', count: 1, instance: { boundTo: 4 } });
      expect(extractTradableCopy(bound, { index: 0, itemId: 'plate' }, plateDef)).toEqual({
        ok: false,
        reason: 'bound_copy',
      });
      expect(bound).toHaveLength(1);
    });

    it('refuses a quest item', () => {
      const inventory = inv({ itemId: 'blade', count: 1 });
      const out = extractTradableCopy(
        inventory,
        { index: 0, itemId: 'blade' },
        def({ kind: 'quest' }),
      );
      expect(out).toEqual({ ok: false, reason: 'quest_item' });
    });

    it('refuses a noMarketList def', () => {
      const inventory = inv({ itemId: 'blade', count: 1 });
      const out = extractTradableCopy(
        inventory,
        { index: 0, itemId: 'blade' },
        def({ noMarketList: true }),
      );
      expect(out).toEqual({ ok: false, reason: 'no_market_list' });
    });

    it('refuses a bound copy explicitly (the boundTo trade lock, never emergent)', () => {
      const inventory = inv({ itemId: 'blade', count: 1, instance: { boundTo: 12 } });
      const out = extractTradableCopy(inventory, { index: 0, itemId: 'blade' }, def());
      expect(out).toEqual({ ok: false, reason: 'bound_copy' });
      expect(inventory).toHaveLength(1);
    });

    it('refuses a still-armed commissioned copy before any stamp lands', () => {
      // bindOnTrade with no boundTo: the copy binds to whoever receives it next,
      // which an anonymous escrow has nobody to be. The gold market and mail
      // refuse the same state, and unbinding returns a copy to it.
      const inventory = inv({ itemId: 'blade', count: 1, instance: { bindOnTrade: true } });
      const out = extractTradableCopy(inventory, { index: 0, itemId: 'blade' }, def());
      expect(out).toEqual({ ok: false, reason: 'bind_armed' });
      expect(inventory).toHaveLength(1);
    });

    it('refuses a copy the owner item-locked, at the extraction seam (R10)', () => {
      // The 'locked' member of ExtractRefusal is PRODUCED here: extraction runs
      // exchangeHardLock on the live slot, which returns 'locked' for an
      // owner-locked copy, and the copy stays in the bags.
      const inventory = inv({ itemId: 'blade', count: 1, instance: { locked: true } });
      const out = extractTradableCopy(inventory, { index: 0, itemId: 'blade' }, def());
      expect(out).toEqual({ ok: false, reason: 'locked' });
      expect(inventory).toHaveLength(1);
      expect(inventory[0]?.instance?.locked).toBe(true);
    });

    it('refuses a stale instance reference (the payload the caller saw is gone)', () => {
      const inventory = inv({ itemId: 'blade', count: 1, instance: { signer: 'Belra' } });
      const out = extractTradableCopy(
        inventory,
        { index: 0, itemId: 'blade', expectInstance: { signer: 'Aldric' } },
        def(),
      );
      expect(out).toEqual({ ok: false, reason: 'stale_copy' });
    });

    it('refuses expectInstance null against a now-instanced slot, and vice versa', () => {
      const instanced = inv({ itemId: 'blade', count: 1, instance: { signer: 'Belra' } });
      expect(
        extractTradableCopy(instanced, { index: 0, itemId: 'blade', expectInstance: null }, def()),
      ).toEqual({ ok: false, reason: 'stale_copy' });
      const plain = inv({ itemId: 'blade', count: 1 });
      expect(
        extractTradableCopy(
          plain,
          { index: 0, itemId: 'blade', expectInstance: { signer: 'Belra' } },
          def(),
        ),
      ).toEqual({ ok: false, reason: 'stale_copy' });
    });

    it('accepts a matching expectInstance across key order and absent-vs-undefined', () => {
      const inventory = inv({
        itemId: 'blade',
        count: 1,
        instance: { rolled: { quality: 'epic' }, signer: 'Aldric' },
      });
      const out = extractTradableCopy(
        inventory,
        {
          index: 0,
          itemId: 'blade',
          expectInstance: { signer: 'Aldric', rolled: { quality: 'epic' }, enchant: undefined },
        },
        def(),
      );
      expect(out.ok).toBe(true);
    });
  });
});
