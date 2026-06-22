// Tests the ArenaWagerCoordinator state machine (server/arena_wager.ts) in
// isolation: the escrow rail, the sim seam, the clock, and WS delivery are all
// injected fakes, so the REAL coordinator logic (pairing, the stake handshake,
// the on-chain stake gate, winner resolution, settle/refund, timeouts,
// idempotency) is exercised end to end without a chain or a server.
import { describe, it, expect, vi } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { ArenaWagerCoordinator, type WagerClientMsg } from '../server/arena_wager';
import type { ArenaEscrow } from '../server/arena_escrow';

const fakeTx = () => ({ serialize: () => Buffer.from('faketx') });

class FakeEscrow {
  bothStakedResult = true;
  startable = true;
  settleResult = { signature: 'settle-sig', potBase: 200_000_000n, payoutBase: 190_000_000n, burnBase: 10_000_000n, headroomBase: 10_000_000n };
  refundResult = { signature: 'refund-sig' };
  calls: { fn: string; arg: any }[] = [];
  async buildOpenTx(a: any) { this.calls.push({ fn: 'open', arg: a }); return fakeTx() as any; }
  async buildJoinTx(a: any) { this.calls.push({ fn: 'join', arg: a }); return fakeTx() as any; }
  async bothStaked(a: any) { this.calls.push({ fn: 'bothStaked', arg: a }); return this.bothStakedResult; }
  async settle(ref: any, winner: PublicKey) { this.calls.push({ fn: 'settle', arg: { ref, winner: winner.toBase58() } }); return this.settleResult; }
  async refundDraw(ref: any) { this.calls.push({ fn: 'refund', arg: ref }); return this.refundResult; }
}

function setup(stakeTimeoutMs = 30_000) {
  const escrow = new FakeEscrow();
  const sent: { pid: number; msg: WagerClientMsg }[] = [];
  const startBout = vi.fn(() => escrow.startable);
  let clock = 1_000_000;
  let nextId = 1n;
  const coord = new ArenaWagerCoordinator({
    escrow: escrow as unknown as ArenaEscrow,
    startBout,
    notify: (pid, msg) => sent.push({ pid, msg }),
    now: () => clock,
    stakeTimeoutMs,
    nextMatchId: () => nextId++,
  });
  const creator = { pid: 1, wallet: Keypair.generate().publicKey, stakeBase: 100_000_000n };
  const opponent = { pid: 2, wallet: Keypair.generate().publicKey, stakeBase: 100_000_000n };
  return { coord, escrow, sent, startBout, creator, opponent, advance: (ms: number) => { clock += ms; } };
}
const msgsFor = (sent: { pid: number; msg: WagerClientMsg }[], pid: number) => sent.filter((s) => s.pid === pid).map((s) => s.msg);

describe('ArenaWagerCoordinator pairing', () => {
  it('pairs two equal-stake players and hands each their unsigned stake tx', async () => {
    const { coord, escrow, sent, creator, opponent } = setup();
    await coord.enqueue(creator);
    expect(sent.length).toBe(0); // first player waits
    await coord.enqueue(opponent);
    const cMsg = msgsFor(sent, 1)[0];
    const oMsg = msgsFor(sent, 2)[0];
    expect(cMsg).toMatchObject({ t: 'wager_match', role: 'creator', stakeBase: '100000000' });
    expect(oMsg).toMatchObject({ t: 'wager_match', role: 'opponent' });
    expect((cMsg as any).unsignedTxB64).toBe(Buffer.from('faketx').toString('base64'));
    expect(escrow.calls.filter((c) => c.fn === 'open')).toHaveLength(1);
    expect(escrow.calls.filter((c) => c.fn === 'join')).toHaveLength(1);
  });

  it('does not pair players with different stakes', async () => {
    const { coord, sent, creator, opponent } = setup();
    await coord.enqueue(creator);
    await coord.enqueue({ ...opponent, stakeBase: 50_000_000n });
    expect(sent.length).toBe(0);
  });

  it('ignores a duplicate enqueue of the same pid', async () => {
    const { coord, sent, creator } = setup();
    await coord.enqueue(creator);
    await coord.enqueue(creator);
    await coord.enqueue({ pid: 2, wallet: Keypair.generate().publicKey, stakeBase: 100_000_000n });
    // Exactly one pairing happened (2 wager_match messages), not a self-pair.
    expect(sent.filter((s) => s.msg.t === 'wager_match')).toHaveLength(2);
  });
});

