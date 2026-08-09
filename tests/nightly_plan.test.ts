import { describe, expect, it } from 'vitest';
import {
  buildTargets,
  dedupeTargetsBySha,
  labelEnsureFailed,
  NIGHTLY_DRILL_ISSUE_LABEL,
  NIGHTLY_DRILL_ISSUE_TITLE,
  NIGHTLY_ISSUE_LABEL,
  NIGHTLY_ISSUE_TITLE,
  NIGHTLY_LANES_PER_REF,
  parseTargetsEnv,
  pickActiveReleaseBranch,
  planNightlyReport,
  refNamesFromMatchingRefs,
  renderIssueBody,
  renderRecoveryComment,
  shaFromGitRefResponse,
  summarizeRunJobs,
  trackingIssueIdentity,
} from '../scripts/lib/nightly_plan.mjs';

const RUN = {
  runUrl: 'https://github.com/levy-street/world-of-claudecraft/actions/runs/123',
  targets: ['main', 'release/v0.35.0'],
  timestamp: '2026-08-05T04:47:00.000Z',
} as const;

const FAILED = [
  {
    name: 'Nightly tests (release/v0.35.0)',
    conclusion: 'failure',
    html_url: 'https://github.com/levy-street/world-of-claudecraft/runs/1',
  },
] as const;

const success = (name: string) => ({ name, conclusion: 'success', html_url: '' });

// A fully proven green run for RUN's two targets: the targets job plus
// NIGHTLY_LANES_PER_REF lanes per ref, all successful.
const FULL_GREEN = [
  success('Resolve nightly refs'),
  success('Nightly tests (main)'),
  success('Nightly checks (main)'),
  success('Nightly browser (main)'),
  success('Nightly tests (release/v0.35.0)'),
  success('Nightly checks (release/v0.35.0)'),
  success('Nightly browser (release/v0.35.0)'),
];

const openIssue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  state: 'open',
  title: NIGHTLY_ISSUE_TITLE,
  ...extra,
});

describe('issue identity constants', () => {
  it('pins the literal label and title the cross-run finder depends on', () => {
    // The label is the issues-API finder and the title is the in-plan finder;
    // renaming either strands every issue created under the old identity, so
    // the literals are pinned here, not just compared to themselves.
    expect(NIGHTLY_ISSUE_LABEL).toBe('nightly-gate');
    expect(NIGHTLY_ISSUE_TITLE).toBe('Nightly full gate is red');
    expect(NIGHTLY_DRILL_ISSUE_LABEL).toBe('nightly-gate-drill');
    expect(NIGHTLY_DRILL_ISSUE_TITLE).toBe('Nightly full gate drill is red');
    expect(NIGHTLY_LANES_PER_REF).toBe(3);
    expect(trackingIssueIdentity(false)).toEqual({
      label: 'nightly-gate',
      title: 'Nightly full gate is red',
    });
    expect(trackingIssueIdentity(true)).toEqual({
      label: 'nightly-gate-drill',
      title: 'Nightly full gate drill is red',
    });
  });
});

describe('pickActiveReleaseBranch', () => {
  it('picks the highest release/vX.Y.Z by semver, not by string order', () => {
    expect(
      pickActiveReleaseBranch([
        'release/v0.9.0',
        'release/v0.35.0',
        'release/v0.27.0',
        'release/v0.10.1',
      ]),
    ).toBe('release/v0.35.0');
    // String comparison would call v0.9.0 the highest here; semver must win.
    expect(pickActiveReleaseBranch(['release/v0.9.0', 'release/v0.10.0'])).toBe('release/v0.10.0');
  });

  it('decides on every dimension, not just the minor version', () => {
    // Patch decides: losing this clause would gate a stale release tip.
    expect(pickActiveReleaseBranch(['release/v0.35.0', 'release/v0.35.1'])).toBe('release/v0.35.1');
    expect(pickActiveReleaseBranch(['release/v0.35.10', 'release/v0.35.9'])).toBe(
      'release/v0.35.10',
    );
    // Major decides.
    expect(pickActiveReleaseBranch(['release/v0.36.0', 'release/v1.0.0'])).toBe('release/v1.0.0');
  });

  it('accepts the unprefixed form and ignores names that do not parse', () => {
    expect(pickActiveReleaseBranch(['release/0.36.0', 'release/v0.35.0'])).toBe('release/0.36.0');
    expect(
      pickActiveReleaseBranch(['release/next', 'release/v1.2', 'main', 'feature/release/v9.9.9']),
    ).toBeNull();
    expect(pickActiveReleaseBranch([])).toBeNull();
  });
});

