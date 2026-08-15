import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cssTreeUnder } from './css_tree_under';

// The paired test for the shared stylesheet walk, and it carries the same weight
// as helpers/ts_files_under.test.ts: `src/styles` is FLAT today, so every
// consumer's assertions over the real tree read identically whether this walk
// descends or stops at the top level. Only a fixture tree can tell the two
// apart, so the contract is pinned here once instead of restated in each guard.
//
// `dirs` is pinned as hard as `files`: two consumers are flat by ruling (#2499)
// and refuse on a subdirectory, so a `dirs` that missed one would turn a loud
// refusal back into the silent narrowing this module exists to stop.

describe('cssTreeUnder', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'woc-css-tree-under-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (relative: string, body = '.a { color: red; }\n'): void => {
    const full = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  };

  it('finds .css files at every depth, labeled relative to the root', () => {
    write('top.css');
    write('one/mid.css');
    write('one/two/three/deep.css');
    // Three levels, not two: a walk with any depth cap fails here rather than
    // passing on a shallower fixture.
    expect(cssTreeUnder(root).files.map((f) => f.file)).toEqual([
      'one/mid.css',
      'one/two/three/deep.css',
      'top.css',
    ]);
  });

  it('reports every subdirectory at every depth, holding a sheet or not', () => {
    write('one/two/deep.css');
    mkdirSync(path.join(root, 'empty'), { recursive: true });
    // `empty` holds no stylesheet and still counts: the flat consumers refuse the
    // day the directory appears, not the later day a .css lands inside it, so a
    // `dirs` derived from the file list would let the decision go quiet in
    // between.
    expect(cssTreeUnder(root).dirs).toEqual(['empty', 'one', 'one/two']);
  });

  it('reports no subdirectory for a flat root, so the flat consumers stay green', () => {
    write('a.css');
    write('b.css');
    const tree = cssTreeUnder(root);
    // The other polarity of the case above: a `dirs` that reported something for
    // a flat tree would make every flat consumer throw on the real src/styles,
    // which no assertion over today's tree could distinguish from a real refusal.
    expect(tree.dirs).toEqual([]);
    expect(tree.files.map((f) => f.file)).toEqual(['a.css', 'b.css']);
  });

  it('labels with forward slashes, so same-named sheets in two directories stay distinct', () => {
    write('a/dupe.css');
    write('b/dupe.css');
    const labels = cssTreeUnder(root).files.map((f) => f.file);
    // Bare names would collide, and a per-file offender message keyed on them
    // would name the wrong sheet.
    expect(labels).toEqual(['a/dupe.css', 'b/dupe.css']);
    expect(new Set(labels).size).toBe(2);
  });

  it('sorts within each directory, so the order does not depend on the filesystem', () => {
    // Written in an order that is neither sorted nor reversed, so a walk
    // returning raw readdir order would have to be lucky to pass. CI is ext4
    // (readdir in hash order) and a dev checkout is APFS (byte-lexicographic),
    // so an unsorted walk pins a list that holds on one machine only.
    //
    // Which means this case is decisive on CI and NOT on a macOS checkout:
    // APFS hands back byte-lexicographic order, so deleting the sort still
    // passes locally, on this fixture or any other. Short of stubbing the fs
    // there is no local fixture that fails, and the failure a missing sort
    // causes is a cross-platform flake rather than a silent narrowing, so the
    // case is kept and its reach written down instead of overstated.
    write('zulu.css');
    write('alpha.css');
    write('mike/zulu.css');
    write('mike/alpha.css');
    expect(cssTreeUnder(root).files.map((f) => f.file)).toEqual([
      'alpha.css',
      'mike/alpha.css',
      'mike/zulu.css',
      'zulu.css',
    ]);
  });

  it('returns only .css files, and a full path that reads back', () => {
    write('kept.css', '.kept { color: red; }\n');
    write('notes.md', '.a { color: var(--x) b0; }\n');
    write('tokens.scss', '.b { outline: none; }\n');
    const found = cssTreeUnder(root).files;
    expect(found.map((f) => f.file)).toEqual(['kept.css']);
    // `full` is what every consumer hands to readFileSync, so a label-only
    // return would break them all. Read the file rather than re-deriving the
    // path with the same path.join the walk used, which would compare the
    // implementation to itself.
    expect(path.isAbsolute(found[0].full)).toBe(true);
    expect(readFileSync(found[0].full, 'utf8')).toBe('.kept { color: red; }\n');
  });

  it('descends a symlinked DIRECTORY and reports it in dirs (a Dirent reads false for one)', () => {
    // The expensive half of the symlink decision: `entry.isDirectory()` is
    // lstat-based, so taking it at face value drops an entire linked subtree
    // silently AND leaves the flat consumers' premise check blind to the one
    // subdirectory shape a hand-rolled `isDirectory()` test cannot see.
    write('real/inside.css');
    write('real/deeper/lower.css');
    symlinkSync(path.join(root, 'real'), path.join(root, 'linked_dir'));
    const tree = cssTreeUnder(root);
    expect(tree.files.map((f) => f.file)).toEqual([
      'linked_dir/deeper/lower.css',
      'linked_dir/inside.css',
      'real/deeper/lower.css',
      'real/inside.css',
    ]);
    expect(tree.dirs).toEqual(['linked_dir', 'linked_dir/deeper', 'real', 'real/deeper']);
  });

  it('walks a DIRECTORY named like a stylesheet instead of returning it', () => {
    // The shape the hand-rolled walk exists for: readdirSync's `recursive: true`
    // emits directory entries into its result, so `theme.css` would come back as
    // a file and reach the consumer's readFileSync as an EISDIR crash.
    write('theme.css/child.css');
    const tree = cssTreeUnder(root);
    expect(tree.files.map((f) => f.file)).toEqual(['theme.css/child.css']);
    expect(tree.dirs).toEqual(['theme.css']);
  });

  it('follows a symlinked .css file (a Dirent reads false for one)', () => {
    // The arm no consumer fixture can reach, and the reason there is no
    // `entry.isFile()` gate: Dirent is lstat-based, so gating on it drops a
    // symlinked sheet that the flat `readdirSync().filter()` this replaces would
    // have read. That is the same silent narrowing arriving one door over, and
    // only this case holds the line.
    write('real/module.css');
    symlinkSync(path.join(root, 'real', 'module.css'), path.join(root, 'linked.css'));
    expect(cssTreeUnder(root).files.map((f) => f.file)).toEqual(['linked.css', 'real/module.css']);
  });

  it('returns a BROKEN symlink named .css instead of dropping it from the scan', () => {
    // The arm behind `throwIfNoEntry: false`, and the reason it is written that
    // way: a dangling link resolves to neither a file nor a directory, so it
    // comes back as a file and the consumer's own readFileSync fails loudly.
    // Drop the option and statSync throws instead, which turns every guard's
    // failure mode from "this one sheet is broken" into "the walk died", with
    // nothing red to say the contract changed.
    write('real/module.css');
    symlinkSync(path.join(root, 'real', 'gone.css'), path.join(root, 'dangling.css'));
    expect(cssTreeUnder(root).files.map((f) => f.file)).toEqual([
      'dangling.css',
      'real/module.css',
    ]);
  });

  it('is empty for an empty root rather than throwing', () => {
    expect(cssTreeUnder(root)).toEqual({ files: [], dirs: [] });
  });

  it('throws for a missing root rather than reporting an empty tree', () => {
    // Load-bearing for css_corpus, which used to answer a missing src/styles
    // with an empty corpus that its teeth case then passed over vacuously.
    expect(() => cssTreeUnder(path.join(root, 'no_such_dir'))).toThrow(/ENOENT/);
  });
});
