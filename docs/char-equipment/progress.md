# Progress: Character Equipment Screen

## Status table

| Phase | Status | Started | Completed |
|---|---|---|---|
| Phase 1: Pure view cores | complete | 2026-07-11 | 2026-07-11 |
| Phase 1 QA | not started | | |
| Phase 2: Window shell | complete | 2026-07-11 | 2026-07-11 |
| Phase 2 QA | not started | | |
| Phase 2b: Preview pedestal + equipment seam | complete | 2026-07-11 | 2026-07-11 |
| Phase 2b QA | not started | | |
| Phase 3: Stat panels | complete | 2026-07-11 | 2026-07-12 |
| Phase 3 QA | not started | | |
| Phase 4: Embedded bags | complete | 2026-07-12 | 2026-07-12 |
| Phase 4 QA | not started | | |
| Phase 5: Overview tab | complete | 2026-07-12 | 2026-07-12 |
| Phase 5 QA | not started | | |
| Phase 6: Mobile + polish | not started | | |
| Phase 6 QA (final) | not started | | |

## Phase 1: Pure view cores

- [x] `char_view.ts`: `PAPERDOLL_LEFT_SLOTS` = `['helmet','neck','shoulder','chest','gloves']`, `PAPERDOLL_RIGHT_SLOTS` = `['mainhand','waist','legs','feet','ring1','ring2']`
- [x] `char_view.ts`: `buildPaperdollView` returns `{ left, right, bagSockets }` (bag-socket model from `bags` + items)
- [x] New `src/ui/char_panels_view.ts`: panel stat-id lists + `buildProgressionPanel` + `buildSpecPanel` (pure, instance-parameterized)
- [x] Registered in `UI_PURE_CORES` (`tests/architecture.test.ts`)
- [x] `tests/char_view.test.ts` re-pinned to the new arrays; new `tests/char_panels_view.test.ts` (Sim-shaped + ClientWorld-shaped stubs)
- [x] Validation green: the 5 targeted vitest suites (95/95 tests) and `ci:changed`
- [x] Validation green: `npx tsc --noEmit` for the WHOLE repo shows NO Phase-1 errors (only the
      6 pre-existing unrelated errors from missing optional deps `@aws-sdk`/`@capacitor` and a
      `native_discord.ts` implicit-any). The `hud.ts` TS2554 is fixed.

Notes:

