// Bank Storage phase 16: a purchase intent survives the page that made it, or
// it is not restored at all.
//
// The subject is a REAL MONEY path. A storage SKU is repeatable and writes no
// grant row, so the economy service dedupes on the client-minted idempotency key
// ALONE: a retry under a fresh key is a SECOND REAL CHARGE. Every arm below is
// written so that a regression fails toward "mint a fresh key exactly as before
// durability existed" (safe, the pre-phase behaviour) and never toward "hand
// back a value nobody checked".
//
// The clock and the storage are INJECTED, which is why the exact age boundary is
// pinned here rather than in an integration arm: this is the module that owns
// the bound, so it is the one place a millisecond-exact assertion is honest.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEY_PATTERN,
  STORAGE_MAX_EXPECTED_COST_CLAUDIUM,
} from '../server/storage_purchases';
import { STORAGE_PRICE_MAX_STALE_MS } from '../server/storage_store_cache';
import { STORAGE_SKU_LIST } from '../src/sim/content/storage_charters';
import {
  durablePurchaseIntentPort,
  type PurchaseIntentScopeSource,
  scopeOfWorld,
} from '../src/ui/purchase_intent_durability';
import {
  intentFromStored,
  PURCHASE_INTENT_KEY_PATTERN,
  PURCHASE_INTENT_MAX_AGE_MS,
  PURCHASE_INTENT_MAX_COST_CLAUDIUM,
  PURCHASE_INTENT_MAX_ENTRIES,
  PURCHASE_INTENT_ROW_PREFIX,
  PURCHASE_INTENT_ROW_VERSION,
  purchaseIntentRowName,
  purchaseIntentScope,
  readPurchaseIntentRow,
  type StoredPurchaseIntent,
  writePurchaseIntentRow,
} from '../src/ui/purchase_intent_record';
import { createPurchaseIntentLedger } from '../src/ui/store_purchase_intent';
import type { IWorld } from '../src/world_api';

const SCOPE = 'warrior_Borin';
const ROW = `${PURCHASE_INTENT_ROW_PREFIX}_${SCOPE}`;
const SKU = 'strongbox_charter_1';
const RUNG = 'strongbox_rung_01';
const NOW = 1_700_000_000_000;

/** A storage double that COUNTS its writes. Counting rather than reading the map
 *  back is deliberate: a read that writes an identical row back is still a write,
 *  and "this read persisted nothing" is otherwise satisfied by the store simply
 *  ending up in the same state. */
class FakeStore {
  readonly map = new Map<string, string>();
  writes = 0;
  removes = 0;
  throwOnGet = false;
  throwOnSet = false;
  throwOnRemove = false;
  getItem(name: string): string | null {
    if (this.throwOnGet) throw new Error('storage locked');
    return this.map.get(name) ?? null;
  }
  setItem(name: string, value: string): void {
    if (this.throwOnSet) throw new Error('quota');
    this.writes++;
    this.map.set(name, value);
  }
  removeItem(name: string): void {
    if (this.throwOnRemove) throw new Error('locked');
    this.removes++;
    this.map.delete(name);
  }
}

const rowOf = (
  intents: Record<string, StoredPurchaseIntent>,
  scope = SCOPE,
  v = PURCHASE_INTENT_ROW_VERSION,
): string => JSON.stringify({ v, scope, intents });

const stored = (over: Partial<StoredPurchaseIntent> = {}): StoredPurchaseIntent => ({
  key: 'intent-abc123',
  costClaudium: 500,
  mintedAtMs: NOW - 1000,
  ...over,
});

// One counter for the whole file rather than one per ledger, so every key this
// suite mints is DISTINCT. A per-ledger counter made two independently minted
// keys collide on 'intent-minted-1', which turned every `not.toBe` arm (the ones
// proving a key was NOT restored) into a coin flip that happened to land wrong.
let minted = 0;
const uniqueMint = (): string => `intent-minted-${++minted}`;

/** A ledger over a fake store and a fake clock, exactly as a window gets one. */
function ledgerOver(store: FakeStore | null, scope = () => SCOPE, now = () => NOW) {
  return createPurchaseIntentLedger(
    uniqueMint,
    durablePurchaseIntentPort(scope, () => store, now),
  );
}

