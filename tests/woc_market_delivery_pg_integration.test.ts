// Real-Postgres coverage for the $WOC Exchange delivery finalization: the
// exactly-once story under every crash point. The matrix seeds the durable
// residue each crash between two delivery steps would leave (a claim with no
// parcel, a parcel with no booking, a booking with no close tail, a delivered
// settlement with an open listing), then runs the REAL sweep and asserts the
// converged end state.
//
// Convergence has TWO postures and the matrix asserts both, because "exactly
// once" is as much about the deliveries that must NOT happen:
//   - CONVERGED (C0, C1, C3, C4, C5, C5b, C6): exactly one parcel, exactly one
//     sale row, the listing closed and disposed once, every bond flipped once.
//   - PARKED (C2a, C2b, C3b, C7, C8): no parcel at all, the settlement still
//     'delivering', and the row visible in the stuck-custody readout. A resume
//     that cannot PROVE the item was not already delivered is required to stop
//     here and wait for an operator.
// Two-connection interleaves pin the finalize transaction's lock participation
// (a snapshot predicate alone provably cannot refuse a concurrent closer; see
// the guard suite beside this one), and a rotation group pins that parking a
// row never hides it from the readout.
//
// Gate: TEST_DATABASE_URL (an admin URL on the dev Postgres from npm run
// db:up). The suite creates and drops its own database and never touches the
// database the URL points at. Pattern: tests/woc_market_settlement_pg_integration.test.ts.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BankLedgerOutboxSnapshot } from '../server/bank_ledger_outbox';
import type { StorageAppliedEffect } from '../server/storage_purchase_db';
import type {
  WocCustodyGrant,
  WocMarketCustody,
  WocMarketService,
  WocSettlementRow,
} from '../server/woc_market';
import type { PgWocMarketDb } from '../server/woc_market_db';
import type { CharacterState } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_woc_market_delivery_verify';

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

/** WocMarketCustody for the MAIL rail: an in-memory parcel book with the same
 *  custodyRef dedupe the live post office applies (the direct-grant rail has
 *  its own fake-db suite and the atomic save-and-book tests below). */
class ParcelCustody implements WocMarketCustody {
  readonly parcels: { letter: 'delivery' | 'return' | 'sold_notice'; custodyRef: string }[] = [];
  /** Every persistMailParcel CALL, in order: the parcel book above dedupes on
   *  the ref, so only this can say whether a second write was attempted. */
  readonly persistCalls: string[] = [];

  runSerialized(): never {
    throw new Error('escrow extraction is not exercised by this suite');
  }
  persistGrantSerialized(): never {
    // Unreachable here BY CONSTRUCTION: grantCopy answers offline, so every
    // delivery takes the mail rail and the FIFO grant entry never runs.
    throw new Error('the grant persist is not exercised by this suite (buyers read offline)');
  }
  ownsLiveCharacter(): boolean {
    return true;
  }
  escrowSessionLost(): void {}
  extractCopy(): never {
    throw new Error('escrow extraction is not exercised by this suite');
  }
  grantCopy(): WocCustodyGrant {
    // Every buyer reads as offline, so delivery always takes the mail rail.
    return { ok: false, reason: 'offline' };
  }
  snapshotCopy(): WocCustodyGrant {
    return { ok: false, reason: 'offline' };
  }
  restoreCopy(): void {}
  async persistMailParcel(
    _recipient: { key: string; name: string },
    letter: 'delivery' | 'return' | 'sold_notice',
    _items: InvSlot[],
    custodyRef: string,
  ): Promise<void> {
    this.persistCalls.push(custodyRef);
    if (this.parcels.some((p) => p.custodyRef === custodyRef)) return;
    this.parcels.push({ letter, custodyRef });
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

describeDb('woc market delivery finalization against real Postgres', () => {
  let admin: Pool;
  let pool: Pool;
  let db: typeof import('../server/db');
  let marketDb: PgWocMarketDb;
  let marketMod: typeof import('../server/woc_market');
  let proxyMod: typeof import('../server/woc_market_proxy');
  let rulesMod: typeof import('../server/woc_market_rules');
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

    // The REAL boot path, so every constraint and index under test is the one
    // production gets (the sale-dedupe index above all).
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
  // the one-open-settlement index stays the authority)
  // -------------------------------------------------------------------------

  async function seedAccount(): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`woc-delivery-fixture-${seq}`],
    );
    return Number(res.rows[0].id);
  }

