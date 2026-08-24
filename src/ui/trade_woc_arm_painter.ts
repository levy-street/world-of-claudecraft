// The trade window's $WOC arm: the thin DOM consumer over trade_woc_view.ts.
//
// A COLD painter (src/ui/CLAUDE.md), named as one so the painter gate
// (tests/hud_perf_budget.test.ts, the `*_painter.ts` sweep) counts its raw
// writes: it repaints only when the trade window itself repaints, holds no
// per-frame path, arms no driver of its own, and makes no forced-reflow layout
// read. Its few in-place writes are event-driven and elided by value compare.
// The gate's allowance row pins the exact count of the PROPERTY writes it
// scans (.textContent, .classList, .dataset: the derived lines and the
// over-balance class); the Send button's disabled flag is an IDL write the
// driverless sweep does not count, so it is named here rather than claimed
// pinned.
//
// The price field deliberately does NOT ride the window's repaint signature.
// The window rebuilds its whole subtree when that signature changes, so putting
// the typed price in it would destroy and recreate the input on every keystroke
// and fight the caret. Instead the buyer's typing updates only the DERIVED
// lines in place (`refreshWocTradeArm`), which is both cheaper and the reason
// the PRICE FIELD needs no focus restore; the arm's buttons and consent box
// are keyed and restored across rebuilds by `restoreWocTradeFocus`.
//
// It owns no state and never imports Hud: everything arrives on the injected
// deps bag, which is what lets a test drive it against a plain object. All
// interpolated player text passes through `esc`.

import type { InvSlot, ItemDef } from '../sim/types';
import { durationText } from './duration_text';
import { esc } from './esc';
import { restoreFirstEnabled } from './focus_restore';
import { formatDateTime, formatNumber, t, tPlural } from './i18n';
import {
  buildWocTradeModel,
  usableStampMs,
  type WocPendingOffer,
  type WocTradeModel,
  type WocTradePartner,
  type WocTradeQuoteReview,
  type WocTradeSplit,
} from './trade_woc_view';
import { usdText } from './usd_text';
import { wocTokensText } from './woc_tokens_text';

export interface WocTradeArmDeps {
  staged: readonly InvSlot[];
  /** The sim's cleaned own-side offer when a session mirrors one; the accept
   *  arm judges over THIS table (the one the player sees rendered), never the
   *  compose list. Absent means no live mirror. */
  stagedAuthoritative?: readonly InvSlot[];
  theirStaged: readonly InvSlot[];
  goldCopper: number;
  /** The OTHER player's staged gold. Read because the currencies are exclusive
   *  for the trade, not per side: their coin has to close your $WOC arm. */
  partnerGoldCopper: number;
  /** The verified wallet's $WOC balance, or null when unknown. */
  walletTokens: number | null;
  items: Readonly<Record<string, ItemDef>>;
  marketEnabled: boolean;
  selfWalletVerified: boolean;
  partner: WocTradePartner | null;
  partnerResolved: boolean;
  mode: 'gold' | 'woc';
  usdCents: number | null;
  tokens: number | null;
  split: WocTradeSplit | null;
  /** The Exchange's minimum listing price from /status. Null or absent
   *  while unknown (the courtesy hint arm; unknown never blocks). */
  minPriceCents?: number | null;
  /** Durable Marketplace-terms acceptance (from /me or a consented send);
   *  false/absent shows the consent row on the buyer's money surfaces (R9). */
  termsAccepted?: boolean;
  /** The consent checkbox's controller-held state (survives rebuilds). */
  termsChecked?: boolean;
  /** The staged settlement quote awaiting the buyer's explicit sign-off. */
  quote?: WocTradeQuoteReview | null;
  /** True while the Pay claim (buyNow + quote) is in flight, so the pressed
   *  button goes disabled immediately rather than two round trips later. */
  paying?: boolean;
  /** True while a Decline / Withdraw / Cancel sale request is in flight. */
  resolving?: boolean;
  /** The seller's cancel was answered cancel-pending (the buyer may still pay). */
  cancelPending?: boolean;
  /** The realm's directed payment hold (seconds) from /status; null unknown. */
  directedHoldSeconds?: number | null;
  /** The consent link's href, resolved per shell by the host (terms_link.ts). */
  termsHref?: string;
  /** The claimed settlement's payment deadline for this deal, or null. */
  paymentDueAtMs?: number | null;
  /** Paint-time clock, for the staged quote's expiry face only. */
  nowMs?: number;
  pendingOffer: WocPendingOffer | null;
  onModeChange(mode: 'gold' | 'woc'): void;
  onPriceInput(usdCents: number | null): void;
  onSendOffer(): void;
  /** The buyer pulls the offer they made ('withdraw'). */
  onCancelOffer(): void;
  /** The seller refuses the incoming offer ('decline'): the dead wiring H13
   *  named, now a real control on the seller's review face. */
  onDeclineOffer(): void;
  /** The seller cancels the directed listing while the buyer has not paid
   *  (the PRD's own mitigation, previously unreachable). */
  onCancelSale(): void;
  onPayOffer(): void;
  /** The consent checkbox moved (R9: the send carries this real choice). */
  onTermsChange(checked: boolean): void;
  /** The buyer signs the reviewed quote (the wallet step follows). */
  onSignQuote(): void;
  /** The buyer backs out of the reviewed quote; the deal stays payable. */
  onQuoteCancel(): void;
}

