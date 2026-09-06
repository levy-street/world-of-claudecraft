// The Exchange Vault handlers (server/woc_market_held_routes.ts) over a fake
// service and fakeCtx: the wire shapes and the refusal routing.

import { describe, expect, it } from 'vitest';
import { HttpError } from '../../server/http/errors';
import type { WocMarketHeldService } from '../../server/woc_market_held';
import { createWocHeldHandlers } from '../../server/woc_market_held_routes';
import { fakeCtx } from './helpers';

function sent(ctx: ReturnType<typeof fakeCtx>): { status: number; body: Record<string, unknown> } {
  const res = ctx.res as unknown as { statusCode: number; body: string };
  return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
}

function handlers(held: Partial<WocMarketHeldService> | null) {
  const busts: string[] = [];
  const h = createWocHeldHandlers({
    held: () => held as WocMarketHeldService | null,
    throwRefusal: (refusal) => {
      throw new HttpError(400, 'woc_market.invalid_input', { reason: refusal.reason });
    },
    bustMe: (account) => busts.push(`me:${account}`),
    bustHistoryAll: () => busts.push('history'),
  });
  return { h, busts };
}

const ACCOUNT = { accountId: 7, username: 'seven', scope: 'full' as const };

describe('GET /held', () => {
  it('answers the off shape on a realm without a Vault', async () => {
    const { h } = handlers(null);
    const ctx = fakeCtx({ account: ACCOUNT });
    await h.readout(ctx);
    expect(sent(ctx)).toEqual({
      status: 200,
      body: { enabled: false, base: '0', tokens: 0, canWithdraw: false, entries: [] },
    });
  });

  it('serializes the readout with base, tokens, and the entry views', async () => {
    const { h } = handlers({
      readout: async () => ({
        enabled: true,
        base: '1500000000',
        tokens: 1.5,
        canWithdraw: true,
        entries: [
          {
            id: 3,
            account: 7,
            ref: 'held:sale:9',
            kind: 'sale',
            deltaBase: '1500000000',
            settlementId: 9,
            createdAtMs: 1_000,
          },
        ],
      }),
    });
    const ctx = fakeCtx({ account: ACCOUNT });
    await h.readout(ctx);
    expect(sent(ctx).body).toEqual({
      enabled: true,
      base: '1500000000',
      tokens: 1.5,
      canWithdraw: true,
      entries: [{ id: 3, kind: 'sale', deltaBase: '1500000000', settlementId: 9, atMs: 1_000 }],
    });
  });
});

describe('POST /held/withdraw', () => {
  it('refuses held_disabled without a Vault', async () => {
    const { h } = handlers(null);
    await expect(h.withdraw(fakeCtx({ account: ACCOUNT, method: 'POST' }))).rejects.toMatchObject({
      status: 403,
      code: 'woc_market.held_disabled',
    });
  });

  it('busts the readout on both arms and answers the moved figure', async () => {
    const { h, busts } = handlers({
      withdraw: async () => ({ ok: true, base: '5', tokens: 0.000000005, wallet: 'w' }),
    });
    const ctx = fakeCtx({ account: ACCOUNT, method: 'POST' });
    await h.withdraw(ctx);
    expect(sent(ctx).body).toEqual({ base: '5', tokens: 0.000000005, wallet: 'w' });
    expect(busts).toEqual(['me:7']);
    const { h: refusing, busts: refusedBusts } = handlers({
      withdraw: async () => ({ ok: false, reason: 'held_empty' }),
    });
    await expect(
      refusing.withdraw(fakeCtx({ account: ACCOUNT, method: 'POST' })),
    ).rejects.toMatchObject({ params: { reason: 'held_empty' } });
    expect(refusedBusts).toEqual(['me:7']);
  });
});

describe('POST /settlements/:id/confirm-held', () => {
  it('routes the id, screens the pending reason, and busts history on a confirmed answer', async () => {
    const seen: number[] = [];
    const { h, busts } = handlers({
      confirmFromHeld: async (_account, id) => {
        seen.push(id);
        return { ok: true, state: 'confirmed', reason: null };
      },
    });
    const ctx = fakeCtx({ account: ACCOUNT, method: 'POST', params: { id: '42' } });
    await h.confirmHeld(ctx);
    expect(seen).toEqual([42]);
    expect(sent(ctx).body).toEqual({ state: 'confirmed', reason: null });
    expect(busts).toEqual(['me:7', 'history']);
  });

  it('collapses an unknown pending word to the screened vocabulary', async () => {
    const { h, busts } = handlers({
      confirmFromHeld: async () => ({ ok: true, state: 'confirming', reason: 'weird_word' }),
    });
    const ctx = fakeCtx({ account: ACCOUNT, method: 'POST', params: { id: '1' } });
    await h.confirmHeld(ctx);
    expect(sent(ctx).body).toEqual({ state: 'confirming', reason: 'other' });
    expect(busts).toEqual(['me:7']);
  });
});