- **Two call sites, both fixed.** `buildPaperdollView`'s new `bags` middle parameter had a SECOND
  call site the phase-01 design contract did not anticipate: `src/ui/hud.ts:13562`
  (`buildPaperdollView(e.equippedItems, ITEMS)`), feeding the "player inspect" popup (another
  player's read-only worn-gear mirror, `Entity.equippedItems`), beyond the `char_window.ts` call
  site the contract named. `Entity` (the inspect target) carries no `bags` field (bags are a
  private per-player `IWorldInventory` field, not mirrored for another player), so the fix passes
  an empty array: `buildPaperdollView(e.equippedItems, [], ITEMS)`. The inspect popup only reads
  `view.left`/`view.right` (its HTML has only `#inspect-equip-left`/`#inspect-equip-right`), so
  the new `bagSockets` field is ignored there and the change is behavior-preserving. This was
  flagged and applied under explicit coordinator authorization (it is a `src/ui/` mechanical
  call-site edit, same class as the authorized `char_window.ts` edit, and not one of the paths
  forbidden by locked decision 11).
  - Full validation after the fix: `npx tsc --noEmit` clean of any Phase-1 error; the 5 targeted
    vitest suites 95/95 green; `npm run ci:changed` exit 0 (its 3 warnings are pre-existing lint
    warnings elsewhere in `hud.ts`, lines 251 and 11161-11163, not from this change, and biome CI
    does not fail on lint warnings).
- **`npm run ci:changed` (`biome ci --changed`) reported "Checked 0 files"** while the touched
  files were only staged/uncommitted (even after `git add` and an explicit
  `--since=<merge-base-sha>` matching `git merge-base HEAD origin/main`), though `git diff
  --name-only <merge-base>` clearly listed them. RESOLVED: biome's `--changed` detection on this
  checkout only sees COMMITTED changes, not the working tree/index; once the two feat commits
  landed, `npm run ci:changed` correctly reported "Checked 8 files ... No fixes applied." Lesson
  for later phases: run `ci:changed` after committing, not mid-diff; a direct `npx biome check
  <file...>` still works pre-commit as a quick spot check.

## Phase 2: Window shell

- [x] BEFORE screenshots committed: `docs/screenshots/char-equipment-before-desktop.png`, `-before-mobile.png` (captured from the pre-change window, verified before any layout/CSS edit landed)
- [x] `scripts/char_equipment_shot.mjs` created (desktop 1600x740/1280x800 + mobile portrait/landscape 390x844/844x390)
- [x] `window_frame_view.ts`/`window_frame.ts`: optional subtitle + titlebar accessory (deps hooks), tests updated
- [x] `CHAR_FRAME` tabs `equipment`/`overview`; tab switching via `applyActiveWindowTab`; default `equipment`
- [x] Titlebar: name title (overwrites the static "Character" placeholder every render), level/class subtitle, money accessory
- [x] Equipment tab paperdoll layout: center model panel (arch line + plinth glow, gradient/border tokens only), flanking slot columns (5 left / 6 right, outside labels), top bag-socket row (4 cells, display+tooltip only); unequip flows intact (corner-x now overlays the icon cell itself, selector-updated only in the sacred test block)
- [x] CSS section `/* ---------- char equipment tab ---------- */` in `components.css` (tokens only); renamed from the old `/* ---------- character window ---------- */` banner (`tests/css_corpus.test.ts` manifest updated to match)
- [x] i18n: `tabs.equipment`, `tabs.overview`, `bagSocket` + M16 fills (zh_CN/zh_TW/ja_JP/ko_KR/ru_RU)
- [x] Validation green: tsc (0 errors, repo-wide), char/window frame suites (all 15 `*_frame.test.ts` + char_view/char_window/char_window_frame/architecture), css suites, localization, `ci:changed` (exit 0)

Notes:

- **Environment fix, prerequisite for any screenshot work:** `node_modules` was stale relative to `package.json` on this checkout (`@capacitor/app`/`@capacitor/browser` and, it turned out, every `@aws-sdk/*` package were declared but never installed), which broke the offline entry flow entirely (a static top-level import of the missing packages in `main.ts` 500'd, so `#btn-offline`'s click handler never wired up) and was ALSO the source of the "6 pre-existing unrelated tsc errors" the state.md validation matrix used to expect. Ran a plain `npm install` to resync; `npx tsc --noEmit` is now 100% clean repo-wide (0 errors), not just clean-of-Phase-2-errors. Future phases should expect a clean `tsc` baseline, not 6 pre-existing errors.
- **Screenshot script gotchas (both fixed in `scripts/char_equipment_shot.mjs`):** (1) the first-spawn intro cinematic holds `#ui` at `display:none` until Escape is pressed, but the intro only plays ONCE per character (persisted in `localStorage`); separate `browser.newPage()` calls from the SAME launched browser instance share that profile, so pressing Escape unconditionally on later pages instead toggled the options menu open. Fixed by checking `#ui`'s computed display before sending Escape. (2) The jewelry items used to fill the paperdoll for the shot (rings, neck) carry a level requirement `equipItem` silently enforces; the script now calls `sim.setPlayerLevel(20, ...)` before equipping, matching the `heroic_vendor_shot.mjs` precedent.
- **Frame extension is fully additive:** verified by running all 15 `tests/*_frame.test.ts` suites unmodified except `window_frame_view.test.ts`/`window_frame.test.ts` themselves (160 to 167 tests green before/after). A descriptor without `subtitle`/`titleAccessory` renders the byte-identical titlebar HTML string (no wrapper div, no accessory node).
- **Title/subtitle ordering bug caught by tests, fixed before commit:** `relocalizeWindowFrame` re-stamps the title text from the frame's stored `data-title-key` on every call; calling it AFTER overwriting `.window-title` with the player's live name silently reverted the name back to the static "Character" placeholder. Fixed by re-ordering `render()`: `relocalizeWindowFrame` first, the live-name overwrite last. A consumer adopting subtitle/accessory refresh via `relocalizeWindowFrame` inside its own `render()` should follow the same order.
- **`CharWindowDeps` left unchanged.** `hud.ts` is out of scope for this packet; the subtitle text is built entirely from existing imports already in `char_window.ts` (`classDisplayName`, `formatNumber`, `t`), and the accessory reuses `moneyHtml` (already part of the shared `PainterHostPresentation` bag `hud.ts` spreads into `CharWindowDeps`), so no new required dep was needed and `hud.ts`'s existing wiring compiles untouched.
- **Content removed from the Equipment tab this phase** (previously rendered ad hoc in `char_window.ts`, now dead until a later phase reintroduces it properly): the identity strip (portrait/name/archetype/hobby), the flat stat grid, the talent summary, the progression bar, the gathering rows, and the share-card button. `talentSummaryHtml`/`progressionHtml`/`statCellHtml`/`statTooltipHtml`/`openPlayerCard`/`openPrestige` stay declared on `CharWindowDeps` (unused this phase) so `hud.ts` needs no edit; Phase 3 (stat panels, into `#char-panels`) and Phase 5 (identity/talent/share, into the Overview tab) are expected to consume them again.
- **Mobile compat (minimal, full redesign is Phase 6):** two selectors added to `hud.mobile.css` because the paperdoll became a CSS grid (`grid-template-columns`, not flex) so the old `.equip-col { width: 108px }` alone no longer narrows the column track on phones: `body.mobile-touch .paperdoll { grid-template-columns: 108px 1fr 108px; }`, plus renaming the now-dead `.equip-slot .slot-name`/`.slot-item` mobile font-size overrides to the new merged `.slot-label` class. Everything else under `body.mobile-touch #char-window .char-stats`/`.stat-cell` is now dormant (the stat grid moved out of this file) pending Phase 3's own mobile treatment, not a regression Phase 2 caused.
- **`i18n.resolved.sha256` re-baselined** via `npm run i18n:hash -- --write` after adding the three new keys' five non-Latin fills (a real translation-content change, per `src/ui/CLAUDE.md`).

## Phase 2b: Preview pedestal + equipment seam

- [x] New `src/render/characters/pedestal.ts` (procedural, no new asset files)
- [x] `CharacterPreview.setPedestal(visible)` default off; enabled only by the char-window mount; framing unchanged; captureCloseup clean; disposal complete
- [x] `PreviewAppearance.equippedItems` + signature coverage in `tests/preview_appearance.test.ts`
- [x] `CharacterVisual.setEquipment` stores the map, delegates mainhand to the existing weapon path (weapon-only rendering today)
- [x] `Hud.mountCharPreview` passes `world.equipment` for the char-window mount; other call sites unchanged
- [x] Validation green: tsc, preview_appearance, architecture, char suites, screenshot check

Notes:

- **`preview.ts` has no dynamic Box3 camera fit** (the phase doc's "the existing fit uses the
  model's Box3" does not match the code): the live-preview camera position/lookAt are fixed
  constants set once in the constructor, never recomputed from scene bounds. Framing safety
  therefore comes from a simpler invariant that still fully satisfies the design intent:
  `setPedestal`/`buildPedestal` never touch `this.camera` at all, they only add/remove a
  `THREE.Group` to `this.scene` positioned under the model's feet, so enabling the pedestal
  cannot change how large or where the character renders. Verified visually (screenshot
  comparison) and by inspection (no camera writes in pedestal.ts or the setPedestal method).
- **Pedestal-enable scope is the `#char-model-preview` container, not one specific Hud method.**
  `renderCharPreview()` (the char-window's own mount/re-mount) AND `renderCharSkinPicker()`'s
  inline skin-swap re-mounts (its click handlers) both target the SAME `#char-model-preview`
  element inside `#char-window` (confirmed via `tests/char_window_frame.test.ts`'s existing
  comment tying both `#char-model-preview` and `#char-skin-row` to "the Phase 2b pedestal
  mount"), so both pass `{ pedestal: true, equipment: this.sim.equipment }` to
  `mountCharPreview`. Only the cosmetic skin-event overlay mount (a different container,
  `.se-preview`) and every other `CharacterPreview` consumer (`main.ts`'s pre-game char-select/
  char-create preview, an entirely separate `CharacterPreview` instance) stay default-off. This
  avoids a pedestal flicker when a player swaps skins inside an already-open char window.
- **`CharacterPreview.setEquipment` added as a thin pass-through** (mirroring the existing
  `setSkin` pattern: `this.currentVisual?.setEquipment(equipped)`), since `Hud.mountCharPreview`
  builds the visual via `setVisualKey`/`setClass` directly rather than through `setAppearance`
  (that manual path already predates this phase, driven by `activeCharacterAppearancePreview`'s
  own mech-readiness handling at the Hud layer). Calling `setEquipment` with the same mainhand
  value `setVisualKey` already applied is a verified no-op on the weapon path (`setWeapon`'s
  `weaponItemId === this.weaponItemId` guard), so this adds zero visual risk while still
  populating `CharacterVisual`'s stored equipment map for the deferred armor feature.
- **`visual.ts`'s new `equippedItems` field is write-only today** (only `setEquipment` writes
  it; no read path exists until armor-on-model lands), so it carries a
  `biome-ignore lint/correctness/noUnusedPrivateClassMembers` comment, following the existing
  precedent at `src/render/renderer.ts:824` for the same write-only-scaffolding shape.
- Commits split cleanly along the stated cadence (pedestal first, then the equipment seam)
  by temporarily reverting the equipment-seam lines from the two shared files
  (`preview.ts`, `hud.ts`) before the first commit and restoring them before the second, so
  each commit is independently `tsc`-clean and test-green at that point in history.

## Phase 3: Stat panels

- [x] Right column renders six panels in locked order with icon section headers
- [x] Attributes/Combat/Defense cells via `deps.statCellHtml` (locked StatId lists), tooltips work
- [x] Progression: Total XP, Virtual Level, Prestige (>0 only), level-XP `.bar` with label
- [x] Specialization row: spec name or none-state + Choose/Change button (`deps.openTalents`)
- [x] Gathering rows via `buildGatheringProficiencyRows`
- [x] New `UiIconName` glyphs (4 new: attributes, shield, banner, leaf; attack/talents reused)
- [x] i18n keys + M16 fills; CSS section for panels
- [x] Validation green: tsc, char suites, css suites, localization, i18n completeness

Notes:

- **Two-column stat grid is a painter-level split, not a new pure core.** `statPanelHtml`
  splits the locked `StatId[]` array in half (`Math.ceil(length/2)` left, remainder right)
  and renders two `.char-stat-col` children inside the existing `.char-stats` grid
  container (Phase 2's `grid-template-columns: 1fr 1fr` lays the two column DIVs out side
  by side unchanged); this reuses `.char-stats`'s cell hover/focus/tooltip styling verbatim
  (one new override, `.char-panel-body .char-stats`, drops its old standalone top divider
  now that a panel header/border provides the separation) instead of forking a new grid.
- **Spec name resolution: `tTalent` + `talentsFor`, not an import of `talents_window.ts`.**
  The design contract's "same surface talents_window.ts uses" is `tTalent({kind:
  'talentSpec', spec, field: 'name'})` from `talent_i18n.ts`, with the `SpecDef` object
  resolved via `talentsFor(world.cfg.playerClass)?.specs.find(s => s.id === specId)`
  (`sim/content/talents`). Both are plain data/i18n modules already imported elsewhere in
  `src/ui/` (e.g. `stat_tooltip.ts` imports `sim/data`); importing them into `char_window.ts`
  does not reach into a `*_window`/`*_painter` module and keeps the pure-core/painter seam
  intact. `hud.ts`'s own (currently unused) `talentSummaryHtml()` does the identical
  `ct.specs.find(...)` + `tTalent(...)` lookup, confirming this is the established pattern.
- **`openTalents` is one line in `hud.ts`:** `openTalents: () => this.toggleTalents()` at the
  `charWindow` deps construction site, reusing the existing 'N'-keybind toggle verbatim (no
  new Hud method, no new window-coordination logic).
- **`xpLabel` (`hudChrome.character.progression.xpLabel`, `"{current} / {max}"`) needed no
  five-locale fill.** No existing xp_bar.ts key matched the plain "current / max" format (the
  xp_bar label bundles a suffix/percent/rested text this bar doesn't want), so it's a new key;
  M16's wordy test (`/[a-z]{4,}/` after stripping `{tokens}`) leaves only `" / "`, no
  four-plus lowercase run, so it is NOT wordy and stays English-only/`pending` like any other
  non-wordy key. All eleven other new keys (six `sections.*`, three `progression.*`, three
  `spec.*`) ARE wordy and carry the five non-Latin fills.
- **Commits split along the stated cadence** (stat-grid panels first, then progression/spec/
  gathering + the talents shortcut) by temporarily stripping the second commit's lines from
  the shared files (`char_window.ts`, `hud.ts`, `ui_icons.ts`, `components.css`,
  `hud_chrome.ts`, the five locale files, the test file) before the first commit and restoring
  them before the second, mirroring the Phase 2b precedent; both commits are independently
  `tsc`-clean and test-green at their point in history.
- **Visual (live-app) verification could not be completed this session.** `npm run dev` plus
  `node scripts/char_equipment_shot.mjs` is blocked by two compounding environment issues on
  this machine/session, neither related to the Phase 3 diff: (1) a background `npm run dev`
  (via Bash) is not network-reachable from Bash/PowerShell/an external Puppeteer process, only
  the harness's own `preview_start` tunnel is; (2) the harness's own Browser-pane tab reports
  `document.hidden === true` / `visibilityState: "hidden"` even when fronted, so
  `requestAnimationFrame` never fires and `main.ts`'s `nextPaint()` (two chained RAF calls,
  awaited before the world finishes booting) hangs indefinitely, so the offline flow never
  reaches the character window in that tab. Root-caused via direct console probes (confirmed
  `ensureLocaleLoaded`/`assetsReady` both resolve instantly when called directly; RAF fires 0
  times in 3s while `document.hidden` is true). All other validation (tsc, the full targeted
  vitest suite, `ci:changed`) is green; a follow-up session with a normally-visible browser tab
  should re-run the screenshot script per the validation matrix before Phase 3 QA signs off.

## Phase 4: Embedded bags

- [x] New `src/ui/char_bags_view.ts` (container partition: backpack + equipped sockets; selector model; used/total counter) registered in `UI_PURE_CORES`
- [x] BAGS section painted under the paperdoll: header (title, counter, open-full button), selector buttons, `.item-cell` grid
- [x] Click-to-use/equip via existing world methods; tooltips; drag-to-unequip drops onto the embedded grid AND the standalone bags window still works
- [x] `tests/char_bags_view.test.ts` + painter assertions
- [x] Validation green: tsc, char suites + bags suites untouched-green, css suites, localization

Notes:

- **Screenshot/live verification, unblocked this session.** `node scripts/char_equipment_shot.mjs`
  ran clean against the warm `npm run dev` (:5173) and wrote all four shots; the standard desktop
  frame (window scrolled to the top by default) shows the paperdoll, bag-socket row, and the
  Attributes panel starting, matching Phase 3's committed layout, with no new console errors (the
  502s and THREE.BufferGeometryUtils merge warnings present in the log are pre-existing and
  unrelated to this diff, reproduced identically against the Phase 3 baseline). Because the
  window body is a single tall scrollable column and the bags section sits BELOW all six stat
  panels, a plain top-of-window shot never reaches it, so a one-off temporary script (not
  committed) equipped two bags (`linen_pouch` at socket 1, `travelers_knapsack` at socket 2) plus
  loose items, scrolled `#char-bags` into view, and captured both a screenshot and the live DOM
  facts. Confirmed live in the running app: the header renders the bags icon, "Bags" title, a
  real `"4 / 16"` counter, and an "Open bags window" control; the selector shows exactly three
  buttons (backpack `'1'` active/gold-bordered, `'2'`/`'3'` for the two occupied sockets, socket 0
  correctly excluded since it was left empty); the grid shows 16 cells for the backpack (4
  occupied with real item icons/quality borders/stack counts, matching the live inventory).
  Switching the selector, drag-to-unequip, and the right-click bag-socket unequip are additionally
  covered by the deterministic `char_window_frame.test.ts` suite (dispatch-level assertions, not
  re-proven pixel-by-pixel here). The harness's own Browser-pane tab still reproduces Phase 3's
  documented `document.hidden === true` environment quirk (RAF never fires, so the offline flow
  cannot reach the world through that tab); this verification therefore ran the same
  puppeteer-core path `char_equipment_shot.mjs` already uses, unaffected by that quirk.
- **Container partition is a VIRTUAL split of the pooled inventory, not a real per-bag
  assignment.** `src/sim/bags.ts` keeps every item in ONE flat list; equipped bags only raise the
  slot budget. `buildCharBags` (`src/ui/char_bags_view.ts`) lays a canonical cumulative-capacity
  range over that flat list, backpack first (`BACKPACK_SLOTS` wide) then each occupied socket in
  order (`bagSlotsOf(item)` wide each), mirroring the exact summation order `sim/bags.ts`'s
  `bagCapacity()` uses. A cell's `slotIndex` is the absolute index into `world.inventory` that
  virtual range resolves to; `used` counts real `InvSlot` entries within it. Never re-derived
  arithmetic: both constants are imported from `sim/bags.ts` verbatim.
- **`CharBagContainer.id` is socket-stable, `label` is positional.** `id` (`'backpack'` or
  `` `bag${socket+1}` ``) is keyed to the real socket index so a `selectedId` keeps pointing at
  the same physical bag across renders even if an earlier socket empties out. `label` (the
  selector button's plain text) is a 1-based ordinal across the containers CURRENTLY listed
  (backpack is always `'1'`, the first equipped bag `'2'`, and so on): using the socket-based
  ordinal instead would collide with the backpack's `'1'` the moment socket 0 fills.
- **Click parity mechanism: the SAME `bagItemAction` (bags_view.ts) call, always fed an all-off
  `BagMode`.** None of the standalone bags window's cross-window transactional flags (trade/
  mail/market/vendor/bank-deposit/pet-feed) can ever be true inside the character window, so the
  embedded grid's click dispatch is `bagItemAction(item, BAGS_GRID_MODE)` with a module-level
  constant `BagMode` object of all-false, in `char_window.ts`. That always resolves to one of
  `'use'`, `'equipBag'`, or `'discardQuest'`; `'use'`/`'equipBag'` execute through the identical
  world calls the standalone window's default-mode cases use (`world.useItem(id)` /
  `world.equipBag(id)`, plus the same `hideTooltip()` on equip); `'discardQuest'` is a deliberate
  no-op (see "Concerns" below). No refactor to `bags_view.ts`/`bags_window.ts` was needed: the
  parity is achieved entirely by reusing the existing exported `bagItemAction` with a fixed mode
  argument, satisfying the packet's first stopping rule (no `bags_window.ts` refactor required).
