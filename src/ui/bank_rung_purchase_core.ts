// The banker's Claudium rung purchase: the money state machine, and nothing
// else.
//
// RULING 30, and this module is only the half of the flow that answers the
// deciding question (src/ui/CLAUDE.md: does this code need the coordinator's
// private mutable state?) with NO. What moved here is what needs rung state and
// an injected hook; what stayed in src/ui/bank_window.ts is everything that
// needs the window itself: the modal confirm prompt and its focus capture, the
// live-DOM busy write, the live-region announcement, the repaint, the top-up
// handoff's `opened` guard, and the two markup builders that read this state at
// build time. Every host effect below arrives as a closure, which is what keeps
// the whole state machine drivable by a Vitest with no browser at all.
//
// WHY A REGISTERED PURE CORE, since the tempting reason is the wrong one. The
// `_core` name is not here to fall outside the painter gate's filename sweep:
// escaping a gate is the definition of leaving a guard covering less, and
// tests/hud_perf_budget.test.ts names that as the anti-pattern in its own
// header. It is here for the opposite reasons. The name puts this file inside
// architecture.test.ts's COMPLETENESS sweep, so a forgotten registration FAILS
// rather than silently escaping the purity and determinism scans; and the
// determinism scan is load-bearing on this path in particular, because a clock
// or an rng draw inside a purchase state machine is exactly what mints a second
// key. The painter gate loses nothing: this module makes no layout read and
// owns no driver, since the busy write, the announcement and its queueMicrotask
// all stayed in the window with its counted allowance.
//
// THE MONEY CONTRACT IT ENFORCES, restated here because this is now where it
// lives. ONE idempotency key per open purchase INTENT, held across every retry
// until an authoritative result proves where the money ended up. A rung SKU is a
// REPEATABLE storage spend that writes no grant row, so the economy service
// dedupes on this key ALONE and a retry under a fresh key is a SECOND REAL
// CHARGE. The ledger also FREEZES the declared cost with the key, which is the
// other half: the server compares a four-field identity (account, character,
// item, expectedCostClaudium) against the prior row BEFORE it branches on that
// row's status, so a retry carrying a refreshed price gets a definitive-looking
// already_granted while the original may still be pending behind a live debit.
// src/ui/store_purchase_intent.ts carries the whole argument; nothing here
// re-derives any of it.
//
// THE SENT LATCH AND THE LEDGER'S `restored` SET ARE A PAIR, and they are a pair
// in ONE module on purpose. `sent` below answers the IN-PAGE half ("this key has
// already reached the service"); the ledger's own `restored` set answers the
// CROSS-PAGE half, because this latch dies with the page and the durable record
// does not. Every abandon in this flow consults both, in that order, through the
// one method below. A second abandon door that consulted only one of them would
// re-open the exact second-charge path phase 16 closed.

import { type BankRungNotice, planBankRungRefusal } from './bank_rung_view';
import type { BankBuySlotsModel } from './bank_view';
import type { StoreSpendResult } from './claudium_purchase_bridge';
import type { PurchaseIntent, PurchaseIntentLedger } from './store_purchase_intent';

/** The host, entirely as closures.
 *
 *  The LEDGER arrives from outside rather than being constructed here, and that
 *  is deliberate three times over: `durableIntents(() => this.deps.world())`
 *  stays spelled in src/ui/bank_window.ts, where
 *  tests/woc_store_window_contract.test.ts's ruling-19 pin already reads for it
 *  and where it keeps meaning what it says; this module stays clean of
 *  src/ui/purchase_intent_durability.ts, which reaches localStorage; and a test
 *  drives the whole flow against a fake ledger with no storage and no clock. */
