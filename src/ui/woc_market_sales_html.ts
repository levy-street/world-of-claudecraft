// The Exchange window's Sales History tab, as one pure builder (the
// chrome-module split, its own file because the tab is a full pane, not
// status chrome; the woc_market_activity_html.ts precedent). The window
// passes its formatters and its tooltip binder through the host bag and
// renders the returned markup; every t() string, column header and focus key
// lives here where a source scan can hold it.
//
// DOM-free and deterministic over its inputs (registered in
// tests/architecture.test.ts UI_PURE_CORES).

import type { ItemInstancePayload } from '../sim/types';
import { esc } from './esc';
import { formatDateTime, type TranslationKey, t } from './i18n';
import { wocErrorStatusHtml, wocLoadingStatusHtml } from './woc_market_chrome';
import type { WocHistoryModel, WocSaleType } from './woc_market_view';

/** The window-owned pieces each row renders through: its USD spelling, its
 *  shared tooltip binder, the item cell that registers stat tooltips, and the
 *  item name resolver (localized). */
export interface WocSalesHtmlHost {
  itemName(itemId: string): string;
  itemCell(itemId: string, quality: string, slot: string, instance?: ItemInstancePayload): string;
  usd(cents: number): string;
  tip(slot: string, text: string): string;
}

/** A party name as the click-through into their recent trades (the Browse
 *  seller-link family, its own data-action so closest() takes it before the
 *  row): the Seller and Buyer columns both open "Recent trades by {name}".
 *  That view is the name's SELLER history, so a buyer who has never sold sees
 *  the empty face; accepted here because it mirrors the Browse seller
 *  click-through exactly, and a "purchases" half is a later seller-history
 *  change rather than part of this tab. */
function nameLink(name: string): string {
  return (
    `<button type="button" class="wm-seller-link" data-action="seller-view" ` +
    `data-seller="${esc(name)}" aria-label="${esc(
      t('hudChrome.wocMarket.sellerLinkAria', { name }),
    )}">${esc(name)}</button>`
  );
}

/** The sale-type cell's label key: a stamped type maps to its word, an older
 *  (pre-feature) sale with no stamp reads the unknown label. */
function saleTypeKey(type: WocSaleType | null): TranslationKey {
  switch (type) {
    case 'auction':
      return 'hudChrome.wocMarket.saleTypeAuction';
    case 'buy_now':
      return 'hudChrome.wocMarket.saleTypeBuyNow';
    case 'directed':
      return 'hudChrome.wocMarket.saleTypeDirected';
    default:
      return 'hudChrome.wocMarket.saleTypeUnknown';
  }
}

export function wocSalesTableHtml(history: WocHistoryModel, host: WocSalesHtmlHost): string {
  if (history.failed) {
    return wocErrorStatusHtml(t('hudChrome.wocMarket.historyError'));
  }
  if (history.rows.length === 0) {
    // Loading with nothing yet paints the ring; a settled empty read paints
    // the empty line (both under the live filter strip the window emits).
    return history.loading
      ? wocLoadingStatusHtml()
      : `<div class="wm-status" role="status">${esc(t('hudChrome.wocMarket.historyEmpty'))}</div>`;
  }
  const rows = history.rows
    .map((r) => {
      // The exact sale time (UTC + local) rides the cell's tooltip; the cell
      // shows the medium date so a long list stays scannable.
      const soldTip = host.tip(
        `sold:${r.id}`,
        formatDateTime(r.atMs, { dateStyle: 'long', timeStyle: 'short' }),
      );
      const sold = esc(formatDateTime(r.atMs, { dateStyle: 'medium', timeStyle: 'short' }));
      return (
        `<tr class="wm-sale-row">` +
        `<td>${host.itemCell(r.itemId, r.quality, `history:${r.id}`, undefined)}</td>` +
        `<td>${nameLink(r.sellerName)}</td>` +
        `<td>${nameLink(r.buyerName)}</td>` +
        `<td${soldTip}>${sold}</td>` +
        `<td>${esc(host.usd(r.priceCents))}</td>` +
        `<td>${esc(t(saleTypeKey(r.saleType)))}</td>` +
        `</tr>`
      );
    })
    .join('');
  // aria-busy on a player-asked refresh (a filter change, a page turn): the
  // rows dim while the answer is on its way; a background poll never raises it
  // (the window keeps history out of its silent poll).
  return (
    `<table class="wm-table wm-sales-table" aria-busy="${history.loading ? 'true' : 'false'}"><thead><tr>` +
    `<th>${esc(t('hudChrome.wocMarket.colItem'))}</th>` +
    `<th>${esc(t('hudChrome.wocMarket.colSeller'))}</th>` +
    `<th>${esc(t('hudChrome.wocMarket.colBuyer'))}</th>` +
    `<th>${esc(t('hudChrome.wocMarket.colSoldAt'))}</th>` +
    `<th>${esc(t('hudChrome.wocMarket.colSalePrice'))}</th>` +
    `<th>${esc(t('hudChrome.wocMarket.colSaleType'))}</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`
  );
}
