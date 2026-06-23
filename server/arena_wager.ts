// The #478 wagered-arena MATCH COORDINATOR: the stateful brain that takes two
// players who opted into a wagered 1v1 with equal stakes through the full
// lifecycle, queue to settlement, decoupled from WS and the sim via injected I/O
// so it is unit-tested in isolation.
//
//   enqueue -> pair (awaiting_stakes) -> both stake on-chain -> start the bout
//   (in_bout) -> bout ends -> settle (winner take + burn) or refund (draw)
//
// Non-custodial throughout: the coordinator hands each client an UNSIGNED stake
// transaction (built by ArenaEscrow) for their own wallet to sign; it never holds
// a player key. The only key it controls is the realm settler, used only to name
// the winner / declare a draw. A stake that does not land within the timeout
// cancels the pairing (the staker reclaims via cancel_match).
import type { PublicKey } from '@solana/web3.js';
import type { ArenaEscrow } from './arena_escrow';

export type WagerPhase = 'awaiting_stakes' | 'in_bout' | 'settling' | 'settled' | 'refunded' | 'cancelled';

export interface WagerParticipant {
  pid: number;
  wallet: PublicKey;
  stakeBase: bigint;
}

// Messages the coordinator emits to a player's client (delivered by the injected
// `notify`). The client signs `unsignedTxB64` with its wallet, submits it, and
// reports back via onStakeSubmitted.
export type WagerClientMsg =
  | { t: 'wager_match'; matchId: string; role: 'creator' | 'opponent'; stakeBase: string; unsignedTxB64: string }
  | { t: 'wager_phase'; matchId: string; phase: WagerPhase }
  | { t: 'wager_result'; matchId: string; outcome: 'won' | 'lost' | 'draw'; signature: string; payoutBase: string; burnBase: string }
  // cancelTxB64 is present for a creator who already staked: the unsigned
  // cancel_match tx for them to sign and reclaim their stake.
  | { t: 'wager_cancelled'; matchId: string; reason: 'stake_timeout' | 'opponent_left'; cancelTxB64?: string };

interface MatchState {
  matchId: bigint;
  creator: WagerParticipant;
  opponent: WagerParticipant;
  stakeBase: bigint;
  phase: WagerPhase;
  pairedAtMs: number;
  openSig: string | null; // creator's open_match signature
  joinSig: string | null; // opponent's join_match signature
}

export interface ArenaWagerDeps {
  escrow: ArenaEscrow;
  /** Start the sim bout between two pids (Sim.startWageredArena1v1); false if it could not start this tick. */
  startBout: (creatorPid: number, opponentPid: number) => boolean;
  /** Deliver a message to one player's client. */
  notify: (pid: number, msg: WagerClientMsg) => void;
  now: () => number;
  /** How long both players have to land their stakes before the pairing is cancelled. */
  stakeTimeoutMs: number;
  /** Monotonic on-chain match id allocator. */
  nextMatchId: () => bigint;
  /** Stake bounds (base units), inclusive. Floor blocks dust-spam; ceiling blocks a whale pot starving the season budget. */
  minStakeBase: bigint;
  maxStakeBase: bigint;
}

/** Why an enqueue was refused, so the WS layer can tell the client. */
export type EnqueueReason = 'stake_below_min' | 'stake_above_max' | 'already_queued';
export type EnqueueResult = { ok: true; queued: boolean } | { ok: false; reason: EnqueueReason };

export class ArenaWagerCoordinator {
  private readonly queue: WagerParticipant[] = [];
  private readonly matches = new Map<string, MatchState>();
  private readonly pidToMatch = new Map<number, string>();

  constructor(private readonly deps: ArenaWagerDeps) {}

  /**
   * Queue a player for a wagered 1v1 at `stakeBase`. Enforces the stake bounds and
   * pairs with the first equal-stake waiter whose WALLET differs (a same-wallet
   * pairing is one person matching themselves to move/launder tokens, so it is
   * never made). Returns whether the player was queued or immediately paired, or a
   * refusal reason. The holder / hold-to-queue gate is applied by the WS layer
   * before calling this (it owns the balance read).
   */
  async enqueue(p: WagerParticipant): Promise<EnqueueResult> {
    if (p.stakeBase < this.deps.minStakeBase) return { ok: false, reason: 'stake_below_min' };
    if (p.stakeBase > this.deps.maxStakeBase) return { ok: false, reason: 'stake_above_max' };
    if (this.pidToMatch.has(p.pid) || this.queue.some((q) => q.pid === p.pid)) return { ok: false, reason: 'already_queued' };

    const partnerIdx = this.queue.findIndex((q) => q.stakeBase === p.stakeBase && !q.wallet.equals(p.wallet));
    if (partnerIdx < 0) {
      this.queue.push(p);
      return { ok: true, queued: true };
    }
    const partner = this.queue.splice(partnerIdx, 1)[0];
    await this.pair(partner, p);
    return { ok: true, queued: false };
  }

  /** Remove a player from the queue (no effect once they are in a match). */
  dequeue(pid: number): void {
    const i = this.queue.findIndex((q) => q.pid === pid);
    if (i >= 0) this.queue.splice(i, 1);
  }

