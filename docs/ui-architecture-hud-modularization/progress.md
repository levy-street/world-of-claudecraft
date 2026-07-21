# Progress: UI Architecture and HUD Modularization

Update at the end of every phase. Status values: not-started / in-progress /
blocked / complete.

## Status table

| Phase | Type | Title | Status | Started | Completed |
|---|---|---|---|---|---|
| 1 | impl | DOM test harness + perf-budget gate | not-started | | |
| 2 | QA | Verify Phase 1 | not-started | | |
| 3 | impl | i18n decouple + IWorld parity + sim-purity gates | not-started | | |
| 4 | QA | Verify Phase 3 | not-started | | |
| 5 | impl | Playwright visual baselines + MCP QA runbook | not-started | | |
| 6 | QA | Verify Phase 5 | not-started | | |
| 7 | impl | Extract HotWriteGate | not-started | | |
| 8 | QA | Verify Phase 7 | not-started | | |
| 9 | impl | Extract ReactiveDiff/StructuralDiff | not-started | | |
| 10 | QA | Verify Phase 9 | not-started | | |
| 11 | impl | Extract IconService + HudContext | not-started | | |
| 12 | QA | Verify Phase 11 | not-started | | |
| 13 | impl | Extract Spellbook (template) | not-started | | |
| 14 | QA | Verify Phase 13 | not-started | | |
| 24 | impl | Per-frame core perf hardening | not-started | | |
| 25 | QA | Final QA + packet teardown | not-started | | |

## P2 window tracking (Phases 15-23; use the templates)

| # | Window | Branch | Impl status | QA status | Notes |
|---|---|---|---|---|---|
| 15 | Talents | | not-started | not-started | |
| 16 | QuestLog | | not-started | not-started | |
| 17 | Character | | not-started | not-started | preview-canvas sync |
| 18 | Options | | not-started | not-started | keybind capture / modal gate |
| 19 | Social | | blocked | blocked | waits on Phase 3 |
| 20 | Trade | | not-started | not-started | |
| 21 | Bags | | not-started | not-started | drag-drop via HudContext |
| 22 | Market | | not-started | not-started | |
| 23 | Arena | | not-started | not-started | |

## Per-phase deliverables and acceptance

### Phase 1 - DOM test harness + perf-budget gate
- [ ] DOM dev dep added (happy-dom default); Vitest opted-in per-file, sim suite stays node env.
- [ ] `tests/helpers/fake_world.ts` implements the `IWorld` read surface with mutators.
- [ ] `tests/hud_harness.test.ts` really instantiates `Hud` and asserts rendered text comes from `t()`.
- [ ] `tests/hud_perf_budget.test.ts` asserts hot-write skip rate > 0.8 over steady-state frames.
- [ ] `tests/client_shell.test.ts` string-scraping replaced with behavioral assertions.
- [ ] `npm run build` and the full `npm test` stay green; sim suite speed unchanged.

### Phase 3 - i18n decouple + IWorld parity + sim-purity gates
- [ ] `localization_fixes.test.ts` S3/B1 asserts runtime localization across all `supportedLanguages`, not hud.ts source shape; matcher trio could move without breaking it (prove, then revert the trial move).
- [ ] Drift coverage unchanged (every sim/server emit still has a matcher/key).
- [ ] `tests/iworld_read_surface.test.ts`: Sim and ClientWorld expose identical render/ui read surface; deleting an accessor from one fails it.
- [ ] `tests/architecture_boundaries.test.ts` + `eslint.config.js`: sim imports nothing from DOM/three/render/ui/game/net and uses no `Math.random`/`Date.now`/`performance.now`; both green now, a deliberate violation fails.

### Phase 5 - Playwright visual baselines + MCP QA runbook
- [ ] `@playwright/test` added (devDependency); `playwright.config.ts` with desktop + mobile projects, `animations:'disabled'`, masks for live numbers.
- [ ] `tests/visual/*.spec.ts` baseline the DOM HUD overlay screens (desktop + mobile) on the current pre-refactor HUD.
- [ ] `window.__game` state-assertion helpers documented for canvas verification.
- [ ] `mcp-qa-runbook.md`: reusable Playwright-MCP QA procedure every QA phase follows.
- [ ] `npm run build` proves the game bundle does not pull in Playwright.

### Phase 7 - HotWriteGate
- [ ] `src/ui/hud/hot_write_gate.ts`: one `Map`, the four setters, counters, `stats()`.
- [ ] Exactly one instance in `Hud`, threaded by reference (grep proves no duplicate cache).
- [ ] Write semantics and string formatting byte-identical (signatures depend on it).
- [ ] `tests/hot_write_gate.test.ts` + the perf gate green.

### Phase 9 - ReactiveDiff/StructuralDiff
- [ ] `src/ui/hud/reactive_diff.ts`: `ReactiveDiff<T>` + `StructuralDiff<S,C>`, exact diff semantics.
- [ ] 7 sites migrated one commit each, each guarded by harness + skip-rate + a fixture "new sig flips iff old sig flipped" parity test.

### Phase 11 - IconService + HudContext
- [ ] `src/ui/hud/icon_service.ts` wraps `iconDataUrl`/`iconCanvas`/`QUALITY_COLOR`.
- [ ] `src/ui/hud/hud_context.ts` defines the shared service bag (gate, window manager, icon/tooltip/money helpers, `sim: IWorld`, renderer-pick, keybinds, `t`).
- [ ] `Hud` constructs and threads `HudContext`; harness + build green.

### Phase 13 - Spellbook (worked template)
- [ ] `src/ui/hud/spellbook.ts` takes `HudContext`, exposes `render()`/`toggle()`/`update()`.
- [ ] Methods moved verbatim; `#spellbook` and every selector/signature byte-identical.
- [ ] `Hud` delegates; `tests/hud_spellbook.test.ts`; opens/closes/updates in `npm run dev`.
- [ ] The seam is documented (this is the template for windows 15-23).

### Phase 24 - Per-frame perf hardening
- [ ] Measure first (`/perf` overlay, busy scene desktop + throttled mobile); only proceed if GC is visible.
- [ ] If confirmed: pool `AnimState` (`renderer.ts:1201`), cache minimap Sets (`hud.ts:1952-1954`), cheapen aura sig (`hud.ts:1838`) with the parity test extended.
- [ ] Fresh subagent reviews for object aliasing and stale-signature risk; skip rate still > 0.8.

## QA phase checklists (per QA phase, fill on completion)
- [ ] Every deliverable implemented; every acceptance criterion met.
- [ ] Tests added for new code; determinism preserved; orphaned tests removed.
- [ ] Dead code/imports removed; import invariant holds; no TODO/FIXME left.
- [ ] Review agents (per dispatch matrix) report no BLOCKING; fixes committed separately.
- [ ] Playwright MCP live-game walkthrough done (per `mcp-qa-runbook.md`); visual baselines unchanged or intentionally re-baselined with reviewed diff.

## Notes (filled after each phase)
- (none yet)
