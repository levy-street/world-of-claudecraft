// The store's purchase-intent ledger: ONE idempotency key per open purchase
// attempt, held stable across retries until an authoritative result proves
// the attempt is finished.
//
// WHY THIS EXISTS (without it, it is a real-money bug). The store's spend hook
// mints a fresh idempotency key on every call. A weapon skin survives that
// because a skin purchase writes a grant row, so a replay under any key
// answers already_granted and debits nothing. STORAGE SKUs are REPEATABLE and
// write NO grant row: the economy service debits the same storage item as
// many times as it is asked to, deduping ONLY on the idempotency key. A retry
// carrying a fresh key is therefore a SECOND REAL CHARGE. The exactly-once
// design behind storage purchases keys entirely on the client-minted key, so
// holding that key stable across retries is the client's half of the contract.
//
// THE RULE. An attempt closes its intent only when the outcome PROVES where
// the money ended up: granted (a real purchase, or one of the granted-true
// replays), or a refusal from the definitive set below (nothing was debited).
// Everything else is AMBIGUOUS: the debit may have landed and the reply may
// have been lost, and the two are indistinguishable from here. That covers
// 'unavailable' and any token this build does not recognise, and also
// 'purchase_in_progress', which reads like a clean refusal but usually means
// THIS VERY INTENT is still running under THIS VERY KEY, possibly mid-debit.
// The intent stays open so the next attempt reuses the same key and the
// service replays its own answer instead of charging again. The failure
// direction is deliberate:
// an unrecognised token retries under one key (at worst an idempotent replay)
// rather than minting a second key over a live debit.
//
// THE COST IS FROZEN WITH THE KEY, and that is the second half of the money
// contract, not a convenience. The game server answers a retry by loading the
// prior row for the key and comparing a FOUR-FIELD IDENTITY (accountId,
// characterId, itemId, expectedCostClaudium) BEFORE it ever branches on
// prior.status, returning refusal('already_granted') on any mismatch. Unlike
// the not_next_rung and does_not_fit arms a few lines below it, that arm has
// NO ambiguousOpenRow diversion, so it fires even when the row is still
// 'pending', which is exactly when the key may be sitting behind a live
// debit. The client can reach it unaided: attempt 1 under key K at cost C1
// answers 'unavailable' and correctly retains K; a background store refresh
// moves the catalog price to C2; the player clicks again; the same K now
// carries C2; the tuple mismatches; the definitive-looking 'already_granted'
// closes the intent; and the next click mints a fresh key over the still-live
// K debit and pays twice.
//
// So every retry of an intent MUST re-send the cost frozen at mint time, never
// a refreshed catalog price. Then the tuple always matches and the flow falls
// through to the correct pending-prior handling. A genuine catalog price move
// is not lost: it comes back from the SERVICE as a real 'price_changed', which
// is definitive, settles the row 'refused', and moves no money. Do not
// "simplify" the freeze away by reading the live price at the call site.
//
// DOM-free, dependency-free, and deterministic: the caller injects the key
// minter, so this module never touches crypto, the clock, or the network.

/** Reasons that PROVE the attempt moved no money, so the intent is finished
 *  and the next deliberate purchase must mint a fresh key. Anything absent
 *  from this set is ambiguous and RETAINS the key.
 *
 *  Membership is earned one token at a time, by an argument that THIS key
 *  cannot be sitting behind a debit. Timing alone is not that argument: a
 *  gate can return early and still say nothing about a prior attempt under
 *  the same key. Nine tokens qualify, in three groups, each commented below
 *  with the reason it is safe. */
