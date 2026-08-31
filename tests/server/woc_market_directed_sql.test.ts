// The SQL half of the directed-sale boundary.
//
// tests/server/woc_market_service.test.ts drives the service against FakeWocMarketDb,
// so it proves the RULES but never the QUERIES: deleting the browse exclusion from
// the real SQL leaves that suite entirely green, because the fake reimplements
// browse in TypeScript. These tests drive PgWocMarketDb itself against a mock pool
// and assert on the statement text, which is the only thing that ships.
//
// The predicate under test is a security boundary (a directed sale is addressed to
// one named account and must never enter a public result set), so it is pinned to a
// literal rather than a shape.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
  BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
  BankLedgerGrowthLimitExceeded,
} from '../../server/bank_ledger_growth_budget';
import {
  type BankLedgerOutboxSnapshot,
  serializeBankLedgerCommandBatch,
} from '../../server/bank_ledger_outbox';
import type { StorageAppliedEffect } from '../../server/storage_purchase_db';
import {
  ESCROW_LOCK_TIMEOUT_MS,
  PgWocMarketDb,
  SAVE_IDLE_TX_TIMEOUT_MS,
  SETTLED_OFFER_GRACE_MS,
  TxNeverStarted,
  WOC_MARKET_OFFERS_PAIR_PENDING_INDEX,
  wocMarketIdleTxKillCount,
} from '../../server/woc_market_db';
import type { CharacterState } from '../../src/sim/sim';

const REALM = 'Claudemoon';

/** A pool that records every statement (and its bound parameters) and answers
 *  with no rows. */
function recordingPool(): { pool: Pool; sql: () => string[]; params: () => unknown[][] } {
  const seen: string[] = [];
  const bound: unknown[][] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    seen.push(text);
    bound.push(values ?? []);
    return { rows: [], rowCount: 0 };
  });
  return { pool: { query } as unknown as Pool, sql: () => seen, params: () => bound };
}

/** recordingPool for the BOUNDED plain writers (since the write-path rider
 *  they ride one short transaction through boundedWrite): the same raw
 *  recorder plus a connect() client so the seam can run, and workload views
 *  that drop the protocol statements (BEGIN/COMMIT/ROLLBACK/SET LOCAL) with
 *  their empty param rows, so a per-writer pin keeps asserting on the ONE
 *  statement it is about. The bounded shape itself is pinned RAW, once, in
 *  its dedicated test below; sql() here stays raw on purpose so a no-BEGIN
 *  style negative can never go vacuous against this rig. */
/** Wrap a bare query fn as a pool the bounded plain-write seam can drive:
 *  the same fn answers pool.query and the checked-out client, with the
 *  protocol statements (BEGIN/SET LOCAL/COMMIT/ROLLBACK) answered empty
 *  BEFORE the fn runs, so a recording rig keeps seeing only its workload
 *  statement and a THROWING responder fires on the workload statement, not
 *  on BEGIN (which would misclassify the staged error as never-started). */
function writeClientPool(
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>,
): Pool {
  const wrapped = async (text: string, values?: unknown[]) => {
    if (
      text === 'BEGIN' ||
      text === 'COMMIT' ||
      text === 'ROLLBACK' ||
      text.startsWith('SET LOCAL')
    ) {
      return { rows: [], rowCount: 0 };
    }
    return query(text, values);
  };
  const client = { query: wrapped, release: () => {}, on: () => {}, removeListener: () => {} };
  return { query: wrapped, connect: async () => client } as unknown as Pool;
}

function recordingWritePool(): {
  pool: Pool;
  sql: () => string[];
  workload: () => string[];
  workloadParams: () => unknown[][];
} {
  const seen: string[] = [];
  const bound: unknown[][] = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    seen.push(text);
    bound.push(values ?? []);
    return { rows: [], rowCount: 0 };
  });
  const client = { query, release: () => {}, on: () => {}, removeListener: () => {} };
  const isProtocol = (t: string) =>
    t === 'BEGIN' || t === 'COMMIT' || t === 'ROLLBACK' || t.startsWith('SET LOCAL');
  return {
    pool: { query, connect: async () => client } as unknown as Pool,
    sql: () => seen,
    workload: () => seen.filter((t) => !isProtocol(t)),
    workloadParams: () => bound.filter((_, i) => !isProtocol(seen[i] ?? '')),
  };
}

const browseQuery = {
  page: 0,
  pageSize: 20,
  quality: null,
  category: null,
  subcategory: null,
  format: null,
  itemIds: null,
  sort: 'ending',
} as const;

describe('the public browse query excludes directed sales in SQL', () => {
  it('carries the directed_buyer_account IS NULL predicate', async () => {
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).browseListings(REALM, browseQuery);
    const [text] = sql();
    expect(text).toContain('directed_buyer_account IS NULL');
  });

  it('keeps the predicate on EVERY sort, not just the default', async () => {
    // Each sort builds its own ORDER BY against the same WHERE. A refactor that
    // rebuilt the clause per sort could drop the exclusion from one of them, and
    // one leaking sort is a full leak.
    for (const sort of ['ending', 'newest', 'price_asc', 'price_desc'] as const) {
      const { pool, sql } = recordingPool();
      await new PgWocMarketDb(pool).browseListings(REALM, { ...browseQuery, sort });
      expect(sql()[0], sort).toContain('directed_buyer_account IS NULL');
    }
  });

  it('keeps the predicate when the caller also filters by quality, format and item', async () => {
    // The optional filters append to the same WHERE array; appending must never
    // displace the unconditional exclusion.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).browseListings(REALM, {
      ...browseQuery,
      quality: 'epic',
      format: 'buy_now',
      itemIds: ['sword'],
    });
    expect(sql()[0]).toContain('directed_buyer_account IS NULL');
  });
});

describe('the seller listing cap counts EVERY non-closed listing, in SQL', () => {
  it('carries no directed exemption in the count predicate', async () => {
    // The exemption was the unbounded-escrow hole (H12): a directed listing
    // escrows a real copy exactly like a public one, so it counts. The
    // authoritative in-transaction copy of this predicate is pinned by the
    // escrow-transaction block below; the two must stay byte-identical.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).countActiveBySeller(REALM, 7);
    expect(sql()[0]).toContain("status <> 'closed'");
    expect(sql()[0]).not.toContain('directed_buyer_account');
  });
});

describe('the schema carries the directed column additively', () => {
  it('adds the column with ADD COLUMN IF NOT EXISTS, never a bare CREATE TABLE', async () => {
    // ensureSchema re-applies this DDL at every boot against tables that already
    // exist, so a column introduced only inside CREATE TABLE IF NOT EXISTS would
    // never appear on a deployed realm and every directed query would error.
    const { WOC_MARKET_SCHEMA } = await import('../../server/woc_market_db');
    expect(WOC_MARKET_SCHEMA).toContain('ADD COLUMN IF NOT EXISTS directed_buyer_account');
    expect(WOC_MARKET_SCHEMA).toContain('woc_market_listings_directed_buyer');
    // The agreed-copy fingerprint column is in the same
    // deployed-realm-needs-the-ALTER class, and the three integrity indexes
    // must exist by name (IF NOT EXISTS matches on the NAME alone).
    expect(WOC_MARKET_SCHEMA).toContain('ADD COLUMN IF NOT EXISTS item_pin');
    expect(WOC_MARKET_SCHEMA).toContain('woc_market_directed_offers_listing');
    expect(WOC_MARKET_SCHEMA).toContain('woc_market_offers_accepted_unstamped');
    expect(WOC_MARKET_SCHEMA).toContain('woc_market_offers_pair_pending');
    // The poll read's two account indexes, with their exact columns (a
    // same-name index with a different prefix puts the seq scan back while a
    // name pin stays green), and the retired pending-only pair they replace.
    const schema = WOC_MARKET_SCHEMA.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_offers_buyer_all ON woc_market_directed_offers(realm, buyer_account, created_at DESC);',
    );
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_offers_seller_all ON woc_market_directed_offers(realm, seller_account, created_at DESC);',
    );
    expect(schema).toContain('DROP INDEX IF EXISTS woc_market_offers_buyer_pending;');
    expect(schema).toContain('DROP INDEX IF EXISTS woc_market_offers_seller_pending;');
    expect(schema).not.toContain('CREATE INDEX IF NOT EXISTS woc_market_offers_buyer_pending');
    expect(schema).not.toContain('CREATE INDEX IF NOT EXISTS woc_market_offers_seller_pending');
  });

  it('creates the pair-pending index with its exact columns and partial predicate', async () => {
    // The name alone is not the bound: this index IS the strike-farming
    // authority (one live deal per buyer/seller pair), and it enforces that
    // only while it is UNIQUE, keyed on exactly those three columns, and
    // partial on pending. Drop 'realm' and two realms collide; drop the WHERE
    // and a resolved pair can never deal again; make it non-unique and the
    // bound silently disappears while every name pin stays green.
    // Comment-stripped and whitespace-collapsed first: the rationale prose
    // above the DDL names the same columns, and the statement is reflowed.
    const { WOC_MARKET_SCHEMA } = await import('../../server/woc_market_db');
    const schema = WOC_MARKET_SCHEMA.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
    expect(schema).toContain(
      `CREATE UNIQUE INDEX IF NOT EXISTS ${WOC_MARKET_OFFERS_PAIR_PENDING_INDEX}` +
        ' ON woc_market_directed_offers(realm, buyer_account, seller_account)' +
        " WHERE status = 'pending'",
    );
  });
});

describe('the directed-rail integrity statements, in SQL', () => {
  it('the offer insert stamps the agreed item and pin at creation, and maps the pair bound typed', async () => {
    const seenSql: string[] = [];
    const seenParams: unknown[][] = [];
    const okPool = {
      query: vi.fn(async (text: string, params?: unknown[]) => {
        seenSql.push(text);
        seenParams.push(params ?? []);
        return {
          rows: [
            {
              id: 1,
              realm: REALM,
              seller_account: 4,
              seller_character: 21,
              seller_name: 'Selara',
              buyer_account: 9,
              buyer_name: 'Aldan',
              item_ref: null,
              item_id: 'crown_of_embers',
              item_pin: 'a'.repeat(64),
              usd_cents: 5000,
              status: 'pending',
              listing_id: null,
              created_at: new Date(0),
              expires_at: new Date(0),
              buyer_accepted: false,
              seller_accepted: false,
            },
          ],
          rowCount: 1,
        };
      }),
    };
    await new PgWocMarketDb(writeClientPool(okPool.query)).insertDirectedOffer({
      realm: REALM,
      sellerAccount: 4,
      sellerCharacter: 21,
      sellerName: 'Selara',
      buyerAccount: 9,
      buyerName: 'Aldan',
      usdCents: 5000,
      expiresAtMs: 1_820_000_000_000,
      itemId: 'crown_of_embers',
      itemPin: 'a'.repeat(64),
    });
    const [text] = seenSql;
    expect(text).toContain('item_id, item_pin');
    expect(seenParams[0]).toContain('crown_of_embers');
    expect(seenParams[0]).toContain('a'.repeat(64));
    // The pair-pending unique violation answers typed instead of throwing:
    // the strike-farming bound must be a refusal the client can render. The
    // discriminator keys on the CONSTRAINT name (shared with the DDL via the
    // exported constant), so the fixture carries it the way pg does.
    const offerRow = (over: Partial<Parameters<PgWocMarketDb['insertDirectedOffer']>[0]> = {}) => ({
      realm: REALM,
      sellerAccount: 4,
      sellerCharacter: 21,
      sellerName: 'Selara',
      buyerAccount: 9,
      buyerName: 'Aldan',
      usdCents: 5000,
      expiresAtMs: 1_820_000_000_000,
      itemId: 'crown_of_embers',
      itemPin: 'a'.repeat(64),
      ...over,
    });
    const dup = {
      query: vi.fn(async () => {
        throw Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: WOC_MARKET_OFFERS_PAIR_PENDING_INDEX,
        });
      }),
    };
    const out = await new PgWocMarketDb(writeClientPool(dup.query)).insertDirectedOffer(offerRow());
    expect(out).toBe('offer_pending');
    // A 23505 from any OTHER unique index (a desynced sequence after a
    // hand-built partial restore) must surface as the 500 it is, never as
    // "the pair is occupied".
    const foreign = {
      query: vi.fn(async () => {
        throw Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'woc_market_directed_offers_pkey',
        });
      }),
    };
    await expect(
      new PgWocMarketDb(writeClientPool(foreign.query)).insertDirectedOffer(offerRow()),
    ).rejects.toThrow('duplicate key');
  });

  it('the seller acceptance records the claimed ref but never rewrites the agreed item_id', async () => {
    // item_id is the BUYER's agreed item, stamped at creation beside the
    // pin; letting the seller's claimed ref overwrite it would show the
    // buyer an item they never agreed to while the deal awaits payment.
    const { pool, workload } = recordingWritePool();
    await new PgWocMarketDb(pool).acceptDirectedOfferSide(REALM, 3, 'seller', {
      index: 0,
      itemId: 'other_item',
    });
    const [text] = workload();
    expect(text).toContain('item_ref = COALESCE');
    expect(text).not.toContain('item_id =');
  });

  it('the converge read is a two-sided window over the partial index, ordered, narrow', async () => {
    const { pool, sql, params } = recordingPool();
    await new PgWocMarketDb(pool).acceptedUnstampedOffers(REALM, 1_000, 2_000, 25);
    const [text] = sql();
    // The predicate must match the woc_market_offers_accepted_unstamped
    // partial index text and carry BOTH age bounds: the young side keeps an
    // in-flight acceptance out, the old side keeps out rows the listings
    // prune un-stamped long after their deal completed (ON DELETE SET NULL),
    // which are not rollback evidence.
    expect(text).toContain("status = 'accepted'");
    expect(text).toContain('listing_id IS NULL');
    expect(text).toContain('updated_at <= to_timestamp($2 / 1000.0)');
    expect(text).toContain('updated_at > to_timestamp($3 / 1000.0)');
    expect(text).toContain('ORDER BY updated_at');
    // Narrow projection: the arm consumes only the id and the TTL verdict
    // input; item_ref and item_pin must not be detoasted per pass.
    expect(text).toContain('SELECT id, expires_at');
    expect(text).not.toContain('item_ref');
    expect(params()[0]).toEqual([REALM, 1_000, 2_000, 25]);
  });

  it('the converge expire write carries the accepted-and-unstamped CAS', async () => {
    const { pool, workload } = recordingWritePool();
    await new PgWocMarketDb(pool).expireDirectedOfferIfUnstamped(REALM, 3);
    const [text] = workload();
    expect(text).toContain("SET status = 'expired'");
    expect(text).toContain("status = 'accepted'");
    expect(text).toContain('listing_id IS NULL');
  });

  it('the offer expiry sweep carries the outer status qual and SKIP LOCKED', async () => {
    // The outer qual is the EvalPlanQual guard beside the escrow stamp: the
    // subselect snapshot can predate a racing acceptance, EPQ re-evaluates
    // only the target row's own columns, and without the qual the sweep
    // could expire an offer whose listing just committed. SKIP LOCKED keeps
    // the sweep from parking a pool client behind the escrow transaction's
    // offer-row lock. Pinned structurally BECAUSE no unit interleave can
    // exercise it: the subselect's own locked re-check shares the predicate,
    // so the outer qual is reachable only through a real snapshot race.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).expireDueDirectedOffers(REALM, 1_000, 25);
    const [text] = sql();
    expect(text).toContain("WHERE status = 'pending'");
    expect(text).toContain('FOR NO KEY UPDATE SKIP LOCKED');
  });

  it('the ever-settled strike gate reads bare existence, no state filter', async () => {
    // 'failed' is not an OPEN state, so a state-filtered probe would strike
    // a buyer twice for one walk-away (once from the close arm, once from
    // the overdue arm expiring the failed row).
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).everSettledForListing(7);
    const [text] = sql();
    expect(text).toContain('SELECT EXISTS');
    expect(text).toContain('woc_market_settlements');
    expect(text).not.toContain('state');
  });

  it('a directed listing refuses every bid as not_found, before any other verdict', async () => {
    // Anti-enumeration AND close-arm integrity in one refusal: browse hides
    // directed rows but ids are guessable, and a stranger's ACTIVE bid would
    // divert the directed close arm into the ordinary auction close, where
    // the bidder can win the escrowed copy.
    const directedRow = {
      id: 7,
      realm: REALM,
      seller_account: 99,
      seller_wallet: 'wallet-x',
      status: 'active',
      directed_buyer_account: 12,
      item: {},
      start_cents: 1000,
      ends_at: new Date(1_820_000_600_000),
    };
    const { pool } = recordingPool();
    const tx = recordingTxPool((text) =>
      text.includes('FROM woc_market_listings') ? { rows: [directedRow], rowCount: 1 } : undefined,
    );
    void pool;
    const out = await new PgWocMarketDb(tx.pool).insertPendingBid({
      realm: REALM,
      listingId: 7,
      account: 12,
      characterId: 1,
      characterName: 'Aldan',
      wallet: 'wallet-a',
      amountCents: 5000,
      bondCents: 250,
      nowMs: 1_820_000_000_000,
      minNext: () => 1000,
    });
    expect(out).toEqual({ ok: false, reason: 'not_found' });
  });

  it('the resolved-offer prune orders behind its partial index and keeps forever on a non-positive window', async () => {
    const { pruneResolvedWocOffersBatch } = await import('../../server/woc_market_db');
    const { pool, sql, params } = recordingPool();
    await pruneResolvedWocOffersBatch(pool as unknown as Pool, 180, 100);
    const [text] = sql();
    expect(text).toContain("status <> 'pending'");
    expect(text).toContain('ORDER BY updated_at');
    expect(text).toContain("($1 || ' days')::interval");
    expect(params()[0]).toEqual(['180', 100]);
    // The keep-forever arm: zero, negative, and NaN windows must not delete.
    const untouched = recordingPool();
    expect(await pruneResolvedWocOffersBatch(untouched.pool as unknown as Pool, 0, 100)).toBe(0);
    expect(await pruneResolvedWocOffersBatch(untouched.pool as unknown as Pool, -5, 100)).toBe(0);
    expect(
      await pruneResolvedWocOffersBatch(untouched.pool as unknown as Pool, Number.NaN, 100),
    ).toBe(0);
    expect(untouched.sql()).toHaveLength(0);
  });

  it('the claiming UPDATE carries the same-wallet NOT EXISTS predicate', async () => {
    // Defense in depth with NO reachable behavioral arm: the locked re-check
    // three statements above shares the predicate and answers first, and no
    // unit rig can commit a relink between two statements of one
    // transaction, so this pin (plus the real-SQL relink test) is the
    // coverage, recorded here rather than silently claimed as a tested arm.
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../helpers/strip_comments');
    const src = stripComments(
      readFileSync(new URL('../../server/woc_market_db.ts', import.meta.url), 'utf8'),
    );
    const updateStart = src.indexOf('SET buy_now_lock_account');
    expect(updateStart).toBeGreaterThan(-1);
    const updateText = src.slice(updateStart, src.indexOf('RETURNING', updateStart));
    expect(updateText).toContain('NOT EXISTS');
    expect(updateText).toContain('wallet_links');
    expect(updateText).toContain('IS NOT DISTINCT FROM');
  });
});

