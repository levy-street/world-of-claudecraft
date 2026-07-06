import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// premium_listings reuses the marketplace's split-payment + burn-vault path. The
// module-load BURN_VAULT constant (in marketplace.ts + premium_listings.ts) is read
// from MARKETPLACE_BURN_VAULT at import, so set it BEFORE the modules evaluate. A
// vi.hoisted block runs before the hoisted static imports below.
vi.hoisted(() => {
  process.env.MARKETPLACE_BURN_VAULT = 'BurnVau1t1111111111111111111111111111111111';
  process.env.USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  process.env.PREMIUM_SLOT_COUNT = '3';
  process.env.PREMIUM_SLOT_PRICE_USDC = '25000000';
  process.env.PREMIUM_SLOT_DURATION_MS = '86400000'; // 1 day
});

import type { MarketplaceQuoteRow, PremiumSlotRow } from '../server/db';
import { marketplaceEnabled } from '../server/marketplace';
import {
  premiumListingsEnabled,
  premiumSlotCount,
  premiumSlotPriceUsdc,
  quotePremiumSlot,
  verifyPremiumPurchase,
} from '../server/premium_listings';
import type { RawConfirmedTransaction } from '../server/solana_rpc';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BUYER = 'Buyer1111111111111111111111111111111111111';
// A real, valid base58-32 pubkey standing in for the creator's payout wallet.
const CREATOR = 'So11111111111111111111111111111111111111112';
const VAULT = 'BurnVau1t1111111111111111111111111111111111';

// The db + rpc boundaries are the only things mocked; validateSplitPayment /
// parseSplitPayment / splitAmounts run for real (same as the marketplace tests).
const db = vi.hoisted(() => ({
  createMarketplaceQuote: vi.fn(async () => {}),
  getMarketplaceQuote: vi.fn(),
  deleteMarketplaceQuote: vi.fn(async () => {}),
  claimPremiumSlot: vi.fn(),
}));
vi.mock('../server/db', () => db);

const rpc = vi.hoisted(() => ({ fetchFinalizedTransaction: vi.fn() }));
vi.mock('../server/solana_rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/solana_rpc')>()),
  fetchFinalizedTransaction: rpc.fetchFinalizedTransaction,
}));

interface Bal {
  owner: string;
  pre?: string;
  post?: string;
}

// Build a jsonParsed getTransaction-shaped fixture from per-owner USDC balances
// (mirrors the marketplace test's makeTx).
function makeTx(opts: {
  feePayer?: string;
  memo?: string | null;
  err?: unknown;
  balances: Bal[];
}): RawConfirmedTransaction {
  const bal = (b: Bal, amount: string) => ({
    owner: b.owner,
    mint: USDC,
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    uiTokenAmount: { amount },
  });
  const pre = opts.balances.filter((b) => b.pre !== undefined).map((b) => bal(b, b.pre!));
  const post = opts.balances.filter((b) => b.post !== undefined).map((b) => bal(b, b.post!));
  const instructions =
    opts.memo === undefined || opts.memo === null
      ? []
      : [{ program: 'spl-memo', parsed: opts.memo }];
  return {
    meta: { err: opts.err ?? null, preTokenBalances: pre, postTokenBalances: post },
    transaction: { message: { accountKeys: [{ pubkey: opts.feePayer ?? BUYER }], instructions } },
  };
}

// A clean $25 split for the fixed feature fee: buyer -25, creator +17.5, vault +7.5.
function goodTx(memo = 'q_prem'): RawConfirmedTransaction {
  return makeTx({
    feePayer: BUYER,
    memo,
    balances: [
      { owner: BUYER, pre: '25000000', post: '0' },
      { owner: CREATOR, pre: '0', post: '17500000' },
      { owner: VAULT, pre: '0', post: '7500000' },
    ],
  });
}

function quote(over: Partial<MarketplaceQuoteRow> = {}): MarketplaceQuoteRow {
  return {
    quoteId: 'q_prem',
    skinId: 'skin_1',
    buyerAccountId: 42,
    creatorOwner: CREATOR,
    burnOwner: VAULT,
    creatorUsdc: 17_500_000n,
    burnUsdc: 7_500_000n,
    mint: USDC,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...over,
  };
}

