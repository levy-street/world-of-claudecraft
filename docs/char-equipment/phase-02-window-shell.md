# Phase 2: Window shell (tabs, titlebar, paperdoll layout)

Goal: the window LOOKS like the mockup's skeleton: tabbed frame (EQUIPMENT default, OVERVIEW stub), titlebar with name + level/class subtitle + money chips, and the new paperdoll layout (slot columns flanking the model panel, bag sockets on top, pedestal styling). Stat panels (Phase 3), embedded bags (Phase 4), and Overview content (Phase 5) come later; leave clearly-bannered mount points.

## Design contract

### 0. BEFORE screenshots (do this before any code change)

Create `scripts/char_equipment_shot.mjs` modeled directly on `scripts/mobile_char_window_shot.mjs` (same boot idiom: `BROWSER_PATH` from `./browser_path.mjs`, `npm run dev` at :5173, `enterOfflineGame`, god-mode, open the char window). It must produce four shots: desktop 1600x740, desktop 1280x800, mobile portrait 390x844 isMobile, mobile landscape 844x390 isMobile, into `tmp/`. Run it against the UNCHANGED window; copy the 1600x740 and mobile-portrait shots to `docs/screenshots/char-equipment-before-desktop.png` and `docs/screenshots/char-equipment-before-mobile.png`; commit them with the script. Memory gotchas: teleport to open ground for the world behind the window; headless Chrome never grants pointer lock (not needed here); use Chrome not Edge.

### 1. Window frame extension (shared, benefits every window)

`src/ui/window_frame_view.ts`: extend the model so the titlebar can carry an optional subtitle (under the title, same column) and an optional right-side accessory region (between title area and close button):

```ts
export interface WindowFrameDescriptor {
  id: string; titleKey: string;
  subtitle?: boolean;        // when true the model emits a subtitle node id + aria wiring
  titleAccessory?: boolean;  // when true the model emits an accessory container id
  tabs?: ...; footer?: ...; modal?: ...; closable?: ...; closeLabelKey?: ...;  // unchanged
}
```

`src/ui/window_frame.ts` (`renderWindowFrame` deps): two new optional hooks the builder calls when the descriptor opts in:

```ts
subtitleHtml?: () => string;        // rendered inside the subtitle node, painter escapes content
titleAccessoryHtml?: () => string;  // rendered inside the accessory container
```

Rules: additive only; every existing window (no `subtitle`/`titleAccessory` in its descriptor) renders byte-identically, and all existing `tests/*_frame.test.ts` suites stay green untouched. Update `tests/window_frame_view.test.ts` + `tests/window_frame.test.ts` with: opted-out = absent nodes, opted-in = correct ids/classes/order (title column, accessory, then close), `relocalizeWindowFrame` refreshes both new regions. Accessory must not steal the drag-handle behavior of the titlebar and must not be inside the close button's hit area.

### 2. CHAR_FRAME tabs + titlebar content

In `src/ui/char_window.ts`:
- `CHAR_FRAME` gains `subtitle: true`, `titleAccessory: true`, and `tabs: [{ id: 'equipment', labelKey: 'hudChrome.character.tabs.equipment' }, { id: 'overview', labelKey: 'hudChrome.character.tabs.overview' }]` (match the tab-descriptor shape used by `talents_window.ts`/`vendor_window.ts`; read one of them first).
- Title stays the character name (existing behavior); `subtitleHtml` = the existing localized level/class line (`itemUi.equipment.levelClass`, `esc()`d, numbers via `formatNumber`); `titleAccessoryHtml` = `deps.moneyHtml(deps.world.copper)`.
- Tab state: `activeTab: 'equipment' | 'overview'` field on `CharWindow`, default `'equipment'`, switched via the frame's tab callbacks + `applyActiveWindowTab`; re-render the body on switch. Overview panel content this phase: a single bannered placeholder container (Phase 5 fills it); keep it empty of copy (no placeholder prose, no TODO strings in player-visible text).

### 3. Equipment tab paperdoll layout

