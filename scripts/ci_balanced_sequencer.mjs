/**
 * Vitest TestSequencer that replaces the default sha1-contiguous --shard
 * packs with LPT packs over MEASURED per-file durations
 * (scripts/ci_shard_weights.generated.json; wired 2026-08-14).
 *
 * CI keeps `npm test -- --shard=i/N`; only the assignment of files to i
 * changes, and only WHERE a file runs can ever change, never WHETHER:
 * completeness is structural (every item lands in exactly one pack) and
 * re-asserted at runtime below, failing loud rather than dropping a file.
 * When --shard is absent (unsharded local runs, the lanes, nightly), vitest
 * never calls shard().
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { BaseSequencer } from 'vitest/node';
import {
  assertPartitionCompleteness,
  MEASURED_WEIGHTS,
  partitionForCi,
  weightForTestFile,
} from './ci_shard_partition.mjs';

export class BalancedSequencer extends BaseSequencer {
  /**
   * @param {import('vitest/node').TestSpecification[]} files
   * @returns {Promise<import('vitest/node').TestSpecification[]>}
   */
  async shard(files) {
    const { config } = this.ctx;
    const shard = config.shard;
    if (!shard) return files;

    const { index, count } = shard;
    const root = config.root;

    const items = files.map((spec) => {
      const abs = spec.moduleId;
      // Match vitest's root-relative path form used for default sha1 sharding
      // (leading slash after root slice) so stripe order is comparable.
      const rel = relative(root, abs).split('\\').join('/');
      const key = rel.startsWith('/') ? rel : `/${rel}`;
      let body = '';
      let size = 0;
      try {
        size = statSync(abs).size;
        body = readFileSync(abs, 'utf8');
      } catch {
        // Unreadable path: still assign so completeness holds.
      }
      return {
        id: spec,
        key,
        weight: weightForTestFile(rel.replace(/^\//, ''), body, size),
      };
    });

    // Active strategy: LPT over measured weights (see ci_shard_partition.mjs
    // for the history; stripe and static-weight LPT both measured worse).
    const packs = partitionForCi(items, count);
    const complete = assertPartitionCompleteness(items, packs);
    if (!complete.ok) throw new Error(`[balanced-sequencer] ${complete.reason}`);
    // Self-auditing job line: measured hits vs fallbacks make a stale or
    // shrunken weight table visible in every shard log, and the digest lets
    // eight job logs prove they partitioned the same collected set.
    const measuredHits = items.filter((i) => MEASURED_WEIGHTS[i.key.slice(1)] !== undefined).length;
    const digest = createHash('sha1')
      .update(
        items
          .map((i) => i.key)
          .sort()
          .join('\n'),
      )
      .digest('hex')
      .slice(0, 12);
    const loads = packs.map((p) => Math.round(p.reduce((s, x) => s + x.weight, 0) / 1000));
    console.log(
      `[balanced-sequencer] lpt shard ${index}/${count}: ${items.length} files ` +
        `(${measuredHits} measured, ${items.length - measuredHits} fallback), ` +
        `set digest ${digest}, pack loads s ${loads.join('/')}`,
    );
    // vitest shard index is 1-based.
    return packs[index - 1].map((item) => item.id);
  }
}

export default BalancedSequencer;
