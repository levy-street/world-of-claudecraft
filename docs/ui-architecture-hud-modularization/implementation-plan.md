# Implementation Plan: UI Architecture and HUD Modularization

TOC + canonical workflow + phase summary. Per-phase detail lives in the
`phase-NN-*.md` starter prompts and the two reusable templates. Read `state.md`
for locked facts and `brainstorm.md` for the why.

Every phase runs as its own fresh Claude Code session on Opus 4.8 at max effort
(1m-context variant where the file load demands it; `ultracode` for the
batch-heavy window phases). Each implementation phase is followed by a dedicated
QA phase, also its own session.

---

## Canonical per-phase workflow (every phase follows this)

Step 0 - Pre-flight. Verify `git status` is clean (a concurrent session may share
this checkout; if dirty, ask). Scan Claude Code memory (`MEMORY.md` + entries for
the phase domain: hud, i18n, shared-worktree, never-push-to-fork).

Step 1 - Load context (do NOT read large docs/source in the main loop; save
context). Spawn an Explore agent to read and summarize `state.md`, `progress.md`,
this phase's starter prompt, and the specific source files the phase names. For
external surfaces (Playwright APIs, Vitest env), spawn a web-research agent;
mark unverifiable facts OPEN.

Step 2 - Choose orchestration + execute. Pick the lightest tool (Explore for
recon, parallel Agent fan-out for independent slices, Workflow for batch/scale).
Request fan-out explicitly. Give each agent only the Explore summary, not raw
planning docs. Never `mode: "plan"` on teammates. `isolation: "worktree"` only if
agents edit overlapping files in parallel.