- **Second drop target mechanism: a thin new read-only dep, no change to `hud.ts`'s existing
  drop wiring.** The embedded grid (rebuilt fresh on every `render()`, since `body.innerHTML`
  is reassigned) cannot host a one-time `dragover`/`drop` listener the way the static `#bags`
  element does; instead `char_window.ts` attaches its OWN `dragover`/`dragleave`/`drop` handlers
  to the freshly-built `.char-bags-grid` element each render, reading the drag-in-progress slot
  through a new `CharWindowDeps.dragUnequipSlot(): EquipSlot | null` getter (wired in `hud.ts` as
  `() => this.dragUnequipSlot`, a ONE-LINE addition to the existing deps-wiring block, nothing
  else touched). On drop it calls the EXISTING `deps.unequip(slot)` (same dep the corner-x/
  right-click paths use, which already unequips + repaints both the char window and the
  standalone bags window) then `deps.endUnequipDrag()`. `hud.ts`'s own `#bags` dragover/
  dragleave/drop block (lines ~1723-1745) is byte-unchanged; this is a genuine EXTENSION, not a
  replacement, and stays entirely within "the deps wiring block" per the packet's second
  stopping rule.
- **Bag-socket right-click unequip: one more thin dep, same side-effect bundle as an equip
  slot.** `CharWindowDeps.unequipBag(socket: number): void`, wired in `hud.ts` to
  `this.sim.unequipBag(socket); audio.click(); this.hideTooltip(); this.renderBags();
  this.renderCharIfOpen();` (the exact same bundle the existing `unequip(slot)` dep uses for an
  equip slot, just calling `world.unequipBag` instead of `world.unequipItem`). `buildBagSocketCell`
  (`char_view.ts`'s `BagSocketView` painter in `char_window.ts`) adds a `contextmenu` listener
  only when the socket is occupied. NOTE (corrected in QA): this mirrors ONLY the right-click
  (contextmenu) ARM of an equip slot, NOT its full affordance set. The bag-socket cell is a plain
  non-focusable `<div>`; it does not have an equip slot's focusable corner-x button or its
  drag-to-unequip, so keyboard-accessible bag-socket unequip is DEFERRED to the Phase 6 a11y
  sweep (also in Deferred follow-ups + state.md Known issues).
- **`openBags()` opens, it never toggles.** `hud.ts`'s `toggleBags()` closes an already-open
  `#bags`; the embedded header's "+" control always means "show me the full window", so the new
  dep guards on `bagsWindowShown($('#bags').style.display)` before calling `toggleBags()`,
  never closing an already-open standalone window from the char sheet.
- **Real bag item id used in every fixture:** `linen_pouch` (`kind: 'bag'`, `bagSlots: 6`,
  `src/sim/content/items.ts`); `travelers_knapsack` (`bagSlots: 8`) exercises a second occupied
  socket in the pure-core tests. Both pulled through the real `ITEMS` table (`src/sim/data`), not
  a local fixture object, so the partition math is pinned against the actual content, not a value
  that could silently drift from it.
- **No `bags_view.ts` helper needed extending.** `buildBagBar`/`buildBagGrid` were read first per
  the design contract but neither fit the container-scoped partition (`buildBagGrid` applies
  `bag_filter.ts`'s search/sort, out of scope here; `buildBagBar` only reports per-socket
  occupancy/slot-count, not a cumulative virtual-index partition). `char_bags_view.ts` reuses
  `BACKPACK_SLOTS`/`bagSlotsOf` directly (from `sim/bags.ts`, the same helpers `buildBagBar`
  itself is built from) rather than duplicating or extending either `bags_view.ts` export.
- **Concern for QA: quest-item discard from the embedded grid is a deliberate no-op.** In
  default mode, `bagItemAction` can return `'discardQuest'` for a quest-kind item; the standalone
  window's arm opens a whole destroy-quantity confirmation prompt (`bags_window.ts`'s
  `installPromptDialog` machinery). The design contract's click-parity requirement is phrased as
  "click-to-use/equip", and building a duplicate destroy-confirmation modal for the embedded grid
  was judged out of scope for this phase (the acceptance criteria only test use/equip parity);
  a quest item click in the embedded grid currently does nothing. Flagging this explicitly rather
  than silently shipping it, in case QA wants it addressed as a fast-follow.
