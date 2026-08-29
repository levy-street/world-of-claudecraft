// The banker rung purchase's presentation: the second price tag's markup and
// the copy mappers that turn a spend RESULT into the sentence a player reads
// (Bank Storage phase 13). DOM-free string building only, so the painter in
// src/ui/bank_window.ts keeps the flow and the private mutable state it owns
// and none of the copy decisions (src/ui/CLAUDE.md, pure core plus thin
// painter). Registered in UI_PURE_CORES.
//
// WHY THESE ARE BANK KEYS AND NOT THE CHARTER ONES. The store's twin mappers
// (charterGrantedText / charterRefusalText in src/ui/charter_card_view.ts) map
// the SAME result tokens, and the shape is deliberately identical, but every
// one of their strings names the product: "The charter was applied", "This
// charter is already on this character", "cannot fit the full grant of this
// charter". Generalizing them would mean either an {item} token spliced into
// every sentence in twenty-one locales, or copy vague enough to fit both
// surfaces, and docs/design/tooltip-writing.md asks for the opposite: write
// from the live mechanic the player just used. What IS shared is the mapping
// DISCIPLINE, and both modules follow it: granted is answered before reason,
// because 'already_granted' means opposite things on the two arms; every
// granted-true arm leads with the payment being complete and may never read
// as a loss; and the ambiguous class falls to one outage default rather than
// being enumerated.
//
// WHICH REFUSALS KEEP THE IDEMPOTENCY KEY IS NOT DECIDED HERE. That is
// src/ui/store_purchase_intent.ts's call alone, and a second classifier in
// this file would silently drift from it.

import type { BankBuyClaudiumModel } from './bank_view';
import { esc } from './esc';
import { formatNumber, t } from './i18n';

/** How a Claudium amount is rendered everywhere on this surface: whole units,
 *  through the i18n number formatter.
 *
 *  The property that actually holds is the STRONGER one, and it is worth stating
 *  precisely because the weaker version invites a later reader to "fix" copy
 *  that is already correct: no surface states a RATE, an equivalence, a
 *  "cheaper than", or a combined total. The two amounts DO meet in one string,
 *  in the button's accessible name (hudChrome.bank.buySlotsDualAria), and that
 *  is deliberate: it is a disjunction of two independent per-product prices,
 *  the spoken equivalent of the two tags a sighted player already sees side by
 *  side on the same button, and it asserts no relation between them. */
export function claudiumAmountText(cost: number): string {
  return formatNumber(cost, { maximumFractionDigits: 0 });
}

/** The SECOND price tag on the one expand button: the Claudium price of the
 *  same next rung the gold tag buys.
 *
 *  It is a plain span, not a control. One button carries both tags and the
 *  choice of rail happens in the confirm prompt, which keeps the button a
 *  single tab stop and avoids nesting an interactive element inside a
 *  <button>. Quieting is by SIBLING POSITION (.bank-buy-tag + .bank-buy-tag in
 *  src/styles/components.css, reserved by phase 08), so the gold tag's own
 *  treatment is untouched and no selector moved to land this. */
export function bankRungClaudiumTagHtml(claudium: BankBuyClaudiumModel): string {
  return (
    `<span class="bank-buy-tag bank-buy-tag-claudium">` +
    `<img src="/claudium/icons/claudium_coin_64.webp" alt="">` +
    `<strong>${esc(claudiumAmountText(claudium.cost))}</strong>` +
    `</span>`
  );
}

/** Success copy for a GRANTED rung spend. Every arm here means the money moved
 *  and the purchase is real, so none of them may read as a failure or as a
 *  lost purchase. apply_deferred and grant_unresolved both arrive with granted
 *  TRUE and lead with payment being complete. */
export function bankRungGrantedText(reason: string | null): string {
  switch (reason) {
    case 'already_granted':
      // The same key replayed: the slots ARE on the character and nothing was
      // charged twice. The OPPOSITE meaning of the granted-false arm below.
      return t('hudChrome.bank.rungAlreadyGranted');
    case 'apply_deferred':
      return t('hudChrome.bank.rungApplyDeferred');
    case 'grant_unresolved':
      return t('hudChrome.bank.rungGrantUnresolved');
    default:
      return t('hudChrome.bank.rungGranted');
  }
}

