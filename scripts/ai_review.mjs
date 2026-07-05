// AI pull-request reviewer, driven by the OpenAI Codex CLI authenticated with a ChatGPT
// account (OAuth), not an API key. Runs `codex exec` non-interactively as a VERIFYING
// agent: the workflow checks out the PR head with dependencies installed (npm ci +
// i18n:gen), and the prompt requires it to confirm findings against the real tree by
// reading files and running the project's own checks (tsc, targeted vitest) before
// posting the review as a sticky comment on the PR. No new npm deps: the Codex CLI is
// installed by the workflow, and the GitHub side is plain REST via global fetch.
//
// Two ways to trigger it (both wired in .github/workflows/pr-ai.yml):
//   - automatically on every push to the PR: DIFF_FILE points at a precomputed diff.
//   - on demand: an OWNER/MEMBER/COLLABORATOR comments `/review` or `/suggest <focus>`
//     on the PR. The workflow gates on the commenter's author_association, checks out
//     the PR head the same way, and posts a fresh reply comment keyed to the triggering
//     comment, separate from the sticky automatic review.
//
// AUTH (ChatGPT OAuth): run `codex login` once locally, which stores OAuth tokens in
// ~/.codex/auth.json. In CI, put that file's contents in the CODEX_AUTH_JSON repo
// secret; this script materializes it into a private CODEX_HOME for the run. Locally,
// an existing `codex login` session is used as-is. If neither is present (for example a
// fork PR that cannot read repo secrets), it prints a notice and exits 0: it is
// best-effort and NON-BLOCKING, it never gates a merge.
//
// PRIVACY: the diff and whatever the agent reads from the checkout are sent to OpenAI
// under the ChatGPT account that logged in. Whether it is used for training follows that
// account's plan and data settings (check the workspace's data controls).
//
// Env (set by the workflow):
//   CODEX_AUTH_JSON     contents of a `codex login` auth.json (repo secret); when
//                       absent, falls back to the ambient CODEX_HOME/~/.codex login,
//                       and if there is none, skips with exit 0
//   GITHUB_TOKEN        token with pull-requests:write (default Actions token)
//   GITHUB_REPOSITORY   owner/repo
//   PR_NUMBER           the pull request number
//   DIFF_FILE           path to a precomputed unified diff (automatic run); when absent,
//                       the diff is fetched from the GitHub API instead (comment run)
//   COMMENT_BODY        the triggering comment's body (comment run only)
//   COMMENT_ID          the triggering comment's id; keys its reply comment
//   COMMENT_AUTHOR      the triggering comment's author; credited in the reply
//   CODEX_MODEL         model id override; when absent the Codex CLI default is used
//   CODEX_BIN           path to the codex binary (default: `codex` on PATH)
//   CODEX_SANDBOX       codex --sandbox mode (default workspace-write). CI sets
//                       danger-full-access: the hosted runner is an ephemeral VM, and the
//                       kernel sandbox (Landlock) is not reliably available there, which
//                       used to abort every inspection command before it ran.
//   CODEX_EFFORT        model reasoning effort (default high), passed as
//                       -c model_reasoning_effort=<value>
//   BASE_SHA, HEAD_SHA  the PR's base/head commits when the workflow checked out the PR
//                       head with history: lets the agent read the FULL diff itself via
//                       git instead of relying only on the inlined (filtered, capped) one
//   REVIEW_CWD          working directory for the Codex agent (default: this script's
//                       cwd). The comment-command job sets it to a separate PR-head
//                       checkout so this script always runs from TRUSTED base-repo code
//                       while the agent inspects the (possibly fork) PR tree; a fork can
//                       then never swap this script out to read the raw secret.
//   MAX_DIFF_CHARS      cap on inlined diff chars in the prompt (default 150000);
//                       generated/vendored/binary sections are filtered out first
//                       (ai_review_diff.mjs) so the cap is spent on hand-written code
//
// A local .env is loaded best-effort (same pattern as the other scripts/ utilities), so
// a local run can keep CODEX_MODEL there. Ambient environment variables (the ones the
// workflow sets) always win: loadEnvFile never overwrites an existing process.env entry.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { capDiff, filterReviewDiff } from './ai_review_diff.mjs';
import { upsertStickyComment } from './gh_sticky_comment.mjs';
import { redactSecrets } from './redact_secrets.mjs';

try {
  process.loadEnvFile();
} catch {
  /* no .env: rely on the ambient env */
}

const MODEL = process.env.CODEX_MODEL || '';
const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const SANDBOX = process.env.CODEX_SANDBOX || 'workspace-write';
const EFFORT = process.env.CODEX_EFFORT || 'high';
const MAX_DIFF_CHARS = Number(process.env.MAX_DIFF_CHARS || 150000);
const GITHUB_API = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const BASE_SHA = process.env.BASE_SHA || '';
const HEAD_SHA = process.env.HEAD_SHA || '';
const REVIEW_CWD = process.env.REVIEW_CWD || process.cwd();

