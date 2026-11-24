// Store purchase parcels: the paid membership token and the annual bundle's mount
// reins arrive as server custody letters (server/membership_token_delivery_db.ts).
// They are the player's own purchase, so the client pops a loot window the moment
// one lands and the take works anywhere, not only at a raven pillar. The fixed
// reward items land even in full bags as the visible inventory overflow; anything
// else a letter carries keeps the normal capacity rule. Pure leaf: no SimContext.

import { MEMBERSHIP_ANNUAL_LETTER, MEMBERSHIP_TOKEN_LETTER } from '../content/letters';
import { MEMBERSHIP_TOKEN_ID } from '../content/membership';
import { MEMBERSHIP_REWARD_MOUNTS } from '../content/mounts';
import type { InvSlot } from '../types';

const PURCHASE_LETTER_IDS: ReadonlySet<string> = new Set([
  MEMBERSHIP_TOKEN_LETTER.letterId,
  MEMBERSHIP_ANNUAL_LETTER.letterId,
]);

const PURCHASE_REWARD_ITEM_IDS: ReadonlySet<string> = new Set([
  MEMBERSHIP_TOKEN_ID,
  ...MEMBERSHIP_REWARD_MOUNTS.map((mount) => `reins_${mount}`),
]);

/** Only server custody can book a purchase parcel: a system letter with a broker
 *  reference and one of the purchase letter ids. */
export function isPurchaseParcel(m: {
  kind: string;
  letterId?: string;
  custodyRef?: string;
}): boolean {
  return (
    m.kind === 'system' &&
    m.custodyRef !== undefined &&
    m.letterId !== undefined &&
    PURCHASE_LETTER_IDS.has(m.letterId)
  );
}

/** A paid reward item that may pass bag capacity as overflow. */
export function overflowsBags(itemId: string): boolean {
  return PURCHASE_REWARD_ITEM_IDS.has(itemId);
}

/** The loot window's view of one parcel: the letter to take and what it holds. */
export interface PurchaseParcelView {
  mailId: number;
  letterId: string;
  items: { itemId: string; count: number }[];
}

export function purchaseParcelView(m: {
  id: number;
  kind: string;
  letterId?: string;
  custodyRef?: string;
  items: readonly InvSlot[];
}): PurchaseParcelView | null {
  if (!isPurchaseParcel(m) || m.items.length === 0) return null;
  return {
    mailId: m.id,
    letterId: m.letterId!,
    items: m.items.map((s) => ({ itemId: s.itemId, count: s.count })),
  };
}
