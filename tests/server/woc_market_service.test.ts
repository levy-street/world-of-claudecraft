// $WOC Exchange service lifecycle, driven end to end through the in-memory
// FakeWocMarketDb (tests/server/helpers/fake_woc_market_db.ts), the dev
// economy (createDevWocMarketEconomy on an injected fake clock: fixed price,
// instant finality, always-successful bond refunds), and a hand-rolled
// custody bridge backed by real extractTradableCopy inventory math. Pins the
// money-critical paths of server/woc_market.ts: escrow-by-removal listing
// custody (extract, persist, compensate-on-refusal), the bid refusal ladder
// and the bond lifecycle (pending -> held -> refund/forfeit), anti-snipe
// extension and its cap, the sweep's close / settle / expire / cascade /
// return arms, buy-now locking over a standing auction, crash-safe delivery
// reconciliation (book-once by custodyRef), and the admin suspension
// teardown. Also the fail-closed and recovery arms either side of those: quote
// expiry and signature replay on both the bond and the settlement leg, the
// seller cancel ladder, the abandoned buy-now lock, the guard ALLOW arms
// (lapsed suspension, unreadable balance), stranded-listing reclaim, the
// durable custody claim ledger, and the account-scoped owned loaders behind
// the requireOwned 404. Every scenario asserts BOTH the returned values and
// the resulting fake-db/custody state.

import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';
import type {
  DesktopWalletStepUpAuthorization,
  DesktopWalletTransactionAuthorization,
} from '../../server/desktop_wallet_handoff';
import type {
  CharacterSaveArgs,
  Refused,
  WocBidRow,
  WocBrowseQuery,
  WocCustodyExtract,
  WocCustodyGrant,
  WocListingRow,
  WocMarketCustody,
  WocMarketDeps,
  WocMarketEconomy,
  WocQuoteIntent,
  WocSettlementRow,
} from '../../server/woc_market';
import { WocMarketService } from '../../server/woc_market';
import { createDevWocMarketEconomy } from '../../server/woc_market_proxy';
import type { WocListingParams } from '../../server/woc_market_rules';
import {
  bondCents,
  listingReturnCustodyRef,
  listingSoldNoticeCustodyRef,
  settlementCustodyRef,
  WOC_MARKET_ANTI_SNIPE_CAP_SECONDS,
  WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS,
  WOC_MARKET_ANTI_SNIPE_WINDOW_SECONDS,
  WOC_MARKET_BOND_PENDING_TTL_SECONDS,
  WOC_MARKET_BOND_POLL_PARK_SECONDS,
  WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS,
  WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR,
  WOC_MARKET_BUY_NOW_LOCK_SECONDS,
  WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS,
  WOC_MARKET_DIRECTED_OFFER_TTL_SECONDS,
  WOC_MARKET_MAX_ACTIVE_LISTINGS,
  WOC_MARKET_OFFER_CONVERGE_MAX_AGE_SECONDS,
  WOC_MARKET_OFFER_CONVERGE_SECONDS,
  WOC_MARKET_QUOTE_TTL_SECONDS,
  WOC_MARKET_RESTRICTED_POLICY,
  WOC_MARKET_SETTLEMENT_WINDOW_SECONDS,
  WOC_MARKET_STRANDED_RECLAIM_SECONDS,
} from '../../server/woc_market_rules';
import { WOC_MARKET_STEPUP_TTL_MS } from '../../server/woc_market_stepup';
import { ITEMS } from '../../src/sim/data';
import type { ExtractRef } from '../../src/sim/inventory_extract';
import { extractTradableCopy } from '../../src/sim/inventory_extract';
import type { CharacterState } from '../../src/sim/sim';
import type { InvSlot, ItemInstancePayload } from '../../src/sim/types';
import { FakeWocMarketDb } from './helpers/fake_woc_market_db';

// ---------------------------------------------------------------------------
// Fixture: a real eligible item from the content tables
// ---------------------------------------------------------------------------

function eligibleEquipmentId(quality: 'epic' | 'rare'): string {
  const id = Object.keys(ITEMS).find((candidate) => {
    const def = ITEMS[candidate];
    return (
      def.quality === quality &&
      !def.soulbound &&
      def.slot !== undefined &&
      !def.noMarketList &&
      def.kind !== 'quest'
    );
  });
  if (!id) throw new Error(`no eligible ${quality} equipment def in ITEMS`);
  return id;
}

const EPIC_ITEM = eligibleEquipmentId('epic');
const RARE_ITEM = eligibleEquipmentId('rare');

// ---------------------------------------------------------------------------
// Fake custody: a Map of bags plus a book-once parcel ledger
// ---------------------------------------------------------------------------

interface BookedParcel {
  recipientKey: string;
  letter: 'delivery' | 'return' | 'sold_notice';
  items: InvSlot[];
  custodyRef: string;
}

class FakeCustody implements WocMarketCustody {
  /** Every runSerialized invocation's characterId, in order: the pin that the
   *  listing critical section actually rides the per-character FIFO seam. */
  readonly serializedRuns: number[] = [];
  /** Force the NEXT runSerialized to answer 'contended' without running the
   *  job (the queue-wait deadline / depth-cap refusal). */
  failNextRunSerialized = false;
  /** Every escrowSessionLost signal, in order (the terminal-arm pins). */
  readonly sessionLost: Array<{ characterId: number; kind: 'fenced' | 'ambiguous' }> = [];

  async runSerialized<T>(characterId: number, job: () => Promise<T>): Promise<T | 'contended'> {
    this.serializedRuns.push(characterId);
    if (this.failNextRunSerialized) {
      this.failNextRunSerialized = false;
      return 'contended';
    }
    return job();
  }

  /** Every persistGrantSerialized invocation's characterId, in order: the
   *  pin that the delivered save rides the FIFO grant entry since the
   *  write-path rider closed the commitGrant carve-out. */
  readonly grantRuns: number[] = [];
  /** Force the NEXT grant persist to answer 'busy' without running (the
   *  wedged-FIFO head-of-line refusal; nothing serialized, nothing written). */
  failNextGrantBusy = false;
  /** Force EVERY grant persist to answer 'busy' (the save-wave wedge shape
   *  the busy budget exists for). */
  alwaysGrantBusy = false;

  async persistGrantSerialized<T>(
    accountId: number,
    characterId: number,
    expectedNonce: string | undefined,
    persist: (save: CharacterSaveArgs) => Promise<T>,
  ): Promise<T | 'busy' | 'session_lost'> {
    this.grantRuns.push(characterId);
    if (this.alwaysGrantBusy) return 'busy';
    if (this.failNextGrantBusy) {
      this.failNextGrantBusy = false;
      return 'busy';
    }
    // The real entry validates UNDER the FIFO slot: session live, owned, and
    // the lease unrotated since the grant.
    if (!this.bags.has(characterId)) return 'session_lost';
    if (this.owners.get(characterId) !== accountId) return 'session_lost';
    if (this.leaseNonce !== expectedNonce) return 'session_lost';
    return persist({
      characterId,
      level: 10,
      state: {} as unknown as CharacterState,
      leaseNonce: this.leaseNonce,
    });
  }

  ownsLiveCharacter(accountId: number, characterId: number): boolean {
    return this.bags.has(characterId) && this.owners.get(characterId) === accountId;
  }

  escrowSessionLost(_pid: number, characterId: number, kind: 'fenced' | 'ambiguous'): void {
    this.sessionLost.push({ characterId, kind });
  }

  readonly bags = new Map<number, InvSlot[]>();
  readonly owners = new Map<number, number>();
  readonly names = new Map<number, string>();
  readonly parcels: BookedParcel[] = [];
  /** Every persistMailParcel ATTEMPT's custodyRef, failures included: the
   *  durable-claim tests assert on call counts, because the fake's own
   *  book-once dedupe below would mask a second booking in `parcels`. */
  readonly persistCalls: string[] = [];
  /** Throw ONCE on the next persistMailParcel (the crash-retry scenario). */
  failNextPersist = false;
  /** How many times grantCopy actually granted: the double-copy pins count
   *  grants, because the bag length alone can mask a grant-then-restore. */
  grantCalls = 0;
  /** The live session identity grant/snapshot saves carry; a test rotates it
   *  to model a relog (a takeover mints a new lease nonce). */
  leaseNonce: string | undefined = 'nonce';

  /** Every extractCopy ATTEMPT's characterId, in order. The "refused before
   *  custody moved" pins need a witness that no extraction was even reached:
   *  a bag-length check cannot tell a never-extracted copy from an
   *  extracted-then-restored one. */
  readonly extractAttempts: number[] = [];

  extractCopy(accountId: number, characterId: number, ref: ExtractRef): WocCustodyExtract {
    this.extractAttempts.push(characterId);
    const inventory = this.bags.get(characterId);
    if (!inventory) return { ok: false, reason: 'offline' };
    if (this.owners.get(characterId) !== accountId) return { ok: false, reason: 'not_yours' };
    const out = extractTradableCopy(inventory, ref, ITEMS[ref.itemId]);
    if (!out.ok) return out;
    return {
      ok: true,
      // The fake has no sim pids; the characterId doubles as one.
      pid: characterId,
      extracted: out.extracted,
      characterName: this.names.get(characterId) ?? `char-${characterId}`,
      save: {
        characterId,
        level: 10,
        // The service never reads the state blob; it only hands it to the db.
        state: {} as unknown as CharacterState,
        leaseNonce: 'nonce',
      },
    };
  }

  /** Characters whose bags are full: grantCopy refuses them, so a test can
   *  drive the mail fallback without modelling real capacity. */
  readonly fullBags = new Set<number>();
  /** Force the NEXT grantCopy to report the AMBIGUOUS refusal (consumed on
   *  use): the copy reaches the LIVE bags and only the re-serialize fails, so
   *  the caller may neither mail over it nor treat the grant as refused. */
  failNextGrantAmbiguous = false;

  grantCopy(accountId: number, characterId: number, slot: InvSlot): WocCustodyGrant {
    const inventory = this.bags.get(characterId);
    // Same three refusals, in the same order, as the real bridge: offline (no
    // live session), wrong owner, no room.
    if (!inventory) return { ok: false, reason: 'offline' };
    if (this.owners.get(characterId) !== accountId) return { ok: false, reason: 'not_yours' };
    if (this.fullBags.has(characterId)) return { ok: false, reason: 'no_space' };
    inventory.push(slot);
    this.grantCalls++;
    if (this.failNextGrantAmbiguous) {
      this.failNextGrantAmbiguous = false;
      // Mirrors the real bridge's ordering: grantTradableCopy already mutated
      // the bags above, and only serializeCharacter came back empty.
      return { ok: false, reason: 'ambiguous' };
    }
    return {
      ok: true,
      save: {
        characterId,
        level: 10,
        state: {} as unknown as CharacterState,
        leaseNonce: this.leaseNonce,
      },
    };
  }

  snapshotCopy(accountId: number, characterId: number): WocCustodyGrant {
    // The resume arm: same session checks as grantCopy, but the bags are
    // untouched (they already hold the earlier grant).
    const inventory = this.bags.get(characterId);
    if (!inventory) return { ok: false, reason: 'offline' };
    if (this.owners.get(characterId) !== accountId) return { ok: false, reason: 'not_yours' };
    return {
      ok: true,
      save: {
        characterId,
        level: 10,
        state: {} as unknown as CharacterState,
        leaseNonce: this.leaseNonce,
      },
    };
  }

  restoreCopy(_pid: number, characterId: number, slot: InvSlot): void {
    this.bags.get(characterId)?.push(slot);
  }

  async persistMailParcel(
    recipient: { key: string; name: string },
    letter: 'delivery' | 'return' | 'sold_notice',
    items: InvSlot[],
    custodyRef: string,
  ): Promise<void> {
    this.persistCalls.push(custodyRef);
    // Book-once by custodyRef, LIVE-BOOK semantics: the marker exists only
    // while the parcel does, exactly like the real post office (a collected
    // letter forgets its ref, so a replay would re-mail; that hazard is what
    // the durable mail intent exists to catch).
    if (!this.parcels.some((p) => p.custodyRef === custodyRef)) {
      this.parcels.push({
        recipientKey: recipient.key,
        letter,
        items: structuredClone(items),
        custodyRef,
      });
    }
    // The transient failure this hook models is the BLOB persist failing
    // AFTER the parcel entered the live book (the real bridge's in-memory
    // mailSystemParcel cannot throw transiently), which is exactly the shape
    // the resume rules must survive: parcel live, nothing durable.
    if (this.failNextPersist) {
      this.failNextPersist = false;
      throw new Error('persist failed');
    }
  }

  hasParcel(custodyRef: string): boolean {
    return this.parcels.some((p) => p.custodyRef === custodyRef);
  }

  /** The buyer collects the attachment and deletes the emptied letter: the
   *  in-book marker is destroyed, exactly like production. */
  collect(custodyRef: string): void {
    const i = this.parcels.findIndex((p) => p.custodyRef === custodyRef);
    if (i >= 0) this.parcels.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const REALM = 'Claudemoon';
/** The harness's H15 bound: 6 hours, matching the shipped default. */
const CONFIRMING_REVIEW_MS = 6 * 3600 * 1000;
const BASE_MS = 1_800_000_000_000;
const HOUR_MS = 3600 * 1000;

const SELLER = 1;
const BUYER_A = 2;
const BUYER_B = 3;
const BUYER_C = 4;
const WALLET_TWIN = 5; // a second account sharing the seller's payout wallet

const SELLER_CHAR = 11;
/** A second character on the SELLER account: an alt is still yourself. */
const SELLER_ALT_CHAR = 12;
const CHAR_A = 21;
const CHAR_B = 31;
const CHAR_C = 41;
const CHAR_TWIN = 51;

// Extra bidder accounts for the anti-snipe cap ladder.
const SNIPER_COUNT = 40;
const SNIPER_ACCOUNT_BASE = 200;
const SNIPER_CHAR_BASE = 9000;

interface Harness {
  db: FakeWocMarketDb;
  custody: FakeCustody;
  economy: WocMarketEconomy;
  service: WocMarketService;
  deps: WocMarketDeps;
  wallets: Map<number, string>;
  balances: Map<string, number>;
  now: () => number;
  setNow: (ms: number) => void;
  /** Every per-arm isolation report the sweep made (deps.onSweepError). */
  sweepErrors: [string, unknown][];
}

function makeHarness(): Harness {
  let clockMs = BASE_MS;
  const now = (): number => clockMs;
  const db = new FakeWocMarketDb({
    now,
    characters: [
      { characterId: SELLER_CHAR, accountId: SELLER, name: 'Selara', realm: REALM },
      { characterId: SELLER_ALT_CHAR, accountId: SELLER, name: 'Selara Alt', realm: REALM },
      { characterId: CHAR_A, accountId: BUYER_A, name: 'Aldan', realm: REALM },
      { characterId: CHAR_B, accountId: BUYER_B, name: 'Brint', realm: REALM },
      { characterId: CHAR_C, accountId: BUYER_C, name: 'Corvo', realm: REALM },
      { characterId: CHAR_TWIN, accountId: WALLET_TWIN, name: 'Twinja', realm: REALM },
      ...Array.from({ length: SNIPER_COUNT }, (_, i) => ({
        characterId: SNIPER_CHAR_BASE + i,
        accountId: SNIPER_ACCOUNT_BASE + i,
        name: `Sniper${i}`,
        realm: REALM,
      })),
    ],
  });
  const custody = new FakeCustody();
  custody.owners.set(SELLER_CHAR, SELLER);
  custody.names.set(SELLER_CHAR, 'Selara');
  custody.bags.set(SELLER_CHAR, [
    { itemId: EPIC_ITEM, count: 1 },
    { itemId: RARE_ITEM, count: 1 },
  ]);
  const wallets = new Map<number, string>([
    [SELLER, 'wallet-seller'],
    [BUYER_A, 'wallet-a'],
    [BUYER_B, 'wallet-b'],
    [BUYER_C, 'wallet-c'],
    [WALLET_TWIN, 'wallet-seller'],
  ]);
  const balances = new Map<string, number>([
    ['wallet-seller', 100_000_000],
    ['wallet-a', 100_000_000],
    ['wallet-b', 100_000_000],
    ['wallet-c', 100_000_000],
  ]);
  const economy = createDevWocMarketEconomy(now);
  const sweepErrors: [string, unknown][] = [];
  const deps: WocMarketDeps = {
    db,
    economy,
    custody,
    verifiedWallet: async (account) => wallets.get(account) ?? null,
    balanceTokens: async (pubkey) => balances.get(pubkey) ?? null,
    // devsig proofs (the double-gated dev switch) so every flow test can mint
    // its step-up cheaply; the ladder itself is unit-proven with real ed25519
    // keys in woc_market_stepup.test.ts, and one arm below runs the REAL
    // signature path end to end with stepUpDevSig false.
    stepUpDevSig: true,
    config: {
      enabled: true,
      realm: REALM,
      policy: WOC_MARKET_RESTRICTED_POLICY,
      confirmingReviewMs: CONFIRMING_REVIEW_MS,
    },
    now,
    onSweepError: (arm, err) => {
      sweepErrors.push([arm, err]);
    },
  };
  const service = new WocMarketService(deps);
  return {
    db,
    custody,
    economy,
    service,
    deps,
    wallets,
    balances,
    now,
    setNow: (ms) => {
      clockMs = ms;
    },
    sweepErrors,
  };
}

function unwrap<T extends { ok: true }>(res: T | Refused, label: string): T {
  if (!res.ok) throw new Error(`${label} refused: ${res.reason}`);
  return res;
}

function listingParams(over: Partial<WocListingParams> = {}): WocListingParams {
  return {
    format: 'auction',
    directedBuyerAccount: null,
    startCents: 5000,
    reserveCents: null,
    buyNowCents: null,
    durationHours: 12,
    offerNext: false,
    ...over,
  };
}

/** The listing-shaped step-up binding for `params`, the same fields the route
 *  hands the challenge issue (including the exact copy and offerNext). */
function listBindingFor(
  itemId: string,
  params: WocListingParams,
  expectInstance: ItemInstancePayload | null = null,
) {
  return {
    operation: 'create_listing' as const,
    itemId,
    expectInstance,
    format: params.format,
    startCents: params.startCents,
    reserveCents: params.reserveCents,
    buyNowCents: params.buyNowCents,
    durationHours: params.durationHours,
    offerNext: params.offerNext,
  };
}

/** Mint a devsig step-up proof through the real issue path (consumes a
 *  challenge row exactly as production does). */
async function stepUpFor(
  h: Harness,
  account: number,
  request: Parameters<WocMarketService['issueStepUpChallenge']>[1],
): Promise<{ nonce: string; signature: string }> {
  const out = await h.service.issueStepUpChallenge(account, request);
  if (!out.ok) throw new Error(`issueStepUpChallenge refused: ${out.reason}`);
  return { nonce: out.challenge.nonce, signature: `devsig:${out.challenge.nonce}` };
}

/** createListing with a fresh matching proof, the honest-flow shorthand. */
async function createListingSteppedUp(
  h: Harness,
  args: Omit<Parameters<WocMarketService['createListing']>[0], 'stepUp'>,
): Promise<Awaited<ReturnType<WocMarketService['createListing']>>> {
  return h.service.createListing({
    ...args,
    stepUp: await stepUpFor(
      h,
      args.account,
      listBindingFor(args.itemRef.itemId, args.params, args.itemRef.expectInstance ?? null),
    ),
  });
}

/** acceptDirectedOffer with a fresh offer-bound proof (the seller side). */
async function acceptSteppedUp(
  h: Harness,
  account: number,
  offerId: number,
  itemRef: Parameters<WocMarketService['acceptDirectedOffer']>[2],
  characterId: number,
): Promise<Awaited<ReturnType<WocMarketService['acceptDirectedOffer']>>> {
  return h.service.acceptDirectedOffer(
    account,
    offerId,
    itemRef,
    characterId,
    await stepUpFor(h, account, { operation: 'accept_directed_offer', offerId }),
  );
}

async function listEpic(h: Harness, over: Partial<WocListingParams> = {}): Promise<WocListingRow> {
  const res = await createListingSteppedUp(h, {
    account: SELLER,
    characterId: SELLER_CHAR,
    itemRef: { index: 0, itemId: EPIC_ITEM },
    params: listingParams(over),
  });
  return unwrap(res, 'createListing').listing;
}

interface BidArgs {
  account: number;
  characterId: number;
  listingId: number;
  amountCents: number;
  acceptTerms?: boolean;
}

function placeBid(h: Harness, args: BidArgs) {
  return h.service.placeBid({
    account: args.account,
    characterId: args.characterId,
    listingId: args.listingId,
    amountCents: args.amountCents,
    acceptTerms: args.acceptTerms ?? true,
  });
}

/** Place a bid and confirm its bond in one step. */
async function confirmedBid(
  h: Harness,
  account: number,
  characterId: number,
  listingId: number,
  amountCents: number,
): Promise<{ bidId: number; standing: boolean }> {
  const placed = unwrap(
    await placeBid(h, { account, characterId, listingId, amountCents }),
    'placeBid',
  );
  const confirmed = unwrap(
    await h.service.confirmBond(account, placed.bid.id, `sig-bond-${placed.bid.id}`),
    'confirmBond',
  );
  return { bidId: placed.bid.id, standing: confirmed.standing };
}

function bagsOf(h: Harness, characterId: number): InvSlot[] {
  return h.custody.bags.get(characterId) ?? [];
}

async function getListing(h: Harness, id: number): Promise<WocListingRow> {
  const row = await h.db.listingById(REALM, id);
  if (!row) throw new Error(`listing ${id} missing`);
  return row;
}

async function getBid(h: Harness, id: number): Promise<WocBidRow> {
  const row = await h.db.bidById(id);
  if (!row) throw new Error(`bid ${id} missing`);
  return row;
}

async function getSettlement(h: Harness, id: number): Promise<WocSettlementRow> {
  const row = await h.db.settlementById(id);
  if (!row) throw new Error(`settlement ${id} missing`);
  return row;
}

async function liveSettlement(h: Harness, listingId: number): Promise<WocSettlementRow> {
  const row = await h.db.liveSettlementForListing(listingId);
  if (!row) throw new Error(`no live settlement for listing ${listingId}`);
  return row;
}

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

describe('woc market fixtures', () => {
  it('resolves real epic and rare tradable equipment defs from ITEMS', () => {
    expect(ITEMS[EPIC_ITEM].quality).toBe('epic');
    expect(ITEMS[EPIC_ITEM].soulbound).toBeFalsy();
    expect(ITEMS[EPIC_ITEM].slot).toBeDefined();
    expect(ITEMS[RARE_ITEM].quality).toBe('rare');
    expect(ITEMS[RARE_ITEM].slot).toBeDefined();
  });
});

describe('a contended recorder maps to the retryable in-flight refusal (the write-path rider fix round)', () => {
  it('confirmBond and confirmSettlement answer confirm_in_flight, never a 500', async () => {
    // Both legs staged through the REAL flows to the recording moment, then
    // the recorder stubbed 'contended': the mapping is the unit under test,
    // and the typed retryable refusal must reach the wire with nothing else
    // disturbed (before the fix round this threw into a 500 with a payment
    // already on chain and its signature unrecorded).
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    const listed = unwrap(
      await createListingSteppedUp(h, {
        account: SELLER,
        characterId: SELLER_CHAR,
        itemRef: { index: 0, itemId: EPIC_ITEM },
        params: listingParams(),
      }),
      'createListing',
    );
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listed.listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    h.db.submitBondSignature = async () => 'contended';
    const bondOut = await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-map-bond');
    expect(bondOut).toEqual({ ok: false, reason: 'confirm_in_flight' });
    // The settlement leg rides the real directed flow to the offered state
    // (the directedSale helper's own steps, stopped before its confirm), so
    // the stubbed recorder is the ONLY divergence from a paying buyer.
    const offer = unwrap(
      await h.service.createDirectedOffer({
        account: BUYER_A,
        characterId: CHAR_A,
        sellerCharacterName: 'Selara',
        usdCents: 5000,
        item: { itemId: EPIC_ITEM },
        acceptTerms: true,
      }),
      'createDirectedOffer',
    );
    unwrap(
      await h.service.acceptDirectedOffer(BUYER_A, offer.offer.id, null, CHAR_A),
      'buyer accept',
    );
    const accepted = unwrap(
      await acceptSteppedUp(
        h,
        SELLER,
        offer.offer.id,
        { index: 0, itemId: EPIC_ITEM },
        SELLER_CHAR,
      ),
      'seller accept',
    );
    if (!accepted.listing) throw new Error('no listing from the acceptance');
    const bought = unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: accepted.listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    unwrap(await h.service.settlementQuote(BUYER_A, bought.settlement.id), 'settlementQuote');
    h.db.submitSettlementSignature = async () => 'contended';
    const settleOut = await h.service.confirmSettlement(
      BUYER_A,
      bought.settlement.id,
      'sig-map-settle',
    );
    expect(settleOut).toEqual({ ok: false, reason: 'confirm_in_flight' });
  });
});

describe('the realm-gate pre-check spares the step-up challenge (the write-path rider fix round)', () => {
  it('refuses saturation BEFORE the proof is consumed: the same challenge lists once the gate clears', async () => {
    // The review round's sharpest availability find: the gate's own refusal
    // lands inside runSerialized, AFTER guardStepUp consumed the single-use
    // wallet challenge, so realm saturation (other players' load) burned an
    // honest seller's signature per retry. The pre-check answers first; the
    // decisive proof is that the SAME challenge then succeeds.
    const h = makeHarness();
    let saturated = true;
    h.deps.escrowSaturated = () => saturated;
    const args = {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    };
    const stepUp = await stepUpFor(h, SELLER, listBindingFor(EPIC_ITEM, args.params, null));
    const refused = await h.service.createListing({ ...args, stepUp });
    expect(refused).toEqual({ ok: false, reason: 'contended' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
    saturated = false;
    const admitted = await h.service.createListing({ ...args, stepUp });
    expect(admitted.ok).toBe(true);
  });

  it('acceptDirectedOffer pre-checks SATURATION before its proof is consumed', async () => {
    // The directed twin of the createListing test (the fix-round review:
    // these lines had zero coverage, and without the OUTER rung the
    // seller's single-use offer-bound proof burns before the INNER
    // createListing's rung refuses). Decisive form again: the SAME proof
    // accepts once the gate clears. The DRAIN rung's twin lives in the
    // pre-burn describe above; this one moves only escrowSaturated, so the
    // title names the rung it actually exercises.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    const offer = unwrap(
      await h.service.createDirectedOffer({
        account: BUYER_A,
        characterId: CHAR_A,
        sellerCharacterName: 'Selara',
        usdCents: 5000,
        item: { itemId: EPIC_ITEM },
        acceptTerms: true,
      }),
      'createDirectedOffer',
    );
    unwrap(
      await h.service.acceptDirectedOffer(BUYER_A, offer.offer.id, null, CHAR_A),
      'buyer accept',
    );
    let saturated = true;
    h.deps.escrowSaturated = () => saturated;
    const proof = await stepUpFor(h, SELLER, {
      operation: 'accept_directed_offer',
      offerId: offer.offer.id,
    });
    const refused = await h.service.acceptDirectedOffer(
      SELLER,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
      proof,
    );
    expect(refused).toEqual({ ok: false, reason: 'contended' });
    // The offer is untouched (still pending, not reopened) and the bags
    // still hold the copy: the refusal preceded every consumable.
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
    saturated = false;
    const accepted = await h.service.acceptDirectedOffer(
      SELLER,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
      proof,
    );
    expect(accepted.ok, 'the SAME proof accepts once the gate clears').toBe(true);
  });

  it('an absent dep changes nothing (the rigs stay byte-identical)', async () => {
    const h = makeHarness();
    expect(h.deps.escrowSaturated).toBeUndefined();
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res.ok).toBe(true);
  });
});

describe('the grant busy budget bounds the delivery pass (the write-path rider fix round)', () => {
  it('stops the scope after the budget instead of one deadline per row', async () => {
    // Three directed sales whose buyers all read busy: without the budget
    // the batch priced the LOCKED sweep segment at one grant deadline per
    // row. The budget (2) stops the scope's settlement work like a
    // contended pass; the rows stay 'delivering' and the next pass, with
    // the wedge cleared, delivers them all.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    // A third epic so three directed sales can stage, and the wedge staged
    // BEFORE the sales so their eager confirms park instead of delivering.
    h.custody.bags.get(SELLER_CHAR)?.push({ itemId: EPIC_ITEM, count: 1 });
    h.custody.alwaysGrantBusy = true;
    const sales: number[] = [];
    for (const sig of ['sig-budget-1', 'sig-budget-2', 'sig-budget-3']) {
      const { listingId } = await directedSale(h, sig);
      sales.push(listingId);
    }
    const runsBefore = h.custody.grantRuns.length;
    h.setNow(h.now() + PAST_BACKOFF_MS);
    await h.service.sweepPass();
    // The budget bit: exactly TWO grant deadlines were paid this pass, not
    // one per row.
    expect(h.custody.grantRuns.length - runsBefore).toBe(2);
    // The wedge clears; every sale converges.
    h.custody.alwaysGrantBusy = false;
    for (let i = 0; i < 3; i++) {
      h.setNow(h.now() + PAST_BACKOFF_MS);
      await h.service.sweepPass();
    }
    for (const listingId of sales) {
      expect((await h.db.listingById(REALM, listingId))?.status).toBe('closed');
    }
  });
});

describe('the draining refusal is PRE-BURN on both escrow entries', () => {
  it('createListing: refuses before the pooled health reads and before the proof is spent', async () => {
    // The rung's whole justification is its POSITION: IO-free and ahead of
    // the consumables. The existing drain tests assert only bags and saves,
    // and the listing helper mints a fresh proof per call, so moving the
    // rung below guardStepUp kept them green while burning an honest
    // seller's single-use signature on every retry of a shutdown window.
    // Decisive form, the saturation twin's: the SAME proof lists once the
    // drain clears, and neither pooled read ran on the refusal.
    const h = makeHarness();
    const price = vi.spyOn(h.economy, 'price');
    const strikeInfo = vi.spyOn(h.db, 'strikeInfo');
    let draining = true;
    h.deps.draining = () => draining;
    const args = {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    };
    const stepUp = await stepUpFor(h, SELLER, listBindingFor(EPIC_ITEM, args.params, null));
    price.mockClear();
    strikeInfo.mockClear();

    const refused = await h.service.createListing({ ...args, stepUp });
    expect(refused).toEqual({ ok: false, reason: 'market_paused' });
    // IO-free: the health guard's two pooled reads never ran on a closing
    // pool, which is the stated reason the rung leads.
    expect(price).not.toHaveBeenCalled();
    expect(strikeInfo).not.toHaveBeenCalled();
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);

    draining = false;
    const admitted = await h.service.createListing({ ...args, stepUp });
    expect(admitted.ok, 'the SAME proof lists once the drain clears').toBe(true);
  });

  it('acceptDirectedOffer: the OUTER drain rung refuses before its offer-bound proof is spent', async () => {
    // The directed twin, which had no coverage at all: the seller's
    // acceptance escrows through the inner createListing, so without the
    // OUTER rung the single-use offer-bound proof burns before the inner
    // one refuses. Deleting server/woc_market.ts's acceptDirectedOffer drain
    // line was invisible to the whole suite before this.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    const offer = unwrap(
      await h.service.createDirectedOffer({
        account: BUYER_A,
        characterId: CHAR_A,
        sellerCharacterName: 'Selara',
        usdCents: 5000,
        item: { itemId: EPIC_ITEM },
        acceptTerms: true,
      }),
      'createDirectedOffer',
    );
    unwrap(
      await h.service.acceptDirectedOffer(BUYER_A, offer.offer.id, null, CHAR_A),
      'buyer accept',
    );
    let draining = true;
    h.deps.draining = () => draining;
    const proof = await stepUpFor(h, SELLER, {
      operation: 'accept_directed_offer',
      offerId: offer.offer.id,
    });
    const refused = await h.service.acceptDirectedOffer(
      SELLER,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
      proof,
    );
    expect(refused).toEqual({ ok: false, reason: 'market_paused' });
    // Nothing consumed: the offer is untouched and the copy is still held.
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);

    draining = false;
    const accepted = await h.service.acceptDirectedOffer(
      SELLER,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
      proof,
    );
    expect(accepted.ok, 'the SAME proof accepts once the drain clears').toBe(true);
  });
});

describe('the draining refusal on createListing (the write-path rider)', () => {
  it('refuses while draining, BEFORE any custody action', async () => {
    // The HTTP listener stays open through the shutdown drain, so a listing
    // accepted late in the grace window could enter an escrow sequence
    // whose honest tail outlives pool.end(). The drain rung answers the
    // existing paused refusal (503, localized copy) and must land with
    // nothing extracted and nothing written.
    const h = makeHarness();
    h.deps.draining = () => true;
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'market_paused' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
    expect(h.db.escrowSaves).toHaveLength(0);
  });

  it('an absent drain dep changes nothing: the same listing goes through', async () => {
    // The dep is optional so every existing rig stays byte-identical; this
    // arm pins that absence really is the no-refusal default (and every
    // other test in this file rides it implicitly).
    const h = makeHarness();
    expect(h.deps.draining).toBeUndefined();
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res.ok).toBe(true);
  });

  it('a drain that flips false again admits the next listing (readiness is re-testable)', async () => {
    // resetHealthForTests exists because readiness state is process-global;
    // the service side must read the thunk LIVE, not capture its value.
    const h = makeHarness();
    let draining = true;
    h.deps.draining = () => draining;
    const refused = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(refused).toEqual({ ok: false, reason: 'market_paused' });
    draining = false;
    const admitted = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(admitted.ok).toBe(true);
  });
});

describe('step-up enforcement on the custody movers (B6/R1)', () => {
  it('refuses a bearer-only createListing with stepup_required, touching nothing', async () => {
    // The B6 vector: a stolen session bearer lists the victim's valuables.
    // With no proof attached the refusal lands before any custody action.
    const h = makeHarness();
    const res = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'stepup_required' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
    expect(h.db.escrowSaves).toHaveLength(0);
  });

  it('refuses a bearer-only SELLER acceptance with stepup_required', async () => {
    // The seller's acceptance is the custody-committing act on the directed
    // rail, so it demands the same proof; the buyer's does not (their money
    // path signs its own payment).
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const offer = await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 7500,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    if (!offer.ok) throw new Error(`offer refused: ${offer.reason}`);
    const res = await h.service.acceptDirectedOffer(
      SELLER,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
    );
    expect(res).toEqual({ ok: false, reason: 'stepup_required' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(1);
  });

  it('refuses a REPLAYED proof: the same challenge cannot authorize twice', async () => {
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [
      { itemId: EPIC_ITEM, count: 1 },
      { itemId: EPIC_ITEM, count: 1 },
    ]);
    const params = listingParams();
    const proof = await stepUpFor(h, SELLER, listBindingFor(EPIC_ITEM, params));
    const args = {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params,
      stepUp: proof,
    };
    expect((await h.service.createListing(args)).ok).toBe(true);
    expect(await h.service.createListing(args)).toEqual({
      ok: false,
      reason: 'stepup_challenge_invalid',
    });
    expect(bagsOf(h, SELLER_CHAR), 'the second copy never escrowed').toHaveLength(1);
  });

  it('refuses an EXPIRED challenge with its own honest reason', async () => {
    const h = makeHarness();
    const params = listingParams();
    const proof = await stepUpFor(h, SELLER, listBindingFor(EPIC_ITEM, params));
    h.setNow(BASE_MS + WOC_MARKET_STEPUP_TTL_MS);
    const res = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params,
      stepUp: proof,
    });
    expect(res).toEqual({ ok: false, reason: 'stepup_challenge_expired' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
  });

  it('refuses a listing challenge replayed onto the OTHER operation', async () => {
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const offer = await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 7500,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    if (!offer.ok) throw new Error(`offer refused: ${offer.reason}`);
    const listingProof = await stepUpFor(h, SELLER, listBindingFor(EPIC_ITEM, listingParams()));
    const res = await h.service.acceptDirectedOffer(
      SELLER,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
      listingProof,
    );
    expect(res).toEqual({ ok: false, reason: 'stepup_binding_mismatch' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(1);
  });

  it('refuses a proof whose item or any money figure moved after signing', async () => {
    // The B6 replay: sign for one listing, submit another. Item and start
    // price each get their own arm; the full member sweep is the unit
    // suite's digest test.
    const h = makeHarness();
    const params = listingParams();
    for (const drifted of [
      { itemRef: { index: 1, itemId: RARE_ITEM }, params },
      { itemRef: { index: 0, itemId: EPIC_ITEM }, params: listingParams({ startCents: 25 }) },
    ]) {
      const proof = await stepUpFor(h, SELLER, listBindingFor(EPIC_ITEM, params));
      const res = await h.service.createListing({
        account: SELLER,
        characterId: SELLER_CHAR,
        ...drifted,
        stepUp: proof,
      });
      expect(res).toEqual({ ok: false, reason: 'stepup_binding_mismatch' });
    }
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
  });

  it('binds the exact COPY: a proof for one roll cannot escrow a different roll of the same id', async () => {
    // The compromised-client copy swap: the wallet signed for a junk roll, the
    // client submits the best-rolled copy of the same id. The binding covers
    // the instance, not just the id, so the swap refuses.
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [
      { itemId: EPIC_ITEM, count: 1, instance: { rolled: { quality: 'epic' } } },
    ]);
    const params = listingParams();
    const proofForJunk = await stepUpFor(
      h,
      SELLER,
      listBindingFor(EPIC_ITEM, params, { rolled: { quality: 'common' } }),
    );
    const res = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM, expectInstance: { rolled: { quality: 'epic' } } },
      params,
      stepUp: proofForJunk,
    });
    expect(res).toEqual({ ok: false, reason: 'stepup_binding_mismatch' });
    // The matching proof for the real copy lists it.
    const good = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM, expectInstance: { rolled: { quality: 'epic' } } },
      params,
    });
    expect(good.ok).toBe(true);
  });

  it('binds offerNext: a proof for offerNext false cannot list with it on', async () => {
    const h = makeHarness();
    const proof = await stepUpFor(h, SELLER, listBindingFor(EPIC_ITEM, listingParams()));
    const res = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams({ offerNext: true }),
      stepUp: proof,
    });
    expect(res).toEqual({ ok: false, reason: 'stepup_binding_mismatch' });
  });

  it('keeps ELIGIBILITY behind the guard: a bearer-only listing of an ineligible item still reads stepup_required', async () => {
    // Coverage's oracle concern: moving guardStepUp below the eligibility check
    // would leak whether the item is listable to a stolen bearer. An ineligible
    // item (a rare, below the epic floor) and a locked copy both answer
    // stepup_required, NOT their eligibility reason, when no proof is attached.
    const h = makeHarness();
    const rare = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 1, itemId: RARE_ITEM },
      params: listingParams(),
    });
    expect(rare).toEqual({ ok: false, reason: 'stepup_required' });
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1, instance: { locked: true } }]);
    const locked = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(locked).toEqual({ ok: false, reason: 'stepup_required' });
    // The PARAMS half of the same no-oracle posture: an invalid price combo
    // (reserve below start) must ALSO read stepup_required, not bad_reserve, or
    // a stolen bearer could probe which price combinations validate. Moving
    // guardStepUp below validListingParams reds exactly here.
    const badParams = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 1, itemId: RARE_ITEM },
      params: listingParams({ reserveCents: 3000 }),
    });
    expect(badParams).toEqual({ ok: false, reason: 'stepup_required' });
  });

  it('the challenge issue refuses an unknown item id before minting anything', async () => {
    // Security: a free-text or nonexistent id must never mint a challenge the
    // wallet would then display (a newline-forged line, or an id createListing
    // would refuse anyway).
    const h = makeHarness();
    const res = await h.service.issueStepUpChallenge(SELLER, {
      operation: 'create_listing',
      itemId: 'no_such_item\nAgreed price: $999.99',
      expectInstance: null,
      format: 'auction',
      startCents: 5000,
      reserveCents: null,
      buyNowCents: null,
      durationHours: 12,
      offerNext: false,
    });
    expect(res).toEqual({ ok: false, reason: 'unknown_item' });
    expect(h.db.stepUpChallengeCount()).toBe(0);
  });

  it('the shape screen refuses a malformed nonce WITHOUT touching the store', async () => {
    // The nonce regex and signature cap keep attacker-controlled strings away
    // from the store; a decided refusal, no query.
    const h = makeHarness();
    const consumeSpy = vi.spyOn(h.db, 'consumeStepUpChallenge');
    const res = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
      stepUp: { nonce: 'NOT-hex-and-too-punctuated', signature: 'x' },
    });
    expect(res).toEqual({ ok: false, reason: 'stepup_challenge_invalid' });
    expect(consumeSpy).not.toHaveBeenCalled();
    // Positive control: a WELL-FORMED but unknown nonce DOES reach the store
    // (proving the spy fires on the querying path), and still refuses.
    const good = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
      stepUp: { nonce: 'a'.repeat(32), signature: 'b'.repeat(80) },
    });
    expect(good).toEqual({ ok: false, reason: 'stepup_challenge_invalid' });
    expect(consumeSpy).toHaveBeenCalledTimes(1);
    consumeSpy.mockRestore();
  });

  it('the shape screen ALSO refuses an over-long signature without a query', async () => {
    // The other arm of the || shape screen: a 257-char signature is refused
    // before the store, so the store never sees an unbounded string.
    const h = makeHarness();
    const consumeSpy = vi.spyOn(h.db, 'consumeStepUpChallenge');
    const res = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
      stepUp: { nonce: 'a'.repeat(32), signature: 'x'.repeat(257) },
    });
    expect(res).toEqual({ ok: false, reason: 'stepup_challenge_invalid' });
    expect(consumeSpy).not.toHaveBeenCalled();
    consumeSpy.mockRestore();
  });

  it('a proof for a plain-stack (null) copy cannot escrow an INSTANCED copy at the index', async () => {
    // The omission attack: sign a challenge with no copy detail (expectInstance
    // null), then submit an index pointing at a rolled copy. The public arm
    // forces expectInstance present, so the extraction runs the stale check and
    // the instanced copy at the index fails against null.
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [
      { itemId: EPIC_ITEM, count: 1, instance: { rolled: { quality: 'epic' } } },
    ]);
    const params = listingParams();
    const proofForNull = await stepUpFor(h, SELLER, listBindingFor(EPIC_ITEM, params, null));
    const res = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      // expectInstance OMITTED (undefined): the service must normalize to null.
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params,
      stepUp: proofForNull,
    });
    // The exact rung is the point: the refusal must come from the copy check
    // (stale_copy), not drift to some other reason that would still be ok:false.
    expect(res, 'the instanced copy cannot escrow under a null-copy proof').toEqual({
      ok: false,
      reason: 'stale_copy',
    });
    expect(bagsOf(h, SELLER_CHAR), 'nothing escrowed').toHaveLength(1);
  });

  it('the challenge issue rejects a prototype-polluting item id', async () => {
    const h = makeHarness();
    for (const itemId of ['constructor', 'toString', '__proto__']) {
      const res = await h.service.issueStepUpChallenge(SELLER, {
        operation: 'create_listing',
        itemId,
        expectInstance: null,
        format: 'auction',
        startCents: 5000,
        reserveCents: null,
        buyNowCents: null,
        durationHours: 12,
        offerNext: false,
      });
      expect(res, itemId).toEqual({ ok: false, reason: 'unknown_item' });
    }
  });

  it('the signed message carries the service realm, not a client value', async () => {
    const h = makeHarness();
    const issue = await h.service.issueStepUpChallenge(
      SELLER,
      listBindingFor(EPIC_ITEM, listingParams()),
    );
    if (!issue.ok) throw new Error(`issue refused: ${issue.reason}`);
    expect(issue.challenge.message).toContain(`Realm: ${REALM}`);
  });

  it('the directed challenge issue refuses a legacy offer with no item to sign for', async () => {
    // A pre-pin offer with a null item names nothing; its challenge issue
    // refuses not_found rather than minting a blank "Item: " authorization.
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const offer = await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 7500,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    if (!offer.ok) throw new Error(`offer refused: ${offer.reason}`);
    // Null out the item on the stored row (a legacy pre-pin shape); reads
    // hand back copies, so the staging goes through the fake's own hook.
    h.db.stageLegacyOfferWithoutItem(offer.offer.id);
    expect(
      await h.service.issueStepUpChallenge(SELLER, {
        operation: 'accept_directed_offer',
        offerId: offer.offer.id,
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  it('the prune runs on every issue: a stale challenge is swept when a fresh one is minted', async () => {
    // The table's growth bound. Seed an expired row, issue a fresh challenge,
    // and the stale one is gone (the count reflects only the live row).
    const h = makeHarness();
    await h.db.createStepUpChallenge({
      nonce: 'a'.repeat(32),
      realm: REALM,
      accountId: SELLER,
      wallet: 'wallet-seller',
      operation: 'create_listing',
      bindingDigest: 'x',
      message: 'stale',
      expiresAtMs: BASE_MS - 1,
    });
    expect(h.db.stepUpChallengeCount()).toBe(1);
    await stepUpFor(h, SELLER, listBindingFor(EPIC_ITEM, listingParams()));
    // The stale row pruned; only the freshly minted one remains.
    expect(h.db.stepUpChallengeCount()).toBe(1);
    expect(await h.db.consumeStepUpChallenge(REALM, 'a'.repeat(32), SELLER)).toBeNull();
  });

  it('the issue refuses not_pending and offer_expired on the directed arm', async () => {
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const offer = await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 7500,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    if (!offer.ok) throw new Error(`offer refused: ${offer.reason}`);
    // Expired: advance past the TTL.
    h.setNow(BASE_MS + WOC_MARKET_DIRECTED_OFFER_TTL_SECONDS * 1000 + 1);
    expect(
      await h.service.issueStepUpChallenge(SELLER, {
        operation: 'accept_directed_offer',
        offerId: offer.offer.id,
      }),
    ).toEqual({ ok: false, reason: 'offer_expired' });
    // Not pending: resolve it, then issue.
    h.setNow(BASE_MS);
    await h.service.resolveDirectedOffer(BUYER_A, offer.offer.id, 'withdraw');
    expect(
      await h.service.issueStepUpChallenge(SELLER, {
        operation: 'accept_directed_offer',
        offerId: offer.offer.id,
      }),
    ).toEqual({ ok: false, reason: 'not_pending' });
  });

  it('refuses another account riding a stolen proof, and the owner keeps their challenge', async () => {
    // WALLET_TWIN owns a character and shares the seller's wallet string, so
    // every pre-step gate passes and the refusal is attributable to the
    // step-up alone. The victim's challenge survives the theft attempt.
    const h = makeHarness();
    h.custody.bags.set(CHAR_TWIN, [{ itemId: EPIC_ITEM, count: 1 }]);
    h.custody.owners.set(CHAR_TWIN, WALLET_TWIN);
    const params = listingParams();
    const proof = await stepUpFor(h, SELLER, listBindingFor(EPIC_ITEM, params));
    const stolen = await h.service.createListing({
      account: WALLET_TWIN,
      characterId: CHAR_TWIN,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params,
      stepUp: proof,
    });
    expect(stolen).toEqual({ ok: false, reason: 'stepup_challenge_invalid' });
    const owner = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params,
      stepUp: proof,
    });
    expect(owner.ok, 'the owner consumes their own challenge untouched').toBe(true);
  });

  it('refuses a proof issued to a FORMERLY linked wallet after a relink', async () => {
    const h = makeHarness();
    const params = listingParams();
    const proof = await stepUpFor(h, SELLER, listBindingFor(EPIC_ITEM, params));
    h.wallets.set(SELLER, 'wallet-seller-relinked');
    const res = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params,
      stepUp: proof,
    });
    expect(res).toEqual({ ok: false, reason: 'stepup_wallet_mismatch' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
  });

  it('refuses the devsig form when the dev switch is off, and a REAL signature passes', async () => {
    // The production posture end to end at the service seam: stepUpDevSig
    // false means only a genuine ed25519 signature over the stored message
    // verifies (the ladder itself is unit-proven; this is the wiring proof).
    const priv = new Uint8Array(32).fill(5);
    const wallet = bs58.encode(ed25519.getPublicKey(priv));
    const h = makeHarness();
    (h.deps as { stepUpDevSig: boolean }).stepUpDevSig = false;
    h.wallets.set(SELLER, wallet);
    const params = listingParams();
    const issue = await h.service.issueStepUpChallenge(SELLER, listBindingFor(EPIC_ITEM, params));
    if (!issue.ok) throw new Error(`issue refused: ${issue.reason}`);
    expect(issue.challenge.signatureRequired, 'production answers signatureRequired').toBe(true);
    const args = (signature: string) => ({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params,
      stepUp: { nonce: issue.challenge.nonce, signature },
    });
    expect(await h.service.createListing(args(`devsig:${issue.challenge.nonce}`))).toEqual({
      ok: false,
      reason: 'stepup_signature_invalid',
    });
    // The devsig attempt consumed the challenge (single-use, no retry
    // oracle), so the real signature signs a FRESH one.
    const second = await h.service.issueStepUpChallenge(SELLER, listBindingFor(EPIC_ITEM, params));
    if (!second.ok) throw new Error(`issue refused: ${second.reason}`);
    const signature = bs58.encode(
      ed25519.sign(new TextEncoder().encode(second.challenge.message), priv),
    );
    const real = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params,
      stepUp: { nonce: second.challenge.nonce, signature },
    });
    expect(real.ok, 'a genuine wallet signature moves custody').toBe(true);
  });

  it('never demands a proof from the BUYER side of an acceptance', async () => {
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const offer = await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 7500,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    if (!offer.ok) throw new Error(`offer refused: ${offer.reason}`);
    const buyer = await h.service.acceptDirectedOffer(BUYER_A, offer.offer.id, null, CHAR_A);
    expect(buyer.ok, 'the buyer agrees bearer-only; their money path signs later').toBe(true);
  });

  it('consummates through the internal directed call WITHOUT a second proof', async () => {
    // The seller's own acceptance carried the offer-bound proof; the escrow
    // then runs createListing internally with args.directed set. One proof
    // per custody move, spent at the decision, is the design.
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const offer = await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 7500,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    if (!offer.ok) throw new Error(`offer refused: ${offer.reason}`);
    const seller = await acceptSteppedUp(
      h,
      SELLER,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
    );
    expect(seller.ok).toBe(true);
    expect(h.db.stepUpChallengeCount(), 'the accept spent the only challenge').toBe(0);
    const buyer = await h.service.acceptDirectedOffer(BUYER_A, offer.offer.id, null, CHAR_A);
    expect(buyer.ok).toBe(true);
    if (buyer.ok) expect(buyer.listing, 'the consummation escrowed').not.toBeNull();
  });

  it('the challenge issue itself refuses without a wallet and derives directed figures from the offer', async () => {
    const h = makeHarness();
    h.wallets.delete(SELLER);
    expect(
      await h.service.issueStepUpChallenge(SELLER, listBindingFor(EPIC_ITEM, listingParams())),
    ).toEqual({ ok: false, reason: 'wallet_required' });
    h.wallets.set(SELLER, 'wallet-seller');
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const offer = await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 7500,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    if (!offer.ok) throw new Error(`offer refused: ${offer.reason}`);
    // Only the SELLER can mint an accept challenge; the buyer and a stranger
    // read not_found, the directed anti-enumeration convention.
    expect(
      await h.service.issueStepUpChallenge(BUYER_A, {
        operation: 'accept_directed_offer',
        offerId: offer.offer.id,
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    const minted = await h.service.issueStepUpChallenge(SELLER, {
      operation: 'accept_directed_offer',
      offerId: offer.offer.id,
    });
    if (!minted.ok) throw new Error(`issue refused: ${minted.reason}`);
    // The wallet shows the AUTHORITATIVE agreed figures from the offer row.
    expect(minted.challenge.message).toContain(`accept directed offer #${offer.offer.id}`);
    expect(minted.challenge.message).toContain('$75.00');
    expect(minted.challenge.signatureRequired, 'dev harness answers false').toBe(false);
  });

  it('refuses a directed-accept proof minted before a seller relink', async () => {
    // The directed rail shares guardStepUp, so the live wallet re-read closes
    // the issue-to-use window here too. Pinned independently of the createListing
    // arm: a regression that skipped the wallet re-read on the accept path would
    // pass every createListing relink test and only red here.
    const h = makeHarness();
    h.wallets.set(SELLER, 'wallet-seller');
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const offer = await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 7500,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    if (!offer.ok) throw new Error(`offer refused: ${offer.reason}`);
    const minted = await h.service.issueStepUpChallenge(SELLER, {
      operation: 'accept_directed_offer',
      offerId: offer.offer.id,
    });
    if (!minted.ok) throw new Error(`issue refused: ${minted.reason}`);
    // Relink AFTER minting, BEFORE the seller presses Accept.
    h.wallets.set(SELLER, 'wallet-seller-relinked');
    const res = await h.service.acceptDirectedOffer(
      SELLER,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
      { nonce: minted.challenge.nonce, signature: `devsig:${minted.challenge.nonce}` },
    );
    expect(res).toEqual({ ok: false, reason: 'stepup_wallet_mismatch' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(1);
  });
});

describe('createListing', () => {
  it('escrows the copy out of the bags and persists the listing row', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    expect(listing.sellerAccount).toBe(SELLER);
    expect(listing.sellerCharacter).toBe(SELLER_CHAR);
    expect(listing.sellerName).toBe('Selara'); // custody-resolved, never client-named
    expect(listing.sellerWallet).toBe('wallet-seller');
    expect(listing.itemId).toBe(EPIC_ITEM);
    expect(listing.item.itemId).toBe(EPIC_ITEM);
    expect(listing.quality).toBe('epic');
    expect(listing.status).toBe('active');
    expect(listing.endsAtMs).toBe(BASE_MS + 12 * HOUR_MS);
    expect(listing.baseEndsAtMs).toBe(BASE_MS + 12 * HOUR_MS);
    // The epic copy left the bags; the rare stayed behind.
    expect(bagsOf(h, SELLER_CHAR).map((s) => s.itemId)).toEqual([RARE_ITEM]);
    // The character save rode the escrow edge.
    expect(h.db.escrowSaves).toHaveLength(1);
    expect(h.db.escrowSaves[0]).toMatchObject({
      characterId: SELLER_CHAR,
      level: 10,
      leaseNonce: 'nonce',
    });
  });

  it('refuses wallet_required when the account has no verified wallet', async () => {
    const h = makeHarness();
    h.wallets.delete(SELLER);
    const res = await h.service.createListing({
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'wallet_required' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
  });

  it('refuses below_quality_floor for a rare item before any custody action', async () => {
    const h = makeHarness();
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 1, itemId: RARE_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'below_quality_floor' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
    expect(h.db.escrowSaves).toHaveLength(0);
  });

  it('refuses locked for a copy the owner has item-locked, before any custody action', async () => {
    // R10: the player item lock (issue 3042) gates the $WOC exchange exactly as
    // it gates salvage, crafting, and vendor sale. The claimed instance carries
    // the flag, so the advisory pre-check refuses with zero custody work.
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1, instance: { locked: true } }]);
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM, expectInstance: { locked: true } },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'locked' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(1);
    expect(h.db.escrowSaves).toHaveLength(0);
  });

  it('a null-claim over a locked live copy is caught at extraction, not slipped through', async () => {
    // A client that LIES about a locked copy by omitting the instance cannot
    // slip it into escrow: the public arm forces expectInstance present (null),
    // so the in-job extraction compares the claimed null to the locked live
    // slot and refuses BEFORE any custody write, and the copy stays in the bags
    // still locked. (The honest claimed-locked case refuses at the pre-check,
    // the test above; the extracted-copy LOCKED reason itself is exercised by
    // the directed rail, whose itemRef carries no claim to compare.) This is
    // the non-vacuous half: the extraction runs here, unlike the pre-check.
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1, instance: { locked: true } }]);
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      // No expectInstance: the public arm forces it to null, so the extraction
      // (not the claimed-instance pre-check) is what runs and refuses.
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'stale_copy' });
    expect(h.custody.extractAttempts).toContain(SELLER_CHAR);
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(1);
    expect(bagsOf(h, SELLER_CHAR)[0]?.instance?.locked).toBe(true);
    expect(h.db.escrowSaves).toHaveLength(0);
  });

  it('runs the custody critical section through runSerialized for the listed character', async () => {
    const h = makeHarness();
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res.ok).toBe(true);
    // The extraction and the escrow write happened INSIDE the serialized job
    // (a direct db call outside it would leave this recorder empty).
    expect(h.custody.serializedRuns).toEqual([SELLER_CHAR]);
    expect(h.db.escrowSaves).toHaveLength(1);
  });

  it('a proven-rollback escrow throw restores the copy to the bags', async () => {
    const h = makeHarness();
    // 57014 (statement_timeout cancel) aborts the transaction before COMMIT,
    // so the compensation split must take the restore arm.
    h.db.failNextEscrowThrow = Object.assign(new Error('canceling statement'), { code: '57014' });
    await expect(
      createListingSteppedUp(h, {
        account: SELLER,
        characterId: SELLER_CHAR,
        itemRef: { index: 0, itemId: EPIC_ITEM },
        params: listingParams(),
      }),
    ).rejects.toThrow('canceling statement');
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
    expect(h.custody.sessionLost).toEqual([]);
  });

  it('an ambiguous escrow throw parks: no restore, the session is abandoned', async () => {
    const h = makeHarness();
    // EPIPE is a Node socket errno, not a SQLSTATE: the COMMIT may have
    // reached the server, so restoring here could mint the copy twice. The
    // durable row decides instead (quarantine + reload).
    h.db.failNextEscrowThrow = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      createListingSteppedUp(h, {
        account: SELLER,
        characterId: SELLER_CHAR,
        itemRef: { index: 0, itemId: EPIC_ITEM },
        params: listingParams(),
      }),
    ).rejects.toThrow('broken pipe');
    const logged = errSpy.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('escrow_outcome_unknown'),
    );
    errSpy.mockRestore();
    expect(logged).toBe(true);
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(1);
    expect(h.custody.sessionLost).toEqual([{ characterId: SELLER_CHAR, kind: 'ambiguous' }]);
  });

  it('a lease-fenced escrow write kicks the displaced zombie after restoring', async () => {
    const h = makeHarness();
    h.db.failNextEscrow = 'lease_lost';
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'lease_lost' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
    expect(h.custody.sessionLost).toEqual([{ characterId: SELLER_CHAR, kind: 'fenced' }]);
  });

  it('a foreign character id refuses with ZERO serialized side effects', async () => {
    const h = makeHarness();
    // CHAR_A belongs to BUYER_A: the seller naming it must not reach the
    // FIFO, the flush, or the depth cap (that slot belongs to the victim).
    h.custody.bags.set(CHAR_A, [{ itemId: EPIC_ITEM, count: 1 }]);
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: CHAR_A,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'character_invalid' });
    expect(h.custody.serializedRuns).toEqual([]);
  });

  it("a db-level 'contended' escrow refusal restores the copy and answers the typed refusal", async () => {
    const h = makeHarness();
    h.db.failNextEscrow = 'contended';
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'contended' });
    // The transaction provably rolled back (55P03/40P01/25P03), so the copy
    // is restored to the bags rather than parked.
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
  });

  it("maps the serialized-job 'contended' to the typed refusal with nothing extracted", async () => {
    const h = makeHarness();
    h.custody.failNextRunSerialized = true;
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'contended' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
    expect(h.db.escrowSaves).toHaveLength(0);
  });

  it('refuses bad_reserve when the reserve sits below the starting bid', async () => {
    const h = makeHarness();
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams({ reserveCents: 4000 }),
    });
    expect(res).toEqual({ ok: false, reason: 'bad_reserve' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
  });

  it('refuses cap_reached at the per-account active cap without extracting', async () => {
    const h = makeHarness();
    h.custody.bags.set(
      SELLER_CHAR,
      Array.from({ length: WOC_MARKET_MAX_ACTIVE_LISTINGS + 1 }, () => ({
        itemId: EPIC_ITEM,
        count: 1,
      })),
    );
    for (let i = 0; i < WOC_MARKET_MAX_ACTIVE_LISTINGS; i++) await listEpic(h);
    expect(await h.db.countActiveBySeller(REALM, SELLER)).toBe(WOC_MARKET_MAX_ACTIVE_LISTINGS);
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'cap_reached' });
    // The pre-check refused before extraction: the last copy never moved.
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(1);
  });

  it('restores the extracted copy when the escrow transaction reports cap_reached', async () => {
    const h = makeHarness();
    h.db.failNextEscrow = 'cap_reached';
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'cap_reached' });
    const ids = bagsOf(h, SELLER_CHAR).map((s) => s.itemId);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(EPIC_ITEM);
    expect(await h.db.listingsBySeller(REALM, SELLER)).toHaveLength(0);
  });

  it('restores the extracted copy when the escrow save loses the lease', async () => {
    const h = makeHarness();
    h.db.failNextEscrow = 'lease_lost';
    const res = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(res).toEqual({ ok: false, reason: 'lease_lost' });
    const ids = bagsOf(h, SELLER_CHAR).map((s) => s.itemId);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(EPIC_ITEM);
  });
});

describe('cancelListing', () => {
  it('closes an unbid listing as cancelled and mails the escrowed copy home', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const res = await h.service.cancelListing(SELLER, listing.id);
    expect(res.ok, 'a public buy-now must not be caught by the directed guard').toBe(true);
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('closed');
    expect(row.resolution).toBe('cancelled');
    expect(row.itemDisposed).toBe(true);
    // Escrow-by-removal: the copy comes back as a durable mail parcel, never
    // straight into the live bags (the seller may be offline or elsewhere).
    expect(bagsOf(h, SELLER_CHAR).map((s) => s.itemId)).toEqual([RARE_ITEM]);
    expect(h.custody.parcels).toEqual([
      {
        recipientKey: String(SELLER_CHAR),
        letter: 'return',
        items: [expect.objectContaining({ itemId: EPIC_ITEM })],
        custodyRef: listingReturnCustodyRef(listing.id),
      },
    ]);
    expect(h.db.custodyClaims.get(listingReturnCustodyRef(listing.id))?.bookedAtMs).toBe(BASE_MS);
  });

  it('refuses has_bids once a bond has been confirmed against the listing', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    // Cancelling under a standing bid would let a seller walk away from a price
    // they no longer like while the bidder's bond sits held.
    const res = await h.service.cancelListing(SELLER, listing.id);
    expect(res).toEqual({ ok: false, reason: 'has_bids' });
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('active');
    expect(row.resolution).toBeNull();
    expect(row.itemDisposed).toBe(false);
    expect(row.currentBidId).toBe(standing.bidId);
    expect(h.custody.parcels).toHaveLength(0);
  });

  it('refuses not_yours for an account that does not own the listing', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    // Cancel is the one seller verb that disposes of custody, so a foreign
    // account reaching it would be an item-theft primitive.
    const res = await h.service.cancelListing(BUYER_A, listing.id);
    expect(res).toEqual({ ok: false, reason: 'not_yours' });
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('active');
    expect(row.resolution).toBeNull();
    expect(row.itemDisposed).toBe(false);
    expect(h.custody.parcels).toHaveLength(0);
  });

  it('refuses while a buy-now payment is in flight and never mails the copy home', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const buy = unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    // The buyer signs, then the lock expires with the payment still settling.
    // This is the dupe shape the guard exists for: the old cancel mailed the
    // copy home here while the broadcast payment went on to deliver it too.
    expect(await h.db.submitSettlementSignature(buy.settlement.id, 'sig-cancel-race')).toBe('ok');
    // Inside the lock window a PAID window refuses even the cancel-intent
    // stamp: cancel-pending must never tear a live settlement.
    expect(await h.service.cancelListing(SELLER, listing.id)).toEqual({
      ok: false,
      reason: 'settlement_in_flight',
    });
    expect((await getListing(h, listing.id)).cancelRequestedAtMs).toBeNull();
    h.setNow(BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000 + 1);
    expect(await h.service.cancelListing(SELLER, listing.id)).toEqual({
      ok: false,
      reason: 'settlement_in_flight',
    });
    // Delivered-but-unclosed is still in flight: the listing row has not
    // resolved, so the cancel keeps refusing rather than re-opening custody.
    await h.db.transitionSettlement(buy.settlement.id, ['confirming'], 'confirmed');
    await h.db.transitionSettlement(buy.settlement.id, ['confirmed'], 'delivering');
    await h.db.transitionSettlement(buy.settlement.id, ['delivering'], 'delivered');
    expect(await h.service.cancelListing(SELLER, listing.id)).toEqual({
      ok: false,
      reason: 'settlement_in_flight',
    });
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('active');
    expect(row.itemDisposed).toBe(false);
    expect(h.custody.parcels).toHaveLength(0);
  });

  it('accepts a cancel on an UNPAID locked window as intent, then converges it closed', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    // The unpaid window accepts the cancel as INTENT: no close yet, no return
    // flight, the holder keeps their window.
    expect(await h.service.cancelListing(SELLER, listing.id)).toEqual({
      ok: true,
      cancelPending: true,
    });
    const stamped = await getListing(h, listing.id);
    expect(stamped.status).toBe('active');
    expect(stamped.cancelRequestedAtMs).not.toBeNull();
    expect(stamped.buyNowLockAccount).toBe(BUYER_A);
    expect(h.custody.parcels).toHaveLength(0);
    // From the stamp on, NEW claims and NEW bids refuse.
    expect(
      await h.service.buyNow({
        account: BUYER_B,
        characterId: CHAR_B,
        listingId: listing.id,
        acceptTerms: true,
      }),
    ).toEqual({ ok: false, reason: 'cancel_pending' });
    // The window ends unpaid: the overdue arm expires the settlement and the
    // converge arm closes the listing cancelled with the return flight home.
    h.setNow(BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000 + 1);
    const stats = await h.service.sweepPass();
    expect(stats?.cancelClosed).toBe(1);
    const closed = await getListing(h, listing.id);
    expect(closed.status).toBe('closed');
    expect(closed.resolution).toBe('cancelled');
    expect(h.custody.parcels).toHaveLength(1);
    expect(h.custody.persistCalls).toEqual([listingReturnCustodyRef(listing.id)]);
  });

  it('a paid window PARKS the converge instead of probing it every pass', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const bought = unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    expect(await h.service.cancelListing(SELLER, listing.id)).toEqual({
      ok: true,
      cancelPending: true,
    });
    // The buyer PAYS inside their window: the settlement is live, the lock
    // window then lapses, and the converge must skip WITHOUT closing.
    expect(await h.db.submitSettlementSignature(bought.settlement.id, 'sig-paid-window')).toBe(
      'ok',
    );
    h.setNow(BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000 + 1);
    await h.service.sweepPass();
    expect((await getListing(h, listing.id)).status, 'a paid window never tears').toBe('active');
    const attemptsAfterOne = h.db.cancelConvergeAttempts.filter((id) => id === listing.id).length;
    expect(attemptsAfterOne, 'the pass probed it once and parked it').toBe(1);
    // Five seconds later (inside the 60s backoff) the next pass EXCLUDES the
    // parked row: a settlement can sit unresolved for operator-scale time,
    // and a standing skip set must cost no batch slots while it waits.
    h.setNow(BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000 + 5_000);
    await h.service.sweepPass();
    const attemptsAfterTwo = h.db.cancelConvergeAttempts.filter((id) => id === listing.id).length;
    expect(attemptsAfterTwo, 'backed off, not re-probed').toBe(1);
  });

  it('plain contention retries next pass WITHOUT the 60s park', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    expect(await h.service.cancelListing(SELLER, listing.id)).toEqual({
      ok: true,
      cancelPending: true,
    });
    h.setNow(BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000 + 1);
    // A transient lock loser is NOT a park: costing a contender the 60s
    // backoff would delay every legitimate converge behind a blip.
    h.db.failNextCancelConverge = 'contended';
    await h.service.sweepPass();
    expect((await getListing(h, listing.id)).status).toBe('active');
    h.setNow(BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000 + 6_000);
    const stats = await h.service.sweepPass();
    expect(stats?.cancelClosed, 'the very next pass converges it').toBe(1);
    expect((await getListing(h, listing.id)).resolution).toBe('cancelled');
  });

  it('refuses not_active on a second cancel and books no second return', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    expect(await h.service.cancelListing(SELLER, listing.id)).toEqual({ ok: true });
    // A retried cancel (double click, replayed request) must not mint a second
    // return flight: that is one escrowed copy delivered twice.
    const again = await h.service.cancelListing(SELLER, listing.id);
    expect(again).toEqual({ ok: false, reason: 'not_active' });
    expect((await getListing(h, listing.id)).resolution).toBe('cancelled');
    expect(h.custody.persistCalls).toEqual([listingReturnCustodyRef(listing.id)]);
    expect(h.custody.parcels).toHaveLength(1);
  });
});

describe('placeBid', () => {
  it('returns the pending bid plus a dev bond intent and stores the bond reference', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const res = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    expect(res.bid.status).toBe('pending_bond');
    expect(res.bid.bondState).toBe('pending');
    expect(res.bid.amountCents).toBe(5000);
    expect(res.bid.bondCents).toBe(bondCents(5000));
    expect(res.bid.characterName).toBe('Aldan'); // db-resolved, never client-named
    expect(res.bond.ok).toBe(true);
    expect(res.bond.reference).toMatch(/^dev_woc_/);
    expect(res.bid.bondReference).toBe(res.bond.reference);
    const stored = await getBid(h, res.bid.id);
    expect(stored.bondReference).toBe(res.bond.reference);
    expect(stored.bondQuoteExpiresAtMs).toBe(BASE_MS + WOC_MARKET_QUOTE_TTL_SECONDS * 1000);
  });

  it('refuses own_listing for the seller account and for a wallet twin', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const own = await placeBid(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      listingId: listing.id,
      amountCents: 5000,
    });
    expect(own).toEqual({ ok: false, reason: 'own_listing' });
    const twin = await placeBid(h, {
      account: WALLET_TWIN,
      characterId: CHAR_TWIN,
      listingId: listing.id,
      amountCents: 5000,
    });
    expect(twin).toEqual({ ok: false, reason: 'own_listing' });
    expect(await h.db.bidsForListing(listing.id)).toHaveLength(0);
  });

  it('refuses character_invalid when the named character is not the account delivery target', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const res = await placeBid(h, {
      account: BUYER_A,
      characterId: 999, // not a character of BUYER_A
      listingId: listing.id,
      amountCents: 5000,
    });
    expect(res).toEqual({ ok: false, reason: 'character_invalid' });
    expect(await h.db.bidsForListing(listing.id)).toHaveLength(0);
  });

  it('refuses bid_too_low below the minimum next bid', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const res = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 4900,
    });
    expect(res).toEqual({ ok: false, reason: 'bid_too_low' });
  });

  it('requires terms once and records acceptance exactly once', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const refused = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 5000,
      acceptTerms: false,
    });
    expect(refused).toEqual({ ok: false, reason: 'terms_required' });
    expect(await h.db.termsAcceptedAt(BUYER_A)).toBeNull();
    unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
        acceptTerms: true,
      }),
      'placeBid',
    );
    expect(await h.db.termsAcceptedAt(BUYER_A)).toBe(BASE_MS);
    h.setNow(BASE_MS + 60_000);
    const second = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 6000,
      acceptTerms: true,
    });
    // The first bid is still pending, so the second refuses AFTER the guards
    // ran; the recorded acceptance stays the first one (first write wins).
    expect(second).toEqual({ ok: false, reason: 'already_pending' });
    expect(await h.db.termsAcceptedAt(BUYER_A)).toBe(BASE_MS);
  });

  it('refuses already_pending for a second bid from one account, per account not per listing', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const first = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    // One unconfirmed bond per account per listing. Stacking pending bids would
    // issue a second bond quote for a seat the account already holds, so a
    // bidder could hold two bonds against one auction.
    const stacked = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 7000,
    });
    expect(stacked).toEqual({ ok: false, reason: 'already_pending' });
    const mine = (await h.db.bidsForListing(listing.id)).filter((b) => b.account === BUYER_A);
    expect(mine.map((b) => b.amountCents)).toEqual([5000]);
    expect((await getBid(h, first.bid.id)).status).toBe('pending_bond');
    // The block is scoped to the account: a rival still gets their own seat.
    const rival = await placeBid(h, {
      account: BUYER_B,
      characterId: CHAR_B,
      listingId: listing.id,
      amountCents: 5500,
    });
    expect(rival.ok).toBe(true);
    expect(await h.db.bidsForListing(listing.id)).toHaveLength(2);
    // Neither bond is confirmed, so nothing stands on the listing yet.
    expect((await getListing(h, listing.id)).currentBidId).toBeNull();
  });

  it('abandoning a pending bid frees the seat it was holding', async () => {
    // The dead end this closes: declining the wallet left the bid pending, and
    // every further bid on that listing was refused with a message telling the
    // player to abandon it, through a control that did not exist. Their only
    // escape was waiting out the five-minute TTL.
    const h = makeHarness();
    const listing = await listEpic(h);
    const first = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    expect(
      await h.service.abandonBid(BUYER_A, first.bid.id),
      'the bidder may withdraw their own unfunded bid',
    ).toEqual({ ok: true });
    expect((await getBid(h, first.bid.id)).status).toBe('cancelled');
    // Nothing was ever transferred for a pending bond, so there is no refund leg.
    expect((await getBid(h, first.bid.id)).bondState).toBe('void');
    // And the seat is genuinely free again: the SAME account can bid once more.
    const again = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 6000,
    });
    expect(again.ok, 'a fresh bid must now be accepted').toBe(true);
  });

  it('refuses to let one player abandon another player’s bid', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const first = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    expect(await h.service.abandonBid(BUYER_B, first.bid.id)).toEqual({
      ok: false,
      reason: 'not_yours',
    });
    expect((await getBid(h, first.bid.id)).status).toBe('pending_bond');
  });

  it('refuses to abandon a bid that is no longer pending', async () => {
    // The race the status arm exists for: a bond that lands while the player is
    // reaching for "Not now" must keep its bid, not lose it to the click.
    const h = makeHarness();
    const listing = await listEpic(h);
    const first = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    unwrap(
      await h.service.confirmBond(BUYER_A, first.bid.id, `sig-bond-${first.bid.id}`),
      'confirmBond',
    );
    expect((await getBid(h, first.bid.id)).status).toBe('active');
    expect(await h.service.abandonBid(BUYER_A, first.bid.id)).toEqual({
      ok: false,
      reason: 'not_pending',
    });
    expect((await getBid(h, first.bid.id)).status, 'the live bid survives').toBe('active');
  });

  it('refuses confirm_in_flight while a recorded signature awaits its verdict', async () => {
    // Abandoning a bond whose payment may already be riding the chain would
    // void money in flight; the abandon waits for the verdict instead.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    expect(await h.db.submitBondSignature(placed.bid.id, 'sig-awaiting-verdict', h.now())).toEqual({
      signatureAtMs: h.now(),
    });
    expect(await h.service.abandonBid(BUYER_A, placed.bid.id)).toEqual({
      ok: false,
      reason: 'confirm_in_flight',
    });
    const bid = await getBid(h, placed.bid.id);
    expect(bid.status).toBe('pending_bond');
    expect(bid.bondState).toBe('pending');
  });

  it('a CAS-lost abandon re-reads for the truthful refusal', async () => {
    // abandonPendingBid re-checks status AND signature inside the UPDATE;
    // when it reports no row, the pre-write reads were stale and the service
    // must answer from a FRESH read (a signature landed: confirm_in_flight),
    // never from the stale one (which had no signature and would misreport).
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const realAbandon = h.db.abandonPendingBid.bind(h.db);
    h.db.abandonPendingBid = async (realm: string, bidId: number, account: number) => {
      // The race: a signature lands between the service's read and its write.
      await h.db.submitBondSignature(bidId, 'sig-raced-in', h.now());
      return realAbandon(realm, bidId, account);
    };
    expect(await h.service.abandonBid(BUYER_A, placed.bid.id)).toEqual({
      ok: false,
      reason: 'confirm_in_flight',
    });
    const bid = await getBid(h, placed.bid.id);
    expect(bid.status).toBe('pending_bond');
    expect(bid.bondSignature).toBe('sig-raced-in');
  });

  it('a placed bid whose quote CAS loses the insert race answers contended', async () => {
    // placeBid writes the bond reference with the same setBidBondQuote CAS;
    // a false return on a brand-new bid means it somehow left pending_bond
    // already, and the caller must hear a retryable contention, not a
    // success carrying a reference that was never written.
    const h = makeHarness();
    const listing = await listEpic(h);
    h.db.setBidBondQuote = async () => false;
    expect(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
    ).toEqual({ ok: false, reason: 'contended' });
    // "Nothing written" (the source's claim): the orphaned seat carries no
    // reference and lapses on the pending TTL.
    const seats = await h.db.bidsByAccount(REALM, BUYER_A, 10);
    expect(seats.every((b) => b.bondReference === null)).toBe(true);
  });

  it('refuses insufficient_balance when the wallet cannot cover bid plus bond', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    // 5000 cents bid + 250 cents bond = 5250 cents = 52,500 dev tokens.
    h.balances.set('wallet-a', 52_499);
    const short = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 5000,
    });
    expect(short).toEqual({ ok: false, reason: 'insufficient_balance' });
    h.balances.set('wallet-a', 52_500);
    const exact = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 5000,
    });
    expect(exact.ok).toBe(true);
  });

  it('refuses insufficient_balance when the wallet balance read is unavailable', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    // The chain read degrades to null instead of throwing (the graceful
    // degradation contract), and the gate must read that as "cannot tell", never
    // as "rich enough": otherwise every RPC outage opens bidding to empty
    // wallets, and the bond is the only thing left holding the auction honest.
    h.balances.delete('wallet-a');
    const res = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 5000,
    });
    expect(res).toEqual({ ok: false, reason: 'insufficient_balance' });
    expect(await h.db.bidsForListing(listing.id)).toHaveLength(0);
    expect((await getListing(h, listing.id)).currentBidCents).toBeNull();
  });

  it('refuses market_paused when the token estimate is unavailable under a healthy price', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    // Price healthy but the estimate leg unreadable: the gate has no required
    // token figure to compare the balance against, so it pauses rather than
    // skipping the comparison and admitting the bid unchecked.
    const noEstimate: WocMarketEconomy = {
      ...h.economy,
      estimate: async (usdCents) => ({
        available: false,
        split: null,
        usdCents,
        amount: null,
        asOfMs: null,
      }),
    };
    const paused = new WocMarketService({ ...h.deps, economy: noEstimate });
    // The premise, so this pins the BALANCE gate and not the pre-gate that
    // shares the reason: the oracle itself is healthy here.
    expect((await paused.status()).price).toMatchObject({ available: true, healthy: true });
    const res = await paused.placeBid({
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 5000,
      acceptTerms: true,
    });
    expect(res).toEqual({ ok: false, reason: 'market_paused' });
    expect(await h.db.bidsForListing(listing.id)).toHaveLength(0);
  });

  it('refuses insufficient_balance when the wallet covers the bid but not its bond', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    // The gate prices bid PLUS bond (5000 + 250 cents = 52,500 dev tokens); a
    // wallet holding only the 50,000 for the bid itself could never post the
    // bond that backs the seat.
    h.balances.set('wallet-a', 50_000);
    const res = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 5000,
    });
    expect(res).toEqual({ ok: false, reason: 'insufficient_balance' });
    expect(await h.db.bidsForListing(listing.id)).toHaveLength(0);
  });

  it('refuses account_suspended while a strike suspension is in force', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    await h.db.addStrike(BUYER_A, BASE_MS + 24 * HOUR_MS);
    const res = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 5000,
    });
    expect(res).toEqual({ ok: false, reason: 'account_suspended' });
  });

  it('allows a bid once the strike suspension has run out, keeping the strike row', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    await h.db.addStrike(BUYER_A, BASE_MS + HOUR_MS);
    // The hold ends AT its own timestamp. A suspension that outlived it would be
    // a permanent bidding ban the progressive strike ladder never intended.
    h.setNow(BASE_MS + HOUR_MS);
    const res = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    expect(res.bid.status).toBe('pending_bond');
    expect(res.bid.bondState).toBe('pending');
    // Serving the bid does not forgive the ladder: the next default escalates
    // from strike 1, not from zero.
    expect(await h.db.strikeInfo(BUYER_A)).toEqual({
      accountId: BUYER_A,
      strikes: 1,
      suspendedUntilMs: BASE_MS + HOUR_MS,
    });
  });

  it('allows bidders with no strike row and with a strike carrying no suspension', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    // The absent-row shape: a clean account has no strikes row at all, and
    // reading that as a suspension would close the marketplace to everyone.
    expect(await h.db.strikeInfo(BUYER_A)).toBeNull();
    const clean = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 5000,
    });
    expect(clean.ok).toBe(true);
    // A first default records a strike with a NULL suspension
    // (strikeSuspensionMs(1) is 0), so the null must read as "no hold in force"
    // rather than as an open-ended one.
    await h.db.addStrike(BUYER_C, null);
    expect(await h.db.strikeInfo(BUYER_C)).toEqual({
      accountId: BUYER_C,
      strikes: 1,
      suspendedUntilMs: null,
    });
    const struck = await placeBid(h, {
      account: BUYER_C,
      characterId: CHAR_C,
      listingId: listing.id,
      amountCents: 5000,
    });
    expect(struck.ok).toBe(true);
    const accounts = (await h.db.bidsForListing(listing.id)).map((b) => b.account);
    expect([...accounts].sort((a, b) => a - b)).toEqual([BUYER_A, BUYER_C]);
  });

  it('refuses disabled when the feature flag is off', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const disabled = new WocMarketService({
      ...h.deps,
      config: { ...h.deps.config, enabled: false },
    });
    const res = await disabled.placeBid({
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 5000,
      acceptTerms: true,
    });
    expect(res).toEqual({ ok: false, reason: 'disabled' });
  });

  it('refuses market_paused when the price oracle reports unhealthy', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const unhealthy: WocMarketEconomy = {
      ...h.economy,
      price: async () => ({
        available: true,
        healthy: false,
        reason: 'stale_oracle',
        tokensPerUsd: null,
        asOfMs: h.now(),
      }),
    };
    const paused = new WocMarketService({ ...h.deps, economy: unhealthy });
    const res = await paused.placeBid({
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 5000,
      acceptTerms: true,
    });
    expect(res).toEqual({ ok: false, reason: 'market_paused' });
  });
});

describe('confirmBond', () => {
  it('holds the bond and stands the bid on the listing', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const confirmed = unwrap(
      await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-hold'),
      'confirmBond',
    );
    expect(confirmed.standing).toBe(true);
    const bid = await getBid(h, placed.bid.id);
    expect(bid.status).toBe('active');
    expect(bid.bondState).toBe('held');
    const row = await getListing(h, listing.id);
    expect(row.currentBidCents).toBe(5000);
    expect(row.currentBidId).toBe(placed.bid.id);
  });

  it('a lower bid confirming second is superseded and its bond flips to refund_due', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const high = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 6000,
      }),
      'placeBid',
    );
    const low = unwrap(
      await placeBid(h, {
        account: BUYER_B,
        characterId: CHAR_B,
        listingId: listing.id,
        amountCents: 5500,
      }),
      'placeBid',
    );
    unwrap(await h.service.confirmBond(BUYER_A, high.bid.id, 'sig-high'), 'confirmBond');
    const second = unwrap(
      await h.service.confirmBond(BUYER_B, low.bid.id, 'sig-low'),
      'confirmBond',
    );
    expect(second.standing).toBe(false);
    const lowRow = await getBid(h, low.bid.id);
    expect(lowRow.status).toBe('outbid');
    expect(lowRow.bondState).toBe('refund_due');
    const highRow = await getBid(h, high.bid.id);
    expect(highRow.status).toBe('active');
    expect(highRow.bondState).toBe('held');
    const row = await getListing(h, listing.id);
    expect(row.currentBidCents).toBe(6000);
    expect(row.currentBidId).toBe(high.bid.id);
  });

  it('a higher bid confirming outbids the standing bid and updates the listing', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const first = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    const higher = unwrap(
      await placeBid(h, {
        account: BUYER_B,
        characterId: CHAR_B,
        listingId: listing.id,
        amountCents: 7000,
      }),
      'placeBid',
    );
    const res = unwrap(
      await h.service.confirmBond(BUYER_B, higher.bid.id, 'sig-higher'),
      'confirmBond',
    );
    expect(res.standing).toBe(true);
    const firstRow = await getBid(h, first.bidId);
    expect(firstRow.status).toBe('outbid');
    expect(firstRow.bondState).toBe('refund_due');
    const row = await getListing(h, listing.id);
    expect(row.currentBidCents).toBe(7000);
    expect(row.currentBidId).toBe(higher.bid.id);
  });

  it('records a signature against an expired quote and lets the chain verdict end the bid', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    // The intake no longer refuses an expired quote BEFORE recording: the
    // signature is the only trace of a transfer that may already have left
    // the wallet, so it lands in the ledger FIRST and the chain decides (the
    // dev economy refuses a dead quote, the H4 near-expiry loss is the case
    // where it settles instead).
    h.setNow(BASE_MS + WOC_MARKET_QUOTE_TTL_SECONDS * 1000);
    const stale = await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-stale-bond');
    expect(stale).toEqual({ ok: false, reason: 'confirm_failed' });
    const pending = await getBid(h, placed.bid.id);
    expect(pending.status).toBe('pending_bond');
    expect(pending.bondState).toBe('pending');
    // The ledger trace survived the refusal: the poll owns the row now.
    expect(pending.bondSignature).toBe('sig-stale-bond');
    const untouched = await getListing(h, listing.id);
    expect(untouched.currentBidId).toBeNull();
    expect(untouched.currentBidCents).toBeNull();
    // With a signature awaiting its verdict, a refresh must NOT re-reference
    // the bond out from under the poll.
    expect(await h.service.refreshBondQuote(BUYER_A, placed.bid.id)).toEqual({
      ok: false,
      reason: 'confirm_in_flight',
    });
    expect((await getBid(h, placed.bid.id)).bondReference).toBe(placed.bond.reference);
    // The poll resolves the decided-against verdict: the bid lapses, the
    // (never-funded) bond voids, and the seat frees for a fresh bid.
    await h.service.sweepPass();
    const lapsed = await getBid(h, placed.bid.id);
    expect(lapsed.status).toBe('lapsed');
    expect(lapsed.bondState).toBe('void');
    const rebid = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const confirmed = unwrap(
      await h.service.confirmBond(BUYER_A, rebid.bid.id, 'sig-fresh-bond'),
      'confirmBond',
    );
    expect(confirmed.standing).toBe(true);
    expect((await getBid(h, rebid.bid.id)).bondState).toBe('held');
    expect((await getListing(h, listing.id)).currentBidId).toBe(rebid.bid.id);
  });

  it('refuses a refresh whose quote would outlive the lapse deadline', async () => {
    // The straddle hole: a refresh in the seat's last quote-lifetime mints a
    // quote valid PAST placed_at plus the pending TTL, inviting a broadcast
    // whose signature arrives against a lapsed bid, where nothing can record
    // it (the one loss shape signature-first recording cannot reach). The
    // refresh refuses instead, the settlement leg's deadline-guard sibling.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const placedAtMs = h.now();
    // Inside the safe window (quote expiry lands before the lapse): allowed.
    h.setNow(
      placedAtMs + (WOC_MARKET_BOND_PENDING_TTL_SECONDS - WOC_MARKET_QUOTE_TTL_SECONDS) * 1000,
    );
    unwrap(await h.service.refreshBondQuote(BUYER_A, placed.bid.id), 'refreshBondQuote');
    // One tick later the quote would straddle the lapse: refused.
    h.setNow(
      placedAtMs + (WOC_MARKET_BOND_PENDING_TTL_SECONDS - WOC_MARKET_QUOTE_TTL_SECONDS) * 1000 + 1,
    );
    expect(await h.service.refreshBondQuote(BUYER_A, placed.bid.id)).toEqual({
      ok: false,
      reason: 'bond_window_closed',
    });
  });

  it('refuses a SERVICE-minted quote that straddles the lapse, whatever the local TTL says', async () => {
    // The expiry actually stored is the service's, not the local constant
    // the pre-quote check predicts with: a service answering a longer TTL
    // than WOC_MARKET_QUOTE_TTL_SECONDS would straddle the lapse anyway,
    // so the authoritative check compares the MINTED expiry. The unused
    // quote expires on its own (the CAS-loss shape).
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const longQuote = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async () => ({
          ok: true,
          reference: 'ref-overlong',
          transactionBase64: null,
          signatureRequired: true,
          amount: null,
          seller: null,
          burn: null,
          treasury: null,
          bondCents: null,
          reason: null,
          expiresAtMs: h.now() + WOC_MARKET_BOND_PENDING_TTL_SECONDS * 1000 + 60_000,
        }),
      },
    });
    expect(await longQuote.refreshBondQuote(BUYER_A, placed.bid.id)).toEqual({
      ok: false,
      reason: 'bond_window_closed',
    });
    expect((await getBid(h, placed.bid.id)).bondReference).toBe(placed.bond.reference);
  });

  it('a poll winning the activation race still answers the confirmer standing true', async () => {
    // The recording commits, the sweep's poll confirms and activates while
    // this request sits in the chain round trip, and activateBid then
    // answers not_pending. The service must answer from the row's REAL
    // status: a bare standing:false read as "outbid" to the very bidder
    // whose payment just stood.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const realActivate = h.db.activateBid.bind(h.db);
    h.db.activateBid = async (bidId: number, nowMs: number) => {
      // The poll got there first: the activation really happened, and THIS
      // caller's own attempt finds the bid no longer pending.
      await realActivate(bidId, nowMs);
      return 'not_pending' as const;
    };
    const confirmed = unwrap(
      await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-race-won'),
      'confirmBond',
    );
    expect(confirmed.standing, 'the bid really stands; say so').toBe(true);
    expect((await getBid(h, placed.bid.id)).status).toBe('active');
  });

  it('the not_pending re-read answers standing false for a genuinely superseded bid', async () => {
    // The FALSE arm of the same re-read: when the row really was outbid
    // (activateBid's supersede left it 'outbid'), the answer must stay
    // standing:false; an unconditional standing:true would lie the other way.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const realActivate = h.db.activateBid.bind(h.db);
    h.db.activateBid = async (bidId: number, nowMs: number) => {
      const bid = await h.db.bidById(bidId);
      if (bid) {
        await h.db.markBidStatus(bid.id, 'outbid');
      }
      void realActivate;
      void nowMs;
      return 'not_pending' as const;
    };
    const confirmed = unwrap(
      await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-race-lost'),
      'confirmBond',
    );
    expect(confirmed.standing, 'genuinely superseded stays not standing').toBe(false);
  });

  it('refreshBondQuote stands an unpaid bid on a fresh reference, end to end', async () => {
    // The SUCCESS arm: the refusal arms above prove what a refresh must not
    // touch, this proves the refresh actually re-references an unpaid quote
    // (a refreshBondQuote that wrote nothing, or answered quote_unavailable
    // unconditionally, would fail here and nowhere else).
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const refreshed = unwrap(
      await h.service.refreshBondQuote(BUYER_A, placed.bid.id),
      'refreshBondQuote',
    );
    expect(refreshed.bond.reference).not.toBe(placed.bond.reference);
    expect((await getBid(h, placed.bid.id)).bondReference).toBe(refreshed.bond.reference);
    // And the refreshed reference is payable: the confirm holds and stands.
    const confirmed = unwrap(
      await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-refreshed-ref'),
      'confirmBond',
    );
    expect(confirmed.standing).toBe(true);
    expect((await getBid(h, placed.bid.id)).bondState).toBe('held');
  });

  it('a CAS-lost refresh answers confirm_in_flight, never a false success', async () => {
    // The setBidBondQuote compare-and-set is the atomic arm behind the
    // signature-read above; when it reports no row (a signature landed in the
    // race window) the service must re-read for the truthful refusal instead
    // of standing the bid on a reference it never wrote.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    h.db.setBidBondQuote = async () => false;
    expect(await h.service.refreshBondQuote(BUYER_A, placed.bid.id)).toEqual({
      ok: false,
      reason: 'confirm_in_flight',
    });
    expect((await getBid(h, placed.bid.id)).bondReference).toBe(placed.bond.reference);
  });

  it('a replay of the recorded signature on an OUTBID bid answers standing false', async () => {
    // The third outcome arm (active/won are covered above): a superseded
    // bidder whose confirm response was swallowed retries and must hear the
    // OUTCOME (outbid, refund queued), never not_pending's "bid gone".
    const h = makeHarness();
    const listing = await listEpic(h);
    const low = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    unwrap(await h.service.confirmBond(BUYER_A, low.bid.id, 'sig-low-outbid'), 'confirmBond');
    const high = unwrap(
      await placeBid(h, {
        account: BUYER_B,
        characterId: CHAR_B,
        listingId: listing.id,
        amountCents: 6000,
      }),
      'placeBid',
    );
    unwrap(await h.service.confirmBond(BUYER_B, high.bid.id, 'sig-high-outbid'), 'confirmBond');
    expect((await getBid(h, low.bid.id)).status).toBe('outbid');
    const replay = unwrap(
      await h.service.confirmBond(BUYER_A, low.bid.id, 'sig-low-outbid'),
      'confirmBond',
    );
    expect(replay.standing).toBe(false);
    expect(replay.pending).toBeUndefined();
    // No churn: the demotion and its queued refund survive the replay...
    const after = await getBid(h, low.bid.id);
    expect(after.status).toBe('outbid');
    expect(after.bondState).toBe('refund_due');
    // ...and a DIFFERENT signature gets no outcome (the negative arm).
    expect(await h.service.confirmBond(BUYER_A, low.bid.id, 'sig-someone-elses')).toEqual({
      ok: false,
      reason: 'not_pending',
    });
  });

  it('answers a same-signature replay after activation as idempotent success, with no churn', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const first = unwrap(
      await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-one-bond'),
      'confirmBond',
    );
    expect(first.standing).toBe(true);
    // One signed transfer is one hold. A retried request or a double-clicked
    // wallet replays the same signature; the recorded-signature arm answers
    // the OUTCOME (the old 'not_pending' refusal read as "bid gone" for a
    // payment that succeeded) while still never re-running hold-and-activate
    // (the transfer's own uniqueness is the memo reference, which the
    // economy service owns). A DIFFERENT caller's string still refuses.
    const replay = await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-one-bond');
    expect(replay).toEqual({ ok: true, standing: true });
    expect(await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-other')).toEqual({
      ok: false,
      reason: 'not_pending',
    });
    const bid = await getBid(h, placed.bid.id);
    expect(bid.status).toBe('active');
    expect(bid.bondState).toBe('held');
    const row = await getListing(h, listing.id);
    expect(row.currentBidId).toBe(placed.bid.id);
    expect(row.currentBidCents).toBe(5000);
    // No bond churn either: the replay owes neither a refund nor a forfeit.
    expect(await h.db.bondsDue(REALM, 10)).toHaveLength(0);
  });

  it('refuses not_pending for a bid whose bond lapsed before the signature arrived', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    h.setNow(BASE_MS + WOC_MARKET_BOND_PENDING_TTL_SECONDS * 1000);
    await h.service.sweepPass();
    expect((await getBid(h, placed.bid.id)).status).toBe('lapsed');
    // A lapsed seat is gone for good: re-animating it on a late signature would
    // insert a stale amount ahead of bidders who placed after the lapse.
    const late = await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-late-bond');
    expect(late).toEqual({ ok: false, reason: 'not_pending' });
    const bid = await getBid(h, placed.bid.id);
    expect(bid.status).toBe('lapsed');
    expect(bid.bondState).toBe('void');
    expect((await getListing(h, listing.id)).currentBidId).toBeNull();
  });
});

describe('anti-snipe extension', () => {
  it('a chain-REFUSED verdict never moves the close (DB-free arm of the verdict gate)', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    // Place inside the final window, then let the QUOTE die (past its TTL,
    // inside the bond TTL) so the dev economy REFUSES the confirm. The
    // extension must not fire on the raw submission: a fabricated signature
    // moving the authoritative clock was the security round's critical.
    const bidAt = listing.endsAtMs - 100_000;
    h.setNow(bidAt);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const confirmAt = bidAt + WOC_MARKET_QUOTE_TTL_SECONDS * 1000;
    h.setNow(confirmAt);
    // Still inside the anti-snipe window, so a fired extension WOULD move the
    // close (the vacuity trap: a close outside the window nulls the math and
    // proves nothing). The guard reads the REAL window constant so a shrunk
    // window cannot quietly hollow it out.
    expect(listing.endsAtMs - confirmAt).toBeLessThan(WOC_MARKET_ANTI_SNIPE_WINDOW_SECONDS * 1000);
    expect(await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-refused-gate')).toEqual({
      ok: false,
      reason: 'confirm_failed',
    });
    expect((await getListing(h, listing.id)).endsAtMs, 'refused extends nothing').toBe(
      listing.endsAtMs,
    );
  });

  it('an unpaid final-window bid no longer moves the close; the signature does', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidAt = listing.endsAtMs - 60_000;
    h.setNow(bidAt);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    // PLACEMENT is free to mint, so it extends nothing (the abandon-loop
    // ruling's anti-snipe constraint: wallets with no money down must not
    // burn the extension cap).
    expect((await getListing(h, listing.id)).endsAtMs).toBe(listing.endsAtMs);
    // BOND PROGRESS is the extension moment: the recorded signature is a real
    // payment claim, and this is what keeps an in-flight confirmation from
    // landing after the close.
    const confirmAt = listing.endsAtMs - 30_000;
    h.setNow(confirmAt);
    unwrap(await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-snipe-bond'), 'confirmBond');
    const row = await getListing(h, listing.id);
    expect(row.endsAtMs).toBe(confirmAt + WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS * 1000);
    expect(row.baseEndsAtMs).toBe(listing.endsAtMs);
  });

  it('a re-posted pending signature cannot creep the close past its first anchor', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidAt = listing.endsAtMs - 60_000;
    h.setNow(bidAt);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const pendingChain = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        // The MATCHED pending word: the one that extends at all.
        confirm: async () => ({ settled: false, pending: true, reason: 'awaiting_finality' }),
      },
    });
    const firstAt = listing.endsAtMs - 30_000;
    h.setNow(firstAt);
    unwrap(await pendingChain.confirmBond(BUYER_A, placed.bid.id, 'sig-creep'), 'confirmBond');
    expect((await getListing(h, listing.id)).endsAtMs).toBe(
      firstAt + WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS * 1000,
    );
    // A minute later the SAME string is re-posted, verdict still pending.
    // The extension anchors on the FIRST recording (the submit returns it),
    // so the close does not move again: a fresh-clock anchor per resubmit
    // let one pending-forever signature hold the close at now plus the
    // extension continuously to the cap.
    h.setNow(firstAt + 60_000);
    unwrap(await pendingChain.confirmBond(BUYER_A, placed.bid.id, 'sig-creep'), 'confirmBond');
    expect((await getListing(h, listing.id)).endsAtMs).toBe(
      firstAt + WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS * 1000,
    );
  });

  it('a pending verdict extends ONLY when the ledger matched the payment', async () => {
    // The service splits undecided in two: awaiting_finality means the
    // verifier MATCHED the transaction at its read commitment (a fabricated
    // signature cannot reach that arm on a live chain), and not_yet_visible
    // means the ledger has shown nothing for the signature. Extending on the
    // second hands a griefer the close for the price of a random string,
    // which is the fabricated-signature residual this allowlist closes.
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidAt = listing.endsAtMs - 60_000;
    h.setNow(bidAt);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const verdict = { settled: false, pending: true, reason: 'not_yet_visible' as string | null };
    const scripted = new WocMarketService({
      ...h.deps,
      economy: { ...h.economy, confirm: async () => verdict },
    });
    const firstAt = listing.endsAtMs - 30_000;
    h.setNow(firstAt);
    unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-unseen'), 'confirmBond');
    expect((await getListing(h, listing.id)).endsAtMs, 'nothing visible extends nothing').toBe(
      listing.endsAtMs,
    );
    // The chain later SEES the payment: the matched verdict extends, and it
    // anchors on the FIRST recording (the creep rule is unchanged).
    verdict.reason = 'awaiting_finality';
    h.setNow(listing.endsAtMs - 20_000);
    unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-unseen'), 'confirmBond');
    expect(
      (await getListing(h, listing.id)).endsAtMs,
      'the matched verdict extends from the first-arrival anchor',
    ).toBe(firstAt + WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS * 1000);
  });

  it('a reason-less pending verdict extends nothing: an allowlist, not a denylist', async () => {
    // The old gate excluded only service_unavailable, so ANY unknown pending
    // word (or a null reason) moved the authoritative clock. The gate now
    // requires the one word that proves the ledger saw the payment.
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidAt = listing.endsAtMs - 60_000;
    h.setNow(bidAt);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({ settled: false, pending: true, reason: null }),
      },
    });
    h.setNow(listing.endsAtMs - 30_000);
    unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-reasonless'), 'confirmBond');
    expect((await getListing(h, listing.id)).endsAtMs).toBe(listing.endsAtMs);
  });

  it('a SETTLED verdict on a late re-post still extends, from the verdict moment', async () => {
    // The first-arrival anchor closes the free pending-arm creep; it must
    // not take away the paid-bond extension. A bond signed well before the
    // window whose verdict lands seconds from the close extends from the
    // verdict moment, so its own activation never reads the auction as over.
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidAt = listing.endsAtMs - 200_000;
    h.setNow(bidAt);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const verdict = { settled: false, pending: true, reason: null as string | null };
    const scripted = new WocMarketService({
      ...h.deps,
      economy: { ...h.economy, confirm: async () => verdict },
    });
    // First arrival OUTSIDE the window: records, pending, extends nothing.
    h.setNow(listing.endsAtMs - 190_000);
    unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-late-settle'), 'confirmBond');
    expect((await getListing(h, listing.id)).endsAtMs).toBe(listing.endsAtMs);
    // The chain decides seconds from the close: the settled arm anchors on
    // NOW, not the first arrival, and the close moves before activation.
    verdict.settled = true;
    verdict.pending = false;
    const settleAt = listing.endsAtMs - 10_000;
    h.setNow(settleAt);
    const out = unwrap(
      await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-late-settle'),
      'confirmBond',
    );
    expect(out.standing).toBe(true);
    expect((await getListing(h, listing.id)).endsAtMs).toBe(
      settleAt + WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS * 1000,
    );
  });

  it('a different signature on a signed pending bond refuses confirm_in_flight (DB-free arm)', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    expect(await h.db.submitBondSignature(placed.bid.id, 'sig-first-claim', h.now())).toEqual({
      signatureAtMs: h.now(),
    });
    // The pg suite pins this against real SQL; this arm is the CI floor (the
    // pg suite skips without TEST_DATABASE_URL). 'not_pending' misread a
    // still-pending bid as gone.
    const res = await h.service.confirmBond(BUYER_A, placed.bid.id, 'sig-second-claim');
    expect(res).toEqual({ ok: false, reason: 'confirm_in_flight' });
    const bid = await getBid(h, placed.bid.id);
    expect(bid.bondSignature).toBe('sig-first-claim');
  });

  it('extensions never push the close past baseEndsAtMs plus the cap', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const capMs = listing.baseEndsAtMs + WOC_MARKET_ANTI_SNIPE_CAP_SECONDS * 1000;
    // Each final-window CONFIRMED bid moves the end forward; ride the ladder
    // past where the cap must clamp it (the bid amounts ascend so every bond
    // activates as the new standing bid).
    for (let i = 0; i < SNIPER_COUNT; i++) {
      const account = SNIPER_ACCOUNT_BASE + i;
      h.wallets.set(account, `wallet-snipe-${i}`);
      h.balances.set(`wallet-snipe-${i}`, 100_000_000);
      const before = await getListing(h, listing.id);
      h.setNow(before.endsAtMs - 60_000);
      const placed = unwrap(
        await placeBid(h, {
          account,
          characterId: SNIPER_CHAR_BASE + i,
          listingId: listing.id,
          amountCents: 5000 + i * 1000,
        }),
        'placeBid',
      );
      unwrap(
        await h.service.confirmBond(account, placed.bid.id, `sig-snipe-cap-${i}`),
        'confirmBond',
      );
      const after = await getListing(h, listing.id);
      expect(after.endsAtMs).toBeLessThanOrEqual(capMs);
    }
    const final = await getListing(h, listing.id);
    expect(final.endsAtMs).toBe(capMs);
    expect(final.baseEndsAtMs).toBe(listing.baseEndsAtMs);
  });
});

describe('the confirming review bound', () => {
  it('parks an over-aged confirming settlement in review with NO default consequences', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    // The signature lands and the chain stays undecided for seven hours
    // (past the six-hour bound): driven at the db seam because the dev
    // economy settles instantly.
    expect(await h.db.submitSettlementSignature(settlement.id, 'sig-stuck-review')).toBe('ok');
    h.setNow(listing.endsAtMs + 1 + 7 * 3600 * 1000);
    const stats = await h.service.sweepPass();
    expect(stats?.reviewed, 'the reviewed arm counts its park').toBe(1);
    const parked = await getSettlement(h, settlement.id);
    expect(parked.state).toBe('review');
    expect(parked.failReason).toBe('confirming_overdue');
    // AMBIGUOUS by construction, so none of the overdue default consequences
    // may fire: no defaulted stamp, no forfeit, no strike, and the listing
    // stays parked behind the still-open settlement. (Belt only: with the
    // review arm deleted the ['offered','failed'] CAS misses and returns
    // early, so these pass either way; the state and fail_reason pins above
    // are the decisive ones.)
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('won');
    expect(bid.bondState).toBe('held');
    expect(await h.db.strikeInfo(BUYER_A)).toBeNull();
    expect((await getListing(h, listing.id)).status).toBe('settling');
    // Out of the polling set, visible to the ops readout, and the operator
    // arms are real transitions (review -> confirmed resumes delivery).
    const readout = await h.db.stuckCustodyReadout(REALM, h.now() + 1, 10, 1000, h.now() + 1);
    expect(readout.reviewSettlements.count).toBe(1);
    expect(readout.reviewSettlements.sample[0]).toMatchObject({ id: settlement.id });
    expect(await h.db.transitionSettlement(settlement.id, ['review'], 'confirmed')).toBe(true);
  });

  it('a recorded-signature retry against a review-parked row answers the state', async () => {
    // The H15 park can land between a recording and its retry (an in-flight
    // request, a wallet resubmit): "purchase gone" (not_active) is exactly
    // wrong for money under review. The outcome arm answers the state and
    // the window renders it honestly; a DIFFERENT signature still gets no
    // outcome.
    const h = makeHarness();
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    expect(await h.db.submitSettlementSignature(settlement.id, 'sig-review-retry')).toBe('ok');
    h.setNow(listing.endsAtMs + 1 + 7 * 3600 * 1000);
    await h.service.sweepPass();
    expect((await getSettlement(h, settlement.id)).state).toBe('review');
    const retry = unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-review-retry'),
      'confirmSettlement',
    );
    expect(retry.state).toBe('review');
    expect(await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-other-string')).toEqual({
      ok: false,
      reason: 'not_active',
    });
  });
});

describe('buy-now claim cooldown', () => {
  it('an abandoned window blocks the abandoner from re-claiming the listing', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    // The window expires unpaid: the overdue arm records the abandonment,
    // clears the lock (holder-guarded), and takes NO strike on a public
    // listing.
    h.setNow(BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000 + 1);
    await h.service.sweepPass();
    expect(h.db.buyNowAbandons).toHaveLength(1);
    expect(h.db.buyNowAbandons[0]).toMatchObject({ listingId: listing.id, account: BUYER_A });
    expect(await h.db.strikeInfo(BUYER_A)).toBeNull();
    expect((await getListing(h, listing.id)).buyNowLockAccount).toBeNull();
    // The abandoner's re-claim refuses for the cooldown; a different buyer
    // claims normally.
    expect(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
    ).toEqual({
      ok: false,
      reason: 'claim_cooldown',
      // The refusal names the remaining time: the abandon's window end plus
      // the re-claim cooldown, minus the one ms the clock has advanced,
      // ceiled back up to the full cooldown.
      params: { retryAfterSeconds: WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS },
    });
    const other = await h.service.buyNow({
      account: BUYER_C,
      characterId: CHAR_C,
      listingId: listing.id,
      acceptTerms: true,
    });
    expect(other.ok).toBe(true);
  });

  it('the two recorders dedupe one abandonment on the window key', async () => {
    // The steal-time recorder and the sweep's canonical one both key on
    // (listing, account, lock_expires), and the coupling holds only because
    // buyNow sets the settlement deadline TO the lock expiry. If they ever
    // diverge, one walk-away writes two ledger rows and the hourly cap
    // effectively halves.
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    // The window expires; the sweep records (canonical) and clears the lock.
    h.setNow(BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000 + 1);
    await h.service.sweepPass();
    expect(h.db.buyNowAbandons).toHaveLength(1);
    // A steal-shaped second recording of the SAME window (the crash-window
    // belt path) lands on the dedupe key and writes nothing new.
    await h.db.recordBuyNowAbandon(
      REALM,
      listing.id,
      BUYER_A,
      BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000,
    );
    expect(h.db.buyNowAbandons).toHaveLength(1);
  });

  it('exempts only chain-plausible refusal classes, never a bare posted signature', async () => {
    // The exemption keys on the REFUSAL CLASS, not signature presence: a
    // fabricated 256-char string is recorded and refused in one request, and
    // exempting on the signature alone let that single request bypass the
    // whole cooldown arm.
    const play = async (failReason: string): Promise<number> => {
      const h = makeHarness();
      const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
      const bought = unwrap(
        await h.service.buyNow({
          account: BUYER_A,
          characterId: CHAR_A,
          listingId: listing.id,
          acceptTerms: true,
        }),
        'buyNow',
      );
      expect(await h.db.submitSettlementSignature(bought.settlement.id, `sig-${failReason}`)).toBe(
        'ok',
      );
      await h.db.transitionSettlement(bought.settlement.id, ['confirming'], 'failed', failReason);
      h.setNow(bought.settlement.deadlineAtMs + 1);
      await h.service.sweepPass();
      expect(
        (await getListing(h, listing.id)).buyNowLockAccount,
        'the lock clears either way',
      ).toBeNull();
      return h.db.buyNowAbandons.length;
    };
    // service_unavailable: an infrastructure verdict, not mintable on
    // demand; exempt.
    expect(await play('service_unavailable')).toBe(0);
    // quote_expired RECORDS: that verdict is attacker-mintable by waiting
    // out the 90s quote TTL and posting any string (the signature-first
    // intake records it), so exempting it re-opened the loop. The genuinely
    // late honest buyer eats one recoverable abandon row until R5 provides
    // a chain-true verdict.
    expect(await play('quote_expired')).toBe(1);
    // A plain refusal (a fabricated or unknown signature): RECORDS, closing
    // the griefer's one-request bypass.
    expect(await play('refused')).toBe(1);
  });

  it('the exemption also requires a recorded signature, not the reason alone', async () => {
    // The tx_signature IS NOT NULL conjunct: an exempt-reason row WITHOUT a
    // recorded signature proves nothing about money in flight, so the window
    // still records. Dropping the conjunct would widen the exemption to any
    // failure the service labels service_unavailable, signature or not.
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const bought = unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    await h.db.transitionSettlement(
      bought.settlement.id,
      ['offered'],
      'failed',
      'service_unavailable',
    );
    h.setNow(bought.settlement.deadlineAtMs + 1);
    await h.service.sweepPass();
    expect(h.db.buyNowAbandons.length, 'no signature, no exemption').toBe(1);
  });
});

describe('sweep close', () => {
  it('closes a no-bid auction as no_bids and flies the copy home', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('closed');
    expect(row.resolution).toBe('no_bids');
    expect(row.itemDisposed).toBe(true);
    expect(h.custody.parcels).toEqual([
      {
        recipientKey: String(SELLER_CHAR),
        letter: 'return',
        items: [expect.objectContaining({ itemId: EPIC_ITEM })],
        custodyRef: listingReturnCustodyRef(listing.id),
      },
    ]);
  });

  it('closes below reserve: standing bid outbid, bond refunded, copy returned', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { reserveCents: 6000 });
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('closed');
    expect(row.resolution).toBe('reserve_not_met');
    expect(row.itemDisposed).toBe(true);
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('outbid');
    // The close flips the bond to refund_due; the same pass's bond arm then
    // refunds it through the dev economy, so the guarded refund_due ->
    // refunded transition is what proves the intermediate state.
    expect(bid.bondState).toBe('refunded');
    expect(h.custody.parcels.map((p) => p.custodyRef)).toEqual([
      listingReturnCustodyRef(listing.id),
    ]);
    expect(await h.db.liveSettlementForListing(listing.id)).toBeNull();
  });

  it('closes with a winner: bid won, settlement offered at attempt 1, listing settling', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    const sweepAt = listing.endsAtMs + 1;
    h.setNow(sweepAt);
    await h.service.sweepPass();
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('won');
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('settling');
    const settlement = await liveSettlement(h, listing.id);
    expect(settlement).toMatchObject({
      listingId: listing.id,
      bidId: standing.bidId,
      attempt: 1,
      buyerAccount: BUYER_A,
      buyerCharacter: CHAR_A,
      buyerName: 'Aldan',
      amountCents: 5000,
      state: 'offered',
      deadlineAtMs: sweepAt + WOC_MARKET_SETTLEMENT_WINDOW_SECONDS * 1000,
    });
    // The copy stays in escrow while the settlement is live.
    expect(h.custody.parcels).toHaveLength(0);
  });

  it('a buy-now landing just before the close wins it: bid outbid, bond refunded, one settlement', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'auction_buy_now', buyNowCents: 8000 });
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    // The buy-now lands one second before the hammer falls, so its settlement
    // is live (and not yet overdue) when the close arm reaches the listing.
    h.setNow(listing.endsAtMs - 1000);
    const buy = unwrap(
      await h.service.buyNow({
        account: BUYER_C,
        characterId: CHAR_C,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    // Exactly one winner. The standing bid never sits 'won' with no settlement
    // behind it, and its bond rides the refund pipeline inside the same pass.
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('outbid');
    expect(bid.bondState).toBe('refunded');
    const settlement = await liveSettlement(h, listing.id);
    expect(settlement?.id).toBe(buy.settlement.id);
    expect((await getListing(h, listing.id)).status).toBe('settling');
  });

  it('the close race queues the loser bond as refund_due even when the refund cannot settle yet', async () => {
    const h = makeHarness();
    // A refund pipeline that cannot finish (chain RPC down) must still show
    // the close arm's own stamp: the queue entry, not the terminal state.
    const stalledRefunds = new WocMarketService({
      ...h.deps,
      economy: { ...h.economy, refundBond: async () => ({ done: false, reason: 'rpc_down' }) },
    });
    const listing = await listEpic(h, { format: 'auction_buy_now', buyNowCents: 8000 });
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs - 1000);
    unwrap(
      await stalledRefunds.buyNow({
        account: BUYER_C,
        characterId: CHAR_C,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    h.setNow(listing.endsAtMs + 1);
    await stalledRefunds.sweepPass();
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('outbid');
    expect(bid.bondState).toBe('refund_due');
  });
});

describe('a bond payment awaiting finality', () => {
  /** An economy whose confirm is UNDECIDED: paid, but the chain has not said so
   *  yet. Exactly what a real confirm returns for tens of seconds after a
   *  mainnet broadcast. */
  function undecided(h: Harness): WocMarketEconomy {
    return {
      ...h.economy,
      confirm: async () => ({ settled: false, pending: true, reason: 'awaiting_finality' }),
    };
  }

  it('does NOT refuse it: the money has already left the wallet', async () => {
    // The defect this pins cost a real settlement its money once, and the same
    // shape survived in the bid leg: an undecided verdict was reported as
    // confirm_failed, so a good payment was answered with "could not be
    // confirmed" while the tokens were gone.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const svc = new WocMarketService({ ...h.deps, economy: undecided(h) });
    const out = await svc.confirmBond(BUYER_A, placed.bid.id, 'sig-bond-pending');
    expect(out, 'accepted, and honestly reported as not yet standing').toEqual({
      ok: true,
      standing: false,
      pending: true,
      reason: 'awaiting_finality',
    });
    const bid = await getBid(h, placed.bid.id);
    expect(bid.status, 'the bid stays alive to be resolved').toBe('pending_bond');
    expect(bid.bondSignature, 'with the signature kept for the re-check').toBe('sig-bond-pending');
  });

  it('parks an undecided bond past the poll delay and skips it while backing off', async () => {
    // DB-free mirror of the pg park proof (the CI floor runs without
    // TEST_DATABASE_URL): the poll keeps full cadence while the bond is
    // young, rotates it to the tail once its SIGNATURE age passes the park
    // delay, and the in-process backoff then excludes it from the next
    // pass's batch read entirely. Confirm-call counting is the observable:
    // one ask per pass while unparked, none while backing off.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    let confirms = 0;
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => {
          confirms++;
          return { settled: false, pending: true, reason: 'awaiting_finality' };
        },
      },
    });
    unwrap(await svc.confirmBond(BUYER_A, placed.bid.id, 'sig-park-me'), 'confirmBond');
    expect(confirms).toBe(1);
    // Young bond: the next pass still polls it (no park below the delay).
    await svc.sweepPass();
    expect(confirms).toBe(2);
    // Past the park delay (aged on the signature recording): this pass still
    // polls it (the verdict could have landed), then parks it.
    h.setNow(h.now() + WOC_MARKET_BOND_POLL_PARK_SECONDS * 1000 + 1);
    await svc.sweepPass();
    expect(confirms).toBe(3);
    // Backing off: the batch read excludes it, so the chain is not asked.
    await svc.sweepPass();
    expect(confirms).toBe(3);
    const bid = await getBid(h, placed.bid.id);
    expect(bid.status, 'still with the poll, never voided').toBe('pending_bond');
    expect(bid.bondState).toBe('pending');
  });

  it('activates the bid once the sweep sees the chain decide', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const svc = new WocMarketService({ ...h.deps, economy: undecided(h) });
    await svc.confirmBond(BUYER_A, placed.bid.id, 'sig-bond-pending');
    // The chain decides in the player's favour; the ordinary sweep finishes it.
    await h.service.sweepPass();
    const bid = await getBid(h, placed.bid.id);
    expect(bid.status).toBe('active');
    expect(bid.bondState).toBe('held');
    expect((await getListing(h, listing.id)).currentBidId).toBe(placed.bid.id);
  });

  it('lapses the bid when the chain decides AGAINST it', async () => {
    // Only a DECIDED verdict may end it. A refusal is a real answer and the bid
    // must not linger holding a seat it never paid for.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const svc = new WocMarketService({ ...h.deps, economy: undecided(h) });
    await svc.confirmBond(BUYER_A, placed.bid.id, 'sig-bond-pending');
    const refusing = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({ settled: false, pending: false, reason: 'refused' }),
      },
    });
    await refusing.sweepPass();
    const bid = await getBid(h, placed.bid.id);
    expect(bid.status).toBe('lapsed');
    expect(bid.bondState).toBe('void');
  });

  it('never lapses a PAID bond on the TTL sweep while it awaits finality', async () => {
    // The lapse arm reaps unconfirmed bonds past their TTL. A bond with a
    // signature is funded, so reaping it would void money the bidder has
    // already spent while the chain was still thinking.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const svc = new WocMarketService({ ...h.deps, economy: undecided(h) });
    await svc.confirmBond(BUYER_A, placed.bid.id, 'sig-bond-pending');
    // Well past the pending-bond TTL.
    h.setNow(BASE_MS + WOC_MARKET_BOND_PENDING_TTL_SECONDS * 1000 + 60_000);
    await svc.sweepPass();
    expect((await getBid(h, placed.bid.id)).status, 'still awaiting the chain').toBe(
      'pending_bond',
    );
  });

  it('refuses a signature already spent on another bid', async () => {
    // One broadcast pays for one thing. Replaying it must not fund a second
    // bond, which is what the unique index on the column enforces.
    const h = makeHarness();
    const listing = await listEpic(h);
    const first = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const second = unwrap(
      await placeBid(h, {
        account: BUYER_B,
        characterId: CHAR_B,
        listingId: listing.id,
        amountCents: 6000,
      }),
      'placeBid',
    );
    const svc = new WocMarketService({ ...h.deps, economy: undecided(h) });
    await svc.confirmBond(BUYER_A, first.bid.id, 'sig-shared');
    expect(await svc.confirmBond(BUYER_B, second.bid.id, 'sig-shared')).toEqual({
      ok: false,
      reason: 'signature_reused',
    });
  });
});

describe('settlement happy path', () => {
  it('quote then confirm delivers eagerly, records the sale, and refunds the bond on the next sweep', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    const sweepAt = listing.endsAtMs + 1;
    h.setNow(sweepAt);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);

    const quoted = unwrap(
      await h.service.settlementQuote(BUYER_A, settlement.id),
      'settlementQuote',
    );
    expect(quoted.quote.ok).toBe(true);
    expect(quoted.quote.reference).toMatch(/^dev_woc_/);
    expect(quoted.quote.seller).not.toBeNull(); // the split legs of a settlement quote
    const stamped = await getSettlement(h, settlement.id);
    expect(stamped.quoteReference).toBe(quoted.quote.reference);
    expect(stamped.quoteExpiresAtMs).toBe(sweepAt + WOC_MARKET_QUOTE_TTL_SECONDS * 1000);

    const confirmed = unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-settle-1'),
      'confirmSettlement',
    );
    expect(confirmed.state).toBe('delivered');
    const after = await getSettlement(h, settlement.id);
    expect(after.state).toBe('delivered');
    expect(after.txSignature).toBe('sig-settle-1');

    const sales = await h.db.salesForItem(REALM, EPIC_ITEM, 10);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      listingId: listing.id,
      itemId: EPIC_ITEM,
      priceCents: 5000,
      sellerAccount: SELLER,
      buyerAccount: BUYER_A,
      sellerName: 'Selara',
      buyerName: 'Aldan',
    });

    const row = await getListing(h, listing.id);
    expect(row.status).toBe('closed');
    expect(row.resolution).toBe('sold');
    expect(row.itemDisposed).toBe(true);

    const delivery = h.custody.parcels.find((p) => p.letter === 'delivery');
    expect(delivery).toEqual({
      recipientKey: String(CHAR_A),
      letter: 'delivery',
      items: [expect.objectContaining({ itemId: EPIC_ITEM })],
      custodyRef: settlementCustodyRef(settlement.id),
    });
    const notice = h.custody.parcels.find((p) => p.letter === 'sold_notice');
    expect(notice).toEqual({
      recipientKey: String(SELLER_CHAR),
      letter: 'sold_notice',
      items: [],
      custodyRef: listingSoldNoticeCustodyRef(listing.id),
    });

    // The winner's bond is owed back after delivery; the next sweep moves it.
    let bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('won');
    expect(bid.bondState).toBe('refund_due');
    await h.service.sweepPass();
    bid = await getBid(h, standing.bidId);
    expect(bid.bondState).toBe('refunded');
  });
});

describe('settlement quote expiry and signature reuse', () => {
  it('answers confirm_failed for a dead quote, recording quote_expired as the fail reason', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    const sweepAt = listing.endsAtMs + 1;
    h.setNow(sweepAt);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    // The quote (90s) dies long before the settlement window (600s). The
    // intake no longer refuses BEFORE recording: the signature is the only
    // trace of a transfer that may already have left the wallet, so it lands
    // in the ledger and the CHAIN's verdict decides (the dev economy refuses
    // a dead quote, so the row fails with that verdict recorded).
    h.setNow(sweepAt + WOC_MARKET_QUOTE_TTL_SECONDS * 1000);
    const res = await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-stale-settle');
    expect(res).toEqual({ ok: false, reason: 'confirm_failed' });
    const after = await getSettlement(h, settlement.id);
    // The verdict came from the chain, AFTER the ledger write: the signature
    // stays as the trace, and the row is retry-eligible 'failed', not a
    // silent bounce back to 'offered' with the evidence discarded.
    expect(after.state).toBe('failed');
    expect(after.txSignature).toBe('sig-stale-settle');
    expect(after.failReason).toBe('quote_expired');
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10)).toHaveLength(0);
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('settling');
    expect(row.itemDisposed).toBe(false);
    expect(h.custody.parcels).toHaveLength(0);
    // The winner keeps their seat: the bond stays held, neither forfeited nor
    // refunded by a refused confirmation.
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('won');
    expect(bid.bondState).toBe('held');
    // The refusal is recoverable inside the window: a fresh quote revives the
    // row and a fresh transfer settles it.
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    const settled = unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-fresh-settle'),
      'confirmSettlement',
    );
    expect(settled.state).toBe('delivered');
  });

  it('a same-signature retry on a confirming settlement re-asks the chain instead of refusing', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    const pendingChain = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({ settled: false, pending: true, reason: null }),
      },
    });
    // Spy on the recording write: the retry must SKIP it (nothing new to
    // record, and re-stamping updated_at would push out the confirming-age
    // review bound, re-opening the unbounded hold it exists to close).
    const record = h.db.submitSettlementSignature.bind(h.db);
    let recordings = 0;
    h.db.submitSettlementSignature = async (id: number, sig: string) => {
      recordings++;
      return record(id, sig);
    };
    const first = unwrap(
      await pendingChain.confirmSettlement(BUYER_A, settlement.id, 'sig-retry-settle'),
      'confirmSettlement',
    );
    expect(first.state).toBe('confirming');
    // The network-blip retry: same signature, still undecided. The old
    // offered-only precondition refused this as not_active, stranding the
    // buyer behind a false dead-row verdict while their payment confirmed.
    const retry = unwrap(
      await pendingChain.confirmSettlement(BUYER_A, settlement.id, 'sig-retry-settle'),
      'confirmSettlement',
    );
    expect(retry.state).toBe('confirming');
    expect(recordings).toBe(1);
    // The decided verdict completes the SAME retry path end to end.
    const done = unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-retry-settle'),
      'confirmSettlement',
    );
    expect(done.state).toBe('delivered');
  });

  it('a DIFFERENT signature on a confirming settlement refuses typed, never as a dead row', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    const pendingChain = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({ settled: false, pending: true, reason: null }),
      },
    });
    unwrap(
      await pendingChain.confirmSettlement(BUYER_A, settlement.id, 'sig-in-flight'),
      'confirmSettlement',
    );
    // The bond leg's rule on this leg: 'not_active' misread a live confirming
    // row as gone; the honest refusal is that a payment is being decided.
    const res = await pendingChain.confirmSettlement(BUYER_A, settlement.id, 'sig-usurper');
    expect(res).toEqual({ ok: false, reason: 'confirm_in_flight' });
    const after = await getSettlement(h, settlement.id);
    expect(after.state).toBe('confirming');
    expect(after.txSignature).toBe('sig-in-flight');
  });

  it('a same-signature retry after the sale completed answers the outcome, not a refusal', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    const done = unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-done-settle'),
      'confirmSettlement',
    );
    expect(done.state).toBe('delivered');
    const sales = await h.db.salesForItem(REALM, EPIC_ITEM, 10);
    expect(sales).toHaveLength(1);
    // The blip retry: the buyer's client never saw the response. 'not_active'
    // read as "purchase gone" for a COMPLETED sale; the retry answers the
    // outcome, re-drives nothing, and mints no second sale.
    const retry = unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-done-settle'),
      'confirmSettlement',
    );
    expect(retry.state).toBe('delivered');
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10)).toHaveLength(1);
    // A DIFFERENT string against the completed sale still refuses.
    expect(await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-other')).toEqual({
      ok: false,
      reason: 'not_active',
    });
  });

  it('refuses signature_reused when one transfer is replayed on a second settlement', async () => {
    const h = makeHarness();
    // Two escrowed copies, because the replay only matters ACROSS settlements:
    // the tx_signature uniqueness is what stops one paid transfer from claiming
    // two items.
    h.custody.bags.set(SELLER_CHAR, [
      { itemId: EPIC_ITEM, count: 1 },
      { itemId: EPIC_ITEM, count: 1 },
    ]);
    const paidListing = await listEpic(h);
    const replayListing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, paidListing.id, 5000);
    const replayBid = await confirmedBid(h, BUYER_A, CHAR_A, replayListing.id, 5000);
    h.setNow(paidListing.endsAtMs + 1);
    await h.service.sweepPass();
    const paid = await liveSettlement(h, paidListing.id);
    const replay = await liveSettlement(h, replayListing.id);

    unwrap(await h.service.settlementQuote(BUYER_A, paid.id), 'settlementQuote');
    const settled = unwrap(
      await h.service.confirmSettlement(BUYER_A, paid.id, 'sig-one-transfer'),
      'confirmSettlement',
    );
    expect(settled.state).toBe('delivered');

    unwrap(await h.service.settlementQuote(BUYER_A, replay.id), 'settlementQuote');
    const res = await h.service.confirmSettlement(BUYER_A, replay.id, 'sig-one-transfer');
    expect(res).toEqual({ ok: false, reason: 'signature_reused' });
    const stillOffered = await getSettlement(h, replay.id);
    expect(stillOffered.state).toBe('offered');
    expect(stillOffered.txSignature).toBeNull();
    // The stamped quote survives the refusal, so the buyer can retry with a real
    // transfer inside the same window.
    expect(stillOffered.quoteReference).not.toBeNull();
    // Exactly one sale, for the settlement that actually paid.
    const sales = await h.db.salesForItem(REALM, EPIC_ITEM, 10);
    expect(sales.map((s) => s.listingId)).toEqual([paidListing.id]);
    const row = await getListing(h, replayListing.id);
    expect(row.status).toBe('settling');
    expect(row.itemDisposed).toBe(false);
    // One delivery only: the second copy is still in escrow.
    const deliveries = h.custody.parcels.filter((p) => p.letter === 'delivery');
    expect(deliveries.map((p) => p.custodyRef)).toEqual([settlementCustodyRef(paid.id)]);
    const bid = await getBid(h, replayBid.bidId);
    expect(bid.status).toBe('won');
    expect(bid.bondState).toBe('held');
  });
});

describe('settlement expiry', () => {
  it('expires an unpaid settlement: defaulted winner, forfeited bond, one strike, unsettled return', async () => {
    const h = makeHarness();
    const listing = await listEpic(h); // offerNext false
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);

    h.setNow(settlement.deadlineAtMs + 1);
    await h.service.sweepPass();

    const after = await getSettlement(h, settlement.id);
    expect(after.state).toBe('expired');
    expect(after.failReason).toBe('window_elapsed');
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('defaulted');
    // forfeit_due was processed by the same pass's bond arm (guarded
    // forfeit_due -> forfeited proves the intermediate state).
    expect(bid.bondState).toBe('forfeited');
    // First strike earns no suspension (strikeSuspensionMs(1) is 0), so the
    // service passes null and the insert arm stores null.
    expect(await h.db.strikeInfo(BUYER_A)).toEqual({
      accountId: BUYER_A,
      strikes: 1,
      suspendedUntilMs: null,
    });
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('closed');
    expect(row.resolution).toBe('unsettled');
    expect(row.itemDisposed).toBe(true);
    expect(h.custody.parcels.map((p) => p.custodyRef)).toEqual([
      listingReturnCustodyRef(listing.id),
    ]);
  });

  it('spares the auction-default strike during an oracle outage; default and forfeit still land', async () => {
    // The shared fairness gate (strikeDefaultingBuyer, the directed arms'
    // gate): payment was impossible while pricing was down (settlementQuote
    // and confirmSettlement refuse market_paused in the same window), so the
    // outage costs the winner no strike. The default stamp and the bond
    // forfeiture stay: the forfeit is the R2-ruled consequence, deliberately
    // ungated here (the outage-forfeit question is recorded for the
    // pre-enable audit, not decided by this arm).
    const h = makeHarness();
    const listing = await listEpic(h);
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    const healthyPrice = h.economy.price.bind(h.economy);
    h.economy.price = (async () => ({
      available: false,
      healthy: false,
    })) as unknown as typeof h.economy.price;
    h.setNow(settlement.deadlineAtMs + 1);
    await h.service.sweepPass();
    expect((await getSettlement(h, settlement.id)).state).toBe('expired');
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('defaulted');
    // Forfeited in the SAME pass even mid-outage (the dev economy's forfeit
    // is not price-gated); the load-bearing claim is it never routes back to
    // the bidder, and the exact state pins that.
    expect(bid.bondState).toBe('forfeited');
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(0);
    // Durable-state control: the expiry CAS fired once, so a later HEALTHY
    // pass drains the forfeit but can never retro-strike the outage window.
    h.economy.price = healthyPrice;
    await h.service.sweepPass();
    expect((await getBid(h, standing.bidId)).bondState).toBe('forfeited');
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(0);
  });

  it('offerNext cascades to the outbid bidder at their own amount, attempt 2', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { offerNext: true });
    const under = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    const over = await confirmedBid(h, BUYER_B, CHAR_B, listing.id, 5500);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const first = await liveSettlement(h, listing.id);
    expect(first).toMatchObject({ bidId: over.bidId, attempt: 1, amountCents: 5500 });

    h.setNow(first.deadlineAtMs + 1);
    await h.service.sweepPass();
    expect((await getSettlement(h, first.id)).state).toBe('expired');
    expect((await getBid(h, over.bidId)).status).toBe('defaulted');
    const cascade = await liveSettlement(h, listing.id);
    expect(cascade.id).not.toBe(first.id);
    expect(cascade).toMatchObject({
      listingId: listing.id,
      bidId: under.bidId,
      attempt: 2,
      buyerAccount: BUYER_A,
      buyerCharacter: CHAR_A,
      // The cascade offer is at the OUTBID BIDDER'S OWN amount, never the
      // defaulted winner's price.
      amountCents: 5000,
      state: 'offered',
    });
    expect((await getBid(h, under.bidId)).status).toBe('won');
    // The listing stays in settlement, not closed, and the copy stays escrowed.
    expect((await getListing(h, listing.id)).status).toBe('settling');
    expect(h.custody.parcels).toHaveLength(0);
  });
});

describe('buy now', () => {
  it('locks, settles at the buy-now price, refuses a rival, cancels the standing bid on delivery', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);

    const buy = unwrap(
      await h.service.buyNow({
        account: BUYER_B,
        characterId: CHAR_B,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    expect(buy.settlement).toMatchObject({
      listingId: listing.id,
      bidId: null,
      attempt: 0,
      buyerAccount: BUYER_B,
      buyerCharacter: CHAR_B,
      buyerName: 'Brint',
      amountCents: 8000,
      state: 'offered',
      deadlineAtMs: BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000,
    });
    expect(buy.quote.ok).toBe(true);
    expect(buy.quote.reference).toMatch(/^dev_woc_/);
    const locked = await getListing(h, listing.id);
    expect(locked.buyNowLockAccount).toBe(BUYER_B);
    expect(locked.buyNowLockExpiresMs).toBe(BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000);

    const rival = await h.service.buyNow({
      account: BUYER_C,
      characterId: CHAR_C,
      listingId: listing.id,
      acceptTerms: true,
    });
    expect(rival).toEqual({ ok: false, reason: 'buy_now_locked' });

    const confirmed = unwrap(
      await h.service.confirmSettlement(BUYER_B, buy.settlement.id, 'sig-buy-now'),
      'confirmSettlement',
    );
    expect(confirmed.state).toBe('delivered');
    const sales = await h.db.salesForItem(REALM, EPIC_ITEM, 10);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ priceCents: 8000, buyerName: 'Brint' });
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('closed');
    expect(row.resolution).toBe('sold');
    expect(row.itemDisposed).toBe(true);
    // The buy-now landed over a standing auction bid: it is cancelled with
    // its held bond owed back.
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('cancelled');
    expect(bid.bondState).toBe('refund_due');
    const delivery = h.custody.parcels.find((p) => p.letter === 'delivery');
    expect(delivery).toMatchObject({
      recipientKey: String(CHAR_B),
      custodyRef: settlementCustodyRef(buy.settlement.id),
    });
  });

  it('lapses an abandoned buy-now lock on the sweep and leaves the listing live', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const buy = unwrap(
      await h.service.buyNow({
        account: BUYER_B,
        characterId: CHAR_B,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    // The holder walked away without ever signing. A lock that outlives its
    // deadline takes the listing off the market for good while the auction clock
    // keeps running down, so the item resolves with nobody able to buy it.
    h.setNow(BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000);
    await h.service.sweepPass();
    const lapsed = await getSettlement(h, buy.settlement.id);
    expect(lapsed.state).toBe('expired');
    expect(lapsed.failReason).toBe('window_elapsed');
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('active');
    expect(row.buyNowLockAccount).toBeNull();
    expect(row.buyNowLockExpiresMs).toBeNull();
    expect(row.itemDisposed).toBe(false);
    // No bid and no bond was ever at risk, so an abandoned buy-now earns no
    // strike: the strike ladder punishes defaulting WINNERS.
    expect(await h.db.strikeInfo(BUYER_B)).toBeNull();
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10)).toHaveLength(0);
    expect(h.custody.parcels).toHaveLength(0);
    // Still biddable AND still buyable: the next buyer takes a fresh lock.
    const bid = await placeBid(h, {
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      amountCents: 5000,
    });
    expect(bid.ok).toBe(true);
    const next = unwrap(
      await h.service.buyNow({
        account: BUYER_C,
        characterId: CHAR_C,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    expect(next.settlement.buyerAccount).toBe(BUYER_C);
    expect(next.settlement.amountCents).toBe(8000);
    expect((await getListing(h, listing.id)).buyNowLockAccount).toBe(BUYER_C);
  });
});

describe('crash reconciliation', () => {
  it('a delivering settlement survives a persist crash and books exactly once on retry', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    // A worker claimed delivery and crashed mid-flight.
    expect(await h.db.transitionSettlement(settlement.id, ['offered'], 'delivering')).toBe(true);
    h.custody.failNextPersist = true;
    // The failing row is ISOLATED and reported, never thrown out of the pass,
    // and the arm counts rows ADVANCED, so this failing one scores zero.
    const stats = await h.service.sweepPass();
    expect(stats?.reconciled).toBe(0);
    expect(h.sweepErrors.map(([arm]) => arm)).toContain('reconciled');
    expect((await getSettlement(h, settlement.id)).state).toBe('delivering');
    // The parcel entered the LIVE book before the blob failure; nothing is
    // durable or booked yet, and the claim stays visible for the resume.
    expect(h.custody.parcels).toHaveLength(1);
    expect(h.db.custodyClaims.get(settlementCustodyRef(settlement.id))?.bookedAtMs).toBeNull();

    // The next pass resumes the stuck row and books the parcel exactly once
    // (a THROWN attempt takes no park backoff: the very next pass retries).
    const retry = await h.service.sweepPass();
    expect(retry?.reconciled).toBe(1);
    expect((await getSettlement(h, settlement.id)).state).toBe('delivered');
    const deliveries = h.custody.parcels.filter(
      (p) => p.custodyRef === settlementCustodyRef(settlement.id),
    );
    expect(deliveries).toHaveLength(1);
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10)).toHaveLength(1);
    const row = await getListing(h, listing.id);
    expect(row.resolution).toBe('sold');
    expect(row.itemDisposed).toBe(true);
  });
});

describe('stranded listing reclaim', () => {
  it('reopens a listing stuck in ending past the grace so the close arm resolves it', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    h.setNow(listing.endsAtMs + 1);
    // A worker claimed the due listing and died before resolving it. Nothing
    // else can reach an 'ending' row (claimDueListings only selects 'active'),
    // so without the reclaim the escrowed copy is stranded forever.
    const claimed = await h.db.claimDueListings(REALM, h.now(), 10);
    expect(claimed.map((r) => r.id)).toEqual([listing.id]);
    expect((await getListing(h, listing.id)).status).toBe('ending');

    h.setNow(listing.endsAtMs + 1 + WOC_MARKET_STRANDED_RECLAIM_SECONDS * 1000);
    const stats = await h.service.sweepPass();
    expect(stats?.reclaimed).toBe(1);
    expect(stats?.closed).toBe(1);
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('closed');
    expect(row.resolution).toBe('no_bids');
    expect(row.itemDisposed).toBe(true);
    expect(h.custody.parcels.map((p) => p.custodyRef)).toEqual([
      listingReturnCustodyRef(listing.id),
    ]);
  });

  it('leaves a mid-resolution listing alone one millisecond inside the grace', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    h.setNow(listing.endsAtMs + 1);
    await h.db.claimDueListings(REALM, h.now(), 10);
    // One millisecond short of the grace. Reclaiming early would race a worker
    // that is still resolving the row and resolve the same auction twice.
    h.setNow(listing.endsAtMs + WOC_MARKET_STRANDED_RECLAIM_SECONDS * 1000);
    const stats = await h.service.sweepPass();
    expect(stats?.reclaimed).toBe(0);
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('ending');
    expect(row.resolution).toBeNull();
    expect(row.itemDisposed).toBe(false);
    expect(h.custody.parcels).toHaveLength(0);
  });
});

describe('custody book-once claims', () => {
  it('keeps a failed booking VISIBLE and books exactly once on the retry', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    expect(await h.service.adminSuspendListing(listing.id)).toEqual({ ok: true });
    const ref = listingReturnCustodyRef(listing.id);
    // The mail persist fails after the claim landed. The claim STAYS, unbooked
    // (releasing it hid a repeatedly failing write from the operator); the
    // resume path re-reads booked_at, so a kept claim can never masquerade as
    // a booked one.
    h.custody.failNextPersist = true;
    await h.service.sweepPass();
    expect(h.custody.persistCalls).toEqual([ref]);
    expect(h.custody.parcels, 'live but not durable').toHaveLength(1);
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBeNull();
    expect(h.db.custodyClaims.get(ref)?.mailIntentAtMs, 'the mail rail owns it').not.toBeNull();
    expect((await getListing(h, listing.id)).itemDisposed).toBe(false);
    expect(
      h.sweepErrors.map(([arm]) => arm),
      'the failure is reported',
    ).toContain('returned');

    await h.service.sweepPass();
    // Two ATTEMPTS, one booking: the ledger is what makes the retry safe.
    expect(h.custody.persistCalls).toEqual([ref, ref]);
    expect(h.custody.parcels).toEqual([
      {
        recipientKey: String(SELLER_CHAR),
        letter: 'return',
        items: [expect.objectContaining({ itemId: EPIC_ITEM })],
        custodyRef: ref,
      },
    ]);
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBe(BASE_MS);
    expect((await getListing(h, listing.id)).itemDisposed).toBe(true);
  });

  it('never re-mails a custody ref a previous pass already booked', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    await h.service.adminSuspendListing(listing.id);
    const ref = listingReturnCustodyRef(listing.id);
    // A previous pass booked and persisted the parcel but died before marking
    // the item disposed, so the backlog still holds this listing. The Postgres
    // claim (not the mail blob, which a player can delete) is the authority that
    // keeps the reconciliation from mailing the copy a second time.
    expect(await h.db.claimCustodyRef(REALM, ref)).toBe(true);
    await h.db.markCustodyRefBooked(ref);
    h.setNow(BASE_MS + 60_000);
    await h.service.sweepPass();
    expect(h.custody.persistCalls).toEqual([]);
    expect(h.custody.parcels).toHaveLength(0);
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBe(BASE_MS);
    // The flight still settles: the listing leaves the backlog.
    expect((await getListing(h, listing.id)).itemDisposed).toBe(true);
  });
});

describe('bond lapse', () => {
  it('a pending bid past the bond TTL lapses with a void bond', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    h.setNow(BASE_MS + WOC_MARKET_BOND_PENDING_TTL_SECONDS * 1000);
    await h.service.sweepPass();
    const bid = await getBid(h, placed.bid.id);
    expect(bid.status).toBe('lapsed');
    expect(bid.bondState).toBe('void');
    // Nothing was transferred, so the bond arm never owes a refund.
    expect(await h.db.bondsDue(REALM, 10)).toHaveLength(0);
  });
});

describe('the kill switch covers the operator writes', () => {
  // WOC_MARKET_ENABLED=0 is the incident lever: it must freeze every write,
  // operator arms included (a suspend returns the item via custody mail, an
  // exclusion rewrites history, a strike clear changes standing). Operator
  // READS stay live on purpose: an incident responder still needs to see
  // residue rows while the market is dark.
  it('refuses the three operator writes and keeps the operator read live', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const disabled = new WocMarketService({
      ...h.deps,
      config: { ...h.deps.config, enabled: false },
    });
    expect(await disabled.adminSuspendListing(listing.id)).toEqual({
      ok: false,
      reason: 'disabled',
    });
    expect(await disabled.adminSetSaleExcluded(1, true)).toEqual({
      ok: false,
      reason: 'disabled',
    });
    expect(await disabled.adminClearStrikes(SELLER)).toEqual({
      ok: false,
      reason: 'disabled',
    });
    // The suspend refusal changed nothing.
    expect((await getListing(h, listing.id)).status).toBe('active');
    // The support read still answers while the market is dark.
    const rows = await disabled.adminListingsBySeller(SELLER);
    expect(rows.map((r) => r.id)).toContain(listing.id);
  });
});

describe('adminSuspendListing', () => {
  it('cancels open bids, refunds held bonds, expires the live settlement, and returns the item', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    const buy = unwrap(
      await h.service.buyNow({
        account: BUYER_B,
        characterId: CHAR_B,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );

    // While the buy-now lock is unexpired a payment may be mid-flight, so the
    // suspend takes the safe path: refuse and change nothing.
    const blocked = await h.service.adminSuspendListing(listing.id);
    expect(blocked).toEqual({ ok: false, reason: 'settlement_in_flight' });
    expect((await getListing(h, listing.id)).status).toBe('active');
    expect((await getBid(h, standing.bidId)).status).toBe('active');
    expect((await getSettlement(h, buy.settlement.id)).state).toBe('offered');

    // Past the lock window with a SIGNED payment still confirming, the other
    // guard arm takes over: the broadcast may still land, so the suspend
    // keeps refusing and still changes nothing.
    expect(await h.db.submitSettlementSignature(buy.settlement.id, 'sig-suspend-race')).toBe('ok');
    h.setNow(BASE_MS + WOC_MARKET_BUY_NOW_LOCK_SECONDS * 1000 + 1);
    const confirming = await h.service.adminSuspendListing(listing.id);
    expect(confirming).toEqual({ ok: false, reason: 'settlement_in_flight' });
    expect((await getSettlement(h, buy.settlement.id)).state).toBe('confirming');
    expect((await getBid(h, standing.bidId)).status).toBe('active');

    // The chain refuses the payment: a 'failed' settlement has nothing in
    // flight any more, which the suspend may safely expire.
    expect(
      await h.db.transitionSettlement(buy.settlement.id, ['confirming'], 'failed', 'refused'),
    ).toBe(true);
    const out = await h.service.adminSuspendListing(listing.id);
    expect(out).toEqual({ ok: true });
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('cancelled');
    expect(bid.bondState).toBe('refund_due');
    const settlement = await getSettlement(h, buy.settlement.id);
    expect(settlement.state).toBe('expired');
    expect(settlement.failReason).toBe('listing_suspended');
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('closed');
    expect(row.resolution).toBe('suspended');
    expect(row.itemDisposed).toBe(false);

    // The sweep's reconciliation arm flies the copy home and pays the refund.
    await h.service.sweepPass();
    const swept = await getListing(h, listing.id);
    expect(swept.itemDisposed).toBe(true);
    expect(h.custody.parcels).toEqual([
      expect.objectContaining({
        recipientKey: String(SELLER_CHAR),
        letter: 'return',
        custodyRef: listingReturnCustodyRef(listing.id),
      }),
    ]);
    expect((await getBid(h, standing.bidId)).bondState).toBe('refunded');
  });
});

describe('owned loaders (the requireOwned 404 seam)', () => {
  it('ownedListing resolves for the seller and returns null for a foreign or absent id', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const mine = await h.service.ownedListing(SELLER, listing.id);
    expect(mine).not.toBeNull();
    expect(mine?.id).toBe(listing.id);
    expect(mine?.sellerAccount).toBe(SELLER);
    // Both misses return the SAME null, which is what lets the middleware answer
    // 404 either way: a distinguishable "exists but not yours" would turn the
    // seller endpoints into a listing-id enumeration oracle.
    expect(await h.service.ownedListing(BUYER_A, listing.id)).toBeNull();
    expect(await h.service.ownedListing(SELLER, listing.id + 999)).toBeNull();
  });

  it('ownedBid resolves for the bidder and returns null for a foreign or absent id', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const mine = await h.service.ownedBid(BUYER_A, placed.bid.id);
    expect(mine).not.toBeNull();
    expect(mine?.id).toBe(placed.bid.id);
    expect(mine?.account).toBe(BUYER_A);
    expect(mine?.amountCents).toBe(5000);
    // A rival must not be able to read (or confirm against) someone else's bond.
    expect(await h.service.ownedBid(BUYER_B, placed.bid.id)).toBeNull();
    expect(await h.service.ownedBid(BUYER_A, placed.bid.id + 999)).toBeNull();
  });

  it('ownedSettlement resolves for the buyer and returns null for a foreign or absent id', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    const mine = await h.service.ownedSettlement(BUYER_A, settlement.id);
    expect(mine).not.toBeNull();
    expect(mine?.id).toBe(settlement.id);
    expect(mine?.buyerAccount).toBe(BUYER_A);
    expect(mine?.amountCents).toBe(5000);
    // The settlement carries the buyer's wallet and the signed quote, so a
    // foreign read is the one that matters most here.
    expect(await h.service.ownedSettlement(BUYER_C, settlement.id)).toBeNull();
    expect(await h.service.ownedSettlement(BUYER_A, settlement.id + 999)).toBeNull();
  });
});

describe('a directed sale is visible and buyable only to its two parties', () => {
  // The row id is a small integer and therefore guessable, so browse exclusion
  // alone is not a defence. Each test below covers one independent gate.
  const BROWSE: WocBrowseQuery = {
    page: 0,
    pageSize: 50,
    quality: null,
    format: null,
    category: null,
    subcategory: null,
    itemIds: null,
    sort: 'ending',
  };
  const directedParams = (over: Partial<WocListingParams> = {}) =>
    listingParams({
      format: 'buy_now',
      startCents: 5000,
      reserveCents: null,
      buyNowCents: 5000,
      directedBuyerAccount: BUYER_A,
      ...over,
    });
  /** Two epic copies, so one listing does not consume the other's item. */
  function stocked(): Harness {
    const h = makeHarness();
    h.custody.bags.set(
      SELLER_CHAR,
      Array.from({ length: WOC_MARKET_MAX_ACTIVE_LISTINGS + 3 }, () => ({
        itemId: EPIC_ITEM,
        count: 1,
      })),
    );
    return h;
  }

  it('never appears in the public browse result set', async () => {
    const h = stocked();
    const directed = await listEpic(h, directedParams());
    const open = await listEpic(h, { format: 'auction', startCents: 2000 });
    const ids = (await h.service.browse(BROWSE)).rows.map((r) => r.id);
    expect(ids, 'the public listing must still browse').toContain(open.id);
    expect(ids, 'the directed listing must be invisible to everyone').not.toContain(directed.id);
  });

  it('reads as not-found for a stranger, and resolves for either party', async () => {
    const h = stocked();
    const directed = await listEpic(h, directedParams());
    expect(await h.service.listingDetail(directed.id, BUYER_B)).toBeNull();
    // Signed out is the same answer: an absent viewer must not be a bypass.
    expect(await h.service.listingDetail(directed.id, null)).toBeNull();
    expect((await h.service.listingDetail(directed.id, BUYER_A))?.listing.id).toBe(directed.id);
    expect((await h.service.listingDetail(directed.id, SELLER))?.listing.id).toBe(directed.id);
  });

  it('refuses buyNow from anyone but the designated buyer, as not_found', async () => {
    const h = stocked();
    const directed = await listEpic(h, directedParams());
    const res = await h.service.buyNow({
      account: BUYER_B,
      characterId: CHAR_B,
      listingId: directed.id,
      acceptTerms: true,
    });
    expect(res.ok).toBe(false);
    // not_found, NOT a distinct "not for you": a caller probing ids must not be
    // able to tell an empty id from someone else's private trade in flight.
    expect((res as { reason: string }).reason).toBe('not_found');
  });

  it('counts against the seller 12-listing cap in BOTH directions (H12)', async () => {
    // The old exemption let an accomplice pair lock unbounded escrow outside
    // the cap; a directed listing escrows a real copy exactly like a public
    // one, so it counts and is counted.
    const h = stocked();
    for (let i = 0; i < WOC_MARKET_MAX_ACTIVE_LISTINGS; i += 1) await listEpic(h);
    const blocked = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(blocked, 'a 13th public listing must be refused').toEqual({
      ok: false,
      reason: 'cap_reached',
    });
    const directed = await createListingSteppedUp(h, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: directedParams(),
    });
    expect(directed, 'a directed listing is inside the cap too').toEqual({
      ok: false,
      reason: 'cap_reached',
    });
    // And the inverse direction: directed rows OCCUPY cap slots. A seller at
    // cap purely on directed sales cannot open a public listing over them.
    const h2 = stocked();
    for (let i = 0; i < WOC_MARKET_MAX_ACTIVE_LISTINGS; i += 1) {
      h2.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
      const row = await createListingSteppedUp(h2, {
        account: SELLER,
        characterId: SELLER_CHAR,
        itemRef: { index: 0, itemId: EPIC_ITEM },
        params: directedParams(),
      });
      expect(row.ok, `directed listing ${i} under the cap`).toBe(true);
    }
    h2.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const publicBlocked = await createListingSteppedUp(h2, {
      account: SELLER,
      characterId: SELLER_CHAR,
      itemRef: { index: 0, itemId: EPIC_ITEM },
      params: listingParams(),
    });
    expect(publicBlocked, 'directed rows occupy cap slots').toEqual({
      ok: false,
      reason: 'cap_reached',
    });
  });

  it('buyNow refuses the wallet twin from values already in hand (H14 fast path)', async () => {
    const h = stocked();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    h.custody.owners.set(CHAR_TWIN, WALLET_TWIN);
    h.custody.bags.set(CHAR_TWIN, []);
    const res = await h.service.buyNow({
      account: WALLET_TWIN,
      characterId: CHAR_TWIN,
      listingId: listing.id,
      acceptTerms: true,
    });
    expect(res).toEqual({ ok: false, reason: 'own_listing' });
  });

  it('leaves a PUBLIC buy-now buyable by any account', async () => {
    // The guard must key on the directed field, never on "is this a buy_now".
    const h = stocked();
    const open = await listEpic(h, {
      format: 'buy_now',
      startCents: 2000,
      reserveCents: null,
      buyNowCents: 5000,
    });
    const res = await h.service.buyNow({
      account: BUYER_B,
      characterId: CHAR_B,
      listingId: open.id,
      acceptTerms: true,
    });
    expect(res.ok, 'a public buy-now must not be caught by the directed guard').toBe(true);
  });
});

describe('directed p2p offers: propose, accept, and the escrow moment', () => {
  function stocked(): Harness {
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [
      { itemId: EPIC_ITEM, count: 1 },
      { itemId: EPIC_ITEM, count: 1 },
    ]);
    return h;
  }
  // BUYER_A opens the deal by naming a price to the seller; SELLER accepts by
  // staging a copy. The buyer holds no items in a $WOC deal.
  const offerArgs = (over: Record<string, unknown> = {}) => ({
    account: BUYER_A,
    characterId: CHAR_A,
    sellerCharacterName: 'Selara',
    usdCents: 5000,
    // The agreed copy (H10): the plain stocked EPIC_ITEM the seller's accept
    // will extract, so the pin matches unless a test deliberately diverges.
    item: { itemId: EPIC_ITEM },
    // Terms parity: a directed buyer can be struck, so the offer sits behind
    // guardTerms. Accepted by default here so every other case under test is
    // the one the title names; the terms gate has its own pair of cases.
    acceptTerms: true,
    ...over,
  });
  /** The seller's half: names the copy, carrying the offer-bound proof the
   *  custody-committing side owes. */
  const sellerAccepts = (h: Harness, id: number) =>
    acceptSteppedUp(h, SELLER, id, { index: 0, itemId: EPIC_ITEM }, SELLER_CHAR);
  /** The buyer's half: money only, no item. */
  const buyerAccepts = (h: Harness, id: number) =>
    h.service.acceptDirectedOffer(BUYER_A, id, null, CHAR_A);
  /** Both, buyer first, so the SELLER's is the one that escrows. */
  const acceptWith = async (h: Harness, id: number) => {
    const first = await buyerAccepts(h, id);
    if (!first.ok) return first;
    return sellerAccepts(h, id);
  };

  it('escrows NOTHING at offer time: the seller keeps the item until acceptance', async () => {
    // This is the whole reason an offer is not a listing. If proposing escrowed,
    // anyone could lock a chosen player's goods by offering deals they never
    // intend to complete.
    const h = stocked();
    const before = bagsOf(h, SELLER_CHAR).length;
    const res = await h.service.createDirectedOffer(offerArgs());
    expect(res.ok).toBe(true);
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(before);
  });

  it('refuses when the SELLER has no wallet to be paid into', async () => {
    // The refusal the buyer's window turns into "that player must connect a
    // wallet", so it must be its own reason and not a generic wallet_required
    // (which means YOUR wallet and is actionable by a different person).
    const h = stocked();
    h.wallets.delete(SELLER);
    expect(await h.service.createDirectedOffer(offerArgs())).toEqual({
      ok: false,
      reason: 'recipient_wallet_required',
    });
  });

  it('refuses an offer naming an item-locked copy, exactly as its acceptance would', async () => {
    // R10 on the directed rail: the agreed copy carries the lock flag, so the
    // static-fact invariant (an offer must not be creatable that its own
    // acceptance refuses) makes this a creation-time refusal.
    const h = stocked();
    const res = await h.service.createDirectedOffer(
      offerArgs({ item: { itemId: EPIC_ITEM, instance: { locked: true } } }),
    );
    expect(res).toEqual({ ok: false, reason: 'locked' });
  });

  it('refuses the escrow moment when the seller locked the copy after the offer was made', async () => {
    // The offer named an unlocked copy; the seller locks it before the deal
    // consummates. The authoritative in-job eligibility re-check refuses on
    // the REAL payload, the copy stays in the bags still locked, and the offer
    // reopens so the seller can unlock and accept again.
    const h = stocked();
    const offer = unwrap(await h.service.createDirectedOffer(offerArgs()), 'createDirectedOffer');
    expect((await buyerAccepts(h, offer.offer.id)).ok).toBe(true);
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1, instance: { locked: true } }]);
    const res = await acceptSteppedUp(
      h,
      SELLER,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
    );
    expect(res).toEqual({ ok: false, reason: 'locked' });
    expect(bagsOf(h, SELLER_CHAR)[0]?.instance?.locked).toBe(true);
    const reopened = await h.db.directedOfferById(REALM, offer.offer.id);
    expect(reopened?.status).toBe('pending');
  });

  it('refuses when the BUYER has no wallet to pay from', async () => {
    const h = stocked();
    h.wallets.delete(BUYER_A);
    expect(await h.service.createDirectedOffer(offerArgs())).toEqual({
      ok: false,
      reason: 'wallet_required',
    });
  });

  it('refuses an offer addressed to yourself', async () => {
    const h = stocked();
    const res = await h.service.createDirectedOffer(offerArgs({ sellerCharacterName: 'Aldan' }));
    expect(res).toEqual({ ok: false, reason: 'self_offer' });
  });

  it('refuses terms_required from a buyer who has never accepted them, and records the acceptance once', async () => {
    // Terms parity with placeBid and buyNow: a directed buyer can be STRUCK
    // for walking away, so the offer sits behind the same gate. It is also
    // what makes the pay arm's "terms were accepted when the offer was made"
    // premise true.
    const h = stocked();
    expect(await h.service.createDirectedOffer(offerArgs({ acceptTerms: false }))).toEqual({
      ok: false,
      reason: 'terms_required',
    });
    expect(await h.db.termsAcceptedAt(BUYER_A), 'a refused offer records nothing').toBeNull();
    expect((await h.service.createDirectedOffer(offerArgs())).ok).toBe(true);
    expect(await h.db.termsAcceptedAt(BUYER_A), 'accepting records the acceptance').toBe(BASE_MS);
    // The stored acceptance is what the gate reads, so a LATER offer passes
    // without the flag. Addressed to a different seller, because the
    // pair-pending bound would otherwise refuse this second deal for an
    // unrelated reason and the case would pass without exercising the gate.
    const later = await h.service.createDirectedOffer(
      offerArgs({ sellerCharacterName: 'Brint', acceptTerms: false }),
    );
    expect(later.ok, 'a recorded acceptance passes the gate without the flag').toBe(true);
  });

  it('accepting escrows the item and produces a directed listing at the agreed price', async () => {
    const h = stocked();
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    // The stored fingerprint is the fixed-width digest, never the raw
    // client-derived serialization (which would bank kilobytes per row).
    expect(offer.offer.itemPin).toMatch(/^[0-9a-f]{64}$/);
    const before = bagsOf(h, SELLER_CHAR).length;
    const accepted = await acceptWith(h, offer.offer.id);
    if (!accepted.ok) throw new Error(`accept refused: ${(accepted as { reason: string }).reason}`);
    expect(bagsOf(h, SELLER_CHAR), 'the copy left the bags').toHaveLength(before - 1);
    expect(accepted.listing?.directedBuyerAccount).toBe(BUYER_A);
    // One agreed price, carried onto both price fields.
    expect(accepted.listing?.buyNowCents).toBe(5000);
    expect(accepted.listing?.startCents).toBe(5000);
    // The hold is the settlement window, not an auction duration (H12): a
    // DB-free pin, so regressing the ends computation back to durationHours
    // reds without a database.
    expect(accepted.listing?.endsAtMs).toBe(BASE_MS + WOC_MARKET_SETTLEMENT_WINDOW_SECONDS * 1000);
  });

  it('refuses item_mismatch when the seller accepts with a DIFFERENT eligible item id', async () => {
    // The other half of the bait-and-switch criterion beside the re-rolled
    // instance: the pin's itemId component is load-bearing, so the refusal
    // must be item_mismatch (the deal is wrong), never not_eligible (the
    // item is fine, it is just not the agreed one).
    const otherEpic = Object.keys(ITEMS).find((id) => {
      const def = ITEMS[id];
      return (
        id !== EPIC_ITEM &&
        def.quality === 'epic' &&
        !def.soulbound &&
        def.slot !== undefined &&
        !def.noMarketList &&
        def.kind !== 'quest'
      );
    });
    if (!otherEpic) throw new Error('content should ship a second eligible epic');
    const h = stocked();
    const made = await h.service.createDirectedOffer(offerArgs());
    if (!made.ok) throw new Error('offer refused');
    const first = await h.service.acceptDirectedOffer(BUYER_A, made.offer.id, null, CHAR_A);
    expect(first.ok).toBe(true);
    h.custody.bags.set(SELLER_CHAR, [{ itemId: otherEpic, count: 1 }]);
    const second = await acceptSteppedUp(
      h,
      SELLER,
      made.offer.id,
      { index: 0, itemId: otherEpic },
      SELLER_CHAR,
    );
    expect(second).toEqual({ ok: false, reason: 'item_mismatch' });
    expect(bagsOf(h, SELLER_CHAR), 'the copy restored').toHaveLength(1);
    expect((await h.db.directedOfferById(REALM, made.offer.id))?.status).toBe('pending');
  });

  it('refuses item_mismatch for a legacy offer with NO stored pin (the safe direction)', async () => {
    const h = stocked();
    const made = await h.service.createDirectedOffer(offerArgs());
    if (!made.ok) throw new Error('offer refused');
    // A row that predates the pin column: NULL survives the read path.
    const row = h.db.offers.get(made.offer.id);
    if (!row) throw new Error('offer vanished');
    row.itemPin = null;
    const out = await acceptWith(h, made.offer.id);
    expect(out).toEqual({ ok: false, reason: 'item_mismatch' });
    expect(bagsOf(h, SELLER_CHAR), 'nothing escrowed').toContainEqual({
      itemId: EPIC_ITEM,
      count: 1,
    });
  });

  it('an escrow not_pending refusal (the converge raced the acceptance) reopens the deal', async () => {
    const h = stocked();
    const made = await h.service.createDirectedOffer(offerArgs());
    if (!made.ok) throw new Error('offer refused');
    await h.service.acceptDirectedOffer(BUYER_A, made.offer.id, null, CHAR_A);
    h.db.failNextEscrow = 'not_pending';
    const out = await acceptSteppedUp(
      h,
      SELLER,
      made.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
    );
    expect(out).toEqual({ ok: false, reason: 'not_pending' });
    // COUNT, not presence: this describe's stocked() seeds TWO identical
    // copies, so a presence check passes with or without the restore.
    expect(
      bagsOf(h, SELLER_CHAR).filter((s) => s.itemId === EPIC_ITEM),
      'the copy restored',
    ).toHaveLength(2);
    expect((await h.db.directedOfferById(REALM, made.offer.id))?.status).toBe('pending');
  });

  it('a reopen resets the seller accept and item, keeps the buyer consent, so a spent proof cannot re-drive custody', async () => {
    // Security: after a reopen the seller's step-up challenge is consumed. If
    // the seller accept survived, a lone buyer re-press would re-consummate on
    // the spent authorization. The reset forces a FRESH seller acceptance. The
    // buyer's standing consent is deliberately KEPT (it carries no custody
    // proof), so the seller alone re-accepting consummates the retry.
    const h = stocked();
    const made = await h.service.createDirectedOffer(offerArgs());
    if (!made.ok) throw new Error('offer refused');
    await h.service.acceptDirectedOffer(BUYER_A, made.offer.id, null, CHAR_A);
    h.db.failNextEscrow = 'not_pending';
    // The seller accepts with a proof; the escrow refuses and reopens.
    await acceptSteppedUp(h, SELLER, made.offer.id, { index: 0, itemId: EPIC_ITEM }, SELLER_CHAR);
    const reopened = await h.db.directedOfferById(REALM, made.offer.id);
    expect(reopened?.status).toBe('pending');
    expect(reopened?.buyerAccepted, 'the buyer consent survives the reopen').toBe(true);
    expect(reopened?.sellerAccepted, 'the seller accept reset').toBe(false);
    expect(reopened?.itemRef, 'the named item cleared').toBeNull();
    // The seller's fresh acceptance (a new proof) alone consummates it, because
    // the buyer's consent was kept; no custody moved on the spent proof.
    const sellerAgain = await acceptSteppedUp(
      h,
      SELLER,
      made.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
    );
    expect(sellerAgain.ok, 'a fresh seller proof consummates the retry').toBe(true);
  });

  it('a THROWING reopen never replaces the typed refusal, and reports offer_reopen', async () => {
    // The swallow's own contract: a reopen transport failure (pool timeout,
    // reset) is reported through the sweep-error channel rather than
    // silently eaten, the caller still sees the typed refusal, and the
    // still-accepted row is left for the converge arm to recover from
    // durable truth.
    const h = stocked();
    const made = await h.service.createDirectedOffer(offerArgs());
    if (!made.ok) throw new Error('offer refused');
    await h.service.acceptDirectedOffer(BUYER_A, made.offer.id, null, CHAR_A);
    h.db.failNextEscrow = 'not_pending';
    h.db.reopenDirectedOffer = async () => {
      throw new Error('timeout exceeded when trying to connect');
    };
    const out = await acceptSteppedUp(
      h,
      SELLER,
      made.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
    );
    expect(out).toEqual({ ok: false, reason: 'not_pending' });
    // COUNT, not presence: see the sibling above.
    expect(
      bagsOf(h, SELLER_CHAR).filter((s) => s.itemId === EPIC_ITEM),
      'the copy restored',
    ).toHaveLength(2);
    expect((await h.db.directedOfferById(REALM, made.offer.id))?.status).toBe('accepted');
    expect(h.sweepErrors.map(([arm]) => arm)).toContain('offer_reopen');
  });

  it('a THROWING reopen on the proven-rollback path keeps the escrow root cause, and reports', async () => {
    // The sibling arm: the rethrow must stay the ESCROW's own error (a
    // reopen transport failure replacing it destroyed the root-cause trace,
    // the original defect), the swallow reports offer_reopen, and the
    // converge arm owns recovering the still-accepted row.
    const h = stocked();
    const made = await h.service.createDirectedOffer(offerArgs());
    if (!made.ok) throw new Error('offer refused');
    await h.service.acceptDirectedOffer(BUYER_A, made.offer.id, null, CHAR_A);
    h.db.failNextEscrowThrow = Object.assign(new Error('unique violation'), { code: '23505' });
    h.db.reopenDirectedOffer = async () => {
      throw new Error('timeout exceeded when trying to connect');
    };
    await expect(
      acceptSteppedUp(h, SELLER, made.offer.id, { index: 0, itemId: EPIC_ITEM }, SELLER_CHAR),
    ).rejects.toThrow('unique violation');
    // COUNT, not presence: deleting the proved-rollback restoreCopy call
    // must fail this line (this describe's stocked() seeds TWO copies).
    expect(
      bagsOf(h, SELLER_CHAR).filter((s) => s.itemId === EPIC_ITEM),
      'the rollback restore still ran',
    ).toHaveLength(2);
    expect((await h.db.directedOfferById(REALM, made.offer.id))?.status).toBe('accepted');
    expect(h.sweepErrors.map(([arm]) => arm)).toContain('offer_reopen');
  });

  it('bounds the pair to ONE pending offer (the strike-farming bound), and frees it on resolve', async () => {
    const h = stocked();
    const first = await h.service.createDirectedOffer(offerArgs());
    expect(first.ok).toBe(true);
    expect(await h.service.createDirectedOffer(offerArgs())).toEqual({
      ok: false,
      reason: 'offer_pending',
    });
    if (!first.ok) throw new Error('unreachable');
    // Resolving the standing deal frees the pair for a fresh one.
    const declined = await h.service.resolveDirectedOffer(SELLER, first.offer.id, 'decline');
    expect(declined.ok).toBe(true);
    expect((await h.service.createDirectedOffer(offerArgs())).ok).toBe(true);
  });

  /** One directed deal driven to its escrowed listing, local to this
   *  describe (the consequences describe has its own richer twin). */
  async function acceptedOffer(h: Harness): Promise<WocListingRow> {
    const made = await h.service.createDirectedOffer(offerArgs());
    if (!made.ok) throw new Error('offer refused');
    const out = await acceptWith(h, made.offer.id);
    if (!out.ok || !out.listing) throw new Error('accept refused');
    return out.listing;
  }

  it('a blocked reopen NO-OPS when a fresh offer occupies the pair, and the converge arm expires it', async () => {
    // The qa round's blocker: flipping an accepted row back to pending is an
    // INSERT into the pair-pending unique index, and the buyer may have
    // opened a fresh deal while the old one sat accepted. The reopen must
    // no-op (never a 500 over the typed refusal, never a lost root-cause
    // trace), and the stuck row expires through the converge arm at its TTL.
    const h = stocked();
    const first = await h.service.createDirectedOffer(offerArgs());
    if (!first.ok) throw new Error('offer refused');
    await h.service.acceptDirectedOffer(BUYER_A, first.offer.id, null, CHAR_A);
    // Drive the row into accepted-and-unstamped directly (the state every
    // reopen caller sees), then occupy the pair with a fresh offer.
    const claimed = await h.db.resolveDirectedOffer(REALM, first.offer.id, 'accepted');
    expect(claimed).not.toBeNull();
    const second = await h.service.createDirectedOffer(offerArgs({ usdCents: 6000 }));
    expect(second.ok, 'the accepted first offer frees the pair slot').toBe(true);
    expect(await h.db.reopenDirectedOffer(REALM, first.offer.id), 'a blocked reopen says so').toBe(
      false,
    );
    expect((await h.db.directedOfferById(REALM, first.offer.id))?.status).toBe('accepted');
    // Past the TTL the converge arm expires the blocked row (the pending
    // sweep cannot see an 'accepted' row, so only converge can have done
    // it). The same clock jump also passes the FRESH offer's own pending
    // TTL, so the ordinary expiry arm takes that one in the same pass:
    // both read 'expired', each by its own arm.
    h.setNow(first.offer.expiresAtMs + (WOC_MARKET_OFFER_CONVERGE_SECONDS + 1) * 1000);
    await h.service.sweepPass();
    expect((await h.db.directedOfferById(REALM, first.offer.id))?.status).toBe('expired');
    if (second.ok) {
      expect((await h.db.directedOfferById(REALM, second.offer.id))?.status).toBe('expired');
    }
  });

  it('the converge REOPEN branch no-ops while the pair is occupied and never counts it as progress', async () => {
    // The stat honesty pin: a blocked reopen moves nothing, so the sweep must
    // not report it converged (the stuck monitor reads this number); once the
    // pair frees, the SAME row reopens and counts. The clock sits 1s before
    // the offer TTL so the reopen branch, not the expire branch, is under
    // test.
    const h = stocked();
    const first = await h.service.createDirectedOffer(offerArgs());
    if (!first.ok) throw new Error('offer refused');
    await h.service.acceptDirectedOffer(BUYER_A, first.offer.id, null, CHAR_A);
    const claimed = await h.db.resolveDirectedOffer(REALM, first.offer.id, 'accepted');
    expect(claimed).not.toBeNull();
    const second = await h.service.createDirectedOffer(offerArgs({ usdCents: 6000 }));
    if (!second.ok) throw new Error('pair offer refused');
    h.setNow(first.offer.expiresAtMs - 1000);
    const blocked = await h.service.sweepPass();
    expect(blocked?.convergedOffers, 'a blocked no-op is not progress').toBe(0);
    expect((await h.db.directedOfferById(REALM, first.offer.id))?.status).toBe('accepted');
    const freed = await h.service.resolveDirectedOffer(SELLER, second.offer.id, 'decline');
    expect(freed.ok).toBe(true);
    const after = await h.service.sweepPass();
    expect(after?.convergedOffers).toBe(1);
    expect((await h.db.directedOfferById(REALM, first.offer.id))?.status).toBe('pending');
  });

  it('spares the strike when the recorded refusal is the exempt service outage class', async () => {
    // The public rail's abandon recorder exempts exactly this class from even
    // a cooldown; a directed buyer whose payment died in a service outage
    // must not eat a real strike for it. The listing still auto-closes and
    // the item still flies home: only the penalty is spared.
    const h = stocked();
    const listing = await acceptedOffer(h);
    unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    const settlement = await liveSettlement(h, listing.id);
    expect(await h.db.submitSettlementSignature(settlement.id, 'sig-outage')).toBe('ok');
    expect(
      await h.db.transitionSettlement(
        settlement.id,
        ['confirming'],
        'failed',
        'service_unavailable',
      ),
    ).toBe(true);
    h.setNow(settlement.deadlineAtMs + 1);
    await h.service.sweepPass();
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(0);
    expect((await h.db.listingById(REALM, listing.id))?.status).toBe('closed');
    expect((await h.db.listingById(REALM, listing.id))?.resolution).toBe('unsettled');
  });

  it('still strikes on a non-exempt refusal class (the exemption positive control)', async () => {
    const h = stocked();
    const listing = await acceptedOffer(h);
    unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    const settlement = await liveSettlement(h, listing.id);
    expect(await h.db.submitSettlementSignature(settlement.id, 'sig-refused')).toBe('ok');
    expect(
      await h.db.transitionSettlement(settlement.id, ['confirming'], 'failed', 'confirm_failed'),
    ).toBe(true);
    h.setNow(settlement.deadlineAtMs + 1);
    await h.service.sweepPass();
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(1);
  });

  it('spares the never-claim strike while the price oracle is unhealthy, and still returns the item', async () => {
    // The sweep keeps closing and returning holds through an outage; only
    // the penalty pauses, because the buyer could not have paid (buyNow
    // refuses market_paused in the same window).
    const h = stocked();
    const listing = await acceptedOffer(h);
    const healthyPrice = h.economy.price.bind(h.economy);
    h.economy.price = (async () => ({
      available: false,
      healthy: false,
    })) as unknown as typeof h.economy.price;
    h.setNow(BASE_MS + (WOC_MARKET_SETTLEMENT_WINDOW_SECONDS + 1) * 1000);
    await h.service.sweepPass();
    expect((await h.db.listingById(REALM, listing.id))?.status).toBe('closed');
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(0);
    h.economy.price = healthyPrice;
  });

  it('strikes the never-claiming buyer once the hold lapses under a HEALTHY oracle', async () => {
    const h = stocked();
    const listing = await acceptedOffer(h);
    h.setNow(BASE_MS + (WOC_MARKET_SETTLEMENT_WINDOW_SECONDS + 1) * 1000);
    await h.service.sweepPass();
    expect((await h.db.listingById(REALM, listing.id))?.status).toBe('closed');
    expect((await h.db.listingById(REALM, listing.id))?.resolution).toBe('unsettled');
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(1);
    // Durable-state re-run control: a second pass cannot strike again.
    await h.service.sweepPass();
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(1);
  });

  it('strikes ONCE when a claimed-then-unpaid window and the hold lapse together (the ever-settled gate)', async () => {
    // Both strike arms are live in the SAME pass here: the close arm runs
    // first and its CAS succeeds (a 'failed' settlement is not an OPEN one,
    // so nothing blocks the close), then the overdue arm expires the dead
    // window and strikes for the claim. Only the ever-settled probe keeps
    // those from being two strikes for one walk-away, so deleting it reds
    // this on the FIRST pass; the second pass is the durable-state control.
    const h = stocked();
    const listing = await acceptedOffer(h);
    unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    const settlement = await liveSettlement(h, listing.id);
    expect(await h.db.submitSettlementSignature(settlement.id, 'sig-gate')).toBe('ok');
    expect(
      await h.db.transitionSettlement(settlement.id, ['confirming'], 'failed', 'confirm_failed'),
    ).toBe(true);
    expect(await h.db.strikeInfo(BUYER_A), 'nothing owed while the window is live').toBeNull();
    // Past the hold AND the payment deadline, so neither arm is spared by a
    // clock that only cleared one of them.
    h.setNow(Math.max(listing.endsAtMs, settlement.deadlineAtMs) + 1);
    await h.service.sweepPass();
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0, 'one walk-away, one strike').toBe(1);
    expect((await h.db.listingById(REALM, listing.id))?.status).toBe('closed');
    expect((await h.db.listingById(REALM, listing.id))?.resolution).toBe('unsettled');
    await h.service.sweepPass();
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(1);
  });

  it('leaves a mid-flight claim alone at hold expiry (the unexpired-lock early return)', async () => {
    // The 270s claim lock routinely outlives the 600s hold. Closing over a
    // paying buyer would return the escrow while their payment request is in
    // the air; the settlement rails own that window's outcome. The retry
    // latency is the stranded-reclaim grace (the early return leaves the row
    // 'ending'), which is fine because the settlement arms resolve first.
    const h = stocked();
    const listing = await acceptedOffer(h);
    h.setNow(BASE_MS + 400_000);
    unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    const settlement = await liveSettlement(h, listing.id);
    h.setNow(BASE_MS + 601_000);
    await h.service.sweepPass();
    expect((await h.db.listingById(REALM, listing.id))?.status).not.toBe('closed');
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(0);
    // The window then expires unpaid: ONE strike and the auto-close.
    h.setNow(settlement.deadlineAtMs + 1);
    await h.service.sweepPass();
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(1);
    expect((await h.db.listingById(REALM, listing.id))?.status).toBe('closed');
    expect((await h.db.listingById(REALM, listing.id))?.resolution).toBe('unsettled');
  });

  it('never strikes when the close is refused over a live payment (the close-CAS-miss arm)', async () => {
    const h = stocked();
    const listing = await acceptedOffer(h);
    unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    const settlement = await liveSettlement(h, listing.id);
    expect(await h.db.submitSettlementSignature(settlement.id, 'sig-live')).toBe('ok');
    // Past the hold with the claim lock long expired but the payment OPEN:
    // the close arm must park the row for the settlement rails, not strike.
    h.setNow(BASE_MS + 601_000);
    await h.service.sweepPass();
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(0);
    expect((await h.db.listingById(REALM, listing.id))?.resolution).not.toBe('unsettled');
  });

  it('refuses an offer whose buyer wallet cannot plausibly pay (guardBalance)', async () => {
    // The auction paths refuse an implausible bid at placement; a directed
    // offer is a bid in everything but name. A wallet the balance read cannot
    // resolve refuses closed.
    const h = stocked();
    h.wallets.set(BUYER_A, 'wallet-with-no-balance');
    expect(await h.service.createDirectedOffer(offerArgs())).toEqual({
      ok: false,
      reason: 'insufficient_balance',
    });
  });

  it('refuses an offer at CREATION for an item its acceptance would refuse (bind_armed)', async () => {
    // The create-time invariant widened to the item (H10 pins it, so it is
    // checkable now): an armed commission piece refuses at offer time exactly
    // as its acceptance would, instead of wasting both players' agreement.
    const h = stocked();
    const res = await h.service.createDirectedOffer(
      offerArgs({
        item: { itemId: EPIC_ITEM, instance: { signer: 'Aldan', bindOnTrade: true } },
      }),
    );
    expect(res).toEqual({ ok: false, reason: 'bind_armed' });
  });

  it('refuses wallet twins on the directed rail, at creation AND at completion (H14)', async () => {
    // WALLET_TWIN shares the seller payout wallet: same beneficial owner even
    // across accounts, so the deal is a self-deal in everything but account id.
    const h = stocked();
    const atCreate = await h.service.createDirectedOffer(
      offerArgs({ account: WALLET_TWIN, characterId: CHAR_TWIN }),
    );
    expect(atCreate).toEqual({ ok: false, reason: 'self_offer' });
    // The completion re-check: wallets re-read LIVE at the second acceptance,
    // so a relink between creation and completion still refuses.
    const made = await h.service.createDirectedOffer(offerArgs());
    if (!made.ok) throw new Error('offer refused');
    const first = await h.service.acceptDirectedOffer(BUYER_A, made.offer.id, null, CHAR_A);
    expect(first.ok).toBe(true);
    h.wallets.set(BUYER_A, 'wallet-seller');
    const second = await acceptSteppedUp(
      h,
      SELLER,
      made.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
    );
    expect(second).toEqual({ ok: false, reason: 'self_offer' });
    expect(bagsOf(h, SELLER_CHAR), 'nothing escrowed on the refusal').toContainEqual({
      itemId: EPIC_ITEM,
      count: 1,
    });
  });

  it('refuses item_mismatch when the accepted copy is not the pinned one, and restores it', async () => {
    // The bait-and-switch guard (H10) against the AUTHORITATIVE extracted
    // copy: the buyer pinned the plain copy, the seller swapped a re-rolled
    // instance of the same id into the same bag slot.
    const h = stocked();
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    const first = await h.service.acceptDirectedOffer(BUYER_A, offer.offer.id, null, CHAR_A);
    expect(first.ok).toBe(true);
    const swapped: InvSlot = {
      itemId: EPIC_ITEM,
      count: 1,
      instance: { rolled: { stats: { str: 3 } } } as InvSlot['instance'],
    };
    h.custody.bags.set(SELLER_CHAR, [swapped]);
    const second = await acceptSteppedUp(
      h,
      SELLER,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM, expectInstance: swapped.instance },
      SELLER_CHAR,
    );
    expect(second).toEqual({ ok: false, reason: 'item_mismatch' });
    expect(bagsOf(h, SELLER_CHAR), 'the copy restored to the bags').toHaveLength(1);
    // The offer reopened (the typed-refusal arm), so the pair can retry with
    // the right copy or walk away cleanly.
    expect((await h.db.directedOfferById(REALM, offer.offer.id))?.status).toBe('pending');
  });

  /** One directed deal over a seller holding exactly the slot given, driven to
   *  the seller's escrowing acceptance. The seller names index 0 and the
   *  instance payload they can see, which is all a trade window ever knows. */
  async function acceptOfferForCopy(
    h: Harness,
    sellerSlot: InvSlot,
    agreed: { itemId: string; instance?: ItemInstancePayload; craftedRecipeId?: string },
  ): Promise<{ ok: true; listing: WocListingRow | null } | Refused> {
    h.custody.bags.set(SELLER_CHAR, [sellerSlot]);
    const offer = await h.service.createDirectedOffer(offerArgs({ item: agreed }));
    if (!offer.ok) throw new Error(`offer refused: ${(offer as { reason: string }).reason}`);
    const first = await h.service.acceptDirectedOffer(BUYER_A, offer.offer.id, null, CHAR_A);
    if (!first.ok) throw new Error('buyer accept refused');
    return acceptSteppedUp(
      h,
      SELLER,
      offer.offer.id,
      {
        index: 0,
        itemId: sellerSlot.itemId,
        expectInstance: sellerSlot.instance ?? null,
      },
      SELLER_CHAR,
    );
  }

  it('escrows an INSTANCED copy end to end: both digest sites agree on the same payload', async () => {
    // The two itemPinDigest sites see DIFFERENT objects for the same deal:
    // createDirectedOffer digests the buyer's claimed snapshot, createListing
    // digests the copy extractTradableCopy actually pulled from the bags. For
    // a plain stack they trivially agree; for an instanced copy they agree
    // only if the payload survives the extraction unchanged, and nothing else
    // in this suite drives an instanced directed sale to a real listing.
    const instance: ItemInstancePayload = { signer: 'Ayla' };
    const h = makeHarness();
    const escrowed = await acceptOfferForCopy(
      h,
      { itemId: EPIC_ITEM, count: 1, instance },
      { itemId: EPIC_ITEM, instance },
    );
    if (!escrowed.ok) {
      throw new Error(`accept refused: ${(escrowed as { reason: string }).reason}`);
    }
    expect(escrowed.listing, 'the second acceptance escrows and lists').not.toBeNull();
    expect(escrowed.listing?.directedBuyerAccount).toBe(BUYER_A);
    // The escrowed copy is the instanced one, not a plain stack of the id.
    expect(escrowed.listing?.item.instance).toEqual(instance);
    expect(bagsOf(h, SELLER_CHAR), 'the copy left the bags').toHaveLength(0);
  });

  it('treats crafted provenance as part of the agreed copy, in BOTH directions', async () => {
    // craftedRecipeId is the third leg of the itemCopyPin 3-tuple and the one
    // no other case exercises. The twins here are byte-equal but for the
    // marker, so a pin that dropped the leg would accept the wrong copy while
    // every other item_mismatch case stayed green.
    const instance: ItemInstancePayload = { signer: 'Ayla' };
    const agreed = { itemId: EPIC_ITEM, instance, craftedRecipeId: 'recipe_x' };
    const unmarked = makeHarness();
    const refused = await acceptOfferForCopy(
      unmarked,
      { itemId: EPIC_ITEM, count: 1, instance },
      agreed,
    );
    expect(refused, 'the unmarked twin is not the agreed copy').toEqual({
      ok: false,
      reason: 'item_mismatch',
    });
    expect(bagsOf(unmarked, SELLER_CHAR), 'the copy restored').toHaveLength(1);
    // The positive control, same deal with the marker present: without it the
    // refusal above would also be produced by a pin that simply never matches.
    const marked = makeHarness();
    const escrowed = await acceptOfferForCopy(
      marked,
      { itemId: EPIC_ITEM, count: 1, instance, craftedRecipeId: 'recipe_x' },
      agreed,
    );
    if (!escrowed.ok) {
      throw new Error(`accept refused: ${(escrowed as { reason: string }).reason}`);
    }
    expect(escrowed.listing?.item.craftedRecipeId).toBe('recipe_x');
    expect(bagsOf(marked, SELLER_CHAR), 'the marked copy left the bags').toHaveLength(0);
  });

  it('refuses a capped seller BEFORE any custody move, not inside the escrow transaction', async () => {
    // The cap has two byte-identical halves: the service pre-check and the
    // in-transaction count under the accounts lock. The pre-check exists to
    // spare the extract and the FIFO job, so a regression that leaned on the
    // in-transaction half alone would still answer cap_reached and pass every
    // outcome-only assertion. The witness is the extraction log: bag counts
    // cannot tell "never extracted" from "extracted then restored".
    const h = makeHarness();
    h.custody.bags.set(
      SELLER_CHAR,
      Array.from({ length: WOC_MARKET_MAX_ACTIVE_LISTINGS + 1 }, () => ({
        itemId: EPIC_ITEM,
        count: 1,
      })),
    );
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    const agreed = await h.service.acceptDirectedOffer(BUYER_A, offer.offer.id, null, CHAR_A);
    expect(agreed.ok).toBe(true);
    // The seller fills their cap between agreeing and accepting: a MOVING
    // fact, which is why the offer was creatable in the first place.
    for (let i = 0; i < WOC_MARKET_MAX_ACTIVE_LISTINGS; i += 1) await listEpic(h);
    // Those twelve listings each extracted, which is what proves the witness
    // below is live rather than a log nothing ever writes to.
    expect(h.custody.extractAttempts).toHaveLength(WOC_MARKET_MAX_ACTIVE_LISTINGS);
    h.custody.extractAttempts.length = 0;
    const escrowed = await sellerAccepts(h, offer.offer.id);
    expect(escrowed).toEqual({ ok: false, reason: 'cap_reached' });
    expect(h.custody.extractAttempts, 'nothing was extracted').toEqual([]);
    expect(bagsOf(h, SELLER_CHAR), 'the last copy is untouched').toHaveLength(1);
    // Typed, so the deal reopens and the pair can retry once a slot frees.
    expect((await h.db.directedOfferById(REALM, offer.offer.id))?.status).toBe('pending');
  });

  it('a proven-rollback escrow throw REOPENS the offer; an ambiguous one parks it accepted', async () => {
    // Judgment (a)'s in-request half: with rollback proof the listing provably
    // does not exist, so reopening cannot pair a live listing with a reopened
    // offer; without proof nothing is written and the converge arm below owns
    // the unwind from durable truth.
    const h = stocked();
    const proven = await h.service.createDirectedOffer(offerArgs());
    if (!proven.ok) throw new Error('offer refused');
    await h.service.acceptDirectedOffer(BUYER_A, proven.offer.id, null, CHAR_A);
    h.db.failNextEscrowThrow = Object.assign(new Error('unique violation'), { code: '23505' });
    await expect(
      acceptSteppedUp(h, SELLER, proven.offer.id, { index: 0, itemId: EPIC_ITEM }, SELLER_CHAR),
    ).rejects.toThrow('unique violation');
    expect((await h.db.directedOfferById(REALM, proven.offer.id))?.status).toBe('pending');

    // The pair-pending bound allows one live deal per pair: resolve the
    // reopened deal before staging the ambiguous arm.
    unwrap(await h.service.resolveDirectedOffer(SELLER, proven.offer.id, 'decline'), 'decline');
    const ambiguous = await h.service.createDirectedOffer(offerArgs());
    if (!ambiguous.ok) throw new Error('offer refused');
    await h.service.acceptDirectedOffer(BUYER_A, ambiguous.offer.id, null, CHAR_A);
    h.db.failNextEscrowThrow = new Error('socket died mid-commit');
    await expect(
      acceptSteppedUp(h, SELLER, ambiguous.offer.id, { index: 0, itemId: EPIC_ITEM }, SELLER_CHAR),
    ).rejects.toThrow('socket died mid-commit');
    expect((await h.db.directedOfferById(REALM, ambiguous.offer.id))?.status).toBe('accepted');
    expect(h.custody.sessionLost.at(-1)?.kind).toBe('ambiguous');
  });

  it('the converge arm reopens an aged unstamped acceptance, expires one past its TTL, and skips a stamped one', async () => {
    const h = stocked();
    // A stamped (completed) deal, as the control: the converge read must
    // never touch it however old it gets.
    const done = await h.service.createDirectedOffer(offerArgs());
    if (!done.ok) throw new Error('offer refused');
    await h.service.acceptDirectedOffer(BUYER_A, done.offer.id, null, CHAR_A);
    const completed = await acceptSteppedUp(
      h,
      SELLER,
      done.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
    );
    expect(completed.ok).toBe(true);
    // An ambiguous-thrown acceptance: stuck 'accepted' with no listing.
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const stuck = await h.service.createDirectedOffer(offerArgs());
    if (!stuck.ok) throw new Error('offer refused');
    await h.service.acceptDirectedOffer(BUYER_A, stuck.offer.id, null, CHAR_A);
    h.db.failNextEscrowThrow = new Error('socket died mid-commit');
    await expect(
      acceptSteppedUp(h, SELLER, stuck.offer.id, { index: 0, itemId: EPIC_ITEM }, SELLER_CHAR),
    ).rejects.toThrow();
    // Too young: the converge age keeps a possibly-in-flight acceptance out
    // of the batch entirely.
    let stats = await h.service.sweepPass();
    expect(stats?.convergedOffers).toBe(0);
    // Aged past the converge bound but inside the TTL: the deal reopens.
    h.setNow(BASE_MS + (WOC_MARKET_OFFER_CONVERGE_SECONDS + 1) * 1000);
    stats = await h.service.sweepPass();
    expect(stats?.convergedOffers).toBe(1);
    expect((await h.db.directedOfferById(REALM, stuck.offer.id))?.status).toBe('pending');
    expect((await h.db.directedOfferById(REALM, done.offer.id))?.status).toBe('accepted');
    // Wedge the SAME deal again, and this time let its TTL lapse: the converge
    // arm expires a dead deal instead of reopening it. The reopen kept the
    // buyer's consent and reset only the seller, so re-wedging needs just the
    // seller to re-accept with a fresh proof.
    const lapsed = await h.db.directedOfferById(REALM, stuck.offer.id);
    if (!lapsed) throw new Error('offer vanished');
    expect(lapsed.buyerAccepted).toBe(true);
    expect(lapsed.sellerAccepted).toBe(false);
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    h.db.failNextEscrowThrow = new Error('socket died again');
    await expect(
      acceptSteppedUp(h, SELLER, stuck.offer.id, { index: 0, itemId: EPIC_ITEM }, SELLER_CHAR),
    ).rejects.toThrow();
    h.setNow(lapsed.expiresAtMs + (WOC_MARKET_OFFER_CONVERGE_SECONDS + 1) * 1000);
    stats = await h.service.sweepPass();
    expect(stats?.convergedOffers).toBe(1);
    expect((await h.db.directedOfferById(REALM, stuck.offer.id))?.status).toBe('expired');
  });

  it('leaves an ANCIENT unstamped acceptance alone: the old bound is not rollback evidence', async () => {
    // The two-sided age window's far side. An offer un-stamped long after its
    // deal completed is the listings prune's ON DELETE SET NULL, not a rolled
    // back escrow, so the converge arm must not relabel it as live history.
    const h = stocked();
    const stuck = await h.service.createDirectedOffer(offerArgs());
    if (!stuck.ok) throw new Error('offer refused');
    await h.service.acceptDirectedOffer(BUYER_A, stuck.offer.id, null, CHAR_A);
    h.db.failNextEscrowThrow = new Error('socket died mid-commit');
    await expect(
      acceptSteppedUp(h, SELLER, stuck.offer.id, { index: 0, itemId: EPIC_ITEM }, SELLER_CHAR),
    ).rejects.toThrow();
    // Age the row past the far bound. Its TTL and the young bound are both
    // long since cleared, so the OLD bound is the only thing that can hold it
    // out of the batch.
    h.db.offerUpdatedMs.set(
      stuck.offer.id,
      BASE_MS - (WOC_MARKET_OFFER_CONVERGE_MAX_AGE_SECONDS + 1) * 1000,
    );
    const skipped = await h.service.sweepPass();
    expect(skipped?.convergedOffers, 'an aged-out row is not converge work').toBe(0);
    expect((await h.db.directedOfferById(REALM, stuck.offer.id))?.status).toBe('accepted');
    // The control that keeps the case honest: the SAME row, stamped back
    // inside the window, converges. Without it a row rejected for any other
    // reason would satisfy the assertions above.
    h.db.offerUpdatedMs.set(
      stuck.offer.id,
      BASE_MS - (WOC_MARKET_OFFER_CONVERGE_SECONDS + 1) * 1000,
    );
    const converged = await h.service.sweepPass();
    expect(converged?.convergedOffers).toBe(1);
    expect((await h.db.directedOfferById(REALM, stuck.offer.id))?.status).toBe('pending');
  });

  /** Put the buyer online with room to spare. Without this every hand-off
   *  refuses as 'offline' and the mail tests below pass for the wrong reason. */
  function buyerOnline(h: Harness): void {
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
  }

  /** Drive an accepted directed offer all the way to a delivered settlement. */
  async function settleDirected(h: Harness): Promise<{ listingId: number }> {
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    const accepted = await acceptWith(h, offer.offer.id);
    if (!accepted.ok || !accepted.listing) throw new Error('accept refused');
    const listingId = accepted.listing.id;
    const bought = unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId,
        acceptTerms: true,
      }),
      'buyNow',
    );
    unwrap(await h.service.settlementQuote(BUYER_A, bought.settlement.id), 'settlementQuote');
    unwrap(
      await h.service.confirmSettlement(BUYER_A, bought.settlement.id, 'sig-directed-1'),
      'confirmSettlement',
    );
    return { listingId };
  }

  it('hands a p2p purchase STRAIGHT to the buyer, with no parcel at all', async () => {
    // The whole point of the trade window: the two players are standing in front
    // of each other, so the goods go in the bag, not in the post.
    const h = stocked();
    buyerOnline(h);
    const before = bagsOf(h, CHAR_A).length;
    await settleDirected(h);
    expect(bagsOf(h, CHAR_A), 'the item lands in the buyer bags').toHaveLength(before + 1);
    expect(
      h.custody.parcels.filter((p) => p.letter === 'delivery'),
      'and no delivery parcel is booked',
    ).toHaveLength(0);
  });

  it('still MAILS an Exchange purchase, which is anonymous and asynchronous', async () => {
    // The other half of the rule, and the reason this is a branch rather than a
    // replacement: a public auction winner may be offline, in another zone, or
    // simply not expecting it.
    const h = makeHarness();
    // Online and roomy ON PURPOSE: the branch must key on the sale being
    // ANONYMOUS, not on the buyer happening to be unreachable. Without this the
    // case passes whatever deliverOne does, which is how it was first written.
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    const before = bagsOf(h, CHAR_A).length;
    unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-exchange-1'),
      'confirmSettlement',
    );
    expect(
      h.custody.parcels.filter((p) => p.letter === 'delivery'),
      'the exchange route is unchanged',
    ).toHaveLength(1);
    expect(bagsOf(h, CHAR_A), 'nothing goes straight into the bags').toHaveLength(before);
  });

  it('falls back to MAIL when the buyer has no room', async () => {
    // Full bags must never drop the item, and must never wedge the settlement.
    const h = stocked();
    buyerOnline(h);
    h.custody.fullBags.add(CHAR_A);
    const before = bagsOf(h, CHAR_A).length;
    await settleDirected(h);
    expect(bagsOf(h, CHAR_A), 'nothing forced into full bags').toHaveLength(before);
    expect(h.custody.parcels.filter((p) => p.letter === 'delivery')).toHaveLength(1);
  });

  it('falls back to MAIL when the buyer has logged out', async () => {
    const h = stocked();
    buyerOnline(h);
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    const accepted = await acceptWith(h, offer.offer.id);
    if (!accepted.ok || !accepted.listing) throw new Error('accept refused');
    const listingId = accepted.listing.id;
    const bought = unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId,
        acceptTerms: true,
      }),
      'buyNow',
    );
    unwrap(await h.service.settlementQuote(BUYER_A, bought.settlement.id), 'settlementQuote');
    // Gone between paying and delivery: no live session to hand anything to.
    h.custody.bags.delete(CHAR_A);
    unwrap(
      await h.service.confirmSettlement(BUYER_A, bought.settlement.id, 'sig-directed-2'),
      'confirmSettlement',
    );
    expect(h.custody.parcels.filter((p) => p.letter === 'delivery')).toHaveLength(1);
  });

  it('PARKS on a lease-fence rejection: no mail, ever, without an operator', async () => {
    // The fence proves THIS write lost, not that an earlier autosave under
    // the then-valid nonce did: the granted bags may already be durable, so
    // mailing (the old same-breath fallback, and the first fix round's
    // next-pass fallback) risks a second copy. The claim keeps its grant
    // intent and stays visible; only an operator can attribute the item.
    const h = stocked();
    buyerOnline(h);
    h.db.failNextDeliveredSave = 'lease_lost';
    const { listingId } = await settleDirected(h);
    const ref = settlementCustodyRef((await liveSettlement(h, listingId)).id);
    expect(
      h.custody.parcels.filter((p) => p.letter === 'delivery'),
      'no mail on the fence pass',
    ).toHaveLength(0);
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
    // Past the park backoff, and again: still parked, still no mail.
    h.setNow(h.now() + 61_000);
    await h.service.sweepPass();
    h.setNow(h.now() + 61_000);
    await h.service.sweepPass();
    expect(h.custody.parcels.filter((p) => p.letter === 'delivery')).toHaveLength(0);
    expect(h.custody.grantCalls, 'the zombie grant is never repeated').toBe(1);
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
    expect(h.db.custodyClaims.get(ref)?.grantCharacterId, 'the intent survives').toBe(CHAR_A);
    const readout = await h.db.stuckCustodyReadout(REALM, h.now() + 1, 10, 1000, 0);
    expect(readout.unbookedClaims.count, 'visible to the operator').toBe(1);
  });

  it('retries a THROWING save on the same custody ref, and never mails (B2b)', async () => {
    // Pool exhaustion at the worst moment: the grant already sits in the live
    // bags and an autosave may persist it. The old code fell through to mail
    // in the same pass, which was the second copy.
    const h = stocked();
    buyerOnline(h);
    h.db.failNextDeliveredSave = 'throw';
    const before = bagsOf(h, CHAR_A).length;
    const { listingId } = await settleDirected(h);
    const ref = settlementCustodyRef((await liveSettlement(h, listingId)).id);
    expect(
      h.custody.parcels.filter((p) => p.letter === 'delivery'),
      'a throwing save never produces mail',
    ).toHaveLength(0);
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs, 'unbooked and visible').toBeNull();
    expect(h.db.custodyClaims.get(ref)?.grantCharacterId).toBe(CHAR_A);
    expect(
      h.sweepErrors.map(([arm]) => arm),
      'the throw is reported',
    ).toContain('deliver_grant');
    // Past the park backoff, the SAME live session retries the SAME ref: one
    // snapshot save, no second grant, no mail, and the tail completes.
    h.setNow(h.now() + 61_000);
    await h.service.sweepPass();
    expect(bagsOf(h, CHAR_A), 'one copy').toHaveLength(before + 1);
    expect(h.custody.grantCalls, 'granted once, snapshot-retried after').toBe(1);
    expect(h.custody.parcels.filter((p) => p.letter === 'delivery')).toHaveLength(0);
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).not.toBeNull();
    expect((await h.db.listingById(REALM, listingId))?.status).toBe('closed');
    // Both saves crossed the delivery edge for the same session: the grant
    // save and the snapshot retry, never a third.
    expect(h.db.deliveredSaves.map((s) => s.characterId)).toEqual([CHAR_A, CHAR_A]);
    expect(h.db.deliveredSaves.map((s) => s.leaseNonce)).toEqual(['nonce', 'nonce']);
  });

  it('resolves an AMBIGUOUS commit (reply lost after booking) without a second copy', async () => {
    // The save-and-book transaction COMMITTED but the reply was lost: the
    // one case a separate booking statement could never untangle, and the
    // reason booking rides the save transaction.
    const h = stocked();
    buyerOnline(h);
    h.db.failNextDeliveredSave = 'throw_after_commit';
    const before = bagsOf(h, CHAR_A).length;
    const { listingId } = await settleDirected(h);
    expect((await liveSettlement(h, listingId)).state, 'no blind advance').toBe('delivering');
    expect(h.custody.parcels.filter((p) => p.letter === 'delivery')).toHaveLength(0);
    // Past the park backoff, the retry reads booked_at, sees the commit, and
    // only finalizes.
    h.setNow(h.now() + 61_000);
    await h.service.sweepPass();
    expect(bagsOf(h, CHAR_A)).toHaveLength(before + 1);
    expect(h.custody.grantCalls).toBe(1);
    expect(h.custody.parcels.filter((p) => p.letter === 'delivery')).toHaveLength(0);
    expect((await h.db.listingById(REALM, listingId))?.status).toBe('closed');
  });

  it('PARKS an unbooked grant claim after a restart: no mail, no re-grant, visible to ops', async () => {
    // A restart loses the in-process session ledger, so the "the live bags
    // hold my grant" proof is gone: the ONLY safe automatic action is none.
    const h = stocked();
    buyerOnline(h);
    h.db.failNextDeliveredSave = 'throw';
    const { listingId } = await settleDirected(h);
    const restarted = new WocMarketService(h.deps);
    await restarted.sweepPass();
    h.setNow(h.now() + 61_000);
    await restarted.sweepPass();
    expect(
      h.custody.parcels.filter((p) => p.letter === 'delivery'),
      'never mails',
    ).toHaveLength(0);
    expect(h.custody.grantCalls, 'never re-grants').toBe(1);
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
    const readout = await h.db.stuckCustodyReadout(REALM, h.now() + 1, 10, 1000, 0);
    expect(readout.unbookedClaims.count).toBe(1);
    expect(readout.unbookedClaims.sample[0]?.grantCharacterId).toBe(CHAR_A);
    expect(readout.stuckDelivering.count).toBe(1);
  });

  it('PARKS an unbooked grant claim after a relog: the retry is no longer provable', async () => {
    const h = stocked();
    buyerOnline(h);
    h.db.failNextDeliveredSave = 'throw';
    const { listingId } = await settleDirected(h);
    // Same process, new session: the lease nonce rotated, so the pending
    // entry no longer matches and the claim parks for the operator.
    h.custody.leaseNonce = 'nonce-after-relog';
    h.setNow(h.now() + 61_000);
    await h.service.sweepPass();
    h.setNow(h.now() + 61_000);
    await h.service.sweepPass();
    expect(h.custody.parcels.filter((p) => p.letter === 'delivery')).toHaveLength(0);
    expect(h.custody.grantCalls).toBe(1);
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
  });

  it('PARKS an unbooked grant claim when the buyer logs out before the retry', async () => {
    // The realistic loss of the resume proof: the session simply ends.
    // snapshotCopy answers offline, and the claim parks rather than mails.
    const h = stocked();
    buyerOnline(h);
    h.db.failNextDeliveredSave = 'throw';
    const { listingId } = await settleDirected(h);
    h.custody.bags.delete(CHAR_A);
    h.setNow(h.now() + 61_000);
    await h.service.sweepPass();
    h.setNow(h.now() + 61_000);
    await h.service.sweepPass();
    expect(h.custody.parcels.filter((p) => p.letter === 'delivery')).toHaveLength(0);
    expect(h.custody.grantCalls).toBe(1);
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
  });

  it('PARKS a bare claim with no rail intent: unattributable, never mailed (B2c)', async () => {
    // The claim-then-die residue (and every legacy row from before the intent
    // columns): the OLD code adopted it as booked and advanced with the item
    // destroyed; the first fix mailed it, which a collected-and-deleted letter
    // turns into a second copy. Neither is provable, so it parks.
    const h = makeHarness();
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    const ref = settlementCustodyRef(settlement.id);
    expect(await h.db.claimCustodyRef(REALM, ref)).toBe(true);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-resume-1'),
      'confirmSettlement',
    );
    expect(h.custody.parcels, 'nothing mailed').toHaveLength(0);
    expect((await liveSettlement(h, listing.id)).state, 'held visibly').toBe('delivering');
    const readout = await h.db.stuckCustodyReadout(REALM, h.now() + 1, 10, 1000, 0);
    expect(readout.unbookedClaims.count).toBe(1);
    expect(readout.unbookedClaims.sample[0]?.mailIntent).toBe(false);
  });

  it('resumes a mail claim whose pass died before the BOOKING: one parcel, then done (B2c)', async () => {
    // The provable resume: the intent is stamped AND the parcel still sits in
    // the live book, so booking it completes the delivery without a re-mail.
    const h = makeHarness();
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    const ref = settlementCustodyRef(settlement.id);
    // A prior pass claimed, stamped the mail intent, wrote the parcel, and
    // died before markCustodyRefBooked (a restart: pendingMail is empty).
    expect(await h.db.claimCustodyRef(REALM, ref)).toBe(true);
    expect(await h.db.markCustodyMailIntent(ref)).toBe(true);
    await h.custody.persistMailParcel(
      { key: String(CHAR_A), name: 'Aldan' },
      'delivery',
      [{ itemId: EPIC_ITEM, count: 1 }],
      ref,
    );
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-resume-2'),
      'confirmSettlement',
    );
    expect(
      h.custody.parcels.filter((p) => p.custodyRef === ref),
      'exactly one parcel',
    ).toHaveLength(1);
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).not.toBeNull();
    expect((await h.db.listingById(REALM, listing.id))?.status).toBe('closed');
  });

  it('PARKS a mail claim whose letter was collected and deleted: never a second copy', async () => {
    // The regression the durable intent exists to stop: parcel written,
    // booking lost, buyer takes the item and deletes the emptied letter. The
    // in-book marker is gone, so a blind resume would mail copy two.
    const h = makeHarness();
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    const ref = settlementCustodyRef(settlement.id);
    expect(await h.db.claimCustodyRef(REALM, ref)).toBe(true);
    expect(await h.db.markCustodyMailIntent(ref)).toBe(true);
    await h.custody.persistMailParcel(
      { key: String(CHAR_A), name: 'Aldan' },
      'delivery',
      [{ itemId: EPIC_ITEM, count: 1 }],
      ref,
    );
    h.custody.collect(ref);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-resume-3'),
      'confirmSettlement',
    );
    expect(h.custody.parcels, 'no second copy, ever').toHaveLength(0);
    expect((await liveSettlement(h, listing.id)).state, 'parked visibly').toBe('delivering');
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBeNull();
  });

  it('keeps a failed mail booking VISIBLE and resumes it: one parcel, then done', async () => {
    const h = makeHarness();
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    const ref = settlementCustodyRef(settlement.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    h.custody.failNextPersist = true;
    unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-mail-keep-1'),
      'confirmSettlement',
    );
    // The write threw: the claim STAYS, unbooked and visible (releasing it
    // made a repeatedly failing mail write invisible), and nothing advanced.
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBeNull();
    expect((await liveSettlement(h, listing.id)).state).toBe('delivering');
    expect(h.sweepErrors.map(([arm]) => arm)).toContain('delivered');
    // The next pass resumes the SAME claim: one parcel, booked, finalized.
    await h.service.sweepPass();
    expect(h.custody.parcels.filter((p) => p.custodyRef === ref)).toHaveLength(1);
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).not.toBeNull();
    expect((await h.db.listingById(REALM, listing.id))?.status).toBe('closed');
  });

  it('PARKS a same-process retry once the written letter was collected', async () => {
    // The in-process twin of the collected-letter hazard: the parcel was
    // written, the BOOKING threw, and the buyer collected and deleted the
    // letter before the retry. The process's own memory of the attempt must
    // not authorize a re-mail (only the parcel still being in the book may),
    // or every booking brownout longer than one collection becomes copy two.
    const h = makeHarness();
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    const ref = settlementCustodyRef(settlement.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    h.db.failNextMarkBooked = true;
    unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-collect-1'),
      'confirmSettlement',
    );
    expect(
      h.custody.parcels.filter((p) => p.custodyRef === ref),
      'written once',
    ).toHaveLength(1);
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBeNull();
    // The buyer takes the item and deletes the emptied letter.
    h.custody.collect(ref);
    await h.service.sweepPass();
    await h.service.sweepPass();
    expect(
      h.custody.parcels.filter((p) => p.custodyRef === ref),
      'never re-mailed',
    ).toHaveLength(0);
    expect((await liveSettlement(h, listing.id)).state, 'parked visibly').toBe('delivering');
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBeNull();
  });

  it('PARKS after a blob-half throw once the letter was collected: written flips BEFORE the call', async () => {
    // The interleaving the flip-before-persist rule exists for: the persist
    // THREW after the parcel entered the live book (the blob half failing),
    // so the attempt never returned, and the buyer collected and deleted the
    // letter before the retry. Only an entry marked written AT ATTEMPT TIME
    // parks here; an entry flipped after the call would still read unwritten
    // and authorize the re-mail, which is copy two. The booking twins above
    // cannot see this: their persist SUCCEEDS, so the flip order is
    // indistinguishable there.
    const h = makeHarness();
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    const ref = settlementCustodyRef(settlement.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    h.custody.failNextPersist = true;
    unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-blobhalf-1'),
      'confirmSettlement',
    );
    expect(
      h.custody.parcels.filter((p) => p.custodyRef === ref),
      'the parcel reached the live book before the throw',
    ).toHaveLength(1);
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBeNull();
    h.custody.collect(ref);
    await h.service.sweepPass();
    await h.service.sweepPass();
    expect(
      h.custody.persistCalls.filter((r) => r === ref),
      'exactly one attempt ever reached the post office',
    ).toHaveLength(1);
    expect(h.custody.parcels.filter((p) => p.custodyRef === ref)).toHaveLength(0);
    expect((await liveSettlement(h, listing.id)).state, 'parked visibly').toBe('delivering');
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBeNull();
  });

  it('resumes a same-process retry while the written letter stays uncollected', async () => {
    // The positive twin: booking threw, nobody collected, so the parcel in
    // the book authorizes the resume and the booking completes, exactly once.
    const h = makeHarness();
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    const ref = settlementCustodyRef(settlement.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    h.db.failNextMarkBooked = true;
    unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-collect-2'),
      'confirmSettlement',
    );
    await h.service.sweepPass();
    expect(h.custody.parcels.filter((p) => p.custodyRef === ref)).toHaveLength(1);
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).not.toBeNull();
    expect((await h.db.listingById(REALM, listing.id))?.status).toBe('closed');
  });

  it('books a seller notice over a stale bare claim: item-free letters skip the ledger', async () => {
    // A sold notice carries no items, so nothing it does can duplicate or
    // destroy; minting durable claims for it only polluted the operator
    // queue (a transiently failed notice parked forever, since nothing ever
    // re-notifies). The notice mails regardless of leftover claim rows.
    const h = stocked();
    buyerOnline(h);
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    const accepted = await acceptWith(h, offer.offer.id);
    if (!accepted.ok || !accepted.listing) throw new Error('accept refused');
    const listingId = accepted.listing.id;
    const noticeRef = listingSoldNoticeCustodyRef(listingId);
    // A stale bare claim under the notice ref (hand intervention residue).
    expect(await h.db.claimCustodyRef(REALM, noticeRef)).toBe(true);
    const bought = unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId,
        acceptTerms: true,
      }),
      'buyNow',
    );
    unwrap(await h.service.settlementQuote(BUYER_A, bought.settlement.id), 'settlementQuote');
    unwrap(
      await h.service.confirmSettlement(BUYER_A, bought.settlement.id, 'sig-notice-1'),
      'confirmSettlement',
    );
    expect((await h.db.listingById(REALM, listingId))?.status).toBe('closed');
    expect(
      h.custody.parcels.map((p) => p.custodyRef),
      'the notice still lands',
    ).toContain(noticeRef);
    // And no delivery-side claim state changed for the notice ref.
    expect(h.db.custodyClaims.get(noticeRef)?.bookedAtMs).toBeNull();
  });

  it('re-drives delivered-but-unclosed residue FORWARD to the finished sale', async () => {
    // The residue shape an older binary's crash leaves: custody booked,
    // settlement 'delivered', close tail never ran. The reclaim arm used to
    // skip it silently forever; it must now converge it to the finished sale.
    const h = stocked();
    buyerOnline(h);
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    const accepted = await acceptWith(h, offer.offer.id);
    if (!accepted.ok || !accepted.listing) throw new Error('accept refused');
    const listingId = accepted.listing.id;
    const bought = unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId,
        acceptTerms: true,
      }),
      'buyNow',
    );
    unwrap(await h.service.settlementQuote(BUYER_A, bought.settlement.id), 'settlementQuote');
    // Custody books, then the tail refuses once (standing in for the old
    // binary crashing between its delivered CAS and its close statements).
    h.db.failNextFinalize = 'contended';
    unwrap(
      await h.service.confirmSettlement(BUYER_A, bought.settlement.id, 'sig-redrive-1'),
      'confirmSettlement',
    );
    await h.db.transitionSettlement(bought.settlement.id, ['delivering'], 'delivered');
    // A buy-now residue keeps the listing 'active': the re-drive must find it
    // by the delivered settlement itself, not by a stranded listing status.
    expect((await h.db.listingById(REALM, listingId))?.status).toBe('active');
    const stats = await h.service.sweepPass();
    expect(stats?.redriven).toBe(1);
    const listing = await h.db.listingById(REALM, listingId);
    expect(listing?.status).toBe('closed');
    expect(listing?.resolution).toBe('sold');
    expect(listing?.itemDisposed).toBe(true);
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10)).toHaveLength(1);
    // The seller still hears about the completed sale on the re-driven path.
    expect(h.custody.parcels.map((p) => p.custodyRef)).toContain(
      listingSoldNoticeCustodyRef(listingId),
    );
    // A second pass changes nothing: converged, and never counted again. The
    // clock has to cross the beat interval first, or the arm returns 0 from
    // its minute gate without reading anything and this pins nothing.
    h.setNow(h.now() + 61_000);
    const again = await h.service.sweepPass();
    expect(again?.redriven).toBe(0);
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10)).toHaveLength(1);
  });

  it('converges an old sold-but-undisposed residue when its sale row stands', async () => {
    // The other close-tail residue: closed 'sold', sale row present, dispose
    // flag never landed. The standing sale proves delivery completed, so the
    // flag is bookkeeping the redriven beat settles; without a sale row the
    // row would stay parked for the operator instead.
    const h = stocked();
    buyerOnline(h);
    h.db.failNextFinalize = 'contended';
    const { listingId } = await settleDirected(h);
    // Craft the residue the old binary left: sale + close landed, dispose did
    // not. The sale insert is the primitive the old tail used.
    await h.db.insertSale({
      realm: REALM,
      listingId,
      itemId: EPIC_ITEM,
      item: { itemId: EPIC_ITEM, count: 1 },
      priceCents: 1000,
      amountBase: null,
      sellerAccount: SELLER,
      buyerAccount: BUYER_A,
      sellerName: 'Selara',
      buyerName: 'Aldan',
    });
    await h.db.transitionSettlement(
      (await liveSettlement(h, listingId)).id,
      ['delivering'],
      'delivered',
    );
    const stats = await h.service.sweepPass();
    expect(stats?.redriven).toBeGreaterThanOrEqual(1);
    const listing = await h.db.listingById(REALM, listingId);
    expect(listing?.status).toBe('closed');
    expect(listing?.itemDisposed).toBe(true);
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10), 'still exactly one sale').toHaveLength(1);
  });

  it('refuses to deliver over an already-disposed listing: parked, not duplicated', async () => {
    // The return-then-deliver belt: once the escrowed copy left custody, a
    // late delivery attempt must do NOTHING (an operator resolves it), and
    // the settlement stays visible in 'delivering'.
    const h = stocked();
    buyerOnline(h);
    h.db.failNextFinalize = 'contended';
    const { listingId } = await settleDirected(h);
    const settlement = await liveSettlement(h, listingId);
    expect(settlement.state).toBe('delivering');
    await h.db.markItemDisposed(listingId);
    const grantsBefore = h.custody.grantCalls;
    const parcelsBefore = h.custody.parcels.length;
    await h.service.sweepPass();
    h.setNow(h.now() + 61_000);
    await h.service.sweepPass();
    expect((await liveSettlement(h, listingId)).state, 'parked').toBe('delivering');
    expect(h.custody.grantCalls).toBe(grantsBefore);
    expect(h.custody.parcels.length).toBe(parcelsBefore);
    const readout = await h.db.stuckCustodyReadout(REALM, h.now() + 1, 10, 1000, 0);
    expect(readout.stuckDelivering.count).toBe(1);
  });

  it('refuses a disposed listing on the MAIL route too: zero parcels, decisive', async () => {
    // The Exchange shape of the same belt, with NO custody claim yet: without
    // the itemDisposed guard the mail route would write a parcel here, so a
    // zero-parcel assertion is what actually pins the guard.
    const h = makeHarness();
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    expect(await h.db.transitionSettlement(settlement.id, ['offered'], 'confirming')).toBe(true);
    expect(await h.db.transitionSettlement(settlement.id, ['confirming'], 'confirmed')).toBe(true);
    await h.db.markItemDisposed(listing.id);
    await h.service.sweepPass();
    expect(h.custody.parcels, 'no parcel over a disposed listing').toHaveLength(0);
    expect((await getSettlement(h, settlement.id)).state).toBe('delivering');
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10)).toHaveLength(0);
  });

  it('PARKS the mail route over a grant-intent claim: the hand-off may have landed', async () => {
    // A public listing whose ref carries a grant intent (hand intervention or
    // cross-shape residue): mailing over it risks the second copy, so the
    // mail rail refuses and the row stays visible.
    const h = makeHarness();
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    const ref = settlementCustodyRef(settlement.id);
    expect(await h.db.claimCustodyRef(REALM, ref)).toBe(true);
    expect(await h.db.markCustodyGrantIntent(ref, CHAR_A)).toBe(true);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    expect(await h.db.transitionSettlement(settlement.id, ['offered'], 'confirming')).toBe(true);
    expect(await h.db.transitionSettlement(settlement.id, ['confirming'], 'confirmed')).toBe(true);
    await h.service.sweepPass();
    expect(h.custody.parcels, 'never mails over a grant intent').toHaveLength(0);
    expect((await getSettlement(h, settlement.id)).state).toBe('delivering');
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBeNull();
  });

  it('PARKS a refused return with backoff instead of busy-looping the backlog', async () => {
    // The return-arm twin of the delivery park machinery: a return whose
    // claim carries a grant intent can never proceed on its own, so it must
    // back off (no per-pass persist attempts) and score zero, not saturate.
    const h = makeHarness();
    const listing = await listEpic(h);
    const ref = listingReturnCustodyRef(listing.id);
    expect(await h.db.claimCustodyRef(REALM, ref)).toBe(true);
    expect(await h.db.markCustodyGrantIntent(ref, CHAR_A)).toBe(true);
    expect(await h.service.adminSuspendListing(listing.id)).toEqual({ ok: true });
    const stats = await h.service.sweepPass();
    expect(stats?.returned, 'parked rows do not count as work').toBe(0);
    expect(h.custody.persistCalls, 'nothing was mailed').toHaveLength(0);
    expect((await getListing(h, listing.id)).itemDisposed).toBe(false);
    // Within the backoff window the parked row costs NO further attempts.
    await h.service.sweepPass();
    expect(h.custody.persistCalls).toHaveLength(0);
    // Past the backoff it retries (and parks again: the intent still stands).
    h.setNow(h.now() + 61_000);
    const later = await h.service.sweepPass();
    expect(later?.returned).toBe(0);
    expect((await getListing(h, listing.id)).itemDisposed).toBe(false);
  });

  it('one CONTENDED finalize stops ALL delivery work for the rest of the pass', async () => {
    // Without the pass-wide stop, rows a contended break left in 'delivering'
    // were re-attempted by the reconcile arm seconds later in the SAME pass,
    // spending the lock_timeout budget the break existed to conserve.
    const h = makeHarness();
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    h.custody.bags.set(CHAR_B, []);
    h.custody.owners.set(CHAR_B, BUYER_B);
    h.custody.owners.set(CHAR_TWIN, WALLET_TWIN);
    h.custody.bags.set(CHAR_TWIN, [{ itemId: EPIC_ITEM, count: 1 }]);
    const first = await listEpic(h);
    const second = unwrap(
      await createListingSteppedUp(h, {
        account: WALLET_TWIN,
        characterId: CHAR_TWIN,
        itemRef: { index: 0, itemId: EPIC_ITEM },
        params: listingParams({ startCents: 6000 }),
      }),
      'createListing',
    ).listing;
    await confirmedBid(h, BUYER_A, CHAR_A, first.id, 5000);
    await confirmedBid(h, BUYER_B, CHAR_B, second.id, 7000);
    h.setNow(Math.max(first.endsAtMs, second.endsAtMs) + 1);
    await h.service.sweepPass();
    for (const [buyer, listingId] of [
      [BUYER_A, first.id],
      [BUYER_B, second.id],
    ] as const) {
      const s = await liveSettlement(h, listingId);
      unwrap(await h.service.settlementQuote(buyer, s.id), 'settlementQuote');
      expect(await h.db.transitionSettlement(s.id, ['offered'], 'confirming')).toBe(true);
      expect(await h.db.transitionSettlement(s.id, ['confirming'], 'confirmed')).toBe(true);
    }
    h.db.failNextFinalize = 'contended';
    const blocked = await h.service.sweepPass();
    // The first row's contention stops the pass: the second claimed row is
    // NOT re-attempted by the reconcile arm in the same pass.
    expect(blocked?.delivered).toBe(0);
    expect(blocked?.reconciled, 'the reconcile arm honors the pass stop').toBe(0);
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10)).toHaveLength(0);
    const converge = await h.service.sweepPass();
    expect(converge?.reconciled).toBe(2);
    expect((await h.db.listingById(REALM, first.id))?.status).toBe('closed');
    expect((await h.db.listingById(REALM, second.id))?.status).toBe('closed');
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10)).toHaveLength(2);
  });

  it('retries a CONTENDED finalize on the next pass and converges, hands off', async () => {
    // The plain contended story with no surgery: the tail refuses once (a
    // guard held the listing row), the batch stops, and the very next pass
    // finishes the sale exactly once.
    const h = stocked();
    buyerOnline(h);
    h.db.failNextFinalize = 'contended';
    const { listingId } = await settleDirected(h);
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
    const stats = await h.service.sweepPass();
    expect(stats?.reconciled).toBe(1);
    const listing = await h.db.listingById(REALM, listingId);
    expect(listing?.status).toBe('closed');
    expect(listing?.resolution).toBe('sold');
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10)).toHaveLength(1);
  });

  it('isolates one poisoned ROW: the rest of the delivery batch still lands', async () => {
    // Per-row isolation inside the batch loop, distinct from the per-arm
    // isolation below: the first settlement's listing read throws once and
    // the second settlement must still deliver in the SAME pass.
    const h = makeHarness();
    h.custody.bags.set(CHAR_A, []);
    h.custody.owners.set(CHAR_A, BUYER_A);
    h.custody.bags.set(CHAR_B, []);
    h.custody.owners.set(CHAR_B, BUYER_B);
    const first = await listEpic(h);
    // A second seller (the wallet twin) lists its own epic, so two deliveries
    // share one batch.
    h.custody.owners.set(CHAR_TWIN, WALLET_TWIN);
    h.custody.bags.set(CHAR_TWIN, [{ itemId: EPIC_ITEM, count: 1 }]);
    const second = unwrap(
      await createListingSteppedUp(h, {
        account: WALLET_TWIN,
        characterId: CHAR_TWIN,
        itemRef: { index: 0, itemId: EPIC_ITEM },
        params: listingParams({ startCents: 6000 }),
      }),
      'createListing',
    ).listing;
    await confirmedBid(h, BUYER_A, CHAR_A, first.id, 5000);
    await confirmedBid(h, BUYER_B, CHAR_B, second.id, 7000);
    h.setNow(Math.max(first.endsAtMs, second.endsAtMs) + 1);
    await h.service.sweepPass();
    const settlementA = await liveSettlement(h, first.id);
    const settlementB = await liveSettlement(h, second.id);
    for (const [buyer, s] of [
      [BUYER_A, settlementA],
      [BUYER_B, settlementB],
    ] as const) {
      unwrap(await h.service.settlementQuote(buyer, s.id), 'settlementQuote');
      expect(await h.db.transitionSettlement(s.id, ['offered'], 'confirming')).toBe(true);
      expect(await h.db.transitionSettlement(s.id, ['confirming'], 'confirmed')).toBe(true);
    }
    const original = h.db.listingById.bind(h.db);
    let poisoned = true;
    h.db.listingById = async (realm, id) => {
      if (poisoned && id === first.id) {
        poisoned = false;
        throw new Error('poisoned row');
      }
      return original(realm, id);
    };
    const stats = await h.service.sweepPass();
    expect(h.sweepErrors.map(([arm]) => arm)).toContain('delivered');
    expect(stats?.delivered, 'the healthy row advanced past the poison').toBe(1);
    expect((await getSettlement(h, settlementB.id)).state).toBe('delivered');
    expect((await h.db.listingById(REALM, second.id))?.status).toBe('closed');
    // The poisoned row is not lost either: the reconcile arm, later in the
    // SAME pass, re-reads 'delivering' rows and lands it (poison consumed).
    expect(stats?.reconciled).toBe(1);
    expect((await getSettlement(h, settlementA.id)).state).toBe('delivered');
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10), 'both sales, once each').toHaveLength(2);
  });

  it('isolates one poisoned sweep arm: later arms still run and the failure is reported', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    h.setNow(listing.endsAtMs + 1);
    const original = h.db.lapsePendingBids.bind(h.db);
    let poisoned = true;
    h.db.lapsePendingBids = async (realm, cutoffMs, limit) => {
      if (poisoned) {
        poisoned = false;
        throw new Error('poisoned arm');
      }
      return original(realm, cutoffMs, limit);
    };
    const stats = await h.service.sweepPass();
    // The poisoned arm scores zero and is reported; the close arm, which runs
    // AFTER it, still resolves the due listing in the same pass (the old
    // shape aborted the whole pass at the first throw).
    expect(stats?.lapsedBids).toBe(0);
    expect(h.sweepErrors.map(([arm]) => arm)).toContain('lapsedBids');
    expect(stats?.closed).toBe(1);
    expect((await h.db.listingById(REALM, listing.id))?.status).toBe('closed');
  });

  it('delivers exactly once even if the sweep runs the settlement again', async () => {
    // The custodyRef claim is shared by both routes precisely so no sequence of
    // retries can hand over a copy AND post one.
    const h = stocked();
    buyerOnline(h);
    const before = bagsOf(h, CHAR_A).length;
    await settleDirected(h);
    await h.service.sweepPass();
    await h.service.sweepPass();
    expect(bagsOf(h, CHAR_A), 'one copy, not three').toHaveLength(before + 1);
    expect(h.custody.parcels.filter((p) => p.letter === 'delivery')).toHaveLength(0);
  });

  it('refuses acceptance by anyone but the named buyer, as not_found', async () => {
    const h = stocked();
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    const res = await h.service.acceptDirectedOffer(
      BUYER_B,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      CHAR_B,
    );
    expect(res).toEqual({ ok: false, reason: 'not_found' });
    expect(bagsOf(h, SELLER_CHAR), 'a refused accept escrows nothing').toHaveLength(2);
  });

  it('accepting twice CONCURRENTLY escrows exactly one copy', async () => {
    // Fired in parallel, deliberately. Awaiting them in sequence proves nothing:
    // the second call would see status 'accepted' and be turned away by the
    // pre-check, so the test passes even with the compare-and-set claim removed.
    // The real shape is a double-click putting two requests in flight together,
    // where both read 'pending' before either writes, and only the claim's
    // compare-and-set stops both reaching createListing and taking two copies.
    const h = stocked();
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    await buyerAccepts(h, offer.offer.id);
    const [first, second] = await Promise.all([
      sellerAccepts(h, offer.offer.id),
      sellerAccepts(h, offer.offer.id),
    ]);
    // Exactly one produces a LISTING: the other loses the compare-and-set. Both
    // may report ok, which is why the assertion is on the escrow, not the flag.
    const listings = [first, second].filter((r) => r.ok && r.listing !== null);
    expect(listings, 'exactly one accept may escrow').toHaveLength(1);
    expect(bagsOf(h, SELLER_CHAR), 'exactly one copy escrowed').toHaveLength(1);
  });

  it('escrows on the SECOND acceptance, never the first, from either order', async () => {
    // Both sides agree through the trade window's ordinary Accept, so one side
    // alone must move nothing. Order must not matter: whoever presses last is
    // the one that escrows.
    for (const sellerFirst of [false, true]) {
      const h = stocked();
      const offer = await h.service.createDirectedOffer(offerArgs());
      if (!offer.ok) throw new Error('offer refused');
      const before = bagsOf(h, SELLER_CHAR).length;

      const first = sellerFirst
        ? await sellerAccepts(h, offer.offer.id)
        : await buyerAccepts(h, offer.offer.id);
      expect(first.ok, `first accept (sellerFirst=${sellerFirst})`).toBe(true);
      expect((first as { listing: unknown }).listing, 'one side alone escrows nothing').toBeNull();
      expect(bagsOf(h, SELLER_CHAR)).toHaveLength(before);

      const second = sellerFirst
        ? await buyerAccepts(h, offer.offer.id)
        : await sellerAccepts(h, offer.offer.id);
      expect(second.ok).toBe(true);
      expect((second as { listing: unknown }).listing, 'the second escrows').not.toBeNull();
      expect(bagsOf(h, SELLER_CHAR)).toHaveLength(before - 1);
    }
  });

  it('refuses a seller acceptance that names no item', async () => {
    // The seller's acceptance is the only place the goods are named, so an
    // itemless one would agree to sell nothing.
    const h = stocked();
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    const res = await acceptSteppedUp(h, SELLER, offer.offer.id, null, SELLER_CHAR);
    expect(res).toEqual({ ok: false, reason: 'character_invalid' });
  });

  it('a sequential second accept is also refused', async () => {
    const h = stocked();
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    expect((await acceptWith(h, offer.offer.id)).ok).toBe(true);
    expect(await acceptWith(h, offer.offer.id)).toEqual({
      ok: false,
      reason: 'not_pending',
    });
  });

  it('reopens the offer when the escrow fails, so a transient refusal is retryable', async () => {
    // The compensating half of claim-then-escrow. Without it the offer is
    // silently dead while both players still see it as live.
    const h = stocked();
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    h.db.failNextEscrow = 'lease_lost';
    await buyerAccepts(h, offer.offer.id);
    const failed = await sellerAccepts(h, offer.offer.id);
    expect(failed.ok).toBe(false);
    expect(bagsOf(h, SELLER_CHAR), 'the copy came back').toHaveLength(2);
    // Still pending, so the buyer can simply try again.
    const retried = await sellerAccepts(h, offer.offer.id);
    expect(retried.ok, 'the reopened offer accepts on retry').toBe(true);
  });

  it('refuses acceptance after the TTL, and never escrows for an expired offer', async () => {
    const h = stocked();
    const offer = await h.service.createDirectedOffer(offerArgs());
    if (!offer.ok) throw new Error('offer refused');
    h.setNow(offer.offer.expiresAtMs);
    const res = await acceptWith(h, offer.offer.id);
    expect(res).toEqual({ ok: false, reason: 'offer_expired' });
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
  });

  it('lets the seller decline and the buyer withdraw, but not the reverse', async () => {
    // Sequential offers (the pair-pending bound allows one live deal per
    // pair): each is exercised and resolved before the next exists.
    const h = stocked();
    const a = await h.service.createDirectedOffer(offerArgs());
    if (!a.ok) throw new Error('offer refused');
    // The verbs belong to opposite sides: the SELLER declines an offer made to
    // them, the BUYER withdraws one they made. Using the other side's verb reads
    // as not_found, the same anti-enumeration shape as everything else here.
    expect(await h.service.resolveDirectedOffer(BUYER_A, a.offer.id, 'decline')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await h.service.resolveDirectedOffer(SELLER, a.offer.id, 'decline')).toEqual({
      ok: true,
    });
    const b = await h.service.createDirectedOffer(offerArgs({ usdCents: 6000 }));
    if (!b.ok) throw new Error('offer refused');
    expect(await h.service.resolveDirectedOffer(SELLER, b.offer.id, 'withdraw')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(await h.service.resolveDirectedOffer(BUYER_A, b.offer.id, 'withdraw')).toEqual({
      ok: true,
    });
    // Neither verb touches custody.
    expect(bagsOf(h, SELLER_CHAR)).toHaveLength(2);
  });
});

describe('a directed sale carries the consequences of the rail it rides', () => {
  function stocked(): Harness {
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [
      { itemId: EPIC_ITEM, count: 1 },
      { itemId: EPIC_ITEM, count: 1 },
    ]);
    return h;
  }

  /** Buyer offers -> seller accepts with an item -> the buyer owes payment. */
  async function acceptedOffer(h: Harness): Promise<WocListingRow> {
    const offer = await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 5000,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    if (!offer.ok) throw new Error('offer refused');
    const first = await h.service.acceptDirectedOffer(BUYER_A, offer.offer.id, null, CHAR_A);
    if (!first.ok) throw new Error('buyer accept refused');
    const accepted = await acceptSteppedUp(
      h,
      SELLER,
      offer.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
    );
    if (!accepted.ok || accepted.listing === null) throw new Error('seller accept refused');
    return accepted.listing;
  }

  it('strikes a buyer who accepts and then never pays', async () => {
    // The requester's rule: strikes apply to p2p non-payment once both parties
    // have accepted. Acceptance is exactly when the seller's item left their
    // bags, so walking away has a cost to a specific person. There is no bond on
    // a directed sale, which makes the strike the only consequence available.
    const h = stocked();
    const listing = await acceptedOffer(h);
    const bought = await h.service.buyNow({
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      acceptTerms: true,
    });
    expect(bought.ok, 'the designated buyer can buy').toBe(true);
    expect(await h.db.strikeInfo(BUYER_A), 'no strike before the window lapses').toBeNull();

    const settlement = await liveSettlement(h, listing.id);
    h.setNow(settlement.deadlineAtMs + 1);
    await h.service.sweepPass();

    expect(await h.db.strikeInfo(BUYER_A)).toMatchObject({
      accountId: BUYER_A,
      strikes: 1,
    });
    // A directed abandon takes its strike and NOTHING ELSE: no cooldown
    // ledger row (the cooldowns defend the public loop only).
    expect(h.db.buyNowAbandons).toHaveLength(0);
  });

  it('does NOT strike an abandoned PUBLIC buy-now', async () => {
    // The other arm, and the reason the strike is keyed on the directed field
    // rather than on "was this a buy-now": a public buy-now buyer committed to
    // nothing, and the listing simply resumes for the next person.
    const h = stocked();
    const open = await listEpic(h, {
      format: 'buy_now',
      startCents: 2000,
      reserveCents: null,
      buyNowCents: 5000,
    });
    const bought = await h.service.buyNow({
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: open.id,
      acceptTerms: true,
    });
    expect(bought.ok).toBe(true);
    const settlement = await liveSettlement(h, open.id);
    h.setNow(settlement.deadlineAtMs + 1);
    await h.service.sweepPass();
    expect(await h.db.strikeInfo(BUYER_A), 'a public buy-now costs no strike').toBeNull();
  });

  it('lands a completed directed sale in the PUBLIC sales history, named on both sides', async () => {
    // The requester asked for public history covering every p2p $WOC trade. It
    // needs no special casing, but "needs none" is worth proving rather than
    // assuming: the row must actually be there, with both player names.
    const h = stocked();
    const listing = await acceptedOffer(h);
    unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    const settlement = await liveSettlement(h, listing.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    unwrap(
      await h.service.confirmSettlement(BUYER_A, settlement.id, 'sig-directed'),
      'confirmSettlement',
    );
    await h.service.sweepPass();

    const sales = await h.service.salesHistory(EPIC_ITEM, 20);
    const mine = sales.filter((s) => s.listingId === listing.id);
    expect(mine, 'the directed sale is publicly recorded').toHaveLength(1);
    expect(mine[0].priceCents).toBe(5000);
    expect(mine[0].sellerName).toBeTruthy();
    expect(mine[0].buyerName).toBeTruthy();

    // The seller pivot serves the SAME public rows keyed by the seller's
    // name (the Browse click-through), and an unknown name answers empty
    // rather than erring: the pane's empty face is a real answer.
    const bySeller = await h.service.sellerSalesHistory(mine[0].sellerName);
    expect(bySeller.sales.some((s) => s.listingId === listing.id)).toBe(true);
    // No character row seeded for the name: the profile arm answers null
    // (the renamed-or-deleted shape) while the sales still stand.
    expect(bySeller.profile).toBeNull();
    h.db.sellerProfiles.set(`${REALM}\x1f${mine[0].sellerName}`, {
      guildName: 'Monarchs',
    });
    const withProfile = await h.service.sellerSalesHistory(mine[0].sellerName);
    expect(withProfile.profile).toEqual({
      guildName: 'Monarchs',
    });
    expect(await h.service.sellerSalesHistory('NoSuchSeller')).toEqual({
      sales: [],
      profile: null,
    });
  });
});

describe('the trade window asks whether a counterparty can be paid in $WOC', () => {
  it('reports a linked player as payable, by character and with no account id', async () => {
    const h = makeHarness();
    const partner = await h.service.tradePartner(SELLER, 'Aldan');
    expect(partner).toEqual({ name: 'Aldan', walletVerified: true });
    // The response shape is the contract: leaking an account id here would put
    // one on the wire for every player you open a trade with.
    expect(Object.keys(partner ?? {}).sort()).toEqual(['name', 'walletVerified']);
  });

  it('reports an unlinked player as not payable, which is what drives the copy', async () => {
    const h = makeHarness();
    h.wallets.delete(BUYER_A);
    expect((await h.service.tradePartner(SELLER, 'Aldan'))?.walletVerified).toBe(false);
  });

  it('reports YOUR OWN character as not payable', async () => {
    // So the window never offers an arm that createDirectedOffer would refuse.
    const h = makeHarness();
    expect((await h.service.tradePartner(SELLER, 'Selara'))?.walletVerified).toBe(false);
  });

  it('reads as absent for a character that is not on this realm', async () => {
    const h = makeHarness();
    expect(await h.service.tradePartner(SELLER, 'Nobody')).toBeNull();
  });

  it('refuses an offer to another character of your OWN account', async () => {
    // Same account, different character: an alt is still yourself, and the
    // check must be on the resolved ACCOUNT rather than the character id.
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const res = await h.service.createDirectedOffer({
      account: SELLER,
      characterId: SELLER_CHAR,
      sellerCharacterName: 'Selara Alt',
      usdCents: 5000,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    expect(res).toEqual({ ok: false, reason: 'self_offer' });
  });
});

describe('the sweep error fallback, with NO onSweepError injected', () => {
  it('logs the code, message, and stack shape and keeps a bare rejection inside the arm', async () => {
    // Production injects no onSweepError (nothing under server/ supplies
    // one), so the console.error fallback IS the production log line; the
    // harness always injects, so without this case the shipped branch never
    // ran under test. A bare Promise.reject() carries `undefined`: the
    // null-safe code read must not throw, or the TypeError would escape
    // arm()'s isolation and abort the remaining arms of the pass.
    const h = makeHarness();
    const bare = new WocMarketService({ ...h.deps, onSweepError: undefined });
    h.db.expireDueDirectedOffers = () => Promise.reject();
    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const stats = await bare.sweepPass();
      expect(stats, 'the pass completed past the failed arm').not.toBeNull();
    } finally {
      console.error = original;
    }
    const line = logged.find((args) => String(args[0]).includes('sweep arm'));
    expect(line, 'the fallback logged the failed arm').toBeDefined();
    expect(line?.[1]).toEqual({ code: undefined, message: 'undefined', stack: undefined });
  });
});

describe('the sweep expires unanswered directed offers', () => {
  // The gap this pins: expireDueDirectedOffers existed and nothing called it, so
  // a pending offer never resolved. It escrows nothing, but it stayed visible in
  // both players' trade windows as a deal that could never be accepted, and the
  // retention prune only reaches resolved rows, so the table grew without bound.
  it('flips a lapsed offer to expired, and leaves a live one alone', async () => {
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const made = await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 5000,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    if (!made.ok) throw new Error('offer refused');

    // Still inside the window: the sweep must not touch it.
    await h.service.sweepPass();
    expect((await h.db.directedOfferById(REALM, made.offer.id))?.status).toBe('pending');

    h.setNow(made.offer.expiresAtMs + 1);
    const stats = await h.service.sweepPass();
    expect(stats?.expiredOffers).toBe(1);
    expect((await h.db.directedOfferById(REALM, made.offer.id))?.status).toBe('expired');
  });

  it('refuses acceptance of an expired offer without escrowing', async () => {
    const h = makeHarness();
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const made = await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 5000,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    });
    if (!made.ok) throw new Error('offer refused');
    h.setNow(made.offer.expiresAtMs + 1);
    await h.service.sweepPass();
    // Deliberately bearer-only: the expired-offer refusal lands BEFORE the
    // step-up gate (status precedes proof in the ladder), so no proof is
    // mintable for it either (the challenge issue refuses the same way).
    const res = await h.service.acceptDirectedOffer(
      SELLER,
      made.offer.id,
      { index: 0, itemId: EPIC_ITEM },
      SELLER_CHAR,
    );
    expect(res.ok).toBe(false);
    expect(bagsOf(h, SELLER_CHAR), 'nothing may leave the bags').toHaveLength(1);
  });
});

describe('the insert refusal arms at the service seam', () => {
  it('buyNow answers not_active and releases the lock when the listing closed under the claim', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    vi.spyOn(h.db, 'insertSettlement').mockResolvedValueOnce('listing_closed');
    const out = await h.service.buyNow({
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      acceptTerms: true,
    });
    // Honest answer, no phantom lock: the refusal names the closed listing,
    // and the claimed lock is released so the seller-side resolution can run.
    expect(out).toEqual({ ok: false, reason: 'not_active' });
    const row = await getListing(h, listing.id);
    expect(row.buyNowLockAccount).toBeNull();
  });

  it('buyNow answers contended and releases the lock on plain row contention', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    vi.spyOn(h.db, 'insertSettlement').mockResolvedValueOnce('contended');
    const out = await h.service.buyNow({
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      acceptTerms: true,
    });
    expect(out).toEqual({ ok: false, reason: 'contended' });
    expect((await getListing(h, listing.id)).buyNowLockAccount).toBeNull();
  });

  it('a due auction with no bids parks settling instead of closing under a live buy-now settlement', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const inserted = await h.db.insertSettlement({
      listingId: listing.id,
      bidId: null,
      attempt: 0,
      buyerAccount: BUYER_A,
      buyerCharacter: CHAR_A,
      buyerName: 'Aldan',
      buyerWallet: 'wallet-a',
      amountCents: 8000,
      deadlineAtMs: listing.endsAtMs + 60_000,
      nowMs: h.now(),
    });
    if (typeof inserted === 'string') throw new Error(`fixture refused: ${inserted}`);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    // The old unguarded close here was the item-dupe hole: closed 'no_bids'
    // mails the escrow home while the buyer can still pay and be delivered.
    const row = await getListing(h, listing.id);
    expect(row.status).toBe('settling');
    expect(row.resolution).toBeNull();
  });

  it('the close arm leaves a claimed listing alone when a suspend closed it underneath', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    vi.spyOn(h.db, 'insertSettlement').mockResolvedValueOnce('listing_closed');
    await h.service.sweepPass();
    // The arm must CONTINUE: the suspend that closed the listing already
    // resolved the bid book, so there is nothing to settle and the claim must
    // not be flipped to 'settling' (the fall-through would do exactly that).
    expect((await getListing(h, listing.id)).status).toBe('ending');
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('active');
    expect(bid.bondState).toBe('held');
  });

  it('the cascade unwinds its bond re-hold when the listing closed under it', async () => {
    const h = makeHarness();
    // Refunds that cannot settle keep the runner-up's queue entry visible, so
    // the re-hold and its unwind are observable states rather than a blur.
    const stalledRefunds = new WocMarketService({
      ...h.deps,
      economy: { ...h.economy, refundBond: async () => ({ done: false, reason: 'rpc_down' }) },
    });
    const listing = await listEpic(h);
    const runnerUp = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    const winner = await confirmedBid(h, BUYER_C, CHAR_C, listing.id, 6000);
    h.setNow(listing.endsAtMs + 1);
    await stalledRefunds.sweepPass();
    // The close-time winner defaults; the cascade re-holds the runner-up's
    // bond and tries to insert the next settlement, which loses to a
    // concurrent close.
    const settled = await liveSettlement(h, listing.id);
    expect(settled.bidId).toBe(winner.bidId);
    h.setNow(settled.deadlineAtMs + 1);
    vi.spyOn(h.db, 'insertSettlement').mockResolvedValueOnce('listing_closed');
    await stalledRefunds.sweepPass();
    const after = await getBid(h, runnerUp.bidId);
    // The unwind: never 'held' on a bid with no claim, and never 'won'.
    expect(after.status).toBe('outbid');
    expect(after.bondState).toBe('refund_due');
  });

  it('an admin suspend refuses a delivered-but-unclosed listing', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const inserted = await h.db.insertSettlement({
      listingId: listing.id,
      bidId: null,
      attempt: 0,
      buyerAccount: BUYER_A,
      buyerCharacter: CHAR_A,
      buyerName: 'Aldan',
      buyerWallet: 'wallet-a',
      amountCents: 8000,
      deadlineAtMs: h.now() + 60_000,
      nowMs: h.now(),
    });
    if (typeof inserted === 'string') throw new Error(`fixture refused: ${inserted}`);
    await h.db.transitionSettlement(inserted.id, ['offered'], 'confirming');
    await h.db.transitionSettlement(inserted.id, ['confirming'], 'confirmed');
    await h.db.transitionSettlement(inserted.id, ['confirmed'], 'delivering');
    await h.db.transitionSettlement(inserted.id, ['delivering'], 'delivered');
    const out = await h.service.adminSuspendListing(listing.id);
    expect(out).toEqual({ ok: false, reason: 'settlement_in_flight' });
    expect((await getListing(h, listing.id)).status).toBe('active');
  });

  it('a buyer may retry the SAME signature after a failed confirmation', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const inserted = await h.db.insertSettlement({
      listingId: listing.id,
      bidId: null,
      attempt: 0,
      buyerAccount: BUYER_A,
      buyerCharacter: CHAR_A,
      buyerName: 'Aldan',
      buyerWallet: 'wallet-a',
      amountCents: 8000,
      deadlineAtMs: h.now() + 60_000,
      nowMs: h.now(),
    });
    if (typeof inserted === 'string') throw new Error(`fixture refused: ${inserted}`);
    expect(await h.db.submitSettlementSignature(inserted.id, 'sig-retry-1')).toBe('ok');
    // A refused confirm sends the row failed, the retry revives it, and the
    // SAME signature must be accepted: the unique index adds no new entry for
    // re-writing the same value onto the same row. Only ANOTHER settlement
    // carrying the signature refuses.
    await h.db.transitionSettlement(inserted.id, ['confirming'], 'failed', 'refused');
    await h.db.transitionSettlement(inserted.id, ['failed'], 'offered');
    expect(await h.db.submitSettlementSignature(inserted.id, 'sig-retry-1')).toBe('ok');
    // listEpic extracts by bag index 0, so the replacement copy goes FIRST.
    h.custody.bags.get(SELLER_CHAR)?.unshift({ itemId: EPIC_ITEM, count: 1 });
    const secondListing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const other = await h.db.insertSettlement({
      listingId: secondListing.id,
      bidId: null,
      attempt: 0,
      buyerAccount: BUYER_C,
      buyerCharacter: CHAR_C,
      buyerName: 'Corvo',
      buyerWallet: 'wallet-c',
      amountCents: 8000,
      deadlineAtMs: h.now() + 60_000,
      nowMs: h.now(),
    });
    if (typeof other === 'string') throw new Error(`fixture refused: ${other}`);
    expect(await h.db.submitSettlementSignature(other.id, 'sig-retry-1')).toBe('signature_reused');
  });

  it('the reclaim parks a failed settlement for the overdue pass instead of expiring it', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settled = await liveSettlement(h, listing.id);
    expect(settled.bidId).toBe(standing.bidId);
    // The buyer's confirmation is refused inside the window: retry-eligible.
    await h.db.transitionSettlement(settled.id, ['offered'], 'failed', 'refused');
    // Past the stranded grace but INSIDE the settlement deadline: the reclaim
    // must leave everything alone (expiring here would skip the deadline
    // pass's default, forfeit, strike, and cascade, stranding the held bond).
    h.setNow(listing.endsAtMs + 1 + WOC_MARKET_STRANDED_RECLAIM_SECONDS * 1000 + 1000);
    await h.service.sweepPass();
    expect((await getListing(h, listing.id)).status).toBe('settling');
    const parked = await getBid(h, standing.bidId);
    expect(parked.status).toBe('won');
    expect(parked.bondState).toBe('held');
    // At the deadline the overdue pass runs its FULL consequence set.
    h.setNow(settled.deadlineAtMs + 1);
    await h.service.sweepPass();
    const defaulted = await getBid(h, standing.bidId);
    expect(defaulted.status).toBe('defaulted');
    expect(defaulted.bondState).not.toBe('held');
    expect((await getListing(h, listing.id)).status).toBe('closed');
  });

  it('the cascade pick breaks ties by placement time, then by id', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const place = async (account: number, characterId: number, name: string, amount: number) => {
      const out = await h.db.insertPendingBid({
        realm: REALM,
        listingId: listing.id,
        account,
        characterId,
        characterName: name,
        wallet: `wallet-${name}`,
        amountCents: amount,
        bondCents: 100,
        nowMs: h.now(),
        minNext: () => 0,
      });
      if (!out.ok) throw new Error(`fixture bid refused: ${out.reason}`);
      await h.db.markBidStatus(out.bid.id, 'outbid');
      return out.bid.id;
    };
    const early = await place(BUYER_A, CHAR_A, 'Aldan', 5000);
    h.setNow(BASE_MS + 60_000);
    const late = await place(BUYER_B, CHAR_B, 'Brint', 5000);
    const lateTwin = await place(BUYER_C, CHAR_C, 'Corvo', 5000);
    // Equal amounts: the EARLIEST placement wins the cascade pick.
    expect((await h.db.nextCascadeBidder(listing.id, 0))?.id).toBe(early);
    // A defaulted prior winner leaves the pool; equal amount AND time on the
    // remaining pair, so the lowest id wins (a total, deterministic order).
    await h.db.markBidStatus(early, 'defaulted');
    expect((await h.db.nextCascadeBidder(listing.id, 0))?.id).toBe(late);
    expect(lateTwin).toBeGreaterThan(late);
    // The exclusion is by ACCOUNT, not by row: BUYER_B's candidate row stays
    // an eligible 'outbid', but a SIBLING defaulted bid from the same account
    // disqualifies it, so the pick falls through to BUYER_C.
    const rebid = await place(BUYER_B, CHAR_B, 'Brint', 4000);
    await h.db.markBidStatus(rebid, 'defaulted');
    expect((await h.db.nextCascadeBidder(listing.id, 0))?.id).toBe(lateTwin);
  });
});

// ---------------------------------------------------------------------------
// Park rotation, the residue beats, and the resume ledgers.
//
// The shared theme: work that CANNOT proceed must stay visible and stay
// bounded. A parked row rotates out of the batch head without refreshing the
// age the monitor watches, the residue beats converge over resumable pages
// rather than one unbounded burst, and a resume that cannot prove the item is
// undelivered stops instead of guessing. The directed-offer block above scopes
// its own copies of these fixtures; they are re-stated here so each block reads
// on its own.
// ---------------------------------------------------------------------------

/** The stuck-custody horizon the operator readout is queried with. */
const STUCK_HORIZON_MS = 600_000;
/** One tick past the in-process park backoff (PARK_RETRY_MS). */
const PAST_BACKOFF_MS = 61_000;

/** Two epics in the seller's bags, so one harness can stage a directed sale
 *  and still have a copy left for a second listing. */
function twoEpics(h: Harness): Harness {
  h.custody.bags.set(SELLER_CHAR, [
    { itemId: EPIC_ITEM, count: 1 },
    { itemId: EPIC_ITEM, count: 1 },
  ]);
  return h;
}

/** The buyer online with room to spare. Without it every hand-off refuses as
 *  'offline' and the park assertions below pass for the wrong reason. */
function putBuyerOnline(h: Harness): void {
  h.custody.bags.set(CHAR_A, []);
  h.custody.owners.set(CHAR_A, BUYER_A);
}

/** A directed p2p deal driven from offer to a delivery attempt: both sides
 *  accept (buyer first, so the SELLER's acceptance escrows), the buyer takes
 *  the buy-now price, and confirmSettlement delivers eagerly. */
async function directedSale(h: Harness, signature: string): Promise<{ listingId: number }> {
  const offer = unwrap(
    await h.service.createDirectedOffer({
      account: BUYER_A,
      characterId: CHAR_A,
      sellerCharacterName: 'Selara',
      usdCents: 5000,
      item: { itemId: EPIC_ITEM },
      acceptTerms: true,
    }),
    'createDirectedOffer',
  );
  unwrap(
    await h.service.acceptDirectedOffer(BUYER_A, offer.offer.id, null, CHAR_A),
    'buyer accept',
  );
  const accepted = unwrap(
    await acceptSteppedUp(h, SELLER, offer.offer.id, { index: 0, itemId: EPIC_ITEM }, SELLER_CHAR),
    'seller accept',
  );
  if (!accepted.listing) throw new Error('the seller acceptance produced no listing');
  const listingId = accepted.listing.id;
  const bought = unwrap(
    await h.service.buyNow({ account: BUYER_A, characterId: CHAR_A, listingId, acceptTerms: true }),
    'buyNow',
  );
  unwrap(await h.service.settlementQuote(BUYER_A, bought.settlement.id), 'settlementQuote');
  unwrap(
    await h.service.confirmSettlement(BUYER_A, bought.settlement.id, signature),
    'confirmSettlement',
  );
  return { listingId };
}

/** Take a closed public auction's settlement to 'confirmed' WITHOUT
 *  confirmSettlement, whose eager arm would deliver it in the same breath. */
async function confirmedAwaitingDelivery(h: Harness, listingId: number): Promise<number> {
  const settlement = await liveSettlement(h, listingId);
  unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
  expect(await h.db.transitionSettlement(settlement.id, ['offered'], 'confirming')).toBe(true);
  expect(await h.db.transitionSettlement(settlement.id, ['confirming'], 'confirmed')).toBe(true);
  return settlement.id;
}

/** One delivered-but-unclosed residue row, the shape an older binary left when
 *  it died between its delivered CAS and its close tail. Seeded through the
 *  fake's DIRECT row seam (the pg suites' raw-SQL twin): the current binary
 *  cannot produce this state, and since the cap widened to count directed
 *  rows (H12), no live path can stage more residue than the cap either;
 *  residue rows predate that rule by definition. */
async function seedDeliveredResidue(h: Harness): Promise<{ listingId: number }> {
  const params = listingParams({ directedBuyerAccount: BUYER_A, buyNowCents: 5000 });
  const listingId = h.db.seedListingRow({
    realm: REALM,
    directedBuyerAccount: BUYER_A,
    sellerAccount: SELLER,
    sellerCharacter: SELLER_CHAR,
    sellerName: 'Selara',
    sellerWallet: 'wallet-seller',
    item: { itemId: EPIC_ITEM, count: 1 },
    itemId: EPIC_ITEM,
    quality: 'epic',
    format: params.format,
    startCents: params.startCents,
    reserveCents: params.reserveCents,
    buyNowCents: params.buyNowCents,
    offerNext: params.offerNext,
    status: 'active',
    resolution: null,
    itemDisposed: false,
    soldCents: null,
    currentBidCents: null,
    currentBidId: null,
    endsAtMs: h.now() + 24 * HOUR_MS,
    baseEndsAtMs: h.now() + 24 * HOUR_MS,
    buyNowLockAccount: null,
    buyNowLockExpiresMs: null,
    createdAtMs: h.now(),
    cancelRequestedAtMs: null,
  });
  const inserted = { ok: true as const, id: listingId };
  const settlement = await h.db.insertSettlement({
    listingId: inserted.id,
    bidId: null,
    attempt: 0,
    buyerAccount: BUYER_A,
    buyerCharacter: CHAR_A,
    buyerName: 'Aldan',
    buyerWallet: 'wallet-a',
    amountCents: 5000,
    deadlineAtMs: h.now() + HOUR_MS,
    nowMs: h.now(),
  });
  if (typeof settlement === 'string') throw new Error(`residue settlement refused: ${settlement}`);
  expect(await h.db.transitionSettlement(settlement.id, ['offered'], 'delivered')).toBe(true);
  return { listingId: inserted.id };
}

/** The readout an operator actually gets: a cutoff BEHIND now by the stuck
 *  horizon. A cutoff in the FUTURE (now + 1) satisfies the age predicate for
 *  every row, so it would stay green over an age column the park rotation
 *  re-stamped, which is the exact defect this group exists to catch. */
function stuckReadout(h: Harness) {
  return h.db.stuckCustodyReadout(REALM, h.now() - STUCK_HORIZON_MS, 10, 1000, 0);
}

/** Sweep once a minute until more than the stuck horizon has passed, which is
 *  what a permanently parked row really lives through before anyone looks. */
async function rotatePastStuckHorizon(h: Harness): Promise<void> {
  const start = h.now();
  while (h.now() - start <= STUCK_HORIZON_MS) {
    h.setNow(h.now() + PAST_BACKOFF_MS);
    await h.service.sweepPass();
  }
}

/** Stage a return that can never proceed: a claim already attributed to the
 *  grant rail refuses the return rail forever, so the backlog parks it on
 *  every pass. Returns the suspended listing. */
async function parkedReturn(h: Harness): Promise<WocListingRow> {
  const listing = await listEpic(h);
  const ref = listingReturnCustodyRef(listing.id);
  expect(await h.db.claimCustodyRef(REALM, ref)).toBe(true);
  expect(await h.db.markCustodyGrantIntent(ref, CHAR_A)).toBe(true);
  expect(await h.service.adminSuspendListing(listing.id)).toEqual({ ok: true });
  return listing;
}

describe('a parked row rotates to the batch tail without hiding from the monitor', () => {
  it('keeps a parked RETURN visible in the readout across ten minutes of rotations', async () => {
    // The rotation column and the age column are deliberately different
    // columns. Rotating the AGE column instead re-stamped every parked row once
    // a minute against a ten-minute threshold, so the operator queue read empty
    // forever precisely while nothing was being delivered.
    const h = makeHarness();
    const listing = await parkedReturn(h);
    await rotatePastStuckHorizon(h);
    const readout = await stuckReadout(h);
    expect(readout.undisposedListings.count, 'still standing, still visible').toBe(1);
    expect(readout.undisposedListings.sample[0]?.id).toBe(listing.id);
    expect((await getListing(h, listing.id)).itemDisposed, 'and nothing was disposed').toBe(false);
    expect(h.custody.persistCalls, 'and nothing was ever mailed').toHaveLength(0);
  });

  it('keeps a parked DELIVERY visible in the readout across ten minutes of rotations', async () => {
    // The delivering twin, aged on the updated_at stamped when the row entered
    // 'delivering'. Same hazard, same proof.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    h.db.failNextDeliveredSave = 'lease_lost';
    const { listingId } = await directedSale(h, 'sig-rotate-delivery-1');
    const settlementId = (await liveSettlement(h, listingId)).id;
    await rotatePastStuckHorizon(h);
    const readout = await stuckReadout(h);
    expect(readout.stuckDelivering.count).toBe(1);
    expect(readout.stuckDelivering.sample[0]?.id).toBe(settlementId);
    expect(
      h.custody.parcels.filter((p) => p.letter === 'delivery'),
      'a fenced grant is never mailed over',
    ).toHaveLength(0);
  });

  it('counts park EVENTS as work, and counts a backoff skip as none', async () => {
    const h = makeHarness();
    await parkedReturn(h);
    const parking = await h.service.sweepPass();
    // A pass that parks everything used to score zero on every arm and read as
    // idle exactly when the marketplace was wedged.
    expect(parking?.returned, 'a parked row is not a returned row').toBe(0);
    expect(parking?.parked).toBe(1);
    // The very next pass is inside the backoff window: nothing NEW parked, so a
    // standing parked set cannot flood the saturation warning either.
    const skipping = await h.service.sweepPass();
    expect(skipping?.parked).toBe(0);
    expect(skipping?.returned).toBe(0);
  });

  it('rotates a parked RETURN once and then EXCLUDES it from the backlog read', async () => {
    // The starvation half: a parked row must neither own the head of every
    // batch (the rotation moves it to the tail) nor keep costing batch slots
    // and writes while it waits out its backoff (the read excludes it).
    const h = makeHarness();
    const listing = await parkedReturn(h);
    const rotations: number[] = [];
    const rotate = h.db.touchListingRow.bind(h.db);
    h.db.touchListingRow = async (id) => {
      rotations.push(id);
      await rotate(id);
    };
    const reads: number[][] = [];
    const backlog = h.db.undisposedClosedListings.bind(h.db);
    h.db.undisposedClosedListings = async (realm, limit, excludeIds) => {
      reads.push([...excludeIds]);
      return backlog(realm, limit, excludeIds);
    };
    await h.service.sweepPass();
    expect(rotations, 'the park rotates ONCE').toEqual([listing.id]);
    expect(reads[0], 'nothing was excluded before the park').toEqual([]);
    await h.service.sweepPass();
    expect(rotations, 'the backoff window costs no further writes').toEqual([listing.id]);
    expect(reads[1], 'the backing-off row is excluded from the read').toEqual([listing.id]);
  });

  it('rotates a parked DELIVERY once and then EXCLUDES it from the reconcile read', async () => {
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    h.db.failNextDeliveredSave = 'lease_lost';
    const { listingId } = await directedSale(h, 'sig-rotate-spy-1');
    const settlementId = (await liveSettlement(h, listingId)).id;
    const rotations: number[] = [];
    const rotate = h.db.touchSettlementRow.bind(h.db);
    h.db.touchSettlementRow = async (id) => {
      rotations.push(id);
      await rotate(id);
    };
    const reads: number[][] = [];
    const stuck = h.db.deliveringSettlements.bind(h.db);
    h.db.deliveringSettlements = async (realm, limit, excludeIds) => {
      reads.push([...excludeIds]);
      return stuck(realm, limit, excludeIds);
    };
    h.setNow(h.now() + PAST_BACKOFF_MS);
    const parking = await h.service.sweepPass();
    expect(rotations).toEqual([settlementId]);
    expect(parking?.reconciled, 'a parked delivery is not a reconciled one').toBe(0);
    expect(parking?.parked).toBe(1);
    const skipping = await h.service.sweepPass();
    expect(rotations, 'the backoff window costs no further writes').toEqual([settlementId]);
    expect(reads[1], 'the backing-off row is excluded from the read').toEqual([settlementId]);
    expect(skipping?.parked, 'a skip is not a new park event').toBe(0);
  });
});

describe('the residue beats converge over bounded, resumable pages', () => {
  it('finalizes at most one batch per beat and resumes behind the last row it took', async () => {
    // Every converged row costs a finalize transaction plus a realm mail-book
    // write on the shared serial writer, and the one moment residue is
    // plentiful (the first boot after a legacy upgrade) is exactly when the
    // realm can least absorb an unbounded burst.
    const h = makeHarness();
    const listingIds: number[] = [];
    for (let i = 0; i < 27; i++) listingIds.push((await seedDeliveredResidue(h)).listingId);
    const first = await h.service.sweepPass();
    expect(first?.redriven, 'one batch, never the whole backlog').toBe(25);
    // The truncated page's cursor sits on the last RETURNED row, so the two it
    // could not reach are the very next beat's work rather than waiting out a
    // full cursor wrap.
    h.setNow(h.now() + PAST_BACKOFF_MS);
    const second = await h.service.sweepPass();
    expect(second?.redriven).toBe(2);
    for (const id of listingIds) {
      const listing = await getListing(h, id);
      expect(listing.status, `listing ${id} converged`).toBe('closed');
      expect(listing.resolution).toBe('sold');
      expect(listing.itemDisposed).toBe(true);
    }
  });

  it('never re-notifies a seller once the residue beat converged its sale', async () => {
    // 'already_final' exists so a converged tail is neither re-counted nor
    // re-mailed. The notice is item-free, but a seller who read and deleted it
    // would still watch it re-appear on every beat.
    const h = makeHarness();
    const { listingId } = await seedDeliveredResidue(h);
    const noticeRef = listingSoldNoticeCustodyRef(listingId);
    const first = await h.service.sweepPass();
    expect(first?.redriven).toBe(1);
    expect(
      h.custody.persistCalls.filter((r) => r === noticeRef),
      'the seller hears exactly once',
    ).toHaveLength(1);
    // The seller reads it and deletes the emptied letter, so the in-book marker
    // is gone: nothing but the beat's own honesty stops a second one.
    h.custody.collect(noticeRef);
    h.setNow(h.now() + PAST_BACKOFF_MS);
    const second = await h.service.sweepPass();
    expect(second?.redriven, 'a beat that really ran, and found nothing left').toBe(0);
    expect(h.custody.persistCalls.filter((r) => r === noticeRef)).toHaveLength(1);
    expect(h.custody.parcels.filter((p) => p.custodyRef === noticeRef)).toHaveLength(0);
  });
});

describe('one contended finalize stops every later delivery arm from claiming', () => {
  it('leaves a confirmed settlement unclaimed when the residue beat hit contention first', async () => {
    // The claim UPDATE moves rows into 'delivering'. Claiming a batch this pass
    // will not deliver only feeds the stuck-delivering readout for nothing, so
    // the check has to happen BEFORE the claim rather than inside the loop.
    const h = makeHarness();
    putBuyerOnline(h);
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlementId = await confirmedAwaitingDelivery(h, listing.id);
    await seedDeliveredResidue(h);
    // Past the beat gate, so the residue arm (which runs BEFORE the delivery
    // arms) really reaches its finalize and really contends.
    h.setNow(h.now() + PAST_BACKOFF_MS);
    h.db.failNextFinalize = 'contended';
    const stats = await h.service.sweepPass();
    expect(stats?.redriven).toBe(0);
    expect(stats?.delivered).toBe(0);
    expect(stats?.reconciled).toBe(0);
    expect((await getSettlement(h, settlementId)).state, 'never claimed').toBe('confirmed');
    // The next pass, with nothing contending, claims and delivers.
    h.setNow(h.now() + PAST_BACKOFF_MS);
    const converge = await h.service.sweepPass();
    expect(converge?.delivered).toBe(1);
    // The residue waits one beat longer BY DESIGN: the contended beat had
    // already advanced its cursor past the page it broke on, so that page comes
    // back around only when the cursor wraps. Slower than the beat interval on
    // a contended cycle, and still convergent.
    expect(converge?.redriven, 'the cursor sits past the broken page').toBe(0);
    h.setNow(h.now() + PAST_BACKOFF_MS);
    expect((await h.service.sweepPass())?.redriven, 'and wraps on the beat after').toBe(1);
  });

  it('clears the contention flag at the eager confirm entry, which runs outside any pass', async () => {
    // The flag is pass-scoped but confirmSettlement is not: a true left over
    // from the previous pass would silently claim-and-drop the buyer who just
    // paid, and the sweep would only pick it up a beat later.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    await seedDeliveredResidue(h);
    h.db.failNextFinalize = 'contended';
    const contended = await h.service.sweepPass();
    expect(contended?.redriven, 'the pass really ended contended').toBe(0);
    const { listingId } = await directedSale(h, 'sig-eager-reset-1');
    expect(
      (await h.db.listingById(REALM, listingId))?.status,
      'the buyer gets their item in the same breath',
    ).toBe('closed');
    expect(bagsOf(h, CHAR_A).map((s) => s.itemId)).toContain(EPIC_ITEM);
  });

  it('reports a settlement that vanished mid-delivery rather than skipping it in silence', async () => {
    // A 'stale' finalize AFTER custody was booked means the row left the shape
    // only a hand edit can produce. It is invisible to every monitor class, so
    // the one pass that saw it is the only chance anyone has to hear about it.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    h.db.failNextFinalize = 'contended';
    const { listingId } = await directedSale(h, 'sig-vanish-1');
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
    h.db.failNextFinalize = 'stale';
    await h.service.sweepPass();
    const vanished = h.sweepErrors.filter(([, err]) =>
      String(err).includes('vanished mid-delivery'),
    );
    expect(vanished, 'reported once, by the arm that saw it').toHaveLength(1);
    expect(vanished[0]?.[0]).toBe('reconciled');
    // The skip CLEARS the park entry instead of backing the row off: on the
    // same clock the next pass looks again rather than waiting out a minute.
    h.db.failNextFinalize = 'stale';
    await h.service.sweepPass();
    expect(
      h.sweepErrors.filter(([, err]) => String(err).includes('vanished mid-delivery')),
    ).toHaveLength(2);
  });
});

describe('an unprovable hand-off parks instead of mailing a second copy', () => {
  it('PARKS an AMBIGUOUS grant refusal, which is not a refusal at all', async () => {
    // grantCopy declining cleanly (offline, full bags) proves the bags are
    // untouched and mail is safe. 'ambiguous' proves the opposite: the copy
    // reached the live bags and an ordinary teardown flush may still persist it,
    // so mailing here is the second copy.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    h.custody.failNextGrantAmbiguous = true;
    const { listingId } = await directedSale(h, 'sig-ambiguous-1');
    const ref = settlementCustodyRef((await liveSettlement(h, listingId)).id);
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
    expect(h.custody.parcels, 'never converts an ambiguous grant to mail').toHaveLength(0);
    expect(h.db.custodyClaims.get(ref)?.grantCharacterId, 'the claim keeps its rail').toBe(CHAR_A);
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBeNull();
    // With the hook off it STILL parks: grantCopy refused before any
    // pendingGrants entry existed, so this process has no session memory to
    // resume from and only an operator can attribute the copy.
    for (let i = 0; i < 2; i++) {
      h.setNow(h.now() + PAST_BACKOFF_MS);
      await h.service.sweepPass();
    }
    expect(h.custody.parcels).toHaveLength(0);
    expect(h.custody.grantCalls, 'and never grants a second time').toBe(1);
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
    expect(await h.db.strikeInfo(BUYER_A), 'the buyer did nothing wrong').toBeNull();
    await rotatePastStuckHorizon(h);
    const readout = await stuckReadout(h);
    expect(readout.unbookedClaims.count, 'visible to the operator').toBe(1);
    expect(readout.unbookedClaims.sample[0]).toMatchObject({
      custodyRef: ref,
      grantCharacterId: CHAR_A,
      mailIntent: false,
    });
  });

  it('PARKS a busy FIFO grant persist and resumes it next pass (the closed carve-out)', async () => {
    // The head-of-line bound the write-path rider shipped with the FIFO
    // close: a wedged buyer save queue answers 'busy' from the bounded
    // custody entry with nothing serialized or written, the row parks with
    // its claim, grant intent, and ledger entry intact, and the NEXT pass
    // resumes the SAME session's grant through a snapshot, never a second
    // grantCopy and never the mail rail.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    const before = bagsOf(h, CHAR_A).length;
    h.custody.failNextGrantBusy = true;
    const { listingId } = await directedSale(h, 'sig-busy-1');
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
    // The grant reached the live bags; the persist never ran.
    expect(bagsOf(h, CHAR_A)).toHaveLength(before + 1);
    expect(h.custody.grantRuns, 'the FIFO entry was asked exactly once').toHaveLength(1);
    expect(h.custody.parcels, 'a busy persist never falls through to mail').toHaveLength(0);
    h.setNow(h.now() + PAST_BACKOFF_MS);
    await h.service.sweepPass();
    expect(h.custody.grantCalls, 'granted once; the retry was a snapshot').toBe(1);
    expect(h.custody.grantRuns.length).toBeGreaterThanOrEqual(2);
    expect(bagsOf(h, CHAR_A), 'still exactly one copy').toHaveLength(before + 1);
    expect((await h.db.listingById(REALM, listingId))?.status).toBe('closed');
  });

  it('refreshes a provable resume on every attempt, so long contention cannot expire it', async () => {
    // The proof of resumability is the session identity plus its nonce, not the
    // ledger entry's age: without the refresh, a slow-database incident longer
    // than the ledger horizon turned a still-live, still-provable retry into a
    // permanent operator-only park.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    const before = bagsOf(h, CHAR_A).length;
    h.db.failNextDeliveredSave = 'throw';
    const { listingId } = await directedSale(h, 'sig-sustained-1');
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
    for (let i = 0; i < 11; i++) {
      h.setNow(h.now() + PAST_BACKOFF_MS);
      h.db.failNextDeliveredSave = 'throw';
      await h.service.sweepPass();
    }
    // Eleven minutes later the database comes back.
    h.setNow(h.now() + PAST_BACKOFF_MS);
    await h.service.sweepPass();
    expect(bagsOf(h, CHAR_A), 'one copy, delivered by the resume').toHaveLength(before + 1);
    expect(h.custody.grantCalls, 'granted once; every retry was a snapshot').toBe(1);
    expect(h.custody.parcels.filter((p) => p.letter === 'delivery')).toHaveLength(0);
    expect((await h.db.listingById(REALM, listingId))?.status).toBe('closed');
  });

  it('PARKS a resume whose session memory aged out of the local ledger', async () => {
    // The other side of the same ledger rule. A process that kept losing the
    // sweep lock makes no attempts at all, so nothing refreshes the entry and
    // the horizon prunes it; from then on the retry is unprovable and parks.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    h.db.failNextDeliveredSave = 'throw';
    const { listingId } = await directedSale(h, 'sig-pruned-1');
    const ref = settlementCustodyRef((await liveSettlement(h, listingId)).id);
    h.setNow(h.now() + 11 * 60_000);
    await h.service.sweepPass();
    expect(h.custody.parcels, 'never mails over a grant intent').toHaveLength(0);
    expect(h.custody.grantCalls).toBe(1);
    expect((await liveSettlement(h, listingId)).state).toBe('delivering');
    expect(h.db.custodyClaims.get(ref)?.bookedAtMs).toBeNull();
    const readout = await stuckReadout(h);
    expect(readout.unbookedClaims.sample[0]).toMatchObject({
      custodyRef: ref,
      grantCharacterId: CHAR_A,
    });
  });
});

describe('the seller notice can fail or be lost without touching the sale', () => {
  it('reports a failed notice under its own tag and still finishes the delivery', async () => {
    // A directed hand-off writes NO delivery parcel, so the only persist in this
    // flow is the notice: this is the blob half failing after the letter already
    // entered the live book, and the delivery must not care.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    h.custody.failNextPersist = true;
    const { listingId } = await directedSale(h, 'sig-notice-fail-1');
    const listing = await getListing(h, listingId);
    expect(listing.status, 'the sale is finished regardless').toBe('closed');
    expect(listing.resolution).toBe('sold');
    expect(await h.db.salesForItem(REALM, EPIC_ITEM, 10)).toHaveLength(1);
    expect(
      h.sweepErrors.map(([arm]) => arm),
      'tagged apart from the delivery arms, so an operator can tell WHERE it failed',
    ).toContain('deliver_notice');
    expect(
      bagsOf(h, CHAR_A).map((s) => s.itemId),
      'the buyer has their item',
    ).toContain(EPIC_ITEM);
  });

  it('loses the notice for good when a crash lands between the finalize and the letter', async () => {
    // Pins the ACCEPTED loss rather than leaving it to be re-discovered: no arm
    // re-notifies, so this seller never hears about the sale. The letter is
    // item-free and the sale itself is durable, which is what makes it
    // acceptable; a silent regression into item loss would not be.
    const h = twoEpics(makeHarness());
    putBuyerOnline(h);
    h.db.failNextFinalize = 'contended';
    const { listingId } = await directedSale(h, 'sig-notice-loss-1');
    const settlement = await liveSettlement(h, listingId);
    expect(
      await h.db.finalizeDeliveredSettlement({
        settlementId: settlement.id,
        listingId,
        bidId: settlement.bidId,
        sale: {
          realm: REALM,
          listingId,
          itemId: EPIC_ITEM,
          item: { itemId: EPIC_ITEM, count: 1 },
          priceCents: settlement.amountCents,
          amountBase: null,
          sellerAccount: SELLER,
          buyerAccount: BUYER_A,
          sellerName: 'Selara',
          buyerName: 'Aldan',
        },
      }),
      'the close tail commits, then the process dies before the notice',
    ).toBe('finalized');
    const noticeRef = listingSoldNoticeCustodyRef(listingId);
    for (let i = 0; i < 3; i++) {
      h.setNow(h.now() + PAST_BACKOFF_MS);
      await h.service.sweepPass();
    }
    expect(
      h.custody.persistCalls.filter((r) => r === noticeRef),
      'nothing ever re-notifies',
    ).toHaveLength(0);
    const listing = await getListing(h, listingId);
    expect(listing.status).toBe('closed');
    expect(listing.resolution).toBe('sold');
    expect(listing.itemDisposed).toBe(true);
    expect((await getSettlement(h, settlement.id)).state).toBe('delivered');
    expect(
      await h.db.salesForItem(REALM, EPIC_ITEM, 10),
      'exactly one sale, unharmed',
    ).toHaveLength(1);
  });
});

/** Service bond-quote intent builders, shared by the contract and the bounds
 *  describes below (the second copy was the rule-of-three tell). */
const okIntent = (over: Partial<WocQuoteIntent>): WocQuoteIntent => ({
  ok: true,
  reference: 'WMB_svc',
  transactionBase64: null,
  signatureRequired: true,
  amount: null,
  seller: null,
  burn: null,
  treasury: null,
  bondCents: null,
  expiresAtMs: 0,
  reason: null,
  ...over,
});
const refusedIntent = (over: Partial<WocQuoteIntent>): WocQuoteIntent => ({
  ok: false,
  reference: null,
  transactionBase64: null,
  signatureRequired: true,
  amount: null,
  seller: null,
  burn: null,
  treasury: null,
  bondCents: null,
  expiresAtMs: null,
  reason: 'refused',
  ...over,
});

describe('the service-owned bond quote contract', () => {
  type BondQuoteArgs = {
    memoRef: string;
    bidCents: number;
    usdCents?: number;
    buyerWallet: string;
  };

  it('placeBid sends the BID and adopts the service bondCents everywhere', async () => {
    // The service computes the bond from the bid (ceil bps, clamped); the
    // game's local figure only sizes the balance guard. Whatever the quote
    // answers is what the row, the response bid, and the intent all carry.
    const h = makeHarness();
    const listing = await listEpic(h);
    const calls: BondQuoteArgs[] = [];
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async (args) => {
          calls.push(args);
          return okIntent({ bondCents: 321, expiresAtMs: h.now() + 60_000 });
        },
      },
    });
    const placed = unwrap(
      await svc.placeBid({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
        acceptTerms: true,
      }),
      'placeBid',
    );
    // No echo on the FIRST quote: nothing has been shown for this bid yet.
    expect(calls).toEqual([
      { memoRef: `woc_bond:${placed.bid.id}`, bidCents: 5000, buyerWallet: 'wallet-a' },
    ]);
    expect(placed.bid.bondCents, 'the response bid carries the adopted figure').toBe(321);
    expect(placed.bond.bondCents, 'and the intent shows the service figure').toBe(321);
    const row = await getBid(h, placed.bid.id);
    expect(row.bondCents, 'persisted on the row').toBe(321);
    // The response bid mirrors the WHOLE row the CAS wrote: a stale quote
    // expiry invites a consumer to cache "no live quote" for a bid with one.
    expect(placed.bid.bondQuoteExpiresAtMs).toBe(row.bondQuoteExpiresAtMs);
    expect(placed.bid.bondQuoteExpiresAtMs).toBe(placed.bond.expiresAtMs);
  });

  it('refreshBondQuote echoes the stored figure and adopts through a drift refusal', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const storedBond = (await getBid(h, placed.bid.id)).bondCents;
    const calls: BondQuoteArgs[] = [];
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async (args) => {
          calls.push(args);
          if (args.usdCents !== 279) {
            return refusedIntent({ reason: 'bond_amount_drift', bondCents: 279 });
          }
          return okIntent({
            reference: 'WMB_fresh',
            bondCents: 279,
            expiresAtMs: h.now() + 60_000,
          });
        },
      },
    });
    const out = unwrap(await svc.refreshBondQuote(BUYER_A, placed.bid.id), 'refreshBondQuote');
    // One drift round trip, then exactly one re-quote with the ADOPTED echo.
    expect(calls.map((c) => ({ bid: c.bidCents, echo: c.usdCents }))).toEqual([
      { bid: 5000, echo: storedBond },
      { bid: 5000, echo: 279 },
    ]);
    expect(out.bond.bondCents).toBe(279);
    const after = await getBid(h, placed.bid.id);
    expect(after.bondCents, 'the row adopts the re-priced bond').toBe(279);
    expect(after.bondReference).toBe('WMB_fresh');
  });

  it('a drift refusal carrying NO figure refuses quote_unavailable after one call', async () => {
    // Nothing to adopt means nothing to retry with: a blind second quote
    // would spin on the same refusal.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    let callCount = 0;
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async () => {
          callCount++;
          return refusedIntent({ reason: 'bond_amount_drift', bondCents: null });
        },
      },
    });
    expect(await svc.refreshBondQuote(BUYER_A, placed.bid.id)).toEqual({
      ok: false,
      reason: 'quote_unavailable',
    });
    expect(callCount).toBe(1);
  });

  it('the dev economy mirrors the contract: ceil bond from the bid, drift on a stale echo', async () => {
    const economy = createDevWocMarketEconomy(() => BASE_MS);
    // ceil(2001 * 5%) = 101 where round gave 100: the half-cent boundary.
    const fresh = await economy.bondQuote({
      memoRef: 'woc_bond:1',
      bidCents: 2001,
      buyerWallet: 'w',
    });
    expect(fresh.ok).toBe(true);
    expect(fresh.bondCents).toBe(101);
    const drift = await economy.bondQuote({
      memoRef: 'woc_bond:1',
      bidCents: 2001,
      usdCents: 100,
      buyerWallet: 'w',
    });
    expect(drift.ok).toBe(false);
    expect(drift.reason).toBe('bond_amount_drift');
    expect(drift.bondCents, 'the refusal carries the figure to adopt').toBe(101);
    const echoed = await economy.bondQuote({
      memoRef: 'woc_bond:1',
      bidCents: 2001,
      usdCents: 101,
      buyerWallet: 'w',
    });
    expect(echoed.ok).toBe(true);
    expect(echoed.bondCents).toBe(101);
  });
});

describe('reference-keyed tolerance: one memoRef can hold two settled service quotes', () => {
  // The service's entry adoption can re-settle a superseded quote beside the
  // fresh one under a single memoRef, so the game must key every ask on the
  // stored REFERENCE and never treat the memo as a settlement identity. The
  // bond leg is structurally safe (its re-quote CAS refuses once a signature
  // exists, so a paid pair can never be retired); the settlement leg CAN
  // retire a pair on a failed-row revival, and owes the operator trace this
  // pins.
  it('a revival re-quote retires the old pair with a trace and asks only about the fresh reference', async () => {
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    let quoteN = 0;
    const confirmAsked: string[] = [];
    const verdict = { settled: false, pending: false, reason: 'leg_mismatch' as string | null };
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        settlementQuote: async () => ({
          ok: true,
          reference: `WMS_r${++quoteN}`,
          transactionBase64: 'dHg=',
          signatureRequired: true,
          amount: { base: '1', tokens: 1 },
          seller: null,
          burn: null,
          treasury: null,
          bondCents: null,
          expiresAtMs: h.now() + 60_000,
          reason: null,
        }),
        confirm: async (reference) => {
          confirmAsked.push(reference);
          return { settled: verdict.settled, pending: verdict.pending, reason: verdict.reason };
        },
      },
    });
    const bought = unwrap(
      await scripted.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    expect(bought.quote.reference).toBe('WMS_r1');
    // The payment against the FIRST reference is terminally refused: the row
    // goes failed carrying that pair.
    expect(await scripted.confirmSettlement(BUYER_A, bought.settlement.id, 'sig-old')).toEqual({
      ok: false,
      reason: 'confirm_failed',
    });
    // Revival mints a second quote under the SAME memo. The retired pair is
    // traced (it is the only durable game-side record of it: the service may
    // later adopt that quote settled if the payment was real).
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
    try {
      const revived = unwrap(
        await scripted.settlementQuote(BUYER_A, bought.settlement.id),
        'settlementQuote',
      );
      expect(revived.quote.reference).toBe('WMS_r2');
      const trace = warned.find((w) => w.includes('retires quote reference'));
      expect(trace, 'the retired pair is traced').toBeDefined();
      expect(trace).toContain('WMS_r1');
      expect(trace).toContain('sig-old');
      // Every later ask uses the STORED reference, which is now the fresh
      // one; the retired sibling is the service's to account for.
      verdict.settled = true;
      verdict.pending = false;
      verdict.reason = null;
      confirmAsked.length = 0;
      const out = await scripted.confirmSettlement(BUYER_A, bought.settlement.id, 'sig-new');
      expect(out.ok).toBe(true);
      expect(confirmAsked).toEqual(['WMS_r2']);
    } finally {
      spy.mockRestore();
    }
  });

  it('a lost quote CAS traces NO retirement: the line fires only after the write lands', async () => {
    // The trace is reconciliation evidence; emitted before the guarded write
    // it can claim a retirement a racing confirm prevented, falsifying the
    // exact trail it exists to keep truthful.
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    let quoteN = 0;
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        settlementQuote: async () => ({
          ok: true,
          reference: `WMS_c${++quoteN}`,
          transactionBase64: 'dHg=',
          signatureRequired: true,
          amount: { base: '1', tokens: 1 },
          seller: null,
          burn: null,
          treasury: null,
          bondCents: null,
          expiresAtMs: h.now() + 60_000,
          reason: null,
        }),
        confirm: async () => ({ settled: false, pending: false, reason: 'leg_mismatch' }),
      },
    });
    const bought = unwrap(
      await scripted.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    expect(await scripted.confirmSettlement(BUYER_A, bought.settlement.id, 'sig-cas')).toEqual({
      ok: false,
      reason: 'confirm_failed',
    });
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
    const cas = vi.spyOn(h.db, 'setSettlementQuote').mockResolvedValueOnce(false);
    try {
      expect(await scripted.settlementQuote(BUYER_A, bought.settlement.id)).toEqual({
        ok: false,
        reason: 'quote_unavailable',
      });
      expect(
        warned.find((w) => w.includes('retires quote reference')),
        'no retirement happened, so nothing may claim one',
      ).toBeUndefined();
    } finally {
      cas.mockRestore();
      spy.mockRestore();
    }
  });

  it('an UNSIGNED re-quote traces nothing: the trace is scoped to retired pairs', async () => {
    // Re-quoting an offered row with no recorded signature is the routine
    // quote-refresh path; a trace per refresh would be noise. Only a retired
    // reference a payment may exist against (a recorded signature) earns the
    // operator line.
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    let quoteN = 0;
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        settlementQuote: async () => ({
          ok: true,
          reference: `WMS_u${++quoteN}`,
          transactionBase64: 'dHg=',
          signatureRequired: true,
          amount: { base: '1', tokens: 1 },
          seller: null,
          burn: null,
          treasury: null,
          bondCents: null,
          expiresAtMs: h.now() + 60_000,
          reason: null,
        }),
      },
    });
    const bought = unwrap(
      await scripted.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
    try {
      const requoted = unwrap(
        await scripted.settlementQuote(BUYER_A, bought.settlement.id),
        'settlementQuote',
      );
      expect(requoted.quote.reference).toBe('WMS_u2');
      expect(warned.filter((w) => w.includes('retires quote reference'))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('a first quote on a fresh settlement traces nothing', async () => {
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
    try {
      const h = makeHarness();
      const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
      unwrap(
        await h.service.buyNow({
          account: BUYER_A,
          characterId: CHAR_A,
          listingId: listing.id,
          acceptTerms: true,
        }),
        'buyNow',
      );
      expect(warned.filter((w) => w.includes('retires quote reference'))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('bond adoption bounds and fallbacks (the review round pins)', () => {
  const okIntent2 = (over: Partial<WocQuoteIntent>): WocQuoteIntent =>
    okIntent({ reference: 'WMB_svc2', ...over });
  const refusedIntent2 = refusedIntent;

  async function placedWithAdopted(
    h: Harness,
    listingId: number,
    bondCents: number,
  ): Promise<number> {
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async () => okIntent2({ bondCents, expiresAtMs: h.now() + 60_000 }),
      },
    });
    const placed = unwrap(
      await svc.placeBid({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId,
        amountCents: 5000,
        acceptTerms: true,
      }),
      'placeBid',
    );
    return placed.bid.id;
  }

  it('placeBid refuses a carried figure outside the contract, persisting nothing', async () => {
    // A figure above the bid (or junk) is not adopted into money accounting:
    // the quote is refused and the unpaid bid lapses on its TTL.
    const h = makeHarness();
    const listing = await listEpic(h);
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async () => okIntent2({ bondCents: 999_999, expiresAtMs: h.now() + 60_000 }),
      },
    });
    expect(
      await svc.placeBid({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
        acceptTerms: true,
      }),
    ).toEqual({ ok: false, reason: 'quote_unavailable' });
  });

  it('placeBid falls back to the mirror when an older service sends no figure', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async () => okIntent2({ bondCents: null, expiresAtMs: h.now() + 60_000 }),
      },
    });
    const placed = unwrap(
      await svc.placeBid({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
        acceptTerms: true,
      }),
      'placeBid',
    );
    expect(placed.bid.bondCents, 'the ceil mirror of 5000 at 500 bps').toBe(250);
    expect((await getBid(h, placed.bid.id)).bondCents).toBe(250);
  });

  it('placeBid re-guards the balance when the adopted figure exceeds the mirror', async () => {
    // The first guard was sized with the mirror; a service that prices the
    // bond higher must not send the player to a wallet prompt the guarded
    // balance cannot cover.
    const h = makeHarness();
    const listing = await listEpic(h);
    // 5000 + mirror 250 = 5250 cents -> 52_500 dev tokens; 5000 + adopted
    // 4000 = 9000 cents -> 90_000 tokens. 60_000 passes the first, fails the
    // second.
    h.balances.set('wallet-a', 60_000);
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async () => okIntent2({ bondCents: 4000, expiresAtMs: h.now() + 60_000 }),
      },
    });
    expect(
      await svc.placeBid({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
        acceptTerms: true,
      }),
    ).toEqual({ ok: false, reason: 'insufficient_balance' });
    // The refresh twin's rule holds here too: nothing was persisted from the
    // refused quote. The pending row keeps its insert-time mirror figure and
    // no bond reference, and lapses on its own TTL.
    const refused = (await h.db.bidsForListing(listing.id)).find((b) => b.account === BUYER_A);
    expect(refused?.bondReference, 'no quote reference was persisted').toBeNull();
    expect(refused?.bondCents, 'the row keeps the insert-time mirror figure').toBe(250);
  });

  it('refresh echoes the STORED service figure, not a local recomputation', async () => {
    // The stored figure (321) is unreachable from the mirror (250 for this
    // bid), so a regression to a locally recomputed echo cannot pass.
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidId = await placedWithAdopted(h, listing.id, 321);
    expect((await getBid(h, bidId)).bondCents).toBe(321);
    const echoes: (number | undefined)[] = [];
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async (args) => {
          echoes.push(args.usdCents);
          return okIntent2({ bondCents: 321, expiresAtMs: h.now() + 60_000 });
        },
      },
    });
    unwrap(await svc.refreshBondQuote(BUYER_A, bidId), 'refreshBondQuote');
    expect(echoes).toEqual([321]);
  });

  it('refresh bounds the drift retry at ONE: a service that always drifts refuses', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidId = await placedWithAdopted(h, listing.id, 250);
    let calls = 0;
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async () => {
          calls++;
          return refusedIntent2({ reason: 'bond_amount_drift', bondCents: 260 });
        },
      },
    });
    expect(await svc.refreshBondQuote(BUYER_A, bidId)).toEqual({
      ok: false,
      reason: 'quote_unavailable',
    });
    expect(calls, 'the initial quote plus exactly one adopted retry').toBe(2);
  });

  it('refresh skips the echo entirely for an out-of-bounds drift figure', async () => {
    // A carried figure the game would never adopt is not worth an outbound
    // round trip (and a non-proxy economy may not have screened the wire
    // integer at all): one call, then the refusal.
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidId = await placedWithAdopted(h, listing.id, 250);
    let calls = 0;
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async () => {
          calls++;
          return refusedIntent2({ reason: 'bond_amount_drift', bondCents: 999_999 });
        },
      },
    });
    expect(await svc.refreshBondQuote(BUYER_A, bidId)).toEqual({
      ok: false,
      reason: 'quote_unavailable',
    });
    expect(calls, 'no echo of a figure the bounds already refuse').toBe(1);
  });

  it('refresh re-guards the balance when the re-priced bond exceeds the stored figure', async () => {
    // The placeBid symmetry: the drift-adopt path can raise the bond, and
    // the prompt labels itself from this quote, so the guarded balance must
    // cover the figure the wallet is about to be asked for.
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidId = await placedWithAdopted(h, listing.id, 250);
    // 5000 + stored 250 = 5250 cents -> 52_500 dev tokens (passes at 60_000);
    // 5000 + re-priced 4000 = 9000 cents -> 90_000 tokens (fails).
    h.balances.set('wallet-a', 60_000);
    let first = true;
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async () => {
          if (first) {
            first = false;
            return refusedIntent2({ reason: 'bond_amount_drift', bondCents: 4000 });
          }
          return okIntent2({ bondCents: 4000, expiresAtMs: h.now() + 60_000 });
        },
      },
    });
    expect(await svc.refreshBondQuote(BUYER_A, bidId)).toEqual({
      ok: false,
      reason: 'insufficient_balance',
    });
    expect((await getBid(h, bidId)).bondCents, 'nothing was persisted').toBe(250);
  });

  it('refresh refuses a post-drift success that carries NO figure', async () => {
    // The service just declared the stored figure wrong; succeeding without
    // saying the right one must not silently keep the refuted number.
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidId = await placedWithAdopted(h, listing.id, 250);
    let first = true;
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async () => {
          if (first) {
            first = false;
            return refusedIntent2({ reason: 'bond_amount_drift', bondCents: 260 });
          }
          return okIntent2({ bondCents: null, expiresAtMs: h.now() + 60_000 });
        },
      },
    });
    expect(await svc.refreshBondQuote(BUYER_A, bidId)).toEqual({
      ok: false,
      reason: 'quote_unavailable',
    });
    expect((await getBid(h, bidId)).bondCents, 'the stored figure is untouched').toBe(250);
  });

  it('refresh keeps the stored figure when a PLAIN success omits one (older service)', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidId = await placedWithAdopted(h, listing.id, 321);
    const svc = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        bondQuote: async () =>
          okIntent2({ reference: 'WMB_plain', bondCents: null, expiresAtMs: h.now() + 60_000 }),
      },
    });
    unwrap(await svc.refreshBondQuote(BUYER_A, bidId), 'refreshBondQuote');
    const after = await getBid(h, bidId);
    expect(after.bondReference).toBe('WMB_plain');
    expect(after.bondCents).toBe(321);
  });

  it('an outage pending verdict still extends nothing (always-run arm)', async () => {
    // The allowlist's most load-bearing exclusion, previously proven only in
    // the env-gated pg fixture.
    const h = makeHarness();
    const listing = await listEpic(h);
    const bidAt = listing.endsAtMs - 60_000;
    h.setNow(bidAt);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({ settled: false, pending: true, reason: 'service_unavailable' }),
      },
    });
    h.setNow(listing.endsAtMs - 30_000);
    unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-outage-arm'), 'confirmBond');
    expect((await getListing(h, listing.id)).endsAtMs).toBe(listing.endsAtMs);
  });

  it('a bond the ledger settles at the POLL still extends, from the poll clock', async () => {
    // The allowlist un-extended the honest bidder whose synchronous confirm
    // raced chain visibility (not_yet_visible) and whose bond the ledger then
    // settled: the poll's settled arm grants the same paid-bond extension the
    // confirm site always granted, and a fabricated signature cannot reach it
    // because a fabricated string never settles.
    const h = makeHarness();
    const listing = await listEpic(h);
    h.setNow(listing.endsAtMs - 60_000);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const verdict = { settled: false, pending: true, reason: 'not_yet_visible' as string };
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({
          settled: verdict.settled,
          pending: verdict.pending,
          reason: verdict.reason,
        }),
      },
    });
    h.setNow(listing.endsAtMs - 30_000);
    unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-poll-settle'), 'confirmBond');
    // The visibility-lag word correctly extends nothing at the confirm site.
    expect((await getListing(h, listing.id)).endsAtMs).toBe(listing.endsAtMs);
    verdict.settled = true;
    verdict.pending = false;
    const pollAt = listing.endsAtMs - 10_000;
    h.setNow(pollAt);
    await scripted.sweepPass();
    expect(
      (await getListing(h, listing.id)).endsAtMs,
      'the poll-observed settled verdict grants the paid-bond extension from the poll clock',
    ).toBe(pollAt + WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS * 1000);
    expect((await getBid(h, placed.bid.id)).status).toBe('active');
  });
});

describe('service vocabulary drift is visible on the dev channel', () => {
  it('warns ONCE per unrecognized pending word, never for the known vocabulary', async () => {
    // The anti-snipe allowlist fails silently toward never extending if the
    // service renames its ledger-matched word; the once-per-word warn is the
    // only signal that a drift happened.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const verdict = { settled: false, pending: true, reason: 'ledger_matched_v2' as string };
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({ settled: false, pending: true, reason: verdict.reason }),
      },
    });
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
    try {
      // INSIDE the anti-snipe window, or the extends-nothing assertion below
      // is vacuous: outside it, no word extends and the pin proves nothing.
      h.setNow(listing.endsAtMs - 30_000);
      unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-drift-word'), 'confirmBond');
      unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-drift-word'), 'confirmBond');
      const driftLines = warned.filter((w) => w.includes('unrecognized pending confirm verdict'));
      expect(driftLines, 'once per word, not per sighting').toHaveLength(1);
      expect(driftLines[0]).toContain('ledger_matched_v2');
      // The drifted word is exactly the shape the allowlist exists for: it
      // must extend nothing (a denylist-form regression passes every
      // known-word arm while any invented word moves the close for free).
      expect(
        (await getListing(h, listing.id)).endsAtMs,
        'an unknown pending word never moves the close',
      ).toBe(listing.endsAtMs);
      verdict.reason = 'awaiting_finality';
      unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-drift-word'), 'confirmBond');
      expect(
        warned.filter((w) => w.includes('unrecognized pending confirm verdict')),
        'a known vocabulary word never warns',
      ).toHaveLength(1);
      // A SECOND distinct drift word earns its own line: a single-boolean
      // dedupe would silence every drift after the first.
      verdict.reason = 'ledger_seen_v3';
      unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-drift-word'), 'confirmBond');
      const twoWords = warned.filter((w) => w.includes('unrecognized pending confirm verdict'));
      expect(twoWords, 'one line per distinct word').toHaveLength(2);
      expect(twoWords[1]).toContain('ledger_seen_v3');
    } finally {
      spy.mockRestore();
    }
  });

  it('clamps a hostile drift word: one bounded printable line, no forged newline', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const hostile = `seen\n[woc_market] forged operator line${'x'.repeat(300)}`;
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({ settled: false, pending: true, reason: hostile }),
      },
    });
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
    try {
      unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-hostile-word'), 'confirmBond');
      const driftLines = warned.filter((w) => w.includes('unrecognized pending confirm verdict'));
      expect(driftLines).toHaveLength(1);
      expect(driftLines[0], 'the newline is replaced, never emitted').not.toContain('\n');
      expect(driftLines[0]).toContain('?');
      // logSafe bounds the identifier at 256, the intake screen's bound: a
      // real 88-char signature elsewhere must survive WHOLE for an exact
      // reconciliation grep, so the clamp must not regress to a shorter
      // slice. The 150-char run proves well past the old 64 survived; the
      // length ceiling proves the 300-char tail was still cut.
      expect(driftLines[0]).toContain('x'.repeat(150));
      // Prefix (50 chars) plus the 256 clamp: any loosening past the intake
      // screen's bound goes red, not just an unbounded interpolation.
      expect(driftLines[0].length).toBeLessThanOrEqual(306);
    } finally {
      spy.mockRestore();
    }
  });

  it('warns once per unrecognized FAIL word too, from the confirm site and the poll', async () => {
    // The fail-side twin: fail words persist on the row, but nobody knows to
    // query for drift; the sighting line is the signal. Same channel rules:
    // once per word across sites, known vocabulary words never warn.
    const h = makeHarness();
    const verdict = { settled: false, pending: false, reason: 'burn_rejected_v9' as string };
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({
          settled: verdict.settled,
          pending: verdict.pending,
          reason: verdict.reason,
        }),
      },
    });
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
    const settledFor = async (buyer: number, char: number): Promise<number> => {
      // The harness seeds ONE epic copy; each round lists a fresh one.
      h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
      const listing = await listEpic(h);
      const standing = await confirmedBid(h, buyer, char, listing.id, 5000);
      h.setNow((await getListing(h, listing.id)).endsAtMs + 1);
      await h.service.sweepPass();
      const settlement = await liveSettlement(h, listing.id);
      unwrap(await scripted.settlementQuote(buyer, settlement.id), 'settlementQuote');
      void standing;
      return settlement.id;
    };
    try {
      // Confirm site: the terminal refusal carries the drifted word.
      const first = await settledFor(BUYER_A, CHAR_A);
      expect(await scripted.confirmSettlement(BUYER_A, first, 'sig-fail-drift-1')).toEqual({
        ok: false,
        reason: 'confirm_failed',
      });
      const failLines = () => warned.filter((w) => w.includes('unrecognized fail verdict'));
      expect(failLines(), 'the confirm site warns on first sighting').toHaveLength(1);
      expect(failLines()[0]).toContain('burn_rejected_v9');
      expect((await getSettlement(h, first)).failReason, 'the row keeps the verbatim word').toBe(
        'burn_rejected_v9',
      );
      // Poll site, same word: dedupe holds across call sites.
      verdict.pending = true;
      const second = await settledFor(BUYER_B, CHAR_B);
      expect(
        unwrap(await scripted.confirmSettlement(BUYER_B, second, 'sig-fail-drift-2'), 'confirm')
          .state,
      ).toBe('confirming');
      verdict.pending = false;
      await scripted.sweepPass();
      expect((await getSettlement(h, second)).state).toBe('failed');
      expect(failLines(), 'once per word, even across sites').toHaveLength(1);
      // A FRESH word whose ONLY sighting is the poller: the confirm site
      // answers a known pending word (no warn possible there), then the poll
      // decides against with the new word. This is what fails if the
      // poller's own note call is deleted; the same-word dedupe round above
      // cannot see that deletion.
      verdict.pending = true;
      verdict.reason = 'not_yet_visible';
      const pollOnly = await settledFor(BUYER_C, CHAR_C);
      expect(
        unwrap(await scripted.confirmSettlement(BUYER_C, pollOnly, 'sig-fail-drift-3'), 'confirm')
          .state,
      ).toBe('confirming');
      expect(failLines(), 'the known pending word warned nothing').toHaveLength(1);
      verdict.pending = false;
      verdict.reason = 'escrow_rejected_v4';
      await scripted.sweepPass();
      expect((await getSettlement(h, pollOnly)).failReason).toBe('escrow_rejected_v4');
      const afterPoll = failLines();
      expect(afterPoll, 'the poll sighting reaches the channel').toHaveLength(2);
      expect(afterPoll[1]).toContain('escrow_rejected_v4');
      // A KNOWN fail word never warns.
      verdict.pending = true;
      verdict.reason = 'refused';
      const third = await settledFor(BUYER_B, CHAR_B);
      expect(
        unwrap(await scripted.confirmSettlement(BUYER_B, third, 'sig-fail-known'), 'confirm').state,
      ).toBe('confirming');
      verdict.pending = false;
      await scripted.sweepPass();
      expect(failLines(), 'vocabulary members are not drift').toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });

  it('a BOND refusal word reaches the fail channel: no row keeps it on this leg', async () => {
    // Unlike a settlement, a refused bond leaves no fail_reason column
    // behind (the refusal drops the word and lapseBid records none), so the
    // sighting line is the only trace a service's new refusal class gets.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({ settled: false, pending: false, reason: 'bond_burn_rejected_v1' }),
      },
    });
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
    try {
      expect(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-bond-fail-word')).toEqual({
        ok: false,
        reason: 'confirm_failed',
      });
      const failLines = () => warned.filter((w) => w.includes('unrecognized fail verdict'));
      expect(failLines(), 'the bond confirm site warns on first sighting').toHaveLength(1);
      expect(failLines()[0]).toContain('bond_burn_rejected_v1');
      // The bond POLL's decided-against arm is the same rowless leg: a fresh
      // word whose only sighting is the poller must reach the channel too.
      const placed2 = unwrap(
        await placeBid(h, {
          account: BUYER_B,
          characterId: CHAR_B,
          listingId: listing.id,
          amountCents: 6000,
        }),
        'placeBid',
      );
      const verdict = { pending: true, reason: 'not_yet_visible' as string };
      const scripted2 = new WocMarketService({
        ...h.deps,
        economy: {
          ...h.economy,
          confirm: async () => ({
            settled: false,
            pending: verdict.pending,
            reason: verdict.reason,
          }),
        },
      });
      unwrap(await scripted2.confirmBond(BUYER_B, placed2.bid.id, 'sig-bond-poll-word'), 'confirm');
      expect(failLines(), 'the known pending word warned nothing').toHaveLength(1);
      verdict.pending = false;
      verdict.reason = 'bond_escrow_rejected_v2';
      await scripted2.sweepPass();
      const afterPoll = failLines();
      expect(afterPoll, 'the bond poll sighting reaches the channel').toHaveLength(2);
      expect(afterPoll[1]).toContain('bond_escrow_rejected_v2');
    } finally {
      spy.mockRestore();
    }
  });

  it('the POLL call sites feed the same drift channel', async () => {
    // Deleting either poller's note call leaves drift invisible on exactly
    // the unattended path; each poller sighting must reach the channel.
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    const verdict = { reason: 'not_yet_visible' as string };
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({ settled: false, pending: true, reason: verdict.reason }),
      },
    });
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
    try {
      unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-poll-drift'), 'confirmBond');
      expect(warned.filter((w) => w.includes('unrecognized'))).toHaveLength(0);
      verdict.reason = 'poll_only_word_v1';
      await scripted.sweepPass();
      const driftLines = warned.filter((w) => w.includes('unrecognized pending confirm verdict'));
      expect(driftLines, 'the bond poll sighting reaches the channel').toHaveLength(1);
      expect(driftLines[0]).toContain('poll_only_word_v1');
    } finally {
      spy.mockRestore();
    }
  });

  it('caps the drift channel: one suppression line past the bound, then silence', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    let word = 0;
    const scripted = new WocMarketService({
      ...h.deps,
      economy: {
        ...h.economy,
        confirm: async () => ({ settled: false, pending: true, reason: `drift_word_${word}` }),
      },
    });
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
    try {
      for (word = 0; word < 103; word++) {
        unwrap(await scripted.confirmBond(BUYER_A, placed.bid.id, 'sig-cap-word'), 'confirmBond');
      }
      expect(
        warned.filter((w) => w.includes('unrecognized pending confirm verdict')),
        'one line per distinct word up to the cap',
      ).toHaveLength(100);
      expect(
        warned.filter((w) => w.includes('further unrecognized pending verdict words suppressed')),
        'exactly one suppression line, then silence',
      ).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('review-round closures (the shared strike gate and the cooldown params)', () => {
  it('the AUCTION default arm spares the strike on the exempt refusal class too', async () => {
    // The other fairness dimension of strikeDefaultingBuyer (the outage test
    // covers oracle health): a chain-plausible refusal class recorded on the
    // settlement spares the strike under a HEALTHY oracle, exactly as the
    // directed rail does. Default and forfeit still land.
    const h = makeHarness();
    const listing = await listEpic(h);
    const standing = await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    unwrap(await h.service.settlementQuote(BUYER_A, settlement.id), 'settlementQuote');
    expect(await h.db.submitSettlementSignature(settlement.id, 'sig-auction-outage')).toBe('ok');
    expect(
      await h.db.transitionSettlement(
        settlement.id,
        ['confirming'],
        'failed',
        'service_unavailable',
      ),
    ).toBe(true);
    h.setNow(settlement.deadlineAtMs + 1);
    await h.service.sweepPass();
    expect((await getSettlement(h, settlement.id)).state).toBe('expired');
    const bid = await getBid(h, standing.bidId);
    expect(bid.status).toBe('defaulted');
    expect((await h.db.strikeInfo(BUYER_A))?.strikes ?? 0).toBe(0);
  });

  it('the cooldown remaining time is floored at ONE second, never zero', async () => {
    // Unreachable through the fake's own ledger (its retry moments are
    // always strictly future), so drive the boundary at the db seam.
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const original = h.db.claimBuyNowLock.bind(h.db);
    h.db.claimBuyNowLock = async () =>
      ({ refusal: 'claim_cooldown', retryAtMs: h.now() - 5_000 }) as never;
    try {
      expect(
        await h.service.buyNow({
          account: BUYER_A,
          characterId: CHAR_A,
          listingId: listing.id,
          acceptTerms: true,
        }),
      ).toEqual({
        ok: false,
        reason: 'claim_cooldown',
        params: { retryAfterSeconds: 1 },
      });
    } finally {
      h.db.claimBuyNowLock = original;
    }
  });

  it('the hourly cap arm carries ITS drain moment through the fake too', async () => {
    // The cap arm's retry moment (the cap-th newest abandon leaving the
    // rolling window) is pinned exactly in the Pg suite; this is the
    // fake-side twin so a non-Postgres leg still pins the arm.
    const h = makeHarness();
    for (let i = 0; i < 3; i++) {
      // One epic copy per listing: the harness stocks the seller with one.
      h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
      const other = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
      await h.db.recordBuyNowAbandon(REALM, other.id, BUYER_A, BASE_MS - (i + 1) * 60_000);
    }
    h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const fresh = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const out = await h.service.buyNow({
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: fresh.id,
      acceptTerms: true,
    });
    // Cap-th newest sits at BASE_MS - 3 min; it leaves the rolling window
    // WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS later.
    const retryAtMs = BASE_MS - 3 * 60_000 + 3_600_000;
    expect(out).toEqual({
      ok: false,
      reason: 'claim_cooldown',
      params: { retryAfterSeconds: Math.ceil((retryAtMs - h.now()) / 1000) },
    });
  });

  it('the announced retry moment is the FIRST admissible one on both arms, in the fake too', async () => {
    // The Pg twin claims at EXACTLY retryAtMs; the fake's two strict filters
    // must agree, or the CI floor (fake-driven) would let a >= drift keep
    // refusing at the announced moment while Postgres admits it.
    // Per-listing arm: one abandon on THIS listing at BASE_MS - 1s.
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    await h.db.recordBuyNowAbandon(REALM, listing.id, BUYER_A, BASE_MS - 1_000);
    const claim = () =>
      h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      });
    const refused = await claim();
    if (refused.ok || refused.reason !== 'claim_cooldown') {
      throw new Error(`expected a cooldown refusal, got ${JSON.stringify(refused)}`);
    }
    const retryAtMs = h.now() + Number(refused.params?.retryAfterSeconds ?? 0) * 1000;
    expect(retryAtMs).toBeGreaterThan(h.now());
    h.setNow(retryAtMs - 1_000);
    expect((await claim()).ok, 'one second before: still refused').toBe(false);
    h.setNow(retryAtMs);
    expect((await claim()).ok, 'at the announced moment: admitted').toBe(true);
    // Cap arm: three abandons on OTHER listings, a fresh one claimed at the
    // moment the cap-th newest leaves the rolling window.
    const h2 = makeHarness();
    for (let i = 0; i < 3; i++) {
      h2.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
      const other = await listEpic(h2, { format: 'buy_now', buyNowCents: 8000 });
      await h2.db.recordBuyNowAbandon(REALM, other.id, BUYER_A, BASE_MS - (i + 1) * 60_000);
    }
    h2.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
    const fresh = await listEpic(h2, { format: 'buy_now', buyNowCents: 8000 });
    const claim2 = () =>
      h2.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: fresh.id,
        acceptTerms: true,
      });
    const capped = await claim2();
    if (capped.ok || capped.reason !== 'claim_cooldown') {
      throw new Error(`expected a cap refusal, got ${JSON.stringify(capped)}`);
    }
    const capAtMs = h2.now() + Number(capped.params?.retryAfterSeconds ?? 0) * 1000;
    expect(capAtMs).toBeGreaterThan(h2.now());
    h2.setNow(capAtMs - 1_000);
    expect((await claim2()).ok, 'cap: one second before, still refused').toBe(false);
    h2.setNow(capAtMs);
    expect((await claim2()).ok, 'cap: at the announced moment, admitted').toBe(true);
  });

  it('both arms refusing with the per-listing cooldown LATER: the reclaim moment wins, in the fake too', async () => {
    // The other direction of the max-combining rule (the cap-later case is
    // pinned above): a fresh abandon on THIS listing 5 minutes ago under the
    // 30-minute re-claim cooldown, plus older abandons on other listings that
    // fill the hourly cap with a boundary 45 minutes old (draining in 15). A
    // "cap wins when present" combiner would announce a moment this listing
    // still refuses; the fake must agree with the Pg twin.
    const h = makeHarness();
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const reclaimSeedMs = BASE_MS - 5 * 60_000;
    await h.db.recordBuyNowAbandon(REALM, listing.id, BUYER_A, reclaimSeedMs);
    for (let i = 0; i < WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR - 1; i++) {
      h.custody.bags.set(SELLER_CHAR, [{ itemId: EPIC_ITEM, count: 1 }]);
      const other = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
      await h.db.recordBuyNowAbandon(REALM, other.id, BUYER_A, BASE_MS - 45 * 60_000 - i * 1000);
    }
    const out = await h.service.buyNow({
      account: BUYER_A,
      characterId: CHAR_A,
      listingId: listing.id,
      acceptTerms: true,
    });
    const retryAtMs = reclaimSeedMs + WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS * 1000;
    expect(retryAtMs, 'the fixture premise: reclaim outlasts the cap drain').toBeGreaterThan(
      BASE_MS - 45 * 60_000 + WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS * 1000,
    );
    expect(out).toEqual({
      ok: false,
      reason: 'claim_cooldown',
      params: { retryAfterSeconds: Math.ceil((retryAtMs - h.now()) / 1000) },
    });
  });
});

describe('settlementQuote entry guards', () => {
  it('refuses a foreign account and a lapsed deadline before any revival', async () => {
    const h = makeHarness();
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    expect(await h.service.settlementQuote(BUYER_B, settlement.id)).toMatchObject({
      ok: false,
      reason: 'not_yours',
    });
    // Inclusive at the bound: the deadline instant itself is already expired.
    h.setNow(settlement.deadlineAtMs);
    expect(await h.service.settlementQuote(BUYER_A, settlement.id)).toMatchObject({
      ok: false,
      reason: 'quote_expired',
    });
    expect((await getSettlement(h, settlement.id)).state, 'no revival, no write').toBe('offered');
  });

  it('a past-deadline FAILED settlement stays failed: the deadline refuses before the revival', async () => {
    // The ordering the source protects: a past-deadline 'failed' row must be
    // left for the overdue sweep's default pass, never revived into an open
    // row the method then refuses anyway. Moving the deadline check below the
    // revival CAS would flip the state this arm pins.
    const h = makeHarness();
    const listing = await listEpic(h);
    await confirmedBid(h, BUYER_A, CHAR_A, listing.id, 5000);
    h.setNow(listing.endsAtMs + 1);
    await h.service.sweepPass();
    const settlement = await liveSettlement(h, listing.id);
    expect(await h.db.transitionSettlement(settlement.id, ['offered'], 'failed')).toBe(true);
    h.setNow(settlement.deadlineAtMs);
    expect(await h.service.settlementQuote(BUYER_A, settlement.id)).toMatchObject({
      ok: false,
      reason: 'quote_expired',
    });
    expect((await getSettlement(h, settlement.id)).state, 'never revived').toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// Desktop browser-signing registration (issue #3692): the service registers
// every signable step-up challenge and payable quote with the desktop wallet
// handoff store, keyed for the /api/desktop-wallet/create lookups.
// ---------------------------------------------------------------------------

describe('desktop handoff registration', () => {
  function recordingRegistrar() {
    const stepUps: Array<[number, DesktopWalletStepUpAuthorization]> = [];
    const transactions: Array<[number, DesktopWalletTransactionAuthorization]> = [];
    return {
      stepUps,
      transactions,
      registrar: {
        authorizeStepUp: (accountId: number, auth: DesktopWalletStepUpAuthorization) => {
          stepUps.push([accountId, auth]);
        },
        authorizeTransaction: (accountId: number, auth: DesktopWalletTransactionAuthorization) => {
          transactions.push([accountId, auth]);
        },
      },
    };
  }

  it('registers an issued step-up challenge under the seller wallet (real-signature arm)', async () => {
    const h = makeHarness();
    const rec = recordingRegistrar();
    (h.deps as { stepUpDevSig: boolean }).stepUpDevSig = false;
    h.deps.desktopHandoff = rec.registrar;
    const out = await h.service.issueStepUpChallenge(
      SELLER,
      listBindingFor(EPIC_ITEM, listingParams()),
    );
    if (!out.ok) throw new Error(`issue refused: ${out.reason}`);
    expect(rec.stepUps).toEqual([
      [
        SELLER,
        {
          nonce: out.challenge.nonce,
          message: out.challenge.message,
          expectedAddress: 'wallet-seller',
          expiresAtMs: out.challenge.expiresAtMs,
        },
      ],
    ]);
    expect(rec.transactions).toEqual([]);
  });

  it('registers nothing for a devsig challenge (no wallet ever signs it)', async () => {
    const h = makeHarness();
    const rec = recordingRegistrar();
    h.deps.desktopHandoff = rec.registrar;
    const out = await h.service.issueStepUpChallenge(
      SELLER,
      listBindingFor(EPIC_ITEM, listingParams()),
    );
    if (!out.ok) throw new Error(`issue refused: ${out.reason}`);
    expect(out.challenge.signatureRequired).toBe(false);
    expect(rec.stepUps).toEqual([]);
  });

  it('registers a signable bond quote under the bidder wallet at placeBid', async () => {
    const h = twoEpics(makeHarness());
    const listing = await listEpic(h);
    const rec = recordingRegistrar();
    h.deps.desktopHandoff = rec.registrar;
    // The dev economy answers signatureRequired false (nothing signable), so
    // force the production posture on the quote alone; everything else rides
    // the real dev-economy answer.
    const economy = h.deps.economy;
    h.deps.economy = {
      ...economy,
      bondQuote: async (args) => ({
        ...(await economy.bondQuote(args)),
        signatureRequired: true,
      }),
    };
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    expect(rec.transactions).toEqual([
      [
        BUYER_A,
        expect.objectContaining({
          reference: placed.bid.bondReference,
          expectedAddress: 'wallet-a',
          rail: 'woc',
          expiresAtMs: placed.bid.bondQuoteExpiresAtMs,
        }),
      ],
    ]);
    expect(rec.stepUps).toEqual([]);
  });

  it('registers the FINAL refreshed bond quote past the CAS, under the bidder wallet', async () => {
    const h = twoEpics(makeHarness());
    const listing = await listEpic(h);
    const placed = unwrap(
      await placeBid(h, {
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        amountCents: 5000,
      }),
      'placeBid',
    );
    // Arm the recorder only for the refresh, and force the production
    // signable posture on the re-quote alone.
    const rec = recordingRegistrar();
    h.deps.desktopHandoff = rec.registrar;
    const economy = h.deps.economy;
    h.deps.economy = {
      ...economy,
      bondQuote: async (args) => ({
        ...(await economy.bondQuote(args)),
        signatureRequired: true,
      }),
    };
    const refreshed = unwrap(
      await h.service.refreshBondQuote(BUYER_A, placed.bid.id),
      'refreshBondQuote',
    );
    expect(rec.transactions).toEqual([
      [
        BUYER_A,
        expect.objectContaining({
          reference: refreshed.bond.reference,
          expectedAddress: 'wallet-a',
          rail: 'woc',
          expiresAtMs: refreshed.bond.expiresAtMs,
        }),
      ],
    ]);
  });

  it('registers the buy-now settlement quote past the stamp (the quoteFor path)', async () => {
    const h = twoEpics(makeHarness());
    const listing = await listEpic(h, { format: 'buy_now', buyNowCents: 8000 });
    const rec = recordingRegistrar();
    h.deps.desktopHandoff = rec.registrar;
    const economy = h.deps.economy;
    h.deps.economy = {
      ...economy,
      settlementQuote: async (args) => ({
        ...(await economy.settlementQuote(args)),
        signatureRequired: true,
      }),
    };
    const buy = unwrap(
      await h.service.buyNow({
        account: BUYER_A,
        characterId: CHAR_A,
        listingId: listing.id,
        acceptTerms: true,
      }),
      'buyNow',
    );
    expect(rec.transactions).toEqual([
      [
        BUYER_A,
        expect.objectContaining({
          reference: buy.quote.reference,
          expectedAddress: 'wallet-a',
          rail: 'woc',
        }),
      ],
    ]);
    expect(buy.quote.reference).not.toBeNull();
  });
});