/** The shared usd_text core, so the trade arm and the Exchange window spell
 *  the same dollar identically (usd_text.ts is the ONE USD spelling). */
const usd = usdText;

/**
 * The standing offer as it reads in the trade window's Money row.
 *
 * "$1.00 (~ 7,812.5 $WOC)": the currency the two players agreed in, with the
 * server-quoted token figure beside it, both figures in ONE catalog template so
 * a locale orders and spaces them (never a code-side join). The tilde is doing
 * real work, since the token amount is a preview and the exact number is set
 * by a fresh quote at payment time. Empty string when there is no offer, so
 * the caller can fall back to gold without a branch on null.
 */
export function wocTradeMoneyText(offer: WocPendingOffer | null): string {
  if (offer === null) return '';
  if (offer.tokens === null) return t('hudChrome.trade.woc.moneyUsd', { usd: usd(offer.usdCents) });
  return t('hudChrome.trade.woc.moneyLine', {
    usd: usd(offer.usdCents),
    tokens: wocTokensText(offer.tokens),
  });
}

export function wocTradeModelFrom(deps: WocTradeArmDeps): WocTradeModel {
  return buildWocTradeModel({
    marketEnabled: deps.marketEnabled,
    selfWalletVerified: deps.selfWalletVerified,
    partner: deps.partner,
    partnerResolved: deps.partnerResolved,
    staged: deps.staged,
    stagedAuthoritative: deps.stagedAuthoritative,
    theirStaged: deps.theirStaged,
    items: deps.items,
    mode: deps.mode,
    usdCents: deps.usdCents,
    tokens: deps.tokens,
    split: deps.split,
    minPriceCents: deps.minPriceCents ?? null,
    termsAccepted: deps.termsAccepted,
    termsChecked: deps.termsChecked,
    quote: deps.quote,
    paying: deps.paying,
    resolving: deps.resolving,
    cancelPending: deps.cancelPending,
    directedHoldSeconds: deps.directedHoldSeconds,
    termsHref: deps.termsHref,
    paymentDueAtMs: deps.paymentDueAtMs,
    nowMs: deps.nowMs,
    pendingOffer: deps.pendingOffer,
    goldOffered: deps.goldCopper > 0 || deps.partnerGoldCopper > 0,
    walletTokens: deps.walletTokens,
  });
}

/** The arm's markup, RETURNED rather than written: the trade window composes it
 *  into the single innerHTML it already builds, because a second write would
 *  discard the listeners that window attaches after its own. */