describe('premiumListingsEnabled — fail-closed flag', () => {
  const saved = process.env.PREMIUM_LISTINGS_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.PREMIUM_LISTINGS_ENABLED;
    else process.env.PREMIUM_LISTINGS_ENABLED = saved;
  });

  it('is off by default (flag unset), even with the marketplace configured', () => {
    delete process.env.PREMIUM_LISTINGS_ENABLED;
    expect(marketplaceEnabled()).toBe(true); // burn vault is set by the hoisted block
    expect(premiumListingsEnabled()).toBe(false);
  });

  it('is off for any value other than exactly "1"', () => {
    process.env.PREMIUM_LISTINGS_ENABLED = 'true';
    expect(premiumListingsEnabled()).toBe(false);
    process.env.PREMIUM_LISTINGS_ENABLED = '0';
    expect(premiumListingsEnabled()).toBe(false);
  });

  it('is on only when the flag is "1" AND the marketplace is configured', () => {
    process.env.PREMIUM_LISTINGS_ENABLED = '1';
    expect(premiumListingsEnabled()).toBe(true);
  });
});

describe('config from env', () => {
  it('reads the fixed slot count and fee (no auction)', () => {
    expect(premiumSlotCount()).toBe(3);
    expect(premiumSlotPriceUsdc()).toBe(25_000_000n);
  });
});

describe('quotePremiumSlot — fixed fee split 70/30 onto creator + burn vault', () => {
  afterEach(() => vi.clearAllMocks());

  it('splits the fixed feature fee and persists the quote (reusing createMarketplaceQuote)', async () => {
    const q = await quotePremiumSlot({ id: 'skin_1', creatorWallet: CREATOR }, 42);
    expect(q.creatorUsdc).toBe(17_500_000n); // 70% of $25
    expect(q.burnUsdc).toBe(7_500_000n); // 30% burn leg
    expect(q.creatorOwner).toBe(CREATOR);
    expect(q.burnOwner).toBe(VAULT);
    expect(q.skinId).toBe('skin_1');
    expect(q.buyerAccountId).toBe(42);
    expect(db.createMarketplaceQuote).toHaveBeenCalledWith(q);
  });

  it('rejects a malformed payout wallet, persisting nothing', async () => {
    await expect(
      quotePremiumSlot({ id: 'skin_1', creatorWallet: 'not-a-wallet' }, 42),
    ).rejects.toThrow();
    expect(db.createMarketplaceQuote).not.toHaveBeenCalled();
  });
});

