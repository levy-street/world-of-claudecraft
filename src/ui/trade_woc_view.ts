// Pure view-core for the trade window's $WOC arm (docs/prd/woc/p2p-woc-trade.md).
//
// The trade window is the ENTRY POINT for selling an item to a named player for
// $WOC, but a $WOC deal is not the sim's atomic swap: the sim trade moves
// everything in one tick, and a $WOC payment is asynchronous (sign, then chain
// finality, seconds to minutes, and it can fail). So this core decides what the
// window offers and shows, and the deal itself rides the exchange rail as a
// directed offer.
//
// The client computes NO economic value here. Token amounts and the fee split
// are passthroughs of server-provided numbers, because the real split rounds
// each fee leg up and gives the seller the remainder: a percentage recomputed
// here would disagree with the settlement by a cent.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { exchangeHardLock, exchangeItemCategory } from '../sim/exchange_eligibility';
import { itemInstancePayloadsEqual } from '../sim/item_instance_merge';
import type { InvSlot, ItemDef } from '../sim/types';
import type { TranslationKey } from './i18n.catalog';
import { TERMS_PATH } from './terms_link';
import { usdText } from './usd_text';
import { overWalletBalance } from './woc_affordable_core';

/** What the window knows about the other side, fed by the server (never by the
 *  sim, which sits inside the token firewall and knows nothing about wallets). */
export interface WocTradePartner {
  name: string;
  walletVerified: boolean;
}

/** The server's fee split for the entered amount, or null when unavailable. */
export interface WocTradeSplit {
  sellerCents: number;
  burnCents: number;
  treasuryCents: number;
}

export type WocTradeMode = 'gold' | 'woc';

/**
 * Where a $WOC deal has got to. The window shows one of these faces.
 *
 *  - review: agreed price on the table, each side yet to accept.
 *  - awaiting_payment: both accepted, the goods are in escrow, and the BUYER
 *    still has to sign. The seller can do nothing but wait, which is exactly
 *    what their face should say.
 *  - paying: the payment is in flight. The buyer has signed and the chain has
 *    not finished confirming, which takes tens of seconds on mainnet.
 *  - settled: SOLD, and only sold (listingResolution === 'sold'). It used to
 *    mean "the listing closed", which told a seller whose deal was cancelled,
 *    suspended, or simply never paid that they had received a payment: the
 *    H13 false-payment line. A closed-not-sold listing is 'closed'.
 *  - closed: the deal died without a sale (cancelled / suspended / unpaid).
 *    The controller reports the honest reason once and returns the arm to
 *    the compose form in the same synchronous step; the panel's closed face
 *    is a belt that renders no action, so a dead deal can never fall through
 *    to Decline or Withdraw.
 *
 * `paying` is not cosmetic. Without it the window sat on `awaiting_payment`
 * through the whole confirmation and then emptied, so a buyer signing in their
 * wallet and a buyer who walked away looked identical to the seller, and the
 * sale appeared to complete with no payment ever shown.
 */
export type WocOfferPhase = 'review' | 'awaiting_payment' | 'paying' | 'settled' | 'closed';

/** The staged settlement quote as the review face shows it: the token total
 *  and the fee legs (null when the service did not answer one), the USD it
 *  settles, and its expiry. Structural only: the transaction blob is not
 *  render state and stays on the controller. */
export interface WocTradeQuoteReview {
  totalTokens: number | null;
  sellerTokens: number | null;
  burnTokens: number | null;
  treasuryTokens: number | null;
  usdCents: number;
  expiresAtMs: number | null;
}

/** A sent-but-unresolved $WOC offer, as both sides see it. */
export interface WocPendingOffer {
  id: number;
  usdCents: number;
  /** Server-quoted tokens for that price, or null while unavailable. */
  tokens: number | null;
  /** Which side the VIEWER is on: only the seller may accept, only the buyer pays. */
  role: 'buyer' | 'seller';
  phase: WocOfferPhase;
  /** The directed listing to pay for, once one exists. */
  listingId: number | null;
  /** Each side's agreement. The trade window's Accept button reads THESE rather
   *  than the sim's own accepted flags, because a $WOC deal never confirms the
   *  sim trade and those flags therefore never move. */
  buyerAccepted: boolean;
  sellerAccepted: boolean;
  /** When the un-accepted offer lapses (the server's TTL), so the review face
   *  can say so instead of silently reverting to the form. Null or absent
   *  when the wire did not carry it (absent reads as null). */
  expiresAtMs?: number | null;
  /** The live settlement's coarse state, so the paying face can distinguish
   *  "confirming on the network" from "confirmed, delivery under way". Null
   *  or absent while none exists (absent reads as null). */
  settlementState?: string | null;
}

