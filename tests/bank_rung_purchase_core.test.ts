// The banker's rung purchase state machine, driven directly.
//
// This file exists because the extraction (Bank Storage phase 17, ruling 30)
// made it possible. Every claim below is about ORDER or about state a spend
// leaves behind, and inside src/ui/bank_window.ts none of them could be written:
// reaching them meant driving a whole DOM purchase, and the ones that matter
// most (the sent latch landing BEFORE the await, the in-flight release surviving
// a REJECTED hook, the re-entrancy guard not clearing the first attempt's state)
// have no visible surface at all. tests/bank_rung_purchase.test.ts still owns the
// window-level behaviour and is unchanged by the move, which is what says the
// move was a move.
//
// No DOM, no clock, no storage: the controller takes its whole host as closures.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BankRungPurchase, type BankRungPurchaseDeps } from '../src/ui/bank_rung_purchase_core';
import type { StoreSpendResult } from '../src/ui/claudium_purchase_bridge';
import {
  createPurchaseIntentLedger,
  type PurchaseIntent,
  type PurchaseIntentDurablePort,
  type PurchaseIntentLedger,
} from '../src/ui/store_purchase_intent';

const SKU = 'strongbox_rung_01';
const COST = 100;
const BLOCK = 6;

function spendResult(over: Partial<StoreSpendResult> = {}): StoreSpendResult {
  return { granted: true, balance: 900, costClaudium: COST, reason: null, ...over };
}

interface Rig {
  purchase: BankRungPurchase;
  /** Every effect in the order it happened, which is what the ordering arms read. */
  log: string[];
  ledger: PurchaseIntentLedger;
  /** Queued spend answers, one per call, in order. */
  results: StoreSpendResult[];
  /** Set to reject the next spend instead of answering it. */
  rejectNext: boolean;
  /** Resolve the pending spend by hand when `hold` is on. */
  release: (() => void) | null;
  hold: boolean;
  spends: { skuId: string; cost: number; key: string }[];
  offers: { claudium?: { cost: number; skuId: string }; nextCost: number | null }[];
  open: boolean;
  noHook: boolean;
  reprompts: unknown[];
  topUps: { blockSlots: number; cost: number; balance: number | null }[];
}

function rig(opts: { ledger?: PurchaseIntentLedger; freshCost?: number | null } = {}): Rig {
  const state = {
    log: [] as string[],
    results: [] as StoreSpendResult[],
    rejectNext: false,
    release: null as (() => void) | null,
    hold: false,
    spends: [] as { skuId: string; cost: number; key: string }[],
    offers: [] as { claudium?: { cost: number; skuId: string }; nextCost: number | null }[],
    open: true,
    noHook: false,
    reprompts: [] as unknown[],
    topUps: [] as { blockSlots: number; cost: number; balance: number | null }[],
  };
  let keySeq = 0;
  const ledger = opts.ledger ?? createPurchaseIntentLedger(() => `key-${++keySeq}`);
  const deps: BankRungPurchaseDeps = {
    intents: ledger,
    spend: (skuId, cost, key) => {
      state.log.push(`spend:${skuId}:${cost}:${key}`);
      state.spends.push({ skuId, cost, key });
      if (state.noHook) return undefined;
      if (state.rejectNext) {
        state.rejectNext = false;
        return Promise.reject(new Error('transport'));
      }
      const answer = state.results.shift() ?? spendResult();
      if (!state.hold) return Promise.resolve(answer);
      return new Promise<StoreSpendResult>((resolve) => {
        state.release = () => resolve(answer);
      });
    },
    isOpen: () => state.open,
    setBusy: (busy) => state.log.push(`busy:${busy}`),
    repaint: () => state.log.push('repaint'),
    currentOffer: () => {
      state.log.push('currentOffer');
      const fresh = opts.freshCost;
      if (fresh === undefined || fresh === null)
        return { nextCost: 500, blockSlots: BLOCK, maxed: false };
      return {
        nextCost: 500,
        blockSlots: BLOCK,
        maxed: false,
        claudium: { cost: fresh, skuId: SKU },
      };
    },
    reprompt: (buy) => {
      state.log.push('reprompt');
      state.reprompts.push(buy);
    },
    needMoreClaudium: (blockSlots, cost, balance) => {
      state.log.push(`topUp:${cost}`);
      state.topUps.push({ blockSlots, cost, balance });
    },
    coin: () => state.log.push('coin'),
  };
  // Object.assign, NOT a spread: a spread COPIES the primitive flags, so setting
  // `r.hold` on the returned object would leave the closure reading the original
  // `false` and four arms would drive the wrong path while looking green about
  // something else.
  return Object.assign(state, { purchase: new BankRungPurchase(deps), ledger }) as unknown as Rig;
}

