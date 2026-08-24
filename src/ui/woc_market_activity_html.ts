// The Exchange window's My Activities tab, as one pure builder (the
// chrome-module split, its own file because the tab is a full pane, not
// status chrome). Moved verbatim from woc_market_window.ts on the monolith
// ratchet: the window passes its formatters, its tooltip binder and its busy
// flag through the host bag and renders the returned markup; every t()
// string, gate and focus key lives here where a source scan can hold it.
//
// DOM-free and deterministic over its inputs (registered in
// tests/architecture.test.ts UI_PURE_CORES).

import { ITEMS } from '../sim/data';
import type { ItemInstancePayload } from '../sim/types';
import { esc } from './esc';
import { FOCUS_KEY_ATTR } from './focus_restore';
import { formatDateTime, formatNumber, type TranslationKey, t } from './i18n';
import { svgIcon } from './ui_icons';
import { wocSpinnerHtml } from './woc_market_chrome';
import { wocSettlementFailText } from './woc_market_reason_text';
import { canCancelListing, type WocMarketViewModel } from './woc_market_view';

type WocActivityModel = Extract<WocMarketViewModel, { kind: 'ready' }>['activity'];

/** The window-owned pieces the rows render through: its formatters (one USD
 *  and one duration spelling per window), its shared tooltip binder, the
 *  item cell that registers stat tooltips, and the busy flag that deadens
 *  every money control while a mutation is in flight. */
export interface WocActivityHtmlHost {
  busy: boolean;
  itemName(itemId: string): string;
  itemCell(itemId: string, quality: string, slot: string, instance?: ItemInstancePayload): string;
  usd(cents: number): string;
  countdown(seconds: number): string;
  tip(slot: string, text: string): string;
}

