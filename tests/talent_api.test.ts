// Drives the REAL server/talent.ts handlers (flag gate, per-currency quote, the
// 80/20 split, the double-spend guard, grant) end to end over fake req/res
// streams. Only the process edges are substituted, per the house pattern
// (tests/CLAUDE.md): Postgres via an in-memory db/ledger that keeps the SQL
// contracts (tx_sig uniqueness, quote ownership), and the on-chain verifier via
// a controllable result (the real verifier is covered by talent_payment.test.ts).
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { TALENT_WALLET, TREASURY_WALLET, PAYER_WALLET } = vi.hoisted(() => ({
  TALENT_WALLET: 'Ta1ent22222222222222222222222222222222222',
  TREASURY_WALLET: 'Treasury111111111111111111111111111111111',
  PAYER_WALLET: 'Payer1111111111111111111111111111111111111',
}));

const mem = vi.hoisted(() => {
  const cosmetics = new Map<number, { completedQuestIds: string[]; talentWareIds: string[] }>();
  const wallets = new Map<number, { account_id: number; pubkey: string }>();
  const quotes = new Map<
    string,
    {
      quoteId: string;
      accountId: number;
      kind: string;
      payload: Record<string, unknown>;
      priceBase: bigint;
      mint: string;
      expiresAt: number;
    }
  >();
  const settledSigs = new Set<string>();
  const sales: Array<Record<string, unknown>> = [];
  const verify = {
    result: {
      ok: true,
      spentBase: 0n,
      talentCreditedBase: 0n,
      treasuryCreditedBase: 0n,
    } as {
      ok: boolean;
      reason?: string;
      spentBase: bigint;
      talentCreditedBase: bigint;
      treasuryCreditedBase: bigint;
    },
  };
  return { cosmetics, wallets, quotes, settledSigs, sales, verify };
});

vi.mock('../server/db', () => ({
  loadAccountCosmetics: vi.fn(async (accountId: number) => {
    const row = mem.cosmetics.get(accountId) ?? { completedQuestIds: [], talentWareIds: [] };
    return { mechChromaIds: [], logolWareIds: [], ...row };
  }),
  grantAccountTalentWare: vi.fn(async (accountId: number, wareId: string) => {
    const row = mem.cosmetics.get(accountId) ?? { completedQuestIds: [], talentWareIds: [] };
    if (!row.talentWareIds.includes(wareId)) row.talentWareIds.push(wareId);
    mem.cosmetics.set(accountId, row);
    return { mechChromaIds: [], logolWareIds: [], ...row };
  }),
  walletForAccount: vi.fn(async (accountId: number) => mem.wallets.get(accountId) ?? null),
}));

vi.mock('../server/logol_db', () => ({
  insertWocQuote: vi.fn(
    async (
      quoteId: string,
      accountId: number,
      kind: string,
      payload: Record<string, unknown>,
      priceBase: bigint,
      mint: string,
      expiresAt: number,
    ) => {
      mem.quotes.set(quoteId, { quoteId, accountId, kind, payload, priceBase, mint, expiresAt });
    },
  ),
  getWocQuote: vi.fn(async (quoteId: string, accountId: number) => {
    const q = mem.quotes.get(quoteId);
    return q && q.accountId === accountId ? q : null;
  }),
  deleteWocQuote: vi.fn(async (quoteId: string) => {
    mem.quotes.delete(quoteId);
  }),
}));

vi.mock('../server/talent_db', () => ({
  recordTalentSale: vi.fn(async (sale: { txSig: string }) => {
    if (mem.settledSigs.has(sale.txSig)) return false;
    mem.settledSigs.add(sale.txSig);
    mem.sales.push(sale as Record<string, unknown>);
    return true;
  }),
}));

vi.mock('../server/talent_payment', () => ({
  verifyTalentPayment: vi.fn(async () => mem.verify.result),
}));

vi.mock('../server/talent_config', async (importActual) => {
  const actual = await importActual<typeof import('../server/talent_config')>();
  return {
    ...actual,
    TALENT_PROGRAM_ENABLED: true,
    TALENT_TREASURY: TREASURY_WALLET,
    talentWallet: (_id: string) => TALENT_WALLET,
  };
});

import { talentConfirm, talentQuote, talentStorefront } from '../server/talent';
import { TALENT_WARES } from '../src/sim/content/talent';

const WARE = TALENT_WARES[0];

function makeReq(body: unknown) {
  return Readable.from([JSON.stringify(body)]) as unknown as import('node:http').IncomingMessage;
}

function makeRes() {
  const out = { status: 0, body: undefined as any };
  const res = {
    writeHead: (status: number) => {
      out.status = status;
      return res;
    },
    end: (data?: string) => {
      if (data !== undefined) out.body = JSON.parse(data);
    },
  } as unknown as import('node:http').ServerResponse;
  return { res, out };
}

function linkWallet(accountId: number) {
  mem.wallets.set(accountId, { account_id: accountId, pubkey: PAYER_WALLET });
}

async function quoteFor(accountId: number, wareId: string, currency: string) {
  const { res, out } = makeRes();
  await talentQuote(makeReq({ wareId, currency }), res, accountId);
  return out;
}

async function confirmFor(accountId: number, quoteId: string, signature: string) {
  const { res, out } = makeRes();
  await talentConfirm(makeReq({ quoteId, signature }), res, accountId);
  return out;
}

