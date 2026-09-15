// The vendor sell-confirm policy (src/ui/vendor_sell_confirm_policy.ts): the
// confirmVendorSell master switch plus the quality threshold that lets a
// player bypass the confirm for cheap loot (the "why do I need to confirm my
// sale, buyback exists" report). tests/bags_vendor_sell_confirm.test.ts drives
// the real BagsWindow on top of it.
import { describe, expect, it } from 'vitest';
import { QUALITY_RANK } from '../src/sim/loot_master';
import {
  DEFAULT_VENDOR_SELL_CONFIRM_POLICY,
  VENDOR_SELL_CONFIRM_QUALITIES,
  vendorSaleNeedsConfirm,
  vendorSellConfirmPolicyFrom,
} from '../src/ui/vendor_sell_confirm_policy';

const junk = { kind: 'weapon', quality: 'poor' } as const;
const green = { kind: 'weapon', quality: 'uncommon' } as const;
const blue = { kind: 'weapon', quality: 'rare' } as const;
const unknownQuality = { kind: 'weapon' } as const;

describe('vendorSaleNeedsConfirm', () => {
  it("default policy: everything beyond true junk confirms (today's behavior)", () => {
    const p = DEFAULT_VENDOR_SELL_CONFIRM_POLICY;
    expect(vendorSaleNeedsConfirm(junk, undefined, undefined, p)).toBe(false);
    expect(
      vendorSaleNeedsConfirm(
        { kind: 'weapon', quality: 'common' } as const,
        undefined,
        undefined,
        p,
      ),
    ).toBe(true);
    expect(vendorSaleNeedsConfirm(green, undefined, undefined, p)).toBe(true);
    // An enchanted junk copy is not true junk (the enchanted-offhand report).
    expect(vendorSaleNeedsConfirm(junk, { enchantId: 'x' } as never, undefined, p)).toBe(true);
    expect(vendorSaleNeedsConfirm(junk, undefined, 'recipe', p)).toBe(true);
  });

  it('the threshold bypasses the confirm for every quality below it, threshold included', () => {
    const p = { enabled: true, minQualityRank: QUALITY_RANK.rare };
    expect(vendorSaleNeedsConfirm(green, undefined, undefined, p)).toBe(false);
    expect(vendorSaleNeedsConfirm(green, { enchantId: 'x' } as never, undefined, p)).toBe(false);
    expect(vendorSaleNeedsConfirm(blue, undefined, undefined, p)).toBe(true);
    expect(
      vendorSaleNeedsConfirm(
        { kind: 'weapon', quality: 'common' } as const,
        { rolled: { quality: 'rare' } } as never,
        undefined,
        p,
      ),
    ).toBe(true);
    // A poor copy that is NOT true junk (instanced / crafted) counts as
    // common for the threshold: it clears 'common' and nothing higher.
    expect(vendorSaleNeedsConfirm(junk, { enchantId: 'x' } as never, undefined, p)).toBe(false);
    expect(
      vendorSaleNeedsConfirm(junk, undefined, 'recipe', {
        enabled: true,
        minQualityRank: QUALITY_RANK.common,
      }),
    ).toBe(true);
    expect(
      vendorSaleNeedsConfirm({ kind: 'weapon', quality: 'epic' } as const, undefined, undefined, p),
    ).toBe(true);
  });

  it('an unknown quality reads as common', () => {
    expect(
      vendorSaleNeedsConfirm(unknownQuality, undefined, undefined, {
        enabled: true,
        minQualityRank: QUALITY_RANK.common,
      }),
    ).toBe(true);
    expect(
      vendorSaleNeedsConfirm(unknownQuality, undefined, undefined, {
        enabled: true,
        minQualityRank: QUALITY_RANK.uncommon,
      }),
    ).toBe(false);
  });

  it('falls back to the item quality when a rolled quality is not displayable', () => {
    expect(
      vendorSaleNeedsConfirm(
        { kind: 'weapon', quality: 'rare' } as const,
        { rolled: { quality: 'mythic' } } as never,
        undefined,
        { enabled: true, minQualityRank: QUALITY_RANK.rare },
      ),
    ).toBe(true);
    expect(
      vendorSaleNeedsConfirm(
        { kind: 'weapon', quality: 'common' } as const,
        { rolled: { quality: 'mythic' } } as never,
        undefined,
        { enabled: true, minQualityRank: QUALITY_RANK.rare },
      ),
    ).toBe(false);
  });

  it('the master switch off never confirms, whatever the threshold', () => {
    const p = { enabled: false, minQualityRank: QUALITY_RANK.common };
    expect(
      vendorSaleNeedsConfirm(
        { kind: 'weapon', quality: 'legendary' } as const,
        undefined,
        undefined,
        p,
      ),
    ).toBe(false);
  });
});

describe('vendorSellConfirmPolicyFrom', () => {
  it('reads both settings', () => {
    const values: Record<string, unknown> = {
      confirmVendorSell: false,
      confirmVendorSellMinQuality: 3,
    };
    expect(vendorSellConfirmPolicyFrom((k) => values[k])).toEqual({
      enabled: false,
      minQualityRank: 3,
    });
  });

  it('falls back to the default (confirm everything) with no reader or malformed values', () => {
    expect(vendorSellConfirmPolicyFrom(undefined)).toEqual(DEFAULT_VENDOR_SELL_CONFIRM_POLICY);
    expect(vendorSellConfirmPolicyFrom(() => undefined)).toEqual(
      DEFAULT_VENDOR_SELL_CONFIRM_POLICY,
    );
    expect(vendorSellConfirmPolicyFrom(() => Number.NaN)).toEqual({
      enabled: true,
      minQualityRank: QUALITY_RANK.common,
    });
  });
});

describe('VENDOR_SELL_CONFIRM_QUALITIES', () => {
  it('is the ascending ladder above poor, matching the setting range 1..5', () => {
    expect(VENDOR_SELL_CONFIRM_QUALITIES.map((q) => QUALITY_RANK[q])).toEqual([1, 2, 3, 4, 5]);
  });
});
