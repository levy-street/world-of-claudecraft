// Real-Postgres coverage for the $WOC Exchange REALM SCOPING: every store
// statement that carries `realm = $n` is a security predicate (one realm's
// actor or sweep must never see, move, or count another realm's rows), and
// until this suite each of those quals was exercised only through the fake
// twin. Each test seeds the SAME accounts into a realm PAIR (alpha, beta), so
// an account- or id-keyed filter alone can never satisfy the assertion: only
// the realm qual separates the two rows. Deleting a qual makes the alpha call
// return, move, or count the beta row, which is exactly what each assertion
// refuses. Per-test realm pairs keep every count exact and order-independent
// (a `-t` filtered run seeds the same world).
//
// Gate: TEST_DATABASE_URL (an admin URL on the dev Postgres from npm run
// db:up). The suite creates and drops its own database and never touches the
// database the URL points at. Pattern: tests/woc_market_settlement_pg_integration.test.ts.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WocListingRow, WocSettlementRow } from '../server/woc_market';
import type { PgWocMarketDb } from '../server/woc_market_db';
import type { CharacterState } from '../src/sim/sim';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_woc_market_realm_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

// server/db.ts reads DATABASE_URL at module load; nothing above is a static
// import of a server module, so this assignment points the boot path at the
// disposable database first.
if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

const BASE_MS = 1_820_000_000_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const FAR_MS = BASE_MS + 365 * DAY_MS;

