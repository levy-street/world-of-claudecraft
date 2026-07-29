import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { duplicatesAmong, testBlockCalls } from './helpers/test_block_calls';
import { tsFilesUnder } from './helpers/ts_files_under';

// #2506: no test file may register the same block twice.
//
// `tests/gathering.test.ts` held a second, byte-identical copy of
// `resolveCorpseFocusHarvest: concentrate vs spread tradeoff (#1142)` and of
// `harvestTierQuantity`; `tests/fixes.test.ts` held a second copy of
// `mob tap rights` and `pet heel warp`. Vitest registers duplicate titles
// silently, so all four ran, and nothing in the suite could say so.
//
// This guard exists rather than the deletion alone because the gathering pair is
// a RECURRENCE: commit a1a8cfd56 deleted the same 80 lines in July, and its own
// message records the release/v0.23.0 merge putting them straight back. A defect
// that returns through merges returns again, and the only thing that stops it is
// a check that runs on every merge.
//
// FAILURE DIRECTION, which is what decides this scan's depth (#2502): it looks
// only for offenders, so a file it fails to reach is a SILENT PASS. It therefore
// recurses, over every `.ts` under `tests/`, and takes no view about which files
// are allowed to hold blocks. `tests/` is genuinely deep (server/, admin/,
// parity/, helpers/, progression/, browser/, util/), so the recursion is pinned
// three ways: by a file-count floor set deliberately ABOVE what a flat
// top-level-only walk of this tree returns, by a depth and per-subdirectory
// check over the real tree, and structurally, by a fixture that drives this
// file's OWN producer over a nested tree.

/** The scan root, as a parameter rather than a constant: the fixture case below
 *  drives this exact function over a temp tree, which is what pins the recursion
 *  rather than restating it (#2499: a producer that resolves its own root can
 *  only ever be proven against the tree it already passes). */
const TESTS_ROOT = path.resolve(process.cwd(), 'tests');

interface Offender {
  readonly file: string;
  readonly head: string;
  readonly title: string;
  readonly first: string;
  readonly repeat: string;
}

/**
 * One pass over `root`: every file's blocks, its duplicates, and the chains the
 * head resolver did not recognize.
 *
 * ONE parse per file, which is why the duplicates come from `duplicatesAmong` on
 * blocks already in hand rather than from the source-taking wrapper, which would
 * parse the file a second time. Parsing 1600-odd sources is this guard's whole
 * cost: the first cut did it twice over, once at collection and once inside the
 * offender case, and the doubled work blew vitest's 5-second per-case timeout
 * whenever the machine was loaded, which is the state CI runs in.
 */
const scanUnder = (root: string) =>
  tsFilesUnder(root).map(({ file, full }) => {
    const parsed = testBlockCalls(readFileSync(full, 'utf8'), file);
    return {
      file,
      ...parsed,
      duplicates: duplicatesAmong(parsed.blocks).map((d): Offender => ({ file, ...d })),
    };
  });

const describeOffender = (o: Offender): string =>
  `${o.file} lines ${o.repeat} repeat lines ${o.first} verbatim: ${o.title}`;