/** A ledger over a fake durable row, so the restored-key half of the sent/restored
 *  pair can be driven. `seed` is what a PREVIOUS page left behind. */
function durableRig(seed: PurchaseIntent | null): {
  ledger: PurchaseIntentLedger;
  port: PurchaseIntentDurablePort;
  dropped: string[];
  saved: string[];
} {
  const row = new Map<string, PurchaseIntent>();
  if (seed) row.set(SKU, seed);
  const dropped: string[] = [];
  const saved: string[] = [];
  const port: PurchaseIntentDurablePort = {
    load: (itemId) => row.get(itemId) ?? null,
    save: (itemId, intent) => {
      saved.push(itemId);
      row.set(itemId, intent);
    },
    drop: (itemId) => {
      dropped.push(itemId);
      row.delete(itemId);
    },
  };
  let n = 0;
  return { ledger: createPurchaseIntentLedger(() => `fresh-${++n}`, port), port, dropped, saved };
}

describe('the sent latch lands BEFORE the await, which is what a racing cancel reads', () => {
  it('a cancel arriving while the spend is on the wire does NOT drop the key', async () => {
    // The ordering claim nothing pinned before the extraction: if the latch were
    // set after the await, a cancel during the round trip would abandon a key that
    // may already be sitting behind a live debit, and the next click would mint a
    // fresh one over it. There is no visible surface for this, which is exactly
    // why it needed a controller to test.
    const r = rig();
    r.hold = true;
    const intent = r.purchase.intentFor(SKU, COST);
    r.purchase.armPrompt(SKU);
    r.purchase.confirmWithClaudium();
    const inflight = r.purchase.spend(SKU, intent, BLOCK);
    // Mid-flight. A prompt torn down here reports NO abandonment.
    r.purchase.armPrompt(SKU);
    expect(r.purchase.endPrompt()).toBe(false);
    expect(r.ledger.isOpen(SKU)).toBe(true);
    r.release?.();
    await inflight;
    expect(r.spends).toHaveLength(1);
  });

  it('the busy write brackets the spend, and the release precedes every repaint', async () => {
    const r = rig();
    const intent = r.purchase.intentFor(SKU, COST);
    await r.purchase.spend(SKU, intent, BLOCK);
    // Released BEFORE anything repaints, so the rebuilt button comes back enabled
    // rather than inheriting a stale busy state from the markup.
    expect(r.log.indexOf('busy:true')).toBeLessThan(r.log.indexOf(`spend:${SKU}:${COST}:key-1`));
    expect(r.log.indexOf('busy:false')).toBeLessThan(r.log.indexOf('repaint'));
    expect(r.log.filter((l) => l === 'busy:false')).toHaveLength(1);
  });
});

