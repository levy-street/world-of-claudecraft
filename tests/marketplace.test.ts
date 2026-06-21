import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  splitAmounts, validateSplitPayment, verifyPurchase, registrySkins, quotePurchase,
  type SplitVerifyReason,
} from '../server/marketplace';
import type { CreatorSkinRow } from '../server/db';
import {
  parseSplitPayment, SPL_TOKEN_PROGRAM, SPL_TOKEN_2022_PROGRAM,
  type RawConfirmedTransaction,
} from '../server/solana_rpc';
import type { MarketplaceQuoteRow } from '../server/db';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BUYER = 'Buyer1111111111111111111111111111111111111';
// A real, valid base58-32 pubkey: quotePurchase now runs isSolanaAddress() on
// the creator wallet, so this stands in as a well-formed payout address.
const CREATOR = 'So11111111111111111111111111111111111111112';
const VAULT = 'Vault11111111111111111111111111111111111111';

interface Bal { owner: string; pre?: string; post?: string; mint?: string; programId?: string }

// Build a jsonParsed getTransaction-shaped fixture from per-owner USDC balances.
function makeTx(opts: { feePayer?: string; memo?: string | null; err?: unknown; balances: Bal[] }): RawConfirmedTransaction {
  const pre = opts.balances
    .filter((b) => b.pre !== undefined)
    .map((b) => ({ owner: b.owner, mint: b.mint ?? USDC, programId: b.programId ?? SPL_TOKEN_PROGRAM, uiTokenAmount: { amount: b.pre! } }));
  const post = opts.balances
    .filter((b) => b.post !== undefined)
    .map((b) => ({ owner: b.owner, mint: b.mint ?? USDC, programId: b.programId ?? SPL_TOKEN_PROGRAM, uiTokenAmount: { amount: b.post! } }));
  const instructions = opts.memo === undefined || opts.memo === null ? [] : [{ program: 'spl-memo', parsed: opts.memo }];
  return {
    meta: { err: opts.err ?? null, preTokenBalances: pre, postTokenBalances: post },
    transaction: { message: { accountKeys: [{ pubkey: opts.feePayer ?? BUYER }], instructions } },
  };
}

function quote(over: Partial<MarketplaceQuoteRow> = {}): MarketplaceQuoteRow {
  return {
    quoteId: 'q_abc', skinId: 'skin_1', buyerAccountId: 42,
    creatorOwner: CREATOR, burnOwner: VAULT,
    creatorUsdc: 7_000_000n, burnUsdc: 3_000_000n, mint: USDC,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...over,
  };
}

// A clean $10 split: buyer −10, creator +7, vault +3, correct payer + memo.
function goodTx(memo = 'q_abc'): RawConfirmedTransaction {
  return makeTx({
    feePayer: BUYER, memo,
    balances: [
      { owner: BUYER, pre: '10000000', post: '0' },
      { owner: CREATOR, pre: '0', post: '7000000' },
      { owner: VAULT, pre: '0', post: '3000000' },
    ],
  });
}

describe('splitAmounts — fixed 70/30, price-independent, no lost base unit', () => {
  it.each([
    [1_000_000n, 700_000n, 300_000n],       // $1
    [10_000_000n, 7_000_000n, 3_000_000n],  // $10
    [100_000_000n, 70_000_000n, 30_000_000n], // $100
  ])('splits %s into creator %s + burn %s', (price, creator, burn) => {
    expect(splitAmounts(price)).toEqual({ creator, burn });
  });

  it('routes rounding dust to the burn share and never loses a base unit', () => {
    for (const price of [1n, 7n, 333n, 1_000_001n, 999_999_999n, 12_345_678n]) {
      const { creator, burn } = splitAmounts(price);
      expect(creator + burn).toBe(price);            // conservation
      expect(creator).toBe((price * 7000n) / 10000n); // creator floors
      expect(burn).toBeGreaterThanOrEqual(price - creator); // remainder incl. dust
    }
  });

  it('gives the creator exactly 70% to the base unit at scale', () => {
    expect(splitAmounts(10_000_000n).creator).toBe(7_000_000n);
  });

  it('at a zero price returns a zero split (no division surprise)', () => {
    expect(splitAmounts(0n)).toEqual({ creator: 0n, burn: 0n });
  });

  it('at 1 base unit the creator floors to 0 and all dust burns', () => {
    expect(splitAmounts(1n)).toEqual({ creator: 0n, burn: 1n });
  });
});

