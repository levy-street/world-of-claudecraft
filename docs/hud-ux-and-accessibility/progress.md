# Progress: HUD Visual + UX + Accessibility

Update at the end of every phase. Status: not-started / in-progress / blocked / complete.

## Status table

| Phase | Type | Title | Status | Started | Completed |
|---|---|---|---|---|---|
| 1 | impl | Design-token system + dark-fantasy palette | not-started | | |
| 2 | QA | Verify Phase 1 | not-started | | |
| 3 | impl | A11y interaction foundation on HudContext | not-started | | |
| 4 | QA | Verify Phase 3 | not-started | | |
| 5 | impl | Mobile + pointer foundation | not-started | | |
| 6 | QA | Verify Phase 5 | not-started | | |
| 7 | impl | Persistent chrome visual + a11y pass | not-started | | |
| 8 | QA | Verify Phase 7 | not-started | | |
| 19 | impl | Reader Mode | not-started | | |
| 20 | QA | Verify Phase 19 | not-started | | |
| 21 | impl | Themes + text-scale + reduced-motion | not-started | | |
| 22 | QA | Verify Phase 21 | not-started | | |
| 23 | impl | AAA conformance pass | not-started | | |
| 24 | QA | Verify Phase 23 | not-started | | |
| 25 | impl | Edit Mode core | not-started | | |
| 26 | QA | Verify Phase 25 | not-started | | |
| 27 | impl | Edit Mode layouts + persistence | not-started | | |
| 28 | QA | Final QA + packet teardown | not-started | | |

## Per-window pass tracking (Phases 9-18; use the templates)

| # | Window | Branch | Impl status | QA status | Notes |
|---|---|---|---|---|---|
| 9 | Spellbook | | not-started | not-started | template-validate first |
| 10 | Bags | | not-started | not-started | single-pointer drag, inspect dialog |
| 11 | Character | | not-started | not-started | preview-canvas DOM/text equiv |
| 12 | Talents | | not-started | not-started | keyboard tree nav |
| 13 | QuestLog | | not-started | not-started | |
| 14 | Social | | not-started | not-started | online-status live region |
| 15 | Trade | | not-started | not-started | modal focus-trap |
| 16 | Market | | not-started | not-started | number formatters |
| 17 | Arena | | not-started | not-started | match-state live region |
| 18 | Options | | not-started | not-started | hosts theme/text-scale/Reader-Mode controls |

## Per-phase deliverables and acceptance

### Phase 1 - Design-token system + dark-fantasy palette
- [ ] Primitive + semantic CSS custom properties formalized from the existing :root set.
- [ ] Dark-fantasy semantic palette (dark slate, gold trim, parchment, crest) defined as tokens.
- [ ] QUALITY_COLOR (src/ui/icons.ts:1358) migrated to --quality-* tokens; canvas painter reads them via a cached readToken() (no per-frame getComputedStyle).
- [ ] --text-scale multiplier scaffold in place (not yet wired to UI).
- [ ] tests/tokens.test.ts (tokens resolve; quality mapping intact); harness + perf gate green; visuals re-baselined with reviewed diff.

### Phase 3 - A11y interaction foundation on HudContext
- [ ] Input-mode gate (game-input vs UI-focus) + text-input guard + KeyboardEvent.code movement; never swallows movement/hotkeys in normal play.
- [ ] Shared modal helper: focus-trap, inert background, Escape stack, focus restore on close, on HudContext.
- [ ] Roving-tabindex utility with t() labels.
- [ ] Announcer singleton + live-region infrastructure (polite/assertive, coalescing), gated by a Reader-Mode flag (off by default).
- [ ] tests/a11y/*.test.ts unit-cover each utility; axe assertions; harness + perf gate green.

### Phase 5 - Mobile + pointer foundation
- [ ] index.html line 5 user-scalable=no removed; pinch-zoom restored (WCAG 1.4.4/1.4.10).
- [ ] env(safe-area-inset-*) applied to every edge-anchored HUD element.
- [ ] Target-size tokens (>=24px AA, larger for primary touch controls) applied.
- [ ] Single-pointer alternative utility for drags and pinch-zoom (WCAG 2.5.7/2.5.1).
- [ ] Mobile screenshot scripts pass at a phone viewport; harness green.

### Phase 7 - Persistent chrome visual + a11y pass
- [ ] Unit/target/party frames, action bar, cast bar, auras restyled to the aesthetic via tokens.
- [ ] Action bar uses roving tabindex with t() slot labels (keybind + ability name).
- [ ] Canvas surfaces (minimap, FCT) get a hidden DOM/live-region text equivalent.
- [ ] Contrast/target-size to AAA where feasible; reduced-motion honored on FCT.
- [ ] Per-frame budget preserved (cached token reads); skip rate > 0.8; visuals re-baselined with reviewed diff.

### Phase 19 - Reader Mode
- [ ] Announcer wired to target/HP/cast/cooldown/loot with coalescing/throttling.
- [ ] Assists: soft-target, directional earcons, click-to-move/click-cast paths confirmed.
- [ ] All menus fully SR-navigable; manual screen-reader pass recorded.
- [ ] Reader Mode is opt-in (Options toggle); off by default; no per-frame cost when off.

### Phase 21 - Themes + text-scale + reduced-motion
- [ ] High-contrast theme + Okabe-Ito colorblind palettes as semantic token sets, swapped via data-theme on the HUD root.
- [ ] Theme picker + text-scale control + Reader-Mode toggle in Options (all t() labels).
- [ ] prefers-reduced-motion + in-game toggle fully honored across HUD motion.

### Phase 23 - AAA conformance pass
- [ ] AAA criteria audited (e.g. 1.4.6 7:1 where feasible); conflicts resolved in favor of legibility.
- [ ] axe + manual audit clean to the committed level; documented where AAA was not feasible and why.

### Phase 25 - Edit Mode core
- [ ] Drag-reposition of HUD windows/elements with grid snap and bounds clamping.
- [ ] Keyboard-accessible repositioning (arrow-key nudge) and an Escape-to-exit.
- [ ] Reads the modular window registry via HudContext; no IWorld change.

### Phase 27 - Edit Mode layouts + persistence
- [ ] Save/load/reset named layouts; default layout restorable.
- [ ] localStorage persistence with a round-trip test (server sync remains OPEN).

## QA phase checklists (per QA phase)
- [ ] Every deliverable + acceptance criterion met.
- [ ] axe-core a11y assertions green; manual SR pass for a11y-heavy phases.
- [ ] Playwright MCP walkthrough: switch locale (no English leak), toggle themes/text-scale/Reader Mode.
- [ ] Visual baselines re-baselined ONLY with a reviewed diff; no unintended pixel drift.
- [ ] Tests added; dead code/imports removed; i18n guard + tsc green; perf skip rate > 0.8.

## Notes (filled after each phase)
- (none yet)