describe('the listing-id stamp rides the escrow transaction, atomically', () => {
  const SAVE = {
    characterId: 21,
    level: 10,
    state: { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState,
    leaseNonce: 'nonce',
  };
  const LISTING = {
    realm: REALM,
    sellerAccount: 4,
    sellerCharacter: 21,
    sellerName: 'Selara',
    sellerWallet: 'wallet-seller',
    item: { itemId: 'crown_of_embers', count: 1 },
    itemId: 'crown_of_embers',
    quality: 'epic' as const,
    category: null,
    subcategory: null,
    params: {
      format: 'buy_now' as const,
      directedBuyerAccount: 9,
      startCents: 5000,
      reserveCents: null,
      buyNowCents: 5000,
      durationHours: 12,
      offerNext: false,
    },
    endsAtMs: 1_820_000_000_000,
    directedOfferId: null,
  };
  // The stamp's home moved TWICE, and each home fixed the previous one's bug.
  // First the stamp was a WHERE narrowed to 'pending' that matched zero rows
  // (the offer never learned its listing). Then it was a second service call
  // after createListing, which a thrown escrow skipped: the listing could
  // exist with the offer stuck 'accepted' and unstamped, an unknowable state.
  // Now escrowInsertListing writes listing_id INSIDE the escrow transaction,
  // so "listing exists IFF the offer is stamped" holds through any throw, and
  // the accepted-offer converge arm proves rollback by exactly that.
  //
  // Asserted on the STATEMENT, because that is the half the fake cannot vouch
  // for and the half that actually ships.
  it('stamps under the accepted-and-unstamped CAS inside the transaction', async () => {
    const { pool, sql } = recordingTxPool((text) =>
      text.includes('RETURNING id')
        ? { rows: [{ id: 41 }], rowCount: 1 }
        : text.includes('woc_market_directed_offers')
          ? { rows: [], rowCount: 1 }
          : undefined,
    );
    const out = await new PgWocMarketDb(pool).escrowInsertListing(SAVE, {
      ...LISTING,
      directedOfferId: 9,
    });
    expect(out).toEqual({ ok: true, id: 41 });
    const stamp = sql().find((t) => t.includes('woc_market_directed_offers'));
    expect(stamp, 'the stamp statement must exist inside the transaction').toBeDefined();
    expect(stamp).toContain('SET listing_id = $1');
    expect(stamp, 'CAS: only a still-accepted row').toContain("status = 'accepted'");
    expect(stamp, 'CAS: only an unstamped row').toContain('listing_id IS NULL');
    const seq = sql();
    expect(seq.indexOf(stamp as string), 'stamp before COMMIT').toBeLessThan(seq.indexOf('COMMIT'));
  });

  it('aborts the WHOLE transaction typed when the stamp CAS misses', async () => {
    // Zero rows means the converge arm reopened or expired the offer while
    // the escrow was in flight: the insert and the character save must roll
    // back together (the copy restores through the typed-refusal arm), never
    // land a listing no offer points at.
    const { pool, sql } = recordingTxPool((text) =>
      text.includes('RETURNING id')
        ? { rows: [{ id: 41 }], rowCount: 1 }
        : text.includes('woc_market_directed_offers')
          ? { rows: [], rowCount: 0 }
          : undefined,
    );
    const out = await new PgWocMarketDb(pool).escrowInsertListing(SAVE, {
      ...LISTING,
      directedOfferId: 9,
    });
    expect(out).toEqual({ ok: false, reason: 'not_pending' });
    expect(sql().at(-1)).toBe('ROLLBACK');
  });

  it('a PUBLIC listing issues no offer statement at all', async () => {
    const { pool, sql } = recordingTxPool((text) =>
      text.includes('RETURNING id') ? { rows: [{ id: 7 }], rowCount: 1 } : undefined,
    );
    await new PgWocMarketDb(pool).escrowInsertListing(SAVE, {
      ...LISTING,
      params: { ...LISTING.params, directedBuyerAccount: null },
    });
    expect(sql().some((t) => t.includes('woc_market_directed_offers'))).toBe(false);
  });

  it('issues exactly FIVE workload statements on the directed arm, FOUR on the public arm', async () => {
    // The tunables relation prices ESCROW_STATEMENT_TIMEOUT_MS * 5 against
    // the autosave period, so the statement count is a pinned input to that
    // arithmetic, not an implementation detail: a sixth statement silently
    // stretches the honest occupancy ceiling past what the relation claims.
    const workload = (seq: string[]): string[] =>
      seq.filter(
        (t) => t !== 'BEGIN' && t !== 'COMMIT' && t !== 'ROLLBACK' && !t.startsWith('SET LOCAL'),
      );
    const directed = recordingTxPool((text) =>
      text.includes('RETURNING id')
        ? { rows: [{ id: 41 }], rowCount: 1 }
        : text.includes('woc_market_directed_offers')
          ? { rows: [], rowCount: 1 }
          : undefined,
    );
    await new PgWocMarketDb(directed.pool).escrowInsertListing(SAVE, {
      ...LISTING,
      directedOfferId: 9,
    });
    expect(workload(directed.sql())).toHaveLength(5);
    const publicArm = recordingTxPool((text) =>
      text.includes('RETURNING id') ? { rows: [{ id: 7 }], rowCount: 1 } : undefined,
    );
    await new PgWocMarketDb(publicArm.pool).escrowInsertListing(SAVE, {
      ...LISTING,
      params: { ...LISTING.params, directedBuyerAccount: null },
    });
    expect(workload(publicArm.sql())).toHaveLength(4);
  });

  it('issues twelve workload statements at the ledger plus one-storage-effect maximum', async () => {
    const batch = serializeBankLedgerCommandBatch('woc.max.query.shape', [
      {
        realm: REALM,
        characterId: SAVE.characterId,
        accountId: LISTING.sellerAccount,
        op: 'deposit',
        itemId: 'peacebloom',
        count: 1,
        instance: null,
        copperDelta: 0,
        purchasedSlotsAfter: 6,
        container: 'personal',
        containerId: null,
      },
    ]);
    const bankLedgerSnapshot: BankLedgerOutboxSnapshot = Object.freeze({
      owner: Object.freeze({
        realm: REALM,
        characterId: SAVE.characterId,
        accountId: LISTING.sellerAccount,
      }),
      batches: Object.freeze([batch]),
      rowCount: 1,
      encodedBytes: batch.encodedBytes,
      guildIds: Object.freeze([]),
      hasUnscopedRows: true,
    });
    const storageEffect: StorageAppliedEffect = {
      realm: REALM,
      accountId: LISTING.sellerAccount,
      characterId: SAVE.characterId,
      itemId: 'strongbox_rung_01',
      expectedCostClaudium: 100,
      idempotencyKey: 'woc-max-query-shape-storage',
      spendClaimToken: '00000000-0000-4000-8000-000000000001',
      purchasedSlotsBefore: 0,
      purchasedSlotsAfter: 6,
    };
    const tx = recordingTxPool((text, values) => {
      if (text.includes('WITH receipt_input AS')) {
        const params = values as unknown[];
        const rowCounts = params[5] as number[];
        return {
          rows: (params[0] as number[]).map((ordinal, index) => ({
            batch_ordinal: ordinal,
            batch_key: (params[1] as string[])[index],
            newly_claimed: true,
            stored_batch_key: (params[1] as string[])[index],
            stored_realm: (params[2] as string[])[index],
            stored_character_id: (params[3] as number[])[index],
            stored_account_id: (params[4] as number[])[index],
            stored_row_count: rowCounts[index],
            stored_payload_sha256: (params[6] as string[])[index],
            inserted_row_count: rowCounts.reduce((sum, count) => sum + count, 0),
          })),
          rowCount: rowCounts.length,
        };
      }
      if (text.includes('FROM storage_purchase_applied_receipts')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM storage_purchases') && text.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              id: 81,
              realm: storageEffect.realm,
              account_id: storageEffect.accountId,
              character_id: storageEffect.characterId,
              item_id: storageEffect.itemId,
              expected_cost_claudium: storageEffect.expectedCostClaudium,
              idempotency_key: storageEffect.idempotencyKey,
              spend_claim_token: storageEffect.spendClaimToken,
              status: 'pending',
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO storage_purchase_applied_receipts')) {
        return { rows: [{ source_purchase_id: 81 }], rowCount: 1 };
      }
      if (text.includes('RETURNING id')) return { rows: [{ id: 41 }], rowCount: 1 };
      return undefined;
    });

    const out = await new PgWocMarketDb(tx.pool).escrowInsertListing(
      { ...SAVE, storageEffects: [storageEffect], bankLedgerSnapshot },
      { ...LISTING, directedOfferId: 9 },
    );
    expect(out).toEqual({ ok: true, id: 41 });
    const workload = tx
      .sql()
      .filter(
        (text) =>
          text !== 'BEGIN' &&
          text !== 'COMMIT' &&
          text !== 'ROLLBACK' &&
          !text.startsWith('SET LOCAL'),
      );
    expect(workload).toHaveLength(12);
    expect(workload.filter((text) => text.includes('FROM accounts'))).toHaveLength(1);
    expect(workload[0]).toContain('FOR NO KEY UPDATE');
    expect(workload.some((text) => text.includes('FOR KEY SHARE'))).toBe(false);
  });

  it('resolveDirectedOffer compare-and-sets on pending and never writes listing_id', () => {
    // The claim must stay narrow: two concurrent accepts both read 'pending',
    // only one UPDATE matches, so only one reaches escrow. The old stamp arm
    // (an accepted-row listing_id write) is deliberately GONE from this
    // statement: reintroducing it would put a second stamp writer beside the
    // atomic one.
    const { pool, workload } = recordingWritePool();
    return new PgWocMarketDb(pool).resolveDirectedOffer(REALM, 3, 'declined').then(() => {
      const [text] = workload();
      expect(text).toContain("status = 'pending'");
      // No listing_id WRITE (RETURNING still projects the column).
      expect(text).not.toContain('listing_id =');
      expect(text).not.toContain('listing_id IS NULL');
    });
  });
});

describe('abandoning a bid is a compare-and-set, not a read-then-write', () => {
  it('narrows on the owner AND the pending status in the statement', async () => {
    // Both arms matter and neither is decorative. The owner arm stops one player
    // cancelling another's bid; the status arm is what makes the button safe to
    // press at all, since a bond can land while the player is reaching for "Not
    // now", and cancelling THEN would drop a bid the auction already counts.
    const { pool, workload, workloadParams } = recordingWritePool();
    await new PgWocMarketDb(pool).abandonPendingBid(REALM, 12, 34);
    const [text] = workload();
    expect(text).toContain("status = 'cancelled'");
    expect(text).toContain("bond_state = 'void'");
    expect(text).toContain("status = 'pending_bond'");
    expect(text).toContain('account = $3');
    expect(text).toContain('realm = $1');
    expect(workloadParams()[0]).toEqual([REALM, 12, 34]);
  });

  it('reports whether it actually matched, so the service can refuse', async () => {
    // rowCount is the only evidence the row was still pending. Returning true
    // unconditionally would tell a player their bid was withdrawn while it was
    // still holding the listing lock.
    const seen: string[] = [];
    const zero = writeClientPool(async (t: string) => {
      seen.push(t);
      return { rows: [], rowCount: 0 };
    });
    expect(await new PgWocMarketDb(zero).abandonPendingBid(REALM, 12, 34)).toBe(false);
    const one = writeClientPool(async () => ({ rows: [], rowCount: 1 }));
    expect(await new PgWocMarketDb(one).abandonPendingBid(REALM, 12, 34)).toBe(true);
  });
});

describe('a finished sale stops being a live offer', () => {
  it('excludes offers whose listing has closed', async () => {
    // Otherwise a completed deal stays in both trade windows forever, showing
    // "Paid" and blocking the same two players from starting a fresh one.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).directedOffersForAccount(REALM, 7, 1_800_000_000_000);
    const [text] = sql();
    expect(text).toContain("l.status <> 'closed'");
    // And an offer with no listing yet (still under review) must survive it.
    expect(text).toContain('o.listing_id IS NULL');
  });

  it('keeps a JUST-closed sale readable, so both sides can see it complete', async () => {
    // The exclusion above, taken alone, is the opposite bug and it shipped: an
    // offer vanished the instant its listing closed, so the client's 'settled'
    // phase was unreachable and the trade window simply emptied. That reads as
    // the item being sent without payment. The grace window is what makes the
    // completion observable, so it is pinned as a THIRD arm of the predicate,
    // not merely as a parameter.
    const { pool, sql, params } = recordingPool();
    const now = 1_800_000_000_000;
    await new PgWocMarketDb(pool).directedOffersForAccount(REALM, 7, now);
    const [text] = sql();
    expect(text).toContain('l.updated_at > $3');
    // Bound to the constant, not to a number repeated here: a test that restates
    // the literal passes when the two drift apart, which is the whole failure.
    expect(params()[0]?.[2]).toEqual(new Date(now - SETTLED_OFFER_GRACE_MS));
    // Long enough that both clients (2s poll) observe it before it drops.
    expect(SETTLED_OFFER_GRACE_MS).toBeGreaterThan(10_000);
  });

  it('keeps a JUST-resolved offer readable too, as an arm of the status predicate', async () => {
    // The verdict read (the honest-endings fix): the side that did NOT
    // decline / withdraw learns the outcome off the lingering row. Its only
    // other guard is the db-gated pg suite, so the always-run floor pins the
    // arm's SHAPE here: an OR inside the status disjunction, on the same $3
    // bound the listing arm rides. Whitespace-collapsed because the
    // statement is reflowed with comments between the arms.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).directedOffersForAccount(REALM, 7, 1_800_000_000_000);
    const text = sql()[0]
      .replace(/--[^\n]*/g, ' ')
      .replace(/\s+/g, ' ');
    expect(text).toContain("o.status IN ('pending', 'accepted') OR o.updated_at > $3");
    // A stable order under same-clock ties: the fake mirrors the id tiebreak.
    expect(text).toContain('ORDER BY o.created_at DESC, o.id DESC LIMIT 50');
  });

  it('joins the LATEST settlement, so a payment in flight is visible', async () => {
    // Without this the seller cannot distinguish a buyer signing in their wallet
    // from a buyer who walked away: both look like "waiting for payment" until
    // the item disappears. ORDER BY id DESC because a buyer may retry, and only
    // the newest attempt describes what is happening now.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).directedOffersForAccount(REALM, 7, 1_800_000_000_000);
    const [text] = sql();
    expect(text).toContain('s.state AS settlement_state');
    expect(text).toContain('woc_market_settlements');
    expect(text).toContain('ORDER BY id DESC LIMIT 1');
  });
});

describe('the bond finality queue, in SQL', () => {
  it('excludes a SIGNED bond from the TTL lapse sweep', async () => {
    // The fake models this too, so the statement is pinned separately: reaping
    // a bond the bidder has already funded voids their money while the chain is
    // still deciding.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).lapsePendingBids(REALM, 1_000, 50);
    expect(sql()[0]).toContain('bond_signature IS NULL');
  });

  it('re-checks only bonds that HAVE a signature', async () => {
    // Without one there is nothing to ask the chain about, and the row belongs
    // to the TTL arm instead.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).confirmingBonds(REALM, 50, []);
    const [text] = sql();
    expect(text).toContain("status = 'pending_bond'");
    expect(text).toContain('bond_signature IS NOT NULL');
  });

  it('a contended signature recorder answers TYPED, recording nothing (both legs)', async () => {
    // The fix round's money-path patience arm: the recorder is the only
    // trace of a broadcast payment, so a 2s lock refusal must answer a
    // typed retryable verdict, never throw into a 500 with the signature
    // unrecorded. Both legs, all three contention codes plus never-started.
    for (const code of ['55P03', '40P01', '25P03']) {
      const contended = writeClientPool(async () => {
        throw Object.assign(new Error('staged contention'), { code });
      });
      expect(await new PgWocMarketDb(contended).submitBondSignature(7, 'sig', 1_000)).toBe(
        'contended',
      );
      expect(await new PgWocMarketDb(contended).submitSettlementSignature(7, 'sig')).toBe(
        'contended',
      );
    }
    const failing = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => {
        throw new Error('timeout exceeded when trying to connect');
      },
    } as unknown as Pool;
    expect(await new PgWocMarketDb(failing).submitBondSignature(7, 'sig', 1_000)).toBe('contended');
    expect(await new PgWocMarketDb(failing).submitSettlementSignature(7, 'sig')).toBe('contended');
    // A non-contention failure still surfaces raw: only the contention
    // classes may stand between a payment and its recording.
    const buggy = writeClientPool(async () => {
      throw new Error('some real bug');
    });
    await expect(new PgWocMarketDb(buggy).submitBondSignature(7, 'sig', 1_000)).rejects.toThrow(
      'some real bug',
    );
  });

  it('records a signature only against a still-pending bid', async () => {
    const { pool, workload } = recordingWritePool();
    await new PgWocMarketDb(pool).submitBondSignature(7, 'sig', 1_000);
    const [text] = workload();
    expect(text).toContain("status = 'pending_bond'");
    // Idempotent on a retry of the SAME signature, so a client re-send is not
    // mistaken for a reuse.
    expect(text).toContain('bond_signature IS NULL OR bond_signature = $2');
    // RETURNING hands back the FIRST recording moment: the caller's extension
    // anchor, so a resubmit cannot re-anchor on a fresh clock.
    expect(text).toContain('RETURNING bond_signature_at');
  });

  it('lapses a decided-against bond only while it is still pending AND unheld', async () => {
    // A bid that activated in the meantime must not be torn down by a late
    // verdict arriving after the fact, and a HELD bond (settled verdict whose
    // activation is retrying) must never void on a reorg-flipped verdict: a
    // voided held bond strands money where no refund arm reads.
    const { pool, workload } = recordingWritePool();
    await new PgWocMarketDb(pool).lapseBid(7);
    const [text] = workload();
    expect(text).toContain("status = 'lapsed'");
    expect(text).toContain("bond_state = 'void'");
    expect(text).toContain("status = 'pending_bond'");
    expect(text).toContain("AND bond_state = 'pending'");
  });
});

