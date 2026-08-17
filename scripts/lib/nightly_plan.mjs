// Pure planning logic for the nightly full-gate workflow
// (.github/workflows/nightly.yml): which refs to gate, which run jobs count as
// failures, and what to do to the single tracking issue. Kept free of fetch/fs
// so Vitest can pin every branch; the two thin entries
// (scripts/nightly_targets.mjs and scripts/nightly_report.mjs) do the HTTP.
//
// The alerting contract, from the incident that motivated the workflow (a
// release tip carried 67 broken tests for days because push runs were red with
// nobody watching): a red nightly run must land in exactly ONE open tracking
// issue (create it if absent, update it if present, never stack a second), and
// a green run must close that issue with a recovery comment. The finder is the
// label AND the exact title together, so a human applying the label to an
// unrelated issue can never get that issue's body overwritten or auto-closed.
// Renaming either constant strands any issue created under the old identity.
//
// A dispatch drill (the ref input) files under a SEPARATE identity, so the
// acceptance drill against a scratch branch never touches the production
// tracking issue.

export const NIGHTLY_ISSUE_LABEL = 'nightly-gate';
export const NIGHTLY_ISSUE_TITLE = 'Nightly full gate is red';
export const NIGHTLY_DRILL_ISSUE_LABEL = 'nightly-gate-drill';
export const NIGHTLY_DRILL_ISSUE_TITLE = 'Nightly full gate drill is red';

// The per-ref lanes the workflow fans out (tests, checks, browser). The
// proven-green guard below counts successes against this, so removing a lane
// from the workflow without updating this constant turns the nightly
// permanently "unproven" (loudly red), never silently green.
export const NIGHTLY_LANES_PER_REF = 3;

/**
 * The issue identity a run reports under: the production pair, or the drill
 * pair when the run was dispatched at an explicit ref.
 *
 * @param {boolean} drill
 * @returns {{ label: string, title: string }}
 */
export function trackingIssueIdentity(drill) {
  return drill
    ? { label: NIGHTLY_DRILL_ISSUE_LABEL, title: NIGHTLY_DRILL_ISSUE_TITLE }
    : { label: NIGHTLY_ISSUE_LABEL, title: NIGHTLY_ISSUE_TITLE };
}

/**
 * Branch names from a git matching-refs API batch. Entries that are not
 * `refs/heads/...` strings are dropped. If this strip ever broke, every name
 * would fail pickActiveReleaseBranch's anchor and the nightly would quietly
 * gate main alone, which is why it lives here under test instead of inline in
 * the entry.
 *
 * @param {ReadonlyArray<{ ref?: unknown }>} entries
 * @returns {string[]}
 */
export function refNamesFromMatchingRefs(entries) {
  /** @type {string[]} */
  const names = [];
  for (const entry of entries) {
    if (typeof entry?.ref === 'string' && entry.ref.startsWith('refs/heads/')) {
      names.push(entry.ref.slice('refs/heads/'.length));
    }
  }
  return names;
}

/**
 * Parse the NIGHTLY_TARGETS env value (the targets job's `refs` output).
 * Anything that is not a JSON array collapses to [], which the report plan
 * treats as "targets unknown" (fail closed toward an unproven verdict).
 *
 * @param {string | undefined} raw
 * @returns {string[]}
 */
export function parseTargetsEnv(raw) {
  try {
    const parsed = JSON.parse(raw ?? '');
    if (Array.isArray(parsed)) return parsed.filter((ref) => typeof ref === 'string');
  } catch {
    // Fall through to the unknown-targets shape.
  }
  return [];
}

/**
 * Whether an ensure-label response is a real failure. 422 means the label
 * already exists, which is the expected steady state.
 *
 * @param {boolean} ok
 * @param {number} status
 * @returns {boolean}
 */
export function labelEnsureFailed(ok, status) {
  return !ok && status !== 422;
}

/**
 * Pick the active release branch from a list of branch names: the highest
 * `release/vX.Y.Z` (or `release/X.Y.Z`) by semver. Names that do not parse are
 * ignored rather than string-compared, so a stray `release/next` can never
 * outrank a real version. Returns null when nothing parses.
 *
 * @param {readonly string[]} names
 * @returns {string | null}
 */
export function pickActiveReleaseBranch(names) {
  let best = null;
  let bestKey = null;
  for (const name of names) {
    const match = /^release\/v?(\d+)\.(\d+)\.(\d+)$/.exec(name);
    if (!match) continue;
    const key = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (
      bestKey === null ||
      key[0] > bestKey[0] ||
      (key[0] === bestKey[0] && key[1] > bestKey[1]) ||
      (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])
    ) {
      best = name;
      bestKey = key;
    }
  }
  return best;
}

