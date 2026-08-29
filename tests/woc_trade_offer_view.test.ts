// The p2p $WOC offer state machine's pure decisions
// (src/ui/hud/woc_trade/woc_trade_offer_view.ts): which server row the open
// trade window adopts, when a repaint is owed, and how the held offer advances
// review -> awaiting_payment -> paying -> settled. These transitions had no
// unit tests while the machine lived on the Hud coordinator; the regressions
// each case names shipped for real (review.md, H7 context).

import { describe, expect, it } from 'vitest';
import {
  adoptedWocOffer,
  selectStandingWocOffer,
  WOC_SETTLING_STATES,
  type WocOfferRowLike,
  wocOfferClosedReason,
  wocOfferPhase,
  wocOfferPollStep,
} from '../src/ui/hud/woc_trade/woc_trade_offer_view';
import { WOC_DELIVERING_STATES, type WocPendingOffer } from '../src/ui/trade_woc_view';

type Row = WocOfferRowLike & {
  listingStatus: string | null;
  listingResolution: string | null;
  settlementState?: string | null;
};

function row(over: Partial<Row> = {}): Row {
  return {
    id: 7,
    status: 'pending',
    role: 'buyer',
    buyerName: 'Aldric',
    sellerName: 'Bree',
    usdCents: 100,
    listingId: null,
    buyerAccepted: false,
    sellerAccepted: false,
    listingStatus: null,
    listingResolution: null,
    ...over,
  };
}

function held(over: Partial<WocPendingOffer> = {}): WocPendingOffer {
  return {
    id: 7,
    usdCents: 100,
    tokens: null,
    role: 'buyer',
    phase: 'review',
    listingId: null,
    buyerAccepted: false,
    sellerAccepted: false,
    ...over,
  };
}

describe('selectStandingWocOffer', () => {
  it('matches the counterparty by role: a buyer looks at sellerName, a seller at buyerName', () => {
    const asBuyer = row({ role: 'buyer', sellerName: 'Bree' });
    expect(selectStandingWocOffer([asBuyer], 'Bree', new Set())).toBe(asBuyer);
    expect(selectStandingWocOffer([asBuyer], 'Aldric', new Set())).toBeUndefined();
    const asSeller = row({ role: 'seller', buyerName: 'Aldric' });
    expect(selectStandingWocOffer([asSeller], 'Aldric', new Set())).toBe(asSeller);
    expect(selectStandingWocOffer([asSeller], 'Bree', new Set())).toBeUndefined();
  });

  it("adopts 'accepted' rows too: the deal is not over when it is agreed", () => {
    // Dropping the offer at agreement made the payment phase unreachable and
    // left both windows holding a stale id to press.
    const agreed = row({ status: 'accepted' });
    expect(selectStandingWocOffer([agreed], 'Bree', new Set())).toBe(agreed);
  });

  it('ignores resolved rows (declined, withdrawn, expired)', () => {
    for (const status of ['declined', 'withdrawn', 'expired']) {
      expect(selectStandingWocOffer([row({ status })], 'Bree', new Set()), status).toBeUndefined();
    }
  });

  it('skips ids already reported finished, so a settled row is never re-adopted', () => {
    // The row lingers server-side for a grace window; re-adopting it reopened
    // the window just closed and blocked the pair from starting a new deal.
    expect(selectStandingWocOffer([row()], 'Bree', new Set([7]))).toBeUndefined();
    const next = row({ id: 8 });
    expect(selectStandingWocOffer([row(), next], 'Bree', new Set([7]))).toBe(next);
  });

  it('two standing rows with the same counterparty: the FIRST wins, by insertion order', () => {
    // find() takes the first match, so the service response ORDER is the
    // tie-break contract; a re-sort upstream would silently change which deal
    // the window adopts.
    const first = row({ id: 11 });
    const second = row({ id: 12 });
    expect(selectStandingWocOffer([first, second], 'Bree', new Set())).toBe(first);
  });
});