describe('the in-flight guard, including the path no arm had ever taken', () => {
  it('a REJECTED spend still releases the in-flight SKU and the busy button', async () => {
    // The hook awaits the network client, so a transport throw reaches here as a
    // rejection rather than a result. Nothing had ever driven that: the finally is
    // what stops the button staying disabled for the rest of the visit.
    const r = rig();
    r.rejectNext = true;
    const intent = r.purchase.intentFor(SKU, COST);
    await expect(r.purchase.spend(SKU, intent, BLOCK)).rejects.toThrow('transport');
    expect(r.purchase.isInFlight(SKU)).toBe(false);
    expect(r.log.filter((l) => l === 'busy:false')).toHaveLength(1);
    // The intent is RETAINED, which is the safe direction: a rejection says
    // nothing about whether the debit landed.
    expect(r.ledger.isOpen(SKU)).toBe(true);
    // And a later attempt is not blocked by the released guard.
    const again = r.purchase.intentFor(SKU, COST);
    await r.purchase.spend(SKU, again, BLOCK);
    expect(r.spends).toHaveLength(2);
  });

  it('a rejected spend paints NO result band, which is a recorded residual not a rule', async () => {
    // Its own arm on purpose. Asserting it inside the in-flight-release arm above
    // made a RESIDUAL read as a requirement: the obvious fix for it (give a
    // rejection a band and a repaint, as every other outcome gets) would have
    // redded an arm whose title is about the busy button. Here the title says what
    // the assertion is, so whoever closes the residual knows this is the arm to
    // re-point. The cause is structural and pre-existing, moved verbatim: the
    // notice/repaint pair sits BELOW the await, so a throw leaves through the
    // finally without reaching it, and the network hook cannot reject.
    const r = rig();
    r.rejectNext = true;
    await expect(r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK)).rejects.toThrow(
      'transport',
    );
    expect(r.log).not.toContain('repaint');
    expect(r.purchase.notice).toBeNull();
  });

  it('a second spend while one is in flight is refused WITHOUT touching the first', async () => {
    // The re-entrancy guard returns before any state write. A guard placed one
    // line lower would clear the first attempt's in-flight SKU and its band.
    const r = rig();
    r.hold = true;
    const intent = r.purchase.intentFor(SKU, COST);
    const first = r.purchase.spend(SKU, intent, BLOCK);
    await r.purchase.spend(SKU, intent, BLOCK);
    expect(r.spends).toHaveLength(1);
    expect(r.purchase.isInFlight(SKU)).toBe(true);
    expect(r.log.filter((l) => l === 'busy:false')).toHaveLength(0);
    // The BUSY half, which the first version of this arm could not see: the guard
    // sits ABOVE deps.setBusy(true), so a refused re-entry logs no second busy
    // write. Without this, a guard moved one line below setBusy survives the arm,
    // and the released spend's single busy:false would then leave the live button
    // disabled with no second release to come.
    expect(r.log.filter((l) => l === 'busy:true')).toHaveLength(1);
    r.release?.();
    await first;
    expect(r.purchase.isInFlight(SKU)).toBe(false);
  });

  it('the guard returns above the SENT latch, so a refused re-entry marks no key sent', async () => {
    // The other half of "before any state write", and the one that reaches money:
    // `sent` is what stops an abandon dropping a key the service may already hold.
    // A guard moved below `this.sent.add(skuId)` would latch a SKU whose spend was
    // never made, and that SKU's next cancel would then keep a cost-frozen intent
    // it should have dropped. Read off the narrowest observable there is:
    // endPrompt only reports an abandonment for a key the latch does not hold.
    const r = rig();
    r.hold = true;
    const other = 'strongbox_rung_02';
    const first = r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    await r.purchase.spend(other, r.purchase.intentFor(other, COST), BLOCK);
    expect(r.spends).toHaveLength(1);
    r.purchase.armPrompt(other);
    expect(r.purchase.endPrompt(), 'the refused SKU was never latched as sent').toBe(true);
    r.release?.();
    await first;
  });

  it('isInFlight answers for the SKU, not for "anything is in flight"', async () => {
    const r = rig();
    r.hold = true;
    const intent = r.purchase.intentFor(SKU, COST);
    const p = r.purchase.spend(SKU, intent, BLOCK);
    expect(r.purchase.isInFlight(SKU)).toBe(true);
    expect(r.purchase.isInFlight('strongbox_rung_02')).toBe(false);
    r.release?.();
    await p;
  });
});

