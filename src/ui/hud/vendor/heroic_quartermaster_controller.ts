import { HEROIC_MARK_ITEM_ID } from '../../../sim/content/dungeon_difficulty';
import type { HeroicVendorOffer } from '../../../sim/content/heroic_vendor';
import type { InvSlot, ItemDef } from '../../../sim/types';
import { itemDisplayName } from '../../entity_i18n';
import { formatNumber, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import type { WindowFocusBridge } from '../../window_focus';
import { buildHeroicVendorView } from './heroic_vendor_view';
import { renderHeroicVendorWindow } from './heroic_vendor_window';

export interface HeroicQuartermasterControllerDeps {
  element(): HTMLElement;
  npcName(npcId: number): string | null;
  npcInRange(npcId: number, range: number): boolean;
  inventory(): readonly InvSlot[];
  stock: readonly HeroicVendorOffer[];
  items: Record<string, ItemDef>;
  presentation: PainterHostPresentation;
  focus: WindowFocusBridge;
  renderWindow?: typeof renderHeroicVendorWindow;
  closeOtherWindows(selector: string): void;
  closeBank(): void;
  closeCopperVendor(): void;
  hideTooltip(): void;
  confirm(title: string, body: string, okText: string, cancelText: string, onOk: () => void): void;
  buy(itemId: string): void;
}

function itemCount(inventory: readonly InvSlot[], itemId: string): number {
  return inventory.reduce((sum, slot) => sum + (slot.itemId === itemId ? slot.count : 0), 0);
}

/**
 * Owns the Heroic Quartermaster window lifecycle. Raid rewards do not route
 * through this controller; it retains only the existing five-player gear shop.
 */
export class HeroicQuartermasterController {
  private npcId: number | null = null;
  private openerFocus: HTMLElement | null = null;

  constructor(private readonly deps: HeroicQuartermasterControllerDeps) {}

  get isOpen(): boolean {
    return this.npcId !== null;
  }

  open(npcId: number): void {
    this.deps.closeOtherWindows('#vendor-window');
    this.deps.closeBank();
    this.deps.closeCopperVendor();
    this.npcId = npcId;
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
    const balance = itemCount(this.deps.inventory(), HEROIC_MARK_ITEM_ID);
    (this.deps.renderWindow ?? renderHeroicVendorWindow)(
      this.deps.element(),
      npcName,
      buildHeroicVendorView(this.deps.stock, this.deps.items, balance),
      {
        ...this.deps.presentation,
        hideTooltip: () => this.deps.hideTooltip(),
        onBuy: (itemId) => this.requestPurchase(itemId),
        onClose: () => this.close(),
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
    if (this.isOpen) this.render();
  }

  onError(_message: string): boolean {
    return false;
  }

  requestPurchase(itemId: string): void {
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
      () => this.deps.buy(itemId),
    );
  }
}