beforeEach(() => {
  mem.cosmetics.clear();
  mem.wallets.clear();
  mem.quotes.clear();
  mem.settledSigs.clear();
  mem.sales.length = 0;
  mem.verify.result = {
    ok: true,
    spentBase: 0n,
    talentCreditedBase: 0n,
    treasuryCreditedBase: 0n,
  };
});

describe('talent checkout: purchase in each currency', () => {
  for (const currency of ['usdc', 'sol', 'woc'] as const) {
    it(`quotes and settles a ${currency.toUpperCase()} purchase with an 80/20 split`, async () => {
      linkWallet(1);
      const q = await quoteFor(1, WARE.id, currency);
      expect(q.status).toBe(200);
      expect(q.body.currency).toBe(currency);
      // The split is exact: talent + treasury == amount, treasury is 20%.
      const amount = BigInt(q.body.amountBase);
      const talent = BigInt(q.body.talentBase);
      const treasury = BigInt(q.body.treasuryBase);
      expect(talent + treasury).toBe(amount);
      expect(treasury).toBe((amount * 2000n) / 10000n);
      expect(talent).toBe(amount - treasury);

      const sig = `sig-${currency}-${'1'.repeat(70)}`;
      const c = await confirmFor(1, q.body.quoteId, sig);
      expect(c.status).toBe(200);
      expect(c.body.ok).toBe(true);
      expect(c.body.wareId).toBe(WARE.id);
      // The sale was recorded with the split legs.
      expect(mem.sales).toHaveLength(1);
      expect(mem.sales[0].currency).toBe(currency);
      expect(mem.sales[0].talentBase).toBe(talent);
      expect(mem.sales[0].treasuryBase).toBe(treasury);
      // The ware is now owned.
      expect(mem.cosmetics.get(1)?.talentWareIds).toContain(WARE.id);
    });
  }
});

describe('talent checkout: guards', () => {
  it('rejects an invalid currency at quote time', async () => {
    linkWallet(1);
    const { res, out } = makeRes();
    await talentQuote(makeReq({ wareId: WARE.id, currency: 'eth' }), res, 1);
    expect(out.status).toBe(400);
    expect(out.body.error).toBe('bad_currency');
  });

  it('rejects a purchase with no linked wallet', async () => {
    const q = await quoteFor(1, WARE.id, 'usdc');
    expect(q.status).toBe(400);
    expect(q.body.error).toBe('no_wallet');
  });

  it('rejects an unknown ware', async () => {
    linkWallet(1);
    const q = await quoteFor(1, 'not_a_real_ware', 'usdc');
    expect(q.status).toBe(400);
    expect(q.body.error).toBe('unknown_ware');
  });

  it('rejects an unverified/invalid payment at confirm time', async () => {
    linkWallet(1);
    const q = await quoteFor(1, WARE.id, 'usdc');
    mem.verify.result = {
      ok: false,
      reason: 'treasury_short',
      spentBase: 0n,
      talentCreditedBase: 0n,
      treasuryCreditedBase: 0n,
    };
    const c = await confirmFor(1, q.body.quoteId, `sig-${'2'.repeat(72)}`);
    expect(c.status).toBe(400);
    expect(c.body.error).toBe('treasury_short');
    expect(mem.sales).toHaveLength(0);
    expect(mem.cosmetics.get(1)?.talentWareIds ?? []).not.toContain(WARE.id);
  });

  it('treats a not-yet-finalized payment as retryable (409, no grant)', async () => {
    linkWallet(1);
    const q = await quoteFor(1, WARE.id, 'usdc');
    mem.verify.result = {
      ok: false,
      reason: 'not_finalized',
      spentBase: 0n,
      talentCreditedBase: 0n,
      treasuryCreditedBase: 0n,
    };
    const c = await confirmFor(1, q.body.quoteId, `sig-${'3'.repeat(72)}`);
    expect(c.status).toBe(409);
    expect(c.body.error).toBe('not_finalized');
  });

  it('rejects a duplicate tx signature (double-spend) with already_settled', async () => {
    linkWallet(1);
    const q1 = await quoteFor(1, WARE.id, 'usdc');
    const sig = `sig-dup-${'4'.repeat(66)}`;
    const c1 = await confirmFor(1, q1.body.quoteId, sig);
    expect(c1.status).toBe(200);

    // A second quote settled with the SAME signature must be refused.
    linkWallet(2);
    const q2 = await quoteFor(2, WARE.id, 'usdc');
    const c2 = await confirmFor(2, q2.body.quoteId, sig);
    expect(c2.status).toBe(409);
    expect(c2.body.error).toBe('already_settled');
    // Only the first sale recorded; the second account did not receive the ware.
    expect(mem.sales).toHaveLength(1);
    expect(mem.cosmetics.get(2)?.talentWareIds ?? []).not.toContain(WARE.id);
  });

  it('rejects re-buying an already-owned ware at quote time', async () => {
    linkWallet(1);
    mem.cosmetics.set(1, { completedQuestIds: [], talentWareIds: [WARE.id] });
    const q = await quoteFor(1, WARE.id, 'usdc');
    expect(q.status).toBe(409);
    expect(q.body.error).toBe('already_owned');
  });
});

describe('talent storefront', () => {
  it('lists live wares with their per-currency prices when enabled', async () => {
    const { res, out } = makeRes();
    await talentStorefront(res, 1);
    expect(out.status).toBe(200);
    expect(out.body.enabled).toBe(true);
    expect(out.body.currencies).toEqual(['usdc', 'sol', 'woc']);
    expect(out.body.wares.length).toBeGreaterThan(0);
    expect(out.body.wares[0].price).toHaveProperty('usdc');
  });
});