Rebuild the equipment tab markup in `char_window.ts` (still innerHTML, cold path):
- Grid: paperdoll region (this phase) + a `char-panels` mount (empty this phase) + a `char-bags` mount (empty this phase).
- Paperdoll: `.paperdoll` becomes a three-column arrangement: left `.equip-col` (5 slots from `view.left`), center `.char-model-panel` (keep `#char-model-preview` and `#char-skin-row` ids EXACTLY, the Hud preview mount depends on them), right `.equip-col` (6 slots from `view.right`). Above the model panel: the bag-socket row (`view.bagSockets`, 4 cells, equipped bag icon + rarity border or empty style). Slot cells: square `.item-cell`-family cells with the slot name label OUTSIDE the cell (left column labels to the left, right column to the right, matching the mockup), item icon via `deps.itemIcon`/`iconDataUrl('item','slot_empty')`, rarity border via `data-quality`, tooltip via `deps.attachTooltip` + `deps.itemTooltip`.
- Keep ALL existing unequip affordances on the new cells (corner-x button, right-click, drag-to-unequip via `deps.beginUnequipDrag`/`endUnequipDrag`): the "(sacred)" test block in `tests/char_window_frame.test.ts` must keep passing with only selector updates.
- Bag-socket cells this phase are display + tooltip only (unequip-bag interaction arrives with the embedded grid in Phase 4).

### 4. CSS

New section in `src/styles/components.css` under `/* ---------- char equipment tab ---------- */` (ten dashes): the three-column paperdoll grid, slot cell + outside label, bag-socket row, model panel arch + pedestal treatment (gradient/border tokens only; reuse `--panel-*`, `--color-border-*`, `--gold*`, `--slot-cell`, `--radius-*`, quality tokens), the two empty mounts. Update the existing `.paperdoll`/`.equip-col` rules in place (components.css 1059-1172) rather than stacking overrides. Do not touch `hud.mobile.css` yet (Phase 6) beyond keeping the existing mobile rules from visibly breaking; if the old mobile selectors no longer match, add the minimal compatibility selectors and note it in progress.md for Phase 6.

### 5. i18n

New keys in `src/ui/i18n.catalog/hud_chrome.ts`: `hudChrome.character.tabs.equipment` = "Equipment", `hudChrome.character.tabs.overview` = "Overview". Both are wordy (M16): add the five non-Latin fills in the same change, following the precedent at `hud_chrome.ts:224-229`. Slot names reuse the existing `deps.slotName` keys; add a key only if a bag-socket label needs one (`hudChrome.character.bagSocket` aria label, with fills).

## Starter Prompt

