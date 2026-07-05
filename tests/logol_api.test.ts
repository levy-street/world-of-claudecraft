// Drives the REAL server/logol.ts handlers (gates, per-ware pricing, quote TTL,
// replay guard, grant) end to end over fake req/res streams. Only the process
// edges are substituted, per the house pattern (tests/CLAUDE.md): Postgres via
// an in-memory db/ledger that keeps the SQL contracts (tx_sig uniqueness, quote
// ownership), and the on-chain verifier via a controllable result (the real
// verifier is covered by tests/woc_payment.test.ts).
import { Readable } from 'node:stream';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => {
  const cosmetics = new Map<number, { completedQuestIds: string[]; logolWareIds: string[] }>();
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
  const verify = {
    result: { ok: true, spentBase: 0n, burnedBase: 0n } as {
      ok: boolean;
      reason?: string;
      spentBase: bigint;
      burnedBase: bigint;
    },
  };
  return { cosmetics, wallets, quotes, settledSigs, verify };
});

vi.mock('../server/db', () => ({
  loadAccountCosmetics: vi.fn(async (accountId: number) => {
    const row = mem.cosmetics.get(accountId) ?? { completedQuestIds: [], logolWareIds: [] };
    return { mechChromaIds: [], ...row };
  }),
  grantAccountLogolWare: vi.fn(async (accountId: number, wareId: string) => {
    const row = mem.cosmetics.get(accountId) ?? { completedQuestIds: [], logolWareIds: [] };
    if (!row.logolWareIds.includes(wareId)) row.logolWareIds.push(wareId);
    mem.cosmetics.set(accountId, row);
    return { mechChromaIds: [], ...row };
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
  // Faithful to the SQL contract: tx_sig is UNIQUE, a duplicate insert is a no-op.
  recordWocPayment: vi.fn(async (_accountId: number, txSig: string) => {
    if (mem.settledSigs.has(txSig)) return false;
    mem.settledSigs.add(txSig);
    return true;
  }),
}));

vi.mock('../server/woc_payment', () => ({
  verifyWocPayment: vi.fn(async () => mem.verify.result),
}));

vi.mock('../server/woc_config', async (importActual) => {
  const actual = await importActual<typeof import('../server/woc_config')>();
  return { ...actual, LOGOL_ENABLED: true };
});

import { logolConfirm, logolInfo, logolInventory, logolQuote } from '../server/logol';
import { wocToBase } from '../server/woc_config';
import {
  LOGOL_FLAGSHIP_WARE_ID,
  LOGOL_ROTATION_SIZE,
  LOGOL_UNLOCK_QUEST_ID,
  LOGOL_WARES,
  logolOfferedWares,
} from '../src/sim/content/logol';
import { LOGOL_APPEAR_PERIOD_MS, LOGOL_VISIT_MS, logolWeekIndex } from '../src/sim/logol_roam';

// A moment inside week 100's visit window, and one after it closed.
const T_PRESENT = 100 * LOGOL_APPEAR_PERIOD_MS + 1000;
const T_AWAY = 100 * LOGOL_APPEAR_PERIOD_MS + LOGOL_VISIT_MS + 1000;
const WEEK_100 = logolWeekIndex(T_PRESENT);

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

function unlockAccount(accountId: number, owned: string[] = []) {
  mem.cosmetics.set(accountId, {
    completedQuestIds: [LOGOL_UNLOCK_QUEST_ID],
    logolWareIds: owned,
  });
  mem.wallets.set(accountId, { account_id: accountId, pubkey: 'PayerPubkey11111111111111111111' });
}

async function quoteFor(accountId: number, wareId: string) {
  const { res, out } = makeRes();
  await logolQuote(makeReq({ wareId }), res, accountId);
  return out;
}

async function confirmFor(accountId: number, quoteId: string, signature: string) {
  const { res, out } = makeRes();
  await logolConfirm(makeReq({ quoteId, signature }), res, accountId);
  return out;
}

beforeEach(() => {
  mem.cosmetics.clear();
  mem.wallets.clear();
  mem.quotes.clear();
  mem.settledSigs.clear();
  mem.verify.result = { ok: true, spentBase: 111n, burnedBase: 111n };
  vi.useFakeTimers();
  vi.setSystemTime(T_PRESENT);
});

afterAll(() => {
  vi.useRealTimers();
});

describe('GET /api/logol/info + /inventory', () => {
  it("returns this week's offered wares with per-ware prices and the unlock state", async () => {
    const { res, out } = makeRes();
    await logolInfo(res, 1);
    expect(out.status).toBe(200);
    expect(out.body.enabled).toBe(true);
    expect(out.body.unlocked).toBe(false);
    expect(out.body.present).toBe(true);
    expect(out.body.weekIndex).toBe(WEEK_100);
    expect(out.body.wares).toHaveLength(1 + LOGOL_ROTATION_SIZE);
    expect(out.body.wares[0].id).toBe(LOGOL_FLAGSHIP_WARE_ID);
    expect(out.body.wares[0].priceWoc).toBe(250000);
  });

  it('inventory lists owned wares from any week', async () => {
    unlockAccount(7, [LOGOL_FLAGSHIP_WARE_ID]);
    const { res, out } = makeRes();
    await logolInventory(res, 7);
    expect(out.status).toBe(200);
    expect(out.body.wares.map((w: { id: string }) => w.id)).toEqual([LOGOL_FLAGSHIP_WARE_ID]);
  });
});

describe('POST /api/logol/quote gates', () => {
  it('refuses while Logol is away', async () => {
    unlockAccount(1);
    vi.setSystemTime(T_AWAY);
    const out = await quoteFor(1, LOGOL_FLAGSHIP_WARE_ID);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe('logol_away');
  });

  it('refuses a locked shop, an unknown ware, and a ware outside this week', async () => {
    // Locked (quest chain not done).
    mem.wallets.set(1, { account_id: 1, pubkey: 'PayerPubkey11111111111111111111' });
    mem.cosmetics.set(1, { completedQuestIds: [], logolWareIds: [] });
    expect((await quoteFor(1, LOGOL_FLAGSHIP_WARE_ID)).body.error).toBe('shop_locked');
    // Unknown ware.
    unlockAccount(1);
    expect((await quoteFor(1, 'not_a_ware')).body.error).toBe('unknown_ware');
    // Offered-this-week gate: pick a pool ware NOT in week 100's rotation.
    const offered = new Set(logolOfferedWares(WEEK_100).map((w) => w.id));
    const notOffered = LOGOL_WARES.find((w) => !offered.has(w.id));
    expect(notOffered).toBeDefined();
    const out = await quoteFor(1, notOffered?.id ?? '');
    expect(out.status).toBe(409);
    expect(out.body.error).toBe('not_offered_this_week');
  });

  it('refuses an already-owned ware and a wallet-less account', async () => {
    unlockAccount(1, [LOGOL_FLAGSHIP_WARE_ID]);
    expect((await quoteFor(1, LOGOL_FLAGSHIP_WARE_ID)).body.error).toBe('already_owned');
    mem.cosmetics.set(2, { completedQuestIds: [LOGOL_UNLOCK_QUEST_ID], logolWareIds: [] });
    expect((await quoteFor(2, LOGOL_FLAGSHIP_WARE_ID)).body.error).toBe('no_wallet');
  });

  it('quotes the PER-WARE price in base units', async () => {
    unlockAccount(1);
    const out = await quoteFor(1, LOGOL_FLAGSHIP_WARE_ID);
    expect(out.status).toBe(200);
    expect(out.body.priceWoc).toBe(250000);
    expect(out.body.amountBase).toBe(wocToBase(250000).toString());
    // A rotating ware quotes its own (thousands-band) price, not the flagship's.
    const cheap = logolOfferedWares(WEEK_100).find((w) => w.id !== LOGOL_FLAGSHIP_WARE_ID);
    expect(cheap).toBeDefined();
    const out2 = await quoteFor(1, cheap?.id ?? '');
    expect(out2.body.priceWoc).toBe(cheap?.priceWoc);
    expect(out2.body.amountBase).toBe(wocToBase(cheap?.priceWoc ?? 0).toString());
  });
});

describe('POST /api/logol/confirm', () => {
  it('grants the ware on a verified payment and deletes the quote', async () => {
    unlockAccount(1);
    const quote = await quoteFor(1, LOGOL_FLAGSHIP_WARE_ID);
    const out = await confirmFor(1, quote.body.quoteId, 'sig_happy');
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    expect(out.body.wares.map((w: { id: string }) => w.id)).toContain(LOGOL_FLAGSHIP_WARE_ID);
    // Quote consumed: a second confirm cannot find it.
    expect((await confirmFor(1, quote.body.quoteId, 'sig_happy')).body.error).toBe(
      'quote_not_found',
    );
  });

  it('the tx_sig replay guard blocks reusing one payment for a second quote', async () => {
    unlockAccount(1);
    const cheap = logolOfferedWares(WEEK_100).find((w) => w.id !== LOGOL_FLAGSHIP_WARE_ID);
    const q1 = await quoteFor(1, LOGOL_FLAGSHIP_WARE_ID);
    expect((await confirmFor(1, q1.body.quoteId, 'sig_reused')).status).toBe(200);
    const q2 = await quoteFor(1, cheap?.id ?? '');
    const out = await confirmFor(1, q2.body.quoteId, 'sig_reused');
    expect(out.status).toBe(409);
    expect(out.body.error).toBe('already_settled');
    // And the second ware was NOT granted.
    expect(mem.cosmetics.get(1)?.logolWareIds).toEqual([LOGOL_FLAGSHIP_WARE_ID]);
  });

  it('a not-finalized payment is retryable: quote survives, later confirm succeeds', async () => {
    unlockAccount(1);
    const quote = await quoteFor(1, LOGOL_FLAGSHIP_WARE_ID);
    mem.verify.result = { ok: false, reason: 'not_finalized', spentBase: 0n, burnedBase: 0n };
    const pending = await confirmFor(1, quote.body.quoteId, 'sig_slow');
    expect(pending.status).toBe(409);
    expect(pending.body.error).toBe('not_finalized');
    expect(mem.quotes.has(quote.body.quoteId)).toBe(true);
    mem.verify.result = { ok: true, spentBase: 1n, burnedBase: 1n };
    expect((await confirmFor(1, quote.body.quoteId, 'sig_slow')).status).toBe(200);
  });

  it('an expired quote is rejected and cleaned up', async () => {
    unlockAccount(1);
    const quote = await quoteFor(1, LOGOL_FLAGSHIP_WARE_ID);
    vi.setSystemTime(T_PRESENT + 16 * 60 * 1000);
    const out = await confirmFor(1, quote.body.quoteId, 'sig_late');
    expect(out.status).toBe(400);
    expect(out.body.error).toBe('quote_expired');
    expect(mem.quotes.has(quote.body.quoteId)).toBe(false);
  });

  it("rejects another account's quote and malformed bodies", async () => {
    unlockAccount(1);
    unlockAccount(2);
    const quote = await quoteFor(1, LOGOL_FLAGSHIP_WARE_ID);
    expect((await confirmFor(2, quote.body.quoteId, 'sig_theft')).body.error).toBe(
      'quote_not_found',
    );
    const { res, out } = makeRes();
    await logolConfirm(makeReq({ quoteId: 123, signature: null }), res, 1);
    expect(out.body.error).toBe('bad_request');
  });

  it('a week rollover inside the quote TTL does not invalidate the purchase', async () => {
    unlockAccount(1);
    // Quote in the last minute of the visit window.
    vi.setSystemTime(100 * LOGOL_APPEAR_PERIOD_MS + LOGOL_VISIT_MS - 60_000);
    const quote = await quoteFor(1, LOGOL_FLAGSHIP_WARE_ID);
    expect(quote.status).toBe(200);
    // Confirm lands after the window closed (still inside the 15 min TTL).
    vi.setSystemTime(100 * LOGOL_APPEAR_PERIOD_MS + LOGOL_VISIT_MS + 60_000);
    expect((await confirmFor(1, quote.body.quoteId, 'sig_rollover')).status).toBe(200);
  });
});