export function wocTradeArmHtml(model: WocTradeModel, usdCents: number | null): string {
  if (!model.armVisible) return '';
  // The consent control, the Exchange checkbox's model made compliant: the
  // terms are LINKED at the moment of acceptance (draft Terms 10.3), and the
  // send carries this checkbox's real state instead of a hard-coded true
  // (R9). Rendered only where the model says a terms-gated send is on
  // screen; checked state is controller-held so it survives rebuilds. The
  // href resolves per shell (src/ui/terms_link.ts, the host passes it in):
  // same-origin on the site, the canonical page from the desktop and native
  // shells.
  // Caption and link share one wrapping row at one size, so they read as one
  // sentence instead of the link dropping to its own line under the box.
  const termsRow = model.showTerms
    ? `<div class="trade-woc-consent"><label class="trade-woc-terms"><input type="checkbox" data-woc-terms data-focus-key="trade-woc-terms"${
        model.termsChecked ? ' checked' : ''
      } /> ${esc(t('hudChrome.wocMarket.termsLabel'))}</label>
      <a class="trade-woc-terms-link" href="${esc(model.termsHref)}" target="_blank" rel="noopener noreferrer">${esc(
        t('hudChrome.wocMarket.termsLink'),
      )}</a></div>`
    : '';
  // The fee block beside a standing deal: the seller commits by accepting,
  // so the fee and THEIR net sit on the review face before that click; the
  // buyer reads the seller's net. Filled in place by refreshWocTradeArm.
  const feeLines = `<p class="trade-woc-fee" data-woc-fee></p>
      <p class="trade-woc-net" data-woc-net></p>`;
  // The p2p commitment note (the auction arm's bidBindingNote): the buyer's
  // accept escrows the copy and starts a payment deadline whose lapse earns
  // a strike, so it reads BEFORE the shared Accept and again on the pay face.
  const bindingNote = model.showBindingNote
    ? `<p class="trade-woc-warn" data-woc-binding></p>`
    : '';
  // The currency switch: a labelled GROUP of two pressed-state toggles (the
  // dungeon finder's ruling: a tablist without the roving-tabindex half reads
  // worse than a group with aria-pressed), named for what it switches, never
  // for one of its two options. Both stay ordinary Tab stops; the pressed one
  // is told apart by aria-pressed AND the underline (shape, not colour alone).
  // The disabled $WOC toggle on the gold face carries the reason as a hint.
  const modeTabs = `
    <div class="trade-woc-modes" role="group" aria-label="${esc(t('hudChrome.trade.woc.modesLabel'))}">
      <button type="button" class="btn trade-woc-mode" aria-pressed="${model.mode === 'gold'}" data-woc-mode="gold" data-focus-key="trade-woc-tab-gold"${model.wocDealStanding ? ' disabled' : ''}>${esc(t('hudChrome.trade.woc.tabGold'))}</button>
      <button type="button" class="btn trade-woc-mode" aria-pressed="${model.mode === 'woc'}" data-woc-mode="woc" data-focus-key="trade-woc-tab-woc"${model.wocDisabled ? ' disabled' : ''}>${esc(t('hudChrome.trade.woc.tabWoc'))}</button>
    </div>`;
  const wocOffHint =
    model.mode === 'gold' && model.wocDisabled && !model.wocDealStanding && model.blockKey === null
      ? `<p class="trade-woc-note">${esc(t('hudChrome.trade.woc.tabWocHint'))}</p>`
      : '';

  if (model.blockKey !== null) {
    // The arm stays present while blocked so the reason has somewhere to live.
    // The partner check is a WAIT (the one block a poll answers), so it wears
    // the shared ring and is announced like the arm's other waits.
    const waiting = model.blockKey === 'hudChrome.trade.woc.blockPartnerUnknown';
    return `<div class="trade-woc-arm">${modeTabs}<p class="trade-woc-block"${waiting ? ' role="status"' : ''}>${
      waiting ? '<span class="woc-spinner" aria-hidden="true"></span>' : ''
    }${esc(t(model.blockKey))}</p></div>`;
  }
  if (model.pendingOffer !== null) {
    const o = model.pendingOffer;
    const busyResolve = model.resolveBusy ? ' disabled' : '';
    // Both sides read the SAME price, in the currency they agreed it in, with
    // the token figure as the server quoted it. The seller gets Accept; the
    // buyer gets Withdraw. Neither is offered an action that is not theirs.
    if (o.phase === 'settled') {
      // Per side: the copy went to the BUYER's bags (or their mail).
      return `<div class="trade-woc-arm">${modeTabs}
        <p class="trade-woc-done">${esc(
          t(
            o.role === 'buyer'
              ? 'hudChrome.trade.woc.settled'
              : 'hudChrome.trade.woc.settledSeller',
          ),
        )}</p>
      </div>`;
    }
    if (o.phase === 'closed') {
      // The controller reports the honest reason and clears the offer in the
      // same synchronous step, so this face is unreachable in practice. It
      // exists so a dead deal can NEVER fall through to the review face below
      // and offer Decline or Withdraw on a listing the server already closed.
      return `<div class="trade-woc-arm">${modeTabs}
        <p class="trade-woc-hint" data-woc-hint role="status"></p>
      </div>`;
    }
    if (o.phase === 'awaiting_payment' || o.phase === 'paying') {
      // The goods are already in escrow. Exactly one face here is actionable
      // per side: the buyer's Pay button while the payment has not started,
      // and the seller's Cancel sale while the buyer has not paid (the
      // directed listing's own cancel; it disappears the moment a payment is
      // in flight, because the server would refuse it then anyway, and once
      // the seller's cancel is PENDING, since a second press only re-answers
      // the same). Every other combination is a WAIT, and each says whose
      // wait it is, because the seller watching a confirmation and the buyer
      // watching their own transaction are not the same sentence.
      //
      // The status line is announced: a state the player cannot see change (a
      // chain confirmation) is exactly the case a screen reader must be told
      // about, and it replaces the only feedback a sighted player gets.
      // The quote-review panel outranks the Pay button: once a quote is
      // staged, the buyer must SEE what signing costs (the token total, the
      // fee legs, the expiry) before the wallet takes over. Going straight
      // from click to wallet was the H13 informed-commitment gap.
      if (model.quoteReview !== null && o.role === 'buyer') {
        const q = model.quoteReview;
        const tokens = wocTokensText;
        const leg = (
          key:
            | 'hudChrome.wocMarket.quoteTotal'
            | 'hudChrome.wocMarket.quoteSeller'
            | 'hudChrome.wocMarket.quoteBurn'
            | 'hudChrome.wocMarket.quoteTreasury',
          value: number | null,
        ) =>
          value == null
            ? ''
            : `<p class="trade-woc-leg${key === 'hudChrome.wocMarket.quoteTotal' ? ' trade-woc-leg-total' : ''}">${esc(t(key, { tokens: tokens(value) }))}</p>`;
        // The Exchange's quote panel shows the same four legs for the same
        // server answer; two surfaces of one economy disclose the same amounts.
        const legs =
          leg('hudChrome.wocMarket.quoteTotal', q.totalTokens) +
          leg('hudChrome.wocMarket.quoteSeller', q.sellerTokens) +
          leg('hudChrome.wocMarket.quoteBurn', q.burnTokens) +
          leg('hudChrome.wocMarket.quoteTreasury', q.treasuryTokens);
        // A lapsed quote SAYS so beside the disabled Sign, in this arm's own
        // words (the way back here is Not now, then Pay: there is no request
        // control), instead of a dead button under a past time.
        const quoteExpiry = model.quoteExpired
          ? `<p class="trade-woc-warn">${esc(t('hudChrome.trade.woc.quoteExpiredTrade'))}</p>`
          : usableStampMs(q.expiresAtMs) === null
            ? ''
            : `<p class="trade-woc-note">${esc(
                t('hudChrome.wocMarket.quoteExpiresAt', {
                  time: formatDateTime(q.expiresAtMs as number, { timeStyle: 'short' }),
                }),
              )}</p>`;
        // The claim's OWN payment deadline (shorter than the directed hold the
        // pre-commitment note announced): Not now keeps it running, so the
        // buyer reads it here too.
        const dueLine =
          model.paymentDueAtMs === null
            ? ''
            : `<p class="trade-woc-warn">${esc(
                t('hudChrome.trade.woc.p2pPaymentDueAt', {
                  time: formatDateTime(model.paymentDueAtMs, { timeStyle: 'short' }),
                }),
              )}</p>`;
        // No consent row here: the claim that staged this quote was the
        // terms-gated send, so acceptance is durable by the time it renders.
        // On this face the amount IS fixed until the quote expires: the note
        // says that. Sign is the one commitment button; Not now is the way out.
        return `<div class="trade-woc-arm">${modeTabs}
          <p class="trade-woc-quote-title" role="status">${esc(t('hudChrome.wocMarket.quoteTitle'))}</p>
          <p class="trade-woc-leg">${esc(t('hudChrome.trade.woc.payNow', { usd: usd(q.usdCents) }))}</p>
          ${legs}
          ${quoteExpiry}
          ${dueLine}
          <p class="trade-woc-warn">${esc(t('hudChrome.wocMarket.quoteFixedNote'))}</p>
          <div class="trade-woc-actions">
          <button type="button" class="btn trade-woc-pay trade-woc-primary" data-woc-sign data-focus-key="trade-woc-sign"${
            model.quoteExpired ? ' disabled' : ''
          }>${esc(t('hudChrome.wocMarket.quoteSign'))}</button>
          <button type="button" class="btn trade-woc-cancel trade-woc-quiet" data-woc-quote-cancel data-focus-key="trade-woc-quote-cancel">${esc(
            t('hudChrome.wocMarket.quoteCancel'),
          )}</button>
          </div>
          <p class="trade-woc-hint" data-woc-hint role="status"></p>
        </div>`;
      }
      // Once a claim exists its own deadline is the honest figure; before
      // one, the pre-commitment note (the hold) still stands.
      const dueOrNote =
        model.paymentDueAtMs === null
          ? bindingNote
          : `<p class="trade-woc-warn">${esc(
              t('hudChrome.trade.woc.p2pPaymentDueAt', {
                time: formatDateTime(model.paymentDueAtMs, { timeStyle: 'short' }),
              }),
            )}</p>`;
      const body =
        model.canPay && o.role === 'buyer'
          ? `${dueOrNote}${termsRow}<button type="button" class="btn trade-woc-pay trade-woc-primary" data-woc-pay data-focus-key="trade-woc-pay"${
              model.busy ? ' disabled' : ''
            }>${
              model.busy ? '<span class="woc-spinner" aria-hidden="true"></span>' : ''
            }${esc(t('hudChrome.trade.woc.payNow', { usd: usd(o.usdCents) }))}</button>`
          : `<p class="trade-woc-waiting" role="status">${
              model.busy ? '<span class="woc-spinner" aria-hidden="true"></span>' : ''
            }${esc(t(model.statusKey ?? 'hudChrome.trade.woc.awaitingPayment'))}</p>`;
      const cancelSale =
        o.role === 'seller' && o.phase === 'awaiting_payment' && !model.cancelPending
          ? `<button type="button" class="btn trade-woc-cancel trade-woc-quiet" data-woc-cancel-sale data-focus-key="trade-woc-cancel-sale"${busyResolve}>${esc(
              t('hudChrome.trade.woc.cancelSale'),
            )}</button>`
          : '';
      return `<div class="trade-woc-arm">${modeTabs}
        ${feeLines}
        ${body}
        ${cancelSale}
        <p class="trade-woc-hint" data-woc-hint role="status"></p>
      </div>`;
    }
    // No Accept button of its own: agreement rides the trade window's existing
    // Accept, on both sides, exactly as a gold trade does. The arm's own
    // actions are each side's way OUT of the deal: the buyer withdraws the
    // offer they made, the seller declines the incoming one (H13's dead
    // wiring, now live). One click, one request: a resolve in flight
    // disables the control.
    const action =
      o.role === 'buyer'
        ? `<button type="button" class="btn trade-woc-cancel trade-woc-quiet" data-woc-cancel data-focus-key="trade-woc-withdraw"${busyResolve}>${esc(t('hudChrome.trade.woc.withdraw'))}</button>`
        : `<button type="button" class="btn trade-woc-cancel trade-woc-quiet" data-woc-decline data-focus-key="trade-woc-decline"${busyResolve}>${esc(t('hudChrome.trade.woc.decline'))}</button>`;
    // The offer is not open-ended, so say when it lapses; static text on
    // purpose (a per-second countdown would rebuild the subtree for no
    // decision the player can take differently).
    // The same one test every other stamp read takes: a null check alone lets
    // NaN through to Intl, which throws rather than printing, and the throw
    // lands inside this painter and takes the whole arm's face down.
    const expiry =
      usableStampMs(o.expiresAtMs) === null
        ? ''
        : `<p class="trade-woc-note">${esc(
            t('hudChrome.trade.woc.offerExpiresAt', {
              time: formatDateTime(o.expiresAtMs as number, { timeStyle: 'short' }),
            }),
          )}</p>`;
    return `<div class="trade-woc-arm">${modeTabs}
      ${feeLines}
      <p class="trade-woc-warn">${esc(t('hudChrome.trade.woc.notInstant'))}</p>
      ${bindingNote}
      ${expiry}
      ${action}
      <p class="trade-woc-hint" data-woc-hint role="status"></p>
    </div>`;
  }
  if (model.mode !== 'woc') return `<div class="trade-woc-arm">${modeTabs}${wocOffHint}</div>`;

  const priceValue = usdCents === null ? '' : (usdCents / 100).toFixed(2);
  return `<div class="trade-woc-arm">${modeTabs}
    <label class="trade-woc-price-label" for="trade-woc-usd">${esc(t('hudChrome.trade.woc.priceLabel'))}</label>
    <input id="trade-woc-usd" class="coininput trade-woc-price" type="number" min="0" step="0.01" inputmode="decimal" value="${esc(priceValue)}" placeholder="${esc(t('hudChrome.trade.woc.pricePlaceholder'))}" data-focus-key="trade-woc-usd">
    <p class="trade-woc-equiv" data-woc-equiv></p>
    ${feeLines}
    <p class="trade-woc-note" data-woc-ineligible></p>
    <p class="trade-woc-note" data-woc-ineligible-why></p>
    <p class="trade-woc-warn">${esc(t('hudChrome.trade.woc.variableWarning'))}</p>
    <p class="trade-woc-warn">${esc(t('hudChrome.trade.woc.notInstant'))}</p>
    ${termsRow}
    <button type="button" class="btn trade-woc-send trade-woc-primary" data-woc-send data-focus-key="trade-woc-send">${esc(t('hudChrome.trade.woc.sendOffer'))}</button>
    <p class="trade-woc-hint" data-woc-hint role="status"></p>
  </div>`;
}