- **QA FIX (cross-window bags-repaint sync, was a flagged concern, now RESOLVED).** With BOTH
  the char window and the standalone `#bags` window open, a use/equip from the embedded grid used
  to leave the standalone `#bags` DOM stale until its next trigger. Fixed by a new thin dep
  `CharWindowDeps.renderBagsIfOpen()`, wired in `hud.ts` as `if ($('#bags').style.display !==
  'none') this.renderBags();` (repaint ONLY when shown), called from `bagCellAction`'s `'use'` and
  `'equipBag'` arms after the world mutation. This is the exact mirror of `bags_window.ts`'s own
  `renderCharIfOpen()` on its `'use'` branch, so both windows now keep each other fresh in both
  directions. Painter tests assert the dep is called on embedded use AND equipBag (and NOT called
  on the quest no-op arm). No `IWorld` surface added (thin Hud UI wiring, locked decision 11
  intact).
- **QA FIX (i18n reuse, was a flagged glossary-consistency choice, now corrected).** The embedded
  header title used to render a NEW `hudChrome.character.bags.title` = "Bags" key (with five
  non-Latin fills). That duplicated `itemUi.bags.title`, the standalone bags window's OWN title
  key (`bags_window.ts:72`), already translated in ALL 22 locales. Fixed: the header now renders
  `t('itemUi.bags.title')`; the duplicate `hudChrome.character.bags.title` key and its five
  non-Latin overlay lines were DELETED and the i18n tables regenerated (`npm run i18n:gen`,
  idempotent; the total key count dropped by one). The rendered English "Bags" is unchanged.
  Same Phase 3 lesson (reuse existing byte-identical keys) applied here.
