# HUD Visual + UX + Accessibility (planning packet)

The follow-on to the `ui-architecture-hud-modularization` refactor. The refactor
makes the HUD modular and gate-protected; THIS packet layers a premium
dark-fantasy aesthetic, world-class UX, and accessibility pushed to WCAG 2.2 AAA
where feasible with a full opt-in Reader Mode, capped by a WoW-style Edit Mode
layout editor. It deliberately re-baselines visuals (with reviewed diffs) rather
than preserving them.

This is cross-session scaffolding, not a shipping artifact. The final QA phase
offers to delete this directory before the PR.

## Index

Cross-cutting docs:
- `research-brief.md` - the deep, cited research (WCAG 2.2, game-a11y standards,
  ARIA widget specs, the real-time SR + focus model, the design-token architecture,
  mobile a11y, what WoW ships). Three load-bearing claims independently fact-checked.
- `brainstorm.md` - vision, locked decisions, the 8 foundation workstreams,
  reusable surface, cross-packet dependency, OPEN items.
- `implementation-plan.md` - TOC, canonical per-phase workflow, phase summary,
  per-window pass order.
- `state.md` - cross-phase cheat sheet: locked decisions, invariants, validation
  matrix, review-dispatch matrix, cross-packet checkpoints, file paths, ledger.
- `progress.md` - status table + per-phase deliverable checklists + per-window tracking.
- `qa-checklist.md` - whole-packet integration QA matrix.

Phase starter prompts (each self-contained):
- `phase-01-design-token-system.md` (impl) - primitive/semantic tokens + dark-fantasy palette + QUALITY_COLOR migration.
- `phase-03-a11y-interaction-foundation.md` (impl) - input-mode gate, focus-trap, roving-tabindex, announcer on HudContext.
- `phase-05-mobile-pointer-foundation.md` (impl) - viewport unblock, safe areas, target size, single-pointer drag.
- `phase-07-persistent-chrome-pass.md` (impl) - frames/action bar/cast bar/auras/minimap/FCT visual + a11y.
- `phase-19-reader-mode.md` (impl) - announcer wiring, coalescing, assists, SR navigation.
- `phase-21-themes-and-text-scale.md` (impl) - high-contrast + colorblind themes, text-scale, reduced motion.
- `phase-23-aaa-conformance-pass.md` (impl) - enhanced contrast where feasible, AAA audit + fixes.
- `phase-25-edit-mode-core.md` (impl) - drag-reposition, grid snap, keyboard repositioning.
- `phase-27-edit-mode-layouts-persistence.md` (impl) - named layouts, save/load/reset, localStorage.
- `phase-window-polish-template.md` (impl template) - used for Phases 9-18 (the 10 per-window passes).
- `qa-phase-template.md` (QA template) - used for every QA phase (2,4,6,8, each window QA, 20,22,24,26, and Phase 28 which also runs teardown).

## How to start

1. Confirm the refactor packet has reached the cross-packet checkpoint this phase
   needs (see `state.md`): tokens (Phase 1) and mobile (Phase 5) can start early;
   Phase 3 needs the refactor's HudContext; per-window passes need the window extracted.
2. Read this README, `state.md`, and the relevant sections of `research-brief.md`.
3. Open the next not-started phase in `progress.md`, copy its starter prompt into a
   fresh Claude Code session (Opus 4.8, max effort; add `ultracode` for batch-heavy
   phases like the per-window passes, Reader Mode, and Edit Mode).
4. The session self-verifies (tsc + harness + perf gate + i18n guard + axe + a
   reviewed visual baseline) and updates `progress.md` + `state.md` before handing
   to its QA phase.
