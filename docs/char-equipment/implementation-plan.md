# Implementation Plan: Character Equipment Screen

Seven implementation phases, each followed by its own QA session (14 sessions total). Every phase runs as a fresh Claude Code session on Opus 4.8 at xhigh effort. Per-phase starter prompts live in the `phase-0N-*.md` files; this file is the workflow contract and the summary table.

## Phase summary

| Phase | Title | File | Delivers |
|---|---|---|---|
| 1 | Pure view cores | [phase-01-pure-cores.md](phase-01-pure-cores.md) | Reworked paperdoll model (new columns + bag-socket top slot), new `char_panels_view.ts`, tests, `UI_PURE_CORES` registration |
| 1 QA | Verify Phase 1 | same file, QA section | Audit + fixes |
| 2 | Window shell | [phase-02-window-shell.md](phase-02-window-shell.md) | Before-screenshots, frame subtitle/accessory extension, EQUIPMENT/OVERVIEW tabs, new paperdoll layout + CSS, screenshot script |
| 2 QA | Verify Phase 2 | same file, QA section | Audit + fixes |
| 2b | Preview pedestal + equipment seam | [phase-02b-preview-pedestal.md](phase-02b-preview-pedestal.md) | Procedural pedestal (char-window only), `PreviewAppearance.equippedItems` + `CharacterVisual.setEquipment` base seam |
| 2b QA | Verify Phase 2b | same file, QA section | Audit + fixes |
| 3 | Stat panels | [phase-03-stat-panels.md](phase-03-stat-panels.md) | Six right-hand panels, section icons, progression bar, spec row, i18n + fills, CSS |
| 3 QA | Verify Phase 3 | same file, QA section | Audit + fixes |
| 4 | Embedded bags | [phase-04-embedded-bags.md](phase-04-embedded-bags.md) | `char_bags_view.ts`, container selector + counter + grid, interactions, drag-to-unequip target, CSS |
| 4 QA | Verify Phase 4 | same file, QA section | Audit + fixes |
| 5 | Overview tab | [phase-05-overview-tab.md](phase-05-overview-tab.md) | Identity/archetype/talents/prestige/share migration to tab 2, tab a11y tests |
| 5 QA | Verify Phase 5 | same file, QA section | Audit + fixes |
| 6 | Mobile + polish | [phase-06-mobile-polish.md](phase-06-mobile-polish.md) | `hud.mobile.css` adaptation, a11y regression, after-screenshots, full gate, PR prep |
| 6 QA | Verify Phase 6 + close packet | same file, QA section | Final audit, `qa-checklist.md` matrix, teardown offer |

Dependency chain is strictly linear. Do not start a phase until the previous phase's QA session reports PASS.

## Canonical team workflow (every phase)

Model: Opus 4.8, xhigh effort. Harness: Claude Code. This is a pure client-side UI packet; no phase needs ultracode/Workflow scale (largest fan-out is 3 agents).

1. **Step 0, pre-flight.** `git status` must be clean and on `feat/char-equipment`. Scan memory (MEMORY.md index) for entries matching: char window, play.html parity, pre-push hook, Windows gate quirks. Read `docs/char-equipment/state.md` yourself (it is small and written for you); it replaces reading the other planning docs.
2. **Step 1, load context.** Spawn ONE Explore agent to read and summarize the specific source files your phase file lists (plus `src/ui/CLAUDE.md` and `src/styles/CLAUDE.md` sections it names). Do not read `hud.ts` or `components.css` whole in the main loop.
3. **Step 2, execute.** Fan out explicitly where the phase file says to (it names the agent split); otherwise implement inline. Each agent owns a vertical slice including its tests. Never `mode: "plan"` on teammates.
4. **Step 3, validate + review.** Run the phase's validation commands (from `state.md`'s matrix). Review dispatch for this packet:
   - `qa-checklist` agent: at the end of every implementation phase.
   - `privacy-security-review`, `migration-safety`, `cross-platform-sync`, `architecture-reviewer`: NOT applicable to this packet (no server/net/sim/DB surface). If your diff unexpectedly touches `src/sim/`, `src/net/`, `server/`, or `src/world_api*`, STOP: that violates locked decision 11; ask the user.
   - Prompt every review agent for COVERAGE, not filtering: "report every issue including low-severity and uncertain ones; ranking happens later." If one truncates: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
5. **Step 4, docs + memory.** Update `progress.md` (phase status, deferrals) and `state.md` (final i18n keys, new gotchas, current-phase line). Commit docs with the implementation (explicit paths).

### Code hygiene (every phase)

- Module-first: new logic in the new/existing sibling modules, never new banner sections in `hud.ts` (Hud gets only thin wiring: deps entries and open/close orchestration).
- Every new module and behavior gets tests; update the pinned tests you invalidate (e.g. `char_view.test.ts` pins the column arrays exactly); never leave orphaned tests.
- Dead code: delete replaced markup builders and CSS blocks; no commented-out code; zero unused imports.
- Conventional Commits with scope, 2-5 commits per phase, explicit paths. Suggested scopes: `feat(ui):`, `test(ui):`, `style(hud):`, `docs(char):`.
- Biome on changed files only.

### Screenshot discipline

- Phase 2 pre-flight captures the BEFORE state (current char window, desktop + mobile) into `docs/screenshots/` before any visual change lands.
- Phase 6 captures the AFTER set. PR body references both.
- Working shots go to `tmp/` (gitignored); only the curated before/after pairs are committed.