const prNumber = process.env.PR_NUMBER;
const diffFile = process.env.DIFF_FILE;
const commentBody = process.env.COMMENT_BODY;
const commentId = process.env.COMMENT_ID;
const commentAuthor = process.env.COMMENT_AUTHOR;

// Resolve auth: a CI secret becomes a throwaway CODEX_HOME (also keeps the run's
// session logs out of the real home dir); otherwise reuse the ambient `codex login`.
const ambientHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
let codexHome = ambientHome;
if (process.env.CODEX_AUTH_JSON) {
  codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
  fs.writeFileSync(path.join(codexHome, 'auth.json'), process.env.CODEX_AUTH_JSON, {
    mode: 0o600,
  });
} else if (!fs.existsSync(path.join(ambientHome, 'auth.json'))) {
  console.log(
    '[ai_review] no CODEX_AUTH_JSON and no `codex login` session; skipping AI review (non-blocking).',
  );
  process.exit(0);
}

// A comment-triggered run carries COMMENT_BODY: parse the /review or /suggest <focus>
// command out of it. The workflow only invokes this script for a comment that already
// matched one of the two commands from a trusted author association, but parse
// defensively so a direct/manual invocation with an unrecognized body no-ops instead of
// reviewing on unexpected input.
function parseCommand(body) {
  if (!body) return null;
  const m = body.trim().match(/^\/(review|suggest)\b[ \t]*([\s\S]*)$/);
  return m ? { command: m[1], focus: m[2].trim() } : null;
}
const command = parseCommand(commentBody);
if (commentBody && !command) {
  console.log('[ai_review] comment did not match /review or /suggest; skipping.');
  process.exit(0);
}

