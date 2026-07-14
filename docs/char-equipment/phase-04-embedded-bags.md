# Phase 4: Embedded bags

Goal: the BAGS section of the Equipment tab: header (title, used/total counter, open-full button), container selector (backpack + equipped bag sockets), and an interactive `.item-cell` grid, all reusing the pure bags machinery. The standalone `#bags` window is untouched and stays fully functional.

## Design contract

### 1. New pure core `src/ui/char_bags_view.ts` (register in `UI_PURE_CORES`)

```ts
import type { InvSlot, ItemDef } from '../sim/types';

export interface CharBagContainer {
  id: 'backpack' | `bag${1 | 2 | 3 | 4}`;   // bag1..bag4 = socket index + 1
  socket: number | null;                     // null for backpack, else 0..3
  label: string;                             // '1'-based ordinal as plain text ('1', '2', ...)
  exists: boolean;                           // backpack always true; bagN true when socket occupied
  capacity: number;                          // slot count of this container
}
export interface CharBagsModel {
  containers: CharBagContainer[];            // backpack first, then sockets in order; only existing
                                             // containers are listed (selector buttons)
  selected: CharBagContainer;                // resolved selection (falls back to backpack)
  cells: CharBagCell[];                      // the selected container's slots, in slot order
  used: number;                              // occupied slots in the selected container
}
export interface CharBagCell {
  slotIndex: number;                         // absolute index into world.inventory
  item: ItemDef | null;
  count: number;                             // stack count (0 for empty)
}
export function buildCharBags(input: {
  inventory: readonly InvSlot[];
  bags: readonly (string | null)[];
  items: Record<string, ItemDef>;
  selectedId: string;                        // tolerate stale ids: fall back to backpack
}): CharBagsModel
```

The container partition MUST come from the real sim helpers (`BACKPACK_SLOTS`, `bagSlotsOf` in `src/sim/bags.ts`), never re-derived arithmetic. Read `src/ui/bags_view.ts` first and reuse its helpers (`buildBagBar` for socket occupancy, grid-cell shaping) wherever they fit; only add what the container-scoped view needs. If a helper belongs in `bags_view.ts` (rule of three), extend it there instead of duplicating.

### 2. Painter (filling the Phase 2 `char-bags` mount in `char_window.ts`)

- Header row: `svgIcon('bags')` + `t('hudChrome.character.bags.title')`, the counter `t('hudChrome.character.bags.counter', { used, total })` (both numbers through `formatNumber`), and an open-full button (`+` glyph via `svgIcon('more')` or the existing plus convention; aria label `t('hudChrome.character.bags.openFull')`) calling the new dep `openBags()`.
- Selector row: one button per `containers` entry, text = `label`, aria label `t('hudChrome.character.bags.container', { n })`, active state on `selected`, click re-renders with the new `selectedId`. Selection is a `CharWindow` field, session-local, default backpack. Selector buttons are >= 40x40 px touch targets.
- Grid: `.item-cell` buttons per cell (icon via `deps.itemIcon`, `data-quality` border, stack count corner), empty cells decorative `.item-cell.is-empty`. Click behavior on an occupied cell: reuse the DEFAULT branch of the standalone window's action logic (`bagItemAction` from `bags_view.ts`, mode default) so click-to-use/equip matches the bags window exactly; execute via the same world methods (`useItem`/`equipItem`). Tooltips via `deps.attachTooltip` + `deps.itemTooltip`.
- Drag-to-unequip: the embedded grid becomes a valid drop target for the paperdoll's `beginUnequipDrag` flow, WITHOUT breaking the existing drop-on-`#bags`-window path. Read the current drag implementation in `char_window.ts`/`hud.ts` (`beginUnequipDrag`/`endUnequipDrag` deps, hud.ts 3727-3740) before touching it; extend the drop-target set, do not replace it.
- Bag-socket cells on the paperdoll (Phase 2 made them display-only): now add right-click unequip-bag (`world.unequipBag(socket)`) with the same affordance pattern as equipment slots.
- New deps on `CharWindowDeps`: `openBags(): void` (wire to the existing bags toggle in hud.ts), plus whatever accessor the grid needs that the deps bag lacks (prefer reading through `deps.world`).

### 3. CSS