/** Why the $WOC arm is unavailable, or null when it is offerable. */
export type WocArmBlock =
  | 'market_disabled' // the realm has no exchange
  | 'no_wallet' // YOUR wallet is not linked
  | 'partner_unknown' // we have not learned whether THEY can be paid
  | 'recipient_no_wallet'; // we have, and they cannot

/**
 * Why "Send offer" is withheld, when the arm itself is usable.
 *
 * Distinct from WocArmBlock, which means $WOC is unavailable and hides the
 * form. These are about the CONTENTS of the offer being incomplete, so the form
 * stays up and the hint says what is missing. A disabled button with no reason
 * is the defect this exists to prevent: a seller typed a price, got a dead
 * button, and had nothing to act on.
 */
export type WocSendHint =
  | 'clear_your_items' // you are BUYING, so your own side must be empty
  | 'await_their_items' // they have staged nothing eligible to buy yet
  | 'one_item' // a directed deal pins EXACTLY one copy; more than one is ambiguous
  | 'enter_price'
  | 'below_min' // under the Exchange's minimum price (the server would refuse)
  | 'gold_offered'
  | 'insufficient_balance'; // the quote is more $WOC than the wallet holds

export interface WocTradeInput {
  marketEnabled: boolean;
  selfWalletVerified: boolean;
  partner: WocTradePartner | null;
  /** YOUR own staged items. Offering $WOC means buying, so this must be empty:
   *  items go one way and $WOC the other. */
  staged: readonly InvSlot[];
  /** The SIM's cleaned own-side offer when a live session mirrors one, which
   *  is the table the player actually sees rendered and the list the accept
   *  path escrows from. The ACCEPT arm (canAccept, acceptHint) reads this so
   *  its WHY can never contradict the visible table; `staged` stays the
   *  compose-time source for everything pre-push (wocDisabled, the
   *  clear-your-items hint). Absent means no live mirror: the compose list
   *  IS the truth and the accept arm falls back to it (defensive: the live
   *  controller always supplies this while the trade window is open, so the
   *  fallback is a test-and-future-host path, not a production one). */
  stagedAuthoritative?: readonly InvSlot[];
  /** What the OTHER player has staged, which is what you are paying for. */
  theirStaged: readonly InvSlot[];
  items: Readonly<Record<string, ItemDef>>;
  mode: WocTradeMode;
  /** The USD the seller typed, in cents. Null when the field is empty. */
  usdCents: number | null;
  /** Server passthroughs for `usdCents`; null while unquoted or unavailable. */
  tokens: number | null;
  split: WocTradeSplit | null;
  /**
   * The live offer standing between these two players, if one has been sent.
   *
   * While it exists the arm stops being a form and becomes a REVIEW surface:
   * both sides see the same price, and each gets the action that is theirs. The
   * trade window deliberately stays open across this, because reviewing and
   * agreeing IS the trade, and closing it would leave both players guessing.
   */
  pendingOffer: WocPendingOffer | null;
  /**
   * True once gold sits on the table from EITHER side.
   *
   * Either, not just your own: the two currencies are exclusive for the whole
   * trade, not per player, and a rule that only watched your own side let one
   * player put gold down while the other was still offered the $WOC arm. The
   * pair would then have agreed a deal neither half could carry.
   */
  goldOffered: boolean;
  /**
   * The Exchange's minimum listing price in cents, from /status. Null or
   * absent while unknown, and unknown never blocks (the hint is a courtesy;
   * the server's own refusal is the authority), like walletTokens below.
   */
  minPriceCents?: number | null;
  /**
   * Whether this account's Marketplace terms acceptance is durably recorded
   * (from /me, or observed on a send this session). False or absent means
   * show the consent control: the sends carry the player's REAL choice, and
   * hard-coding acceptTerms while showing nothing recorded consent the
   * player never gave (R9).
   */
  termsAccepted?: boolean;
  /** The consent checkbox's current state (painter-owned, like the Exchange
   *  window's). Read only to re-render it across rebuilds. */
  termsChecked?: boolean;
  /**
   * The held settlement quote awaiting the buyer's explicit sign-off, or
   * null/absent when none is staged. Its presence is what turns the pay face
   * into the review panel: H13's finding was the p2p Pay flow going straight
   * from click to wallet with nothing showing the token total or expiry.
   * The fee legs ride beside the total (the Exchange's quote panel shows the
   * same four figures for the same server answer).
   */
  quote?: WocTradeQuoteReview | null;
  /** True while the Pay claim (buyNow + quote) round trips: the pressed Pay
   *  button must go disabled immediately, not when the quote lands. */
  paying?: boolean;
  /** True while a Decline / Withdraw / Cancel sale request is in flight: the
   *  pressed control disables (one click, one request). */
  resolving?: boolean;
  /** The seller's cancel was answered cancel-pending (a buyer holds the
   *  purchase window): the face records it instead of re-offering Cancel. */
  cancelPending?: boolean;
  /** The realm's directed payment hold from /status (seconds), for the p2p
   *  commitment disclosure; null or absent while unknown (the note then
   *  names no figure rather than a guessed one). */
  directedHoldSeconds?: number | null;
  /** The href the consent link renders (src/ui/terms_link.ts resolves it per
   *  shell; the host that knows the page origin passes it in, so this core
   *  and its painter stay host-agnostic). Absent renders the site path. */
  termsHref?: string;
  /** The claimed settlement's payment deadline for THIS deal (a pressed Pay
   *  opens a window shorter than the directed hold), or null/absent before
   *  any claim. Rendered on the buyer's pay and quote faces. */
  paymentDueAtMs?: number | null;
  /** Paint-time clock for the staged quote's expiry face. Absent means the
   *  face never shows expired (the sign handler still guards the click). */
  nowMs?: number;
  /**
   * The VERIFIED wallet's $WOC balance, or null when it is not known.
   *
   * Null is deliberately NOT treated as zero. The balance is fetched
   * asynchronously and can be absent for reasons that say nothing about what the
   * player holds (still loading, an RPC blip, a wallet connected but not yet
   * linked). Refusing the offer then would block a player who can perfectly well
   * pay, on no evidence. The server re-checks the balance at payment time and is
   * the authority; this only stops the obviously-doomed offer before two people
   * spend a round trip agreeing to it.
   */
  walletTokens: number | null;
  /**
   * Whether the counterparty lookup has produced an answer yet.
   *
   * Separate from `partner` being non-null on purpose. A null partner is
   * ambiguous: it is both "still asking" and "asked, and there is no such
   * character". Only the caller knows which, so it tells us, and an
   * unanswered lookup never accuses the other player of anything.
   */
  partnerResolved: boolean;
}