async function fetchDiffFromApi() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo || !prNumber) return '';
  const res = await fetch(`${GITHUB_API}/repos/${repo}/pulls/${prNumber}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3.diff',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    console.log(`[ai_review] could not fetch PR diff via API (HTTP ${res.status}); skipping.`);
    return '';
  }
  return res.text();
}

let diff = '';
if (diffFile) {
  try {
    diff = fs.readFileSync(diffFile, 'utf8');
  } catch {
    console.log(`[ai_review] could not read DIFF_FILE=${diffFile}; skipping.`);
    process.exit(0);
  }
} else {
  diff = await fetchDiffFromApi();
}
if (!diff.trim()) {
  console.log('[ai_review] empty diff; skipping.');
  process.exit(0);
}

// Spend the prompt budget on the hand-written change: drop generated/vendored/binary
// sections first, then cap on a file-section boundary. The agent can always read the
// full diff itself via git (BASE_SHA/HEAD_SHA below).
const filtered = filterReviewDiff(diff);
const dropped = filtered.dropped;
if (dropped.length) {
  console.log(
    `[ai_review] filtered ${dropped.length} generated/binary file section(s) from the inlined diff.`,
  );
}
const capped = capDiff(filtered.diff, MAX_DIFF_CHARS);
diff = capped.diff;
const truncated = capped.truncated;
if (!diff.trim()) {
  console.log('[ai_review] diff is all generated/binary churn; skipping the AI review.');
  process.exit(0);
}

// Codex runs as a verifying agent over a full checkout of the PR HEAD with dependencies
// installed (the workflow runs npm ci + i18n:gen first), so the prompt demands evidence:
// read the tree, run the typecheck, run the tests that cover the change, and only then
// write the review. The inlined diff below is filtered (no generated/binary churn) and
// capped; the agent reads the full diff itself via git when it needs more.
const gitDiffHint =
  BASE_SHA && HEAD_SHA
    ? `The checkout is the PR HEAD (${HEAD_SHA.slice(0, 10)}). The full, unfiltered diff is available
locally: \`git diff --no-color ${BASE_SHA} ${HEAD_SHA}\` (also \`git log ${BASE_SHA}..${HEAD_SHA}\`
for the commits). The inlined diff below omits generated/binary files and may be capped; consult
git whenever you need the complete picture.`
    : `The checkout may be the PR's BASE branch, so a file the diff itself adds may exist only in the
diff text; that is expected, never a finding.`;

const prompt = `You are a thorough, constructive senior code reviewer for World of ClaudeCraft, a TypeScript
micro-MMO and reinforcement-learning environment built on one deterministic 20 Hz simulation core
(see CLAUDE.md at the repo root for the architecture and the invariants; read it first).

You have a full checkout of the repository with npm dependencies already installed and generated
i18n artifacts in place. ${gitDiffHint}

VERIFY BEFORE YOU WRITE. This review must be grounded in what you actually ran and read, not in
what the diff looks like. Do all of the following that apply, and skip a step only when the diff
plainly cannot affect it:
1. Read the changed files IN THE TREE (not just the hunks) so you see each change in context.
2. Run the typecheck: \`npx tsc --noEmit\`. A new type error introduced by the diff is a finding.
3. Run the tests that cover the change: the test files the diff touches, plus the suites for the
   changed area (for example \`npx vitest run tests/<area>.test.ts\`). When the diff touches
   src/sim/, also run the guard \`npx vitest run tests/architecture.test.ts\`. Prefer several
   targeted files over the full suite; run broader slices only when the change is genuinely broad.
4. For a bug fix, check the fix has a test that would fail without it (read the test, do not
   assume). For new behavior, check the new code paths are exercised by some test.
5. Confirm imports, helpers, wire fields, and referenced files exist where the code says they do
   (grep the tree; check package.json for dependencies).
Budget your time: about 10 minutes of commands. Do not install packages, do not run npm ci, do not
run browser/E2E scripts (scripts/*.mjs need a live dev server), do not push, and do not modify any
tracked file; scratch output under /tmp is fine. If a command fails for environmental reasons,
say so in the verification section rather than guessing.

Invariant scope, apply LITERALLY and do not generalize beyond it: these rules constrain application
code under src/ ONLY.
- src/sim/ stays pure: no DOM/Three/render/ui/net imports; all randomness via the Rng helper, never
  Math.random / Date.now / performance.now.
- The server is authoritative; clients never decide outcomes.
- Every player-visible string rendered by the app is a t() key. Contributors add ENGLISH only;
  never ask for translations, they are release-time maintainer work.
Code under scripts/, tests/, headless/, and CI YAML under .github/ is Node TOOLING: it is
English-only, exempt from t(), and may use Math.random / Date.now / child_process freely. NEVER
raise a t(), Rng, or sim-purity finding against a file outside src/. The "no em dashes, en dashes,
or emojis" rule applies everywhere.

Severity rubric, use it strictly:
- high: a real bug, security issue, or src/ invariant violation that WILL break behavior or fail CI
  AND that you confirmed against the tree (and, where relevant, by running the check).
- medium: likely incorrect or risky, but not certain.
- low: style, naming, maintainability, or a question.
If you CANNOT verify a finding, it is AT MOST low and MUST be phrased as a one-line question, never
high or medium.

Be constructive: when the change is solid, open with one or two specific lines on what is good
(design choice, test coverage, a subtle case handled), never generic praise. Every finding names
the file and line, explains WHY it matters in one or two sentences, and proposes a concrete fix or
next step. Prefer FEW verified findings over many speculative ones; if you are not confident a
finding is real, OMIT it. Do not pad with generic advice, and do not restate the diff.

Output rules: your FINAL message is posted verbatim as the PR review comment, so it must contain
ONLY the review in GitHub-flavored Markdown, no preamble or meta commentary. Do NOT add your own
title or top-level heading (no "# ..." or "## AI review"). Structure it as:
1. A one-or-two-line overall assessment (what the change does and whether it is sound).
2. "**Verified:**" followed by a short list of the commands you ran and their outcomes (for
   example: tsc clean; vitest tests/spirit.test.ts 34 passed). If something could not run,
   say so here honestly.
3. Findings grouped under Correctness, Invariants, Tests, Nits, each tagged with its severity.
   Omit an empty group. If there are no findings, say the change looks correct in one line and
   name the strongest piece of evidence.

${truncated ? `Note: the inlined diff below was capped at ${MAX_DIFF_CHARS} characters; use git for the rest.\n\n` : ''}${
  dropped.length
    ? `Note: ${dropped.length} generated/binary file section(s) were omitted from the inlined diff (${dropped.slice(0, 8).join(', ')}${dropped.length > 8 ? ', ...' : ''}); they are derived from the real change and gated elsewhere.\n\n`
    : ''
}${
  command?.focus
    ? `The reviewer specifically asked (via a PR comment) to focus on:\n\n${command.focus}\n\nStill mention any other high-confidence finding, but prioritize this.\n\n`
    : ''
}Unified diff to review:

\`\`\`diff
${diff}
\`\`\``;

function review() {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-review-')), 'last.md');
  const args = [
    'exec',
    // Sandbox mode comes from the environment: workspace-write for a local run (the agent
    // needs to execute tsc/vitest, which write caches), danger-full-access in CI where the
    // kernel sandbox is unavailable and the runner VM is the isolation boundary.
    '--sandbox',
    SANDBOX,
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '-c',
    `model_reasoning_effort=${JSON.stringify(EFFORT)}`,
    '--output-last-message',
    outFile,
    ...(MODEL ? ['--model', MODEL] : []),
    '-',
  ];
  // Progress goes to the workflow log (stderr/stdout inherited); the review itself is
  // read back from --output-last-message so log noise can never leak into the comment.
  // The budget is generous because the agent runs the project's own checks (tsc, targeted
  // vitest) before writing; the workflow job timeout is the hard backstop.
  execFileSync(CODEX_BIN, args, {
    input: prompt,
    stdio: ['pipe', 'inherit', 'inherit'],
    // The agent's workspace: REVIEW_CWD when the workflow separates the (trusted) script
    // checkout from the (untrusted) PR tree; otherwise wherever this script runs.
    cwd: REVIEW_CWD,
    // HARDENING (#1409, ported onto the reworked bot): the diff the agent reviews is
    // attacker controlled, so the child process (and any test process it spawns, which
    // on a fork PR is that PR's code) gets a minimal allowlisted environment: never
    // GITHUB_TOKEN, never CODEX_AUTH_JSON (already materialized into CODEX_HOME/auth.json),
    // never the GITHUB_* context vars.
    env: codexChildEnv(),
    timeout: 25 * 60 * 1000,
  });
  const content = fs.readFileSync(outFile, 'utf8').trim();
  if (!content) throw new Error('Codex produced no final message');
  return content;
}

// Environment the Codex CLI child process may inherit: binary resolution (PATH), its
// home/config fallbacks, temp dirs, locale/terminal basics, and the model override.
// CODEX_HOME is set explicitly at spawn time. Everything else, notably GITHUB_TOKEN,
// CODEX_AUTH_JSON, and the GITHUB_* context vars, is withheld: the prompt embeds an
// attacker-controlled diff, so the agent must never hold credentials it could be
// injected into leaking.
const CODEX_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'NO_COLOR',
  'CI',
  'CODEX_MODEL',
];