New banner `/* ---------- char bags section ---------- */` in `components.css`: header row, selector buttons (reuse `.chip`/`.tab` styling family where it fits), the grid (auto-fill columns of `--slot-cell`-sized cells, matching the standalone window's cell look). Tokens only.

### 4. i18n

`hudChrome.character.bags.title` ("Bags"), `.counter` ("{used} / {total}"), `.openFull` ("Open bags window"), `.container` ("Bag {n}"). Wordy values get the five non-Latin fills (counter is non-wordy; check each against the M16 rule and fill accordingly).

### 5. Tests

- New `tests/char_bags_view.test.ts`: container partition pinned against the real `BACKPACK_SLOTS`/`bagSlotsOf` values (equip a real bag item id from the content tables in the fixture); selector list excludes empty sockets; stale `selectedId` falls back to backpack; used/capacity counts; cell slot-index mapping across backpack + a socket bag; purity scans (both world-shaped stubs, no DOM/i18n).
- Painter tests (`tests/char_window.test.ts` family): header + counter render, selector switches container, occupied-cell click routes to the same action as the bags window default mode, drag-to-unequip onto the embedded grid unequips, bag-socket right-click unequips the bag.
- Prove non-regression: `npx vitest run tests/bags_view.test.ts tests/bags_window.test.ts tests/bags_window_frame.test.ts tests/bag_filter.test.ts` untouched-green.

## Starter Prompt

```
This is Phase 4 of the Character Equipment Screen feature: Embedded bags.

Model: Opus 4.8, xhigh effort. Harness: Claude Code. No ultracode.

Goal: the interactive BAGS section (header, container selector, grid) inside the Equipment tab,
reusing the pure bags machinery, without regressing the standalone bags window.

STEP 0 - PRE-FLIGHT: git status clean, feat/char-equipment, Phase 3 QA PASS per progress.md.
Read docs/char-equipment/state.md yourself.

STEP 1 - LOAD CONTEXT:
Spawn one Explore agent to read and summarize:
- docs/char-equipment/phase-04-embedded-bags.md (this file)
- src/ui/bags_view.ts (whole) + src/sim/bags.ts (BACKPACK_SLOTS, bagSlotsOf)
- src/ui/bags_window.ts: fillGrid (around 446-645) and the default-mode click dispatch
- src/ui/char_window.ts (current) + the drag-to-unequip flow, plus hud.ts 3708-3760 (deps wiring,
  beginUnequipDrag/endUnequipDrag) and the bags toggle method name
- src/world_api/inventory.ts (InvSlot, bags, bagCapacity, useItem/equipItem/unequipBag)
- tests/bags_view.test.ts (fixture style with real item ids)
- One real equippable bag item id from src/sim/content (search kind bag)
Return: the exact partition helpers, the default-mode action path, the drag flow, the deps bag,
the bags toggle name, and a real bag item id for fixtures.

STEP 2 - EXECUTE (two agents in parallel, then integrate):
- core-agent: src/ui/char_bags_view.ts + tests/char_bags_view.test.ts + UI_PURE_CORES
  registration (tests written first).
- painter-agent: the char_window.ts bags section + CSS + i18n keys/fills + painter tests +
  the openBags/unequip-bag wiring in hud.ts, coded against the core contract in this file.
Integrate, then drive the real app: select containers, click-use a consumable, click-equip a
weapon from the embedded grid, drag a worn item onto the embedded grid, right-click a bag socket,
open the standalone bags window and repeat its flows to prove no regression.

INVARIANTS IN PLAY:
- Container math from src/sim/bags.ts helpers only; never re-derived.
- Click semantics identical to the standalone window's default mode (same bagItemAction branch).
- The sacred unequip flows and the drop-on-#bags path keep working; extend, never replace.
- Pure core rules; painter no-magic-values; t()/esc()/formatNumber; CSS tokens + ten-dash banner;
  M16 fills; selector buttons >= 40x40 px.
- No em/en dashes or emojis. Nothing under src/sim, src/net, server, src/world_api* (read-only use
  of existing members is the point; adding members violates locked decision 11).

OUT OF SCOPE: filter/sort/search in the embedded grid (standalone window keeps those), money
footer (money lives in the titlebar accessory), Overview tab, mobile CSS.

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit
- npx vitest run tests/char_bags_view.test.ts tests/char_view.test.ts tests/char_window.test.ts tests/char_window_frame.test.ts tests/architecture.test.ts
- npx vitest run tests/bags_view.test.ts tests/bags_window.test.ts tests/bags_window_frame.test.ts tests/bag_filter.test.ts
- npx vitest run tests/localization_fixes.test.ts tests/i18n_completeness.test.ts
- npx vitest run tests/css_corpus.test.ts tests/css_value_validity.test.ts
- npm run ci:changed
- node scripts/char_equipment_shot.mjs (grid visible in the desktop shot)
- qa-checklist agent (COVERAGE prompt).

STEP 4 - COMMIT CADENCE:
- feat(ui): add char_bags_view pure core for the embedded bags grid
- feat(ui): embedded bags section with container selector in the character window
- docs(char): mark phase 4 complete

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] Selector shows backpack + occupied sockets only; counter = used/capacity of selection
- [ ] Click-to-use and click-to-equip from the embedded grid match the standalone window
- [ ] Drag-to-unequip works onto BOTH the embedded grid and the standalone window
- [ ] Bag-socket right-click unequips the bag
- [ ] All bags_* suites untouched-green; full validation list green

STEP 6 - DOC UPDATES: progress.md; state.md (final bags keys, any bags_view helpers extended).

STEP 7 - FINAL RESPONSE: status, files, validation, verdicts, handoff for Phase 4 QA.

STOPPING RULES:
- Stop and ask if matching the standalone click semantics requires refactoring bags_window.ts
  beyond extracting a shared pure helper into bags_view.ts.
- Stop and ask if the drag flow cannot gain a second drop target without changing hud.ts beyond
  the deps wiring block.
```

## QA Starter Prompt

```
This is Phase 4 QA of the Character Equipment Screen feature: verify the embedded bags.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

STEP 0: git status clean. Read docs/char-equipment/state.md.
STEP 1: Explore agent: phase-04 file, progress.md, Phase 4 diff, touched tests.
STEP 2 - AUDIT (parallel, COVERAGE):
Correctness agent: partition vs src/sim/bags.ts helpers (literal cross-check); click parity with
the standalone default mode (trace both paths to the same world call); drag both drop targets in
the running app; stale-selection fallback; socket right-click.
Test-coverage agent: fixtures use real item ids; both drop targets asserted; bags_* suites
untouched (git diff shows no edits); decisive counter assertions.
i18n agent: keys + fills per M16 check on each value; formatNumber on counter numbers.
STEP 3 - FIX all BLOCKING/SHOULD-FIX; rerun validation; commit fixes.
STEP 4: progress.md + state.md; commit.
STEP 5 - FINAL RESPONSE: verdict, counts, handoff for Phase 5.
```
