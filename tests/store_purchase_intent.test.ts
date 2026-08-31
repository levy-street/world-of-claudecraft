import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createPurchaseIntentLedger,
  DEFINITIVE_SPEND_REFUSALS,
} from '../src/ui/store_purchase_intent';

/** A deterministic minter that also counts its calls, so a test can prove the
 *  ledger asked for exactly one key per intent and passed it through unchanged. */
function countingMinter(): { mint: () => string; calls: () => number; minted: string[] } {
  const minted: string[] = [];
  return {
    mint: () => {
      const key = `key-${minted.length + 1}`;
      minted.push(key);
      return key;
    },
    calls: () => minted.length,
    minted,
  };
}

/** The declared cost most tests do not care about; the freeze tests use their
 *  own literals so the two prices are visibly different. */
const COST = 800;

/** The server source with comments stripped, LINE comments first so a `//`
 *  inside a block comment cannot swallow the terminator. Both cross-boundary
 *  pins below read through this: on the raw text a member commented OUT rather
 *  than deleted still parses as present, which is precisely the direction that
 *  matters (the client would keep treating a token the server no longer settles
 *  on as definitive, and close an intent over a possibly-live debit). */
function serverSourceWithoutComments(): string {
  return readFileSync('server/storage_purchases.ts', 'utf8')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('createPurchaseIntentLedger', () => {
  it('MONEY PIN: a retry reuses the key AND the cost frozen at mint time', () => {
    // The bug this pins. The game server compares the prior row's four-field
    // identity (accountId, characterId, itemId, expectedCostClaudium) BEFORE
    // it branches on prior.status, and answers any mismatch with
    // refusal('already_granted') with no ambiguousOpenRow diversion. So a
    // retry that carried a REFRESHED catalog price would be told
    // 'already_granted', a definitive token, closing the intent and letting
    // the next click mint a second key over a still-pending debit.
    const minter = countingMinter();
    const ledger = createPurchaseIntentLedger(minter.mint);
    const first = ledger.intentFor('strongbox_charter_2', 100);
    // A background store refresh moved the catalog price under the player.
    const retry = ledger.intentFor('strongbox_charter_2', 250);
    expect(retry.key).toBe(first.key);
    expect(retry.costClaudium).toBe(100);
    expect(minter.calls()).toBe(1);
  });

  it('freezes the NEW cost once a settle has closed the previous intent', () => {
    const minter = countingMinter();
    const ledger = createPurchaseIntentLedger(minter.mint);
    const first = ledger.intentFor('strongbox_charter_2', 100);
    ledger.settle('strongbox_charter_2', { granted: true, reason: null });
    const next = ledger.intentFor('strongbox_charter_2', 250);
    expect(next.key).not.toBe(first.key);
    expect(next.costClaudium).toBe(250);
    expect(minter.calls()).toBe(2);
  });

  it('hands back a frozen intent, so a caller cannot edit the cost off the key', () => {
    const ledger = createPurchaseIntentLedger(countingMinter().mint);
    const intent = ledger.intentFor('strongbox_charter_2', 100);
    expect(Object.isFrozen(intent)).toBe(true);
    expect(ledger.intentFor('strongbox_charter_2', 100).costClaudium).toBe(100);
  });

  it('freezes a cost per item, not globally', () => {
    const ledger = createPurchaseIntentLedger(countingMinter().mint);
    const one = ledger.intentFor('strongbox_charter_1', 400);
    const two = ledger.intentFor('strongbox_charter_2', 800);
    expect(one.costClaudium).toBe(400);
    expect(two.costClaudium).toBe(800);
    expect(ledger.intentFor('strongbox_charter_1', 999).costClaudium).toBe(400);
  });

  it('returns the same key for every retry while the intent is open', () => {
    const minter = countingMinter();
    const ledger = createPurchaseIntentLedger(minter.mint);
    const first = ledger.intentFor('strongbox_charter_1', COST).key;
    expect(ledger.intentFor('strongbox_charter_1', COST).key).toBe(first);
    expect(ledger.intentFor('strongbox_charter_1', COST).key).toBe(first);
    expect(minter.calls()).toBe(1);
    expect(first).toBe('key-1');
    expect(ledger.isOpen('strongbox_charter_1')).toBe(true);
  });

  it('mints a fresh key for the next purchase after a granted settle', () => {
    const minter = countingMinter();
    const ledger = createPurchaseIntentLedger(minter.mint);
    const first = ledger.intentFor('strongbox_charter_1', COST).key;
    ledger.settle('strongbox_charter_1', { granted: true, reason: null });
    expect(ledger.isOpen('strongbox_charter_1')).toBe(false);
    expect(ledger.intentFor('strongbox_charter_1', COST).key).not.toBe(first);
    expect(minter.calls()).toBe(2);
  });

  it.each(['already_granted', 'apply_deferred', 'grant_unresolved'])(
    'closes the intent on the granted-true replay %s',
    (reason) => {
      const minter = countingMinter();
      const ledger = createPurchaseIntentLedger(minter.mint);
      const first = ledger.intentFor('strongbox_charter_2', COST).key;
      ledger.settle('strongbox_charter_2', { granted: true, reason });
      expect(ledger.isOpen('strongbox_charter_2')).toBe(false);
      expect(ledger.intentFor('strongbox_charter_2', COST).key).not.toBe(first);
    },
  );

  it.each([...DEFINITIVE_SPEND_REFUSALS])(
    'closes the intent on the definitive refusal %s',
    (reason) => {
      const minter = countingMinter();
      const ledger = createPurchaseIntentLedger(minter.mint);
      const first = ledger.intentFor('strongbox_charter_3', COST).key;
      ledger.settle('strongbox_charter_3', { granted: false, reason });
      expect(ledger.isOpen('strongbox_charter_3')).toBe(false);
      const next = ledger.intentFor('strongbox_charter_3', COST).key;
      expect(next).not.toBe(first);
      expect(minter.calls()).toBe(2);
    },
  );

  // THE FIVE MONEY PINS. Every one of these outcomes leaves open the
  // possibility that this key already took money, so the ledger must hand the
  // SAME key back and let the server replay its own answer. Minting a fresh
  // key on any of them is a second real charge, because a storage SKU is
  // repeatable and dedupes ONLY on the idempotency key.
  it.each([
    [
      'unavailable',
      'unavailable',
      'never-reached and debited-but-reply-lost are indistinguishable',
    ],
    [
      'purchase_in_progress',
      'purchase_in_progress',
      'the concurrent attempt is usually THIS intent under THIS key, mid-debit',
    ],
    [
      'no_live_character',
      'no_live_character',
      'returns before the flow ever reads the pending row for this key',
    ],
    [
      'an unrecognised token',
      'some_future_service_token',
      'a token this build does not know could be hiding a debit',
    ],
    ['no reason at all', null, 'a malformed reply proves nothing about the debit'],
  ])('MONEY PIN: a refusal of %s RETAINS the key (%s)', (_label, reason, _why) => {
    const minter = countingMinter();
    const ledger = createPurchaseIntentLedger(minter.mint);
    const first = ledger.intentFor('strongbox_charter_complete', COST).key;
    ledger.settle('strongbox_charter_complete', { granted: false, reason });
    expect(ledger.isOpen('strongbox_charter_complete')).toBe(true);
    expect(ledger.intentFor('strongbox_charter_complete', COST).key).toBe(first);
    expect(minter.calls()).toBe(1);
  });

  it('MONEY PIN: an empty-string reason RETAINS the key (falsy is not definitive)', () => {
    const minter = countingMinter();
    const ledger = createPurchaseIntentLedger(minter.mint);
    const first = ledger.intentFor('strongbox_charter_1', COST).key;
    ledger.settle('strongbox_charter_1', { granted: false, reason: '' });
    expect(ledger.isOpen('strongbox_charter_1')).toBe(true);
    expect(ledger.intentFor('strongbox_charter_1', COST).key).toBe(first);
    expect(minter.calls()).toBe(1);
  });

  it('keeps one intent per item and settles them independently', () => {
    const minter = countingMinter();
    const ledger = createPurchaseIntentLedger(minter.mint);
    const one = ledger.intentFor('strongbox_charter_1', COST).key;
    const two = ledger.intentFor('strongbox_charter_2', COST).key;
    expect(one).not.toBe(two);
    ledger.settle('strongbox_charter_1', { granted: true, reason: null });
    expect(ledger.isOpen('strongbox_charter_1')).toBe(false);
    expect(ledger.isOpen('strongbox_charter_2')).toBe(true);
    expect(ledger.intentFor('strongbox_charter_2', COST).key).toBe(two);
  });

  it('drops the intent on abandon', () => {
    const minter = countingMinter();
    const ledger = createPurchaseIntentLedger(minter.mint);
    const first = ledger.intentFor('strongbox_charter_1', COST).key;
    ledger.abandon('strongbox_charter_1');
    expect(ledger.isOpen('strongbox_charter_1')).toBe(false);
    expect(ledger.intentFor('strongbox_charter_1', COST).key).not.toBe(first);
  });

  it('passes every minted key through unchanged, one call per intent', () => {
    const minter = countingMinter();
    const ledger = createPurchaseIntentLedger(minter.mint);
    const keys = [
      ledger.intentFor('a', COST).key,
      ledger.intentFor('b', COST).key,
      ledger.intentFor('a', COST).key,
      ledger.intentFor('b', COST).key,
      ledger.intentFor('c', COST).key,
    ];
    expect(keys).toEqual(['key-1', 'key-2', 'key-1', 'key-2', 'key-3']);
    expect(minter.calls()).toBe(3);
    expect(minter.minted).toEqual(['key-1', 'key-2', 'key-3']);
  });

  it('is a no-op to settle an item that has no open intent', () => {
    const minter = countingMinter();
    const ledger = createPurchaseIntentLedger(minter.mint);
    ledger.settle('strongbox_charter_1', { granted: true, reason: null });
    expect(ledger.isOpen('strongbox_charter_1')).toBe(false);
    expect(minter.calls()).toBe(0);
  });
});

describe('DEFINITIVE_SPEND_REFUSALS', () => {
  it('never contains unavailable, the ambiguous token', () => {
    expect(DEFINITIVE_SPEND_REFUSALS.has('unavailable')).toBe(false);
  });

  it('never contains the two early gates that return before the pending-row read', () => {
    // Both are returned before the flow reads the pending row for this key, so
    // neither proves this key took no money. purchase_in_progress in
    // particular usually means THIS intent is still running under THIS key.
    expect(DEFINITIVE_SPEND_REFUSALS.has('purchase_in_progress')).toBe(false);
    expect(DEFINITIVE_SPEND_REFUSALS.has('no_live_character')).toBe(false);
  });

  it('pins the exact membership, so an addition or a removal cannot land silently', () => {
    // The it.each arms above are generated FROM this set, so they can never
    // catch a removal. This literal list is the only pin that does.
    expect([...DEFINITIVE_SPEND_REFUSALS].sort()).toEqual([
      'already_granted',
      'does_not_fit',
      'insufficient_balance',
      'invalid_request',
      'kind_mismatch',
      'not_cosmetic',
      'not_next_rung',
      'price_changed',
      'unknown_item',
    ]);
  });

  it('contains every reason the server declares definitive, so the two cannot drift', () => {
    // The server constant is not exported, so parse it out of the real source
    // and prove the parse found all six BEFORE comparing: a parse failure must
    // never pass vacuously.
    const source = serverSourceWithoutComments();
    const block = /const DEFINITIVE_REFUSAL_REASONS = new Set\(\[([\s\S]*?)\]\)/.exec(source);
    expect(block).not.toBeNull();
    const serverReasons = [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(serverReasons).toEqual([
      'insufficient_balance',
      'unknown_item',
      'already_granted',
      'not_cosmetic',
      'kind_mismatch',
      'price_changed',
    ]);
    expect(serverReasons).toHaveLength(6);
    for (const reason of serverReasons) {
      expect(DEFINITIVE_SPEND_REFUSALS.has(reason)).toBe(true);
    }
  });

  it('deliberately diverges from the server set on invalid_request, in both directions', () => {
    // Containment above is one-way on purpose. The server excludes
    // invalid_request because the SERVICE emits it only from its admin
    // recovery surface, where it could follow a debit. The client includes it
    // because the token it sees comes from the game's own wire-boundary
    // rejection, which never calls the service. Pinning the divergence stops a
    // future reader from "fixing" the two lists into agreement.
    const source = serverSourceWithoutComments();
    const block = /const DEFINITIVE_REFUSAL_REASONS = new Set\(\[([\s\S]*?)\]\)/.exec(source);
    expect(block).not.toBeNull();
    const serverReasons = [...(block?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(serverReasons).toHaveLength(6);
    expect(serverReasons).not.toContain('invalid_request');
    expect(DEFINITIVE_SPEND_REFUSALS.has('invalid_request')).toBe(true);
  });
});