/**
 * Update only the derived lines, in place.
 *
 * Called on every price edit and whenever a fresh server estimate lands. It
 * writes text and one disabled flag and touches nothing structural, so the
 * caret in the price field survives. Each write is elided against the value
 * already there, so an unchanged estimate costs no DOM work.
 */
export function refreshWocTradeArm(root: ParentNode, model: WocTradeModel): void {
  const setText = (sel: string, text: string): void => {
    const el = root.querySelector<HTMLElement>(sel);
    if (el && el.textContent !== text) el.textContent = text;
  };
  setText(
    '[data-woc-equiv]',
    model.tokens === null
      ? ''
      : t('hudChrome.trade.woc.equivalent', {
          tokens: wocTokensText(model.tokens),
        }),
  );
  // The figure itself carries the problem, not just the hint below it: the
  // number is what the player is looking at while typing.
  const equiv = root.querySelector<HTMLElement>('[data-woc-equiv]');
  if (equiv && equiv.classList.contains('over-balance') !== model.insufficientBalance) {
    equiv.classList.toggle('over-balance', model.insufficientBalance);
  }
  // Absent split means show nothing, never a client-derived percentage: the
  // real split rounds each fee leg up and gives the seller the remainder.
  setText(
    '[data-woc-fee]',
    model.split === null
      ? ''
      : t('hudChrome.trade.woc.feeLine', {
          fee: usd(model.split.burnCents + model.split.treasuryCents),
        }),
  );
  // Per side (the model picks the key): the seller reads what THEY receive,
  // the buyer what the seller receives, since the price is the buyer's to
  // pay in full.
  setText(
    '[data-woc-net]',
    model.split === null ? '' : t(model.netKey, { net: usd(model.split.sellerCents) }),
  );
  // The p2p commitment note names the realm's payment hold once /status has
  // answered it; until then its untimed twin still names the strike rather
  // than a guessed figure. Rendered here (not in the markup) so the /status
  // answer lands without a rebuild.
  setText(
    '[data-woc-binding]',
    !model.showBindingNote
      ? ''
      : model.holdSeconds === null
        ? t('hudChrome.trade.woc.p2pBindingNoteUntimed')
        : t('hudChrome.trade.woc.p2pBindingNote', {
            duration: durationText(model.holdSeconds),
          }),
  );
  // The count through the plurals base (a Slavic locale has three forms for
  // it), then WHY: the exchange lock predicate's arms. TWO rendered lines, not
  // one string joined in code: a hard ' ' between two sentences is the caller
  // deciding a locale's spacing (wrong in CJK, which sets no inter-sentence
  // space), and it is the same reason the fee and the net each own their line.
  setText(
    '[data-woc-ineligible]',
    model.ineligible.length === 0
      ? ''
      : tPlural('hudChrome.plurals.wocTradeIneligible', model.ineligible.length, {
          count: formatNumber(model.ineligible.length, { maximumFractionDigits: 0 }),
        }),
  );
  setText(
    '[data-woc-ineligible-why]',
    model.ineligible.length === 0 ? '' : t('hudChrome.trade.woc.ineligibleReason'),
  );
  // A disabled affordance always says why: the hint rides beside it and
  // clears the moment the action becomes available. The model picks the
  // accept-side key (nothing sellable staged vs a table holding more than
  // the one agreed copy) AND resolves any values the copy interpolates (the
  // below_min floor), so the panel renders it verbatim.
  setText(
    '[data-woc-hint]',
    model.pendingOffer !== null
      ? model.acceptHint === null
        ? ''
        : t(model.acceptHint)
      : model.sendHint === null
        ? ''
        : t(model.sendHint, model.sendHintParams ?? undefined),
  );
  const send = root.querySelector<HTMLButtonElement>('[data-woc-send]');
  if (send && send.disabled !== !model.canSend) send.disabled = !model.canSend;
}

