// Entry for the nightly workflow's ref-resolution job: decide which refs the
// scheduled full gate runs against and write them as a JSON array to the
// `refs` step output (consumed via fromJSON into the job matrix). Planning
// logic lives in lib/nightly_plan.mjs (unit-tested); this file only does the
// environment and HTTP plumbing. No npm deps: Node 18+ global fetch only.
//
// Fail direction: ref resolution exists to WIDEN the nightly, so an API error
// here must not silence the whole run. On any failure the targets collapse to
// the default branch alone, loudly, and the run still happens.
import { appendFileSync } from 'node:fs';
import {
  buildTargets,
  pickActiveReleaseBranch,
  refNamesFromMatchingRefs,
  shaFromGitRefResponse,
} from './lib/nightly_plan.mjs';

const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const repo = process.env.GITHUB_REPOSITORY ?? '';
const token = process.env.GITHUB_TOKEN ?? '';
// The workflow passes the real default branch; the 'main' fallback only
// covers a missing env var, so a renamed default branch cannot strand the
// nightly on a nonexistent ref.
const defaultBranch = (process.env.NIGHTLY_DEFAULT_BRANCH ?? '').trim() || 'main';

/** @returns {Promise<string[]>} branch names under release/ */
async function listReleaseBranches() {
  if (!repo || !token) throw new Error('missing GITHUB_REPOSITORY or GITHUB_TOKEN');
  /** @type {string[]} */
  const names = [];
  // matching-refs paginates like every list endpoint; release branches are few,
  // but a short-page loop costs nothing and cannot truncate silently.
  for (let page = 1; page <= 10; page++) {
    const url = `${API}/repos/${repo}/git/matching-refs/heads/release/?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`matching-refs page ${page} failed: HTTP ${res.status}`);
    const batch = await res.json();
    if (!Array.isArray(batch)) throw new Error(`matching-refs page ${page}: non-array payload`);
    names.push(...refNamesFromMatchingRefs(batch));
    if (batch.length < 100) return names;
  }
  return names;
}

/**
 * Resolve one branch's current commit SHA via the git-refs API. Failure
 * (missing token/repo, a non-OK response, a malformed payload, a network
 * error) resolves to null rather than throwing: SHA dedup fails OPEN, so an
 * unresolved SHA must widen the gated set, never collapse the whole run.
 *
 * @param {string} branchName
 * @returns {Promise<string | null>}
 */
async function resolveRefSha(branchName) {
  if (!repo || !token) return null;
  try {
    const url = `${API}/repos/${repo}/git/ref/heads/${branchName}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return shaFromGitRefResponse(await res.json());
  } catch {
    return null;
  }
}

/**
 * Resolve the commit SHA of every candidate ref the scheduled run considers,
 * for the dedupe pass in buildTargets. Each branch resolves independently so
 * one failed lookup never suppresses the other's SHA.
 *
 * @param {{ defaultBranch: string, releaseBranch: string | null }} opts
 * @returns {Promise<Record<string, string | null>>}
 */
async function resolveTargetShas({ defaultBranch, releaseBranch }) {
  /** @type {Record<string, string | null>} */
  const shaByRef = { [defaultBranch]: await resolveRefSha(defaultBranch) };
  if (releaseBranch && releaseBranch !== defaultBranch) {
    shaByRef[releaseBranch] = await resolveRefSha(releaseBranch);
  }
  return shaByRef;
}

const inputRef = process.env.NIGHTLY_REF ?? '';
let targets;
if (inputRef.trim() !== '') {
  targets = buildTargets({ inputRef, defaultBranch });
  console.log(`[nightly_targets] dispatch ref override: gating ${targets.join(', ')}`);
} else {
  try {
    const releaseBranch = pickActiveReleaseBranch(await listReleaseBranches());
    const shaByRef = await resolveTargetShas({ defaultBranch, releaseBranch });
    targets = buildTargets({ inputRef: null, releaseBranch, defaultBranch, shaByRef });
    console.log(
      `[nightly_targets] gating ${targets.join(', ')}${releaseBranch ? '' : ' (no release/vX.Y.Z branch found)'}`,
    );
  } catch (err) {
    targets = buildTargets({ inputRef: null, releaseBranch: null, defaultBranch });
    const detail = err instanceof Error ? err.message : String(err);
    console.log(
      `[nightly_targets] release branch resolution failed (${detail}); gating ${targets.join(', ')} only`,
    );
  }
}

const outputLine = `refs=${JSON.stringify(targets)}\n`;
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, outputLine);
} else {
  process.stdout.write(outputLine);
}