/** Refusal copy, and ONLY copy.
 *
 *  'insufficient_balance' and 'price_changed' are absent on purpose: the flow
 *  intercepts both before it reaches here (the top-up handoff and the re-read
 *  and re-prompt respectively), exactly as the store's twin does, so reaching
 *  this table with either would mean the flow changed and the outage default
 *  is the honest answer until it is given its own arm.
 *
 *  'purchase_in_progress' reads like a clean refusal and is not: the server
 *  returns it before it reads the pending row for this key, and the concurrent
 *  attempt it names is usually THIS intent mid-debit. It gets its own message
 *  while the ledger keeps the key. The default covers the whole AMBIGUOUS
 *  class ('unavailable', null, or a token this build does not know). */
export function bankRungRefusalText(reason: string | null): string {
  switch (reason) {
    case 'purchase_in_progress':
      return t('hudChrome.bank.rungInProgress');
    case 'does_not_fit':
      return t('hudChrome.bank.rungDoesNotFit');
    case 'already_granted':
      // granted FALSE: this key was already spent on a DIFFERENT purchase.
      return t('hudChrome.bank.rungFailed');
    case 'unknown_item':
    case 'not_cosmetic':
    case 'kind_mismatch':
    case 'invalid_request':
    case 'not_next_rung':
    case 'no_live_character':
      return t('hudChrome.bank.rungNotPurchasable');
    default:
      return t('hudChrome.bank.rungOutage');
  }
}

/** A purchase-result band, painted from the window's own state so the result
 *  survives every repaint that lands before the player has read it.
 *
 *  It holds the RESULT, never the finished sentence. Storing resolved copy
 *  would freeze the band in the language it was bought in: every other string
 *  in this window is re-resolved from t() on each paint, which is exactly the
 *  assumption tests/language_fanout_registry.test.ts records when it answers
 *  `bankWindow.render` for bank_window.ts. A player who buys a rung and then
 *  switches language would otherwise watch the whole window relocalize around
 *  one English sentence about their real-money purchase. */
export interface BankRungNotice {
  granted: boolean;
  /** The service's own token, or null. NOTE that null is OVERLOADED: it is both
   *  "there was no spend hook at all" and "the service answered with a token
   *  this build does not know". Both resolve to the same outage sentence today,
   *  which is why one field is enough; the day either needs its own copy, this
   *  is the line that has to split first. */
  reason: string | null;
}

/** The band's tone, derived rather than stored: a granted spend is the only
 *  success, so a second field could only ever disagree with this one. */
export function bankRungNoticeTone(notice: BankRungNotice): 'success' | 'failure' {
  return notice.granted ? 'success' : 'failure';
}

/** The band's sentence, resolved at PAINT time.
 *
 *  'price_changed' is routed here rather than added to bankRungRefusalText
 *  below, so that table's own claim stays true: it is the copy for refusals the
 *  flow did NOT intercept, and price_changed is intercepted (it re-reads and may
 *  re-prompt). Only the band it leaves behind needs a sentence. */
export function bankRungNoticeText(notice: BankRungNotice): string {
  if (notice.granted) return bankRungGrantedText(notice.reason);
  if (notice.reason === 'price_changed') return t('hudChrome.wocStore.priceChanged');
  return bankRungRefusalText(notice.reason);
}

/** What a granted-false result should DO, as a pure function of the result and
 *  the live offer.
 *
 *  Extracted from the window (Bank Storage phase 13 QA) because none of these
 *  decisions need the window's private mutable state, and inside it every branch
 *  was reachable only by driving a whole purchase: the re-prompt inequality, the
 *  one-per-open cap, and the authoritative-cost preference each had arms that
 *  could not be written. The window keeps the side effects (the repaint, the
 *  prompt, the handoff) and this owns the decision. */
export interface BankRungRefusalPlan {
  /** The band to show, or null for the one refusal that speaks through a dialog
   *  instead (insufficient balance opens the top-up handoff). */
  notice: BankRungNotice | null;
  /** The cost to quote in the top-up handoff, or null for no handoff. */
  topUpCost: number | null;
  /** Whether to re-prompt automatically at the fresh price. */
  reprompt: boolean;
}

