// Exercises the server layer of the $WOC-paid respec + loadout-slot flow (#472):
//   - server/respec_actions.ts: prepare (validate + price) and apply (offline
//     state edit) for both kinds, including the loadout-slot ceiling guard and
//     the offline-only requirement.
//   - server/respec.ts confirm route: fail-closed behind PAID_RESPEC_ENABLED,
//     rejection of an unverified payment, and the shared tx_sig replay guard.
// The DB + the on-chain verifier are mocked; the real paid_respec transforms and
// the real reason/status mapping run.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The respec routes are fail-closed behind PAID_RESPEC_ENABLED, read at import
// time in server/woc_config.ts. ES imports are evaluated before top-level
// statements, so set the env in a hoisted block that runs BEFORE the static
// imports below; the flag-off case re-imports with it unset.
vi.hoisted(() => {
  process.env.WOC_PAID_RESPEC_ENABLED = '1';
});

vi.mock('../server/db', () => ({
  getCharacter: vi.fn(),
  mutateOfflineCharacterState: vi.fn(),
  walletForAccount: vi.fn(async () => ({ pubkey: 'Payer1111' })),
  getWocQuote: vi.fn(),
  createWocQuote: vi.fn(),
  deleteWocQuote: vi.fn(async () => {}),
  pruneWocQuotes: vi.fn(async () => {}),
  recordWocPayment: vi.fn(),
}));

vi.mock('../server/woc_payment', () => ({
  verifyWocPayment: vi.fn(),
}));

vi.mock('../server/solana_tx', () => ({
  getLatestBlockhash: vi.fn(async () => 'blockhash'),
  largestTokenAccountForOwner: vi.fn(async () => 'TokenAcct'),
}));

import * as db from '../server/db';
import { handleRespecConfirm, registerRespecActions } from '../server/respec';
import { makeRespecActions } from '../server/respec_actions';
import { verifyWocPayment } from '../server/woc_payment';

const charRow = (over: Partial<any> = {}) => ({
  id: 1,
  account_id: 10,
  name: 'Hero',
  class: 'warrior',
  level: 20,
  state: { level: 20, talents: { spec: 'arms', ranks: { impale: 2 } }, loadoutSlots: 0 },
  is_gm: false,
  force_rename: false,
  ...over,
});

// A tiny fake http response that records the status + JSON body.
function fakeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined as unknown,
    setHeader() {},
    writeHead(code: number) {
      res.statusCode = code;
      return res;
    },
    end(payload?: string) {
      if (payload) res.body = JSON.parse(payload);
    },
  };
  return res;
}

function fakeReq(body: unknown) {
  return { body } as any;
}

// server/http_util.readBody reads the raw request stream; stub it to return our
// preset body object so the confirm handler sees { quoteId, signature }.
vi.mock('../server/http_util', async (importActual) => {
  const actual = await importActual<typeof import('../server/http_util')>();
  return {
    ...actual,
    readBody: vi.fn(async (req: any) => req.body ?? {}),
  };
});

beforeEach(() => {
  vi.mocked(db.getCharacter)
    .mockReset()
    .mockResolvedValue(charRow() as any);
  vi.mocked(db.mutateOfflineCharacterState)
    .mockReset()
    .mockResolvedValue({ ok: true } as any);
  vi.mocked(db.getWocQuote).mockReset();
  vi.mocked(db.recordWocPayment).mockReset();
  vi.mocked(verifyWocPayment).mockReset();
});