/**
 * The arm's actionable controls in the order a keyboard player would want
 * focus to land when the control they held is gone or disabled: the payment
 * commitments first, then the ways out, then the form. A ladder rather than
 * one candidate, because a rebuild routinely retires the focused control (a
 * pressed Pay renders disabled through the claim; the pay face becomes the
 * quote face) and a single-candidate restore then drops focus to body, the
 * exact failure src/ui/focus_restore.ts spells out.
 */
const WOC_TRADE_FOCUS_LADDER = [
  'trade-woc-sign',
  'trade-woc-quote-cancel',
  'trade-woc-pay',
  'trade-woc-send',
  'trade-woc-decline',
  'trade-woc-withdraw',
  'trade-woc-cancel-sale',
  'trade-woc-terms',
  'trade-woc-usd',
  // The mode tabs last: on a face with nothing else keyed and enabled (a
  // pressed Pay under durable consent) focus still lands inside the arm.
  'trade-woc-tab-woc',
  'trade-woc-tab-gold',
];

/**
 * Re-focus the arm's own control after the trade window rebuilds.
 *
 * The restore lives HERE rather than in the caller because this module owns the
 * `data-focus-key` it emits, and `data-focus-key` is a namespace shared across
 * every window: the shared helper carries the containment check that stops one
 * window's repaint stealing focus from another (#2528). The held key leads the
 * ladder; the ladder is what catches focus when that control is gone.
 */