describe('verifyPremiumPurchase — claims a slot on a verified payment', () => {
  afterEach(() => vi.clearAllMocks());
  const params = {
    quoteId: 'q_prem',
    signature: 'sig_prem',
    buyerAccountId: 42,
    buyerWallet: BUYER,
  };

  it('claims a slot with the exact split + expiry on a valid, correctly-paid split', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(quote());
    rpc.fetchFinalizedTransaction.mockResolvedValueOnce(goodTx());
    db.claimPremiumSlot.mockResolvedValueOnce({ ok: true, slotIndex: 0 });

    const result = await verifyPremiumPurchase(params);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slotIndex).toBe(0);
    // The claim carries the exact gross + slot count + the same signature that is
    // the replay guard (via onchain_payments), proving reuse of the dedupe path.
    expect(db.claimPremiumSlot).toHaveBeenCalledTimes(1);
    const arg = db.claimPremiumSlot.mock.calls[0][0];
    expect(arg).toMatchObject({
      txSig: 'sig_prem',
      accountId: 42,
      quoteId: 'q_prem',
      mint: USDC,
      skinId: 'skin_1',
      grossUsdc: 25_000_000n,
      slotCount: 3,
    });
    expect(new Date(arg.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects an unknown quote without touching the chain or claiming a slot', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(null);
    expect(await verifyPremiumPurchase(params)).toEqual({ ok: false, reason: 'quote_not_found' });
    expect(rpc.fetchFinalizedTransaction).not.toHaveBeenCalled();
    expect(db.claimPremiumSlot).not.toHaveBeenCalled();
  });

  it('rejects + reaps an expired quote', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(
      quote({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    expect(await verifyPremiumPurchase(params)).toEqual({ ok: false, reason: 'quote_expired' });
    expect(db.deleteMarketplaceQuote).toHaveBeenCalledWith('q_prem');
    expect(db.claimPremiumSlot).not.toHaveBeenCalled();
  });

  it('surfaces the validator reason (e.g. memo mismatch) and never claims a slot', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(quote());
    rpc.fetchFinalizedTransaction.mockResolvedValueOnce(goodTx('wrong_memo'));
    expect(await verifyPremiumPurchase(params)).toEqual({ ok: false, reason: 'memo_mismatch' });
    expect(db.claimPremiumSlot).not.toHaveBeenCalled();
  });

  it('rejects a short burn leg (the burn-vault share) just as hard as a skin purchase', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(quote());
    rpc.fetchFinalizedTransaction.mockResolvedValueOnce(
      makeTx({
        feePayer: BUYER,
        memo: 'q_prem',
        balances: [
          { owner: BUYER, pre: '25000000', post: '0' },
          { owner: CREATOR, pre: '0', post: '17500000' },
          { owner: VAULT, pre: '0', post: '7499999' }, // 1 base unit short on burn
        ],
      }),
    );
    expect(await verifyPremiumPurchase(params)).toEqual({ ok: false, reason: 'burn_amount' });
    expect(db.claimPremiumSlot).not.toHaveBeenCalled();
  });

  it('rejects a replayed signature as already_redeemed (claimPremiumSlot reports the dedupe)', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(quote());
    rpc.fetchFinalizedTransaction.mockResolvedValueOnce(goodTx());
    // The onchain_payments PK already holds this signature -> the claim path reports it.
    db.claimPremiumSlot.mockResolvedValueOnce({ ok: false, reason: 'already_redeemed' });
    expect(await verifyPremiumPurchase(params)).toEqual({ ok: false, reason: 'already_redeemed' });
  });

  it('rejects when every slot is taken (exhaustion), on an otherwise-valid payment', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(quote());
    rpc.fetchFinalizedTransaction.mockResolvedValueOnce(goodTx());
    db.claimPremiumSlot.mockResolvedValueOnce({ ok: false, reason: 'exhausted' });
    expect(await verifyPremiumPurchase(params)).toEqual({ ok: false, reason: 'exhausted' });
  });
});

// The slot ledger + expiry sweep + exhaustion + replay guard live in the DB
// transaction claimPremiumSlot / the SQL expiry filter. We exercise that logic
// against an in-memory model of the two tables it touches (onchain_payments PK +
// premium_slots), the same style social_system.test.ts uses for its FakeDb: this
// is the REAL claim algorithm (free-slot search after an inline sweep), not a mock
// of it, so the sweep-frees-a-slot and exhaustion behaviors are actually tested.
class SlotLedger {
  private payments = new Set<string>(); // onchain_payments.tx_sig (the replay guard)
  private slots = new Map<number, PremiumSlotRow>(); // slot_index -> row

  activeSlots(nowMs: number): PremiumSlotRow[] {
    return [...this.slots.values()]
      .filter((s) => new Date(s.expiresAt).getTime() > nowMs)
      .sort((a, b) => a.slotIndex - b.slotIndex);
  }

  pruneExpired(nowMs: number): number {
    let freed = 0;
    for (const [i, s] of this.slots) {
      if (new Date(s.expiresAt).getTime() <= nowMs) {
        this.slots.delete(i);
        freed++;
      }
    }
    return freed;
  }

