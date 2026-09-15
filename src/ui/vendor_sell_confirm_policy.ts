// The vendor sell-confirm policy: WHETHER a vendor sale confirms before it
// sells, resolved from the two Interface settings that own it.
//
//   confirmVendorSell            the master switch (off: classic one-click sale)
//   confirmVendorSellMinQuality  the lowest item quality that still confirms;
//                                anything below it sells instantly (a mis-sold
//                                item is recoverable from the vendor's Buyback)
//
// Both fold into the one instant gate vendorSellIsInstant (bags_view.ts)
// already draws around true junk, so the bags window keeps a single question:
// "does this sale confirm?". HOW MUCH sells (one unit on a plain click, the
// stack on ctrl) is unchanged and stays in the window.
//
// Pure (no DOM), the bags_view.ts precedent: a Vitest imports it directly.

import { QUALITY_RANK, type Quality } from '../sim/loot_master';
import type { ItemInstancePayload } from '../sim/types';
import { type BagItemInfo, vendorSellIsInstant } from './bags_view';

export interface VendorSellConfirmPolicy {
  /** The confirmVendorSell setting (on by default). */
  enabled: boolean;
  /** QUALITY_RANK of the confirmVendorSellMinQuality setting: the lowest
   *  quality that confirms. 1 (common) is the default and today's behavior. */
  minQualityRank: number;
}

/** The choice ladder the Options row offers, lowest first; the setting stores
 *  the QUALITY_RANK value, so 'poor' (always instant) is never a choice. */
export const VENDOR_SELL_CONFIRM_QUALITIES: readonly Quality[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
];

/** The policy every sale confirms under (the settings' defaults). */
export const DEFAULT_VENDOR_SELL_CONFIRM_POLICY: VendorSellConfirmPolicy = {
  enabled: true,
  minQualityRank: QUALITY_RANK.common,
};

/** Resolve the policy from a settings reader (Settings.get); a missing or
 *  malformed value falls back to the default, never to "no confirm". */
export function vendorSellConfirmPolicyFrom(
  read: ((key: 'confirmVendorSell' | 'confirmVendorSellMinQuality') => unknown) | undefined,
): VendorSellConfirmPolicy {
  if (!read) return DEFAULT_VENDOR_SELL_CONFIRM_POLICY;
  const enabled = read('confirmVendorSell');
  const min = read('confirmVendorSellMinQuality');
  return {
    enabled: typeof enabled === 'boolean' ? enabled : true,
    minQualityRank:
      typeof min === 'number' && Number.isFinite(min) ? Math.round(min) : QUALITY_RANK.common,
  };
}

/** Whether selling this copy to a vendor confirms first. False for true junk
 *  (vendorSellIsInstant), for a disabled policy, and for any quality below the
 *  policy's threshold. A copy's known rolled quality wins so the threshold
 *  matches the displayed quality; a malformed roll falls back to the item.
 *  A missing item quality reads as common, and so does a poor copy that is NOT
 *  true junk (instanced or crafted): it confirms at the default threshold
 *  exactly as before, and clears only a raised one. */
export function vendorSaleNeedsConfirm(
  item: BagItemInfo,
  instance: ItemInstancePayload | undefined,
  craftedRecipeId: string | undefined,
  policy: VendorSellConfirmPolicy,
): boolean {
  if (!policy.enabled) return false;
  if (vendorSellIsInstant(item, instance, craftedRecipeId)) return false;
  const quality =
    instance?.rolled?.quality !== undefined && Object.hasOwn(QUALITY_RANK, instance.rolled.quality)
      ? (instance.rolled.quality as Quality)
      : item.quality;
  const rank = Math.max(QUALITY_RANK[quality ?? 'common'], QUALITY_RANK.common);
  return rank >= policy.minQualityRank;
}