describe('parseSplitPayment — pure reduction of a confirmed tx', () => {
  it('extracts fee payer, memo, and net USDC deltas per owner', () => {
    const parsed = parseSplitPayment(goodTx(), USDC);
    expect(parsed.succeeded).toBe(true);
    expect(parsed.feePayer).toBe(BUYER);
    expect(parsed.memo).toBe('q_abc');
    expect(parsed.usesToken2022ForMint).toBe(false);
    expect(parsed.tokenDeltas.get(BUYER)).toBe(-10_000_000n);
    expect(parsed.tokenDeltas.get(CREATOR)).toBe(7_000_000n);
    expect(parsed.tokenDeltas.get(VAULT)).toBe(3_000_000n);
  });

  it('treats an ATA absent from preTokenBalances as starting at zero', () => {
    const tx = makeTx({ balances: [{ owner: CREATOR, post: '7000000' }] });
    expect(parseSplitPayment(tx, USDC).tokenDeltas.get(CREATOR)).toBe(7_000_000n);
  });

  it('ignores balances on other mints', () => {
    const tx = makeTx({ balances: [{ owner: CREATOR, pre: '0', post: '500', mint: 'OtherMint1111111111111111111111111111111111' }] });
    expect(parseSplitPayment(tx, USDC).tokenDeltas.size).toBe(0);
  });

  it('flags the USDC mint being carried under Token-2022', () => {
    const tx = makeTx({ balances: [{ owner: CREATOR, pre: '0', post: '7000000', programId: SPL_TOKEN_2022_PROGRAM }] });
    expect(parseSplitPayment(tx, USDC).usesToken2022ForMint).toBe(true);
  });

  it('fails closed: a configured-mint row that OMITS programId is treated as non-legacy', () => {
    // Some RPCs omit programId on token balances; never default a missing field to
    // "legacy" — that would silently accept a hook/fee mint if USDC_MINT were ever
    // misconfigured to Token-2022. Build the row directly (makeTx defaults programId).
    const tx: RawConfirmedTransaction = {
      meta: { err: null, preTokenBalances: [], postTokenBalances: [{ owner: CREATOR, mint: USDC, uiTokenAmount: { amount: '7000000' } }] },
      transaction: { message: { accountKeys: [{ pubkey: BUYER }], instructions: [] } },
    };
    expect(parseSplitPayment(tx, USDC).usesToken2022ForMint).toBe(true);
  });

  it('marks a failed transaction (meta.err set) as not succeeded', () => {
    const tx = makeTx({ err: { InstructionError: [0, 'Custom'] }, balances: [] });
    expect(parseSplitPayment(tx, USDC).succeeded).toBe(false);
  });

  it('omits zero-net deltas (an account touched but unchanged)', () => {
    const tx = makeTx({ balances: [{ owner: BUYER, pre: '5', post: '5' }] });
    expect(parseSplitPayment(tx, USDC).tokenDeltas.has(BUYER)).toBe(false);
  });

  it('sums a delta across multiple USDC accounts owned by the same wallet', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: BUYER, pre: '10000000', post: '0' },
      { owner: CREATOR, pre: '0', post: '3500000' },
      { owner: CREATOR, pre: '0', post: '3500000' }, // a second ATA — must aggregate to 7M
      { owner: VAULT, pre: '0', post: '3000000' },
    ] });
    const parsed = parseSplitPayment(tx, USDC);
    expect(parsed.tokenDeltas.get(CREATOR)).toBe(7_000_000n);
    expect(validateSplitPayment(parsed, quote(), BUYER)).toBe('ok');
  });

  it('reads the first memo instruction and ignores any later one', () => {
    const tx = goodTx('q_abc');
    tx.transaction.message.instructions.push({ program: 'spl-memo', parsed: 'a_second_memo' });
    expect(parseSplitPayment(tx, USDC).memo).toBe('q_abc');
  });

  it('treats empty accountKeys as a null fee payer (no throw)', () => {
    const tx: RawConfirmedTransaction = {
      meta: { err: null, preTokenBalances: [], postTokenBalances: [] },
      transaction: { message: { accountKeys: [], instructions: [] } },
    };
    const parsed = parseSplitPayment(tx, USDC);
    expect(parsed.feePayer).toBeNull();
    expect(parsed.succeeded).toBe(true);
    expect(parsed.tokenDeltas.size).toBe(0);
  });

  it('reads a bare-string accountKeys[0] as the fee payer', () => {
    const tx: RawConfirmedTransaction = {
      meta: { err: null, preTokenBalances: [], postTokenBalances: [] },
      transaction: { message: { accountKeys: [BUYER], instructions: [] } }, // string, not {pubkey}
    };
    expect(parseSplitPayment(tx, USDC).feePayer).toBe(BUYER);
  });

  it('reads a memo carried via a MEMO program id (not program:"spl-memo")', () => {
    const tx: RawConfirmedTransaction = {
      meta: { err: null, preTokenBalances: [], postTokenBalances: [] },
      transaction: { message: { accountKeys: [{ pubkey: BUYER }], instructions: [
        { programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', parsed: 'q_via_programid' },
      ] } },
    };
    expect(parseSplitPayment(tx, USDC).memo).toBe('q_via_programid');
  });

  it('ignores a memo instruction whose parsed payload is not a string', () => {
    const tx: RawConfirmedTransaction = {
      meta: { err: null, preTokenBalances: [], postTokenBalances: [] },
      transaction: { message: { accountKeys: [{ pubkey: BUYER }], instructions: [{ program: 'spl-memo', parsed: { not: 'a string' } }] } },
    };
    expect(parseSplitPayment(tx, USDC).memo).toBeNull();
  });

  it('marks meta:null as not succeeded with empty deltas', () => {
    const tx: RawConfirmedTransaction = { meta: null, transaction: { message: { accountKeys: [{ pubkey: BUYER }], instructions: [] } } };
    const parsed = parseSplitPayment(tx, USDC);
    expect(parsed.succeeded).toBe(false);
    expect(parsed.tokenDeltas.size).toBe(0);
  });

  it('skips rows missing owner or amount', () => {
    const tx = makeTx({ balances: [{ owner: CREATOR, post: '7000000' }] });
    // Corrupt the row: drop owner on one, amount on another — both must be ignored.
    (tx.meta!.postTokenBalances as Array<Record<string, unknown>>).push({ mint: USDC, programId: SPL_TOKEN_PROGRAM, uiTokenAmount: { amount: '5' } }); // no owner
    (tx.meta!.postTokenBalances as Array<Record<string, unknown>>).push({ owner: VAULT, mint: USDC, programId: SPL_TOKEN_PROGRAM, uiTokenAmount: {} }); // no amount
    const parsed = parseSplitPayment(tx, USDC);
    expect(parsed.tokenDeltas.get(CREATOR)).toBe(7_000_000n);
    expect(parsed.tokenDeltas.has(VAULT)).toBe(false);
  });

  it('reports a drained account (present in pre, absent in post) as a negative delta', () => {
    const tx = makeTx({ balances: [{ owner: BUYER, pre: '5000000' }] }); // pre only -> post defaults 0
    expect(parseSplitPayment(tx, USDC).tokenDeltas.get(BUYER)).toBe(-5_000_000n);
  });

  it('does NOT flag Token-2022 when it is on a DIFFERENT mint than the configured one', () => {
    const tx = makeTx({ balances: [{ owner: CREATOR, pre: '0', post: '7000000', mint: 'Other1111111111111111111111111111111111111', programId: SPL_TOKEN_2022_PROGRAM }] });
    expect(parseSplitPayment(tx, USDC).usesToken2022ForMint).toBe(false);
  });
});