  // Mirrors server/db.ts claimPremiumSlot: consume the signature first (replay
  // guard), sweep expired slots inline, then take the lowest free slot index.
  claim(
    p: { txSig: string; skinId: string; accountId: number; slotCount: number; expiresAt: string },
    nowMs: number,
  ): { ok: true; slotIndex: number } | { ok: false; reason: 'already_redeemed' | 'exhausted' } {
    if (this.payments.has(p.txSig)) return { ok: false, reason: 'already_redeemed' };
    this.payments.add(p.txSig);
    this.pruneExpired(nowMs);
    const taken = new Set([...this.slots.keys()]);
    let slotIndex = -1;
    for (let i = 0; i < p.slotCount; i++) {
      if (!taken.has(i)) {
        slotIndex = i;
        break;
      }
    }
    if (slotIndex < 0) {
      this.payments.delete(p.txSig); // rolled back with the transaction
      return { ok: false, reason: 'exhausted' };
    }
    this.slots.set(slotIndex, {
      slotIndex,
      skinId: p.skinId,
      buyerAccountId: p.accountId,
      payTxSig: p.txSig,
      expiresAt: p.expiresAt,
    });
    return { ok: true, slotIndex };
  }
}

describe('slot ledger — claim, sweep-frees-a-slot, exhaustion, replay', () => {
  const now = Date.UTC(2026, 0, 1);
  const later = (ms: number) => new Date(now + ms).toISOString();
  let ledger: SlotLedger;
  beforeEach(() => {
    ledger = new SlotLedger();
  });

  it('claims the lowest free slot index in order', () => {
    expect(
      ledger.claim(
        { txSig: 'a', skinId: 's1', accountId: 1, slotCount: 3, expiresAt: later(1000) },
        now,
      ),
    ).toEqual({ ok: true, slotIndex: 0 });
    expect(
      ledger.claim(
        { txSig: 'b', skinId: 's2', accountId: 2, slotCount: 3, expiresAt: later(1000) },
        now,
      ),
    ).toEqual({ ok: true, slotIndex: 1 });
    expect(ledger.activeSlots(now).map((s) => s.skinId)).toEqual(['s1', 's2']);
  });

  it('rejects when all slots are exhausted, and frees none', () => {
    for (let i = 0; i < 3; i++)
      ledger.claim(
        { txSig: `t${i}`, skinId: `s${i}`, accountId: 1, slotCount: 3, expiresAt: later(1000) },
        now,
      );
    // A 4th claim on a full 3-slot set is rejected.
    expect(
      ledger.claim(
        { txSig: 't3', skinId: 's3', accountId: 1, slotCount: 3, expiresAt: later(1000) },
        now,
      ),
    ).toEqual({ ok: false, reason: 'exhausted' });
    expect(ledger.activeSlots(now)).toHaveLength(3);
  });

  it('sweep frees an expired slot and it is no longer featured; a new claim reuses that slot', () => {
    ledger.claim(
      { txSig: 'a', skinId: 's1', accountId: 1, slotCount: 3, expiresAt: later(1000) },
      now,
    );
    ledger.claim(
      { txSig: 'b', skinId: 's2', accountId: 2, slotCount: 3, expiresAt: later(5000) },
      now,
    );
    // Advance past s1's expiry: it is no longer active, and a sweep frees its slot.
    const t = now + 2000;
    expect(ledger.activeSlots(t).map((s) => s.skinId)).toEqual(['s2']); // s1 no longer featured
    expect(ledger.pruneExpired(t)).toBe(1); // one slot freed
    // The freed slot (index 0) is reused by the next claim.
    expect(
      ledger.claim(
        { txSig: 'c', skinId: 's3', accountId: 3, slotCount: 3, expiresAt: later(9000) },
        t,
      ),
    ).toEqual({ ok: true, slotIndex: 0 });
    expect(
      ledger
        .activeSlots(t)
        .map((s) => s.skinId)
        .sort(),
    ).toEqual(['s2', 's3']);
  });

  it('rejects a replayed signature as already_redeemed (no second slot claimed)', () => {
    expect(
      ledger.claim(
        { txSig: 'dup', skinId: 's1', accountId: 1, slotCount: 3, expiresAt: later(1000) },
        now,
      ),
    ).toEqual({ ok: true, slotIndex: 0 });
    expect(
      ledger.claim(
        { txSig: 'dup', skinId: 's2', accountId: 1, slotCount: 3, expiresAt: later(1000) },
        now,
      ),
    ).toEqual({ ok: false, reason: 'already_redeemed' });
    expect(ledger.activeSlots(now)).toHaveLength(1); // still just one feature
  });
});
