// The composable glue between the game server and the #478 wager coordinator.
// game.ts stays thin: it constructs this service (via buildArenaWagerService in
// arena_wager_boot.ts) and calls handleQueue / handleStaked / handleCancel from
// the WS dispatch, onArenaEnd from the sim-event router, poll() from the loop, and
// recoverOnBoot() at startup.
//
// All gating lives here (a verified wallet, a hold-to-queue holder tier, an active
// reward season) before a stake is ever requested; the on-chain non-custodial flow
// and the buy>sell ledger accounting live in ArenaEscrow + ArenaWagerCoordinator.
// This module takes injected dependencies and imports NOTHING that touches the DB
// or env, so it is unit-tested without a chain or a DB; arena_wager_boot.ts wires
// the production dependencies (db.ts, flow_ledger_db, env) and is loaded only by
// the server entrypoint.
import { PublicKey } from '@solana/web3.js';
import { recoverLockedMatches, type ArenaWagerCoordinator, type WagerClientMsg, type WagerStore, type EnqueueReason } from './arena_wager';
import type { ArenaEscrow } from './arena_escrow';

interface QueueSession {
  pid: number;
  accountId: number;
}

export interface ArenaWagerServiceDeps {
  coordinator: ArenaWagerCoordinator;
  notify: (pid: number, msg: WagerClientMsg) => void;
  /** The player's verified wallet pubkey (base58), or null if none is linked. */
  walletFor: (accountId: number) => Promise<string | null>;
  /** Holder tier + balance for a wallet (the hold-to-queue gate reads tier). */
  holderInfoFor: (pubkey: string) => Promise<{ tier: number; balance: number }>;
  /** Minimum holder tier required to enter a wagered match (anti-churn-and-dump). */
  minHolderTier: number;
  /** The player's arena 1v1 Elo, for rating-band pairing. */
  ratingFor: (pid: number) => number;
  /** Whether the pinned reward season is still active (stakes must record against it). */
  seasonActive: () => Promise<boolean>;
  escrow: ArenaEscrow;
  store: Pick<WagerStore, 'setPhase'>;
  loadRecoverable: () => Promise<{ matchId: bigint; creatorWallet: string; opponentWallet: string; stakeBase: bigint }[]>;
  cancelStale: () => Promise<number>;
}

const ENQUEUE_REASON_TEXT: Record<EnqueueReason, string> = {
  stake_below_min: 'Stake is below the minimum.',
  stake_above_max: 'Stake is above the maximum.',
  already_queued: 'You are already queued or in a wagered match.',
};

/** Parse a client-supplied base-unit stake into a positive bigint, or null if malformed. */
export function parseStakeBase(raw: unknown): bigint | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return null;
  return BigInt(raw);
}

export class ArenaWagerService {
  constructor(private readonly d: ArenaWagerServiceDeps) {}

  /** A player asks to enter the wagered 1v1 queue at `stakeRaw` (base-unit string). */
  async handleQueue(session: QueueSession, stakeRaw: unknown): Promise<void> {
    const fail = (reason: string) => this.d.notify(session.pid, { t: 'wager_error', reason });
    const stakeBase = parseStakeBase(stakeRaw);
    if (stakeBase === null) return fail('Invalid stake amount.');
    if (!(await this.d.seasonActive())) return fail('No reward season is active right now.');
    const wallet = await this.d.walletFor(session.accountId);
    if (!wallet) return fail('Link a verified $WOC wallet to wager.');
    const { tier } = await this.d.holderInfoFor(wallet);
    if (tier < this.d.minHolderTier) return fail('You need to hold more $WOC to enter wagered matches.');
    const r = await this.d.coordinator.enqueue({ pid: session.pid, wallet: new PublicKey(wallet), stakeBase, rating: this.d.ratingFor(session.pid) });
    if (!r.ok) fail(ENQUEUE_REASON_TEXT[r.reason]);
  }

  /** A player reports the stake transaction they signed + submitted. */
  handleStaked(session: QueueSession, matchId: unknown, signature: unknown): Promise<void> {
    if (typeof matchId !== 'string' || typeof signature !== 'string') return Promise.resolve();
    return this.d.coordinator.onStakeSubmitted(session.pid, matchId, signature);
  }

  /** A player leaves the queue (no effect once they are in a match; that exit is the on-chain cancel). */
  handleCancel(session: QueueSession): void {
    this.d.coordinator.dequeue(session.pid);
  }

  /** Bridge from the sim's arenaEnd event: settle/refund the wager for that bout. */
  onArenaEnd(pid: number, won: boolean, draw: boolean): Promise<void> {
    return this.d.coordinator.onBoutEnd(pid, won, draw);
  }

  /** Drive stake timeouts; called once per server loop tick. */
  poll(): Promise<void> {
    return this.d.coordinator.poll();
  }

  /** Drop a leaving player from the queue. */
  onLeave(pid: number): void {
    this.d.coordinator.dequeue(pid);
  }

  /**
   * Boot recovery: clear stale pairings, then refund any pot left locked on-chain
   * by a previous crash. Returns the counts (for the boot log).
   */
  async recoverOnBoot(): Promise<{ refunded: number; reconciled: number; staleCancelled: number }> {
    const staleCancelled = await this.d.cancelStale();
    const rows = await this.d.loadRecoverable();
    const { refunded, reconciled } = await recoverLockedMatches(this.d.escrow, this.d.store, rows);
    return { refunded, reconciled, staleCancelled };
  }
}
