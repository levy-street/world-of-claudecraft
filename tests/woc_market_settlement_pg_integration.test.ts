// Real-Postgres coverage for the $WOC Exchange settlement-state guards: the
// money predicates the fake db can only imitate. Interleaved transactions
// simulate the races; the disposable database boots through the REAL
// ensureSchema so the partial unique indexes under test are genuinely present.
//
// Gate: TEST_DATABASE_URL (an admin URL on the dev Postgres from npm run
// db:up). The suite creates and drops its own database and never touches the
// database the URL points at. Pattern: tests/guild_bank_pg_integration.test.ts.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WocMarketCustody, WocMarketService, WocSettlementRow } from '../server/woc_market';
import type { PgWocMarketDb } from '../server/woc_market_db';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_woc_market_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

// server/db.ts reads DATABASE_URL at module load and builds its pool from it.
// Nothing above is a static import of a server module, so this assignment runs
// first and points the boot path at the disposable database.
if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

const BASE_MS = 1_820_000_000_000;
const MINUTE_MS = 60_000;
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describeDb('woc market settlement guards against real Postgres', () => {
  let admin: Pool;
  let pool: Pool;
  let db: typeof import('../server/db');
  let marketDb: PgWocMarketDb;
  let marketMod: typeof import('../server/woc_market');
  let proxyMod: typeof import('../server/woc_market_proxy');
  let rulesMod: typeof import('../server/woc_market_rules');
  let schemaSql: string;
  let seq = 0;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
    // Never drop the database the caller pointed us at.
    expect(own).not.toBe(VERIFY_DB);
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [VERIFY_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${VERIFY_DB}`);
    await admin.query(`CREATE DATABASE ${VERIFY_DB}`);

    db = await import('../server/db');
    const marketDbMod = await import('../server/woc_market_db');
    marketMod = await import('../server/woc_market');
    proxyMod = await import('../server/woc_market_proxy');
    rulesMod = await import('../server/woc_market_rules');
    schemaSql = marketDbMod.WOC_MARKET_SCHEMA;

    // The REAL boot path, so every constraint and index under test is the one
    // production gets.
    await db.ensureSchema();
    await db.runConcurrentIndexMigrations();

    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 12 });
    marketDb = new marketDbMod.PgWocMarketDb(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  // -------------------------------------------------------------------------
  // Fixtures (direct SQL; settlements go through the real insertSettlement so
  // the partial unique index stays the authority)
  // -------------------------------------------------------------------------

  async function seedAccount(): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`woc-guard-fixture-${seq}`],
    );
    return Number(res.rows[0].id);
  }

  async function seedListing(
    realm: string,
    sellerAccount: number,
    over: {
      status?: string;
      endsAtMs?: number;
      buyNowCents?: number | null;
      offerNext?: boolean;
      reserveCents?: number | null;
      itemId?: string;
    } = {},
  ): Promise<number> {
    seq++;
    const endsAtMs = over.endsAtMs ?? BASE_MS + 60 * MINUTE_MS;
    const itemId = over.itemId ?? 'crown_of_embers';
    const res = await pool.query(
      `INSERT INTO woc_market_listings (
         realm, seller_account, seller_character, seller_name, seller_wallet,
         item, item_id, quality, format, start_cents, reserve_cents,
         buy_now_cents, offer_next, status, ends_at, base_ends_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'epic', 'auction_buy_now', 500, $8, $9,
         $10, $11, to_timestamp($12 / 1000.0), to_timestamp($12 / 1000.0)
       ) RETURNING id`,
      [
        realm,
        sellerAccount,
        9000 + seq,
        `Seller${seq}`,
        `wallet-seller-${seq}`,
        JSON.stringify({ itemId, count: 1 }),
        itemId,
        over.reserveCents ?? null,
        over.buyNowCents === undefined ? 1000 : over.buyNowCents,
        over.offerNext ?? false,
        over.status ?? 'active',
        endsAtMs,
      ],
    );
    return Number(res.rows[0].id);
  }

  async function seedBid(
    realm: string,
    listingId: number,
    account: number,
    over: {
      status?: string;
      bondState?: string;
      amountCents?: number;
      placedAtMs?: number;
      bondReference?: string;
    } = {},
  ): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO woc_market_bids (
         listing_id, realm, account, character_id, character_name, wallet,
         amount_cents, status, bond_cents, bond_state, placed_at, bond_reference
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, to_timestamp($11 / 1000.0), $12)
       RETURNING id`,
      [
        listingId,
        realm,
        account,
        8000 + seq,
        `Bidder${seq}`,
        `wallet-bidder-${seq}`,
        over.amountCents ?? 700,
        over.status ?? 'active',
        70,
        over.bondState ?? 'held',
        over.placedAtMs ?? BASE_MS - 10 * MINUTE_MS,
        over.bondReference ?? null,
      ],
    );
    return Number(res.rows[0].id);
  }

  async function seedSettlement(
    _realm: string,
    listingId: number,
    buyerAccount: number,
    over: { state?: string; bidId?: number | null; deadlineAtMs?: number } = {},
  ): Promise<WocSettlementRow> {
    // _realm is unused: the settlement inherits its realm from the listing via
    // the INSERT..SELECT; call sites keep passing it for fixture readability.
    const out = await marketDb.insertSettlement({
      listingId,
      bidId: over.bidId ?? null,
      attempt: over.bidId ? 1 : 0,
      buyerAccount,
      buyerCharacter: 7000 + seq,
      buyerName: `Buyer${seq}`,
      buyerWallet: `wallet-buyer-${seq}`,
      amountCents: 1000,
      deadlineAtMs: over.deadlineAtMs ?? BASE_MS + 15 * MINUTE_MS,
      nowMs: BASE_MS,
    });
    if (typeof out === 'string') {
      throw new Error(`fixture settlement refused: ${out}`);
    }
    if (over.state && over.state !== 'offered') await setSettlementState(out.id, over.state);
    return out;
  }

  async function setSettlementState(id: number, state: string): Promise<void> {
    await pool.query(
      `UPDATE woc_market_settlements SET state = $2, updated_at = now() WHERE id = $1`,
      [id, state],
    );
  }

  async function listingRow(
    id: number,
  ): Promise<{ status: string; resolution: string | null; lockAccount: number | null }> {
    const res = await pool.query(
      `SELECT status, resolution, buy_now_lock_account FROM woc_market_listings WHERE id = $1`,
      [id],
    );
    return {
      status: res.rows[0].status,
      resolution: res.rows[0].resolution,
      lockAccount: res.rows[0].buy_now_lock_account,
    };
  }

  async function bidRow(id: number): Promise<{ status: string; bondState: string }> {
    const res = await pool.query(`SELECT status, bond_state FROM woc_market_bids WHERE id = $1`, [
      id,
    ]);
    return { status: res.rows[0].status, bondState: res.rows[0].bond_state };
  }

  async function settlementRow(id: number): Promise<{ state: string; failReason: string | null }> {
    const res = await pool.query(
      `SELECT state, fail_reason FROM woc_market_settlements WHERE id = $1`,
      [id],
    );
    return { state: res.rows[0].state, failReason: res.rows[0].fail_reason };
  }

  function makeService(realm: string): WocMarketService {
    const custody: WocMarketCustody = {
      runSerialized: () => {
        throw new Error('custody not exercised by this suite');
      },
      persistGrantSerialized: () => {
        throw new Error('custody not exercised by this suite');
      },
      ownsLiveCharacter: () => true,
      escrowSessionLost: () => {},
      extractCopy: () => {
        throw new Error('custody not exercised by this suite');
      },
      grantCopy: () => {
        throw new Error('custody not exercised by this suite');
      },
      snapshotCopy: () => {
        throw new Error('custody not exercised by this suite');
      },
      restoreCopy: () => {},
      persistMailParcel: async () => {},
      hasParcel: () => false,
    };
    return new marketMod.WocMarketService({
      db: marketDb,
      economy: proxyMod.createDevWocMarketEconomy(() => BASE_MS),
      custody,
      verifiedWallet: async () => 'wallet-fixture',
      balanceTokens: async () => 1_000_000,
      stepUpDevSig: true,
      config: {
        enabled: true,
        realm,
        policy: rulesMod.WOC_MARKET_RESTRICTED_POLICY,
        confirmingReviewMs: 6 * 3600 * 1000,
      },
      now: () => BASE_MS,
    });
  }

  // -------------------------------------------------------------------------
  // B1: seller cancel versus a live settlement
  // -------------------------------------------------------------------------

  describe('settlement-aware seller cancel', () => {
    it('refuses the cancel at every non-terminal settlement state', async () => {
      const realm = 'guard-cancel-live';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const settlement = await seedSettlement(realm, listingId, buyer);
      for (const state of ['offered', 'confirming', 'confirmed', 'delivering', 'delivered']) {
        await setSettlementState(settlement.id, state);
        const out = await marketDb.cancelListingIfUnbid(realm, listingId, seller, BASE_MS);
        expect(out, `state ${state}`).toBe('settlement_live');
        const row = await listingRow(listingId);
        expect(row.status, `state ${state}`).toBe('active');
        expect(row.resolution, `state ${state}`).toBeNull();
      }
    });

    it('accepts a cancel on an unpaid locked window as INTENT, and closes after expiry', async () => {
      const realm = 'guard-cancel-lock';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const claimed = await marketDb.claimBuyNowLock(
        realm,
        listingId,
        buyer,
        BASE_MS,
        BASE_MS + 2 * MINUTE_MS,
      );
      expect(claimed).toMatchObject({ id: listingId });
      // The cancel-intent arm: no refusal, no close either; the listing stays
      // active with the stamp and the holder keeps their window.
      expect(await marketDb.cancelListingIfUnbid(realm, listingId, seller, BASE_MS)).toBe(
        'cancel_pending',
      );
      const stamped = await listingRow(listingId);
      expect(stamped.status).toBe('active');
      // Past the lock expiry (and with no settlement created) the cancel lands.
      const out = await marketDb.cancelListingIfUnbid(
        realm,
        listingId,
        seller,
        BASE_MS + 3 * MINUTE_MS,
      );
      expect(out).toMatchObject({ id: listingId, status: 'closed', resolution: 'cancelled' });
    });

    it('a successful cancel expires a failed settlement so a retry cannot revive it', async () => {
      const realm = 'guard-cancel-failed';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const settlement = await seedSettlement(realm, listingId, buyer, { state: 'failed' });
      const out = await marketDb.cancelListingIfUnbid(realm, listingId, seller, BASE_MS);
      expect(out).toMatchObject({ id: listingId, status: 'closed', resolution: 'cancelled' });
      const after = await settlementRow(settlement.id);
      expect(after.state).toBe('expired');
      expect(after.failReason).toBe('listing_cancelled');
      // The retry path's own compare-and-set arms find nothing to revive.
      expect(await marketDb.transitionSettlement(settlement.id, ['failed'], 'offered')).toBe(false);
      expect(
        await marketDb.setSettlementQuote(settlement.id, 'ref-x', BASE_MS + MINUTE_MS, null),
      ).toBe(false);
    });

    it('a refused cancel rolls its speculative failed-expiry back', async () => {
      const realm = 'guard-cancel-rollback';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const failed = await seedSettlement(realm, listingId, buyer, { state: 'failed' });
      const open = await seedSettlement(realm, listingId, buyer);
      const out = await marketDb.cancelListingIfUnbid(realm, listingId, seller, BASE_MS);
      expect(out).toBe('settlement_live');
      // The transaction expires failed rows BEFORE finding the open one; the
      // abort must roll that expiry back, never leak it past a refusal.
      expect((await settlementRow(failed.id)).state).toBe('failed');
      expect((await settlementRow(open.id)).state).toBe('offered');
    });

    it('the real cancel blocks behind the row lock and refuses a lock claimed under it', async () => {
      const realm = 'guard-cancel-race';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const client = await pool.connect();
      try {
        // Hold the listing row lock the way any writer would, then fire the
        // REAL cancelListingIfUnbid: it must sit blocked on its own SELECT
        // FOR UPDATE (the assertion that pins the production row lock), never
        // interleave past it.
        await client.query('BEGIN');
        await client.query(
          `SELECT 1 FROM woc_market_listings WHERE realm = $1 AND id = $2 FOR UPDATE`,
          [realm, listingId],
        );
        const cancel = marketDb.cancelListingIfUnbid(realm, listingId, seller, BASE_MS);
        const first = await Promise.race([
          cancel.then(() => 'resolved'),
          delay(200).then(() => 'blocked'),
        ]);
        expect(first).toBe('blocked');
        // The lock holder claims the buy-now lock and commits; the unblocked
        // cancel re-reads the committed row and must respect the fresh lock
        // (cancel-intent, never a close over the racer's window).
        await client.query(
          `UPDATE woc_market_listings
              SET buy_now_lock_account = $2,
                  buy_now_lock_expires = to_timestamp($3 / 1000.0),
                  updated_at = now()
            WHERE id = $1`,
          [listingId, buyer, BASE_MS + MINUTE_MS],
        );
        await client.query('COMMIT');
        expect(await cancel).toBe('cancel_pending');
        const row = await listingRow(listingId);
        expect(row.status).toBe('active');
        // The racer's window survived the cancel.
        expect(row.lockAccount).toBe(buyer);
      } finally {
        client.release();
      }
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Admin suspend: the defined safe path
  // -------------------------------------------------------------------------

  describe('admin suspend safe path', () => {
    it('suspends over an offered settlement: expires it, cancels bids, queues bond refunds', async () => {
      const realm = 'guard-suspend-offered';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const bidder = await seedAccount();
      const pendingBidder = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const heldBid = await seedBid(realm, listingId, bidder);
      const pendingBid = await seedBid(realm, listingId, pendingBidder, {
        status: 'pending_bond',
        bondState: 'pending',
      });
      const settlement = await seedSettlement(realm, listingId, buyer);
      const out = await marketDb.suspendListingIfSafe(realm, listingId, BASE_MS);
      expect(out).toMatchObject({ id: listingId, status: 'closed', resolution: 'suspended' });
      const row = await listingRow(listingId);
      expect(row.status).toBe('closed');
      expect(row.resolution).toBe('suspended');
      const after = await settlementRow(settlement.id);
      expect(after.state).toBe('expired');
      expect(after.failReason).toBe('listing_suspended');
      expect(await bidRow(heldBid)).toEqual({ status: 'cancelled', bondState: 'refund_due' });
      // An unfunded bond has nothing to refund; only the bid is cancelled.
      expect(await bidRow(pendingBid)).toEqual({ status: 'cancelled', bondState: 'pending' });
    });

    it('refuses the suspend at every state where the payment may already be moving', async () => {
      const realm = 'guard-suspend-live';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const bidder = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bid = await seedBid(realm, listingId, bidder);
      const settlement = await seedSettlement(realm, listingId, buyer);
      for (const state of ['confirming', 'confirmed', 'delivering', 'delivered']) {
        await setSettlementState(settlement.id, state);
        const out = await marketDb.suspendListingIfSafe(realm, listingId, BASE_MS);
        expect(out, `state ${state}`).toBe('settlement_live');
        expect((await listingRow(listingId)).status, `state ${state}`).toBe('active');
        // A refused suspend must leave the bid book untouched.
        expect(await bidRow(bid), `state ${state}`).toEqual({
          status: 'active',
          bondState: 'held',
        });
      }
    });

    it('refuses the suspend under an unexpired buy-now lock, proceeds after expiry', async () => {
      const realm = 'guard-suspend-lock';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      await marketDb.claimBuyNowLock(realm, listingId, buyer, BASE_MS, BASE_MS + 2 * MINUTE_MS);
      expect(await marketDb.suspendListingIfSafe(realm, listingId, BASE_MS)).toBe(
        'buy_now_pending',
      );
      expect((await listingRow(listingId)).status).toBe('active');
      const out = await marketDb.suspendListingIfSafe(realm, listingId, BASE_MS + 3 * MINUTE_MS);
      expect(out).toMatchObject({ id: listingId, status: 'closed', resolution: 'suspended' });
      expect((await listingRow(listingId)).resolution).toBe('suspended');
    });

    it('suspending over a failed settlement expires it and still tears the bid book down', async () => {
      const realm = 'guard-suspend-failed';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const bidder = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const heldBid = await seedBid(realm, listingId, bidder);
      const settlement = await seedSettlement(realm, listingId, buyer, { state: 'failed' });
      const out = await marketDb.suspendListingIfSafe(realm, listingId, BASE_MS);
      expect(out).toMatchObject({ id: listingId, status: 'closed', resolution: 'suspended' });
      const after = await settlementRow(settlement.id);
      expect(after.state).toBe('expired');
      expect(after.failReason).toBe('listing_suspended');
      // The atomic teardown holds on this arm too, not only over 'offered'.
      expect(await bidRow(heldBid)).toEqual({ status: 'cancelled', bondState: 'refund_due' });
    });

    it('refuses a missing or already-closed listing', async () => {
      const realm = 'guard-suspend-refusals';
      const seller = await seedAccount();
      expect(await marketDb.suspendListingIfSafe(realm, 999_999_999, BASE_MS)).toBe('not_found');
      const closed = await seedListing(realm, seller, { status: 'closed' });
      expect(await marketDb.suspendListingIfSafe(realm, closed, BASE_MS)).toBe('not_active');
    });

    it('a suspend interleaved with a bond activation cannot deadlock', async () => {
      const realm = 'guard-suspend-deadlock';
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, bidder);
      const client = await pool.connect();
      try {
        // Replay activateBid's lock order (its bid row first, the listing row
        // second) around a live suspend. The suspend takes bids before the
        // listing too, so it queues behind the held bid lock; the old
        // listing-first order formed a cycle here and one side died 40P01.
        await client.query('BEGIN');
        await client.query(`SELECT 1 FROM woc_market_bids WHERE id = $1 FOR UPDATE`, [bidId]);
        const suspend = marketDb.suspendListingIfSafe(realm, listingId, BASE_MS);
        const first = await Promise.race([
          suspend.then(() => 'resolved'),
          delay(200).then(() => 'blocked'),
        ]);
        expect(first).toBe('blocked');
        await client.query(`SELECT 1 FROM woc_market_listings WHERE id = $1 FOR UPDATE`, [
          listingId,
        ]);
        await client.query('COMMIT');
        expect(await suspend).toMatchObject({
          id: listingId,
          status: 'closed',
          resolution: 'suspended',
        });
        expect(await bidRow(bidId)).toEqual({ status: 'cancelled', bondState: 'refund_due' });
      } finally {
        client.release();
      }
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Delivered-but-unclosed visibility (the liveness groundwork)
  // -------------------------------------------------------------------------

  describe('delivered-but-unclosed listings stay visible to the liveness checks', () => {
    it('liveSettlementForListing reports a delivered settlement', async () => {
      const realm = 'guard-delivered-visible';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const settlement = await seedSettlement(realm, listingId, buyer, { state: 'delivered' });
      const live = await marketDb.liveSettlementForListing(listingId);
      expect(live?.id).toBe(settlement.id);
      expect(live?.state).toBe('delivered');
    });

    it('a second settlement for a delivered-but-unclosed listing fails closed at the index', async () => {
      const realm = 'guard-delivered-unique';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      await seedSettlement(realm, listingId, buyer, { state: 'delivered' });
      const second = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 0,
        buyerAccount: buyer,
        buyerCharacter: 7999,
        buyerName: 'SecondBuyer',
        buyerWallet: 'wallet-second',
        amountCents: 1000,
        deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
        nowMs: BASE_MS,
      });
      expect(second).toBe('live_settlement_exists');
    });

    it('the sweep drives a delivered-but-unclosed listing FORWARD and still reopens a dead one', async () => {
      const realm = 'guard-delivered-reclaim';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const deliveredListing = await seedListing(realm, seller, { status: 'settling' });
      await seedSettlement(realm, deliveredListing, buyer, { state: 'delivered' });
      const deadListing = await seedListing(realm, seller, { status: 'settling' });
      const dead = await seedSettlement(realm, deadListing, buyer, { state: 'failed' });
      // The failed settlement is past its retry window, so its listing really
      // is stranded; the delivered one is mid-close and must never REOPEN
      // (re-auctioning a delivered item was the dupe): it converges to the
      // finished sale through the redriven arm instead.
      await pool.query(
        `UPDATE woc_market_settlements SET deadline_at = to_timestamp($2 / 1000.0) WHERE id = $1`,
        [dead.id, BASE_MS - 60 * MINUTE_MS],
      );
      await pool.query(
        `UPDATE woc_market_listings SET updated_at = to_timestamp($2 / 1000.0) WHERE realm = $1`,
        [realm, BASE_MS - 24 * 60 * MINUTE_MS],
      );
      const service = makeService(realm);
      await service.sweepPass();
      // Pass 1: the reclaim refuses while the failed row still rides the dead
      // listing (its deadline belongs to the overdue arm, which expires it
      // later in the same pass; expiring it from the reclaim would skip the
      // default consequences), and the delivered listing converges FORWARD.
      expect((await listingRow(deadListing)).status).toBe('settling');
      const delivered = await listingRow(deliveredListing);
      expect(delivered.status).toBe('closed');
      expect(delivered.resolution).toBe('sold');
      // Pass 2: with the failed row terminal, the reclaim reopens the
      // genuinely dead listing; the converged one never reopens.
      await service.sweepPass();
      expect((await listingRow(deliveredListing)).status).toBe('closed');
      expect((await listingRow(deadListing)).status).not.toBe('settling');
    }, 20_000);

    it('the schema swaps both superseded indexes for the open2 one, and re-applies cleanly', async () => {
      const names = async (): Promise<string[]> => {
        const res = await pool.query(
          `SELECT indexname FROM pg_indexes WHERE tablename = 'woc_market_settlements'`,
        );
        return res.rows.map((r) => r.indexname);
      };
      const first = await names();
      expect(first).toContain('woc_market_settlements_open2');
      expect(first).not.toContain('woc_market_settlements_open');
      expect(first).not.toContain('woc_market_settlements_live');
      const def = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'woc_market_settlements_open2'`,
      );
      const indexdef: string = def.rows[0].indexdef;
      expect(indexdef).toContain('UNIQUE');
      expect(indexdef).toContain('(listing_id)');
      // The whole six-state predicate, member by member: dropping any one of
      // them would quietly narrow the invariant this index exists to widen
      // ('review' is the operator park; its listing must never re-auction).
      for (const state of [
        'offered',
        'confirming',
        'review',
        'confirmed',
        'delivering',
        'delivered',
      ]) {
        expect(indexdef, state).toContain(`'${state}'`);
      }
      // The FK/LATERAL composite: it must order id DESC behind listing_id (the
      // latest-settlement probe's seek) and the superseded single-column FK
      // index must be gone. pg_indexes rows are exact names, so no prefix
      // hazard between _listing and _listing_latest here.
      expect(first).toContain('woc_market_settlements_listing_latest');
      expect(first).not.toContain('woc_market_settlements_listing');
      const latest = await pool.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'woc_market_settlements_listing_latest'`,
      );
      expect(latest.rows[0].indexdef).toContain('(listing_id, id DESC)');
      // A database created before either swap still carries a stale index; a
      // re-boot must drop BOTH generations. Recreate them, re-apply, re-check.
      // The single-column FK index gets the same upgrade-path proof.
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS woc_market_settlements_live
           ON woc_market_settlements(listing_id)
           WHERE state IN ('offered', 'confirming', 'confirmed', 'delivering')`,
      );
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS woc_market_settlements_open
           ON woc_market_settlements(listing_id)
           WHERE state IN ('offered', 'confirming', 'confirmed', 'delivering', 'delivered')`,
      );
      await pool.query(
        `CREATE INDEX IF NOT EXISTS woc_market_settlements_listing
           ON woc_market_settlements(listing_id)`,
      );
      await pool.query(schemaSql);
      const second = await names();
      expect(second).toContain('woc_market_settlements_open2');
      expect(second).not.toContain('woc_market_settlements_open');
      expect(second).not.toContain('woc_market_settlements_live');
      expect(second).toContain('woc_market_settlements_listing_latest');
      expect(second).not.toContain('woc_market_settlements_listing');
    }, 20_000);

    it('every marketplace FK first column is index-covered, minus the judged accounts carve-out', async () => {
      // The retention round's criterion is an "every" claim (an index for
      // every FK-cascade column marketplace deletes touch), so it gets a
      // completeness floor, not a name list: a future woc_market_* child
      // table whose FK ships uncovered must fail HERE, not as a production
      // cascade's per-row sequential scan. Partial indexes do not count as
      // coverage (a cascade scan's bare col = $1 predicate cannot imply an
      // index predicate). The four allowlisted accounts-cascade columns are
      // the JUDGED exceptions: the only hard accounts DELETE in production
      // is the federated-provision race loser
      // (server/federated_auth_db.ts), whose predicate (no password, no
      // tokens, no links) cannot own market rows, player-facing removal is
      // a soft delete that fires no cascade, and four permanent
      // write-amplifying indexes on the two hottest tables would serve
      // scans that cannot fire. Growing this list is a judgment, not a
      // formality: every addition needs the same cannot-fire argument.
      const uncovered = await pool.query(
        `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
           FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
          WHERE c.contype = 'f'
            AND c.conrelid::regclass::text LIKE 'woc_market%'
            AND NOT EXISTS (
              SELECT 1 FROM pg_index i
               WHERE i.indrelid = c.conrelid
                 AND i.indpred IS NULL
                 AND i.indisvalid
                 AND i.indkey[0] = c.conkey[1])
          ORDER BY 1, 2`,
      );
      expect(uncovered.rows.map((r) => `${r.tbl}.${r.col}`)).toEqual([
        'woc_market_directed_offers.buyer_account',
        'woc_market_directed_offers.seller_account',
        'woc_market_listings.directed_buyer_account',
        'woc_market_listings.seller_account',
      ]);
    }, 20_000);

    it('the boot repair demotes a legacy delivered-plus-open pair instead of failing the boot', async () => {
      const realm = 'guard-repair-settlements';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const rankedListing = await seedListing(realm, seller);
      // Recreate the legacy shape: with the wide index dropped, a delivered
      // row and a later revived one can coexist, exactly what the pre-guard
      // reclaim/re-auction bug produced. The next boot must repair it, not
      // die on the CREATE UNIQUE INDEX. try/finally: a failure between the
      // drop and the re-apply must not leave the rest of the file running
      // without the invariant under test.
      await pool.query('DROP INDEX woc_market_settlements_open2');
      try {
        const delivered = await seedSettlement(realm, listingId, buyer, { state: 'delivered' });
        const revived = await seedSettlement(realm, listingId, buyer);
        // The ranking arm: the ADVANCED row is inserted SECOND (higher id),
        // so a survivor chosen by state rank differs from keep-earliest; a
        // repair degraded to ORDER BY id would demote the confirming payment
        // and keep the idle offered row, exactly the wrong survivor. The
        // offered row also carries a prior fail_reason, pinning the forensic
        // append (the marker stays greppable, the history stays attached).
        const rankedOffered = await seedSettlement(realm, rankedListing, buyer);
        await pool.query(`UPDATE woc_market_settlements SET fail_reason = $2 WHERE id = $1`, [
          rankedOffered.id,
          'quote_lapsed',
        ]);
        const rankedConfirming = await seedSettlement(realm, rankedListing, buyer, {
          state: 'confirming',
        });
        expect(rankedConfirming.id).toBeGreaterThan(rankedOffered.id);
        await pool.query(schemaSql);
        expect((await settlementRow(delivered.id)).state).toBe('delivered');
        const demoted = await settlementRow(revived.id);
        expect(demoted.state).toBe('expired');
        expect(demoted.failReason).toBe('schema_dedupe');
        expect((await settlementRow(rankedConfirming.id)).state).toBe('confirming');
        const rankedDemoted = await settlementRow(rankedOffered.id);
        expect(rankedDemoted.state).toBe('expired');
        expect(rankedDemoted.failReason).toBe('schema_dedupe:quote_lapsed');
      } finally {
        await pool.query(schemaSql);
      }
      const rebuilt = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE indexname = 'woc_market_settlements_open2'`,
      );
      expect(rebuilt.rows).toHaveLength(1);
    }, 20_000);

    it('an INVALID index carcass re-opens the repair gate and is rebuilt valid', async () => {
      const realm = 'guard-repair-carcass';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      await pool.query('DROP INDEX woc_market_settlements_open2');
      try {
        const keep = await seedSettlement(realm, listingId, buyer, { state: 'confirming' });
        const dupe = await seedSettlement(realm, listingId, buyer);
        // A failed CONCURRENTLY build (the incident-response hand build the
        // DDL comment names) leaves an INVALID carcass that satisfies both
        // to_regclass and IF NOT EXISTS while enforcing nothing.
        await expect(
          pool.query(
            `CREATE UNIQUE INDEX CONCURRENTLY woc_market_settlements_open2
               ON woc_market_settlements(listing_id)
               WHERE state IN ('offered', 'confirming', 'confirmed', 'delivering', 'delivered')`,
          ),
        ).rejects.toMatchObject({ code: '23505' });
        const carcass = await pool.query(
          `SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
            WHERE c.relname = 'woc_market_settlements_open2'`,
        );
        expect(carcass.rows).toEqual([{ indisvalid: false }]);
        // The boot must see through the carcass: repair the duplicates, drop
        // the invalid leftover, and rebuild a VALID index.
        await pool.query(schemaSql);
        expect((await settlementRow(keep.id)).state).toBe('confirming');
        expect((await settlementRow(dupe.id)).state).toBe('expired');
        const rebuilt = await pool.query(
          `SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
            WHERE c.relname = 'woc_market_settlements_open2'`,
        );
        expect(rebuilt.rows).toEqual([{ indisvalid: true }]);
      } finally {
        await pool.query(schemaSql);
      }
    }, 20_000);

    it('a closed listing refuses a new settlement distinctly from a missing one', async () => {
      const realm = 'guard-insert-closed';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const closed = await seedListing(realm, seller, { status: 'closed' });
      const insertFor = (listingId: number) =>
        marketDb.insertSettlement({
          listingId,
          bidId: null,
          attempt: 0,
          buyerAccount: buyer,
          buyerCharacter: 7800,
          buyerName: 'ClosedBuyer',
          buyerWallet: 'wallet-closed',
          amountCents: 1000,
          deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
          nowMs: BASE_MS,
        });
      expect(await insertFor(closed)).toBe('listing_closed');
      expect(await insertFor(999_999_999)).toBe('live_settlement_exists');
    });
  });

  // -------------------------------------------------------------------------
  // H9: buy-now racing the auction close
  // -------------------------------------------------------------------------

  describe('buy-now versus auction close', () => {
    it('the auction close loses to a live buy-now settlement: bid outbid, bond refunded, one winner', async () => {
      const realm = 'guard-h9-race';
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, { endsAtMs: BASE_MS - MINUTE_MS });
      const bidId = await seedBid(realm, listingId, bidder, { bondReference: 'bond-ref-h9-race' });
      const buyNow = await seedSettlement(realm, listingId, buyer);
      await makeService(realm).sweepPass();
      // Exactly one winner: the buy-now settlement stands alone and the
      // standing bid holds no claim; its bond rode the refund pipeline to its
      // terminal state inside the same pass (the dev economy always settles).
      expect(await bidRow(bidId)).toEqual({ status: 'outbid', bondState: 'refunded' });
      const settlements = await pool.query(
        `SELECT id, state FROM woc_market_settlements WHERE listing_id = $1`,
        [listingId],
      );
      expect(settlements.rows.map((r) => Number(r.id))).toEqual([buyNow.id]);
      expect((await listingRow(listingId)).status).toBe('settling');
    }, 20_000);

    it('a clean auction close still stamps the winner atomically with its settlement', async () => {
      const realm = 'guard-h9-clean';
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listingId = await seedListing(realm, seller, { endsAtMs: BASE_MS - MINUTE_MS });
      const bidId = await seedBid(realm, listingId, bidder);
      await makeService(realm).sweepPass();
      expect((await bidRow(bidId)).status).toBe('won');
      const settlements = await pool.query(
        `SELECT bid_id, state FROM woc_market_settlements WHERE listing_id = $1`,
        [listingId],
      );
      expect(settlements.rows).toHaveLength(1);
      expect(Number(settlements.rows[0].bid_id)).toBe(bidId);
      expect(settlements.rows[0].state).toBe('offered');
      expect((await listingRow(listingId)).status).toBe('settling');
    }, 20_000);

    it('a conflicting winner insert rolls the won stamp back with the settlement', async () => {
      const realm = 'guard-h9-atomic';
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, bidder);
      await seedSettlement(realm, listingId, buyer);
      const out = await marketDb.insertSettlement({
        listingId,
        bidId,
        attempt: 1,
        buyerAccount: bidder,
        buyerCharacter: 7500,
        buyerName: 'RacerBidder',
        buyerWallet: 'wallet-racer',
        amountCents: 700,
        deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
        nowMs: BASE_MS,
        winnerBidId: bidId,
      });
      expect(out).toBe('live_settlement_exists');
      // The atomic pair: no settlement means no won stamp survives.
      expect((await bidRow(bidId)).status).toBe('active');
    });

    it('the winner stamp lands with the settlement and never resurrects a cancelled bid', async () => {
      const realm = 'guard-h9-stamp';
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, bidder);
      const won = await marketDb.insertSettlement({
        listingId,
        bidId,
        attempt: 1,
        buyerAccount: bidder,
        buyerCharacter: 7501,
        buyerName: 'StampBidder',
        buyerWallet: 'wallet-stamp',
        amountCents: 700,
        deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
        nowMs: BASE_MS,
        winnerBidId: bidId,
      });
      // The positive control for the rollback test above: on a clean insert
      // the stamp really does land.
      expect(won).toMatchObject({ listingId, bidId });
      expect((await bidRow(bidId)).status).toBe('won');
      // The converse guard: naming a cancelled bid as winner aborts the whole
      // insert, so no settlement can exist whose winner holds no claim.
      const otherListing = await seedListing(realm, seller);
      const cancelledBid = await seedBid(realm, otherListing, bidder, { status: 'cancelled' });
      const out = await marketDb.insertSettlement({
        listingId: otherListing,
        bidId: cancelledBid,
        attempt: 1,
        buyerAccount: bidder,
        buyerCharacter: 7502,
        buyerName: 'GhostBidder',
        buyerWallet: 'wallet-ghost',
        amountCents: 700,
        deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
        nowMs: BASE_MS,
        winnerBidId: cancelledBid,
      });
      // The distinct label: the winner left the pickable states, which is not
      // the same operator story as a live settlement standing in the way.
      expect(out).toBe('winner_gone');
      expect((await bidRow(cancelledBid)).status).toBe('cancelled');
      const none = await pool.query(
        `SELECT count(*)::int AS n FROM woc_market_settlements WHERE listing_id = $1`,
        [otherListing],
      );
      expect(none.rows[0].n).toBe(0);
    });

    it('two racing settlement inserts resolve to exactly one winner under the index', async () => {
      const realm = 'guard-h9-concurrent';
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, bidder);
      // A genuine interleave: both transactions race the partial unique index
      // itself, not a pre-seeded loser.
      const [buyNowOut, winnerOut] = await Promise.all([
        marketDb.insertSettlement({
          listingId,
          bidId: null,
          attempt: 0,
          buyerAccount: buyer,
          buyerCharacter: 7601,
          buyerName: 'RaceBuyer',
          buyerWallet: 'wallet-race-buyer',
          amountCents: 1000,
          deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
          nowMs: BASE_MS,
        }),
        marketDb.insertSettlement({
          listingId,
          bidId,
          attempt: 1,
          buyerAccount: bidder,
          buyerCharacter: 7602,
          buyerName: 'RaceBidder',
          buyerWallet: 'wallet-race-bidder',
          amountCents: 700,
          deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
          nowMs: BASE_MS,
          winnerBidId: bidId,
        }),
      ]);
      const survivors = [buyNowOut, winnerOut].filter((o) => typeof o === 'object');
      expect(survivors).toHaveLength(1);
      const count = await pool.query(
        `SELECT count(*)::int AS n FROM woc_market_settlements WHERE listing_id = $1`,
        [listingId],
      );
      expect(count.rows[0].n).toBe(1);
      // The stamp exists exactly when the winner insert is the survivor: a
      // rolled-back loser leaves no settlement-less won bid behind.
      expect((await bidRow(bidId)).status).toBe(typeof winnerOut === 'object' ? 'won' : 'active');
    }, 20_000);

    it('the settle cascade promotes the next bidder atomically with the new settlement', async () => {
      const realm = 'guard-h9-cascade';
      const seller = await seedAccount();
      const winner = await seedAccount();
      const runnerUp = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling', offerNext: true });
      const winnerBid = await seedBid(realm, listingId, winner, {
        amountCents: 900,
        bondReference: 'bond-ref-cascade-winner',
      });
      await pool.query(`UPDATE woc_market_bids SET status = 'won' WHERE id = $1`, [winnerBid]);
      const runnerUpBid = await seedBid(realm, listingId, runnerUp, {
        amountCents: 800,
        status: 'outbid',
        bondState: 'refund_due',
        bondReference: 'bond-ref-cascade-runner-up',
      });
      await seedSettlement(realm, listingId, winner, {
        bidId: winnerBid,
        deadlineAtMs: BASE_MS - MINUTE_MS,
      });
      await makeService(realm).sweepPass();
      // The defaulted winner's forfeit also resolves inside the same pass.
      expect(await bidRow(winnerBid)).toEqual({ status: 'defaulted', bondState: 'forfeited' });
      expect(await bidRow(runnerUpBid)).toEqual({ status: 'won', bondState: 'held' });
      const settlements = await pool.query(
        `SELECT bid_id, state, attempt FROM woc_market_settlements WHERE listing_id = $1 ORDER BY id`,
        [listingId],
      );
      expect(settlements.rows).toHaveLength(2);
      expect(Number(settlements.rows[1].bid_id)).toBe(runnerUpBid);
      expect(settlements.rows[1].state).toBe('offered');
      expect(settlements.rows[1].attempt).toBe(2);
    }, 20_000);

    it('the cascade unwinds its bond re-hold when a settlement raced into the retry window', async () => {
      const realm = 'guard-h9-cascade-conflict';
      const seller = await seedAccount();
      const winner = await seedAccount();
      const runnerUp = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling', offerNext: true });
      const winnerBid = await seedBid(realm, listingId, winner, {
        amountCents: 900,
        bondReference: 'bond-ref-cc-winner',
      });
      await pool.query(`UPDATE woc_market_bids SET status = 'won' WHERE id = $1`, [winnerBid]);
      const runnerUpBid = await seedBid(realm, listingId, runnerUp, {
        amountCents: 800,
        status: 'outbid',
        bondState: 'held',
        bondReference: 'bond-ref-cc-runner-up',
      });
      // The winner's settlement failed and its window lapsed, but a second
      // open settlement raced into the freed index slot before the sweep
      // reached the listing (the 'failed' retry window is exactly where the
      // one-open-settlement index momentarily has no row).
      const failed = await seedSettlement(realm, listingId, winner, {
        bidId: winnerBid,
        deadlineAtMs: BASE_MS - MINUTE_MS,
      });
      await setSettlementState(failed.id, 'failed');
      const racer = await seedSettlement(realm, listingId, buyer);
      await makeService(realm).sweepPass();
      // The cascade picked the runner-up, its insert refused against the
      // racer, the won stamp rolled back, and the re-held bond went straight
      // back through the refund pipeline (terminal in the same pass).
      expect((await settlementRow(failed.id)).state).toBe('expired');
      expect(await bidRow(runnerUpBid)).toEqual({ status: 'outbid', bondState: 'refunded' });
      const offered = await pool.query(
        `SELECT id FROM woc_market_settlements WHERE listing_id = $1 AND state = 'offered'`,
        [listingId],
      );
      expect(offered.rows.map((r) => Number(r.id))).toEqual([racer.id]);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // One sale row per listing
  // -------------------------------------------------------------------------

  describe('the sales table refuses a second sale for one listing', () => {
    async function saleArgs(realm: string, listingId: number, seller: number, buyer: number) {
      return {
        realm,
        listingId,
        itemId: 'crown_of_embers',
        item: { itemId: 'crown_of_embers', count: 1 },
        priceCents: 1000,
        amountBase: '1000000',
        sellerAccount: seller,
        buyerAccount: buyer,
        sellerName: 'SellerSale',
        buyerName: 'BuyerSale',
      };
    }

    it('a duplicate sale insert fails closed at the constraint', async () => {
      const realm = 'guard-sale-unique';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const args = await saleArgs(realm, listingId, seller, buyer);
      await marketDb.insertSale(args);
      await expect(marketDb.insertSale(args)).rejects.toMatchObject({
        code: '23505',
        constraint: 'woc_market_sales_listing_once',
      });
    });

    it('the boot repair voids a legacy duplicate sale instead of failing the boot', async () => {
      const realm = 'guard-repair-sales';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      // Two non-excluded rows for one listing were legal before the index;
      // re-applying the schema must keep the earliest and void the rest, not
      // die on the CREATE UNIQUE INDEX.
      await pool.query('DROP INDEX woc_market_sales_listing_once');
      let firstId: number;
      let secondId: number;
      try {
        const args = await saleArgs(realm, listingId, seller, buyer);
        firstId = await marketDb.insertSale(args);
        secondId = await marketDb.insertSale(args);
        await pool.query(schemaSql);
      } finally {
        // A failure above must not leave the rest of the file running without
        // the invariant under test.
        await pool.query(schemaSql);
      }
      const rows = await pool.query(
        `SELECT id, excluded FROM woc_market_sales WHERE listing_id = $1 ORDER BY id`,
        [listingId],
      );
      expect(rows.rows.map((r) => [Number(r.id), r.excluded])).toEqual([
        [firstId, false],
        [secondId, true],
      ]);
      const rebuilt = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE indexname = 'woc_market_sales_listing_once'`,
      );
      expect(rebuilt.rows).toHaveLength(1);
    }, 20_000);

    it('an operator-voided sale row admits its correction', async () => {
      const realm = 'guard-sale-excluded';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const args = await saleArgs(realm, listingId, seller, buyer);
      const firstId = await marketDb.insertSale(args);
      expect(await marketDb.setSaleExcluded(firstId, true)).toBe('ok');
      const secondId = await marketDb.insertSale(args);
      expect(secondId).not.toBe(firstId);
      const rows = await pool.query(
        `SELECT excluded FROM woc_market_sales WHERE listing_id = $1 ORDER BY id`,
        [listingId],
      );
      expect(rows.rows.map((r) => r.excluded)).toEqual([true, false]);
      // Re-including the voided row while its correction stands refuses as a
      // typed miss, never a thrown 23505.
      // A refused re-include is a distinct 'conflict' (the operator hears
      // what is actually in the way), never conflated with a missing row.
      expect(await marketDb.setSaleExcluded(firstId, false)).toBe('conflict');
      expect(await marketDb.setSaleExcluded(secondId, true)).toBe('ok');
      expect(await marketDb.setSaleExcluded(firstId, false)).toBe('ok');
    });
  });

  // -------------------------------------------------------------------------
  // The QA round's race pins: insert-vs-close, the ordered bid locks, the
  // retry revival, the quoted-offered suspend, and the CAS floor
  // -------------------------------------------------------------------------

  describe('a due no-bid auction under a live buy-now settlement', () => {
    it('parks settling instead of closing no_bids over the payment', async () => {
      const realm = 'guard-close-nobids-live';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, { endsAtMs: BASE_MS - MINUTE_MS });
      await seedSettlement(realm, listingId, buyer);
      await makeService(realm).sweepPass();
      // The unguarded close was the dupe hole: 'no_bids' would mail the
      // escrow home while the settlement can still pay and deliver.
      const row = await listingRow(listingId);
      expect(row.status).toBe('settling');
      expect(row.resolution).toBeNull();
    }, 20_000);
  });

  describe('settlement insert versus a concurrent close', () => {
    it('an insert blocked by a concurrent closer aborts instead of landing on the closed listing', async () => {
      const realm = 'guard-insert-vs-close';
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling' });
      const bidId = await seedBid(realm, listingId, bidder, {
        status: 'outbid',
        bondState: 'held',
      });
      const client = await pool.connect();
      try {
        // Hold the listing row the way suspend/cancel do, then fire the REAL
        // insertSettlement: its statement snapshot still sees the open
        // listing, so only the explicit row lock plus the re-read can refuse.
        await client.query('BEGIN');
        await client.query(`SELECT 1 FROM woc_market_listings WHERE id = $1 FOR UPDATE`, [
          listingId,
        ]);
        const insert = marketDb.insertSettlement({
          listingId,
          bidId,
          attempt: 2,
          buyerAccount: bidder,
          buyerCharacter: 7900,
          buyerName: 'RaceBuyer',
          buyerWallet: 'wallet-race',
          amountCents: 900,
          deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
          nowMs: BASE_MS,
          winnerBidId: bidId,
          winnerFrom: ['outbid'],
        });
        const first = await Promise.race([
          insert.then(() => 'resolved'),
          delay(200).then(() => 'blocked'),
        ]);
        expect(first).toBe('blocked');
        await client.query(
          `UPDATE woc_market_listings
              SET status = 'closed', resolution = 'suspended', updated_at = now()
            WHERE id = $1`,
          [listingId],
        );
        await client.query('COMMIT');
        expect(await insert).toBe('listing_closed');
        // The winner stamp rolled back with the refused insert, and nothing
        // landed on the closed listing.
        expect((await bidRow(bidId)).status).toBe('outbid');
        const none = await pool.query(
          `SELECT count(*)::int AS n FROM woc_market_settlements WHERE listing_id = $1`,
          [listingId],
        );
        expect(none.rows[0].n).toBe(0);
      } finally {
        client.release();
      }
    }, 20_000);
  });

  describe('bond activation versus suspend, with a standing bid in the book', () => {
    it('the crossing lock shape resolves without a deadlock', async () => {
      const realm = 'guard-activate-deadlock';
      const seller = await seedAccount();
      const standingBidder = await seedAccount();
      const pendingBidder = await seedAccount();
      const listingId = await seedListing(realm, seller);
      // The standing 'active' bid has the LOWER id and is the listing's
      // current bid: the exact fixture where the old activateBid (own bid,
      // then listing, then the PREVIOUS bid) crossed the suspend guard's
      // ordered scan and one side died 40P01.
      const standingBid = await seedBid(realm, listingId, standingBidder, { amountCents: 700 });
      const pendingBid = await seedBid(realm, listingId, pendingBidder, {
        status: 'pending_bond',
        bondState: 'pending',
        amountCents: 900,
      });
      await pool.query(
        `UPDATE woc_market_listings SET current_bid_cents = 700, current_bid_id = $2 WHERE id = $1`,
        [listingId, standingBid],
      );
      const client = await pool.connect();
      try {
        // Park the standing bid's row lock, queue the REAL suspend on it
        // first and the REAL activation behind it, then release: under the
        // old lock order the activation held its own bid plus the listing and
        // then asked for the standing bid, completing the cycle the moment
        // the suspend acquired it.
        await client.query('BEGIN');
        await client.query(`SELECT 1 FROM woc_market_bids WHERE id = $1 FOR UPDATE`, [standingBid]);
        const suspend = marketDb.suspendListingIfSafe(realm, listingId, BASE_MS);
        await delay(150);
        const activate = marketDb.activateBid(pendingBid, BASE_MS);
        await delay(150);
        await client.query('COMMIT');
        const [suspendOut, activateOut] = await Promise.all([suspend, activate]);
        // Deterministic winner: the suspend queued first on the standing bid.
        expect(suspendOut).toMatchObject({
          id: listingId,
          status: 'closed',
          resolution: 'suspended',
        });
        expect(activateOut).toBe('not_pending');
        expect(await bidRow(standingBid)).toEqual({
          status: 'cancelled',
          bondState: 'refund_due',
        });
        expect((await bidRow(pendingBid)).status).toBe('cancelled');
      } finally {
        client.release();
      }
    }, 20_000);
  });

  describe('the failed-settlement retry revival', () => {
    it('cannot revive over a second open settlement: a typed refusal, never a 500', async () => {
      const realm = 'guard-quote-revive';
      const seller = await seedAccount();
      const buyerA = await seedAccount();
      const buyerB = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling' });
      const failed = await seedSettlement(realm, listingId, buyerA, { state: 'failed' });
      // Legal coexistence: 'failed' sits outside the open-set index, so a
      // second open settlement can stand beside it (the cascade builds
      // exactly this pair).
      const live = await seedSettlement(realm, listingId, buyerB);
      const service = makeService(realm);
      const out = await service.settlementQuote(buyerA, failed.id);
      expect(out).toMatchObject({ ok: false, reason: 'not_active' });
      expect((await settlementRow(failed.id)).state).toBe('failed');
      expect((await settlementRow(live.id)).state).toBe('offered');
    });

    it('a lone failed settlement still revives for its retry', async () => {
      const realm = 'guard-quote-revive-ok';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling' });
      const failed = await seedSettlement(realm, listingId, buyer, { state: 'failed' });
      const service = makeService(realm);
      const out = await service.settlementQuote(buyer, failed.id);
      expect(out).toMatchObject({ ok: true });
      expect((await settlementRow(failed.id)).state).toBe('offered');
    });
  });

  describe('suspend versus a quoted offered settlement', () => {
    it('refuses while the quote is live: the buyer may already have broadcast payment', async () => {
      const realm = 'guard-suspend-quoted';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const settlement = await seedSettlement(realm, listingId, buyer);
      await pool.query(
        `UPDATE woc_market_settlements
            SET quote_reference = 'quote-live-1', quote_expires = to_timestamp($2 / 1000.0)
          WHERE id = $1`,
        [settlement.id, BASE_MS + 5 * MINUTE_MS],
      );
      expect(await marketDb.suspendListingIfSafe(realm, listingId, BASE_MS)).toBe(
        'settlement_live',
      );
      expect((await settlementRow(settlement.id)).state).toBe('offered');
      expect((await listingRow(listingId)).status).toBe('active');
    });

    it('proceeds once the quote expired: no payment can ride it any more', async () => {
      const realm = 'guard-suspend-quote-expired';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const settlement = await seedSettlement(realm, listingId, buyer);
      await pool.query(
        `UPDATE woc_market_settlements
            SET quote_reference = 'quote-stale-1', quote_expires = to_timestamp($2 / 1000.0)
          WHERE id = $1`,
        [settlement.id, BASE_MS - MINUTE_MS],
      );
      const out = await marketDb.suspendListingIfSafe(realm, listingId, BASE_MS);
      expect(out).toMatchObject({ id: listingId, status: 'closed', resolution: 'suspended' });
      const after = await settlementRow(settlement.id);
      expect(after.state).toBe('expired');
      expect(after.failReason).toBe('listing_suspended');
    });
  });

  describe('bid status compare-and-set floor', () => {
    it('markBidStatus with a from set refuses a bid outside it; the bare form moves it', async () => {
      const realm = 'guard-bid-cas';
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, bidder, { status: 'cancelled' });
      await marketDb.markBidStatus(bidId, 'outbid', ['active']);
      expect((await bidRow(bidId)).status).toBe('cancelled');
      await marketDb.markBidStatus(bidId, 'outbid');
      expect((await bidRow(bidId)).status).toBe('outbid');
    });

    it('the atomic demote outbids an active bid and queues its held bond in one call', async () => {
      const realm = 'guard-bid-demote';
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const cancelledBidder = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const activeBid = await seedBid(realm, listingId, bidder);
      const cancelledBid = await seedBid(realm, listingId, cancelledBidder, {
        status: 'cancelled',
        bondState: 'held',
      });
      await marketDb.markBidOutbidQueueRefund(activeBid);
      expect(await bidRow(activeBid)).toEqual({ status: 'outbid', bondState: 'refund_due' });
      // The CAS from 'active': a cancelled bid (and its bond) is left alone.
      await marketDb.markBidOutbidQueueRefund(cancelledBid);
      expect(await bidRow(cancelledBid)).toEqual({ status: 'cancelled', bondState: 'held' });
    });
  });

  describe('terminal states stay outside the liveness surface', () => {
    it('an expired settlement is invisible to liveSettlementForListing and no bar to suspend', async () => {
      const realm = 'guard-terminal-negatives';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      await seedSettlement(realm, listingId, buyer, { state: 'expired' });
      expect(await marketDb.liveSettlementForListing(listingId)).toBeNull();
      const out = await marketDb.suspendListingIfSafe(realm, listingId, BASE_MS);
      expect(out).toMatchObject({ id: listingId, status: 'closed', resolution: 'suspended' });
    });
  });

  describe('the stranded reclaim arm', () => {
    it('leaves a failed settlement parked for the overdue default pass, never expires it', async () => {
      const realm = 'guard-reclaim-failed';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const bidder = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling' });
      // The close-time shape: a won bid with a held bond behind the failed
      // settlement. Reclaiming (and expiring) here would silently skip the
      // deadline pass that defaults the winner, forfeits the bond, records
      // the strike, and runs the cascade; the bond would sit 'held' forever.
      const wonBid = await seedBid(realm, listingId, bidder, {
        status: 'won',
        bondState: 'held',
      });
      const failed = await seedSettlement(realm, listingId, buyer, {
        state: 'failed',
        bidId: wonBid,
      });
      await makeService(realm).sweepPass();
      const after = await settlementRow(failed.id);
      expect(after.state).toBe('failed');
      expect((await listingRow(listingId)).status).toBe('settling');
      expect(await bidRow(wonBid)).toEqual({ status: 'won', bondState: 'held' });
    }, 20_000);

    it('the reopen statement itself refuses while an open or failed settlement rides the listing', async () => {
      const realm = 'guard-reclaim-reopen-belt';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling' });
      const settlement = await seedSettlement(realm, listingId, buyer);
      // The belt under the read-then-act arm: a direct reopen with an open
      // settlement present must not move the row; a retry-eligible 'failed'
      // row refuses too (it belongs to the overdue default pass).
      await marketDb.reopenListing(listingId);
      expect((await listingRow(listingId)).status).toBe('settling');
      await setSettlementState(settlement.id, 'failed');
      await marketDb.reopenListing(listingId);
      expect((await listingRow(listingId)).status).toBe('settling');
      await setSettlementState(settlement.id, 'expired');
      await marketDb.reopenListing(listingId);
      expect((await listingRow(listingId)).status).toBe('active');
    });
  });

  describe('the overdue default pass respects a prior bid resolution', () => {
    it('never re-labels a suspend-released bid as defaulted (the [won] CAS)', async () => {
      // The suspend-race shape the default site's comment describes: the
      // suspend CTE already cancelled the winner with its refund queued, but
      // the sweep's overdue read selected the settlement before that commit.
      // Without the ['won'] CAS on markBidStatus (and the ['held'] CAS on
      // setBondState) the default pass would stamp defaulted/forfeit_due on
      // top of the resolution and forfeit a bond whose refund is already
      // owed.
      const realm = 'guard-default-cas';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const bidder = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling' });
      const releasedBid = await seedBid(realm, listingId, bidder, {
        status: 'cancelled',
        bondState: 'refund_due',
        bondReference: 'guard-default-cas-ref',
      });
      await seedSettlement(realm, listingId, buyer, {
        state: 'offered',
        bidId: releasedBid,
        deadlineAtMs: BASE_MS - MINUTE_MS,
      });
      await makeService(realm).sweepPass();
      // The same pass's release arm may legitimately advance refund_due to
      // refunded (the dev economy releases immediately); the pin is that the
      // resolution is never OVERWRITTEN: status stays cancelled (the ['won']
      // CAS) and the bond is never forfeited (the ['held'] CAS).
      const after = await bidRow(releasedBid);
      expect(after.status).toBe('cancelled');
      expect(after.bondState).not.toBe('forfeit_due');
    }, 20_000);
  });

  describe('administrative expiry releases the settlement winner', () => {
    it('a suspend over a failed close-time settlement cancels its won bid and queues the bond refund', async () => {
      const realm = 'guard-suspend-winner-release';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const bidder = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling' });
      const wonBid = await seedBid(realm, listingId, bidder, {
        status: 'won',
        bondState: 'held',
      });
      const failed = await seedSettlement(realm, listingId, buyer, {
        state: 'failed',
        bidId: wonBid,
      });
      const out = await marketDb.suspendListingIfSafe(realm, listingId, BASE_MS);
      expect(out).toMatchObject({ id: listingId, status: 'closed', resolution: 'suspended' });
      const after = await settlementRow(failed.id);
      expect(after.state).toBe('expired');
      expect(after.failReason).toBe('listing_suspended');
      // The CTE released the winner in the same statement: without it the
      // bid sits 'won' with a held bond no sweep arm can ever reach.
      expect(await bidRow(wonBid)).toEqual({ status: 'cancelled', bondState: 'refund_due' });
    });
  });
  describe('activity reads are item-named (the real SQL, not just the fake twin)', () => {
    it('settlementsByAccount joins the listed item onto every row', async () => {
      const realm = `settlements-itemized-${Date.now()}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      // TWO listings with DIFFERENT items, both settled by the same buyer: the
      // pin reaches the CORRELATION itself (a single-listing seed passes an
      // uncorrelated lookup that names every row after the first listing).
      const crown = await seedListing(realm, seller);
      const plate = await seedListing(realm, seller, { itemId: 'deathlord_warplate' });
      await seedSettlement(realm, crown, buyer);
      await seedSettlement(realm, plate, buyer);
      const rows = await marketDb.settlementsByAccount(realm, buyer, 10);
      expect(rows).toHaveLength(2);
      const named = new Map(rows.map((r) => [r.listingId, r.itemId]));
      expect(named.get(crown), 'the correlated listing lookup, row 1').toBe('crown_of_embers');
      expect(named.get(plate), 'the correlated listing lookup, row 2').toBe('deathlord_warplate');
    });
  });

  // -------------------------------------------------------------------------
  // H11 hot-path scale guards: the chain arms' single-winner exclusion (what
  // replaces the whole-pass advisory lock for the unlocked sweep segments)
  // and the activity fan-out's one-pool-client bound, both against real
  // Postgres.
  // -------------------------------------------------------------------------

  describe('hot-path scale guards', () => {
    it('two concurrent sweepers cannot double-confirm one settlement (the chain-arm CAS)', async () => {
      const realm = 'guard-h11-poll-cas';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const settlement = await seedSettlement(realm, listingId, buyer, { state: 'confirming' });
      // The chain-polls segment runs UNLOCKED now, so the deploy-overlap case
      // is two processes reaching the same verdict write together. The
      // from-state CAS is the exclusion: exactly one wins, and the loser's
      // EvalPlanQual re-check sees the moved row rather than re-applying.
      const [a, b] = await Promise.all([
        marketDb.transitionSettlement(settlement.id, ['confirming'], 'confirmed'),
        marketDb.transitionSettlement(settlement.id, ['confirming'], 'confirmed'),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
      expect((await settlementRow(settlement.id)).state).toBe('confirmed');
    });

    it('two concurrent sweepers race a bond payout write to exactly one winner', async () => {
      const realm = 'guard-h11-bond-cas';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, buyer, {
        status: 'outbid',
        bondState: 'refund_due',
        bondReference: 'woc_bond:h11-cas',
      });
      const [a, b] = await Promise.all([
        marketDb.setBondState(bidId, ['refund_due'], 'refunded'),
        marketDb.setBondState(bidId, ['refund_due'], 'refunded'),
      ]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
    });

    it('the activity readout holds at most ONE pool client at a time (counted at the pool)', async () => {
      const realm = 'guard-h11-me-pool';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      await seedBid(realm, listingId, buyer, {});
      await seedSettlement(realm, listingId, buyer, { state: 'offered' });
      // A dedicated two-client pool plus a gauge over query(): the six-way
      // Promise.all this replaces held up to six clients per request, so the
      // decisive assertion is the PEAK, not the outcome (the pool-hold bound
      // must be COUNTED, never just passed functionally).
      const gaugePool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 2 });
      let inFlight = 0;
      let peak = 0;
      const counting = {
        query: async (...args: unknown[]) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          try {
            return await (gaugePool.query as (...a: unknown[]) => Promise<unknown>)(...args);
          } finally {
            inFlight--;
          }
        },
        // Explicit checkouts count too, for their whole hold: a read
        // refactored onto withTx must not escape the gauge (today every
        // activity read is a one-shot pool.query, so connect() going
        // unexercised here is itself part of the pin).
        connect: async () => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          const client = await gaugePool.connect();
          const release = client.release.bind(client);
          client.release = (destroy?: boolean | Error) => {
            inFlight--;
            client.release = release;
            return release(destroy as Error | undefined);
          };
          return client;
        },
      };
      const marketDbMod = await import('../server/woc_market_db');
      const countingDb = new marketDbMod.PgWocMarketDb(counting as unknown as Pool);
      const service = new marketMod.WocMarketService({
        db: countingDb,
        economy: proxyMod.createDevWocMarketEconomy(() => BASE_MS),
        custody: {
          runSerialized: () => {
            throw new Error('custody not exercised');
          },
          persistGrantSerialized: () => {
            throw new Error('custody not exercised');
          },
          ownsLiveCharacter: () => true,
          escrowSessionLost: () => {},
          extractCopy: () => {
            throw new Error('custody not exercised');
          },
          grantCopy: () => {
            throw new Error('custody not exercised');
          },
          snapshotCopy: () => {
            throw new Error('custody not exercised');
          },
          restoreCopy: () => {},
          persistMailParcel: async () => {},
          hasParcel: () => false,
        },
        verifiedWallet: async () => 'wallet-fixture',
        balanceTokens: async () => 1_000_000,
        stepUpDevSig: true,
        config: {
          enabled: true,
          realm,
          policy: rulesMod.WOC_MARKET_RESTRICTED_POLICY,
          confirmingReviewMs: 6 * 3600 * 1000,
        },
        now: () => BASE_MS,
      });
      try {
        const activity = await service.myActivity(buyer);
        // The reads really ran (rows came back), one at a time.
        expect(activity.bids).toHaveLength(1);
        expect(activity.settlements).toHaveLength(1);
        expect(peak).toBe(1);
      } finally {
        await gaugePool.end().catch(() => {});
      }
    });

    it('the realm advisory lock EXCLUDES a second session against real Postgres', async () => {
      // The shell suite proves the sweep honors a false try-lock answer over
      // a fake; THIS proves the SQL itself excludes, executing the EXPORTED
      // statement strings the shell issues (one source of truth: a
      // hashtext-shape drift cannot pass the text pin while this proof runs
      // a different statement), with the exact key constant, two sessions.
      const sweepMod = await import('../server/woc_market_sweep');
      const realm = 'guard-h11-advisory';
      const a = await pool.connect();
      const b = await pool.connect();
      try {
        const lock = (client: typeof a | typeof b) =>
          client.query(sweepMod.WOC_MARKET_SWEEP_LOCK_SQL, [
            sweepMod.WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY,
            realm,
          ]);
        const first = await lock(a);
        expect(first.rows[0]?.ok).toBe(true);
        // The peer loses while the lock is held...
        const second = await lock(b);
        expect(second.rows[0]?.ok).toBe(false);
        // ...and wins as soon as the holder releases (per-segment release is
        // what hands the realm's sweep between peers).
        const unlocked = await a.query(sweepMod.WOC_MARKET_SWEEP_UNLOCK_SQL, [
          sweepMod.WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY,
          realm,
        ]);
        expect(unlocked.rows[0]?.ok).toBe(true);
        const third = await lock(b);
        expect(third.rows[0]?.ok).toBe(true);
        await b.query(sweepMod.WOC_MARKET_SWEEP_UNLOCK_SQL, [
          sweepMod.WOC_MARKET_SWEEP_ADVISORY_LOCK_KEY,
          realm,
        ]);
      } finally {
        a.release();
        b.release();
      }
    });

    it('two concurrent sweepers race a bid LAPSE to exactly one winner', async () => {
      const realm = 'guard-h11-lapse-cas';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, buyer, {
        status: 'pending_bond',
        bondState: 'pending',
      });
      // The guarded lapse is one of the unlocked chain-poll segment's
      // single-winner writes: its status+bond_state qual is the exclusion.
      const [a, b] = await Promise.all([marketDb.lapseBid(bidId), marketDb.lapseBid(bidId)]);
      expect([a, b].filter(Boolean)).toHaveLength(1);
    });

    it('two concurrent anti-snipe extensions converge on ONE absolute close, never a compound', async () => {
      const realm = 'guard-h11-extend-cas';
      const seller = await seedAccount();
      const endsAtMs = BASE_MS + 60 * MINUTE_MS;
      const target = endsAtMs + 5 * MINUTE_MS;
      const listingId = await seedListing(realm, seller, { endsAtMs });
      // The real caller computes an ABSOLUTE target from the anchor and the
      // base cap and answers null once the row already reaches it, so a
      // racing peer re-reading under FOR UPDATE skips instead of stacking a
      // second extension on the first one's output.
      const extendTo = (row: { endsAtMs: number }) => (row.endsAtMs >= target ? null : target);
      const [a, b] = await Promise.all([
        marketDb.extendAuctionForBondProgress(realm, listingId, extendTo),
        marketDb.extendAuctionForBondProgress(realm, listingId, extendTo),
      ]);
      expect([a, b].filter((r) => r === 'extended')).toHaveLength(1);
      expect([a, b].filter((r) => r === 'skip')).toHaveLength(1);
      const row = await pool.query(
        `SELECT (extract(epoch FROM ends_at) * 1000)::bigint AS ends FROM woc_market_listings WHERE id = $1`,
        [listingId],
      );
      expect(Number(row.rows[0].ends)).toBe(target);
    });
  });

  describe('settlement signature intake, in real SQL', () => {
    it('the signature lands only on an offered row, and a reused signature answers typed', async () => {
      const realm = `sig-intake-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const offered = await seedSettlement(realm, await seedListing(realm, seller), buyer);
      const failed = await seedSettlement(realm, await seedListing(realm, seller), buyer, {
        state: 'failed',
      });
      const rival = await seedSettlement(realm, await seedListing(realm, seller), buyer);

      expect(await marketDb.submitSettlementSignature(offered.id, 'sig-shared')).toBe('ok');
      const recorded = await pool.query(
        `SELECT state, tx_signature FROM woc_market_settlements WHERE id = $1`,
        [offered.id],
      );
      expect(recorded.rows[0]).toEqual({ state: 'confirming', tx_signature: 'sig-shared' });

      // A non-offered row refuses and takes nothing: the signature-first
      // recording belongs to the offered window only.
      expect(await marketDb.submitSettlementSignature(failed.id, 'sig-late')).toBe('not_offered');
      const failedRow = await pool.query(
        `SELECT state, tx_signature FROM woc_market_settlements WHERE id = $1`,
        [failed.id],
      );
      expect(failedRow.rows[0]).toEqual({ state: 'failed', tx_signature: null });

      // The ledger holds ONE settlement per signature: a rival submitting the
      // same signature answers the typed word, never a raw 500, and stays
      // offered with no recording.
      expect(await marketDb.submitSettlementSignature(rival.id, 'sig-shared')).toBe(
        'signature_reused',
      );
      const rivalRow = await pool.query(
        `SELECT state, tx_signature FROM woc_market_settlements WHERE id = $1`,
        [rival.id],
      );
      expect(rivalRow.rows[0]).toEqual({ state: 'offered', tx_signature: null });
    });
  });

  describe('sweep batch predicates, in real SQL', () => {
    it('claimDueListings takes only ACTIVE listings whose close has passed', async () => {
      const realm = `sweep-due-${++seq}`;
      const seller = await seedAccount();
      const due = await seedListing(realm, seller, { endsAtMs: BASE_MS - MINUTE_MS });
      const future = await seedListing(realm, seller, { endsAtMs: BASE_MS + 60 * MINUTE_MS });
      const settling = await seedListing(realm, seller, {
        status: 'settling',
        endsAtMs: BASE_MS - MINUTE_MS,
      });
      const closed = await seedListing(realm, seller, {
        status: 'closed',
        endsAtMs: BASE_MS - MINUTE_MS,
      });
      // AT the bound: ends_at equal to now is already due (inclusive), the
      // same convention the bid intake's not_active bound holds, so a listing
      // at the close instant refuses bids AND gets claimed in the same tick.
      const atBound = await seedListing(realm, seller, { endsAtMs: BASE_MS });
      const took = await marketDb.claimDueListings(realm, BASE_MS, 10);
      expect(took.map((r) => r.id).sort((x, y) => x - y)).toEqual(
        [due, atBound].sort((x, y) => x - y),
      );
      expect((await listingRow(future)).status, 'an undue auction never closes early').toBe(
        'active',
      );
      expect((await listingRow(settling)).status, 'a settling window is not re-claimed').toBe(
        'settling',
      );
      expect((await listingRow(closed)).status).toBe('closed');
    });

    it('overdueSettlements is the default arm: offered and failed rows past deadline only', async () => {
      const realm = `sweep-overdue-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const offeredPast = await seedSettlement(realm, await seedListing(realm, seller), buyer, {
        deadlineAtMs: BASE_MS - 2 * MINUTE_MS,
      });
      const failedPast = await seedSettlement(realm, await seedListing(realm, seller), buyer, {
        state: 'failed',
        deadlineAtMs: BASE_MS - MINUTE_MS,
      });
      await seedSettlement(realm, await seedListing(realm, seller), buyer, {
        state: 'confirming',
        deadlineAtMs: BASE_MS - MINUTE_MS,
      });
      await seedSettlement(realm, await seedListing(realm, seller), buyer, {
        deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
      });
      const due = await marketDb.overdueSettlements(realm, BASE_MS, 10);
      // Exactly the offered and failed rows past deadline: the confirming row
      // belongs to the review arm and the future deadline is not due, both
      // excluded by the exact set.
      expect(due.map((r) => r.id)).toEqual([offeredPast.id, failedPast.id]);
    });
  });

  describe('seller cancel and terminal listing writes, in real SQL', () => {
    it('the cancel refusal ladder answers from the locked row', async () => {
      const realm = `cancel-ladder-${++seq}`;
      const seller = await seedAccount();
      const stranger = await seedAccount();
      const bidder = await seedAccount();
      const listing = await seedListing(realm, seller);
      expect(await marketDb.cancelListingIfUnbid(realm, listing, stranger, BASE_MS)).toBe(
        'not_yours',
      );
      const ending = await seedListing(realm, seller, { status: 'ending' });
      expect(await marketDb.cancelListingIfUnbid(realm, ending, seller, BASE_MS)).toBe(
        'not_active',
      );
      await seedBid(realm, listing, bidder, { status: 'active' });
      expect(await marketDb.cancelListingIfUnbid(realm, listing, seller, BASE_MS)).toBe('has_bids');
      expect((await listingRow(listing)).status, 'every refusal left the listing standing').toBe(
        'active',
      );
      // The OTHER member of the probe's status set: an unpaid pending_bond
      // bid is free to mint, and it alone must still deny the cancel (the
      // one-window bound the cancel-intent ruling promises).
      const pendingOnly = await seedListing(realm, seller);
      await seedBid(realm, pendingOnly, bidder, { status: 'pending_bond' });
      expect(await marketDb.cancelListingIfUnbid(realm, pendingOnly, seller, BASE_MS)).toBe(
        'has_bids',
      );
    });

    it('a PAID locked window refuses the cancel outright and takes no intent stamp', async () => {
      const realm = `cancel-paid-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listing = await seedListing(realm, seller);
      await pool.query(
        `UPDATE woc_market_listings
            SET buy_now_lock_account = $2, buy_now_lock_expires = to_timestamp($3 / 1000.0)
          WHERE id = $1`,
        [listing, buyer, BASE_MS + 5 * MINUTE_MS],
      );
      await seedSettlement(realm, listing, buyer, { state: 'confirming' });
      expect(await marketDb.cancelListingIfUnbid(realm, listing, seller, BASE_MS)).toBe(
        'settlement_live',
      );
      const stamped = await pool.query(
        `SELECT cancel_requested_at FROM woc_market_listings WHERE id = $1`,
        [listing],
      );
      expect(stamped.rows[0].cancel_requested_at, 'no intent stamp on a paid window').toBeNull();
    });

    it('cancel intent stamps once: a repeat request never moves the window', async () => {
      const realm = `cancel-stamp-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listing = await seedListing(realm, seller);
      await pool.query(
        `UPDATE woc_market_listings
            SET buy_now_lock_account = $2, buy_now_lock_expires = to_timestamp($3 / 1000.0)
          WHERE id = $1`,
        [listing, buyer, BASE_MS + 5 * MINUTE_MS],
      );
      expect(await marketDb.cancelListingIfUnbid(realm, listing, seller, BASE_MS)).toBe(
        'cancel_pending',
      );
      const first = await pool.query(
        `SELECT cancel_requested_at FROM woc_market_listings WHERE id = $1`,
        [listing],
      );
      expect(first.rows[0].cancel_requested_at).not.toBeNull();
      // Still inside the unexpired window (lock ends at +5 minutes): the
      // repeat request answers cancel_pending again without moving the stamp.
      expect(
        await marketDb.cancelListingIfUnbid(realm, listing, seller, BASE_MS + 2 * MINUTE_MS),
      ).toBe('cancel_pending');
      const second = await pool.query(
        `SELECT cancel_requested_at FROM woc_market_listings WHERE id = $1`,
        [listing],
      );
      expect(second.rows[0].cancel_requested_at, 'the one-window bound never restarts').toEqual(
        first.rows[0].cancel_requested_at,
      );
    });

    it('suspend releases only the WON bid of the settlement it expires', async () => {
      const realm = `suspend-won-only-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listing = await seedListing(realm, seller);
      const defaulted = await seedBid(realm, listing, buyer, {
        status: 'defaulted',
        bondState: 'forfeit_due',
      });
      await seedSettlement(realm, listing, buyer, { state: 'failed', bidId: defaulted });
      const out = await marketDb.suspendListingIfSafe(realm, listing, BASE_MS);
      expect(typeof out === 'object' ? out.id : out).toBe(listing);
      expect(await bidRow(defaulted), 'a defaulted verdict is history, not releasable').toEqual({
        status: 'defaulted',
        bondState: 'forfeit_due',
      });
    });

    it('terminal listing writes never resurrect or relabel a closed row', async () => {
      const realm = `terminal-writes-${++seq}`;
      const seller = await seedAccount();
      const closed = await seedListing(realm, seller, { status: 'closed' });
      await pool.query(`UPDATE woc_market_listings SET resolution = 'cancelled' WHERE id = $1`, [
        closed,
      ]);
      expect(await marketDb.closeListingIfNoOpenSettlement(closed, 'no_bids')).toBe(false);
      await marketDb.closeListing(closed, 'no_bids');
      await marketDb.markListingSettling(closed);
      await marketDb.reopenListing(closed);
      const row = await listingRow(closed);
      expect(row.status, 'closed is terminal').toBe('closed');
      expect(row.resolution, 'the recorded outcome never relabels').toBe('cancelled');
    });

    it('the cascade candidate read picks only eligible outbid rows at or above the floor', async () => {
      const realm = `cascade-read-${++seq}`;
      const seller = await seedAccount();
      const active = await seedAccount();
      const eligible = await seedAccount();
      const low = await seedAccount();
      const prior = await seedAccount();
      const listing = await seedListing(realm, seller);
      await seedBid(realm, listing, active, { status: 'active', amountCents: 950 });
      const out900 = await seedBid(realm, listing, eligible, {
        status: 'outbid',
        amountCents: 900,
      });
      await seedBid(realm, listing, low, { status: 'outbid', amountCents: 800 });
      await seedBid(realm, listing, prior, { status: 'outbid', amountCents: 920 });
      await seedBid(realm, listing, prior, { status: 'defaulted', amountCents: 990 });
      expect((await marketDb.nextCascadeBidder(listing, 850))?.id).toBe(out900);
      expect((await marketDb.nextCascadeBidder(listing, 900))?.id, 'the floor is inclusive').toBe(
        out900,
      );
      expect(
        await marketDb.nextCascadeBidder(listing, 901),
        'an active bid and a prior winner are never cascade candidates',
      ).toBeNull();
    });

    it('bondsDue reads only the due bond states', async () => {
      const realm = `bonds-due-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listing = await seedListing(realm, seller);
      const refund = await seedBid(realm, listing, bidder, {
        status: 'outbid',
        bondState: 'refund_due',
        placedAtMs: BASE_MS - 30 * MINUTE_MS,
      });
      const forfeit = await seedBid(realm, listing, bidder, {
        status: 'defaulted',
        bondState: 'forfeit_due',
        placedAtMs: BASE_MS - 20 * MINUTE_MS,
      });
      await seedBid(realm, listing, bidder, { status: 'won', bondState: 'held' });
      await seedBid(realm, listing, bidder, { status: 'lapsed', bondState: 'void' });
      await seedBid(realm, listing, bidder, { bondState: 'pending' });
      const due = await marketDb.bondsDue(realm, 10);
      expect(
        due.map((r) => r.id),
        'held, void, and pending money is not payable',
      ).toEqual([refund, forfeit]);
    });
  });

  describe('the schema CHECK constraints refuse unknown money states', () => {
    it('every state, format, and shape CHECK rejects at the database', async () => {
      const realm = `checks-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      await expect(seedListing(realm, seller, { status: 'bogus' })).rejects.toMatchObject({
        code: '23514',
        constraint: 'woc_market_listings_status_check',
      });
      await expect(
        pool.query(`UPDATE woc_market_listings SET resolution = 'bogus' WHERE id = $1`, [
          await seedListing(realm, seller),
        ]),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'woc_market_listings_resolution_check',
      });
      await expect(
        pool.query(
          `INSERT INTO woc_market_listings (
             realm, seller_account, seller_character, seller_name, seller_wallet,
             item, item_id, quality, format, start_cents, ends_at, base_ends_at
           ) VALUES ($1, $2, 1, 'S', 'w', '"str"'::jsonb, 'x', 'epic', 'auction',
                     500, now(), now())`,
          [realm, seller],
        ),
        'a non-object custody copy never lands',
      ).rejects.toMatchObject({ code: '23514', constraint: 'woc_market_listings_item_check' });
      await expect(
        pool.query(
          `INSERT INTO woc_market_listings (
             realm, seller_account, seller_character, seller_name, seller_wallet,
             item, item_id, quality, format, start_cents, ends_at, base_ends_at
           ) VALUES ($1, $2, 1, 'S', 'w', '{}'::jsonb, 'x', 'epic', 'bogus',
                     500, now(), now())`,
          [realm, seller],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'woc_market_listings_format_check' });
      const listing = await seedListing(realm, seller);
      await expect(seedBid(realm, listing, buyer, { status: 'bogus' })).rejects.toMatchObject({
        code: '23514',
        constraint: 'woc_market_bids_status_check',
      });
      await expect(seedBid(realm, listing, buyer, { bondState: 'bogus' })).rejects.toMatchObject({
        code: '23514',
        constraint: 'woc_market_bids_bond_state_check',
      });
      await expect(
        pool.query(`UPDATE woc_market_settlements SET state = 'bogus' WHERE id = $1`, [
          (await seedSettlement(realm, await seedListing(realm, seller), buyer)).id,
        ]),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'woc_market_settlements_state_check',
      });
      await expect(
        pool.query(
          `INSERT INTO woc_market_directed_offers (
             realm, seller_account, seller_character, seller_name, buyer_account,
             buyer_name, usd_cents, status, expires_at
           ) VALUES ($1, $2, 1, 'S', $3, 'B', 100, 'bogus', now())`,
          [realm, seller, buyer],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'woc_market_directed_offers_status_check',
      });
      // The two remaining jsonb shape CHECKs: sales provenance and the
      // directed offer's agreed-copy ref.
      await expect(
        pool.query(
          `INSERT INTO woc_market_sales (
             realm, listing_id, item_id, item, price_cents, amount_base,
             seller_account, buyer_account, seller_name, buyer_name
           ) VALUES ($1, $2, 'x', '"str"'::jsonb, 100, NULL, $3, $4, 'S', 'B')`,
          [realm, listing, seller, buyer],
        ),
      ).rejects.toMatchObject({ code: '23514', constraint: 'woc_market_sales_item_check' });
      await expect(
        pool.query(
          `INSERT INTO woc_market_directed_offers (
             realm, seller_account, seller_character, seller_name, buyer_account,
             buyer_name, usd_cents, status, expires_at, item_ref
           ) VALUES ($1, $2, 1, 'S', $3, 'B', 100, 'pending', now(), '"str"'::jsonb)`,
          [realm, seller, buyer],
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'woc_market_directed_offers_item_ref_check',
      });
    });
  });
});