export const DEFINITIVE_SPEND_REFUSALS: ReadonlySet<string> = new Set([
  // GROUP 1: the six the economy service itself declares definitive
  // (DEFINITIVE_REFUSAL_REASONS in server/storage_purchases.ts). The server
  // settles the purchase row 'refused' on exactly these, so the client may
  // close its intent on exactly these too. Containment is pinned against that
  // real server source by tests/store_purchase_intent.test.ts.
  //
  // The balance could not cover the price. Nothing was debited.
  'insufficient_balance',
  // No such SKU in the catalog. Nothing was debited.
  'unknown_item',
  // With granted FALSE: this key was already spent on a DIFFERENT purchase, a
  // key conflict, and THIS attempt debited nothing. The granted flag is
  // checked FIRST, so the granted-TRUE already_granted (a successful replay of
  // THIS purchase) never reaches the set lookup.
  'already_granted',
  // The SKU is not spendable on this surface. Refused before debit.
  'not_cosmetic',
  // The declared kind disagrees with the catalog. Refused before debit.
  'kind_mismatch',
  // The declared cost no longer matches the catalog, so the spend was rejected
  // rather than settled at a stale price.
  'price_changed',

  // GROUP 2: the game server's own structural rejection. Bad key charset, a
  // declared cost over the cap, missing fields: the request dies at the wire
  // boundary and the economy service is never called, so no debit can exist.
  //
  // DO NOT "fix" this against the server's DEFINITIVE_REFUSAL_REASONS, which
  // deliberately EXCLUDES this token. That exclusion is about a DIFFERENT
  // sender: the service emits invalid_request only from its admin recovery
  // surface, where it could in principle follow a debit, so the server refuses
  // to settle a row 'refused' on it. The comment in that file states the
  // game's own invalid_request is returned to the caller directly and is never
  // a spend RESULT, which is precisely the token the client sees here. The two
  // lists are meant to differ.
  'invalid_request',

  // GROUP 3: the pre-spend dry run. Both refuse before any money moves, AND
  // the code explicitly diverts the one dangerous case: when a PENDING prior
  // row already exists for this key, these two arms call ambiguousOpenRow,
  // which answers 'unavailable' instead. So a client-visible token from this
  // group provably had no pending prior, hence no debit under this key.
  //
  // The ladder gate: this rung is not the character's next unpurchased one.
  'not_next_rung',
  // The ceiling gate: the full grant would overshoot the purchasable ceiling.
  'does_not_fit',

  // DELIBERATELY ABSENT, all for the same reason: they are returned BEFORE the
  // flow reads the pending row for this idempotency key, so none of them says
  // anything about whether THIS key already took money.
  //   'unavailable'          never-reached and debited-but-reply-lost are
  //                          indistinguishable from here.
  //   'purchase_in_progress' a concurrent attempt is running RIGHT NOW, and in
  //                          the ordinary case that attempt is THE SAME INTENT
  //                          under THE SAME KEY, possibly mid-debit. Closing
  //                          on it would make the next click mint a fresh key
  //                          and pay twice.
  //   'no_live_character'    returns at the very top of the flow, before the
  //                          pending row is ever consulted.
  // All three must retain the key and let the retry replay.
]);

export interface PurchaseIntent {
  key: string;
  /** The cost frozen when this intent was minted. Every retry of the intent
   *  MUST send this, never a refreshed catalog price: the server's prior-row
   *  identity check includes expectedCostClaudium and answers a mismatch with
   *  a definitive-looking already_granted even when the row is still pending
   *  (the header walks the whole second-charge path). */
  costClaudium: number;
}

/** The DURABILITY port, and its whole surface is data in and data out.
 *
 *  The ledger never learns what is behind it: no clock, no storage, no scope, no
 *  knowledge that a browser exists. That is what keeps this module registered in
 *  UI_PURE_CORES, and the registration is load-bearing rather than decorative,
 *  because the determinism scan is what lets a caller inject a key minter and
 *  unit-test the money rules with no host. src/ui/purchase_intent_record.ts owns
 *  every guard and src/ui/purchase_intent_durability.ts binds the host.
 *
 *  A port is OPTIONAL. Omit it and this module behaves exactly as it did before
 *  durability existed, which is what keeps the offline world, and every existing
 *  arm of tests/store_purchase_intent.test.ts, unchanged. */
export interface PurchaseIntentDurablePort {
  /** The stored intent for this item, or null. Every reason a stored one may not
   *  be handed back (wrong scope, stale, bad charset, unparseable) resolves to
   *  null HERE, so this module sees only "there is one" or "there is not". */
  load(itemId: string): PurchaseIntent | null;
  /** Persist a FRESHLY MINTED intent. Called on the mint and never on a restore,
   *  so an intent's age runs from when it was first minted: re-stamping it on
   *  every read would let a player hold one open forever by clicking. */
  save(itemId: string, intent: PurchaseIntent): void;
  /** Forget this item's intent. Called from exactly the paths that delete from
   *  the map below, which is what stops the two stores disagreeing about what
   *  is open. */
  drop(itemId: string): void;
}

export interface PurchaseIntentLedger {
  /** The open intent for this item, minting one (freezing costClaudium) on
   *  first use. A later call returns the STORED intent and IGNORES the cost
   *  argument, which is what holds the key and its declared cost together for
   *  every retry until settle() closes the intent. */
  intentFor(itemId: string, costClaudium: number): PurchaseIntent;
  /** Close or keep the intent from an authoritative spend result. */
  settle(itemId: string, result: { granted: boolean; reason: string | null }): void;
  /** Drop the intent unconditionally (the user abandoned it). */
  abandon(itemId: string): void;
  /** Test/introspection: is an intent open for this item. */
  isOpen(itemId: string): boolean;
}

/** Build a ledger over a caller-supplied key minter.
 *
 *  Keys must satisfy the server's STORAGE_KEY_PATTERN, `^[A-Za-z0-9_.:-]{1,200}$`.
 *  This module never mints one itself, which is what keeps it pure and
 *  deterministic; the caller passes a crypto-random minter. Both minters in the
 *  tree fit that charset on both of their arms: crypto.randomUUID emits hex and
 *  hyphens, and each non-crypto fallback emits a literal prefix plus digits,
 *  lowercase letters and hyphens. Both windows' caller is mintIntentKey in
 *  src/ui/purchase_intent_key.ts, whose two arms are pinned against the pattern
 *  by tests/daily_rewards_store_behavior.test.ts; the `intent-` prefix belongs to
 *  its FALLBACK arm alone, because crypto.randomUUID emits a bare UUID.
 *  src/net/economy_sdk.ts's newIdempotencyKey (prefix `idem-`) is the one
 *  main.ts falls back to when no caller key is supplied. */