describe('the result contract: what settles, what is announced, and what plays a coin', () => {
  it('the intent is settled UNCLASSIFIED, and the sent latch is released only when it closed', async () => {
    const r = rig();
    r.results.push(spendResult({ granted: true }));
    const intent = r.purchase.intentFor(SKU, COST);
    await r.purchase.spend(SKU, intent, BLOCK);
    expect(r.ledger.isOpen(SKU)).toBe(false);
    // Latch released: a fresh attempt is abandonable again.
    r.purchase.armPrompt(SKU);
    const fresh = r.purchase.intentFor(SKU, COST);
    expect(fresh.key).not.toBe(intent.key);
    expect(r.purchase.endPrompt()).toBe(true);
  });

  it('an AMBIGUOUS refusal keeps the key AND keeps the latch, so a later cancel cannot drop it', async () => {
    // 'unavailable' is not in DEFINITIVE_SPEND_REFUSALS, so the ledger keeps the
    // intent. The latch must be kept in step, or the very next dismiss abandons a
    // key that may be sitting behind a live debit.
    const r = rig();
    r.results.push(spendResult({ granted: false, reason: 'unavailable' }));
    const intent = r.purchase.intentFor(SKU, COST);
    await r.purchase.spend(SKU, intent, BLOCK);
    expect(r.ledger.isOpen(SKU)).toBe(true);
    r.purchase.armPrompt(SKU);
    expect(r.purchase.endPrompt()).toBe(false);
    expect(r.ledger.isOpen(SKU)).toBe(true);
    // The retry replays under the SAME key.
    const retry = r.purchase.intentFor(SKU, 999);
    expect(retry.key).toBe(intent.key);
    expect(retry.costClaudium).toBe(COST);
  });

  it('the coin plays on a GRANTED spend and on no refusal', async () => {
    const granted = rig();
    await granted.purchase.spend(SKU, granted.purchase.intentFor(SKU, COST), BLOCK);
    expect(granted.log).toContain('coin');

    // EVERY refusal, not one of them. The title says "no refusal", and the three
    // reasons that carry their own SIDE EFFECTS (price_changed re-prompts,
    // insufficient_balance hands off to the top-up window, unavailable retains the
    // key) are exactly the branches a stray coin could ride out on: each one
    // reaches refuse() and leaves through a different door.
    for (const reason of [
      'does_not_fit',
      'price_changed',
      'insufficient_balance',
      'unavailable',
      'already_granted',
      'purchase_in_progress',
    ] as const) {
      const refused = rig();
      refused.results.push(spendResult({ granted: false, reason }));
      await refused.purchase.spend(SKU, refused.purchase.intentFor(SKU, COST), BLOCK);
      expect(refused.log, `coin on ${reason}`).not.toContain('coin');
      // ...and the arm is not vacuous through an unreached refuse(): every one of
      // these really did travel the granted-false path.
      expect(refused.log, `no refusal effect on ${reason}`).toContain('repaint');
    }
  });

  it('the band is cleared at the START of a spend, so a stale result never survives a retry', async () => {
    const r = rig();
    r.results.push(spendResult({ granted: false, reason: 'does_not_fit' }));
    await r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    expect(r.purchase.notice).toEqual({ granted: false, reason: 'does_not_fit' });
    // The next attempt HOLDS, so the only thing that could have cleared the band
    // is the clear at the top of spend().
    r.hold = true;
    const p = r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    expect(r.purchase.notice).toBeNull();
    r.release?.();
    await p;
  });

  it('NO hook at all reads as a lost reply: the intent stays open and the band says outage', async () => {
    const r = rig();
    r.noHook = true;
    const intent = r.purchase.intentFor(SKU, COST);
    await r.purchase.spend(SKU, intent, BLOCK);
    expect(r.purchase.notice).toEqual({ granted: false, reason: null });
    expect(r.ledger.isOpen(SKU)).toBe(true);
    expect(r.log).toContain('repaint');
  });
});

describe('the notice rules: two different clears, deliberately not one', () => {
  it('a result landing after the window closed does NOT re-arm the band', async () => {
    const r = rig();
    r.open = false;
    await r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    expect(r.purchase.notice).toBeNull();
  });

  it('clearNotice drops the band even while the window reports CLOSED', async () => {
    // close() is the caller, and it runs while `opened` is already false on some
    // paths. One method answering both rules would leave a stale result to paint
    // on the next open.
    const r = rig();
    await r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    expect(r.purchase.notice).not.toBeNull();
    r.open = false;
    r.purchase.clearNotice();
    expect(r.purchase.notice).toBeNull();
  });
});

