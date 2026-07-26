import type { HeroicVendorOffer } from '../../../sim/content/heroic_vendor';
import { NYTHRAXIS_RAID_DUNGEON_ID } from '../../../sim/content/procedural_raid_loot';
import type { InvSlot, ItemDef, PlayerClass } from '../../../sim/types';
import { itemDisplayName } from '../../entity_i18n';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { itemPresentationName } from '../../procedural_item_presentation';
import type { WindowFocusBridge } from '../../window_focus';
import { HeroicVendorOperationState } from './heroic_vendor_pending_core';
import { buildHeroicQuartermasterView, type HeroicVendorTab } from './heroic_vendor_view';
import { renderHeroicQuartermasterWindow } from './heroic_vendor_window';

export interface HeroicQuartermasterControllerDeps {
  element(): HTMLElement;
  npcName(npcId: number): string | null;
  npcInRange(npcId: number, range: number): boolean;
  inventory(): readonly InvSlot[];
  playerClass(): PlayerClass;
  raidLockoutIds(): readonly string[];
  stock: readonly HeroicVendorOffer[];
  items: Record<string, ItemDef>;
  presentation: PainterHostPresentation;
  focus: WindowFocusBridge;
  renderWindow?: typeof renderHeroicQuartermasterWindow;
  closeOtherWindows(selector: string): void;
  closeBank(): void;
  closeCopperVendor(): void;
  hideTooltip(): void;
  confirm(title: string, body: string, okText: string, cancelText: string, onOk: () => void): void;
  buy(itemId: string): void;
  forge(offerId: string): void;
  tune(instanceUid: string): void;
}

/**
 * Owns the Heroic Quartermaster window lifecycle and request state. Hud only
 * forwards interaction/event boundaries; tab state, confirmation gates,
 * pending recovery, focus return, and painter composition stay here.
 */
export class HeroicQuartermasterController {
  private npcId: number | null = null;
  private openerFocus: HTMLElement | null = null;
  private tab: HeroicVendorTab = 'gear';
  private readonly operation = new HeroicVendorOperationState();

  constructor(private readonly deps: HeroicQuartermasterControllerDeps) {}

  get isOpen(): boolean {
    return this.npcId !== null;
  }

  open(npcId: number): void {
    this.deps.closeOtherWindows('#vendor-window');
    this.deps.closeBank();
    this.deps.closeCopperVendor();
    this.npcId = npcId;
    this.tab = 'gear';
    this.operation.reset();
    this.render();
    this.openerFocus = this.deps.focus.captureFocus();
  }

  close(): void {
    if (this.npcId === null) return;
    this.deps.element().style.display = 'none';
    this.npcId = null;
    this.deps.hideTooltip();
    this.deps.focus.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  render(): void {
    if (this.npcId === null) return;
    const npcName = this.deps.npcName(this.npcId);
    if (npcName === null) return;
    (this.deps.renderWindow ?? renderHeroicQuartermasterWindow)(
      this.deps.element(),
      npcName,
      this.buildView(this.tab),
      {
        ...this.deps.presentation,
        hideTooltip: () => this.deps.hideTooltip(),
        onBuy: (itemId) => this.requestPurchase(itemId),
        onForge: (offerId) => this.requestForge(offerId),
        onTune: (instanceUid) => this.requestTune(instanceUid),
        onTab: (tab) => {
          this.tab = tab;
          this.operation.clearStatus();
          this.render();
        },
        onClose: () => this.close(),
        status: this.operation.status,
        pending: this.operation.pending !== null,
      },
    );
  }

  relocalize(): void {
    if (this.isOpen && this.deps.element().style.display === 'block') this.render();
  }

  updateProximity(): void {
    if (this.npcId !== null && !this.deps.npcInRange(this.npcId, 8)) this.close();
  }

  onVendorResult(): void {
    if (!this.isOpen) return;
    const pendingTab = this.operation.pending;
    if (pendingTab) {
      this.operation.resolve(t(`heroicShop.status.${pendingTab}` as TranslationKey));
    }
    this.render();
  }

  onError(message: string): boolean {
    if (!this.isOpen || !this.operation.reject(message)) return false;
    this.render();
    return true;
  }

  requestPurchase(itemId: string): void {
    if (this.operation.pending) return;
    const offer = this.deps.stock.find((candidate) => candidate.itemId === itemId);
    const item = this.deps.items[itemId];
    if (!offer || !item) return;
    this.deps.confirm(
      t('heroicShop.buyConfirmTitle'),
      t('heroicShop.buyConfirmBody', {
        item: itemDisplayName(item),
        marks: formatNumber(offer.marks, { maximumFractionDigits: 0 }),
      }),
      t('heroicShop.buyConfirmAccept'),
      t('heroicShop.buyConfirmCancel'),
      () => {
        if (!this.operation.begin('gear', t('heroicShop.status.pending'))) return;
        this.render();
        this.deps.buy(itemId);
      },
    );
  }

  requestForge(offerId: string): void {
    if (this.operation.pending) return;
    const row = this.buildView('forge').forgeRows.find(
      (candidate) => candidate.offerId === offerId,
    );
    if (!row || row.blockReason) return;
    const item = row.powerId
      ? t(`itemUi.procedural.legendary.${row.powerId}.name` as TranslationKey)
      : itemDisplayName(row.item);
    this.deps.confirm(
      t('heroicShop.forgeConfirmTitle'),
      t('heroicShop.forgeConfirmBody', {
        item,
        fragments: formatNumber(row.cost.fragments, { maximumFractionDigits: 0 }),
        marks: formatNumber(row.cost.heroicMarks, { maximumFractionDigits: 0 }),
      }),
      t('heroicShop.forgeConfirmAccept'),
      t('heroicShop.buyConfirmCancel'),
      () => {
        if (!this.operation.begin('forge', t('heroicShop.status.pending'))) return;
        this.render();
        this.deps.forge(offerId);
      },
    );
  }

  requestTune(instanceUid: string): void {
    if (this.operation.pending) return;
    const row = this.buildView('tune').tuneRows.find(
      (candidate) => candidate.instanceUid === instanceUid,
    );
    if (!row || row.blockReason) return;
    const item = itemPresentationName({ name: itemDisplayName(row.item) }, row.instance);
    this.deps.confirm(
      t('heroicShop.tuneConfirmTitle'),
      t('heroicShop.tuneConfirmBody', {
        item,
        fragments: formatNumber(row.cost.fragments, { maximumFractionDigits: 0 }),
        marks: formatNumber(row.cost.heroicMarks, { maximumFractionDigits: 0 }),
      }),
      t('heroicShop.tuneConfirmAccept'),
      t('heroicShop.buyConfirmCancel'),
      () => {
        if (!this.operation.begin('tune', t('heroicShop.status.pending'))) return;
        this.render();
        this.deps.tune(instanceUid);
      },
    );
  }

  private buildView(tab: HeroicVendorTab) {
    return buildHeroicQuartermasterView({
      tab,
      stock: this.deps.stock,
      items: this.deps.items,
      inventory: this.deps.inventory(),
      playerClass: this.deps.playerClass(),
      heroicClear: this.deps.raidLockoutIds().includes(`${NYTHRAXIS_RAID_DUNGEON_ID}:heroic`),
    });
  }
}
