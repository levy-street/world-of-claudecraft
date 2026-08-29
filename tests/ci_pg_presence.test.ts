// The runtime half of the real-SQL merge bar (ruling R16, recorded in the
// woc-marketplace hardening state). Every pg integration suite gates on
// TEST_DATABASE_URL and SKIPS GREEN without it, so losing the CI service
// wiring would silently drop hundreds of money and security tests while
// every check stayed green. tests/ci_workflow.test.ts pins the wiring's
// SOURCE per job span; this suite is the live assertion the source pin
// cannot be: wherever it is ARMED it demands the variable EXIST. Two arms
// arm it: WOCC_EXPECT_PG travels in the same pinned job-level env block as
// the database URL, so the sentinel is source-fingerprinted alongside what
// it guards and fires on ANY runner brand; GITHUB_ACTIONS stays as the
// second arm so that on GitHub even deleting the whole env block (sentinel
// included) cannot disarm the check. Coverage mechanism, stated precisely:
// the variables are workflow-static, so losing them REQUIRES a .github/ (or
// config) diff, and exactly those diffs force the selective gate into FULL
// mode; as a CI_GUARD_SUITES member this file also seeds every selective
// run, where one shard leg executes it (sufficient: the env is job-level,
// so every leg of the job carries the same block); nightly re-proves it
// daily on every tracked ref. Local runs stay free: without either arm the
// pg suites are documented dev-optional (tests/CLAUDE.md, "Opt-in DB
// gates").
import { describe, expect, it } from 'vitest';

describe('ci real-sql presence', () => {
  // runIf, not an early return: a local run reports this SKIPPED honestly
  // instead of a green no-op, matching the repo idiom and the whole point
  // of this suite (skips must speak).
  it.runIf(process.env.WOCC_EXPECT_PG === '1' || process.env.GITHUB_ACTIONS === 'true')(
    'armed runs of this suite always carry TEST_DATABASE_URL',
    () => {
      expect(
        process.env.TEST_DATABASE_URL,
        'the pg suites are skipping green in CI: the per-leg Postgres service or its ' +
          'job-level TEST_DATABASE_URL is gone from this job (see tests/ci_workflow.test.ts)',
      ).toBeTruthy();
    },
  );
});