  private async pair(creator: WagerParticipant, opponent: WagerParticipant): Promise<void> {
    const matchId = this.deps.nextMatchId();
    const key = matchId.toString();
    const m: MatchState = {
      matchId, creator, opponent, stakeBase: creator.stakeBase, phase: 'awaiting_stakes',
      pairedAtMs: this.deps.now(), openSig: null, joinSig: null,
    };
    this.matches.set(key, m);
    this.pidToMatch.set(creator.pid, key);
    this.pidToMatch.set(opponent.pid, key);

    const openTx = await this.deps.escrow.buildOpenTx({ matchId, creator: creator.wallet, stakeBase: creator.stakeBase });
    const joinTx = await this.deps.escrow.buildJoinTx({ matchId, opponent: opponent.wallet });
    this.deps.notify(creator.pid, { t: 'wager_match', matchId: key, role: 'creator', stakeBase: m.stakeBase.toString(), unsignedTxB64: serializeUnsigned(openTx) });
    this.deps.notify(opponent.pid, { t: 'wager_match', matchId: key, role: 'opponent', stakeBase: m.stakeBase.toString(), unsignedTxB64: serializeUnsigned(joinTx) });
  }

  /**
   * A client reports it submitted its stake transaction. Once both have reported
   * AND the pot vault on-chain holds the full 2x stake, the bout starts. Reported
   * out of the awaiting_stakes phase is ignored (idempotent / late).
   */
  async onStakeSubmitted(pid: number, matchId: string, signature: string): Promise<void> {
    const m = this.matches.get(matchId);
    if (!m || m.phase !== 'awaiting_stakes') return;
    if (pid === m.creator.pid) m.openSig = signature;
    else if (pid === m.opponent.pid) m.joinSig = signature;
    else return;
    if (!m.openSig || !m.joinSig) return;
    if (!(await this.deps.escrow.bothStaked({ matchId: m.matchId }))) return;
    if (!this.deps.startBout(m.creator.pid, m.opponent.pid)) return; // no arena slot yet; retried when the next stake report or poll re-checks
    m.phase = 'in_bout';
    this.broadcastPhase(m);
  }

  /**
   * The sim reported a bout result for a player (from the arenaEnd event). Settles
   * on-chain: a decided bout pays the winner (minus burn), a draw refunds both.
   * Idempotent: only the first call for a match while in_bout settles.
   */
  async onBoutEnd(pid: number, won: boolean, draw: boolean): Promise<void> {
    const key = this.pidToMatch.get(pid);
    if (!key) return;
    const m = this.matches.get(key);
    if (!m || m.phase !== 'in_bout') return;
    m.phase = 'settling';
    this.broadcastPhase(m);
    const ref = { matchId: m.matchId, creator: m.creator.wallet, opponent: m.opponent.wallet, stakeBase: m.stakeBase };

    if (draw) {
      const r = await this.deps.escrow.refundDraw(ref);
      m.phase = 'refunded';
      for (const part of [m.creator, m.opponent]) {
        this.deps.notify(part.pid, { t: 'wager_result', matchId: key, outcome: 'draw', signature: r.signature, payoutBase: m.stakeBase.toString(), burnBase: '0' });
      }
      this.finish(m);
      return;
    }

    // The reporting player either won (they are the winner) or lost (the other player is).
    const winnerPid = won ? pid : pid === m.creator.pid ? m.opponent.pid : m.creator.pid;
    const winnerWallet = winnerPid === m.creator.pid ? m.creator.wallet : m.opponent.wallet;
    const r = await this.deps.escrow.settle(ref, winnerWallet, m.openSig!, m.joinSig!);
    m.phase = 'settled';
    for (const part of [m.creator, m.opponent]) {
      this.deps.notify(part.pid, {
        t: 'wager_result', matchId: key,
        outcome: part.pid === winnerPid ? 'won' : 'lost',
        signature: r.signature, payoutBase: r.payoutBase.toString(), burnBase: r.burnBase.toString(),
      });
    }
    this.finish(m);
  }

  /**
   * Drive stake timeouts; call once per server loop tick. A pairing that has not
   * fully staked within stakeTimeoutMs is cancelled. Only the creator can have a
   * lone stake at this point (the opponent cannot join before the creator opens),
   * so if the creator already staked we hand them the unsigned cancel_match tx to
   * sign and reclaim their stake; the opponent who never staked has nothing to
   * reclaim.
   */
  async poll(): Promise<void> {
    const now = this.deps.now();
    for (const m of [...this.matches.values()]) {
      if (m.phase !== 'awaiting_stakes' || now - m.pairedAtMs < this.deps.stakeTimeoutMs) continue;
      m.phase = 'cancelled';
      const cancelTxB64 = m.openSig
        ? serializeUnsigned(await this.deps.escrow.buildCancelTx({ matchId: m.matchId, creator: m.creator.wallet }))
        : undefined;
      this.deps.notify(m.creator.pid, { t: 'wager_cancelled', matchId: m.matchId.toString(), reason: 'stake_timeout', cancelTxB64 });
      this.deps.notify(m.opponent.pid, { t: 'wager_cancelled', matchId: m.matchId.toString(), reason: 'stake_timeout' });
      this.finish(m);
    }
  }

  phaseOf(matchId: string): WagerPhase | null {
    return this.matches.get(matchId)?.phase ?? null;
  }

  private broadcastPhase(m: MatchState): void {
    for (const part of [m.creator, m.opponent]) {
      this.deps.notify(part.pid, { t: 'wager_phase', matchId: m.matchId.toString(), phase: m.phase });
    }
  }

  private finish(m: MatchState): void {
    this.pidToMatch.delete(m.creator.pid);
    this.pidToMatch.delete(m.opponent.pid);
  }
}

/** Base64 of an unsigned transaction's message-bearing serialization for the client to sign. */
function serializeUnsigned(tx: { serialize: (opts: { requireAllSignatures: boolean }) => Buffer }): string {
  return tx.serialize({ requireAllSignatures: false }).toString('base64');
}