export function restoreWocTradeFocus(root: ParentNode, focusKey: string | null): void {
  if (focusKey === null) return;
  const byKey = (key: string) =>
    root.querySelector<HTMLElement>(`[data-focus-key="${key.replace(/["\\]/g, '\\$&')}"]`);
  restoreFirstEnabled([byKey(focusKey), ...WOC_TRADE_FOCUS_LADDER.map(byKey)]);
}

/** Attach the arm's listeners to a freshly painted root. */
export function wireWocTradeArm(root: ParentNode, deps: WocTradeArmDeps): void {
  root.querySelectorAll<HTMLElement>('[data-woc-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      deps.onModeChange(btn.dataset.wocMode === 'woc' ? 'woc' : 'gold');
    });
  });
  const price = root.querySelector<HTMLInputElement>('#trade-woc-usd');
  price?.addEventListener('input', () => {
    const raw = price.value.trim();
    if (raw === '') {
      deps.onPriceInput(null);
      return;
    }
    // Guard the parse rather than trusting the number input: a non-finite value
    // would become NaN cents and travel to the server as a malformed price.
    const dollars = Number(raw);
    deps.onPriceInput(Number.isFinite(dollars) ? Math.round(dollars * 100) : null);
  });
  root
    .querySelector<HTMLElement>('[data-woc-send]')
    ?.addEventListener('click', () => deps.onSendOffer());
  root
    .querySelector<HTMLElement>('[data-woc-cancel]')
    ?.addEventListener('click', () => deps.onCancelOffer());
  root
    .querySelector<HTMLElement>('[data-woc-decline]')
    ?.addEventListener('click', () => deps.onDeclineOffer());
  root
    .querySelector<HTMLElement>('[data-woc-cancel-sale]')
    ?.addEventListener('click', () => deps.onCancelSale());
  root
    .querySelector<HTMLElement>('[data-woc-pay]')
    ?.addEventListener('click', () => deps.onPayOffer());
  const terms = root.querySelector<HTMLInputElement>('[data-woc-terms]');
  terms?.addEventListener('change', () => deps.onTermsChange(terms.checked));
  root
    .querySelector<HTMLElement>('[data-woc-sign]')
    ?.addEventListener('click', () => deps.onSignQuote());
  root
    .querySelector<HTMLElement>('[data-woc-quote-cancel]')
    ?.addEventListener('click', () => deps.onQuoteCancel());
}