describe('the automatic price-changed re-prompt is capped at ONE per window open', () => {
  it('re-prompts once at the fresh price, then stops while the cap stands', async () => {
    const r = rig({ freshCost: 250 });
    r.results.push(spendResult({ granted: false, reason: 'price_changed' }));
    await r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    expect(r.reprompts).toHaveLength(1);
    // A SECOND price_changed in the same open must not reopen it: an oscillating
    // price satisfies the moved-price guard every time.
    r.results.push(spendResult({ granted: false, reason: 'price_changed' }));
    await r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    expect(r.reprompts).toHaveLength(1);
    // ...and the cap really is what stopped it: reset it and the third does.
    r.purchase.resetRepromptCap();
    r.results.push(spendResult({ granted: false, reason: 'price_changed' }));
    await r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    expect(r.reprompts).toHaveLength(2);
  });

  it('an UNMOVED price does not re-prompt, which is the loop guard', async () => {
    const r = rig({ freshCost: COST });
    r.results.push(spendResult({ granted: false, reason: 'price_changed' }));
    await r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    expect(r.reprompts).toHaveLength(0);
    // The wire was still consulted, so the absence is the DECISION and not a
    // skipped read.
    expect(r.log).toContain('currentOffer');
  });

  it('the wire is re-read ONLY on the price_changed arm', async () => {
    const r = rig();
    r.results.push(spendResult({ granted: false, reason: 'does_not_fit' }));
    await r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    expect(r.log).not.toContain('currentOffer');
  });

  it('insufficient_balance hands off at the SERVICE cost, and shows no band', async () => {
    const r = rig();
    r.results.push(
      spendResult({
        granted: false,
        reason: 'insufficient_balance',
        costClaudium: 175,
        balance: 20,
      }),
    );
    await r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    expect(r.topUps).toEqual([{ blockSlots: BLOCK, cost: 175, balance: 20 }]);
    expect(r.purchase.notice).toBeNull();
  });
});

