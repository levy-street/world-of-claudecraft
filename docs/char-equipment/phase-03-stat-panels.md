# Phase 3: Stat panels

Goal: the right-hand column of the Equipment tab renders the six panels in the locked order (Attributes, Combat, Defense, Progression, Specialization, Gathering), each with an icon section header, populated from the Phase 1 `char_panels_view` models and the existing stat-cell/tooltip machinery.

## Design contract

### 1. Markup (in `char_window.ts`, filling the Phase 2 `char-panels` mount)

Panel skeleton (repeat per section):

```
.char-panel
  .char-panel-header        (svg icon + t('hudChrome.character.sections.<id>'))
  .char-panel-body
```

- **Attributes / Combat / Defense**: two-column stat grids of `deps.statCellHtml(stat)` cells, in the LOCKED order from `ATTRIBUTE_PANEL_STATS` / `COMBAT_PANEL_STATS` / `DEFENSE_PANEL_STATS`. Column flow: fill down the left column first, then the right (mockup order: Strength/Agility/Stamina/Intellect/Spirit left, Armor/Attack Power/Damage per sec/Crit Chance/Dodge right; that is exactly the array order split in half, ceil on the left). Stat cells keep their existing lazy tooltips (the `deps.statTooltipHtml` wiring); do not fork a second stat-cell renderer, reuse `deps.statCellHtml`.
- **Progression**: rows for Total XP (`formatNumber(model.totalXp)`), Virtual Level (`formatNumber(model.virtualLevel)`), Prestige Rank (render only when `model.prestigeRank > 0`), then a level-XP bar using the frame grammar `.bar` > `.bar-fill` with width percent from `model.levelXp / model.levelXpMax` (painter computes percent, CSS owns colors) and a centered label `formatNumber(levelXp) / formatNumber(levelXpMax)` (reuse the existing xp_bar label key if one exists; otherwise `hudChrome.character.progression.xpLabel` with `{current}` and `{max}` tokens). At `model.atMaxLevel`: full bar, no label division by zero.
- **Specialization**: one row: when `specId` is null, `t('hudChrome.character.spec.none')` + a `.btn.is-primary` button labeled `t('hudChrome.character.spec.choose')`; when set, the localized spec name (resolve via the same surface `talents_window.ts` uses for spec names, read it first; never the raw id) + a plain `.btn` labeled `t('hudChrome.character.spec.change')`. Both buttons call `deps.openTalents()`.
- **Gathering**: reuse the existing `gatheringHtml()` path (`buildGatheringProficiencyRows`), restyled into the panel body; keep its existing keys.

### 2. New dep + Hud wiring

`CharWindowDeps` gains `openTalents(): void`. Wire in `hud.ts` at the CharWindow construction site (3708-3751) to the same toggle the talents keybind uses (find `toggleTalents` or equivalent near `toggleChar`). Thin wiring only; no new Hud logic.

### 3. Section icons

`src/ui/ui_icons.ts`: reuse existing glyphs where they fit (`attack` for Combat, `talents` for Specialization); add new 512x512 single-path `UiIconName` entries ONLY for the sections lacking a fit (expect: `attributes` (a fist or torso glyph), `shield` (Defense), `banner` or `star` (Progression), `leaf` (Gathering)); at most 4 new names. Follow the existing path style (fill from `currentColor`, no hardcoded colors).

### 4. CSS

Extend the Phase 2 `/* ---------- char equipment tab ---------- */` section (or a sibling `/* ---------- char stat panels ---------- */` banner): `.char-panel`, `.char-panel-header` (gold display-font header, icon tinted via `currentColor`, hairline under it from `--panel-edge`), the two-column stat grid (reuse the existing `.char-stats` cell styling as base; consolidate rather than duplicate), progression rows + bar, spec row + button spacing, gathering rows. Tokens only. The panels column scrolls with the window body (no inner scrollbar).

### 5. i18n (all in `hud_chrome.ts`, M16 fills for every wordy value)

`hudChrome.character.sections.attributes|combat|defense|progression|specialization|gathering`, `hudChrome.character.progression.totalXp|virtualLevel|prestigeRank` (+ `xpLabel` only if no existing xp_bar label key is reusable), `hudChrome.character.spec.none|choose|change`. English values: "Attributes", "Combat", "Defense", "Progression", "Specialization", "Gathering", "Total XP", "Virtual Level", "Prestige Rank", "No specialization chosen", "Choose", "Change". All wordy per M16 (assume yes for all): five non-Latin fills each, per the `hud_chrome.ts:224-229` precedent.

### 6. Tests

- Extend `tests/char_window.test.ts` (or a focused new describe in `tests/char_window_frame.test.ts`, follow where the body-grammar assertions live): six panels present in locked order; stat grids contain exactly the locked StatId cells in order; prestige row hidden at rank 0 and shown at rank 2; spec row switches between none-state + Choose and name + Change; both buttons call `deps.openTalents`; bar width percent correct for a known model; max-level renders without NaN.
- The no-magic-values scan must stay green (no literal colors/px in the new painter code).

## Starter Prompt

