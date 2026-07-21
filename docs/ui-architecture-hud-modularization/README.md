# UI Architecture and HUD Modularization (planning packet)

This packet turns `src/ui/hud.ts` (a 6,280-line single `Hud` class) into a
gate-protected, modular HUD: shared primitives plus one module per on-demand
window under `src/ui/hud/`, with `hud.ts` reduced to persistent chrome and the
per-frame loop coordinator. The sequence is deliberate: build the test and gate
scaffold first (P0), extract shared primitives (P1), peel windows one PR at a time
(P2), harden the per-frame core last (P3). No frontend framework, no signals
library, zero new runtime deps; the deterministic gates stand in for a human
reviewer in this 100%-AI repo.

This is cross-session scaffolding, not a shipping artifact. The final QA phase
offers to delete this directory before the PR.

## Index

Cross-cutting docs:
- `00-design-brief.md` - the maintainer's original design brief (the source vision).
- `brainstorm.md` - distilled vision, current state, reusable surface, research findings, OPEN items, locked decisions.
- `implementation-plan.md` - TOC, canonical per-phase workflow, phase summary table, P2 window order.
- `state.md` - cross-phase cheat sheet: locked decisions, invariants, validation matrix, review-dispatch matrix, file paths, anchors, ledger.
- `progress.md` - status table + per-phase deliverable checklists + P2 window tracking.
- `qa-checklist.md` - whole-packet integration QA matrix.
- `mcp-qa-runbook.md` - reusable Playwright-MCP live-game QA procedure (created in Phase 5).

Phase starter prompts (each self-contained; paste into a fresh session):
- `phase-01-dom-harness-and-perf-gate.md` (impl) - DOM test harness + perf-budget gate.
- `phase-03-i18n-decouple-parity-boundary.md` (impl) - i18n guard decouple + IWorld parity + sim-purity gates.
- `phase-05-playwright-visual-baselines.md` (impl) - Playwright DOM visual baselines + MCP QA runbook.
- `phase-07-extract-hotwritegate.md` (impl) - extract `HotWriteGate`.
- `phase-09-extract-reactivediff.md` (impl) - extract `ReactiveDiff`/`StructuralDiff` + migrate 7 sites.
- `phase-11-iconservice-and-hudcontext.md` (impl) - extract `IconService` + define `HudContext`.
- `phase-13-p2-spellbook.md` (impl) - extract the Spellbook window (the worked template).
- `phase-24-perf-hardening.md` (impl) - per-frame core perf hardening.
- `phase-p2-window-template.md` (impl template) - used for Phases 15-23 (the remaining 9 windows).
- `qa-phase-template.md` (QA template) - used for every QA phase (2,4,6,8,10,12,14, per-window, and the final phase 25, which also runs packet teardown).

## How to start

1. Read this README and `state.md`.
2. Open the next not-started phase in `progress.md`.
3. Copy that phase's starter prompt into a fresh Claude Code session (Opus 4.8,
   max effort; add `ultracode` for the batch-heavy window phases).
4. The session self-verifies against the gates and updates `progress.md` +
   `state.md` before handing off to its QA phase.

Recommended session grouping (concurrency-safe on the shared worktree):
- Session A: Phase 1 (then its QA).
- Session B (parallel with A): Phase 3 (disjoint files).
- Session C: Phase 5 (after Phase 1).
- Session D: Phases 7 -> 9 -> 11 (sequential primitives).
- Sessions E..M: one window each (Phase 13 first as the template, then 15-23
  concurrently; Phase 19/Social waits on Phase 3).
- Session N: Phase 24 (perf), after the skip-rate gate exists.
