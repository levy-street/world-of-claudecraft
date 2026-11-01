// Pure view core for the two store-purchase dialogs (painter:
// purchase_reward_dialogs.ts): the loot window a paid parcel opens
// (src/sim/mail/purchase_parcels.ts) and the membership congratulation.
// DOM-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { ITEMS } from '../sim/data';
import type { PurchaseParcelView } from '../sim/mail/purchase_parcels';
import type { ItemDef } from '../sim/types';
import { itemDisplayName } from './entity_i18n';
import { formatDateTime, formatNumber, t } from './i18n';
import { itemImageUrl } from './icons';

export interface PurchaseLootRow {
  itemId: string;
  name: string;
  quality: ItemDef['quality'];
  /** Empty for a single copy. */
  count: string;
  image: string | null;
}

/** Merge newly offered parcels into the open set: a parcel is keyed by its letter,
 *  so a login re-announce never lists the same purchase twice. */
export function mergePurchaseParcels(
  open: readonly PurchaseParcelView[],
  offered: readonly PurchaseParcelView[],
): PurchaseParcelView[] {
  const byMail = new Map(open.map((parcel) => [parcel.mailId, parcel]));
  for (const parcel of offered) byMail.set(parcel.mailId, parcel);
  return [...byMail.values()];
}

/** One row per item the open parcels hold; unknown item ids are skipped. */
export function purchaseLootRows(parcels: readonly PurchaseParcelView[]): PurchaseLootRow[] {
  const rows: PurchaseLootRow[] = [];
  for (const parcel of parcels) {
    for (const slot of parcel.items) {
      const item = ITEMS[slot.itemId];
      if (!item) continue;
      rows.push({
        itemId: slot.itemId,
        name: itemDisplayName(item),
        quality: item.quality,
        count: slot.count > 1 ? formatNumber(slot.count) : '',
        image: itemImageUrl(slot.itemId),
      });
    }
  }
  return rows;
}

/** The congratulation body: with the new end date when the server sent one. */
export function membershipWelcomeBody(expiresAt: number | null): string {
  return expiresAt !== null && Number.isFinite(expiresAt) && expiresAt > 0
    ? t('hudChrome.membershipWelcome.bodyUntil', {
        date: formatDateTime(expiresAt, { dateStyle: 'medium' }),
      })
    : t('hudChrome.membershipWelcome.body');
}
