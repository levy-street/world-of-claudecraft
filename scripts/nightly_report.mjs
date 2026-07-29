// Entry for the nightly workflow's report job: read the current run's job
// results and upsert the single tracking issue (create on first red, update on
// repeat red, close on recovery). The decision logic lives in
// lib/nightly_plan.mjs (unit-tested); this file is the HTTP plumbing. No npm
// deps: Node 18+ global fetch only.
//
// A dispatch drill (NIGHTLY_REF set) reports under the separate drill
// label/title, so acceptance runs against a scratch branch never touch the
// production tracking issue.
//
// Unlike the targets entry, an API failure HERE throws and fails the job: the
// report is the alerting deliverable, so degrading it silently would recreate
// the watched-by-nobody red tip this workflow exists to prevent. A red report
// job is itself visible in the Actions list.
import {
  labelEnsureFailed,
  parseTargetsEnv,
  planNightlyReport,
  summarizeRunJobs,
  trackingIssueIdentity,
} from './lib/nightly_plan.mjs';

const API = process.env.GITHUB_API_URL || 'https://api.github.com';
const repo = process.env.GITHUB_REPOSITORY ?? '';
const token = process.env.GITHUB_TOKEN ?? '';
const runId = process.env.GITHUB_RUN_ID ?? '';
const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
if (!repo || !token || !runId) {
  throw new Error('missing GITHUB_REPOSITORY, GITHUB_TOKEN, or GITHUB_RUN_ID');
}

const drill = (process.env.NIGHTLY_REF ?? '').trim() !== '';
const identity = trackingIssueIdentity(drill);
if (drill) {
  console.log(`[nightly_report] dispatch drill: reporting under the ${identity.label} identity`);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

/** @param {string} url @param {RequestInit} [init] @returns {Promise<any>} */
async function api(url, init) {
  const res = await fetch(`${API}${url}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
    ...init,
  });
  if (!res.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${url} failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
  return res.json();
}

// The current run's jobs, paginated. Only completed jobs are judged, which
// also excludes this report job itself (still in progress while asking).
/** @type {any[]} */
const jobs = [];
for (let page = 1; page <= 10; page++) {
  const payload = await api(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}`);
  const batch = Array.isArray(payload?.jobs) ? payload.jobs : [];
  jobs.push(...batch);
  if (batch.length < 100) break;
}

const { completed, failed } = summarizeRunJobs(jobs);
console.log(
  `[nightly_report] ${completed.length} completed jobs, ${failed.length} failed` +
    failed.map((job) => `\n  - ${job.name}: ${job.conclusion}`).join(''),
);

const openIssues = await api(
  `/repos/${repo}/issues?state=open&labels=${encodeURIComponent(identity.label)}&per_page=100`,
);

const plan = planNightlyReport({
  failed,
  completed,
  openIssues: Array.isArray(openIssues) ? openIssues : [],
  runUrl: `${serverUrl}/${repo}/actions/runs/${runId}`,
  targets: parseTargetsEnv(process.env.NIGHTLY_TARGETS),
  timestamp: new Date().toISOString(),
  drill,
});

if (plan.action === 'create') {
  // The label is the finder for every later run, so it must exist before the
  // issue carries it. 422 means it already does.
  const labelRes = await fetch(`${API}/repos/${repo}/labels`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      name: identity.label,
      color: 'b60205',
      description: drill
        ? 'Drill issue managed by the nightly full gate (dispatch runs)'
        : 'Tracking issue managed by the nightly full gate',
    }),
  });
  if (labelEnsureFailed(labelRes.ok, labelRes.status)) {
    throw new Error(`ensuring the ${identity.label} label failed: HTTP ${labelRes.status}`);
  }
  const issue = await api(`/repos/${repo}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: plan.title, body: plan.body, labels: plan.labels }),
  });
  console.log(`[nightly_report] created tracking issue #${issue.number}`);
} else if (plan.action === 'update') {
  await api(`/repos/${repo}/issues/${plan.issueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: plan.body }),
  });
  await api(`/repos/${repo}/issues/${plan.issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: plan.comment }),
  });
  console.log(`[nightly_report] updated tracking issue #${plan.issueNumber}`);
} else if (plan.action === 'close') {
  await api(`/repos/${repo}/issues/${plan.issueNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: plan.comment }),
  });
  await api(`/repos/${repo}/issues/${plan.issueNumber}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
  });
  console.log(`[nightly_report] closed tracking issue #${plan.issueNumber} (recovered)`);
} else {
  console.log(`[nightly_report] nothing to do: ${plan.reason}`);
}