describe('the abandon decision, and its two halves', () => {
  it('endPrompt drops an UNSENT intent and reports that it did', () => {
    const r = rig();
    r.purchase.armPrompt(SKU);
    r.purchase.intentFor(SKU, COST);
    expect(r.purchase.endPrompt()).toBe(true);
    expect(r.ledger.isOpen(SKU)).toBe(false);
  });

  it('endPrompt does NOTHING after either confirm arm', () => {
    for (const confirm of [
      (p: BankRungPurchase) => p.confirmWithClaudium(),
      (p: BankRungPurchase) => p.confirmWithGold(null),
    ]) {
      const r = rig();
      r.purchase.armPrompt(SKU);
      r.purchase.intentFor(SKU, COST);
      confirm(r.purchase);
      expect(r.purchase.endPrompt()).toBe(false);
      expect(r.ledger.isOpen(SKU)).toBe(true);
    }
  });

  it('endPrompt on a GOLD-ONLY prompt (no sku) reports nothing and touches nothing', () => {
    const r = rig();
    r.purchase.armPrompt(null);
    r.purchase.intentFor(SKU, COST);
    expect(r.purchase.endPrompt()).toBe(false);
    expect(r.ledger.isOpen(SKU)).toBe(true);
  });

  it('endPrompt is IDEMPOTENT, so every teardown site may run it unconditionally', () => {
    // close() runs it on every close, including one long after the attempt ended.
    // A second call must not re-abandon an intent a later prompt has since minted.
    const r = rig();
    r.purchase.armPrompt(SKU);
    r.purchase.intentFor(SKU, COST);
    expect(r.purchase.endPrompt()).toBe(true);
    const later = r.purchase.intentFor(SKU, COST);
    expect(r.purchase.endPrompt()).toBe(false);
    expect(r.ledger.isOpen(SKU)).toBe(true);
    expect(r.purchase.intentFor(SKU, COST).key).toBe(later.key);
  });

  it('the FAMILY TEARDOWN ends the attempt, which is the path the dismiss hook never sees', () => {
    // dismissBankPrompts removes the prompt NODE, so showBuyConfirmPrompt's own
    // dismiss hook never runs and the attempt used to survive the repaint with
    // its cost FROZEN. Phase 16 made that record durable, so it outlived the page
    // too. Here the teardown is the caller with no lexical SKU at all, which is
    // why endPrompt reads the ARMED attempt rather than taking an argument.
    const r = rig();
    r.purchase.armPrompt(SKU);
    const minted = r.purchase.intentFor(SKU, COST);
    expect(r.purchase.endPrompt()).toBe(true);
    expect(r.ledger.isOpen(SKU)).toBe(false);
    expect(r.purchase.intentFor(SKU, COST).key).not.toBe(minted.key);
  });

  it('a teardown does NOT end an attempt that already reached the service', async () => {
    // The negative control that keeps the fix from becoming its own money bug:
    // once a spend has been sent, a repaint tearing the prompt down must leave the
    // key alone, because it may be sitting behind a live debit.
    const r = rig();
    r.results.push(spendResult({ granted: false, reason: 'unavailable' }));
    const intent = r.purchase.intentFor(SKU, COST);
    await r.purchase.spend(SKU, intent, BLOCK);
    r.purchase.armPrompt(SKU);
    expect(r.purchase.endPrompt()).toBe(false);
    expect(r.purchase.intentFor(SKU, 999).key).toBe(intent.key);
  });

  it('the GOLD rail abandons the unsent Claudium intent it opened beside', () => {
    const r = rig();
    r.purchase.armPrompt(SKU);
    r.purchase.intentFor(SKU, COST);
    r.purchase.confirmWithGold(SKU);
    expect(r.ledger.isOpen(SKU)).toBe(false);
  });

  it('the GOLD rail does NOT abandon a key that has already reached the service', async () => {
    const r = rig();
    r.results.push(spendResult({ granted: false, reason: 'unavailable' }));
    const intent = r.purchase.intentFor(SKU, COST);
    await r.purchase.spend(SKU, intent, BLOCK);
    r.purchase.armPrompt(SKU);
    r.purchase.confirmWithGold(SKU);
    expect(r.ledger.isOpen(SKU)).toBe(true);
    expect(r.purchase.intentFor(SKU, 999).key).toBe(intent.key);
  });

  it('the sent latch and the ledger map cannot DIVERGE, because one event empties both', async () => {
    // RECORDED REFUTATION. The review round argued the latch could go stale: an
    // ambiguous spend leaves `sent` holding the SKU, the durable record expires
    // ten minutes later, a later intentFor mints a FRESH key, and every abandon
    // on that SKU is then silently vetoed by a latch left over from the old one.
    //
    // A probe settled it against that reading. `intentFor` consults the IN-MEMORY
    // map first, and the expiry only reaps the DURABLE row, so while the page
    // lives the ambiguous intent is handed back unchanged and nothing mints. The
    // only event that empties the map is a definitive settle, and that same
    // statement is what clears the latch. Pinned here so the coupling cannot be
    // broken silently, since neither half states a lifetime of its own.
    const r = rig();
    r.results.push(spendResult({ granted: false, reason: 'unavailable' }));
    const first = r.purchase.intentFor(SKU, COST);
    await r.purchase.spend(SKU, first, BLOCK);
    // Still open, still latched: a later read hands BACK the same key.
    expect(r.purchase.intentFor(SKU, COST).key).toBe(first.key);
    r.purchase.armPrompt(SKU);
    expect(r.purchase.endPrompt(), 'and the abandon is correctly vetoed').toBe(false);

    // Now a DEFINITIVE settle, the one event that empties the map.
    r.results.push(spendResult({ granted: false, reason: 'price_changed' }));
    await r.purchase.spend(SKU, r.purchase.intentFor(SKU, COST), BLOCK);
    expect(r.ledger.isOpen(SKU)).toBe(false);
    const fresh = r.purchase.intentFor(SKU, COST);
    expect(fresh.key).not.toBe(first.key);
    // ...and the latch went with it, so the fresh intent IS abandonable.
    r.purchase.armPrompt(SKU);
    expect(r.purchase.endPrompt(), 'the latch cleared with the map').toBe(true);
  });

  it('a RESTORED key keeps its DURABLE record through an abandon, which is the cross-page half', () => {
    // The pair the extraction had to keep together: `sent` covers the in-page
    // half and dies with the page; the ledger's own `restored` set covers the
    // half that outlives it. On a fresh page nothing was sent, so the latch says
    // "abandonable" and only the ledger stops the record going away.
    const d = durableRig({ key: 'from-a-previous-page', costClaudium: COST });
    const r = rig({ ledger: d.ledger });
    r.purchase.armPrompt(SKU);
    const restored = r.purchase.intentFor(SKU, COST);
    expect(restored.key).toBe('from-a-previous-page');
    expect(r.purchase.endPrompt()).toBe(true);
    // The in-memory intent is gone; the DURABLE record is not.
    expect(d.ledger.isOpen(SKU)).toBe(false);
    expect(d.dropped).toEqual([]);
    // ...so the next click replays under the SAME key rather than minting a
    // second one over a debit that may still be live.
    expect(r.purchase.intentFor(SKU, COST).key).toBe('from-a-previous-page');
  });

  it('and an intent this PAGE minted is forgotten outright, so the two halves really differ', () => {
    // The negative control for the arm above: without it, a ledger that never
    // dropped anything would satisfy it perfectly.
    const d = durableRig(null);
    const r = rig({ ledger: d.ledger });
    r.purchase.armPrompt(SKU);
    r.purchase.intentFor(SKU, COST);
    expect(d.saved).toEqual([SKU]);
    expect(r.purchase.endPrompt()).toBe(true);
    expect(d.dropped).toEqual([SKU]);
  });
});

