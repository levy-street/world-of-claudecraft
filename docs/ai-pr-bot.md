# PR AI assist

Two informational, non-blocking GitHub Actions jobs that help review a pull request.
They live in `.github/workflows/pr-ai.yml`, separate from the CI gate (`ci.yml`), and
neither is a required check.

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

## Enabling the AI review

The screenshots job needs no configuration. The AI review is opt-in:

- Add a repository **secret** `OPENROUTER_API_KEY` (Settings -> Secrets and variables ->
  Actions). Get a key at https://openrouter.ai. Without it the `ai-review` job runs but
  no-ops and exits green, so the workflow is safe to merge before the key exists.
- Optional repository **variable** `OPENROUTER_MODEL` to override the model. The default is
  `openrouter/owl-alpha`, a free stealth model (1M context, tool use). It is free **for
  now**: an unnamed provider can change pricing or pull it at any time, so treat it as a
  prototype default and switch the variable when it goes away. Swapping the model is a
  one-line change with no workflow edit.

## Privacy: read before enabling on private code

The free `owl-alpha` tier **logs prompts to improve the model**, which means the PR diff
you send is retained by a third party. Do not enable the AI review on code you cannot
disclose while it points at owl-alpha. Safer options:

- Point `OPENROUTER_MODEL` at a paid / non-logging OpenRouter model.
- Run a local model (the same script pattern works against any OpenAI-compatible endpoint;
  change `ENDPOINT` in `scripts/ai_review.mjs`).

The screenshots job sends nothing to a third party; it only renders your own client.

## Behavior on fork PRs

Pull requests from forks get a read-only `GITHUB_TOKEN` and cannot read repo secrets. Both
comment steps and the AI review degrade to a no-op there (the scripts detect the missing
write access / key and skip), so the workflow never errors on a fork PR. Screenshots are
still captured and uploaded as an artifact.

## Running the screenshot tour locally

```sh
npm run dev                       # serves the client on :5173
BROWSER_PATH=/path/to/chrome \
  node scripts/pr_screenshots.mjs # writes PNGs into pr-shots/
```

`BROWSER_PATH` is only needed if no Chrome/Edge/Chromium is on a standard path
(see `scripts/browser_path.mjs`).
