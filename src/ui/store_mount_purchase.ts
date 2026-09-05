// Store-mount purchase controller for the WOC Store's Machine Stable strip: the
// row model, the one-spend guard, confirmation, authoritative refusal handling,
// and stale-surface result routing, mirroring the weapon-skin controller
// (src/ui/store_armory_purchase.ts). DailyRewardsWindow supplies only its spend
// and repaint seams. Kept as its own controller rather than generalizing the
// skin one: that one is typed on ArmorySkinRow end to end (inspector refresh,
// skin copy), and this is the second copy, not the third.
//
// What the two share is stated once as StoreSpendSeams so the window wires one
// object into both. A mount SKU is a GRANT (like a skin, unlike a repeatable
// charter): the service dedupes on the grant row, so no intent key travels, and
// ownership reflects through the refreshed rows once the reins lands in the
// bags via the server mirror (server/store_mount_grants.ts).

import type { StoreSpendResult } from './claudium_purchase_bridge';
import { formatNumber, t } from './i18n';
import { type StoreArmoryPurchaseDeps, usableCost } from './store_armory_purchase';
import { storeMountName, storeMountsSectionHtml } from './store_mount_card_view';
import { buildStoreMountRows, type StoreMountRow, type WocStoreItemInput } from './woc_store_view';

/** The window seams every store spend controller needs: the skin controller's
 *  deps minus its skin-only row model and inspector. */
export type StoreSpendSeams = Pick<
  StoreArmoryPurchaseDeps,
  | 'balance'
  | 'setBalance'
  | 'captureSurface'
  | 'surfaceIsCurrent'
  | 'showDecision'
  | 'showNeedMore'
  | 'showResult'
  | 'needMoreText'
  | 'setPriceChanged'
  | 'setError'
  | 'refreshStore'
  | 'rebuildAndPaint'
>;

export interface StoreMountPurchaseDeps extends StoreSpendSeams {
  /** The service spend for a kind 'item' SKU. */
  spend(itemId: string, cost: number): Promise<StoreSpendResult | undefined>;
}