describe('buildTargets', () => {
  it('gates the default branch plus the active release branch on a scheduled run', () => {
    expect(buildTargets({ inputRef: null, releaseBranch: 'release/v0.35.0' })).toEqual([
      'main',
      'release/v0.35.0',
    ]);
    expect(
      buildTargets({ inputRef: null, releaseBranch: 'release/v0.35.0', defaultBranch: 'trunk' }),
    ).toEqual(['trunk', 'release/v0.35.0']);
  });

  it('collapses to the default branch when no release branch resolves', () => {
    expect(buildTargets({ inputRef: null, releaseBranch: null })).toEqual(['main']);
    expect(buildTargets({ inputRef: '   ', releaseBranch: null })).toEqual(['main']);
  });

  it('lets a dispatch ref replace the whole list (the acceptance drill path)', () => {
    expect(
      buildTargets({ inputRef: 'scratch/broken-test', releaseBranch: 'release/v0.35.0' }),
    ).toEqual(['scratch/broken-test']);
  });

  it('never lists the default branch twice', () => {
    expect(buildTargets({ inputRef: null, releaseBranch: 'main' })).toEqual(['main']);
  });

  it('drops the release branch when it resolves to the same SHA as the default branch', () => {
    // The scenario this exists for: a release cut or a release-to-main merge
    // leaves both branches pointing at the identical commit.
    expect(
      buildTargets({
        inputRef: null,
        releaseBranch: 'release/v0.35.0',
        defaultBranch: 'main',
        shaByRef: { main: 'sha-1', 'release/v0.35.0': 'sha-1' },
      }),
    ).toEqual(['main']);
  });

  it('keeps both branches when their SHAs differ', () => {
    expect(
      buildTargets({
        inputRef: null,
        releaseBranch: 'release/v0.35.0',
        defaultBranch: 'main',
        shaByRef: { main: 'sha-1', 'release/v0.35.0': 'sha-2' },
      }),
    ).toEqual(['main', 'release/v0.35.0']);
  });

  it('fails open: an unresolved SHA never drops a target', () => {
    // Missing from the map entirely.
    expect(
      buildTargets({
        inputRef: null,
        releaseBranch: 'release/v0.35.0',
        defaultBranch: 'main',
        shaByRef: { main: 'sha-1' },
      }),
    ).toEqual(['main', 'release/v0.35.0']);
    // Explicitly null (a failed lookup), even though the other side matches.
    expect(
      buildTargets({
        inputRef: null,
        releaseBranch: 'release/v0.35.0',
        defaultBranch: 'main',
        shaByRef: { main: 'sha-1', 'release/v0.35.0': null },
      }),
    ).toEqual(['main', 'release/v0.35.0']);
    // No shaByRef at all defaults to keeping everything, same as before this
    // dedup existed.
    expect(
      buildTargets({ inputRef: null, releaseBranch: 'release/v0.35.0', defaultBranch: 'main' }),
    ).toEqual(['main', 'release/v0.35.0']);
  });

  it('ignores shaByRef entirely on a dispatch override', () => {
    expect(
      buildTargets({
        inputRef: 'scratch/broken-test',
        releaseBranch: 'release/v0.35.0',
        defaultBranch: 'main',
        shaByRef: { main: 'sha-1', 'scratch/broken-test': 'sha-1' },
      }),
    ).toEqual(['scratch/broken-test']);
  });
});

describe('dedupeTargetsBySha', () => {
  it('drops a later name whose SHA repeats an earlier kept name', () => {
    expect(
      dedupeTargetsBySha(['main', 'release/v0.35.0', 'release/v0.34.0'], {
        main: 'sha-1',
        'release/v0.35.0': 'sha-1',
        'release/v0.34.0': 'sha-2',
      }),
    ).toEqual(['main', 'release/v0.34.0']);
  });

  it('never drops a name with an unknown SHA, missing or falsy', () => {
    expect(dedupeTargetsBySha(['main', 'release/v0.35.0'], { main: 'sha-1' })).toEqual([
      'main',
      'release/v0.35.0',
    ]);
    expect(
      dedupeTargetsBySha(['main', 'release/v0.35.0'], { main: 'sha-1', 'release/v0.35.0': null }),
    ).toEqual(['main', 'release/v0.35.0']);
    expect(
      dedupeTargetsBySha(['main', 'release/v0.35.0'], { main: 'sha-1', 'release/v0.35.0': '' }),
    ).toEqual(['main', 'release/v0.35.0']);
  });

  it('passes an empty list through unchanged', () => {
    expect(dedupeTargetsBySha([], {})).toEqual([]);
  });
});