describe('the operator reads behind the internal dashboard', () => {
  it('keeps DIRECTED rows out of the listings read', async () => {
    // The player browse withholds directed sales as a security boundary. This
    // read withholds them for a different reason: they are p2p trades and have
    // their own view, where the counterparty is the point. Same predicate,
    // pinned separately, so relaxing one can never quietly relax the other.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).opsListings({
      realm: REALM,
      status: 'active',
      fromMs: 0,
      toMs: 1_000,
      page: 0,
      pageSize: 50,
    });
    expect(sql()[0]).toContain('directed_buyer_account IS NULL');
  });

  it('bounds the window and the page, never scanning the whole table', async () => {
    const { pool, sql, params } = recordingPool();
    await new PgWocMarketDb(pool).opsListings({
      realm: REALM,
      status: 'all',
      fromMs: 1_000,
      toMs: 2_000,
      page: 0,
      // Over the ceiling on purpose: an ops caller must not be able to ask for
      // an unbounded page.
      pageSize: 9_999,
    });
    const [text] = sql();
    expect(text).toContain('created_at >= $2');
    expect(text).toContain('created_at <= $3');
    // 200 cap, +1 for the has-more probe.
    expect(params()[0]).toContain(201);
    // 'all' means no status predicate at all, rather than a list of every value.
    expect(text).not.toContain('status = $4');
  });

  it('pages before joining sale provenance and filters sold or cancelled by resolution', async () => {
    for (const status of ['sold', 'cancelled'] as const) {
      const { pool, sql, params } = recordingPool();
      await new PgWocMarketDb(pool).opsListings({
        realm: REALM,
        status,
        fromMs: 1_000,
        toMs: 2_000,
        page: 3,
        pageSize: 50,
      });
      const [text] = sql();
      expect(text).toContain('WITH listing_page AS MATERIALIZED');
      expect(text).toContain("status = 'closed'");
      expect(text).toContain('resolution = $4');
      expect(params()[0]?.[3]).toBe(status);
      expect(text).toContain('LIMIT $5 OFFSET $6');
      expect(text).toContain('LEFT JOIN LATERAL');
      expect(text).toContain('FROM woc_market_sales sale');
      expect(text).toContain("p.status = 'closed' AND p.resolution = 'sold'");
      expect(text).toContain('sale.excluded = false');
      expect(text).toContain('LIMIT 1');
      expect(text.indexOf('LIMIT $5 OFFSET $6')).toBeLessThan(text.indexOf('LEFT JOIN LATERAL'));
      expect(sql()).toHaveLength(1);
    }
  });

  it('maps buyer provenance onto sold listings and leaves non-sold rows unavailable', async () => {
    const rows = [
      {
        id: 7,
        realm: REALM,
        seller_account: 1,
        seller_character: 2,
        seller_name: 'Seller',
        seller_wallet: 'seller-wallet',
        item: { itemId: 'ember_blade', count: 1 },
        item_id: 'ember_blade',
        quality: 'epic',
        format: 'buy_now',
        start_cents: 100,
        reserve_cents: null,
        buy_now_cents: 500,
        offer_next: false,
        status: 'closed',
        resolution: 'sold',
        item_disposed: true,
        current_bid_cents: null,
        current_bid_id: null,
        ends_at: new Date(1_000),
        base_ends_at: new Date(1_000),
        buy_now_lock_account: null,
        buy_now_lock_expires: null,
        created_at: new Date(500),
        directed_buyer_account: null,
        cancel_requested_at: null,
        sale_buyer_account: 44,
        sale_buyer_name: 'Buyer',
        sold_at: new Date(900),
      },
      {
        id: 6,
        realm: REALM,
        seller_account: 1,
        seller_character: 2,
        seller_name: 'Seller',
        seller_wallet: 'seller-wallet',
        item: { itemId: 'ash_totem', count: 1 },
        item_id: 'ash_totem',
        quality: 'epic',
        format: 'auction',
        start_cents: 100,
        reserve_cents: null,
        buy_now_cents: null,
        offer_next: false,
        status: 'closed',
        resolution: 'cancelled',
        item_disposed: true,
        current_bid_cents: null,
        current_bid_id: null,
        ends_at: new Date(1_000),
        base_ends_at: new Date(1_000),
        buy_now_lock_account: null,
        buy_now_lock_expires: null,
        created_at: new Date(400),
        directed_buyer_account: null,
        cancel_requested_at: null,
        sale_buyer_account: null,
        sale_buyer_name: null,
        sold_at: null,
      },
    ];
    const query = vi.fn(async () => ({ rows, rowCount: rows.length }));
    const result = await new PgWocMarketDb({ query } as unknown as Pool).opsListings({
      realm: REALM,
      status: 'all',
      fromMs: 0,
      toMs: 1_000,
      page: 0,
      pageSize: 50,
    });
    expect(
      result.rows.map((row) => [row.id, row.buyerAccount, row.buyerName, row.soldAtMs]),
    ).toEqual([
      [7, 44, 'Buyer', 900],
      [6, null, null, null],
    ]);
  });

  it('reads p2p trades from OFFERS, so failed attempts are visible', async () => {
    // Sourcing from sales would show the successes and silently omit every
    // declined, withdrawn, expired or unpaid attempt, which is usually the half
    // an operator is looking for.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).opsP2pTrades({
      realm: REALM,
      status: 'all',
      fromMs: 0,
      toMs: 1_000,
      page: 0,
      pageSize: 50,
    });
    const [text] = sql();
    expect(text).toContain('FROM woc_market_directed_offers o');
    // With the outcome joined on, so a completed trade still reports what it
    // settled for and under which signature.
    expect(text).toContain('s.state AS settlement_state');
    expect(text).toContain('s.settled_amount_base');
    expect(text).toContain('ORDER BY id DESC LIMIT 1');
  });

  it('narrows the p2p read by status only when one is asked for', async () => {
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).opsP2pTrades({
      realm: REALM,
      status: 'accepted',
      fromMs: 0,
      toMs: 1_000,
      page: 0,
      pageSize: 50,
    });
    expect(sql()[0]).toContain('o.status = $4');
  });
});

// ---------------------------------------------------------------------------
// DB-free structural pins for the settlement-state guards: the real-Postgres
// suite skips green without TEST_DATABASE_URL, so these hold the shipped DDL
// text (and the fake's mirror of it) in ordinary CI, where the fake-backed
// suites would stay green over a reverted predicate.
// ---------------------------------------------------------------------------

describe('the settlement guards ship their DDL (structural floor)', () => {
  // Strip SQL line comments FIRST (the rationale comments name the same
  // keywords), then collapse whitespace so the pins survive reflowing.
  const strippedSchema = async (): Promise<string> => {
    const { WOC_MARKET_SCHEMA } = await import('../../server/woc_market_db');
    return WOC_MARKET_SCHEMA.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
  };

  it('carries both unique indexes and drops both stale settlement indexes', async () => {
    const schema = await strippedSchema();
    expect(schema).toContain('CREATE UNIQUE INDEX IF NOT EXISTS woc_market_settlements_open2');
    expect(schema).toContain('CREATE UNIQUE INDEX IF NOT EXISTS woc_market_sales_listing_once');
    // The two superseded names: _live (pre-'delivered') and _open
    // (pre-'review'). Each swap creates the wider index FIRST, so these drops
    // must sit AFTER the open2 create (pinned by order below).
    expect(schema).toContain('DROP INDEX IF EXISTS woc_market_settlements_live');
    expect(schema).toContain('DROP INDEX IF EXISTS woc_market_settlements_open;');
    expect(
      schema.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS woc_market_settlements_open2'),
    ).toBeLessThan(schema.indexOf('DROP INDEX IF EXISTS woc_market_settlements_open;'));
    expect(schema).toContain('ON woc_market_sales(listing_id) WHERE excluded = false');
  });

  it('the open-settlement index predicate is exactly the six open states', async () => {
    const schema = await strippedSchema();
    const m = schema.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS woc_market_settlements_open2 ON woc_market_settlements\(listing_id\) WHERE state IN \(([^)]*)\)/,
    );
    expect(m, 'index creation shape').not.toBeNull();
    const states = (m as RegExpMatchArray)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    const { OPEN_SETTLEMENT_STATES } = await import('./helpers/fake_woc_market_db');
    // One list, three holders: the shipped predicate, the fake's mirror, and
    // the literal spelling here. A seventh state (or a dropped sixth) fails
    // all three comparisons. 'review' is open BY RULING: the payment may have
    // landed, so its listing must never re-auction around it.
    expect(states).toEqual([
      'offered',
      'confirming',
      'review',
      'confirmed',
      'delivering',
      'delivered',
    ]);
    expect([...OPEN_SETTLEMENT_STATES]).toEqual(states);
    expect(states).not.toContain('failed');
    expect(states).not.toContain('expired');
  });

  it('the cancel-intent paid probe reads exactly OPEN minus offered, under the idle bound', async () => {
    // The probe's subset is a second spelling of the open-states list: pin
    // the relationship (paid = OPEN without 'offered') so the two cannot
    // drift apart, and pin that the cancel guard runs under BOTH transaction
    // bounds now that the intent work added round trips inside its lock
    // window.
    const { pool, sql } = recordingTxPool((text) =>
      text.includes('FROM woc_market_listings') && text.includes('FOR NO KEY UPDATE')
        ? {
            rows: [
              {
                seller_account: 3,
                status: 'active',
                buy_now_lock_account: 9,
                buy_now_lock_expires: new Date(2_000),
              },
            ],
            rowCount: 1,
          }
        : text.includes('FROM woc_market_settlements') || text.includes('FROM woc_market_bids')
          ? { rows: [], rowCount: 0 }
          : undefined,
    );
    const out = await new PgWocMarketDb(pool).cancelListingIfUnbid('realm-1', 7, 3, 1_000);
    expect(out).toBe('cancel_pending');
    const paidProbe = sql().find((t) => t.includes('FROM woc_market_settlements'));
    // DERIVED from the production DDL, not a second literal: parse the open2
    // predicate and drop 'offered', so the probe can only drift by failing
    // here (the sibling test owns the open list's own shape).
    const schema = await strippedSchema();
    const m = schema.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS woc_market_settlements_open2 ON woc_market_settlements\(listing_id\) WHERE state IN \(([^)]*)\)/,
    );
    expect(m, 'open2 predicate').not.toBeNull();
    const open = (m as RegExpMatchArray)[1].split(',').map((s) => s.trim());
    expect(paidProbe).toContain(`state IN (${open.filter((s) => s !== "'offered'").join(', ')})`);
    expect(sql().some((t) => t.includes('SET LOCAL lock_timeout'))).toBe(true);
    expect(
      sql().some((t) => t.includes('SET LOCAL idle_in_transaction_session_timeout = 2000')),
    ).toBe(true);
  });

  it('the settlements state CHECK evolves in place and carries review', async () => {
    const schema = await strippedSchema();
    // Fresh tables get the widened inline CHECK; legacy tables get the gated
    // DROP+ADD (the gate reads the constraint text, so it runs once).
    expect(schema).toContain(
      "CHECK (state IN ('offered', 'confirming', 'review', 'confirmed', 'delivering', 'delivered', 'expired', 'failed'))",
    );
    expect(schema).toContain("pg_get_constraintdef(oid) NOT LIKE '%''review''%'");
    expect(schema).toContain(
      'ALTER TABLE woc_market_settlements DROP CONSTRAINT woc_market_settlements_state_check',
    );
    expect(schema).toContain(
      'ALTER TABLE woc_market_settlements ADD CONSTRAINT woc_market_settlements_state_check',
    );
  });

  it('every boot repair gates on index VALIDITY, and every create drops an invalid carcass', async () => {
    const schema = await strippedSchema();
    // The repair gates: an INVALID carcass must re-open the repair, so the
    // gate reads pg_index.indisvalid through the search_path-aware
    // to_regclass house idiom (a hardcoded nspname breaks the runs-once
    // property under a non-public search_path), never bare existence.
    // One arm per repair-plus-unique-index pair; a NEW pair joins this list
    // in the same change or this pin is exactly how its omission hides.
    const guardedIndexes = [
      'woc_market_settlements_open2',
      'woc_market_sales_listing_once',
      'woc_market_offers_pair_pending',
    ];
    for (const name of guardedIndexes) {
      expect(schema).toContain(`WHERE i.indexrelid = to_regclass('${name}') AND i.indisvalid`);
      // The carcass drop ahead of each CREATE (IF NOT EXISTS matches by name
      // and would keep an index that enforces nothing).
      expect(schema).toContain(`WHERE i.indexrelid = to_regclass('${name}') AND NOT i.indisvalid`);
      expect(schema).toContain(`EXECUTE 'DROP INDEX ${name}'`);
    }
    // The REVERSE sweep, parsed from the schema itself: every unique index
    // the boot DDL creates in the CREATE UNIQUE INDEX IF NOT EXISTS form
    // (the matcher's exact shape; a create WITHOUT IF NOT EXISTS would
    // escape it, and none exists) is either repair-backed (guardedIndexes)
    // or named below with the reason it legitimately rides NO repair. A new
    // repair-plus-unique-index pair cannot land outside guardedIndexes, and
    // a new repairless unique index of this form must state its reason
    // here. Column-level UNIQUE constraints (bond_reference, tx_signature)
    // are outside this sweep's reach: they cannot carry a carcass-drop
    // convention and their names are minted by Postgres, so the pin
    // deliberately covers only the named form.
    const repairlessUniqueIndexes = new Map([
      [
        'woc_market_buy_now_abandons_once',
        'shipped in the same commit as its table: no rows predate the bound',
      ],
      [
        'woc_market_bids_bond_signature',
        'signature replay bound on a fresh column: nothing predates it',
      ],
    ]);
    const created = [...schema.matchAll(/CREATE UNIQUE INDEX IF NOT EXISTS (\w+)/g)]
      .map((m) => m[1])
      .sort();
    expect(created).toEqual([...guardedIndexes, ...repairlessUniqueIndexes.keys()].sort());
  });

  it('the settlements repair ranks every open state above the ELSE arm', async () => {
    const schema = await strippedSchema();
    // The survivor CASE and the index predicate must stay in lockstep: a
    // state added to the predicate but not ranked here would fall to ELSE 1
    // and the repair would prefer to demote it. 'offered' rides ELSE 1 by
    // construction (the lowest rank), so five WHEN arms cover the other five.
    expect(schema).toContain(
      "CASE state WHEN 'delivered' THEN 6 WHEN 'delivering' THEN 5 WHEN 'confirmed' THEN 4 WHEN 'review' THEN 3 WHEN 'confirming' THEN 2 ELSE 1 END",
    );
    // The forensic demotion marker keeps any prior reason attached.
    expect(schema).toContain("fail_reason = 'schema_dedupe' || COALESCE(':' || fail_reason, '')");
  });

  it('carries the intent columns additively, plus the readout and rotation indexes', async () => {
    const schema = await strippedSchema();
    // Same additive rule as directed_buyer_account: the claims table exists on
    // deployed realms, so the columns must ride ALTER, never only CREATE TABLE.
    expect(schema).toContain('ADD COLUMN IF NOT EXISTS grant_character_id');
    expect(schema).toContain('ADD COLUMN IF NOT EXISTS mail_intent_at');
    // The rotation column is additive on BOTH rotated tables.
    expect(schema).toContain(
      'ALTER TABLE woc_market_settlements ADD COLUMN IF NOT EXISTS sweep_parked_at TIMESTAMPTZ',
    );
    expect(schema).toContain(
      'ALTER TABLE woc_market_listings ADD COLUMN IF NOT EXISTS sweep_parked_at TIMESTAMPTZ',
    );
    // The stuck-custody readout's indexes: the monitor reads unbooked claims
    // and aged delivering settlements through them, so their predicates are
    // load-bearing, not decorative (the delivering class ages and orders on
    // updated_at, stamped at the delivering claim; park rotation writes only
    // sweep_parked_at, so the age signal never moves on a park).
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_custody_claims_unbooked ' +
        'ON woc_market_custody_claims(realm, claimed_at) WHERE booked_at IS NULL',
    );
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_settlements_state_updated ' +
        'ON woc_market_settlements(realm, state, updated_at)',
    );
    // The batch-rotation partials spell PARK_ROTATION_ORDER verbatim (an
    // expression index only serves a query with the identical text), and the
    // superseded full created_at index is dropped, not left to rot.
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_settlements_delivering_rotation ' +
        "ON woc_market_settlements(realm, (COALESCE(sweep_parked_at, updated_at))) WHERE state = 'delivering'",
    );
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_listings_undisposed_rotation ' +
        'ON woc_market_listings(realm, (COALESCE(sweep_parked_at, updated_at))) ' +
        "WHERE status = 'closed' AND item_disposed = false",
    );
    expect(schema).toContain('DROP INDEX IF EXISTS woc_market_settlements_state_created');
    // The redrive page walk and the sold-residue probe get their partials.
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_listings_live_ids ' +
        "ON woc_market_listings(realm, id) WHERE status <> 'closed'",
    );
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_listings_sold_undisposed ' +
        'ON woc_market_listings(realm, id) ' +
        "WHERE status = 'closed' AND item_disposed = false AND resolution = 'sold'",
    );
    // The booked-claims retention cursor: partial on the prune's own
    // predicate, so the nightly batch walks oldest-first without a sort and
    // the unbooked operator queue stays outside the index entirely.
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_custody_claims_booked ' +
        'ON woc_market_custody_claims(booked_at) WHERE booked_at IS NOT NULL',
    );
    // price_desc browse sort: its own DESC-expression index (the columns are
    // pinned in full because live_price is a NAME PREFIX of this one, so a
    // name-only pin could not tell them apart). The ASC id tiebreak is shared
    // with price_asc for page stability, which is exactly why a backward scan
    // of the ASC index cannot serve this sort.
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_listings_live_price_desc ' +
        'ON woc_market_listings(realm, COALESCE(current_bid_cents, start_cents) DESC, id) ' +
        "WHERE status <> 'closed'",
    );
    // The offers reads' LATERAL latest-settlement probe (listing_id = ...
    // ORDER BY id DESC LIMIT 1) seeks its composite; it supersedes the
    // single-column FK index, which is dropped, not left to rot. The
    // trailing 'ON'/';' anchors matter: _listing is a NAME PREFIX of
    // _listing_latest.
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_settlements_listing_latest ' +
        'ON woc_market_settlements(listing_id, id DESC)',
    );
    expect(schema).not.toContain('CREATE INDEX IF NOT EXISTS woc_market_settlements_listing ON');
    expect(schema).toContain('DROP INDEX IF EXISTS woc_market_settlements_listing;');
    // Create-before-drop: a boot must never leave the FK column uncovered,
    // even transiently, on a box replaying the schema mid-upgrade.
    expect(
      schema.indexOf('CREATE INDEX IF NOT EXISTS woc_market_settlements_listing_latest'),
    ).toBeLessThan(schema.indexOf('DROP INDEX IF EXISTS woc_market_settlements_listing;'));
  });

  it('makes custody_ref the claims table PRIMARY KEY, which is what makes a claim unique', async () => {
    // The book-once ledger's whole guarantee rests on ONE row per ref: without
    // the key, claimCustodyRef's ON CONFLICT arm has nothing to conflict on and
    // two passes both read fresh, both stamp an intent, and both deliver.
    const schema = await strippedSchema();
    expect(schema).toContain('custody_ref TEXT PRIMARY KEY');
  });
});

// ---------------------------------------------------------------------------
// The delivery close tail and the custody claim primitives. The real-Postgres
// crash-matrix suite (tests/woc_market_delivery_pg_integration.test.ts) skips
// green without TEST_DATABASE_URL, so the statement shapes that make delivery
// exactly-once are ALSO pinned here, where ordinary CI always runs.
// ---------------------------------------------------------------------------

/** A pool whose transactions run on a recording CLIENT (withTx methods call
 *  pool.connect()). Every statement lands in one sequence; the listing lock
 *  read answers one open row so the tail past it is reachable. An optional
 *  responder overrides the answer for chosen statements (e.g. a close CAS
 *  that matches nothing, driving the already_final arm). */
