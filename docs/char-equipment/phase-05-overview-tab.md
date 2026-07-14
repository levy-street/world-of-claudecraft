# Phase 5: Overview tab

Goal: the OVERVIEW tab carries everything the old sheet showed that the Equipment tab no longer does: identity strip (portrait chip, name, level/class, archetype title, hobby craft), talent/spec summary, prestige/milestones, and the share-card button. Nothing the old window displayed is lost.

## Design contract

### 1. Content inventory first

Before writing markup, diff the OLD window body (git show the pre-Phase-2 `char_window.ts`, `render()` at 209-267) against what the Equipment tab now renders. Every element of the old body must be accounted for in exactly one of: the new titlebar (name, level/class), the Equipment tab (paperdoll, stats, gathering, bags mount), or this Overview tab. Expected Overview set:
- Identity strip: `portraitChipHtml`, character name, archetype title row, hobby craft row (the level/class line moved to the titlebar subtitle; do not duplicate it here unless the strip looks broken without it, in which case keep it and note the duplication in progress.md).
- Talent summary: the existing `deps.talentSummaryHtml()` block, plus a button to `deps.openTalents()` (reuse the Phase 3 dep and its keys).
- Prestige / milestones: whatever the old sheet rendered from `deps.progressionHtml()` that Phase 3's Progression panel does not already show (compare the two outputs; keep only the non-duplicated parts here, e.g. milestones/prestige actions).
- Share card: the existing share-card button and flow, unchanged.

### 2. Mechanics

- Fill the Phase 2 Overview placeholder container; render lazily on first tab activation is optional (cold path; simple always-render is fine).
- Tab switching via the existing frame callbacks + `applyActiveWindowTab`; default tab stays `equipment`; active tab persists for the session (the `CharWindow` field from Phase 2), resets to equipment on a fresh page load.
- Focus: switching tabs keeps focus inside the window (the tablist's roving tabindex from the frame handles the rail; verify the panel swap does not drop focus to body).
- The 3D preview lives only on the Equipment tab. Verify switching away and back re-renders the turntable (the Hud `renderPreview` dep must be called again after the Equipment panel re-mounts; the single shared canvas re-parents via setContainer).

### 3. Tests

Extend `tests/char_window_frame.test.ts`:
- tab rail: two tabs, correct order, equipment default, `aria-selected`/`aria-controls` wiring, switch swaps panels;
- content accounting: every old-body landmark (identity strip, talent summary, share button, gathering, stat grid, paperdoll) asserted present in its NEW home (one test per landmark, so a future regression names the lost piece);
- preview re-mount: after switching overview -> equipment, `deps.renderPreview` was called again.

### 4. i18n

Expect zero or near-zero new keys (content migrates with its existing keys). If a heading is needed for the talent/identity sections, add `hudChrome.character.sections.identity` / reuse `sections.specialization`. M16 fills for anything wordy.

## Starter Prompt

```
This is Phase 5 of the Character Equipment Screen feature: Overview tab.

Model: Opus 4.8, xhigh effort. Harness: Claude Code. No ultracode.

Goal: migrate identity, talent summary, prestige/milestones, and share card into the Overview
tab; prove nothing from the old sheet was lost; preview survives tab round-trips.

STEP 0 - PRE-FLIGHT: git status clean, feat/char-equipment, Phase 4 QA PASS per progress.md.
Read docs/char-equipment/state.md yourself.

STEP 1 - LOAD CONTEXT:
Spawn one Explore agent to read and summarize:
- docs/char-equipment/phase-05-overview-tab.md (this file)
- The OLD render() body: git show <pre-phase-2-commit>:src/ui/char_window.ts (lines ~200-270);
  find the commit via git log -- src/ui/char_window.ts (last commit before the Phase 2 ones)
- src/ui/char_window.ts (current) + tests/char_window_frame.test.ts
- src/ui/hud.ts: talentSummaryHtml, progressionHtml, share-card deps (in the CharWindow wiring)
- src/ui/portrait_chip.ts (portraitChipHtml surface)
Return: the complete old-body element inventory vs the current equipment-tab inventory (the
migration delta this phase must cover), and the share-card flow's deps.

STEP 2 - EXECUTE (inline, single slice):
1. Write the content-accounting tests first (they fail on the missing Overview pieces).
2. Fill the Overview panel per the contract; wire tab-switch preview re-mount.
3. Green the tests; drive the real app: switch tabs repeatedly, confirm turntable returns,
   share card still generates, archetype/hobby rows correct, focus stays trapped.

INVARIANTS IN PLAY:
- Nothing the old sheet displayed is lost (the accounting tests are the proof).
- Preview: single WebGL context; only the Equipment tab hosts it; re-mount on return.
- Existing i18n keys migrate untouched; any new heading follows M16.
- Painter no-magic-values; CSS tokens (extend the char banner sections); no em/en dashes/emojis.
- Nothing under src/sim, src/net, server, src/world_api*.

OUT OF SCOPE: mobile CSS (Phase 6), new Overview-only features (nothing beyond migration).

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit
- npx vitest run tests/char_window.test.ts tests/char_window_frame.test.ts tests/char_view.test.ts tests/char_panels_view.test.ts tests/char_bags_view.test.ts tests/architecture.test.ts
- npx vitest run tests/localization_fixes.test.ts tests/i18n_completeness.test.ts (if any key moved/added)
- npx vitest run tests/css_corpus.test.ts tests/css_value_validity.test.ts (if CSS changed)
- npm run ci:changed
- node scripts/char_equipment_shot.mjs plus a manual overview-tab shot into tmp/
- qa-checklist agent (COVERAGE prompt).

STEP 4 - COMMIT CADENCE:
- feat(ui): overview tab with identity, talents, prestige, and share card
- test(ui): content-accounting coverage for the character window tabs
- docs(char): mark phase 5 complete

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] Every old-sheet landmark asserted present in its new home (accounting tests green)
- [ ] Tab round-trip restores the 3D preview; share card works; focus stays trapped
- [ ] Equipment stays the default tab; full validation list green

STEP 6 - DOC UPDATES: progress.md; state.md.

STEP 7 - FINAL RESPONSE: status, files, validation, verdicts, handoff for Phase 5 QA.

STOPPING RULES:
- Stop and ask if any old-sheet element has no sensible home (do not silently drop content).
```

## QA Starter Prompt

```
This is Phase 5 QA of the Character Equipment Screen feature: verify the Overview tab.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

STEP 0: git status clean. Read docs/char-equipment/state.md.
STEP 1: Explore agent: phase-05 file, progress.md, Phase 5 diff, the frame test file, and the
pre-Phase-2 render() body (git show) for an independent content inventory.
STEP 2 - AUDIT (parallel, COVERAGE):
Correctness agent: independently rebuild the old-vs-new content accounting from git history and
verify NOTHING is unaccounted for; tab round-trip preview behavior in the running app; no level/
class duplication between titlebar and identity strip (or a progress.md note if kept).
Test-coverage agent: one decisive assertion per landmark; preview re-mount asserted via the dep
call, not a smoke check; default-tab pin present.
STEP 3 - FIX all BLOCKING/SHOULD-FIX; rerun validation; commit fixes.
STEP 4: progress.md + state.md; commit.
STEP 5 - FINAL RESPONSE: verdict, counts, handoff for Phase 6.
```