export function wocActivityHtml(a: WocActivityModel, host: WocActivityHtmlHost): string {
  if (!a || (a.listings.length === 0 && a.bids.length === 0 && a.settlements.length === 0)) {
    return `<div class="wm-status" role="status">${esc(t('hudChrome.wocMarket.activityEmpty'))}</div>`;
  }
  const listingStatus = (status: string, resolution: string | null): string => {
    if (status !== 'closed') {
      return t(
        status === 'settling' || status === 'ending'
          ? 'hudChrome.wocMarket.listingStatusSettling'
          : 'hudChrome.wocMarket.listingStatusActive',
      );
    }
    switch (resolution) {
      case 'sold':
        return t('hudChrome.wocMarket.listingStatusSold');
      case 'cancelled':
        return t('hudChrome.wocMarket.listingStatusCancelled');
      case 'suspended':
        return t('hudChrome.wocMarket.listingStatusSuspended');
      case 'no_bids':
      case 'reserve_not_met':
      case 'unsettled':
        return t('hudChrome.wocMarket.listingStatusUnsold');
      default:
        return t('hudChrome.wocMarket.listingStatusReturned');
    }
  };
  const bidStatusKey = (status: string): TranslationKey => {
    switch (status) {
      case 'pending_bond':
        return 'hudChrome.wocMarket.bidStatusPending';
      case 'active':
        return 'hudChrome.wocMarket.bidStatusActive';
      case 'outbid':
        return 'hudChrome.wocMarket.bidStatusOutbid';
      case 'won':
        return 'hudChrome.wocMarket.bidStatusWon';
      case 'defaulted':
        return 'hudChrome.wocMarket.bidStatusDefaulted';
      case 'cancelled':
        return 'hudChrome.wocMarket.bidStatusCancelled';
      default:
        return 'hudChrome.wocMarket.bidStatusLapsed';
    }
  };
  const settlementKey = (state: string): TranslationKey => {
    switch (state) {
      case 'confirming':
        return 'hudChrome.wocMarket.settlementConfirming';
      // Decided money whose delivery has not finished: not "confirming"
      // any more (the chain answered), not "delivered" yet (the trade arm
      // says the same for the same server state).
      case 'confirmed':
      case 'delivering':
        return 'hudChrome.wocMarket.settlementConfirmedDelivering';
      // The operator-review park: the payment is being verified by hand.
      // Deliberately NOT the default arm ('Payment due' would invite a
      // second payment for money that may already have landed).
      case 'review':
        return 'hudChrome.wocMarket.settlementReview';
      case 'delivered':
        return 'hudChrome.wocMarket.settlementDelivered';
      case 'expired':
        return 'hudChrome.wocMarket.settlementExpired';
      case 'failed':
        return 'hudChrome.wocMarket.settlementFailed';
      default:
        return 'hudChrome.wocMarket.settlementOffered';
    }
  };
  // One row grammar for the three lists: item | amount | status (+ chips and
  // countdowns) | controls, so amounts and statuses line up down the tab.
  const row = (item: string, amount: string, status: string, actions: string, tail = ''): string =>
    `<li><span class="wm-act-item">${item}</span>` +
    `<span class="wm-act-amount">${amount}</span>` +
    `<span class="wm-act-status">${status}</span>` +
    `<span class="wm-act-actions">${actions}</span>${tail}</li>`;
  const listings = a.listings
    .map((l) => {
      // The two state booleans the wire carries for exactly this surface:
      // without them a reloading seller cannot tell an accepted cancel
      // intent from a plainly active listing, or a directed sale minted by
      // a trade offer from a public auction.
      const cancelBadge = l.cancelPending
        ? `<span class="wm-inline-busy">${wocSpinnerHtml()}${esc(t('hudChrome.wocMarket.activityCancelPending'))}</span>`
        : '';
      const directedBadge = l.directed
        ? `<span class="wm-mine">${esc(t('hudChrome.wocMarket.activityDirected'))}</span>`
        : '';
      // The seller's own cancel, HERE where their listings actually render:
      // a directed listing never passes through the browse detail pane (the
      // only prior cancel surface), so its seller had no way to reach the
      // cancel the PRD promised. Same gate as the browse pane (active and
      // unbid; the server's guards decide the rest, including the
      // cancel-pending conversion on a locked window).
      const cancel = canCancelListing(l)
        ? `<button type="button" data-action="cancel-listing" data-listing="${l.id}" ${host.busy ? 'disabled' : ''} ` +
          `aria-label="${esc(t('hudChrome.wocMarket.cancelAria', { item: host.itemName(l.itemId) }))}" ${FOCUS_KEY_ATTR}="wm-activity-cancel-${l.id}">` +
          `${esc(t('hudChrome.wocMarket.cancelButton'))}</button>`
        : '';
      return row(
        host.itemCell(l.itemId, l.quality, `activity:${l.id}`, l.instance),
        // A sold row names the price the sale CLOSED at (the sales table's
        // figure): a buy-now that outran the bidding sells above the last
        // bid, and currentCents would show that losing bid forever. Live
        // rows (and older servers that send no soldCents) keep the
        // current-else-start price.
        esc(
          host.usd(
            l.resolution === 'sold' && l.soldCents !== null
              ? l.soldCents
              : l.currentCents === null
                ? l.startCents
                : l.currentCents,
          ),
        ),
        `<span>${esc(listingStatus(l.status, l.resolution))}</span>${directedBadge}${cancelBadge}`,
        cancel,
      );
    })
    .join('');
  const bids = a.bids
    .map((b) => {
      const itemName = b.itemId != null && b.itemId !== '' ? host.itemName(b.itemId) : null;
      // A submitted bond that the chain has not answered yet shows PROGRESS,
      // never the pay control. `busy` alone could not carry this: it covers
      // only a call in flight, and it clears the moment the server accepts the
      // signature, while the bid legitimately stays pending_bond for as long
      // as confirmation takes. That gap is exactly when a second press would
      // send a second payment for a bond already paid.
      const payBond =
        b.status !== 'pending_bond'
          ? ''
          : b.bondConfirming
            ? // The SHORT key, shared with the busy banner: a permanent
              // inline label on every affected row must stay terse (the
              // first-accepted toast names WHICH pending it is instead).
              `<span class="wm-inline-busy" role="status">${wocSpinnerHtml()}${esc(t('hudChrome.wocMarket.confirming'))}</span>`
            : `<button type="button" data-action="pay-bond" data-bid="${b.id}" ${host.busy ? 'disabled' : ''} ` +
              // The accessible name names the item when the wire carries it
              // (H13 put the item on the row), the listing id otherwise.
              `aria-label="${esc(
                itemName === null
                  ? t('hudChrome.wocMarket.bidBondPayAria', {
                      id: formatNumber(b.listingId, { useGrouping: false }),
                    })
                  : t('hudChrome.wocMarket.bidBondPayItemAria', {
                      bond: host.usd(b.bondCents),
                      item: itemName,
                    }),
              )}" ${FOCUS_KEY_ATTR}="wm-bond-${b.id}">` +
              `${esc(t('hudChrome.wocMarket.bidBondPay'))}</button>`;
      // The pay surface names its figure: the bond due beside 'Awaiting
      // bond', and its quote's remaining time while one is open (both are
      // on the model; the row used to render neither).
      const bondLine =
        b.status === 'pending_bond'
          ? `<span class="wm-note">${esc(t('hudChrome.wocMarket.quoteBondFor', { usd: host.usd(b.bondCents) }))}</span>`
          : '';
      const bondCountdown =
        b.status === 'pending_bond' && b.bondQuoteRemainingMs !== null && b.bondQuoteRemainingMs > 0
          ? `<span class="wm-note">${esc(t('hudChrome.wocMarket.quoteExpires', { duration: host.countdown(b.bondQuoteRemainingMs / 1000) }))}</span>`
          : '';
      // Name WHAT the bid is for (H13: pay rows never named the item). The
      // wire ships the joined item id; a null (older server, pruned
      // listing) renders the row as before rather than an unknown-item box.
      const item =
        b.itemId != null && b.itemId !== ''
          ? host.itemCell(b.itemId, ITEMS[b.itemId]?.quality ?? 'common', `activity:bid:${b.id}`)
          : '';
      return row(
        item,
        esc(host.usd(b.amountCents)),
        `<span>${esc(t(bidStatusKey(b.status)))}</span>${bondLine}${bondCountdown}`,
        payBond,
      );
    })
    .join('');
  const settlements = a.settlements
    .map((s) => {
      const itemName = s.itemId != null && s.itemId !== '' ? host.itemName(s.itemId) : null;
      const payable = s.state === 'offered' || s.state === 'failed';
      const pay = payable
        ? `<button type="button" class="wm-primary" data-action="pay-settlement" data-settlement="${s.id}" ${host.busy ? 'disabled' : ''} ` +
          `aria-label="${esc(
            itemName === null
              ? t('hudChrome.wocMarket.activityPayNowAria', {
                  id: formatNumber(s.id, { useGrouping: false }),
                })
              : t('hudChrome.wocMarket.activityPayNowItemAria', {
                  usd: host.usd(s.amountCents),
                  item: itemName,
                }),
          )}" ${FOCUS_KEY_ATTR}="wm-settle-${s.id}">` +
          `${esc(t('hudChrome.wocMarket.activityPayNow'))}</button>`
        : '';
      // The countdown is one truncated unit; the exact deadline (UTC and
      // local) rides its tooltip.
      const deadline = payable
        ? `<span class="wm-note"${host.tip(
            `due:${s.id}`,
            t('hudChrome.wocMarket.dueAt', {
              utc: formatDateTime(s.deadlineAtMs, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'UTC',
              }),
              local: formatDateTime(s.deadlineAtMs, { dateStyle: 'medium', timeStyle: 'short' }),
            }),
          )}>${esc(t('hudChrome.wocMarket.activityDeadline', { duration: host.countdown(s.deadlineRemainingMs / 1000) }))}</span>`
        : '';
      const quoteCountdown =
        payable && s.quoteRemainingMs !== null && s.quoteRemainingMs > 0
          ? `<span class="wm-note">${esc(t('hudChrome.wocMarket.quoteExpires', { duration: host.countdown(s.quoteRemainingMs / 1000) }))}</span>`
          : '';
      // WHY it failed: the view core owns the gate (failDetailReason is
      // non-null on failed rows only; the expired-row exclusion is decided
      // and tested there), the painter only renders its verdict. The WHY
      // sentence takes its own row under the figures.
      const failDetail =
        s.failDetailReason != null
          ? `<span class="wm-fail-why">${esc(wocSettlementFailText(s.failDetailReason) ?? '')}</span>`
          : '';
      // Item identity on the payment row itself (H13), same shape as the
      // bid rows above.
      const item =
        s.itemId != null && s.itemId !== ''
          ? host.itemCell(s.itemId, ITEMS[s.itemId]?.quality ?? 'common', `activity:settle:${s.id}`)
          : '';
      return row(
        item,
        esc(host.usd(s.amountCents)),
        `<span>${esc(t(settlementKey(s.state)))}</span>${deadline}${quoteCountdown}`,
        pay,
        failDetail,
      );
    })
    .join('');
  // The strikes / suspension notice LEADS the tab: it is the one state that
  // explains every refused control under it, so it never sits under 150
  // rows. The count carries the definition of a strike and the ladder it
  // climbs, on hover and focus.
  const strikes =
    a.strikes > 0
      ? `<p class="wm-strikes"${host.tip('strikes', t('hudChrome.wocMarket.strikesTip'))}>${svgIcon('alert')}<span>${esc(t('hudChrome.wocMarket.activityStrikes', { count: formatNumber(a.strikes) }))}</span></p>` +
        (a.suspendedRemainingMs !== null
          ? `<p class="wm-strikes">${svgIcon('alert')}<span>${esc(t('hudChrome.wocMarket.activitySuspended', { duration: host.countdown(a.suspendedRemainingMs / 1000) }))}</span></p>`
          : '')
      : '';
  // A section with nothing in it says so, instead of a heading over air.
  const section = (title: TranslationKey, items: string, emptyKey: TranslationKey): string =>
    `<h3>${esc(t(title))}</h3>` +
    (items === '' ? `<p class="wm-activity-empty">${esc(t(emptyKey))}</p>` : `<ul>${items}</ul>`);
  return (
    `<div class="wm-activity">` +
    strikes +
    section(
      'hudChrome.wocMarket.activityListings',
      listings,
      'hudChrome.wocMarket.activityNoListings',
    ) +
    section('hudChrome.wocMarket.activityBids', bids, 'hudChrome.wocMarket.activityNoBids') +
    section(
      'hudChrome.wocMarket.activitySettlements',
      settlements,
      'hudChrome.wocMarket.activityNoSettlements',
    ) +
    `</div>`
  );
}
