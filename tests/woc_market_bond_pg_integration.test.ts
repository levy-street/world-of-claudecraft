// Real-Postgres coverage for the $WOC Exchange bond and buy-now lock
// lifecycle: the payment-loss cluster (signature-first intake, the refresh
// CAS, teardowns that keep paid-but-undecided bonds pollable), the bounded
// 'confirming' resolution (the operator review state), the bond-progress
// anti-snipe move, and the buy-now abandon-loop defenses (claim cooldowns and
// seller cancel-intent). Every block pins behavior that FAILS on the code
// this change replaced (the old expiry-first intake, the unguarded quote
// overwrite, the teardown that cancelled signed bonds, the placement-time
// extension, the free re-claim loop, the holderless lock clear).
//
// Gate: TEST_DATABASE_URL (an admin URL on the dev Postgres from npm run
// db:up). The suite creates and drops its own database and never touches the
// database the URL points at. Pattern: tests/woc_market_settlement_pg_integration.test.ts.
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  WocMarketCustody,
  WocMarketEconomy,
  WocMarketService,
  WocQuoteIntent,
} from '../server/woc_market';
import type { PgWocMarketDb } from '../server/woc_market_db';

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const VERIFY_DB = 'wocc_woc_market_bond_verify';

function verifyUrl(admin: string): string {
  const u = new URL(admin);
  u.pathname = `/${VERIFY_DB}`;
  return u.toString();
}

// server/db.ts reads DATABASE_URL at module load; nothing above is a static
// server import, so this assignment points the boot at the disposable db.
if (ADMIN_URL) process.env.DATABASE_URL = verifyUrl(ADMIN_URL);

const describeDb = ADMIN_URL ? describe : describe.skip;

const BASE_MS = 1_820_000_000_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** Controllable economy: confirm() serves the scripted verdict; quotes mint
 *  deterministic references. Only the members the bond paths reach are real. */
class ScriptedEconomy implements WocMarketEconomy {
  verdict: { settled: boolean; pending: boolean; reason: string | null } = {
    settled: false,
    pending: true,
    reason: null,
  };
  quoteSeq = 0;
  readonly confirms: [string, string][] = [];
  constructor(private readonly clock: () => number) {}

  async price() {
    return { available: true, healthy: true, reason: null, tokensPerUsd: 1000, asOfMs: BASE_MS };
  }
  async estimate(usdCents: number) {
    return { available: true, usdCents, amount: null, asOfMs: BASE_MS, split: null };
  }
  async bondQuote(): Promise<WocQuoteIntent> {
    this.quoteSeq++;
    return {
      ok: true,
      reference: `bond-ref-${this.quoteSeq}`,
      expiresAtMs: this.clock() + 90_000,
      amount: null,
      reason: null,
    } as unknown as WocQuoteIntent;
  }
  async settlementQuote(): Promise<WocQuoteIntent> {
    this.quoteSeq++;
    return {
      ok: true,
      reference: `settle-ref-${this.quoteSeq}`,
      expiresAtMs: this.clock() + 90_000,
      amount: null,
      reason: null,
    } as unknown as WocQuoteIntent;
  }
  async confirm(reference: string, signature: string) {
    this.confirms.push([reference, signature]);
    return this.verdict;
  }
  async refundBond() {
    return { done: true, reason: null };
  }
  async forfeitBond() {
    return { done: true, reason: null };
  }
}

/** Custody stub: the bond/lock paths under test never move items. */
const inertCustody: WocMarketCustody = {
  runSerialized() {
    throw new Error('not exercised');
  },
  persistGrantSerialized() {
    throw new Error('not exercised');
  },
  ownsLiveCharacter() {
    return true;
  },
  escrowSessionLost() {},
  extractCopy() {
    throw new Error('not exercised');
  },
  grantCopy() {
    return { ok: false, reason: 'offline' };
  },
  snapshotCopy() {
    return { ok: false, reason: 'offline' };
  },
  restoreCopy() {},
  async persistMailParcel() {},
  hasParcel() {
    return false;
  },
};