function creatorSkinRow(over: Partial<CreatorSkinRow> = {}): CreatorSkinRow {
  return {
    id: 'skin_1', creatorAccountId: 7, creatorWallet: CREATOR, name: 'Dragonscale',
    description: 'Scaled plate', skinCatalog: 'class', fallbackSkin: 0, targetClass: 'warrior',
    assetUrl: 'https://cdn.example/skin_1.png', emissiveUrl: null, priceUsdc: 10_000_000n,
    status: 'live', sha256: null, ...over,
  };
}

describe('registrySkins — public projection', () => {
  afterEach(() => vi.clearAllMocks());

  it('maps live rows to public metadata (price as string) and drops internal fields', async () => {
    db.listLiveCreatorSkins.mockResolvedValueOnce([creatorSkinRow()]);
    const skins = await registrySkins();
    expect(skins).toEqual([{
      id: 'skin_1', name: 'Dragonscale', description: 'Scaled plate', skinCatalog: 'class',
      fallbackSkin: 0, targetClass: 'warrior', assetUrl: 'https://cdn.example/skin_1.png',
      emissiveUrl: null, priceUsdc: '10000000',
    }]);
    // the creator wallet, account id, status, and sha are NOT exposed publicly
    expect(skins[0]).not.toHaveProperty('creatorWallet');
    expect(skins[0]).not.toHaveProperty('status');
  });
});

