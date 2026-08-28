// Type declarations for scripts/lib/ci_shard_weight_harvest_guard.mjs (the harvest's
// per-job refusal rule), so tests/ci_shard_weight_harvest_guard.test.ts type-checks.

export const SHARD_LOG_FILE_FLOOR: number;

export interface ShardHarvestVerdict {
  ok: boolean;
  reason: string;
}

export function shardHarvestVerdict(jobName: string, parsedFiles: number): ShardHarvestVerdict;