describeDb('woc market bond and lock lifecycle against real Postgres', () => {
  let admin: Pool;
  let pool: Pool;
  let db: typeof import('../server/db');
  let marketDb: PgWocMarketDb;
  let marketMod: typeof import('../server/woc_market');
  let rulesMod: typeof import('../server/woc_market_rules');
  let seq = 0;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL, max: 2 });
    const own = new URL(ADMIN_URL as string).pathname.replace(/^\//, '');
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
    rulesMod = await import('../server/woc_market_rules');

    // The REAL boot path: the state CHECK evolution, the open2 index swap,
    // and the abandon-ledger DDL under test are the ones production applies.
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

  function makeService(
    realm: string,
    economy: ScriptedEconomy,
    clock: () => number,
  ): WocMarketService {
    return new marketMod.WocMarketService({
      db: marketDb,
      economy,
      custody: inertCustody,
      verifiedWallet: async () => 'wallet-fixture',
      balanceTokens: async () => 1_000_000,
      stepUpDevSig: true,
      config: {
        enabled: true,
        realm,
        policy: rulesMod.WOC_MARKET_RESTRICTED_POLICY,
        confirmingReviewMs: 6 * HOUR_MS,
      },
      now: clock,
      onSweepError: (arm, err) => {
        throw new Error(`sweep arm ${arm} failed: ${String(err)}`);
      },
    });
  }

  async function seedAccount(): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`woc-bond-fixture-${seq}`],
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
      directedBuyerAccount?: number | null;
      lockAccount?: number | null;
      lockExpiresAtMs?: number | null;
      cancelRequestedAtMs?: number | null;
      itemId?: string;
    } = {},
  ): Promise<number> {
    seq++;
    const endsAtMs = over.endsAtMs ?? BASE_MS + 60 * MINUTE_MS;
    const itemId = over.itemId ?? 'crown_of_embers';
    const res = await pool.query(
      `INSERT INTO woc_market_listings (
         realm, seller_account, seller_character, seller_name, seller_wallet,
         item, item_id, quality, format, start_cents, buy_now_cents,
         offer_next, status, ends_at, base_ends_at, directed_buyer_account,
         buy_now_lock_account, buy_now_lock_expires, cancel_requested_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, 'epic', 'auction_buy_now', 500, $8,
         false, $9, to_timestamp($10 / 1000.0), to_timestamp($10 / 1000.0), $11,
         $12,
         CASE WHEN $13::bigint IS NULL THEN NULL ELSE to_timestamp($13::bigint / 1000.0) END,
         CASE WHEN $14::bigint IS NULL THEN NULL ELSE to_timestamp($14::bigint / 1000.0) END
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
        endsAtMs,
        over.directedBuyerAccount ?? null,
        over.lockAccount ?? null,
        over.lockExpiresAtMs ?? null,
        over.cancelRequestedAtMs ?? null,
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
      bondReference?: string | null;
      bondSignature?: string | null;
      bondQuoteExpiresAtMs?: number | null;
      // Explicit ONLY to decouple the signature-recording moment from
      // placement (the late-signer case); default couples them, like the
      // real first-recording stamp on a promptly-signed bond.
      bondSignatureAtMs?: number | null;
    } = {},
  ): Promise<number> {
    seq++;
    const res = await pool.query(
      `INSERT INTO woc_market_bids (
         listing_id, realm, account, character_id, character_name, wallet,
         amount_cents, status, bond_cents, bond_state, placed_at,
         bond_reference, bond_signature, bond_quote_expires, bond_signature_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, 70, $9, to_timestamp($10 / 1000.0),
         $11, $12,
         CASE WHEN $13::bigint IS NULL THEN NULL ELSE to_timestamp($13::bigint / 1000.0) END,
         CASE
           WHEN $14::bigint IS NOT NULL THEN to_timestamp($14::bigint / 1000.0)
           WHEN $12::text IS NULL THEN NULL
           ELSE to_timestamp($10 / 1000.0)
         END
       ) RETURNING id`,
      [
        listingId,
        realm,
        account,
        8000 + seq,
        `Bidder${seq}`,
        `wallet-bidder-${seq}`,
        over.amountCents ?? 700,
        over.status ?? 'pending_bond',
        over.bondState ?? 'pending',
        over.placedAtMs ?? BASE_MS - 10 * MINUTE_MS,
        over.bondReference ?? `seed-ref-${seq}`,
        over.bondSignature ?? null,
        over.bondQuoteExpiresAtMs ?? null,
        over.bondSignatureAtMs ?? null,
      ],
    );
    return Number(res.rows[0].id);
  }

  async function bidRow(id: number): Promise<Record<string, unknown>> {
    const res = await pool.query(
      `SELECT status, bond_state, bond_reference, bond_signature, bond_cents
         FROM woc_market_bids WHERE id = $1`,
      [id],
    );
    return res.rows[0] as Record<string, unknown>;
  }

  async function listingRow(id: number): Promise<Record<string, unknown>> {
    const res = await pool.query(
      `SELECT status, resolution, buy_now_lock_account, cancel_requested_at,
              extract(epoch from ends_at) * 1000 AS ends_ms
         FROM woc_market_listings WHERE id = $1`,
      [id],
    );
    return res.rows[0] as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // Signature-first intake (H4 arm one)
  // -------------------------------------------------------------------------

  describe('signature-first bond intake', () => {
    it('records a near-expiry broadcast BEFORE any expiry verdict, and the poll completes it', async () => {
      const realm = `bond-intake-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      // The quote expired a second before the signature arrived: the old
      // intake refused quote_expired here with NO ledger trace.
      const bidId = await seedBid(realm, listingId, buyer, {
        bondReference: `near-expiry-${seq}`,
        bondQuoteExpiresAtMs: BASE_MS - 1_000,
      });
      const economy = new ScriptedEconomy(() => BASE_MS);
      const service = makeService(realm, economy, () => BASE_MS);
      economy.verdict = { settled: false, pending: true, reason: null };
      const out = await service.confirmBond(buyer, bidId, 'sig-near-expiry');
      // Tracked, not refused: the payment may be real and merely unfinalized.
      expect(out).toEqual({ ok: true, standing: false, pending: true, reason: null });
      expect(await bidRow(bidId)).toMatchObject({
        status: 'pending_bond',
        bond_signature: 'sig-near-expiry',
      });
      // The row is IN the polling set, and a settled verdict completes it.
      const polled = await marketDb.confirmingBonds(realm, 10, []);
      expect(polled.map((b) => b.id)).toContain(bidId);
      economy.verdict = { settled: true, pending: false, reason: null };
      await service.sweepPass();
      expect(await bidRow(bidId)).toMatchObject({ status: 'active', bond_state: 'held' });
    });

    it('a verdict AGAINST routes the tracked row to lapse, never a silent loss', async () => {
      const realm = `bond-lapse-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, buyer, {
        bondReference: `refused-${seq}`,
        bondQuoteExpiresAtMs: BASE_MS - 1_000,
      });
      const economy = new ScriptedEconomy(() => BASE_MS);
      const service = makeService(realm, economy, () => BASE_MS);
      economy.verdict = { settled: false, pending: false, reason: 'quote_expired' };
      const out = await service.confirmBond(buyer, bidId, 'sig-refused');
      // The chain's verdict, AFTER the ledger write: the signature survives
      // the refusal as the trace.
      expect(out).toEqual({ ok: false, reason: 'confirm_failed' });
      expect(await bidRow(bidId)).toMatchObject({
        status: 'pending_bond',
        bond_signature: 'sig-refused',
      });
      await service.sweepPass();
      expect(await bidRow(bidId)).toMatchObject({ status: 'lapsed', bond_state: 'void' });
    });

    it('a SECOND, different signature refuses typed while the first is being decided', async () => {
      const realm = `bond-second-sig-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      // Captured BEFORE seeding: seq moves inside the seeders.
      const firstSig = `sig-first-${seq}`;
      const bidId = await seedBid(realm, listingId, buyer, {
        bondReference: `first-claim-${seq}`,
        bondSignature: firstSig,
      });
      const economy = new ScriptedEconomy(() => BASE_MS);
      const service = makeService(realm, economy, () => BASE_MS);
      const out = await service.confirmBond(buyer, bidId, `sig-second-${seq}`);
      // 'not_pending' here misread a still-pending bid as gone; the honest
      // answer is that a payment is already in flight awaiting its verdict.
      expect(out).toEqual({ ok: false, reason: 'confirm_in_flight' });
      // The FIRST claim stays the ledger trace, and the chain is never asked
      // about the discarded second string.
      expect(await bidRow(bidId)).toMatchObject({
        status: 'pending_bond',
        bond_signature: firstSig,
      });
      expect(economy.confirms).toHaveLength(0);
    });

    it('a resubmit returns the FIRST recording moment as the anchor', async () => {
      const realm = `bond-anchor-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, buyer, {
        bondReference: `anchor-ref-${seq}`,
        bondSignature: null,
      });
      const first = await marketDb.submitBondSignature(bidId, 'sig-anchor', BASE_MS);
      expect(first).toEqual({ signatureAtMs: BASE_MS });
      // The retry an hour later hands back the ORIGINAL arrival, not its own
      // clock: the extension anchor must not advance with retries, or one
      // pending-forever signature re-posts its way to holding the close.
      const retry = await marketDb.submitBondSignature(bidId, 'sig-anchor', BASE_MS + HOUR_MS);
      expect(retry).toEqual({ signatureAtMs: BASE_MS });
    });

    it('a legacy row without a stamp adopts placement, never the resubmit clock', async () => {
      const realm = `bond-legacy-stamp-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const placedAt = BASE_MS - 10 * MINUTE_MS;
      const bidId = await seedBid(realm, listingId, buyer, {
        bondReference: `legacy-ref-${seq}`,
        bondSignature: 'sig-legacy',
        placedAtMs: placedAt,
      });
      // The pre-column shape: a signature recorded before bond_signature_at
      // existed (the seeder auto-stamps, so null it by hand). Its first
      // re-post must not mint a fresh first-arrival and creep the close.
      await pool.query(`UPDATE woc_market_bids SET bond_signature_at = NULL WHERE id = $1`, [
        bidId,
      ]);
      const retry = await marketDb.submitBondSignature(bidId, 'sig-legacy', BASE_MS + HOUR_MS);
      expect(retry).toEqual({ signatureAtMs: placedAt });
    });

    it('a reorg-flipped verdict cannot void a HELD bond', async () => {
      const realm = `bond-held-flip-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      // The activation-retry shape: settled verdict held the bond, the
      // activate lost its lock race, and the row stayed with the poll. A
      // LATER contradictory verdict (a reorg flip) must not void it: a
      // voided held bond strands money where no refund arm reads.
      const heldId = await seedBid(realm, listingId, buyer, {
        bondState: 'held',
        bondReference: `held-ref-${seq}`,
        bondSignature: `sig-held-${seq}`,
      });
      // Positive control in the same pass: an ordinary pending-bond refusal
      // still lapses, so the carve-out is proven narrow, not a dead poll.
      const pendingId = await seedBid(realm, listingId, await seedAccount(), {
        bondReference: `plain-ref-${seq}`,
        bondSignature: `sig-plain-${seq}`,
      });
      const economy = new ScriptedEconomy(() => BASE_MS);
      const service = makeService(realm, economy, () => BASE_MS);
      economy.verdict = { settled: false, pending: false, reason: 'refused' };
      await service.sweepPass();
      expect(await bidRow(heldId)).toMatchObject({
        status: 'pending_bond',
        bond_state: 'held',
      });
      expect(await bidRow(pendingId)).toMatchObject({ status: 'lapsed', bond_state: 'void' });
      // Still visible to the poll (and so to the stuckBonds readout class),
      // but ROTATED: the refused lapse must park the row like a
      // never-decided one, or it re-owns the batch head and burns one
      // confirm RPC every pass forever.
      const parked = await pool.query(`SELECT poll_parked_at FROM woc_market_bids WHERE id = $1`, [
        heldId,
      ]);
      expect(
        parked.rows[0].poll_parked_at,
        'held survivor rotates to the poll tail',
      ).not.toBeNull();
      const polled = await marketDb.confirmingBonds(realm, 10, []);
      expect(polled.map((b) => b.id)).toContain(heldId);
    });
  });

  // -------------------------------------------------------------------------
  // The refresh CAS and the abandon guard (H4 arm two)
  // -------------------------------------------------------------------------

  describe('paid-but-undecided bonds are immovable', () => {
    it('setBidBondQuote refuses to re-reference a signed bond', async () => {
      const realm = `bond-cas-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      // Captured BEFORE seeding: seq moves inside the seeders.
      const paidRef = `paid-ref-${seq}`;
      const bidId = await seedBid(realm, listingId, buyer, {
        bondReference: paidRef,
        bondSignature: `paid-sig-${seq}`,
      });
      // The poller re-checks reference+signature as a PAIR: the old
      // unconditional UPDATE overwrote the reference and read the real
      // payment as refused. The adopted bond figure rides the same fence:
      // a possibly-paid bond keeps the figure its payment was sized to.
      expect(await marketDb.setBidBondQuote(bidId, 'fresh-ref', BASE_MS + 90_000, 999)).toBe(false);
      expect(await bidRow(bidId)).toMatchObject({ bond_reference: paidRef, bond_cents: 70 });
      // An UNSIGNED bond still refreshes, and adopts the quoted figure.
      const freshRef = `fresh-ref-${seq}`;
      const unsignedId = await seedBid(realm, listingId, await seedAccount(), {
        bondReference: `unsigned-ref-${seq}`,
      });
      expect(await marketDb.setBidBondQuote(unsignedId, freshRef, BASE_MS + 90_000, 82)).toBe(true);
      expect(await bidRow(unsignedId)).toMatchObject({ bond_reference: freshRef, bond_cents: 82 });
    });

    it('abandonPendingBid refuses to void a signed bond', async () => {
      const realm = `bond-abandon-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, buyer, {
        bondSignature: `abandon-sig-${seq}`,
      });
      // The old UPDATE voided it: money possibly in flight, gone from every
      // queue with no arm able to move it again.
      expect(await marketDb.abandonPendingBid(realm, bidId, buyer)).toBe(false);
      expect(await bidRow(bidId)).toMatchObject({ status: 'pending_bond', bond_state: 'pending' });
    });
  });

  // -------------------------------------------------------------------------
  // Teardowns keep paid-but-undecided bonds in the polling set (H4 arm three)
  // -------------------------------------------------------------------------

  describe('cancellation never orphans a bond', () => {
    it('the suspend teardown skips a signed, unheld bond and the poll routes it to refund', async () => {
      const realm = `suspend-carve-${++seq}`;
      const seller = await seedAccount();
      const paidBuyer = await seedAccount();
      const activeBuyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const paidUndecided = await seedBid(realm, listingId, paidBuyer, {
        bondReference: `undecided-${seq}`,
        bondSignature: `undecided-sig-${seq}`,
      });
      const activeHeld = await seedBid(realm, listingId, activeBuyer, {
        status: 'active',
        bondState: 'held',
        bondReference: `held-${seq}`,
      });
      // The carve-out's THIRD dimension alone: pending_bond WITH a recorded
      // signature but bond_state 'held' (the chain already decided). Only the
      // bond_state conjunct separates this from the preserved bid above, so a
      // teardown that dropped AND bond_state = 'pending' would wrongly skip
      // it and strand a decided, refundable bond.
      const heldBuyer = await seedAccount();
      const signedHeld = await seedBid(realm, listingId, heldBuyer, {
        bondReference: `signed-held-${seq}`,
        bondSignature: `signed-held-sig-${seq}`,
        bondState: 'held',
      });
      const out = await marketDb.suspendListingIfSafe(realm, listingId, BASE_MS);
      expect(typeof out).not.toBe('string');
      // The held active bid tore down normally...
      expect(await bidRow(activeHeld)).toMatchObject({
        status: 'cancelled',
        bond_state: 'refund_due',
      });
      // ...the signed-but-DECIDED pending bid tore down too (its bond rides
      // the ordinary refund queue, not the poll)...
      expect(await bidRow(signedHeld)).toMatchObject({
        status: 'cancelled',
        bond_state: 'refund_due',
      });
      // ...but the paid-but-undecided bond STAYED with the poll (the old
      // teardown cancelled it out of the polling set with bond_state stuck
      // 'pending' forever).
      expect(await bidRow(paidUndecided)).toMatchObject({
        status: 'pending_bond',
        bond_state: 'pending',
      });
      expect((await marketDb.confirmingBonds(realm, 10, [])).map((b) => b.id)).toContain(
        paidUndecided,
      );
      // The settled verdict against the CLOSED listing reaches refund: hold,
      // then activation's supersede arm flips held -> refund_due.
      await marketDb.markBondHeld(paidUndecided);
      expect(await marketDb.activateBid(paidUndecided, BASE_MS)).toBe('listing_closed');
      expect(await bidRow(paidUndecided)).toMatchObject({
        status: 'outbid',
        bond_state: 'refund_due',
      });
      expect((await marketDb.bondsDue(realm, 10)).map((b) => b.id)).toContain(paidUndecided);
    });

    it('the finalize teardown carries the same carve-out', async () => {
      const realm = `finalize-carve-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const bystander = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const paidUndecided = await seedBid(realm, listingId, bystander, {
        bondReference: `fin-undecided-${seq}`,
        bondSignature: `fin-undecided-sig-${seq}`,
      });
      const settlement = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 0,
        buyerAccount: buyer,
        buyerCharacter: 7000 + seq,
        buyerName: `Buyer${seq}`,
        buyerWallet: `wallet-buyer-${seq}`,
        amountCents: 1000,
        deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
        nowMs: BASE_MS,
      });
      if (typeof settlement === 'string') throw new Error(`fixture settlement: ${settlement}`);
      await pool.query(
        `UPDATE woc_market_settlements SET state = 'delivering', updated_at = now() WHERE id = $1`,
        [settlement.id],
      );
      const out = await marketDb.finalizeDeliveredSettlement({
        settlementId: settlement.id,
        listingId,
        bidId: null,
        sale: {
          realm,
          listingId,
          itemId: 'crown_of_embers',
          item: { itemId: 'crown_of_embers', count: 1 },
          priceCents: 1000,
          amountBase: null,
          sellerAccount: seller,
          buyerAccount: buyer,
          sellerName: 'Seller',
          buyerName: 'Buyer',
        },
      });
      expect(out).toBe('finalized');
      expect(await bidRow(paidUndecided)).toMatchObject({
        status: 'pending_bond',
        bond_state: 'pending',
      });
      expect((await marketDb.confirmingBonds(realm, 10, [])).map((b) => b.id)).toContain(
        paidUndecided,
      );
    });
  });

  // -------------------------------------------------------------------------
  // H15: the bounded confirming resolution
  // -------------------------------------------------------------------------

  describe('the confirming age bound', () => {
    it('an over-bound confirming settlement surfaces as overdue and parks in review', async () => {
      const realm = `review-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling' });
      const settlement = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 0,
        buyerAccount: buyer,
        buyerCharacter: 7000 + seq,
        buyerName: `Buyer${seq}`,
        buyerWallet: `wallet-buyer-${seq}`,
        amountCents: 1000,
        deadlineAtMs: BASE_MS - 20 * MINUTE_MS,
        nowMs: BASE_MS,
      });
      if (typeof settlement === 'string') throw new Error(`fixture settlement: ${settlement}`);
      // Confirming for seven hours: past the six-hour bound.
      await pool.query(
        `UPDATE woc_market_settlements
            SET state = 'confirming', tx_signature = $2,
                updated_at = to_timestamp($3 / 1000.0)
          WHERE id = $1`,
        [settlement.id, `stuck-sig-${seq}`, BASE_MS - 7 * HOUR_MS],
      );
      // The overdue read now carries the confirming arm (the old predicate
      // selected only offered/failed: this row was polled forever).
      const overdue = await marketDb.confirmingOverdueSettlements(realm, BASE_MS - 6 * HOUR_MS, 10);
      expect(overdue.map((s) => s.id)).toContain(settlement.id);
      // The sweep parks it in 'review' (the real CHECK constraint accepts the
      // state: the DDL evolution under test), with NO default consequences
      // (the payment may have landed, so no strike, no forfeit, no cascade).
      const economy = new ScriptedEconomy(() => BASE_MS);
      const service = makeService(realm, economy, () => BASE_MS);
      await service.sweepPass();
      const after = await pool.query(
        `SELECT state, fail_reason FROM woc_market_settlements WHERE id = $1`,
        [settlement.id],
      );
      expect(after.rows[0]).toEqual({ state: 'review', fail_reason: 'confirming_overdue' });
      // Out of the polling set...
      expect((await marketDb.confirmingSettlements(realm, 10)).map((s) => s.id)).not.toContain(
        settlement.id,
      );
      // ...but still OPEN: the one-open-settlement index holds it, so nothing
      // can re-auction or double-sell the listing around it.
      expect(await marketDb.liveSettlementForListing(listingId)).toMatchObject({
        id: settlement.id,
        state: 'review',
      });
      await marketDb.reopenListing(listingId);
      expect((await listingRow(listingId)).status).toBe('settling');
      const second = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 1,
        buyerAccount: buyer,
        buyerCharacter: 7000 + seq,
        buyerName: `Buyer${seq}`,
        buyerWallet: `wallet-buyer-${seq}`,
        amountCents: 1000,
        deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
        nowMs: BASE_MS,
      });
      expect(second).toBe('live_settlement_exists');
      // The monitor surfaces it, and the operator arms are real transitions:
      // review -> confirmed resumes delivery.
      const readout = await marketDb.stuckCustodyReadout(realm, BASE_MS, 10, 1000, BASE_MS);
      expect(readout.reviewSettlements.count).toBe(1);
      expect(readout.reviewSettlements.sample[0]).toMatchObject({
        id: settlement.id,
        listingId,
      });
      expect(await marketDb.transitionSettlement(settlement.id, ['review'], 'confirmed')).toBe(
        true,
      );
    });

    it('an under-bound confirming settlement stays with the poll', async () => {
      const realm = `review-young-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling' });
      const settlement = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 0,
        buyerAccount: buyer,
        buyerCharacter: 7000 + seq,
        buyerName: `Buyer${seq}`,
        buyerWallet: `wallet-buyer-${seq}`,
        amountCents: 1000,
        deadlineAtMs: BASE_MS - 20 * MINUTE_MS,
        nowMs: BASE_MS,
      });
      if (typeof settlement === 'string') throw new Error(`fixture settlement: ${settlement}`);
      await pool.query(
        `UPDATE woc_market_settlements
            SET state = 'confirming', tx_signature = $2,
                updated_at = to_timestamp($3 / 1000.0)
          WHERE id = $1`,
        [settlement.id, `young-sig-${seq}`, BASE_MS - 1 * HOUR_MS],
      );
      // Past its DEADLINE but inside the confirming bound: the deadline arm
      // must not catch a confirming row (only offered/failed age on it)...
      const deadline = await marketDb.overdueSettlements(realm, BASE_MS, 10);
      expect(deadline.map((s) => s.id)).not.toContain(settlement.id);
      // ...and the confirming arm's own read must not catch a YOUNG row.
      const overdue = await marketDb.confirmingOverdueSettlements(realm, BASE_MS - 6 * HOUR_MS, 10);
      expect(overdue.map((s) => s.id)).not.toContain(settlement.id);
    });

    it('a bond undecided past the pending TTL rotates out of the poll head', async () => {
      const realm = `poll-rotate-${++seq}`;
      const seller = await seedAccount();
      const listingId = await seedListing(realm, seller);
      // Captured BEFORE seeding: seq moves inside the seeders.
      const oldRef = `rotate-old-${seq}`;
      const youngRef = `rotate-young-${seq}`;
      const oldBond = await seedBid(realm, listingId, await seedAccount(), {
        bondReference: oldRef,
        bondSignature: `rotate-old-sig-${seq}`,
        placedAtMs: BASE_MS - 10 * MINUTE_MS, // past the 5-minute pending TTL
      });
      const youngBond = await seedBid(realm, listingId, await seedAccount(), {
        bondReference: youngRef,
        bondSignature: `rotate-young-sig-${seq}`,
        placedAtMs: BASE_MS - 1 * MINUTE_MS,
      });
      const economy = new ScriptedEconomy(() => BASE_MS);
      economy.verdict = { settled: false, pending: true, reason: null };
      const service = makeService(realm, economy, () => BASE_MS);
      // Pass one polls BOTH; the over-TTL row parks (poll_parked_at stamped,
      // in-process backoff). Pass two re-polls ONLY the young row: a standing
      // set of never-decided signatures can no longer own the batch head.
      await service.sweepPass();
      const confirmsAfterOne = economy.confirms.length;
      expect(economy.confirms.map(([ref]) => ref)).toContain(oldRef);
      expect(economy.confirms.map(([ref]) => ref)).toContain(youngRef);
      const stamped = await pool.query(`SELECT poll_parked_at FROM woc_market_bids WHERE id = $1`, [
        oldBond,
      ]);
      expect(stamped.rows[0].poll_parked_at, 'the over-TTL row rotated').not.toBeNull();
      const young = await pool.query(`SELECT poll_parked_at FROM woc_market_bids WHERE id = $1`, [
        youngBond,
      ]);
      expect(young.rows[0].poll_parked_at, 'the young row keeps full cadence').toBeNull();
      await service.sweepPass();
      const passTwo = economy.confirms.slice(confirmsAfterOne).map(([ref]) => ref);
      expect(passTwo).toContain(youngRef);
      expect(passTwo, 'the parked row is excluded while backing off').not.toContain(oldRef);
    });

    it('the confirming cutoff is INCLUSIVE at the exact bound', async () => {
      const realm = `review-exact-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, { status: 'settling' });
      const settlement = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 0,
        buyerAccount: buyer,
        buyerCharacter: 7000 + seq,
        buyerName: `Buyer${seq}`,
        buyerWallet: `wallet-buyer-${seq}`,
        amountCents: 1000,
        deadlineAtMs: BASE_MS - 20 * MINUTE_MS,
        nowMs: BASE_MS,
      });
      if (typeof settlement === 'string') throw new Error(`fixture settlement: ${settlement}`);
      const cutoff = BASE_MS - 6 * HOUR_MS;
      await pool.query(
        `UPDATE woc_market_settlements
            SET state = 'confirming', tx_signature = $2,
                updated_at = to_timestamp($3 / 1000.0)
          WHERE id = $1`,
        [settlement.id, `exact-sig-${seq}`, cutoff],
      );
      const overdue = await marketDb.confirmingOverdueSettlements(realm, cutoff, 10);
      expect(
        overdue.map((s) => s.id),
        'updated_at <= cutoff includes the bound',
      ).toContain(settlement.id);
    });

    it('a LATE signer keeps the full poll cadence (park ages on the signature, not placement)', async () => {
      const realm = `late-signer-${++seq}`;
      const seller = await seedAccount();
      const listingId = await seedListing(realm, seller);
      // Placed 10 minutes ago (well past the park window) but signed only 1
      // minute ago: aging on placement would park this bond instantly, aging
      // on the signature keeps it in the fast poll. This is the fixture the
      // fix-round reviewer flagged the old test could not distinguish.
      const lateSigned = await seedBid(realm, listingId, await seedAccount(), {
        bondReference: `late-ref-${seq}`,
        bondSignature: `late-sig-${seq}`,
        placedAtMs: BASE_MS - 10 * MINUTE_MS,
        bondSignatureAtMs: BASE_MS - 1 * MINUTE_MS,
      });
      const economy = new ScriptedEconomy(() => BASE_MS);
      economy.verdict = { settled: false, pending: true, reason: null };
      const service = makeService(realm, economy, () => BASE_MS);
      await service.sweepPass();
      const stamped = await pool.query(`SELECT poll_parked_at FROM woc_market_bids WHERE id = $1`, [
        lateSigned,
      ]);
      expect(stamped.rows[0].poll_parked_at, 'a recently-signed bond is NOT parked').toBeNull();
    });

    it('over-aged signed bonds surface in the stuck readout', async () => {
      const realm = `stuck-bonds-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const oldBond = await seedBid(realm, listingId, buyer, {
        bondSignature: `old-sig-${seq}`,
        placedAtMs: BASE_MS - 7 * HOUR_MS,
      });
      await seedBid(realm, listingId, await seedAccount(), {
        bondSignature: `young-sig-b-${seq}`,
        placedAtMs: BASE_MS - 1 * HOUR_MS,
      });
      const readout = await marketDb.stuckCustodyReadout(
        realm,
        BASE_MS,
        10,
        1000,
        BASE_MS - 6 * HOUR_MS,
      );
      expect(readout.stuckBonds.count).toBe(1);
      expect(readout.stuckBonds.sample[0]).toMatchObject({ id: oldBond, listingId });
      // An UNSIGNED old pending bid never enters the class (the signature
      // dimension of the predicate).
      await seedBid(realm, listingId, await seedAccount(), {
        bondSignature: null,
        placedAtMs: BASE_MS - 8 * HOUR_MS,
      });
      const again = await marketDb.stuckCustodyReadout(
        realm,
        BASE_MS,
        10,
        1000,
        BASE_MS - 6 * HOUR_MS,
      );
      expect(again.stuckBonds.count).toBe(1);
    });

    it('the two new readout classes saturate at the count cap', async () => {
      const realm = `saturate-new-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      for (let i = 0; i < 2; i++) {
        const listingId = await seedListing(realm, seller, { status: 'settling' });
        const settlement = await marketDb.insertSettlement({
          listingId,
          bidId: null,
          attempt: 0,
          buyerAccount: buyer,
          buyerCharacter: 7000 + seq,
          buyerName: `Buyer${seq}`,
          buyerWallet: `wallet-buyer-${seq}-${i}`,
          amountCents: 1000,
          deadlineAtMs: BASE_MS - 20 * MINUTE_MS,
          nowMs: BASE_MS,
        });
        if (typeof settlement === 'string') throw new Error(`fixture settlement: ${settlement}`);
        await pool.query(`UPDATE woc_market_settlements SET state = 'review' WHERE id = $1`, [
          settlement.id,
        ]);
        const bidListing = await seedListing(realm, seller);
        await seedBid(realm, bidListing, await seedAccount(), {
          bondSignature: `sat-sig-${seq}-${i}`,
          placedAtMs: BASE_MS - 7 * HOUR_MS,
        });
      }
      const readout = await marketDb.stuckCustodyReadout(realm, BASE_MS, 10, 1, BASE_MS);
      expect(readout.reviewSettlements).toMatchObject({ count: 1, saturated: true });
      expect(readout.stuckBonds).toMatchObject({ count: 1, saturated: true });
    });
  });

  // -------------------------------------------------------------------------
  // Anti-snipe at bond progress
  // -------------------------------------------------------------------------

  describe('anti-snipe rides bond progress', () => {
    it('the extension writes only to an ACTIVE listing', async () => {
      // The status guard inside the extension transaction: a closed or ending
      // row keeps its clock, or a late bond confirmation would perturb a
      // subsequent reopen-then-claim cycle on a listing already resolved.
      const realm = `extend-guard-${++seq}`;
      const seller = await seedAccount();
      const closed = await seedListing(realm, seller, {
        status: 'closed',
        endsAtMs: BASE_MS + MINUTE_MS,
      });
      expect(
        await marketDb.extendAuctionForBondProgress(realm, closed, () => BASE_MS + 10 * MINUTE_MS),
      ).toBe('skip');
      const row = await pool.query(`SELECT ends_at FROM woc_market_listings WHERE id = $1`, [
        closed,
      ]);
      expect((row.rows[0].ends_at as Date).getTime(), 'a closed row keeps its clock').toBe(
        BASE_MS + MINUTE_MS,
      );
      const active = await seedListing(realm, seller, { endsAtMs: BASE_MS + MINUTE_MS });
      expect(
        await marketDb.extendAuctionForBondProgress(realm, active, () => BASE_MS + 10 * MINUTE_MS),
      ).toBe('extended');
    });

    it('extends only on a chain-seen verdict: pending extends, refused does not', async () => {
      const realm = `snipe-verdict-${++seq}`;
      const seller = await seedAccount();
      const refusedBuyer = await seedAccount();
      const pendingBuyer = await seedAccount();
      const endsAtMs = BASE_MS + 60_000; // inside the 120s window
      const listingId = await seedListing(realm, seller, { endsAtMs });
      const economy = new ScriptedEconomy(() => BASE_MS);
      const service = makeService(realm, economy, () => BASE_MS);
      // A fabricated signature the chain REFUSES moves nothing: extending on
      // the raw submission let a random string move the authoritative clock.
      const refused = await seedBid(realm, listingId, refusedBuyer, {
        bondReference: `snipe-refused-${seq}`,
      });
      economy.verdict = { settled: false, pending: false, reason: 'unknown_reference' };
      await service.confirmBond(refusedBuyer, refused, 'sig-fabricated');
      expect(Number((await listingRow(listingId)).ends_ms)).toBe(endsAtMs);
      // A pending verdict that only says THE SERVICE WAS DOWN extends
      // nothing either: the proxy maps an unreachable economy to
      // pending + service_unavailable (correct fail-safe for money), and
      // extending on that arm would hand a fabricated signature the clock
      // again for the length of any outage.
      const outage = await seedBid(realm, listingId, await seedAccount(), {
        bondReference: `snipe-outage-${seq}`,
      });
      economy.verdict = { settled: false, pending: true, reason: 'service_unavailable' };
      const outageOut = await service.confirmBond(
        (await pool.query(`SELECT account FROM woc_market_bids WHERE id = $1`, [outage])).rows[0]
          .account,
        outage,
        'sig-during-outage',
      );
      expect(outageOut).toEqual({
        ok: true,
        standing: false,
        pending: true,
        reason: 'service_unavailable',
      });
      expect(Number((await listingRow(listingId)).ends_ms)).toBe(endsAtMs);
      // A pending verdict where the ledger has shown NOTHING for the
      // signature extends nothing: a fabricated string mints not_yet_visible
      // forever, and the old any-pending gate handed it the clock.
      const unseen = await seedBid(realm, listingId, await seedAccount(), {
        bondReference: `snipe-unseen-${seq}`,
      });
      economy.verdict = { settled: false, pending: true, reason: 'not_yet_visible' };
      const unseenOut = await service.confirmBond(
        (await pool.query(`SELECT account FROM woc_market_bids WHERE id = $1`, [unseen])).rows[0]
          .account,
        unseen,
        'sig-never-broadcast',
      );
      // The outcome shape proves the PENDING arm was reached: a refusal for
      // an unrelated reason would also leave the close unmoved.
      expect(unseenOut).toEqual({
        ok: true,
        standing: false,
        pending: true,
        reason: 'not_yet_visible',
      });
      expect(Number((await listingRow(listingId)).ends_ms)).toBe(endsAtMs);
      // The verdict the chain has SEEN (matched, pending finality) is the ONE
      // pending word that earns the extension.
      const paying = await seedBid(realm, listingId, pendingBuyer, {
        bondReference: `snipe-pending-${seq}`,
      });
      economy.verdict = { settled: false, pending: true, reason: 'awaiting_finality' };
      await service.confirmBond(pendingBuyer, paying, 'sig-in-flight');
      expect(Number((await listingRow(listingId)).ends_ms)).toBe(
        BASE_MS + rulesMod.WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS * 1000,
      );
    });

    it('placement no longer moves the close; the recorded signature does', async () => {
      const realm = `snipe-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const endsAtMs = BASE_MS + 60_000; // inside the 120s window
      const listingId = await seedListing(realm, seller, { endsAtMs });
      const inserted = await marketDb.insertPendingBid({
        realm,
        listingId,
        account: buyer,
        characterId: 8000 + seq,
        characterName: `Bidder${seq}`,
        wallet: `wallet-snipe-${seq}`,
        amountCents: 700,
        bondCents: 70,
        nowMs: BASE_MS,
        minNext: () => 0,
      });
      expect(inserted.ok).toBe(true);
      // The old placement-time arm extended here with no money down.
      expect(Number((await listingRow(listingId)).ends_ms)).toBe(endsAtMs);
      // Bond progress extends, same pure cap math as before.
      const out = await marketDb.extendAuctionForBondProgress(realm, listingId, (row) =>
        rulesMod.antiSnipeExtendedEndMs(BASE_MS, row.endsAtMs, row.baseEndsAtMs),
      );
      expect(out).toBe('extended');
      expect(Number((await listingRow(listingId)).ends_ms)).toBe(
        BASE_MS + rulesMod.WOC_MARKET_ANTI_SNIPE_EXTENSION_SECONDS * 1000,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Bounded lock waits on the bid paths: a held listing row answers the typed
  // 'contended' refusal within the ESCROW_LOCK_TIMEOUT_MS deadline instead of
  // camping a pooled client for the 15s session statement_timeout (the two
  // sites were the last withTx guards with no lock_timeout of their own).
  // -------------------------------------------------------------------------

  describe('bounded lock waits on the bid paths', () => {
    it('a bid against a held listing row gets the retryable refusal within the deadline', async () => {
      const realm = `lockwait-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT 1 FROM woc_market_listings WHERE id = $1 FOR UPDATE`, [
          listingId,
        ]);
        const counters = await import('../server/woc_market_db');
        const idleBefore = counters.wocMarketIdleTxKillCount();
        const lockBefore = counters.wocMarketLockWaitTimeoutCount();
        const startedAt = Date.now();
        const out = await marketDb.insertPendingBid({
          realm,
          listingId,
          account: buyer,
          characterId: 8000 + seq,
          characterName: `Bidder${seq}`,
          wallet: `wallet-lockwait-${seq}`,
          amountCents: 700,
          bondCents: 70,
          nowMs: BASE_MS,
          minNext: () => 0,
        });
        const elapsedMs = Date.now() - startedAt;
        expect(out).toEqual({ ok: false, reason: 'contended' });
        // The refusal must come from the 2s lock_timeout actually WAITING and
        // firing: near the bound from below (not an instant refusal on some
        // other arm) and decisively under the 15s session statement_timeout
        // that bounded this wait before the lock_timeout existed.
        expect(elapsedMs).toBeGreaterThanOrEqual(1_500);
        expect(elapsedMs).toBeLessThan(10_000);
        // The 55P03 lands on ITS counter and stays OFF the idle-kill one: a
        // real lock-timeout fire against real Postgres, so a future fold of
        // 55P03 into the 25P03 arm poisons a pinned metric here.
        expect(counters.wocMarketLockWaitTimeoutCount()).toBe(lockBefore + 1);
        expect(counters.wocMarketIdleTxKillCount()).toBe(idleBefore);
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }
    }, 20_000);

    it('bond-poll activation against a held listing row answers contended within the deadline', async () => {
      const realm = `lockwait-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, buyer, { status: 'pending_bond' });
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query(`SELECT 1 FROM woc_market_listings WHERE id = $1 FOR UPDATE`, [
          listingId,
        ]);
        const counters = await import('../server/woc_market_db');
        const idleBefore = counters.wocMarketIdleTxKillCount();
        const lockBefore = counters.wocMarketLockWaitTimeoutCount();
        const startedAt = Date.now();
        const out = await marketDb.activateBid(bidId, BASE_MS);
        const elapsedMs = Date.now() - startedAt;
        // The poll simply retries next pass; the deadline is what keeps the
        // sweep's pooled client out of a crossing finalize's 60s heavy
        // allowance.
        expect(out).toBe('contended');
        expect(elapsedMs).toBeGreaterThanOrEqual(1_500);
        expect(elapsedMs).toBeLessThan(10_000);
        expect(counters.wocMarketLockWaitTimeoutCount()).toBe(lockBefore + 1);
        expect(counters.wocMarketIdleTxKillCount(), 'a lock wait is not an idle kill').toBe(
          idleBefore,
        );
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }
    }, 20_000);
  });

  describe('the NO KEY narrowing (write-path rider): FK-child inserts freed, exclusion kept', () => {
    it('a guard-held listing row admits a bid-row insert; plain FOR UPDATE provably blocked it', async () => {
      const realm = `nokey-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidInsert = `INSERT INTO woc_market_bids (
           listing_id, realm, account, character_id, character_name, wallet,
           amount_cents, status, bond_cents, bond_state, placed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 700, 'pending_bond', 70, 'pending', now())`;
      const holder = await pool.connect();
      const child = await pool.connect();
      try {
        // The guard's exact narrowed mode: the FK KEY SHARE the child INSERT
        // takes on the listing row no longer conflicts, so the insert
        // proceeds WHILE the guard transaction runs. "Freed" means it never
        // waits at all, not that it survived a wait: well under the bound.
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM woc_market_listings WHERE id = $1 FOR NO KEY UPDATE', [
          listingId,
        ]);
        await child.query('BEGIN');
        await child.query('SET LOCAL lock_timeout = 1500');
        const startedAt = Date.now();
        await child.query(bidInsert, [
          listingId,
          realm,
          buyer,
          9100 + seq,
          `NoKey${seq}`,
          `wallet-nokey-${seq}`,
        ]);
        expect(Date.now() - startedAt).toBeLessThan(1_000);
        await child.query('ROLLBACK');
        await holder.query('ROLLBACK');

        // The negative control: the OLD mode blocks the identical insert,
        // which is what makes the arm above evidence of the narrowing rather
        // than FK-locking trivia that was always true.
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM woc_market_listings WHERE id = $1 FOR UPDATE', [
          listingId,
        ]);
        await child.query('BEGIN');
        await child.query('SET LOCAL lock_timeout = 1200');
        await expect(
          child.query(bidInsert, [
            listingId,
            realm,
            buyer,
            9200 + seq,
            `NoKeyB${seq}`,
            `wallet-nokeyb-${seq}`,
          ]),
        ).rejects.toMatchObject({ code: '55P03' });
        await child.query('ROLLBACK');
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        await child.query('ROLLBACK').catch(() => {});
        holder.release();
        child.release();
      }
    }, 20_000);

    it('the escrow accounts hold admits the abandon recorder; plain FOR UPDATE provably blocked it', async () => {
      // escrowInsertListing's exact accounts statement against the abandon
      // INSERT's FK KEY SHARE on the same row: the 05 blast-radius note
      // (under the old mode the account could not insert into ANY table
      // referencing accounts(id) while its escrow ran) stops being true.
      const realm = `nokey-acct-${++seq}`;
      const seller = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const abandonInsert = `INSERT INTO woc_market_buy_now_abandons (realm, listing_id, account, lock_expires)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))`;
      const holder = await pool.connect();
      const child = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM accounts WHERE id = $1 FOR NO KEY UPDATE', [seller]);
        await child.query('BEGIN');
        await child.query('SET LOCAL lock_timeout = 1500');
        const startedAt = Date.now();
        await child.query(abandonInsert, [realm, listingId, seller, BASE_MS]);
        expect(Date.now() - startedAt).toBeLessThan(1_000);
        await child.query('ROLLBACK');
        await holder.query('ROLLBACK');

        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', [seller]);
        await child.query('BEGIN');
        await child.query('SET LOCAL lock_timeout = 1200');
        await expect(
          child.query(abandonInsert, [realm, listingId, seller, BASE_MS + 1000]),
        ).rejects.toMatchObject({ code: '55P03' });
        await child.query('ROLLBACK');
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        await child.query('ROLLBACK').catch(() => {});
        holder.release();
        child.release();
      }
    }, 20_000);

    it('a plain writer against a held row refuses at the 2s bound as a counted 55P03', async () => {
      // The bounded plain-write seam, proven against real Postgres: before
      // the rider, setBondState (and its 36 siblings) waited the full 15s
      // session default on a contended row with the failure unclassified;
      // now the wait dies at the guard lock ceiling and lands on the
      // lock-wait counter like every guard transaction's.
      const realm = `plainwrite-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      const bidId = await seedBid(realm, listingId, buyer, { status: 'pending_bond' });
      const holder = await pool.connect();
      try {
        await holder.query('BEGIN');
        await holder.query('SELECT 1 FROM woc_market_bids WHERE id = $1 FOR NO KEY UPDATE', [
          bidId,
        ]);
        const counters = await import('../server/woc_market_db');
        const lockBefore = counters.wocMarketLockWaitTimeoutCount();
        const idleBefore = counters.wocMarketIdleTxKillCount();
        const startedAt = Date.now();
        await expect(marketDb.setBondState(bidId, ['pending'], 'held')).rejects.toMatchObject({
          code: '55P03',
        });
        const elapsedMs = Date.now() - startedAt;
        expect(elapsedMs).toBeGreaterThanOrEqual(1_500);
        expect(elapsedMs).toBeLessThan(10_000);
        expect(counters.wocMarketLockWaitTimeoutCount()).toBe(lockBefore + 1);
        expect(counters.wocMarketIdleTxKillCount()).toBe(idleBefore);
      } finally {
        await holder.query('ROLLBACK').catch(() => {});
        holder.release();
      }
    }, 20_000);

    it('same-account escrow holds still serialize: NO KEY UPDATE conflicts with itself', async () => {
      // The cap's whole serialization argument rests on this: two escrow
      // transactions for ONE account queue on the accounts row exactly as
      // before the narrowing. The waiter fires its 55P03 at the bound while
      // the holder stands, having genuinely WAITED; commit the holder and
      // the identical statement proceeds.
      const account = await seedAccount();
      const a = await pool.connect();
      const b = await pool.connect();
      try {
        await a.query('BEGIN');
        await a.query('SELECT 1 FROM accounts WHERE id = $1 FOR NO KEY UPDATE', [account]);
        await b.query('BEGIN');
        await b.query('SET LOCAL lock_timeout = 1200');
        const startedAt = Date.now();
        await expect(
          b.query('SELECT 1 FROM accounts WHERE id = $1 FOR NO KEY UPDATE', [account]),
        ).rejects.toMatchObject({ code: '55P03' });
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000);
        await b.query('ROLLBACK');
        await a.query('COMMIT');
        await b.query('BEGIN');
        await b.query('SET LOCAL lock_timeout = 1200');
        await b.query('SELECT 1 FROM accounts WHERE id = $1 FOR NO KEY UPDATE', [account]);
        await b.query('ROLLBACK');
      } finally {
        await a.query('ROLLBACK').catch(() => {});
        await b.query('ROLLBACK').catch(() => {});
        a.release();
        b.release();
      }
    }, 20_000);
  });

  // -------------------------------------------------------------------------
  // The abandon-loop defenses (both ruling arms)
  // -------------------------------------------------------------------------

  describe('buy-now claim cooldowns', () => {
    it('an abandoner cannot steal their own expired lock back (the re-claim loop)', async () => {
      const realm = `cooldown-${++seq}`;
      const seller = await seedAccount();
      const griefer = await seedAccount();
      const honest = await seedAccount();
      const listingId = await seedListing(realm, seller, {
        lockAccount: griefer,
        lockExpiresAtMs: BASE_MS - 1_000, // expired unpaid
      });
      // The steal is the first look at the dead lock: it records the abandon
      // and the recording itself refuses the same account's re-claim. The old
      // code let this loop forever at zero cost.
      const again = await marketDb.claimBuyNowLock(
        realm,
        listingId,
        griefer,
        BASE_MS,
        BASE_MS + 270_000,
      );
      // The refusal names WHEN a retry can first succeed: the just-recorded
      // abandon's window end plus the re-claim cooldown (the only live arm:
      // one abandon sits under the hourly cap).
      expect(again).toEqual({
        refusal: 'claim_cooldown',
        retryAtMs: BASE_MS - 1_000 + rulesMod.WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS * 1000,
      });
      const ledger = await pool.query(
        `SELECT account FROM woc_market_buy_now_abandons WHERE listing_id = $1`,
        [listingId],
      );
      expect(ledger.rows).toEqual([{ account: griefer }]);
      // A DIFFERENT account claims the freed listing normally.
      const stolen = await marketDb.claimBuyNowLock(
        realm,
        listingId,
        honest,
        BASE_MS,
        BASE_MS + 270_000,
      );
      expect(typeof stolen).not.toBe('string');
      // The holder guard: the old holder's unwind clear cannot wipe the new
      // claimer's live lock (the old clear had no guard).
      await marketDb.clearBuyNowLock(listingId, griefer);
      expect((await listingRow(listingId)).buy_now_lock_account).toBe(honest);
    });

    it('the per-listing cooldown ages out on its own', async () => {
      const realm = `cooldown-age-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      await marketDb.recordBuyNowAbandon(realm, listingId, buyer, BASE_MS - 1_000);
      // Inside the window the re-claim refuses; one second past it, the block
      // lifts by itself (a permanent per-listing ban would fail here).
      expect(
        await marketDb.claimBuyNowLock(realm, listingId, buyer, BASE_MS, BASE_MS + 270_000),
      ).toEqual({
        refusal: 'claim_cooldown',
        retryAtMs: BASE_MS - 1_000 + rulesMod.WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS * 1000,
      });
      const later = BASE_MS + rulesMod.WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS * 1000;
      const ok = await marketDb.claimBuyNowLock(realm, listingId, buyer, later, later + 270_000);
      expect(typeof ok).not.toBe('string');
    });

    it('the announced retry moment is the FIRST admissible one, on both arms', async () => {
      // The honesty contract behind retryAfterSeconds: a claim at EXACTLY
      // retryAtMs succeeds. Both probes compare strictly (lock_expires > the
      // window cutoff), which is what puts the boundary on the admissible
      // side; a >= would keep refusing at the announced moment (a '1 second'
      // answer once more), and the pins above retry well past it, so only
      // this case can see it. One second before, still refused.
      const realm = `cooldown-boundary-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller);
      await marketDb.recordBuyNowAbandon(realm, listingId, buyer, BASE_MS - 1_000);
      const refused = await marketDb.claimBuyNowLock(
        realm,
        listingId,
        buyer,
        BASE_MS,
        BASE_MS + 270_000,
      );
      if (typeof refused === 'string' || !('retryAtMs' in refused)) {
        throw new Error(`expected a cooldown refusal, got ${JSON.stringify(refused)}`);
      }
      const at = refused.retryAtMs;
      expect(
        await marketDb.claimBuyNowLock(realm, listingId, buyer, at - 1_000, at + 269_000),
      ).toMatchObject({ refusal: 'claim_cooldown' });
      const atBoundary = await marketDb.claimBuyNowLock(realm, listingId, buyer, at, at + 270_000);
      expect(typeof atBoundary, 'the per-listing arm admits the claim at retryAtMs').not.toBe(
        'string',
      );
      expect(atBoundary).not.toMatchObject({ refusal: 'claim_cooldown' });
      // The cap arm: cap abandons on other listings, then a fresh listing
      // claimed at exactly the moment the cap-th newest leaves the window.
      const griefer = await seedAccount();
      for (let i = 0; i < rulesMod.WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR; i++) {
        const other = await seedListing(realm, seller);
        await marketDb.recordBuyNowAbandon(realm, other, griefer, BASE_MS - (i + 1) * MINUTE_MS);
      }
      const fresh = await seedListing(realm, seller);
      const capped = await marketDb.claimBuyNowLock(
        realm,
        fresh,
        griefer,
        BASE_MS,
        BASE_MS + 270_000,
      );
      if (typeof capped === 'string' || !('retryAtMs' in capped)) {
        throw new Error(`expected a cap refusal, got ${JSON.stringify(capped)}`);
      }
      const capAt = capped.retryAtMs;
      expect(
        await marketDb.claimBuyNowLock(realm, fresh, griefer, capAt - 1_000, capAt + 269_000),
      ).toMatchObject({ refusal: 'claim_cooldown' });
      const capBoundary = await marketDb.claimBuyNowLock(
        realm,
        fresh,
        griefer,
        capAt,
        capAt + 270_000,
      );
      expect(typeof capBoundary, 'the cap arm admits the claim at retryAtMs').not.toBe('string');
      expect(capBoundary).not.toMatchObject({ refusal: 'claim_cooldown' });
    });

    it('the account-wide cap allows the claim BELOW the cap and refuses AT it', async () => {
      const realm = `cap-${++seq}`;
      const seller = await seedAccount();
      const griefer = await seedAccount();
      // Cap minus one abandons: still allowed (pins the threshold from below,
      // so a quietly tightened cap reds here). Derived from the constant so a
      // raised cap keeps the fixture AT the boundary.
      for (let i = 0; i < rulesMod.WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR - 1; i++) {
        const otherListing = await seedListing(realm, seller);
        await marketDb.recordBuyNowAbandon(
          realm,
          otherListing,
          griefer,
          BASE_MS - (i + 1) * MINUTE_MS,
        );
      }
      const below = await seedListing(realm, seller);
      const allowed = await marketDb.claimBuyNowLock(
        realm,
        below,
        griefer,
        BASE_MS,
        BASE_MS + 270_000,
      );
      expect(typeof allowed).not.toBe('string');
      // The cap-th abandon trips the cap for every further public claim.
      const third = await seedListing(realm, seller);
      await marketDb.recordBuyNowAbandon(
        realm,
        third,
        griefer,
        BASE_MS - rulesMod.WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR * MINUTE_MS,
      );
      const fresh = await seedListing(realm, seller);
      // Cap-only refusal (a FRESH listing, no per-listing arm): the retry
      // moment is the cap-th newest abandon leaving the rolling window.
      expect(
        await marketDb.claimBuyNowLock(realm, fresh, griefer, BASE_MS, BASE_MS + 270_000),
      ).toEqual({
        refusal: 'claim_cooldown',
        retryAtMs:
          BASE_MS -
          rulesMod.WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR * MINUTE_MS +
          rulesMod.WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS * 1000,
      });
      // The window is ROLLING: once the abandons age out, the claim works.
      const later = BASE_MS + rulesMod.WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS * 1000;
      const ok = await marketDb.claimBuyNowLock(realm, fresh, griefer, later, later + 270_000);
      expect(typeof ok).not.toBe('string');
    });

    it('a paying holder is never stamped: an open settlement refuses the rival probe instead', async () => {
      const realm = `paying-holder-${++seq}`;
      const seller = await seedAccount();
      const holder = await seedAccount();
      const rival = await seedAccount();
      // The holder's window EXPIRED while their payment is mid-confirmation:
      // the listing stays active through confirming, so this is exactly the
      // shape a rival's claim probe hits.
      const listingId = await seedListing(realm, seller, {
        lockAccount: holder,
        lockExpiresAtMs: BASE_MS - 1_000,
      });
      const settlement = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 0,
        buyerAccount: holder,
        buyerCharacter: 7000 + seq,
        buyerName: `Holder${seq}`,
        buyerWallet: `wallet-holder-${seq}`,
        amountCents: 1000,
        deadlineAtMs: BASE_MS - 1_000,
        nowMs: BASE_MS - 300_000,
      });
      if (typeof settlement === 'string') throw new Error(`fixture settlement: ${settlement}`);
      await pool.query(
        `UPDATE woc_market_settlements SET state = 'confirming', tx_signature = $2 WHERE id = $1`,
        [settlement.id, `paying-${seq}`],
      );
      expect(
        await marketDb.claimBuyNowLock(realm, listingId, rival, BASE_MS, BASE_MS + 270_000),
      ).toBe('locked');
      const ledger = await pool.query(
        `SELECT 1 FROM woc_market_buy_now_abandons WHERE listing_id = $1`,
        [listingId],
      );
      expect(ledger.rowCount, 'no unearned abandon row').toBe(0);
    });

    it('the steal recorder shares the exempt-window predicate (no drift with the sweep)', async () => {
      const realm = `steal-exempt-${++seq}`;
      const seller = await seedAccount();
      const holder = await seedAccount();
      const rival = await seedAccount();
      const lockExpiresAtMs = BASE_MS - 1_000;
      const listingId = await seedListing(realm, seller, {
        lockAccount: holder,
        lockExpiresAtMs,
      });
      // The holder TRIED during an OUTAGE: their expired window carries a
      // signature and the infrastructure verdict (the one exempt class:
      // quote_expired was removed as attacker-mintable), already expired by
      // the sweep. The rival's steal must not stamp them (the sibling
      // recorder used to have no exemption at all).
      const settlement = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 0,
        buyerAccount: holder,
        buyerCharacter: 7000 + seq,
        buyerName: `Holder${seq}`,
        buyerWallet: `wallet-holder-${seq}`,
        amountCents: 1000,
        deadlineAtMs: lockExpiresAtMs,
        nowMs: BASE_MS - 300_000,
      });
      if (typeof settlement === 'string') throw new Error(`fixture settlement: ${settlement}`);
      await pool.query(
        `UPDATE woc_market_settlements
            SET state = 'expired', tx_signature = $2, fail_reason = 'service_unavailable'
          WHERE id = $1`,
        [settlement.id, `steal-exempt-`],
      );
      const stolen = await marketDb.claimBuyNowLock(
        realm,
        listingId,
        rival,
        BASE_MS,
        BASE_MS + 270_000,
      );
      expect(typeof stolen, 'the dead window is claimable').not.toBe('string');
      const ledger = await pool.query(
        `SELECT 1 FROM woc_market_buy_now_abandons WHERE listing_id = $1`,
        [listingId],
      );
      expect(ledger.rowCount, 'the tried holder is not stamped').toBe(0);
    });

    it('an idle-stalled guard transaction surfaces as contended, never a raw 500', async () => {
      // The REAL 25P03 path: the idle-in-transaction timeout terminates the
      // SESSION and the SQLSTATE arrives asynchronously on the client error
      // event (a synthetic {code:'25P03'} unit stub passes even when this is
      // broken). The extension callback runs INSIDE the guard transaction,
      // so a synchronous stall past the timeout reproduces the event-loop
      // pause the bound exists for.
      const realm = `idle-stall-${++seq}`;
      const seller = await seedAccount();
      const listingId = await seedListing(realm, seller, { endsAtMs: BASE_MS + 60_000 });
      const out = await marketDb.extendAuctionForBondProgress(realm, listingId, (row) => {
        const until = Date.now() + 2_600; // past GUARD_IDLE_TX_TIMEOUT_MS (2000)
        while (Date.now() < until) {
          // A busy event loop: the session sits idle-in-transaction.
        }
        return row.endsAtMs + 60_000;
      });
      expect(out, 'typed contention, not an unhandled throw').toBe('contended');
      // And the pool survives the discarded session: the next read works.
      expect(Number((await listingRow(listingId)).ends_ms)).toBe(BASE_MS + 60_000);
    }, 20_000);

    it('an ASYNC stall (awaited work between queries) still surfaces the 25P03 code', async () => {
      // The OTHER measured stall shape (the busy-loop test above covers the
      // event-loop pause): here the transaction AWAITS real async work while
      // the session sits idle, so the terminated session's SQLSTATE arrives
      // on the client error event mid-sleep and the NEXT query rejects with
      // a codeless not-queryable shell. Only withTx's captured async error
      // carries 25P03, which is what isLockContention (and so every guard's
      // typed 'contended') keys on; dropping the capture preference reds
      // exactly this. Driven through the private withTx seam because every
      // public guard's callback is synchronous by design.
      const db = marketDb as unknown as {
        withTx<T>(fn: (client: { query(sql: string): Promise<unknown> }) => Promise<T>): Promise<T>;
      };
      let thrown: unknown = null;
      try {
        await db.withTx(async (client) => {
          await client.query(`SET LOCAL idle_in_transaction_session_timeout = 500`);
          await new Promise((resolve) => setTimeout(resolve, 900));
          await client.query('SELECT 1');
        });
      } catch (err) {
        thrown = err;
      }
      expect(
        (thrown as { code?: string } | null)?.code,
        'the captured async 25P03 must win over the codeless shell',
      ).toBe('25P03');
    }, 20_000);

    it('a directed dead lock records nothing at steal time', async () => {
      const realm = `directed-steal-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const directed = await seedListing(realm, seller, {
        directedBuyerAccount: buyer,
        lockAccount: buyer,
        lockExpiresAtMs: BASE_MS - 1_000,
      });
      // The directed buyer re-claims their own expired window: allowed (no
      // cooldowns on the directed rail) and NO ledger row (directed abandons
      // keep their strike instead).
      const out = await marketDb.claimBuyNowLock(
        realm,
        directed,
        buyer,
        BASE_MS,
        BASE_MS + 270_000,
      );
      expect(typeof out).not.toBe('string');
      const ledger = await pool.query(
        `SELECT 1 FROM woc_market_buy_now_abandons WHERE listing_id = $1`,
        [directed],
      );
      expect(ledger.rowCount).toBe(0);
    });

    it('a refusal never blocks behind a held row lock (the lock-free diagnosis)', async () => {
      const realm = `lockfree-${++seq}`;
      const seller = await seedAccount();
      const holder = await seedAccount();
      const rival = await seedAccount();
      const listingId = await seedListing(realm, seller, {
        lockAccount: holder,
        lockExpiresAtMs: BASE_MS + 4 * MINUTE_MS,
      });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT 1 FROM woc_market_listings WHERE id = $1 FOR UPDATE`, [
          listingId,
        ]);
        // The rival's refusal ('locked': the window is live) must resolve
        // while the row lock is HELD: on the old shape every refusal
        // serialized behind the holder with a pooled client pinned.
        const verdict = await Promise.race([
          marketDb.claimBuyNowLock(realm, listingId, rival, BASE_MS, BASE_MS + 270_000),
          new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 500)),
        ]);
        expect(verdict).toBe('locked');
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }, 20_000);

    it('a cooled-down claim refuses lock-free too, never behind a held row lock', async () => {
      // The cooldown probes moved into the advisory pass: a cooled-down
      // account retrying at the rate limit must not take (or wait on) the
      // listing FOR UPDATE just to be refused, or the proven-abusive caller
      // is exactly the one granted a lock that blocks bids and the seller
      // cancel. The committed ledger row makes the advisory answer safe (only
      // the 30-day retention removes one, far outside every cooldown window).
      const realm = `lockfree-cooled-${++seq}`;
      const seller = await seedAccount();
      const cooled = await seedAccount();
      const listingId = await seedListing(realm, seller);
      await marketDb.recordBuyNowAbandon(realm, listingId, cooled, BASE_MS - MINUTE_MS);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT 1 FROM woc_market_listings WHERE id = $1 FOR UPDATE`, [
          listingId,
        ]);
        const verdict = await Promise.race([
          marketDb.claimBuyNowLock(realm, listingId, cooled, BASE_MS, BASE_MS + 270_000),
          new Promise<'blocked'>((r) => setTimeout(() => r('blocked'), 500)),
        ]);
        expect(verdict).toEqual({
          refusal: 'claim_cooldown',
          retryAtMs:
            BASE_MS - MINUTE_MS + rulesMod.WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS * 1000,
        });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    }, 20_000);

    it('an at-cap self-steal still records its own abandon before refusing', async () => {
      // The advisory shortcut must NOT answer over a recordable expired
      // lock: an account already at the hourly cap, re-claiming its own
      // expired window, would otherwise be refused lock-free with THAT
      // abandon never booked, so its per-listing cooldown never started and
      // the same listing was re-claimable the moment the hourly window
      // rolled off.
      const realm = `atcap-selfsteal-${++seq}`;
      const seller = await seedAccount();
      const abuser = await seedAccount();
      for (let i = 0; i < rulesMod.WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR; i++) {
        const otherListing = await seedListing(realm, seller);
        await marketDb.recordBuyNowAbandon(realm, otherListing, abuser, BASE_MS - (i + 1) * 1000);
      }
      const listingId = await seedListing(realm, seller, {
        lockAccount: abuser,
        lockExpiresAtMs: BASE_MS - MINUTE_MS,
      });
      // Both arms refuse here and the LATER moment wins: the hourly cap's
      // drain (the cap-th newest of the now cap-plus-one in-window rows, the
      // one seeded cap seconds back, leaving the rolling window) is later
      // than this listing's re-claim cooldown (-60s + 30 min), pinning the
      // max-combining rule.
      expect(
        await marketDb.claimBuyNowLock(realm, listingId, abuser, BASE_MS, BASE_MS + 270_000),
      ).toEqual({
        refusal: 'claim_cooldown',
        retryAtMs:
          BASE_MS -
          rulesMod.WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR * 1_000 +
          rulesMod.WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS * 1000,
      });
      const booked = await pool.query(
        `SELECT 1 FROM woc_market_buy_now_abandons WHERE listing_id = $1 AND account = $2`,
        [listingId, abuser],
      );
      expect(booked.rowCount, 'the fourth abandon was recorded').toBe(1);
    });

    it('when THIS listing re-claim cooldown outlasts the cap drain, the reclaim moment wins', async () => {
      // The other direction of the max-combining rule: the case above has the
      // cap drain later; here the per-listing cooldown is the later moment
      // (a fresh abandon on this listing 5 minutes ago under a 30-minute
      // cooldown, while the cap-th newest in-window abandon is 45 minutes old
      // and drains in 15). A "cap wins when present" combiner would send the
      // player back 10 minutes before this listing admits them.
      const realm = `reclaim-later-${++seq}`;
      const seller = await seedAccount();
      const abuser = await seedAccount();
      const cap = rulesMod.WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR;
      const windowMs = rulesMod.WOC_MARKET_BUY_NOW_ABANDON_WINDOW_SECONDS * 1000;
      const cooldownMs = rulesMod.WOC_MARKET_BUY_NOW_RECLAIM_COOLDOWN_SECONDS * 1000;
      const capBoundaryMs = BASE_MS - 45 * MINUTE_MS;
      const reclaimSeedMs = BASE_MS - 5 * MINUTE_MS;
      // The fixture's premise, stated so a tunable change fails loudly here
      // rather than silently flipping which arm is later.
      expect(reclaimSeedMs + cooldownMs).toBeGreaterThan(capBoundaryMs + windowMs);
      const listingId = await seedListing(realm, seller);
      await marketDb.recordBuyNowAbandon(realm, listingId, abuser, reclaimSeedMs);
      // Older abandons on OTHER listings fill the cap: with the fresh one they
      // number cap, and the cap-th newest is the 45-minute-old boundary.
      for (let i = 0; i < cap - 1; i++) {
        const other = await seedListing(realm, seller);
        await marketDb.recordBuyNowAbandon(realm, other, abuser, capBoundaryMs - i * 1000);
      }
      expect(
        await marketDb.claimBuyNowLock(realm, listingId, abuser, BASE_MS, BASE_MS + 270_000),
      ).toEqual({ refusal: 'claim_cooldown', retryAtMs: reclaimSeedMs + cooldownMs });
    });

    it('a directed buyer is exempt from the public-loop cooldowns', async () => {
      const realm = `directed-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      for (let i = 0; i < 3; i++) {
        const otherListing = await seedListing(realm, seller);
        await marketDb.recordBuyNowAbandon(
          realm,
          otherListing,
          buyer,
          BASE_MS - (i + 1) * MINUTE_MS,
        );
      }
      const directed = await seedListing(realm, seller, { directedBuyerAccount: buyer });
      const out = await marketDb.claimBuyNowLock(
        realm,
        directed,
        buyer,
        BASE_MS,
        BASE_MS + 270_000,
      );
      // The seller CHOSE this buyer; public-loop history must not block the
      // directed sale (its own defense is the strike system).
      expect(typeof out).not.toBe('string');
    });
  });

  describe('seller cancel-intent', () => {
    it('stamps an unpaid locked window, blocks new claims and bids, then converges closed', async () => {
      const realm = `intent-${++seq}`;
      const seller = await seedAccount();
      const holder = await seedAccount();
      const rival = await seedAccount();
      const lockExpiresAtMs = BASE_MS + 4 * MINUTE_MS;
      const listingId = await seedListing(realm, seller, {
        lockAccount: holder,
        lockExpiresAtMs,
      });
      // The old cancel refused buy_now_pending here, and the loop re-locked
      // before the seller could ever come back.
      const out = await marketDb.cancelListingIfUnbid(realm, listingId, seller, BASE_MS);
      expect(out).toBe('cancel_pending');
      const stamped = await listingRow(listingId);
      expect(stamped.status).toBe('active');
      expect(stamped.cancel_requested_at).not.toBeNull();
      // The holder keeps their window; everyone else is done here.
      expect(stamped.buy_now_lock_account).toBe(holder);
      expect(
        await marketDb.claimBuyNowLock(realm, listingId, rival, BASE_MS, BASE_MS + 270_000),
      ).toBe('cancel_pending');
      const bid = await marketDb.insertPendingBid({
        realm,
        listingId,
        account: rival,
        characterId: 8000 + seq,
        characterName: `Rival${seq}`,
        wallet: `wallet-rival-${seq}`,
        amountCents: 700,
        bondCents: 70,
        nowMs: BASE_MS,
        minNext: () => 0,
      });
      expect(bid).toEqual({ ok: false, reason: 'cancel_pending' });
      // Inside the window the converge arm waits...
      expect(await marketDb.closeCancelPendingListing(realm, listingId, BASE_MS)).toBe('skip');
      // ...and once the window ends unpaid it closes cancelled.
      const after = lockExpiresAtMs + 1;
      expect(
        (await marketDb.cancelPendingListings(realm, after, 10, [])).map((l) => l.id),
      ).toContain(listingId);
      const closed = await marketDb.closeCancelPendingListing(realm, listingId, after);
      expect(typeof closed).not.toBe('string');
      expect(await listingRow(listingId)).toMatchObject({
        status: 'closed',
        resolution: 'cancelled',
      });
    });

    it('a converge skip rolls its speculative failed-expiry back', async () => {
      const realm = `intent-rollback-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const listingId = await seedListing(realm, seller, {
        cancelRequestedAtMs: BASE_MS - MINUTE_MS,
      });
      // The cascade shape: a retry-eligible 'failed' row beside a live open
      // one. The converge must SKIP (the open row) and leave the failed row
      // UNTOUCHED: expiring it while skipping would silently drop the overdue
      // deadline pass (default, forfeit, strike) and strand its held bond,
      // the exact hole the sibling cancel's TxAbort exists for.
      const failed = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 0,
        buyerAccount: buyer,
        buyerCharacter: 7000 + seq,
        buyerName: `Buyer${seq}`,
        buyerWallet: `wallet-buyer-${seq}`,
        amountCents: 1000,
        deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
        nowMs: BASE_MS,
      });
      if (typeof failed === 'string') throw new Error(`fixture settlement: ${failed}`);
      await pool.query(`UPDATE woc_market_settlements SET state = 'failed' WHERE id = $1`, [
        failed.id,
      ]);
      const open = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 1,
        buyerAccount: buyer,
        buyerCharacter: 7000 + seq,
        buyerName: `Buyer${seq}`,
        buyerWallet: `wallet-buyer-${seq}`,
        amountCents: 1000,
        deadlineAtMs: BASE_MS + 15 * MINUTE_MS,
        nowMs: BASE_MS,
      });
      if (typeof open === 'string') throw new Error(`fixture settlement: ${open}`);
      expect(await marketDb.closeCancelPendingListing(realm, listingId, BASE_MS)).toBe('skip');
      const after = await pool.query(`SELECT state FROM woc_market_settlements WHERE id = $1`, [
        failed.id,
      ]);
      expect(after.rows[0].state, 'the failed row survived the skip').toBe('failed');
      expect((await listingRow(listingId)).status).toBe('active');
    });

    it('refuses the cancel-intent stamp for EVERY post-offered settlement state', async () => {
      // The paid probe spells its own state list; each member is exercised so
      // a dropped one reds (the suspend guard's per-state idiom).
      for (const state of ['review', 'confirmed', 'delivering', 'delivered'] as const) {
        const realm = `intent-paid-${state}-${++seq}`;
        const seller = await seedAccount();
        const holder = await seedAccount();
        const listingId = await seedListing(realm, seller, {
          lockAccount: holder,
          lockExpiresAtMs: BASE_MS + 4 * MINUTE_MS,
        });
        const settlement = await marketDb.insertSettlement({
          listingId,
          bidId: null,
          attempt: 0,
          buyerAccount: holder,
          buyerCharacter: 7000 + seq,
          buyerName: `Holder${seq}`,
          buyerWallet: `wallet-holder-${seq}`,
          amountCents: 1000,
          deadlineAtMs: BASE_MS + 4 * MINUTE_MS,
          nowMs: BASE_MS,
        });
        if (typeof settlement === 'string') throw new Error(`fixture settlement: ${settlement}`);
        await pool.query(`UPDATE woc_market_settlements SET state = $2 WHERE id = $1`, [
          settlement.id,
          state,
        ]);
        expect(await marketDb.cancelListingIfUnbid(realm, listingId, seller, BASE_MS), state).toBe(
          'settlement_live',
        );
        expect((await listingRow(listingId)).cancel_requested_at, state).toBeNull();
      }
    });

    it('never stamps over a paid window and never tears a live settlement', async () => {
      const realm = `intent-paid-${++seq}`;
      const seller = await seedAccount();
      const holder = await seedAccount();
      const listingId = await seedListing(realm, seller, {
        lockAccount: holder,
        lockExpiresAtMs: BASE_MS + 4 * MINUTE_MS,
      });
      const settlement = await marketDb.insertSettlement({
        listingId,
        bidId: null,
        attempt: 0,
        buyerAccount: holder,
        buyerCharacter: 7000 + seq,
        buyerName: `Holder${seq}`,
        buyerWallet: `wallet-holder-${seq}`,
        amountCents: 1000,
        deadlineAtMs: BASE_MS + 4 * MINUTE_MS,
        nowMs: BASE_MS,
      });
      if (typeof settlement === 'string') throw new Error(`fixture settlement: ${settlement}`);
      await pool.query(
        `UPDATE woc_market_settlements SET state = 'confirming', tx_signature = $2 WHERE id = $1`,
        [settlement.id, `paid-window-${seq}`],
      );
      // A PAID window refuses even the stamp.
      expect(await marketDb.cancelListingIfUnbid(realm, listingId, seller, BASE_MS)).toBe(
        'settlement_live',
      );
      expect((await listingRow(listingId)).cancel_requested_at).toBeNull();
      // And a stamped listing whose settlement is LIVE never converges: force
      // the stamp, then prove the open settlement skips the close.
      await pool.query(
        `UPDATE woc_market_listings SET cancel_requested_at = to_timestamp($2 / 1000.0) WHERE id = $1`,
        [listingId, BASE_MS],
      );
      const after = BASE_MS + 5 * MINUTE_MS;
      expect(await marketDb.closeCancelPendingListing(realm, listingId, after)).toBe('skip');
      expect((await listingRow(listingId)).status).toBe('active');
    });
  });
  describe('activity reads are item-named (the real SQL, not just the fake twin)', () => {
    it('bidsByAccount joins the listed item onto every row', async () => {
      const realm = `bids-itemized-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      // TWO listings with DIFFERENT items, both bid on by the same account:
      // the pin reaches the CORRELATION itself. A single-listing seed passes
      // an uncorrelated lookup (any listing's item, the first by id) that
      // would name every row after the same item.
      const crown = await seedListing(realm, seller);
      const plate = await seedListing(realm, seller, { itemId: 'deathlord_warplate' });
      await seedBid(realm, crown, bidder, { status: 'active', placedAtMs: BASE_MS - 2_000 });
      await seedBid(realm, plate, bidder, { status: 'active', placedAtMs: BASE_MS - 1_000 });
      const rows = await marketDb.bidsByAccount(realm, bidder, 10);
      expect(rows).toHaveLength(2);
      const named = new Map(rows.map((r) => [r.listingId, r.itemId]));
      expect(named.get(crown), 'the correlated listing lookup, row 1').toBe('crown_of_embers');
      expect(named.get(plate), 'the correlated listing lookup, row 2').toBe('deathlord_warplate');
      // The pruned-listing '' arm is UNREACHABLE against real referential
      // integrity (bids CASCADE with their listing), so the guard is
      // defensive; the wire's empty-to-null collapse is pinned separately.
    });
  });

  // -------------------------------------------------------------------------
  // Bid intake: the refusal ladder insertPendingBid judges over the LOCKED
  // listing row. Until now only the fake twin answered these words; each arm
  // here lands real rows and reads the ledger back, so deleting a guard
  // either mints a bid the ladder must refuse or refuses one it must mint.
  // -------------------------------------------------------------------------

  describe('bid intake refusal ladder, in real SQL', () => {
    function bidArgs(
      realm: string,
      listingId: number,
      account: number,
      over: { wallet?: string; amountCents?: number; minNext?: number; nowMs?: number } = {},
    ) {
      seq++;
      return {
        realm,
        listingId,
        account,
        characterId: 8000 + seq,
        characterName: `Bidder${seq}`,
        wallet: over.wallet ?? `wallet-intake-${seq}`,
        amountCents: over.amountCents ?? 700,
        bondCents: 70,
        nowMs: over.nowMs ?? BASE_MS,
        minNext: () => over.minNext ?? 0,
      };
    }

    async function bidCount(listingId: number): Promise<number> {
      const res = await pool.query(
        `SELECT count(*)::int AS n FROM woc_market_bids WHERE listing_id = $1`,
        [listingId],
      );
      return Number(res.rows[0].n);
    }

    it('refuses the seller account and the seller wallet twin as own_listing; a stranger lands', async () => {
      const realm = `bid-own-${++seq}`;
      const seller = await seedAccount();
      const twin = await seedAccount();
      const stranger = await seedAccount();
      const listing = await seedListing(realm, seller);
      const sellerWallet = String(
        (await pool.query(`SELECT seller_wallet FROM woc_market_listings WHERE id = $1`, [listing]))
          .rows[0].seller_wallet,
      );
      expect(await marketDb.insertPendingBid(bidArgs(realm, listing, seller))).toEqual({
        ok: false,
        reason: 'own_listing',
      });
      // A second account paying out to the seller's wallet is the seller.
      expect(
        await marketDb.insertPendingBid(bidArgs(realm, listing, twin, { wallet: sellerWallet })),
      ).toEqual({ ok: false, reason: 'own_listing' });
      expect(await bidCount(listing), 'the refusals minted nothing').toBe(0);
      const landed = await marketDb.insertPendingBid(bidArgs(realm, listing, stranger));
      expect(landed.ok, 'a stranger bids').toBe(true);
      if (landed.ok) {
        expect(landed.bid).toMatchObject({
          listingId: listing,
          account: stranger,
          amountCents: 700,
          bondCents: 70,
          status: 'pending_bond',
          bondState: 'pending',
        });
      }
      expect(await bidCount(listing)).toBe(1);
    });

    it('a directed listing answers not_found to everyone, its designated buyer included', async () => {
      const realm = `bid-directed-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const stranger = await seedAccount();
      const listing = await seedListing(realm, seller, { directedBuyerAccount: buyer });
      expect(await marketDb.insertPendingBid(bidArgs(realm, listing, buyer))).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(await marketDb.insertPendingBid(bidArgs(realm, listing, stranger))).toEqual({
        ok: false,
        reason: 'not_found',
      });
      // The anti-enumeration ORDER: the directed verdict comes before every
      // other refusal, so a cancel-stamped directed listing still answers
      // not_found (cancel_pending would confirm a private trade is in
      // flight to anyone probing guessable ids).
      const cancelStamped = await seedListing(realm, seller, {
        directedBuyerAccount: buyer,
        cancelRequestedAtMs: BASE_MS - MINUTE_MS,
      });
      expect(await marketDb.insertPendingBid(bidArgs(realm, cancelStamped, stranger))).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(await bidCount(listing)).toBe(0);
    });

    it('an ending status and a lapsed close both refuse not_active; the close bound is inclusive', async () => {
      const realm = `bid-inactive-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const ending = await seedListing(realm, seller, { status: 'ending' });
      expect(await marketDb.insertPendingBid(bidArgs(realm, ending, bidder))).toEqual({
        ok: false,
        reason: 'not_active',
      });
      const lapsed = await seedListing(realm, seller, { endsAtMs: BASE_MS });
      expect(
        await marketDb.insertPendingBid(bidArgs(realm, lapsed, bidder, { nowMs: BASE_MS })),
        'ends_at equal to now is closed',
      ).toEqual({ ok: false, reason: 'not_active' });
      const open = await seedListing(realm, seller, { endsAtMs: BASE_MS + 1_000 });
      expect(
        (await marketDb.insertPendingBid(bidArgs(realm, open, bidder, { nowMs: BASE_MS }))).ok,
        'one second before the close still bids',
      ).toBe(true);
    });

    it('cancel-intent refuses new bids as cancel_pending', async () => {
      const realm = `bid-cancel-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listing = await seedListing(realm, seller, {
        cancelRequestedAtMs: BASE_MS - MINUTE_MS,
      });
      expect(await marketDb.insertPendingBid(bidArgs(realm, listing, bidder))).toEqual({
        ok: false,
        reason: 'cancel_pending',
      });
      expect(await bidCount(listing)).toBe(0);
    });

    it('bid_too_low is judged against the injected minimum, inclusive at the bound', async () => {
      const realm = `bid-low-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listing = await seedListing(realm, seller);
      expect(
        await marketDb.insertPendingBid(
          bidArgs(realm, listing, bidder, { amountCents: 799, minNext: 800 }),
        ),
      ).toEqual({ ok: false, reason: 'bid_too_low' });
      expect(
        (
          await marketDb.insertPendingBid(
            bidArgs(realm, listing, bidder, { amountCents: 800, minNext: 800 }),
          )
        ).ok,
      ).toBe(true);
    });

    it('already_pending is per listing and account, and only while the first bid is still pending_bond', async () => {
      const realm = `bid-pending-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const other = await seedAccount();
      const listing = await seedListing(realm, seller);
      const sibling = await seedListing(realm, seller);
      const first = await marketDb.insertPendingBid(bidArgs(realm, listing, bidder));
      expect(first.ok).toBe(true);
      expect(await marketDb.insertPendingBid(bidArgs(realm, listing, bidder))).toEqual({
        ok: false,
        reason: 'already_pending',
      });
      expect(
        (await marketDb.insertPendingBid(bidArgs(realm, listing, other))).ok,
        'per account',
      ).toBe(true);
      expect(
        (await marketDb.insertPendingBid(bidArgs(realm, sibling, bidder))).ok,
        'per listing',
      ).toBe(true);
      // Once the first bid leaves pending_bond the account may bid again here.
      if (first.ok) {
        await pool.query(`UPDATE woc_market_bids SET status = 'lapsed' WHERE id = $1`, [
          first.bid.id,
        ]);
      }
      expect(
        (await marketDb.insertPendingBid(bidArgs(realm, listing, bidder))).ok,
        'only a pending_bond row blocks',
      ).toBe(true);
    });

    it('abandonPendingBid is holder-scoped and voids only an unsigned pending bond', async () => {
      const realm = `bid-abandon-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const other = await seedAccount();
      const listing = await seedListing(realm, seller);
      const pending = await seedBid(realm, listing, bidder, { bondState: 'pending' });
      // Another account cannot void someone else's bond.
      expect(await marketDb.abandonPendingBid(realm, pending, other)).toBe(false);
      expect(await bidRow(pending)).toMatchObject({ status: 'pending_bond' });
      // An ACTIVE bid (held bond) is not abandonable through this arm.
      const active = await seedBid(realm, listing, bidder, {
        status: 'active',
        bondState: 'held',
      });
      expect(await marketDb.abandonPendingBid(realm, active, bidder)).toBe(false);
      expect(await bidRow(active)).toMatchObject({ status: 'active', bond_state: 'held' });
      // The holder abandons their own unsigned pending bond.
      expect(await marketDb.abandonPendingBid(realm, pending, bidder)).toBe(true);
      expect(await bidRow(pending)).toMatchObject({ status: 'cancelled', bond_state: 'void' });
    });

    it('the bond poll reads only SIGNED pending bonds', async () => {
      const realm = `bid-poll-signed-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const other = await seedAccount();
      const listing = await seedListing(realm, seller);
      const signed = await seedBid(realm, listing, bidder, {
        bondSignature: `poll-signed-${seq}`,
      });
      await seedBid(realm, listing, other);
      // A SIGNED spare in a dead status (a superseded bid keeps its recorded
      // signature) separates the status member: signature presence alone must
      // not put a bond back on the chain poll.
      await seedBid(realm, listing, await seedAccount(), {
        status: 'outbid',
        bondSignature: `poll-signed-spare-${seq}`,
      });
      const polled = await marketDb.confirmingBonds(realm, 10, []);
      // Exactly the signed PENDING bond: the unsigned pending bond has
      // nothing for the chain to decide, and the signed outbid spare is done.
      expect(polled.map((r) => r.id)).toEqual([signed]);
    });

    it('the cancel-intent converge read skips an UNEXPIRED locked window', async () => {
      const realm = `cancel-window-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      // Load-bearing by EXISTENCE: the exact set below excludes this
      // unexpired locked window.
      await seedListing(realm, seller, {
        cancelRequestedAtMs: BASE_MS - 20 * MINUTE_MS,
        lockAccount: buyer,
        lockExpiresAtMs: BASE_MS + 5 * MINUTE_MS,
      });
      const expired = await seedListing(realm, seller, {
        cancelRequestedAtMs: BASE_MS - 20 * MINUTE_MS,
        lockAccount: buyer,
        lockExpiresAtMs: BASE_MS - 5 * MINUTE_MS,
      });
      const batch = await marketDb.cancelPendingListings(realm, BASE_MS, 10, []);
      // The exact set: the holder keeps their unexpired window (the `locked`
      // row is excluded by this equality).
      expect(batch.map((r) => r.id)).toEqual([expired]);
    });
  });

  describe('buy-now claim diagnosis and cooldown scoping, in real SQL', () => {
    it('a twin steal of an EXPIRED lock refuses before the abandon recorder', async () => {
      // The transaction ORDER: the wallet-twin guard sits above the
      // steal-time abandon recorder, so a refused twin charges the dead
      // holder nothing; only a legitimate steal is the "first look" that
      // records the walk-away.
      const realm = `claim-twin-steal-${++seq}`;
      const seller = await seedAccount();
      const holder = await seedAccount();
      const twin = await seedAccount();
      const listing = await seedListing(realm, seller, {
        lockAccount: holder,
        lockExpiresAtMs: BASE_MS - MINUTE_MS,
      });
      const wallet = await pool.query(
        `SELECT seller_wallet FROM woc_market_listings WHERE id = $1`,
        [listing],
      );
      await pool.query(`INSERT INTO wallet_links (account_id, pubkey) VALUES ($1, $2)`, [
        twin,
        wallet.rows[0].seller_wallet,
      ]);
      expect(
        await marketDb.claimBuyNowLock(realm, listing, twin, BASE_MS, BASE_MS + 5 * MINUTE_MS),
      ).toBe('own_listing');
      const charged = async (): Promise<number> => {
        const res = await pool.query(
          `SELECT count(*)::int AS n FROM woc_market_buy_now_abandons WHERE account = $1`,
          [holder],
        );
        return Number(res.rows[0].n);
      };
      expect(await charged(), 'the refused twin recorded nothing against the dead holder').toBe(0);
      const stranger = await seedAccount();
      const claimed = await marketDb.claimBuyNowLock(
        realm,
        listing,
        stranger,
        BASE_MS,
        BASE_MS + 5 * MINUTE_MS,
      );
      expect(typeof claimed === 'object' && 'id' in claimed ? claimed.id : claimed).toBe(listing);
      expect(await charged(), 'the legitimate steal is what charges the holder').toBe(1);
    });

    it('the diagnosis ladder refuses from the row state', async () => {
      const realm = `claim-diag-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const own = await seedListing(realm, seller);
      expect(
        await marketDb.claimBuyNowLock(realm, own, seller, BASE_MS, BASE_MS + 5 * MINUTE_MS),
      ).toBe('own_listing');
      const ending = await seedListing(realm, seller, { status: 'ending' });
      expect(
        await marketDb.claimBuyNowLock(realm, ending, buyer, BASE_MS, BASE_MS + 5 * MINUTE_MS),
      ).toBe('not_active');
      const auctionOnly = await seedListing(realm, seller, { buyNowCents: null });
      expect(
        await marketDb.claimBuyNowLock(realm, auctionOnly, buyer, BASE_MS, BASE_MS + 5 * MINUTE_MS),
      ).toBe('no_buy_now');
    });

    it('an OPEN settlement refuses the claim even with no lock standing', async () => {
      const realm = `claim-open-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const rival = await seedAccount();
      const listing = await seedListing(realm, seller);
      await pool.query(
        `INSERT INTO woc_market_settlements (
           listing_id, realm, bid_id, attempt, buyer_account, buyer_character,
           buyer_name, buyer_wallet, amount_cents, state, deadline_at
         ) VALUES ($1, $2, NULL, 0, $3, 1, 'B', 'w', 1000, 'offered',
                   to_timestamp($4 / 1000.0))`,
        [listing, realm, buyer, BASE_MS + 15 * MINUTE_MS],
      );
      expect(
        await marketDb.claimBuyNowLock(realm, listing, rival, BASE_MS, BASE_MS + 5 * MINUTE_MS),
        'a paying buyer is never raced by a rival probe',
      ).toBe('locked');
      expect((await listingRow(listing)).buy_now_lock_account, 'no rival stamp').toBeNull();
    });

    it('a recent abandon on ANOTHER listing starts no reclaim cooldown here', async () => {
      const realm = `claim-scope-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const here = await seedListing(realm, seller);
      const there = await seedListing(realm, seller);
      await pool.query(
        `INSERT INTO woc_market_buy_now_abandons (realm, listing_id, account, lock_expires)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))`,
        [realm, there, buyer, BASE_MS - 1_000],
      );
      // A RIVAL at the hourly cap spends nothing of ours: the cap counts the
      // claimer's own ledger only. Derived from the cap constant so a raised
      // cap keeps the rival AT it (a hard-coded three would silently drop
      // below and vacate this pin).
      const rival = await seedAccount();
      for (let i = 1; i <= rulesMod.WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR; i++) {
        await pool.query(
          `INSERT INTO woc_market_buy_now_abandons (realm, listing_id, account, lock_expires)
           VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))`,
          [realm, there, rival, BASE_MS - (i + 1) * 1_000],
        );
      }
      const claimed = await marketDb.claimBuyNowLock(
        realm,
        here,
        buyer,
        BASE_MS,
        BASE_MS + 5 * MINUTE_MS,
      );
      expect(typeof claimed === 'object' && 'id' in claimed ? claimed.id : claimed).toBe(here);
    });

    it('a directed buyer at the account cap still claims their window', async () => {
      const realm = `claim-directed-cap-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const other = await seedListing(realm, seller);
      // AT the cap by derivation, so a raised cap cannot silently move the
      // buyer below it and vacate the exemption pin.
      for (let i = 1; i <= rulesMod.WOC_MARKET_BUY_NOW_ABANDONS_PER_HOUR; i++) {
        await pool.query(
          `INSERT INTO woc_market_buy_now_abandons (realm, listing_id, account, lock_expires)
           VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))`,
          [realm, other, buyer, BASE_MS - i * 1_000],
        );
      }
      const directed = await seedListing(realm, seller, { directedBuyerAccount: buyer });
      const claimed = await marketDb.claimBuyNowLock(
        realm,
        directed,
        buyer,
        BASE_MS,
        BASE_MS + 5 * MINUTE_MS,
      );
      expect(
        typeof claimed === 'object' && 'id' in claimed ? claimed.id : claimed,
        'the public-loop cooldowns never gate a directed window',
      ).toBe(directed);
    });

    it('closeCancelPendingListing skips while a bid stands', async () => {
      const realm = `cancel-close-bids-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const bidder = await seedAccount();
      const listing = await seedListing(realm, seller, {
        cancelRequestedAtMs: BASE_MS - 20 * MINUTE_MS,
        lockAccount: buyer,
        lockExpiresAtMs: BASE_MS - 5 * MINUTE_MS,
      });
      await seedBid(realm, listing, bidder, { status: 'active', bondState: 'held' });
      expect(await marketDb.closeCancelPendingListing(realm, listing, BASE_MS)).toBe('skip');
      expect((await listingRow(listing)).status, 'a standing bid blocks the converge close').toBe(
        'active',
      );
    });

    it('submitBondSignature lands only on a pending bid and answers reuse typed', async () => {
      const realm = `bond-sig-guards-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listing = await seedListing(realm, seller);
      const outbid = await seedBid(realm, listing, bidder, { status: 'outbid' });
      expect(await marketDb.submitBondSignature(outbid, `late-sig-${seq}`, BASE_MS)).toBe(
        'not_pending',
      );
      expect((await bidRow(outbid)).bond_signature, 'no recording on a dead bid').toBeNull();
      const first = await seedBid(realm, listing, bidder, { bondState: 'pending' });
      const second = await seedBid(realm, listing, await seedAccount(), {
        bondState: 'pending',
      });
      const shared = `shared-sig-${seq}`;
      const landed = await marketDb.submitBondSignature(first, shared, BASE_MS);
      expect(landed).toEqual({ signatureAtMs: BASE_MS });
      expect((await bidRow(first)).bond_signature, 'the recording landed').toBe(shared);
      expect(
        await marketDb.submitBondSignature(second, shared, BASE_MS),
        'one signature funds one bond',
      ).toBe('signature_reused');
      expect((await bidRow(second)).bond_signature).toBeNull();
      // A DEAD bid answers not_pending even on a spent signature: the guarded
      // UPDATE misses first, so the unique index is never consulted (the
      // verdict-order contract the fake mirrors).
      expect(await marketDb.submitBondSignature(outbid, shared, BASE_MS)).toBe('not_pending');
      expect((await bidRow(outbid)).bond_signature).toBeNull();
    });

    it('bid state guards never move settled money', async () => {
      const realm = `bid-state-guards-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listing = await seedListing(realm, seller);
      const active = await seedBid(realm, listing, bidder, {
        status: 'active',
        bondState: 'pending',
      });
      expect(await marketDb.lapseBid(active), 'lapse reaps only pending bids').toBe(false);
      expect(await bidRow(active)).toMatchObject({ status: 'active', bond_state: 'pending' });
      const outbid = await seedBid(realm, listing, bidder, { status: 'outbid' });
      expect(
        await marketDb.setBidBondQuote(outbid, `dead-ref-${seq}`, BASE_MS + MINUTE_MS, 70),
        'no quote lands on a dead bid',
      ).toBe(false);
      const due = await seedBid(realm, listing, bidder, {
        status: 'outbid',
        bondState: 'refund_due',
      });
      await marketDb.markBondHeld(due);
      expect((await bidRow(due)).bond_state, 'a due refund is never re-held').toBe('refund_due');
    });

    it('the activation ladder, in real SQL', async () => {
      const realm = `activate-ladder-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const rival = await seedAccount();
      const listing = await seedListing(realm, seller);
      const winner = await seedBid(realm, listing, bidder, {
        status: 'active',
        bondState: 'held',
        amountCents: 900,
      });
      await pool.query(
        `UPDATE woc_market_listings SET current_bid_cents = 900, current_bid_id = $2 WHERE id = $1`,
        [listing, winner],
      );
      expect(await marketDb.activateBid(winner, BASE_MS), 'an active bid is not pending').toBe(
        'not_pending',
      );
      expect(await bidRow(winner)).toMatchObject({ status: 'active' });
      const equal = await seedBid(realm, listing, rival, { amountCents: 900 });
      expect(await marketDb.activateBid(equal, BASE_MS), 'a tie never outbids').toBe('superseded');
      expect(await bidRow(equal)).toMatchObject({ status: 'outbid' });
      const higher = await seedBid(realm, listing, rival, { amountCents: 950 });
      expect(await marketDb.activateBid(higher, BASE_MS)).toBe('activated');
      expect(await bidRow(higher)).toMatchObject({ status: 'active' });
      const board = await pool.query(
        `SELECT current_bid_cents, current_bid_id FROM woc_market_listings WHERE id = $1`,
        [listing],
      );
      expect(board.rows[0], 'the listing board carries the activation').toEqual({
        current_bid_cents: 950,
        current_bid_id: String(higher),
      });
      expect(await bidRow(winner), 'the demoted winner routes to refund').toMatchObject({
        status: 'outbid',
        bond_state: 'refund_due',
      });
    });

    it('activation never demotes a WON prior row', async () => {
      const realm = `activate-won-prior-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listing = await seedListing(realm, seller);
      const wonPrior = await seedBid(realm, listing, bidder, {
        status: 'won',
        bondState: 'held',
        amountCents: 900,
      });
      await pool.query(
        `UPDATE woc_market_listings SET current_bid_cents = 900, current_bid_id = $2 WHERE id = $1`,
        [listing, wonPrior],
      );
      const pending = await seedBid(realm, listing, await seedAccount(), { amountCents: 950 });
      expect(await marketDb.activateBid(pending, BASE_MS)).toBe('activated');
      expect(await bidRow(wonPrior), 'a won verdict is not an active bid to demote').toMatchObject({
        status: 'won',
        bond_state: 'held',
      });
    });

    it('the abandon recorder exempt window, in real SQL', async () => {
      const realm = `abandon-exempt-${++seq}`;
      const seller = await seedAccount();
      const buyer = await seedAccount();
      const lockExp = BASE_MS - MINUTE_MS;
      const exemptReason = rulesMod.WOC_MARKET_ABANDON_EXEMPT_FAIL_REASONS[0];
      async function seedFailed(
        listingId: number,
        over: { deadlineMs?: number; sig?: string | null; reason?: string },
      ): Promise<void> {
        seq++;
        await pool.query(
          `INSERT INTO woc_market_settlements (
             listing_id, realm, bid_id, attempt, buyer_account, buyer_character,
             buyer_name, buyer_wallet, amount_cents, state, deadline_at,
             tx_signature, fail_reason
           ) VALUES ($1, $2, NULL, 0, $3, 1, 'B', 'w', 1000, 'failed',
                     to_timestamp($4 / 1000.0), $5, $6)`,
          [
            listingId,
            realm,
            buyer,
            over.deadlineMs ?? lockExp,
            over.sig === undefined ? `exempt-sig-${seq}` : over.sig,
            over.reason ?? exemptReason,
          ],
        );
      }
      async function recorded(listingId: number): Promise<number> {
        const res = await pool.query(
          `SELECT count(*)::int AS n FROM woc_market_buy_now_abandons
            WHERE listing_id = $1 AND account = $2`,
          [listingId, buyer],
        );
        return Number(res.rows[0].n);
      }
      // Exempt: the chain-plausible refusal with a REAL recorded signature on
      // exactly this window records no abandon.
      const exempt = await seedListing(realm, seller);
      await seedFailed(exempt, {});
      await marketDb.recordBuyNowAbandon(realm, exempt, buyer, lockExp);
      expect(await recorded(exempt), 'a chain-plausible failure is not an abandon').toBe(0);
      // A non-exempt reason records.
      const wrongReason = await seedListing(realm, seller);
      await seedFailed(wrongReason, { reason: 'buyer_default' });
      await marketDb.recordBuyNowAbandon(realm, wrongReason, buyer, lockExp);
      expect(await recorded(wrongReason), 'a plain default pays the window').toBe(1);
      // A bare posted claim with NO signature records: one fabricated request
      // must not bypass the cooldown arm.
      const noSig = await seedListing(realm, seller);
      await seedFailed(noSig, { sig: null });
      await marketDb.recordBuyNowAbandon(realm, noSig, buyer, lockExp);
      expect(await recorded(noSig)).toBe(1);
      // A signature on a DIFFERENT window exempts nothing here.
      const wrongWindow = await seedListing(realm, seller);
      await seedFailed(wrongWindow, { deadlineMs: lockExp - MINUTE_MS });
      await marketDb.recordBuyNowAbandon(realm, wrongWindow, buyer, lockExp);
      expect(await recorded(wrongWindow)).toBe(1);
      // The ledger dedupes on the window triple.
      await marketDb.recordBuyNowAbandon(realm, wrongWindow, buyer, lockExp);
      expect(await recorded(wrongWindow), 'one window, one row').toBe(1);
      // ANOTHER buyer's chain-plausible failure exempts nothing for ours.
      const rivalBuyer = await seedAccount();
      const rivalWindow = await seedListing(realm, seller);
      seq++;
      await pool.query(
        `INSERT INTO woc_market_settlements (
           listing_id, realm, bid_id, attempt, buyer_account, buyer_character,
           buyer_name, buyer_wallet, amount_cents, state, deadline_at,
           tx_signature, fail_reason
         ) VALUES ($1, $2, NULL, 0, $3, 1, 'R', 'w', 1000, 'failed',
                   to_timestamp($4 / 1000.0), $5, $6)`,
        [rivalWindow, realm, rivalBuyer, lockExp, `exempt-sig-${seq}`, exemptReason],
      );
      await marketDb.recordBuyNowAbandon(realm, rivalWindow, buyer, lockExp);
      expect(await recorded(rivalWindow), 'exemption is per buyer').toBe(1);
    });

    it('the schema enforces one bond per reference', async () => {
      const realm = `bond-ref-unique-${++seq}`;
      const seller = await seedAccount();
      const bidder = await seedAccount();
      const listing = await seedListing(realm, seller);
      const ref = `dup-ref-${seq}`;
      await seedBid(realm, listing, bidder, { bondReference: ref });
      await expect(
        seedBid(realm, listing, await seedAccount(), { bondReference: ref }),
      ).rejects.toMatchObject({ code: '23505', constraint: 'woc_market_bids_bond_reference_key' });
    });
  });
});
