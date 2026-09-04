// The ONE walk predicate behind the shard-weight coverage floor and the
// harvester's local-missing carry mode. Keeping both consumers on this helper
// prevents them from measuring different test populations.
//
// The predicate, stated once: skip any entry (file OR directory) named
// node_modules, dist, or browser, or whose name starts with a dot; recurse into
// every other directory; collect every other entry whose name ends in .test.ts
// but not .browser.test.ts. Directory entries come from withFileTypes, so a
// symlink is never followed as a directory (it is neither a directory nor,
// unless its NAME matches, a test file). This population is deliberately
// narrower than vitest's own collection (scripts/lib/gate_discovery.mjs walks
// *.test.mjs and the helpers/ tree too): it is the set the weight table
// describes, not the set the suite runs.
import { readdirSync as fsReaddirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Entry names skipped outright, file or directory alike. */
export const SHARD_WALK_SKIP_NAMES = Object.freeze(['node_modules', 'dist', 'browser']);

/**
 * True when the walk skips this entry before looking at its kind.
 * @param {string} name a directory entry name (not a path)
 */
export function isShardWalkSkipped(name) {
  return SHARD_WALK_SKIP_NAMES.includes(name) || name.startsWith('.');
}

/**
 * True when a non-directory entry with this name is a shard-partition test file.
 * @param {string} name a directory entry name (not a path)
 */
export function isShardTestFileName(name) {
  return name.endsWith('.test.ts') && !name.endsWith('.browser.test.ts');
}

/**
 * Walk `<root>/tests` and return every shard-partition test file as a sorted,
 * repo-relative, POSIX-slashed path (`tests/foo.test.ts`).
 *
 * @param {string} root the repo root
 * @param {{ readdirSync?: typeof fsReaddirSync }} [io] injectable for fixtures
 * @returns {string[]}
 */
export function walkShardTestFiles(root, io = {}) {
  const readdirSync = io.readdirSync ?? fsReaddirSync;
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isShardWalkSkipped(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (isShardTestFileName(entry.name)) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(join(root, 'tests'));
  return out.sort();
}
