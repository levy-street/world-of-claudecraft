// Thin DOM consumer for the Heroic Quartermaster window.
//
// The consumer half of the pure-core + thin-consumer split (reference
// vendor_window.ts): paints the marks-currency shop from the structured
// HeroicShopView and reports buy/close clicks back through the injected
// callbacks. Reuses the vendor window's CSS classes (.vendor-item, .vi-name,
// .vi-price) so the shop reads as the same window family. It owns no state.

import { markDialogRoot } from '../../dialog_root';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { focusedWithin, restoreFirstEnabled } from '../../focus_restore';
import { formatNumber, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import type { HeroicShopView } from './heroic_vendor_view';

export interface HeroicVendorWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onBuy(itemId: string): void;
  onClose(): void;
}

/** Paint the Heroic Quartermaster panel from a prepared view. */
export function renderHeroicVendorWindow(
  el: HTMLElement,
  vendorName: string,
  view: HeroicShopView,
  deps: HeroicVendorWindowDeps,
): void {
  // The rebuild replaces the hovered row (its mouseleave never fires) and
  // collapses the scrolled list; drop the tooltip and restore the scroll.
  deps.hideTooltip();
  // Inventory and purse deltas repaint this window uninitiated (#2931), so
  // carry keyboard focus across the wipe per the focus-across-a-REBUILD
  // contract (the vendor_window idiom): the exact tile when it survived
  // enabled, else outward grid neighbors, else the close button.
  const focused = focusedWithin(el);
  const focusKey = focused?.dataset.focusKey ?? null;
  const focusedSlot = focused?.classList.contains('vendor-item')
    ? [...el.querySelectorAll<HTMLButtonElement>('button.vendor-item')].indexOf(
        focused as HTMLButtonElement,
      )
    : -1;
  const scrollTop = el.scrollTop;
  markDialogRoot(el, { label: t('itemUi.vendor.goodsTitle', { name: vendorName }) });
  el.innerHTML = `<div class="panel-title"><span>${esc(t('itemUi.vendor.goodsTitle', { name: vendorName }))}</span><button type="button" class="x-btn" data-close data-focus-key="close" aria-label="${esc(t('itemUi.vendor.close'))}">${svgIcon('close')}</button></div>`;

  const balance = document.createElement('div');
  balance.className = 'vendor-section-title';
  balance.textContent = t('heroicShop.balance', {
    count: formatNumber(view.balance, { maximumFractionDigits: 0 }),
  });
  el.appendChild(balance);

  // Same landscape tile grid as the goods/buyback vendor (.vendor-goods-grid
  // in components.css): the Heroic Quartermaster is the same kind of shop
  // counter and shares #vendor-window's width, so its rows must flow into
  // the grid rather than stay a single full-width column at that width.
  const goodsGrid = document.createElement('div');
  goodsGrid.className = 'vendor-goods-grid';
  for (const { itemId, item, marks, affordable } of view.rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vendor-item';
    row.disabled = !affordable;
    // Its own focus key so the restore ladder can find the same offer tile
    // across a rebuild (one tile per item id, so the id is the identity).
    row.dataset.focusKey = `buy:${itemId}`;
    const itemName = itemDisplayName(item);
    const marksLabel = formatNumber(marks, { maximumFractionDigits: 0 });
    row.setAttribute('aria-label', t('heroicShop.buyAria', { item: itemName, marks: marksLabel }));
    row.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(itemName)}</span><span class="vi-price${affordable ? '' : ' unaffordable'}">${esc(t('delveUi.shop.price', { marks: marksLabel }))}</span>`;
    row.addEventListener('click', () => deps.onBuy(itemId));
    deps.attachTooltip(
      row,
      () =>
        `${deps.itemTooltip(item)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuy'))}</div>`,
    );
    goodsGrid.appendChild(row);
  }
  // Guard mirrors vendor_window.ts's goods/buyback grids: skip appending an
  // empty grid container rather than leaving a dead node in the DOM.
  if (view.rows.length > 0) el.appendChild(goodsGrid);

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
  // Restore focus LAST (a bare focus() may scroll the tile into view, which
  // must win over the raw scroll restore for a keyboard player; with no
  // captured key, mouse users keep their exact scroll). Dataset equality
  // rather than an attribute selector: the keys embed item ids and this
  // needs no CSS.escape (the vendor_window precedent).
  if (focusKey) {
    const keyed = [...el.querySelectorAll<HTMLButtonElement>('[data-focus-key]')];
    const exact = keyed.find((b) => b.dataset.focusKey === focusKey);
    // The same-slot ladder: the tile's own slot first (after a sell-out the
    // grid shifts and it holds the next offer), then outward neighbors,
    // before the close fallback.
    const ladder = [...el.querySelectorAll<HTMLButtonElement>('button.vendor-item')];
    const slot = focusedSlot >= 0 ? Math.min(focusedSlot, ladder.length - 1) : -1;
    const neighbors: (HTMLButtonElement | undefined)[] = [];
    if (slot >= 0) {
      for (let step = 0; step < ladder.length; step++) {
        if (ladder[slot + step]) neighbors.push(ladder[slot + step]);
        if (step > 0 && ladder[slot - step]) neighbors.push(ladder[slot - step]);
      }
    }
    restoreFirstEnabled([exact, ...neighbors, keyed.find((b) => b.dataset.focusKey === 'close')]);
  }
}