  /** A real characters row, so deliveryTarget resolves the buyer. */
  async function seedCharacter(realm: string, accountId: number): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       VALUES ($1, $2, 'warrior', $3, 10, '{}'::jsonb) RETURNING id`,
      [accountId, `DeliveryChar${seq}`, realm],
    );
    return Number(res.rows[0].id);
  }

  async function seedListing(
    realm: string,
    sellerAccount: number,
    over: { status?: string; itemDisposed?: boolean; resolution?: string | null } = {},
  ): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO woc_market_listings (
         realm, seller_account, seller_character, seller_name, seller_wallet,
         item, item_id, quality, format, start_cents, buy_now_cents,
         offer_next, status, item_disposed, resolution, ends_at, base_ends_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'epic', 'auction_buy_now', 500, 1000,
         false, $8, $9, $10, to_timestamp($11 / 1000.0), to_timestamp($11 / 1000.0)
       ) RETURNING id`,
      [
        realm,
        sellerAccount,
        9000 + seq,
        `Seller${seq}`,
        `wallet-seller-${seq}`,
        JSON.stringify({ itemId: 'crown_of_embers', count: 1 }),
        'crown_of_embers',
        over.status ?? 'settling',
        over.itemDisposed ?? false,
        over.resolution ?? null,
        BASE_MS + 60 * MINUTE_MS,
      ],
    );
    return Number(res.rows[0].id);
  }

  async function seedBid(
    realm: string,
    listingId: number,
    account: number,
    over: { status?: string; bondState?: string } = {},
  ): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO woc_market_bids (
         listing_id, realm, account, character_id, character_name, wallet,
         amount_cents, status, bond_cents, bond_state, placed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 700, $7, 70, $8, to_timestamp($9 / 1000.0))
       RETURNING id`,
      [
        listingId,
        realm,
        account,
        8000 + seq,
        `Bidder${seq}`,
        `wallet-bidder-${seq}`,
        over.status ?? 'active',
        over.bondState ?? 'held',
        BASE_MS - 10 * MINUTE_MS,
      ],
    );
    return Number(res.rows[0].id);
  }

  async function seedSettlement(
    listingId: number,
    buyerAccount: number,
    buyerCharacter: number,
    over: { state?: string; bidId?: number | null } = {},
  ): Promise<WocSettlementRow> {
    const out = await marketDb.insertSettlement({
      listingId,
      bidId: over.bidId ?? null,
      attempt: over.bidId ? 1 : 0,
      buyerAccount,
      buyerCharacter,
      buyerName: `Buyer${seq}`,
      buyerWallet: `wallet-buyer-${seq}`,
      amountCents: 1000,
      deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
      nowMs: BASE_MS,
    });
    if (typeof out === 'string') throw new Error(`fixture settlement refused: ${out}`);
    if (over.state && over.state !== 'offered') {
      await pool.query(
        `UPDATE woc_market_settlements SET state = $2, updated_at = now() WHERE id = $1`,
        [out.id, over.state],
      );
    }
    return out;
  }

  /** The service clock. MUTABLE on purpose: the minute-gated residue beats
   *  (redriven, disposed) return 0 without doing anything while the clock
   *  stands still, so a re-run assertion under a frozen clock passes over a
   *  beat that never ran. makeService rebases it, and a test advances it. */
  let clockMs = BASE_MS;
  const setNow = (ms: number): void => {
    clockMs = ms;
  };

  function makeService(realm: string, custody: ParcelCustody): WocMarketService {
    clockMs = BASE_MS;
    return new marketMod.WocMarketService({
      db: marketDb,
      economy: proxyMod.createDevWocMarketEconomy(() => clockMs),
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
      now: () => clockMs,
      // The matrix asserts convergence; an arm failure must fail the test
      // loudly rather than score a quiet zero.
      onSweepError: (arm, err) => {
        throw new Error(`sweep arm ${arm} failed: ${String(err)}`);
      },
    });
  }

  /** The full delivered end state, asserted after every crash point. */
  async function expectDeliveredExactlyOnce(opts: {
    listingId: number;
    settlementId: number;
    custody: ParcelCustody;
    custodyRef: string;
    parcels: number;
    winnerBidId?: number;
    loserBidId?: number;
  }): Promise<void> {
    const listing = await pool.query(
      `SELECT status, resolution, item_disposed FROM woc_market_listings WHERE id = $1`,
      [opts.listingId],
    );
    expect(listing.rows[0]).toEqual({
      status: 'closed',
      resolution: 'sold',
      item_disposed: true,
    });
    const settlement = await pool.query(`SELECT state FROM woc_market_settlements WHERE id = $1`, [
      opts.settlementId,
    ]);
    expect(settlement.rows[0].state).toBe('delivered');
    const sales = await pool.query(
      `SELECT count(*)::int AS n FROM woc_market_sales WHERE listing_id = $1 AND excluded = false`,
      [opts.listingId],
    );
    expect(sales.rows[0].n, 'exactly one sale row').toBe(1);
    const claim = await pool.query(
      `SELECT booked_at FROM woc_market_custody_claims WHERE custody_ref = $1`,
      [opts.custodyRef],
    );
    expect(claim.rows[0]?.booked_at, 'the claim is booked').not.toBeNull();
    const booked = opts.custody.parcels.filter((p) => p.custodyRef === opts.custodyRef);
    expect(booked, 'exactly the expected parcel count').toHaveLength(opts.parcels);
    // The ref alone does not say WHICH letter went out, and the three letters
    // are addressed to different people: a delivery ref carrying the return
    // letter would post the buyer's item back to the seller.
    for (const parcel of booked) expect(parcel.letter).toBe('delivery');
    // Bond invariants that survive the SAME pass's bond arm (which resolves a
    // reference-less refund_due to 'void' right after the finalize flips it):
    // never stranded 'held', never forfeited. The precise refund_due flip is
    // pinned by the direct-finalize interleave tests, where no bond arm runs.
    if (opts.winnerBidId !== undefined) {
      const winner = await pool.query(
        `SELECT status, bond_state FROM woc_market_bids WHERE id = $1`,
        [opts.winnerBidId],
      );
      expect(winner.rows[0].status).toBe('won');
      expect(['refund_due', 'refunded', 'void']).toContain(winner.rows[0].bond_state);
    }
    if (opts.loserBidId !== undefined) {
      const loser = await pool.query(
        `SELECT status, bond_state FROM woc_market_bids WHERE id = $1`,
        [opts.loserBidId],
      );
      expect(loser.rows[0].status).toBe('cancelled');
      expect(['refund_due', 'refunded', 'void']).toContain(loser.rows[0].bond_state);
    }
  }

  /** Seed the standard delivery scene: listing + buyer character + winner and
   *  loser bids + a settlement in the given state. */
  async function seedScene(
    realm: string,
    state: string,
  ): Promise<{
    listingId: number;
    settlement: WocSettlementRow;
    buyerCharacter: number;
    winnerBidId: number;
    loserBidId: number;
    custodyRef: string;
  }> {
    const seller = await seedAccount();
    const buyer = await seedAccount();
    const buyerCharacter = await seedCharacter(realm, buyer);
    const listingId = await seedListing(realm, seller);
    const winnerBidId = await seedBid(realm, listingId, buyer, {
      status: 'won',
      bondState: 'held',
    });
    const loserBidId = await seedBid(realm, listingId, await seedAccount(), {
      status: 'active',
      bondState: 'held',
    });
    const settlement = await seedSettlement(listingId, buyer, buyerCharacter, {
      state,
      bidId: winnerBidId,
    });
    return {
      listingId,
      settlement,
      buyerCharacter,
      winnerBidId,
      loserBidId,
      custodyRef: rulesMod.settlementCustodyRef(settlement.id),
    };
  }

  // -------------------------------------------------------------------------
  // The crash-point matrix: seed each residue, run the sweep, assert the one
  // converged end state.
  // -------------------------------------------------------------------------

  describe('delivery crash-point matrix', () => {
    it('C0: a confirmed settlement delivers end to end, and a re-run changes nothing', async () => {
      const realm = 'delivery-c0';
      const scene = await seedScene(realm, 'confirmed');
      const custody = new ParcelCustody();
      const service = makeService(realm, custody);
      await service.sweepPass();
      await expectDeliveredExactlyOnce({
        listingId: scene.listingId,
        settlementId: scene.settlement.id,
        custody,
        custodyRef: scene.custodyRef,
        parcels: 1,
        winnerBidId: scene.winnerBidId,
        loserBidId: scene.loserBidId,
      });
      // Convergence is idempotent: the whole sweep again, same end state.
      await service.sweepPass();
      await expectDeliveredExactlyOnce({
        listingId: scene.listingId,
        settlementId: scene.settlement.id,
        custody,
        custodyRef: scene.custodyRef,
        parcels: 1,
        winnerBidId: scene.winnerBidId,
        loserBidId: scene.loserBidId,
      });
    }, 20_000);

    it('C1: killed after the delivering claim, before the custody claim', async () => {
      const realm = 'delivery-c1';
      const scene = await seedScene(realm, 'delivering');
      const custody = new ParcelCustody();
      await makeService(realm, custody).sweepPass();
      await expectDeliveredExactlyOnce({
        listingId: scene.listingId,
        settlementId: scene.settlement.id,
        custody,
        custodyRef: scene.custodyRef,
        parcels: 1,
        winnerBidId: scene.winnerBidId,
        loserBidId: scene.loserBidId,
      });
    }, 20_000);

    it('C2a: a bare claim with no rail intent PARKS: unattributable, never mailed', async () => {
      // The claim-then-die residue, and every legacy row from before the
      // intent columns. The ORIGINAL code adopted it as booked and advanced
      // with the item destroyed; a blind mail resume risks the second copy
      // when the ref belonged to the other rail. Neither is provable: park.
      const realm = 'delivery-c2a';
      const scene = await seedScene(realm, 'delivering');
      expect(await marketDb.claimCustodyRef(realm, scene.custodyRef)).toBe(true);
      const custody = new ParcelCustody();
      await makeService(realm, custody).sweepPass();
      expect(custody.parcels, 'nothing mailed').toHaveLength(0);
      const after = await pool.query(`SELECT state FROM woc_market_settlements WHERE id = $1`, [
        scene.settlement.id,
      ]);
      expect(after.rows[0].state, 'held visibly').toBe('delivering');
      const readout = await marketDb.stuckCustodyReadout(
        realm,
        Date.now() + MINUTE_MS,
        10,
        1000,
        0,
      );
      expect(readout.unbookedClaims.count).toBe(1);
      expect(readout.unbookedClaims.sample[0]?.mailIntent).toBe(false);
    }, 20_000);

    it('C2b: killed between the mail intent and the write PARKS (parcel absent)', async () => {
      // Intent stamped, parcel never became durable: absence cannot be told
      // apart from collected-and-deleted, so the resume refuses to re-mail.
      const realm = 'delivery-c2b';
      const scene = await seedScene(realm, 'delivering');
      expect(await marketDb.claimCustodyRef(realm, scene.custodyRef)).toBe(true);
      expect(await marketDb.markCustodyMailIntent(scene.custodyRef)).toBe(true);
      const custody = new ParcelCustody();
      await makeService(realm, custody).sweepPass();
      expect(custody.parcels, 'no blind re-mail').toHaveLength(0);
      const after = await pool.query(`SELECT state FROM woc_market_settlements WHERE id = $1`, [
        scene.settlement.id,
      ]);
      expect(after.rows[0].state).toBe('delivering');
    }, 20_000);

    it('C3: killed between the mail write and the booking RESUMES (parcel present)', async () => {
      // The provable resume: intent stamped AND the parcel still in the book.
      // The re-run dedupes on the ref (one parcel) and completes the booking.
      const realm = 'delivery-c3';
      const scene = await seedScene(realm, 'delivering');
      expect(await marketDb.claimCustodyRef(realm, scene.custodyRef)).toBe(true);
      expect(await marketDb.markCustodyMailIntent(scene.custodyRef)).toBe(true);
      const custody = new ParcelCustody();
      await custody.persistMailParcel(
        { key: String(scene.buyerCharacter), name: 'Buyer' },
        'delivery',
        [],
        scene.custodyRef,
      );
      await makeService(realm, custody).sweepPass();
      await expectDeliveredExactlyOnce({
        listingId: scene.listingId,
        settlementId: scene.settlement.id,
        custody,
        custodyRef: scene.custodyRef,
        parcels: 1,
        winnerBidId: scene.winnerBidId,
        loserBidId: scene.loserBidId,
      });
    }, 20_000);

    it('C3b: the collected-and-deleted letter PARKS: never a second copy', async () => {
      // The dupe the durable mail intent exists to stop: parcel written and
      // collected, letter deleted, booking lost. The in-book marker is gone,
      // so a blind resume would mail copy two; the resume must refuse.
      const realm = 'delivery-c3b';
      const scene = await seedScene(realm, 'delivering');
      expect(await marketDb.claimCustodyRef(realm, scene.custodyRef)).toBe(true);
      expect(await marketDb.markCustodyMailIntent(scene.custodyRef)).toBe(true);
      const custody = new ParcelCustody();
      await custody.persistMailParcel(
        { key: String(scene.buyerCharacter), name: 'Buyer' },
        'delivery',
        [],
        scene.custodyRef,
      );
      custody.collect(scene.custodyRef);
      await makeService(realm, custody).sweepPass();
      expect(custody.parcels, 'no second copy, ever').toHaveLength(0);
      const after = await pool.query(`SELECT state FROM woc_market_settlements WHERE id = $1`, [
        scene.settlement.id,
      ]);
      expect(after.rows[0].state, 'parked visibly').toBe('delivering');
      const claim = await pool.query(
        `SELECT booked_at FROM woc_market_custody_claims WHERE custody_ref = $1`,
        [scene.custodyRef],
      );
      expect(claim.rows[0].booked_at).toBeNull();
    }, 20_000);

    it('C4: killed between the booking and the close tail', async () => {
      // Custody fully booked, settlement still 'delivering': the re-run must
      // not mail again and must finish the tail.
      const realm = 'delivery-c4';
      const scene = await seedScene(realm, 'delivering');
      expect(await marketDb.claimCustodyRef(realm, scene.custodyRef)).toBe(true);
      const custody = new ParcelCustody();
      await custody.persistMailParcel(
        { key: String(scene.buyerCharacter), name: 'Buyer' },
        'delivery',
        [],
        scene.custodyRef,
      );
      await marketDb.markCustodyRefBooked(scene.custodyRef);
      await makeService(realm, custody).sweepPass();
      await expectDeliveredExactlyOnce({
        listingId: scene.listingId,
        settlementId: scene.settlement.id,
        custody,
        custodyRef: scene.custodyRef,
        parcels: 1,
        winnerBidId: scene.winnerBidId,
        loserBidId: scene.loserBidId,
      });
      // Booked already: the resume asked the mail rail for nothing new.
      expect(custody.persistCalls).toEqual([scene.custodyRef]);
    }, 20_000);

    it('C5: an older binary died after its delivered CAS, listing still open', async () => {
      // The silent-forever residue the review found: state 'delivered', no
      // sale row, listing open, bonds stranded. No arm read 'delivered' at
      // all; the re-drive arm must converge it FORWARD.
      const realm = 'delivery-c5';
      const scene = await seedScene(realm, 'delivered');
      // Custody was completed by the old binary before its CAS.
      expect(await marketDb.claimCustodyRef(realm, scene.custodyRef)).toBe(true);
      await marketDb.markCustodyRefBooked(scene.custodyRef);
      const custody = new ParcelCustody();
      const service = makeService(realm, custody);
      const stats = await service.sweepPass();
      expect(stats?.redriven).toBe(1);
      await expectDeliveredExactlyOnce({
        listingId: scene.listingId,
        settlementId: scene.settlement.id,
        custody,
        custodyRef: scene.custodyRef,
        parcels: 0,
        winnerBidId: scene.winnerBidId,
        loserBidId: scene.loserBidId,
      });
      // A re-run converges to the same end state and re-drives nothing. The
      // clock MUST advance past the beat interval first: the residue arm is
      // minute-gated, so a second pass on a frozen clock returns 0 before
      // reading anything and the assertion below would pin nothing at all.
      setNow(BASE_MS + MINUTE_MS + 1_000);
      const again = await service.sweepPass();
      expect(again?.redriven).toBe(0);
      await expectDeliveredExactlyOnce({
        listingId: scene.listingId,
        settlementId: scene.settlement.id,
        custody,
        custodyRef: scene.custodyRef,
        parcels: 0,
        winnerBidId: scene.winnerBidId,
        loserBidId: scene.loserBidId,
      });
    }, 20_000);

    it('C5b: the same residue on an ACTIVE listing (the buy-now shape)', async () => {
      // A buy-now leaves its listing 'active' through delivery, so the
      // re-drive must find the residue by the settlement, never by a
      // stranded listing status.
      const realm = 'delivery-c5b';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const buyerCharacter = await seedCharacter(realm, buyer);
      const listingId = await seedListing(realm, seller, { status: 'active' });
      const settlement = await seedSettlement(listingId, buyer, buyerCharacter, {
        state: 'delivered',
      });
      const custodyRef = rulesMod.settlementCustodyRef(settlement.id);
      expect(await marketDb.claimCustodyRef(realm, custodyRef)).toBe(true);
      await marketDb.markCustodyRefBooked(custodyRef);
      const custody = new ParcelCustody();
      const stats = await makeService(realm, custody).sweepPass();
      expect(stats?.redriven).toBe(1);
      await expectDeliveredExactlyOnce({
        listingId,
        settlementId: settlement.id,
        custody,
        custodyRef,
        parcels: 0,
      });
    }, 20_000);

    it('C6: the old binary also landed its sale row before dying', async () => {
      // The residue that now THROWS 23505 on a blind re-insert: the finalize
      // dedupes on the provenance index instead and still converges.
      const realm = 'delivery-c6';
      const scene = await seedScene(realm, 'delivered');
      expect(await marketDb.claimCustodyRef(realm, scene.custodyRef)).toBe(true);
      await marketDb.markCustodyRefBooked(scene.custodyRef);
      await marketDb.insertSale({
        realm,
        listingId: scene.listingId,
        itemId: 'crown_of_embers',
        item: { itemId: 'crown_of_embers', count: 1 },
        priceCents: 1000,
        amountBase: null,
        sellerAccount: 1,
        buyerAccount: 2,
        sellerName: 'S',
        buyerName: 'B',
      });
      const custody = new ParcelCustody();
      const stats = await makeService(realm, custody).sweepPass();
      expect(stats?.redriven).toBe(1);
      await expectDeliveredExactlyOnce({
        listingId: scene.listingId,
        settlementId: scene.settlement.id,
        custody,
        custodyRef: scene.custodyRef,
        parcels: 0,
        winnerBidId: scene.winnerBidId,
        loserBidId: scene.loserBidId,
      });
    }, 20_000);

    it('C9: sold-but-undisposed residue converges when its sale row stands, parks without one', async () => {
      // The other close-tail residue of the old binary (crash between its
      // close and dispose statements). A standing sale row proves delivery
      // completed, so the flag converges; a sold row with NO sale is a
      // question only an operator can answer and stays visible.
      const realm = 'delivery-c9';
      const seller = await seedAccount();
      const withSale = await seedListing(realm, seller, { status: 'closed' });
      const withoutSale = await seedListing(realm, seller, { status: 'closed' });
      await pool.query(
        `UPDATE woc_market_listings SET resolution = 'sold' WHERE id = ANY($1::bigint[])`,
        [[withSale, withoutSale]],
      );
      await marketDb.insertSale({
        realm,
        listingId: withSale,
        itemId: 'crown_of_embers',
        item: { itemId: 'crown_of_embers', count: 1 },
        priceCents: 1000,
        amountBase: null,
        sellerAccount: 1,
        buyerAccount: 2,
        sellerName: 'S',
        buyerName: 'B',
      });
      const custody = new ParcelCustody();
      const stats = await makeService(realm, custody).sweepPass();
      // The dispose arm's own stat: it is counted apart from the page walk so
      // a throw in one residue class can never be read as the other draining.
      expect(stats?.disposed).toBe(1);
      expect(stats?.redriven, 'no delivered-but-unclosed residue exists here').toBe(0);
      const rows = await pool.query(
        `SELECT id, item_disposed FROM woc_market_listings WHERE id = ANY($1::bigint[]) ORDER BY id`,
        [[withSale, withoutSale].sort((a, b) => a - b)],
      );
      const byId = new Map(rows.rows.map((r) => [Number(r.id), r.item_disposed]));
      expect(byId.get(withSale), 'the proven sale converges').toBe(true);
      expect(byId.get(withoutSale), 'the unproven one parks').toBe(false);
      // And the parked one is what the readout carries.
      await pool.query(
        `UPDATE woc_market_listings SET updated_at = now() - interval '1 hour' WHERE id = $1`,
        [withoutSale],
      );
      const readout = await marketDb.stuckCustodyReadout(realm, Date.now() - 600_000, 10, 1000, 0);
      expect(readout.undisposedListings.count).toBe(1);
      expect(readout.undisposedListings.sample[0]?.id).toBe(withoutSale);
    }, 20_000);

    it('C7: refuses to deliver over a disposed listing and stays visible', async () => {
      const realm = 'delivery-c7';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const buyerCharacter = await seedCharacter(realm, buyer);
      const listingId = await seedListing(realm, seller, { itemDisposed: true });
      const settlement = await seedSettlement(listingId, buyer, buyerCharacter, {
        state: 'delivering',
      });
      const custody = new ParcelCustody();
      await makeService(realm, custody).sweepPass();
      const after = await pool.query(`SELECT state FROM woc_market_settlements WHERE id = $1`, [
        settlement.id,
      ]);
      expect(after.rows[0].state, 'parked in delivering').toBe('delivering');
      expect(custody.parcels).toHaveLength(0);
      const sales = await pool.query(
        `SELECT count(*)::int AS n FROM woc_market_sales WHERE listing_id = $1`,
        [listingId],
      );
      expect(sales.rows[0].n).toBe(0);
    }, 20_000);

    it('C8: parks an unbooked claim carrying a grant intent; no mail, visible', async () => {
      // A direct hand-off died ambiguously (grant maybe persisted): the mail
      // rail must NOT adopt the claim, and the readout must surface it.
      const realm = 'delivery-c8';
      const scene = await seedScene(realm, 'delivering');
      expect(await marketDb.claimCustodyRef(realm, scene.custodyRef)).toBe(true);
      expect(await marketDb.markCustodyGrantIntent(scene.custodyRef, scene.buyerCharacter)).toBe(
        true,
      );
      const custody = new ParcelCustody();
      await makeService(realm, custody).sweepPass();
      const after = await pool.query(`SELECT state FROM woc_market_settlements WHERE id = $1`, [
        scene.settlement.id,
      ]);
      expect(after.rows[0].state).toBe('delivering');
      expect(custody.parcels).toHaveLength(0);
      const readout = await marketDb.stuckCustodyReadout(
        realm,
        Date.now() + MINUTE_MS,
        10,
        1000,
        0,
      );
      expect(readout.unbookedClaims.count).toBe(1);
      expect(readout.unbookedClaims.sample[0]).toMatchObject({
        custodyRef: scene.custodyRef,
        grantCharacterId: scene.buyerCharacter,
      });
      expect(readout.stuckDelivering.count).toBe(1);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // The atomic save-and-book against the real lease fence.
  // -------------------------------------------------------------------------

  describe('saveDeliveredCharacterBooked', () => {
    it('persists the bags and the booking together (unfenced arm)', async () => {
      const realm = 'delivery-book-ok';
      const account = await seedAccount();
      const characterId = await seedCharacter(realm, account);
      const ref = `woc_delivery_book_ok_${seq}`;
      expect(await marketDb.claimCustodyRef(realm, ref)).toBe(true);
      const out = await marketDb.saveDeliveredCharacterBooked(
        {
          characterId,
          level: 11,
          state: { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState,
          leaseNonce: undefined,
        },
        ref,
      );
      expect(out).toBe('booked');
      const character = await pool.query(`SELECT level FROM characters WHERE id = $1`, [
        characterId,
      ]);
      expect(character.rows[0].level, 'the save landed').toBe(11);
      const claim = await pool.query(
        `SELECT booked_at FROM woc_market_custody_claims WHERE custody_ref = $1`,
        [ref],
      );
      expect(claim.rows[0].booked_at, 'and the booking landed with it').not.toBeNull();
    });

    it('carries a non-empty ledger snapshot through the delivered save (the second call site)', async () => {
      // The delivered-save transaction normalizes save.bankLedgerSnapshot
      // through the SAME bankLedgerSaveEffects seam as the escrow site (the
      // source pin in tests/server/woc_market_directed_sql.test.ts counts
      // both). Behavioral half for this site: the buyer's captured prefix
      // lands with the booking, receipt identity intact.
      const { serializeBankLedgerCommandBatch } = await import('../server/bank_ledger_outbox');
      const { bankLedgerCommandBatchPayloadSha256 } = await import(
        '../server/bank_ledger_batch_db'
      );
      const { REALM } = await import('../server/realm');
      const account = await seedAccount();
      const characterId = await seedCharacter(REALM, account);
      const ref = `woc_delivery_book_ledger_${seq}`;
      expect(await marketDb.claimCustodyRef(REALM, ref)).toBe(true);
      const batchKey = `woc.delivered.roundtrip.${seq}`;
      const batch = serializeBankLedgerCommandBatch(batchKey, [
        {
          realm: REALM,
          characterId,
          accountId: account,
          op: 'deposit' as const,
          itemId: 'peacebloom',
          count: 1,
          instance: null,
          copperDelta: 0,
          purchasedSlotsAfter: 6,
          container: 'personal' as const,
          containerId: null,
        },
      ]);
      const out = await marketDb.saveDeliveredCharacterBooked(
        {
          characterId,
          level: 15,
          state: { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState,
          leaseNonce: undefined,
          bankLedgerSnapshot: Object.freeze({
            owner: Object.freeze({ realm: REALM, characterId, accountId: account }),
            batches: Object.freeze([batch]),
            rowCount: batch.rows.length,
            encodedBytes: batch.encodedBytes,
            guildIds: batch.guildIds,
            hasUnscopedRows: batch.hasUnscopedRows,
          }),
        },
        ref,
      );
      expect(out).toBe('booked');
      const receipt = await pool.query(
        `SELECT row_count, payload_sha256 FROM bank_ledger_batch_receipts WHERE batch_key = $1`,
        [batchKey],
      );
      expect(receipt.rows).toEqual([
        { row_count: 1, payload_sha256: bankLedgerCommandBatchPayloadSha256(batch) },
      ]);
      const rows = await pool.query(
        `SELECT op, item_id, count FROM bank_ledger WHERE character_id = $1`,
        [characterId],
      );
      expect(rows.rows).toEqual([{ op: 'deposit', item_id: 'peacebloom', count: 1 }]);
    });

    it('an EMPTY ledger snapshot is a no-op at the delivered site too: the booked save commits with zero ledger rows', async () => {
      // The empty half of the second call site, symmetric with the escrow
      // arm below: a rowCount 0 snapshot collapses to undefined through the
      // same bankLedgerSaveEffects normalization, so the transaction must
      // still commit BOTH halves (the fenced save and the booking) while
      // neither bank_ledger nor bank_ledger_batch_receipts gains a row.
      const { REALM } = await import('../server/realm');
      const account = await seedAccount();
      const characterId = await seedCharacter(REALM, account);
      const ref = 'woc_delivery_book_empty_ledger';
      expect(await marketDb.claimCustodyRef(REALM, ref)).toBe(true);
      const emptySnapshot: BankLedgerOutboxSnapshot = Object.freeze({
        owner: Object.freeze({ realm: REALM, characterId, accountId: account }),
        batches: Object.freeze([]),
        rowCount: 0,
        encodedBytes: 0,
        guildIds: Object.freeze([]),
        hasUnscopedRows: false,
      });
      const out = await marketDb.saveDeliveredCharacterBooked(
        {
          characterId,
          level: 16,
          state: { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState,
          leaseNonce: undefined,
          bankLedgerSnapshot: emptySnapshot,
        },
        ref,
      );
      expect(out).toBe('booked');
      // Prove both halves really ran: the no-op claim is about the ledger
      // statement, never the transaction.
      const character = await pool.query(`SELECT level FROM characters WHERE id = $1`, [
        characterId,
      ]);
      expect(character.rows[0].level).toBe(16);
      const claim = await pool.query(
        `SELECT booked_at FROM woc_market_custody_claims WHERE custody_ref = $1`,
        [ref],
      );
      expect(claim.rows[0].booked_at).not.toBeNull();
      const ledger = await pool.query(
        `SELECT count(*)::int AS n FROM bank_ledger WHERE character_id = $1`,
        [characterId],
      );
      expect(ledger.rows[0].n).toBe(0);
      const receipts = await pool.query(
        `SELECT count(*)::int AS n FROM bank_ledger_batch_receipts WHERE character_id = $1`,
        [characterId],
      );
      expect(receipts.rows[0].n).toBe(0);
    });

    it('passes the REAL lease fence when this process holds the lease', async () => {
      // The fenced statement's passing form against real Postgres: a wrong
      // holder or nonce column in the EXISTS would make every direct hand-off
      // report lease_lost forever, and only this arm would say so.
      const realm = 'delivery-book-fenced-ok';
      const account = await seedAccount();
      const characterId = await seedCharacter(realm, account);
      await pool.query(
        `INSERT INTO character_leases (character_id, realm, holder, nonce, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '90 seconds')`,
        [characterId, realm, db.PROCESS_LEASE_HOLDER, 'live-nonce-1'],
      );
      const ref = `woc_delivery_book_fenced_${seq}`;
      expect(await marketDb.claimCustodyRef(realm, ref)).toBe(true);
      const out = await marketDb.saveDeliveredCharacterBooked(
        {
          characterId,
          level: 14,
          state: { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState,
          leaseNonce: 'live-nonce-1',
        },
        ref,
      );
      expect(out).toBe('booked');
      const character = await pool.query(`SELECT level FROM characters WHERE id = $1`, [
        characterId,
      ]);
      expect(character.rows[0].level, 'the fenced save landed').toBe(14);
      const claim = await pool.query(
        `SELECT booked_at FROM woc_market_custody_claims WHERE custody_ref = $1`,
        [ref],
      );
      expect(claim.rows[0].booked_at).not.toBeNull();
    });

    it('rolls BOTH halves back when the lease fence rejects', async () => {
      // A nonce with no matching lease row: the in-statement EXISTS fence
      // matches zero rows, so neither the bags nor the booking may land.
      const realm = 'delivery-book-fence';
      const account = await seedAccount();
      const characterId = await seedCharacter(realm, account);
      const ref = `woc_delivery_book_fence_${seq}`;
      expect(await marketDb.claimCustodyRef(realm, ref)).toBe(true);
      const out = await marketDb.saveDeliveredCharacterBooked(
        {
          characterId,
          level: 12,
          state: { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState,
          leaseNonce: 'a-nonce-nobody-holds',
        },
        ref,
      );
      expect(out).toBe('lease_lost');
      const character = await pool.query(`SELECT level FROM characters WHERE id = $1`, [
        characterId,
      ]);
      expect(character.rows[0].level, 'the fenced save did not land').toBe(10);
      const claim = await pool.query(
        `SELECT booked_at FROM woc_market_custody_claims WHERE custody_ref = $1`,
        [ref],
      );
      expect(claim.rows[0].booked_at, 'and neither did the booking').toBeNull();
    });

    it('reports claim_missing (and saves nothing) over an already-booked ref', async () => {
      const realm = 'delivery-book-missing';
      const account = await seedAccount();
      const characterId = await seedCharacter(realm, account);
      const ref = `woc_delivery_book_missing_${seq}`;
      expect(await marketDb.claimCustodyRef(realm, ref)).toBe(true);
      await marketDb.markCustodyRefBooked(ref);
      const out = await marketDb.saveDeliveredCharacterBooked(
        {
          characterId,
          level: 13,
          state: { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState,
          leaseNonce: undefined,
        },
        ref,
      );
      expect(out).toBe('claim_missing');
      const character = await pool.query(`SELECT level FROM characters WHERE id = $1`, [
        characterId,
      ]);
      expect(character.rows[0].level, 'the save rolled back with the refusal').toBe(10);
    });
  });

  // -------------------------------------------------------------------------
  // Two-connection interleaves: the finalize transaction's lock participation.
  // -------------------------------------------------------------------------

  describe('finalize interleaves', () => {
    function finalizeArgs(
      realm: string,
      scene: {
        listingId: number;
        settlement: WocSettlementRow;
        winnerBidId: number;
      },
    ) {
      return {
        settlementId: scene.settlement.id,
        listingId: scene.listingId,
        bidId: scene.winnerBidId,
        sale: {
          realm,
          listingId: scene.listingId,
          itemId: 'crown_of_embers',
          item: { itemId: 'crown_of_embers', count: 1 },
          priceCents: 1000,
          amountBase: null,
          sellerAccount: 1,
          buyerAccount: 2,
          sellerName: 'S',
          buyerName: 'B',
        },
      };
    }

    it('waits on a held LISTING row lock, then completes', async () => {
      const realm = 'delivery-il-listing';
      const scene = await seedScene(realm, 'delivered');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT 1 FROM woc_market_listings WHERE id = $1 FOR UPDATE`, [
          scene.listingId,
        ]);
        const finalize = marketDb.finalizeDeliveredSettlement(finalizeArgs(realm, scene));
        const first = await Promise.race([
          finalize.then(() => 'resolved'),
          delay(200).then(() => 'blocked'),
        ]);
        // This is the pin: the transaction really takes the listing row lock
        // (a snapshot predicate alone would sail past the holder).
        expect(first).toBe('blocked');
        await client.query('COMMIT');
        expect(await finalize).toBe('finalized');
      } finally {
        client.release();
      }
      // The direct finalize (no bond arm ran here) leaves the winner's bond
      // exactly at refund_due: the precise flip the matrix cannot see because
      // the same pass's bond arm resolves it further.
      const winner = await pool.query(
        `SELECT status, bond_state FROM woc_market_bids WHERE id = $1`,
        [scene.winnerBidId],
      );
      expect(winner.rows[0]).toEqual({ status: 'won', bond_state: 'refund_due' });
      const loser = await pool.query(
        `SELECT status, bond_state FROM woc_market_bids WHERE id = $1`,
        [scene.loserBidId],
      );
      expect(loser.rows[0]).toEqual({ status: 'cancelled', bond_state: 'refund_due' });
    }, 20_000);

    it('finalize and the suspend guard cross without a deadlock hang', async () => {
      // The lock-cycle shape the widened suspend pre-lock closes: suspend
      // cancels a dead settlement's 'won' winner, finalize pre-locks that
      // same winner. Both sides must come back TYPED (refusal or success),
      // never hang and never 500; the delivered settlement always survives.
      const realm = 'delivery-il-suspend';
      const scene = await seedScene(realm, 'delivered');
      const [suspend, finalize] = await Promise.all([
        marketDb.suspendListingIfSafe(realm, scene.listingId, BASE_MS),
        marketDb.finalizeDeliveredSettlement(finalizeArgs(realm, scene)),
      ]);
      // Three legal serializations for the suspend arm: it reads the live
      // settlement first (settlement_live), it collides mid-flight
      // (contended), or finalize commits WHOLE before suspend takes its
      // locks, so the guard correctly refuses over the now-closed listing
      // (not_active). The invariants below hold in all three.
      expect(['settlement_live', 'contended', 'not_active']).toContain(suspend);
      expect(['finalized', 'contended']).toContain(finalize);
      // Converge: a plain retry finishes the sale exactly once.
      if (finalize !== 'finalized') {
        expect(await marketDb.finalizeDeliveredSettlement(finalizeArgs(realm, scene))).toBe(
          'finalized',
        );
      }
      const sales = await pool.query(
        `SELECT count(*)::int AS n FROM woc_market_sales WHERE listing_id = $1 AND excluded = false`,
        [scene.listingId],
      );
      expect(sales.rows[0].n).toBe(1);
      const listing = await pool.query(
        `SELECT status, resolution FROM woc_market_listings WHERE id = $1`,
        [scene.listingId],
      );
      expect(listing.rows[0]).toEqual({ status: 'closed', resolution: 'sold' });
    }, 20_000);

    it('waits on a held WINNER BID row lock (bids join the lock set first)', async () => {
      const realm = 'delivery-il-bid';
      const scene = await seedScene(realm, 'delivered');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT 1 FROM woc_market_bids WHERE id = $1 FOR UPDATE`, [
          scene.winnerBidId,
        ]);
        const finalize = marketDb.finalizeDeliveredSettlement(finalizeArgs(realm, scene));
        const first = await Promise.race([
          finalize.then(() => 'resolved'),
          delay(200).then(() => 'blocked'),
        ]);
        expect(first).toBe('blocked');
        await client.query('COMMIT');
        expect(await finalize).toBe('finalized');
      } finally {
        client.release();
      }
    }, 20_000);

    it('reports contended past the bounded lock wait, writing nothing', async () => {
      const realm = 'delivery-il-timeout';
      const scene = await seedScene(realm, 'delivered');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT 1 FROM woc_market_listings WHERE id = $1 FOR UPDATE`, [
          scene.listingId,
        ]);
        // Held past ESCROW_LOCK_TIMEOUT_MS: the transaction must give up with
        // the typed refusal rather than wait forever inside a sweep pass.
        expect(await marketDb.finalizeDeliveredSettlement(finalizeArgs(realm, scene))).toBe(
          'contended',
        );
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
      const sales = await pool.query(
        `SELECT count(*)::int AS n FROM woc_market_sales WHERE listing_id = $1`,
        [scene.listingId],
      );
      expect(sales.rows[0].n, 'nothing was written').toBe(0);
      const listing = await pool.query(`SELECT status FROM woc_market_listings WHERE id = $1`, [
        scene.listingId,
      ]);
      expect(listing.rows[0].status).toBe('settling');
    }, 20_000);

    it('two concurrent finalizes both converge on exactly one sale row', async () => {
      const realm = 'delivery-il-double';
      const scene = await seedScene(realm, 'delivered');
      const [a, b] = await Promise.all([
        marketDb.finalizeDeliveredSettlement(finalizeArgs(realm, scene)),
        marketDb.finalizeDeliveredSettlement(finalizeArgs(realm, scene)),
      ]);
      // Exactly ONE reports the transition. The close is a compare-and-set, so
      // the loser (which waited out the winner's listing row lock) sees a row
      // already closed and disposed and reports 'already_final': that is what
      // keeps the seller from being notified twice for one sale.
      expect([a, b].filter((r) => r === 'finalized')).toHaveLength(1);
      expect(
        [a, b].every((r) => r === 'finalized' || r === 'already_final' || r === 'contended'),
      ).toBe(true);
      const sales = await pool.query(
        `SELECT count(*)::int AS n FROM woc_market_sales WHERE listing_id = $1 AND excluded = false`,
        [scene.listingId],
      );
      expect(sales.rows[0].n, 'one sale row, never two').toBe(1);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // The stuck-custody readout over real rows: aged in, fresh and foreign out.
  // -------------------------------------------------------------------------

  describe('stuckCustodyReadout', () => {
    it('counts the three aged classes and excludes fresh and foreign rows', async () => {
      const realm = 'delivery-readout';
      const otherRealm = 'delivery-readout-other';
      const seller = await seedAccount();

      // Aged unbooked claim, fresh unbooked claim, aged BOOKED claim.
      await marketDb.claimCustodyRef(realm, 'readout-aged');
      await marketDb.claimCustodyRef(realm, 'readout-fresh');
      await marketDb.claimCustodyRef(realm, 'readout-booked');
      await marketDb.markCustodyRefBooked('readout-booked');
      await marketDb.claimCustodyRef(otherRealm, 'readout-foreign');
      await pool.query(
        `UPDATE woc_market_custody_claims SET claimed_at = now() - interval '1 hour'
          WHERE custody_ref IN ('readout-aged', 'readout-booked', 'readout-foreign')`,
      );

      // Aged stuck delivering settlement.
      const buyer = await seedAccount();
      const buyerCharacter = await seedCharacter(realm, buyer);
      const stuckListing = await seedListing(realm, seller);
      const stuck = await seedSettlement(stuckListing, buyer, buyerCharacter, {
        state: 'delivering',
      });
      // The class ages on UPDATED_AT, stamped when the row entered
      // 'delivering', so a slow payment leg is not reported stuck the moment
      // delivery begins. Park rotation writes sweep_parked_at instead, which
      // is why the rotated negative below must stay OUT.
      await pool.query(
        `UPDATE woc_market_settlements SET updated_at = now() - interval '1 hour' WHERE id = $1`,
        [stuck.id],
      );
      // Per-dimension negatives, all in the SAME realm: a FRESH delivering
      // settlement (age arm), an aged CONFIRMED one (state arm), and one whose
      // aged value sits in the ROTATION column only (the readout must not read
      // COALESCE(sweep_parked_at, updated_at), or every parked row would age in
      // on its rotation rather than on its real standing time).
      const freshListing = await seedListing(realm, seller);
      await seedSettlement(freshListing, buyer, buyerCharacter, { state: 'delivering' });
      const confirmedListing = await seedListing(realm, seller);
      const agedConfirmed = await seedSettlement(confirmedListing, buyer, buyerCharacter, {
        state: 'confirmed',
      });
      await pool.query(
        `UPDATE woc_market_settlements SET updated_at = now() - interval '1 hour' WHERE id = $1`,
        [agedConfirmed.id],
      );
      const rotatedListing = await seedListing(realm, seller);
      const rotated = await seedSettlement(rotatedListing, buyer, buyerCharacter, {
        state: 'delivering',
      });
      await pool.query(
        `UPDATE woc_market_settlements SET sweep_parked_at = now() - interval '1 hour'
          WHERE id = $1`,
        [rotated.id],
      );

      // Aged closed-undisposed listing (sold residue); a disposed one and a
      // FRESH closed-undisposed one stay out (flag arm, age arm), and an aged
      // OPEN listing stays out (status arm).
      const undisposed = await seedListing(realm, seller, { status: 'closed' });
      await pool.query(
        `UPDATE woc_market_listings
            SET resolution = 'sold', updated_at = now() - interval '1 hour'
          WHERE id = $1`,
        [undisposed],
      );
      const disposed = await seedListing(realm, seller, { status: 'closed', itemDisposed: true });
      await pool.query(
        `UPDATE woc_market_listings
            SET resolution = 'cancelled', updated_at = now() - interval '1 hour'
          WHERE id = $1`,
        [disposed],
      );
      const freshClosed = await seedListing(realm, seller, { status: 'closed' });
      await pool.query(`UPDATE woc_market_listings SET resolution = 'cancelled' WHERE id = $1`, [
        freshClosed,
      ]);
      const agedOpen = await seedListing(realm, seller, { status: 'active' });
      await pool.query(
        `UPDATE woc_market_listings SET updated_at = now() - interval '1 hour' WHERE id = $1`,
        [agedOpen],
      );

      const cutoff = Date.now() - 10 * MINUTE_MS;
      const readout = await marketDb.stuckCustodyReadout(realm, cutoff, 10, 1000, 0);
      expect(readout.unbookedClaims.count).toBe(1);
      expect(readout.unbookedClaims.sample[0]?.custodyRef).toBe('readout-aged');
      expect(readout.stuckDelivering.count, 'one per-dimension survivor').toBe(1);
      expect(readout.stuckDelivering.sample[0]?.id).toBe(stuck.id);
      expect(readout.undisposedListings.count).toBe(1);
      expect(readout.undisposedListings.sample[0]).toMatchObject({
        id: undisposed,
        resolution: 'sold',
      });
    }, 20_000);

    it('saturates the counts at the cap instead of scanning the stuck set', async () => {
      const realm = 'delivery-readout-cap';
      for (let i = 0; i < 7; i++) {
        await marketDb.claimCustodyRef(realm, `cap-claim-${i}`);
      }
      await pool.query(
        `UPDATE woc_market_custody_claims SET claimed_at = now() - interval '1 hour'
          WHERE realm = $1`,
        [realm],
      );
      const readout = await marketDb.stuckCustodyReadout(realm, Date.now() - 600_000, 3, 5, 0);
      expect(readout.unbookedClaims.count, 'cap or more, never the true 7').toBe(5);
      expect(readout.unbookedClaims.sample, 'the sample keeps its own cap').toHaveLength(3);
      // The flag is what stops a capped count from reading as an exact one on
      // the operator dashboard.
      expect(readout.unbookedClaims.saturated).toBe(true);
      // An EMPTY class must never claim saturation: zero rows is zero rows.
      expect(readout.stuckDelivering).toMatchObject({ count: 0, saturated: false });
      expect(readout.undisposedListings).toMatchObject({ count: 0, saturated: false });
      // And below the cap the flag clears while the count becomes the truth.
      const roomy = await marketDb.stuckCustodyReadout(realm, Date.now() - 600_000, 3, 50, 0);
      expect(roomy.unbookedClaims.count, 'the real backlog, unclamped').toBe(7);
      expect(roomy.unbookedClaims.saturated).toBe(false);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Booked-claims retention over real rows. The never-sweep set is the
  // dangerous part: an over-eager prune here deletes the exactly-once
  // evidence and silently re-arms the delivery duplication (B2), so every
  // surviving class is asserted per dimension.
  // -------------------------------------------------------------------------

  describe('booked-claims retention, in real SQL', () => {
    it('prunes aged booked claims with dead referents; live referents, fresh rows, and the whole unbooked queue survive', async () => {
      const realm = 'delivery-claims-prune';
      const marketDbMod = await import('../server/woc_market_db');
      const book = async (ref: string): Promise<string> => {
        expect(await marketDb.claimCustodyRef(realm, ref)).toBe(true);
        await marketDb.markCustodyRefBooked(ref);
        return ref;
      };
      // PRUNABLE: aged booked claims whose referent rows never existed (one
      // per mint shape), plus one aged booked LEGACY ref no mint function
      // produces (it prunes on the window alone; the referent belt cannot
      // vouch for a ref it cannot parse).
      const deadSettlement = await book(rulesMod.settlementCustodyRef(99_999_901));
      const deadReturn = await book(rulesMod.listingReturnCustodyRef(99_999_902));
      const deadSold = await book(rulesMod.listingSoldNoticeCustodyRef(99_999_903));
      const legacy = await book('legacy-opaque-ref');
      // SURVIVORS by referent: aged booked claims whose settlement or listing
      // row STILL EXISTS (a stuck deal past the window keeps its evidence).
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const buyerCharacter = await seedCharacter(realm, buyer);
      const liveListingId = await seedListing(realm, seller);
      const liveSettlement = await seedSettlement(liveListingId, buyer, buyerCharacter, {
        state: 'delivered',
      });
      const liveSettlementRef = await book(rulesMod.settlementCustodyRef(liveSettlement.id));
      const returnListing = await seedListing(realm, seller);
      const liveReturnRef = await book(rulesMod.listingReturnCustodyRef(returnListing));
      // The sold-notice arm of the listing regex, per dimension: its
      // candidate row is shielded by the SAME live listing class, so
      // narrowing the regex to return-only would wrongly prune this one.
      const soldListing = await seedListing(realm, seller);
      const liveSoldRef = await book(rulesMod.listingSoldNoticeCustodyRef(soldListing));
      // SURVIVOR by age: booked yesterday, referents long gone.
      const fresh = await book(rulesMod.settlementCustodyRef(99_999_904));
      // SURVIVORS unconditionally: the unbooked operator queue in all three
      // attribution states, aged far past any window, referents dead.
      const bare = rulesMod.settlementCustodyRef(99_999_905);
      expect(await marketDb.claimCustodyRef(realm, bare)).toBe(true);
      const granted = rulesMod.settlementCustodyRef(99_999_906);
      expect(await marketDb.claimCustodyRef(realm, granted)).toBe(true);
      expect(await marketDb.markCustodyGrantIntent(granted, buyerCharacter)).toBe(true);
      const mailed = rulesMod.settlementCustodyRef(99_999_907);
      expect(await marketDb.claimCustodyRef(realm, mailed)).toBe(true);
      expect(await marketDb.markCustodyMailIntent(mailed)).toBe(true);
      // Age everything this test owns except the fresh row; the aging is
      // ref-scoped so the suite's other fixtures stay out of the window.
      // deadReturn deliberately keeps its RECENT claimed_at: a prune that
      // drifted to ageing on claimed_at would then stop pruning it, so the
      // booked_at-vs-claimed_at choice is caught behaviorally here, not
      // only by the SQL text pin.
      await pool.query(
        `UPDATE woc_market_custody_claims
            SET booked_at = booked_at - interval '400 days',
                claimed_at = CASE WHEN custody_ref <> $3
                                  THEN claimed_at - interval '400 days'
                                  ELSE claimed_at END
          WHERE realm = $1 AND custody_ref <> $2`,
        [realm, fresh, deadReturn],
      );
      // The premise that makes the counts below EXACT: this test's seven aged
      // booked rows are the only booked rows in the whole disposable database
      // older than the window (every other fixture books at now()). Asserted
      // so a future aged fixture fails loudly here instead of drifting the
      // prune count.
      const aged = await pool.query(
        `SELECT count(*)::int AS n FROM woc_market_custody_claims
          WHERE booked_at IS NOT NULL AND booked_at < now() - interval '365 days'`,
      );
      expect(aged.rows[0].n, 'only this test ages booked rows past the window').toBe(7);
      // Staged batches pin the cursor walk AND idempotence: the batch bound
      // is honored, a re-run continues where the last left off, and a drained
      // table answers zero instead of re-deleting.
      expect(await marketDbMod.pruneBookedWocCustodyClaimsBatch(pool, 365, 2)).toBe(2);
      expect(await marketDbMod.pruneBookedWocCustodyClaimsBatch(pool, 365, 2)).toBe(2);
      const pruned = await marketDbMod.pruneBookedWocCustodyClaimsBatch(pool, 365, 100);
      expect(pruned, 'the staged batches already drained the prunable set').toBe(0);
      const left = await pool.query(
        `SELECT custody_ref FROM woc_market_custody_claims WHERE realm = $1 ORDER BY custody_ref`,
        [realm],
      );
      const refs = left.rows.map((r) => String(r.custody_ref));
      for (const gone of [deadSettlement, deadReturn, deadSold, legacy]) {
        expect(refs, 'aged, booked, referent gone: pruned').not.toContain(gone);
      }
      expect(refs, 'live settlement row shields its claim').toContain(liveSettlementRef);
      expect(refs, 'live listing row shields its claim').toContain(liveReturnRef);
      expect(refs, 'live listing shields its sold notice too').toContain(liveSoldRef);
      expect(refs, 'inside the window: kept').toContain(fresh);
      expect(refs, 'unbooked bare: never pruned').toContain(bare);
      expect(refs, 'unbooked grant-intent: never pruned').toContain(granted);
      expect(refs, 'unbooked mail-intent: never pruned').toContain(mailed);
      // The monitor keeps seeing what it must: the three parked rows still
      // age into the operator readout after the prune ran.
      const readout = await marketDb.stuckCustodyReadout(realm, Date.now() - 600_000, 10, 1000, 0);
      expect(readout.unbookedClaims.count).toBe(3);
      // Keep-forever: an unset window (0) deletes nothing even with aged rows
      // still on the table.
      expect(await marketDbMod.pruneBookedWocCustodyClaimsBatch(pool, 0, 100)).toBe(0);
    }, 20_000);

    it('the booked-claims cursor index is partial on booked rows and survives a schema re-apply', async () => {
      const marketDbMod = await import('../server/woc_market_db');
      const def = async (): Promise<string | undefined> => {
        const res = await pool.query(
          `SELECT indexdef FROM pg_indexes WHERE indexname = 'woc_market_custody_claims_booked'`,
        );
        return res.rows[0]?.indexdef as string | undefined;
      };
      const first = await def();
      expect(first).toContain('(booked_at)');
      expect(first).toContain('booked_at IS NOT NULL');
      // The double boot: re-applying the whole schema is a no-op, and the
      // index definition is byte-stable across it.
      await pool.query(marketDbMod.WOC_MARKET_SCHEMA);
      expect(await def()).toBe(first);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Park rotation: a parked row cycles to the back of its batch WITHOUT
  // refreshing the age the readout watches. Rotating the age column instead
  // (the shape this pins against) hid every permanently parked row from the
  // monitor by construction, because the retry cadence is a minute and the
  // stuck threshold is ten.
  // -------------------------------------------------------------------------

  describe('park rotation stays visible to the readout', () => {
    it('a rotated RETURN keeps aging into the readout and sorts to the batch tail', async () => {
      const realm = 'delivery-rotation-listing';
      const seller = await seedAccount();
      const parked = await seedListing(realm, seller, { status: 'closed' });
      const fresher = await seedListing(realm, seller, { status: 'closed' });
      await pool.query(
        `UPDATE woc_market_listings
            SET resolution = 'cancelled', updated_at = now() - interval '1 hour'
          WHERE id = $1`,
        [parked],
      );
      await pool.query(
        `UPDATE woc_market_listings
            SET resolution = 'cancelled', updated_at = now() - interval '5 minutes'
          WHERE id = $1`,
        [fresher],
      );
      // Several minutes of retries, which is what a permanently refused return
      // actually gets before an operator ever looks at it.
      for (let i = 0; i < 3; i++) await marketDb.touchListingRow(parked);
      const readout = await marketDb.stuckCustodyReadout(
        realm,
        Date.now() - 10 * MINUTE_MS,
        10,
        1000,
        0,
      );
      expect(readout.undisposedListings.count, 'rotation left the age column alone').toBe(1);
      expect(readout.undisposedListings.sample[0]?.id).toBe(parked);
      // The rotation still did its job: the parked row lost the batch head.
      const batch = await marketDb.undisposedClosedListings(realm, 25, []);
      expect(batch.map((r) => r.id)).toEqual([fresher, parked]);
      // And a backing-off parked row is excluded from the read entirely.
      const excluded = await marketDb.undisposedClosedListings(realm, 25, [parked]);
      expect(excluded.map((r) => r.id)).toEqual([fresher]);
    }, 20_000);

    it('a rotated DELIVERING settlement keeps aging into the readout and sorts to the batch tail', async () => {
      const realm = 'delivery-rotation-settlement';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const buyerCharacter = await seedCharacter(realm, buyer);
      const parked = await seedSettlement(await seedListing(realm, seller), buyer, buyerCharacter, {
        state: 'delivering',
      });
      const fresher = await seedSettlement(
        await seedListing(realm, seller),
        buyer,
        buyerCharacter,
        { state: 'delivering' },
      );
      await pool.query(
        `UPDATE woc_market_settlements SET updated_at = now() - interval '1 hour' WHERE id = $1`,
        [parked.id],
      );
      await pool.query(
        `UPDATE woc_market_settlements SET updated_at = now() - interval '5 minutes' WHERE id = $1`,
        [fresher.id],
      );
      for (let i = 0; i < 3; i++) await marketDb.touchSettlementRow(parked.id);
      const readout = await marketDb.stuckCustodyReadout(
        realm,
        Date.now() - 10 * MINUTE_MS,
        10,
        1000,
        0,
      );
      expect(readout.stuckDelivering.count, 'rotation left the age column alone').toBe(1);
      expect(readout.stuckDelivering.sample[0]?.id).toBe(parked.id);
      // The sample's updatedAtMs is the AGE SIGNAL the dashboard renders, and
      // created_at sits one line above it in the same SELECT: pin the value
      // to the hour-old stamp so a copy-paste swap cannot mis-report incident
      // ages on the one surface built for incidents.
      const sample = readout.stuckDelivering.sample[0];
      expect(sample?.updatedAtMs).toBeLessThan(Date.now() - 55 * MINUTE_MS);
      expect(sample?.updatedAtMs).toBeGreaterThan(Date.now() - 65 * MINUTE_MS);
      expect(sample?.updatedAtMs).not.toBe(sample?.createdAtMs);
      const batch = await marketDb.deliveringSettlements(realm, 25, []);
      expect(batch.map((s) => s.id)).toEqual([fresher.id, parked.id]);
      // And a backing-off parked row is excluded from the read entirely.
      const excluded = await marketDb.deliveringSettlements(realm, 25, [parked.id]);
      expect(excluded.map((s) => s.id)).toEqual([fresher.id]);
    }, 20_000);

    it('scopes the delivering and undisposed classes to the reading realm', async () => {
      // The claims class already has a foreign-realm negative; these two did
      // not, so a dropped realm predicate on either would have shown up only
      // as another realm's rows quietly joining this operator's queue.
      const realm = 'delivery-realm-scope';
      const foreign = 'delivery-realm-scope-other';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const foreignCharacter = await seedCharacter(foreign, buyer);
      const foreignListing = await seedListing(foreign, seller, { status: 'closed' });
      const foreignSettlement = await seedSettlement(
        await seedListing(foreign, seller),
        buyer,
        foreignCharacter,
        { state: 'delivering' },
      );
      await pool.query(
        `UPDATE woc_market_listings
            SET resolution = 'cancelled', updated_at = now() - interval '1 hour'
          WHERE id = $1`,
        [foreignListing],
      );
      await pool.query(
        `UPDATE woc_market_settlements SET updated_at = now() - interval '1 hour' WHERE id = $1`,
        [foreignSettlement.id],
      );
      const cutoff = Date.now() - 10 * MINUTE_MS;
      const home = await marketDb.stuckCustodyReadout(realm, cutoff, 10, 1000, 0);
      expect(home.stuckDelivering.count).toBe(0);
      expect(home.undisposedListings.count).toBe(0);
      // The positive control: both rows really exist and really are aged, so
      // the zeros above are the realm predicate rather than an empty table.
      const away = await marketDb.stuckCustodyReadout(foreign, cutoff, 10, 1000, 0);
      expect(away.stuckDelivering.sample[0]?.id).toBe(foreignSettlement.id);
      expect(away.undisposedListings.sample[0]?.id).toBe(foreignListing);
    }, 20_000);
  });

  describe('the escrow listing transaction (custody entry)', () => {
    const SAVE_STATE = { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState;

    async function seedLease(realm: string, characterId: number, nonce: string): Promise<void> {
      await pool.query(
        `INSERT INTO character_leases (character_id, realm, holder, nonce, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '90 seconds')`,
        [characterId, realm, db.PROCESS_LEASE_HOLDER, nonce],
      );
    }

    function escrowListing(
      realm: string,
      sellerAccount: number,
      sellerCharacter: number,
      over: { directedBuyerAccount?: number | null } = {},
    ) {
      seq++;
      return {
        realm,
        sellerAccount,
        sellerCharacter,
        sellerName: `EscrowSeller${seq}`,
        sellerWallet: `wallet-escrow-${seq}`,
        item: { itemId: 'crown_of_embers', count: 1 },
        itemId: 'crown_of_embers',
        quality: 'epic' as const,
        category: null,
        subcategory: null,
        params: {
          format: 'auction' as const,
          directedBuyerAccount: over.directedBuyerAccount ?? null,
          startCents: 5000,
          reserveCents: null,
          buyNowCents: null,
          durationHours: 12,
          offerNext: false,
        },
        endsAtMs: BASE_MS + 12 * 60 * MINUTE_MS,
        directedOfferId: null,
      };
    }

    it('commits the fenced character blob and the listing row in ONE transaction', async () => {
      const realm = 'escrow-commit';
      const account = await seedAccount();
      const characterId = await seedCharacter(realm, account);
      await seedLease(realm, characterId, 'escrow-nonce-live');
      const out = await marketDb.escrowInsertListing(
        { characterId, level: 12, state: SAVE_STATE, leaseNonce: 'escrow-nonce-live' },
        escrowListing(realm, account, characterId),
      );
      if (!out.ok) throw new Error(`escrow refused: ${out.reason}`);
      const character = await pool.query(`SELECT level FROM characters WHERE id = $1`, [
        characterId,
      ]);
      expect(character.rows[0].level, 'the fenced save landed').toBe(12);
      const listing = await pool.query(
        `SELECT status FROM woc_market_listings WHERE id = $1 AND realm = $2`,
        [out.id, realm],
      );
      expect(listing.rows[0]?.status).toBe('active');
    });

    it('an EMPTY ledger snapshot is a no-op: the escrow save commits with zero ledger rows', async () => {
      // The behavioral half of the bankLedgerSaveEffects normalization pin
      // (tests/server/woc_market_directed_sql.test.ts holds the source-text
      // half): a rowCount 0 snapshot collapses to undefined at the call site,
      // so the transaction must still commit BOTH halves while neither
      // bank_ledger nor bank_ledger_batch_receipts gains a row. The realm is
      // the real REALM because prepareBankLedgerSaveEffects validates the
      // owner against it on the non-empty path this arm must stay symmetric
      // with.
      const { REALM } = await import('../server/realm');
      const account = await seedAccount();
      const characterId = await seedCharacter(REALM, account);
      await seedLease(REALM, characterId, 'escrow-empty-ledger-live');
      const emptySnapshot: BankLedgerOutboxSnapshot = Object.freeze({
        owner: Object.freeze({ realm: REALM, characterId, accountId: account }),
        batches: Object.freeze([]),
        rowCount: 0,
        encodedBytes: 0,
        guildIds: Object.freeze([]),
        hasUnscopedRows: false,
      });
      const out = await marketDb.escrowInsertListing(
        {
          characterId,
          level: 13,
          state: SAVE_STATE,
          leaseNonce: 'escrow-empty-ledger-live',
          bankLedgerSnapshot: emptySnapshot,
        },
        escrowListing(REALM, account, characterId),
      );
      if (!out.ok) throw new Error(`empty-snapshot escrow refused: ${out.reason}`);
      // Prove the save half really ran: the no-op claim is about the ledger
      // statement, never the transaction.
      const character = await pool.query(`SELECT level FROM characters WHERE id = $1`, [
        characterId,
      ]);
      expect(character.rows[0].level).toBe(13);
      const listing = await pool.query(`SELECT status FROM woc_market_listings WHERE id = $1`, [
        out.id,
      ]);
      expect(listing.rows[0]?.status).toBe('active');
      const ledger = await pool.query(
        `SELECT count(*)::int AS n FROM bank_ledger WHERE character_id = $1`,
        [characterId],
      );
      expect(ledger.rows[0].n).toBe(0);
      const receipts = await pool.query(
        `SELECT count(*)::int AS n FROM bank_ledger_batch_receipts WHERE character_id = $1`,
        [characterId],
      );
      expect(receipts.rows[0].n).toBe(0);
    });

    it('a non-empty ledger snapshot round-trips its receipt identity through the escrow save', async () => {
      // The other behavioral arm: a captured outbox prefix handed to
      // escrowInsertListing must land as bank_ledger rows carrying the
      // batch's exact row identity, under a receipt whose batch_key and
      // payload_sha256 are the batch's own fingerprint. A rebuilt, filtered,
      // or dropped prefix (the drift the source pin guards textually) fails
      // here on the stored identity, not on a regex.
      const { serializeBankLedgerCommandBatch } = await import('../server/bank_ledger_outbox');
      const { bankLedgerCommandBatchPayloadSha256 } = await import(
        '../server/bank_ledger_batch_db'
      );
      const { REALM } = await import('../server/realm');
      const account = await seedAccount();
      const characterId = await seedCharacter(REALM, account);
      await seedLease(REALM, characterId, 'escrow-ledger-roundtrip-live');
      const batchKey = `woc.escrow.roundtrip.${seq}`;
      const rowBase = {
        realm: REALM,
        characterId,
        accountId: account,
        instance: null,
        copperDelta: 0,
        purchasedSlotsAfter: 6,
        container: 'personal' as const,
        containerId: null,
      };
      const batch = serializeBankLedgerCommandBatch(batchKey, [
        { ...rowBase, op: 'deposit' as const, itemId: 'peacebloom', count: 3 },
        { ...rowBase, op: 'withdraw' as const, itemId: 'wolf_fang', count: 2 },
      ]);
      const snapshot: BankLedgerOutboxSnapshot = Object.freeze({
        owner: Object.freeze({ realm: REALM, characterId, accountId: account }),
        batches: Object.freeze([batch]),
        rowCount: batch.rows.length,
        encodedBytes: batch.encodedBytes,
        guildIds: batch.guildIds,
        hasUnscopedRows: batch.hasUnscopedRows,
      });
      const out = await marketDb.escrowInsertListing(
        {
          characterId,
          level: 14,
          state: SAVE_STATE,
          leaseNonce: 'escrow-ledger-roundtrip-live',
          bankLedgerSnapshot: snapshot,
        },
        escrowListing(REALM, account, characterId),
      );
      if (!out.ok) throw new Error(`round-trip escrow refused: ${out.reason}`);
      const receipt = await pool.query(
        `SELECT realm, character_id, account_id, row_count, payload_sha256
           FROM bank_ledger_batch_receipts WHERE batch_key = $1`,
        [batchKey],
      );
      expect(receipt.rows).toEqual([
        {
          realm: REALM,
          character_id: characterId,
          account_id: account,
          row_count: 2,
          payload_sha256: bankLedgerCommandBatchPayloadSha256(batch),
        },
      ]);
      const rows = await pool.query(
        `SELECT op, item_id, count, container, copper_delta::int AS copper_delta,
                purchased_slots_after
           FROM bank_ledger WHERE character_id = $1 ORDER BY id`,
        [characterId],
      );
      expect(rows.rows).toEqual([
        {
          op: 'deposit',
          item_id: 'peacebloom',
          count: 3,
          container: 'personal',
          copper_delta: 0,
          purchased_slots_after: 6,
        },
        {
          op: 'withdraw',
          item_id: 'wolf_fang',
          count: 2,
          container: 'personal',
          copper_delta: 0,
          purchased_slots_after: 6,
        },
      ]);
    });

    it('a lease fence miss rolls BOTH halves back: no blob, no listing', async () => {
      const realm = 'escrow-fence-miss';
      const account = await seedAccount();
      const characterId = await seedCharacter(realm, account);
      await seedLease(realm, characterId, 'escrow-nonce-live');
      const out = await marketDb.escrowInsertListing(
        { characterId, level: 12, state: SAVE_STATE, leaseNonce: 'escrow-nonce-stale' },
        escrowListing(realm, account, characterId),
      );
      expect(out).toEqual({ ok: false, reason: 'lease_lost' });
      const character = await pool.query(`SELECT level FROM characters WHERE id = $1`, [
        characterId,
      ]);
      expect(character.rows[0].level, 'the seeded level survived untouched').toBe(10);
      const listings = await pool.query(`SELECT id FROM woc_market_listings WHERE realm = $1`, [
        realm,
      ]);
      expect(listings.rowCount).toBe(0);
    });

    it('a held accounts row surfaces the typed contended refusal at the lock ceiling', async () => {
      const realm = 'escrow-contended';
      const account = await seedAccount();
      const characterId = await seedCharacter(realm, account);
      await seedLease(realm, characterId, 'escrow-nonce-live');
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [account]);
        const startedAt = Date.now();
        const out = await marketDb.escrowInsertListing(
          { characterId, level: 12, state: SAVE_STATE, leaseNonce: 'escrow-nonce-live' },
          escrowListing(realm, account, characterId),
        );
        const elapsed = Date.now() - startedAt;
        expect(out).toEqual({ ok: false, reason: 'contended' });
        // The 2s lock_timeout is the bound that fired, not the statement
        // allowance and not the 15s session default (generous CI margins).
        expect(elapsed).toBeGreaterThanOrEqual(1_000);
        expect(elapsed).toBeLessThan(5_000);
        const listings = await pool.query(`SELECT id FROM woc_market_listings WHERE realm = $1`, [
          realm,
        ]);
        expect(listings.rowCount).toBe(0);
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }
    }, 20_000);

    it('the escrow accounts lock IS the narrowed mode: a held FK KEY SHARE never blocks it', async () => {
      // Binds the SOURCE's lock mode behaviorally (the rider's mutation
      // round: the bond suite's freed-insert proof holds its own raw-client
      // lock, so reverting escrowInsertListing itself to plain FOR UPDATE
      // survived it). FOR KEY SHARE, exactly what an in-flight FK-child
      // insert holds on the seller's accounts row, conflicts with plain FOR
      // UPDATE but not with FOR NO KEY UPDATE: under the narrowed mode this
      // escrow proceeds without waiting; a reverted mode would eat the 2s
      // lock ceiling and answer contended.
      const realm = 'escrow-narrowed-mode';
      const account = await seedAccount();
      const characterId = await seedCharacter(realm, account);
      await seedLease(realm, characterId, 'escrow-nonce-live');
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM accounts WHERE id = $1 FOR KEY SHARE', [account]);
        const startedAt = Date.now();
        const out = await marketDb.escrowInsertListing(
          { characterId, level: 12, state: SAVE_STATE, leaseNonce: 'escrow-nonce-live' },
          escrowListing(realm, account, characterId),
        );
        expect(out.ok, 'proceeded under the held KEY SHARE').toBe(true);
        expect(Date.now() - startedAt).toBeLessThan(1_000);
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }
    }, 20_000);

    it('runs beside the delivered-save twin on the same character without a deadlock', async () => {
      // The lock-graph probe: escrow takes accounts then characters; the
      // delivered save takes characters then the claim row. No reverse edge
      // exists, so the two serialize on the characters row instead of
      // deadlocking; both must land.
      const realm = 'escrow-lock-graph';
      const account = await seedAccount();
      const characterId = await seedCharacter(realm, account);
      await seedLease(realm, characterId, 'escrow-nonce-live');
      // Repeated so the two transactions genuinely overlap at least once:
      // one Promise.all pair can serialize by accident and prove nothing.
      for (let round = 0; round < 5; round++) {
        seq++;
        const ref = `escrow_lock_graph_${seq}_${round}`;
        expect(await marketDb.claimCustodyRef(realm, ref)).toBe(true);
        const [escrow, booked] = await Promise.all([
          marketDb.escrowInsertListing(
            // The PUBLIC arm (cap-counting COUNT included): five rounds stay
            // under the 12-listing cap, and this is the fuller lock graph.
            { characterId, level: 12, state: SAVE_STATE, leaseNonce: 'escrow-nonce-live' },
            escrowListing(realm, account, characterId),
          ),
          marketDb.saveDeliveredCharacterBooked(
            { characterId, level: 13, state: SAVE_STATE, leaseNonce: 'escrow-nonce-live' },
            ref,
          ),
        ]);
        expect(escrow.ok).toBe(true);
        expect(booked).toBe('booked');
      }
    }, 30_000);

    it('measures the transaction cost against its statement allowance', async () => {
      // The workload-scoped 4s statement_timeout replaced the 60s heavy
      // allowance because this transaction now heads a character's save FIFO.
      // Prove the expected cost really is orders of magnitude under the
      // ceiling with a representative blob (a few hundred inventory slots),
      // and print the distribution for the ledger.
      const { ESCROW_STATEMENT_TIMEOUT_MS } = await import('../server/woc_market_db');
      const realm = 'escrow-cost';
      const account = await seedAccount();
      const characterId = await seedCharacter(realm, account);
      await seedLease(realm, characterId, 'escrow-nonce-live');
      const heavyState = {
        questLog: [],
        questsDone: [],
        inventory: Array.from({ length: 300 }, (_, i) => ({
          itemId: 'crown_of_embers',
          count: 1,
          instance: { rolled: { quality: 'epic', seed: i } },
        })),
      } as unknown as CharacterState;
      const samples: number[] = [];
      for (let i = 0; i < 25; i++) {
        const startedAt = performance.now();
        const out = await marketDb.escrowInsertListing(
          { characterId, level: 12, state: heavyState, leaseNonce: 'escrow-nonce-live' },
          escrowListing(realm, account, characterId),
        );
        samples.push(performance.now() - startedAt);
        if (!out.ok) throw new Error(`escrow refused on pass ${i}: ${out.reason}`);
        // The cap counts every non-closed row since the directed-rail
        // hardening (the old directed exemption this loop leaned on was the
        // H12 hole), so each measured row closes outside the sample.
        await pool.query(
          `UPDATE woc_market_listings SET status = 'closed', resolution = 'cancelled' WHERE id = $1`,
          [out.id],
        );
      }
      samples.sort((a, b) => a - b);
      const p50 = samples[Math.floor(samples.length / 2)] ?? 0;
      const p99 = samples[samples.length - 1] ?? 0;
      console.log(
        `[escrow-cost] blob ${JSON.stringify(heavyState).length} bytes: p50 ${p50.toFixed(1)}ms max ${p99.toFixed(1)}ms over ${samples.length} passes`,
      );
      // 25x the observed 8.3ms max: loose enough for a loaded dev box, tight
      // enough that a plan regression (a scan, a lost index) reds here
      // instead of hiding under the 4s allowance.
      expect(p99).toBeLessThan(ESCROW_STATEMENT_TIMEOUT_MS / 25);
    }, 30_000);

    it('persists the maximum ledger prefix plus one storage effect under PostgreSQL 16', async () => {
      const { BANK_LEDGER_OUTBOX_DEFAULT_SESSION_LIMITS, serializeBankLedgerCommandBatch } =
        await import('../server/bank_ledger_outbox');
      const { REALM } = await import('../server/realm');
      const { ESCROW_LEDGER_STORAGE_WORKLOAD_STATEMENTS, ESCROW_STATEMENT_TIMEOUT_MS } =
        await import('../server/woc_market_db');
      const versionResult = await pool.query('SHOW server_version_num');
      const serverVersion = Number(versionResult.rows[0]?.server_version_num);
      expect(serverVersion).toBeGreaterThanOrEqual(160_000);
      expect(serverVersion).toBeLessThan(170_000);

      const account = await seedAccount();
      const buyer = await seedAccount();
      const characterId = await seedCharacter(REALM, account);
      await seedLease(REALM, characterId, 'escrow-max-prefix-live');
      const { maxRows, maxEncodedBytes } = BANK_LEDGER_OUTBOX_DEFAULT_SESSION_LIMITS;
      const buildBatch = (batchKey: string, payloadBytes: number) => {
        const instance = { padding: 'x'.repeat(payloadBytes) };
        return serializeBankLedgerCommandBatch(
          batchKey,
          Array.from({ length: maxRows }, () => ({
            realm: REALM,
            characterId,
            accountId: account,
            op: 'deposit' as const,
            itemId: 'peacebloom',
            count: 1,
            instance,
            copperDelta: 0,
            purchasedSlotsAfter: 6,
            container: 'personal' as const,
            containerId: null,
          })),
        );
      };

      // Find the largest equal-sized instance payload whose exact retained
      // JSON shape fits the production 2 MiB prefix budget. Each extra byte
      // costs one byte per row, so the accepted batch finishes within one
      // 2,048-byte step of the configured ceiling.
      let low = 0;
      let high = Math.ceil(maxEncodedBytes / maxRows);
      let payloadBytes = -1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = buildBatch('woc.pg16.max.0000', mid);
        if (candidate.encodedBytes <= maxEncodedBytes) {
          payloadBytes = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      expect(payloadBytes).toBeGreaterThanOrEqual(0);
      const calibrated = buildBatch('woc.pg16.max.0000', payloadBytes);
      expect(calibrated.rows).toHaveLength(maxRows);
      expect(calibrated.encodedBytes).toBeLessThanOrEqual(maxEncodedBytes);
      expect(maxEncodedBytes - calibrated.encodedBytes).toBeLessThan(maxRows);

      const samples: number[] = [];
      for (let sample = 0; sample < 3; sample++) {
        const suffix = String(sample + 1).padStart(4, '0');
        const batch = buildBatch(`woc.pg16.max.${suffix}`, payloadBytes);
        expect(batch.rows).toHaveLength(maxRows);
        expect(batch.encodedBytes).toBeLessThanOrEqual(maxEncodedBytes);
        const bankLedgerSnapshot: BankLedgerOutboxSnapshot = Object.freeze({
          owner: Object.freeze({ realm: REALM, characterId, accountId: account }),
          batches: Object.freeze([batch]),
          rowCount: batch.rows.length,
          encodedBytes: batch.encodedBytes,
          guildIds: batch.guildIds,
          hasUnscopedRows: batch.hasUnscopedRows,
        });
        const itemId = `strongbox_rung_${String(sample + 1).padStart(2, '0')}`;
        const idempotencyKey = `woc-pg16-max-storage-${suffix}`;
        const spendClaimToken = `00000000-0000-4000-8000-${String(sample + 1).padStart(12, '0')}`;
        const expectedCostClaudium = 100 + sample;
        await pool.query(
          `INSERT INTO storage_purchases (
             realm, account_id, character_id, item_id, expected_cost_claudium,
             idempotency_key, spend_claim_token, spend_claim_expires_at, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '90 seconds', 'pending')`,
          [
            REALM,
            account,
            characterId,
            itemId,
            expectedCostClaudium,
            idempotencyKey,
            spendClaimToken,
          ],
        );
        const storageEffect: StorageAppliedEffect = {
          realm: REALM,
          accountId: account,
          characterId,
          itemId,
          expectedCostClaudium,
          idempotencyKey,
          spendClaimToken,
          purchasedSlotsBefore: sample * 6,
          purchasedSlotsAfter: (sample + 1) * 6,
        };
        const offer = await pool.query(
          `INSERT INTO woc_market_directed_offers (
             realm, seller_account, seller_character, seller_name, buyer_account,
             buyer_name, item_ref, item_id, item_pin, usd_cents, status,
             buyer_accepted, seller_accepted, expires_at
           ) VALUES ($1, $2, $3, 'MaxSeller', $4, 'MaxBuyer',
                     '{"index":0,"itemId":"crown_of_embers"}'::jsonb,
                     'crown_of_embers', 'max-pin', 5000, 'accepted', true, true,
                     now() + interval '10 minutes')
           RETURNING id`,
          [REALM, account, characterId, buyer],
        );
        const listing = escrowListing(REALM, account, characterId, {
          directedBuyerAccount: buyer,
        });
        const startedAt = performance.now();
        const out = await marketDb.escrowInsertListing(
          {
            characterId,
            level: 12,
            state: SAVE_STATE,
            leaseNonce: 'escrow-max-prefix-live',
            storageEffects: [storageEffect],
            bankLedgerSnapshot,
          },
          { ...listing, directedOfferId: Number(offer.rows[0].id) },
        );
        samples.push(performance.now() - startedAt);
        if (!out.ok) throw new Error(`maximum-prefix escrow refused: ${out.reason}`);
        await pool.query(
          `UPDATE woc_market_listings SET status = 'closed', resolution = 'cancelled' WHERE id = $1`,
          [out.id],
        );
      }
      samples.sort((a, b) => a - b);
      const p50 = samples[Math.floor(samples.length / 2)] ?? 0;
      const max = samples[samples.length - 1] ?? 0;
      console.log(
        `[escrow-max-prefix] PostgreSQL ${serverVersion}, ${maxRows} rows, ${calibrated.encodedBytes} encoded bytes, ${ESCROW_LEDGER_STORAGE_WORKLOAD_STATEMENTS} statements under ${ESCROW_STATEMENT_TIMEOUT_MS}ms each: p50 ${p50.toFixed(1)}ms max ${max.toFixed(1)}ms over ${samples.length} passes`,
      );
      // Success is the timeout proof: PostgreSQL itself enforces the installed
      // 4s statement_timeout on every workload statement. The observed wall
      // time is logged, not promoted into a made-up CI latency promise.
      expect(max).toBeGreaterThan(0);
    }, 120_000);
  });

  describe('custody claim intent ledger, in real SQL', () => {
    it('the booked flip is one-way and every intent write refuses a booked claim', async () => {
      const realm = 'custody-intent-ledger';
      const ref = 'intent-ledger-1';
      expect(await marketDb.claimCustodyRef(realm, ref)).toBe(true);
      expect(await marketDb.markCustodyGrantIntent(ref, 4242)).toBe(true);
      expect((await marketDb.custodyRefState(ref))?.grantCharacterId).toBe(4242);
      // The one legal conversion: the mail intent WITHDRAWS the grant intent
      // in the same statement.
      expect(await marketDb.markCustodyMailIntent(ref)).toBe(true);
      expect(await marketDb.custodyRefState(ref)).toEqual({
        booked: false,
        grantCharacterId: null,
        mailIntent: true,
      });
      await marketDb.markCustodyRefBooked(ref);
      const stamped = await pool.query(
        `SELECT booked_at FROM woc_market_custody_claims WHERE custody_ref = $1`,
        [ref],
      );
      expect(stamped.rows[0].booked_at).not.toBeNull();
      // Booked: every intent write refuses and writes nothing.
      expect(await marketDb.markCustodyGrantIntent(ref, 777)).toBe(false);
      expect(await marketDb.markCustodyMailIntent(ref)).toBe(false);
      expect(await marketDb.custodyRefState(ref)).toEqual({
        booked: true,
        grantCharacterId: null,
        mailIntent: true,
      });
      // The flip is one-way: a re-book never moves the exactly-once evidence.
      await new Promise((r) => setTimeout(r, 10));
      await marketDb.markCustodyRefBooked(ref);
      const again = await pool.query(
        `SELECT booked_at FROM woc_market_custody_claims WHERE custody_ref = $1`,
        [ref],
      );
      expect(again.rows[0].booked_at, 'booked_at never re-stamps').toEqual(
        stamped.rows[0].booked_at,
      );
    });
  });

  describe('residue arm predicates, in real SQL', () => {
    async function seedSale(realm: string, listingId: number, excluded = false): Promise<void> {
      const saleId = await marketDb.insertSale({
        realm,
        listingId,
        itemId: 'crown_of_embers',
        item: { itemId: 'crown_of_embers', count: 1 },
        priceCents: 1000,
        amountBase: null,
        sellerAccount: 1,
        buyerAccount: 2,
        sellerName: 'S',
        buyerName: 'B',
      });
      if (excluded) expect(await marketDb.setSaleExcluded(saleId, true)).toBe('ok');
    }

    async function disposedFlag(id: number): Promise<boolean> {
      const res = await pool.query(`SELECT item_disposed FROM woc_market_listings WHERE id = $1`, [
        id,
      ]);
      return Boolean(res.rows[0].item_disposed);
    }

    it('disposeSoldResidueListings converges only SOLD residue proven by a LIVE sale row', async () => {
      const realm = 'residue-dispose';
      const seller = await seedAccount();
      const soldWithSale = await seedListing(realm, seller, {
        status: 'closed',
        resolution: 'sold',
      });
      await seedSale(realm, soldWithSale);
      const soldExcludedSale = await seedListing(realm, seller, {
        status: 'closed',
        resolution: 'sold',
      });
      await seedSale(realm, soldExcludedSale, true);
      const cancelledWithSale = await seedListing(realm, seller, {
        status: 'closed',
        resolution: 'cancelled',
      });
      await seedSale(realm, cancelledWithSale);
      // The item_disposed = false arm's own negative: an ALREADY-disposed
      // sold listing with a live sale row is converged history, not residue,
      // and must not re-enter the batch count.
      const alreadyDisposed = await seedListing(realm, seller, {
        status: 'closed',
        resolution: 'sold',
        itemDisposed: true,
      });
      await seedSale(realm, alreadyDisposed);
      expect(await marketDb.disposeSoldResidueListings(realm, 10)).toBe(1);
      expect(await disposedFlag(soldWithSale)).toBe(true);
      expect(
        await disposedFlag(soldExcludedSale),
        'a voided sale row proves nothing; the item must not vanish on it',
      ).toBe(false);
      expect(
        await disposedFlag(cancelledWithSale),
        'a cancelled listing keeps its return flight even beside a stray sale row',
      ).toBe(false);
    });

    it('undisposedClosedListings returns only undisposed non-sold residue', async () => {
      const realm = 'residue-return';
      const seller = await seedAccount();
      const returnable = await seedListing(realm, seller, {
        status: 'closed',
        resolution: 'unsettled',
      });
      await seedListing(realm, seller, {
        status: 'closed',
        resolution: 'unsettled',
        itemDisposed: true,
      });
      await seedListing(realm, seller, {
        status: 'closed',
        resolution: 'sold',
      });
      const rows = await marketDb.undisposedClosedListings(realm, 10, []);
      // Exactly the returnable row: a disposed copy must never mail twice and
      // sold residue belongs to the dispose arm, both excluded by the exact set.
      expect(rows.map((r) => r.id)).toEqual([returnable]);
    });
  });

  describe('finalize guards, in real SQL', () => {
    function guardArgs(
      realm: string,
      scene: { listingId: number; settlement: WocSettlementRow; winnerBidId: number },
    ) {
      return {
        settlementId: scene.settlement.id,
        listingId: scene.listingId,
        bidId: scene.winnerBidId,
        sale: {
          realm,
          listingId: scene.listingId,
          itemId: 'crown_of_embers',
          item: { itemId: 'crown_of_embers', count: 1 },
          priceCents: 1000,
          amountBase: null,
          sellerAccount: 1,
          buyerAccount: 2,
          sellerName: 'S',
          buyerName: 'B',
        },
      };
    }

    async function saleCount(listingId: number): Promise<number> {
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM woc_market_sales WHERE listing_id = $1`,
        [listingId],
      );
      return Number(res.rows[0].n);
    }

    it('refuses a settlement outside the delivering pair and writes NOTHING', async () => {
      const realm = 'finalize-guards';
      const scene = await seedScene(realm, 'confirmed');
      expect(await marketDb.finalizeDeliveredSettlement(guardArgs(realm, scene))).toBe('stale');
      const state = await pool.query(`SELECT state FROM woc_market_settlements WHERE id = $1`, [
        scene.settlement.id,
      ]);
      expect(state.rows[0].state, 'the CAS moved nothing').toBe('confirmed');
      expect(await saleCount(scene.listingId), 'no sale row on a refused finalize').toBe(0);
      const listing = await pool.query(
        `SELECT status, item_disposed FROM woc_market_listings WHERE id = $1`,
        [scene.listingId],
      );
      expect(listing.rows[0]).toEqual({ status: 'settling', item_disposed: false });
    });

    it('keeps a closed listing resolution and never re-queues a settled bond', async () => {
      const realm = 'finalize-keep';
      const scene = await seedScene(realm, 'delivering');
      // The listing was suspended mid-flight and the winner bond already paid
      // back by the suspend teardown.
      await pool.query(
        `UPDATE woc_market_listings SET status = 'closed', resolution = 'suspended' WHERE id = $1`,
        [scene.listingId],
      );
      await pool.query(`UPDATE woc_market_bids SET bond_state = 'refunded' WHERE id = $1`, [
        scene.winnerBidId,
      ]);
      expect(await marketDb.finalizeDeliveredSettlement(guardArgs(realm, scene))).toBe('finalized');
      const row = await pool.query(
        `SELECT status, resolution, item_disposed FROM woc_market_listings WHERE id = $1`,
        [scene.listingId],
      );
      expect(row.rows[0], 'the operator verdict survives the close tail').toEqual({
        status: 'closed',
        resolution: 'suspended',
        item_disposed: true,
      });
      const bond = await pool.query(`SELECT bond_state FROM woc_market_bids WHERE id = $1`, [
        scene.winnerBidId,
      ]);
      expect(bond.rows[0].bond_state, 'refunded money never re-queues').toBe('refunded');
    });
  });
});
