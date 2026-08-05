/**
 * Vitest TestSequencer that replaces the default sha1-contiguous --shard
 * packs with LPT packs weighted for import cost (D11 path-matrix equivalent).
 *
 * CI keeps `npm test -- --shard=i/N`; only the assignment of files to i changes.
 * When --shard is absent (local `npm run gate`), vitest never calls shard().
 */

import { readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { BaseSequencer } from 'vitest/node';
import { partitionForCi, weightForTestFile } from './ci_shard_partition.mjs';

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

    // Approach 2: stripe after sha1 order (not LPT). See ci_shard_partition.mjs.
    const packs = partitionForCi(items, count);
    // vitest shard index is 1-based.
    return packs[index - 1].map((item) => item.id);
  }
}

export default BalancedSequencer;
