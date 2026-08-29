// Weapon-skin purchase controller for the WOC Store. It owns the one-spend
// guard, confirmation, authoritative refusal handling, and stale-surface result
// routing; DailyRewardsWindow supplies only its model/repaint seams.

import { localizeWeaponSkin } from './armory_labels';
import type { StoreSpendResult } from './claudium_purchase_bridge';
import { formatNumber, t } from './i18n';
import type { StoreDecisionPromptOptions } from './store_decision_prompt';
import type { ArmorySkinRow } from './woc_store_view';

export interface StoreArmoryPurchaseDeps {
  balance(): number | null;
  setBalance(balance: number): void;
  captureSurface(): number;
  surfaceIsCurrent(generation: number): boolean;
  spend(itemId: string, cost: number): Promise<StoreSpendResult | undefined>;
  showDecision(options: Omit<StoreDecisionPromptOptions, 'closeText'>): void;
  showNeedMore(itemName: string, cost: number, balance: number | null, generation: number): void;
  showResult(tone: 'success' | 'failure', text: string): void;
  needMoreText(itemName: string, cost: number, balance: number | null): string;
  setPriceChanged(changed: boolean): void;
  setError(): void;
  refreshStore(): Promise<void>;
  rebuildAndPaint(): void;
  rowById(itemId: string): ArmorySkinRow | null;
  refreshInspector(row: ArmorySkinRow): void;
}

export class StoreArmoryPurchase {
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: StoreArmoryPurchaseDeps) {}

  refreshAfterAppearanceChange(skinId: string): void {
    this.deps.rebuildAndPaint();
    const row = this.deps.rowById(skinId);
    if (row) this.deps.refreshInspector(row);
  }

  request(row: ArmorySkinRow): void {
    if (
      row.owned ||
      !row.purchasable ||
      row.costClaudium === null ||
      this.inFlight.has(row.skin.id)
    )
      return;
    const copy = localizeWeaponSkin(row.skin);
    if (!row.affordable) {
      this.deps.showNeedMore(
        copy.name,
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
        item: copy.name,
        cost: formatNumber(row.costClaudium, { maximumFractionDigits: 0 }),
      }),
      confirmText: t('hudChrome.wocStore.confirmPurchase'),
      cancelText: t('hudChrome.wocStore.cancel'),
      onConfirm: () => void this.purchase(row, generation),
    });
  }

  async purchase(row: ArmorySkinRow, generation = this.deps.captureSurface()): Promise<void> {
    const cost = row.costClaudium;
    if (cost === null || this.inFlight.has(row.skin.id)) return;
    this.deps.setPriceChanged(false);
    this.inFlight.add(row.skin.id);
    let reconfirm: ArmorySkinRow | null = null;
    try {
      let result: StoreSpendResult | undefined;
      try {
        result = await this.deps.spend(row.skin.id, cost);
      } catch {
        this.fail(generation);
        return;
      }
      reconfirm = await this.finish(row, cost, generation, result);
    } finally {
      // The mirror/inspector remains stale until finish() completes. Releasing
      // after spend() alone lets the old buy control start a second charge
      // while the first outcome refresh is still in flight.
      this.inFlight.delete(row.skin.id);
    }
    if (reconfirm) this.request(reconfirm);
  }

  private async finish(
    row: ArmorySkinRow,
    cost: number,
    generation: number,
    result: StoreSpendResult | undefined,
  ): Promise<ArmorySkinRow | null> {
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
      const current = this.deps.rowById(row.skin.id);
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
      const authoritativeCost = usableCost(result.costClaudium) ?? cost;
      this.deps.showNeedMore(
        localizeWeaponSkin(row.skin).name,
        authoritativeCost,
        result.balance,
        generation,
      );
      return null;
    }
    if (!result?.granted) {
      await this.deps.refreshStore();
      if (!this.deps.surfaceIsCurrent(generation)) {
        this.deps.showResult(
          result?.reason === 'already_granted' ? 'success' : 'failure',
          result?.reason === 'already_granted'
            ? t('hudChrome.wocStore.owned')
            : t('hudChrome.wocStore.error'),
        );
        return null;
      }
      if (!this.deps.rowById(row.skin.id)?.owned) {
        this.deps.setError();
        return null;
      }
    } else {
      await this.deps.refreshStore();
      if (!this.deps.surfaceIsCurrent(generation)) {
        this.deps.showResult('success', t('hudChrome.wocStore.owned'));
        return null;
      }
    }
    const fresh = this.deps.rowById(row.skin.id);
    if (fresh) this.deps.refreshInspector(fresh);
    return null;
  }

  private fail(generation: number): void {
    if (this.deps.surfaceIsCurrent(generation)) this.deps.setError();
    else this.deps.showResult('failure', t('hudChrome.wocStore.error'));
  }

  private presentStale(
    row: ArmorySkinRow,
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
          localizeWeaponSkin(row.skin).name,
          usableCost(result.costClaudium) ?? sentCost,
          result.balance,
        ),
      );
    } else {
      this.deps.showResult('failure', t('hudChrome.wocStore.error'));
    }
  }
}

function usableCost(cost: number | null): number | null {
  return cost !== null && Number.isFinite(cost) && cost > 0 ? cost : null;
}
