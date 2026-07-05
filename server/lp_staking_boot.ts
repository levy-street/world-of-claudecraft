// Production wiring for the LP staking vault service: reads env + the DB and
// constructs the chain reader + ledger + service. Separated from
// lp_staking_service.ts so the service CORE stays import-clean (no db.ts, which
// throws without DATABASE_URL) and remains unit-testable; only the server
// entrypoint imports this boot module.
import { Connection, PublicKey } from '@solana/web3.js';
import { FlowLedger } from './flow_ledger';
import { PgFlowLedgerDb } from './flow_ledger_db';
import { PgLpStakingDb } from './lp_staking_db';
import { connectionChainReader, LpStakingService } from './lp_staking_service';
import { SOLANA_RPC_URL } from './solana_rpc';

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  return v && /^[0-9]+$/.test(v) ? Number(v) : fallback;
}
function bigEnv(name: string, fallback: bigint): bigint {
  const v = process.env[name];
  return v && /^[0-9]+$/.test(v) ? BigInt(v) : fallback;
}

/**
 * Build the production LP staking service from env, or return null when the
 * feature is not configured (the common case: the flag is off, so the server
 * runs exactly as before, the rail is DARK). Required to enable:
 * WOC_LP_STAKING_ENABLED=1, the vault program id, the LP mint, and the LP
 * mining season id. Throws on a half-configured setup so a misconfiguration
 * fails loudly at boot rather than silently disabling.
 *
 * Even fully enabled, EMISSIONS stay dark until WOC_LP_EMISSION_RATE_BASE > 0:
 * staking reads and tx builders work, but no epoch ever reserves a single base
 * unit, mirroring the ship-logic-gate-rails posture of #736/#938.
 */
export async function buildLpStakingService(): Promise<LpStakingService | null> {
  if (process.env.WOC_LP_STAKING_ENABLED !== '1') return null;
  const programIdStr = process.env.WOC_LP_VAULT_PROGRAM_ID;
  const lpMintStr = process.env.WOC_LP_MINT;
  const seasonId = intEnv('WOC_LP_SEASON_ID', 0);
  if (!programIdStr || !lpMintStr || seasonId <= 0) {
    throw new Error(
      'WOC_LP_STAKING_ENABLED=1 requires WOC_LP_VAULT_PROGRAM_ID, WOC_LP_MINT, and WOC_LP_SEASON_ID',
    );
  }
  const cfg = {
    programId: new PublicKey(programIdStr),
    lpMint: new PublicKey(lpMintStr),
    seasonId,
    epochSeconds: intEnv('WOC_LP_EPOCH_SECONDS', 3600),
    vestSeconds: intEnv('WOC_LP_VEST_SECONDS', 30 * 24 * 60 * 60),
    emissionRateBase: bigEnv('WOC_LP_EMISSION_RATE_BASE', 0n),
    headroomCapBps: Math.min(intEnv('WOC_LP_HEADROOM_CAP_BPS', 2000), 10_000),
  };
  const ledger = new FlowLedger(new PgFlowLedgerDb());
  // The LP mining season must exist before the first epoch can account against
  // it; idempotent (reuses the reward-season API from #799).
  await ledger.ensureSeason(seasonId, 'lp mining');
  const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
  return new LpStakingService({
    cfg,
    chain: connectionChainReader(connection, cfg),
    db: new PgLpStakingDb(),
    ledger,
    now: () => Date.now(),
  });
}
