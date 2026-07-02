# World of ClaudeCraft - v0.19.0 Release Notes

**Release:** v0.19.0
**Date:** 2026-07-02
**Previous release:** v0.18.0

v0.19.0 is a focused release-operations update for the pull request assistance
pipeline. It improves how the optional AI reviewer is requested, documents the
privacy and fork-safety model, and keeps screenshot automation on explicit PR
or manual workflow paths.

## Highlights

- **On-demand AI PR reviews**: repository owners, members, and collaborators can
  comment `/review` or `/suggest <focus>` on a pull request to request a fresh
  AI review of the current diff.
- **Safer automation boundaries**: screenshot generation is limited to
  `pull_request` and manual `workflow_dispatch` runs, so it does not spend
  runner time on unrelated workflow triggers.
- **Expanded operator documentation**: `docs/ai-pr-bot.md` now explains setup,
  model configuration, fork behavior, prompt-logging privacy considerations, and
  local screenshot-tour usage.

## Pull Request Assistance

- The AI reviewer now supports two modes:
  - automatic review on the normal pull request workflow when the repository has
    the optional `OPENROUTER_API_KEY` secret configured;
  - collaborator-triggered review from PR comments with `/review` or
    `/suggest <focus>`.
- One-off `/review` and `/suggest` responses are posted as fresh PR comments
  instead of replacing the standing sticky AI review summary.
- Comment-triggered review reads PR diffs through the GitHub API rather than
  checking out or executing contributor code.
- The comment trigger is gated by the comment author's association with the
  upstream repository, so fork authors cannot spend the repository's configured
  model budget by self-triggering reviews.
- The reviewer script handles direct GitHub diff fetching for comment-triggered
  runs and keeps missing-key / unavailable-permission cases as green no-ops.

## Screenshots & CI

- The screenshot job is constrained to pull request and manual workflow
  dispatch events.
- Existing screenshot capture behavior remains unchanged for PRs: the workflow
  still renders relevant screens headlessly, uploads the `pr-screenshots`
  artifact, and links it from a sticky PR comment.
- The AI review and screenshot workflow remains separate from the required CI
  gate, so these assistive jobs are informational rather than merge-blocking.

## Documentation

- `docs/ai-pr-bot.md` now documents:
  - the screenshot and AI-review jobs;
  - how to configure `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`;
  - how `/review` and `/suggest <focus>` work;
  - privacy tradeoffs for OpenRouter models that may log prompts;
  - how fork PRs degrade safely when secrets or write permissions are missing;
  - how to run the screenshot tour locally with `scripts/pr_screenshots.mjs`.

## Notes For Maintainers

- The default AI review model is still configurable without editing workflow
  YAML. If the current default becomes unavailable, update the repository
  `OPENROUTER_MODEL` variable.
- Free third-party AI models can retain submitted prompts. Keep the reviewer
  disabled or point it at a non-logging model for code that cannot be disclosed.
- These notes describe the current `release/v0.19.0` branch state and can be
  extended before ship if additional pull requests are cherry-picked into the
  release.
