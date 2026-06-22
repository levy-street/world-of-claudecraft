// The server-side money rail for a #478 winner-takes-all arena wager. Stateless
// escrow operations over the deployed woc_escrow program: it builds the unsigned
// stake transactions players sign with their own wallets (non-custodial: the
// server never holds a player key), reads the pot vault to confirm both staked,
// and signs settle/refund with the realm SETTLER key (the only server key, and it
// can only name a winner among the two players, never divert funds).
//
// Flow-ledger accounting (see flow_ledger.ts): on settle, the two stakes are
// credited as `gamblefi_stake` inflows (attributed to the open/join tx sigs so
// replay-guard stays per-tx) and the winner take is a budget-gated
// `gamblefi_payout` outflow; the difference (the burned rake) is the only net
// sink, so a match adds exactly +rake to the season's emittable budget. A drawn
// refund returns both stakes and is recorded as nothing (economically neutral).
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import {
  openMatchIx, joinMatchIx, settleMatchIx, refundMatchIx, cancelMatchIx, matchPda, vaultAta,
} from './woc_escrow_client';
import type { FlowLedger } from './flow_ledger';

export interface ArenaEscrowConfig {
  connection: Connection;
  programId: PublicKey;
  mint: PublicKey;
  settler: Keypair;
  ledger: FlowLedger;
  seasonId: number;
  rakeBps: number; // burn rake on settle, capped at the program's MAX_RAKE_BPS (1000)
}

/** A match the server is escrowing; ids/wallets come from the matchmaking layer. */
export interface MatchRef {
  matchId: bigint;
  creator: PublicKey;
  opponent: PublicKey;
  stakeBase: bigint;
}

export interface SettleResult {
  signature: string;
  potBase: bigint;
  payoutBase: bigint;
  burnBase: bigint;
  headroomBase: bigint; // season emittable budget after recording
}

export class ArenaEscrow {
  constructor(private readonly cfg: ArenaEscrowConfig) {}

  /** The pot vault (ATA of the match PDA) for a match. */
  vault(matchId: bigint): PublicKey {
    return vaultAta(matchPda(this.cfg.programId, matchId), this.cfg.mint);
  }

  /** Unsigned open_match tx for the creator's wallet to sign (stakes + sets the rake + settler). */
  buildOpenTx(m: Pick<MatchRef, 'matchId' | 'creator' | 'stakeBase'>): Promise<Transaction> {
    return this.unsigned(
      openMatchIx({
        programId: this.cfg.programId, mint: this.cfg.mint, matchId: m.matchId,
        stakeBase: m.stakeBase, rakeBps: this.cfg.rakeBps, creator: m.creator, settler: this.cfg.settler.publicKey,
      }),
      m.creator,
    );
  }

  /** Unsigned join_match tx for the opponent's wallet to sign (matches the stake). */
  buildJoinTx(m: Pick<MatchRef, 'matchId' | 'opponent'>): Promise<Transaction> {
    return this.unsigned(joinMatchIx({ programId: this.cfg.programId, mint: this.cfg.mint, matchId: m.matchId, opponent: m.opponent }), m.opponent);
  }

  /** Unsigned cancel_match tx for the creator to reclaim their stake if no opponent joined. */
  buildCancelTx(m: Pick<MatchRef, 'matchId' | 'creator'>): Promise<Transaction> {
    return this.unsigned(cancelMatchIx({ programId: this.cfg.programId, mint: this.cfg.mint, matchId: m.matchId, creator: m.creator }), m.creator);
  }

  /** Current pot-vault balance in base units (0 if the vault has not been created yet). */
  async vaultBalanceBase(matchId: bigint): Promise<bigint> {
    const info = await this.cfg.connection.getParsedAccountInfo(this.vault(matchId));
    const data = info.value?.data;
    if (!data || !('parsed' in data)) return 0n;
    return BigInt(data.parsed.info.tokenAmount.amount);
  }

  /** True once both players have staked (vault holds the full 2x pot). */
  async bothStaked(m: Pick<MatchRef, 'matchId' | 'stakeBase'>): Promise<boolean> {
    return (await this.vaultBalanceBase(m.matchId)) >= m.stakeBase * 2n;
  }

  /**
   * Settle a decided bout: the settler signs settle_match paying the winner the
   * pot minus the burned rake, then the flow ledger records the two stake inflows
   * (by their open/join sigs) and the budget-gated payout outflow. `openSig` /
   * `joinSig` are the players' on-chain stake signatures.
   */
  async settle(m: MatchRef, winner: PublicKey, openSig: string, joinSig: string): Promise<SettleResult> {
    if (!winner.equals(m.creator) && !winner.equals(m.opponent)) {
      throw new Error('winner must be one of the two staked players');
    }
    const signature = await this.send(
      settleMatchIx({
        programId: this.cfg.programId, mint: this.cfg.mint, matchId: m.matchId,
        settler: this.cfg.settler.publicKey, creator: m.creator, winner,
      }),
    );

    const potBase = m.stakeBase * 2n;
    const burnBase = (potBase * BigInt(this.cfg.rakeBps)) / 10_000n;
    const payoutBase = potBase - burnBase;

    await this.cfg.ledger.ensureSeason(this.cfg.seasonId);
    for (const [sig, who] of [[openSig, 'creator'], [joinSig, 'opponent']] as const) {
      const r = await this.cfg.ledger.creditInflow({
        seasonId: this.cfg.seasonId, source: 'gamblefi_stake', amountBase: m.stakeBase,
        txSig: sig, memo: `match ${m.matchId} ${who} stake`,
      });
      if (!r.ok && r.reason !== 'duplicate') throw new Error(`stake inflow (${who}) rejected: ${r.reason}`);
    }
    const out = await this.cfg.ledger.emit({
      seasonId: this.cfg.seasonId, source: 'gamblefi_payout', amountBase: payoutBase,
      recipient: winner.toBase58(), txSig: signature,
    });
    if (!out.ok) throw new Error(`gamblefi payout rejected by flow ledger: ${out.reason}`);

    return { signature, potBase, payoutBase, burnBase, headroomBase: out.headroomBase };
  }

  /**
   * Refund a drawn bout: the settler signs refund_match returning each player
   * their stake. No ledger entry: the pot went in and came straight back out, so
   * a draw is supply-neutral (no burn, no emission).
   */
  async refundDraw(m: MatchRef): Promise<{ signature: string }> {
    const signature = await this.send(
      refundMatchIx({
        programId: this.cfg.programId, mint: this.cfg.mint, matchId: m.matchId,
        settler: this.cfg.settler.publicKey, creator: m.creator, opponent: m.opponent,
      }),
    );
    return { signature };
  }

  private async unsigned(ix: TransactionInstruction, feePayer: PublicKey): Promise<Transaction> {
    const { blockhash, lastValidBlockHeight } = await this.cfg.connection.getLatestBlockhash();
    return new Transaction({ feePayer, blockhash, lastValidBlockHeight }).add(ix);
  }

  private async send(ix: TransactionInstruction): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.cfg.connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: this.cfg.settler.publicKey, blockhash, lastValidBlockHeight }).add(ix);
    const signature = await this.cfg.connection.sendTransaction(tx, [this.cfg.settler]);
    await this.cfg.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    return signature;
  }
}
