// Real-Postgres coverage for the $WOC Exchange DIRECTED rail: the agreed-item
// fingerprint, the settlement-window hold, the shared listing cap, the
// same-wallet self-deal guard, the non-payment strike and auto-close, and the
// accepted-offer converge arm. Interleaved transactions simulate the races;
// the disposable database boots through the REAL ensureSchema so every index
// and constraint under test is the one production gets.
//
// Gate: TEST_DATABASE_URL (an admin URL on the dev Postgres from npm run
// db:up). The suite creates and drops its own database and never touches the
// database the URL points at. Pattern: tests/woc_market_settlement_pg_integration.test.ts.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WocCustodyExtract, WocMarketCustody, WocMarketService } from '../server/woc_market';
import type { PgWocMarketDb } from '../server/woc_market_db';
import { itemCopyPin } from '../src/sim/item_copy_ref';
import type { CharacterState } from '../src/sim/sim';
import type { InvSlot } from '../src/sim/types';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_woc_market_directed_verify';

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

describeDb('woc market directed rail against real Postgres', () => {
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
  // the one-open-settlement index stays the authority)
  // -------------------------------------------------------------------------

  const SAVE_STATE = { questLog: [], questsDone: [], inventory: [] } as unknown as CharacterState;

  async function seedAccount(): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`woc-directed-fixture-${seq}`],
    );
    return Number(res.rows[0].id);
  }

  async function seedCharacter(realm: string, accountId: number, name?: string): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO characters (account_id, name, class, realm, level, state)
       VALUES ($1, $2, 'warrior', $3, 10, '{}'::jsonb) RETURNING id`,
      [accountId, name ?? `DirectedChar${seq}`, realm],
    );
    return Number(res.rows[0].id);
  }

  async function linkWallet(accountId: number, pubkey: string): Promise<void> {
    await pool.query(
      `INSERT INTO wallet_links (account_id, pubkey) VALUES ($1, $2)
       ON CONFLICT (account_id) DO UPDATE SET pubkey = EXCLUDED.pubkey`,
      [accountId, pubkey],
    );
  }

  async function unlinkWallet(accountId: number): Promise<void> {
    await pool.query(`DELETE FROM wallet_links WHERE account_id = $1`, [accountId]);
  }

  async function seedListing(
    realm: string,
    sellerAccount: number,
    over: {
      status?: string;
      endsAtMs?: number;
      buyNowCents?: number | null;
      directedBuyerAccount?: number | null;
      sellerWallet?: string;
      /** A REAL characters row id, for the arms that resolve a recipient
       *  (the return flight's deliveryTarget). The synthetic default never
       *  resolves, which is what the park arms want. */
      sellerCharacter?: number;
    } = {},
  ): Promise<number> {
    seq++;
    const endsAtMs = over.endsAtMs ?? BASE_MS + 60 * MINUTE_MS;
    const res = await pool.query(
      `INSERT INTO woc_market_listings (
         realm, seller_account, seller_character, seller_name, seller_wallet,
         item, item_id, quality, format, start_cents, buy_now_cents,
         offer_next, status, ends_at, base_ends_at, directed_buyer_account
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'epic', 'buy_now', 500, $8,
         false, $9, to_timestamp($10 / 1000.0), to_timestamp($10 / 1000.0), $11
       ) RETURNING id`,
      [
        realm,
        sellerAccount,
        over.sellerCharacter ?? 9000 + seq,
        `Seller${seq}`,
        over.sellerWallet ?? `wallet-seller-${seq}`,
        JSON.stringify({ itemId: 'amber_crimson_armor_plate', count: 1 }),
        'amber_crimson_armor_plate',
        over.buyNowCents === undefined ? 1000 : over.buyNowCents,
        over.status ?? 'active',
        endsAtMs,
        over.directedBuyerAccount ?? null,
      ],
    );
    return Number(res.rows[0].id);
  }

  async function listingRow(id: number): Promise<{
    status: string;
    resolution: string | null;
    endsAtMs: number;
    itemDisposed: boolean;
    item: InvSlot;
  }> {
    const res = await pool.query(
      `SELECT status, resolution, item, item_disposed,
              (EXTRACT(EPOCH FROM ends_at) * 1000)::bigint AS ends_ms
         FROM woc_market_listings WHERE id = $1`,
      [id],
    );
    return {
      status: res.rows[0].status,
      resolution: res.rows[0].resolution ?? null,
      endsAtMs: Number(res.rows[0].ends_ms),
      itemDisposed: Boolean(res.rows[0].item_disposed),
      item: res.rows[0].item as InvSlot,
    };
  }

  async function strikeCount(account: number): Promise<number> {
    const res = await pool.query(`SELECT strikes FROM woc_market_strikes WHERE account_id = $1`, [
      account,
    ]);
    return res.rows[0] ? Number(res.rows[0].strikes) : 0;
  }

  /** One persistMailParcel call, flattened to what a test asserts on. */
  interface MailParcel {
    recipientKey: string;
    letter: 'delivery' | 'return' | 'sold_notice';
    itemIds: string[];
    custodyRef: string;
  }

  /**
   * A service whose custody fake really executes the escrow job: extractCopy
   * answers from the per-character copy map (matching on itemId ONLY: the
   * real extraction also validates expectInstance, but the pin check under
   * test runs on the RETURNED copy, so the narrower fake weakens nothing
   * here), runSerialized runs the job inline, and the lease is
   * skipped (leaseNonce undefined saves unfenced, matching the delivery
   * suite's unfenced arm).
   *
   * A test that stocks `bags` gets the whole bag array and extraction resolves
   * the NAMED index, which is what the duplicate-copy arm needs; `copies`
   * stays the one-copy-at-any-index shorthand every other test uses. A test
   * that passes `parcels` gets the mail rail's parcel book (the delivery
   * suite's ParcelCustody, narrowed to what the return flight needs).
   */
  function makeService(
    realm: string,
    opts: {
      wallets: Map<number, string | null>;
      copies?: Map<number, InvSlot>;
      bags?: Map<number, InvSlot[]>;
      parcels?: MailParcel[];
      nowMs?: () => number;
    },
  ): WocMarketService {
    const custody: WocMarketCustody = {
      runSerialized: async <T>(_characterId: number, job: () => Promise<T>) => await job(),
      ownsLiveCharacter: () => true,
      escrowSessionLost: () => {},
      extractCopy: (_account, characterId, ref): WocCustodyExtract => {
        const bag = opts.bags?.get(characterId);
        const copy = bag ? bag[ref.index] : opts.copies?.get(characterId);
        if (!copy || copy.itemId !== ref.itemId) return { ok: false, reason: 'stale_copy' };
        return {
          ok: true,
          pid: 100_000 + characterId,
          extracted: copy,
          characterName: `DirectedChar${characterId}`,
          save: { characterId, level: 10, state: SAVE_STATE, leaseNonce: undefined },
        };
      },
      grantCopy: () => {
        throw new Error('grant not exercised by this suite');
      },
      persistGrantSerialized: () => {
        throw new Error('grant persist not exercised by this suite');
      },
      snapshotCopy: () => {
        throw new Error('snapshot not exercised by this suite');
      },
      restoreCopy: () => {},
      persistMailParcel: async (recipient, letter, items, custodyRef) => {
        // The live post office dedupes on the ref; recording every CALL is
        // what lets a test say a second write was attempted at all.
        opts.parcels?.push({
          recipientKey: recipient.key,
          letter,
          itemIds: items.map((item) => item.itemId),
          custodyRef,
        });
      },
      hasParcel: (custodyRef) => (opts.parcels ?? []).some((p) => p.custodyRef === custodyRef),
    };
    return new marketMod.WocMarketService({
      db: marketDb,
      economy: proxyMod.createDevWocMarketEconomy(opts.nowMs ?? (() => BASE_MS)),
      custody,
      verifiedWallet: async (account) => opts.wallets.get(account) ?? null,
      balanceTokens: async () => 1_000_000,
      stepUpDevSig: true,
      config: {
        enabled: true,
        realm,
        policy: rulesMod.WOC_MARKET_RESTRICTED_POLICY,
        confirmingReviewMs: 6 * 3600 * 1000,
      },
      now: opts.nowMs ?? (() => BASE_MS),
    });
  }

  /** Drive one directed deal to the both-accepted escrow: buyer opens the
   *  offer naming the agreed copy, seller accepts naming theirs, buyer
   *  completes. Returns the final accept outcome. */
  async function acceptDirectedDeal(args: {
    realm: string;
    service: WocMarketService;
    buyer: number;
    buyerCharacter: number;
    sellerName: string;
    sellerCharacter: number;
    agreed: { itemId: string; instance?: InvSlot['instance']; craftedRecipeId?: string };
    acceptRef: { index: number; itemId: string; expectInstance?: InvSlot['instance'] | null };
    seller: number;
  }): Promise<
    | { ok: true; listing: { id: number; endsAtMs: number } | null }
    | { ok: false; reason: string }
    | { created: unknown }
  > {
    const created = await args.service.createDirectedOffer({
      account: args.buyer,
      characterId: args.buyerCharacter,
      sellerCharacterName: args.sellerName,
      usdCents: 1000,
      item: args.agreed,
      // The strike-parity gate: a directed buyer can be struck, so the offer
      // intake sits behind terms. Recorded once per account, so every later
      // offer from the same buyer passes on the stored acceptance.
      acceptTerms: true,
    } as Parameters<WocMarketService['createDirectedOffer']>[0]);
    if (!created.ok) return created as { ok: false; reason: string };
    const offerId = (created as { ok: true; offer: { id: number } }).offer.id;
    // The seller's custody-committing acceptance carries the offer-bound
    // step-up proof (B6/R1), minted devsig through the real issue path.
    const minted = await args.service.issueStepUpChallenge(args.seller, {
      operation: 'accept_directed_offer',
      offerId,
    });
    if (!minted.ok) return minted as { ok: false; reason: string };
    const sellerSide = await args.service.acceptDirectedOffer(
      args.seller,
      offerId,
      {
        index: args.acceptRef.index,
        itemId: args.acceptRef.itemId,
        ...(args.acceptRef.expectInstance == null
          ? {}
          : { expectInstance: args.acceptRef.expectInstance }),
      },
      args.sellerCharacter,
      { nonce: minted.challenge.nonce, signature: `devsig:${minted.challenge.nonce}` },
    );
    if (!sellerSide.ok) return sellerSide as { ok: false; reason: string };
    const buyerSide = await args.service.acceptDirectedOffer(
      args.buyer,
      offerId,
      null,
      args.buyerCharacter,
    );
    return buyerSide as
      | { ok: true; listing: { id: number; endsAtMs: number } | null }
      | { ok: false; reason: string };
  }

  // -------------------------------------------------------------------------
  // H14: same-wallet self-deal (the relink dance) refuses in the claim SQL
  // -------------------------------------------------------------------------

  describe('same-wallet self-deal guard', () => {
    it('refuses a buy-now claim from an account now holding the listing seller wallet', async () => {
      const realm = 'directed-wallet-twin';
      const seller = await seedAccount();
      const twin = await seedAccount();
      // The listing recorded the seller wallet at creation; the seller then
      // unlinked it and the twin account linked the SAME pubkey (pubkey is
      // UNIQUE, so the twin is sequential, never concurrent).
      const listingId = await seedListing(realm, seller, { sellerWallet: 'wallet-twin-shared' });
      await linkWallet(twin, 'wallet-twin-shared');
      const claimed = await marketDb.claimBuyNowLock(
        realm,
        listingId,
        twin,
        BASE_MS,
        BASE_MS + 270_000,
      );
      expect(claimed).toBe('own_listing');
      // Positive control: a genuinely different wallet claims fine.
      const stranger = await seedAccount();
      await linkWallet(stranger, 'wallet-twin-distinct');
      const ok = await marketDb.claimBuyNowLock(
        realm,
        listingId,
        stranger,
        BASE_MS,
        BASE_MS + 270_000,
      );
      // The claimed row itself, not merely "not a refusal string": a future
      // refusal returned as an object would pass the typeof check alone.
      expect(ok).toMatchObject({ id: listingId });
    });

    it('a claimer with NO wallet row never trips the twin guard', async () => {
      const realm = 'directed-wallet-null';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, { sellerWallet: 'wallet-null-seller' });
      // Degenerate arm: the LISTING wallet is never null by DDL, but the
      // claimer-side read can be. A buyer with NO wallet row must not trip
      // the twin guard (the route refuses wallet_required upstream; the SQL
      // guard must simply not fire).
      await unlinkWallet(buyer);
      const claimed = await marketDb.claimBuyNowLock(
        realm,
        listingId,
        buyer,
        BASE_MS,
        BASE_MS + 270_000,
      );
      expect(claimed).toMatchObject({ id: listingId });
    });
  });

  // -------------------------------------------------------------------------
  // H12: the directed hold is the settlement window, not the auction duration
  // -------------------------------------------------------------------------

  describe('directed hold and cap', () => {
    it('an accepted directed offer escrows for the settlement window, not 12 hours', async () => {
      const realm = 'directed-hold-window';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const sellerCharacter = await seedCharacter(realm, seller, `HoldSeller${seq}`);
      const sellerName = `HoldSeller${seq - 1}`;
      const buyerCharacter = await seedCharacter(realm, buyer);
      const copy: InvSlot = { itemId: 'amber_crimson_armor_plate', count: 1 };
      const service = makeService(realm, {
        wallets: new Map([
          [seller, 'wallet-hold-seller'],
          [buyer, 'wallet-hold-buyer'],
        ]),
        copies: new Map([[sellerCharacter, copy]]),
      });
      const out = await acceptDirectedDeal({
        realm,
        service,
        buyer,
        buyerCharacter,
        sellerName,
        sellerCharacter,
        seller,
        agreed: { itemId: 'amber_crimson_armor_plate' },
        acceptRef: { index: 0, itemId: 'amber_crimson_armor_plate' },
      });
      expect(out).toMatchObject({ ok: true });
      const listing = (out as { ok: true; listing: { id: number } }).listing;
      expect(listing).not.toBeNull();
      const row = await listingRow(listing.id);
      expect(row.endsAtMs - BASE_MS).toBe(rulesMod.WOC_MARKET_SETTLEMENT_WINDOW_SECONDS * 1000);
    });

    it('a directed acceptance refuses cap_reached when the seller already holds 12 live listings', async () => {
      const realm = 'directed-cap-blocks';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const sellerCharacter = await seedCharacter(realm, seller, `CapSeller${seq}`);
      const sellerName = `CapSeller${seq - 1}`;
      const buyerCharacter = await seedCharacter(realm, buyer);
      for (let i = 0; i < rulesMod.WOC_MARKET_MAX_ACTIVE_LISTINGS; i++) {
        await seedListing(realm, seller);
      }
      const copy: InvSlot = { itemId: 'amber_crimson_armor_plate', count: 1 };
      const service = makeService(realm, {
        wallets: new Map([
          [seller, 'wallet-cap-seller'],
          [buyer, 'wallet-cap-buyer'],
        ]),
        copies: new Map([[sellerCharacter, copy]]),
      });
      const out = await acceptDirectedDeal({
        realm,
        service,
        buyer,
        buyerCharacter,
        sellerName,
        sellerCharacter,
        seller,
        agreed: { itemId: 'amber_crimson_armor_plate' },
        acceptRef: { index: 0, itemId: 'amber_crimson_armor_plate' },
      });
      expect(out).toMatchObject({ ok: false, reason: 'cap_reached' });
    });

    it('directed listings count toward the cap in the authoritative in-transaction check', async () => {
      const realm = 'directed-cap-counts';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      for (let i = 0; i < rulesMod.WOC_MARKET_MAX_ACTIVE_LISTINGS; i++) {
        await seedListing(realm, seller, { directedBuyerAccount: buyer });
      }
      const out = await marketDb.escrowInsertListing(
        {
          characterId: await seedCharacter(realm, seller),
          level: 10,
          state: SAVE_STATE,
          leaseNonce: undefined,
        },
        {
          realm,
          sellerAccount: seller,
          sellerCharacter: 1,
          sellerName: 'CapCounter',
          sellerWallet: 'wallet-cap-counter',
          item: { itemId: 'amber_crimson_armor_plate', count: 1 },
          itemId: 'amber_crimson_armor_plate',
          quality: 'epic',
          category: null,
          subcategory: null,
          params: {
            format: 'buy_now',
            startCents: 1000,
            reserveCents: null,
            buyNowCents: 1000,
            offerNext: false,
            durationHours: 12,
            directedBuyerAccount: null,
          },
          endsAtMs: BASE_MS + 60 * MINUTE_MS,
          directedOfferId: null,
        } as Parameters<PgWocMarketDb['escrowInsertListing']>[1],
      );
      expect(out).toMatchObject({ ok: false, reason: 'cap_reached' });
    });
  });

  // -------------------------------------------------------------------------
  // H12: non-payment consequences (strike + auto-close + return)
  // -------------------------------------------------------------------------

  describe('directed non-payment', () => {
    it('a directed settlement that expires unpaid strikes the buyer AND auto-closes the listing', async () => {
      const realm = 'directed-autoclose';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const buyerCharacter = await seedCharacter(realm, buyer);
      const listingId = await seedListing(realm, seller, { directedBuyerAccount: buyer });
      const inserted = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 0,
        buyerAccount: buyer,
        buyerCharacter,
        buyerName: 'DirectedBuyer',
        buyerWallet: 'wallet-autoclose-buyer',
        amountCents: 1000,
        deadlineAtMs: BASE_MS - MINUTE_MS,
        nowMs: BASE_MS - 11 * MINUTE_MS,
      });
      expect(typeof inserted).toBe('object');
      const service = makeService(realm, { wallets: new Map() });
      await service.sweepPass();
      expect(await strikeCount(buyer)).toBe(1);
      const row = await listingRow(listingId);
      expect(row.status).toBe('closed');
      expect(row.resolution).toBe('unsettled');
    });

    it('a directed listing whose buyer never claims closes struck at hold expiry, exactly once', async () => {
      const realm = 'directed-neverclaim';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, {
        directedBuyerAccount: buyer,
        endsAtMs: BASE_MS - MINUTE_MS,
      });
      const service = makeService(realm, { wallets: new Map() });
      await service.sweepPass();
      expect(await strikeCount(buyer)).toBe(1);
      const row = await listingRow(listingId);
      expect(row.status).toBe('closed');
      // A second pass over durable state must not strike again.
      await service.sweepPass();
      expect(await strikeCount(buyer)).toBe(1);
    });

    it('a directed listing with a FAILED settlement reaching hold expiry produces exactly one strike', async () => {
      const realm = 'directed-onestrike';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const buyerCharacter = await seedCharacter(realm, buyer);
      const listingId = await seedListing(realm, seller, {
        directedBuyerAccount: buyer,
        endsAtMs: BASE_MS - MINUTE_MS,
      });
      const inserted = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 0,
        buyerAccount: buyer,
        buyerCharacter,
        buyerName: 'DirectedBuyer',
        buyerWallet: 'wallet-onestrike-buyer',
        amountCents: 1000,
        deadlineAtMs: BASE_MS - MINUTE_MS,
        nowMs: BASE_MS - 11 * MINUTE_MS,
      });
      expect(typeof inserted).toBe('object');
      await pool.query(
        `UPDATE woc_market_settlements SET state = 'failed', fail_reason = 'confirm_failed' WHERE id = $1`,
        [(inserted as { id: number }).id],
      );
      const service = makeService(realm, { wallets: new Map() });
      await service.sweepPass();
      await service.sweepPass();
      expect(await strikeCount(buyer)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // H12: the other half of the auto-close, the return flight home
  // -------------------------------------------------------------------------

  describe('directed return flight', () => {
    it('mails the escrowed copy home and disposes the listing in the auto-closing pass', async () => {
      const realm = 'directed-return-home';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      // A REAL characters row: the return flight resolves its recipient through
      // deliveryTarget, and a synthetic seller_character resolves to nobody
      // (which is the park arm, not this one).
      const sellerCharacter = await seedCharacter(realm, seller, `ReturnSeller${seq}`);
      const listingId = await seedListing(realm, seller, {
        directedBuyerAccount: buyer,
        endsAtMs: BASE_MS - MINUTE_MS,
        sellerCharacter,
      });
      const parcels: MailParcel[] = [];
      const service = makeService(realm, { wallets: new Map(), parcels });
      // ONE pass does both halves: the closed arm auto-closes the never-claimed
      // hold 'unsettled', and the returned arm (later in the same pass) flies
      // the copy home, so a seller never has to cancel to get their item back.
      await service.sweepPass();
      const row = await listingRow(listingId);
      expect(row.status).toBe('closed');
      expect(row.resolution).toBe('unsettled');
      expect(row.itemDisposed, 'the flag that retires the row from the backlog').toBe(true);
      const custodyRef = rulesMod.listingReturnCustodyRef(listingId);
      expect(parcels).toEqual([
        {
          recipientKey: String(sellerCharacter),
          letter: 'return',
          itemIds: ['amber_crimson_armor_plate'],
          custodyRef,
        },
      ]);
      // The durable half, which is what makes the flight exactly-once: the
      // claim carries the mail-rail attribution AND the one-way booked flip.
      const claim = await pool.query(
        `SELECT booked_at IS NOT NULL AS booked, mail_intent_at IS NOT NULL AS mail_intent,
                grant_character_id
           FROM woc_market_custody_claims WHERE custody_ref = $1`,
        [custodyRef],
      );
      expect(claim.rows[0]).toMatchObject({ booked: true, mail_intent: true });
      expect(claim.rows[0].grant_character_id, 'the mail rail, never the grant rail').toBeNull();
      // A second pass over the same durable state must not mint a second copy.
      await service.sweepPass();
      expect(parcels, 'the disposed listing left the backlog').toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Judgment (a): the atomic stamp and the accepted-offer converge arm
  // -------------------------------------------------------------------------

  async function seedOffer(
    realm: string,
    sellerAccount: number,
    buyerAccount: number,
    over: {
      status?: string;
      listingId?: number | null;
      expiresAtMs?: number;
      updatedAtMs?: number;
      buyerAccepted?: boolean;
      sellerAccepted?: boolean;
    } = {},
  ): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO woc_market_directed_offers (
         realm, seller_account, seller_character, seller_name, buyer_account,
         buyer_name, usd_cents, status, listing_id, expires_at, updated_at,
         buyer_accepted, seller_accepted, item_id, item_pin
       ) VALUES ($1, $2, $3, $4, $5, $6, 1000, $7, $8,
                 to_timestamp($9 / 1000.0), to_timestamp($10 / 1000.0), $11, $12,
                 'amber_crimson_armor_plate', 'pin')
       RETURNING id`,
      [
        realm,
        sellerAccount,
        9000 + seq,
        `OfferSeller${seq}`,
        buyerAccount,
        `OfferBuyer${seq}`,
        over.status ?? 'pending',
        over.listingId ?? null,
        over.expiresAtMs ?? BASE_MS + 10 * MINUTE_MS,
        over.updatedAtMs ?? BASE_MS - 10 * MINUTE_MS,
        over.buyerAccepted ?? false,
        over.sellerAccepted ?? false,
      ],
    );
    return Number(res.rows[0].id);
  }

  async function offerRow(id: number): Promise<{ status: string; listingId: number | null }> {
    const res = await pool.query(
      `SELECT status, listing_id FROM woc_market_directed_offers WHERE id = $1`,
      [id],
    );
    return {
      status: res.rows[0].status,
      listingId: res.rows[0].listing_id === null ? null : Number(res.rows[0].listing_id),
    };
  }

  async function offerAcceptState(
    id: number,
  ): Promise<{ buyerAccepted: boolean; sellerAccepted: boolean; itemRefNull: boolean }> {
    const res = await pool.query(
      `SELECT buyer_accepted, seller_accepted, item_ref FROM woc_market_directed_offers WHERE id = $1`,
      [id],
    );
    return {
      buyerAccepted: res.rows[0].buyer_accepted === true,
      sellerAccepted: res.rows[0].seller_accepted === true,
      itemRefNull: res.rows[0].item_ref === null,
    };
  }

  describe('the accepted-offer converge arm, in real SQL', () => {
    it('reopens an aged unstamped acceptance, expires a lapsed one, and skips a stamped one', async () => {
      const realm = 'directed-converge';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, { directedBuyerAccount: buyer });
      const reopenable = await seedOffer(realm, seller, buyer, {
        status: 'accepted',
        buyerAccepted: true,
        sellerAccepted: true,
      });
      // Give it a non-null item_ref (the seller's named copy) so the reopen's
      // clear-to-NULL is observable rather than vacuously already-null.
      await pool.query(
        `UPDATE woc_market_directed_offers SET item_ref = '{"index":0,"itemId":"amber_crimson_armor_plate"}'::jsonb WHERE id = $1`,
        [reopenable],
      );
      const lapsed = await seedOffer(realm, seller, buyer, {
        status: 'accepted',
        expiresAtMs: BASE_MS - MINUTE_MS,
        buyerAccepted: true,
        sellerAccepted: true,
      });
      const stamped = await seedOffer(realm, seller, buyer, {
        status: 'accepted',
        listingId,
        buyerAccepted: true,
        sellerAccepted: true,
      });
      const service = makeService(realm, { wallets: new Map() });
      const stats = await service.sweepPass();
      expect(stats?.convergedOffers).toBe(2);
      expect(await offerRow(reopenable)).toEqual({ status: 'pending', listingId: null });
      expect(await offerRow(lapsed)).toEqual({ status: 'expired', listingId: null });
      expect(await offerRow(stamped)).toEqual({ status: 'accepted', listingId });
      // The REAL reopen UPDATE resets the seller accept and clears the named
      // item so a spent step-up proof cannot re-drive custody, while keeping
      // the buyer's standing consent (B6/R1). This is the production SQL the
      // FakeWocMarketDb mirror stands in for elsewhere.
      expect(await offerAcceptState(reopenable)).toEqual({
        buyerAccepted: true,
        sellerAccepted: false,
        itemRefNull: true,
      });
    });

    it('keeps a YOUNG unstamped acceptance out of the batch (the in-flight guard)', async () => {
      const realm = 'directed-converge-young';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const young = await seedOffer(realm, seller, buyer, {
        status: 'accepted',
        updatedAtMs: BASE_MS - 60_000,
        buyerAccepted: true,
        sellerAccepted: true,
      });
      const service = makeService(realm, { wallets: new Map() });
      const stats = await service.sweepPass();
      expect(stats?.convergedOffers).toBe(0);
      expect((await offerRow(young)).status).toBe('accepted');
    });

    it('leaves a row OLDER than the max age alone (the prune-fallout guard)', async () => {
      // Past the upper window bound the accepted-unstamped shape stops being
      // rollback evidence (the listings prune's ON DELETE SET NULL produces
      // it for completed deals); the arm must not touch it.
      const realm = 'directed-converge-ancient';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const ancient = await seedOffer(realm, seller, buyer, {
        status: 'accepted',
        updatedAtMs: BASE_MS - 25 * 3600 * 1000,
        expiresAtMs: BASE_MS - 24 * 3600 * 1000,
        buyerAccepted: true,
        sellerAccepted: true,
      });
      const service = makeService(realm, { wallets: new Map() });
      const stats = await service.sweepPass();
      expect(stats?.convergedOffers).toBe(0);
      expect((await offerRow(ancient)).status).toBe('accepted');
    });

    it('never relabels a COMPLETED deal whose listing the retention prune deleted', async () => {
      // The end-to-end F3 regression: a stamped offer survives its pruned
      // listing with listing_id SET-NULLed by the FK, and the converge arm
      // must leave its status and updated_at untouched.
      const realm = 'directed-converge-pruned';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, {
        directedBuyerAccount: buyer,
        status: 'closed',
      });
      await pool.query(
        `UPDATE woc_market_listings SET item_disposed = true, resolution = 'sold' WHERE id = $1`,
        [listingId],
      );
      const done = await seedOffer(realm, seller, buyer, {
        status: 'accepted',
        listingId,
        // A completed deal from months ago: outside the converge window.
        updatedAtMs: BASE_MS - 30 * 24 * 3600 * 1000,
        expiresAtMs: BASE_MS - 30 * 24 * 3600 * 1000,
        buyerAccepted: true,
        sellerAccepted: true,
      });
      // The prune's FK effect, applied directly (the prune itself keys on the
      // real wall clock while this suite's fixtures ride BASE_MS).
      await pool.query(`DELETE FROM woc_market_listings WHERE id = $1`, [listingId]);
      expect((await offerRow(done)).listingId, 'the FK SET-NULLed the stamp').toBeNull();
      const before = await pool.query(
        `SELECT updated_at FROM woc_market_directed_offers WHERE id = $1`,
        [done],
      );
      const service = makeService(realm, { wallets: new Map() });
      const stats = await service.sweepPass();
      expect(stats?.convergedOffers).toBe(0);
      expect((await offerRow(done)).status).toBe('accepted');
      const after = await pool.query(
        `SELECT updated_at FROM woc_market_directed_offers WHERE id = $1`,
        [done],
      );
      expect(after.rows[0].updated_at).toEqual(before.rows[0].updated_at);
    });

    it('bounds a pair to ONE pending offer at the database (the unique index)', async () => {
      const realm = 'directed-pair-bound';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const first = await marketDb.insertDirectedOffer({
        realm,
        sellerAccount: seller,
        sellerCharacter: 1,
        sellerName: 'PairSeller',
        buyerAccount: buyer,
        buyerName: 'PairBuyer',
        usdCents: 1000,
        expiresAtMs: BASE_MS + 10 * MINUTE_MS,
        itemId: 'amber_crimson_armor_plate',
        itemPin: 'p'.repeat(64),
      });
      expect(typeof first).toBe('object');
      const second = await marketDb.insertDirectedOffer({
        realm,
        sellerAccount: seller,
        sellerCharacter: 1,
        sellerName: 'PairSeller',
        buyerAccount: buyer,
        buyerName: 'PairBuyer',
        usdCents: 2000,
        expiresAtMs: BASE_MS + 10 * MINUTE_MS,
        itemId: 'amber_crimson_armor_plate',
        itemPin: 'p'.repeat(64),
      });
      expect(second, 'the unique index answers typed').toBe('offer_pending');
    });

    it('a reopen NO-OPS while a fresh pending offer occupies the pair, then lands once it frees', async () => {
      // The conditional UPDATE's own behavior in real SQL (the service-level
      // arc is proven against the fake; this is what keeps the fake honest):
      // a blocked reopen touches nothing and reports so, a freed pair
      // reopens, and the CAS refuses the now-pending row on a re-call.
      const realm = 'directed-reopen-pair';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const stuck = await seedOffer(realm, seller, buyer, {
        status: 'accepted',
        buyerAccepted: true,
        sellerAccepted: true,
      });
      const fresh = await seedOffer(realm, seller, buyer, { status: 'pending' });
      expect(await marketDb.reopenDirectedOffer(realm, stuck), 'the occupied pair blocks').toBe(
        false,
      );
      expect((await offerRow(stuck)).status).toBe('accepted');
      await pool.query(`UPDATE woc_market_directed_offers SET status = 'expired' WHERE id = $1`, [
        fresh,
      ]);
      expect(await marketDb.reopenDirectedOffer(realm, stuck), 'the freed pair reopens').toBe(true);
      expect((await offerRow(stuck)).status).toBe('pending');
      expect(await marketDb.reopenDirectedOffer(realm, stuck), 'the CAS refuses pending').toBe(
        false,
      );
    });

    it('the 23505 race belt swallows a concurrent pair insert by CONSTRAINT name', async () => {
      // The NOT EXISTS subquery reads its snapshot before the index write, so
      // a pair offer committing in between raises 23505 from the partial
      // unique index; the belt keys on err.constraint carrying the index
      // name. Staged deterministically: the racer's INSERT sits uncommitted
      // (invisible to the subquery), the reopen proceeds to the index write
      // and blocks on the racer's transaction, and the COMMIT turns the
      // block into 23505. A renamed index or a driver that stopped naming
      // the constraint would rethrow here and fail this test.
      const realm = 'directed-reopen-race';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const stuck = await seedOffer(realm, seller, buyer, {
        status: 'accepted',
        buyerAccepted: true,
        sellerAccepted: true,
      });
      const racer = await pool.connect();
      try {
        await racer.query('BEGIN');
        await racer.query(
          `INSERT INTO woc_market_directed_offers (
             realm, seller_account, seller_character, seller_name, buyer_account,
             buyer_name, usd_cents, status, listing_id, expires_at, updated_at,
             buyer_accepted, seller_accepted, item_id, item_pin
           ) VALUES ($1, $2, 9500, 'RaceSeller', $3, 'RaceBuyer', 1000, 'pending', NULL,
                     to_timestamp($4 / 1000.0), now(), false, false,
                     'amber_crimson_armor_plate', 'pin')`,
          [realm, seller, buyer, BASE_MS + 10 * MINUTE_MS],
        );
        // Settle-capture at creation: round 3's foreign-constraint rethrow
        // (or a lock timeout) rejecting inside the wait window must fail the
        // assertion below, never crash the process as an unhandled
        // rejection.
        const reopen = marketDb
          .reopenDirectedOffer(realm, stuck)
          .then((flipped) => ({ flipped }))
          .catch((err: unknown) => ({ err }));
        // Commit only after the reopen backend is OBSERVED blocked on the
        // racer's transaction, so the 23505 path (not the visible-row
        // guard) is deterministically under test. The poll runs on the
        // POOL, not the racer's connection: a transaction freezes its
        // pg_stat_activity snapshot at first read, so the racer could never
        // see a wait that began after it. Scoped to this database and to
        // OTHER backends so a busy sibling suite on the cluster cannot
        // satisfy it.
        let observedWaitAt = -1;
        for (let i = 0; i < 200; i++) {
          const waiting = await pool.query(
            `SELECT 1 FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid()
                AND wait_event_type = 'Lock'
                AND query LIKE '%woc_market_directed_offers o%'`,
          );
          if (waiting.rows.length > 0) {
            observedWaitAt = i;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(
          observedWaitAt,
          'the reopen was observed blocked on the racer',
        ).toBeGreaterThanOrEqual(0);
        await racer.query('COMMIT');
        expect(await reopen, 'swallowed as the pair-occupied no-op').toEqual({ flipped: false });
      } finally {
        racer.release();
      }
      expect((await offerRow(stuck)).status).toBe('accepted');
    });
  });

  describe('the pair-pending boot repair, in real SQL', () => {
    it('expires all but the newest pending offer per pair, then rebuilds a valid index', async () => {
      // The repair exists for developer and staging databases that ran BEFORE
      // the pair bound: their duplicate pending rows would fail the unique
      // index build and take the whole boot with it. A fresh database creates
      // the index immediately, so the only way to reach the repair is to stage
      // the pre-bound shape: drop the index (which re-arms the repair's own
      // validity gate), seed the duplicates, and boot again.
      const realm = 'directed-pair-repair';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const marketDbMod = await import('../server/woc_market_db');
      const indexName = marketDbMod.WOC_MARKET_OFFERS_PAIR_PENDING_INDEX;
      await pool.query(`DROP INDEX ${indexName}`);
      const gone = await pool.query(`SELECT to_regclass($1) AS reg`, [indexName]);
      expect(
        gone.rows[0].reg,
        'the repair gate is armed only while the index is missing',
      ).toBeNull();
      // The SAME pair in a sibling realm, seeded first so its id is the lowest
      // of all: the repair's duplicate probe is realm-joined, so this row must
      // survive untouched (a realm-blind probe would read the newer rows in
      // the other realm as its duplicates and expire it).
      const siblingRealm = await seedOffer(`${realm}-sibling`, seller, buyer, {
        updatedAtMs: BASE_MS - 40 * MINUTE_MS,
      });
      // Ascending stamps in insert order, the shape a real pre-bound database
      // has. The repair's tiebreak is the row ID (id > o.id), not the stamp,
      // so the survivor below is asserted as the last row inserted.
      const oldest = await seedOffer(realm, seller, buyer, {
        updatedAtMs: BASE_MS - 30 * MINUTE_MS,
      });
      const middle = await seedOffer(realm, seller, buyer, {
        updatedAtMs: BASE_MS - 20 * MINUTE_MS,
      });
      const newest = await seedOffer(realm, seller, buyer, {
        updatedAtMs: BASE_MS - 10 * MINUTE_MS,
      });
      expect(newest, 'the survivor is the highest id of the pair').toBeGreaterThan(middle);

      // The REAL boot path, which is where the repair lives.
      await db.ensureSchema();

      expect((await offerRow(oldest)).status).toBe('expired');
      expect((await offerRow(middle)).status).toBe('expired');
      expect((await offerRow(newest)).status).toBe('pending');
      expect((await offerRow(siblingRealm)).status, 'the other realm is not a duplicate').toBe(
        'pending',
      );
      const rebuilt = await pool.query(
        `SELECT i.indisvalid FROM pg_index i WHERE i.indexrelid = to_regclass($1)`,
        [indexName],
      );
      expect(rebuilt.rows[0]?.indisvalid, 'the bound is enforcing again').toBe(true);
      // The bound really binds after the repair: a fourth pending row for the
      // same pair is refused by the index, not merely absent.
      const blocked = await marketDb.insertDirectedOffer({
        realm,
        sellerAccount: seller,
        sellerCharacter: 1,
        sellerName: 'RepairSeller',
        buyerAccount: buyer,
        buyerName: 'RepairBuyer',
        usdCents: 1000,
        expiresAtMs: BASE_MS + 10 * MINUTE_MS,
        itemId: 'amber_crimson_armor_plate',
        itemPin: 'r'.repeat(64),
      });
      expect(blocked).toBe('offer_pending');
    }, 60_000);
  });

  describe('the escrow stamp CAS and cap, in real SQL', () => {
    function directEscrowListing(
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
        sellerName: `StampSeller${seq}`,
        sellerWallet: `wallet-stamp-${seq}`,
        item: { itemId: 'amber_crimson_armor_plate', count: 1 },
        itemId: 'amber_crimson_armor_plate',
        quality: 'epic' as const,
        category: null,
        subcategory: null,
        params: {
          format: 'buy_now' as const,
          directedBuyerAccount: null,
          startCents: 1000,
          reserveCents: null,
          buyNowCents: 1000,
          durationHours: 12,
          offerNext: false,
        },
        endsAtMs: BASE_MS + 12 * 60 * MINUTE_MS,
        directedOfferId,
      };
    }

    it('refuses a non-accepted or already-stamped offer and rolls the whole escrow back', async () => {
      const realm = 'escrow-stamp-cas';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const characterId = await seedCharacter(realm, seller);
      const pendingOffer = await seedOffer(realm, seller, buyer);
      const priorListing = await seedListing(realm, seller);
      const stampedOffer = await seedOffer(realm, seller, buyer, {
        status: 'accepted',
        listingId: priorListing,
      });
      const before = await marketDb.countActiveBySeller(realm, seller);

      const onPending = await marketDb.escrowInsertListing(
        { characterId, level: 10, state: SAVE_STATE, leaseNonce: undefined },
        directEscrowListing(realm, seller, characterId, pendingOffer),
      );
      expect(onPending).toEqual({ ok: false, reason: 'not_pending' });
      expect((await offerRow(pendingOffer)).status, 'the pending offer never adopts').toBe(
        'pending',
      );

      const onStamped = await marketDb.escrowInsertListing(
        { characterId, level: 10, state: SAVE_STATE, leaseNonce: undefined },
        directEscrowListing(realm, seller, characterId, stampedOffer),
      );
      expect(onStamped).toEqual({ ok: false, reason: 'not_pending' });
      const stamped = await pool.query(
        `SELECT listing_id FROM woc_market_directed_offers WHERE id = $1`,
        [stampedOffer],
      );
      expect(Number(stamped.rows[0].listing_id), 'one deal never re-stamps').toBe(priorListing);
      expect(
        await marketDb.countActiveBySeller(realm, seller),
        'both refused escrows rolled their listing insert back',
      ).toBe(before);
    });

    it('the authoritative cap count ignores closed listings', async () => {
      const realm = 'escrow-cap-closed';
      const seller = await seedAccount();
      const characterId = await seedCharacter(realm, seller);
      for (let i = 0; i < rulesMod.WOC_MARKET_MAX_ACTIVE_LISTINGS; i++) {
        await seedListing(realm, seller, { status: 'closed' });
      }
      const out = await marketDb.escrowInsertListing(
        { characterId, level: 10, state: SAVE_STATE, leaseNonce: undefined },
        directEscrowListing(realm, seller, characterId, null),
      );
      expect(out.ok, 'closed listings hold no escrow and count for nothing').toBe(true);
    });
  });

  describe('reopen refuses resolved and stamped offers, in real SQL', () => {
    it('a declined offer stays declined and a stamped acceptance stays stamped', async () => {
      const realm = 'reopen-guards';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const declined = await seedOffer(realm, seller, buyer, { status: 'declined' });
      expect(await marketDb.reopenDirectedOffer(realm, declined)).toBe(false);
      expect((await offerRow(declined)).status, 'a dead deal never resurrects').toBe('declined');

      const listing = await seedListing(realm, seller);
      const stamped = await seedOffer(realm, seller, buyer, {
        status: 'accepted',
        listingId: listing,
        sellerAccepted: true,
      });
      expect(await marketDb.reopenDirectedOffer(realm, stamped)).toBe(false);
      expect(
        await marketDb.expireDirectedOfferIfUnstamped(realm, stamped),
        'a consummated deal never expires as rollback residue',
      ).toBe(false);
      const row = await pool.query(
        `SELECT status, listing_id, seller_accepted FROM woc_market_directed_offers WHERE id = $1`,
        [stamped],
      );
      expect(row.rows[0].status, 'a consummated deal never reopens').toBe('accepted');
      expect(Number(row.rows[0].listing_id)).toBe(listing);
      expect(row.rows[0].seller_accepted).toBe(true);
    });
  });

  describe('the resolve and accept-side pending CAS, in real SQL', () => {
    it('a resolved offer gains no acceptance and never re-resolves', async () => {
      // The 'pending' predicate on BOTH writes is the compare-and-set: two
      // concurrent accepts both read pending, only one UPDATE matches. Its
      // observable single-row face: a dead offer is inert to both methods.
      const realm = 'offer-cas-status';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const declined = await seedOffer(realm, seller, buyer, { status: 'declined' });
      expect(await marketDb.resolveDirectedOffer(realm, declined, 'withdrawn')).toBeNull();
      expect((await offerRow(declined)).status, 'a verdict never relabels').toBe('declined');
      expect(await marketDb.acceptDirectedOfferSide(realm, declined, 'buyer', null)).toBeNull();
      expect(
        await offerAcceptState(declined),
        'a dead deal accumulates neither acceptance nor a ref',
      ).toMatchObject({ buyerAccepted: false });

      const live = await seedOffer(realm, seller, buyer);
      expect(
        (await marketDb.acceptDirectedOfferSide(realm, live, 'buyer', null))?.buyerAccepted,
      ).toBe(true);
      expect((await marketDb.resolveDirectedOffer(realm, live, 'declined'))?.status).toBe(
        'declined',
      );
    });
  });

  describe('the ever-settled strike gate read, in real SQL', () => {
    it('answers true only for the listing that ever opened a settlement', async () => {
      // The directed close arm's double-strike guard: 'failed' is not an OPEN
      // state, so this read is deliberately state-blind, and the listing_id
      // qual is what keeps one listing's history from vouching for another.
      const realm = 'ever-settled';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const settled = await seedListing(realm, seller);
      const sibling = await seedListing(realm, seller);
      await pool.query(
        `INSERT INTO woc_market_settlements (
           listing_id, realm, attempt, buyer_account, buyer_character,
           buyer_name, buyer_wallet, amount_cents, state, deadline_at
         ) VALUES ($1, $2, 1, $3, $3, 'Buyer', 'wallet-buyer', 1000, 'failed',
                   to_timestamp($4 / 1000.0))`,
        [settled, realm, buyer, BASE_MS + 10 * MINUTE_MS],
      );
      expect(await marketDb.everSettledForListing(settled)).toBe(true);
      expect(
        await marketDb.everSettledForListing(sibling),
        'a sibling listing has no history to answer with',
      ).toBe(false);
    });
  });

  describe('the offer-expiry sweep against a concurrent stamp, in real SQL', () => {
    it('SKIP LOCKED walks past a row a concurrent transaction holds', async () => {
      // The OUTER status qual (the EvalPlanQual guard beside the escrow
      // stamp) is deliberately NOT exercised here: the subselect's own
      // locked re-check shares the predicate, so only a genuine snapshot
      // race can reach it, and no test rig can schedule one. Its presence
      // is pinned structurally in woc_market_directed_sql.test.ts.
      const realm = 'directed-expiry-race';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const buyerTwo = await seedAccount();
      // Both rows are pending and past their TTL (distinct buyers: the
      // pair-pending unique index allows one live deal per pair): one gets
      // locked by a concurrent transaction (the escrow stamp holding the
      // row), the other is free. The sweep must expire ONLY the free one,
      // without blocking.
      const held = await seedOffer(realm, seller, buyer, {
        expiresAtMs: BASE_MS - MINUTE_MS,
      });
      const free = await seedOffer(realm, seller, buyerTwo, {
        expiresAtMs: BASE_MS - MINUTE_MS,
      });
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT 1 FROM woc_market_directed_offers WHERE id = $1 FOR UPDATE`, [
          held,
        ]);
        const expired = await marketDb.expireDueDirectedOffers(realm, BASE_MS, 25);
        expect(expired).toBe(1);
        expect((await offerRow(free)).status).toBe('expired');
        expect((await offerRow(held)).status).toBe('pending');
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }
    });
  });

  describe('concurrent escrow and offer writers, interleave smoke', () => {
    // Honesty note: three of the four concurrent participants are
    // single-statement autocommit writes that cannot hold one lock while
    // waiting on another, so this CANNOT deadlock by construction; the
    // lock-order safety argument is static (no transaction takes
    // offers-then-listings since the post-hoc stamp hop was deleted). What
    // this run does prove live: the stamp CAS, the racing expiry, and the
    // sibling writers compose without errors or lost writes.
    it('the stamp, the expiry, and the sibling offer writers compose cleanly under concurrency', async () => {
      const realm = 'directed-deadlock';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const characterId = await seedCharacter(realm, seller);
      for (let i = 0; i < 5; i++) {
        const offerId = await seedOffer(realm, seller, buyer, {
          status: 'accepted',
          buyerAccepted: true,
          sellerAccepted: true,
        });
        // A FRESH buyer each round: the pair-pending unique index binds one
        // live deal per pair, and whether the racing expiry below resolves
        // the sibling before the next round is exactly the nondeterminism
        // this smoke run exists to exercise.
        const sibling = await seedOffer(realm, seller, await seedAccount(), {});
        const results = await Promise.allSettled([
          marketDb.escrowInsertListing(
            { characterId, level: 10, state: SAVE_STATE, leaseNonce: undefined },
            {
              realm,
              sellerAccount: seller,
              sellerCharacter: characterId,
              sellerName: `Deadlock${i}`,
              sellerWallet: `wallet-deadlock-${i}`,
              item: { itemId: 'amber_crimson_armor_plate', count: 1 },
              itemId: 'amber_crimson_armor_plate',
              quality: 'epic',
              category: null,
              subcategory: null,
              params: {
                format: 'buy_now',
                startCents: 1000,
                reserveCents: null,
                buyNowCents: 1000,
                offerNext: false,
                durationHours: 12,
                directedBuyerAccount: buyer,
              },
              endsAtMs: BASE_MS + 10 * MINUTE_MS,
              directedOfferId: offerId,
            },
          ),
          marketDb.expireDueDirectedOffers(realm, BASE_MS + 20 * MINUTE_MS, 25),
          marketDb.acceptDirectedOfferSide(realm, sibling, 'buyer', null),
          marketDb.reopenDirectedOffer(realm, sibling),
        ]);
        for (const r of results) {
          if (r.status === 'rejected') {
            expect((r.reason as { code?: string }).code, String(r.reason)).not.toBe('40P01');
            throw r.reason;
          }
        }
        // The escrow either landed with its stamp or refused typed; a
        // deadlock would have surfaced as a rejection above.
        const escrow = results[0] as PromiseFulfilledResult<
          Awaited<ReturnType<PgWocMarketDb['escrowInsertListing']>>
        >;
        if (escrow.value.ok) {
          expect((await offerRow(offerId)).listingId).toBe(escrow.value.id);
          // Free the cap slot for the next iteration.
          await pool.query(
            `UPDATE woc_market_listings SET status = 'closed', resolution = 'cancelled' WHERE id = $1`,
            [escrow.value.id],
          );
        }
      }
    });
  });

  describe('resolved-offer retention, in real SQL', () => {
    it('prunes resolved rows past the window, keeps pending rows forever', async () => {
      const realm = 'directed-prune';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      // The retention cutoff is the DATABASE clock (now() minus the window),
      // unlike every other fixture stamp in this suite, so these rows date
      // relative to the real wall clock on purpose.
      const realNowMs = Date.now();
      const old = realNowMs - 200 * 24 * 3600 * 1000;
      const resolvedOld = await seedOffer(realm, seller, buyer, {
        status: 'declined',
        updatedAtMs: old,
      });
      const pendingOld = await seedOffer(realm, seller, buyer, { updatedAtMs: old });
      const resolvedFresh = await seedOffer(realm, seller, buyer, {
        status: 'expired',
        updatedAtMs: realNowMs - MINUTE_MS,
      });
      const marketDbMod = await import('../server/woc_market_db');
      // The count below is EXACT by construction, and this is the premise that
      // makes it so: every other fixture row in this disposable database is
      // stamped from BASE_MS, which sits over a year AHEAD of the real clock,
      // so nothing but resolvedOld can fall behind the retention cutoff.
      // Asserted rather than assumed, so a future fixture that seeds a real
      // aged row fails here with the reason instead of drifting the count.
      const reachable = await pool.query(
        `SELECT count(*)::int AS n FROM woc_market_directed_offers
          WHERE status <> 'pending' AND updated_at < now() - interval '180 days'`,
      );
      expect(reachable.rows[0].n, 'only this test seeds a row inside the window').toBe(1);
      // The retention clock is now(); the seeded rows are dated far behind it.
      const pruned = await marketDbMod.pruneResolvedWocOffersBatch(pool, 180, 100);
      expect(pruned).toBe(1);
      const remaining = await pool.query(
        `SELECT id FROM woc_market_directed_offers WHERE realm = $1 ORDER BY id`,
        [realm],
      );
      const ids = remaining.rows.map((r) => Number(r.id));
      expect(ids).not.toContain(resolvedOld);
      expect(ids).toContain(pendingOld);
      expect(ids).toContain(resolvedFresh);
    });
  });

  // -------------------------------------------------------------------------
  // H10: the agreed-item fingerprint refuses bait-and-switch at acceptance
  // -------------------------------------------------------------------------

  describe('agreed-item fingerprint', () => {
    it('accepting with a re-rolled instance of the agreed item id refuses item_mismatch', async () => {
      const realm = 'directed-bait-reroll';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const sellerCharacter = await seedCharacter(realm, seller, `BaitSeller${seq}`);
      const sellerName = `BaitSeller${seq - 1}`;
      const buyerCharacter = await seedCharacter(realm, buyer);
      // The buyer agreed to the +9 roll; the seller's bags now hold a +3.
      const agreedInstance = { rolled: { stats: { str: 9 } } };
      const heldCopy: InvSlot = {
        itemId: 'amber_crimson_armor_plate',
        count: 1,
        instance: { rolled: { stats: { str: 3 } } } as InvSlot['instance'],
      };
      const service = makeService(realm, {
        wallets: new Map([
          [seller, 'wallet-bait-seller'],
          [buyer, 'wallet-bait-buyer'],
        ]),
        copies: new Map([[sellerCharacter, heldCopy]]),
      });
      const out = await acceptDirectedDeal({
        realm,
        service,
        buyer,
        buyerCharacter,
        sellerName,
        sellerCharacter,
        seller,
        agreed: {
          itemId: 'amber_crimson_armor_plate',
          instance: agreedInstance as InvSlot['instance'],
        },
        acceptRef: {
          index: 0,
          itemId: 'amber_crimson_armor_plate',
          expectInstance: heldCopy.instance,
        },
      });
      expect(out).toMatchObject({ ok: false, reason: 'item_mismatch' });
      // The pin the guard compares against is the canonical copy pin.
      expect(
        itemCopyPin({ itemId: 'amber_crimson_armor_plate', count: 1, instance: heldCopy.instance }),
      ).not.toBe(
        itemCopyPin({
          itemId: 'amber_crimson_armor_plate',
          count: 1,
          instance: agreedInstance as InvSlot['instance'],
        }),
      );
    });

    it('accepts a byte-identical duplicate from another bag cell', async () => {
      // The pin is CONTENT identity, not slot identity (itemPinDigest's
      // contract): a duplicate in another cell satisfies it, and the seller's
      // named index decides which copy ships. Identical copies are
      // interchangeable by definition, so this must not refuse. What the
      // index half of this test pins is that the SERVICE forwards ref.index
      // into extraction (proved through the fake's own bag[ref.index]
      // resolution); the real extractTradableCopy honoring the index is its
      // own suite's contract.
      const realm = 'directed-duplicate-copy';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const sellerCharacter = await seedCharacter(realm, seller, `TwinSeller${seq}`);
      const sellerName = `TwinSeller${seq - 1}`;
      const buyerCharacter = await seedCharacter(realm, buyer);
      // Two copies the pin cannot tell apart, in different bag cells. `slot` is
      // the advisory cell marker and sits OUTSIDE the pin's 3-tuple (item id,
      // instance payload, crafted provenance), which is exactly what lets it
      // say WHICH copy shipped without changing what the pin sees.
      const staged: InvSlot = {
        itemId: 'amber_crimson_armor_plate',
        count: 1,
        instance: { rolled: { stats: { str: 5 } } } as InvSlot['instance'],
        slot: 2,
      };
      const duplicate: InvSlot = {
        itemId: 'amber_crimson_armor_plate',
        count: 1,
        instance: { rolled: { stats: { str: 5 } } } as InvSlot['instance'],
        slot: 7,
      };
      expect(itemCopyPin(staged), 'the two cells are one content identity').toBe(
        itemCopyPin(duplicate),
      );
      const service = makeService(realm, {
        wallets: new Map([
          [seller, 'wallet-twin-copy-seller'],
          [buyer, 'wallet-twin-copy-buyer'],
        ]),
        bags: new Map([[sellerCharacter, [staged, duplicate]]]),
      });
      const out = await acceptDirectedDeal({
        realm,
        service,
        buyer,
        buyerCharacter,
        sellerName,
        sellerCharacter,
        seller,
        // The buyer's trade window previewed the copy in cell 2; the seller
        // accepts naming the one in cell 7.
        agreed: { itemId: 'amber_crimson_armor_plate', instance: staged.instance },
        acceptRef: {
          index: 1,
          itemId: 'amber_crimson_armor_plate',
          expectInstance: duplicate.instance,
        },
      });
      expect(out).toMatchObject({ ok: true });
      const listing = (out as { ok: true; listing: { id: number } }).listing;
      expect(listing, 'the deal escrowed').not.toBeNull();
      const row = await listingRow(listing.id);
      expect(row.item, 'the NAMED index is the copy that shipped').toEqual(duplicate);
    });

    it('escrows an instanced, crafted copy end to end', async () => {
      const realm = 'directed-instanced-deal';
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const sellerCharacter = await seedCharacter(realm, seller, `ForgeSeller${seq}`);
      const sellerName = `ForgeSeller${seq - 1}`;
      const buyerCharacter = await seedCharacter(realm, buyer);
      // Both provenance channels a copy can carry at once: the instance payload
      // and the plain-stack crafted marker, which together with the item id are
      // the whole pin.
      const copy: InvSlot = {
        itemId: 'amber_crimson_armor_plate',
        count: 1,
        instance: {
          signer: 'Sableforge',
          rolled: { stats: { str: 7, sta: 4 }, masterwork: true },
        } as InvSlot['instance'],
        craftedRecipeId: 'recipe_amber_crimson_armor_plate',
      };
      const service = makeService(realm, {
        wallets: new Map([
          [seller, 'wallet-forge-seller'],
          [buyer, 'wallet-forge-buyer'],
        ]),
        copies: new Map([[sellerCharacter, copy]]),
      });
      const out = await acceptDirectedDeal({
        realm,
        service,
        buyer,
        buyerCharacter,
        sellerName,
        sellerCharacter,
        seller,
        agreed: {
          itemId: copy.itemId,
          instance: copy.instance,
          craftedRecipeId: copy.craftedRecipeId,
        },
        acceptRef: {
          index: 0,
          itemId: copy.itemId,
          expectInstance: copy.instance,
        },
      });
      expect(out).toMatchObject({ ok: true });
      const listing = (out as { ok: true; listing: { id: number } }).listing;
      expect(listing).not.toBeNull();
      const row = await listingRow(listing.id);
      // The whole payload survived the escrow write: an instanced deal that
      // dropped a channel here would launder the copy on delivery.
      expect(row.item).toEqual(copy);
      expect(row.status).toBe('active');
      // And the offer carries the atomic stamp (listing exists IFF stamped).
      const offer = await pool.query(
        `SELECT status, listing_id FROM woc_market_directed_offers WHERE realm = $1`,
        [realm],
      );
      expect(offer.rows).toHaveLength(1);
      expect(offer.rows[0].status).toBe('accepted');
      expect(Number(offer.rows[0].listing_id)).toBe(listing.id);
    });
  });
  describe('a just-resolved offer lingers for the grace window (the verdict read)', () => {
    it('declined stays visible inside the grace bound and leaves after it', async () => {
      // The non-resolving side's poll reads the verdict off this lingering
      // row; filtered out the instant it resolved, the arm emptied silently.
      const marketDbMod = await import('../server/woc_market_db');
      const realm = `resolved-grace-${Date.now()}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const nowMs = Date.now();
      const offerId = await seedOffer(realm, seller, buyer, {
        status: 'declined',
        updatedAtMs: nowMs - 1_000,
      });
      const within = await marketDb.directedOffersForAccount(realm, buyer, nowMs);
      expect(within.map((o) => o.id)).toContain(offerId);
      expect(within.find((o) => o.id === offerId)?.status).toBe('declined');
      const after = await marketDb.directedOffersForAccount(
        realm,
        buyer,
        nowMs + marketDbMod.SETTLED_OFFER_GRACE_MS + 2_000,
      );
      expect(after.map((o) => o.id)).not.toContain(offerId);
    });

    it('an expired offer lingers the same way; a stale resolved row never returns', async () => {
      const marketDbMod = await import('../server/woc_market_db');
      const realm = `resolved-grace-exp-${Date.now()}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const nowMs = Date.now();
      const fresh = await seedOffer(realm, seller, buyer, {
        status: 'expired',
        updatedAtMs: nowMs - 1_000,
      });
      const stale = await seedOffer(realm, seller, buyer, {
        status: 'withdrawn',
        updatedAtMs: nowMs - marketDbMod.SETTLED_OFFER_GRACE_MS - 60_000,
      });
      const rows = await marketDb.directedOffersForAccount(realm, buyer, nowMs);
      const ids = rows.map((o) => o.id);
      expect(ids).toContain(fresh);
      expect(ids).not.toContain(stale);
    });

    it('the schema carries the non-partial account indexes this poll read runs on', async () => {
      // The grace arm above means the read's predicate (status IN
      // pending,accepted OR updated_at inside the window) can NEVER use the
      // pending-only partial indexes, so without these two every 2-second
      // poll seq-scans a table that grows per offer. Existence-pinned so a
      // schema edit cannot silently put the seq scan back.
      const marketDbMod = await import('../server/woc_market_db');
      const res = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'woc_market_directed_offers'`,
      );
      const names = res.rows.map((r) => String(r.indexname));
      expect(names).toContain('woc_market_offers_buyer_all');
      expect(names).toContain('woc_market_offers_seller_all');
      // The COLUMNS, not just the names: a same-name index with a different
      // prefix (no realm, no created_at) survives the name pin and puts the
      // seq scan back.
      const def = (name: string) =>
        String(res.rows.find((r) => String(r.indexname) === name)?.indexdef ?? '');
      expect(def('woc_market_offers_buyer_all')).toContain(
        '(realm, buyer_account, created_at DESC)',
      );
      expect(def('woc_market_offers_seller_all')).toContain(
        '(realm, seller_account, created_at DESC)',
      );
      // The retired pending-only pair is gone from a freshly applied schema...
      expect(names).not.toContain('woc_market_offers_buyer_pending');
      expect(names).not.toContain('woc_market_offers_seller_pending');
      // ...AND from a database that already carried them (the upgrade path a
      // fresh-schema pin cannot see: production booted the CREATE in an
      // earlier round, so re-applying the schema must retire them there).
      await pool.query(`CREATE INDEX IF NOT EXISTS woc_market_offers_buyer_pending
        ON woc_market_directed_offers(realm, buyer_account, created_at DESC)
        WHERE status = 'pending'`);
      await pool.query(`CREATE INDEX IF NOT EXISTS woc_market_offers_seller_pending
        ON woc_market_directed_offers(realm, seller_account, created_at DESC)
        WHERE status = 'pending'`);
      await pool.query(marketDbMod.WOC_MARKET_SCHEMA);
      const again = await pool.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'woc_market_directed_offers'`,
      );
      const after = again.rows.map((r) => String(r.indexname));
      expect(after).not.toContain('woc_market_offers_buyer_pending');
      expect(after).not.toContain('woc_market_offers_seller_pending');
      expect(after).toContain('woc_market_offers_buyer_all');
      expect(after).toContain('woc_market_offers_seller_all');
    });

    it('the poll read PLANS on those indexes (no seq scan of the offers table)', async () => {
      // A plan pin, because existence alone cannot fail when a later predicate
      // edit (another OR arm, a function wrapper on realm/account) makes the
      // read unable to use them. On the small disposable database the planner
      // would pick a seq scan on cost alone, so it is disallowed for the
      // session: with USABLE indexes the plan then goes through them (a
      // BitmapOr over the two, or plain index scans); with none it still
      // seq-scans, at a huge cost, which is what the assertion catches.
      const marketDbMod = await import('../server/woc_market_db');
      const realm = `plan-${Date.now()}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      await seedOffer(realm, seller, buyer, { status: 'pending' });
      // Capture the exact statement the read runs, then EXPLAIN it verbatim.
      const captured: { text: string; values: unknown[] }[] = [];
      const recorder = {
        query: (text: string, values: unknown[]) => {
          captured.push({ text, values });
          return pool.query(text, values);
        },
      } as unknown as Pool;
      await new marketDbMod.PgWocMarketDb(recorder).directedOffersForAccount(
        realm,
        buyer,
        Date.now(),
      );
      expect(captured).toHaveLength(1);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL enable_seqscan = off');
        const plan = await client.query(`EXPLAIN ${captured[0].text}`, captured[0].values);
        const lines = plan.rows.map((r) => String(r['QUERY PLAN'])).join('\n');
        expect(lines).not.toMatch(/Seq Scan on woc_market_directed_offers/);
        expect(lines).toMatch(/woc_market_offers_(buyer|seller)_all/);
      } finally {
        // ROLLBACK on every path: a red assertion must not hand a client
        // back to the shared pool inside an open transaction (with
        // enable_seqscan still off in it).
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    });
  });

  describe('strikes and terms, in real SQL', () => {
    it('strikes escalate by one and a suspension never shortens', async () => {
      const acc = await seedAccount();
      const first = await marketDb.addStrike(acc, null);
      expect(first).toMatchObject({ accountId: acc, strikes: 1, suspendedUntilMs: null });
      const long = BASE_MS + 120 * MINUTE_MS;
      const second = await marketDb.addStrike(acc, long);
      expect(second.strikes).toBe(2);
      expect(second.suspendedUntilMs).toBe(long);
      const third = await marketDb.addStrike(acc, BASE_MS + 60 * MINUTE_MS);
      expect(third.strikes, 'every strike counts').toBe(3);
      expect(third.suspendedUntilMs, 'a shorter suspension never wins').toBe(long);
      // Clearing one account's record never touches another's.
      const other = await seedAccount();
      await marketDb.addStrike(other, null);
      await marketDb.clearStrikes(acc);
      expect(await marketDb.strikeInfo(acc)).toBeNull();
      expect((await marketDb.strikeInfo(other))?.strikes, 'per-account clear').toBe(1);
    });

    it('the FIRST terms acceptance is the durable one', async () => {
      const acc = await seedAccount();
      await marketDb.recordTermsAccepted(acc, BASE_MS);
      await marketDb.recordTermsAccepted(acc, BASE_MS + 60 * MINUTE_MS);
      expect(await marketDb.termsAcceptedAt(acc), 'consent is recorded once').toBe(BASE_MS);
    });
  });
});
