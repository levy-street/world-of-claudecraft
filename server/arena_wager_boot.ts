// Production wiring for the #478 wager service: reads env + the DB and constructs
// the escrow + coordinator + service. Separated from arena_wager_service.ts so the
// service CORE stays import-clean (no db.ts, which throws without DATABASE_URL) and
// remains unit-testable; only the server entrypoint imports this boot module.
import { Connection, PublicKey } from '@solana/web3.js';
import { ArenaWagerCoordinator, type WagerClientMsg, type WagerStore } from './arena_wager';
import { ArenaEscrow } from './arena_escrow';
import { ArenaWagerService } from './arena_wager_service';
import { loadKeypairFromEnv } from './woc_escrow_client';
import { FlowLedger } from './flow_ledger';
import { PgFlowLedgerDb, activeSeasonStatus } from './flow_ledger_db';
import { walletForAccount } from './db';
import { holderInfoForPubkey } from './woc_balance';
import {
  allocateWagerMatchId, insertWagerMatch, recordWagerStake, setWagerPhase,
  recoverableLockedMatches, cancelStaleAwaitingMatches,
} from './arena_wager_db';
import { SOLANA_RPC_URL } from './solana_rpc';

const MAX_RAKE_BPS = 1_000; // mirrors the program constant (lib.rs)

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  return v && /^[0-9]+$/.test(v) ? Number(v) : fallback;
}
function bigEnv(name: string, fallback: bigint): bigint {
  const v = process.env[name];
  return v && /^[0-9]+$/.test(v) ? BigInt(v) : fallback;
}

/**
 * Build the production service from env, or return null when the wager feature is
 * not configured (the common case: no settler key / program / mint, so the server
 * runs exactly as before). Required to enable: WOC_ARENA_WAGER_ENABLED=1, a settler
 * secret, the escrow program id, and the $WOC mint. Throws on a half-configured
 * setup so a misconfiguration fails loudly at boot rather than silently disabling.
 *
 * `startBout` is the sim seam; `sendToPid` delivers a wager message to one player.
 */
export async function buildArenaWagerService(
  startBout: (creatorPid: number, opponentPid: number) => boolean,
  ratingFor: (pid: number) => number,
  sendToPid: (pid: number, msg: WagerClientMsg) => void,
): Promise<ArenaWagerService | null> {
  if (process.env.WOC_ARENA_WAGER_ENABLED !== '1') return null;
  const programIdStr = process.env.WOC_ESCROW_PROGRAM_ID;
  const mintStr = process.env.WOC_MINT;
  if (!programIdStr || !mintStr || !process.env.WOC_ARENA_SETTLER_SECRET) {
    throw new Error('WOC_ARENA_WAGER_ENABLED=1 requires WOC_ESCROW_PROGRAM_ID, WOC_MINT, and WOC_ARENA_SETTLER_SECRET');
  }
  const season = await activeSeasonStatus();
  const pinnedSeasonId = season ? season.seasonId : 0;

  const rakeBps = Math.min(intEnv('WOC_ARENA_RAKE_BPS', 500), MAX_RAKE_BPS);
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  const settler = loadKeypairFromEnv('WOC_ARENA_SETTLER_SECRET');
  const escrow = new ArenaEscrow({
    connection, programId: new PublicKey(programIdStr), mint: new PublicKey(mintStr),
    settler, ledger: new FlowLedger(new PgFlowLedgerDb()), seasonId: pinnedSeasonId, rakeBps,
  });
  const store: WagerStore = { insert: insertWagerMatch, recordStake: recordWagerStake, setPhase: setWagerPhase };

  const coordinator = new ArenaWagerCoordinator({
    escrow, startBout, notify: sendToPid,
    now: () => Date.now(),
    stakeTimeoutMs: intEnv('WOC_ARENA_STAKE_TIMEOUT_MS', 60_000),
    nextMatchId: allocateWagerMatchId,
    minStakeBase: bigEnv('WOC_ARENA_MIN_STAKE_BASE', 1_000_000n),
    maxStakeBase: bigEnv('WOC_ARENA_MAX_STAKE_BASE', 1_000_000_000_000n),
    maxRatingGap: intEnv('WOC_ARENA_MAX_RATING_GAP', 300),
    rakeBps, store,
  });

  return new ArenaWagerService({
    coordinator, notify: sendToPid,
    walletFor: async (accountId) => (await walletForAccount(accountId))?.pubkey ?? null,
    holderInfoFor: holderInfoForPubkey,
    minHolderTier: intEnv('WOC_ARENA_MIN_HOLDER_TIER', 1),
    ratingFor,
    // Pinned to the boot-time season: refuse queues once it closes (a realm restart
    // re-pins to the next season). Stakes always record against the season they
    // were taken under.
    seasonActive: async () => (await activeSeasonStatus())?.seasonId === pinnedSeasonId && pinnedSeasonId !== 0,
    escrow, store, loadRecoverable: recoverableLockedMatches, cancelStale: cancelStaleAwaitingMatches,
  });
}
