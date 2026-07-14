---
name: woc-review-pr
description: "Review a World of ClaudeCraft pull request against its actual diff, canonical architecture, tests, and domain risks. Use when asked to inspect, review, assess, or prepare feedback for a pull request. Reading and drafting are allowed by default, but posting GitHub feedback requires explicit authorization."
---

# Review Pull Request

Perform a read-only, evidence-backed review of the requested pull request.

## Hold the authorization boundary

A request to review, inspect, check, or assess authorizes reading and drafting only. Do
not run `gh pr review`, post a comment, approve, request changes, push, edit the branch,
or otherwise write to GitHub unless the user explicitly asks to submit the review.

## Establish scope

1. Read the root `CLAUDE.md` in full.
2. Identify the pull request, repository, head, base, and merge base.
3. Read local `CLAUDE.md` files for touched directories.
4. Inspect the actual diff, surrounding production code, and linked acceptance criteria.
5. Run `git status --short` and avoid disturbing unrelated work.

Use read-only Git and GitHub inspection as needed. Do not rely on the PR description.

## Review and verify

Check correctness, edge cases, canonical architecture, determinism, parity, persistence,
security, authorization, localization, generated artifacts, decisive tests, and updated
operator documentation wherever those domains apply.

The coordinating agent runs targeted commands once. Specialist reviewers inspect the
diff and shared results without duplicating the full test or build run.

For every candidate finding:

1. Trace the execution path.
2. Confirm the PR introduces or exposes it.
3. Check existing tests and guards.
4. Identify concrete impact.
5. Cite the narrowest useful file and line.
6. Remove speculative, duplicate, inherited, and style-only noise.

Classify findings as blocking, should fix, or suggestion. Deliver confirmed findings
first, followed by test gaps and residual risk.

If posting was explicitly authorized, show the final review text before the write when
practical and submit only the requested action. Otherwise return the draft and state that
nothing was posted.