```
This is Phase 2 of the Character Equipment Screen feature: Window shell.

Model: Opus 4.8, xhigh effort. Harness: Claude Code. No ultracode.

Goal: before-screenshots, the shared frame subtitle/accessory extension, EQUIPMENT/OVERVIEW tabs,
and the new paperdoll layout with pedestal styling; stat-panel and bags mounts left empty.

STEP 0 - PRE-FLIGHT:
- git status clean, branch feat/char-equipment, Phase 1 QA reported PASS (check progress.md).
- Memory scan: preview_start serves the original checkout (run the dev server from THIS checkout);
  headless pointer-lock and sightline gotchas; play.html parity note (markup is JS-generated, no
  double edit).
- Read docs/char-equipment/state.md yourself.

STEP 1 - LOAD CONTEXT:
Spawn one Explore agent to read and summarize:
- docs/char-equipment/phase-02-window-shell.md (this file)
- src/ui/char_window.ts (whole, 351 lines) + tests/char_window.test.ts + tests/char_window_frame.test.ts
- src/ui/window_frame_view.ts + src/ui/window_frame.ts + their two test files
- One existing tabbed window for the tab-descriptor shape (src/ui/talents_window.ts)
- src/ui/hud.ts lines 3700-3760 (CharWindow deps wiring) and 11690-11770 (toggleChar, mountCharPreview)
- src/styles/components.css lines 1050-1180 and 2570-2660 (current char CSS) and 9040-9600 (frame grammar)
- scripts/mobile_char_window_shot.mjs (whole) + scripts/CLAUDE.md
- src/ui/i18n.catalog/hud_chrome.ts lines 200-260 (the M16 fill precedent)
Return: frame descriptor/tab mechanics, the sacred unequip test's exact selectors, the deps bag
surface, the shot-script boot idiom, and the current char CSS class inventory.

STEP 2 - EXECUTE, in this order:
A. FIRST: create scripts/char_equipment_shot.mjs and capture + commit the BEFORE screenshots
   (docs/screenshots/char-equipment-before-desktop.png, -before-mobile.png) from the unchanged UI.
B. Then fan out two agents in parallel:
   - frame-agent: the window_frame_view/window_frame subtitle + accessory extension + its tests
     (additive; all existing *_frame tests stay green untouched).
   - paperdoll-agent: char_window.ts tabs + titlebar content + equipment-tab layout + the
     components.css section + the two i18n keys with their five non-Latin fills each.
   The paperdoll-agent depends on the frame-agent's API; give it the contract signatures from
   this file so they can work in parallel against the agreed interface.
C. Integrate, then verify in the real app: npm run dev, open the window with KeyC, check tabs,
   subtitle, money chips, all 11 slots + 4 bag sockets, preview turntable still renders and
   drag-rotates, unequip flows work (corner-x, right-click, drag onto the bags window).

INVARIANTS IN PLAY:
- #char-window root stays pristine; frame on the inner mount; open state remains display 'block'.
- #char-model-preview and #char-skin-row ids unchanged (Hud preview mount).
- The sacred unequip flows keep working; update test selectors, never delete assertions.
- Painter: no raw hex/px/color in TS; all strings t() + esc(); numbers formatNumber; money moneyHtml.
- CSS: tokens only, ten-dash banner, edit the existing char rules in place.
- i18n: hud_chrome.ts, no as const, M16 fills for wordy values (follow the :224-229 precedent).
- No em dashes / en dashes / emojis. No changes under src/sim, src/net, server, src/world_api*.

OUT OF SCOPE: stat panels (Phase 3), embedded bags grid + bag-socket interactions (Phase 4),
Overview content (Phase 5), hud.mobile.css redesign (Phase 6).

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit
- npx vitest run tests/char_view.test.ts tests/char_window.test.ts tests/char_window_frame.test.ts tests/window_frame_view.test.ts tests/window_frame.test.ts tests/architecture.test.ts
- npx vitest run tests/*_frame.test.ts   (the shared builder changed: every window's frame suite)
- npx vitest run tests/localization_fixes.test.ts tests/i18n_completeness.test.ts
- npx vitest run tests/css_corpus.test.ts tests/styles_extraction.test.ts tests/css_value_validity.test.ts tests/per_entry_css_wiring.test.ts
- npm run ci:changed
- node scripts/char_equipment_shot.mjs (visual sanity, tmp/ output)
- Spawn the qa-checklist agent (COVERAGE prompt). No sim/server/net reviewers (pure UI diff).

STEP 4 - COMMIT CADENCE:
- test(ui): add char equipment screenshot script and before shots
- feat(ui): window frame subtitle and titlebar accessory extension
- feat(ui): tabbed character window shell with new paperdoll layout
- docs(char): mark phase 2 complete

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] Before screenshots committed under docs/screenshots/ (captured from the PRE-change UI)
- [ ] Frame extension additive: descriptors without the new flags render byte-identically; all frame suites green
- [ ] Window shows: name title, level/class subtitle, money chips, EQUIPMENT/OVERVIEW tabs (equipment default)
- [ ] Paperdoll: left 5 / right 6 slots with outside labels, 4 bag sockets on top, model panel with pedestal styling, preview rotates
- [ ] Corner-x, right-click, and drag unequip all work; sacred test green
- [ ] Both i18n keys present with five non-Latin fills each; localization suites green
- [ ] Full validation list green

STEP 6 - DOC UPDATES: progress.md, state.md (record the final frame-extension API and any
mobile-compat selectors added for Phase 6).

STEP 7 - FINAL RESPONSE: status, files, validation, verdicts, handoff line for Phase 2 QA.

STOPPING RULES:
- Stop and ask if the frame extension cannot be made without behavior changes to existing windows.
- Stop and ask if the sacred unequip test needs assertion DELETIONS (selector updates are fine).
```

## QA Starter Prompt

```
This is Phase 2 QA of the Character Equipment Screen feature: verify the window shell.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: audit tabs, titlebar, frame extension, paperdoll layout, screenshots, i18n fills.

STEP 0: git status clean. Read docs/char-equipment/state.md.

STEP 1: Explore agent reads phase-02-window-shell.md, progress.md, the Phase 2 diff, and the
frame + char test files. Return contract-vs-landed comparison.

STEP 2 - AUDIT (parallel, COVERAGE prompts):
Correctness agent:
- Frame extension is additive (diff existing windows' rendered markup: pick two, e.g. bags +
  talents, assert no change); accessory not draggable-conflicting, not inside close hit area.
- Paperdoll arrangement matches locked decision 2 exactly; preview ids intact; unequip flows
  exercised in the real app (npm run dev + manual/script drive).
- Before-screenshots are genuinely pre-change (verify capture commit precedes layout commits).
Test-coverage agent (or test-coverage-auditor):
- New frame model/test assertions decisive; tab a11y assertions (roles, aria-controls) present;
  sacred block intact (assertions preserved, selectors only).
i18n agent (small): keys, fills present for all five locales, no as const, esc() on names,
run tests/localization_fixes.test.ts + tests/i18n_completeness.test.ts.

STEP 3 - FIX all BLOCKING and SHOULD-FIX; rerun Phase 2 validation. Commit fixes.

STEP 4: Update progress.md + state.md. Commit.

STEP 5 - FINAL RESPONSE: verdict, counts, handoff line for Phase 3.
```
