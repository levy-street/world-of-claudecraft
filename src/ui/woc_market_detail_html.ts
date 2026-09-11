// The Exchange window's Browse detail pane (the selected listing: its facts,
// the estimate, the bid form, buy-now, cancel, and the per-item sales list),
// as one pure builder. Moved verbatim from woc_market_window.ts on the
// monolith ratchet, the woc_market_activity_html.ts precedent: the window
// passes its formatters and the live form/wallet state through the host bag
// and renders the returned markup; every t() string, gate and focus key lives
// here where a source scan can hold it, and every event stays wired in the
// window (delegated by data-action / data-field).
//
// DOM-free and deterministic over its inputs (registered in
// tests/architecture.test.ts UI_PURE_CORES); the browser origin arrives
// through the host bag so this stays host-agnostic.

import type { ItemInstancePayload } from '../sim/types';
import { esc } from './esc';
import { FOCUS_KEY_ATTR } from './focus_restore';
import { t } from './i18n';
import { termsUrlFor } from './terms_link';
import { overWalletBalance } from './woc_affordable_core';
import {
  wocBidDisclosuresHtml,
  wocBuyNowHtml,
  wocEndsAtText,
  wocSalesHistoryHtml,
} from './woc_market_chrome';
import { canCancelListing, type WocMarketViewModel } from './woc_market_view';

type ReadyModel = Extract<WocMarketViewModel, { kind: 'ready' }>;

/** The window-owned pieces the detail pane renders through: its formatters,
 *  the item cell that registers stat tooltips, the live quote/wallet figures
 *  the buttons gate on, the form toggles, and the page origin for the terms
 *  link (passed in so the builder touches no browser global). */
export interface WocDetailHtmlHost {
  itemName(itemId: string): string;
  itemCell(itemId: string, quality: string, slot: string, instance?: ItemInstancePayload): string;
  usd(cents: number): string;
  tokens(value: number): string;
  countdown(seconds: number): string;
  /** Null while the per-item sales read is still out (the loading face). */
  salesLoading: boolean;
  buyNowTokens: number | null;
  bidEquivalentTokens: number | null;
  walletTokens: number | null;
  busy: boolean;
  bidTermsOpen: boolean;
  acceptTerms: boolean;
  origin: string;
}

export function wocDetailPaneHtml(model: ReadyModel, host: WocDetailHtmlHost): string {
  const d = model.browse.detail;
  if (!d) return '';
  const name = host.itemName(d.row.itemId);
  const buyNowOnly = d.row.format === 'buy_now';
  // The estimate names the amount it converts (the same rule the server
  // priced: the current bid, else the starting bid), and its slot is kept
  // while the figure is on its way so the form below never moves.
  const estimate = d.estimateAmount
    ? `<p class="wm-estimate">${esc(
        t('hudChrome.wocMarket.estimateNote', {
          tokens: host.tokens(d.estimateAmount.tokens),
          usd: host.usd(d.row.currentCents ?? d.row.startCents),
        }),
      )}</p>`
    : `<p class="wm-estimate"></p>`;
  const sales = wocSalesHistoryHtml(host.salesLoading ? null : d.sales, (c) => host.usd(c));
  const bidForm = bidFormHtml(model, d.row.id, name, host);
  // EXACT here, unlike the bid: buy-now carries no bond, so the server compares
  // this same price and nothing else.
  const overBuyNow = overWalletBalance(host.buyNowTokens, host.walletTokens);
  const buyNow =
    d.row.buyNowCents !== null && !d.row.mine
      ? // The chrome builder: the walk-away-cost disclosure BEFORE the
        // button, the token equivalence off buy-now's own quote.
        wocBuyNowHtml({
          listingId: d.row.id,
          itemName: name,
          buyNowCents: d.row.buyNowCents,
          locked: d.row.buyNowLocked,
          disabled: model.paused || !model.walletLinked || d.row.buyNowLocked || overBuyNow,
          tokensText: host.buyNowTokens === null ? null : host.tokens(host.buyNowTokens),
          overBalance: overBuyNow,
          usd: (c) => host.usd(c),
        })
      : '';
  // The shared cancel predicate (woc_market_view.ts canCancelListing): a
  // cancel-pending listing offers no second Cancel here either.
  const cancel =
    d.row.mine && canCancelListing(d.row)
      ? `<button type="button" class="ui-btn" data-action="cancel-listing" data-listing="${d.row.id}" ` +
        `aria-label="${esc(t('hudChrome.wocMarket.cancelAria', { item: name }))}" ${FOCUS_KEY_ATTR}="wm-cancel">` +
        `${esc(t('hudChrome.wocMarket.cancelButton'))}</button>`
      : '';
  // A fixed-price listing has no bid form, so nothing else would carry the two
  // fields buyNow's own server-side guards demand. Rendered only when the bid
  // form is absent: a legacy combined listing would otherwise emit the same
  // data-field twice and the reader would take whichever came first.
  const buyNowFields = buyNow !== '' && bidForm === '' ? confirmFieldsHtml(model, host) : '';
  // A buy-now-only listing takes no bids: no starting-bid line for a start
  // price that exists only for sorting (the button already carries the
  // price the buyer pays).
  const priceLine = buyNowOnly
    ? ''
    : `<p>${
        d.row.currentCents === null
          ? esc(t('hudChrome.wocMarket.detailStartingBid', { usd: host.usd(d.row.startCents) }))
          : esc(t('hudChrome.wocMarket.detailCurrentBid', { usd: host.usd(d.row.currentCents) }))
      }</p>`;
  return (
    `<div class="wm-detail ui-card"><h3>${esc(t('hudChrome.wocMarket.detailTitle'))}</h3>` +
    `<div class="wm-detail-item">${host.itemCell(d.row.itemId, d.row.quality, `detail:${d.row.id}`, d.row.instance)}</div>` +
    `<p>${esc(t('hudChrome.wocMarket.detailSeller', { name: d.row.sellerName }))}</p>` +
    `<p>${esc(wocEndsAtText(d.row.endsAtMs))}</p>` +
    priceLine +
    estimate +
    bidForm +
    buyNowFields +
    buyNow +
    cancel +
    `<h4>${esc(t('hudChrome.wocMarket.detailSales'))}</h4>${sales}</div>`
  );
}