export interface BankRungPurchaseDeps {
  /** The durable purchase-intent ledger, shared with the store's charter flow. */
  intents: PurchaseIntentLedger;
  /** The Claudium spend, or `undefined` when no hooks are attached at all. The
   *  window supplies the storage KIND, so the one wire literal stays at the one
   *  call site a source pin can still read. */
  spend(skuId: string, costClaudium: number, key: string): Promise<StoreSpendResult> | undefined;
  /** Is the bank window still open. A spend outcome can land after the player
   *  closed the bank (or walked away from the banker, which grace-closes it). */
  isOpen(): boolean;
  /** Mark the buy button busy on the LIVE element for the span of one spend. */
  setBusy(busy: boolean): void;
  /** Repaint, announce the result, and hand focus back to the pressed control. */
  repaint(): void;
  /** The buy sub-model rebuilt from the live mirror, so a price-changed
   *  re-prompt quotes what the wire says NOW rather than anything cached. */
  currentOffer(): BankBuySlotsModel | null;
  /** Re-open the confirm prompt at a refreshed price. */
  reprompt(buy: BankBuySlotsModel): void;
  /** Hand off to the Claudium top-up window and come back. */
  needMoreClaudium(blockSlots: number, cost: number, balance: number | null): void;
  /** The coin sound a completed purchase plays. */
  coin(): void;
}

export class BankRungPurchase {
  // The rung SKU whose open intent has actually reached the service. It gates
  // the cancel path: once a spend HAS been sent under a key, an ambiguous
  // outcome may be hiding a live debit, so the key must outlive the cancel.
  private readonly sent = new Set<string>();
  // The SKU currently on the wire, or null. Read at MARKUP-BUILD time by the
  // window (never written onto a live element), so a repaint landing mid-spend
  // rebuilds the button busy rather than handing the player an enabled button
  // for a purchase already in flight.
  private inFlight: string | null = null;
  // The purchase-result band.
  private band: BankRungNotice | null = null;
  // THE OPEN ATTEMPT, with a stated lifetime, which is the point of giving it an
  // owner rather than leaving it a pair of loose flags (the StoreFocusStash
  // precedent in src/ui/store_focus_policy.ts, minted for exactly this class of
  // bug one window over).
  //
  // ARMED by armPrompt when a confirm prompt opens, carrying the SKU the prompt
  // is for (null for a gold-only prompt, which has no intent to lose).
  // SPENT by either confirm arm.
  // DROPPED by endPrompt, from EVERY path that ends the prompt without a
  // confirm: the prompt's own dismiss hook, and the window's family teardown,
  // which the dismiss hook never sees because dismissBankPrompts removes the
  // node directly. One method for both, so there is never a second abandon
  // decision to keep in step with the first.
  private promptSku: string | null = null;
  // Latched by either confirm arm so endPrompt can tell an abandonment from a
  // completion: only an abandonment drops an unsent intent.
  private promptConfirmed = false;
  // The automatic price-changed re-prompt is capped at ONE per window open. The
  // moved-price guard already stops the same-price loop, but a price that
  // oscillates between two values across retries would satisfy it every time
  // and keep reopening a prompt the player did not ask for, which is the
  // repeating-prompt shape DESIGN.md bans. After the cap the refreshed price is
  // still on the button; the next attempt is just the player's own click.
  private repromptedThisOpen = false;

  constructor(private readonly deps: BankRungPurchaseDeps) {}

  /** The result band to paint, or null. The window reads it at markup-build time
   *  and when it writes the live region. */
  get notice(): BankRungNotice | null {
    return this.band;
  }

  /** Is this SKU's spend on the wire right now. */
  isInFlight(skuId: string): boolean {
    return this.inFlight === skuId;
  }

  /** The open intent for this SKU, minting one (and freezing its cost) on first
   *  use. A later call returns the STORED intent and IGNORES the cost argument,
   *  which is what holds the key and its declared cost together for every retry. */
  intentFor(skuId: string, costClaudium: number): PurchaseIntent {
    return this.deps.intents.intentFor(skuId, costClaudium);
  }

  /** A confirm prompt is opening for `skuId` (null for a gold-only prompt, which
   *  has no Claudium intent beside it). Nothing is confirmed yet. */
  armPrompt(skuId: string | null): void {
    this.promptSku = skuId;
    this.promptConfirmed = false;
  }

