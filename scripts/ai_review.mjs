// Minimal AI pull-request reviewer, driven by the OpenAI Codex CLI authenticated with a
// ChatGPT account (OAuth), not an API key. Runs `codex exec` non-interactively over the
// PR diff (read-only sandbox, no network for the agent) and posts the review as a sticky
// comment on the PR. No new npm deps: the Codex CLI is installed by the workflow, and
// the GitHub side is plain REST via global fetch.
//
// Two ways to trigger it (both wired in .github/workflows/pr-ai.yml):
//   - automatically on every push to the PR: DIFF_FILE points at a precomputed diff.
//   - on demand: an OWNER/MEMBER/COLLABORATOR comments `/review` or `/suggest <focus>`
//     on the PR. The workflow gates on the commenter's author_association; this script
//     fetches the diff itself via the GitHub API (no DIFF_FILE, no checkout of the PR
//     head) and posts a fresh reply comment keyed to the triggering comment, separate
//     from the sticky automatic review.
//
// AUTH (ChatGPT OAuth): run `codex login` once locally, which stores OAuth tokens in
// ~/.codex/auth.json. In CI, put that file's contents in the CODEX_AUTH_JSON repo
// secret; this script materializes it into a private CODEX_HOME for the run. Locally,
// an existing `codex login` session is used as-is. If neither is present (for example a
// fork PR that cannot read repo secrets), it prints a notice and exits 0: it is
// best-effort and NON-BLOCKING, it never gates a merge.
//
// PRIVACY: the diff is sent to OpenAI under the ChatGPT account that logged in. Whether
// it is used for training follows that account's plan and data settings (check the
// workspace's data controls); the agent itself runs sandboxed read-only with network
// disabled, so it cannot exfiltrate beyond the model request itself.
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
//   MAX_DIFF_CHARS      cap on diff chars sent to the model (default 60000)
//
// A local .env is loaded best-effort (same pattern as the other scripts/ utilities), so
// a local run can keep CODEX_MODEL there. Ambient environment variables (the ones the
// workflow sets) always win: loadEnvFile never overwrites an existing process.env entry.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { upsertStickyComment } from './gh_sticky_comment.mjs';

try {
  process.loadEnvFile();
} catch {
  /* no .env: rely on the ambient env */
}

const MODEL = process.env.CODEX_MODEL || '';
const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const MAX_DIFF_CHARS = Number(process.env.MAX_DIFF_CHARS || 60000);
const GITHUB_API = process.env.GITHUB_API_URL ?? 'https://api.github.com';

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

let truncated = false;
if (diff.length > MAX_DIFF_CHARS) {
  diff = diff.slice(0, MAX_DIFF_CHARS);
  truncated = true;
}

// Unlike the old single-shot HTTP reviewer, Codex runs as an agent with READ-ONLY access
// to the checkout, so instead of shipping it file lists to stop hallucinated "missing
// import" findings, we tell it to verify against the working tree itself. One caveat is
// preserved from the old design: on a comment-triggered run the checkout is the BASE
// branch (no PR-head checkout, intentionally, see .github/workflows/pr-ai.yml), so a
// file the PR itself adds exists only inside the diff text.
const prompt = `You are a precise, skeptical senior code reviewer for World of ClaudeCraft, a TypeScript
micro-MMO and reinforcement-learning environment built on one deterministic 20 Hz simulation core.

Review the unified diff below. You have READ-ONLY access to a checkout of the repository; before
flagging that an import, helper, or referenced file is missing or wrong, verify it against the
working tree (and package.json for dependencies). Use lightweight inspection only: file reads,
focused searches, and short static checks. Do not install packages, run network commands, run full
builds, run full test suites, or run long typecheck commands. Note: the checkout may be the PR's
BASE branch, so a file the diff itself adds may exist only in the diff text; that is expected,
never a finding. When you cannot verify something, ask a one-line question at LOW severity instead
of asserting a problem. Do not modify anything; produce a review only.

Invariant scope, apply LITERALLY and do not generalize beyond it: these rules constrain application
code under src/ ONLY.
- src/sim/ stays pure: no DOM/Three/render/ui/net imports; all randomness via the Rng helper, never
  Math.random / Date.now / performance.now.
- The server is authoritative; clients never decide outcomes.
- Every player-visible string rendered by the app is a t() key.
Code under scripts/, tests/, headless/, and CI YAML under .github/ is Node TOOLING: it is
English-only, exempt from t(), and may use Math.random / Date.now / child_process freely. NEVER
raise a t(), Rng, or sim-purity finding against a file outside src/. The "no em dashes, en dashes,
or emojis" rule applies everywhere.

Severity rubric, use it strictly:
- high: a real bug, security issue, or src/ invariant violation that WILL break behavior or fail CI
  AND that you confirmed from the diff plus the working tree.
- medium: likely incorrect or risky, but not certain.
- low: style, naming, maintainability, or a question.
If you CANNOT verify a finding, it is AT MOST low and MUST be phrased as a one-line question, never
high or medium.

Output rules: your FINAL message is posted verbatim as the PR review comment, so it must contain
ONLY the review in GitHub-flavored Markdown, no preamble or meta commentary. Prefer FEW
high-confidence findings over many; if you are not confident a finding is real, OMIT it. Do not pad
with generic advice. Only mention missing tests when the diff changes src/ or server logic that the
repo actually tests. Do NOT add your own title or top-level heading (no "# ..." or "## AI review");
start directly with the first group. Group findings under Correctness, Invariants, Tests, Nits and
tag each with its severity. If the change looks fine, say so in one line. Do not restate the diff.

${truncated ? `Note: the diff was truncated to the first ${MAX_DIFF_CHARS} characters.\n\n` : ''}${
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
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
    '--output-last-message',
    outFile,
    ...(MODEL ? ['--model', MODEL] : []),
    '-',
  ];
  // Progress goes to the workflow log (stderr/stdout inherited); the review itself is
  // read back from --output-last-message so log noise can never leak into the comment.
  execFileSync(CODEX_BIN, args, {
    input: prompt,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, CODEX_HOME: codexHome },
    timeout: 12 * 60 * 1000,
  });
  const content = fs.readFileSync(outFile, 'utf8').trim();
  if (!content) throw new Error('Codex produced no final message');
  return content;
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

const body = [
  heading,
  '',
  reviewText,
  truncated ? `\n<sub>Diff truncated to the first ${MAX_DIFF_CHARS} characters.</sub>` : '',
  '',
  '<sub>Automated and non-blocking. May be wrong; a human review still decides. Generated by the OpenAI Codex CLI under the maintainer ChatGPT account; data handling follows that account plan and settings.</sub>',
].join('\n');

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
