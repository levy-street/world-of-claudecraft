// Tests the ArenaWagerService gate + delegation + boot recovery in isolation. The
// coordinator, escrow, wallet/holder reads, season check, and store are injected
// fakes, so the service's REAL logic (the hold-to-queue + active-season + linked-
// wallet gate, stake parsing, command delegation, recovery orchestration) is
// exercised end to end without a chain, a DB, or a server.
import { describe, it, expect, vi } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ArenaWagerService, parseStakeBase, type ArenaWagerServiceDeps } from '../server/arena_wager_service';
import type { ArenaWagerCoordinator, WagerClientMsg, EnqueueResult } from '../server/arena_wager';
import type { ArenaEscrow } from '../server/arena_escrow';

const WALLET = Keypair.generate().publicKey.toBase58();

function setup(over: Partial<ArenaWagerServiceDeps> = {}) {
  const sent: { pid: number; msg: WagerClientMsg }[] = [];
  const coord = {
    enqueueResult: { ok: true, queued: false } as EnqueueResult,
    calls: [] as { fn: string; args: any[] }[],
    enqueue(p: any) { this.calls.push({ fn: 'enqueue', args: [p] }); return Promise.resolve(this.enqueueResult); },
    onStakeSubmitted(...a: any[]) { this.calls.push({ fn: 'onStakeSubmitted', args: a }); return Promise.resolve(); },
    dequeue(...a: any[]) { this.calls.push({ fn: 'dequeue', args: a }); },
    onBoutEnd(...a: any[]) { this.calls.push({ fn: 'onBoutEnd', args: a }); return Promise.resolve(); },
    poll() { this.calls.push({ fn: 'poll', args: [] }); return Promise.resolve(); },
  };
  const escrow = {
    matchStatus: vi.fn(async (): Promise<number | null> => null), // closed PDA => reconcile, no refund
    refundDraw: vi.fn(async () => ({ signature: 'refund-sig' })),
  };
  const store = { setPhase: vi.fn(async () => {}) };
  const deps: ArenaWagerServiceDeps = {
    coordinator: coord as unknown as ArenaWagerCoordinator,
    notify: (pid, msg) => sent.push({ pid, msg }),
    walletFor: async () => WALLET,
    holderInfoFor: async () => ({ tier: 3, balance: 1000 }),
    minHolderTier: 1,
    seasonActive: async () => true,
    escrow: escrow as unknown as ArenaEscrow,
    store,
    loadRecoverable: async () => [{ matchId: 9n, creatorWallet: WALLET, opponentWallet: WALLET, stakeBase: 100n }],
    cancelStale: async () => 2,
    ...over,
  };
  return { service: new ArenaWagerService(deps), sent, coord, escrow, store };
}
const lastError = (sent: { msg: WagerClientMsg }[]) => sent.filter((s) => s.msg.t === 'wager_error').map((s) => (s.msg as any).reason).pop();

describe('parseStakeBase (boundary + invalid input)', () => {
  it('accepts a positive integer string', () => expect(parseStakeBase('100000000')).toBe(100_000_000n));
  it('rejects zero, negative, empty, non-numeric, leading-zero, and non-string', () => {
    for (const bad of ['0', '-5', '', 'abc', '01', '1.5', ' 10', 10 as unknown, null, undefined]) {
      expect(parseStakeBase(bad)).toBe(null);
    }
  });
});

describe('ArenaWagerService.handleQueue gate', () => {
  const sess = { pid: 7, accountId: 42 };
  it('rejects a malformed stake before any wallet/season read', async () => {
    const { service, sent, coord } = setup();
    await service.handleQueue(sess, 'not-a-number');
    expect(lastError(sent)).toBe('Invalid stake amount.');
    expect(coord.calls).toHaveLength(0);
  });
  it('rejects when no reward season is active', async () => {
    const { service, sent, coord } = setup({ seasonActive: async () => false });
    await service.handleQueue(sess, '100000000');
    expect(lastError(sent)).toBe('No reward season is active right now.');
    expect(coord.calls).toHaveLength(0);
  });
  it('rejects when no verified wallet is linked', async () => {
    const { service, sent } = setup({ walletFor: async () => null });
    await service.handleQueue(sess, '100000000');
    expect(lastError(sent)).toBe('Link a verified $WOC wallet to wager.');
  });
  it('rejects when the holder tier is below the hold-to-queue minimum', async () => {
    const { service, sent, coord } = setup({ holderInfoFor: async () => ({ tier: 0, balance: 5 }), minHolderTier: 1 });
    await service.handleQueue(sess, '100000000');
    expect(lastError(sent)).toBe('You need to hold more $WOC to enter wagered matches.');
    expect(coord.calls).toHaveLength(0);
  });
  it('enqueues with the resolved wallet when every gate passes', async () => {
    const { service, sent, coord } = setup();
    await service.handleQueue(sess, '100000000');
    expect(sent.filter((s) => s.msg.t === 'wager_error')).toHaveLength(0);
    const call = coord.calls.find((c) => c.fn === 'enqueue')!;
    expect(call.args[0]).toMatchObject({ pid: 7, stakeBase: 100_000_000n });
    expect((call.args[0].wallet as PublicKey).toBase58()).toBe(WALLET);
  });
  it('surfaces a coordinator enqueue refusal as a wager_error', async () => {
    const { service, sent, coord } = setup();
    coord.enqueueResult = { ok: false, reason: 'already_queued' };
    await service.handleQueue(sess, '100000000');
    expect(lastError(sent)).toBe('You are already queued or in a wagered match.');
  });
});

describe('ArenaWagerService delegation', () => {
  const sess = { pid: 7, accountId: 42 };
  it('handleStaked forwards valid strings and ignores malformed input', async () => {
    const { service, coord } = setup();
    await service.handleStaked(sess, 'match-1', 'sig-1');
    await service.handleStaked(sess, 123 as unknown, 'sig'); // bad matchId
    expect(coord.calls.filter((c) => c.fn === 'onStakeSubmitted')).toEqual([{ fn: 'onStakeSubmitted', args: [7, 'match-1', 'sig-1'] }]);
  });
  it('handleCancel and onLeave dequeue, onArenaEnd settles, poll ticks', async () => {
    const { service, coord } = setup();
    service.handleCancel(sess);
    service.onLeave(9);
    await service.onArenaEnd(7, true, false);
    await service.poll();
    expect(coord.calls.map((c) => c.fn)).toEqual(['dequeue', 'dequeue', 'onBoutEnd', 'poll']);
    expect(coord.calls[0].args).toEqual([7]);
    expect(coord.calls[2].args).toEqual([7, true, false]);
  });
});

describe('ArenaWagerService.recoverOnBoot', () => {
  it('cancels stale pairings and reconciles recoverable matches, returning counts', async () => {
    const { service, escrow, store } = setup();
    const r = await service.recoverOnBoot();
    expect(r).toEqual({ refunded: 0, reconciled: 1, staleCancelled: 2 });
    expect(escrow.matchStatus).toHaveBeenCalledWith(9n);
    expect(escrow.refundDraw).not.toHaveBeenCalled(); // closed PDA => no refund
    expect(store.setPhase).toHaveBeenCalledWith(9n, 'settled');
  });
  it('refunds a still-Locked recoverable match on boot', async () => {
    const { service, escrow, store } = setup();
    escrow.matchStatus = vi.fn(async () => 1); // Locked
    const r = await service.recoverOnBoot();
    expect(r.refunded).toBe(1);
    expect(escrow.refundDraw).toHaveBeenCalled();
    expect(store.setPhase).toHaveBeenCalledWith(9n, 'refunded', 'refund-sig');
  });
});
