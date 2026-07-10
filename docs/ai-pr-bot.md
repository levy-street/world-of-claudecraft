# PR AI assist

Informational, non-blocking GitHub Actions jobs that help review a pull request. They
live in `.github/workflows/pr-ai.yml`, separate from the CI gate (`ci.yml`), and none of
them is a required check.

## What it does

1. **Screenshots of changes** (`screenshots` job). Boots the Vite dev client headless on
   a runner (software GL via SwiftShader, no GPU needed) and, only when the diff has a
   visual change, captures PNGs of the sections it touches, then **embeds them inline** in a
   sticky PR comment (no artifact to download). The capture plan comes from the diff alone
   (`scripts/pr_screenshots.mjs` + the classifier in `scripts/pr_shot_targets.mjs`):
   - **Specific windows**: a change under `src/ui/bags*` captures the inventory window; a
     change under `src/sim/content/zones*` (or the map/terrain renderer) teleports to a
     landmark and captures the world map, each cropped to that window. The target registry
     (which paths imply which screen, and how to bring it up + clip it) lives in
     `scripts/pr_shot_targets.mjs`; add coverage with one entry there.
   - **Generic HUD**: a visual change that maps to no specific window (renderer, HUD chrome,
     CSS) captures the in-world desktop HUD, plus the mobile HUD when the change touches the
     mobile/responsive surface (`hud.mobile`, `play.html`, touch controls).
   - **Nothing**: a backend/data/i18n-only diff is not visual, so it captures no frames and
     posts no screenshots. There is no fixed tour of unrelated screens.

   Inline embedding needs a URL GitHub can fetch (artifacts are not embeddable and markdown
   does not render `data:` URIs), so `scripts/gh_image_host.mjs` uploads each PNG to a
   bot-owned orphan branch (`bot-pr-screenshots`) via the REST API and references its raw
   URL. This needs the job's `contents: write` permission. If hosting fails while
   commenting still works, the comment degrades to a note instead of broken image links;
   on a fork PR the read-only token can do neither, so the comment is skipped entirely.
2. **AI review** (`ai-review` job). Reviews the PR with the OpenAI Codex CLI,
   authenticated with a ChatGPT account via OAuth (no API key), and posts the review as a
   sticky PR comment: a short overall assessment, a "Verified" list of the commands it
   ran with their outcomes, then findings grouped into Correctness / Invariants / Tests /
   Nits with severity tags. The job checks out the PR HEAD, installs dependencies
   (`npm ci --ignore-scripts`) and generates the i18n artifacts, so Codex runs as a
   VERIFYING agent: it is required to read the changed files in the tree, run
   `npx tsc --noEmit`, and run the vitest files covering the change before writing, and
   to only report findings it confirmed (anything unverifiable is at most a low-severity
   question). The inlined prompt diff is pre-filtered (`scripts/ai_review_diff.mjs`
   drops generated i18n tables, parity goldens, lockfiles, and binary assets) and capped
   on a file boundary; the agent reads the full diff itself via `git diff BASE HEAD`.
   The reviewer is `scripts/ai_review.mjs`; the GitHub comment helper is
   `scripts/gh_sticky_comment.mjs`. No new npm dependencies in the repo: the workflow
   installs `@openai/codex` globally on the runner, and the GitHub side is Node's
   built-in `fetch` against the REST API.
3. **AI review on demand** (`ai-review-comment-verify` + `ai-review-comment-post` jobs).
   Anyone can comment `/review` or `/suggest <focus>` on a PR (for example
   `/suggest check the null handling around the new cache`) to re-run the reviewer
   whenever they want, optionally pointed at a specific concern. It is split into two
   jobs so it can be open to every commenter without ever running a fork's code under the
   secret (see "Requesting a review on demand" below): a secret-less verify job runs the
   PR's checks and emits only sanitized text, and a post job feeds that text to
   `scripts/ai_review.mjs` in no-execute mode and posts a fresh reply comment rather than
   editing the standing sticky review, so a one-off question does not overwrite it.

## Enabling the AI review

The screenshots job needs no configuration. The AI review (automatic and on-demand) is
opt-in and authenticates with a ChatGPT account through OAuth, not an API key:

- On any machine, install the Codex CLI (`npm install -g @openai/codex`) and run
  `codex login`. Complete the browser OAuth flow with the ChatGPT account whose plan
  should pay for the reviews. This writes `~/.codex/auth.json` (OAuth access + refresh
  tokens).
- Add a repository **secret** `CODEX_AUTH_JSON` (Settings -> Secrets and variables ->
  Actions) containing that file's exact contents. The workflow materializes it into a
  throwaway `CODEX_HOME` for each run. Without the secret the `ai-review` and
  `ai-review-comment` jobs run but no-op and exit green, so the workflow is safe to merge
  before the secret exists. Treat the secret like a password: it is a login to the
  ChatGPT account.