describe('shaFromGitRefResponse', () => {
  it('extracts the commit SHA from a well-formed git-refs single-ref response', () => {
    expect(
      shaFromGitRefResponse({
        ref: 'refs/heads/main',
        object: { sha: 'abc123', type: 'commit' },
      }),
    ).toBe('abc123');
  });

  it('resolves to null for anything that is not the expected shape', () => {
    expect(shaFromGitRefResponse(null)).toBeNull();
    expect(shaFromGitRefResponse(undefined)).toBeNull();
    expect(shaFromGitRefResponse('abc123')).toBeNull();
    expect(shaFromGitRefResponse({})).toBeNull();
    expect(shaFromGitRefResponse({ object: {} })).toBeNull();
    expect(shaFromGitRefResponse({ object: { sha: 42 } })).toBeNull();
    expect(shaFromGitRefResponse({ object: { sha: '' } })).toBeNull();
  });
});

describe('refNamesFromMatchingRefs', () => {
  it('strips the refs/heads/ prefix and drops everything else', () => {
    // If this strip broke, every name would fail pickActiveReleaseBranch's
    // anchor and the nightly would quietly gate main alone forever.
    expect(
      refNamesFromMatchingRefs([
        { ref: 'refs/heads/release/v0.35.0' },
        { ref: 'refs/heads/main' },
        { ref: 'refs/tags/v0.35.0' },
        { ref: 42 as unknown as string },
        {},
        { ref: 'release/v0.34.0' },
      ]),
    ).toEqual(['release/v0.35.0', 'main']);
    expect(refNamesFromMatchingRefs([])).toEqual([]);
  });
});

describe('parseTargetsEnv', () => {
  it('parses a JSON string array and collapses everything else to unknown', () => {
    expect(parseTargetsEnv('["main","release/v0.35.0"]')).toEqual(['main', 'release/v0.35.0']);
    expect(parseTargetsEnv('["main",5,null]')).toEqual(['main']);
    expect(parseTargetsEnv('')).toEqual([]);
    expect(parseTargetsEnv(undefined)).toEqual([]);
    expect(parseTargetsEnv('null')).toEqual([]);
    expect(parseTargetsEnv('{"ref":"main"}')).toEqual([]);
    expect(parseTargetsEnv('not json')).toEqual([]);
  });
});

describe('labelEnsureFailed', () => {
  it('tolerates only success and already-exists', () => {
    expect(labelEnsureFailed(true, 201)).toBe(false);
    expect(labelEnsureFailed(false, 422)).toBe(false);
    // Inverting this makes the very first red night throw instead of filing.
    expect(labelEnsureFailed(false, 403)).toBe(true);
    expect(labelEnsureFailed(false, 500)).toBe(true);
  });
});

