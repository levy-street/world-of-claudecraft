import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tsFilesUnder } from './ts_files_under';

// The paired test for the shared source walk. It matters more than a helper
// test usually would: every scan root in the repo is FLAT today, so a
// consumer's own assertions read identically whether this walk descends or
// stops at the top level, and a regression to a flat read would leave four
// guards quietly covering less with every suite still green (#2485, #2489).
// Only a fixture tree can tell the two apart, so the contract is pinned here,
// once, rather than restated in each consumer.

describe('tsFilesUnder', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'woc-ts-files-under-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (relative: string, body = 'export const x = 1;\n'): void => {
    const full = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  };

  it('finds .ts files at every depth, labeled relative to the root', () => {
    write('top.ts');
    write('one/mid.ts');
    write('one/two/three/deep.ts');
    // Three levels, not two: a walk with any depth cap fails here rather than
    // passing on a shallower fixture.
    expect(tsFilesUnder(root).map((f) => f.file)).toEqual([
      'one/mid.ts',
      'one/two/three/deep.ts',
      'top.ts',
    ]);
  });

  it('labels with forward slashes, so same-named files in two directories stay distinct', () => {
    write('a/dupe.ts');
    write('b/dupe.ts');
    const labels = tsFilesUnder(root).map((f) => f.file);
    // Bare names would collide, and a per-file count map keyed on them would
    // silently merge two files into one row.
    expect(labels).toEqual(['a/dupe.ts', 'b/dupe.ts']);
    expect(new Set(labels).size).toBe(2);
  });

  it('sorts within each directory, so the order does not depend on the filesystem', () => {
    // Written in an order that is neither sorted nor reversed, so a walk
    // returning raw readdir order would have to be lucky to pass. CI is ext4
    // (readdir in hash order) and a dev checkout is APFS (byte-lexicographic),
    // so an unsorted walk pins a list that holds on one machine only.
    write('zulu.ts');
    write('alpha.ts');
    write('mike/zulu.ts');
    write('mike/alpha.ts');
    expect(tsFilesUnder(root).map((f) => f.file)).toEqual([
      'alpha.ts',
      'mike/alpha.ts',
      'mike/zulu.ts',
      'zulu.ts',
    ]);
  });

  it('returns only .ts files, and a full path that reads back', () => {
    write('kept.ts', 'export const kept = true;\n');
    write('notes.md', 'ctx.addItem(itemId, 1, pid);\n');
    write('data.json', '{}\n');
    const found = tsFilesUnder(root);
    expect(found.map((f) => f.file)).toEqual(['kept.ts']);
    // `full` is what every consumer hands to readFileSync, so a label-only
    // return would break them all. Read the file rather than re-deriving the
    // path with the same path.join the walk used, which would compare the
    // implementation to itself.
    expect(path.isAbsolute(found[0].full)).toBe(true);
    expect(readFileSync(found[0].full, 'utf8')).toBe('export const kept = true;\n');
  });

  it('descends a symlinked DIRECTORY (a Dirent reads false for that too)', () => {
    // The other half of the symlink decision, and the more expensive one to get
    // wrong: `entry.isDirectory()` is lstat-based, so taking it at face value
    // drops an entire linked subtree rather than a single file, silently.
    write('real/inside.ts');
    write('real/deeper/lower.ts');
    symlinkSync(path.join(root, 'real'), path.join(root, 'linked_dir'));
    expect(tsFilesUnder(root).map((f) => f.file)).toEqual([
      'linked_dir/deeper/lower.ts',
      'linked_dir/inside.ts',
      'real/deeper/lower.ts',
      'real/inside.ts',
    ]);
  });

  it('walks a DIRECTORY named like a source file instead of returning it', () => {
    // The shape the hand-rolled walk exists for, per this module's own note:
    // readdirSync's `recursive: true` emits directory entries into its result,
    // so `namespace.ts` would come back as a file and reach the consumer's
    // readFileSync as an EISDIR crash. Nothing else pins that reasoning.
    write('namespace.ts/child.ts');
    expect(tsFilesUnder(root).map((f) => f.file)).toEqual(['namespace.ts/child.ts']);
  });

  it('follows a symlinked .ts file (a Dirent reads false for one)', () => {
    // The arm no consumer fixture can reach, and the reason there is no
    // `entry.isFile()` gate: Dirent is lstat-based, so gating on it drops a
    // symlinked module that the flat `readdirSync().filter()` this replaces
    // would have read. That is the same silent narrowing the walk exists to
    // fix, arriving one door over, and only this case holds the line.
    write('real/module.ts');
    symlinkSync(path.join(root, 'real', 'module.ts'), path.join(root, 'linked.ts'));
    expect(tsFilesUnder(root).map((f) => f.file)).toEqual(['linked.ts', 'real/module.ts']);
  });

  it('is empty for an empty root rather than throwing', () => {
    expect(tsFilesUnder(root)).toEqual([]);
  });
});
