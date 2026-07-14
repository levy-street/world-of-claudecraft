# State: Character Equipment Screen (cross-phase cheat sheet)

Read this file at the start of every session. It is the only doc a phase needs besides its own phase file.

## Current phase

Phase 5 complete; Phase 5 QA next. Phase 5 (Overview tab) fills the Phase 2 Overview placeholder
with the migration set locked decision 4 names: an identity strip (`identityStripHtml`: portrait
chip, name, archetype title, hobby craft; the level/class line stays titlebar-only, NOT
duplicated), the talent/spec summary (`talentOverviewHtml`: `deps.talentSummaryHtml()` plus a
Choose/Change button reusing the Phase 3 `deps.openTalents()` dep and its `spec.choose`/
`spec.change` keys), a milestones/prestige block (`deps.progressionHtml(level)`, TRIMMED in
`hud.ts` this phase to only the content the Equipment tab's Progression panel does not already
show: milestone badges and the at-cap Prestige action, dropping the now-duplicate Total XP/
Virtual Level/Prestige Rank rows and swapping its heading from the reused
`game.progression.heading` to the reused `game.progression.milestones` so the two tabs never
stamp the same title), and the unchanged share-card button/flow (`shareCardHtml` +
`wireOverviewTab`, the exact `SHARE_GLYPH`/`playerCard.shareButton` pair from the pre-Phase-2
sheet). Tab switching, focus, and the single-WebGL-preview re-mount all fall out of EXISTING
Phase 2 mechanics with zero new plumbing: `render()` already calls `deps.renderPreview()`
unconditionally at the end of its equipment-only branch, and the tab rail's `onTabChange`
already re-runs the full `render()` on every switch, so returning to Equipment naturally
re-invokes the preview mount (verified by a `vi.fn()` call-count assertion, not a smoke check,
plus a live-app check: 1 call at open, 2 after an overview -> equipment round-trip). Content
accounting is complete: every element the pre-Phase-2 `char_window.ts` (commit `fd084e250`,
`render()` lines 209-267) painted now has exactly one new home (titlebar, Equipment tab, or
Overview tab); the full old-element -> new-home table is in progress.md. Zero new i18n keys
(only an EXISTING key's usage site changed: `progressionHtml`'s heading swapped from one
already-translated key to another). The `.char-identity`/`.char-title-text`/`.portrait-chip`
CSS Phase 2 orphaned is REUSED, not deleted: re-scoped from
`#char-window .window-body > .char-identity` to
`#char-window .window-body .char-overview > .char-identity` (same declarations, new selector
depth matching the Overview mount's nesting). Validation green: `npx tsc --noEmit` (0 errors),
the full targeted vitest suite (`char_window`/`char_window_frame`/`char_view`/
`char_panels_view`/`char_bags_view`/`architecture`, 167 tests total;
`char_window_frame.test.ts` alone grew from 54 to 66 tests, the new tab-order/aria-controls,
content-accounting, preview-remount, and focus-stays-inside assertions), `localization_fixes`/`i18n_completeness` (37 passed + 3
pre-existing skipped, unchanged since no key changed), `css_corpus`/`css_value_validity`/
`styles_extraction`/`per_entry_css_wiring`, and `npm run ci:changed` (exit 0, only pre-existing
warnings in untouched lines). Screenshot/live verification: `node scripts/char_equipment_shot.mjs`
(unmodified) ran clean; the Overview-tab capture and the preview-re-mount empirical check used a
separate UNCOMMITTED temporary script (this phase's touch scope does not include the checked-in
screenshot script), matching the Phase 4 precedent for one-off verification scripts.

**Previously (Phase 4, embedded bags):** Phase 4 complete AND Phase 4 QA complete (three reviewers, zero blocking; the QA-fix commits are
folded into this line). Phase 4 (embedded bags) fills the Phase 2 `#char-bags`
mount with a new pure core (`src/ui/char_bags_view.ts`, `buildCharBags`) plus a painter section:
a header (`svgIcon('bags')` + the title reusing `itemUi.bags.title`, the used/total counter, and
an `icon-btn` `svgIcon('more')` control that opens the standalone `#bags` window), a container
selector row (one `.char-bags-tab` button per existing container: backpack always first, then each
occupied bag socket in socket order, each sized `>= 40x40` via `--touch-min` on every host, not
just touch), and the selected container's `.item-cell` grid. The container partition is a VIRTUAL
split of the pooled inventory (`src/sim/bags.ts` keeps one flat list; an equipped bag only
raises the slot budget): the pure core lays a canonical cumulative-capacity range over that flat
list using `BACKPACK_SLOTS`/`bagSlotsOf` verbatim, never re-derived arithmetic. Click parity
with the standalone bags window's default mode is achieved by calling the SAME exported
`bagItemAction` (bags_view.ts) with an all-off `BagMode` constant (no `bags_view.ts` edit
needed); occupied-cell clicks execute through `world.useItem`/`world.equipBag` exactly like the
standalone window's plain click, and (QA fix) also call the new `renderBagsIfOpen()` dep after the
mutation so an open standalone `#bags` window stays in sync (the mirror of `bags_window.ts`'s own
`renderCharIfOpen()`). The embedded grid is a SECOND drag-to-unequip drop target
(alongside the standalone `#bags`, which is untouched) via one new read-only dep
(`dragUnequipSlot()`) the painter reads each render, since the grid element itself is rebuilt
fresh every `render()` and cannot hold a one-time listener the way the static `#bags` element
does. A bag-socket cell on the paperdoll now supports right-click unequip-bag (a new
`unequipBag(socket)` dep, the same side-effect bundle `unequip(slot)` uses for an equip slot);
this mirrors ONLY the equip slot's contextmenu arm (the cell is a non-focusable div, no corner-x,
no drag: keyboard-accessible bag-socket unequip is deferred to Phase 6, see Known issues).
FOUR `CharWindowDeps`: `openBags()`, `dragUnequipSlot()`, `unequipBag(socket)`, and (QA)
`renderBagsIfOpen()`; all four are thin Hud-side UI wiring (no new `IWorld`/sim/server surface,
locked decision 11 intact). i18n: the header title REUSES `itemUi.bags.title` (QA fix, the
duplicate `hudChrome.character.bags.title` was deleted); the remaining new keys are
`hudChrome.character.bags.counter`/`openFull`/`container` (five non-Latin fills for all but
`counter`, and the `container` `{n}` aria value goes through `formatNumber`; see "New i18n keys"
below). Validation green after the QA fixes: `npx tsc --noEmit` (0 errors repo-wide), the full
targeted vitest suite (`char_bags_view`/`char_view`/`char_window`/`char_window_frame`/
`architecture`, 136 tests), the untouched-green non-regression suites
(`bags_view`/`bags_window`/`bags_window_frame`/`bag_filter`, 80 tests, zero diff to those files),
`localization_fixes`/`i18n_completeness` (37 passed + 3 pre-existing skipped),
`css_corpus`/`css_value_validity`, and `npm run ci:changed` (exit 0; its warnings are all
pre-existing, in files/lines this phase did not touch). Screenshot/live verification (unlike
Phase 3, unblocked): `node scripts/char_equipment_shot.mjs` ran clean, and a temporary
equip-two-bags-and-scroll-to-#char-bags check (via the same puppeteer-core path, not the harness's
own Browser pane, which still reproduces Phase 3's `document.hidden` quirk) confirmed the
header/counter/selector/grid render correctly against the live running app. Two DEFERRED
limitations remain, documented in "Known issues / gotchas" below and in Deferred follow-ups (the
cross-window sync concern was FIXED in QA, not deferred): the embedded grid does not surface a
legacy over-capacity overflow, and keyboard-accessible bag-socket unequip awaits the Phase 6 a11y
sweep. Update this line as phases complete.