function codexChildEnv() {
  const inherited = Object.fromEntries(
    CODEX_ENV_ALLOWLIST.filter((name) => process.env[name] !== undefined).map((name) => [
      name,
      process.env[name],
    ]),
  );
  return { ...inherited, CODEX_HOME: codexHome };
}

const modelLabel = MODEL ? `Codex, \`${MODEL}\`` : 'Codex';
let reviewText;
try {
  reviewText = review();
} catch (e) {
  // Non-blocking: a CLI/auth/model failure leaves a short note rather than failing the
  // job. Common cause: the CODEX_AUTH_JSON secret's OAuth session expired; re-run
  // `codex login` locally and refresh the secret.
  console.log(`[ai_review] review failed (non-blocking): ${e.message}`);
  reviewText = `_The automated review could not run this time (${modelLabel}). See the workflow logs._`;
}

const heading = command
  ? `## AI review (${modelLabel}, requested by @${commentAuthor ?? 'a maintainer'} via \`/${command.command}\`)`
  : `## AI review (${modelLabel})`;

const assembledBody = [
  heading,
  '',
  reviewText,
  truncated
    ? `\n<sub>The inlined diff was capped at ${MAX_DIFF_CHARS} characters; the agent had the full diff via git.</sub>`
    : '',
  '',
  '<sub>Automated and non-blocking. May be wrong; a human review still decides. Generated by the OpenAI Codex CLI under the maintainer ChatGPT account; data handling follows that account plan and settings.</sub>',
].join('\n');

// Second hardening layer (the first is the minimal child env in codexChildEnv): scrub
// credential-shaped output, plus this run's actual secret values, before the body goes
// public. Every posting path flows through this one assembled body: the automatic
// sticky review, the /review and /suggest replies, and the error-fallback text.
const { text: scrubbedBody, redactedCount } = redactSecrets(
  assembledBody,
  [process.env.GITHUB_TOKEN, process.env.CODEX_AUTH_JSON].filter(Boolean),
);
if (redactedCount > 0) {
  console.log(`[ai_review] redacted ${redactedCount} secret-like match(es) from the comment body.`);
}
const body =
  redactedCount > 0
    ? `${scrubbedBody}\n\nNote: secret-like content was redacted from this comment.`
    : scrubbedBody;

// A comment-triggered run gets its own marker keyed to the triggering comment, so a
// reply to /review or /suggest never overwrites the standing automatic review, but a
// retried workflow run for the same comment updates its own reply instead of duplicating.
const marker = command
  ? `<!-- pr-ai-review-comment-${commentId ?? prNumber} -->`
  : '<!-- pr-ai-review -->';

try {
  const result = await upsertStickyComment({ marker, body, prNumber });
  console.log(`ai review comment: ${result ?? 'skipped'}`);
} catch (e) {
  console.log(`[ai_review] could not post comment (non-blocking): ${e.message}`);
}
