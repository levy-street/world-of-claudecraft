// CI entry for the ci.yml `changes` job ("Detect code path changes"): decide
// whether the run touches the code path set and write the `code` step output.
// The changed-file list comes from the GitHub pull request files endpoint, so
// the job needs no git history at all; the decision logic lives in
// lib/ci_change_classify.mjs (unit-tested) and is fail closed end to end (any
// error means code=true, the full PR tier). No npm deps: Node 18+ global
// fetch only, since this job deliberately skips the dependency install.
//
// Reads the standard GitHub Actions environment: GITHUB_EVENT_NAME,
// GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_OUTPUT, plus
// GITHUB_TOKEN passed in by the workflow step.
import { appendFileSync, readFileSync } from 'node:fs';
import { detectCode } from './lib/ci_change_classify.mjs';

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

const { code, reason } = await detectCode({
  eventName: process.env.GITHUB_EVENT_NAME ?? '',
  prNumber: typeof pr?.number === 'number' ? pr.number : Number.NaN,
  reportedCount: typeof pr?.changed_files === 'number' ? pr.changed_files : undefined,
  repo: process.env.GITHUB_REPOSITORY ?? '',
  token: process.env.GITHUB_TOKEN ?? '',
  apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com',
});

console.log(`[detect_code_changes] ${reason}`);

const outputLine = `code=${code}\n`;
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, outputLine);
} else {
  process.stdout.write(outputLine);
}
