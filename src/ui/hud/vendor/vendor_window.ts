// Thin DOM consumer for the vendor window.
//
// The consumer half of the pure-core + thin-consumer split: it paints
// #vendor-window from the structured VendorView (vendor_view.ts) and wires the
// buy / buyback / close actions. It owns no state. The cross-window
// orchestration (which windows to close, bag re-centring, mobile teardown)
// stays in Hud because it needs Hud's private state; this module only renders
// one panel and reports clicks back through the injected callbacks.

import type { ItemInstancePayload } from '../../../sim/types';
import { itemDisplayName } from '../../entity_i18n';
import { esc } from '../../esc';
import { formatMoney as formatLocalizedMoney, formatNumber, t } from '../../i18n';
import type { PainterHostPresentation } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import type { VendorGoodsRow, VendorPrice, VendorView } from './vendor_view';

/**
 * Hud-supplied glue. The icon/money/tooltip painters are the shared
 * PainterHostPresentation bag (Hud builds it once and hands it to every window
 * that renders item rows); this composes that base and adds the vendor-specific
 * tooltip teardown, the buy/buyback/sell-junk dispatch, and the sell-junk state.
 * The module never reaches into Hud directly.
 */
export interface VendorWindowDeps extends PainterHostPresentation {
  hideTooltip(): void;
  /** `bulk` (#2374): true for a ctrl/cmd-click on the row or a click on its
   *  "Buy Stack" control, requesting the largest affordable stack instead of
   *  the ordinary single unit. */
  onBuy(itemId: string, bulk?: boolean): void;
  onBuyBack(
    itemId: string,
    index: number,
    instance: ItemInstancePayload | undefined,
    craftedRecipeId: string | undefined,
  ): void;
  onSellJunk(): void;
  onClose(): void;
  sellJunk: {
    enabled: boolean;
    proceeds: number;
  };
}

function honorText(amount: number): string {
  return t('hudChrome.warfare.honorAmount', {
    amount: formatNumber(amount, { maximumFractionDigits: 0 }),
  });
}

function goodsPriceText(price: VendorPrice): string {
  const money = price.copper > 0 ? formatLocalizedMoney(price.copper) : '';
  const honor = price.honor > 0 ? honorText(price.honor) : '';
  if (money && honor) return t('hudChrome.warfare.dualPrice', { money, honor });
  return money || honor;
}

