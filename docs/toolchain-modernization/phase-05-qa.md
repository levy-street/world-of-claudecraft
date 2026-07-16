# Phase 5 QA: Verify the TypeScript 7 flip (closes the packet)

### QA Starter Prompt

```
This is Phase 5 QA of the Toolchain Modernization packet: Verify the TypeScript 7 flip.
This is the FINAL phase of the packet; it also runs the whole-packet integration matrix
and offers packet teardown.

Model: Opus 4.8, xhigh effort (reserve max for genuinely frontier problems), 1m context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: recommended; the whole-packet matrix benefits from an adversarial-verify
Workflow.

Goal: audit Phase 5, then verify the whole-packet integration matrix in
docs/toolchain-modernization/qa-checklist.md, then offer packet teardown.

STEP 0 - PRE-FLIGHT: feature/typescript-7 worktree; git status clean (packet
bootstrap: if docs/toolchain-modernization/ is absent, copy it from the main checkout).
Memory scan for typescript/toolchain entries.

STEP 1 - LOAD CONTEXT (via an Explore agent): state.md (D1 execution record),
progress.md (Phase 5 checklist + recorded timings), phase-05-typescript-7-flip.md, the
full phase diff including package-lock.json, CLAUDE.md (root), and CONTRIBUTING.md.
Return: deliverables, touched files, timings, the installed versions.

STEP 2 - QA AUDIT (parallel agents; COVERAGE not filtering: report every issue
including low-severity and uncertain ones; ranking happens in a later step):

Toolchain agent:
- Re-verify from a CLEAN install (rm -rf node_modules; npm ci): tsc --version is 7.x,
  require('typescript').version is 6.x with ts.sys present, check:types green, the
  recorded check:ts timing reproduces, tsc --checkers 8 clean.
- Re-run the broken-install probe simulation (invoke the hardened pre-push probe
  against a nonexistent binary path) and confirm the hook skips with the legible
  message rather than passing on a stat.
- Verify every tsc consumer runs the intended binary: check:ts, .githooks/pre-push (dry
  run), tests/server/new_endpoint.test.ts (green), and that nothing anywhere imports
  the typescript package at runtime (grep).
- Audit the package-lock.json diff line by line for anything beyond the typescript,
  typescript6, and platform packages.

Docs agent:
- CONTRIBUTING.md and the editor note are accurate for a new contributor on a fresh
  clone (follow them literally on a scratch clone); re-evaluation triggers present in
  state.md.

Whole-packet agent (the integration close):
- Execute every row of docs/toolchain-modernization/qa-checklist.md and record each
  verdict in that file. This includes re-running the Phase 1 conflict-elimination
  experiment, the byte-identical resolved-output proof, the canonical stronger-typing
  probe pair (a bogus overlay key entities.itemSets.bogus_zzz.name and a bogus t()
  literal, both failing tsc), the three-run CI timing check, and full npm run gate on
  this branch plus release-tier on the release branch (2026-07-15, Phase 3 QA: the
  v0.26.0 fill emptied pending, so pending-row locale reds are no longer an expected
  mid-cycle state; treat a red release tier as a real regression unless a post-fill
  catalog key legitimately reintroduced pending rows, and record exactly which).

Multi-agent review dispatch per the implementation-plan.md matrix, plus qa-checklist
(the agent) for phase completion. Standard truncation-resume message.

STEP 3 - FIX: apply all BLOCKING and SHOULD-FIX items; re-run the affected validation
rows; commit with EXPLICIT paths.

STEP 4 - UPDATE DOCS + MEMORY:
- progress.md (Phase 5 QA complete; the packet status table all green; deferrals),
  state.md (final state), qa-checklist.md (verdicts filled in).
- Memory: record the executed end-state (TS7 dual alias, the artifact policy, the CI
  shape) as the project's current toolchain baseline, plus the re-evaluation triggers.

STEP 5 - PACKET TEARDOWN (this IS the final phase):
Surface all deferred follow-ups first (expected at minimum: the svelte-check --tsgo
follow-up, the drop-the-dual-alias trigger, any slow-test optimization candidates from
Phase 4). Before any deletion, make the durable knowledge survive teardown: summarize
the research conclusions on issue #1868 (the go decision, the corrections, the
executed design, the re-evaluation triggers), paste the filled qa-checklist.md verdict
matrix into the final PR body or that issue summary, confirm the re-evaluation
triggers live in CONTRIBUTING.md, and git grep for any committed file still referencing
docs/toolchain-modernization/ (fix pointers before deleting). Then ask the user
explicitly: "All phases are complete and green. OK to delete
docs/toolchain-modernization/ (the planning scaffolding) before the final PR is marked
ready?" Delete ONLY on explicit confirmation, ONLY that directory (git rm -r
docs/toolchain-modernization/ and commit docs: remove toolchain-modernization planning
scaffolding). If declined, leave it in place.

STEP 6 - FINAL RESPONSE FORMAT: QA verdict, counts found/fixed, deferred items,
whether the packet was removed, and "packet complete" with the headline outcomes (tsc
time before/after, PR gate time before/after, the conflict class eliminated).

STOPPING RULES:
- Stop and surface if any whole-packet matrix row fails; do not close the packet on a
  red row.
```