describeDb('woc market realm scoping against real Postgres', () => {
  let admin: Pool;
  let pool: Pool;
  let db: typeof import('../server/db');
  let marketDb: PgWocMarketDb;
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
    // The REAL boot path, so every index and constraint under test is the one
    // production gets (the pair-pending index's realm column is pinned here).
    await db.ensureSchema();
    await db.runConcurrentIndexMigrations();

    pool = new Pool({ connectionString: verifyUrl(ADMIN_URL as string), max: 8 });
    marketDb = new marketDbMod.PgWocMarketDb(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await db?.pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
  }, 30_000);

  // -------------------------------------------------------------------------
  // Fixtures: direct SQL with an explicit realm on every row. The SAME
  // accounts live in both realms of a pair, on purpose.
  // -------------------------------------------------------------------------

  /** A fresh realm pair per test: exact counts, no cross-test coupling. */
  function realmPair(slug: string): { alpha: string; beta: string } {
    seq++;
    return { alpha: `alpha-${slug}-${seq}`, beta: `beta-${slug}-${seq}` };
  }

  async function seedAccount(): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`woc-realm-fixture-${seq}`],
    );
    return Number(res.rows[0].id);
  }

  async function seedCharacter(realm: string, accountId: number): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state, updated_at)
       VALUES ($1, $2, 'warrior', $3, 10, '{}'::jsonb, to_timestamp($4 / 1000.0)) RETURNING id`,
      // Later seq = later updated_at, so the deliveryTarget fallback's
      // "most recent character" tiebreak is deterministic.
      [accountId, `RealmChar${seq}`, realm, BASE_MS + seq * 1000],
    );
    return Number(res.rows[0].id);
  }

  async function characterName(id: number): Promise<string> {
    const res = await pool.query(`SELECT name FROM characters WHERE id = $1`, [id]);
    return String(res.rows[0].name);
  }

  interface ListingOver {
    status?: 'active' | 'ending' | 'settling' | 'closed';
    resolution?: string | null;
    itemDisposed?: boolean;
    endsAtMs?: number;
    updatedAtMs?: number;
    buyNowCents?: number | null;
    cancelRequestedAtMs?: number | null;
    lockAccount?: number | null;
    lockExpiresAtMs?: number | null;
    directedBuyerAccount?: number | null;
    itemId?: string;
  }

  async function seedListing(
    realm: string,
    sellerAccount: number,
    over: ListingOver = {},
  ): Promise<number> {
    seq++;
    const itemId = over.itemId ?? 'crown_of_embers';
    const res = await pool.query(
      `INSERT INTO woc_market_listings (
         realm, seller_account, seller_character, seller_name, seller_wallet,
         item, item_id, quality, format, start_cents, buy_now_cents, offer_next,
         status, resolution, item_disposed, ends_at, base_ends_at, updated_at,
         cancel_requested_at, buy_now_lock_account, buy_now_lock_expires,
         directed_buyer_account
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'epic', 'auction_buy_now', 500, $8, false,
         $9, $10, $11, to_timestamp($12 / 1000.0), to_timestamp($12 / 1000.0),
         to_timestamp($13 / 1000.0),
         CASE WHEN $14::bigint IS NULL THEN NULL ELSE to_timestamp($14::bigint / 1000.0) END,
         $15,
         CASE WHEN $16::bigint IS NULL THEN NULL ELSE to_timestamp($16::bigint / 1000.0) END,
         $17
       ) RETURNING id`,
      [
        realm,
        sellerAccount,
        9000 + seq,
        `Seller${seq}`,
        `wallet-seller-${seq}`,
        JSON.stringify({ itemId, count: 1 }),
        itemId,
        over.buyNowCents === undefined ? 1000 : over.buyNowCents,
        over.status ?? 'active',
        over.resolution ?? null,
        over.itemDisposed ?? false,
        over.endsAtMs ?? BASE_MS + 60 * MINUTE_MS,
        over.updatedAtMs ?? BASE_MS,
        over.cancelRequestedAtMs ?? null,
        over.lockAccount ?? null,
        over.lockExpiresAtMs ?? null,
        over.directedBuyerAccount ?? null,
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
      placedAtMs?: number;
      bondSignature?: string | null;
    } = {},
  ): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO woc_market_bids (
         listing_id, realm, account, character_id, character_name, wallet,
         amount_cents, status, bond_cents, bond_state, placed_at,
         bond_signature, bond_signature_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 700, $7, 70, $8, to_timestamp($9 / 1000.0), $10,
         CASE WHEN $10::text IS NULL THEN NULL ELSE to_timestamp($9 / 1000.0) END
       ) RETURNING id`,
      [
        listingId,
        realm,
        account,
        8000 + seq,
        `Bidder${seq}`,
        `wallet-bidder-${seq}`,
        over.status ?? 'pending_bond',
        over.bondState ?? 'pending',
        over.placedAtMs ?? BASE_MS - 10 * MINUTE_MS,
        over.bondSignature ?? null,
      ],
    );
    return Number(res.rows[0].id);
  }

  async function seedSettlement(
    realm: string,
    listingId: number,
    buyerAccount: number,
    over: { state?: string; deadlineAtMs?: number; updatedAtMs?: number } = {},
  ): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO woc_market_settlements (
         listing_id, realm, bid_id, attempt, buyer_account, buyer_character,
         buyer_name, buyer_wallet, amount_cents, state, deadline_at, updated_at
       ) VALUES (
         $1, $2, NULL, 0, $3, $4, $5, $6, 1000, $7,
         to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0)
       ) RETURNING id`,
      [
        listingId,
        realm,
        buyerAccount,
        7000 + seq,
        `Buyer${seq}`,
        `wallet-buyer-${seq}`,
        over.state ?? 'offered',
        over.deadlineAtMs ?? BASE_MS + 15 * MINUTE_MS,
        over.updatedAtMs ?? BASE_MS,
      ],
    );
    return Number(res.rows[0].id);
  }

  async function seedOffer(
    realm: string,
    sellerAccount: number,
    buyerAccount: number,
    over: { status?: string; expiresAtMs?: number; updatedAtMs?: number } = {},
  ): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO woc_market_directed_offers (
         realm, seller_account, seller_character, seller_name, buyer_account,
         buyer_name, item_id, item_pin, usd_cents, status, expires_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, 'crown_of_embers', repeat('a', 64), 1000, $7,
         to_timestamp($8 / 1000.0), to_timestamp($9 / 1000.0)
       ) RETURNING id`,
      [
        realm,
        sellerAccount,
        9000 + seq,
        `OfferSeller${seq}`,
        buyerAccount,
        `OfferBuyer${seq}`,
        over.status ?? 'pending',
        over.expiresAtMs ?? BASE_MS + 30 * MINUTE_MS,
        over.updatedAtMs ?? BASE_MS,
      ],
    );
    return Number(res.rows[0].id);
  }

  async function seedCustodyClaim(realm: string, claimedAtMs: number): Promise<string> {
    seq++;
    const ref = `realm-claim-${seq}`;
    await pool.query(
      `INSERT INTO woc_market_custody_claims (custody_ref, realm, claimed_at)
       VALUES ($1, $2, to_timestamp($3 / 1000.0))`,
      [ref, realm, claimedAtMs],
    );
    return ref;
  }

  async function seedAbandon(
    realm: string,
    listingId: number,
    account: number,
    lockExpiresAtMs: number,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO woc_market_buy_now_abandons (realm, listing_id, account, lock_expires)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))`,
      [realm, listingId, account, lockExpiresAtMs],
    );
  }

  async function listingStatus(id: number): Promise<{
    status: string;
    itemDisposed: boolean;
    lockAccount: number | null;
    endsAtMs: number;
  }> {
    const res = await pool.query(
      `SELECT status, item_disposed, buy_now_lock_account,
              (EXTRACT(EPOCH FROM ends_at) * 1000)::bigint AS ends_ms
         FROM woc_market_listings WHERE id = $1`,
      [id],
    );
    return {
      status: String(res.rows[0].status),
      itemDisposed: Boolean(res.rows[0].item_disposed),
      lockAccount:
        res.rows[0].buy_now_lock_account === null ? null : Number(res.rows[0].buy_now_lock_account),
      endsAtMs: Number(res.rows[0].ends_ms),
    };
  }

  async function offerRow(
    id: number,
  ): Promise<{ status: string; listingId: number | null; buyerAccepted: boolean }> {
    const res = await pool.query(
      `SELECT status, listing_id, buyer_accepted FROM woc_market_directed_offers WHERE id = $1`,
      [id],
    );
    return {
      status: String(res.rows[0].status),
      listingId: res.rows[0].listing_id === null ? null : Number(res.rows[0].listing_id),
      buyerAccepted: Boolean(res.rows[0].buyer_accepted),
    };
  }

  async function bidStatus(id: number): Promise<string> {
    const res = await pool.query(`SELECT status FROM woc_market_bids WHERE id = $1`, [id]);
    return String(res.rows[0].status);
  }

  async function settlementState(id: number): Promise<string> {
    const res = await pool.query(`SELECT state FROM woc_market_settlements WHERE id = $1`, [id]);
    return String(res.rows[0].state);
  }

  const ids = (rows: readonly { id: number }[]): number[] =>
    rows.map((r) => r.id).sort((x, y) => x - y);
  const settlementIds = (rows: readonly WocSettlementRow[]): number[] => ids(rows);
  const listingIds = (rows: readonly WocListingRow[]): number[] => ids(rows);

  // -------------------------------------------------------------------------
  // Listing reads
  // -------------------------------------------------------------------------

  describe('listing reads', () => {
    it('listingById refuses a cross-realm id, browse / seller / directed reads keep to the realm', async () => {
      const { alpha, beta } = realmPair('listing-reads');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const a = await seedListing(alpha, seller);
      const aDirected = await seedListing(alpha, seller, { directedBuyerAccount: buyer });
      // Closed rows must leave the public browse too (the liveness status set).
      const aClosed = await seedListing(alpha, seller, {
        status: 'closed',
        resolution: 'cancelled',
      });
      const b = await seedListing(beta, seller);
      // Load-bearing by EXISTENCE: the exact sets below exclude this beta twin.
      await seedListing(beta, seller, { directedBuyerAccount: buyer });
      // Two ALPHA rows the buyer's directed read must also exclude: another
      // buyer's directed sale (the addressee qual) and a CLOSED sale already
      // addressed to this buyer (the liveness member). A second seller keeps
      // the seller-keyed sets above unchanged.
      const seller2 = await seedAccount();
      await seedListing(alpha, seller2, { directedBuyerAccount: await seedAccount() });
      await seedListing(alpha, seller2, {
        directedBuyerAccount: buyer,
        status: 'closed',
        resolution: 'cancelled',
      });

      expect(await marketDb.listingById(alpha, b), 'cross-realm point read').toBeNull();
      expect((await marketDb.listingById(alpha, a))?.id).toBe(a);

      const browse = await marketDb.browseListings(alpha, {
        page: 0,
        pageSize: 50,
        quality: null,
        format: null,
        category: null,
        subcategory: null,
        itemIds: null,
        sort: 'newest',
      });
      expect(listingIds(browse.rows)).toEqual([a]);

      expect(listingIds(await marketDb.listingsBySeller(alpha, seller))).toEqual([
        a,
        aDirected,
        aClosed,
      ]);
      // The SAME seller holds two non-closed listings in beta; the count must
      // not see them (and the alpha closed row never counts).
      expect(await marketDb.countActiveBySeller(alpha, seller)).toBe(2);
      // The exact set is the whole pin: it excludes the beta twin
      // (bDirected), the other-addressee row, and the closed row at once.
      expect(listingIds(await marketDb.directedOffersForBuyer(alpha, buyer))).toEqual([aDirected]);

      const ops = await marketDb.opsListings({
        realm: alpha,
        status: 'active',
        fromMs: 0,
        toMs: Date.now() + DAY_MS,
        page: 0,
        pageSize: 200,
      });
      expect(listingIds(ops.rows)).toEqual([a]);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Listing guard transactions: a cross-realm id is 'not_found' and the beta
  // row is untouched
  // -------------------------------------------------------------------------

  describe('listing guard transactions', () => {
    it('cancel, suspend, buy-now claim, bid, and anti-snipe extension all refuse a cross-realm listing', async () => {
      const { alpha, beta } = realmPair('listing-guards');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const holder = await seedAccount();
      // The beta listing is LOCKED by a third account: the buy-now claim's
      // lock-free peek would otherwise diagnose it 'locked' before the guard
      // transaction ever refuses it, so only a realm-scoped peek answers the
      // honest 'not_found'.
      const b = await seedListing(beta, seller, {
        lockAccount: holder,
        lockExpiresAtMs: BASE_MS + 5 * MINUTE_MS,
      });
      const before = await listingStatus(b);

      expect(await marketDb.cancelListingIfUnbid(alpha, b, seller, BASE_MS)).toBe('not_found');
      expect(await marketDb.suspendListingIfSafe(alpha, b, BASE_MS)).toBe('not_found');
      expect(
        await marketDb.claimBuyNowLock(alpha, b, buyer, BASE_MS, BASE_MS + 5 * MINUTE_MS),
      ).toBe('not_found');
      const bid = await marketDb.insertPendingBid({
        realm: alpha,
        listingId: b,
        account: buyer,
        characterId: 1,
        characterName: 'Bidder',
        wallet: 'wallet-bidder-x',
        amountCents: 900,
        bondCents: 90,
        nowMs: BASE_MS,
        minNext: () => 0,
      });
      expect(bid).toEqual({ ok: false, reason: 'not_found' });
      expect(await marketDb.extendAuctionForBondProgress(alpha, b, () => FAR_MS)).toBe('skip');

      const after = await listingStatus(b);
      expect(after, 'the beta row never moved').toEqual(before);
      expect(after.status).toBe('active');
      expect(after.lockAccount).toBe(holder);
      const bids = await pool.query(
        `SELECT count(*)::int AS n FROM woc_market_bids WHERE listing_id = $1`,
        [b],
      );
      expect(bids.rows[0].n).toBe(0);
    }, 20_000);

    it('the cancel-intent converge read and close keep to the realm', async () => {
      const { alpha, beta } = realmPair('cancel-pending');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const over: ListingOver = {
        cancelRequestedAtMs: BASE_MS - 20 * MINUTE_MS,
        lockAccount: buyer,
        lockExpiresAtMs: BASE_MS - 5 * MINUTE_MS,
      };
      const a = await seedListing(alpha, seller, over);
      const b = await seedListing(beta, seller, over);

      expect(listingIds(await marketDb.cancelPendingListings(alpha, BASE_MS, 10, []))).toEqual([a]);
      expect(await marketDb.closeCancelPendingListing(alpha, b, BASE_MS)).toBe('skip');
      expect((await listingStatus(b)).status).toBe('active');
      const closed = await marketDb.closeCancelPendingListing(alpha, a, BASE_MS);
      expect(typeof closed === 'object' ? closed.id : closed).toBe(a);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Sweep batch reads and batch writes over listings
  // -------------------------------------------------------------------------

  describe('listing sweep arms', () => {
    it('claimDueListings moves only the realm due set; the beta due listing stays active', async () => {
      const { alpha, beta } = realmPair('claim-due');
      const seller = await seedAccount();
      const a = await seedListing(alpha, seller, { endsAtMs: BASE_MS - MINUTE_MS });
      const b = await seedListing(beta, seller, { endsAtMs: BASE_MS - MINUTE_MS });
      expect(listingIds(await marketDb.claimDueListings(alpha, BASE_MS, 10))).toEqual([a]);
      expect((await listingStatus(a)).status).toBe('ending');
      expect((await listingStatus(b)).status, 'beta due listing untouched').toBe('active');
    }, 20_000);

    it('undisposed, stranded, and delivered-page reads keep to the realm', async () => {
      const { alpha, beta } = realmPair('batch-reads');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const old = BASE_MS - 2 * HOUR_MS;
      const aUndisposed = await seedListing(alpha, seller, {
        status: 'closed',
        resolution: 'unsettled',
        updatedAtMs: old,
      });
      // Load-bearing by EXISTENCE (this and the two beta rows below): the
      // exact sets exclude them.
      await seedListing(beta, seller, {
        status: 'closed',
        resolution: 'unsettled',
        updatedAtMs: old,
      });
      const aStranded = await seedListing(alpha, seller, { status: 'ending', updatedAtMs: old });
      await seedListing(beta, seller, { status: 'ending', updatedAtMs: old });
      // FRESH ending rows are mid-close, not stranded: the age bound must
      // keep them out of the reclaim batch.
      await seedListing(alpha, seller, { status: 'ending', updatedAtMs: BASE_MS });
      const aOpen = await seedListing(alpha, seller);
      const bOpen = await seedListing(beta, seller);
      const aDelivered = await seedSettlement(alpha, aOpen, buyer, { state: 'delivered' });
      await seedSettlement(beta, bOpen, buyer, { state: 'delivered' });

      // Each exact set below is the whole pin: it excludes the beta twin row
      // (bUndisposed / bStranded / bDelivered) by equality.
      expect(listingIds(await marketDb.undisposedClosedListings(alpha, 10, []))).toEqual([
        aUndisposed,
      ]);
      expect(listingIds(await marketDb.strandedListings(alpha, BASE_MS - HOUR_MS, 10))).toEqual([
        aStranded,
      ]);
      const page = await marketDb.deliveredUnclosedSettlementsPage(alpha, 0, 50, 50);
      expect(settlementIds(page.settlements)).toEqual([aDelivered]);
    }, 20_000);

    it('salesForItem reads only the realm ledger', async () => {
      const { alpha, beta } = realmPair('sales');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const sale = async (realm: string): Promise<number> =>
        marketDb.insertSale({
          realm,
          listingId: await seedListing(realm, seller, { status: 'closed', resolution: 'sold' }),
          itemId: 'crown_of_embers',
          item: { itemId: 'crown_of_embers', count: 1 },
          priceCents: 1000,
          amountBase: null,
          sellerAccount: seller,
          buyerAccount: buyer,
          sellerName: 'S',
          buyerName: 'B',
        });
      const a = await sale(alpha);
      // Load-bearing by EXISTENCE: the exact set excludes the beta sale.
      await sale(beta);
      const rows = await marketDb.salesForItem(alpha, 'crown_of_embers', 10);
      // The exact set is the whole pin: it excludes the beta sale by equality.
      expect(ids(rows)).toEqual([a]);
      // The seller pivot (the Browse click-through) reads the same realm
      // ledger by seller_name, and misses a different name entirely.
      expect(ids(await marketDb.salesForSeller(alpha, 'S', 10))).toEqual([a]);
      expect(await marketDb.salesForSeller(alpha, 'Nobody', 10)).toEqual([]);
      // A voided sale leaves the price history too, on both pivots.
      expect(await marketDb.setSaleExcluded(a, true)).toBe('ok');
      expect(await marketDb.salesForItem(alpha, 'crown_of_embers', 10)).toEqual([]);
      expect(await marketDb.salesForSeller(alpha, 'S', 10)).toEqual([]);
    }, 20_000);

    it('the category backfill stamps pre-round rows and the filter then reaches them', async () => {
      // The dev repro end to end: a row seeded WITHOUT stamps (this suite's
      // seedListing predates the columns, like the live pre-round listings)
      // is invisible to a category-filtered browse; one backfill pass stamps
      // it from the catalog derivation and the same query finds it.
      const { alpha } = realmPair('cat-backfill');
      const seller = await seedAccount();
      const id = await seedListing(alpha, seller, { itemId: 'heroic_kingsbane_last_oath' });
      const swordQuery = {
        page: 0,
        pageSize: 25,
        quality: null,
        format: null,
        category: 'weapon',
        subcategory: 'sword',
        itemIds: null,
        sort: 'ending',
      } as const;
      const before = await marketDb.browseListings(alpha, swordQuery);
      expect(before.rows.map((r) => r.id)).not.toContain(id);
      const { backfillListingCategoryStamps } = await import('../server/woc_market_backfill');
      expect(await backfillListingCategoryStamps(marketDb)).toBeGreaterThanOrEqual(1);
      const after = await marketDb.browseListings(alpha, swordQuery);
      expect(after.rows.map((r) => r.id)).toContain(id);
      // Converged for this item: the worklist no longer names it.
      expect(await marketDb.listingItemIdsMissingCategory()).not.toContain(
        'heroic_kingsbane_last_oath',
      );
    }, 20_000);

    it('sellerProfile resolves guild and creation only on the character realm', async () => {
      const { alpha, beta } = realmPair('seller-profile');
      const account = await seedAccount();
      const characterId = await seedCharacter(alpha, account);
      const name = await characterName(characterId);
      const guild = await pool.query(
        `INSERT INTO guilds (name, realm) VALUES ($1, $2) RETURNING id`,
        [`Monarchs-${seq}`, alpha],
      );
      await pool.query(`INSERT INTO guild_members (character_id, guild_id) VALUES ($1, $2)`, [
        characterId,
        Number(guild.rows[0].id),
      ]);
      const profile = await marketDb.sellerProfile(alpha, name);
      expect(profile?.guildName).toBe(`Monarchs-${seq}`);
      // The realm qual is a scoping predicate: the SAME name probed on the
      // other realm resolves nothing (the renamed-or-deleted arm's shape).
      expect(await marketDb.sellerProfile(beta, name)).toBeNull();
      // An unguilded character still resolves, with a null guild.
      const loner = await seedCharacter(alpha, account);
      const lonerProfile = await marketDb.sellerProfile(alpha, await characterName(loner));
      expect(lonerProfile).not.toBeNull();
      expect(lonerProfile?.guildName).toBeNull();
    }, 20_000);

    it('disposeSoldResidueListings converges only the realm residue', async () => {
      const { alpha, beta } = realmPair('dispose-sold');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const mk = async (realm: string): Promise<number> => {
        const id = await seedListing(realm, seller, { status: 'closed', resolution: 'sold' });
        await marketDb.insertSale({
          realm,
          listingId: id,
          itemId: 'crown_of_embers',
          item: { itemId: 'crown_of_embers', count: 1 },
          priceCents: 1000,
          amountBase: null,
          sellerAccount: seller,
          buyerAccount: buyer,
          sellerName: 'S',
          buyerName: 'B',
        });
        return id;
      };
      const a = await mk(alpha);
      const b = await mk(beta);
      expect(await marketDb.disposeSoldResidueListings(alpha, 10)).toBe(1);
      expect((await listingStatus(a)).itemDisposed).toBe(true);
      expect((await listingStatus(b)).itemDisposed, 'beta residue untouched').toBe(false);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Directed offers
  // -------------------------------------------------------------------------

  describe('directed offers', () => {
    it('point and account reads keep to the realm', async () => {
      const { alpha, beta } = realmPair('offer-reads');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const a = await seedOffer(alpha, seller, buyer);
      const b = await seedOffer(beta, seller, buyer);
      // A SAME-realm offer between two strangers: the exact sets below can
      // then only be satisfied through the participant qual (buyer OR seller
      // equals the queried account), not through realm scoping alone. This
      // read is every account's trade poll; a participant strip would leak
      // counterparties, prices, and item pins across the whole realm.
      const strangers = await seedOffer(alpha, await seedAccount(), await seedAccount());
      expect(await marketDb.directedOfferById(alpha, b)).toBeNull();
      expect((await marketDb.directedOfferById(alpha, a))?.id).toBe(a);
      const forBuyer = await marketDb.directedOffersForAccount(alpha, buyer, BASE_MS);
      expect(ids(forBuyer)).toEqual([a]);
      const forSeller = await marketDb.directedOffersForAccount(alpha, seller, BASE_MS);
      expect(ids(forSeller)).toEqual([a]);
      const ops = await marketDb.opsP2pTrades({
        realm: alpha,
        status: 'all',
        fromMs: 0,
        toMs: Date.now() + DAY_MS,
        page: 0,
        pageSize: 200,
      });
      // The OPERATOR read is realm-wide by design: it sees the strangers'
      // deal too, and still excludes the beta twin by equality.
      expect(ids(ops.rows)).toEqual([a, strangers].sort((x, y) => x - y));
    }, 20_000);

    it('resolve and accept-side refuse a cross-realm pending offer and leave it pending', async () => {
      const { alpha, beta } = realmPair('offer-cas');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const b = await seedOffer(beta, seller, buyer);
      expect(await marketDb.resolveDirectedOffer(alpha, b, 'declined')).toBeNull();
      expect(await marketDb.acceptDirectedOfferSide(alpha, b, 'buyer', null)).toBeNull();
      const row = await offerRow(b);
      expect(row.status).toBe('pending');
      expect(row.buyerAccepted).toBe(false);
    }, 20_000);

    it('the expiry sweep expires only the realm due set', async () => {
      const { alpha, beta } = realmPair('offer-expiry');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const a = await seedOffer(alpha, seller, buyer, { expiresAtMs: BASE_MS - MINUTE_MS });
      const b = await seedOffer(beta, seller, buyer, { expiresAtMs: BASE_MS - MINUTE_MS });
      // Two SAME-realm rows the due set must also exclude: a pending offer
      // whose TTL has not run out (the due bound: a strip would expire live
      // deals early) and a due-aged row already resolved (the inner status
      // qual: a verdict never relabels to expired).
      const undue = await seedOffer(alpha, await seedAccount(), buyer, {
        expiresAtMs: BASE_MS + MINUTE_MS,
      });
      const resolved = await seedOffer(alpha, await seedAccount(), buyer, {
        status: 'declined',
        expiresAtMs: BASE_MS - MINUTE_MS,
      });
      expect(await marketDb.expireDueDirectedOffers(alpha, BASE_MS, 10)).toBe(1);
      expect((await offerRow(a)).status).toBe('expired');
      expect((await offerRow(b)).status, 'beta due offer untouched').toBe('pending');
      expect((await offerRow(undue)).status, 'a live TTL is not due').toBe('pending');
      expect((await offerRow(resolved)).status, 'a verdict never relabels').toBe('declined');
    }, 20_000);

    it('the converge arm reads, reopens, and expires only within the realm', async () => {
      const { alpha, beta } = realmPair('offer-converge');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const window = { status: 'accepted', updatedAtMs: BASE_MS - 10 * MINUTE_MS };
      const a = await seedOffer(alpha, seller, buyer, window);
      const b = await seedOffer(beta, seller, buyer, window);
      const batch = await marketDb.acceptedUnstampedOffers(
        alpha,
        BASE_MS - 5 * MINUTE_MS,
        BASE_MS - DAY_MS,
        10,
      );
      expect(ids(batch)).toEqual([a]);
      expect(await marketDb.expireDirectedOfferIfUnstamped(alpha, b)).toBe(false);
      expect(await marketDb.reopenDirectedOffer(alpha, b)).toBe(false);
      expect((await offerRow(b)).status, 'beta accepted row untouched').toBe('accepted');
      expect(await marketDb.reopenDirectedOffer(alpha, a)).toBe(true);
    }, 20_000);

    it('a pending pair in another realm neither blocks a new offer nor a reopen here', async () => {
      const { alpha, beta } = realmPair('pair-index-realm');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      await seedOffer(beta, seller, buyer);
      // The pair-pending unique index carries realm as its first column: the
      // beta pending pair is no bound on an alpha insert...
      const inserted = await marketDb.insertDirectedOffer({
        realm: alpha,
        sellerAccount: seller,
        sellerCharacter: 1,
        sellerName: 'S',
        buyerAccount: buyer,
        buyerName: 'B',
        usdCents: 1000,
        expiresAtMs: BASE_MS + 30 * MINUTE_MS,
        itemId: 'crown_of_embers',
        itemPin: 'a'.repeat(64),
      });
      expect(inserted === 'offer_pending' ? inserted : 'row').toBe('row');
      // ...and the reopen's NOT EXISTS probe is realm-joined, so a beta pending
      // pair cannot veto an alpha reopen either. Resolve the alpha pending row
      // first so the alpha pair is free.
      const aPendingId = inserted === 'offer_pending' ? -1 : inserted.id;
      expect(await marketDb.resolveDirectedOffer(alpha, aPendingId, 'declined')).not.toBeNull();
      const accepted = await seedOffer(alpha, seller, buyer, {
        status: 'accepted',
        updatedAtMs: BASE_MS - 10 * MINUTE_MS,
      });
      expect(await marketDb.reopenDirectedOffer(alpha, accepted)).toBe(true);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Bids
  // -------------------------------------------------------------------------

  describe('bids', () => {
    it('abandon refuses a cross-realm bid; confirming, lapse, activity, and bond-due reads keep to the realm', async () => {
      const { alpha, beta } = realmPair('bids');
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const aListing = await seedListing(alpha, seller);
      const bListing = await seedListing(beta, seller);
      const old = BASE_MS - 2 * HOUR_MS;
      const aSigned = await seedBid(alpha, aListing, bidder, { bondSignature: `sig-a-${seq}` });
      // Load-bearing by EXISTENCE: the exact sets below exclude this beta
      // twin and the beta refund twin further down.
      await seedBid(beta, bListing, bidder, { bondSignature: `sig-b-${seq}` });
      const aStale = await seedBid(alpha, aListing, bidder, { placedAtMs: old });
      const bStale = await seedBid(beta, bListing, bidder, { placedAtMs: old });
      // Fresh AND unsigned: only the TTL, not the signature, spares it.
      const aFresh = await seedBid(alpha, aListing, bidder, {
        placedAtMs: BASE_MS - 10 * MINUTE_MS,
      });
      // OLD and unsigned but NOT pending: the lapse sweep's status qual is
      // what keeps it standing (a strip would flip it lapsed and VOID a
      // refund the bond worker still owes).
      const aDue = await seedBid(alpha, aListing, bidder, {
        status: 'outbid',
        bondState: 'refund_due',
        placedAtMs: old,
      });
      await seedBid(beta, bListing, bidder, {
        status: 'outbid',
        bondState: 'refund_due',
      });
      // A RIVAL's same-realm bid: the account read below is a bid-history
      // surface (amounts, bond states), so its exact set must be separable
      // by the account qual, not by realm alone.
      await seedBid(alpha, aListing, await seedAccount());

      expect(await marketDb.abandonPendingBid(alpha, bStale, bidder)).toBe(false);
      expect(await bidStatus(bStale)).toBe('pending_bond');

      // The exact set is the whole pin: it excludes the beta twin (bSigned).
      expect(ids(await marketDb.confirmingBonds(alpha, 10, []))).toEqual([aSigned]);

      expect(await marketDb.lapsePendingBids(alpha, BASE_MS - HOUR_MS, 10)).toBe(1);
      expect(await bidStatus(aStale)).toBe('lapsed');
      expect(await bidStatus(bStale), 'beta stale bid untouched').toBe('pending_bond');
      expect(await bidStatus(aFresh), 'a fresh unsigned bid outlives the sweep').toBe(
        'pending_bond',
      );
      expect(await bidStatus(aDue), 'the sweep lapses only PENDING bids').toBe('outbid');

      const activity = await marketDb.bidsByAccount(alpha, bidder, 50);
      expect(ids(activity)).toEqual([aSigned, aStale, aDue, aFresh].sort((x, y) => x - y));

      // The exact set is the whole pin: it excludes the beta twin (bDue).
      expect(ids(await marketDb.bondsDue(alpha, 10))).toEqual([aDue]);
    }, 20_000);

    it('the account-wide abandon cap counts only the realm ledger', async () => {
      const { alpha, beta } = realmPair('abandon-cap');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const aListing = await seedListing(alpha, seller);
      const bListing = await seedListing(beta, seller);
      // Recent beta abandons by the SAME buyer up to the cap (distinct lock
      // expiries, the once-index key): at the cap there, free here.
      const { WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR } = await import('../server/woc_market_rules');
      for (let i = 1; i <= WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR; i++) {
        await seedAbandon(beta, bListing, buyer, BASE_MS - i * MINUTE_MS);
      }
      const claimed = await marketDb.claimBuyNowLock(
        alpha,
        aListing,
        buyer,
        BASE_MS,
        BASE_MS + 5 * MINUTE_MS,
      );
      expect(typeof claimed === 'object' && 'id' in claimed ? claimed.id : claimed).toBe(aListing);
      expect((await listingStatus(aListing)).lockAccount).toBe(buyer);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Settlements
  // -------------------------------------------------------------------------

  describe('settlements', () => {
    it('every settlement batch read keeps to the realm and the deliverable claim moves only its rows', async () => {
      const { alpha, beta } = realmPair('settlements');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const old = BASE_MS - 10 * HOUR_MS;
      const mk = async (
        realm: string,
        over: Parameters<typeof seedSettlement>[3],
      ): Promise<number> => seedSettlement(realm, await seedListing(realm, seller), buyer, over);
      const aConfirming = await mk(alpha, { state: 'confirming', updatedAtMs: old });
      // Load-bearing by EXISTENCE: the exact toEqual sets below exclude them.
      await mk(beta, { state: 'confirming', updatedAtMs: old });
      const aConfirmed = await mk(alpha, { state: 'confirmed' });
      const bConfirmed = await mk(beta, { state: 'confirmed' });
      const aDelivering = await mk(alpha, { state: 'delivering' });
      await mk(beta, { state: 'delivering' });
      const aOverdue = await mk(alpha, { state: 'offered', deadlineAtMs: BASE_MS - MINUTE_MS });
      await mk(beta, { state: 'offered', deadlineAtMs: BASE_MS - MINUTE_MS });
      // A STRANGER's same-realm settlement: the account activity read carries
      // wallets, amounts, and signatures, so its exact set must be separable
      // by the buyer qual, not by realm alone.
      const stranger = await seedAccount();
      await seedSettlement(alpha, await seedListing(alpha, seller), stranger, {
        state: 'offered',
        deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
      });

      const activity = await marketDb.settlementsByAccount(alpha, buyer, 50);
      expect(ids(activity)).toEqual(
        [aConfirming, aConfirmed, aDelivering, aOverdue].sort((x, y) => x - y),
      );
      expect(settlementIds(await marketDb.confirmingSettlements(alpha, 10))).toEqual([aConfirming]);
      expect(
        settlementIds(
          await marketDb.confirmingOverdueSettlements(alpha, BASE_MS - 6 * HOUR_MS, 10),
        ),
      ).toEqual([aConfirming]);
      expect(settlementIds(await marketDb.deliveringSettlements(alpha, 10, []))).toEqual([
        aDelivering,
      ]);
      expect(settlementIds(await marketDb.overdueSettlements(alpha, BASE_MS, 10))).toEqual([
        aOverdue,
      ]);

      expect(settlementIds(await marketDb.claimDeliverableSettlements(alpha, 10))).toEqual([
        aConfirmed,
      ]);
      expect(await settlementState(aConfirmed)).toBe('delivering');
      expect(await settlementState(bConfirmed), 'beta confirmed row untouched').toBe('confirmed');
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // Custody readout and delivery target
  // -------------------------------------------------------------------------

  describe('custody readout and delivery target', () => {
    it('the stuck readout counts and samples exactly the realm rows in all five classes', async () => {
      const { alpha, beta } = realmPair('readout');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const old = BASE_MS - 2 * HOUR_MS;
      const seedRealm = async (realm: string) => {
        const claim = await seedCustodyClaim(realm, old);
        const delivering = await seedSettlement(realm, await seedListing(realm, seller), buyer, {
          state: 'delivering',
          updatedAtMs: old,
        });
        const undisposed = await seedListing(realm, seller, {
          status: 'closed',
          resolution: 'unsettled',
          updatedAtMs: old,
        });
        const review = await seedSettlement(realm, await seedListing(realm, seller), buyer, {
          state: 'review',
        });
        const bond = await seedBid(realm, await seedListing(realm, seller), buyer, {
          placedAtMs: old,
          bondSignature: `stuck-${realm}`,
        });
        return { claim, delivering, undisposed, review, bond };
      };
      const a = await seedRealm(alpha);
      await seedRealm(beta);
      const out = await marketDb.stuckCustodyReadout(
        alpha,
        BASE_MS - HOUR_MS,
        10,
        100,
        BASE_MS - HOUR_MS,
      );
      expect(out.unbookedClaims.count).toBe(1);
      expect(out.unbookedClaims.sample.map((s) => s.custodyRef)).toEqual([a.claim]);
      expect(out.stuckDelivering.count).toBe(1);
      expect(out.stuckDelivering.sample.map((s) => s.id)).toEqual([a.delivering]);
      expect(out.undisposedListings.count).toBe(1);
      expect(out.undisposedListings.sample.map((s) => s.id)).toEqual([a.undisposed]);
      expect(out.reviewSettlements.count).toBe(1);
      expect(out.reviewSettlements.sample.map((s) => s.id)).toEqual([a.review]);
      expect(out.stuckBonds.count).toBe(1);
      expect(out.stuckBonds.sample.map((s) => s.id)).toEqual([a.bond]);
    }, 20_000);

    it('characterByName and deliveryTarget resolve only within the realm', async () => {
      const { alpha, beta } = realmPair('characters');
      const buyer = await seedAccount();
      const aChar = await seedCharacter(alpha, buyer);
      // Seeded AFTER the alpha character, so it is the newest of the account's
      // characters: a fallback that forgot the realm would prefer it.
      const bChar = await seedCharacter(beta, buyer);
      expect(await marketDb.characterByName(alpha, await characterName(bChar))).toBeNull();
      expect((await marketDb.characterByName(alpha, await characterName(aChar)))?.characterId).toBe(
        aChar,
      );
      // Preferred id from the other realm: refused, and the fallback lands on
      // the realm's own character, never the newer beta one.
      expect((await marketDb.deliveryTarget(alpha, buyer, bChar))?.characterId).toBe(aChar);
      // Account scoping rides the same statements: a preferred id owned by a
      // DIFFERENT account refuses, and the newest-character fallback never
      // crosses accounts even inside the realm.
      const outsider = await seedAccount();
      const outsiderChar = await seedCharacter(alpha, outsider);
      expect((await marketDb.deliveryTarget(alpha, buyer, outsiderChar))?.characterId).toBe(aChar);
      expect(outsiderChar).toBeGreaterThan(aChar);
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // The escrow transaction's two realm quals
  // -------------------------------------------------------------------------

  describe('escrow entry', () => {
    const SAVE_STATE = { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState;

    function escrowListing(
      realm: string,
      sellerAccount: number,
      sellerCharacter: number,
      directedOfferId: number | null,
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
          directedBuyerAccount: null,
          startCents: 5000,
          reserveCents: null,
          buyNowCents: null,
          durationHours: 12,
          offerNext: false,
        },
        endsAtMs: BASE_MS + 12 * 60 * MINUTE_MS,
        directedOfferId,
      };
    }

    it('the authoritative cap count sees only the realm listings', async () => {
      const { alpha, beta } = realmPair('escrow-cap');
      const seller = await seedAccount();
      const characterId = await seedCharacter(alpha, seller);
      // The seller sits AT the cap in beta; alpha is empty.
      const { WOC_MARKET_MAX_ACTIVE_LISTINGS } = await import('../server/woc_market_rules');
      for (let i = 0; i < WOC_MARKET_MAX_ACTIVE_LISTINGS; i++) await seedListing(beta, seller);
      const out = await marketDb.escrowInsertListing(
        { characterId, level: 10, state: SAVE_STATE, leaseNonce: undefined },
        escrowListing(alpha, seller, characterId, null),
      );
      expect(out.ok, `escrow answered ${out.ok ? 'ok' : out.reason}`).toBe(true);
    }, 20_000);

    it('the atomic offer stamp refuses a cross-realm offer id and rolls the listing back', async () => {
      const { alpha, beta } = realmPair('escrow-stamp');
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const characterId = await seedCharacter(alpha, seller);
      const bAccepted = await seedOffer(beta, seller, buyer, { status: 'accepted' });
      const out = await marketDb.escrowInsertListing(
        { characterId, level: 10, state: SAVE_STATE, leaseNonce: undefined },
        escrowListing(alpha, seller, characterId, bAccepted),
      );
      expect(out).toEqual({ ok: false, reason: 'not_pending' });
      expect((await offerRow(bAccepted)).listingId, 'beta offer never stamped').toBeNull();
      expect(await marketDb.countActiveBySeller(alpha, seller), 'the insert rolled back').toBe(0);
    }, 20_000);
  });
});