export function createPurchaseIntentLedger(
  mintKey: () => string,
  durable?: PurchaseIntentDurablePort,
): PurchaseIntentLedger {
  const openIntents = new Map<string, PurchaseIntent>();
  // Intents handed back by the durable store rather than minted here.
  //
  // THIS SET IS WHAT MAKES abandon() SAFE ACROSS A PAGE. A caller's "this key
  // has already reached the service" latch is its own in-memory set, and that
  // set dies with the page while the durable record does not. So on the page
  // AFTER an ambiguous outcome the caller believes nothing was sent, and its
  // cancel path calls abandon() on a key that may be sitting behind a live
  // debit. Dropping it there is the exact second charge this module exists to
  // prevent: the next click would mint a fresh key over that debit.
  //
  // A restored intent is therefore treated as possibly-sent, which is the
  // conservative direction and the only one available: nothing on this side can
  // tell a restored-and-sent key from a restored-but-never-sent one. The cost of
  // being wrong is that a never-sent key lingers until its own expiry, and
  // re-using it is harmless (it has no prior row, so the retry is an ordinary
  // fresh attempt, and a moved catalog price comes back as a definitive
  // price_changed that mints afresh).
  const restored = new Set<string>();
  // Close the intent in BOTH stores, from the one place, so a path can never
  // clear one and leave the other. Every caller of this is a path that ENDS the
  // attempt with an AUTHORITATIVE answer; see the port's own doc for why that
  // list has to be complete.
  const close = (itemId: string): void => {
    openIntents.delete(itemId);
    // EQUIVALENT-MUTANT NOTE, recorded so a later reader does not hunt for the
    // arm that pins this line. Dropping it moves no money and changes no
    // reachable outcome: the durable record is gone on the very next statement,
    // the only reader of `restored` is abandon(), and a fresh mint clears the
    // marking again. The one thing it would cost is not an outcome: a stale
    // marking makes a LATER abandon skip its drop(), and drop() is also one of
    // the places the expiry sweep rides, so the row would lose that single
    // reaping opportunity until the next read. Kept as hygiene, and because the
    // sibling clear on the mint path IS load-bearing (an expired record mints
    // afresh, and that intent must be abandonable outright).
    restored.delete(itemId);
    durable?.drop(itemId);
  };
  return {
    intentFor(itemId: string, costClaudium: number): PurchaseIntent {
      const open = openIntents.get(itemId);
      // The stored intent wins and the cost argument is dropped on the floor:
      // a retry that arrives carrying a refreshed catalog price must still go
      // out under the frozen one.
      if (open !== undefined) return open;
      // The DURABLE store is asked before anything is minted, which is the whole
      // of ruling 19: the page that minted the key is gone, so the map is empty,
      // and without this the next click mints a SECOND key over a debit that may
      // still be live. What comes back carries its own frozen cost, never a
      // refreshed catalog price, for the reason the header walks end to end.
      const stored = durable?.load(itemId) ?? null;
      if (stored !== null) {
        openIntents.set(itemId, stored);
        restored.add(itemId);
        return stored;
      }
      // Frozen so a caller cannot edit the cost out from under the key it is
      // paired with; that pairing is the whole point of this module.
      const intent: PurchaseIntent = Object.freeze({ key: mintKey(), costClaudium });
      openIntents.set(itemId, intent);
      restored.delete(itemId);
      durable?.save(itemId, intent);
      return intent;
    },
    settle(itemId: string, result: { granted: boolean; reason: string | null }): void {
      // granted FIRST: it is the one discriminator, and it is what makes the
      // granted-true replays (already_granted, apply_deferred,
      // grant_unresolved) close the intent rather than fall through.
      if (result.granted) {
        close(itemId);
        return;
      }
      if (result.reason !== null && DEFINITIVE_SPEND_REFUSALS.has(result.reason)) {
        close(itemId);
        return;
      }
      // Ambiguous: keep the key so the next attempt replays under it. The
      // durable copy is kept too, deliberately: a reload of an ambiguous attempt
      // is exactly the case durability exists for.
    },
    abandon(itemId: string): void {
      openIntents.delete(itemId);
      // A RESTORED key keeps its durable record: see the `restored` set above.
      // Only an intent this page MINTED is provably unsent, and only that one
      // may be forgotten outright.
      if (!restored.has(itemId)) durable?.drop(itemId);
    },
    isOpen(itemId: string): boolean {
      return openIntents.has(itemId);
    },
  };
}