describe('the durable record: every guard answers ABSENT, never a repair', () => {
  it('round-trips one entry through the row it writes', () => {
    const raw = writePurchaseIntentRow(SCOPE, { [SKU]: stored() });
    const read = readPurchaseIntentRow(raw, SCOPE, NOW);
    expect(read.intents[SKU]).toEqual(stored());
    expect(read.prunedReadableRow, 'a row with nothing to drop must not ask for a write').toBe(
      false,
    );
  });

  it('hands the ledger the key AND the cost frozen with it, and nothing else', () => {
    // The mint time is durability bookkeeping. If it ever reached the ledger the
    // ledger would have a clock, which is the trade this phase refused.
    expect(intentFromStored(stored())).toEqual({ key: 'intent-abc123', costClaudium: 500 });
    expect(Object.isFrozen(intentFromStored(stored()))).toBe(true);
  });

  it('refuses an unreadable row WITHOUT asking for it to be rewritten', () => {
    // Three shapes, and the shared claim is the SECOND assertion each time: a row
    // this build cannot read may belong to another build or another character on
    // a shared browser, so it is left alone rather than pruned away.
    for (const [label, raw] of [
      ['not json', '{oh no'],
      ['not an object', '"a string"'],
      ['a future version', rowOf({ [SKU]: stored() }, SCOPE, PURCHASE_INTENT_ROW_VERSION + 1)],
      ['another character', rowOf({ [SKU]: stored() }, 'mage_Elenwe')],
      ['no intents object', JSON.stringify({ v: PURCHASE_INTENT_ROW_VERSION, scope: SCOPE })],
      // THE TWO NULL HALVES, and they need their own rows because `typeof null`
      // is 'object': the typeof half of each guard PASSES for null, so the
      // `=== null` half alone is what stands between a hand-edited row and a
      // throw. A literal null row would reach `row.v` on null; a null `intents`
      // would reach Object.entries(null). Neither read is inside a try, so the
      // throw escapes load(), escapes intentFor, and FAILS a purchase that would
      // otherwise have worked, which is the one thing this module may never do.
      ['a literal null row', 'null'],
      [
        'a null intents map',
        JSON.stringify({ v: PURCHASE_INTENT_ROW_VERSION, scope: SCOPE, intents: null }),
      ],
    ] as const) {
      // Answering, never throwing, is half the claim and the half a mutant kills.
      expect(() => readPurchaseIntentRow(raw, SCOPE, NOW), `${label} must not throw`).not.toThrow();
      const read = readPurchaseIntentRow(raw, SCOPE, NOW);
      expect(read.intents, label).toEqual({});
      expect(read.prunedReadableRow, `${label} must not be rewritten`).toBe(false);
    }
    // The two shapes the raw check itself answers, each pinned separately so a
    // mutant that drops one half is not covered by the other.
    expect(readPurchaseIntentRow(null, SCOPE, NOW).intents).toEqual({});
    expect(readPurchaseIntentRow('', SCOPE, NOW).intents).toEqual({});
  });

  it('drops an entry per BAD DIMENSION, and says the row should be rewritten', () => {
    // One arm per dimension, not one arm for "a bad entry": a single combined
    // case passes with any one of the five checks deleted.
    const bad: Record<string, Partial<StoredPurchaseIntent>> = {
      'a key outside the server charset': { key: 'has a space' },
      'an empty key': { key: '' },
      // RegExp.prototype.test COERCES, so /^[A-Za-z0-9_.:-]{1,200}$/.test(12345)
      // is true and the typeof guard is the only thing standing between a NUMBER
      // and the idempotency key on the wire. Nothing killed that guard until
      // this row existed.
      'a key that is not a string at all': { key: 12345 as unknown as string },
      'a fractional cost': { costClaudium: 12.5 },
      'a negative cost': { costClaudium: -1 },
      // ZERO is refused for the same reason as the cap, not as padding: the wire
      // refuses expectedCostClaudium <= 0 with invalid_request, which the ledger
      // reads as DEFINITIVE and closes the intent on.
      'a zero cost': { costClaudium: 0 },
      'a cost above the wire cap': { costClaudium: PURCHASE_INTENT_MAX_COST_CLAUDIUM + 1 },
      'an unreadable mint time': { mintedAtMs: Number.NaN },
      // NaN alone does NOT kill the isFinite guard: with it deleted, NaN still
      // fails both comparisons below it. A numeric STRING is what separates
      // them, because '1699999999000' > 1700000000000 is false while the
      // subtraction coerces and passes the age check.
      'a mint time that is a numeric string': {
        mintedAtMs: String(NOW - 1000) as unknown as number,
      },
      'a mint time in the FUTURE': { mintedAtMs: NOW + 1 },
    };
    for (const [label, over] of Object.entries(bad)) {
      const read = readPurchaseIntentRow(rowOf({ [SKU]: stored(over) }), SCOPE, NOW);
      expect(read.intents, label).toEqual({});
      expect(read.prunedReadableRow, `${label} came out of a READABLE row`).toBe(true);
    }
    // And the non-object entry, which cannot carry a dimension at all.
    const read = readPurchaseIntentRow(
      JSON.stringify({ v: PURCHASE_INTENT_ROW_VERSION, scope: SCOPE, intents: { [SKU]: 7 } }),
      SCOPE,
      NOW,
    );
    expect(read.intents).toEqual({});
    expect(read.prunedReadableRow).toBe(true);
  });

  it('expires at exactly the bound, and the bound is the ambiguity span, not a number', () => {
    const at = (ageMs: number) =>
      readPurchaseIntentRow(rowOf({ [SKU]: stored({ mintedAtMs: NOW - ageMs }) }), SCOPE, NOW);
    // One millisecond inside the bound is still live; the bound itself is not.
    // Exact here because the clock is an ARGUMENT: nothing in this file reads a
    // real clock, so there is no harness timing to measure by accident.
    expect(at(PURCHASE_INTENT_MAX_AGE_MS - 1).intents[SKU]).toBeDefined();
    expect(at(PURCHASE_INTENT_MAX_AGE_MS).intents[SKU]).toBeUndefined();
    expect(at(PURCHASE_INTENT_MAX_AGE_MS).prunedReadableRow).toBe(true);
  });

  it('BORROWS its three limits from the server rather than restating them', () => {
    // The charset copy is the dangerous one: a key that fails the server pattern
    // comes back invalid_request, which the ledger reads as DEFINITIVE, so it
    // CLOSES the intent and the next click mints a fresh key over the live debit.
    // A drift must fail here rather than in a purchase.
    expect(PURCHASE_INTENT_KEY_PATTERN.source).toBe(STORAGE_KEY_PATTERN.source);
    // THE LITERAL ANCHOR, the precedent tests/server/storage_ladder_hold.test.ts
    // already set. The comparison above pins the CHARSET, which really is
    // written twice, but both sides interpolate the same shared
    // BANK_STORAGE_KEY_MAX_LENGTH, so lowering that one constant moves both
    // patterns together and the equality still holds while every minted key
    // (about 43 characters) starts failing at the wire as invalid_request, which
    // this ledger reads as DEFINITIVE. The literal is what catches that.
    expect(PURCHASE_INTENT_KEY_PATTERN.source).toBe('^[A-Za-z0-9_.:-]{1,200}$');
    expect(PURCHASE_INTENT_MAX_COST_CLAUDIUM).toBe(STORAGE_MAX_EXPECTED_COST_CLAUDIUM);
    // The age bound is the server's own answer to "how long may a purchase whose
    // money MAY have moved still be believed" (AMBIGUITY_HOLD_MAX_MS borrows the
    // same source). src/ui may not import from server/, so the equality is a pin.
    expect(PURCHASE_INTENT_MAX_AGE_MS).toBe(STORAGE_PRICE_MAX_STALE_MS);
  });

  it('bounds the row at the catalog, keeping the NEWEST entries', () => {
    // Reaches the real cap: 24 entries against a bound of 16, so the assertion is
    // toBe(cap) and not a comparison that holds with the slice deleted.
    const intents: Record<string, StoredPurchaseIntent> = {};
    for (let i = 0; i < 24; i++) {
      intents[`sku_${i}`] = stored({ key: `intent-k${i}`, mintedAtMs: NOW - (24 - i) * 1000 });
    }
    const raw = rowOf(intents);
    const read = readPurchaseIntentRow(raw, SCOPE, NOW);
    expect(Object.keys(read.intents)).toHaveLength(16);
    // THE CAP BOUNDS WHAT IS HANDED BACK AND NOTHING ELSE. The flag reports the
    // expiry-and-malformed reaper, so it stays FALSE here: every one of these 24
    // entries is live by every other guard, and the binder answers a true flag by
    // writing the shortened row back, which would permanently delete eight live
    // entries on a read for a different item from the other ledger. One of them
    // could be the unsettled key behind a running debit.
    expect(read.prunedReadableRow, 'the cap must not trigger a write-back').toBe(false);
    // `retained` is what a write-back may use, and the cap does NOT bound it.
    expect(Object.keys(read.retained), 'the cap must not bound what SURVIVES').toHaveLength(24);
    // And an EXPIRED entry in the same over-cap row DOES flip the flag, so the
    // reaper is not switched off by the change above.
    const withCorpse = { ...intents };
    withCorpse.sku_dead = stored({ mintedAtMs: NOW - PURCHASE_INTENT_MAX_AGE_MS - 1 });
    const corpseRead = readPurchaseIntentRow(rowOf(withCorpse), SCOPE, NOW);
    expect(corpseRead.prunedReadableRow).toBe(true);
    // The handed-back set is still capped, and the retained set still is not.
    expect(Object.keys(corpseRead.intents)).toHaveLength(16);
    expect(Object.keys(corpseRead.retained)).toHaveLength(24);
    // WHICH survived, not just how many: newest kept, oldest gone.
    expect(read.intents.sku_23, 'the newest entry survives').toBeDefined();
    expect(read.intents.sku_8, 'the 16th newest survives').toBeDefined();
    expect(read.intents.sku_7, 'the 17th newest is evicted').toBeUndefined();
    expect(read.intents.sku_0, 'the oldest is evicted').toBeUndefined();
    // The cap is DERIVED from the catalog. Both literals are a DELIBERATE
    // TRIPWIRE rather than a coupling accident: adding a storage SKU should red
    // here, because it changes how many open intents one row may hold and that
    // deserves a look rather than a silent truncation of a real intent.
    expect(PURCHASE_INTENT_MAX_ENTRIES).toBe(16);
    expect(STORAGE_SKU_LIST).toHaveLength(16);
  });

  it('names the row from the scope, and answers NOTHING when identity is unknown', () => {
    expect(purchaseIntentRowName(SCOPE)).toBe(ROW);
    // The empty name is the "before the first snapshot" signal: ClientWorld
    // answers a blank entity whose name is ''.
    expect(purchaseIntentScope('warrior', '')).toBe('');
    expect(purchaseIntentRowName('')).toBeNull();
    expect(purchaseIntentRowName(null)).toBeNull();
    expect(purchaseIntentScope('warrior', 'Borin')).toBe(SCOPE);
  });
});

