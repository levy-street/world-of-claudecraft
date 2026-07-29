// Pure test-mode decision for the ci.yml `changes` job: given the PR's file
// listing (the same snapshot ci_change_classify.mjs classified), decide whether
// the PR-tier shard matrix may run the SELECTIVE test plan or must run the FULL
// suite. Phase 2 of the CI/CD performance packet (docs/qa-gate.md,
// "Selective PR-tier CI").
//
// The reference semantics are the local selective gate (scripts/gate_select.mjs
// and docs/qa-gate.md): an always-run floor plus `vitest related` over the
// changed set, with an explicit fall-back-to-everything condition list. The
// planner buckets are shared outright (lib/gate_select_plan.mjs), so CI and the
// local bar cannot disagree about what a lockfile or a shared-helper edit
// means. On top of those, CI adds triggers of its own, each closing a hole the
// local gate covers some other way:
//
//   .github/          the workflow that RUNS the selection. A pull_request run
//                     executes the PR's own copy of ci.yml, so a workflow edit
//                     means the selection wiring itself is unproven.
//   pipeline scripts  the selection pipeline runs the PR's own copy of these
//                     too; a buggy edit could narrow its own test run. Locally
//                     the same files are ordinary related-sources; in CI they
//                     are the decision layer and get the full bar. Rot and
//                     mistake guards, NOT an integrity boundary: an adversary
//                     editing the pipeline edits this trigger with it, exactly
//                     as they could edit ci.yml, and the actual containment for
//                     fork PRs is the read-only token plus review.
//   removals/renames  `vitest related <deleted path>` matches nothing, so a
//                     test importing the deleted module is silently unselected.
//                     Locally tsc catches the broken import for .ts suites; the
//                     handful of .mjs suites are outside tsc, so CI refuses to
//                     narrow on ANY removed or renamed source/test path.
//   oversized listing the changed-path list rides a job output into an env var;
//                     past the relay budget it cannot be handed over intact, so
//                     the mode falls back rather than truncating the list.
//   odd paths/status  a path or status this module cannot read safely (control
//                     characters, a leading dash that vitest would parse as a
//                     flag, an unknown status) is unprovable, so it widens.
//
// SAFETY DIRECTION: mode='full' is always legal (it is exactly today's
// behavior). mode='selective' requires proving every changed file is one the
// planner understands. Any doubt resolves to 'full'.

import { isRelatedSourcePath, isTestPath, normalizeRepoPath } from './gate_fast_plan.mjs';
import { classifySelectPaths, isGeneratedI18nArtifactPath } from './gate_select_plan.mjs';

/**
 * The selection pipeline's own source files: the modules whose code computes
 * the mode decision or the shard-level plan. A PR touching any of these runs
 * the full suite, because the touched version is the one deciding.
 *
 * Extension-insensitive on the declaration side: the `.d.mts` twin of each
 * `.mjs` is included, since a stale declaration can hide a wiring bug from
 * check:types while the runtime behavior changes underneath it.
 *
 * tests/ci_selection_pipeline.test.ts recomputes the static import closure of
 * the two entries and fails when a module in the closure is missing here, so
 * the list cannot rot as imports are added.
 */
export const SELECTION_PIPELINE_FILES = Object.freeze([
  'scripts/detect_code_changes.mjs',
  'scripts/ci_shard_test.mjs',
  'scripts/lib/ci_change_classify.mjs',
  'scripts/lib/ci_test_select.mjs',
  'scripts/lib/ci_shard_plan.mjs',
  'scripts/lib/ci_leg_runner.mjs',
  'scripts/lib/gate_discovery.mjs',
  'scripts/lib/gate_select_plan.mjs',
  'scripts/lib/gate_fast_plan.mjs',
  'scripts/lib/teardown_rpc_flake.mjs',
  'scripts/lib/test_visibility.mjs',
]);

/** Statuses the pull request files endpoint documents. Anything else widens. */
const KNOWN_FILE_STATUSES = Object.freeze([
  'added',
  'removed',
  'modified',
  'renamed',
  'copied',
  'changed',
  'unchanged',
]);

/**
 * The changed-path list is relayed changes-job -> shard jobs as one job output
 * mapped into one env var. A single env entry beyond the kernel's per-string
 * budget (MAX_ARG_STRLEN, 128 KiB of BYTES on Linux) would make every shard's
 * spawn fail, so the handover refuses at half that, measured in UTF-8 BYTES
 * (a code-unit count under-measures non-ASCII paths), and falls back to the
 * full suite instead.
 */
export const CHANGED_LIST_BUDGET = 65536;

/** UTF-8 byte length, the unit MAX_ARG_STRLEN is defined in. */
export function relayByteLength(s) {
  return new TextEncoder().encode(s).length;
}

/** True for a path that is safe to relay and to place in a vitest argv. */
export function isRelayablePath(p) {
  if (typeof p !== 'string' || p === '') return false;
  if (p.startsWith('-')) return false;
  // Repo-relative only: the API listing cannot emit an absolute or escaping
  // path, but this predicate is the named relay-safety bar and its consumer
  // treats it as the whole validation, so it must not depend on the producer.
  if (p.startsWith('/') || p === '..' || p.startsWith('../')) return false;
  if (p.includes('/../') || p.endsWith('/..')) return false;
  // Control characters (newlines included) break the single-line GITHUB_OUTPUT
  // handover and can smuggle workflow commands into logs.
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
  }
  return true;
}

