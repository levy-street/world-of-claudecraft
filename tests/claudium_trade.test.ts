import { beforeEach, describe, expect, it, vi } from 'vitest';

// The economy-service proxy is the IO boundary; stub it so the dedupe-key contract
// (the idempotency the PRD calls out) and the balance cache are pinned as literals,
// without any network. Mirrors woc_trade.test.ts's fetch-stub treatment of the
// analogous $WOC boundary.
const proxy = vi.hoisted(() => ({
  transferClaudium: vi.fn(),
  claudiumBalance: vi.fn(),
}));
vi.mock('../server/claudium_proxy', () => ({
  transferClaudium: proxy.transferClaudium,
  claudiumBalance: proxy.claudiumBalance,
}));

import { createClaudiumTrade } from '../server/claudium_trade';

beforeEach(() => {
  proxy.transferClaudium.mockReset();
  proxy.claudiumBalance.mockReset();
});

describe('createClaudiumTrade dedupe keys', () => {
  it('executeClaudiumLeg forwards from->to with the literal trade-<id>-<dir> key', async () => {
    proxy.transferClaudium.mockResolvedValue({ ok: true });
    const trade = createClaudiumTrade();

    const rA = await trade.executeClaudiumLeg(42, 'a', 100, 200, 5);
    const rB = await trade.executeClaudiumLeg(42, 'b', 200, 100, 7);

    expect(rA).toEqual({ ok: true });
    expect(rB).toEqual({ ok: true });
    expect(proxy.transferClaudium.mock.calls[0]).toEqual([100, 200, 5, 'trade-42-a']);
    expect(proxy.transferClaudium.mock.calls[1]).toEqual([200, 100, 7, 'trade-42-b']);
  });

  it('refundClaudiumLeg reverses to->from with the distinct trade-refund-<id>-<dir> key', async () => {
    proxy.transferClaudium.mockResolvedValue({ ok: true });
    const trade = createClaudiumTrade();

    // forward was from=100 -> to=200; the refund sends 200 -> 100 under its own key
    await trade.refundClaudiumLeg(42, 'a', 100, 200, 5);

    expect(proxy.transferClaudium.mock.calls[0]).toEqual([200, 100, 5, 'trade-refund-42-a']);
  });

  it('fails closed: a proxy ok:false propagates as the leg result', async () => {
    proxy.transferClaudium.mockResolvedValue({ ok: false, reason: 'declined' });
    const trade = createClaudiumTrade();

    const r = await trade.executeClaudiumLeg(1, 'a', 1, 2, 3);

    expect(r).toEqual({ ok: false, reason: 'declined' });
  });
});

describe('createClaudiumTrade balance cache', () => {
  it('refresh populates the cache; claudiumBalanceFor reads it and defaults unknown accounts to 0', async () => {
    proxy.claudiumBalance.mockResolvedValue({ available: true, balance: 250 });
    const trade = createClaudiumTrade();

    expect(trade.claudiumBalanceFor(7)).toBe(0); // never refreshed
    await trade.refresh(7);
    expect(trade.claudiumBalanceFor(7)).toBe(250);
    expect(proxy.claudiumBalance).toHaveBeenCalledWith(7);
  });

  it('a null balance (service off) leaves the cache untouched', async () => {
    proxy.claudiumBalance.mockResolvedValueOnce({ available: true, balance: 40 });
    const trade = createClaudiumTrade();
    await trade.refresh(7);
    expect(trade.claudiumBalanceFor(7)).toBe(40);

    proxy.claudiumBalance.mockResolvedValueOnce({ available: false, balance: null });
    await trade.refresh(7);
    // the stale-but-known value is kept rather than clobbered to 0
    expect(trade.claudiumBalanceFor(7)).toBe(40);
  });
});