describe('the scope: account and character, from what the client already has', () => {
  it('reads the per-character scope off the world', () => {
    expect(scopeOfWorld({ cfg: { playerClass: 'mage' }, player: { name: 'Elenwe' } })).toBe(
      'mage_Elenwe',
    );
  });

  it('degrades to UNKNOWN rather than throwing on a world that cannot answer', () => {
    // A money path may never throw out of intentFor. Unknown costs the
    // durability and nothing else.
    for (const world of [{}, { cfg: {} }, { player: {} }, { cfg: {}, player: {} }]) {
      expect(scopeOfWorld(world as PurchaseIntentScopeSource)).toBe('');
    }
  });

  it('a SPECTATING session has NO scope, so nothing is filed under the watched name', () => {
    // The money case. A moderator spectate repoints playerId at the watched
    // character and swaps cfg.playerClass with it, so both reads answer for the
    // ANCHOR. A Claudium spend is an HTTP call the spectate command-gate does
    // not touch, so the money would move on the VIEWER's account while the
    // record filed itself under the WATCHED character's row: unfindable after a
    // reload, which is exactly the pre-durability behaviour, and readable by that
    // character if they play on this browser.
    const watched = { cfg: { playerClass: 'mage' }, player: { name: 'Elenwe' } };
    expect(scopeOfWorld(watched)).toBe('mage_Elenwe');
    // The SAME reads, now while spectating: no scope at all.
    expect(scopeOfWorld({ ...watched, spectating: 'Elenwe' })).toBe('');
    // Including the case where the anchor is the viewer's own name, because the
    // guard is on the FACT of spectating and never on whose name it is.
    expect(scopeOfWorld({ ...watched, spectating: 'Borin' })).toBe('');
    // And null (the ordinary session) is NOT spectating. Both the absent and the
    // explicit-null arms, so a `!= null` slip in either direction reddens.
    expect(scopeOfWorld({ ...watched, spectating: null })).toBe('mage_Elenwe');
    expect(scopeOfWorld(watched)).toBe('mage_Elenwe');
    // An empty spectate name is still a spectate: the field is a name or null,
    // never an empty string, but a truthiness test here would let one through.
    expect(scopeOfWorld({ ...watched, spectating: '' })).toBe('');
  });

  it('and a spectating session therefore WRITES nothing at all', () => {
    // The scope arm above is only half the claim: prove it reaches the port, so
    // a future refactor cannot keep the scope rule and lose the write refusal.
    const store = new FakeStore();
    let spectating: string | null = 'Someone';
    const watching = () =>
      scopeOfWorld({ cfg: { playerClass: 'mage' }, player: { name: 'Elenwe' }, spectating });
    const mid = ledgerOver(store, watching).intentFor(SKU, 500);
    // It still MINTS, because a purchase may never fail for want of durability.
    expect(mid.key).not.toBe('');
    // But nothing was written, under ANY name.
    expect(store.map.size, 'a spectating session wrote a row').toBe(0);
    expect(store.writes).toBe(0);
    // The same ledger once spectate ENDS writes normally, which is what proves
    // the zero above came from the guard and not from a broken fixture.
    spectating = null;
    const own = ledgerOver(store, watching).intentFor(SKU, 500);
    expect(store.map.size).toBe(1);
    expect([...store.map.keys()][0]).toBe(`${PURCHASE_INTENT_ROW_PREFIX}_mage_Elenwe`);
    // And the key minted while spectating is NOT the one that survived, which is
    // the honest consequence: that purchase lost its durability.
    expect(own.key).not.toBe(mid.key);
  });

  it('IWorld really carries the two members the scope is built from', () => {
    // ASSIGNMENT ALONE IS VACUOUS HERE. Every member of PurchaseIntentScopeSource
    // is optional (it has to be: a partial world must degrade rather than
    // throw), so `(w: IWorld) => w` keeps compiling even if IWorld DROPS or
    // RENAMES cfg.playerClass or player.name, and the silent result would be a
    // scope of '' and durability quietly off on both windows. READ the members
    // instead, which is what actually stops compiling.
    const proof = (world: IWorld): { c: string; n: string; s: string | null } => ({
      c: world.cfg.playerClass,
      n: world.player.name,
      // Read it here too: the spectate guard is the money guard, and a member
      // this test never touches can be renamed off IWorld in silence.
      s: world.spectating,
    });
    expect(typeof proof).toBe('function');
    // And a runtime arm over the same shape both worlds present, so the
    // derivation is exercised and not merely type-checked.
    const shaped = { cfg: { playerClass: 'priest' }, player: { name: 'Alaria' } };
    expect(scopeOfWorld(shaped)).toBe('priest_Alaria');
    expect(purchaseIntentRowName(scopeOfWorld(shaped))).toBe(
      `${PURCHASE_INTENT_ROW_PREFIX}_priest_Alaria`,
    );
  });
});