describe('wocOfferPollStep', () => {
  it('settled wins over everything: the deal is done whatever is held locally', () => {
    expect(wocOfferPollStep(null, row(), 'settled')).toEqual({ kind: 'settle' });
    expect(wocOfferPollStep(held({ phase: 'paying' }), row(), 'settled')).toEqual({
      kind: 'settle',
    });
  });

  it('keeps the held offer only when id, phase, AND both acceptance flags match', () => {
    expect(wocOfferPollStep(held(), row(), 'review')).toEqual({ kind: 'keep' });
  });

  it('one side accepting forces a repaint even though id and phase are unchanged', () => {
    // The shipped regression: an id-and-phase check left the button reading
    // "Accept" after the player had already accepted, and the other side never
    // learned they were waited on.
    expect(wocOfferPollStep(held(), row({ buyerAccepted: true }), 'review')).toEqual({
      kind: 'adopt',
    });
    expect(wocOfferPollStep(held(), row({ sellerAccepted: true }), 'review')).toEqual({
      kind: 'adopt',
    });
  });

  it('adopts on a phase move, a different offer id, or no held offer at all', () => {
    expect(wocOfferPollStep(held(), row(), 'awaiting_payment')).toEqual({ kind: 'adopt' });
    expect(wocOfferPollStep(held(), row({ id: 8 }), 'review')).toEqual({ kind: 'adopt' });
    expect(wocOfferPollStep(null, row(), 'review')).toEqual({ kind: 'adopt' });
  });
});

describe('adoptedWocOffer', () => {
  it('projects the service row plus the derived phase and the quoted tokens', () => {
    // The two acceptance flags deliberately DIFFER: with both true, swapping
    // the buyerAccepted/sellerAccepted assignments would project cleanly and
    // make a one-sided acceptance adopt forever (the keep comparison reads
    // these fields).
    const mine = row({
      id: 9,
      usdCents: 250,
      role: 'seller',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: false,
    });
    expect(adoptedWocOffer(mine, 'awaiting_payment', 19531.25)).toEqual({
      id: 9,
      usdCents: 250,
      tokens: 19531.25,
      role: 'seller',
      phase: 'awaiting_payment',
      listingId: 41,
      buyerAccepted: true,
      sellerAccepted: false,
      expiresAtMs: null,
      settlementState: null,
    });
  });

  it('carries a missing quote as null rather than inventing a figure', () => {
    expect(adoptedWocOffer(row(), 'review', null).tokens).toBeNull();
  });

  it('carries the expiry and the settlement state when the row names them', () => {
    // The review face renders the expiry, and the paying face's status
    // sentence keys on the settlement state (confirmed is not "confirming").
    const projected = adoptedWocOffer(
      row({ expiresAtMs: 1_800_000_000_000, settlementState: 'confirmed' }),
      'paying',
      null,
    );
    expect(projected.expiresAtMs).toBe(1_800_000_000_000);
    expect(projected.settlementState).toBe('confirmed');
  });
});