function bidFormHtml(
  model: ReadyModel,
  listingId: number,
  itemName: string,
  host: WocDetailHtmlHost,
): string {
  const d = model.browse.detail;
  if (!d || d.row.mine || d.row.format === 'buy_now' || d.row.remainingMs <= 0) return '';
  // A LOWER BOUND on the server's rule, which checks the bid PLUS its bond.
  // The bond for an arbitrary bid is server-computed and the client may not
  // derive money, so this catches the clear case (bidding well past what you
  // hold) and leaves the narrow band between bid and bid+bond to the server's
  // own refusal. Erring this way only ever permits, never wrongly blocks.
  const overBid = overWalletBalance(host.bidEquivalentTokens, host.walletTokens);
  const disabled = model.paused || !model.walletLinked || host.busy || overBid ? 'disabled' : '';
  return (
    `<div class="wm-bid-form ui-card">` +
    `<p class="wm-min-next">${esc(t('hudChrome.wocMarket.detailMinNext', { usd: host.usd(d.row.minNextBidCents) }))}</p>` +
    `<label>${esc(t('hudChrome.wocMarket.bidLabel'))}` +
    `<input type="number" class="ui-input" inputmode="decimal" min="0" step="0.25" data-field="bid-usd" ${FOCUS_KEY_ATTR}="wm-bid-usd" placeholder="${esc(
      t('hudChrome.wocMarket.bidPlaceholder'),
    )}" /></label>` +
    // Empty until the server has quoted the typed price, so it never claims a
    // rate it does not have.
    (host.bidEquivalentTokens === null
      ? ''
      : `<p class="wm-bid-equiv${overBid ? ' over-balance' : ''}">${esc(
          t('hudChrome.trade.woc.equivalent', {
            tokens: host.tokens(host.bidEquivalentTokens),
          }),
        )}</p>`) +
    // Never colour alone: the refusal is also stated in words, beside a button
    // that is actually disabled.
    (overBid
      ? `<p class="wm-over-balance">${esc(t('hudChrome.trade.woc.hintInsufficientBalance'))}</p>`
      : '') +
    confirmFieldsHtml(model, host) +
    // The commitment disclosures (H13), composed by the chrome builder:
    // collapsed behind the Bid terms toggle, always in the DOM before the
    // commit control. Both bond figures are server-computed and ride the
    // row; the client computes no money (the PRD rule).
    wocBidDisclosuresHtml({
      open: host.bidTermsOpen,
      bondCents: d.row.minNextBidBondCents,
      bidCents: d.row.minNextBidCents,
      schedule:
        model.bondSchedule === null
          ? null
          : {
              ...model.bondSchedule,
              payWindowText: host.countdown(model.bondSchedule.pendingTtlSeconds),
            },
      offerNext: d.offerNext,
      settlementWindowText: host.countdown(model.settlementWindowSeconds),
      usd: (c) => host.usd(c),
    }) +
    `<button type="button" class="wm-primary ui-btn ui-btn--gold" data-action="place-bid" data-listing="${listingId}" ${disabled} ` +
    `aria-label="${esc(t('hudChrome.wocMarket.bidAria', { item: itemName }))}" ${FOCUS_KEY_ATTR}="wm-bid-submit">` +
    `${esc(t('hudChrome.wocMarket.bidButton'))}</button></div>`
  );
}

/**
 * The field the SERVER demands before it will take money: the terms
 * acceptance. It was two until 2FA came off the Exchange's paying side; the
 * helper stays because the same reasoning applies to whatever the server gates
 * on next, and because both the bid form and the buy-now path still need it.
 *
 * One definition, rendered by whichever action is on screen, because the
 * server's guards do not care which one it was. Both `placeBid` and `buyNow`
 * run guardTerms, but this input used to live only inside the bid form, which
 * is suppressed for a fixed-price listing: a buyer who had not yet accepted the
 * terms got terms_required with no checkbox to tick, a dead end with no way out
 * of the UI, and one that could not appear on a legacy combined listing, which
 * is the only kind the local database held.
 */
function confirmFieldsHtml(model: ReadyModel, host: WocDetailHtmlHost): string {
  // The terms are LINKED at the moment of acceptance (draft Terms 10.3):
  // a checkbox naming a document the player cannot reach recorded consent
  // to nothing (the R9 cluster's Exchange half). Caption and link share one
  // row and one size, so they read as one sentence.
  return model.activity?.termsAccepted
    ? ''
    : `<div class="wm-terms-row"><label class="wm-terms"><input type="checkbox" class="ui-check" data-field="accept-terms" ${FOCUS_KEY_ATTR}="wm-terms" ${host.acceptTerms ? 'checked' : ''} /> ${esc(
        t('hudChrome.wocMarket.termsLabel'),
      )}</label> <a class="wm-terms-link" href="${esc(termsUrlFor(host.origin))}" target="_blank" rel="noopener noreferrer">${esc(
        t('hudChrome.wocMarket.termsLink'),
      )}</a></div>`;
}
