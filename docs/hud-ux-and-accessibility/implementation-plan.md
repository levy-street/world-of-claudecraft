# Implementation Plan: HUD Visual + UX + Accessibility

TOC + canonical workflow + phase summary. Deep findings are in `research-brief.md`;
locked facts in `state.md`; vision in `brainstorm.md`. Each phase is its own fresh
Claude Code session on Opus 4.8 at max effort (`ultracode` for batch-heavy phases).
Each implementation phase is followed by a dedicated QA phase.

This packet rides on the `ui-architecture-hud-modularization` refactor. Confirm
the cross-packet checkpoints in `state.md` during each phase pre-flight.

---

## Canonical per-phase workflow (every phase follows this)

Step 0 - Pre-flight. `git status` clean (shared worktree; ask if dirty). Confirm
the cross-packet dependency for this phase is met (the needed refactor phase has
landed; see state.md). Scan memory (MEMORY.md + topics: hud, i18n, shared-worktree,
never-push-to-fork, no-em-dashes-or-emojis, live-site-and-test-creds).

Step 1 - Load context (do NOT read large docs or hud.ts in the main loop). Spawn an
Explore agent to summarize `state.md`, `research-brief.md` (the sections this phase
needs: ARIA widget specs, token taxonomy, SR model), `progress.md` (this phase),
this phase's starter prompt, and the specific source files. Spawn a web-research
agent only if a phase needs a current external fact not in research-brief.md.

Step 2 - Choose orchestration + execute. Lightest tool that fits; request fan-out
explicitly; give each agent only the Explore summary. `isolation: "worktree"` only
if agents edit overlapping files in parallel.

Step 3 - Validation + multi-agent review. Run the validation matrix from state.md
for the change type. ALWAYS run the a11y checks (axe-core) and a Playwright MCP
live-game walkthrough for any visible/interactive change; re-baseline visuals only
after reviewing the diff. Spawn review agents per the dispatch matrix, but ONLY the
ones whose surface the diff touches (usually `qa-checklist` only). Prompt for
COVERAGE not filtering; resume truncating agents with the standard message. No
commit until no BLOCKING.

Step 4 - Docs + memory. Update `progress.md` and `state.md` (ledger, new tokens/
utilities/keys, gotchas). Record memory notes. Commit docs with the implementation
(explicit paths).

Code hygiene every phase: new code gets tests (unit + axe a11y assertions where
applicable); determinism preserved; remove dead code/unused imports; uphold the
import invariant; never hand-edit generated files; every new visible string is a
`t()` key.

The self-verify merge bar: `npx tsc --noEmit` + the phase's vitest files + the HUD
harness + the perf skip-rate gate + the i18n guard + the axe a11y checks + a
reviewed Playwright visual baseline. For Opus 4.8: a fresh subagent reviews the
diff for correctness, a11y-spec conformance, and requirement gaps before done.

## Phase summary

| Phase | Type | Title | Workstream | Cross-packet dep |
|---|---|---|---|---|
| 1 | impl | Design-token system + dark-fantasy palette | tokens (3,8) | none (CSS) |
| 2 | QA | Verify Phase 1 | | |
| 3 | impl | A11y interaction foundation on HudContext (input-mode, focus-trap, roving-tabindex, announcer) | 1,4,5,7 | refactor HudContext (P11) |
| 4 | QA | Verify Phase 3 | | |
| 5 | impl | Mobile + pointer foundation (viewport unblock, safe-area, target-size, single-pointer drag, pinch-zoom) | 2,6 | none (markup/CSS) |
| 6 | QA | Verify Phase 5 | | |
| 7 | impl | Persistent chrome visual + a11y pass (frames, action bar roving tabindex, cast bar, auras, minimap, FCT) | apply | refactor chrome present |
| 8 | QA | Verify Phase 7 | | |
| 9-18 | impl | Per-window visual + AAA a11y pass (10 windows; use `phase-window-polish-template.md`) | apply | each window extracted |
| (each) | QA | Verify each window (use `qa-phase-template.md`) | | |
| 19 | impl | Reader Mode (announcer wiring, coalescing, assists, SR navigation) | 7 | windows instrumented |
| 20 | QA | Verify Phase 19 | | |
| 21 | impl | Themes (high-contrast + Okabe-Ito colorblind) + text-scale UI + reduced-motion coverage | 8 | tokens stable |
| 22 | QA | Verify Phase 21 | | |
| 23 | impl | AAA conformance pass (enhanced contrast where feasible, AAA audit + fixes) | a11y | passes done |
| 24 | QA | Verify Phase 23 | | |
| 25 | impl | Edit Mode layout editor: core (drag-reposition, grid snap, modular windows) | capstone | windows modular |
| 26 | QA | Verify Phase 25 | | |
| 27 | impl | Edit Mode: named layouts, save/load/reset, localStorage persistence | capstone | Phase 25 |
| 28 | QA | Final QA + packet teardown offer | | |