export function planBankRungRefusal(input: {
  reason: string | null;
  /** The cost actually SENT (the intent's frozen one), which is what the service
   *  judged and therefore what a refreshed price is compared against. */
  sentCost: number;
  /** The cost the SERVICE returned with the refusal, when it gave one. */
  serviceCost: number | null;
  /** Whether this window open has already spent its one automatic re-prompt. */
  reprompted: boolean;
  /** The Claudium price the wire quotes NOW, or null when there is no live
   *  Claudium offer left to re-prompt with. */
  freshCost: number | null;
}): BankRungRefusalPlan {
  if (input.reason === 'price_changed') {
    return {
      notice: { granted: false, reason: 'price_changed' },
      topUpCost: null,
      // The inequality is load-bearing: re-prompting at a price that still
      // equals the one just refused would loop the prompt forever. The cap is
      // the second guard, for a price that OSCILLATES between two values.
      reprompt: !input.reprompted && input.freshCost !== null && input.freshCost !== input.sentCost,
    };
  }
  if (input.reason === 'insufficient_balance') {
    // Prefer the service's own cost over the one we sent, exactly as the charter
    // path does: it is the authoritative number to top up against.
    const usable =
      input.serviceCost !== null && Number.isFinite(input.serviceCost) && input.serviceCost > 0;
    return {
      notice: null,
      topUpCost: usable ? (input.serviceCost as number) : input.sentCost,
      reprompt: false,
    };
  }
  return { notice: { granted: false, reason: input.reason }, topUpCost: null, reprompt: false };
}

/** The result band AND the region that announces it.
 *
 *  TWO NODES, and the split is the point. The VISIBLE band carries no aria role:
 *  it is built in the same write as its own text, which is the shape that fails
 *  to announce. The announcing region is separate, visually hidden, and ALWAYS
 *  EMITTED EMPTY, even when there is a result to show.
 *
 *  Empty is not an oversight, it is the contract. A live region that arrives in
 *  the DOM already carrying its text is commonly not announced at all; what a
 *  screen reader reports is a CHANGE to a region that was already there. So the
 *  window paints first and writes the text into this node afterwards, which
 *  also means an unrelated repaint cannot re-announce a result the player has
 *  already heard. The VISIBLE band is the half that survives every repaint, so
 *  nothing is lost on screen either way. */
export function bankRungResultHtml(notice: BankRungNotice | null): string {
  const band = notice
    ? `<div class="bank-rung-notice ${bankRungNoticeTone(notice)}">` +
      `${esc(bankRungNoticeText(notice))}</div>`
    : '';
  return (
    band +
    `<span class="visually-hidden" data-rung-live role="status" aria-live="polite"` +
    ` aria-atomic="true"></span>`
  );
}

/** The four localized strings of the insufficient-balance top-up handoff.
 *
 *  Pure, so the shortfall arithmetic has arms of its own: the floor at zero
 *  matters because the AUTHORITATIVE cost the service returned can be lower than
 *  the balance the client last read, and a negative shortfall would ask the
 *  player to buy a negative amount of Claudium. */
export interface BankRungTopUpCopy {
  title: string;
  body: string;
  confirm: string;
  cancel: string;
}

export function bankRungTopUpCopy(
  blockSlots: number,
  cost: number,
  knownBalance: number,
): BankRungTopUpCopy {
  return {
    title: t('hudChrome.wocStore.needMoreTitle'),
    body: t('hudChrome.wocStore.needMoreBody', {
      item: bankRungItemName(blockSlots),
      shortfall: formatNumber(Math.max(0, cost - knownBalance), { maximumFractionDigits: 0 }),
    }),
    confirm: t('hudChrome.wocStore.buyClaudium'),
    cancel: t('hudChrome.wocStore.cancel'),
  };
}

/** The name this surface gives what is being bought, for the sentences that
 *  splice an item (the shared Claudium top-up prompt). A rung has no product
 *  name in the registry by design, so it is described by what it grants. */
export function bankRungItemName(blockSlots: number): string {
  return t('hudChrome.bank.rungItemName', {
    count: formatNumber(blockSlots, { maximumFractionDigits: 0 }),
  });
}
