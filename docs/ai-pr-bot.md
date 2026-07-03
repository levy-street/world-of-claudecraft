# PR AI assist

Informational, non-blocking GitHub Actions jobs that help review a pull request. They
live in `.github/workflows/pr-ai.yml`, separate from the CI gate (`ci.yml`), and none of
them is a required check.

## What it does

1. **Screenshots of changes** (`screenshots` job). Boots the Vite dev client headless on
   a runner (software GL via SwiftShader, no GPU needed) and captures PNGs of the relevant
   screens. The frames are uploaded as the `pr-screenshots` artifact and linked from a
   sticky PR comment. Two modes (`scripts/pr_screenshots.mjs`):
   - **Change-aware** (when a diff is available): it maps the changed paths to the screens
     they imply and shoots exactly those, cropped to the relevant region. A change under
     `src/ui/bags*` captures the inventory window; a change under `src/sim/content/zones*`
     (or the map/terrain renderer) teleports to a landmark and captures the world map. The
     target registry (which paths imply which screen, and how to bring it up + clip it)
     lives in `scripts/pr_shot_targets.mjs`; add coverage with one entry there.
   - **Fixed tour** (no diff or no matched target): a consistent baseline, character
     select, desktop HUD, mobile HUD. Keep all recipes offline and quick.
2. **AI review** (`ai-review` job). Sends the PR diff to an OpenRouter model and posts a
   short review as a sticky PR comment, grouped into Correctness / Invariants / Tests /
   Nits with severity tags. The reviewer is `scripts/ai_review.mjs`; the GitHub comment
   helper is `scripts/gh_sticky_comment.mjs`. No new npm dependencies: it uses Node's
   built-in `fetch` and the GitHub REST API.
3. **AI review on demand** (`ai-review-comment` job). An OWNER, MEMBER, or COLLABORATOR
   of this repo can comment `/review` or `/suggest <focus>` on a PR (for example
   `/suggest check the null handling around the new cache`) to re-run the same reviewer
   whenever they want, optionally pointed at a specific concern. It runs the same
   `scripts/ai_review.mjs`, fetching the diff itself from the GitHub API instead of a
   precomputed file, and posts its answer as a fresh reply comment rather than editing
   the standing sticky review, so a one-off question does not overwrite it.

## Enabling the AI review

The screenshots job needs no configuration. The AI review (automatic and on-demand) is
opt-in:

- Add a repository **secret** `OPENROUTER_API_KEY` (Settings -> Secrets and variables ->
  Actions). Get a key at https://openrouter.ai. Without it the `ai-review` and
  `ai-review-comment` jobs run but no-op and exit green, so the workflow is safe to merge
  before the key exists.
- Optional repository **variable** `OPENROUTER_MODEL` to override the model. The default is
  `nvidia/nemotron-3-ultra-550b-a55b:free` (NVIDIA Nemotron 3 Ultra). It is free **for
  now**: OpenRouter free tiers can change pricing, rate limits, or be pulled at any time
  (the previous default, `openrouter/owl-alpha`, was pulled), so treat this as a
  prototype default and switch the variable when it goes away. Swapping the model is a
  one-line change with no workflow edit.

## Requesting a review on demand

Comment `/review` on a PR to re-run the reviewer over the current diff, or
`/suggest <focus>` to ask it to prioritize something specific (the rest of the comment
after the command is passed to the model as the thing to focus on; it still mentions
other high-confidence findings). Only comments from an OWNER, MEMBER, or COLLABORATOR of
this repo trigger it, checked against this repo regardless of whose PR it is, so a first-
time contributor cannot self-trigger it on their own fork PR by commenting on it. This
gate exists because, unlike the automatic `pull_request`-triggered job, a comment trigger
always runs with this repo's secrets available, even against a fork PR: the job never
checks out or executes the PR's own code, it only reads the diff as text through the
GitHub API, but the trust gate keeps it from being invoked, and the OpenRouter budget
spent, by an untrusted commenter.

## Privacy: read before enabling on private code

Free OpenRouter models commonly **log prompts to improve the model**, which means the PR
diff you send may be retained by a third party; check the model's Data Policy tab on
openrouter.ai. Do not enable the AI review on code you cannot disclose while it points at
a free model. Safer options:

- Point `OPENROUTER_MODEL` at a paid / non-logging OpenRouter model.
- Run a local model (the same script pattern works against any OpenAI-compatible endpoint;
  change `ENDPOINT` in `scripts/ai_review.mjs`).

The screenshots job sends nothing to a third party; it only renders your own client.

## Behavior on fork PRs

Pull requests from forks get a read-only `GITHUB_TOKEN` and cannot read repo secrets on
the `pull_request` trigger. Both comment steps and the automatic AI review degrade to a
no-op there (the scripts detect the missing write access / key and skip), so the workflow
never errors on a fork PR. Screenshots are still captured and uploaded as an artifact.

The on-demand `/review` and `/suggest` comment trigger is different: `issue_comment`
always runs with full repo secrets, regardless of whether the PR is from a fork. It is
still safe against a fork PR because the job never checks out or runs the PR's own code,
and because it is gated on the commenter's `author_association` with this repo, not with
the PR's origin (see "Requesting a review on demand" above).

## Running the screenshot tour locally

```sh
npm run dev                       # serves the client on :5173
BROWSER_PATH=/path/to/chrome \
  node scripts/pr_screenshots.mjs # writes PNGs into pr-shots/
```

`BROWSER_PATH` is only needed if no Chrome/Edge/Chromium is on a standard path
(see `scripts/browser_path.mjs`).
