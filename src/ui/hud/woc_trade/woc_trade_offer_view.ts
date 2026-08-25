// Pure decisions for the trade window's standing $WOC offer: which server row
// the open window adopts, how a held offer advances through its phases, and the
// projection from a service row to the client's held-offer shape. DOM-free and
// host-free so the transitions are unit-testable directly
// (tests/woc_trade_offer_view.test.ts). The EFFECTS (REST calls, log lines,
// repaint invalidation, closing the sim trade) stay with the controller.

import type { WocOfferPhase, WocPendingOffer } from '../../trade_woc_view';

/** The slice of the service's offer row these decisions read. Structural on
 *  purpose: the pure core must not import the REST SDK. */
export interface WocOfferRowLike {
  id: number;
  status: string;
  role: 'buyer' | 'seller';
  buyerName: string;
  sellerName: string;
  usdCents: number;
  listingId: number | null;
  listingStatus?: string | null;
  listingResolution?: string | null;
  settlementState?: string | null;
  expiresAtMs?: number | null;
  buyerAccepted: boolean;
  sellerAccepted: boolean;
}

/**
 * Which face of the deal a server-side offer row is showing.
 *
 * Derived from the listing rather than the offer's own status, because the
 * offer says only "agreed": what decides whether money is still owed is the
 * LISTING, which exists from acceptance and closes when the deal ends.
 *
 * 'settled' requires resolution === 'sold', never bare closed-ness: a listing
 * closes cancelled, suspended, and unpaid too, and treating any close as
 * settled printed "You have received a payment" to a seller whose buyer never
 * paid (H13). Those ends are 'closed'; wocOfferClosedReason names which.
 */
export function wocOfferPhase(
  row: {
    listingId: number | null;
    listingStatus: string | null;
    listingResolution: string | null;
    settlementState?: string | null;
  },
  /** The viewer's own payment is in flight locally. The buyer knows this before
   *  any server round trip, and waiting for the poll to catch up is a visible
   *  gap where their click appears to have done nothing. */
  payingLocally = false,
): WocOfferPhase {
  if (row.listingId === null) return 'review';
  if (row.listingResolution === 'sold') return 'settled';
  if (row.listingStatus === 'closed') return 'closed';
  if (payingLocally || SETTLING_STATES.has(row.settlementState ?? '')) return 'paying';
  return 'awaiting_payment';
}

/**
 * Settlement states that mean money is moving.
 *
 * 'offered' is deliberately ABSENT: a quote exists but nothing has been signed,
 * so the buyer still has to act and their button must stay live. Treating it as
 * in-flight would show a spinner to a player whose next move is to press Pay.
 * 'review' is PRESENT: an operator-parked payment is not settled and not lost,
 * and announcing delivery for it would tell the buyer of money under review
 * that the purchase completed (the custody-lie class the row label rule
 * already covers); the poll finishes the deal when the resolution does.
 * 'delivered' rides too: the copy has moved but the sale's own finalize has
 * not run, and the poll's settled line closes the loop when it does.
 *
 * Exported so the arm's status ladder (trade_woc_view.ts DELIVERING_STATES)
 * can be pinned a SUBSET of this set: a delivering-class sentence only ever
 * renders on the 'paying' face this set decides.
 */
export const WOC_SETTLING_STATES: ReadonlySet<string> = new Set([
  'confirming',
  'confirmed',
  'delivering',
  'delivered',
  'review',
]);
const SETTLING_STATES = WOC_SETTLING_STATES;

/** How a dead deal died, for the honest report line. 'unpaid' covers every
 *  closed-unsold resolution (no_bids / reserve_not_met / unsettled) AND any
 *  future resolution word this bundle predates: the safe reading of an
 *  unknown close is "it did not sell", never a fabricated cause. */
export type WocOfferClosedReason = 'cancelled' | 'suspended' | 'unpaid';

export function wocOfferClosedReason(row: {
  listingStatus: string | null;
  listingResolution: string | null;
}): WocOfferClosedReason | null {
  if (row.listingStatus !== 'closed' || row.listingResolution === 'sold') return null;
  if (row.listingResolution === 'cancelled') return 'cancelled';
  if (row.listingResolution === 'suspended') return 'suspended';
  return 'unpaid';
}

/**
 * The one standing offer between these two players, or undefined.
 *
 * 'accepted' as well as 'pending': the deal is not over when it is agreed,
 * and dropping it at that moment is what made the payment phase unreachable
 * and left both windows with a stale id to press.
 */
export function selectStandingWocOffer<T extends WocOfferRowLike>(
  offers: readonly T[],
  otherName: string,
  finished: ReadonlySet<number>,
): T | undefined {
  return offers.find(
    (o) =>
      (o.status === 'pending' || o.status === 'accepted') &&
      (o.role === 'buyer' ? o.sellerName : o.buyerName) === otherName &&
      // Already reported and closed. The row lingers for a grace window so
      // both sides can see the sale finish; re-adopting it here would reopen
      // the window we just closed and block the next deal.
      !finished.has(o.id),
  );
}

export type WocOfferPollStep =
  | { readonly kind: 'settle' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'keep' }
  | { readonly kind: 'adopt' };

/**
 * What the poll does with the row it found.
 *
 * 'settle': the deal is DONE and gets reported exactly once, then the window
 * has nothing left to offer. 'closed': the deal DIED (cancelled / suspended /
 * unpaid) and the honest reason gets reported exactly once, then the arm
 * returns to the compose form. 'keep': nothing a repaint would show has moved.
 * Compare the wocOfferPhase AND the acceptance flags AND the settlement state, not
 * just the id: one side accepting moves neither the id nor the phase, so an
 * id-and-face check left the button reading "Accept" after the player had
 * already accepted; and a payment moving from confirming to confirmed keeps
 * wocOfferPhase 'paying' while the status sentence it owes the player changes.
 */
export function wocOfferPollStep(
  cur: WocPendingOffer | null,
  mine: WocOfferRowLike,
  phase: WocOfferPhase,
): WocOfferPollStep {
  if (phase === 'settled') return { kind: 'settle' };
  if (phase === 'closed') return { kind: 'closed' };
  if (
    cur?.id === mine.id &&
    cur.phase === phase &&
    cur.buyerAccepted === mine.buyerAccepted &&
    cur.sellerAccepted === mine.sellerAccepted &&
    (cur.settlementState ?? null) === (mine.settlementState ?? null)
  ) {
    return { kind: 'keep' };
  }
  return { kind: 'adopt' };
}

/** The service row projected into the held-offer shape the window repaints
 *  from, with the quoted token figure riding beside the agreed USD price. */
export function adoptedWocOffer(
  mine: WocOfferRowLike,
  phase: WocOfferPhase,
  tokens: number | null,
): WocPendingOffer {
  return {
    id: mine.id,
    usdCents: mine.usdCents,
    tokens,
    role: mine.role,
    phase,
    listingId: mine.listingId,
    buyerAccepted: mine.buyerAccepted,
    sellerAccepted: mine.sellerAccepted,
    expiresAtMs: mine.expiresAtMs ?? null,
    settlementState: mine.settlementState ?? null,
  };
}