function goodsPriceHtml(row: VendorGoodsRow, deps: VendorWindowDeps): string {
  const parts: string[] = [];
  if (row.price.copper > 0) parts.push(deps.moneyHtml(row.price.copper));
  if (row.price.honor > 0) {
    parts.push(`<span class="warfare-price">${esc(honorText(row.price.honor))}</span>`);
  }
  return parts.join('<span aria-hidden="true"> + </span>');
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

  if (view.hasHonorGoods) {
    const balance = document.createElement('div');
    balance.className = 'warfare-balance';
    balance.textContent = t('hudChrome.warfare.balance', {
      amount: formatNumber(view.honorBalance, { maximumFractionDigits: 0 }),
    });
    el.appendChild(balance);
  }

  // Landscape layout: goods tile up in a multi-column grid instead of one
  // full-width row per item (see .vendor-goods-grid in components.css).
  const goodsGrid = document.createElement('div');
  goodsGrid.className = 'vendor-goods-grid';
  for (const goods of view.goods) {
    const { itemId, item, quantity } = goods;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vendor-item';
    row.disabled = !goods.affordable;
    const price = goodsPriceText(goods.price);
    const itemName = itemDisplayName(item);
    const stack =
      quantity > 1
        ? ` ${t('itemUi.bags.stackCount', { count: formatNumber(quantity, { maximumFractionDigits: 0 }) })}`
        : '';
    row.setAttribute(
      'aria-label',
      t('itemUi.vendor.buyAria', { item: `${itemName}${stack}`, price }),
    );
    row.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(itemName)}${esc(stack)}</span><span class="vi-price">${goodsPriceHtml(goods, deps)}</span>`;
    // Ctrl/Cmd-click requests a bulk purchase (#2374), the desktop mirror of
    // the "Buy Stack" tile below; both funnel through the same onBuy(itemId, true).
    row.addEventListener('click', (ev) => deps.onBuy(itemId, ev.ctrlKey || ev.metaKey));
    deps.attachTooltip(
      row,
      () =>
        `${deps.itemTooltip(item)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuy'))}</div>`,
    );
    goodsGrid.appendChild(row);
    // A separate, always-visible tile (never a nested <button>, never hidden
    // behind a modifier key) so the bulk purchase is reachable identically on
    // touch and desktop: the mobile-parity affordance for the ctrl-click
    // gesture above. Only offered when the row actually qualifies for a bulk
    // purchase of more than one unit (see bulkQuantity in vendor_view.ts).
    if (goods.bulkQuantity !== undefined && goods.bulkQuantity > 1) {
      const bulkRow = document.createElement('button');
      bulkRow.type = 'button';
      bulkRow.className = 'vendor-item vendor-item-bulk';
      bulkRow.disabled = !goods.bulkAffordable;
      const bulkCount = formatNumber(goods.bulkQuantity, { maximumFractionDigits: 0 });
      const bulkCopper = Math.max(0, item.buyValue ?? 0) * goods.bulkQuantity;
      const bulkPrice = formatLocalizedMoney(bulkCopper);
      bulkRow.setAttribute(
        'aria-label',
        t('itemUi.vendor.buyStackAria', { item: itemName, count: bulkCount, price: bulkPrice }),
      );
      bulkRow.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(t('itemUi.vendor.buyStack', { count: bulkCount }))}</span><span class="vi-price">${deps.moneyHtml(bulkCopper)}</span>`;
      bulkRow.addEventListener('click', () => deps.onBuy(itemId, true));
      deps.attachTooltip(
        bulkRow,
        () =>
          `${deps.itemTooltip(item)}<div class="tt-sub">${esc(t('itemUi.vendor.buyStack', { count: bulkCount }))}</div>`,
      );
      goodsGrid.appendChild(bulkRow);
    }
  }
  if (view.goods.length > 0) el.appendChild(goodsGrid);

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
  const buybackGrid = document.createElement('div');
  buybackGrid.className = 'vendor-goods-grid';
  for (const {
    itemId,
    item,
    count,
    price: priceCopper,
    index,
    instance,
    craftedRecipeId,
  } of view.buyback) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vendor-item';
    const price = formatLocalizedMoney(priceCopper);
    const itemName = itemDisplayName(item);
    row.setAttribute('aria-label', t('itemUi.vendor.buybackAria', { item: itemName, price }));
    row.innerHTML = `${deps.itemIcon(item)}<span class="vi-name">${esc(itemName)}${count > 1 ? ` ${esc(t('itemUi.bags.stackCount', { count: formatNumber(count, { maximumFractionDigits: 0 }) }))}` : ''}</span><span class="vi-price">${deps.moneyHtml(priceCopper)}</span>`;
    row.addEventListener('click', () => deps.onBuyBack(itemId, index, instance, craftedRecipeId));
    deps.attachTooltip(
      row,
      () =>
        `${deps.itemTooltip(item, instance)}<div class="tt-sub">${esc(t('itemUi.tooltip.clickBuyback'))}</div>`,
    );
    buybackGrid.appendChild(row);
  }
  if (view.buyback.length > 0) el.appendChild(buybackGrid);

  const hint = document.createElement('div');
  hint.className = 'vendor-hint';
  hint.textContent = t('itemUi.vendor.hint');
  el.appendChild(hint);

  el.querySelector('[data-close]')?.addEventListener('click', () => deps.onClose());
  el.style.display = 'block';
  el.scrollTop = scrollTop;
}
