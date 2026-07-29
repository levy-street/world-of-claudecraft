import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFullGateSteps, I18N_RELEASE_TIER_SUITES } from '../scripts/lib/gate_steps.mjs';
import { tsFilesUnder } from './helpers/ts_files_under';

// The anti-rot guard for the release-tier split (issue #2820).
//
// The release tier used to be a job-level env var over the whole release test job.
// That could not be forgotten, but it fused two signals: a release branch is red for
// un-filled locales through most of a cycle, so a real regression hid inside expected
// noise for hours. Moving the tier onto its own job separates them, at the cost of an
// explicit file list, and an explicit list can rot: add a sixth tier-sensitive suite,
// forget the list, and that suite silently never runs under the tier again. Nothing
// goes red. A check that quietly stopped running looks exactly like a passing one.
//
// So the list is pinned THREE ways and they must agree:
//   1. the scan below, over every test file that READS process.env.I18N_RELEASE_TIER
//   2. I18N_RELEASE_TIER_SUITES (scripts/lib/gate_steps.mjs), which the local gate runs
//   3. the release-i18n job command in .github/workflows/ci.yml
// Any one drifting fails here, naming the file and the place that forgot it.

const REPO_ROOT = new URL('..', import.meta.url);
const WORKFLOW = readFileSync(new URL('.github/workflows/ci.yml', REPO_ROOT), 'utf8');

/** Reads the flag at runtime, as opposed to merely mentioning the name in prose. */
const READS_TIER_FLAG = /process\.env\.I18N_RELEASE_TIER/;

/**
 * This guard's own file is excluded: its prose names the flag while asserting ABOUT it,
 * which is not the same as reading it at runtime, and including itself would make the
 * list permanently one entry longer than the suites that actually run under the tier.
 */
const SELF = 'release_i18n_tier_coverage.test.ts';

function suitesReadingTierFlag(): string[] {
  return tsFilesUnder(new URL('.', import.meta.url).pathname)
    .filter((entry) => entry.file.endsWith('.test.ts') && !entry.file.endsWith(SELF))
    .filter((entry) => READS_TIER_FLAG.test(readFileSync(entry.full, 'utf8')))
    .map((entry) => `tests/${entry.file}`)
    .sort();
}

/** The test files named on the release-i18n job's `npm test` line. */
function suitesInWorkflowJob(): string[] {
  const job = WORKFLOW.slice(WORKFLOW.indexOf('  release-i18n:'));
  const jobBody = job.slice(0, job.indexOf('\n  release-checks:'));
  const runLine = /run: npm test -- (.+)/.exec(jobBody)?.[1] ?? '';
  return runLine
    .split(/\s+/)
    .filter((arg) => arg.endsWith('.test.ts'))
    .sort();
}

describe('release-tier i18n job covers every tier-sensitive suite', () => {
  it('scans a non-empty set (a scan that finds nothing would pass everything)', () => {
    // Vacuity floor: if the scan silently stopped matching, every equality below
    // would hold trivially over two empty lists.
    expect(suitesReadingTierFlag().length).toBeGreaterThanOrEqual(5);
  });

  it('matches the shared list the local gate runs', () => {
    expect(suitesReadingTierFlag()).toEqual([...I18N_RELEASE_TIER_SUITES].sort());
  });

  it('matches the release-i18n job in ci.yml, so CI and the local gate cannot drift', () => {
    expect(suitesInWorkflowJob()).toEqual([...I18N_RELEASE_TIER_SUITES].sort());
  });

  it('names each expected suite explicitly, so a wholesale replacement is visible', () => {
    // Pinned to literals rather than derived, so swapping the whole set (rather than
    // adding to it) still has to be a deliberate edit here.
    expect([...I18N_RELEASE_TIER_SUITES].sort()).toEqual([
      'tests/deed_i18n.test.ts',
      'tests/i18n_status_registry.test.ts',
      'tests/i18n_t_behavior.test.ts',
      'tests/localization_coverage.test.ts',
      'tests/localization_fixes.test.ts',
    ]);
  });
});

describe('the tier flag lives in exactly one job', () => {
  it('release-gate runs at PR tier, so a red shard there is always a real regression', () => {
    const releaseGate = WORKFLOW.slice(
      WORKFLOW.indexOf('  release-gate:'),
      WORKFLOW.indexOf('  release-i18n:'),
    );
    // Absence of the ENV STANZA, not of the string: the job's comment explains why the
    // flag is not here, and a prose ban would make that comment unwritable.
    expect(releaseGate).not.toMatch(/^\s{4}env:\n\s{6}I18N_RELEASE_TIER/m);
  });

  it('release-i18n sets the flag at job level', () => {
    const releaseI18n = WORKFLOW.slice(
      WORKFLOW.indexOf('  release-i18n:'),
      WORKFLOW.indexOf('  release-checks:'),
    );
    expect(releaseI18n).toContain("\n    env:\n      I18N_RELEASE_TIER: '1'");
    // Unsharded on purpose: five files, seconds long. A matrix here would be cost
    // with no benefit, and would reintroduce per-shard tier confusion.
    expect(releaseI18n).not.toContain('matrix:');
  });

  it('shares the release if-condition, so the release jobs run or skip together', () => {
    const releaseGate = WORKFLOW.slice(
      WORKFLOW.indexOf('  release-gate:'),
      WORKFLOW.indexOf('  release-i18n:'),
    );
    const releaseI18n = WORKFLOW.slice(
      WORKFLOW.indexOf('  release-i18n:'),
      WORKFLOW.indexOf('  release-checks:'),
    );
    const ifLine = (job: string) => /^\s{4}if: .+$/m.exec(job)?.[0]?.trim();
    expect(ifLine(releaseI18n)).toBe(ifLine(releaseGate));
  });
});

describe('the local gate carries the same split as CI', () => {
  // tests/ci_workflow.test.ts only string-matches the `buildFullGateSteps(workers,
  // { releaseTier })` CALL. Deleting the `if (opts.releaseTier)` body would leave that
  // match, CI's release-i18n job, and the three-way list pin all green while
  // `npm run gate` on a release branch silently stopped running the tier at all. This
  // pins the produced step instead of the call site.
  const prTier = buildFullGateSteps(8);
  const releaseTier = buildFullGateSteps(8, { releaseTier: true });
  const named = (steps: ReturnType<typeof buildFullGateSteps>, name: string) =>
    steps.find((step) => step.name === name);

  it('adds exactly one step on a release branch', () => {
    expect(releaseTier.length).toBe(prTier.length + 1);
    expect(named(prTier, 'vitest (release-tier i18n)')).toBeUndefined();
  });

  it('runs the tier suites under the flag, and nothing else', () => {
    const step = named(releaseTier, 'vitest (release-tier i18n)');
    expect(step?.env?.I18N_RELEASE_TIER).toBe('1');
    expect(step?.args.filter((arg) => arg.endsWith('.test.ts'))).toEqual([
      ...I18N_RELEASE_TIER_SUITES,
    ]);
  });

  it('leaves the full suite at PR tier in both shapes', () => {
    // The whole point of the split: the full run must never carry the flag, or the
    // masking this fixes comes straight back locally.
    for (const steps of [prTier, releaseTier]) {
      expect(named(steps, 'vitest (full suite)')?.env?.I18N_RELEASE_TIER).toBeUndefined();
    }
  });
});