- If reviews start failing with an auth error in the workflow logs, the OAuth session
  has expired or been revoked: re-run `codex login` and refresh the secret.
- Optional repository **variable** `CODEX_MODEL` to override the model; when unset, the
  Codex CLI's own default model is used. Swapping the model is a one-line change with no
  workflow edit.
- For a **local run** of `node scripts/ai_review.mjs`, your normal `codex login` session
  is used directly (no secret needed), and `CODEX_MODEL` can live in the repo-root
  `.env` (see `.env.example`); the script loads it best-effort. Variables already set in
  the environment always take precedence, so the CI values are never overridden.
- Reviews consume the ChatGPT plan's Codex usage quota; a burst of PR pushes can hit the
  plan's rate limits, in which case the job posts the non-blocking fallback note instead.

## Requesting a review on demand

Comment `/review` on a PR to re-run the reviewer over the current state of the PR, or
`/suggest <focus>` to ask it to prioritize something specific (the rest of the comment
after the command is passed to the model as the thing to focus on; it still mentions
other high-confidence findings). There is no author_association gate: any commenter can
trigger it, including a first-time contributor on their own fork PR. This is a deliberate
choice so every contributor can self-serve a review without waiting on a maintainer.

That is safe to leave open to everyone because the command is split into two jobs so a
fork's code never runs in the job that holds the secret:

- **`ai-review-comment-verify`** has NO secret. It checks out the PR head, installs deps
  with `npm ci --ignore-scripts`, generates i18n artifacts, computes the diff, and runs
  the project's own checks (`tsc --noEmit`, plus the vitest files the diff touches and the
  sim guard when `src/sim/` changed). This is the only place the PR's code executes, and
  because the job holds no token there is nothing for that code to steal (secrets are
  injected only into steps that reference them, and the check steps reference none). It
  uploads only sanitized TEXT (the diff and the check output) as a workflow artifact.
- **`ai-review-comment-post`** holds `CODEX_AUTH_JSON` but never checks out or runs the
  PR's code. It checks out only the trusted base-repo tooling, downloads the text
  artifact, and runs `scripts/ai_review.mjs` in no-execute mode (`REVIEW_NO_EXECUTE=1`)
  from an empty working directory under a `read-only` sandbox, with a prompt that forbids
  running commands or reading files. Codex reviews the diff and the pre-computed check
  output as text-as-data and posts the reply.

The only attacker-controlled input reaching the secret-bearing job is that text, so the
remaining surface is prompt injection (a diff that tries to talk the model into leaking
the token), contained by the read-only sandbox, the minimal child environment that never
exposes `GITHUB_TOKEN` or the raw `CODEX_AUTH_JSON` (`codexChildEnv`), and the output
secret-redaction (`redactSecrets`) before anything is posted. Defense in depth worth
adding: point `CODEX_AUTH_JSON` at a dedicated throwaway ChatGPT account rather than a
personal one, so a leak is contained. If the token is ever suspected leaked, refresh it
(see the setup note).

## Privacy: read before enabling on private code

The PR diff (and whatever the agent reads from the checkout) is sent to OpenAI under the
ChatGPT account that ran `codex login`. Whether that data can be used for training
follows the account's plan and data-control settings, so review those settings on the
account behind `CODEX_AUTH_JSON` before enabling this on code you cannot disclose.

The screenshots job sends nothing to a third party; it only renders your own client.

## Behavior on fork PRs

Pull requests from forks get a read-only `GITHUB_TOKEN` and cannot read repo secrets on
the `pull_request` trigger. Both comment steps and the automatic AI review degrade to a
no-op there (the scripts detect the missing write access / auth and skip), so the workflow
never errors on a fork PR. Screenshots are still captured, but a read-only token can
neither host the images nor post a comment at all, so on a fork PR the screenshot comment
is skipped entirely (the frames exist only in the job log's capture output).

The on-demand `/review` and `/suggest` comment trigger is different: `issue_comment`
always runs with full repo secrets, regardless of whether the PR is from a fork. It is
intentionally ungated (any commenter, any PR, including a fork PR's own author), and it is
split so the secret never meets the fork's code: the `-verify` job runs that code with no
secret, and the `-post` job that holds the secret only reviews the resulting text and
never runs the PR's code. See "Requesting a review on demand" above for the full split and
its remaining prompt-injection surface.

## Running the screenshot capture locally

```sh
npm run dev                       # serves the client on :5173
git diff --no-color origin/main > pr.diff   # the change to classify
BROWSER_PATH=/path/to/chrome DIFF_FILE=pr.diff \
  node scripts/pr_screenshots.mjs # writes PNGs into pr-shots/ (none if not visual)
```

The capture is diff-driven: with no `DIFF_FILE` (or a diff that changes nothing visual)
it captures nothing. `BROWSER_PATH` is only needed if no Chrome/Edge/Chromium is on a
standard path (see `scripts/browser_path.mjs`), and only when there is something to shoot.
