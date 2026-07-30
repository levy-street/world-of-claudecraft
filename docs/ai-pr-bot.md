# PR AI assist

`.github/workflows/pr-ai.yml` contains informational, non-blocking pull-request helpers.
They do not replace the required checks in `ci.yml`.

## Screenshot assist

The `screenshots` job starts the Vite client and captures only surfaces implied by the
diff. A window-specific change opens that window, a generic visual change captures the
HUD, and a non-visual change captures nothing. Mobile surfaces add a phone-sized capture.

`scripts/pr_shot_targets.mjs` owns path-to-screen mapping. Captures are written by
`scripts/pr_screenshots.mjs`, hosted on the bot-owned `bot-pr-screenshots` branch by
`scripts/gh_image_host.mjs`, and embedded in a sticky comment. The job degrades to no
comment when a fork token cannot write.

## Codex review assist

The `codex-review` job performs static review through
[`openai/codex-action@v1`](https://github.com/openai/codex-action). It never runs PR
code, tests, package managers, hooks, builds, interpreters, or generated commands.
Normal CI remains authoritative for execution.

The workflow has three trust zones:

1. A trusted checkout at the PR base supplies the review script, prompt, schema, and
   canonical policy files.
2. The PR head lives at `review/untrusted/pr` and is treated as data. Its `AGENTS.md`,
   `CLAUDE.md`, `.codex`, `.agents`, `.claude`, documentation, commits, media, and Git
   configuration never become runtime instructions.
3. A fresh posting job receives structured review output and a GitHub write token, but
   no OpenAI credential. It validates the schema again, bounds every field, neutralizes
   model-controlled Markdown and HTML, redacts credential shapes, and posts the comment.

The action uses an empty `CODEX_HOME`, `permission-profile: ":read-only"`,
`safety-strategy: "drop-sudo"`, no project hooks or rules, and no direct network access.
It is the final step on its runner. These controls follow the
[official action security guidance](https://github.com/openai/codex-action/blob/main/docs/security.md).

## Configure the reviewer

Add one repository Actions secret:

- `OPENAI_API_KEY`: an OpenAI API key used by the action's secure Responses API proxy.

Never store `~/.codex/auth.json`, ChatGPT OAuth tokens, or a serialized Codex login in
GitHub Actions. An `auth.json` is a password-equivalent user credential and is not an
appropriate public-repository CI secret.

Optional repository Actions variables:

- `CODEX_REVIEW_MODEL`: explicit review model. Leave empty for the current action default.
- `CODEX_REVIEW_EFFORT`: explicit reasoning effort. Leave empty for the model default.
- `CODEX_CLI_VERSION`: CLI version used by the action. Pin when reproducibility is more
  important than automatically receiving the latest action-compatible CLI. The selected
  version must be `0.138.0` or newer because the workflow uses permission profiles.

Model and effort are variables rather than workflow assumptions, so Sol, Terra, Luna,
and future models can be selected without changing review architecture. API reviews use
the OpenAI API project's billing and data controls, not a ChatGPT plan quota. Review the
[OpenAI API data controls](https://platform.openai.com/docs/guides/your-data) before
enabling review for private code.

If the API key is absent or the action fails, the posting job emits only a non-blocking
failure note. It never publishes partial or malformed model output.

The PR that first adds or changes the trusted reviewer harness does not run its own head
copy. If the base lacks the harness, the job skips cleanly and activates after merge.

## Automatic and requested reviews

Automatic Codex review runs only for a same-repository pull request. The action also
enforces its own trigger-user access check.

For an on-demand review, an OWNER, MEMBER, or COLLABORATOR can comment:

```text
/review
/suggest inspect the cache invalidation path
```

The resolver accepts only the exact `/review` command or `/suggest` with a nonempty
focus. It validates the current PR through the GitHub API, bounds the focus, strips
hidden comments and control characters, and rechecks the author association. The action
still checks repository write access. A requested review can inspect a fork safely
because the fork checkout remains static untrusted data and nothing from it executes.

Automatic output updates one sticky comment. Each requested run uses a marker tied to
the triggering comment so it does not replace the standing review.

## Review output

`.github/codex/review-output.schema.json` restricts the response to an assessment,
concise summary, and at most 20 findings with severity, category, source location,
message, and recommendation. `scripts/post_ai_review.mjs` independently validates that
shape before rendering fixed Markdown.

The prompt requires findings to be introduced or exposed by the PR, concrete, and
supported by static evidence. It explicitly forbids claiming that tests ran. This keeps
review findings separate from the CI evidence reviewers should consult beside them.

For an interactive local review, use `$woc-review-pr`. Reading and drafting are the
default; posting still requires an explicit user request.

## Local screenshot capture

```sh
npm run dev
git diff --no-color <release-base> > pr.diff
BROWSER_PATH=/path/to/chrome DIFF_FILE=pr.diff node scripts/pr_screenshots.mjs
```

`BROWSER_PATH` is needed only when no Chrome, Edge, or Chromium binary is on a standard
path and the diff contains a visual change.