```
This is Phase 3 of the Character Equipment Screen feature: Stat panels.

Model: Opus 4.8, xhigh effort. Harness: Claude Code. No ultracode.

Goal: render the six right-hand panels (Attributes, Combat, Defense, Progression, Specialization,
Gathering) with icon headers, from the Phase 1 models, fully tested and localized.

STEP 0 - PRE-FLIGHT: git status clean, feat/char-equipment, Phase 2 QA PASS per progress.md.
Read docs/char-equipment/state.md yourself.

STEP 1 - LOAD CONTEXT:
Spawn one Explore agent to read and summarize:
- docs/char-equipment/phase-03-stat-panels.md (this file)
- src/ui/char_window.ts (current state after Phase 2) + its two test files
- src/ui/char_panels_view.ts + its test (the Phase 1 contract as landed)
- src/ui/hud.ts: the CharWindow deps construction (search "new CharWindow"), statCellHtml wiring,
  and the talents-window toggle method name
- src/ui/talents_window.ts: how spec display names are resolved (the exact call)
- src/ui/gathering_view.ts + the current gatheringHtml in char_window.ts
- src/ui/xp_bar.ts: existing label keys
- src/ui/ui_icons.ts: UiIconName + one path entry as a style reference
- src/styles/components.css: the Phase 2 char section + .bar/.bar-fill rules (around 9574)
Return: the deps-bag shape, spec-name resolution call, toggle method name, existing xp label keys,
icon entry style, and where the body-grammar test assertions live.

STEP 2 - EXECUTE (inline or two agents: panels-agent for markup+CSS+tests, i18n-agent for
keys+fills+icon glyphs; fan out only if both slices stay independent):
Implement the design contract exactly. Write the panel-grammar tests first where practical.

INVARIANTS IN PLAY:
- Stat-id lists and panel order are LOCKED (state.md decision 5); reuse deps.statCellHtml,
  never a second stat renderer.
- Painter: no literal colors/px in TS; t() + esc() everywhere; formatNumber for every number.
- CSS tokens only, ten-dash banners; panels scroll with the window body.
- i18n: hud_chrome.ts, no as const, M16 five non-Latin fills for every wordy value.
- openTalents is thin Hud wiring to the EXISTING talents toggle.
- No em/en dashes or emojis. Nothing under src/sim, src/net, server, src/world_api*.

OUT OF SCOPE: bags section (Phase 4), Overview tab content (Phase 5), mobile CSS (Phase 6),
ranged/hit/block/parry/resistance rows (dropped by locked decision 1).

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit
- npx vitest run tests/char_window.test.ts tests/char_window_frame.test.ts tests/char_panels_view.test.ts tests/architecture.test.ts
- npx vitest run tests/localization_fixes.test.ts tests/i18n_completeness.test.ts
- npx vitest run tests/css_corpus.test.ts tests/css_value_validity.test.ts
- npm run ci:changed
- node scripts/char_equipment_shot.mjs and eyeball the desktop shot: six panels, readable, tooltips
  work when driven manually via npm run dev
- qa-checklist agent (COVERAGE prompt).

STEP 4 - COMMIT CADENCE:
- feat(ui): character stat panels with icon section headers
- feat(ui): specialization and progression panel rows with talents shortcut
- docs(char): mark phase 3 complete

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] Six panels, locked order, locked stat cells, working tooltips
- [ ] Progression numbers agree with the HUD XP bar for the same character
- [ ] Spec row both states + button opens the talents window (verified in the running app)
- [ ] Prestige row hidden at 0
- [ ] All new keys filled in the five non-Latin locales; localization suites green
- [ ] Full validation list green

STEP 6 - DOC UPDATES: progress.md; state.md (final key list, icon names added).

STEP 7 - FINAL RESPONSE: status, files, validation, verdicts, handoff for Phase 3 QA.

STOPPING RULES:
- Stop and ask if spec display names cannot be resolved without importing talents_window into
  char_window (a shared pure helper may need extracting; propose it first).
```

## QA Starter Prompt

```
This is Phase 3 QA of the Character Equipment Screen feature: verify the stat panels.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

STEP 0: git status clean. Read docs/char-equipment/state.md.
STEP 1: Explore agent: phase-03 file, progress.md, the Phase 3 diff, the touched tests.
STEP 2 - AUDIT (parallel, COVERAGE):
Correctness agent: panel order + stat lists vs locked decision 5 (literal comparison);
progression vs xp_bar agreement at a real mid-level character (drive the app); spec both states;
prestige gating; no forked stat renderer; openTalents wiring is thin.
Test-coverage agent: decisive pins for panel order and stat lists; both spec states asserted;
max-level bar case present; no-magic-values scan still meaningful.
i18n agent: every new key + its five fills; no English left byte-identical in non-Latin locales
beyond brand leaves; formatters used for all numbers.
STEP 3 - FIX all BLOCKING/SHOULD-FIX; rerun validation; commit fixes.
STEP 4: progress.md + state.md updates; commit.
STEP 5 - FINAL RESPONSE: verdict, counts, handoff for Phase 4.
```
