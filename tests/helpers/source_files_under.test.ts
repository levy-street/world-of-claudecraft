import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SOURCE_EXTENSIONS, sourceFilesUnder } from './source_files_under';

// The paired test for the shared source walk, and the producer fixture the
// guards that consume it cannot supply themselves: every scan root in this repo
// is shallow enough that a consumer's own assertions read identically whether
// this walk descends or stops at the top level (#2485, #2489). Only a fixture
// tree separates them, so the contract is pinned here once.
//
// The symlink cases are not hypothetical hygiene. This walk follows links on
// both arms by design, so a cycle is a hang that takes the whole suite's
// collection down with it, and a link out of the root is a corpus quietly
// holding files nobody reviewing this repo can see.

describe('sourceFilesUnder', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'woc-source-files-under-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (relative: string, body = 'export const x = 1;\n'): void => {
    const full = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  };

  it('finds source files at every depth, labeled relative to the root', () => {
    write('top.ts');
    write('one/mid.js');
    write('one/two/three/deep.mjs');
    // Three levels, not two: a walk with any depth cap fails here rather than
    // passing on a shallower fixture.
    expect(sourceFilesUnder(root).map((f) => f.file)).toEqual([
      'one/mid.js',
      'one/two/three/deep.mjs',
      'top.ts',
    ]);
  });

  it('covers the whole declared extension policy, and nothing outside it', () => {
    // Every extension SOURCE_EXTENSIONS declares, driven off the constant, so
    // adding one there without teaching the walk about it fails here. The
    // shader extensions have no file in the tree today: this is the only place
    // that can prove they would be scanned the day one lands.
    for (const extension of SOURCE_EXTENSIONS) write(`kept${extension}`);
    write('notes.md');
    write('data.json');
    write('shader.txt');
    write('types.d.ts');
    write('legacy.d.mts');
    expect(
      sourceFilesUnder(root)
        .map((f) => f.file)
        .sort(),
    ).toEqual(SOURCE_EXTENSIONS.map((extension) => `kept${extension}`).sort());
  });

  it('sorts within each directory, so the order does not depend on the filesystem', () => {
    // Written in an order that is neither sorted nor reversed, so a walk
    // returning raw readdir order would have to be lucky to pass. CI is ext4
    // (readdir in hash order) and a dev checkout is APFS (byte-lexicographic).
    write('zulu.ts');
    write('alpha.ts');
    write('mike/zulu.js');
    write('mike/alpha.js');
    expect(sourceFilesUnder(root).map((f) => f.file)).toEqual([
      'alpha.ts',
      'mike/alpha.js',
      'mike/zulu.js',
      'zulu.ts',
    ]);
  });

  it('labels with forward slashes, and returns a full path that reads back', () => {
    write('a/dupe.ts', 'export const a = 1;\n');
    write('b/dupe.ts', 'export const b = 2;\n');
    const found = sourceFilesUnder(root);
    // Bare names would collide, and a per-file count map keyed on them would
    // silently merge two files into one row.
    expect(found.map((f) => f.file)).toEqual(['a/dupe.ts', 'b/dupe.ts']);
    // `full` is what every consumer hands to readFileSync. Read the file rather
    // than re-deriving the path with the same path.join the walk used, which
    // would compare the implementation to itself.
    expect(path.isAbsolute(found[0].full)).toBe(true);
    expect(readFileSync(found[0].full, 'utf8')).toBe('export const a = 1;\n');
  });

  it('skips only the named directories, at any depth', () => {
    write('kept.ts');
    write('node_modules/dep.ts');
    write('one/node_modules/nested_dep.ts');
    write('one/kept_too.ts');
    expect(
      sourceFilesUnder(root, { skipDirectories: ['node_modules'] }).map((f) => f.file),
    ).toEqual(['kept.ts', 'one/kept_too.ts']);
    // Without the option nothing is skipped: the exclusion is the caller's
    // decision, never a default the caller cannot see.
    expect(sourceFilesUnder(root).map((f) => f.file)).toContain('node_modules/dep.ts');
  });

  it('follows a symlinked source FILE (a Dirent reads false for one)', () => {
    // The reason there is no `entry.isFile()` gate: Dirent is lstat-based, so
    // gating on it drops a symlinked module that a flat readdirSync().filter()
    // would have read. That is the silent narrowing this walk exists to stop.
    write('real/module.ts');
    symlinkSync(path.join(root, 'real', 'module.ts'), path.join(root, 'linked.ts'));
    expect(sourceFilesUnder(root).map((f) => f.file)).toEqual(['linked.ts', 'real/module.ts']);
  });

  it('walks a DIRECTORY named like a source file instead of returning it', () => {
    // The shape the hand-rolled walk exists for: readdirSync's `recursive: true`
    // emits directory entries into its result, so `namespace.ts` would come back
    // as a file and reach a consumer's readFileSync as an EISDIR crash.
    write('namespace.ts/child.ts');
    expect(sourceFilesUnder(root).map((f) => f.file)).toEqual(['namespace.ts/child.ts']);
  });

  it('descends a symlinked directory ONCE, rather than returning its files twice', () => {
    // The other half of the symlink decision: `entry.isDirectory()` is
    // lstat-based, so taking it at face value drops an entire linked subtree.
    // Following it means two links to one subtree can double-count, which
    // silently doubles any per-file count a consumer pins.
    write('real/inside.ts');
    write('real/deeper/lower.ts');
    symlinkSync(path.join(root, 'real'), path.join(root, 'link_a'));
    symlinkSync(path.join(root, 'real'), path.join(root, 'link_b'));
    const files = sourceFilesUnder(root).map((f) => f.file);
    // The first link reached in sorted order wins; `real/` itself is then a
    // revisit of the same realpath.
    expect(files).toEqual(['link_a/deeper/lower.ts', 'link_a/inside.ts']);
    expect(new Set(files).size).toBe(files.length);
  });

  it('terminates on a symlink cycle instead of recursing until the process dies', () => {
    // A link pointing at its own ancestor. Without the visited-realpath set this
    // case does not fail, it HANGS, and it takes the collection of every other
    // suite in the run with it.
    write('one/two/kept.ts');
    symlinkSync(path.join(root, 'one'), path.join(root, 'one', 'two', 'loop'));
    expect(sourceFilesUnder(root).map((f) => f.file)).toEqual(['one/two/kept.ts']);
  });

  it('throws on a directory link that escapes the root, rather than silently deciding', () => {
    // Refuses rather than filtering (#2499). Skipping it narrows the scan with
    // no diff to notice; following it puts files from outside the tree into a
    // corpus pinned as a file set.
    const outside = mkdtempSync(path.join(tmpdir(), 'woc-source-files-outside-'));
    try {
      writeFileSync(path.join(outside, 'stranger.ts'), 'export const s = 1;\n');
      symlinkSync(outside, path.join(root, 'escape'));
      expect(() => sourceFilesUnder(root)).toThrow(/links outside the scan root/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('is empty for an empty root rather than throwing', () => {
    expect(sourceFilesUnder(root)).toEqual([]);
  });
});