export interface WocTradeModel {
  /** Whether to render the $WOC toggle at all. */
  armVisible: boolean;
  /** Why it is unavailable, when it is not offerable. Null means offerable. */
  block: WocArmBlock | null;
  /** The i18n key for the block message, or null. Typed, not a bare
   *  string, so the painter renders it through t() with no cast. */
  blockKey: TranslationKey | null;
  mode: WocTradeMode;
  /** Staged items that may legally be sold for $WOC. */
  eligible: readonly InvSlot[];
  /** Staged items that may not, so the window can say which and why. */
  ineligible: readonly InvSlot[];
  /** Whether the coin INPUTS must be disabled (the two currencies are
   *  exclusive). Covers composing a $WOC price as well as a standing deal; the
   *  Gold TAB is gated by wocDealStanding instead. */
  goldDisabled: boolean;
  /**
   * Whether a $WOC deal is standing for either side.
   *
   * ONE cause with two effects, which is why it is one flag: the Gold tab is
   * disabled and the coin inputs come off screen entirely. Distinct from
   * goldDisabled, which also covers merely COMPOSING a price: the tab must stay
   * live then, or a player who opened the $WOC arm to look at it can never get
   * back to gold.
   */
  wocDealStanding: boolean;
  /** Whether the $WOC field must be disabled. */
  wocDisabled: boolean;
  /** Whether the quoted amount exceeds the wallet's balance, so the figure can
   *  be shown as the problem it is rather than as an ordinary estimate. */
  insufficientBalance: boolean;
  tokens: number | null;
  split: WocTradeSplit | null;
  /** The live offer to review, or null while none is standing. */
  pendingOffer: WocPendingOffer | null;
  /** Whether the SELLER may accept the standing offer (they hold the goods).
   *  Deliberately unconsumed by the panel: it renders no accept affordance of
   *  its own (agreement rides the trade window's Accept, whose disabled state
   *  never consults this model), so acceptHint carries the player-facing
   *  meaning and this boolean stays the tested truth it derives from. */
  canAccept: boolean;
  /** The i18n key explaining why the seller may NOT accept yet, or null when
   *  they may (or when no review-phase offer points at them). Distinguishes
   *  the two refusal shapes: nothing sellable staged versus a table holding
   *  more than the one agreed copy. */
  acceptHint: TranslationKey | null;
  /** Whether the BUYER may start paying: escrow is done and it is their turn. */
  canPay: boolean;
  /** Whether to render the terms consent row: a money commitment affordance
   *  is on screen for the VIEWER (the buyer's compose form or pay face) and
   *  acceptance is not durably recorded. The seller's surfaces never show it:
   *  their accept is not terms-gated server-side. */
  showTerms: boolean;
  /** The consent checkbox state to re-render (see input.termsChecked). */
  termsChecked: boolean;
  /** The staged settlement quote to review before signing, or null. Non-null
   *  only on the buyer's own pay surface. */
  quoteReview: WocTradeQuoteReview | null;
  /** Whether a Decline / Withdraw / Cancel sale request is in flight, so
   *  the pressed control renders disabled. */
  resolveBusy: boolean;
  /** Whether the seller's cancel is pending (the buyer may still pay): the
   *  waiting face says so and Cancel sale is withdrawn. */
  cancelPending: boolean;
  /** Which net line the fee block renders: the seller reads what THEY
   *  receive, the buyer what the SELLER receives (the price is theirs to pay
   *  in full). */
  netKey: TranslationKey;
  /** The directed payment hold in seconds when the realm has told us, for
   *  the buyer's commitment note; null renders the note without a figure. */
  holdSeconds: number | null;
  /** Whether the buyer's p2p commitment note renders on this face: the
   *  buyer's review face (before the shared Accept) and their pay face. */
  showBindingNote: boolean;
  /** The consent link's href (see input.termsHref). */
  termsHref: string;
  /** The claimed settlement's payment deadline to render, or null: the
   *  buyer's pay and quote faces name it once a claim exists (the pressed
   *  Pay shortened the window the pre-commitment note announced). */
  paymentDueAtMs: number | null;
  /** True once the staged quote's deadline passed at paint time: Sign renders
   *  disabled. The click handler re-checks the clock either way (a face
   *  painted before the lapse keeps its enabled button until a repaint), so
   *  this is the honest face, not the guard. */
  quoteExpired: boolean;
  /** Whether "Send offer" may be pressed. */
  canSend: boolean;
  /** The i18n key explaining why it may not, or null when it may. */
  sendHint: TranslationKey | null;
  /** Values the sendHint copy interpolates (the below_min floor), or null
   *  when the hint takes none. Resolved HERE so the painter renders the key
   *  verbatim and derives nothing. */
  sendHintParams: Record<string, string> | null;
  /** The exact copy the offer pins (H10): the partner's ONE eligible staged
   *  item, or null while the table is empty or ambiguous. Non-null whenever
   *  canSend is true, by the hint ladder's one_item arm. */
  agreedItem: InvSlot | null;
  /**
   * What the standing deal is doing, in words, for the VIEWER's side. Null when
   * there is nothing to say (no offer, or the offer is theirs to act on and the
   * button already says so).
   *
   * Per role, not just per phase: while a payment confirms, the buyer is waiting
   * on their own transaction and the seller is waiting on someone else's, and
   * one sentence cannot honestly describe both.
   */
  statusKey: TranslationKey | null;
  /** Whether to show the pending indicator beside that line. */
  busy: boolean;
}