- **QA FIX (container ordinal via formatNumber).** The selector aria-label's `{n}` used to be a
  plain `String(ordinal)`; it now routes through `formatNumber` (the
  `hudChrome.unitFrame.partyGroup` precedent). The button GLYPH text stays a plain digit; only
  the `{n}` spliced into the translated aria string is formatted.
- **Concern for QA (DEFERRED, documented): embedded-grid overflow is invisible.** `buildCharBags`
  does not surface a legacy over-capacity overflow (inventory slots PAST `BACKPACK_SLOTS` + the
  occupied sockets' summed `bagSlots`) the way the standalone grid's `BagGridModel.overflow` does.
  A pre-bag save that loaded overflowing (see `src/sim/bags.ts` header: over-capacity inventories
  are tolerated, never destroyed) would have items sitting at absolute indices beyond every
  virtual container range, so they never map to a cell and are INVISIBLE in the embedded grid. The
  standalone `#bags` window still shows them (its grid paints the whole flat inventory). Left as-is
  on purpose (avoids i18n churn on a rare legacy-save edge case); recorded in state.md Known issues
  and Deferred follow-ups. Do NOT add overflow UI now.

## Phase 5: Overview tab

- [x] Overview tab: identity strip, archetype title, hobby craft, talent summary, prestige/milestones, share-card button (all migrated, none lost)
- [x] Equipment tab contains no identity duplication; tab switch preserves focus rules
- [x] `tests/char_window_frame.test.ts` extended: tab order/aria-controls, content-accounting (one test per landmark), preview re-mount, focus-stays-inside
- [x] Validation green: tsc, char suites, localization, css
- [x] Dead-CSS cleanup: the `.char-identity`/`.char-title-text`/`.portrait-chip` rules Phase 2 orphaned in `components.css` are REUSED (re-scoped to `#char-window .window-body .char-overview > .char-identity`, not deleted)

Notes:

- **Content-inventory-first, per the design contract.** `git show fd084e250:src/ui/char_window.ts`
  (the last commit before Phase 2's `e31addf6d` rewrote `render()`) is the OLD body baseline.
  Every element it painted (lines 209-267 of that revision) now has exactly one new home:

  | Old element (`fd084e250`) | New home |
  |---|---|
  | Frame title / close | Shared `WindowFrameDescriptor` titlebar (Phase 2, unchanged) |
  | Level/class subtitle | Titlebar subtitle (`subtitleHtml`, Phase 2, unchanged) |
  | `.char-identity` (portrait, name, archetype title, hobby craft) | OVERVIEW tab, `identityStripHtml` (this phase) |
  | Paperdoll (equip-col-left/right, model panel, skin row) | EQUIPMENT tab (Phases 2-4, unchanged) |
  | `STAT_GRID` flat stat cells | EQUIPMENT tab Attributes/Combat/Defense panels (Phase 3) |
  | `deps.talentSummaryHtml()` | OVERVIEW tab, `talentOverviewHtml` (this phase; the Specialization PANEL on Equipment is a separate, non-duplicated view built from `buildSpecPanel`, Phase 3) |
  | `deps.progressionHtml(level)` (Total XP/Virtual Level/Prestige Rank/milestones/prestige action) | SPLIT: Total XP/Virtual Level/Prestige Rank now live on the EQUIPMENT tab's Progression panel (Phase 3, `buildProgressionPanel`); milestones + the at-cap Prestige action are the ONLY parts `progressionHtml` still renders (hud.ts, trimmed this phase), landing on OVERVIEW |
  | `gatheringHtml` (mining/logging/herbalism rows) | EQUIPMENT tab Gathering panel (Phase 3) |
  | Share-card button (`data-act="share-card"`, `SHARE_GLYPH`) | OVERVIEW tab, `shareCardHtml` (this phase, byte-identical glyph/label/flow) |

  Nothing was left without a home; the STOPPING RULE ("any old-sheet element has no sensible
  home") never triggered.
- **`hud.ts`'s `progressionHtml(level)` was TRIMMED, not called wholesale.** Calling it
  unmodified into the Overview tab would have re-shown Total XP/Virtual Level/Prestige Rank,
  already rendered by the Equipment tab's Progression panel (Phase 3) from the SAME underlying
  data (`sim.lifetimeXp`/`sim.prestigeRank`), a same-data double-render across tabs the design
  contract explicitly warns against. Fixed by editing the private method (in scope: it feeds
  only `CharWindowDeps`, has no other caller) to keep just the milestone badges and the at-cap
  Prestige action, and swapping its heading from the reused `game.progression.heading`
  ("Progression") to the reused `game.progression.milestones` ("Milestones") so the two tabs
  never stamp the identical title over different content. Zero new i18n keys; both keys were
  already fully translated (used inline as the "Milestones:" label before this change). The
  now-unused `virtualLevel` import was removed from `hud.ts` alongside it.
- **Level/class line: NOT duplicated on the Overview identity strip.** The titlebar subtitle
  (Phase 2, `itemUi.equipment.levelClass`) already carries it and stays visible while the
  Overview tab is active (the titlebar does not repaint per tab), so the strip only shows
  portrait, name, archetype title, and (conditionally) hobby craft, per the design contract's
  default recommendation. The strip does not look broken without it: the mockup's identity
  block reads name/title/hobby as a group, distinct from the level/class line already pinned
  above it in the titlebar.
- **Dead-CSS resolution: reused, not deleted.** `components.css`'s
  `#char-window .window-body > .char-identity` (+ its `.char-title-text`/`.portrait-chip` child
  rules), orphaned by Phase 2's removal of the old sticky identity header, are now re-scoped to
  `#char-window .window-body .char-overview > .char-identity` (one selector edit per rule, same
  banner section, same declarations) so they style the Overview tab's identity strip. The
  `.char-progression`/`.cp-title`/`.cp-milestones`/`.cp-ms-label`/`.cp-none`/`.ms-badge`/
  `.cp-actions`/`.cp-hint` classes (used by `talentSummaryHtml`/the trimmed `progressionHtml`)
  and `.pc-share-row`/`.pc-share-btn`/`.pc-share-ico` (the share row) were NEVER dead: Phase 2-4
  left them unused in TS (since nothing called `talentSummaryHtml`/`progressionHtml`/the share
  button) but never removed the CSS, so this phase's render calls simply make them live again
  with no CSS edit needed for them.
- **The talent/spec summary's Choose/Change button reuses the Phase 3 dep AND its exact keys**
  (`deps.openTalents()`, `hudChrome.character.spec.choose`/`spec.change`), computed the same way
  `specPanelHtml` (Equipment tab) does via `buildSpecPanel(world.talentSpec)`, INCLUDING the
  `is-primary` treatment when no spec is chosen yet (caught while screenshotting the live app and
  matched before committing, with a decisive test pinning the class on both arms). Both buttons
  (Equipment's Specialization panel and Overview's talent-summary block) trigger the identical
  action; this is an intentional duplicate AFFORDANCE (not duplicate DATA), the same pattern
  locked decision 6 already sanctions for duplicate stat cells.
- **Preview re-mount verified two ways.** The deterministic path: `deps.renderPreview` is a
  vi.fn() spy asserted to fire once on initial render, stay at one call while Overview is
  active, and fire a second time after switching back to Equipment
  (`tests/char_window_frame.test.ts`, "3D preview re-mount on tab round-trip"). This falls out
  of existing Phase 2 mechanics with no new code: `render()` already calls `deps.renderPreview()`
  unconditionally at the end of the `equipment`-only branch, and the tab-rail's `onTabChange`
  callback already calls the full `render()` on every tab switch, so returning to Equipment
  re-enters that branch and re-invokes it. Also verified against the live running app (see
  "Screenshot/live verification" below): the wrapped `hud.renderCharPreview` call count went
  from 1 (initial open) to 2 after an overview -> equipment round-trip, and
  `#char-model-preview` was confirmed present again after the switch back.
- **Screenshot/live verification.** `node scripts/char_equipment_shot.mjs` (unmodified,
  reused warm `npm run dev` on :5173) ran clean, all five shots written with no new console
  errors. Since the checked-in script is shared Phase 2-4 infrastructure and was not in this
  phase's touch scope, the OVERVIEW-tab capture (and the preview-re-mount empirical check) used
  a separate, uncommitted temporary script (the Phase 4 precedent: "a one-off temporary script
  (not committed)"), writing `tmp/char_overview_verify_*.png`. Confirmed live: the identity strip
  (portrait chip + name + archetype title, hobby craft omitted since this fresh save has none
  yet), the talent-summary block, and the share-card button all render on the Overview tab;
  switching back to Equipment restores the paperdoll AND the 3D preview container.

## Phase 6: Mobile + polish

- [ ] `hud.mobile.css` char section updated: full-screen, single-column stack (paperdoll, bags, panels), landscape branch, tap targets >= 40px
- [ ] A11y regression: focus trap, focus return, Esc via closeAll, forced-colors, reduced motion
- [ ] AFTER screenshots committed (desktop, mobile, overview)
- [ ] `npm run ci:changed` green; `npm run gate` green except the known Windows new_endpoint red
- [ ] PR body drafted with before/after images
- [ ] Validation green: everything in the matrix

Notes:

## Deferred follow-ups (carry into the PR body / issues)

- Ranged attack power display (needs a new StatId + tooltip model)
- Off-hand / trinket slots (sim feature)
- Armor visible on the 3D preview (per-slot meshes; the base seam ships in Phase 2b, user-approved to defer the visuals)
- Crafting skills on the sheet (blocked on online mirroring of `craftSkills`)
- Keyboard-accessible bag-socket unequip (Phase 4 shipped mouse/touch right-click only on a
  non-focusable div; the equip slot's focusable corner-x + drag affordances are NOT mirrored on
  the bag-socket cell). Address in the Phase 6 a11y sweep.
- Embedded-grid overflow display (Phase 4's `buildCharBags` does not surface a legacy
  over-capacity overflow the way the standalone `BagGridModel.overflow` does, so items past
  `BACKPACK_SLOTS` + the occupied sockets' summed `bagSlots` are invisible in the embedded grid;
  the standalone `#bags` window still shows them). Rare legacy-save edge case; not worth the i18n
  churn now, but note it if the embedded grid ever becomes the primary bags surface.

## Phase 6 gate summary (final)
- npx tsc --noEmit: CLEAN.
- npm run ci:changed (biome changed-files): GREEN.
- npm run build (5 entries: game/admin/play/guide/editor): GREEN (backdrop-survival OK; 992 media assets; only pre-existing admin-i18n INEFFECTIVE_DYNAMIC_IMPORT warnings).
- npm run gate vitest full suite: GREEN except 3 environmental Windows subprocess-spawn reds NOT touched by this branch (git-verified): tests/server/new_endpoint.test.ts (documented), tests/ai_review.test.ts, tests/codex_setup.test.ts. All fail via node/tsc subprocess spawn, not assertions.
- One real gate red WAS ours, now FIXED (commit 8f772e11a): tests/i18n_resolved_equivalence.test.ts - the resolved-table SHA baseline drifted after later phases added keys; ran i18n:gen (no-op, tables current) + i18n:hash --write (re-baseline); check now OK, suite green.
- After-screenshots committed (bbc983967): docs/screenshots/char-equipment-after-{desktop,mobile,overview}.png.
- Final whole-feature qa-checklist: PASS (clean; 18 files/348 tests; scope guard empty on forbidden paths; all invariants verified).
- PR draft: docs/char-equipment/pr-draft.md. Newest release branch = release/v0.25.0 (retarget/rebase from origin/main needed; run release-merge-audit if a release merge occurs).

## STATUS: feature complete through PR-draft. NOT pushed / PR not opened (needs user auth via fork per memory). Packet teardown NOT done (needs explicit user confirm).