/**
 * The refs the nightly run gates. A manual dispatch ref replaces the whole
 * list (that is the acceptance path: point the workflow at a scratch branch);
 * otherwise the default branch plus the active release branch, deduplicated
 * by name AND by resolved commit SHA: a release cut, or a release-to-main
 * merge, commonly leaves both branches pointing at the identical commit, and
 * gating both would run a full duplicate lane-job matrix for no extra
 * coverage.
 *
 * `shaByRef` maps a candidate ref name to its resolved commit SHA. A name
 * missing from the map, or mapped to a falsy value, means the SHA could not
 * be resolved for that ref: it is always kept, never dropped, because
 * dedup exists to NARROW the gated set and an unproven SHA must not be the
 * reason a ref goes ungated (fail OPEN, the same direction as every other
 * failure mode in this file).
 *
 * @param {{ inputRef?: string | null, releaseBranch?: string | null, defaultBranch?: string,
 *   shaByRef?: Readonly<Record<string, string | null | undefined>> }} opts
 * @returns {string[]}
 */
export function buildTargets({ inputRef, releaseBranch, defaultBranch = 'main', shaByRef = {} }) {
  const dispatch = typeof inputRef === 'string' ? inputRef.trim() : '';
  if (dispatch !== '') return [dispatch];
  const targets = [defaultBranch];
  if (releaseBranch && releaseBranch !== defaultBranch) targets.push(releaseBranch);
  return dedupeTargetsBySha(targets, shaByRef);
}

/**
 * Drop a later target whose resolved SHA matches an earlier target already
 * kept. A target whose SHA is unknown (missing or falsy in `shaByRef`) is
 * always kept: fail OPEN toward widening the gated set, never toward
 * silently dropping a ref the resolver could not vouch for.
 *
 * @param {readonly string[]} names
 * @param {Readonly<Record<string, string | null | undefined>>} shaByRef
 * @returns {string[]}
 */
export function dedupeTargetsBySha(names, shaByRef) {
  /** @type {string[]} */
  const kept = [];
  const seenShas = new Set();
  for (const name of names) {
    const sha = shaByRef[name];
    if (!sha) {
      kept.push(name);
      continue;
    }
    if (seenShas.has(sha)) continue;
    seenShas.add(sha);
    kept.push(name);
  }
  return kept;
}

/**
 * Extract the commit SHA from a git-refs API single-ref response
 * (`GET /repos/{repo}/git/ref/heads/{branch}`). Anything that is not the
 * expected `{ object: { sha: string } }` shape resolves to null, which
 * `dedupeTargetsBySha` treats as "unknown": fail OPEN, never drop a target
 * on an unproven duplicate.
 *
 * @param {unknown} body
 * @returns {string | null}
 */
export function shaFromGitRefResponse(body) {
  const sha =
    body && typeof body === 'object'
      ? /** @type {{ object?: { sha?: unknown } }} */ (body).object?.sha
      : undefined;
  return typeof sha === 'string' && sha.length > 0 ? sha : null;
}

/**
 * Split a workflow run's job listing into completed jobs and failures. Only
 * completed jobs are judged (the report job itself is still in progress when
 * it asks); among those, anything that is not success, skipped, or neutral
 * counts as a failure: cancelled, timed_out, action_required, stale, and an
 * unreadable conclusion all mean "the nightly did not prove the tip green",
 * which is the fail-closed direction for an alerting job.
 *
 * @param {ReadonlyArray<{ name?: string, status?: string, conclusion?: string | null, html_url?: string }>} jobs
 * @returns {{
 *   completed: Array<{ name: string, conclusion: string, html_url: string }>,
 *   failed: Array<{ name: string, conclusion: string, html_url: string }>,
 * }}
 */
export function summarizeRunJobs(jobs) {
  const completed = [];
  const failed = [];
  for (const job of jobs) {
    if (job?.status !== 'completed') continue;
    const entry = {
      name: typeof job.name === 'string' ? job.name : '(unnamed job)',
      conclusion: typeof job.conclusion === 'string' ? job.conclusion : 'unknown',
      html_url: typeof job.html_url === 'string' ? job.html_url : '',
    };
    completed.push(entry);
    if (
      entry.conclusion !== 'success' &&
      entry.conclusion !== 'skipped' &&
      entry.conclusion !== 'neutral'
    ) {
      failed.push(entry);
    }
  }
  return { completed, failed };
}

/**
 * @param {{ runUrl: string, targets: readonly string[], timestamp: string,
 *   failed: ReadonlyArray<{ name: string, conclusion: string, html_url: string }> }} opts
 * @returns {string}
 */
export function renderIssueBody({ runUrl, targets, timestamp, failed }) {
  const lines = [
    'The scheduled full gate found the tip red. This issue is managed by the',
    'nightly workflow: it is updated on repeat failures and closed automatically',
    'on the first green run, so keep it open until the tip is actually repaired.',
    '',
    `Latest red run: ${runUrl} (${timestamp})`,
    `Refs gated: ${targets.length > 0 ? targets.join(', ') : 'unknown (ref resolution failed)'}`,
    '',
    'Failed jobs:',
    ...failed.map(
      (job) => `- ${job.name}: ${job.conclusion}${job.html_url ? ` (${job.html_url})` : ''}`,
    ),
  ];
  return lines.join('\n');
}

