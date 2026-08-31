import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { declaredTimeouts, maskCommentsAndStrings } from './helpers/declared_timeouts';
import { expectScansOnlyThroughSharedWalkers } from './helpers/scan_guard_self_audit';
import { sourceFilesUnder } from './helpers/source_files_under';

// THE ANTI-WHALE RATCHET (docs/qa-gate.md, "Declared duration budgets").
//
// One giant test file sets the wall clock of whichever 2-worker CI job draws
// it: the owned-class balance harness reached 788 to 842 seconds as ONE file
// before it was split, and the warlock sustain suite drifted to 359 seconds in
// the shard pool with nothing to say so. This guard makes that drift a red
// diff instead of a slow surprise, off DECLARED vitest timeouts, which are the
// only deterministic signal available at review time.
//
// It reads ALLOWANCES, not runtimes (tests/helpers/declared_timeouts.ts is
// the parser, a masking scanner anchored to registration heads; the fixtures
// below are its executable specification). The rules are conscious-decision
// ratchets, in the monolith_budget mold:
//  - a single test (or hook) may not declare more than SINGLE_TEST_CAP unless
//    its file has an exact-match exception row here. One test is one worker
//    chain: it cannot parallelize, so its allowance IS a job-wall floor. For a
//    test, split it along its cost clusters; for a hook, shrink the hook's
//    work. Shrink an exception when the test splits; growing one is a
//    maintainer decision that needs its reasoning in the PR body.
//  - a file whose declared sum exceeds DEFAULT_FILE_ALLOWANCE needs an
//    exact-match ledger row. The remedies, in preference order: split the file
//    (the owned-class and chronomancy splits are the worked precedent, and the
//    extract-and-test skill has the recipe), move the heavy case to a
//    lane-owned suite (a MEASURED decision under the 90-second rule that
//    scripts/lib/ci_shard_plan.mjs documents beside CI_LONG_SUITES), or add
//    the row deliberately.
//  - rows and exceptions are EXACT, so any timeout edit in a listed file
//    touches this ledger in the same change, and a row for a file that no
//    longer exceeds the default must be deleted (the ratchet direction).
//  - a timeout the parser cannot size (an unresolvable identifier) fails the
//    suite outright: hiding an allowance behind a constant is not an escape.
//
// Lane membership itself stays a MEASURED decision, deliberately not enforced
// here: tests/audit_conservation_property.test.ts declares 2,700 seconds of
// allowance across its property cases yet measured 55.1 seconds in-lane and
// was evicted, so declared sums must never drive the lane list.

const SINGLE_TEST_CAP = 480_000;

// file -> the exact largest single declared timeout it is allowed to carry.
// Every entry must exceed SINGLE_TEST_CAP (an exception at or under the cap
// is dead weight and fails below).
const SINGLE_TEST_EXCEPTIONS: ReadonlyMap<string, number> = new Map([
  // The Nythraxis matrix runs its full boss ladder as one case. Splitting it
  // is the standing follow-up; shrink this when that lands. Raised 720s to
  // 1200s for the v0.38 tank pass, which doubled the Monte Carlo roster from
  // two boss tanks to four: the case measured 218s solo (was ~120s), and the
  // two child runs it spawns now carry 480s timeouts each, so the case budget
  // must clear 960s to let a child fail on its own bound rather than here.
  // Same ~5x lane-contention headroom the 720s row carried, not looser.
  ['tests/nythraxis_matrix.test.ts', 1_200_000],
]);

const DEFAULT_FILE_ALLOWANCE = 300_000;

// file -> exact declared diet-arm sum, for every file above the default.
const FILE_ALLOWANCE_LEDGER: ReadonlyMap<string, number> = new Map([
  ['tests/audit_conservation_property.test.ts', 2_700_000],
  ['tests/battleground_band.test.ts', 480_000],
  ['tests/chronomancy_balance_targets.test.ts', 420_000],
  // The real-suite shard collection case walks the complete test corpus and
  // needs a 60s allowance on low-worker hosts; the other timeout pins in this
  // file keep the exact aggregate just above the default.
  ['tests/ci_shard_plan.test.ts', 310_000],
  ['tests/discord_db_integration.test.ts', 420_000],
  ['tests/dragonkin_whelp_litter.test.ts', 420_000],
  ['tests/druid_balance_probe.test.ts', 540_000],
  ['tests/emerald_deck_escape.test.ts', 540_000],
  ['tests/guild_bank_pg_integration.test.ts', 840_000],
  ['tests/nythraxis_matrix.test.ts', 1_200_000],
  ['tests/owned_class_balance_dps_probes.test.ts', 360_000],
  // The shared PostgreSQL escrow fixture carries a 30s setup hook plus ten
  // independently bounded 30s cases. The exact row records that existing
  // parallelizable shape without promoting the suite into the measured lane.
  ['tests/woc_market_delivery_pg_integration.test.ts', 330_000],
  // The 2026-08-23 warlock viability round doubled each anchor file's scope
  // (the heroic Nythraxis contract plus the historical level-20 tripwire,
  // four probe runs each); same suite family as the druid/owned probes above.
  ['tests/warlock_anchor_affliction.test.ts', 480_000],
  ['tests/warlock_anchor_demonology.test.ts', 480_000],
  ['tests/warlock_anchor_destruction.test.ts', 480_000],
  // Three 300s probe windows since the round added destruction's (it had
  // no five-minute coverage at all before).
  ['tests/warlock_five_minute_windows.test.ts', 360_000],
]);