describe('ArenaWagerCoordinator stake handshake', () => {
  async function paired(timeout?: number) {
    const ctx = setup(timeout);
    await ctx.coord.enqueue(ctx.creator);
    await ctx.coord.enqueue(ctx.opponent);
    const matchId = (msgsFor(ctx.sent, 1)[0] as any).matchId as string;
    return { ...ctx, matchId };
  }

  it('starts the bout only after BOTH stakes are reported and confirmed on-chain', async () => {
    const { coord, startBout, matchId } = await paired();
    await coord.onStakeSubmitted(1, matchId, 'open-sig');
    expect(startBout).not.toHaveBeenCalled(); // only one staked
    await coord.onStakeSubmitted(2, matchId, 'join-sig');
    expect(startBout).toHaveBeenCalledWith(1, 2);
    expect(coord.phaseOf(matchId)).toBe('in_bout');
  });

  it('does not start the bout if the on-chain vault is not funded for both', async () => {
    const { coord, escrow, startBout, matchId } = await paired();
    escrow.bothStakedResult = false;
    await coord.onStakeSubmitted(1, matchId, 'open-sig');
    await coord.onStakeSubmitted(2, matchId, 'join-sig');
    expect(startBout).not.toHaveBeenCalled();
    expect(coord.phaseOf(matchId)).toBe('awaiting_stakes');
  });

  it('cancels the pairing and notifies both when stakes time out', async () => {
    const { coord, sent, matchId, advance } = await paired(30_000);
    await coord.onStakeSubmitted(1, matchId, 'open-sig'); // only creator staked
    advance(30_000);
    coord.poll();
    expect(coord.phaseOf(matchId)).toBe('cancelled');
    expect(sent.filter((s) => s.msg.t === 'wager_cancelled' && (s.msg as any).reason === 'stake_timeout')).toHaveLength(2);
  });
});

describe('ArenaWagerCoordinator settlement', () => {
  async function inBout() {
    const ctx = setup();
    await ctx.coord.enqueue(ctx.creator);
    await ctx.coord.enqueue(ctx.opponent);
    const matchId = (msgsFor(ctx.sent, 1)[0] as any).matchId as string;
    await ctx.coord.onStakeSubmitted(1, matchId, 'open-sig');
    await ctx.coord.onStakeSubmitted(2, matchId, 'join-sig');
    ctx.sent.length = 0; // clear pairing/phase messages
    return { ...ctx, matchId };
  }

  it('settles to the reporting winner and tells each player won/lost + amounts', async () => {
    const { coord, escrow, sent, creator } = await inBout();
    await coord.onBoutEnd(1, true, false); // creator won
    const settle = escrow.calls.find((c) => c.fn === 'settle')!;
    expect(settle.arg.winner).toBe(creator.wallet.toBase58());
    expect(msgsFor(sent, 1).pop()).toMatchObject({ t: 'wager_result', outcome: 'won', payoutBase: '190000000', burnBase: '10000000', signature: 'settle-sig' });
    expect(msgsFor(sent, 2).pop()).toMatchObject({ t: 'wager_result', outcome: 'lost' });
  });

  it('resolves the winner from a LOSER report (won=false means the other player won)', async () => {
    const { coord, escrow, opponent } = await inBout();
    await coord.onBoutEnd(1, false, false); // creator reports a loss => opponent won
    const settle = escrow.calls.find((c) => c.fn === 'settle')!;
    expect(settle.arg.winner).toBe(opponent.wallet.toBase58());
  });

  it('refunds both (no settle) on a draw and reports outcome draw', async () => {
    const { coord, escrow, sent } = await inBout();
    await coord.onBoutEnd(1, false, true);
    expect(escrow.calls.some((c) => c.fn === 'settle')).toBe(false);
    expect(escrow.calls.some((c) => c.fn === 'refund')).toBe(true);
    expect(msgsFor(sent, 1).pop()).toMatchObject({ t: 'wager_result', outcome: 'draw', signature: 'refund-sig', burnBase: '0' });
    expect(msgsFor(sent, 2).pop()).toMatchObject({ t: 'wager_result', outcome: 'draw' });
  });

  it('settles only once even if both arenaEnd events arrive', async () => {
    const { coord, escrow } = await inBout();
    await coord.onBoutEnd(1, true, false);
    await coord.onBoutEnd(2, false, false); // second event for the same match
    expect(escrow.calls.filter((c) => c.fn === 'settle')).toHaveLength(1);
  });
});