describe('the canonical deal walks review -> awaiting_payment -> paying -> settled', () => {
  // Drives wocOfferPhase (the phase derivation the controller feeds this
  // machine) together with the poll decision, so the whole arc is pinned as
  // behavior rather than as source text.
  it('each server-side move advances the held offer exactly once', () => {
    // Offer made: no listing yet, both reviewing.
    let mine = row();
    let phase = wocOfferPhase(mine, false);
    expect(phase).toBe('review');
    expect(wocOfferPollStep(null, mine, phase)).toEqual({ kind: 'adopt' });
    let cur = adoptedWocOffer(mine, phase, 100);
    expect(wocOfferPollStep(cur, mine, phase)).toEqual({ kind: 'keep' });

    // Both agreed and the escrow listing exists: the buyer owes payment.
    mine = row({ status: 'accepted', buyerAccepted: true, sellerAccepted: true, listingId: 41 });
    mine.listingStatus = 'open';
    phase = wocOfferPhase(mine, false);
    expect(phase).toBe('awaiting_payment');
    expect(wocOfferPollStep(cur, mine, phase)).toEqual({ kind: 'adopt' });
    cur = adoptedWocOffer(mine, phase, 100);

    // The buyer pressed Pay: locally in flight before any server round trip.
    phase = wocOfferPhase(mine, true);
    expect(phase).toBe('paying');
    expect(wocOfferPollStep(cur, mine, phase)).toEqual({ kind: 'adopt' });
    cur = adoptedWocOffer(mine, phase, 100);

    // The chain settled the sale: report once and close.
    mine.listingResolution = 'sold';
    phase = wocOfferPhase(mine, false);
    expect(phase).toBe('settled');
    expect(wocOfferPollStep(cur, mine, phase)).toEqual({ kind: 'settle' });
  });

  it("a closed listing is 'settled' ONLY when it sold (the H13 false-payment fix)", () => {
    // The old derivation treated ANY closed listing as settled, so a
    // cancelled directed sale logged "You have received a payment" to the
    // seller. Sold is the one resolution that means money moved.
    const base = {
      listingId: 41,
      listingStatus: 'closed',
      settlementState: null as string | null,
    };
    expect(wocOfferPhase({ ...base, listingResolution: 'sold' })).toBe('settled');
    for (const resolution of ['cancelled', 'suspended', 'unsettled', 'no_bids', null]) {
      expect(wocOfferPhase({ ...base, listingResolution: resolution }), String(resolution)).toBe(
        'closed',
      );
    }
  });

  it('names WHY a dead deal died, and unknown resolutions read as unpaid, never invented', () => {
    const closed = (listingResolution: string | null) =>
      wocOfferClosedReason({ listingStatus: 'closed', listingResolution });
    expect(closed('cancelled')).toBe('cancelled');
    expect(closed('suspended')).toBe('suspended');
    for (const r of ['unsettled', 'no_bids', 'reserve_not_met', null, 'future_word']) {
      expect(closed(r), String(r)).toBe('unpaid');
    }
    // Not closed, or sold: nothing to explain.
    expect(wocOfferClosedReason({ listingStatus: 'active', listingResolution: null })).toBeNull();
    expect(wocOfferClosedReason({ listingStatus: 'closed', listingResolution: 'sold' })).toBeNull();
  });

  it("the poll answers 'closed' for a dead deal, decisively over any held state", () => {
    const dead = row({ listingId: 41, listingStatus: 'closed', listingResolution: 'cancelled' });
    expect(wocOfferPollStep(null, dead, wocOfferPhase(dead))).toEqual({ kind: 'closed' });
    expect(wocOfferPollStep(held({ phase: 'paying' }), dead, wocOfferPhase(dead))).toEqual({
      kind: 'closed',
    });
  });

  it('a settlement-state move alone forces a repaint (confirming -> confirmed)', () => {
    // wocOfferPhase stays 'paying' across the move, but the status sentence the
    // player reads changes; an id-face-flags comparison kept the stale
    // "confirming on the network" through the whole delivery.
    const mine = row({
      status: 'accepted',
      buyerAccepted: true,
      sellerAccepted: true,
      listingId: 41,
      listingStatus: 'open',
      settlementState: 'confirmed',
    });
    const heldConfirming = adoptedWocOffer(
      { ...mine, settlementState: 'confirming' },
      'paying',
      null,
    );
    expect(wocOfferPollStep(heldConfirming, mine, 'paying')).toEqual({ kind: 'adopt' });
    expect(wocOfferPollStep(adoptedWocOffer(mine, 'paying', null), mine, 'paying')).toEqual({
      kind: 'keep',
    });
  });

  it("the row's settlementState alone reads as paying: the seller has no local click", () => {
    // payingLocally covers only the buyer's own Pay press; the seller (and a
    // buyer whose client rejoined mid-settlement) reaches 'paying' through the
    // SETTLING_STATES arm. 'offered' stays awaiting_payment on purpose: a
    // quote nobody signed still needs the Pay button live.
    const mine = row({
      status: 'accepted',
      buyerAccepted: true,
      sellerAccepted: true,
      listingId: 41,
      listingStatus: 'open',
    });
    for (const state of ['confirming', 'confirmed', 'delivering']) {
      expect(wocOfferPhase({ ...mine, settlementState: state }, false), state).toBe('paying');
    }
    expect(wocOfferPhase({ ...mine, settlementState: 'offered' }, false)).toBe('awaiting_payment');
  });
});