describe('quotePurchase — split + persisted binding', () => {
  afterEach(() => vi.clearAllMocks());

  it('splits the skin price 70/30 onto the creator wallet and persists the quote', async () => {
    const quoteRow = await quotePurchase(creatorSkinRow(), 42);
    expect(quoteRow.creatorUsdc).toBe(7_000_000n);
    expect(quoteRow.burnUsdc).toBe(3_000_000n);
    expect(quoteRow.creatorOwner).toBe(CREATOR);
    expect(quoteRow.skinId).toBe('skin_1');
    expect(quoteRow.buyerAccountId).toBe(42);
    expect(db.createMarketplaceQuote).toHaveBeenCalledWith(quoteRow);
  });

  it('rejects a skin whose payout wallet is malformed (fails fast, persists nothing)', async () => {
    await expect(quotePurchase(creatorSkinRow({ creatorWallet: 'not-a-real-wallet' }), 42)).rejects.toThrow();
    await expect(quotePurchase(creatorSkinRow({ creatorWallet: '' }), 42)).rejects.toThrow();
    expect(db.createMarketplaceQuote).not.toHaveBeenCalled();
  });
});

describe('validateSplitPayment — exhaustive accept + reject matrix', () => {
  const check = (tx: RawConfirmedTransaction, q = quote(), buyer = BUYER): SplitVerifyReason =>
    validateSplitPayment(parseSplitPayment(tx, q.mint), q, buyer);

  it('accepts an exact, correctly-paid split', () => {
    expect(check(goodTx())).toBe('ok');
  });

  it('rejects a failed transaction', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', err: { x: 1 }, balances: [
      { owner: BUYER, pre: '10000000', post: '0' }, { owner: CREATOR, pre: '0', post: '7000000' }, { owner: VAULT, pre: '0', post: '3000000' },
    ] });
    expect(check(tx)).toBe('tx_failed');
  });

  it('rejects USDC carried under Token-2022', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: BUYER, pre: '10000000', post: '0', programId: SPL_TOKEN_2022_PROGRAM },
      { owner: CREATOR, pre: '0', post: '7000000', programId: SPL_TOKEN_2022_PROGRAM },
      { owner: VAULT, pre: '0', post: '3000000', programId: SPL_TOKEN_2022_PROGRAM },
    ] });
    expect(check(tx)).toBe('token_2022');
  });

  it('rejects a payment whose fee payer is not the buyer wallet', () => {
    expect(check(goodTx(), quote(), 'SomeoneElse1111111111111111111111111111111')).toBe('wrong_payer');
  });

  it('rejects a memo that does not match the quote id', () => {
    expect(check(goodTx('different_quote'))).toBe('memo_mismatch');
  });

  it('rejects when the three parties are not distinct (creator == buyer)', () => {
    expect(check(goodTx(), quote({ creatorOwner: BUYER }))).toBe('owners_not_distinct');
  });

  it('rejects a short creator leg', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: BUYER, pre: '10000000', post: '0' }, { owner: CREATOR, pre: '0', post: '6999999' }, { owner: VAULT, pre: '0', post: '3000000' },
    ] });
    expect(check(tx)).toBe('creator_amount');
  });

  it('rejects an over-paid creator leg just as hard as a short one', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: BUYER, pre: '10000001', post: '0' }, { owner: CREATOR, pre: '0', post: '7000001' }, { owner: VAULT, pre: '0', post: '3000000' },
    ] });
    expect(check(tx)).toBe('creator_amount');
  });

  it('rejects a short burn leg', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: BUYER, pre: '10000000', post: '0' }, { owner: CREATOR, pre: '0', post: '7000000' }, { owner: VAULT, pre: '0', post: '2999999' },
    ] });
    expect(check(tx)).toBe('burn_amount');
  });

  it('rejects when the buyer is debited more than the quoted gross (extra USDC moved)', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: BUYER, pre: '11000000', post: '0' }, { owner: CREATOR, pre: '0', post: '7000000' }, { owner: VAULT, pre: '0', post: '3000000' },
    ] });
    expect(check(tx)).toBe('buyer_amount');
  });

  it('rejects a third-party USDC recipient slipped into the same tx', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: BUYER, pre: '10000000', post: '0' }, { owner: CREATOR, pre: '0', post: '7000000' },
      { owner: VAULT, pre: '0', post: '3000000' }, { owner: 'Mule1111111111111111111111111111111111111', pre: '0', post: '1' },
    ] });
    expect(check(tx)).toBe('extra_recipient');
  });

  it('rejects the other two distinctness violations (creator==burn, burn==buyer)', () => {
    expect(check(goodTx(), quote({ creatorOwner: VAULT }))).toBe('owners_not_distinct'); // creator === burn
    expect(check(goodTx(), quote({ burnOwner: BUYER }))).toBe('owners_not_distinct'); // burn === buyer
  });

  it('rejects when the creator leg is missing entirely (no row → 0 != quoted)', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: BUYER, pre: '3000000', post: '0' }, { owner: VAULT, pre: '0', post: '3000000' }, // no creator row at all
    ] });
    expect(check(tx)).toBe('creator_amount');
  });

  it('rejects an OVER-paid burn leg, not just a short one', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: BUYER, pre: '10000000', post: '0' }, { owner: CREATOR, pre: '0', post: '7000000' }, { owner: VAULT, pre: '0', post: '3000001' },
    ] });
    expect(check(tx)).toBe('burn_amount');
  });

  it('rejects when the buyer is debited LESS than gross, and when the buyer leg is absent', () => {
    const under = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: BUYER, pre: '9000000', post: '0' }, { owner: CREATOR, pre: '0', post: '7000000' }, { owner: VAULT, pre: '0', post: '3000000' },
    ] });
    expect(check(under)).toBe('buyer_amount'); // -9M != -(7M+3M)
    const absent = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: CREATOR, pre: '0', post: '7000000' }, { owner: VAULT, pre: '0', post: '3000000' }, // buyer never debited (funded elsewhere)
    ] });
    expect(check(absent)).toBe('buyer_amount');
  });

  it('IGNORES a third party that SPENDS USDC (negative delta) on an otherwise-correct split', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [
      { owner: BUYER, pre: '10000000', post: '0' }, { owner: CREATOR, pre: '0', post: '7000000' },
      { owner: VAULT, pre: '0', post: '3000000' }, { owner: 'Spender11111111111111111111111111111111111', pre: '5000000', post: '0' }, // -5M, ignored
    ] });
    expect(check(tx)).toBe('ok');
  });

  it('accepts a zero-price split (every leg nets zero, no rows)', () => {
    const tx = makeTx({ feePayer: BUYER, memo: 'q_abc', balances: [] });
    expect(check(tx, quote({ creatorUsdc: 0n, burnUsdc: 0n }))).toBe('ok');
  });
});