function recordingTxPool(
  respond?: (text: string, values?: unknown[]) => { rows: unknown[]; rowCount: number } | undefined,
): {
  pool: Pool;
  sql: () => string[];
} {
  const seen: string[] = [];
  const query = async (text: string, values?: unknown[]) => {
    seen.push(text);
    const forced = respond?.(text, values);
    if (forced) return forced;
    if (text.includes('FROM accounts') && text.includes('FOR NO KEY UPDATE')) {
      return { rows: [{ id: Number(values?.[0]) }], rowCount: 1 };
    }
    if (text.includes('FROM woc_market_listings') && text.includes('FOR NO KEY UPDATE')) {
      return { rows: [{ status: 'settling' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  };
  // on/removeListener: withTx watches the client's async 'error' event for
  // the session-termination SQLSTATE; the recorder never emits one.
  const client = { query, release: () => {}, on: () => {}, removeListener: () => {} };
  const pool = { query, connect: async () => client } as unknown as Pool;
  return { pool, sql: () => seen };
}

/** A raw settlements row (snake_case, as pg returns it) for page fixtures. */
const settlementRowFixture = (id: number, listingId: number) => ({
  id,
  listing_id: listingId,
  bid_id: null,
  attempt: 1,
  buyer_account: 1,
  buyer_character: 1,
  buyer_name: 'b',
  buyer_wallet: 'w',
  amount_cents: 100,
  state: 'delivered',
  quote_reference: null,
  quote_expires: null,
  settled_amount_base: null,
  tx_signature: null,
  fail_reason: null,
  deadline_at: new Date(0),
  created_at: new Date(0),
});

const FINALIZE_ARGS = {
  settlementId: 5,
  listingId: 9,
  bidId: 3,
  sale: {
    realm: REALM,
    listingId: 9,
    itemId: 'sword',
    item: { itemId: 'sword', count: 1 },
    priceCents: 5000,
    amountBase: null,
    sellerAccount: 1,
    buyerAccount: 2,
    sellerName: 'S',
    buyerName: 'B',
  },
} as const;

describe('every guard transaction bounds its idle holds', () => {
  it('every explicit row lock is FOR NO KEY UPDATE: no plain FOR UPDATE remains (completeness)', async () => {
    // The write-path rider's narrowing pass, held as a ratchet: plain FOR
    // UPDATE conflicts with the FOR KEY SHARE every FK-child INSERT takes
    // (a bid against a guarded listing, an abandon against the escrow-held
    // accounts row), and no guard here relies on that conflict for
    // correctness (guard-vs-guard exclusion survives because NO KEY UPDATE
    // conflicts with itself). A regressed site would matter most exactly
    // where it is least visible, so the counts are exact: zero plain
    // clauses, and the narrowed count moves in the same change as any new
    // lock site. Comment-stripped: the history notes legitimately name the
    // old mode. The pg battery proves the behavioral halves (self-conflict
    // preserved, FK-child inserts freed with a plain-mode negative
    // control); this floor keeps the SQL text from drifting back.
    const { stripComments } = await import('../helpers/strip_comments');
    const src = stripComments(
      readFileSync(new URL('../../server/woc_market_db.ts', import.meta.url), 'utf8'),
    );
    const narrowed = src.match(/FOR NO KEY UPDATE/g) ?? [];
    expect(narrowed).toHaveLength(20);
    // 'FOR NO KEY UPDATE' does not contain the substring 'FOR UPDATE', so a
    // plain match here is a real regressed clause, not a narrowed one.
    expect(src.match(/FOR UPDATE/g) ?? []).toEqual([]);
    // The five sweep claims keep their non-blocking shape in the same mode.
    expect(src.match(/FOR NO KEY UPDATE( OF \w+)? SKIP LOCKED/g) ?? []).toHaveLength(5);
    // The escrow account lock moved behind the opaque save-effect proof seam.
    // Count its exact stronger lock separately so relocating the SQL cannot
    // make the marketplace-wide narrowing floor silently shrink.
    const saveEffectsSrc = stripComments(
      readFileSync(new URL('../../server/bank_ledger_save_effects_db.ts', import.meta.url), 'utf8'),
    );
    expect(saveEffectsSrc.match(/FOR NO KEY UPDATE/g) ?? []).toHaveLength(1);
    expect(saveEffectsSrc.match(/FOR UPDATE/g) ?? []).toEqual([]);
    // And no sibling module quietly grows its own lock clause outside this
    // scan (the review round's durability note). DISCOVERED, not enumerated:
    // a hand-kept list cannot see a NEW server/woc_market_*.ts module, which
    // is exactly the case the note is about, so every marketplace module
    // except the counted db one is swept and carries a flat zero.
    const serverDir = fileURLToPath(new URL('../../server', import.meta.url));
    const siblings = readdirSync(serverDir)
      .filter((f) => f.startsWith('woc_market') && f.endsWith('.ts') && f !== 'woc_market_db.ts')
      .sort();
    // Non-vacuity: a glob that discovered nothing would satisfy every absence
    // check below. The floor is the module count at the write-path rider.
    expect(siblings.length).toBeGreaterThanOrEqual(16);
    for (const sibling of siblings) {
      const sib = stripComments(readFileSync(join(serverDir, sibling), 'utf8'));
      expect(sib.length, sibling).toBeGreaterThan(0);
      expect(sib.includes('FOR UPDATE'), sibling).toBe(false);
      expect(sib.includes('FOR NO KEY UPDATE'), sibling).toBe(false);
    }
  });

  it('every row-writing statement is ROUTED through the bounded seam (routing completeness)', async () => {
    // The workload() rigs deliberately filter the envelope, so a writer
    // reverted to this.pool.query would keep its per-writer pin green (the
    // audit round's blocking find). This pin closes the routing direction
    // the way the narrowing pin closes the mode: exact counts over the
    // comment-stripped source. Every this.pool.query whose statement writes
    // (UPDATE/INSERT/DELETE) must be one of the five sanctioned SKIP LOCKED
    // sweep claims; everything else rides boundedWrite.
    const { stripComments } = await import('../helpers/strip_comments');
    const src = stripComments(
      readFileSync(new URL('../../server/woc_market_db.ts', import.meta.url), 'utf8'),
    );
    // 38 -> 39 with the category-stamp backfill write (stampListingCategory).
    // 39 -> 40 with the parked-review realm-scoped CAS (transitionSettlementInRealm).
    expect(src.match(/this\.boundedWrite\(/g) ?? []).toHaveLength(40);
    const poolCalls = src.split('this.pool.query(').slice(1);
    // CLASSIFICATION TOTALITY first: the verb test below can only read a
    // statement written INLINE, so a call whose first argument is an
    // identifier (the hoisted-SQL idiom this same file already uses, e.g.
    // boundedWrite(RECORD_ABANDON_SQL, ...)) would classify as a read and
    // escape both counts silently. Every site must therefore open with a
    // string or template literal; an unclassifiable one reds here instead of
    // slipping through as an un-routed writer.
    for (const slice of poolCalls) {
      expect(
        /^\s*[`'"]/.test(slice),
        `every this.pool.query site opens with an inline statement, got: ${slice.slice(0, 60)}`,
      ).toBe(true);
    }
    // The verb must LEAD the statement (a read whose trailing slice brushes
    // a neighboring function's write would otherwise misclassify).
    const writingDirect = poolCalls.filter((slice) =>
      /^\s*[`'"]?\s*(UPDATE|INSERT|DELETE)\b/.test(slice.slice(0, 60)),
    );
    for (const slice of writingDirect) {
      expect(slice.slice(0, 900)).toContain('SKIP LOCKED');
    }
    expect(writingDirect).toHaveLength(5);
  });

  it('carries the idle-in-transaction bound at EVERY withTx site (completeness, comment-stripped)', async () => {
    // The retrofit rule: a guard transaction that can sit idle between
    // statements camps a shared-pool client, so every one carries the 25P03
    // bound. Counted against the withTx sites so a NEW guard transaction
    // cannot ship without it (the count moves in the same change, on
    // purpose). The SHARED stripper, not local regexes: the block-before-line
    // order this floor first used is exactly the form strip_comments.ts
    // documents as silently exempting whole spans.
    const { stripComments } = await import('../helpers/strip_comments');
    const src = stripComments(
      readFileSync(new URL('../../server/woc_market_db.ts', import.meta.url), 'utf8'),
    );
    // The call may carry an explicit generic (this.withTx<T>(...): the
    // insertPendingBid contended-tail shape), so match both forms.
    const txSites = src.match(/this\.withTx(<[^>\n]+>)?\(/g) ?? [];
    const idleBounds = src.match(/SET LOCAL idle_in_transaction_session_timeout/g) ?? [];
    // 13 since the write-path rider: the twelve guard transactions plus the
    // ONE bounded plain-write seam (boundedWrite), which routes every
    // direct row-locking writer through the same two bounds.
    expect(txSites.length).toBe(13);
    expect(idleBounds.length).toBe(txSites.length);
    // DISTRIBUTION, not just the count: a copy-paste retrofit can double one
    // site and skip another with the totals intact. Every withTx callback
    // must carry the bound near its head (the SET LOCALs open each guard).
    const slices = src.split(/this\.withTx(?:<[^>\n]+>)?\(/).slice(1);
    expect(slices.length).toBe(13);
    for (const [i, slice] of slices.entries()) {
      expect(
        slice.slice(0, 1600).includes('SET LOCAL idle_in_transaction_session_timeout'),
        `withTx site ${i + 1} carries the idle bound near its head`,
      ).toBe(true);
      // The lock-wait bound reached the last two holdouts (insertPendingBid,
      // activateBid) with the retention round, so the floor ratchets: every
      // guard transaction now bounds BOTH how long it waits for a row lock
      // and how long it may idle while holding one. The FULL literal per
      // slice, so a doubled site cannot mask a sibling on a different
      // constant while the total stays right.
      expect(
        slice.slice(0, 1600).includes('SET LOCAL lock_timeout = ${ESCROW_LOCK_TIMEOUT_MS}'),
        `withTx site ${i + 1} carries the lock-wait bound near its head`,
      ).toBe(true);
    }
    const lockBounds = src.match(/SET LOCAL lock_timeout = \$\{ESCROW_LOCK_TIMEOUT_MS\}/g) ?? [];
    expect(lockBounds.length).toBe(txSites.length);
    // The bound is TWO-TIER: exactly the two save-bearing transactions
    // (escrowInsertListing, saveDeliveredCharacterBooked) carry the wider
    // save bound, because they serialize a character blob between
    // statements; every other guard carries the 2s bound. A site quietly
    // switching tiers is a policy change, not a tidy-up.
    // 3 since the write-path rider's fix round: the two save-bearing guards
    // plus the bounded plain-write seam, which moved OFF the 2s guard tier
    // on the save-site argument (its round-trip gaps are pure protocol
    // idle, and a 2s idle kill there destroys a pooled client across the
    // widest write surface in the market).
    expect(src.match(/\$\{SAVE_IDLE_TX_TIMEOUT_MS\}/g)).toHaveLength(3);
    expect(src.match(/\$\{GUARD_IDLE_TX_TIMEOUT_MS\}/g)).toHaveLength(10);
  });
});

describe('the delivery close tail is ONE transaction, in SQL', () => {
  it('runs the whole tail between one BEGIN and one COMMIT, waits bounded', async () => {
    const { pool, sql } = recordingTxPool();
    expect(
      await new PgWocMarketDb(pool).finalizeDeliveredSettlement(structuredClone(FINALIZE_ARGS)),
    ).toBe('finalized');
    const seq = sql();
    expect(seq[0]).toBe('BEGIN');
    expect(seq.at(-1)).toBe('COMMIT');
    expect(seq[1]).toContain('SET LOCAL lock_timeout');
    // The connection-camping bound rides every guard transaction now (the
    // idle-in-transaction retrofit).
    expect(seq[2]).toContain('SET LOCAL idle_in_transaction_session_timeout');
    // The whole tail holds the listing plus bid locks, so it carries the
    // heavy statement allowance too (the pool default would abort a slow
    // money-path commit mid-flight).
    expect(seq[3]).toContain('SET LOCAL statement_timeout');
    // Every write the old code committed separately now sits inside the one
    // transaction: the CAS, the sale, the close, the dispose, the bond flips.
    const inside = seq.slice(1, -1).join('\n');
    expect(inside).toContain('UPDATE woc_market_settlements');
    expect(inside).toContain('INSERT INTO woc_market_sales');
    expect(inside).toContain("SET status = 'closed'");
    expect(inside).toContain('item_disposed = true');
    expect(inside).toContain("SET bond_state = 'refund_due'");
    // The settlement CAS clears the rotation stamp on the terminal move.
    const cas = seq.find((t) => t.includes("SET state = 'delivered'"));
    expect(cas).toContain('sweep_parked_at = NULL');
    // Close and dispose share ONE statement (two UPDATEs on the same row per
    // sale doubled the version churn), an already-closed row keeps its
    // resolution, and the WHERE makes it a real compare-and-set (the
    // already_final downgrade reads its rowCount).
    const closeStmt = seq.find((t) => t.includes("SET status = 'closed'"));
    expect(closeStmt).toContain('item_disposed = true');
    expect(closeStmt).toContain("CASE WHEN status = 'closed' THEN resolution ELSE $2 END");
    expect(closeStmt).toContain("(status <> 'closed' OR item_disposed = false)");
    expect(closeStmt).toContain('sweep_parked_at = NULL');
  });

  it('reports already_final when the close CAS matches nothing', async () => {
    // A re-run over a closed-and-disposed listing converges nothing new: the
    // caller must neither count it as fresh work nor re-send the seller
    // notice, and the verdict is what carries that.
    const { pool } = recordingTxPool((text) =>
      text.includes("SET status = 'closed'") ? { rows: [], rowCount: 0 } : undefined,
    );
    expect(
      await new PgWocMarketDb(pool).finalizeDeliveredSettlement(structuredClone(FINALIZE_ARGS)),
    ).toBe('already_final');
  });

  it('locks bids FIRST (open set plus the winner, by id), the listing second, then RE-LOCKS', async () => {
    // The file-wide lock order: the reverse deadlocks against the suspend and
    // activate guards, which pre-lock the bid set the same way. The SECOND
    // bid lock, after the listing lock is held, is load-bearing on its own: a
    // buy-now finalize runs while the listing is still 'active', so a bid
    // inserted between the pre-lock and the listing lock (insertPendingBid is
    // listing-lock-first) would otherwise reach the cancel UPDATE unlocked.
    const { pool, sql } = recordingTxPool();
    await new PgWocMarketDb(pool).finalizeDeliveredSettlement(structuredClone(FINALIZE_ARGS));
    const seq = sql();
    const bidLocks = seq
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => t.includes('FROM woc_market_bids') && t.includes('FOR NO KEY UPDATE'));
    const listingLock = seq.findIndex(
      (t) => t.includes('FROM woc_market_listings') && t.includes('FOR NO KEY UPDATE'),
    );
    expect(bidLocks, 'exactly the pre-lock and the re-lock').toHaveLength(2);
    const [preLock, reLock] = bidLocks;
    expect(preLock.i).toBeGreaterThan(0);
    expect(listingLock).toBeGreaterThan(preLock.i);
    expect(reLock.i, 'the re-lock runs AFTER the listing lock').toBeGreaterThan(listingLock);
    expect(preLock.t).toContain('ORDER BY id');
    expect(preLock.t, 'the winner bid joins the pre-lock set').toContain('OR id = $2');
    expect(reLock.t).toContain('ORDER BY id');
    expect(reLock.t, 'the re-lock covers only the OPEN set').not.toContain('OR id = $2');
  });

  it('accepts delivering AND delivered, which is what makes the re-drive converge', async () => {
    const { pool, sql } = recordingTxPool();
    await new PgWocMarketDb(pool).finalizeDeliveredSettlement(structuredClone(FINALIZE_ARGS));
    const cas = sql().find((t) => t.includes('UPDATE woc_market_settlements'));
    expect(cas).toContain("state IN ('delivering', 'delivered')");
  });

  it('dedupes the sale on the provenance index, never by throwing', async () => {
    const { pool, sql } = recordingTxPool();
    await new PgWocMarketDb(pool).finalizeDeliveredSettlement(structuredClone(FINALIZE_ARGS));
    const insert = sql().find((t) => t.includes('INSERT INTO woc_market_sales'));
    expect(insert).toContain('ON CONFLICT (listing_id) WHERE excluded = false DO NOTHING');
  });

  it('demotes every still-open loser in ONE statement, bond flip included', async () => {
    const { pool, sql } = recordingTxPool();
    await new PgWocMarketDb(pool).finalizeDeliveredSettlement(structuredClone(FINALIZE_ARGS));
    const demote = sql().find(
      (t) => t.includes("SET status = 'cancelled'") && t.includes('woc_market_bids'),
    );
    expect(demote).toContain("CASE WHEN bond_state = 'held' THEN 'refund_due' ELSE bond_state END");
    expect(demote).toContain("status IN ('pending_bond', 'active')");
  });

  it('both teardowns carve out the paid-but-undecided bond, in the statement', async () => {
    // The payment-loss fix itself: a signed, unheld bond must stay with the
    // bond poll, so BOTH cancel-everything UPDATEs (the finalize demote and
    // the suspend teardown) carry the NOT arm. Deleting it from either
    // orphans money in flight and only a Postgres-gated run would notice.
    const carveOut =
      "NOT (status = 'pending_bond' AND bond_signature IS NOT NULL\n              AND bond_state = 'pending')";
    const finalize = recordingTxPool();
    await new PgWocMarketDb(finalize.pool).finalizeDeliveredSettlement(
      structuredClone(FINALIZE_ARGS),
    );
    const demote = finalize
      .sql()
      .find((t) => t.includes("SET status = 'cancelled'") && t.includes('woc_market_bids'));
    expect(demote?.replace(/\s+/g, ' ')).toContain(carveOut.replace(/\s+/g, ' '));
    const suspend = recordingTxPool((text) => {
      if (text.includes('FROM woc_market_listings') && text.includes('FOR NO KEY UPDATE')) {
        return { rows: [{ status: 'active', buy_now_lock_account: null }], rowCount: 1 };
      }
      // The open-settlement re-check must find nothing, or the transaction
      // aborts settlement_live before ever reaching the teardown.
      if (text.includes('SELECT 1 FROM woc_market_settlements')) {
        return { rows: [], rowCount: 0 };
      }
      // The close RETURNING feeds toListing; a minimal raw row keeps the
      // transaction completing so every captured statement is committed.
      if (text.includes('UPDATE woc_market_listings') && text.includes("'suspended'")) {
        return { rows: [{ id: 7, realm: REALM, item: {} }], rowCount: 1 };
      }
      return undefined;
    });
    await new PgWocMarketDb(suspend.pool).suspendListingIfSafe(REALM, 7, 1_000);
    // Narrowed past the expiry CTE (which also cancels, but only 'won' rows):
    // the teardown is the statement over the open set.
    const teardown = suspend
      .sql()
      .find(
        (t) =>
          t.includes("SET status = 'cancelled'") &&
          t.includes("status IN ('pending_bond', 'active')"),
      );
    expect(teardown?.replace(/\s+/g, ' ')).toContain(carveOut.replace(/\s+/g, ' '));
  });
});

describe('the bond and lock lifecycle statements, in SQL', () => {
  it('setBidBondQuote refreshes only an UNPAID quote, in the statement', async () => {
    const { pool, workload, workloadParams } = recordingWritePool();
    await new PgWocMarketDb(pool).setBidBondQuote(3, 'ref', 1_000, 82);
    const [text] = workload();
    expect(text).toContain("status = 'pending_bond'");
    expect(text, 'the signature arm is the CAS').toContain('bond_signature IS NULL');
    expect(text, 'the adopted service figure rides the same guarded write').toContain(
      'bond_cents = $4',
    );
    expect(workloadParams()[0]).toEqual([3, 'ref', 1_000, 82]);
  });

  it('abandonPendingBid refuses to void a signed bond, in the statement', async () => {
    const { pool, workload } = recordingWritePool();
    await new PgWocMarketDb(pool).abandonPendingBid(REALM, 3, 4);
    const [text] = workload();
    expect(text, 'a signed bond may be riding real money').toContain('bond_signature IS NULL');
  });

  it('overdueSettlements is single-arm; the H15 bound rides its own sibling read', async () => {
    // The two arms are SEPARATE reads by ruling: sharing one batch let a
    // confirming backlog (oldest deadlines by construction) own the batch
    // head and starve the offered/failed expiry work behind it, and the OR
    // lost the ordered-index pushdown for both.
    const { pool, sql, params } = recordingPool();
    await new PgWocMarketDb(pool).overdueSettlements(REALM, 2_000, 25);
    const [text] = sql();
    expect(text).toContain("state IN ('offered', 'failed') AND deadline_at <= to_timestamp($2");
    expect(text, 'the confirming arm must NOT share this batch').not.toContain("'confirming'");
    expect(params()[0]).toEqual([REALM, 2_000, 25]);
  });

  it('the stuckBonds sample orders on the INDEXED placed_at, never the age COALESCE', async () => {
    // The COALESCE ORDER has no matching expression index, so it top-N
    // sorted every signed pending bond in the realm per 30s refresh
    // (measured about 4,000 buffers at 5k confirming bonds), degrading
    // exactly during the incident the readout reports. placed_at is served
    // ordered by the partial bond_confirming index; stuck_since stays the
    // honest per-row age projection.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).stuckCustodyReadout(REALM, 1_000, 20, 1_000, 2_000);
    const sample = sql().find((t) => t.includes('AS stuck_since'));
    expect(sample, 'the bond sample query exists').toBeDefined();
    expect(sample).toContain('ORDER BY placed_at');
    expect(sample).not.toContain('ORDER BY COALESCE');
    expect(sample).toContain('COALESCE(bond_signature_at, placed_at) AS stuck_since');
  });

  it('confirmingOverdueSettlements ages on updated_at with its own budget', async () => {
    const { pool, sql, params } = recordingPool();
    await new PgWocMarketDb(pool).confirmingOverdueSettlements(REALM, 1_000, 25);
    const [text] = sql();
    expect(text, 'the H15 arm ages confirming on updated_at').toContain(
      "state = 'confirming' AND updated_at <= to_timestamp($2",
    );
    expect(text, 'ordered on the age axis so the oldest park first').toContain(
      'ORDER BY updated_at',
    );
    expect(params()[0]).toEqual([REALM, 1_000, 25]);
  });

  it('confirmingBonds rotates on poll_parked_at and honors the backoff exclusion', async () => {
    const { pool, sql, params } = recordingPool();
    await new PgWocMarketDb(pool).confirmingBonds(REALM, 25, [7, 9]);
    const [text] = sql();
    expect(text).toContain('ORDER BY COALESCE(poll_parked_at, placed_at)');
    expect(text).toContain('id <> ALL($3::bigint[])');
    expect(params()[0]).toEqual([REALM, 25, [7, 9]]);
  });

  it('touchBidPollRow writes the rotation stamp ONLY, never the age column', async () => {
    const { pool, workload } = recordingWritePool();
    await new PgWocMarketDb(pool).touchBidPollRow(7);
    const [text] = workload();
    expect(text).toContain('SET poll_parked_at = now()');
    expect(text).not.toContain('placed_at');
  });

  it('a bounded plain write carries the guard bounds in one short transaction (raw shape)', async () => {
    // The write-path rider's seam, pinned RAW exactly once: every direct
    // row-locking writer rides this five-statement envelope, so a contended
    // row refuses at the 2s lock ceiling as a counted 55P03 instead of
    // camping a pooled client for the 15s session default. The per-writer
    // pins above assert through workload() and never see the envelope; this
    // is the one place its shape is load-bearing.
    const { pool, sql, workload } = recordingWritePool();
    await new PgWocMarketDb(pool).touchBidPollRow(7);
    const raw = sql();
    // FOUR statements since the fix round: both bounds ride ONE
    // unparameterized query (each extra round trip here is a pure protocol
    // gap Postgres reads as idle-in-transaction), and the idle bound is the
    // SAVE tier, not the 2s guard tier, so an ordinary event-loop stall
    // cannot 25P03-kill a pooled client across the whole write surface.
    expect(raw).toHaveLength(4);
    expect(raw[0]).toBe('BEGIN');
    expect(raw[1]).toBe(
      `SET LOCAL lock_timeout = ${ESCROW_LOCK_TIMEOUT_MS}; SET LOCAL idle_in_transaction_session_timeout = ${SAVE_IDLE_TX_TIMEOUT_MS}`,
    );
    expect(raw[2]).toContain('UPDATE woc_market_bids SET poll_parked_at = now()');
    expect(raw[3]).toBe('COMMIT');
    expect(workload()).toHaveLength(1);
  });

  it('clearBuyNowLock swallows an already-counted contention and keeps the decided answer', async () => {
    // The sharpest plain-writer caller: buyNow's four compensation calls run
    // AFTER their request decided a typed refusal, and before the rider a
    // contended clear converted that decided 409 into a 500 while STILL
    // leaving the lock held. The contract is best-effort by design (the
    // lock ages out through buy_now_lock_expires): contention retries ONCE
    // (the fix round's consequence repair, since an un-cleared lock's
    // expiry mints an abandon record against the blameless holder) and then
    // everything resolves void with a loud line.
    const counters = await import('../../server/woc_market_db');
    const warns = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const code of ['55P03', '40P01', '25P03']) {
      const lockBefore = counters.wocMarketLockWaitTimeoutCount();
      const deadlockBefore = counters.wocMarketDeadlockCount();
      const contended = writeClientPool(async () => {
        throw Object.assign(new Error('staged contention'), { code });
      });
      await expect(new PgWocMarketDb(contended).clearBuyNowLock(7, 3)).resolves.toBeUndefined();
      // Counted once PER ATTEMPT, two attempts for a persistently contended
      // clear; the swallow's own second look rides the non-counting
      // predicate, or these would read four and poison the alert rate.
      expect(counters.wocMarketLockWaitTimeoutCount()).toBe(
        lockBefore + (code === '55P03' ? 2 : 0),
      );
      expect(counters.wocMarketDeadlockCount()).toBe(deadlockBefore + (code === '40P01' ? 2 : 0));
    }
    // A checkout failure (never-started) is equally safe to swallow: nothing
    // ran, and the lock still ages out.
    const failing = {
      query: async () => ({ rows: [], rowCount: 0 }),
      connect: async () => {
        throw new Error('timeout exceeded when trying to connect');
      },
    } as unknown as Pool;
    await expect(new PgWocMarketDb(failing).clearBuyNowLock(7, 3)).resolves.toBeUndefined();
    // A non-contention failure is swallowed too (best-effort BY CONTRACT:
    // every caller decided its answer already, and a 500 here masks it),
    // but LOUDLY: the error line is the surface for the real bug, judged
    // over the earlier throw-through in the review round.
    warns.mockClear();
    const buggy = writeClientPool(async () => {
      throw new Error('some real bug');
    });
    await expect(new PgWocMarketDb(buggy).clearBuyNowLock(7, 3)).resolves.toBeUndefined();
    expect(warns.mock.calls.some((c) => String(c[0]).includes('buy-now lock clear failed'))).toBe(
      true,
    );
    warns.mockRestore();
  });

  it('cancelPendingListings rides the rotation order with the backoff exclusion', async () => {
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).cancelPendingListings(REALM, 1_000, 25, [4]);
    const [text] = sql();
    expect(text).toContain('cancel_requested_at IS NOT NULL');
    expect(text).toContain('ORDER BY COALESCE(sweep_parked_at, updated_at)');
    expect(text).toContain('id <> ALL($4::bigint[])');
  });

  it('the abandon prune batches with NO ORDER BY (the unindexed-cutoff rule)', async () => {
    const { pool, sql } = recordingPool();
    const { pruneWocBuyNowAbandonsBatch } = await import('../../server/woc_market_db');
    await pruneWocBuyNowAbandonsBatch(pool, 30, 500);
    const [text] = sql();
    expect(text).toContain('DELETE FROM woc_market_buy_now_abandons');
    expect(text).toContain('LIMIT $2');
    // The age qual is the whole security of this prune: deleting in-window
    // rows early erases cooldown evidence (cap evasion), so the cutoff text
    // is pinned, not just the DELETE shape.
    expect(text).toContain("lock_expires < now() - ($1 || ' days')::interval");
    // lock_expires has no global index, so an ORDER BY would plan a full
    // sort per batch (the retention prune rule pins the absence).
    expect(text).not.toContain('ORDER BY');
  });

  it('the abandon prune keeps forever on a non-positive window', async () => {
    const { pool, sql } = recordingPool();
    const { pruneWocBuyNowAbandonsBatch } = await import('../../server/woc_market_db');
    expect(await pruneWocBuyNowAbandonsBatch(pool, 0, 500)).toBe(0);
    expect(await pruneWocBuyNowAbandonsBatch(pool, Number.NaN, 500)).toBe(0);
    expect(sql()).toHaveLength(0);
  });

  it('the listings prune orders on its indexed cutoff and honors keep-forever', async () => {
    // The pair's older half, pinned here for the same reason: only a
    // Postgres-gated run exercised either prune before.
    const { pool, sql } = recordingPool();
    const { pruneClosedWocListingsBatch } = await import('../../server/woc_market_db');
    await pruneClosedWocListingsBatch(pool, 180, 500);
    const [text] = sql();
    expect(text).toContain('DELETE FROM woc_market_listings');
    expect(text).toContain("status = 'closed' AND item_disposed = true");
    // updated_at IS indexed for this predicate (woc_market_listings_closed_updated),
    // so oldest-first ordering is a bounded index walk, not a sort.
    expect(text).toContain('ORDER BY updated_at');
    expect(text).toContain('LIMIT $2');
    const quiet = recordingPool();
    expect(await pruneClosedWocListingsBatch(quiet.pool, 0, 500)).toBe(0);
    expect(quiet.sql()).toHaveLength(0);
  });

  it('the booked-claims prune touches only booked rows, guards its referents, and honors keep-forever', async () => {
    const { pool, sql, params } = recordingPool();
    const { pruneBookedWocCustodyClaimsBatch } = await import('../../server/woc_market_db');
    await pruneBookedWocCustodyClaimsBatch(pool, 365, 100);
    const [text] = sql();
    expect(text).toContain('DELETE FROM woc_market_custody_claims');
    // The ctid outer keeps the DELETE a Tid Scan instead of a table-sized
    // semi-join (measured 6.8x; a concurrently moved row fails the re-check,
    // reads as caught-up for the night, and prunes on a later run, the safe
    // direction for a prune).
    expect(text).toContain('WHERE ctid IN');
    // The unbooked operator queue is structurally out of reach: the predicate
    // is the prune-cursor partial's own (woc_market_custody_claims_booked).
    expect(text).toContain('booked_at IS NOT NULL');
    expect(text).not.toContain('booked_at IS NULL');
    // Age on booked_at, never claimed_at (a re-stamped claim age would let an
    // old parked row slip in) and never a referent column (there is no FK).
    expect(text).toContain("booked_at < now() - ($1 || ' days')::interval");
    expect(text).not.toContain('claimed_at');
    // The referent belt: a claim whose settlement or listing row still exists
    // is unreachable whatever its age, so a stuck deal keeps its exactly-once
    // evidence. The probes are BARE NOT EXISTS (a NULL parsed id passes them
    // vacuously; wrapping them in IS-NULL disjuncts blocked the anti-join
    // pull-up and hashed the whole settlements id set per batch, the measured
    // regression the plan-pins suite now guards), and the {1,18} digit bound
    // keeps the ::bigint cast off any hostile over-long ref.
    expect(text).toContain("c.custody_ref ~ '^woc_settlement:[0-9]{1,18}$'");
    expect(text).toContain("c.custody_ref ~ '^woc_listing_(return|sold):[0-9]{1,18}$'");
    expect(text).not.toContain('IS NULL OR');
    expect(text).toContain('SELECT 1 FROM woc_market_settlements s WHERE s.id = ref.settlement_id');
    expect(text).toContain('SELECT 1 FROM woc_market_listings l WHERE l.id = ref.listing_id');
    // booked_at IS indexed for this predicate (the partial cursor above), so
    // the index can supply the ordering when the planner takes the ordered
    // path; on small fixtures a bitmap-plus-sort of one batch's bounded
    // candidate set is a legitimate cost pick (the plan-pins suite holds the
    // load-bearing classes: no table scans and no SubPlan).
    expect(text).toContain('ORDER BY c.booked_at');
    expect(text).toContain('LIMIT $2');
    expect(params()[0]).toEqual(['365', 100]);
    // The keep-forever arm: zero, negative, and NaN windows must not delete.
    const quiet = recordingPool();
    expect(await pruneBookedWocCustodyClaimsBatch(quiet.pool, 0, 100)).toBe(0);
    expect(await pruneBookedWocCustodyClaimsBatch(quiet.pool, -5, 100)).toBe(0);
    expect(await pruneBookedWocCustodyClaimsBatch(quiet.pool, Number.NaN, 100)).toBe(0);
    expect(quiet.sql()).toHaveLength(0);
  });

  it('every exported custody-ref mint shape matches a prune referent regex (no fourth rail slips to window-only)', async () => {
    // The regexes duplicate the mint functions as SQL literals; this pin is
    // what makes that duplication safe. A NEW *CustodyRef export whose output
    // matches neither regex would silently get window-only retention, losing
    // the referent protection that stands between the prune and the re-drive
    // duplication, so it must fail HERE first.
    const rules = await import('../../server/woc_market_rules');
    const { pool, sql } = recordingPool();
    const { pruneBookedWocCustodyClaimsBatch } = await import('../../server/woc_market_db');
    await pruneBookedWocCustodyClaimsBatch(pool, 365, 100);
    const [text] = sql();
    const regexes = [...text.matchAll(/~ '(\^[^']+\$)'/g)].map((m) => new RegExp(m[1]));
    expect(regexes.length).toBe(2);
    const minters = Object.entries(rules).filter(
      (entry): entry is [string, (id: number) => string] =>
        entry[0].endsWith('CustodyRef') && typeof entry[1] === 'function',
    );
    // All three known shapes, plus any future export the filter discovers.
    expect(minters.map(([name]) => name).sort()).toEqual(
      expect.arrayContaining([
        'listingReturnCustodyRef',
        'listingSoldNoticeCustodyRef',
        'settlementCustodyRef',
      ]),
    );
    for (const [name, mint] of minters) {
      const ref = mint(123456789);
      expect(
        regexes.some((re) => re.test(ref)),
        `${name} output ${ref} must match a prune referent regex`,
      ).toBe(true);
    }
  });

  it('custody-ref prefix literals live ONLY in the rules minters and the prune regexes', async () => {
    // The minter-correspondence pin above sees only *CustodyRef-suffixed
    // exports of woc_market_rules.ts, so an inline template ref at a call
    // site would bypass it and silently fall to window-only retention.
    // Containment closes that arm: the known ref families' prefixes may
    // appear in exactly two files, the minters (where the suffix pin
    // patrols) and the prune's referent regexes. A NEW prefix family stays
    // a naming-contract obligation (stated at the prune docstring); no
    // static scan can enumerate the unknown.
    const { readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { stripComments } = await import('../helpers/strip_comments');
    const dir = fileURLToPath(new URL('../../server/', import.meta.url));
    const offenders: string[] = [];
    let scanned = 0;
    // Recursive on purpose: server/ has subdirectories (http/, epic/, ...),
    // and a shallow walk is the known scan-guard trap. Platform sep, not
    // '/': the recursive listing joins with the native separator.
    for (const entry of readdirSync(dir, { recursive: true })) {
      const rel = String(entry);
      if (!rel.endsWith('.ts')) continue;
      // Exact root-relative paths, not basenames: a nested copy named like
      // an allowlisted file must NOT inherit its exemption.
      if (rel === 'woc_market_rules.ts' || rel === 'woc_market_db.ts') continue;
      scanned++;
      const text = stripComments(readFileSync(join(dir, rel), 'utf8'));
      if (/woc_(settlement|listing_[a-z_]+):/.test(text)) offenders.push(rel);
    }
    // Positive control: a mis-rooted or empty walk must not pass vacuously.
    expect(scanned).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });

  it('the custody retention misconfiguration warning fires on both hazard arms and stays quiet when sound', async () => {
    const { wocCustodyClaimsRetentionWarning } = await import('../../server/woc_market_db');
    // Sound configuration (the defaults): silent.
    expect(wocCustodyClaimsRetentionWarning(365, 180)).toBeNull();
    // Claims retention off: nothing to warn about (keep-forever is safe).
    expect(wocCustodyClaimsRetentionWarning(0, 180)).toBeNull();
    // Listings keep-forever makes the referent guard block everything: the
    // registered prune is silently inert, which deserves a boot line.
    expect(wocCustodyClaimsRetentionWarning(365, 0)).toContain('grow without bound');
    // A window at or below the listings window abandons the outlive
    // invariant that protects unparseable legacy refs.
    expect(wocCustodyClaimsRetentionWarning(180, 180)).toContain('must stay ABOVE');
    expect(wocCustodyClaimsRetentionWarning(30, 180)).toContain('must stay ABOVE');
    expect(wocCustodyClaimsRetentionWarning(181, 180)).toBeNull();
  });

  it('the cascade pick derives prior winners per ACCOUNT in the shipped SQL (no exclusion array)', async () => {
    // The always-running twin of the pg plan case: the fake mirrors this
    // derivation, so without this pin a revert of the correlated subquery
    // would pass the whole merge gate on the fake's re-implementation.
    const { pool, sql, params } = recordingPool();
    await new PgWocMarketDb(pool).nextCascadeBidder(41, 500);
    const [text] = sql();
    expect(text).toContain("candidate.status = 'outbid'");
    expect(text).toContain('w.listing_id = $1');
    expect(text).toContain('w.account = candidate.account');
    expect(text).toContain("w.status IN ('won', 'defaulted')");
    expect(text).toContain('NOT EXISTS');
    expect(text).not.toContain('= ANY($3');
    expect(params()[0]).toEqual([41, 500]);
  });

  it('the step-up drain deletes only long-expired nonces with NO ORDER BY (the unindexed-cutoff rule)', async () => {
    const { pool, sql, params } = recordingPool();
    const { pruneExpiredWocStepUpChallengesBatch, WOC_STEPUP_PRUNE_SLACK_DAYS } = await import(
      '../../server/woc_market_db'
    );
    await pruneExpiredWocStepUpChallengesBatch(pool, 500);
    const [text] = sql();
    expect(text).toContain('DELETE FROM woc_market_stepup_challenges');
    // A day past expires_at: prune-on-issue is the primary reaper, this drain
    // only clears realms that stopped issuing, and the slack keeps any
    // in-flight verify safe.
    expect(text).toContain("expires_at < now() - ($1 || ' days')::interval");
    expect(text).toContain('LIMIT $2');
    // expires_at leads only behind realm (the composite seek index), so a
    // global oldest-first would plan a full sort per batch; the rows are all
    // equally dead, so order carries nothing.
    expect(text).not.toContain('ORDER BY');
    expect(WOC_STEPUP_PRUNE_SLACK_DAYS).toBe(1);
    expect(params()[0]).toEqual([String(WOC_STEPUP_PRUNE_SLACK_DAYS), 500]);
  });

  it('the bid paths carry the lock-wait bound ahead of their first row lock', async () => {
    // insertPendingBid and activateBid were the two withTx sites with no
    // lock_timeout (their comments recorded the retrofit debt): a bid blocked
    // behind a held listing row camped a pooled client for the 15s session
    // statement_timeout. Both now bound the wait at ESCROW_LOCK_TIMEOUT_MS,
    // and the pre-existing contended tails answer the 55P03 as the typed 409.
    const { stripComments } = await import('../helpers/strip_comments');
    const src = stripComments(
      readFileSync(new URL('../../server/woc_market_db.ts', import.meta.url), 'utf8'),
    );
    for (const method of ['async insertPendingBid', 'async activateBidTx']) {
      const start = src.indexOf(method);
      expect(start, method).toBeGreaterThan(-1);
      // Guard the slice bound: with no FOR NO KEY UPDATE after the method, indexOf
      // answers -1 and the slice silently widens to the whole file, turning
      // this into a vacuous somewhere-in-the-file pin.
      const bound = src.indexOf('FOR NO KEY UPDATE', start);
      expect(bound, `${method} still takes a row lock`).toBeGreaterThan(start);
      const head = src.slice(start, bound);
      expect(head, `${method} bounds its lock wait before the first row lock`).toContain(
        'SET LOCAL lock_timeout = ${ESCROW_LOCK_TIMEOUT_MS}',
      );
    }
  });

  it('a refused claim opens NO transaction: the advisory refusal is lock-free', async () => {
    // The db-lane P1 in one line: refusing under FOR UPDATE serialized every
    // hopeful behind the holder while pinning a pooled client. A refused
    // claim must never even BEGIN; a refactor re-inlining the diagnosis into
    // the guard would stay green on every behavioral test but not this one.
    const refused = recordingTxPool((text) =>
      text.includes('FROM woc_market_listings')
        ? {
            rows: [
              {
                id: 7,
                realm: REALM,
                seller_account: 99,
                status: 'active',
                buy_now_cents: 1000,
                cancel_requested_at: null,
                buy_now_lock_account: 9,
                buy_now_lock_expires: new Date(9_999_999_999_999),
                directed_buyer_account: null,
                item: {},
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    expect(await new PgWocMarketDb(refused.pool).claimBuyNowLock(REALM, 7, 3, 1_000, 2_000)).toBe(
      'locked',
    );
    expect(refused.sql()).not.toContain('BEGIN');
  });

  it('the new guard transactions bound their IDLE holds, not just their waits', async () => {
    // lock_timeout bounds how long a statement WAITS for a lock; only the
    // idle-in-transaction bound limits how long a stalled event loop HOLDS
    // one between statements, which is what amplifies every waiter. Dropping
    // the statement silently removes the whole P1 rationale.
    const claimable = {
      id: 7,
      realm: REALM,
      seller_account: 99,
      status: 'active',
      buy_now_cents: 1000,
      cancel_requested_at: null,
      buy_now_lock_account: null,
      buy_now_lock_expires: null,
      directed_buyer_account: null,
      item: {},
    };
    const claim = recordingTxPool((text) =>
      text.includes('FROM woc_market_listings')
        ? { rows: [claimable], rowCount: 1 }
        : text.includes('woc_market_settlements') || text.includes('woc_market_buy_now_abandons')
          ? { rows: [], rowCount: 0 }
          : text.includes('UPDATE woc_market_listings')
            ? { rows: [claimable], rowCount: 1 }
            : undefined,
    );
    await new PgWocMarketDb(claim.pool).claimBuyNowLock(REALM, 7, 3, 1_000, 2_000);
    // The literal 2000 pins GUARD_IDLE_TX_TIMEOUT_MS itself (equal to
    // ESCROW_LOCK_TIMEOUT_MS by ruling: one story for both bounds): a retune must be
    // a deliberate edit here, not a silent constant change.
    expect(
      claim.sql().some((t) => t.includes('SET LOCAL idle_in_transaction_session_timeout = 2000')),
      'claimBuyNowLock',
    ).toBe(true);
    const extend = recordingTxPool((text) =>
      text.includes('FROM woc_market_listings')
        ? { rows: [{ id: 7, realm: REALM, status: 'active', item: {} }], rowCount: 1 }
        : undefined,
    );
    await new PgWocMarketDb(extend.pool).extendAuctionForBondProgress(REALM, 7, () => null);
    expect(
      extend.sql().some((t) => t.includes('SET LOCAL idle_in_transaction_session_timeout = 2000')),
      'extendAuctionForBondProgress',
    ).toBe(true);
    const converge = recordingTxPool();
    await new PgWocMarketDb(converge.pool).closeCancelPendingListing(REALM, 7, 1_000);
    expect(
      converge
        .sql()
        .some((t) => t.includes('SET LOCAL idle_in_transaction_session_timeout = 2000')),
      'closeCancelPendingListing',
    ).toBe(true);
  });

  it('BOTH abandon recorders run the ONE shared statement with its exempt predicate', async () => {
    // One statement, two callers: the sweep recorder and the steal arm can
    // never disagree on what counts as a walk-away. The NOT EXISTS exempts a
    // window whose refusal class says the chain plausibly saw money; a bare
    // signature deliberately does NOT exempt (one fabricated request would
    // bypass the cooldown arm).
    const viaRecorder = recordingWritePool();
    await new PgWocMarketDb(viaRecorder.pool).recordBuyNowAbandon(REALM, 7, 3, 1_000);
    const [recorderText] = viaRecorder.workload();
    expect(recorderText).toContain('WHERE NOT EXISTS');
    expect(recorderText).toContain('tx_signature IS NOT NULL');
    // The exempt list rides a BOUND parameter (no interpolation), and its
    // one member is the infrastructure verdict: quote_expired was removed
    // as attacker-mintable (wait out the TTL, post any string), and a
    // re-added member must consciously red this literal.
    expect(recorderText).toContain('ANY($5::text[])');
    expect(viaRecorder.workloadParams()[0]?.[4]).toEqual(['service_unavailable']);
    expect(recorderText).toContain('ON CONFLICT (listing_id, account, lock_expires) DO NOTHING');
    const deadLock = {
      id: 7,
      realm: REALM,
      seller_account: 99,
      seller_wallet: 'wallet-steal-seller',
      status: 'active',
      buy_now_cents: 1000,
      cancel_requested_at: null,
      buy_now_lock_account: 9,
      buy_now_lock_expires: new Date(0),
      directed_buyer_account: null,
      item: {},
    };
    const viaSteal = recordingTxPool((text) =>
      text.includes('FROM wallet_links')
        ? { rows: [], rowCount: 0 }
        : text.includes('FROM woc_market_listings')
          ? { rows: [deadLock], rowCount: 1 }
          : text.includes('FROM woc_market_settlements')
            ? { rows: [], rowCount: 0 }
            : text.includes('SELECT 1 FROM woc_market_buy_now_abandons')
              ? { rows: [], rowCount: 0 }
              : text.includes('count(*)::int AS n FROM')
                ? { rows: [{ n: 0 }], rowCount: 1 }
                : text.includes('UPDATE woc_market_listings')
                  ? { rows: [deadLock], rowCount: 1 }
                  : undefined,
    );
    await new PgWocMarketDb(viaSteal.pool).claimBuyNowLock(REALM, 7, 3, 1_000, 2_000);
    // Find the INSERT specifically: the advisory pass now runs the two
    // cooldown SELECTs over the same table before the transaction opens.
    const stealText = viaSteal
      .sql()
      .find((t) => t.includes('INSERT INTO woc_market_buy_now_abandons'));
    expect(stealText, 'the steal arm records through the same statement').toBe(recorderText);
  });

  it('the CHECK evolution adds the constraint NOT VALID (catalog-only boot work)', async () => {
    const { WOC_MARKET_SCHEMA } = await import('../../server/woc_market_db');
    const schema = WOC_MARKET_SCHEMA.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
    // Without NOT VALID the ADD re-validates the whole table under
    // AccessExclusive inside the unbounded boot transaction; every standing
    // value is in the wider list by construction, so validation buys nothing.
    expect(schema).toContain("'failed')) NOT VALID");
  });

  it('the proxy emits the SAME unavailable reason the gates branch on', async () => {
    // The extension gate and the abandon exemption both compare against this
    // string; a proxy emitting a drifted literal fails both open.
    const { WOC_MARKET_CONFIRM_UNAVAILABLE_REASON } = await import('../../server/woc_market_rules');
    expect(WOC_MARKET_CONFIRM_UNAVAILABLE_REASON).toBe('service_unavailable');
    const { readFileSync } = await import('node:fs');
    const { stripComments } = await import('../helpers/strip_comments');
    const proxy = stripComments(
      readFileSync(new URL('../../server/woc_market_proxy.ts', import.meta.url), 'utf8'),
    );
    // The confirm arm references the shared constant, not its own literal
    // (comment-stripped, so a commented-out copy cannot satisfy the pin).
    expect(proxy).toContain(
      'return { settled: false, pending: true, reason: WOC_MARKET_CONFIRM_UNAVAILABLE_REASON }',
    );
  });

  it('the schema carries the abandon ledger and cancel-intent surfaces additively', async () => {
    const { WOC_MARKET_SCHEMA } = await import('../../server/woc_market_db');
    const schema = WOC_MARKET_SCHEMA.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS woc_market_buy_now_abandons');
    // The unique window key IS the dedupe mechanism: the two recorders'
    // ON CONFLICT target raises 42P10 at runtime without it.
    expect(schema).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS woc_market_buy_now_abandons_once ON woc_market_buy_now_abandons(listing_id, account, lock_expires)',
    );
    expect(schema).toContain(
      'CREATE INDEX IF NOT EXISTS woc_market_buy_now_abandons_account ON woc_market_buy_now_abandons(account, lock_expires DESC)',
    );
    expect(schema).toContain('ADD COLUMN IF NOT EXISTS cancel_requested_at');
    // _rotation replaced the short-lived (realm, id) shape that shipped under
    // the _cancel_pending name: same-name redefinition is invisible to
    // IF NOT EXISTS, so the swap needs the new name AND the old drop.
    expect(schema).toContain(
      "CREATE INDEX IF NOT EXISTS woc_market_listings_cancel_rotation ON woc_market_listings(realm, (COALESCE(sweep_parked_at, updated_at))) WHERE cancel_requested_at IS NOT NULL AND status = 'active'",
    );
    expect(schema).toContain('DROP INDEX IF EXISTS woc_market_listings_cancel_pending');
    expect(schema).toContain('ADD COLUMN IF NOT EXISTS bond_signature_at');
    expect(schema).toContain('ADD COLUMN IF NOT EXISTS poll_parked_at');
    // The WHERE predicate is part of the pin: predicate drift would quietly
    // widen or empty the partial queue while the name and expression held.
    expect(schema).toContain(
      "CREATE INDEX IF NOT EXISTS woc_market_bids_bond_confirming_rotation ON woc_market_bids(realm, (COALESCE(poll_parked_at, placed_at))) WHERE status = 'pending_bond' AND bond_signature IS NOT NULL",
    );
  });
});

describe('the atomic save-and-book, in SQL', () => {
  // The save path sanitizes the state (the removed-zone strip walks questLog,
  // questsDone and the bags), so the fixture carries those, unlike the
  // service fakes whose db never touches the blob.
  const SAVE = {
    characterId: 21,
    level: 10,
    state: { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState,
    leaseNonce: 'nonce-1',
  };

  it('passes the normalized ledger snapshot as argument seven at both WOC character-save sites', async () => {
    // There are exactly two character-only marketplace transactions. Both
    // must hand the generic save helper the captured snapshot NORMALIZED
    // through the one snapshot-to-effects seam (bankLedgerSaveEffects, the
    // paid_guild_creation shape): rebuilding or filtering a mixed prefix
    // breaks receipt identity, while omitting one site makes that WOC rail
    // commit state without its audit rows.
    const { stripComments } = await import('../helpers/strip_comments');
    const src = stripComments(
      readFileSync(new URL('../../server/woc_market_db.ts', import.meta.url), 'utf8'),
    );
    const calls = [...src.matchAll(/saveCharacterStateOnClient\s*\(([\s\S]*?)\n\s*\);/g)].map(
      (match) => match[1] ?? '',
    );
    expect(calls).toHaveLength(2);
    for (const args of calls) {
      expect(
        args.match(
          /save\.bankLedgerSnapshot \? bankLedgerSaveEffects\(save\.bankLedgerSnapshot\) : undefined/g,
        ),
      ).toHaveLength(1);
      expect(args).toMatch(/save\.storageEffects,\s*save\.bankLedgerSnapshot \?/);
    }
    expect(calls.filter((args) => /: undefined,\s*accountLock,/.test(args))).toHaveLength(1);
  });

  it('persists the fenced character write and the booking in one transaction', async () => {
    const { pool, sql } = recordingTxPool();
    expect(await new PgWocMarketDb(pool).saveDeliveredCharacterBooked(SAVE, 'ref-1')).toBe(
      'booked',
    );
    const seq = sql();
    expect(seq[0]).toBe('BEGIN');
    expect(seq.at(-1)).toBe('COMMIT');
    // The WIDER save-tier idle bound BY IDENTITY, not just the site count:
    // this transaction serializes the character blob between statements, so
    // a swap back to the 2s guard bound (with the two-and-ten counts kept
    // intact by promoting some other guard) must fail here.
    expect(seq.some((t) => t.includes('idle_in_transaction_session_timeout = 10000'))).toBe(true);
    const character = seq.findIndex((t) => t.includes('UPDATE characters'));
    const booking = seq.findIndex((t) => t.includes('UPDATE woc_market_custody_claims'));
    expect(character).toBeGreaterThan(0);
    expect(booking).toBeGreaterThan(character);
    // The character half carries the in-statement lease fence, and the
    // booking half is monotonic (unbooked rows only).
    expect(seq[character]).toContain('character_leases');
    expect(seq[booking]).toContain('SET booked_at = now()');
    expect(seq[booking]).toContain('booked_at IS NULL');
  });

  it('rolls the WHOLE transaction back when the lease fence matches no row', async () => {
    // The recording client answers rowCount 0 for the fenced UPDATE here, so
    // the booking must never run and the transaction must end in ROLLBACK:
    // a displaced session can neither persist the grant nor book the ref.
    const seen: string[] = [];
    const query = vi.fn(async (text: string) => {
      seen.push(text);
      return { rows: [], rowCount: 0 };
    });
    const client = { query, release: vi.fn(), on: () => {}, removeListener: () => {} };
    const pool = { query, connect: async () => client } as unknown as Pool;
    expect(await new PgWocMarketDb(pool).saveDeliveredCharacterBooked(SAVE, 'ref-1')).toBe(
      'lease_lost',
    );
    expect(seen.some((t) => t.includes('woc_market_custody_claims'))).toBe(false);
    expect(seen.at(-1)).toBe('ROLLBACK');
  });

  it('surfaces a never-started transaction as the TYPED tag, not a bare error', async () => {
    // This method has no TxNeverStarted catch on purpose (its caller owns the
    // grant-side decision), which makes it the honest place to prove the tag
    // is a real exported class rather than a comment: escrowInsertListing
    // maps the tag to 'contended' by an instanceof test, so a tag that
    // stopped being thrown (or stopped being this class) would silently send
    // that provably-nothing-ran failure back down the ambiguous park arm.
    const pool = {
      query: vi.fn(),
      connect: async () => {
        throw new Error('timeout exceeded when trying to connect');
      },
    } as unknown as Pool;
    await expect(
      new PgWocMarketDb(pool).saveDeliveredCharacterBooked(SAVE, 'ref-1'),
    ).rejects.toBeInstanceOf(TxNeverStarted);
    await expect(
      new PgWocMarketDb(pool).saveDeliveredCharacterBooked(SAVE, 'ref-1'),
    ).rejects.toThrow('transaction never started');
  });

  it('translates a deferred bank-ledger ceiling refusal from COMMIT', async () => {
    const raw = {
      code: BANK_LEDGER_GROWTH_LIMIT_SQLSTATE,
      constraint: BANK_LEDGER_GROWTH_LIMIT_CONSTRAINT,
      detail: JSON.stringify({
        committed_rows: 9_999_999,
        attempted_rows: 2,
        hard_limit_rows: 10_000_000,
      }),
    };
    const seen: string[] = [];
    const query = vi.fn(async (text: string) => {
      seen.push(text);
      if (text === 'COMMIT') throw raw;
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn(), on: () => {}, removeListener: () => {} };
    const pool = { query, connect: async () => client } as unknown as Pool;

    await expect(
      new PgWocMarketDb(pool).saveDeliveredCharacterBooked(SAVE, 'ref-growth-limit'),
    ).rejects.toMatchObject({
      name: BankLedgerGrowthLimitExceeded.name,
      committedRows: 9_999_999,
      attemptedRows: 2,
      hardLimitRows: 10_000_000,
      cause: raw,
    });
    expect(seen).toContain('COMMIT');
    expect(seen.at(-1)).toBe('ROLLBACK');
  });
});

describe('the escrow listing transaction, in SQL', () => {
  const SAVE = {
    characterId: 21,
    level: 10,
    state: { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState,
    leaseNonce: 'nonce-1',
  };
  const LISTING = {
    realm: REALM,
    sellerAccount: 4,
    sellerCharacter: 21,
    sellerName: 'Selara',
    sellerWallet: 'wallet-seller',
    item: { itemId: 'crown_of_embers', count: 1 },
    itemId: 'crown_of_embers',
    quality: 'epic' as const,
    category: null,
    subcategory: null,
    params: {
      format: 'auction' as const,
      directedBuyerAccount: null,
      startCents: 5000,
      reserveCents: null,
      buyNowCents: null,
      durationHours: 12,
      offerNext: false,
    },
    endsAtMs: 1_820_000_000_000,
    directedOfferId: null,
  };

  it('bounds itself, locks accounts THEN writes the fenced character, then inserts', async () => {
    const { pool, sql } = recordingTxPool((text) =>
      text.includes('RETURNING id') ? { rows: [{ id: 7 }], rowCount: 1 } : undefined,
    );
    const out = await new PgWocMarketDb(pool).escrowInsertListing(SAVE, LISTING);
    expect(out).toEqual({ ok: true, id: 7 });
    const seq = sql();
    expect(seq[0]).toBe('BEGIN');
    expect(seq.at(-1)).toBe('COMMIT');
    // The three SET LOCAL bounds with their literals: the workload-scoped
    // statement allowance (the transaction heads a character's save FIFO, so
    // it must never hold it for the 60s heavy allowance), the lock-wait
    // ceiling, and the WIDER save-site idle bound (the character serialize
    // runs between statements, where Postgres sees idle-in-transaction; the
    // 2s guard bound false-fires on an ordinary stall there).
    expect(seq.some((t) => t.includes('SET LOCAL statement_timeout = 4000'))).toBe(true);
    expect(seq.some((t) => t.includes('SET LOCAL lock_timeout = 2000'))).toBe(true);
    expect(
      seq.some((t) => t.includes('SET LOCAL idle_in_transaction_session_timeout = 10000')),
    ).toBe(true);
    // Lock ORDER: accounts before characters (the createCharacterCapped
    // order), and the listing INSERT only after the fenced character write.
    const accounts = seq.findIndex(
      (t) => t.includes('FROM accounts') && t.includes('FOR NO KEY UPDATE'),
    );
    const character = seq.findIndex((t) => t.includes('UPDATE characters'));
    const insert = seq.findIndex((t) => t.includes('INSERT INTO woc_market_listings'));
    expect(accounts).toBeGreaterThan(0);
    expect(character).toBeGreaterThan(accounts);
    expect(insert).toBeGreaterThan(character);
    // The character half carries the in-statement lease fence.
    expect(seq[character]).toContain('character_leases');
  });

  it('rolls the WHOLE transaction back when the lease fence matches no row', async () => {
    const { pool, sql } = recordingTxPool((text) =>
      text.includes('UPDATE characters') ? { rows: [], rowCount: 0 } : undefined,
    );
    const out = await new PgWocMarketDb(pool).escrowInsertListing(SAVE, LISTING);
    expect(out).toEqual({ ok: false, reason: 'lease_lost' });
    const seq = sql();
    expect(seq.some((t) => t.includes('INSERT INTO woc_market_listings'))).toBe(false);
    expect(seq.at(-1)).toBe('ROLLBACK');
  });

  it.each([
    ['55P03', 'canceling statement due to lock timeout'],
    ['40P01', 'deadlock detected'],
    ['25P03', 'terminating connection due to idle-in-transaction timeout'],
  ])('maps the %s contention code to the typed refusal', async (code, message) => {
    // All three are the same answer to the seller (retry; the copy restores),
    // and all three must reach it through isLockContention rather than the
    // 500 an unmapped code would produce: 40P01 is this transaction chosen as
    // the deadlock victim, 25P03 its own idle-in-transaction bound firing on
    // a stalled event loop.
    const { pool } = recordingTxPool((text) => {
      if (text.includes('FOR NO KEY UPDATE')) {
        throw Object.assign(new Error(message), { code });
      }
      return undefined;
    });
    const counters = await import('../../server/woc_market_db');
    const idleBefore = counters.wocMarketIdleTxKillCount();
    const lockBefore = counters.wocMarketLockWaitTimeoutCount();
    const deadlockBefore = counters.wocMarketDeadlockCount();
    const neverStartedBefore = counters.wocMarketTxNeverStartedCount();
    const out = await new PgWocMarketDb(pool).escrowInsertListing(SAVE, LISTING);
    expect(out).toEqual({ ok: false, reason: 'contended' });
    // The counters partition the codes EXACTLY: 55P03 moves only the
    // lock-wait counter, 25P03 only the idle-kill one, 40P01 only the
    // deadlock one (the write-path rider's contention-class label), and the
    // never-started counter moves for NONE of them (the transaction here
    // provably began), so a widened increment condition in the classifier
    // (counting the whole contention set) fails on this row.
    expect(counters.wocMarketLockWaitTimeoutCount()).toBe(lockBefore + (code === '55P03' ? 1 : 0));
    expect(counters.wocMarketIdleTxKillCount()).toBe(idleBefore + (code === '25P03' ? 1 : 0));
    expect(counters.wocMarketDeadlockCount()).toBe(deadlockBefore + (code === '40P01' ? 1 : 0));
    expect(counters.wocMarketTxNeverStartedCount()).toBe(neverStartedBefore);
  });

  it('the 25P03 kill warns its DISTINCT line and counts; a 55P03 lock wait does neither', async () => {
    // The retrofit's false-fire rate must be observable: folded silently
    // into 'contended' an idle kill was indistinguishable from an ordinary
    // lock wait, so the arm owns one warn line and the counter the internal
    // readout serves. The 55P03 negative proves the line is the KILL's, not
    // every contention refusal's.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const before = wocMarketIdleTxKillCount();
      const rig = (code: string) =>
        recordingTxPool((text) => {
          if (text.includes('FOR NO KEY UPDATE')) {
            throw Object.assign(new Error('boom'), { code });
          }
          return undefined;
        });
      const { wocMarketLockWaitTimeoutCount } = await import('../../server/woc_market_db');
      const lockBefore = wocMarketLockWaitTimeoutCount();
      await new PgWocMarketDb(rig('25P03').pool).escrowInsertListing(SAVE, LISTING);
      const killLines = spy.mock.calls.filter((c) => String(c[0]).includes('25P03'));
      expect(killLines).toHaveLength(1);
      expect(String(killLines[0]?.[0])).toContain('idle-killed');
      expect(wocMarketIdleTxKillCount()).toBe(before + 1);
      // The two counters partition the contention codes: an idle kill never
      // moves the lock-wait counter.
      expect(wocMarketLockWaitTimeoutCount()).toBe(lockBefore);
      spy.mockClear();
      await new PgWocMarketDb(rig('55P03').pool).escrowInsertListing(SAVE, LISTING);
      expect(spy.mock.calls.filter((c) => String(c[0]).includes('25P03'))).toHaveLength(0);
      expect(wocMarketIdleTxKillCount()).toBe(before + 1);
      // And a lock-wait refusal counts on ITS side only: the operator's
      // tuning signal for ESCROW_LOCK_TIMEOUT_MS on the internal readout.
      expect(wocMarketLockWaitTimeoutCount()).toBe(lockBefore + 1);
    } finally {
      spy.mockRestore();
    }
  });

  it('the delivered-save guard counts a 55P03 on the lock-wait counter and rethrows it raw', async () => {
    // The one guard with no typed 'contended' mapping: commitGrant's
    // transient-throw arm wants the raw error as its park-or-retry evidence.
    // But the characters row it waits on is the most contended lock in the
    // market (the game loop's autosave fights it), so skipping the
    // classifier left those fires invisible to the lockWaitTimeouts tuning
    // signal. Count-and-rethrow: the raw error still reaches the transient
    // arm untouched.
    const { pool } = recordingTxPool((text) => {
      if (text.includes('UPDATE characters')) {
        throw Object.assign(new Error('canceling statement due to lock timeout'), {
          code: '55P03',
        });
      }
      return undefined;
    });
    const counters = await import('../../server/woc_market_db');
    const idleBefore = counters.wocMarketIdleTxKillCount();
    const lockBefore = counters.wocMarketLockWaitTimeoutCount();
    await expect(
      new PgWocMarketDb(pool).saveDeliveredCharacterBooked(SAVE, 'woc_settlement:9'),
    ).rejects.toMatchObject({ code: '55P03' });
    expect(counters.wocMarketLockWaitTimeoutCount()).toBe(lockBefore + 1);
    expect(counters.wocMarketIdleTxKillCount()).toBe(idleBefore);
  });

  it("insertPendingBid maps a contention code to the typed 'contended' (never a raw 500 on a bid)", async () => {
    // The idle-bound retrofit made 25P03 the FIRST contention code this
    // transaction can produce, and its refusal union had no contended member:
    // without the tail catch the player's bid answered internal.error.
    const bidArgs = {
      realm: 'Claudemoon',
      listingId: 9,
      account: 7,
      characterId: 21,
      characterName: 'Bidder',
      wallet: 'wallet-7',
      amountCents: 5000,
      bondCents: 250,
      nowMs: 1_000_000,
      minNext: () => 100,
    };
    const { pool } = recordingTxPool((text) => {
      if (text.includes('FOR NO KEY UPDATE')) {
        throw Object.assign(new Error('idle kill'), { code: '25P03' });
      }
      return undefined;
    });
    expect(await new PgWocMarketDb(pool).insertPendingBid(bidArgs)).toEqual({
      ok: false,
      reason: 'contended',
    });
    // A non-contention failure still surfaces: the catch maps ONLY the
    // contention codes, never a real bug.
    const { pool: buggy } = recordingTxPool((text) => {
      if (text.includes('FOR NO KEY UPDATE')) throw new Error('some real bug');
      return undefined;
    });
    await expect(new PgWocMarketDb(buggy).insertPendingBid(bidArgs)).rejects.toThrow(
      'some real bug',
    );
  });

  it('every guard tail maps TxNeverStarted like contention (the widening), with the two recorded exceptions', async () => {
    // The write-path rider's widening: before it, only the escrow write
    // mapped the never-started tag, so a pool-checkout timeout on any OTHER
    // guard was a raw 500 in exactly the correlated volume (pool
    // saturation) where a retryable typed answer matters most. The
    // completeness form mirrors the idle-bound distribution pin above:
    // exact counts over the comment-stripped source, so an eleventh widened
    // tail or a dropped one moves a number here.
    const { stripComments } = await import('../helpers/strip_comments');
    const src = stripComments(
      readFileSync(new URL('../../server/woc_market_db.ts', import.meta.url), 'utf8'),
    );
    const widened = src.match(/err instanceof TxNeverStarted \|\| isLockContention\(err\)/g) ?? [];
    expect(widened).toHaveLength(11);
    // The recorded exceptions, each load-bearing: exactly ONE un-widened
    // `if (isLockContention(err))` tail remains (the advisory claim reads,
    // which run on the plain pool where the tag cannot occur), exactly TWO
    // bare classify-to-count statements (the delivered-save tail and the
    // bounded plain-write seam, both of which rethrow RAW so their callers
    // keep the evidence), and exactly ONE swallow through the non-counting
    // isContentionCode (clearBuyNowLock's best-effort contract: its error
    // was already counted by boundedWrite's tail, so a counting second look
    // would double every rate).
    expect(src.match(/if \(isLockContention\(err\)\)/g) ?? []).toHaveLength(1);
    expect(src.match(/^\s*isLockContention\(err\);$/gm) ?? []).toHaveLength(2);
    // THREE non-counting second looks since the fix round: clearBuyNowLock's
    // best-effort swallow plus the two money-path signature recorders, whose
    // contended answer maps to the retryable confirm_in_flight at their
    // callers instead of 500ing a payment already on chain.
    expect(
      src.match(/err instanceof TxNeverStarted \|\| isContentionCode\(err\)/g) ?? [],
    ).toHaveLength(3);

    // Behavioral, one per answer shape. The typed-refusal shape: a checkout
    // failure on the bid path answers 'contended' and moves ONLY the
    // never-started counter.
    const bidArgs = {
      realm: 'Claudemoon',
      listingId: 9,
      account: 7,
      characterId: 21,
      characterName: 'Bidder',
      wallet: 'wallet-7',
      amountCents: 5000,
      bondCents: 250,
      nowMs: 1_000_000,
      minNext: () => 100,
    };
    const failingPool = {
      query: async () => ({ rows: [], rowCount: 1 }),
      connect: async () => {
        throw new Error('timeout exceeded when trying to connect');
      },
    } as unknown as Pool;
    const counters = await import('../../server/woc_market_db');
    const neverStartedBefore = counters.wocMarketTxNeverStartedCount();
    const lockBefore = counters.wocMarketLockWaitTimeoutCount();
    expect(await new PgWocMarketDb(failingPool).insertPendingBid(bidArgs)).toEqual({
      ok: false,
      reason: 'contended',
    });
    expect(counters.wocMarketTxNeverStartedCount()).toBe(neverStartedBefore + 1);
    expect(counters.wocMarketLockWaitTimeoutCount()).toBe(lockBefore);

    // The false-arm shape: the no-open-settlement probe NEVER RAN, so it
    // must answer false (park; assumes least), never "no settlement found".
    expect(await new PgWocMarketDb(failingPool).closeListingIfNoOpenSettlement(9, 'no_bids')).toBe(
      false,
    );
  });

  it("maps a CODELESS BEGIN failure to 'contended': nothing could have committed", async () => {
    // A pooled client whose socket died since its last use is not revalidated
    // at checkout, so it fails HERE with a codeless connection error instead
    // of at connect, in the same correlated volume as checkout timeouts.
    // withTx tags that as TxNeverStarted; without the tag this class parked as
    // ambiguous, which quarantine-kicked the seller for a transaction that
    // provably never began.
    const { pool, sql } = recordingTxPool((text) => {
      if (text === 'BEGIN') throw new Error('Connection terminated unexpectedly');
      return undefined;
    });
    const counters = await import('../../server/woc_market_db');
    const neverStartedBefore = counters.wocMarketTxNeverStartedCount();
    const out = await new PgWocMarketDb(pool).escrowInsertListing(SAVE, LISTING);
    expect(out).toEqual({ ok: false, reason: 'contended' });
    // A never-started transaction owes no ROLLBACK, and issuing one on the
    // dead session is what the tag's early rethrow exists to skip.
    expect(sql()).toEqual(['BEGIN']);
    // The contention-class label: never-started is COUNTED (pool is the
    // bottleneck, not a row), and it is the only counter this arm moves.
    expect(counters.wocMarketTxNeverStartedCount()).toBe(neverStartedBefore + 1);
  });

  it('DISCARDS a begin-broken client instead of returning it to the pool', async () => {
    // The load-bearing half of the tag: pg's driver-side query_timeout fires
    // WITHOUT flipping the client unqueryable and WITHOUT an 'error' event,
    // so on the black-holed-socket case nothing else stops pg-pool from
    // handing the next checkout a client with a BEGIN still in flight.
    // release(true) destroys the session; this is the only pin on it.
    const release = vi.fn();
    const query = async (text: string) => {
      if (text === 'BEGIN') throw new Error('Connection terminated unexpectedly');
      return { rows: [], rowCount: 1 };
    };
    const client = { query, release, on: () => {}, removeListener: () => {} };
    const pool = { query, connect: async () => client } as unknown as Pool;
    const out = await new PgWocMarketDb(pool).escrowInsertListing(SAVE, LISTING);
    expect(out).toEqual({ ok: false, reason: 'contended' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith(true);
  });

  it('DISCARDS a client after ANY codeless failure; a coded failure with a clean rollback returns it', async () => {
    // A codeless rejection means no server verdict reached us (the driver
    // backstop in particular cancels nothing and leaves its response
    // outstanding, so even a "successful" best-effort ROLLBACK may have
    // consumed the stale reply): the connection state is unknown and the
    // client must be destroyed. A CODED failure is a server verdict, so a
    // rollback that lands keeps that client poolable.
    const rolledBack: string[] = [];
    const makePool = (statementError: Error) => {
      const release = vi.fn();
      const query = async (text: string) => {
        if (text.includes('FOR NO KEY UPDATE')) throw statementError;
        if (text === 'ROLLBACK') rolledBack.push(text);
        return { rows: [], rowCount: 1 };
      };
      const client = { query, release, on: () => {}, removeListener: () => {} };
      return { pool: { query, connect: async () => client } as unknown as Pool, release };
    };
    const codeless = makePool(new Error('Connection terminated unexpectedly'));
    await expect(
      new PgWocMarketDb(codeless.pool).escrowInsertListing(SAVE, LISTING),
    ).rejects.toThrow('Connection terminated unexpectedly');
    expect(codeless.release).toHaveBeenCalledWith(true);
    // The control: a coded server verdict with a landed rollback stays poolable.
    const coded = makePool(Object.assign(new Error('duplicate key'), { code: '23505' }));
    await expect(new PgWocMarketDb(coded.pool).escrowInsertListing(SAVE, LISTING)).rejects.toThrow(
      'duplicate key',
    );
    expect(coded.release).toHaveBeenCalledWith(undefined);
    expect(rolledBack.length).toBe(2);
  });

  it('does NOT widen the never-started tag past BEGIN: a later codeless throw rejects', async () => {
    // The companion negative. Once a statement has run, a codeless failure
    // proves nothing about what committed, so it must stay a rejection for
    // the service's ambiguous arm (park the copy, loudly) rather than
    // collapsing into the retry refusal whose compensation restores it.
    const { pool } = recordingTxPool((text) => {
      if (text.includes('FOR NO KEY UPDATE')) throw new Error('Connection terminated unexpectedly');
      return undefined;
    });
    const out = await new PgWocMarketDb(pool)
      .escrowInsertListing(SAVE, LISTING)
      .catch((err: unknown) => err);
    expect(out).not.toEqual({ ok: false, reason: 'contended' });
    expect(out).not.toBeInstanceOf(TxNeverStarted);
    // The ORIGINAL error reaches the caller. This is the half that pins
    // withTx's code-preference expression: while its helper dereferenced the
    // still-null asyncErr, every codeless failure in this module arrived as
    // "TypeError: Cannot read properties of null (reading 'code')" instead,
    // which classified the same but erased the cause from the incident.
    expect(out).toBeInstanceOf(Error);
    expect((out as Error).message).toBe('Connection terminated unexpectedly');
  });

  it('prefers a CODED async termination over the codeless shell it leaves behind', async () => {
    // The other half of that same expression, and the reason it cannot simply
    // always keep the thrown error: the idle-in-transaction kill arrives on
    // the client's 'error' event while no statement is in flight, and the
    // statement that then fails carries only a generic not-queryable shell
    // with no code. Preferring the coded one is what keeps the 25P03
    // contention arm live instead of dropping a retryable refusal into the
    // 500 arm. The live-Postgres twin needs TEST_DATABASE_URL
    // (woc_market_bond_pg_integration), so the arm is pinned here too, where
    // ordinary CI always runs.
    let onError: ((err: unknown) => void) | undefined;
    const query = async (text: string) => {
      if (text.includes('FOR NO KEY UPDATE')) {
        onError?.(
          Object.assign(new Error('terminating connection due to idle-in-transaction timeout'), {
            code: '25P03',
          }),
        );
        throw new Error('Client has encountered a connection error and is not queryable');
      }
      return { rows: [], rowCount: 1 };
    };
    const client = {
      query,
      release: () => {},
      on: (_event: string, fn: (err: unknown) => void) => {
        onError = fn;
      },
      removeListener: () => {},
    };
    const pool = { query, connect: async () => client } as unknown as Pool;
    const out = await new PgWocMarketDb(pool).escrowInsertListing(SAVE, LISTING);
    // Contended, not a rejection: reached only by throwing the captured async
    // error in place of the codeless one the statement produced.
    expect(out).toEqual({ ok: false, reason: 'contended' });
  });

  it("a pool checkout failure maps to 'contended': the transaction never started", async () => {
    // pg-pool's checkout timeout is a CODELESS error, so without the
    // TxNeverStarted tag it would classify as ambiguous at the service and
    // quarantine-kick the seller under exactly the saturation that causes
    // checkout timeouts in volume. Nothing ran, so the typed retry refusal
    // (whose compensation restores the copy) is the provably correct answer.
    const pool = {
      query: vi.fn(),
      connect: async () => {
        throw new Error('timeout exceeded when trying to connect');
      },
    } as unknown as Pool;
    const out = await new PgWocMarketDb(pool).escrowInsertListing(SAVE, LISTING);
    expect(out).toEqual({ ok: false, reason: 'contended' });
  });

  it('rethrows a non-contention failure instead of eating it as a refusal', async () => {
    const { pool } = recordingTxPool((text) => {
      if (text.includes('INSERT INTO woc_market_listings')) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      return undefined;
    });
    await expect(new PgWocMarketDb(pool).escrowInsertListing(SAVE, LISTING)).rejects.toThrow(
      'duplicate key',
    );
  });

  it('counts the cap with the SAME predicate as the pre-check, directed rows included', async () => {
    // The authoritative half of the H12 cap. The pre-check has its own
    // no-exemption pin, but loosening only THIS half reopens the race the two
    // halves exist to close, and every outcome assertion in this describe
    // stays green while it does. Pinned two ways: the exemption predicate is
    // absent here, and the two statements are the same statement modulo
    // reflow, so a widened predicate has to be widened in both places
    // deliberately rather than drifting into one.
    const flatten = (text: string) => text.replace(/\s+/g, ' ').trim();
    const { pool: txPool, sql: txSql } = recordingTxPool((text) =>
      text.includes('RETURNING id') ? { rows: [{ id: 7 }], rowCount: 1 } : undefined,
    );
    await new PgWocMarketDb(txPool).escrowInsertListing(SAVE, LISTING);
    const capStatements = txSql().filter((t) => t.includes('COUNT(*)'));
    expect(capStatements, 'exactly one cap count inside the transaction').toHaveLength(1);
    expect(capStatements[0]).toContain("status <> 'closed'");
    expect(capStatements[0], 'no directed exemption inside the transaction').not.toContain(
      'directed_buyer_account',
    );
    const { pool: precheckPool, sql: precheckSql } = recordingPool();
    await new PgWocMarketDb(precheckPool).countActiveBySeller(REALM, LISTING.sellerAccount);
    expect(flatten(capStatements[0])).toBe(flatten(precheckSql()[0]));
  });

  it('refuses cap_reached under the accounts lock BEFORE any character write', async () => {
    const { pool, sql } = recordingTxPool((text) =>
      text.includes('COUNT(*)') ? { rows: [{ n: 12 }], rowCount: 1 } : undefined,
    );
    const out = await new PgWocMarketDb(pool).escrowInsertListing(SAVE, LISTING);
    expect(out).toEqual({ ok: false, reason: 'cap_reached' });
    const seq = sql();
    expect(seq.some((t) => t.includes('UPDATE characters'))).toBe(false);
    expect(seq.at(-1)).toBe('ROLLBACK');
  });
});

describe('the custody claim primitives stay monotonic, in SQL', () => {
  it('books and stamps ONLY while unbooked', async () => {
    for (const run of [
      (db: PgWocMarketDb) => db.markCustodyRefBooked('ref-1'),
      (db: PgWocMarketDb) => db.markCustodyGrantIntent('ref-1', 21),
      (db: PgWocMarketDb) => db.markCustodyMailIntent('ref-1'),
    ]) {
      const { pool, workload } = recordingWritePool();
      await run(new PgWocMarketDb(pool));
      expect(workload()[0]).toContain('booked_at IS NULL');
    }
  });

  it('the mail-intent stamp WITHDRAWS the grant intent in the same statement', async () => {
    // The one legal conversion (a grantCopy refusal proves the bags are
    // untouched); two statements here would leave a crash window in which a
    // claim carries both rails.
    const { pool, workload } = recordingWritePool();
    await new PgWocMarketDb(pool).markCustodyMailIntent('ref-1');
    const [text] = workload();
    expect(text).toContain('mail_intent_at = now()');
    expect(text).toContain('grant_character_id = NULL');
  });

  it('claims a ref with an INSERT that loses the race rather than raising', async () => {
    // The claim IS the mutual exclusion: two passes racing the same ref must
    // leave exactly one holder, and the loser must learn it lost (rowCount 0)
    // instead of taking a 23505 through the sweep's error path. The conflict
    // target names the primary key column pinned in the DDL floor above.
    const { pool, workload, workloadParams } = recordingWritePool();
    await new PgWocMarketDb(pool).claimCustodyRef(REALM, 'ref-1');
    const [text] = workload();
    expect(text).toContain('INSERT INTO woc_market_custody_claims');
    expect(text).toContain('ON CONFLICT (custody_ref) DO NOTHING');
    expect(workloadParams()[0]).toEqual([REALM, 'ref-1']);
  });

  it('reads the claim state (booked flag plus both rail intents) from the row', async () => {
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).custodyRefState('ref-1');
    const [text] = sql();
    expect(text).toContain('booked_at IS NOT NULL AS booked');
    expect(text).toContain('grant_character_id');
    expect(text).toContain('mail_intent_at IS NOT NULL AS mail_intent');
  });
});

describe('the sweep reads that keep delivery converging, in SQL', () => {
  it('pages delivered-but-unclosed residue over bounded id slices', async () => {
    // Delivered settlements grow with sale history forever. The single-join
    // form let the planner hash-join the WHOLE settlements table under a
    // LIMIT it could not push down (measured); the page shape is two bounded
    // statements the planner cannot reorder into a scan.
    const { pool, sql, params } = recordingPool();
    await new PgWocMarketDb(pool).deliveredUnclosedSettlementsPage(REALM, 40, 500, 25);
    const seq = sql();
    // No rows from the id read means the second statement never runs.
    expect(seq).toHaveLength(1);
    expect(seq[0]).toContain('FROM woc_market_listings');
    expect(seq[0]).toContain("status IN ('active', 'ending', 'settling')");
    expect(seq[0]).toContain('id > $2');
    expect(seq[0]).toContain('ORDER BY id');
    expect(seq[0]).toContain('LIMIT $3');
    expect(params()[0]).toEqual([REALM, 40, 500]);
  });

  it('probes the settlements ONLY by the page ids, delivered state pinned and BOUNDED', async () => {
    const seen: string[] = [];
    const bound: unknown[][] = [];
    const query = vi.fn(async (text: string, values?: unknown[]) => {
      seen.push(text);
      bound.push(values ?? []);
      if (text.includes('SELECT id FROM woc_market_listings')) {
        return { rows: [{ id: 7 }, { id: 9 }], rowCount: 2 };
      }
      return { rows: [], rowCount: 0 };
    });
    const pool = { query } as unknown as Pool;
    const out = await new PgWocMarketDb(pool).deliveredUnclosedSettlementsPage(REALM, 0, 500, 25);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toContain('listing_id = ANY($1::bigint[])');
    expect(seen[1]).toContain("state = 'delivered'");
    expect(seen[1]).toContain('ORDER BY listing_id');
    // Bounded residue fetch: every returned row costs a finalize transaction
    // plus a mail-book write, so the LIMIT (maxSettlements + 1, the +1 being
    // the truncation probe) is load-bearing, not cosmetic.
    expect(seen[1]).toContain('LIMIT $2');
    expect(bound[1]).toEqual([[7, 9], 26]);
    expect(out.lastListingId, 'the cursor advances to the page tail').toBe(9);
  });

  it('a truncated residue fetch moves the cursor to the last RETURNED row', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('SELECT id FROM woc_market_listings')) {
        return { rows: [{ id: 7 }, { id: 9 }, { id: 11 }], rowCount: 3 };
      }
      // Three delivered rows against maxSettlements = 2: the third is the
      // truncation probe and must be dropped, with the cursor at row two.
      return {
        rows: [7, 9, 11].map((listingId, i) => settlementRowFixture(100 + i, listingId)),
        rowCount: 3,
      };
    });
    const pool = { query } as unknown as Pool;
    const out = await new PgWocMarketDb(pool).deliveredUnclosedSettlementsPage(REALM, 0, 500, 2);
    expect(out.settlements).toHaveLength(2);
    expect(out.settlements.map((s) => s.listingId)).toEqual([7, 9]);
    expect(out.lastListingId, 'resume right behind the last processed row').toBe(9);
  });

  it('converges sold residue only over a STANDING sale row, bounded, never waiting', async () => {
    const { pool, sql, params } = recordingPool();
    await new PgWocMarketDb(pool).disposeSoldResidueListings(REALM, 25);
    const [text] = sql();
    expect(text).toContain('SET item_disposed = true');
    expect(text).toContain("l.resolution = 'sold'");
    expect(text).toContain('s.excluded = false');
    expect(text).toContain('LIMIT $2');
    // Deterministic lock order plus SKIP LOCKED: the arm never waits on (and
    // so can never deadlock against) a concurrent finalize holding a listing
    // row; a skipped row is the next beat's business.
    expect(text).toContain('ORDER BY l.id');
    expect(text).toContain('FOR NO KEY UPDATE OF l SKIP LOCKED');
    expect(params()[0]).toEqual([REALM, 25]);
  });

  it('keeps SOLD rows out of the return backlog read', async () => {
    // A sold listing whose dispose flag never landed (old-binary residue)
    // must not occupy a return batch slot forever; the stuck readout is what
    // surfaces it instead.
    const { pool, sql } = recordingPool();
    await new PgWocMarketDb(pool).undisposedClosedListings(REALM, 25, []);
    expect(sql()[0]).toContain("(resolution IS NULL OR resolution <> 'sold')");
  });

  it('rotates a parked row on sweep_parked_at ONLY, never the age signal', async () => {
    // The stuck classes age on updated_at; a rotation that touched it would
    // re-stamp a parked row every retry and hide it from the monitor forever
    // (the retry cadence is far inside the stuck threshold).
    const { pool, workload } = recordingWritePool();
    const db = new PgWocMarketDb(pool);
    await db.touchSettlementRow(7);
    await db.touchListingRow(9);
    for (const text of workload()) {
      expect(text).toContain('SET sweep_parked_at = now()');
      expect(text).not.toContain('updated_at');
      expect(text).not.toContain('created_at');
    }
    expect(workload()).toHaveLength(2);
  });

  it('orders both park-rotated batch reads by the rotation expression', async () => {
    // COALESCE(sweep_parked_at, updated_at), shared verbatim with the two
    // partial indexes: a drifted spelling silently loses the index.
    const { pool, sql, params } = recordingPool();
    const db = new PgWocMarketDb(pool);
    await db.deliveringSettlements(REALM, 25, [7, 9]);
    await db.undisposedClosedListings(REALM, 25, [11]);
    for (const text of sql()) {
      expect(text).toContain('ORDER BY COALESCE(sweep_parked_at, updated_at)');
      // Backing-off parked rows are excluded in the QUERY, so a standing
      // parked set costs neither batch slots nor per-pass rotation writes.
      expect(text).toContain('id <> ALL($3::bigint[])');
    }
    expect(sql()).toHaveLength(2);
    expect(params()[0]).toEqual([REALM, 25, [7, 9]]);
    expect(params()[1]).toEqual([REALM, 25, [11]]);
  });
});

describe('the stuck-custody readout saturates, in SQL', () => {
  it('samples and counts each class separately, counts capped by an inner LIMIT', async () => {
    const { pool, sql, params } = recordingPool();
    await new PgWocMarketDb(pool).stuckCustodyReadout(REALM, 1_000, 20, 1000, 1_000);
    const seq = sql();
    // Five sample reads and five capped counts, interleaved per class (the
    // three custody classes, plus review settlements and stuck bonds).
    expect(seq).toHaveLength(10);
    const samples = [seq[0], seq[2], seq[4], seq[6], seq[8]];
    const counts = [seq[1], seq[3], seq[5], seq[7], seq[9]];
    for (const [i, text] of samples.entries()) {
      expect(text, `sample ${i} is realm-scoped`).toContain('realm = $1');
    }
    // The three age-filtered custody classes share one param shape.
    for (const i of [0, 1, 2]) {
      expect(samples[i], `sample ${i} is capped`).toContain('LIMIT $3');
      expect(params()[i * 2]).toEqual([REALM, 1_000, 20]);
      expect(params()[i * 2 + 1]).toEqual([REALM, 1_000]);
    }
    for (const [i, text] of counts.entries()) {
      // The saturating shape: a bare count consumed the whole stuck set.
      expect(text, `count ${i} saturates`).toContain('SELECT count(*)::int AS n FROM (SELECT 1');
      expect(text, `count ${i} caps the inner read`).toContain('LIMIT 1000');
    }
    expect(samples[0]).toContain('booked_at IS NULL');
    expect(samples[0]).toContain('mail_intent_at');
    expect(samples[1]).toContain("state = 'delivering'");
    // Aged on updated_at (stamped at the delivering claim): rotation writes
    // sweep_parked_at, so a parked row's age keeps counting, and a slow
    // payment leg is not reported stuck the moment delivery begins.
    expect(samples[1]).toContain('updated_at <= to_timestamp($2 / 1000.0)');
    expect(samples[1]).not.toContain('created_at <=');
    expect(samples[1]).not.toContain('sweep_parked_at');
    expect(samples[2]).toContain("status = 'closed' AND item_disposed = false");
    expect(samples[2]).toContain('updated_at <= to_timestamp($2 / 1000.0)');
    expect(samples[2]).not.toContain('sweep_parked_at');
    // The review class carries NO age filter (the sweep's confirming bound
    // already aged it) and orders on updated_at (entry into review).
    expect(samples[3]).toContain("state = 'review'");
    expect(samples[3]).not.toContain('to_timestamp');
    expect(samples[3]).toContain('ORDER BY updated_at');
    expect(params()[6]).toEqual([REALM, 20]);
    expect(params()[7]).toEqual([REALM]);
    // Stuck bonds: the confirming-set predicate (matching its partial index)
    // plus the caller's bond age cutoff, aged on the SIGNATURE recording
    // (placed_at only for legacy rows): the same axis the poll park uses, so
    // the readout reports on the mechanism it describes.
    expect(samples[4]).toContain("status = 'pending_bond' AND bond_signature IS NOT NULL");
    expect(samples[4]).toContain(
      'COALESCE(bond_signature_at, placed_at) <= to_timestamp($2 / 1000.0)',
    );
    expect(params()[8]).toEqual([REALM, 1_000, 20]);
    expect(params()[9]).toEqual([REALM, 1_000]);
  });

  it('a bad countCap fails CLOSED to LIMIT 1 on every capped count', async () => {
    // The cap is string-interpolated into the count subquery, so a non-finite
    // or non-positive value would emit `LIMIT NaN` and error the operator
    // readout; the clamp keeps the read tiny instead. Real-arm twin of the
    // fake fidelity suite's clamp pin.
    for (const bad of [0, Number.NaN]) {
      const { pool, sql } = recordingPool();
      await new PgWocMarketDb(pool).stuckCustodyReadout(REALM, 1_000, 20, bad, 1_000);
      const counts = sql().filter((t) => t.includes('SELECT count(*)::int AS n FROM (SELECT 1'));
      expect(counts).toHaveLength(5);
      for (const [i, text] of counts.entries()) {
        expect(text, `count ${i} clamps to 1 on countCap ${bad}`).toContain('LIMIT 1)');
      }
    }
  });

  describe('activation and suspend lock shapes, in the statements', () => {
    it('activateBid locks the open bid set FIRST (ordered, FOR NO KEY UPDATE), the listing after', async () => {
      const bidRow = {
        id: 5,
        listing_id: 77,
        account: 1,
        character_id: 1,
        character_name: 'x',
        wallet: 'w',
        amount_cents: 900,
        status: 'pending_bond',
        bond_cents: 90,
        bond_state: 'pending',
        bond_reference: null,
        bond_quote_expires: null,
        bond_signature: null,
        bond_signature_at: null,
        placed_at: new Date(0),
      };
      const { pool, sql } = recordingTxPool((text) => {
        if (text.includes('SELECT listing_id FROM woc_market_bids')) {
          return { rows: [{ listing_id: 77 }], rowCount: 1 };
        }
        if (text.includes('FROM woc_market_bids WHERE id = $1 FOR NO KEY UPDATE')) {
          return { rows: [bidRow], rowCount: 1 };
        }
        if (text.includes('FROM woc_market_listings') && text.includes('FOR NO KEY UPDATE')) {
          // A vanished listing routes to the supersede arm; every lock
          // statement has already been ISSUED by then, which is all this
          // pin reads.
          return { rows: [], rowCount: 0 };
        }
        return undefined;
      });
      await new PgWocMarketDb(pool).activateBid(5, 1_000);
      const seq = sql();
      const openSet = seq.findIndex(
        (t) =>
          t.includes('FROM woc_market_bids') &&
          t.includes("status IN ('pending_bond', 'active')") &&
          t.includes('FOR NO KEY UPDATE'),
      );
      const ownLock = seq.findIndex((t) =>
        t.includes('FROM woc_market_bids WHERE id = $1 FOR NO KEY UPDATE'),
      );
      const listingLock = seq.findIndex(
        (t) => t.includes('FROM woc_market_listings') && t.includes('FOR NO KEY UPDATE'),
      );
      expect(openSet, 'the ordered open-set pre-lock exists').toBeGreaterThan(-1);
      expect(seq[openSet]).toContain('ORDER BY id');
      expect(seq[openSet], 'every pre-lock walks the SAME direction').not.toContain('DESC');
      expect(ownLock).toBeGreaterThan(openSet);
      expect(listingLock, 'bids first, listing second').toBeGreaterThan(ownLock);
    });

    it('suspend pre-locks pending, active AND won bids before the listing', async () => {
      const { pool, sql } = recordingTxPool();
      await new PgWocMarketDb(pool).suspendListingIfSafe(REALM, 5, 1_000);
      const seq = sql();
      const preLock = seq.findIndex(
        (t) => t.includes('FROM woc_market_bids') && t.includes('FOR NO KEY UPDATE'),
      );
      const listingLock = seq.findIndex(
        (t) => t.includes('FROM woc_market_listings') && t.includes('FOR NO KEY UPDATE'),
      );
      expect(preLock).toBeGreaterThan(-1);
      expect(
        seq[preLock],
        'a WON bid can take a bond write in the expiry CTE, so it joins the pre-lock set',
      ).toContain("status IN ('pending_bond', 'active', 'won')");
      expect(seq[preLock]).toContain('ORDER BY id');
      expect(seq[preLock], 'every pre-lock walks the SAME direction').not.toContain('DESC');
      expect(listingLock, 'bids first, listing second').toBeGreaterThan(preLock);
    });

    it('a lock-free open-settlement refusal takes NO row lock', async () => {
      // The advisory pass exists so a refused claimer never holds the listing
      // row against bids and the seller cancel; the verdict itself is shared
      // with the in-transaction twin, so THIS is the arm's observable
      // property.
      const listingRow = {
        seller_account: 1,
        status: 'active',
        buy_now_cents: 100,
        cancel_requested_at: null,
        buy_now_lock_account: null,
        buy_now_lock_expires: null,
        directed_buyer_account: null,
      };
      const { pool, sql } = recordingTxPool((text) => {
        if (text.includes('FROM woc_market_listings') && !text.includes('FOR NO KEY UPDATE')) {
          return { rows: [listingRow], rowCount: 1 };
        }
        if (text.includes('FROM woc_market_settlements')) {
          return { rows: [{ one: 1 }], rowCount: 1 };
        }
        return undefined;
      });
      const out = await new PgWocMarketDb(pool).claimBuyNowLock(REALM, 5, 2, 1_000, 2_000);
      expect(out).toBe('locked');
      expect(
        sql().some((t) => t.includes('FOR NO KEY UPDATE')),
        'the refusal held no lock',
      ).toBe(false);
      expect(sql().some((t) => t.includes('BEGIN'))).toBe(false);
    });
  });
});
