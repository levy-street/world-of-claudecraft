// Thin DOM consumer for the vendor window.
//
// The consumer half of the pure-core + thin-consumer split: it paints
// #vendor-window from the structured VendorView (vendor_view.ts) and wires the
// buy / buyback / close actions. It owns no state. The cross-window
// orchestration (which windows to close, bag re-centring, mobile teardown)
// stays in Hud because it needs Hud's private state; this module only renders
// one panel and reports clicks back through the injected callbacks.

import { itemDisplayName } from './entity_i18n';
import { esc } from './esc';
import { formatMoney as formatLocalizedMoney, formatNumber, t } from './i18n';
import type { PainterHostPresentation } from './painter_host';
import { svgIcon } from './ui_icons';
import type { VendorView } from './vendor_view';

/**
 * Hud-supplied glue. The icon/money/tooltip painters are the shared
 * PainterHostPresentation bag (Hud builds it once and hands it to every window
 * that renders item rows); this composes that base and adds the vendor-specific
 * tooltip teardown, the buy/buyback/sell-junk dispatch, and the sell-junk state.
 * The module never reaches into Hud directly.
 */
export interface VendorWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  onBuy(itemId: string): void;
  onBuyBack(itemId: string): void;
  onSellJunk(): void;
  onClose(): void;
  sellJunk: {
    enabled: boolean;
    proceeds: number;
  };
}

/** Paint the vendor panel from a prepared view. */
export function renderVendorWindow(
  el: HTMLElement,
  vendorName: string,
  view: VendorView,
  deps: VendorWindowDeps,
): void {
  // The rebuild replaces the hovered row (its mouseleave never fires) and
  // collapses the scrolled list, drop the tooltip and restore the scroll.
  deps.hideTooltip();
  const scrollTop = el.scrollTop;
  el.innerHTML = `<div class="panel-title"><span>${esc(t('itemUi.vendor.goodsTitle', { name: vendorName }))}</span><button type="button" class="x-btn" data-close aria-label="${esc(t('itemUi.vendor.close'))}">${svgIcon('close')}</button></div>`;

  for (const { itemId, item, price: priceCopper } of view.goods) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vendor-item';
    const price = formatLocalizedMoney(priceCopper);
    const itemName = itemDisplayName(item);
    row.setAttribute('aria-label', t('itemUi.vendor.buyAria', { item: itemName, price }));
    row.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(itemName)}</span><span class="vi-price">${deps.moneyHtml(priceCopper)}</span>`;
    row.addEventListener('click', () => deps.onBuy(itemId));
    deps.attachTooltip(
      row,
      () =>
        `${deps.itemTooltip(item)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuy'))}</div>`,
    );
    el.appendChild(row);
  }

  const sellJunk = document.createElement('button');
  sellJunk.type = 'button';
  sellJunk.className = 'vendor-sell-junk';
  sellJunk.disabled = !deps.sellJunk.enabled;
  sellJunk.innerHTML = `<span class="vi-name">${esc(t('itemUi.vendor.sellJunk'))}</span>${deps.sellJunk.enabled ? `<span class="vi-price">${deps.moneyHtml(deps.sellJunk.proceeds)}</span>` : ''}`;
  sellJunk.setAttribute(
    'aria-label',
    deps.sellJunk.enabled
      ? t('itemUi.vendor.sellJunkAria', {
          price: formatLocalizedMoney(deps.sellJunk.proceeds),
        })
      : t('itemUi.vendor.sellJunk'),
  );
  sellJunk.addEventListener('click', () => deps.onSellJunk());
  deps.attachTooltip(
    sellJunk,
    () => `<div class="tt-sub">${esc(t('itemUi.vendor.sellJunkHint'))}</div>`,
  );
  el.appendChild(sellJunk);

  const buybackTitle = document.createElement('div');
  buybackTitle.className = 'vendor-section-title';
  buybackTitle.textContent = t('itemUi.vendor.buybackTitle');
  el.appendChild(buybackTitle);

  if (view.buyback.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'vendor-empty';
    empty.textContent = t('itemUi.vendor.buybackEmpty');
    el.appendChild(empty);
  }
  for (const { itemId, item, count, price: priceCopper } of view.buyback) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vendor-item';
    const price = formatLocalizedMoney(priceCopper);
    const itemName = itemDisplayName(item);
    row.setAttribute('aria-label', t('itemUi.vendor.buybackAria', { item: itemName, price }));
    row.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(itemName)}${count > 1 ? ` ${esc(t('itemUi.bags.stackCount', { count: formatNumber(count, { maximumFractionDigits: 0 }) }))}` : ''}</span><span class="vi-price">${deps.moneyHtml(priceCopper)}</span>`;
    row.addEventListener('click', () => deps.onBuyBack(itemId));
    deps.attachTooltip(
      row,
      () =>
        `${deps.itemTooltip(item)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuyback'))}</div>`,
    );
    el.appendChild(row);
  }

  const hint = document.createElement('div');
  hint.className = 'vendor-hint';
  hint.textContent = t('itemUi.vendor.hint');
  el.appendChild(hint);

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
