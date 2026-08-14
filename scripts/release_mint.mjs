// Release-mint settings step (docs/merge-queue.md, "Minting a release branch").
//
// Run LOCALLY by the maintainer at mint time, after creating the new
// release/vX.Y.Z branch: `node scripts/release_mint.mjs vX.Y.Z` (the `v` is
// required; pass `--dry-run` to print without writing). It needs a gh CLI
// authenticated with admin:repo scope, which is exactly why this is a local
// script and not a workflow: rulesets cannot be edited with the workflow's
// `github.token`, and ci.yml deliberately bans `secrets.` interpolation
// (tests/ci_workflow.test.ts), so automating this server-side would mean
// minting a long-lived admin PAT into the repo. A local, audited, one-command
// step is the better trade; the incident it prevents is real (the queue
// ruleset stayed pinned to release/v0.35.0 for three releases and the queue
// silently stopped queueing anything, 2026-08-07 to 2026-08-14).
//
// What it does, in order:
//   1. Dumps BOTH green-tip rulesets (required checks + merge queue) to
//      stdout, before-state first, as the audit trail.
//   2. Verifies the new release ref is covered by the required-checks
//      ruleset's `release/**` include (structural: fails loud if someone
//      narrowed it). This script never edits that ruleset; its contexts
//      change only through the rename choreography in docs/merge-queue.md.
//   3. Rewrites the merge-queue ruleset's include to EXACTLY
//      [refs/heads/main, refs/heads/release/vX.Y.Z]: the new release branch
//      joins, the previous one leaves (its tip is frozen at mint), and main
//      stays.
//   4. Dumps the after-state and prints the remaining manual mint checklist.
//
// Keep scripts/release_version.mjs dependency-free and separate: it runs
// INSIDE the release-version-gate job on plain Node; this script runs only on
// a maintainer machine where gh is a given.

import { execFileSync } from 'node:child_process';

const OWNER_REPO = 'levy-street/world-of-claudecraft';
const REQUIRED_CHECKS_RULESET = 20533396;
const MERGE_QUEUE_RULESET = 20533398;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = args.find((a) => !a.startsWith('--'));
if (!version || !/^v\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node scripts/release_mint.mjs vX.Y.Z [--dry-run]');
  process.exit(1);
}
const releaseRef = `refs/heads/release/${version}`;

/**
 * @param {string[]} ghArgs
 * @param {string} [input]
 * @returns {string}
 */
function gh(ghArgs, input) {
  return execFileSync('gh', ghArgs, { encoding: 'utf8', ...(input ? { input } : {}) });
}

/** @param {number} id */
function fetchRuleset(id) {
  return JSON.parse(gh(['api', `repos/${OWNER_REPO}/rulesets/${id}`]));
}

console.log(`[release-mint] target ${releaseRef}${dryRun ? ' (dry run)' : ''}`);

const before96 = fetchRuleset(REQUIRED_CHECKS_RULESET);
const before98 = fetchRuleset(MERGE_QUEUE_RULESET);
console.log('[release-mint] BEFORE required-checks ruleset:');
console.log(JSON.stringify(before96, null, 2));
console.log('[release-mint] BEFORE merge-queue ruleset:');
console.log(JSON.stringify(before98, null, 2));

const include96 = before96.conditions?.ref_name?.include ?? [];
const covered = include96.some((pat) => pat === releaseRef || pat === 'refs/heads/release/**');
if (!covered) {
  console.error(
    `[release-mint] FAIL: required-checks ruleset include ${JSON.stringify(include96)} ` +
      `does not cover ${releaseRef}; fix the ruleset before minting`,
  );
  process.exit(1);
}
console.log('[release-mint] required-checks include covers the new ref');

const desired = ['refs/heads/main', releaseRef];
const current98 = before98.conditions?.ref_name?.include ?? [];
const sameInclude = JSON.stringify([...current98].sort()) === JSON.stringify([...desired].sort());

if (sameInclude) {
  console.log('[release-mint] merge-queue include already correct; nothing to write');
} else if (dryRun) {
  console.log(
    `[release-mint] DRY RUN: would set merge-queue include ${JSON.stringify(current98)} ` +
      `-> ${JSON.stringify(desired)}`,
  );
} else {
  // PUT replaces the whole ruleset, so resend every field unchanged except
  // the include list; a partial body would silently drop the queue rule.
  const body = JSON.stringify({
    name: before98.name,
    target: before98.target,
    enforcement: before98.enforcement,
    conditions: {
      ref_name: {
        include: desired,
        exclude: before98.conditions?.ref_name?.exclude ?? [],
      },
    },
    rules: before98.rules,
    bypass_actors: before98.bypass_actors ?? [],
  });
  gh(
    [
      'api',
      '--method',
      'PUT',
      `repos/${OWNER_REPO}/rulesets/${MERGE_QUEUE_RULESET}`,
      '--input',
      '-',
    ],
    body,
  );
  const after98 = fetchRuleset(MERGE_QUEUE_RULESET);
  console.log('[release-mint] AFTER merge-queue ruleset:');
  console.log(JSON.stringify(after98, null, 2));
}

console.log(`[release-mint] remaining manual mint checklist (docs/merge-queue.md):
  1. Confirm the ruleset dump above matches the intended include.
  2. Merge the previous release branch to main first if it has not landed.
  3. Update the tracking issue and announce the new integration base.
  4. First queued PR on the new branch is the queue drill: watch its
     gh-readonly-queue run go green before trusting the queue.`);