export class StoreMountPurchase {
  private rows: StoreMountRow[] = [];
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: StoreMountPurchaseDeps) {}

  /** Re-project the rows from the service snapshot plus the live mount
   *  ownership mirror (IWorldMounts.ownedMounts), so a fresh purchase reads as
   *  owned as soon as the reins is in the bags. */
  rebuild(
    balance: number | null,
    items: WocStoreItemInput[],
    ownedMountKeys: readonly string[],
  ): void {
    this.rows = buildStoreMountRows(balance, items, ownedMountKeys);
  }

  sectionHtml(): string {
    return storeMountsSectionHtml(this.rows);
  }

  rowById(itemId: string): StoreMountRow | null {
    return this.rows.find((row) => row.itemId === itemId) ?? null;
  }

  /** A click on a card's buy button. The id comes off the DOM, so an unknown
   *  or missing one is a no-op rather than an error. */
  request(itemId: string | undefined): void {
    const row = itemId === undefined ? null : this.rowById(itemId);
    if (row) this.requestRow(row);
  }

  private requestRow(row: StoreMountRow): void {
    if (row.owned || !row.purchasable || row.costClaudium === null || this.inFlight.has(row.itemId))
      return;
    const name = storeMountName(row.itemId);
    if (!row.affordable) {
      this.deps.showNeedMore(
        name,
        row.costClaudium,
        this.deps.balance(),
        this.deps.captureSurface(),
      );
      return;
    }
    const generation = this.deps.captureSurface();
    this.deps.showDecision({
      title: t('hudChrome.wocStore.confirmTitle'),
      body: t('hudChrome.wocStore.confirmBody', {
        item: name,
        cost: formatNumber(row.costClaudium, { maximumFractionDigits: 0 }),
      }),
      confirmText: t('hudChrome.wocStore.confirmPurchase'),
      cancelText: t('hudChrome.wocStore.cancel'),
      onConfirm: () => void this.purchase(row, generation),
    });
  }

  async purchase(row: StoreMountRow, generation = this.deps.captureSurface()): Promise<void> {
    const cost = row.costClaudium;
    if (cost === null || this.inFlight.has(row.itemId)) return;
    this.deps.setPriceChanged(false);
    this.inFlight.add(row.itemId);
    let reconfirm: StoreMountRow | null = null;
    try {
      let result: StoreSpendResult | undefined;
      try {
        result = await this.deps.spend(row.itemId, cost);
      } catch {
        this.fail(generation);
        return;
      }
      reconfirm = await this.finish(row, cost, generation, result);
    } finally {
      // Released only after the outcome refresh, like the skin controller: the
      // old buy control must not start a second charge while the first
      // outcome refresh is still in flight.
      this.inFlight.delete(row.itemId);
    }
    if (reconfirm) this.requestRow(reconfirm);
  }

  private async finish(
    row: StoreMountRow,
    cost: number,
    generation: number,
    result: StoreSpendResult | undefined,
  ): Promise<StoreMountRow | null> {
    if (!this.deps.surfaceIsCurrent(generation)) {
      this.presentStale(row, cost, result);
      return null;
    }
    if (result?.reason === 'price_changed') {
      this.deps.setPriceChanged(true);
      if (result.balance !== null) this.deps.setBalance(result.balance);
      await this.deps.refreshStore();
      if (!this.deps.surfaceIsCurrent(generation)) {
        this.deps.showResult('failure', t('hudChrome.wocStore.priceChanged'));
        return null;
      }
      const current = this.rowById(row.itemId);
      if (current && current.costClaudium !== null && current.costClaudium !== cost) {
        return current;
      }
      return null;
    }
    if (result?.reason === 'insufficient_balance') {
      if (result.balance !== null) {
        this.deps.setBalance(result.balance);
        this.deps.rebuildAndPaint();
      }
      this.deps.showNeedMore(
        storeMountName(row.itemId),
        usableCost(result.costClaudium) ?? cost,
        result.balance,
        generation,
      );
      return null;
    }
    const owned = result?.granted === true || result?.reason === 'already_granted';
    await this.deps.refreshStore();
    if (!this.deps.surfaceIsCurrent(generation)) {
      this.deps.showResult(
        owned ? 'success' : 'failure',
        owned ? t('hudChrome.wocStore.owned') : t('hudChrome.wocStore.error'),
      );
      return null;
    }
    // On the live surface only the refreshed row proves ownership, exactly as
    // the skin controller reads it: an already_granted answer whose reins the
    // mirror has not landed is the error state, not a silent success (the
    // stale-surface toast above is the one place already_granted reads as
    // owned, because there is no row to check against there).
    if (!result?.granted && !this.rowById(row.itemId)?.owned) this.deps.setError();
    return null;
  }

  private fail(generation: number): void {
    if (this.deps.surfaceIsCurrent(generation)) this.deps.setError();
    else this.deps.showResult('failure', t('hudChrome.wocStore.error'));
  }

  private presentStale(
    row: StoreMountRow,
    sentCost: number,
    result: StoreSpendResult | undefined,
  ): void {
    if (result?.granted || result?.reason === 'already_granted') {
      this.deps.showResult('success', t('hudChrome.wocStore.owned'));
    } else if (result?.reason === 'price_changed') {
      this.deps.showResult('failure', t('hudChrome.wocStore.priceChanged'));
    } else if (result?.reason === 'insufficient_balance') {
      this.deps.showResult(
        'failure',
        this.deps.needMoreText(
          storeMountName(row.itemId),
          usableCost(result.costClaudium) ?? sentCost,
          result.balance,
        ),
      );
    } else {
      this.deps.showResult('failure', t('hudChrome.wocStore.error'));
    }
  }
}