describe('the durable ledger: an intent survives the page', () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it('a FRESH ledger returns the SAME key and the SAME frozen cost', () => {
    // This is ruling 19 in one arm. Without durability the second ledger mints a
    // new key, and a new key over a live debit is a second real charge.
    const first = ledgerOver(store).intentFor(SKU, 500);
    const second = ledgerOver(store).intentFor(SKU, 900);
    expect(second.key).toBe(first.key);
    // The cost argument on the restore is DROPPED, exactly as the in-memory path
    // drops it: the wire must carry the frozen price or the server's four-field
    // identity check answers a definitive-looking already_granted over a row that
    // may still be pending behind a live debit.
    expect(second.costClaudium).toBe(500);
  });

  it('restoring does NOT re-stamp the mint time, so clicking cannot extend the life', () => {
    ledgerOver(store).intentFor(SKU, 500);
    const mintedAt = JSON.parse(store.map.get(ROW) as string).intents[SKU].mintedAtMs;
    expect(mintedAt).toBe(NOW);
    // Restore it much later but still inside the bound, then read the row again.
    ledgerOver(
      store,
      () => SCOPE,
      () => NOW + 60_000,
    ).intentFor(SKU, 500);
    expect(JSON.parse(store.map.get(ROW) as string).intents[SKU].mintedAtMs).toBe(mintedAt);
  });

  it('REFUSES to restore across a character change, and mints a new key instead', () => {
    const mine = ledgerOver(store, () => SCOPE).intentFor(SKU, 500);
    const theirs = ledgerOver(store, () => 'mage_Elenwe').intentFor(SKU, 500);
    expect(theirs.key).not.toBe(mine.key);
    // And the other character's row is untouched: their protection is not
    // collateral damage from mine.
    expect(store.map.get(ROW)).toContain(mine.key);
  });

  it('writes NOTHING before the client knows who it is', () => {
    const unknown = ledgerOver(store, () => '');
    const intent = unknown.intentFor(SKU, 500);
    // Asserted on the SPY, not on a later read: a later read would also pass if
    // the write happened and was then swept.
    expect(store.writes, 'no write under a placeholder scope').toBe(0);
    expect(store.map.size).toBe(0);
    // The in-memory ledger still works, which is the whole fallback contract.
    expect(unknown.intentFor(SKU, 900).key).toBe(intent.key);
  });

  it('closes the durable record on granted and on a DEFINITIVE refusal only', () => {
    for (const [label, result] of [
      ['granted', { granted: true, reason: null }],
      ['granted already_granted (a replay)', { granted: true, reason: 'already_granted' }],
      ['insufficient_balance', { granted: false, reason: 'insufficient_balance' }],
      ['price_changed', { granted: false, reason: 'price_changed' }],
      ['invalid_request', { granted: false, reason: 'invalid_request' }],
    ] as const) {
      store = new FakeStore();
      const ledger = ledgerOver(store);
      const key = ledger.intentFor(SKU, 500).key;
      ledger.settle(SKU, result);
      expect(store.map.has(ROW), `${label} must close the record`).toBe(false);
      // And a fresh ledger then mints a DIFFERENT key, which is what "closed"
      // means. Compared against the key this arm actually minted, never against
      // a counter value, so the assertion cannot pass by coincidence.
      expect(ledgerOver(store).intentFor(SKU, 500).key, label).not.toBe(key);
    }
  });

  it('KEEPS the durable record on every ambiguous outcome', () => {
    for (const [label, reason] of [
      ['unavailable', 'unavailable'],
      ['purchase_in_progress', 'purchase_in_progress'],
      ['no_live_character', 'no_live_character'],
      ['a token this build does not know', 'invented_by_a_newer_server'],
    ] as const) {
      store = new FakeStore();
      const first = ledgerOver(store);
      const key = first.intentFor(SKU, 500).key;
      first.settle(SKU, { granted: false, reason });
      expect(store.map.has(ROW), `${label} must retain the key`).toBe(true);
      expect(ledgerOver(store).intentFor(SKU, 500).key, label).toBe(key);
    }
  });

  it('KEEPS a RESTORED record when the player abandons, because it may be sent', () => {
    // The hole a reviewer found, and it is the phase's own threat model reached
    // through the one piece of state that was never made durable. A window's
    // "this key has already reached the service" latch is an in-memory Set that
    // dies with the page. On the page AFTER an ambiguous outcome the window
    // believes nothing was sent, so its cancel path abandons a key that may be
    // sitting behind a live debit, and the next click would mint a fresh key
    // over it. A restored intent is therefore treated as possibly-sent.
    const first = ledgerOver(store);
    const key = first.intentFor(SKU, 500).key;
    first.settle(SKU, { granted: false, reason: 'unavailable' });

    const afterReload = ledgerOver(store);
    expect(afterReload.intentFor(SKU, 500).key, 'restored').toBe(key);
    afterReload.abandon(SKU);
    // The in-memory intent is gone, which is what the window asked for...
    expect(afterReload.isOpen(SKU)).toBe(false);
    // ...and the durable record is NOT, which is what protects the debit.
    expect(store.map.has(ROW), 'the durable record outlives the cancel').toBe(true);
    expect(ledgerOver(store).intentFor(SKU, 500).key, 'the next click replays it').toBe(key);
  });

  it('still drops a record this page MINTED, which is provably unsent', () => {
    // The other direction, so the fix above cannot become "abandon never drops".
    // An intent minted here and cancelled here never reached the service.
    const ledger = ledgerOver(store);
    const key = ledger.intentFor(SKU, 500).key;
    ledger.abandon(SKU);
    expect(store.map.has(ROW)).toBe(false);
    expect(ledgerOver(store).intentFor(SKU, 500).key).not.toBe(key);
  });

  it('a FRESH mint after an expiry is abandonable again, not stuck as restored', () => {
    // ONE ledger and a MOVING clock, which is the whole point: `restored` is per
    // ledger instance, so an arm that built a second ledger to represent "later"
    // gave it a fresh set and could not see this guard at all. A window's ledger
    // lives as long as its page, so restore, cancel, wait out the bound and buy
    // again all happen on the SAME instance.
    let clock = NOW;
    const ledger = ledgerOver(
      store,
      () => SCOPE,
      () => clock,
    );
    store.map.set(ROW, rowOf({ [SKU]: stored({ key: 'intent-from-the-last-page' }) }));

    expect(ledger.intentFor(SKU, 500).key).toBe('intent-from-the-last-page');
    ledger.abandon(SKU);
    expect(store.map.has(ROW), 'the restored record survives the cancel').toBe(true);

    // Past the bound the stored entry is refused, so this mints afresh. That
    // intent is provably unsent, so a cancel must forget it OUTRIGHT rather than
    // inherit the previous one's possibly-sent status.
    clock = NOW + PURCHASE_INTENT_MAX_AGE_MS + 1;
    const fresh = ledger.intentFor(SKU, 500);
    expect(fresh.key).not.toBe('intent-from-the-last-page');
    ledger.abandon(SKU);
    expect(store.map.has(ROW), 'a freshly minted intent is forgotten on a cancel').toBe(false);
  });

  it('a DEFINITIVE settle still closes a restored record', () => {
    // And the restored marking must not outlive an authoritative answer, or a
    // settled purchase would keep replaying forever.
    const first = ledgerOver(store);
    first.intentFor(SKU, 500);
    first.settle(SKU, { granted: false, reason: 'unavailable' });
    const afterReload = ledgerOver(store);
    afterReload.intentFor(SKU, 500);
    afterReload.settle(SKU, { granted: true, reason: null });
    expect(store.map.has(ROW)).toBe(false);
  });

  it('survives a storage whose removeItem throws, on the settle path', () => {
    // The close path is the real-money one, and its removeItem sat inside a
    // try/catch nothing exercised.
    store.throwOnRemove = true;
    const ledger = ledgerOver(store);
    ledger.intentFor(SKU, 500);
    expect(() => ledger.settle(SKU, { granted: true, reason: null })).not.toThrow();
    expect(() => ledger.abandon(SKU)).not.toThrow();
  });

  it('drops the record when the player abandons the purchase', () => {
    const ledger = ledgerOver(store);
    ledger.intentFor(SKU, 500);
    ledger.abandon(SKU);
    expect(store.map.has(ROW)).toBe(false);
  });

  it('reaps an expired sibling on an ordinary read for a DIFFERENT item', () => {
    // The path with NO further call: an intent nothing will ever settle or
    // abandon, because that surface is never opened again. Before durability the
    // reaper was process death; this is the bound that replaces it.
    store.map.set(
      ROW,
      rowOf({
        [SKU]: stored({ key: 'intent-stale', mintedAtMs: NOW - PURCHASE_INTENT_MAX_AGE_MS }),
        [RUNG]: stored({ key: 'intent-live', mintedAtMs: NOW - 1000 }),
      }),
    );
    const rung = ledgerOver(store).intentFor(RUNG, 100);
    expect(rung.key).toBe('intent-live');
    // Asserted on what the ROW now CONTAINS, not on what the read returned: the
    // claim is that the sweep persisted, not that this call filtered.
    const after = JSON.parse(store.map.get(ROW) as string);
    expect(Object.keys(after.intents)).toEqual([RUNG]);
  });

  it('a reaper firing inside an OVER-CAP row keeps every live entry on disk', () => {
    // THE ONE THE FIRST FIX MISSED, and it was measured rather than argued. The
    // cap no longer fires the flag on its own, but a CORPSE in an over-cap row
    // fires it for a perfectly good reason, and the write-back that followed
    // still wrote the CAPPED set: 24 live entries plus one expired went in and
    // sixteen came out, so eight keys that passed every guard left the disk
    // forever. One of them can be the unsettled key behind a running debit, and
    // the deletion happens on a read for a DIFFERENT item, possibly from the
    // OTHER ledger, so nothing the player touched is even involved.
    const intents: Record<string, StoredPurchaseIntent> = {};
    for (let i = 0; i < 24; i++) {
      intents[`sku_${i}`] = stored({ key: `intent-live${i}`, mintedAtMs: NOW - (24 - i) * 1000 });
    }
    intents.sku_dead = stored({
      key: 'intent-dead',
      mintedAtMs: NOW - PURCHASE_INTENT_MAX_AGE_MS - 1,
    });
    store.map.set(ROW, rowOf(intents));

    // A PURE LOAD: an item the row already carries, so the ledger restores it and
    // mints nothing. The expiry sweep rides every read, so this innocuous path is
    // the one that was doing the damage. (Asking for an item the row does NOT
    // carry would mint and save a 25th entry and measure something else.)
    const restoredIntent = ledgerOver(store).intentFor('sku_23', 500);
    expect(restoredIntent.key, 'the read did not restore, so it measured nothing').toBe(
      'intent-live23',
    );

    const after = JSON.parse(store.map.get(ROW) as string).intents as Record<string, unknown>;
    // ONLY the corpse is gone. Counted, and then named, so an implementation that
    // keeps the right NUMBER of the wrong entries fails too.
    expect(Object.keys(after), 'live entries were deleted by a read').toHaveLength(24);
    expect(after.sku_dead, 'the corpse survived, so the reaper stopped working').toBeUndefined();
    expect(after.sku_0, 'the OLDEST live entry is the one a capped write-back loses').toBeDefined();
    expect(after.sku_23, 'the newest live entry').toBeDefined();
  });

  it('does not rewrite the row on a read that dropped nothing', () => {
    // Counting real writes, because a store that ends in the same state cannot
    // tell an elided write from a performed one.
    ledgerOver(store).intentFor(SKU, 500);
    const writesAfterMint = store.writes;
    ledgerOver(store).intentFor(SKU, 500);
    ledgerOver(store).intentFor(SKU, 500);
    expect(store.writes).toBe(writesAfterMint);
  });

  it('shares ONE row between the store ledger and the banker ledger', () => {
    // The two SKU sets are disjoint, so sharing is safe, and sharing is what
    // gives the sweep above a second driver.
    const charters = ledgerOver(store);
    const rungs = ledgerOver(store);
    const c = charters.intentFor(SKU, 500);
    const r = rungs.intentFor(RUNG, 100);
    expect(store.map.size).toBe(1);
    const row = JSON.parse(store.map.get(ROW) as string);
    expect(row.intents[SKU].key).toBe(c.key);
    expect(row.intents[RUNG].key).toBe(r.key);
    // Settling one leaves the other alone.
    charters.settle(SKU, { granted: true, reason: null });
    expect(Object.keys(JSON.parse(store.map.get(ROW) as string).intents)).toEqual([RUNG]);
  });

  it('overwrites a row it could not read, rather than being wedged by one', () => {
    store.map.set(ROW, '{not json at all');
    const intent = ledgerOver(store).intentFor(SKU, 500);
    const row = JSON.parse(store.map.get(ROW) as string);
    expect(row.intents[SKU].key).toBe(intent.key);
  });

  it('loses the durability and NEVER the purchase when storage misbehaves', () => {
    // Each arm: the ledger still answers, still holds its key in memory, and
    // never throws. A money path that throws is worse than one that forgets.
    const noStore = ledgerOver(null);
    const key = noStore.intentFor(SKU, 500).key;
    expect(noStore.intentFor(SKU, 900).key, 'the in-memory map still holds it').toBe(key);

    const gettersThrow = new FakeStore();
    gettersThrow.throwOnGet = true;
    const a = ledgerOver(gettersThrow);
    expect(() => a.intentFor(SKU, 500)).not.toThrow();

    const settersThrow = new FakeStore();
    settersThrow.throwOnSet = true;
    const b = ledgerOver(settersThrow);
    expect(() => b.intentFor(SKU, 500)).not.toThrow();
    expect(() => b.settle(SKU, { granted: true, reason: null })).not.toThrow();

    const worldThrows = ledgerOver(store, () => {
      throw new Error('no world yet');
    });
    expect(() => worldThrows.intentFor(SKU, 500)).not.toThrow();
    expect(store.writes).toBe(0);
  });

  it('a drop for an item with no record does NOT touch the row at all', () => {
    // Without this the drop path writes on every settle of an item that was
    // never stored, which is a real-money row rewritten for no reason. Counted
    // on the spy, because the row's CONTENT is identical either way.
    const ledger = ledgerOver(store);
    ledger.intentFor(RUNG, 100);
    const writes = store.writes;
    const removes = store.removes;
    ledger.abandon(SKU);
    expect(store.writes, 'no write for an item with no record').toBe(writes);
    expect(store.removes, 'and no removal either').toBe(removes);
    // And the sibling entry is untouched, so the no-op really was a no-op.
    expect(Object.keys(JSON.parse(store.map.get(ROW) as string).intents)).toEqual([RUNG]);
  });

  it('but a drop with nothing of its own STILL reaps an expired sibling', () => {
    // The other half of the guard above, and it needs its own arm: the no-op case
    // exercises only "I have no entry", so a mutant that deletes the
    // `&& !read.prunedReadableRow` half survives it while silently costing the
    // drop path its share of the expiry sweep. Written so it fails toward MORE
    // work being owed, which is the direction a lost reaper shows up in.
    store.map.set(
      ROW,
      rowOf({
        [RUNG]: stored({ key: 'intent-expired', mintedAtMs: NOW - PURCHASE_INTENT_MAX_AGE_MS - 1 }),
      }),
    );
    const writes = store.writes;
    const removes = store.removes;
    // Abandon an item this ledger never opened: nothing of its own to remove,
    // but the row it can see is carrying a corpse.
    ledgerOver(store).abandon(SKU);
    expect(
      store.writes + store.removes,
      'the drop path saw an expired sibling and left it there',
    ).toBe(writes + removes + 1);
    // The row is now GONE rather than an empty husk, because reaping the only
    // entry empties it and an emptied row names a real-money attempt nobody has.
    expect(store.map.has(ROW)).toBe(false);
  });

  it('REFUSES to persist what the reader would refuse, so no entry is dead on arrival', () => {
    // The save-side guard had ZERO arms: deleting it survived the whole suite.
    // It matters because the store's charter path mints
    // `intentFor(itemId, row?.costClaudium ?? 0)` when the catalog row is
    // missing, so a ZERO cost is reachable without devtools, and the wire
    // refuses `expectedCostClaudium <= 0` with invalid_request, which this
    // ledger reads as DEFINITIVE. Persisting one would write a record that the
    // very next read drops, costing a prune and teaching the row to lie.
    const zero = ledgerOver(store).intentFor(SKU, 0);
    expect(zero.costClaudium, 'the ledger still mints, it just does not persist').toBe(0);
    expect(store.writes, 'a dead-on-arrival entry was written').toBe(0);
    expect(store.map.has(ROW)).toBe(false);
    // NEGATIVE ARM, so the assertion above cannot pass because the fixture never
    // writes at all: the same ledger with a real cost DOES persist.
    const good = ledgerOver(store).intentFor(RUNG, 100);
    expect(store.writes).toBe(1);
    expect(JSON.parse(store.map.get(ROW) as string).intents[RUNG].key).toBe(good.key);
    // The zero-cost item is absent from the row it would have shared.
    expect(JSON.parse(store.map.get(ROW) as string).intents[SKU]).toBeUndefined();
  });

  it('samples the clock ONCE per save, so a moving clock cannot discard the record', () => {
    // save() used to read the clock three times inside one read-modify-write and
    // then judge the stamp it had just written against a LATER sample. Any clock
    // that moves between the two reads (every real one does) makes
    // `mintedAtMs > nowMs` true, the future-stamp guard rejects, and the record
    // the whole phase exists to write is silently not written.
    //
    // THE FIXTURE MUST RETREAT, NOT ADVANCE, and getting that backwards makes the
    // arm green against the very code it was written to kill. The pre-fix shape
    // sampled the stamp BEFORE the judgement, so an ADVANCING clock produces
    // stamp NOW+1 judged against NOW+2, the `mintedAtMs > nowMs` guard never
    // fires, and the record persists anyway. A RETREATING clock produces stamp
    // NOW-1 judged against NOW-2, the guard fires, and save() returns having
    // written nothing. With one read both uses see the same instant either way.
    let tick = 0;
    const retreating = () => NOW - tick++;
    const store = new FakeStore();
    const ledger = createPurchaseIntentLedger(
      uniqueMint,
      durablePurchaseIntentPort(
        () => SCOPE,
        () => store,
        retreating,
      ),
    );
    const intent = ledger.intentFor(SKU, 500);
    expect(store.map.has(ROW), 'a moving clock discarded the record').toBe(true);
    const written = JSON.parse(store.map.get(ROW) as string).intents[SKU];
    expect(written.key).toBe(intent.key);
    // And the stamp is never in its own future by the moment it is judged.
    expect(written.mintedAtMs).toBeLessThanOrEqual(NOW);
    // The clock really did move, so the arm is not passing on a frozen fixture.
    expect(tick, 'the fixture clock never advanced, so this proves nothing').toBeGreaterThan(1);
  });

  it('never hands back an entry stored under an EMPTY item id', () => {
    // A row can only get one by hand. It must not be reachable, because an
    // itemId is what a retry targets and an empty one targets nothing.
    store.map.set(ROW, rowOf({ '': stored({ key: 'intent-nameless' }) }));
    const read = readPurchaseIntentRow(store.map.get(ROW) as string, SCOPE, NOW);
    expect(read.intents).toEqual({});
    expect(read.prunedReadableRow, 'and the row is asked to shed it').toBe(true);
    expect(ledgerOver(store).intentFor('', 500).key).not.toBe('intent-nameless');
  });

  it('the port is OPTIONAL: without one the ledger is byte-for-byte what it was', () => {
    // The guarantee that keeps the offline world and every existing arm of
    // tests/store_purchase_intent.test.ts unchanged.
    const plain = createPurchaseIntentLedger(() => 'intent-plain');
    const first = plain.intentFor(SKU, 500);
    expect(first).toEqual({ key: 'intent-plain', costClaudium: 500 });
    expect(plain.isOpen(SKU)).toBe(true);
    plain.settle(SKU, { granted: false, reason: 'unavailable' });
    expect(plain.isOpen(SKU)).toBe(true);
    plain.settle(SKU, { granted: true, reason: null });
    expect(plain.isOpen(SKU)).toBe(false);
  });

  it('reads the scope LAZILY, and only the DURABLE half is scoped at all', () => {
    // WHAT THIS ARM USED TO SAY AND DID NOT PIN, because the correction matters
    // more than the arm: it was titled "a character switch under a live ledger is
    // honoured" and then asserted on a SECOND ledger, whose openIntents Map
    // starts empty, so the live one it named was never touched again. That is
    // the same two-ledger shadow that made a fix-round arm survive its own
    // mutant one field over (`restored` is per instance too). Its call-count
    // assertion was vacuous for a second reason: the mint alone calls the getter
    // twice (load, then save), so it held with the switch deleted entirely.
    let scope = SCOPE;
    const scoped = vi.fn(() => scope);
    const ledger = createPurchaseIntentLedger(
      uniqueMint,
      durablePurchaseIntentPort(
        scoped,
        () => store,
        () => NOW,
      ),
    );
    const mine = ledger.intentFor(SKU, 500);
    const beforeSwitch = scoped.mock.calls.length;
    scope = 'mage_Elenwe';

    // (1) THE LAZINESS, measured ACROSS the switch rather than by the mint's own
    // two calls: a fresh operation on the SAME ledger must address the NEW row.
    // A port that captured the scope once at construction fails here.
    ledger.intentFor(RUNG, 100);
    expect(scoped.mock.calls.length).toBeGreaterThan(beforeSwitch);
    expect(store.map.has(`${PURCHASE_INTENT_ROW_PREFIX}_mage_Elenwe`)).toBe(true);
    expect(store.map.has(ROW), "the previous character's row is untouched").toBe(true);

    // (2) THE DURABLE HALF IS SCOPED. A different ledger over the new scope, which
    // is what the page after a reload really is, never sees the old key.
    expect(ledgerOver(store, () => scope).intentFor(SKU, 500).key).not.toBe(mine.key);

    // (3) AND THE IN-MEMORY HALF IS NOT, pinned because it is TRUE and because
    // the old title invited the opposite belief. openIntents is a plain Map with
    // no scope component and intentFor reads it BEFORE it ever calls load(), so
    // the same instance still hands back the key it minted for the previous
    // character. No shipped session reaches this: the only in-world character
    // exit is the options logout, whose last statement is location.reload(), and
    // that destroys the Hud and both ledgers with it. Pinned here so a future
    // change that keeps a window alive across a character switch reds in this
    // file rather than on a real-money wire.
    expect(ledger.intentFor(SKU, 500).key).toBe(mine.key);
  });
});