describe('no test file registers the same block twice (#2506)', () => {
  // ONE corpus, read once, and every case below measures THAT list. Deliberately
  // not a second `tsFilesUnder` call beside the scan: if the offender sweep and
  // the floors walked separately, a narrowing applied inside the sweep alone (a
  // stray `.filter(f => f.file.endsWith('.test.ts'))`, say) would leave every
  // floor, the subdirectory pin and the fixture green while the sweep quietly
  // covered less. The floors can only vouch for the sweep if they are counting
  // the same files it read.
  const perFile = scanUnder(TESTS_ROOT);
  const allBlocks = perFile.flatMap((f) => f.blocks);

  it('finds no block that repeats a sibling verbatim', () => {
    // The whole point of the guard. A repeat is always a defect: vitest runs
    // both copies, so the suite pays for the second one, and a reader has no way
    // to tell which copy the next case belongs in.
    expect(perFile.flatMap((f) => f.duplicates).map(describeOffender)).toEqual([]);
  });

  it('scanned a corpus the size of the real suite, not a handful of files', () => {
    // The vacuity floor, and the reason it is not `> 0`: this guard reports
    // OFFENDERS, so every way it can break quietly ends in an empty scan. A walk
    // that stopped recursing, a parse that threw and was swallowed, a filter that
    // matched nothing: all of them pass the assertion above with an empty list.
    //
    // The floors sit just ABOVE what a flat, top-level-only walk of `tests/`
    // returns, which is what makes them decisive rather than decorative. Almost
    // all of this repo's tests sit at the top level, so a floor set the usual
    // comfortable distance below the real total is satisfied by a walk that never
    // descends at all: the recursion this guard depends on would be gone with
    // this case still green. Sitting above the flat count costs headroom for
    // churn, and that is the trade being made on purpose. No literal count in the
    // prose, since those rot inside a release; the two numbers below are the only
    // ones that mean anything, and both may only ever be raised.
    expect(perFile.length).toBeGreaterThan(1600);
    expect(allBlocks.length).toBeGreaterThan(23_000);
  });

  it('parses every test file to at least one block', () => {
    // The other way a scan goes quiet: `ts.createSourceFile` does not throw on a
    // malformed source, it returns a partial tree. A file the parser gave up on
    // contributes no blocks, cannot hold a duplicate, and leaves the scan with
    // nothing to show for it. Every `*.test.ts` in the tree registers at least
    // one block today, so nothing yet excuses a zero, and a regression in the
    // head resolver that hit a whole file family would land here first.
    const empty = perFile.filter((f) => /\.test\.ts$/.test(f.file) && f.blocks.length === 0);
    expect(empty.map((f) => f.file)).toEqual([]);
  });

  it('reaches every subdirectory of tests/, at full depth', () => {
    // The direct recursion pin over the REAL tree, which `tests/` can carry and
    // a flat root cannot.
    //
    // A SUPERSET check, not an exact set, and that is the failure direction
    // talking: what harms this guard is a directory LEAVING the scan, which fails
    // here. A directory arriving does not, because the walk is generic and
    // already covers it, and pinning the set exactly would turn this red on the
    // unrelated PR that puts the first `.ts` file into `tests/fixtures/`.
    const dirs = new Set(
      perFile.map((f) => f.file.split('/')[0]).filter((d) => d.endsWith('.ts') === false),
    );
    for (const dir of ['admin', 'browser', 'helpers', 'parity', 'progression', 'server', 'util']) {
      expect(dirs.has(dir), `tests/${dir}/ left the scan`).toBe(true);
    }
    // Depth, not just breadth. The check above is satisfied by a walk that
    // descends exactly one level, and `tests/` is really three deep, so a
    // depth-capped walk would pass it while dropping a subtree. This is also why
    // the mkdtemp fixture below plants its offender three levels down: both
    // numbers track the real tree, and neither should be lowered.
    expect(Math.max(...perFile.map((f) => f.file.split('/').length))).toBeGreaterThanOrEqual(3);
    // ...and that those subdirectories really contribute blocks, not just files.
    const nested = perFile.filter((f) => f.file.includes('/') && f.blocks.length > 0);
    expect(nested.length).toBeGreaterThan(100);
  });

  it('holds the fix it shipped with: each repaired block survives exactly once', () => {
    // Not "the file is present and has some blocks", which both files would pass
    // with every one of these blocks deleted outright. The guard can only ever
    // notice a REPEAT, so the surviving copies need their own pin: each of the
    // four titles #2506 de-duplicated appears exactly once in its file, which
    // fails on a re-duplicating merge AND on a deletion.
    const titles: Array<[string, string]> = [
      ['gathering.test.ts', "describe('resolveCorpseFocusHarvest: concentrate vs spread"],
      ['gathering.test.ts', "describe('harvestTierQuantity'"],
      ['fixes.test.ts', "describe('mob tap rights'"],
      ['fixes.test.ts', "describe('pet heel warp'"],
    ];
    for (const [file, title] of titles) {
      const found = perFile.find((f) => f.file === file);
      expect(found, `${file} left the scan`).toBeDefined();
      expect(
        (found?.blocks ?? []).filter((b) => b.text.startsWith(title)).length,
        `${file} should hold exactly one ${title}...`,
      ).toBe(1);
    }
  });

  it('resolves every block chain except the known local rigs', () => {
    // The completeness half, and the one thing a "found no offenders" result
    // cannot tell you: if the head resolver stops recognizing a chain, those
    // blocks leave the scan and this file stays green over less. Pinned as an
    // exact set rather than a count, per #2516: a category field is a free-text
    // opt-out unless its distribution is pinned.
    //
    // Both survivors are a local rig bound to the name `test` in a controller
    // suite, which roots at the same identifier a real `test.each(...)` does.
    // A THIRD entry means one of two things: a new rig accessor that takes a
    // callback (add it here), or a vitest modifier missing from BLOCK_MODIFIERS
    // (add it there, and the blocks it was hiding rejoin the scan).
    //
    // The removal direction, since an exact set fails on that too: these chains
    // live in `tests/loot_window_controller.test.ts` and
    // `tests/fiesta_controller.test.ts`, so rewriting either rig turns this case
    // red on an unrelated PR. That is expected and the fix is to delete the row,
    // not to loosen the assertion; the exact set is what makes a silently
    // narrowing resolver visible at all.
    const chains = perFile.flatMap((f) => f.unresolved.map((u) => `${u.head}.${u.chain}`));
    expect([...new Set(chains)].sort()).toEqual([
      'test.attachTooltip.mock.calls.find',
      'test.scheduled.some',
    ]);
  });

  it('reads the tree only through the shared walker', () => {
    // Over a root this deep a hand-rolled read would return the same list today,
    // so no assertion above can tell one from the other (#2502).
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['ts_files_under']);
  });

  it('descends, so a duplicate in a SUBDIRECTORY is caught (#2485, #2489, #2502)', () => {
    // The structural recursion pin: drive the real producer over a fixture tree
    // rather than eyeballing the walk. The offender sits THREE levels down, so a
    // walk with any depth cap fails here rather than passing on a shallow tree.
    const fixture = mkdtempSync(path.join(tmpdir(), 'woc-dup-blocks-'));
    try {
      mkdirSync(path.join(fixture, 'nested', 'deeper', 'deepest'), { recursive: true });
      const dupe = [
        "describe('a', () => {",
        "  it('one', () => {",
        '    expect(1).toBe(1);',
        '  });',
        '});',
        '',
        "describe('a', () => {",
        "  it('one', () => {",
        '    expect(1).toBe(1);',
        '  });',
        '});',
        '',
      ].join('\n');
      writeFileSync(path.join(fixture, 'nested', 'deeper', 'deepest', 'deep.test.ts'), dupe);
      // A clean file beside it, so the fixture proves the scan is discriminating
      // and not just reporting every file it reaches.
      writeFileSync(
        path.join(fixture, 'top.test.ts'),
        "describe('kept', () => {\n  it('only once', () => {\n    expect(1).toBe(1);\n  });\n});\n",
      );
      // Reported through `describeOffender`, the real failure message, not a
      // private restatement of it. This is the only case that ever runs that
      // formatter: the real-tree assertion maps an EMPTY list through it on every
      // green run, so a swapped first/repeat, a dropped file label or a throw
      // inside it would surface only on a red run, at the moment it is being
      // relied on most. The message is the whole product of this guard.
      const found = scanUnder(fixture).flatMap((f) => f.duplicates);
      expect(found.map(describeOffender)).toEqual([
        "nested/deeper/deepest/deep.test.ts lines 7-11 repeat lines 1-5 verbatim: describe('a', () => {",
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
