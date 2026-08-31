// The shard-weight walk predicate (scripts/lib/ci_shard_walk.mjs) is the ONE
// population both the coverage floor pin (tests/ci_shard_partition.test.ts) and
// the union tool (scripts/merge_audit/shard_weight_union.mjs) grade the weight
// table against. Until Phase 18 each carried a copy, and the copies had drifted
// in two places (the tool skipped dot-prefixed DIRECTORIES only and re-checked
// isFile(); the pin skipped any dot-prefixed entry and pushed via a bare else),
// so the tool could certify a coverage number the pin then rejected. These arms
// pin the predicate on a fixture tree, entry class by entry class, and pin that
// both consumers import the module rather than hand-rolling a read again.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isShardTestFileName,
  isShardWalkSkipped,
  SHARD_WALK_SKIP_NAMES,
  walkShardTestFiles,
} from '../scripts/lib/ci_shard_walk.mjs';
import { stripComments } from './helpers/strip_comments';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('walkShardTestFiles: the predicate, one entry class per arm', () => {
  let tmp = '';
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  });

  const plant = (rel: string, body = '') => {
    const full = join(tmp, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  };

  it('collects nested .test.ts files and skips every excluded class the same way for files and dirs', () => {
    tmp = mkdtempSync(join(tmpdir(), 'shard-walk-'));
    plant('tests/a.test.ts');
    plant('tests/nested/deep/e.test.ts');
    // Excluded by NAME, whether the entry is a file or a directory: the drift
    // the union tool carried was applying the dot skip to directories only.
    plant('tests/.hidden.test.ts');
    plant('tests/.hiddendir/x.test.ts');
    plant('tests/browser/b.test.ts');
    plant('tests/node_modules/n.test.ts');
    plant('tests/dist/d.test.ts');
    // Excluded by suffix, and a non-test sibling.
    plant('tests/c.browser.test.ts');
    plant('tests/notatest.ts');
    plant('tests/also.test.mjs');
    // A symlink to a matching file is a non-directory entry whose NAME matches,
    // so it is collected (withFileTypes never follows it, and the pin's bare
    // else never re-stats it); a symlink to a directory is neither a directory
    // entry nor a matching name, so it is not walked.
    symlinkSync(join(tmp, 'tests/a.test.ts'), join(tmp, 'tests/link.test.ts'));
    symlinkSync(join(tmp, 'tests/nested'), join(tmp, 'tests/linkdir'));
    expect(walkShardTestFiles(tmp)).toEqual([
      'tests/a.test.ts',
      'tests/link.test.ts',
      'tests/nested/deep/e.test.ts',
    ]);
  });

  it('returns repo-relative POSIX paths sorted, and an empty list for an empty tests dir', () => {
    tmp = mkdtempSync(join(tmpdir(), 'shard-walk-'));
    mkdirSync(join(tmp, 'tests'));
    expect(walkShardTestFiles(tmp)).toEqual([]);
    plant('tests/z.test.ts');
    plant('tests/m/a.test.ts');
    const out = walkShardTestFiles(tmp);
    expect(out).toEqual(['tests/m/a.test.ts', 'tests/z.test.ts']);
    for (const p of out) expect(p.includes('\\')).toBe(false);
  });

  it('pins the two name predicates as literals', () => {
    expect(SHARD_WALK_SKIP_NAMES).toEqual(['node_modules', 'dist', 'browser']);
    for (const name of ['node_modules', 'dist', 'browser', '.git', '.hidden.test.ts']) {
      expect(isShardWalkSkipped(name), name).toBe(true);
    }
    for (const name of ['helpers', 'parity', 'a.test.ts', 'browserish']) {
      expect(isShardWalkSkipped(name), name).toBe(false);
    }
    expect(isShardTestFileName('a.test.ts')).toBe(true);
    expect(isShardTestFileName('a.browser.test.ts')).toBe(false);
    expect(isShardTestFileName('a.test.mjs')).toBe(false);
    expect(isShardTestFileName('a.ts')).toBe(false);
  });

  it('walks the real tree to a population the vacuity floor recognizes', () => {
    const real = walkShardTestFiles(ROOT);
    expect(real.length).toBeGreaterThan(1000);
    expect(real).toContain('tests/ci_shard_partition.test.ts');
    expect(real.some((p) => p.startsWith('tests/browser/'))).toBe(false);
    expect(real.some((p) => p.endsWith('.browser.test.ts'))).toBe(false);
    expect([...real].sort()).toEqual(real);
  });
});

describe('both consumers read the walk by import, never by a hand-rolled directory read', () => {
  const consumers = [
    'tests/ci_shard_partition.test.ts',
    'scripts/merge_audit/shard_weight_union.mjs',
  ] as const;
  const importRe =
    /import\s*\{[^}]*\bwalkShardTestFiles\b[^}]*\}\s*from\s*'[^']*\/ci_shard_walk\.mjs'/;

  it.each(consumers)('%s imports walkShardTestFiles and opens no directory itself', (file) => {
    // Comment-stripped: a commented-out readdirSync must not convict and a
    // commented-out import must not satisfy.
    const code = stripComments(readFileSync(join(ROOT, file), 'utf8'));
    expect(code).toMatch(importRe);
    for (const spelling of ['readdirSync(', 'opendirSync(', 'globSync(', 'readdir(', 'opendir(']) {
      expect(code.split(spelling).length - 1, `${file} reads a directory via ${spelling}`).toBe(0);
    }
  });

  it('the positive control: the import matcher recognizes the shipped statement shapes', () => {
    expect(
      importRe.test("import { walkShardTestFiles } from '../scripts/lib/ci_shard_walk.mjs';"),
    ).toBe(true);
    expect(importRe.test("import { walkShardTestFiles } from '../lib/ci_shard_walk.mjs';")).toBe(
      true,
    );
    expect(importRe.test("import { other } from '../lib/ci_shard_walk.mjs';")).toBe(false);
  });
});