// verifyPurchase orchestration: real validate + parse, mocking only the network
// boundary (fetchFinalizedTransaction) and the db (I/O). Exercises the quote
// lookup, expiry, buyer binding, replay guard ordering, and grant/record flow.
const db = vi.hoisted(() => ({
  getMarketplaceQuote: vi.fn(),
  deleteMarketplaceQuote: vi.fn(async () => {}),
  redeemPurchase: vi.fn(async () => true),
  listLiveCreatorSkins: vi.fn(async (): Promise<CreatorSkinRow[]> => []),
  createMarketplaceQuote: vi.fn(async () => {}),
}));
vi.mock('../server/db', () => db);

const rpc = vi.hoisted(() => ({ fetchFinalizedTransaction: vi.fn() }));
vi.mock('../server/solana_rpc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../server/solana_rpc')>()),
  fetchFinalizedTransaction: rpc.fetchFinalizedTransaction,
}));

describe('verifyPurchase — orchestration over the real validator', () => {
  afterEach(() => vi.clearAllMocks());

  const params = { quoteId: 'q_abc', signature: 'sig_xyz', buyerAccountId: 42, buyerWallet: BUYER };

  it('redeems atomically with the exact split and grants the skin on a valid purchase', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(quote());
    rpc.fetchFinalizedTransaction.mockResolvedValueOnce(goodTx());

    const result = await verifyPurchase(params);

    expect(result).toEqual({ ok: true, skinId: 'skin_1' });
    // One atomic redeem call carries the exact split + binding (inspect the data).
    expect(db.redeemPurchase).toHaveBeenCalledTimes(1);
    expect(db.redeemPurchase).toHaveBeenCalledWith({
      txSig: 'sig_xyz', accountId: 42, quoteId: 'q_abc', mint: USDC, skinId: 'skin_1',
      grossUsdc: 10_000_000n, creatorUsdc: 7_000_000n, burnUsdc: 3_000_000n,
    });
  });

  it('rejects an unknown quote without touching the chain', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(null);
    expect(await verifyPurchase(params)).toEqual({ ok: false, reason: 'quote_not_found' });
    expect(rpc.fetchFinalizedTransaction).not.toHaveBeenCalled();
  });

  it('rejects + reaps an expired quote', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(quote({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(await verifyPurchase(params)).toEqual({ ok: false, reason: 'quote_expired' });
    expect(db.deleteMarketplaceQuote).toHaveBeenCalledWith('q_abc');
    expect(db.redeemPurchase).not.toHaveBeenCalled();
  });

  it('rejects a quote issued to a different buyer account', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(quote({ buyerAccountId: 99 }));
    expect(await verifyPurchase(params)).toEqual({ ok: false, reason: 'quote_buyer_mismatch' });
    expect(db.redeemPurchase).not.toHaveBeenCalled();
  });

  it('rejects when the transaction is not finalized / unknown', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(quote());
    rpc.fetchFinalizedTransaction.mockResolvedValueOnce(null);
    expect(await verifyPurchase(params)).toEqual({ ok: false, reason: 'tx_not_finalized' });
    expect(db.redeemPurchase).not.toHaveBeenCalled();
  });

  it('surfaces the validator reason and never redeems on an invalid tx', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(quote());
    rpc.fetchFinalizedTransaction.mockResolvedValueOnce(goodTx('wrong_memo'));
    expect(await verifyPurchase(params)).toEqual({ ok: false, reason: 'memo_mismatch' });
    expect(db.redeemPurchase).not.toHaveBeenCalled();
  });

  it('treats a replayed signature as already redeemed (redeemPurchase returns false)', async () => {
    db.getMarketplaceQuote.mockResolvedValueOnce(quote());
    rpc.fetchFinalizedTransaction.mockResolvedValueOnce(goodTx());
    db.redeemPurchase.mockResolvedValueOnce(false); // signature already consumed

    expect(await verifyPurchase(params)).toEqual({ ok: false, reason: 'already_redeemed' });
  });
});
