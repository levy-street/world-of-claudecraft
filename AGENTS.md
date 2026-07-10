# Codex entry point

This file owns Codex runtime behavior for World of ClaudeCraft. The root and
directory-local `CLAUDE.md` files remain canonical for repository facts, architecture,
hard invariants, conventions, commands, and the QA contract. Claude-specific model,
memory, Workflow, slash-command, and agent-runtime instructions do not apply to Codex.
Do not edit or replace the Claude setup unless the user explicitly asks for that work.

## Start safely

1. Run `git status --short` before edits and preserve unrelated user work.
2. Confirm the requested base branch. Use an isolated worktree when another session may
   share the checkout, and keep work off the shared branch.
3. Read the root `CLAUDE.md` in full. Before reading or changing files in a directory,
   read that directory's `CLAUDE.md` if it exists. Codex builds its instruction chain at
   session start, so opening a nested file does not load local guidance automatically.
4. Use `rg` and targeted reads to discover the current shape. Follow existing code and
   tests instead of relying on remembered inventories or line numbers.

Never revert, discard, stage, commit, push, file an issue, post a review, or mutate a
remote system unless the user authorized that action. If a commit is requested, stage
only this task's files and follow the scoped Conventional Commit rule in `CLAUDE.md`.

## Work effectively

- Keep the main thread responsible for integration and final verification.
- Parallelize bounded exploration, log analysis, and read-only reviews when useful.
  Give overlapping files one implementation owner and wait for every delegated task
  before reporting completion.
- Treat subagent results as evidence to verify, not verdicts to relay unchanged.
- Use the active session model and reasoning setting. Do not weaken acceptance criteria,
  tests, or review depth for a faster model. Route by task shape, not a hardcoded model:
  clear mechanical work can run fast, while ambiguous architecture and security work
  needs deeper reasoning.
- Fetch current official documentation for external APIs and libraries. Do not write
  unstable interfaces from memory.
- Prefer small modules, decisive tests, and existing seams. Do not add frameworks or
  abstractions without a concrete repository need.

## Codex workflows

Repository skills live in `.agents/skills/` and are invoked as `$skill-name`:

- `$woc-qa`: scope and run the contribution gate, then dispatch relevant reviewers.
- `$woc-extract-and-test`: extract a module behind behavior-pinning tests.
- `$woc-feature-plan`: produce an implementation-ready plan for cross-cutting work.
- `$woc-review-pr`: verify a pull request without posting unless explicitly requested.
- `$woc-file-issue`: draft an issue, and file it only with explicit authorization.
- `$woc-release-merge-audit`: find semantic damage after release integration.
- `$woc-release-malware-audit`: scan and judge malicious-code risk.
- `$woc-codex-audit`: compare the checked-in Codex architecture with current official
  guidance.

Read-only specialist agents live in `.codex/agents/`. Use only the roles matching the
changed surface: sim architecture, cross-platform parity, persistence, security, test
coverage, frontend, release malware, and official documentation research. The parent
runs deterministic commands once; reviewers inspect evidence instead of duplicating the
full gate.

## Completion contract

Run checks proportional to the change while iterating. Before calling an implementation
complete, use `$woc-qa` or follow `docs/qa-gate.md`, including `npm run gate` when the
canonical gate requires it. Report the exact commands and outcomes, remaining risks, and
any checks you could not run. A hook or subagent report never substitutes for the shared
test, typecheck, build, i18n, and security gates.