  /** The GOLD rail was taken. Buying with gold abandons the Claudium intent this
   *  prompt minted, while it is still unsent: otherwise it survives with its cost
   *  FROZEN and a later Claudium attempt replays that stale price and is refused.
   *  A RESTORED key is the exception, and the LEDGER enforces it, so that outcome
   *  is real there rather than re-decided here. */
  confirmWithGold(skuId: string | null): void {
    this.promptConfirmed = true;
    if (skuId !== null) this.abandonIfUnsent(skuId);
  }

  /** The CLAUDIUM rail was taken. The spend itself follows. */
  confirmWithClaudium(): void {
    this.promptConfirmed = true;
  }

  /** The prompt ENDED, by any path. Returns whether it ABANDONED an intent, which
   *  is the one outcome the window acts on (it drops the focus stash only then).
   *
   *  Only an ABANDONMENT drops the intent, and only while it has never reached
   *  the service: once a spend has been sent under the key an ambiguous outcome
   *  may be hiding a live debit, so the key must outlive the cancel and let the
   *  next attempt replay under it.
   *
   *  THE TEARDOWN PATH IS WHY THIS TAKES NO ARGUMENT. `dismissBankPrompts()`
   *  removes the prompt NODE, so `showBuyConfirmPrompt`'s own dismiss hook never
   *  runs on that path, and the window's render() takes it whenever the repaint
   *  signature moves with a prompt open. The lexically captured SKU the dismiss
   *  hook used to pass is not available there; the armed attempt is. */
  endPrompt(): boolean {
    const skuId = this.promptSku;
    const confirmed = this.promptConfirmed;
    // BOTH fields, or the attempt is only half dropped and its two halves end up
    // bounded by two different rules. Clearing promptSku alone left the confirm
    // latch TRUE until the next armPrompt happened to reset it, which is safe
    // today only because every path that arms one arms the other. The review
    // round caught it as the second instance of the bound-by-coincidence shape
    // this module was extracted to end; a second confirm surface, or a reprompt
    // that reused an open prompt node, would inherit the stale latch and silently
    // decline to abandon a never-sent, cost-frozen intent.
    //
    // EQUIVALENT-MUTANT NOTE, because that safety has a consequence for the
    // tests: removing the latch clear kills no arm, and that is recorded rather
    // than papered over with an arm that re-arms the prompt in between and
    // proves only that armPrompt works. It is defence in depth for the day the
    // second arm site above exists.
    //
    // Idempotent: every caller may run it unconditionally, and the window's
    // close() does exactly that.
    this.promptSku = null;
    this.promptConfirmed = false;
    if (confirmed || skuId === null) return false;
    if (this.sent.has(skuId)) return false;
    this.deps.intents.abandon(skuId);
    return true;
  }

  /** Drop an intent that has never reached the service. The IN-PAGE half of the
   *  pair; `abandon` then applies the CROSS-PAGE half (a restored key keeps its
   *  durable record, because nothing on this side can tell a restored-and-sent
   *  key from a restored-but-never-sent one). */
  private abandonIfUnsent(skuId: string): void {
    if (this.sent.has(skuId)) return;
    this.deps.intents.abandon(skuId);
  }

