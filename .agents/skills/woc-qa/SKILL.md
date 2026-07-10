---
name: woc-qa
description: "Run end-of-contribution QA for World of ClaudeCraft, including readiness checks, scoped regression testing, and conditional specialist review. Use when asked to QA changes, make work ready, verify a branch or worktree, or assess whether a contribution is complete."
---

# World of ClaudeCraft QA

Coordinate one evidence-backed QA pass for the requested change.

## Establish authority and scope

1. Read the root `CLAUDE.md` in full.
2. Read each relevant local `CLAUDE.md` before inspecting or editing that area.
3. Run `git status --short` and preserve unrelated work.
4. Establish the diff once. Prefer the working tree when changes are uncommitted;
   otherwise use the user-provided base or active release base. Never assume `main`.
5. Treat `review`, `check`, and `audit` as read-only. Treat `fix findings`, `make
   ready`, or implementation requests as permission for scoped remediation.
6. Do not commit, push, post comments, or create pull requests unless explicitly asked.

`CLAUDE.md` owns repository architecture and invariants. Reference it instead of
restating or replacing it.

## Run coordinator-owned checks

The coordinating agent owns build, test, lint, generation, and scanner commands.
Specialist agents inspect code and shared command output without rerunning the full gate.

During iteration, run the smallest relevant set:

1. Targeted Vitest files for changed behavior.
2. Architecture or localization guard tests for touched domains.
3. `npm run i18n:gen` before tests that require generated localization artifacts.
4. `npm run ci:changed`.
5. `npx tsc --noEmit`.

Before declaring implementation work ready, run:

```sh
npm run gate
```

If a command cannot run, report the exact blocker and continue with every safe check
that remains.

## Dispatch conditional reviewers

Give each reviewer the established diff, relevant files, applicable canonical
instructions, and command results. Require read-only evidence with file and line
references. Use only the agents relevant to the diff:

- `woc_sim_architecture` for simulation behavior, determinism, or module boundaries.
- `woc_cross_platform` for world, network, wire, RL, matcher, or client parity.
- `woc_persistence` for DDL, stored JSONB, save paths, or compatibility.
- `woc_security` for server, admin, auth, deployment, secrets, or trust boundaries.
- `woc_test_coverage` for changed behavior, acceptance criteria, and regression tests.
- `woc_frontend` for UI, render, CSS, i18n, accessibility, responsive, or fairness work.
- `woc_release_malware` for releases, dependencies, install behavior, AI instructions,
  or suspicious executable content.

Run independent reviewers in parallel when capacity permits. Verify consequential
findings against the actual diff and surrounding code. Reject speculative, inherited,
duplicate, or out-of-scope findings. In review-only mode, do not edit files.

## Report

Return the scope and base, commands and results, reviewers used, confirmed findings,
authorized fixes, remaining risks, and one verdict: `READY`, `READY WITH NOTES`, or
`NOT READY`.
