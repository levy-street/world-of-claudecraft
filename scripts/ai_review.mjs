// Minimal AI pull-request reviewer. Sends the PR diff to an OpenRouter model (default:
// the free openrouter/owl-alpha stealth model) and posts the review as a single sticky
// comment on the PR. No new npm deps: Node 18+ global fetch + the GitHub REST API.
//
// It is best-effort and NON-BLOCKING: if OPENROUTER_API_KEY is absent (for example a
// fork PR that cannot read repo secrets) it prints a notice and exits 0, so it never
// gates a merge. The model is swappable via OPENROUTER_MODEL with zero workflow edits,
// which matters because owl-alpha is a free stealth model that can disappear at any time.
//
// PRIVACY: the free owl-alpha tier logs prompts to improve the model, so the diff you
// send is retained by a third party. Point OPENROUTER_MODEL at a non-logging / paid
// model (or a self-hosted one) before using this on code you cannot disclose.
//
// Env (set by the workflow):
//   OPENROUTER_API_KEY  OpenRouter key (repo secret); absent -> skip, exit 0
//   GITHUB_TOKEN        token with pull-requests:write (default Actions token)
//   GITHUB_REPOSITORY   owner/repo
//   PR_NUMBER           the pull request number
//   DIFF_FILE           path to a unified diff to review
//   OPENROUTER_MODEL    model id (default openrouter/owl-alpha)
//   MAX_DIFF_CHARS      cap on diff chars sent to the model (default 60000)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { upsertStickyComment } from './gh_sticky_comment.mjs';

const MARKER = '<!-- pr-ai-review -->';
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/owl-alpha';
const MAX_DIFF_CHARS = Number(process.env.MAX_DIFF_CHARS || 60000);
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const key = process.env.OPENROUTER_API_KEY;
const prNumber = process.env.PR_NUMBER;
const diffFile = process.env.DIFF_FILE;

if (!key) {
  console.log('[ai_review] OPENROUTER_API_KEY not set; skipping AI review (non-blocking).');
  process.exit(0);
}

let diff = '';
try {
  diff = fs.readFileSync(diffFile, 'utf8');
} catch {
  console.log(`[ai_review] could not read DIFF_FILE=${diffFile}; skipping.`);
  process.exit(0);
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

// Give the model the file list of the directories this diff touches, so it stops
// hallucinating that existing imports/helpers are "missing" (its top false positive).
// Best-effort: empty string when not in a git checkout.
function listTouchedDirs(d) {
  const files = [...d.matchAll(/^\+\+\+ b\/(.+)$/gm)]
    .map((m) => m[1])
    .filter((p) => p !== '/dev/null');
  // Map each changed file to its parent dir; drop the repo root so a root-level file
  // (e.g. .gitignore) does not expand `git ls-files` to the whole tree.
  const dirs = [
    ...new Set(
      files
        .map((f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.'))
        .filter((d) => d !== '.'),
    ),
  ];
  if (!dirs.length) return '';
  try {
    const out = execFileSync('git', ['ls-files', '--', ...dirs], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
    // Safety cap so a large touched directory cannot blow up the prompt.
    const lines = out.split('\n');
    return lines.length > 500
      ? `${lines.slice(0, 500).join('\n')}\n... (${lines.length - 500} more)`
      : out;
  } catch {
    return '';
  }
}
const repoFiles = listTouchedDirs(diff);

// Declared dependency names, so the model does not flag an imported package as "missing
// from package.json" (a false positive it cannot otherwise verify from the diff).
function declaredDeps() {
  try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
      .sort()
      .join(', ');
  } catch {
    return '';
  }
}
const deps = declaredDeps();

const system = `You are a precise, skeptical senior code reviewer for World of ClaudeCraft, a TypeScript
micro-MMO and reinforcement-learning environment built on one deterministic 20 Hz simulation core.

You see ONLY a unified diff plus a list of files that ALREADY EXIST in the repository. Everything
not shown in the diff already exists and works. Do NOT flag an imported module, helper, or
referenced file as "missing" or "not in the diff": that is expected. If an import resolves to a path
in the existing-files list, it is fine. You are also given the list of declared package.json
dependencies; an import of any listed package is available, so NEVER say a dependency is missing
from package.json. When you cannot verify something from what you were given, ask a one-line
question at LOW severity instead of asserting a problem.

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
  AND that you can confirm from the diff alone.
- medium: likely incorrect or risky, but not certain.
- low: style, naming, maintainability, or a question.
If you CANNOT verify a finding from the diff and the provided context, it is AT MOST low and MUST be
phrased as a one-line question, never high or medium. Do not guess at repository state you were not
given (CI pins, other files' contents): if you did not see it, do not assert it.

Output rules: prefer FEW high-confidence findings over many. If you are not confident a finding is
real, OMIT it. Do not pad with generic advice. Only mention missing tests when the diff changes src/
or server logic that the repo actually tests. Do NOT add your own title or top-level heading (no
"# ..." or "## AI review"); start directly with the first group. Group findings under Correctness,
Invariants, Tests, Nits and tag each with its severity. If the change looks fine, say so in one line.
Do not restate the diff. Output GitHub-flavored Markdown.`;

const user = [
  truncated ? `Note: the diff was truncated to the first ${MAX_DIFF_CHARS} characters.\n` : '',
  repoFiles
    ? `Files that already exist in the directories this diff touches (so you can resolve imports and must NOT flag these as missing):\n\n\`\`\`\n${repoFiles}\n\`\`\`\n`
    : '',
  deps
    ? `Declared package.json dependencies (names only); any import of these is available, do NOT flag it as missing:\n\n${deps}\n`
    : '',
  `Unified diff to review:\n\n\`\`\`diff\n${diff}\n\`\`\``,
]
  .filter(Boolean)
  .join('\n');

async function review() {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'WoCC PR review',
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content)
    throw new Error(`OpenRouter returned no content: ${JSON.stringify(data).slice(0, 500)}`);
  return content;
}

let reviewText;
try {
  reviewText = await review();
} catch (e) {
  // Non-blocking: a model/API failure leaves a short note rather than failing the job.
  console.log(`[ai_review] review failed (non-blocking): ${e.message}`);
  reviewText = `_The automated review could not run this time (\`${MODEL}\`). See the workflow logs._`;
}

const body = [
  `## AI review (\`${MODEL}\`)`,
  '',
  reviewText,
  truncated ? `\n<sub>Diff truncated to the first ${MAX_DIFF_CHARS} characters.</sub>` : '',
  '',
  '<sub>Automated and non-blocking. May be wrong; a human review still decides. The free owl-alpha tier logs prompts, so the diff is retained by a third party.</sub>',
].join('\n');

try {
  const result = await upsertStickyComment({ marker: MARKER, body, prNumber });
  console.log(`ai review comment: ${result ?? 'skipped'}`);
} catch (e) {
  console.log(`[ai_review] could not post comment (non-blocking): ${e.message}`);
}