  /** Buy the character's next unpurchased rung with Claudium, through the phase
   *  11 server flow. The client never grants a slot: it sends a spend under the
   *  intent's frozen cost and key, and every visible change after that comes
   *  from an authoritative answer (this result, or the owner-only bank snapshot
   *  the slow band repaints from). */
  async spend(
    skuId: string,
    /** The intent minted when the confirm prompt opened. Its cost is FROZEN and
     *  its key is held across every retry: see this module's header for the
     *  second-charge path a refreshed cost or a fresh key opens. */
    intent: PurchaseIntent,
    blockSlots: number,
  ): Promise<void> {
    if (this.inFlight !== null) return;
    // Only NOW has the key reached the service, so only now must a cancel stop
    // dropping it.
    this.sent.add(skuId);
    this.band = null;
    this.inFlight = skuId;
    this.deps.setBusy(true);
    let result: StoreSpendResult | undefined;
    try {
      result = await this.deps.spend(skuId, intent.costClaudium, intent.key);
    } finally {
      // Released BEFORE anything repaints, so the rebuilt button comes back
      // enabled rather than inheriting a stale busy state from the markup.
      this.inFlight = null;
      this.deps.setBusy(false);
    }
    if (!result) {
      // No hook at all is indistinguishable from a lost reply: leave the intent
      // OPEN so the next attempt replays under the same key.
      this.setNotice({ granted: false, reason: null });
      this.deps.repaint();
      return;
    }
    // EVERY authoritative result goes to the ledger UNCLASSIFIED: which refusals
    // close an intent and which retain the key is store_purchase_intent.ts's
    // decision alone, and a second classifier here would silently drift from it
    // (purchase_in_progress and no_live_character both LOOK definitive and are
    // not).
    this.deps.intents.settle(skuId, { granted: result.granted, reason: result.reason });
    if (!this.deps.intents.isOpen(skuId)) this.sent.delete(skuId);
    // granted FIRST, then reason: 'already_granted' means OPPOSITE things on the
    // two arms, and every granted-true arm is a real purchase whose money moved.
    if (result.granted) {
      this.deps.coin();
      this.setNotice({ granted: true, reason: result.reason });
      // NOTHING is applied client-side. The slots arrive on the owner-only bank
      // snapshot and the window's slow band repaints the meter and the buy row
      // from that; painting them here would be optimistic state the server never
      // confirmed.
      this.deps.repaint();
      return;
    }
    this.refuse(intent.costClaudium, blockSlots, result);
  }

  /** The granted-false half of the result contract: a thin consumer of
   *  planBankRungRefusal (bank_rung_view.ts), which owns every DECISION here.
   *  This keeps only the side effects and the state they touch. */
  private refuse(
    /** The cost actually SENT (the intent's frozen one), which is what the
     *  service judged and therefore what a refreshed price is compared against. */
    sentCost: number,
    blockSlots: number,
    result: StoreSpendResult,
  ): void {
    // Re-read the wire only on the arm that can use it: price_changed is a
    // definitive refusal, so the ledger has already closed this intent and a
    // re-confirm mints a fresh key at whatever the wire says NOW.
    const fresh = result.reason === 'price_changed' ? this.deps.currentOffer() : null;
    const plan = planBankRungRefusal({
      reason: result.reason,
      sentCost,
      serviceCost: result.costClaudium,
      reprompted: this.repromptedThisOpen,
      freshCost: fresh?.claudium?.cost ?? null,
    });
    this.setNotice(plan.notice);
    this.deps.repaint();
    if (plan.reprompt && fresh) {
      this.repromptedThisOpen = true;
      this.deps.reprompt(fresh);
      return;
    }
    if (plan.topUpCost !== null) {
      this.deps.needMoreClaudium(blockSlots, plan.topUpCost, result.balance);
    }
  }

  /** Record the result band. STATE ONLY: the announcement is made by the
   *  window's repaint, which every caller of this runs immediately afterwards.
   *  Splitting them is load-bearing rather than tidy, because the repaint
   *  REPLACES the live region: announcing here would write into the node the
   *  rebuild is about to throw away, and the fresh one would arrive carrying
   *  its text, which is the shape that is never announced at all. */
  private setNotice(notice: BankRungNotice | null): void {
    // A spend outcome can land after the player closed the bank (or walked away
    // from the banker, which grace-closes it). close() cleared the band, so
    // re-arming it here would paint a stale result on the NEXT open, attached to
    // nothing the player just did.
    if (!this.deps.isOpen()) return;
    this.band = notice;
  }

  /** Drop the result band, UNCONDITIONALLY. Deliberately not setNotice(null):
   *  that one refuses to write while the window is closed, and this is the close
   *  itself. One boolean answering both rules is how a caller ends up applying
   *  the wrong one. */
  clearNotice(): void {
    this.band = null;
  }

  /** Reset the one-per-open automatic re-prompt cap. Called on the way IN as well
   *  as OUT: close() alone leaves a refusal that resolved after the close holding
   *  the next open's cap. */
  resetRepromptCap(): void {
    this.repromptedThisOpen = false;
  }
}