/** The status line per phase and side. Only the states where SOMETHING is
 *  happening that the player cannot act on need one. */
const STATUS_KEYS: Partial<Record<`${WocOfferPhase}:${'buyer' | 'seller'}`, TranslationKey>> = {
  'awaiting_payment:seller': 'hudChrome.trade.woc.statusAwaitingBuyer',
  'paying:buyer': 'hudChrome.trade.woc.statusPayingBuyer',
  'paying:seller': 'hudChrome.trade.woc.statusPayingSeller',
};

/** A CONFIRMED payment whose delivery is still completing is not "confirming
 *  on the network" (decided money) and not yet "on its way by mail" (the
 *  finalize has not run): its own honest sentence, per side. */
const DELIVERING_STATUS_KEYS: Record<'buyer' | 'seller', TranslationKey> = {
  buyer: 'hudChrome.trade.woc.statusConfirmedBuyer',
  seller: 'hudChrome.trade.woc.statusConfirmedSeller',
};

/** Settlement states where the money is DECIDED and delivery is completing
 *  ('delivered' included: the copy has moved but the sale's own finalize has
 *  not run, so the poll's settled line still closes the loop). Exported for
 *  the subset pin against WOC_SETTLING_STATES (woc_trade_offer_view.ts): a
 *  state here that the settling set lacks would never render its sentence. */