Step 3 - Validation + multi-agent review. Run the validation matrix from
`state.md` for the change type. Spawn review agents per the review-dispatch matrix,
but ONLY the ones whose surface the diff touches (`git diff --name-only` vs the
phase-start commit). Most phases here trigger `qa-checklist` only. Prompt every
review agent for COVERAGE not filtering ("report every issue including
low-severity and uncertain ones; ranking is a later step"). Resume any agent that
truncates with: "Stop reading more files. Output the full report now based on what
you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT." Do not commit until each reports no BLOCKING issues.

Step 4 - Docs + memory. Update `progress.md` (status, deferrals) and `state.md`
(new files, primitives, decisions, gotchas). Record surprising rules in memory.
Commit doc updates with the implementation, explicit paths.

Code hygiene (every phase): new code gets tests; determinism preserved; update or
remove tests you invalidate; delete dead code and unused imports; uphold the
import invariant (`src/sim/` imports nothing from render/ui/game/net, no
DOM/Three); never hand-edit generated files (`i18n.resolved.generated.ts`,
`manifest.generated.ts`).

Agent scaling: split a phase across agents when it spans 4+ independent concerns;
merge trivial work; each agent owns a complete vertical slice (logic + its tests),
not a file-type. Escalate to a Workflow past ~5 manual agents.

The self-verify merge bar (the trust substrate): `npx tsc --noEmit` +
`npx vitest run <the card's test file>` + the HUD harness + the perf skip-rate
gate + the S3 i18n guard, all green. For Opus 4.8: a fresh subagent reviews the
diff for correctness and requirement gaps (not style) before declaring done.

## Phase summary

| Phase | Type | Card(s) | Title | Depends on |
|---|---|---|---|---|
| 1 | impl | P0-1, P0-2 | DOM test harness + perf-budget gate | none |
| 2 | QA | - | Verify Phase 1 | 1 |
| 3 | impl | P0-3, P0-4, P0-5 | Decouple i18n guard + IWorld read-surface parity + sim-purity boundary/ESLint | none (parallel-safe with 1) |
| 4 | QA | - | Verify Phase 3 | 3 |
| 5 | impl | NEW | Playwright DOM-HUD visual baselines + MCP QA runbook + CI wiring (the one place CI learns about Playwright) | 1 |
| 6 | QA | - | Verify Phase 5 | 5 |
| 7 | impl | P1-A | Extract `HotWriteGate` | 1, 2 |
| 8 | QA | - | Verify Phase 7 | 7 |
| 9 | impl | P1-B | Extract `ReactiveDiff`/`StructuralDiff` + migrate 7 sites | 1, 7 |
| 10 | QA | - | Verify Phase 9 | 9 |
| 11 | impl | P1-C | Extract `IconService` + define `HudContext` seam | 1, 7 |
| 12 | QA | - | Verify Phase 11 | 11 |
| 13 | impl | P2-Spellbook | Extract Spellbook window (the worked template) | 7, 9, 11 |
| 14 | QA | - | Verify Phase 13 | 13 |
| 15-23 | impl | P2-* | Extract the remaining 9 windows (one session/PR each; use `phase-p2-window-template.md`) | 13 (+ 3 for Social) |
| (each) | QA | - | Verify each window (use `qa-phase-template.md`) | its impl phase |
| 24 | impl | P3 | Per-frame core perf hardening | 1 (skip-rate gate) |
| 25 | QA | - | Final QA + packet teardown offer | all |

Phase 5 also owns the CI wiring for the new browser/visual tier: it adds the
Playwright job to BOTH the pr-gate and release-gate in `.github/workflows/ci.yml`
(structured so the UX packet can later extend it with the `@axe-core/playwright`
sweep), asserts the DOM harness + perf-budget gate ride the CI `npm test`, and
adds `'**/tests/visual/**'` to the Vitest `exclude` in vite.config.ts so `npm
test` does not try to execute the Playwright specs. It is the single place CI
learns about Playwright.

Phases 1, 3, and 5 are mutually independent after their shared dep and can run as
concurrent sessions (disjoint files). Phases 7 -> 9 -> 11 are sequential
(primitives build on each other). The window phases (13, then 15-23) can run
concurrently across sessions once P1 (7/9/11) has landed, because each owns a
disjoint new file and disjoint `id` roots. Phase 19 (Social) waits on Phase 3.

## P2 window extraction order and tracking

Each window is one card, one session, one PR, using `phase-p2-window-template.md`
for implementation and `qa-phase-template.md` for QA. Order is lowest-risk first;
the per-window status table lives in `progress.md`. Re-grep every anchor before
editing (line numbers drift).

| # | Window | Source anchor | Risk | Notes / dependency |
|---|---|---|---|---|
| 13 | Spellbook | `hud.ts:4191-4259` | low | Worked template; do first, document the seam. Concrete file `phase-13-p2-spellbook.md`. |
| 15 | Talents | `hud.ts:4269+` | med | Staged-edit, loadouts, import/export. Keep staged alloc owned by the module. |
| 16 | QuestLog | `hud.ts:3714+` | low | |
| 17 | Character | `hud.ts:3830+` | med | Owns a preview canvas; verify `CharacterPreview` sync still fires. |
| 18 | Options | `hud.ts:5549+` | med | Keybind capture lives here; keep on the modal gate. |
| 19 | Social | `hud.ts:5090+` | med | Consumes `StructuralDiff` (P1-B); touches matcher area, BLOCKED on Phase 3. |
| 20 | Trade | `hud.ts:5435+` | med | |
| 21 | Bags | `hud.ts:2752+` | med | Drag-drop shared state with the action bar; thread via `HudContext`, do not duplicate `dragAction`. |
| 22 | Market | `hud.ts:3419+` | med | Browse/sell/collect tabs. |
| 23 | Arena | `hud.ts:2064+` | med | Bracket queue + in-match UI + leaderboard fetch. |

What stays in `hud.ts` after P2: persistent chrome + loop coordinator (player/
target frame, action bar, cast bar, auras, minimap, the `update()` tier
dispatcher, window manager, event dispatch, the behaviorally-tested matchers).
This is explicitly NOT modularized for its own sake.

## Program-level definition of done

- `hud.ts` reduced to persistent chrome + loop coordinator; each on-demand window
  in its own `src/ui/hud/<window>.ts` consuming a shared `HudContext`.
- Shared primitives (`HotWriteGate`, `ReactiveDiff`/`StructuralDiff`,
  `IconService`) defined once and unit-tested.
- The HUD has behavioral tests, a skip-rate perf gate, an `IWorld` read-surface
  parity test, a sim-purity boundary check, the i18n guard asserts runtime
  behavior not source shape, and Playwright DOM visual baselines exist. The
  Vitest-based gates (DOM harness, perf-budget gate, parity/purity/i18n checks,
  and any axe UNIT tests) ride the PR-tier `npm test`. The Playwright visual sweep
  (and, later, the `@axe-core/playwright` AAA sweep added by the UX packet) runs
  as a SEPARATE CI job wired into the pr-gate and release-gate in Phase 5, not via
  `npm test`.
- Per-frame core untouched in behavior, still imperative, still above the skip floor.
- All invariants in `state.md` hold, verified by gates not eyeball.
- CI-equivalent gate green: `npm test && npx tsc --noEmit && npm run build:env &&
  npm run build:server && npm run build`.
