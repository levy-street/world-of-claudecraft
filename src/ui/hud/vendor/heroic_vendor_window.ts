// Thin DOM consumer for the Heroic Quartermaster window.
//
// Paints the marks-currency shop from a structured HeroicShopView and reports
// buy/close clicks through injected callbacks. It owns no state.

import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import type { HeroicShopView } from './heroic_vendor_view';

export interface HeroicVendorWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onBuy(itemId: string): void;
  onClose(): void;
}

/** Paint the Heroic Quartermaster gear panel from a prepared view. */
export function renderHeroicVendorWindow(
  el: HTMLElement,
  vendorName: string,
  view: HeroicShopView,
  deps: HeroicVendorWindowDeps,
): void {
  deps.hideTooltip();
  const scrollTop = el.scrollTop;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('itemUi.vendor.goodsTitle', { name: vendorName }))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.vendor.close'))}">${svgIcon('close')}</button></div>`;

  const balance = document.createElement('div');
  balance.className = 'vendor-section-title';
  balance.textContent = t('heroicShop.balance', {
    count: formatNumber(view.balance, { maximumFractionDigits: 0 }),
  });
  el.appendChild(balance);

  const goodsGrid = document.createElement('div');
  goodsGrid.className = 'vendor-goods-grid';
  for (const { itemId, item, marks, affordable } of view.rows) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vendor-item';
    row.disabled = !affordable;
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
  if (view.rows.length > 0) el.appendChild(goodsGrid);

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