export const WOC_DELIVERING_STATES: ReadonlySet<string> = new Set([
  'confirmed',
  'delivering',
  'delivered',
]);
const DELIVERING_STATES = WOC_DELIVERING_STATES;

/** A settlement parked under an operator verdict: neither confirming nor
 *  decided, so its own sentence per side and no spinner. */
const REVIEW_STATUS_KEYS: Record<'buyer' | 'seller', TranslationKey> = {
  buyer: 'hudChrome.trade.woc.statusReviewBuyer',
  seller: 'hudChrome.trade.woc.statusReviewSeller',
};

const BLOCK_KEYS: Record<WocArmBlock, TranslationKey> = {
  market_disabled: 'hudChrome.trade.woc.blockDisabled',
  no_wallet: 'hudChrome.trade.woc.blockNoWallet',
  partner_unknown: 'hudChrome.trade.woc.blockPartnerUnknown',
  recipient_no_wallet: 'hudChrome.trade.woc.blockRecipientNoWallet',
};

const SEND_HINT_KEYS: Record<WocSendHint, TranslationKey> = {
  clear_your_items: 'hudChrome.trade.woc.hintClearYourItems',
  await_their_items: 'hudChrome.trade.woc.hintAwaitTheirItems',
  one_item: 'hudChrome.trade.woc.hintOneItem',
  enter_price: 'hudChrome.trade.woc.hintEnterPrice',
  below_min: 'hudChrome.trade.woc.hintBelowMin',
  gold_offered: 'hudChrome.trade.woc.hintGoldOffered',
  insufficient_balance: 'hudChrome.trade.woc.hintInsufficientBalance',
};

/**
 * A wire timestamp this client is willing to PRINT, or null.
 *
 * Every expiry on the $WOC arm comes from a server column projected through a
 * Date parse, and the shapes that projection can produce are exactly the ones
 * Intl refuses: NaN and Infinity make `formatDateTime` throw a RangeError
 * (taking the whole line, and its painter, down), while 0 and a negative stamp
 * are absence written as a number and would print a 1970 deadline. One test,
 * one place, so the send path, the offer row and the quote face cannot drift
 * apart on what counts as usable.
 */