/** Pipeline self-match: the path itself or its `.d.mts`/`.mjs` twin. */
function isPipelineFile(p) {
  const base = p.replace(/\.d\.mts$/, '.mjs');
  return SELECTION_PIPELINE_FILES.includes(p) || SELECTION_PIPELINE_FILES.includes(base);
}

/**
 * Decide the PR-tier test mode from the changes-job context.
 *
 * @param {{
 *   eventName: string,
 *   code: boolean,
 *   files?: Array<{ filename?: string, previous_filename?: string | null, status?: string }>,
 * }} opts
 * @returns {{ mode: 'full' | 'selective', reason: string, changedPaths: string[] }}
 */
export function decideTestMode({ eventName, code, files }) {
  const full = (reason) => ({ mode: 'full', reason, changedPaths: [] });

  if (eventName !== 'pull_request') {
    return full('selection applies to pull requests only: full suite');
  }
  if (!Array.isArray(files) || files.length === 0) {
    return full('no provable changed-file listing: full suite');
  }
  if (code !== true && code !== false) {
    return full('code classification missing: full suite');
  }

  const changedPaths = [];
  for (const file of files) {
    const name = typeof file?.filename === 'string' ? normalizeRepoPath(file.filename) : '';
    if (!name || !isRelayablePath(name)) {
      return full('unreadable or unsafe file entry: full suite');
    }
    const status = file.status;
    if (typeof status !== 'string' || !KNOWN_FILE_STATUSES.includes(status)) {
      return full(`unknown file status (${JSON.stringify(name)}): full suite`);
    }
    if (name.startsWith('.github/')) {
      return full(`workflow-side change (${JSON.stringify(name)}): full suite`);
    }
    if (isPipelineFile(name)) {
      return full(`selection pipeline change (${JSON.stringify(name)}): full suite`);
    }
    const prev =
      typeof file.previous_filename === 'string' ? normalizeRepoPath(file.previous_filename) : '';
    if (prev && (isPipelineFile(prev) || prev.startsWith('.github/'))) {
      return full(`selection pipeline rename (${JSON.stringify(prev)}): full suite`);
    }
    // A rename whose source path is missing cannot be reasoned about: the
    // removed-path rule below depends on that field, so its absence is
    // unprovable, the same doctrine the status field gets.
    if (status === 'renamed' && !prev) {
      return full(`rename without a source path (${JSON.stringify(name)}): full suite`);
    }
    // A removed or renamed source/test file breaks importers that `related`
    // can no longer reach through the deleted path (see header).
    const goneEnds = [];
    if (status === 'removed') goneEnds.push(name);
    if (status === 'renamed' && prev) goneEnds.push(prev);
    for (const gone of goneEnds) {
      if (isRelatedSourcePath(gone) || isTestPath(gone)) {
        return full(`removed or renamed code path (${JSON.stringify(gone)}): full suite`);
      }
      // A deleted artifact is the one artifact shape the freshness diff cannot
      // flag (regeneration recreates it UNTRACKED, and `git diff` never shows
      // untracked files), so it is unprovable and widens.
      if (isGeneratedI18nArtifactPath(gone)) {
        return full(
          `removed or renamed generated i18n artifact (${JSON.stringify(gone)}): full suite`,
        );
      }
    }
    changedPaths.push(name);
  }

  if (relayByteLength(JSON.stringify(changedPaths)) > CHANGED_LIST_BUDGET) {
    return full(`changed-path list exceeds the relay budget (${files.length} files): full suite`);
  }

  // Shared planner buckets: lockfile, package.json, vite/vitest/tsconfig,
  // turbo/biome/npmrc, tests/helpers + fixtures, vitest setup files, and every
  // unrecognized path land in broadConfigs and widen to the full suite. The
  // generatedI18n bucket (freshness-guarded artifacts) never widens: the
  // deletion guard above already ran over the statuses, presence in the merge
  // tree is re-proven shard-side (lib/ci_shard_plan.mjs has the checkout this
  // job lacks), pr-checks' i18n regenerate-and-diff runs on every code PR in
  // every mode, and the shard plan feeds the artifact paths to `vitest
  // related` as graph nodes so their consumer suites stay selected (the
  // rationale lives in lib/gate_select_plan.mjs).
  const { testFiles, relatedSources, broadConfigs, generatedI18n } =
    classifySelectPaths(changedPaths);
  if (broadConfigs.length > 0) {
    const shown = broadConfigs.slice(0, 3).map((p) => JSON.stringify(p));
    return full(
      `broad or unclassified change (${shown.join(', ')}${broadConfigs.length > 3 ? ', ...' : ''}): full suite`,
    );
  }

  const inertCount =
    changedPaths.length - relatedSources.length - testFiles.length - generatedI18n.length;
  const artifactNote =
    generatedI18n.length > 0
      ? `, ${generatedI18n.length} generated i18n artifact(s) fed to related (freshness-guarded)`
      : '';
  return {
    mode: 'selective',
    reason:
      `selective: ${relatedSources.length} changed source file(s), ` +
      `${testFiles.length} changed test file(s), ` +
      `${inertCount} inert path(s)${artifactNote}`,
    changedPaths,
  };
}