describe('the controller is host-free by construction', () => {
  it('makes no layout read and owns no driver, which is what the painter gate would have checked', () => {
    // STANDING IN FOR A GATE THIS FILE'S NAME FALLS OUTSIDE. The painter gate
    // (tests/hud_perf_budget.test.ts) discovers its corpus by FILENAME SUFFIX
    // (_painter, _window, _controller), so a `_core` sibling is not swept. The
    // `_core` name was chosen for the completeness sweep and the determinism
    // scan, NOT to slip this gate, and that claim is worth an assertion rather
    // than a comment: the module holds the same cold contract src/ui/CLAUDE.md
    // gives a window, and if a layout read or a repeating driver ever lands here
    // the right answer is to rename the file into the sweep, not to widen this.
    const src = readFileSync(resolve(process.cwd(), 'src/ui/bank_rung_purchase_core.ts'), 'utf8')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    // The module really is the one under test, so the negatives below cannot pass
    // over an empty or mis-resolved read.
    expect(src).toContain('export class BankRungPurchase');
    for (const read of [
      'offsetWidth',
      'offsetHeight',
      'getBoundingClientRect',
      'getComputedStyle',
      'scrollTop',
      'clientWidth',
    ]) {
      expect(src, `layout read ${read}`).not.toContain(read);
    }
    for (const driver of ['setInterval', 'setTimeout', 'requestAnimationFrame', 'queueMicrotask']) {
      expect(src, `driver ${driver}`).not.toContain(driver);
    }
  });

  it('spends the FROZEN cost and the intent key, never a refreshed number', async () => {
    const r = rig();
    r.results.push(spendResult({ granted: false, reason: 'unavailable' }));
    const first = r.purchase.intentFor(SKU, COST);
    await r.purchase.spend(SKU, first, BLOCK);
    // The catalog moved under us; the ledger ignores the new cost.
    const retry = r.purchase.intentFor(SKU, 250);
    await r.purchase.spend(SKU, retry, BLOCK);
    expect(r.spends.map((s) => s.cost)).toEqual([COST, COST]);
    expect(new Set(r.spends.map((s) => s.key)).size).toBe(1);
  });
});