// The corpus is every .ts and .mjs under tests/, NOT just *.test.ts: vitest
// collects .test.mjs files too, and a vi.setConfig({ testTimeout }) in an
// imported helper (tests/tank_crit_immunity_util.ts declares one) is a real
// file-wide allowance that a test-files-only scan would never see.
function suiteTimeouts(): Map<string, ReturnType<typeof declaredTimeouts>> {
  const out = new Map<string, ReturnType<typeof declaredTimeouts>>();
  for (const found of sourceFilesUnder('tests')) {
    if (!/\.(ts|mjs)$/.test(found.file)) continue;
    out.set(`tests/${found.file}`, declaredTimeouts(readFileSync(found.full, 'utf8')));
  }
  return out;
}

describe('suite duration budget (declared-timeout ratchet)', () => {
  const suite = suiteTimeouts();

  it('walks the whole suite recursively and actually parses timeouts', () => {
    // Recursion pinning per the scan-guard rules: the floor sits ABOVE the
    // depth-2 truncation count (2,734 on 2026-08-13, vs 2,802 full and 2,499
    // flat), and the pinned member lives three segments deep, so a walk that
    // silently stopped descending fails both ways.
    expect(suite.size).toBeGreaterThanOrEqual(2_760);
    expect(suite.has('tests/server/http/characterization.test.ts')).toBe(true);
    const withTimeouts = [...suite.values()].filter((entry) => entry.sum > 0).length;
    // Vacuity floor near the real count (82 on 2026-08-13): a parser change
    // that stopped matching the repo's real declaration forms fails here, not
    // by quietly emptying every rule below.
    expect(withTimeouts).toBeGreaterThanOrEqual(70);
    const nythraxis = suite.get('tests/nythraxis_matrix.test.ts');
    expect(nythraxis?.sum).toBe(1_200_000);
    expect(Math.max(...(nythraxis?.perTest ?? [0]))).toBe(1_200_000);
  });

  it('refuses any timeout the parser cannot size', () => {
    for (const [file, { unparsed }] of suite) {
      expect(
        unparsed,
        `${file} declares a timeout behind an identifier this parser cannot resolve; bind it ` +
          'to a same-file numeric const or inline the literal, so the ledger can see it',
      ).toEqual([]);
    }
  });

  it('parses every declared-timeout form, the executable spec', () => {
    const per = (src: string) => declaredTimeouts(src).perTest;
    // The forms that COUNT.
    expect(per(`it('a', () => { run(); }, 120_000);`)).toEqual([120_000]);
    expect(per(`it('b', { timeout: 240_000 }, () => { run(); });`)).toEqual([240_000]);
    expect(per(`it('c', () => { run(); }, FULL ? 900_000 : 300_000);`)).toEqual([300_000]);
    expect(per(`it('d', { timeout: FULL ? 720_000 : 90_000 }, fn);`)).toEqual([90_000]);
    expect(per(`it.each(['x'] as const)('%s runs', (s) => { run(s); }, 180_000);`)).toEqual([
      180_000,
    ]);
    expect(per(`beforeAll(async () => { await seed(); }, 120_000);`)).toEqual([120_000]);
    expect(per(`vi.setConfig({ testTimeout: 30_000 });`)).toEqual([30_000]);
    expect(per(`const HOOK_MS = 60_000;\nbeforeAll(() => { seed(); }, HOOK_MS);`)).toEqual([
      60_000,
    ]);
    // The forms that MUST NOT count: spawn options, ordinary call arguments,
    // fixture objects inside a body, string and comment text, and values at
    // or under the repo default testTimeout.
    expect(per(`execFileSync(cmd, args, { timeout: 300_000 });`)).toEqual([]);
    expect(per(`const o = makeOptions({ visible: true }, 120_000);`)).toEqual([]);
    expect(per(`it('e', () => { expect(rows).toEqual([{ timeout: 120_000 }]); });`)).toEqual([]);
    expect(per(`it('f', () => { log('statement_timeout: 900000'); });`)).toEqual([]);
    expect(per(`// it('old', () => { run(); }, 900_000);`)).toEqual([]);
    expect(per(`it('g', () => { run(); }, 15_000);`)).toEqual([]);
    expect(per(`setTimeout(() => { poll(); }, 30_000);`)).toEqual([]);
    // A method call on a LOCAL VARIABLE named test is not a registration.
    expect(per(`test.controller.advance('a', 'b', 60_000);`)).toEqual([]);
    // A regex literal with an odd quote count must not swallow the rest of
    // the file into string state.
    expect(per(`const R = /it's/;\nit('r', () => { run(); }, 600_000);`)).toEqual([600_000]);
    // A trailing identifier in the TIMEOUT SLOT (previous argument is a
    // function literal) counts by position, whatever its name; a trailing
    // identifier after an options object is a test-fn reference and does not.
    expect(per(`const BUDGET = 600_000;\nit('x', () => { run(); }, BUDGET);`)).toEqual([600_000]);
    expect(per(`it('y', { timeout: 240_000 }, myTestFn);`)).toEqual([240_000]);
    // Unresolvable identifiers surface instead of vanishing.
    expect(declaredTimeouts(`it('h', { timeout: IMPORTED_MS }, fn);`).unparsed).toHaveLength(1);
    expect(declaredTimeouts(`it('i', () => { run(); }, importedBudget);`).unparsed).toHaveLength(1);
    // The mask keeps template interpolations bracket-balanced.
    expect(maskCommentsAndStrings(`\`a \${b(1)} c\``).includes('b(1)')).toBe(true);
  });

  it('caps every single declared test timeout at the worker-chain bound', () => {
    for (const [file, { perTest }] of suite) {
      const largest = Math.max(0, ...perTest);
      const exception = SINGLE_TEST_EXCEPTIONS.get(file);
      if (exception !== undefined) {
        expect(
          largest,
          `${file}: the single-test exception is exact; shrink the row when the test splits, ` +
            'and growing it is a maintainer decision that needs its reasoning in the PR body',
        ).toBe(exception);
        continue;
      }
      expect(
        largest,
        `${file} declares a ${Math.round(largest / 1000)}s single-test allowance (cap ` +
          `${SINGLE_TEST_CAP / 1000}s). One test is one worker chain and cannot parallelize: ` +
          'split a test along its cost clusters (the owned-class balance split is the ' +
          'precedent), shrink a hook, or add an exact exception row in ' +
          'tests/suite_duration_budget.test.ts deliberately.',
      ).toBeLessThanOrEqual(SINGLE_TEST_CAP);
    }
    for (const [file, value] of SINGLE_TEST_EXCEPTIONS) {
      expect(suite.has(file), `${file}: stale single-test exception row`).toBe(true);
      expect(
        value,
        `${file}: a single-test exception at or under the cap is dead weight; delete it`,
      ).toBeGreaterThan(SINGLE_TEST_CAP);
    }
  });

  it('pins the per-file declared allowance ledger exactly, both directions', () => {
    for (const [file, { sum }] of suite) {
      const row = FILE_ALLOWANCE_LEDGER.get(file);
      if (row !== undefined) {
        expect(
          sum,
          `${file}: the ledger row is exact; any timeout edit here updates the row in the ` +
            'same change (and a split LOWERS it)',
        ).toBe(row);
        continue;
      }
      expect(
        sum,
        `${file} declares ${Math.round(sum / 1000)}s of summed allowance (default ` +
          `${DEFAULT_FILE_ALLOWANCE / 1000}s). Split the file along its cost clusters, move the ` +
          'heavy case to a lane-owned suite (a MEASURED decision; scripts/lib/ci_shard_plan.mjs, ' +
          'CI_LONG_SUITES), or add an exact ledger row in tests/suite_duration_budget.test.ts ' +
          'deliberately.',
      ).toBeLessThanOrEqual(DEFAULT_FILE_ALLOWANCE);
    }
    for (const [file, row] of FILE_ALLOWANCE_LEDGER) {
      expect(suite.has(file), `${file}: stale ledger row (file gone; delete the row)`).toBe(true);
      expect(
        row,
        `${file}: ledger row at or under the default is dead weight; delete it`,
      ).toBeGreaterThan(DEFAULT_FILE_ALLOWANCE);
    }
  });

  it('reads the tree only through the shared walker', () => {
    expectScansOnlyThroughSharedWalkers(import.meta.url, ['source_files_under']);
  });
});