/**
 * @param {{ runUrl: string, timestamp: string,
 *   failed: ReadonlyArray<{ name: string, conclusion: string, html_url: string }> }} opts
 * @returns {string}
 */
export function renderFailureComment({ runUrl, timestamp, failed }) {
  const lines = [
    `Still red: ${runUrl} (${timestamp})`,
    '',
    ...failed.map(
      (job) => `- ${job.name}: ${job.conclusion}${job.html_url ? ` (${job.html_url})` : ''}`,
    ),
  ];
  return lines.join('\n');
}

/**
 * @param {{ runUrl: string, timestamp: string }} opts
 * @returns {string}
 */
export function renderRecoveryComment({ runUrl, timestamp }) {
  return `Recovered: the nightly full gate is green again. ${runUrl} (${timestamp})`;
}

/**
 * Decide what to do to the tracking issue.
 *
 * The verdict is not "no failures": a run whose lanes never materialized (an
 * empty matrix, a skipped chain, unknown targets) proves nothing, so a green
 * verdict additionally requires one success for the targets job plus
 * NIGHTLY_LANES_PER_REF successes per gated ref among the completed jobs.
 * Anything short of that synthesizes an "unproven" failure, because closing
 * the tracking issue on a run that ran nothing is exactly the silent-green
 * failure mode this workflow exists to abolish.
 *
 * `openIssues` may be the raw issues listing: pull requests (which the issues
 * API also returns) and anything not open are filtered here, and only issues
 * whose title matches the run's identity are considered, so a human applying
 * the label to an unrelated issue never gets it rewritten or closed. When
 * several tracking issues exist, the OLDEST is updated and none are created;
 * duplicates are possible only when a dispatch run races the scheduled run
 * (they sit in different concurrency groups), and they drain one per green
 * run through the close branch.
 *
 * @param {{
 *   failed: ReadonlyArray<{ name: string, conclusion: string, html_url: string }>,
 *   completed: ReadonlyArray<{ name: string, conclusion: string, html_url: string }>,
 *   openIssues: ReadonlyArray<{ number?: number, state?: string, title?: string, pull_request?: unknown }>,
 *   runUrl: string,
 *   targets: readonly string[],
 *   timestamp: string,
 *   drill?: boolean,
 * }} opts
 * @returns {{ action: 'create', title: string, body: string, labels: string[] }
 *   | { action: 'update', issueNumber: number, body: string, comment: string }
 *   | { action: 'close', issueNumber: number, comment: string }
 *   | { action: 'none', reason: string }}
 */
export function planNightlyReport({
  failed,
  completed,
  openIssues,
  runUrl,
  targets,
  timestamp,
  drill = false,
}) {
  const identity = trackingIssueIdentity(drill);
  const tracking = openIssues
    // pull_request == null tolerates both the omitted key (GitHub) and an
    // explicit null (normalizing proxies); either way it is not a PR.
    .filter((issue) => issue && issue.state === 'open' && issue.pull_request == null)
    .filter((issue) => Number.isInteger(issue.number) && issue.title === identity.title)
    .sort((a, b) => a.number - b.number);
  const existing = tracking[0];

  const successCount = completed.filter((job) => job.conclusion === 'success').length;
  const requiredSuccesses = targets.length > 0 ? 1 + NIGHTLY_LANES_PER_REF * targets.length : null;
  const proven = requiredSuccesses !== null && successCount >= requiredSuccesses;
  const effectiveFailed =
    failed.length > 0
      ? failed
      : proven
        ? []
        : [
            {
              name:
                requiredSuccesses === null
                  ? 'nightly run reported no failures but its targets are unknown (unproven)'
                  : `nightly run reported no failures but only ${successCount} of the ${requiredSuccesses} expected jobs succeeded (unproven)`,
              conclusion: 'unproven',
              html_url: '',
            },
          ];

  if (effectiveFailed.length > 0) {
    const body = renderIssueBody({ runUrl, targets, timestamp, failed: effectiveFailed });
    if (existing === undefined) {
      return {
        action: 'create',
        title: identity.title,
        body,
        labels: [identity.label],
      };
    }
    return {
      action: 'update',
      issueNumber: existing.number,
      body,
      comment: renderFailureComment({ runUrl, timestamp, failed: effectiveFailed }),
    };
  }

  if (existing !== undefined) {
    return {
      action: 'close',
      issueNumber: existing.number,
      comment: renderRecoveryComment({ runUrl, timestamp }),
    };
  }
  return { action: 'none', reason: 'green run and no open tracking issue' };
}