Phases 1 and 5 can be CODED early as concurrent sessions (no modular-seam
dependency), but their visual-validation step requires the refactor packet's
Phase 5 (`playwright.config.ts` + `tests/visual/` baselines + the CI Playwright job)
to have landed. Phase 3 needs the refactor's HudContext. The per-window passes (9-18) can run
concurrently across sessions once each window is extracted and the foundation
(1/3/5) has landed; each owns a disjoint window module. The capstone (25-27) is last.

## Per-window pass order (Phases 9-18; template-driven)

Use `phase-window-polish-template.md` (impl) and `qa-phase-template.md` (QA) per
window; track status in `progress.md`. Each pass applies: the dark-fantasy token
restyle, the ARIA role/state/keyboard spec for that window's widget types (from
research-brief.md section 3), roving tabindex for grids/lists, the modal
focus-trap if applicable, `t()` for every label, and contrast/target-size to AAA
where feasible.

| # | Window | Primary widget types (ARIA) | Notes |
|---|---|---|---|
| 9 | Spellbook | listbox/grid, tooltip | template-validate here first |
| 10 | Bags | grid, drag, tooltip | single-pointer drag + roving tabindex; dense item tooltips use inspect dialog |
| 11 | Character | grid (equipment), preview canvas | canvas needs DOM/text equivalent for the preview |
| 12 | Talents | grid/tree, dialog | staged-edit; keyboard tree navigation |
| 13 | QuestLog | list, dialog | |
| 14 | Social | tablist, listbox, live region | friend/guild online announcements |
| 15 | Trade | dialog, grid | modal focus-trap; confirm/accept flow |
| 16 | Market | tablist, grid, slider | price inputs; numbers via formatters |
| 17 | Arena | dialog, live region, meter | queue/match-state announcements |
| 18 | Options | tablist, slider, switch | houses the theme/text-scale/Reader-Mode controls (coordinate with Phase 21) |

## Program-level definition of done

- The HUD presents the premium dark-fantasy aesthetic via a primitive/semantic
  token system; `QUALITY_COLOR` is tokenized and the canvas painter reads cached tokens.
- WCAG 2.2 AA holds across the HUD with AAA where feasible, verified by axe-core and
  a manual screen-reader pass; Reader Mode ships as an opt-in mode. The axe UNIT
  tests (`tests/a11y/*.test.ts`, Vitest) ride `npm test` and so run in CI; the
  `@axe-core/playwright` AAA SWEEP runs as a separate CI job that EXTENDS the
  Playwright job introduced in the refactor packet's Phase 5, so it is gated on that
  job landing.
- Keyboard navigation, focus management, roving tabindex, and single-pointer
  alternatives cover every interactive surface; mobile scale lock removed and safe
  areas honored.
- High-contrast and colorblind themes and a text-scale control ship in Options;
  reduced motion is fully honored.
- Edit Mode lets players reposition windows and save/load named layouts (persisted).
- Every new visible string is a `t()` key; the i18n guard and `tsc` are green.
- Visuals are deliberately re-baselined with reviewed diffs; CI-equivalent gate green.