describe('summarizeRunJobs', () => {
  it('judges only completed jobs, so the in-progress report job never counts', () => {
    const { completed, failed } = summarizeRunJobs([
      { name: 'Nightly tests (main)', status: 'completed', conclusion: 'success', html_url: 'u1' },
      { name: 'Report nightly verdict', status: 'in_progress', conclusion: null, html_url: 'u2' },
    ]);
    expect(completed.map((job) => job.name)).toEqual(['Nightly tests (main)']);
    expect(failed).toEqual([]);
  });

  it('counts every non-success, non-skipped, non-neutral conclusion as a failure', () => {
    const { failed } = summarizeRunJobs([
      { name: 'a', status: 'completed', conclusion: 'failure', html_url: '' },
      { name: 'b', status: 'completed', conclusion: 'cancelled', html_url: '' },
      { name: 'c', status: 'completed', conclusion: 'timed_out', html_url: '' },
      { name: 'd', status: 'completed', conclusion: 'action_required', html_url: '' },
      { name: 'e', status: 'completed', conclusion: 'stale', html_url: '' },
      { name: 'f', status: 'completed', conclusion: 'success', html_url: '' },
      { name: 'g', status: 'completed', conclusion: 'skipped', html_url: '' },
      { name: 'h', status: 'completed', conclusion: 'neutral', html_url: '' },
    ]);
    expect(failed.map((job) => job.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('fails closed on a completed job with unreadable fields', () => {
    const { failed } = summarizeRunJobs([
      { status: 'completed', conclusion: null, html_url: 7 as unknown as string },
    ]);
    expect(failed).toEqual([{ name: '(unnamed job)', conclusion: 'unknown', html_url: '' }]);
  });
});

describe('renderIssueBody', () => {
  it('omits the parenthesised link when a job has no URL', () => {
    const body = renderIssueBody({
      ...RUN,
      failed: [
        { name: 'with-url', conclusion: 'failure', html_url: 'https://example.com/1' },
        { name: 'without-url', conclusion: 'unproven', html_url: '' },
      ],
    });
    expect(body).toContain('- with-url: failure (https://example.com/1)');
    expect(body.endsWith('- without-url: unproven')).toBe(true);
    expect(body).not.toContain('unproven (');
  });
});

describe('planNightlyReport', () => {
  it('creates the labeled tracking issue on the first red run', () => {
    const plan = planNightlyReport({ ...RUN, failed: [...FAILED], completed: [], openIssues: [] });
    expect(plan).toEqual({
      action: 'create',
      title: NIGHTLY_ISSUE_TITLE,
      body: renderIssueBody({ ...RUN, failed: [...FAILED] }),
      labels: [NIGHTLY_ISSUE_LABEL],
    });
    if (plan.action !== 'create') throw new Error('unreachable');
    expect(plan.body).toContain(RUN.runUrl);
    expect(plan.body).toContain(RUN.timestamp);
    expect(plan.body).toContain('Nightly tests (release/v0.35.0): failure');
    expect(plan.body).toContain('Refs gated: main, release/v0.35.0');
  });

  it('updates the existing open issue on a repeat failure, never a second issue', () => {
    const plan = planNightlyReport({
      ...RUN,
      failed: [...FAILED],
      completed: [],
      openIssues: [openIssue(42)],
    });
    expect(plan.action).toBe('update');
    if (plan.action !== 'update') throw new Error('unreachable');
    expect(plan.issueNumber).toBe(42);
    expect(plan.comment).toContain('Still red');
    expect(plan.comment).toContain(RUN.runUrl);
    // The comment must say WHICH job is still red, not just that something is.
    expect(plan.comment).toContain('Nightly tests (release/v0.35.0): failure');
  });

  it('keeps exactly one tracking issue even if duplicates exist: oldest wins, none created', () => {
    const plan = planNightlyReport({
      ...RUN,
      failed: [...FAILED],
      completed: [],
      openIssues: [openIssue(50), openIssue(42)],
    });
    expect(plan.action).toBe('update');
    if (plan.action !== 'update') throw new Error('unreachable');
    expect(plan.issueNumber).toBe(42);
  });

  it('ignores pull requests and non-open entries, but keeps a null pull_request field', () => {
    const plan = planNightlyReport({
      ...RUN,
      failed: [...FAILED],
      completed: [],
      openIssues: [
        openIssue(7, { pull_request: { url: 'x' } }),
        { number: 8, state: 'closed', title: NIGHTLY_ISSUE_TITLE },
        { state: 'open', title: NIGHTLY_ISSUE_TITLE },
      ],
    });
    expect(plan.action).toBe('create');
    // pull_request: null (a normalizing proxy) is still an issue, not a PR.
    const tolerant = planNightlyReport({
      ...RUN,
      failed: [...FAILED],
      completed: [],
      openIssues: [openIssue(9, { pull_request: null })],
    });
    expect(tolerant.action).toBe('update');
    if (tolerant.action !== 'update') throw new Error('unreachable');
    expect(tolerant.issueNumber).toBe(9);
  });

  it('never touches a mislabeled foreign issue: the title is part of the finder', () => {
    const foreign = openIssue(3, { title: 'Server login is broken' });
    // Red run: the foreign issue must not be updated (its body would be
    // overwritten wholesale); a fresh tracking issue is created instead.
    const red = planNightlyReport({
      ...RUN,
      failed: [...FAILED],
      completed: [],
      openIssues: [foreign],
    });
    expect(red.action).toBe('create');
    // Green run: the foreign issue must not be closed as "recovered".
    const green = planNightlyReport({
      ...RUN,
      failed: [],
      completed: FULL_GREEN,
      openIssues: [foreign],
    });
    expect(green.action).toBe('none');
  });

  it('closes the issue with a recovery comment on the first proven green run', () => {
    const plan = planNightlyReport({
      ...RUN,
      failed: [],
      completed: FULL_GREEN,
      openIssues: [openIssue(42)],
    });
    expect(plan).toEqual({
      action: 'close',
      issueNumber: 42,
      comment: renderRecoveryComment(RUN),
    });
    if (plan.action !== 'close') throw new Error('unreachable');
    expect(plan.comment).toContain('green again');
    expect(plan.comment).toContain(RUN.runUrl);
  });

  it('closes the oldest duplicate on green, draining extras one per green run', () => {
    const plan = planNightlyReport({
      ...RUN,
      failed: [],
      completed: FULL_GREEN,
      openIssues: [openIssue(50), openIssue(42)],
    });
    expect(plan.action).toBe('close');
    if (plan.action !== 'close') throw new Error('unreachable');
    expect(plan.issueNumber).toBe(42);
  });

  it('does nothing on a proven green run with no open tracking issue', () => {
    expect(
      planNightlyReport({ ...RUN, failed: [], completed: FULL_GREEN, openIssues: [] }),
    ).toEqual({
      action: 'none',
      reason: 'green run and no open tracking issue',
    });
  });

  it('treats a no-failure run that proved nothing as red, never as recovery', () => {
    // Zero failures but only the targets job and one lane completed: closing
    // the tracking issue here would be the silent-green failure mode itself.
    const partial = [success('Resolve nightly refs'), success('Nightly tests (main)')];
    const plan = planNightlyReport({
      ...RUN,
      failed: [],
      completed: partial,
      openIssues: [openIssue(42)],
    });
    expect(plan.action).toBe('update');
    if (plan.action !== 'update') throw new Error('unreachable');
    expect(plan.body).toContain('only 2 of the 7 expected jobs succeeded (unproven)');
    // And with no open issue, it files one rather than staying silent.
    const fresh = planNightlyReport({ ...RUN, failed: [], completed: partial, openIssues: [] });
    expect(fresh.action).toBe('create');
  });

  it('treats unknown targets as unproven even with zero failures', () => {
    const plan = planNightlyReport({
      ...RUN,
      targets: [],
      failed: [],
      completed: FULL_GREEN,
      openIssues: [],
    });
    expect(plan.action).toBe('create');
    if (plan.action !== 'create') throw new Error('unreachable');
    expect(plan.body).toContain('targets are unknown (unproven)');
    expect(plan.body).toContain('unknown (ref resolution failed)');
  });

  it('reports a drill under the drill identity and never sees the production issue', () => {
    const prod = openIssue(42);
    const drillRun = { ...RUN, targets: ['scratch/broken-test'] };
    const red = planNightlyReport({
      ...drillRun,
      failed: [...FAILED],
      completed: [],
      openIssues: [prod],
      drill: true,
    });
    expect(red).toMatchObject({
      action: 'create',
      title: NIGHTLY_DRILL_ISSUE_TITLE,
      labels: [NIGHTLY_DRILL_ISSUE_LABEL],
    });
    // A proven green drill (targets job + 3 lanes for its one ref) must not
    // close the production issue either.
    const green = planNightlyReport({
      ...drillRun,
      failed: [],
      completed: [
        success('Resolve nightly refs'),
        success('Nightly tests (scratch/broken-test)'),
        success('Nightly checks (scratch/broken-test)'),
        success('Nightly browser (scratch/broken-test)'),
      ],
      openIssues: [prod],
      drill: true,
    });
    expect(green.action).toBe('none');
    // And it does close its own drill issue.
    const drillIssue = openIssue(60, { title: NIGHTLY_DRILL_ISSUE_TITLE });
    const recovery = planNightlyReport({
      ...drillRun,
      failed: [],
      completed: [
        success('Resolve nightly refs'),
        success('Nightly tests (scratch/broken-test)'),
        success('Nightly checks (scratch/broken-test)'),
        success('Nightly browser (scratch/broken-test)'),
      ],
      openIssues: [drillIssue],
      drill: true,
    });
    expect(recovery.action).toBe('close');
    if (recovery.action !== 'close') throw new Error('unreachable');
    expect(recovery.issueNumber).toBe(60);
  });

  it('says so in the body when ref resolution failed instead of guessing', () => {
    const plan = planNightlyReport({
      ...RUN,
      targets: [],
      failed: [...FAILED],
      completed: [],
      openIssues: [],
    });
    if (plan.action !== 'create') throw new Error('expected create');
    expect(plan.body).toContain('unknown (ref resolution failed)');
  });
});