export function usableStampMs(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Whether one staged slot may be sold for $WOC.
 *
 * Shares `exchangeHardLock` / `exchangeItemCategory` with the server's
 * eligibility policy and the sim's escrow extraction, so the window cannot
 * offer something the server would refuse. It is deliberately the CATEGORY test
 * only: the quality floor is policy the server owns and may retune, and a
 * client copy of it would drift.
 */
export function wocTradableSlot(slot: InvSlot, items: Readonly<Record<string, ItemDef>>): boolean {
  const def = items[slot.itemId];
  if (!def) return false;
  if (exchangeHardLock(def, slot.instance)) return false;
  // 'other' is the taxonomy's CLOSED default, not an absent value: anything it
  // does not recognize is deliberately not tradable. Testing against null here
  // instead would be vacuously true and offer every item in the game.
  return exchangeItemCategory(def) !== 'other';
}

/**
 * Where a staged slot lives in the player's INVENTORY.
 *
 * The escrow extraction keys on an inventory index (ExtractRef.index), while the
 * trade window works in its own staged array. Passing the staged position
 * straight through is the bug this exists to prevent: with one item staged it
 * reads as index 0, which extracts whatever happens to sit first in the bags,
 * and the mismatch refuses the whole sale.
 *
 * Matched on the FULL copy identity itemCopyPin fingerprints: id, the
 * crafted-recipe marker, and the per-instance payload through the sim's
 * ORDER-INDEPENDENT structural comparator, never a JSON.stringify key. Since
 * staged slots carry real payloads (the per-copy staging), this comparison
 * decides whether an instanced directed sale can resolve at all, and
 * stringify would silently depend on key insertion order surviving every
 * clone and wire hop; dropping craftedRecipeId would resolve a staged
 * crafted copy to an unmarked twin at a lower bag index and refuse the sale
 * as item_mismatch. Returns -1 when the slot cannot be found, which the
 * caller must treat as "do not send", never as index 0.
 */
export function inventoryIndexOfStaged(inventory: readonly InvSlot[], staged: InvSlot): number {
  return inventory.findIndex(
    (s) =>
      s.itemId === staged.itemId &&
      s.craftedRecipeId === staged.craftedRecipeId &&
      itemInstancePayloadsEqual(s.instance, staged.instance),
  );
}

/** The trade window's $WOC arm, as a function of its inputs. */
export function buildWocTradeModel(input: WocTradeInput): WocTradeModel {
  // Eligibility is about what you are BUYING, so it reads the other side.
  const eligible = input.theirStaged.filter((s) => wocTradableSlot(s, input.items));
  const ineligible = input.theirStaged.filter((s) => !wocTradableSlot(s, input.items));

  // Order matters, and it is "what can this player act on". A missing exchange
  // is nobody's fault; your own wallet is yours to fix; theirs is the message
  // the requester asked for by name. Reporting the recipient first would tell a
  // player to go and ask someone else when their own wallet is the problem.
  const block: WocArmBlock | null = !input.marketEnabled
    ? 'market_disabled'
    : !input.selfWalletVerified
      ? 'no_wallet'
      : // "We have not been told yet" is its OWN state, ahead of the accusation.
        // Collapsing the two says something false about the other player on any
        // slow, failed, or unsupported lookup.
        !input.partnerResolved
        ? 'partner_unknown'
        : !input.partner?.walletVerified
          ? 'recipient_no_wallet'
          : null;

  const offerable = block === null;
  const wocMode = offerable && input.mode === 'woc';

  // Shared with the Exchange's bid and buy-now gates: the fail-open semantics
  // are the subtle part, and one definition is what stops them drifting.
  const shortfall = overWalletBalance(input.tokens, input.walletTokens);

  // Ordered the way a seller does the work: pick the item, then price it. Gold
  // comes first because it makes the whole arm unusable rather than incomplete.
  // Ordered the way a buyer hits them: clear your own side, wait for goods, then
  // price them. Gold comes first because it makes the arm unusable outright.
  const hint: WocSendHint | null = input.goldOffered
    ? 'gold_offered'
    : input.staged.length > 0
      ? 'clear_your_items'
      : eligible.length === 0
        ? 'await_their_items'
        : // An offer pins EXACTLY ONE copy (H10: the server refuses acceptance
          // of any copy but the pinned one), so the WHOLE table must hold
          // exactly one single-unit slot: a second eligible item, a stack of
          // several units, or even an ineligible companion beside the real
          // one is ambiguous about what the price buys (the buyer sees a
          // full table while the deal covers one copy). Silently pinning
          // one slot would be the bait-and-switch surface inverted.
          input.theirStaged.length > 1 || (eligible[0]?.count ?? 1) !== 1
          ? 'one_item'
          : input.usdCents === null || input.usdCents <= 0
            ? 'enter_price'
            : // Courtesy pre-check of the server's floor: with the floor
              // unknown (null/absent) nothing blocks, and the server's own
              // refusal stays the authority either way.
              input.minPriceCents != null && input.usdCents < input.minPriceCents
              ? 'below_min'
              : shortfall
                ? 'insufficient_balance'
                : null;

  // Only the seller accepts, and only with the agreed shape on the table:
  // acceptance is what escrows the goods, so there must be goods, and the
  // deal covers ONE pinned copy, so the seller's WHOLE table must be one
  // eligible single-unit slot (the send-side one_item rule, mirrored). A
  // second staged slot or a stack makes the accept's slot resolution
  // ambiguous, and the server's pin digest could only refuse the surplus as
  // item_mismatch after the fact. Judged over the AUTHORITATIVE table (see
  // stagedAuthoritative): the sim can clean a pushed offer into a different
  // shape than the compose list, and a hint derived from the list the
  // player is NOT looking at is the wrong-WHY class this arm exists to
  // close.
  const acceptTable = input.stagedAuthoritative ?? input.staged;
  const canAccept =
    input.pendingOffer?.phase === 'review' &&
    input.pendingOffer.role === 'seller' &&
    acceptTable.length === 1 &&
    acceptTable[0].count === 1 &&
    wocTradableSlot(acceptTable[0], input.items);

  return {
    // The arm stays VISIBLE while blocked: hiding it would leave a player who
    // expected to trade for $WOC with no explanation of why they cannot, which
    // is the case the "recipient must connect a wallet" copy exists to answer.
    armVisible: input.marketEnabled,
    block,
    blockKey: block === null ? null : BLOCK_KEYS[block],
    mode: wocMode ? 'woc' : 'gold',
    eligible,
    ineligible,
    // Mutual exclusivity is enforced here as a DISPLAY rule only. The structural
    // guarantee is elsewhere and stronger: a $WOC deal is a directed listing,
    // which has no copper field at all, so no reachable state carries both.
    //
    // A STANDING offer closes gold for BOTH players, not just the one composing
    // it: the deal on the table is priced in $WOC, and the other side being
    // able to add coin to it would offer them a trade the settlement cannot
    // carry.
    goldDisabled: wocMode || input.pendingOffer !== null,
    // Hidden rather than merely greyed once a deal is standing. A disabled coin
    // field still reads as part of the offer, and the money row above it is
    // already showing the agreed $WOC figure, so leaving three dead inputs under
    // it invites the question of which number counts.
    wocDealStanding: input.pendingOffer !== null,
    // Holding items means you are the SELLER in this trade, so the $WOC tab is
    // not yours to use: the requester's rule that the button is disabled once
    // you have an item offered. Gold from EITHER side closes it too.
    wocDisabled: !offerable || input.goldOffered || input.staged.length > 0,
    insufficientBalance: shortfall,
    tokens: wocMode ? input.tokens : null,
    // The split renders on the compose face AND beside a standing deal: the
    // seller commits by accepting, so the fee and their net must be on the
    // review face before that click, not only on the buyer's compose form.
    split: wocMode || input.pendingOffer !== null ? input.split : null,
    netKey:
      input.pendingOffer?.role === 'seller'
        ? 'hudChrome.trade.woc.netLine'
        : 'hudChrome.trade.woc.netLineBuyer',
    pendingOffer: input.pendingOffer,
    canAccept,
    // The WHY beside the (absent) accept affordance: the panel renders this
    // key verbatim, so it must name the RIGHT obstacle. With something
    // sellable staged but a wrong table shape, "add the item" would
    // contradict the visible table; only a table with nothing sellable earns
    // that copy. Scoped to the review phase: after acceptance the goods are
    // escrowed and an empty table is the CORRECT state, not a problem to
    // name.
    acceptHint:
      input.pendingOffer?.phase === 'review' && input.pendingOffer.role === 'seller' && !canAccept
        ? // A single staged copy blocked ONLY by the player's own item lock is
          // liftable in one click, so name that instead of "add the item" (which
          // contradicts the visible, locked item on the table). R10. Gate on
          // category too: a LOCKED but ineligible-category copy (a potion) would
          // still be untradable after unlocking, so telling the player to unlock
          // it is the same wrong-WHY class this arm exists to close.
          acceptTable.length === 1 &&
          acceptTable[0].count === 1 &&
          input.items[acceptTable[0].itemId] !== undefined &&
          exchangeHardLock(input.items[acceptTable[0].itemId], acceptTable[0].instance) ===
            'locked' &&
          exchangeItemCategory(input.items[acceptTable[0].itemId]) !== 'other'
          ? 'hudChrome.trade.woc.hintAcceptLocked'
          : acceptTable.some((s) => wocTradableSlot(s, input.items))
            ? 'hudChrome.trade.woc.hintOneItem'
            : 'hudChrome.trade.woc.hintAcceptNeedsItem'
        : null,
    // Only the buyer pays, and only once the goods are actually in escrow: a pay
    // button before that would take money for an item still in someone's bags.
    canPay:
      input.pendingOffer?.phase === 'awaiting_payment' &&
      input.pendingOffer.role === 'buyer' &&
      input.pendingOffer.listingId !== null,
    // The consent row rides exactly the surfaces whose SEND is terms-gated
    // server-side (guardTerms: the offer create and buyNow, both the buyer's):
    // the compose form and the pay face. Durable acceptance hides it, the
    // Exchange checkbox's own contract.
    showTerms:
      input.termsAccepted !== true &&
      ((wocMode && input.pendingOffer === null) ||
        (input.pendingOffer?.role === 'buyer' && input.pendingOffer.phase === 'awaiting_payment')),
    termsChecked: input.termsChecked === true,
    // The staged quote renders only on the buyer's own pay surface: a quote
    // leaking onto the seller's wait face would show them the buyer's money.
    quoteReview:
      input.quote != null &&
      input.pendingOffer?.role === 'buyer' &&
      (input.pendingOffer.phase === 'awaiting_payment' || input.pendingOffer.phase === 'paying')
        ? input.quote
        : null,
    quoteExpired:
      input.quote?.expiresAtMs != null &&
      input.nowMs != null &&
      input.nowMs > input.quote.expiresAtMs,
    resolveBusy: input.resolving === true,
    cancelPending: input.cancelPending === true,
    holdSeconds:
      typeof input.directedHoldSeconds === 'number' && input.directedHoldSeconds > 0
        ? input.directedHoldSeconds
        : null,
    showBindingNote:
      input.pendingOffer?.role === 'buyer' &&
      (input.pendingOffer.phase === 'review' || input.pendingOffer.phase === 'awaiting_payment'),
    termsHref: input.termsHref ?? TERMS_PATH,
    paymentDueAtMs:
      input.pendingOffer?.role === 'buyer' &&
      (input.pendingOffer.phase === 'awaiting_payment' || input.pendingOffer.phase === 'paying') &&
      typeof input.paymentDueAtMs === 'number'
        ? input.paymentDueAtMs
        : null,
    // A standing offer replaces the form: you cannot send a second one over it.
    canSend: wocMode && hint === null && input.pendingOffer === null,
    sendHint: wocMode && hint !== null ? SEND_HINT_KEYS[hint] : null,
    sendHintParams:
      wocMode && hint === 'below_min' && input.minPriceCents != null
        ? { usd: usdText(input.minPriceCents) }
        : null,
    agreedItem:
      input.theirStaged.length === 1 && eligible.length === 1 && eligible[0].count === 1
        ? eligible[0]
        : null,
    statusKey:
      input.pendingOffer === null
        ? null
        : input.pendingOffer.phase === 'paying' && input.pendingOffer.settlementState === 'review'
          ? REVIEW_STATUS_KEYS[input.pendingOffer.role]
          : input.pendingOffer.phase === 'paying' &&
              DELIVERING_STATES.has(input.pendingOffer.settlementState ?? '')
            ? DELIVERING_STATUS_KEYS[input.pendingOffer.role]
            : input.pendingOffer.role === 'seller' &&
                input.pendingOffer.phase === 'awaiting_payment' &&
                input.cancelPending === true
              ? 'hudChrome.trade.woc.cancelPendingSeller'
              : (STATUS_KEYS[`${input.pendingOffer.phase}:${input.pendingOffer.role}`] ?? null),
    // Only the payment itself spins. Waiting on the other player to press a
    // button is not progress and must not look like it, or every wait reads as
    // "something is happening" and the player never knows when to act. The
    // claim round trips (buyNow + quote) count as the payment: the pressed
    // Pay button must stop looking pressable immediately, not two RTTs later.
    // A payment parked under review is waiting on an operator, not moving.
    busy:
      (input.pendingOffer?.phase === 'paying' && input.pendingOffer.settlementState !== 'review') ||
      input.paying === true,
  };
}
