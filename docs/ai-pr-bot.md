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
3. **AI review on demand** (`ai-review-comment` job). An OWNER, MEMBER, or COLLABORATOR
   of this repo can comment `/review` or `/suggest <focus>` on a PR (for example
   `/suggest check the null handling around the new cache`) to re-run the same reviewer
   whenever they want, optionally pointed at a specific concern. It runs the same
   `scripts/ai_review.mjs` with the same PR-head checkout and verification setup, and
   posts its answer as a fresh reply comment rather than editing the standing sticky
   review, so a one-off question does not overwrite it.

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
other high-confidence findings). Only comments from an OWNER, MEMBER, or COLLABORATOR of
this repo trigger it, checked against this repo regardless of whose PR it is, so a first-
time contributor cannot self-trigger it on their own fork PR by commenting on it.

Know what you are opting into on a FORK PR: unlike the old diff-only reviewer, this job
checks out the fork's code and exercises it (the i18n generation step, and whatever tests
the agent runs), in a job that holds the `CODEX_AUTH_JSON` secret. The mitigations are
real but not absolute: the reviewer scripts themselves run from a TRUSTED default-branch
checkout while the PR head sits in a separate `pr/` tree (so a fork cannot replace
`ai_review.mjs` and read the secret from inside the secret-holding step),
`npm ci --ignore-scripts` keeps third-party install hooks from running, the raw secret is
scrubbed from the agent's child environment (only the materialized `CODEX_HOME/auth.json`
exists, in a throwaway temp dir), and the `GITHUB_TOKEN` carries only `contents: read`
plus `pull-requests: write`. Skim a fork PR's diff for anything that reads credentials or
phones home before typing `/review` on it; for same-repo PRs there is no new exposure.

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
always runs with full repo secrets, regardless of whether the PR is from a fork, and it
checks out and exercises the PR's own code so the agent can verify it. That combination
is gated on the commenter's `author_association` with this repo, not the PR's origin,
and is a deliberate maintainer opt-in with documented mitigations (see "Requesting a
review on demand" above).

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
