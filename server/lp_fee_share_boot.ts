// Production wiring for the LP fee-share layer: the distributor that pays the
// vested accrual book from the LP season's distribution vault, plus the LP fee
// keeper (built separately in lp_fee_keeper.ts). Separated from the logic
// modules so they stay import-clean and unit-testable; only the server
// entrypoint loads this.

import { randomBytes } from 'node:crypto';
import { Connection, type Keypair, PublicKey } from '@solana/web3.js';
import { DEFAULT_LP_DISTRIBUTOR_POLICY, distributionChain, LpDistributor } from './lp_distributor';
import { PgLpStakingDb } from './lp_staking_db';
import { poolPda } from './lp_vault_client';
import { SOLANA_RPC_URL, signatureStatus } from './solana_rpc';
import { loadKeypairFromEnv } from './woc_escrow_client';

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  return v && /^[0-9]+$/.test(v) ? Number(v) : fallback;
}
function bigEnv(name: string, fallback: bigint): bigint {
  const v = process.env[name];
  return v && /^[0-9]+$/.test(v) ? BigInt(v) : fallback;
}

/**
 * Build the production LP fee-share distributor from env, or return null when
 * the feature is not configured (the default: rail dark, the server runs as
 * before). Required to enable: WOC_LP_FEE_SHARE_ENABLED=1 plus the escrow
 * program, the $WOC mint, the LP mining season, the distribution authority
 * secret, and the LP staking pool identity (program + LP mint, so the payout
 * book key matches the epoch runner's). Throws on a half-configured setup so a
 * misconfiguration fails loudly at boot rather than silently disabling.
 */
export function buildLpDistributor(): LpDistributor | null {
  if (process.env.WOC_LP_FEE_SHARE_ENABLED !== '1') return null;
  const escrowProgram = process.env.WOC_ESCROW_PROGRAM_ID;
  const mintStr = process.env.WOC_MINT;
  const seasonId = intEnv('WOC_LP_SEASON_ID', 0);
  const lpProgramStr = process.env.WOC_LP_VAULT_PROGRAM_ID;
  const lpMintStr = process.env.WOC_LP_MINT;
  if (
    !escrowProgram ||
    !mintStr ||
    seasonId <= 0 ||
    !lpProgramStr ||
    !lpMintStr ||
    !process.env.WOC_LP_DISTRIBUTION_AUTHORITY_SECRET
  ) {
    throw new Error(
      'WOC_LP_FEE_SHARE_ENABLED=1 requires WOC_ESCROW_PROGRAM_ID, WOC_MINT, WOC_LP_SEASON_ID, WOC_LP_VAULT_PROGRAM_ID, WOC_LP_MINT, and WOC_LP_DISTRIBUTION_AUTHORITY_SECRET',
    );
  }
  const authority: Keypair = loadKeypairFromEnv('WOC_LP_DISTRIBUTION_AUTHORITY_SECRET');
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  const poolKey = poolPda(new PublicKey(lpProgramStr), new PublicKey(lpMintStr)).toBase58();
  return new LpDistributor({
    poolKey,
    vestSeconds: intEnv('WOC_LP_VEST_SECONDS', 30 * 24 * 60 * 60),
    chain: distributionChain({
      connection,
      programId: new PublicKey(escrowProgram),
      mint: new PublicKey(mintStr),
      seasonId: BigInt(seasonId),
      authority,
      confirm: signatureStatus,
    }),
    db: new PgLpStakingDb(),
    policy: {
      minPayoutBase: bigEnv('WOC_LP_PAYOUT_MIN_BASE', DEFAULT_LP_DISTRIBUTOR_POLICY.minPayoutBase),
      maxPerCycle: intEnv('WOC_LP_PAYOUT_MAX_PER_CYCLE', DEFAULT_LP_DISTRIBUTOR_POLICY.maxPerCycle),
      staleMs: intEnv('WOC_LP_PAYOUT_STALE_MS', DEFAULT_LP_DISTRIBUTOR_POLICY.staleMs),
    },
    now: () => Date.now(),
    newPayoutId: () => randomBytes(16).toString('hex'),
    toPublicKey: (base58) => new PublicKey(base58),
  });
}
