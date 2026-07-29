// CI entry for the ci.yml `changes` job ("Detect code path changes"): decide
// whether the run touches the code path set and write the `code` step output,
// plus the PR-tier selection decision (`test_mode`,
// `test_mode_reason`, `changed_files`) the pr-gate shards consume (the CI/CD
// performance packet's Phase 2; model and audit contract: docs/qa-gate.md,
// "Selective PR-tier CI"). The changed-file list comes from the
// GitHub pull request files endpoint, so the job needs no git history at all;
// both decisions are derived from the SAME fetched listing so they cannot
// disagree about the diff. The decision logic lives in
// lib/ci_change_classify.mjs and lib/ci_test_select.mjs (unit-tested) and is
// fail closed end to end (any error means code=true and test_mode=full). No
// npm deps: Node 18+ global fetch only, since this job deliberately skips the
// dependency install.
//
// Reads the standard GitHub Actions environment: GITHUB_EVENT_NAME,
// GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_OUTPUT, plus
// GITHUB_TOKEN passed in by the workflow step.
import { appendFileSync, readFileSync } from 'node:fs';
import { detectCode } from './lib/ci_change_classify.mjs';
import { decideTestMode } from './lib/ci_test_select.mjs';

/** @returns {any} the parsed event payload, or null when unreadable (fail closed downstream) */
function readEventPayload(path) {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

const payload = readEventPayload(process.env.GITHUB_EVENT_PATH);
const pr = payload?.pull_request;

const eventName = process.env.GITHUB_EVENT_NAME ?? '';
const { code, reason, files } = await detectCode({
  eventName,
  prNumber: typeof pr?.number === 'number' ? pr.number : Number.NaN,
  reportedCount: typeof pr?.changed_files === 'number' ? pr.changed_files : undefined,
  repo: process.env.GITHUB_REPOSITORY ?? '',
  token: process.env.GITHUB_TOKEN ?? '',
  apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
});

console.log(`[detect_code_changes] ${reason}`);

// The selection decision reuses the SAME listing snapshot; when detectCode
// failed closed it returns no files and the mode falls back to full. Wrapped
// like detectCode's own body: an unexpected throw here would fail the whole
// changes job, and its dependents SKIP rather than run full, which is the one
// wrong direction this file has. Any error is a full-suite decision instead.
let modeDecision;
try {
  modeDecision = decideTestMode({ eventName, code, files });
} catch (err) {
  const detail = JSON.stringify(err instanceof Error ? err.message : String(err));
  modeDecision = {
    mode: 'full',
    reason: `test-mode decision failed (${detail}): full suite`,
    changedPaths: [],
  };
}
// Values written to GITHUB_OUTPUT are one line each by construction (embedded
// filenames are JSON-escaped, the path list is JSON); this strip is the
// belt-and-suspenders against a future reason string smuggling a newline in.
const modeReason = modeDecision.reason.replace(/[\r\n]+/g, ' ');
console.log(`[detect_code_changes] test_mode=${modeDecision.mode} (${modeReason})`);

const outputLines =
  `code=${code}\n` +
  `test_mode=${modeDecision.mode}\n` +
  `test_mode_reason=${modeReason}\n` +
  `changed_files=${JSON.stringify(modeDecision.mode === 'selective' ? modeDecision.changedPaths : [])}\n`;
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, outputLines);
} else {
  process.stdout.write(outputLines);
}
