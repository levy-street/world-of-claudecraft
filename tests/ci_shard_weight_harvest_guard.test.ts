// The shard-weight harvest's refusal rule (scripts/lib/ci_shard_weight_harvest_guard.mjs):
// a shard log that parses to too few per-file lines is a reporter or fetch
// change, and the table must not be written short.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SHARD_LOG_FILE_FLOOR,
  shardHarvestVerdict,
} from '../scripts/lib/ci_shard_weight_harvest_guard.mjs';

describe('shardHarvestVerdict', () => {
  it('refuses a PR tests shard under the floor, accepts one at or above it', () => {
    expect(shardHarvestVerdict('PR tests (3)', 0).ok).toBe(false);
    expect(shardHarvestVerdict('PR tests (3)', 5).ok).toBe(false);
    expect(shardHarvestVerdict('PR tests (3)', SHARD_LOG_FILE_FLOOR - 1).ok).toBe(false);
    expect(shardHarvestVerdict('PR tests (3)', SHARD_LOG_FILE_FLOOR)).toEqual({
      ok: true,
      reason: '',
    });
    expect(shardHarvestVerdict('PR tests (8)', 387).ok).toBe(true);
    // The refusal names the job and the floor, so the operator knows what to look at.
    const refused = shardHarvestVerdict('PR tests (3)', 5);
    expect(refused.reason).toContain('PR tests (3)');
    expect(refused.reason).toContain(`${SHARD_LOG_FILE_FLOOR}`);
    expect(refused.reason).toContain('NOT written');
  });

  it('holds the small lanes to one parsed line, never the shard floor', () => {
    expect(shardHarvestVerdict('PR long sims A', 0).ok).toBe(false);
    expect(shardHarvestVerdict('PR long sims A', 7).ok).toBe(true);
    expect(shardHarvestVerdict('PR gate', 1).ok).toBe(true);
  });

  it('pins the floor against a real shard: eight shards of about 390 files', () => {
    // A one-shard fetch failure (0 lines) and a truncated log (a few lines)
    // both land far under it; a real shard lands far above.
    expect(SHARD_LOG_FILE_FLOOR).toBe(100);
  });

  it('is what the harvest consults, per job, before it merges that log', () => {
    const harvest = readFileSync(
      new URL('../scripts/ci_shard_weights_harvest.mjs', import.meta.url),
      'utf8',
    );
    expect(harvest).toContain("from './lib/ci_shard_weight_harvest_guard.mjs'");
    const verdictAt = harvest.indexOf('shardHarvestVerdict(job.name, Object.keys(own).length)');
    const mergeAt = harvest.indexOf('weights[file] = Math.max(weights[file] ?? 0, ms);');
    const writeAt = harvest.indexOf('writeFileSync(target,');
    expect(verdictAt).toBeGreaterThan(-1);
    expect(mergeAt).toBeGreaterThan(verdictAt);
    expect(writeAt).toBeGreaterThan(mergeAt);
    // The refusal exits before any write.
    const refuse = harvest.slice(verdictAt, mergeAt);
    expect(refuse).toContain('process.exit(1)');
    // The raw job-log fallback exists for the empty `gh run view --log` case.
    expect(harvest).toContain("['api', `repos/{owner}/{repo}/actions/jobs/${job.id}/logs`]");
  });
});