describe('makeRespecActions: prepare', () => {
  const online = (v: boolean) => makeRespecActions({ isCharacterOnline: () => v });

  it('prices a respec for an offline character', async () => {
    const r = await online(false).prepare(10, 'respec', { characterId: 1 });
    expect(r).toMatchObject({ ok: true, priceKey: 'respec', payload: { characterId: 1 } });
  });

  it('refuses a respec while the character is online', async () => {
    const r = await online(true).prepare(10, 'respec', { characterId: 1 });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('prices a loadout-slot unlock when below the ceiling', async () => {
    const r = await online(false).prepare(10, 'unlock_loadout_slot', { characterId: 1 });
    expect(r).toMatchObject({ ok: true, priceKey: 'loadout_slot' });
  });

  it('rejects a loadout-slot unlock at the hard ceiling (no paid no-op)', async () => {
    // loadoutSlots high enough that the effective cap is already at the max.
    vi.mocked(db.getCharacter).mockResolvedValue(
      charRow({ state: { level: 20, loadoutSlots: 999 } }) as any,
    );
    const r = await online(false).prepare(10, 'unlock_loadout_slot', { characterId: 1 });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});

describe('makeRespecActions: apply', () => {
  const acts = makeRespecActions({ isCharacterOnline: () => false });

  it('respec applies the offline transform and returns 200', async () => {
    const r = await acts.apply(10, 'respec', { characterId: 1 });
    expect(r.status).toBe(200);
    expect(db.mutateOfflineCharacterState).toHaveBeenCalledWith(10, 1, expect.any(Function));
  });

  it('an "unchanged" mutation (already at ceiling) surfaces as 409', async () => {
    vi.mocked(db.mutateOfflineCharacterState).mockResolvedValue({
      ok: false,
      reason: 'unchanged',
    } as any);
    const r = await acts.apply(10, 'unlock_loadout_slot', { characterId: 1 });
    expect(r.status).toBe(409);
  });
});

describe('handleRespecConfirm (route: flag, payment, replay)', () => {
  beforeEach(() => {
    registerRespecActions(makeRespecActions({ isCharacterOnline: () => false }));
    vi.mocked(db.getWocQuote).mockResolvedValue({
      quote_id: 'q1',
      account_id: 10,
      kind: 'respec:respec',
      payload: { characterId: 1 },
      price_base: '750000000',
      mint: '3WjLscH2JsXLEFJZRA9z8ti8yRGxWGKbqymPd7UicRth',
    } as any);
  });

  it('rejects an unverified payment (verifier fails)', async () => {
    vi.mocked(verifyWocPayment).mockResolvedValue({ ok: false, reason: 'burn_missing' } as any);
    const res = fakeRes();
    await handleRespecConfirm(fakeReq({ quoteId: 'q1', signature: '5'.repeat(80) }), res, 10);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ reason: 'burn_missing' });
    // Never records a payment for an unverified burn.
    expect(db.recordWocPayment).not.toHaveBeenCalled();
  });

  it('rejects a duplicate tx signature (shared replay guard, 409)', async () => {
    vi.mocked(verifyWocPayment).mockResolvedValue({
      ok: true,
      spentBase: 750000000n,
      burnedBase: 750000000n,
    } as any);
    // recordWocPayment returns null when the tx_sig was already consumed.
    vi.mocked(db.recordWocPayment).mockResolvedValue(null);
    const res = fakeRes();
    await handleRespecConfirm(fakeReq({ quoteId: 'q1', signature: '5'.repeat(80) }), res, 10);
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: expect.stringMatching(/already used/i) });
  });

  it('applies exactly once on a fresh, verified payment', async () => {
    vi.mocked(verifyWocPayment).mockResolvedValue({
      ok: true,
      spentBase: 750000000n,
      burnedBase: 750000000n,
    } as any);
    vi.mocked(db.recordWocPayment).mockResolvedValue({ id: 1 });
    const res = fakeRes();
    await handleRespecConfirm(fakeReq({ quoteId: 'q1', signature: '5'.repeat(80) }), res, 10);
    expect(res.statusCode).toBe(200);
    expect(db.mutateOfflineCharacterState).toHaveBeenCalledTimes(1);
  });
});

describe('fail-closed behind PAID_RESPEC_ENABLED', () => {
  it('every respec route 404s when the flag is off', async () => {
    // Re-import the route module with the flag unset so the module-level
    // PAID_RESPEC_ENABLED re-evaluates to false in a fresh module registry.
    vi.resetModules();
    const prev = process.env.WOC_PAID_RESPEC_ENABLED;
    delete process.env.WOC_PAID_RESPEC_ENABLED;
    delete process.env.PAID_RESPEC_ENABLED;
    try {
      const mod = await import('../server/respec');
      const res = fakeRes();
      mod.handleRespecPrices(res);
      expect(res.statusCode).toBe(404);
    } finally {
      if (prev !== undefined) process.env.WOC_PAID_RESPEC_ENABLED = prev;
    }
  });
});