describe('the two settlement-state vocabularies stay nested', () => {
  it('every delivering-class state is a settling state, or its sentence could never render', () => {
    // trade_woc_view.ts picks the delivering sentence only on the 'paying'
    // face, and 'paying' is decided by WOC_SETTLING_STATES here: a state added
    // to one literal but not the other silently loses its sentence.
    for (const state of WOC_DELIVERING_STATES) {
      expect(WOC_SETTLING_STATES.has(state), state).toBe(true);
    }
    // And the settling set alone decides 'paying' off the wire (no local click).
    expect(WOC_SETTLING_STATES.has('offered'), 'a bare quote is not a payment').toBe(false);
    expect(WOC_SETTLING_STATES.has('review'), 'parked money is still in flight').toBe(true);
    expect(WOC_SETTLING_STATES.has('delivered')).toBe(true);
  });
});

describe('wocOfferPhase (the direct pins, moved beside the module they test)', () => {
  it('derives wocOfferPhase from the LISTING, not the offer status', () => {
    // The offer says only "agreed"; what decides whether money is still owed is
    // the listing, which exists from acceptance and closes when the deal ends
    // (sold, cancelled, suspended, or unpaid: the H13 fix splits those).
    expect(wocOfferPhase({ listingId: null, listingStatus: null, listingResolution: null })).toBe(
      'review',
    );
    expect(wocOfferPhase({ listingId: 41, listingStatus: 'active', listingResolution: null })).toBe(
      'awaiting_payment',
    );
    expect(
      wocOfferPhase({ listingId: 41, listingStatus: 'closed', listingResolution: 'sold' }),
    ).toBe('settled');
  });

  it('reports a payment IN FLIGHT, so a wait is distinguishable from an absence', () => {
    // The shipped gap: from acceptance until the item vanished, the seller saw
    // one unchanging "waiting" face whether the buyer was signing in their
    // wallet or had walked away. The settlement state is what separates them.
    const live = { listingId: 41, listingStatus: 'active', listingResolution: null };
    for (const state of ['confirming', 'confirmed', 'delivering']) {
      expect(wocOfferPhase({ ...live, settlementState: state }), state).toBe('paying');
    }
  });

  it("does NOT spin on 'offered': the buyer still has to press Pay", () => {
    // A quote exists but nothing is signed. Showing progress here would put a
    // spinner in front of a player whose next move is to act, which is the
    // opposite of what the indicator means.
    expect(
      wocOfferPhase({
        listingId: 41,
        listingStatus: 'active',
        listingResolution: null,
        settlementState: 'offered',
      }),
    ).toBe('awaiting_payment');
  });

  it('lets the BUYER see their own payment before the server confirms it', () => {
    // The wallet takes over the screen; coming back to a live-looking Pay button
    // is what made a successful payment read as a click that did nothing. The
    // local flag closes that gap without waiting for a poll.
    const live = { listingId: 41, listingStatus: 'active', listingResolution: null };
    expect(wocOfferPhase(live, true)).toBe('paying');
    expect(wocOfferPhase(live, false)).toBe('awaiting_payment');
  });

  it('a CLOSED listing outranks any in-flight settlement state', () => {
    // Delivery is the last word. A stale 'delivering' row alongside a closed
    // listing must not strand both windows on a spinner that never resolves.
    expect(
      wocOfferPhase({
        listingId: 41,
        listingStatus: 'closed',
        listingResolution: 'sold',
        settlementState: 'delivering',
      }),
    ).toBe('settled');
  });

  it('treats an operator-parked review payment as still in flight, never settled', () => {
    // A review-parked settlement is neither settled nor lost; the offer face
    // must stay 'paying' (the pending face), not fall to awaiting_payment
    // with a live Pay control under money an operator is deciding. Pinned
    // through the REAL consumer (wocOfferPhase over SETTLING_STATES; the old
    // wocSettlementInFlight wrapper had no production caller and is gone).
    const row = { listingId: 41, listingStatus: 'settling', listingResolution: null };
    expect(wocOfferPhase({ ...row, settlementState: 'review' })).toBe('paying');
    expect(wocOfferPhase({ ...row, settlementState: 'confirming' })).toBe('paying');
    // A DELIVERED settlement whose sale has not finalized is decided money
    // (the copy has moved): still the pending face, never a live Pay button
    // over a purchase already made.
    expect(wocOfferPhase({ ...row, settlementState: 'delivered' })).toBe('paying');
    expect(wocOfferPhase({ ...row, settlementState: 'offered' })).toBe('awaiting_payment');
    expect(wocOfferPhase({ ...row, settlementState: null })).toBe('awaiting_payment');
  });
});