**Previously (Phase 3, stat panels):** fills the Phase 2 `#char-panels`
mount with the six locked-order panels (Attributes, Combat, Defense, Progression,
Specialization, Gathering), each an icon + gold header over a body: the three stat panels
are two-column `deps.statCellHtml` grids (locked `StatId` order, lazy tooltips preserved,
no forked stat-cell renderer); Progression shows Total XP / Virtual Level / Prestige Rank
(gated at 0) plus a level-XP `.bar`/`.bar-fill` (percent + centered label computed in the
painter, reusing `char_panels_view.ts`'s `buildProgressionPanel`/`xpForLevel` math, no new
formula); Specialization shows the localized spec name (via `tTalent`, the same surface
`talents_window.ts`/`hud.ts`'s `talentSummaryHtml` use) or the none-state copy, plus a
Choose/Change button; Gathering restyles the pre-Phase-2 `buildGatheringProficiencyRows`
rows. Both spec buttons call the new `CharWindowDeps.openTalents()`, wired in `hud.ts` to
the existing `toggleTalents()` keybind toggle (one line, no new Hud logic). Four new
`UiIconName` glyphs (`attributes`, `shield`, `banner`, `leaf`; `attack`/`talents` reused for
Combat/Specialization). Two commits: `feat(ui): character stat panels with icon section
headers` and `feat(ui): specialization and progression panel rows with talents shortcut`.
Validation green: `npx tsc --noEmit` (0 errors repo-wide), the full targeted vitest suite
(`char_window`/`char_window_frame`/`char_panels_view`/`architecture`/`localization_fixes`/
`i18n_completeness`/`css_corpus`/`css_value_validity`, 157 passed + 3 pre-existing skipped),
`npm run ci:changed` exit 0 (only pre-existing warnings in files this phase didn't touch).
Screenshot verification (`node scripts/char_equipment_shot.mjs`) could NOT be completed this
session: blocked by two environment issues unrelated to the diff (a Bash-background dev
server isn't network-reachable outside Bash's own sandbox; the harness's own Browser-pane
tab reports `document.hidden === true` even when fronted, so `requestAnimationFrame` never
fires and `main.ts`'s `nextPaint()` hangs, so the offline flow never reaches the world). See
"Phase 3" notes in progress.md for the full root-cause trail. (Phase 4 re-attempted the
screenshot script this session; see the Phase 4 paragraph above and progress.md for the
outcome.)

**Environment note (affects every future phase, not just this one):** this checkout's
`node_modules` was stale relative to `package.json` (`@capacitor/app`, `@capacitor/browser`, and
every `@aws-sdk/*` package were declared but never installed). This broke the offline entry flow
outright (a static top-level import failing to resolve 500'd `main.ts`, so no click handlers ever
wired up) and was the actual source of the "6 pre-existing unrelated tsc errors" this file used to
document. Fixed with a plain `npm install`. `npx tsc --noEmit` is now 100% clean; do not expect or
tolerate those 6 errors going forward, and run `npm install` first if the offline flow ever seems
inert in a screenshot/E2E script (check for a 500 on a `/src/...` resource before assuming a code bug).

## Locked decisions (never re-litigate)

1. Drop nonexistent stats: DEFENSE panel = Armor + Dodge only. No hit/block/parry/resistance rows anywhere, no display-only zeros.
2. Paperdoll = the 11 real `EquipSlot`s, mockup arrangement: left `helmet, neck, shoulder, chest, gloves`; right `mainhand, waist, legs, feet, ring1, ring2`; top-center = equipped-bag sockets (bag system, not an EquipSlot). No off hand, no trinket.
3. Bags grid embedded in the Equipment tab via the pure `bags_view` helpers; container selector = backpack + equipped bag sockets; counter = used/capacity of selected container. Standalone `#bags` window unchanged.
4. Tabs: `equipment` (default) + `overview`. Overview = identity strip, archetype title, hobby craft, talent summary (links to talents window), prestige/milestones, share card.
5. Stat panels on the Equipment tab, right column, in order: Attributes, Combat, Defense, Progression, Specialization, Gathering.
   - ATTRIBUTES stat cells (via `deps.statCellHtml`, existing `StatId`s, this exact order): `str, agi, sta, int, spi, armor, attackPower, dps, critChance, dodge`.
   - COMBAT stat cells: `attackPower, dps, critChance, critRating, hasteRating, spellPower`.
   - DEFENSE stat cells: `armor, dodge`.
   - PROGRESSION rows: Total XP (`lifetimeXp`), Virtual Level (`virtualLevel(lifetimeXp)`), Prestige Rank (only when > 0), and a level-XP bar (`xp` / `xpForLevel(player.level)`, no +1, styling via the frame `.bar`/`.bar-fill` grammar; reuse the same math `src/ui/xp_bar.ts` uses, do not invent a new formula).
   - SPECIALIZATION: spec name (resolved via the talents i18n surface) or the none-state string, plus a Choose/Change button calling `deps.openTalents()`.
   - GATHERING: `buildGatheringProficiencyRows` (mining, logging, herbalism with skill/maxSkill).
6. Duplicate stat cells across panels (armor, dodge, attackPower, dps, critChance appear in two panels) are intentional, mirroring the mockup.
7. Titlebar: title = character name; subtitle = localized level/class line (reuse `itemUi.equipment.levelClass`); right accessory = `deps.moneyHtml(world.copper)` before the close button. Implemented as an optional `window_frame` extension (subtitle + accessory deps hooks), available to all windows.
8. The mockup's "+" button on the BAGS header opens the full `#bags` window (`deps.openBags()`).
9. This is a cold-path window: full re-render on open/change is the existing pattern; no per-frame `PainterHostWriters` needed. Do not add per-frame work.
10. One WebGL context: the preview stays Hud-owned (`mountCharPreview`); `char_view.ts`, `char_panels_view.ts`, `char_bags_view.ts`, and `char_window.ts` never import `CharacterPreview` or anything from `src/render/` (guarded by tests).
11. No changes to `src/sim/`, `server/`, `src/net/`, `src/world_api*`, the wire protocol, or the DB in this packet. If a phase seems to need one, stop and ask the user. (`src/render/characters/` changes are in scope for Phase 2b only.)
12. (User-approved 2026-07-11) The preview gets a real 3D procedural pedestal, char-window mount only, default off everywhere else; no new asset files. And the equipment-visual BASE SEAM ships now (`PreviewAppearance.equippedItems`, `CharacterVisual.setEquipment` storing the map, weapon-only rendering today) so armor-on-model can land later without rework; the armor meshes themselves stay a deferred follow-up. **Landed Phase 2b**, see "Landed render surface (Phase 2b, final)" under Architecture decisions.

## Non-negotiable constraints

- Every player-visible string is a `t()` key in `src/ui/i18n.catalog/hud_chrome.ts` (`hudChrome.character.*` namespace; English only; never `as const`). M16: every new wordy English value (run of 4+ consecutive lowercase letters after stripping `{tokens}`) also needs its five non-Latin fills (`zh_CN`, `zh_TW`, `ja_JP`, `ko_KR`, `ru_RU`) in the same change, following the precedent documented at `src/ui/i18n.catalog/hud_chrome.ts:224-229`. Interpolated names pass through `esc()`. Numbers via `formatNumber`, money via `deps.moneyHtml`/`formatMoney`.
- No em dashes, en dashes, or emojis anywhere (code, docs, commits, player copy). The Stop hook blocks them.
- Painter TS never hard-codes a hex/px/color (per-painter no-magic-values source scan in `tests/char_window.test.ts`); CSS uses tokens from `src/styles/tokens.css`.
- New CSS goes in `src/styles/components.css` under a ten-dash banner (`/* ---------- name ---------- */`, exactly ten dashes each side); mobile overrides in `src/styles/hud.mobile.css` gated on `body.mobile-touch`. Never a four-dash fence (silently drops the section from the corpus scan).
- New pure cores are named `*_view.ts`, DOM/Three/i18n-free, instance-parameterized, and registered in `UI_PURE_CORES` in `tests/architecture.test.ts` (the completeness sweep fails otherwise). They never import a `*_window`/`*_painter`/`painter_host`, `three`, or `render/`.
- `#char-window` root stays a pristine `.window.panel`; the frame mounts on an inner container; open state remains `root.style.display === 'block'` (Hud reads that exact string).
- The "(sacred)" equip/unequip flows keep working: corner-x unequip, right-click unequip, drag-to-unequip. Never regress `tests/char_window_frame.test.ts`.
- Tap targets >= 40x40 px on touch; no `transform: scale()` on hover/focus; honor `prefers-reduced-motion`; forced-colors stays functional; focus trap + focus return via the existing FocusManager wiring.
- Biome: format ONLY changed files (`npx @biomejs/biome check --write <file>`), never whole-repo. `npm run ci:changed` before push.
- Shared checkout: commit with explicit paths, never `git add -A`.
- Known Windows quirk: `npm run gate` is always red at `tests/server/new_endpoint.test.ts` on this machine (POSIX .bin/tsc spawn, pre-existing). Do not blame the diff for it; verify everything else is green.

## Validation matrix

| Change type | Commands |
|---|---|
| Any TS change | `npx tsc --noEmit` |
| Pure cores | `npx vitest run tests/char_view.test.ts tests/char_panels_view.test.ts tests/char_bags_view.test.ts tests/architecture.test.ts` |
| Painter / window | `npx vitest run tests/char_window.test.ts tests/char_window_frame.test.ts` |
| Frame extension | `npx vitest run tests/window_frame_view.test.ts tests/window_frame.test.ts` (plus the per-window `*_frame.test.ts` suites if the shared builder changed: `npx vitest run tests/*_frame.test.ts`) |
| Any new player string | `npx vitest run tests/localization_fixes.test.ts tests/i18n_completeness.test.ts` |
| Any CSS change | `npx vitest run tests/css_corpus.test.ts tests/styles_extraction.test.ts tests/css_value_validity.test.ts tests/per_entry_css_wiring.test.ts` |
| Render (Phase 2b) | `npx vitest run tests/preview_appearance.test.ts tests/architecture.test.ts` + screenshot framing comparison; asset manifest diff must be empty |
| Visual verification | `npm run dev` + `node scripts/char_equipment_shot.mjs` (created in Phase 2; modeled on `scripts/mobile_char_window_shot.mjs`) |
| Changed-file lint | `npm run ci:changed` |
| Pre-merge (Phase 6) | `npm run gate` (expect the known Windows new_endpoint red; everything else must be green) |

## Key file paths

Existing (read before touching):
- `src/ui/char_view.ts`, `src/ui/char_window.ts` (+ `tests/char_view.test.ts`, `tests/char_window.test.ts`, `tests/char_window_frame.test.ts`)
- `src/ui/hud.ts`: CharWindow wiring 3708-3751, `mountCharPreview` 11734-11760, `toggleChar` 11692, `moneyHtml` 3913-3922, presentation bag 3466
- `src/ui/window_frame_view.ts`, `src/ui/window_frame.ts` (+ their tests)
- `src/ui/bags_view.ts` (`buildBagGrid` :252, `buildBagBar` :288, `bagItemAction` :89), `src/sim/bags.ts` (`BACKPACK_SLOTS`, `bagSlotsOf`)
- `src/ui/stat_tooltip.ts` (StatId :38-51, `AP_PER_DPS` :165), `src/ui/gathering_view.ts`, `src/ui/xp_bar.ts`
- `src/ui/ui_icons.ts` (`svgIcon`, `UiIconName` :16-55), `src/ui/icons.ts` (`iconDataUrl`, `QUALITY_COLOR`)
- `src/ui/i18n.catalog/hud_chrome.ts` (precedent comment :224-229)
- `src/styles/tokens.css`, `src/styles/components.css` (frame grammar 9045+, tabs 9215-9248, item-cell 9529, char CSS 1059-1172 and 2573-2658, coins 3717-3734), `src/styles/hud.mobile.css` (char window 2731-2806)
- `src/world_api/inventory.ts`, `src/world_api/progression_xp.ts`, `src/world_api/talents.ts`, `src/world_api/professions.ts`, `src/sim/types.ts` (EquipSlot 308-335, XP helpers 2605-2719)
- `tests/architecture.test.ts` (`UI_PURE_CORES` 122-199)
- `scripts/mobile_char_window_shot.mjs` (screenshot template), `scripts/browser_path.mjs`

Existing, Phase 2b surface (post-landing line numbers; shifted from pre-Phase-2b):
- `src/render/characters/preview.ts` (scene, framing, `setAppearance` :133, `setEquipment` :150,
  `setPedestal` :158, `captureCloseup` :343, `destroy` :409), `preview_appearance.ts`
  (`PreviewAppearance` :13-19, `appearanceSignature` :46-48) + `tests/preview_appearance.test.ts`,
  `visual.ts` (`setEquipment` :471, `setWeapon` :482), `index.ts` barrel (unchanged, no new
  export needed), `src/render/characters/CLAUDE.md`, `src/render/CLAUDE.md`
- `src/ui/hud.ts`: `mountCharPreview` (`opts.pedestal`/`opts.equipment`) 11734-11774

Created by this packet (update as they land):
- `src/ui/char_panels_view.ts` + `tests/char_panels_view.test.ts` (Phase 1)
- `src/render/characters/pedestal.ts` (Phase 2b, landed: `buildPedestal()`, `disposePedestal()`)
- Phase 3, landed in `src/ui/char_window.ts`: `panelHtml`/`statPanelHtml`/
  `progressionPanelHtml`/`specPanelHtml`/`gatheringPanelHtml` (private painter methods) +
  `CharWindowDeps.openTalents()`; four new `UiIconName` glyphs in `src/ui/ui_icons.ts`
  (`attributes`, `shield`, `banner`, `leaf`).
- `src/ui/char_bags_view.ts` + `tests/char_bags_view.test.ts` (Phase 4, landed: `buildCharBags`,
  `CharBagContainer`/`CharBagCell`/`CharBagsModel`). Phase 4, landed in `src/ui/char_window.ts`:
  `renderBagsSection`/`buildBagsHeader`/`buildBagsSelector`/`buildBagsGrid`/`buildBagCell`/
  `bagCellAction` (private painter methods), the `selectedBagContainer` session-local field, the
  module-level `BAGS_GRID_MODE` all-off `BagMode` constant, and three new `CharWindowDeps`:
  `openBags()`, `dragUnequipSlot()`, `unequipBag(socket)`. `buildBagSocketCell` gained a
  `contextmenu` listener (right-click unequip-bag) on an occupied socket.
- Phase 5, landed in `src/ui/char_window.ts`: `overviewTabHtml`/`identityStripHtml`/
  `talentOverviewHtml`/`shareCardHtml`/`wireOverviewTab` (private painter methods), the
  module-level `SHARE_GLYPH` constant (reintroduced verbatim from the pre-Phase-2 sheet). Landed
  in `src/ui/hud.ts`: `progressionHtml(level)` trimmed to milestones + the at-cap Prestige action
  only (no new `CharWindowDeps` member, no new dep; same signature, smaller output).
- `scripts/char_equipment_shot.mjs` (Phase 2, landed)
- `docs/screenshots/char-equipment-before-desktop.png`, `-before-mobile.png` (Phase 2, landed), `-after-desktop.png`, `-after-mobile.png`, `-after-overview.png` (Phase 6)

## New i18n keys (running list; all in hudChrome.character.* unless noted)

Landed (Phase 2): `tabs.equipment` = "Equipment", `tabs.overview` = "Overview", `bagSocket` = "Bag
Socket: {name}" (aria label on a top-center bag-socket cell; `{name}` is the bag's display name or
`itemUi.equipment.empty`). All three are M16-wordy; the five non-Latin fills
(zh_CN/zh_TW/ja_JP/ko_KR/ru_RU) are in `src/ui/i18n.locales/`, the other ~16 Latin-script locales
stay `pending` per the normal contributor workflow.
Landed (Phase 3, after QA reuse): NEW keys are `sections.attributes` = "Attributes",
`sections.combat` = "Combat", `sections.defense` = "Defense", `spec.choose` = "Choose",
`spec.change` = "Change" (all M16-wordy; five non-Latin fills in `src/ui/i18n.locales/`),
plus `progression.xpLabel` = "{current} / {max}" (the level-XP bar's centered label; NOT
wordy after stripping `{current}`/`{max}`, so no non-Latin fill, English-only/`pending`).
Phase 3 QA REUSED (do not re-add these under `hudChrome.character.*`; the seven duplicates
were deleted): the Progression/Specialization/Gathering panels render
`game.progression.heading` (Progression), `game.progression.totalXp` (Total XP),
`game.progression.virtualLevel` (Virtual Level), `game.progression.prestigeRank` (Prestige
Rank), `game.talents.specTab` (Specialization), `game.talents.noSpec` (No specialization
chosen), and `hudChrome.gathering.title` (Gathering) directly (all byte-identical English,
already translated). See the `refactor(i18n)` QA-fix commit.
Landed (Phase 4, after QA i18n-reuse fix): `bags.counter` = "{used} / {total}" (formatted numbers
via `formatNumber`), `bags.openFull` = "Open bags window" (aria label, the header's open-full
control), `bags.container` = "Bag {n}" (aria label per selector button, `{n}` = the container's
positional ordinal label, routed through `formatNumber` per the `hudChrome.unitFrame.partyGroup`
precedent). Only `openFull` strictly trips the M16 `/[a-z]{4,}/` wordy regex (via "bags"/"window"
mid-sentence); `container` ("Bag {n}") is short enough that it does not strictly trip it but
carries the five non-Latin fills anyway for glossary consistency. `counter` stays
English-only/`pending` (not wordy after stripping `{used}`/`{total}`).
Phase 4 QA REUSED (do NOT re-add): the embedded header TITLE renders `itemUi.bags.title` ("Bags"),
the standalone bags window's OWN title key (`bags_window.ts:72`), already translated in all 22
locales. The originally-landed duplicate `hudChrome.character.bags.title` (+ its five non-Latin
overlay fills) was DELETED in QA and the i18n tables regenerated (the same Phase 3 reuse lesson).
Landed (Phase 5): ZERO new keys. `hud.ts`'s trimmed `progressionHtml(level)` swapped its heading
from `game.progression.heading` ("Progression") to `game.progression.milestones` ("Milestones"),
both pre-existing, fully-translated keys (the latter was already used inline as the
"Milestones:" row label before this change), so the two tabs never show the identical title
over different content. Every other Overview string reuses an existing key verbatim:
`hudChrome.archetypeTitle.label`/`.none`/`.hobbyLabel`/`.<craftId>` (identity strip),
`hudChrome.character.spec.choose`/`.change` (the talent-summary button, Phase 3's keys),
`game.progression.none`/`game.prestige.action`/`.needXp` (the trimmed milestones/prestige
block, unchanged from the pre-Phase-2 sheet), `playerCard.shareButton` (the share button).
Reuse, do not duplicate: slot names via existing `deps.slotName`, level/class via `itemUi.equipment.levelClass`, money units via `itemUi.money.*`, XP bar strings via the `xp_bar` keys, gathering names via `hudChrome.gathering.*`, spec/talent names via the talents i18n surface.
Record the FINAL key list here as phases land.

## New IWorld members / SimEvents / wire fields / endpoints / tables

None. Locked decision 11: this packet adds zero cross-host surface. `CharWindowDeps` was left
completely unchanged in Phase 2 (no new required members): the subtitle text is built inline in
`char_window.ts` from imports it already had, and the titlebar accessory reuses `moneyHtml`
(already part of the shared `PainterHostPresentation` bag `hud.ts` spreads into the deps object),
so `hud.ts`'s existing wiring needed no edit.

## Architecture decisions

- One window, one frame, two tab panels; tab state lives on `CharWindow` (session-local, default `equipment`).
- Pure cores own layout MODELS (slot arrangement, panel row lists, container partition math); the painter owns DOM; Hud owns the preview, focus, and window lifecycle. Same trio split as today.
- The frame accessory extension is deps-driven (`subtitleHtml?`, `titleAccessoryHtml?` style hooks) so other windows can adopt it later; descriptor stays declarative.
- **Landed frame-extension API (Phase 2, final):** `WindowFrameDescriptor` (`window_frame_view.ts`)
  gains two optional booleans, `subtitle?: boolean` and `titleAccessory?: boolean`. The model gains
  `titleCol: {id, className} | null` (non-null only when `subtitle` is set; a titleAccessory-only
  window keeps the title a bare span), `subtitle: {id, className} | null`, and
  `titleAccessory: {id, className} | null`. `WindowFrameDeps` (`window_frame.ts`) gains
  `subtitleHtml?: () => string` and `titleAccessoryHtml?: () => string` (raw HTML, consumer already
  escaped); `renderWindowFrame` renders titlebar children in the order title-col (or bare title),
  accessory, close, additive (both null for every existing descriptor: verified byte-identical
  across all 15 `tests/*_frame.test.ts` suites). `relocalizeWindowFrame(frame, deps?)` gained an
  OPTIONAL second parameter (same two keys) so a consumer's own `render()` can refresh both regions
  with fresh computed content (money, level) on every repaint, not only a language switch; the
  existing single-argument call site (`hud.ts`'s generic per-frame loop) is untouched. **Ordering
  gotcha:** call `relocalizeWindowFrame` BEFORE overwriting a frame's title with dynamic text (e.g.
  a player name) in the same `render()`, never after: it re-stamps `.window-title` from the stored
  `data-title-key` unconditionally, which will silently revert a later name overwrite done first.
- **`CharWindow` tab lifecycle (Phase 2, final):** `activeTab: 'equipment' | 'overview'` field,
  default `'equipment'`. `ensureFrame`'s cold path passes `onTabChange` (sets `activeTab` + calls
  `render()`) and the current `activeTab` as `renderWindowFrame`'s 4th arg; its REUSE path
  re-queries `tabButtons` fresh via `querySelectorAll('[data-window-tab]')` every call (the shared
  `WindowFrameParts` contract only returns them at cold stamp, a char-window-local fix, not a
  `window_frame.ts` change). `render()` always calls `applyActiveWindowTab` + `relocalizeWindowFrame`
  every time (cheap, cold-path window), then overwrites `.window-title` with the live player name.
- **Landed render surface (Phase 2b, final):** `src/render/characters/pedestal.ts` (new) exports
  `buildPedestal(): THREE.Group` (a tapered `CylinderGeometry` dais with dark-stone side/lighter-top
  materials via a 3-entry material array, plus a `TorusGeometry` rim; top surface sits at local
  y=0 so a caller drops it directly under a model whose root pivots at the feet) and
  `disposePedestal(pedestal)` (traverses and disposes every mesh's geometry/material; safe because
  the pedestal is built fresh per `CharacterPreview` instance, never shared/cached). `preview.ts`:
  `CharacterPreview.setPedestal(visible: boolean)` (default off; lazy-builds on first `true`;
  add/remove the `Group` from `this.scene`, no camera writes at all) and
  `setEquipment(equipped: Partial<Record<EquipSlot,string>>)` (thin pass-through to
  `this.currentVisual?.setEquipment`, mirroring the existing `setSkin` pattern); `setAppearance`
  calls `setEquipment` when `a.equippedItems` is set. `captureCloseup()` removes the pedestal
  from the scene before its off-pose render and re-adds it before the final restore render, so
  the player-card headshot is byte-unaffected either way. `preview_appearance.ts`:
  `PreviewAppearance.equippedItems?: Partial<Record<EquipSlot,string>>`;
  `appearanceSignature` folds a slot-sorted serialization of it in (stable order, empty/absent
  produces the same tail as before). `visual.ts`: `CharacterVisual.setEquipment(equipped)` stores
  the map (a write-only field today, `biome-ignore`d, read path lands with armor-on-model) and
  delegates `setWeapon(equipped.mainhand ?? null)`, a verified no-op when the mainhand is already
  correct. `hud.ts`: `mountCharPreview` gains `opts?: { pedestal?: boolean; equipment?:
  Partial<Record<EquipSlot,string>> }`; every call site that mounts into `#char-model-preview`
  (`renderCharPreview`'s two branches AND `renderCharSkinPicker`'s two inline skin-swap branches)
  passes `{ pedestal: true, equipment: this.sim.equipment }`; the skin-event overlay mount (a
  different container, `.se-preview`) and `main.ts`'s separate pre-game `CharacterPreview`
  instance pass/touch neither, so they stay default-off. **Judgment call, worth flagging for
  QA:** the phase doc's contract text names only `renderCharPreview` as "the char-window mount";
  this implementation treats `renderCharSkinPicker`'s inline re-mounts the same way because they
  target the identical `#char-model-preview` container (confirmed by `tests/char_window_frame.test.ts`'s
  existing comment tying both `#char-model-preview` and `#char-skin-row` to "the Phase 2b pedestal
  mount"); the alternative (pedestal off during an in-window skin swap) would flicker the pedestal
  off and back on for no user-visible reason.

## Known issues / gotchas discovered during phases

- **Signature changes to `char_view` exports have TWO call sites:** `src/ui/char_window.ts` AND
  the `src/ui/hud.ts` inspect popup (~line 13562, `buildPaperdollView(e.equippedItems, ..., ITEMS)`,
  showing another player's read-only worn gear). Any future phase that touches these signatures
  must update BOTH. (Phase 1's `bags` parameter added the hud.ts one; `Entity` has no `bags`
  mirror for other players, so the inspect popup passes `[]`.)
- **Phase 1:** `npm run ci:changed` (`biome ci --changed`) reports "Checked 0 files" against a
  real, git-diff-visible change set while the files are only staged/uncommitted on this
  checkout; it only sees COMMITTED changes. Run it (or trust it) after committing, not mid-diff;
  a direct `npx biome check <file...>` works as a pre-commit spot check.
- **Phase 2: stale `node_modules` broke the offline entry flow outright**, not just `tsc`. See the
  "Environment note" atop this file: `npm install` first if `#btn-offline`'s class-select card
  never appears in a screenshot/E2E script (check the page's network log for a `500` on a
  `/src/...` module before assuming a code regression).
- **Phase 2: `relocalizeWindowFrame` call-order gotcha**, see "Landed frame-extension API" above:
  it unconditionally re-stamps `.window-title` from the descriptor's static `titleKey`, so a window
  that overwrites the title with dynamic text (a player/vendor/NPC name) must do that overwrite
  AFTER calling `relocalizeWindowFrame` in the same render pass, not before.
- **Phase 2: content removed from the Equipment tab, RELOCATED by Phase 3 + Phase 5.** The old ad
  hoc identity strip, flat stat grid, talent summary, progression bar, gathering rows, and
  share-card button stopped rendering anywhere for two phases (Equipment tab was paperdoll-only;
  Overview was an empty placeholder). Phase 3 relocated the stat grid/gathering rows into the
  Equipment tab's stat panels; Phase 5 relocated the identity strip/talent summary/
  milestones-prestige/share-card into the Overview tab. All six `CharWindowDeps` members this
  note used to list as declared-but-unused (`talentSummaryHtml`/`progressionHtml`/`statCellHtml`/
  `statTooltipHtml`/`openPlayerCard`/`openPrestige`) are now called somewhere in `char_window.ts`.
- **Phase 2 left dead CSS in `components.css` (under the banner "character + talents +
  crafting AAA frame"): the selectors `#char-window .window-body > .char-identity`,
  `> .char-identity > .char-title-text`, `> .char-identity > .portrait-chip` were dead
  (char_window.ts no longer emitted those classes after Phase 2). RESOLVED in Phase 5:**
  the selectors are REUSED (re-scoped to `#char-window .window-body .char-overview > .char-identity`
  and its two child rules, matching the identity strip's new nesting depth under the Overview
  mount), not deleted. Same declarations, same banner section, just one extra `.char-overview`
  hop in the selector path.
- **Phase 2b: the phase doc's framing premise doesn't match the code, re-verified against it.**
  `docs/char-equipment/phase-02b-preview-pedestal.md` says "the existing fit uses the model's
  Box3"; `preview.ts` has no such thing (no `THREE.Box3` anywhere in the file): the live-preview
  camera position/lookAt are fixed constants set once in the constructor and never recomputed.
  The pedestal invariant ("enabling it must not change how large the character renders") still
  holds, just via a simpler mechanism: `setPedestal`/`buildPedestal` never write to `this.camera`,
  they only add/remove a `Group` under the model's feet. Confirmed both by inspection and by a
  side-by-side screenshot diff against the Phase 2 after-shot (identical character size/position,
  pedestal added underneath).
- **Phase 2b: `mountCharPreview`'s equipment/pedestal opts had no matching contract line for
  `renderCharSkinPicker`'s two inline re-mount call sites.** See "Landed render surface (Phase 2b,
  final)" above for the reasoning; flagged explicitly for Phase 2b QA to re-check rather than
  assumed correct.
- **Phase 2b QA RESOLUTION (pedestal scope): the rule is "char-window mount only", meaning any
  mount into the char window's own `#char-model-preview` container, default off everywhere else.**
  Pedestal ON: `Hud.renderCharPreview` (the char window's model mount, both its class-rig and
  lazy-mech branches) AND `Hud.renderCharSkinPicker` (the char window's inline cosmetic skin row;
  its swatch click handlers re-mount into that same `#char-model-preview`, so turning the pedestal
  off there would flicker it away on an in-window skin swap). Pedestal OFF: `src/main.ts`'s
  pre-game char-select / char-create preview (a SEPARATE `CharacterPreview` instance mounting into
  `#online-preview-container` / `#charcreate-preview-container`, with its own `renderSkinPicker`
  into `#online-skin-row` / `#offline-skin-row`) and the cosmetic skin-event overlay
  (`Hud.openSkinEvent` / `renderSkinEvent`, mounting into `.se-preview`). The contract's
  parenthetical "(skin picker)" as pedestal-off meant the pre-game skin picker, not the char
  window's own skin row; the code is correct as landed and the phase doc's section-2 bullet 4 was
  reworded to say so.
- **Phase 3: this session's screenshot-verification environment was unusable, for reasons that
  will recur.** (1) A dev server started via the Bash tool's own `run_in_background` is reachable
  ONLY from that same Bash sandbox: `curl`/`Invoke-WebRequest` from other tool calls and a
  separately-launched Puppeteer browser process both get connection-refused/timeout against it.
  Only `mcp__Claude_Browser__preview_start`'s own tunnel is reachable cross-tool. (2) Even against
  that tunnel, the harness's Browser-pane tab reported `document.hidden === true` /
  `visibilityState: "hidden"` (confirmed live: `requestAnimationFrame` fired 0 times in 3s) even
  after `tabs_select`-fronting it, so `src/main.ts`'s `nextPaint()` (two chained
  `requestAnimationFrame` calls, awaited early in `startGame()` before the world finishes
  booting) hung forever and the offline flow never reached the world, let alone the char window.
  Root-caused via direct in-page probes (`ensureLocaleLoaded`/`assetsReady` both resolve
  instantly when called directly, ruling out an i18n or asset regression). Neither issue is
  caused by the Phase 3 diff (no `src/render/`, `src/main.ts`, or asset changes this phase); the
  next phase/QA session should re-attempt the screenshot script fresh and check
  `document.hidden` early if it reproduces.
- **Phase 4: the harness's Browser-pane `document.hidden === true` quirk still reproduces**
  (confirmed again this session via a direct `document.hidden` probe), but
  `scripts/char_equipment_shot.mjs` (its own `puppeteer-core` launch, not the harness's Browser
  pane) is unaffected and ran clean; a `npm run dev`-served `:5173` was ALSO directly reachable
  via a plain Bash `curl` this session (unlike Phase 3's note that a Bash-backgrounded dev server
  was reachable only from that same Bash sandbox), so this specific dev-server-reachability
  symptom did not reproduce this time. Treat both quirks as environment-dependent, not fixed
  facts to assume either way in a future session; re-check fresh each time.
- **Phase 4: the standard `char_equipment_shot.mjs` desktop/mobile shots never reach the bags
  section.** The Equipment tab's `.window-body` is one tall scrollable column (paperdoll, six
  stat panels, then `#char-bags`); a plain top-of-window screenshot only shows through the
  Attributes panel. This is not a regression: it is the same "content taller than the viewport"
  shape Phase 3's own panels already created. Verifying the bags section specifically needs
  either scrolling `#char-bags` into view first (`element.scrollIntoView()`) or a taller
  viewport; a later phase/QA session doing a full before/after screenshot pass should scroll (or
  use a tall enough viewport) before capturing, not conclude the section is missing from a
  cropped top-of-window shot.
- **Phase 4: quest-item discard from the embedded grid is a deliberate no-op.** In the grid's
  always-default mode `bagItemAction` can return `'discardQuest'`; `bagCellAction` does NOT act on
  it (the destroy-quantity confirmation modal stays a standalone-`#bags`-window affordance). A
  quest item click in the embedded grid does nothing. Covered by a decisive test (asserts no world
  method is called and the grid DOM is unchanged).
- **Phase 4 QA RESOLVED: cross-window bags-repaint sync.** Originally a flagged concern (with both
  windows open, an embedded-grid use/equip left the standalone `#bags` DOM stale). FIXED in QA via
  the new `CharWindowDeps.renderBagsIfOpen()` dep (wired in `hud.ts` to repaint `#bags` only when
  shown), called from `bagCellAction`'s use/equipBag arms. Both windows now stay in sync in both
  directions. No longer a limitation.
- **Phase 4 DEFERRED: embedded-grid legacy over-capacity overflow is invisible.** `buildCharBags`
  does not surface an overflow the way the standalone `BagGridModel.overflow` does. A pre-bag save
  that loaded overflowing (`src/sim/bags.ts` header: over-capacity inventories are tolerated, never
  destroyed) has items at absolute inventory indices PAST `BACKPACK_SLOTS` + the occupied sockets'
  summed `bagSlots`; those indices map to no virtual container cell, so such items are INVISIBLE in
  the embedded grid (the standalone `#bags` window still shows them, since its grid paints the whole
  flat inventory). Left as-is on purpose (a rare legacy-save edge case not worth the i18n churn of
  an overflow-count UI); in Deferred follow-ups. Revisit only if the embedded grid ever becomes the
  primary bags surface.
- **Phase 4 DEFERRED: bag-socket unequip is mouse/touch-only (a11y).** The paperdoll bag-socket
  cell is a plain non-focusable `<div>` with only a `contextmenu` (right-click) handler. Earlier
  Phase 4 prose said it uses "the same affordance pattern an equip slot uses"; that is CORRECTED:
  it mirrors only the equip slot's contextmenu ARM, NOT its focusable corner-x button or its
  drag-to-unequip. Keyboard-accessible bag-socket unequip is deferred to the Phase 6 a11y sweep;
  in Deferred follow-ups.
