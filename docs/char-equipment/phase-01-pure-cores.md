# Phase 1: Pure view cores

Goal: land the data models the whole redesign paints from, with zero DOM: the reworked paperdoll arrangement (including the bag-socket top slot) and the new stat-panels core.

## Design contract (implement exactly this)

### 1. `src/ui/char_view.ts` rework

Change the column constants to the new arrangement (locked decision 2):

```ts
export const PAPERDOLL_LEFT_SLOTS: readonly EquipSlot[] = ['helmet', 'neck', 'shoulder', 'chest', 'gloves'];
export const PAPERDOLL_RIGHT_SLOTS: readonly EquipSlot[] = ['mainhand', 'waist', 'legs', 'feet', 'ring1', 'ring2'];
```

Extend the view with the bag-socket top slot. Keep `PaperdollSlot` as-is; add:

```ts
export interface BagSocketView {
  socket: number;              // 0..3, index into world.bags
  item: ItemDef | null;        // resolved bag item or null when the socket is empty
}
export interface PaperdollView {
  left: PaperdollSlot[];
  right: PaperdollSlot[];
  bagSockets: BagSocketView[]; // always length 4, in socket order
}
export function buildPaperdollView(
  equipment: Partial<Record<EquipSlot, string>>,
  bags: readonly (string | null)[],
  items: Record<string, ItemDef>,
): PaperdollView
```

Note the signature change (new `bags` middle parameter): the painter call site in `char_window.ts` will not compile until Phase 2 touches it, so in THIS phase update that one call site mechanically (pass `deps.world.bags`, render nothing new) to keep `tsc` green. Do not restyle anything yet.

Rules the existing file already follows and you must keep: no DOM, no Three, no i18n, no RNG, unknown item ids resolve to `item: null`, module stays in `UI_PURE_CORES`.

### 2. New `src/ui/char_panels_view.ts`

Pure module (register in `UI_PURE_CORES`), no imports beyond `src/sim` types and sibling pure cores. Contents:

```ts
import type { StatId } from './stat_tooltip';
import { virtualLevel, xpForLevel } from '../sim/types';

export const ATTRIBUTE_PANEL_STATS: readonly StatId[] =
  ['str', 'agi', 'sta', 'int', 'spi', 'armor', 'attackPower', 'dps', 'critChance', 'dodge'];
export const COMBAT_PANEL_STATS: readonly StatId[] =
  ['attackPower', 'dps', 'critChance', 'critRating', 'hasteRating', 'spellPower'];
export const DEFENSE_PANEL_STATS: readonly StatId[] = ['armor', 'dodge'];

export interface ProgressionPanelModel {
  totalXp: number;        // lifetimeXp, monotonic
  virtualLevel: number;   // virtualLevel(lifetimeXp)
  prestigeRank: number;   // hidden by the painter when 0
  levelXp: number;        // current progress into the level (same source xp_bar uses)
  levelXpMax: number;     // xp needed for the next level (same math xp_bar uses)
  atMaxLevel: boolean;    // painter renders a full, label-less bar when true
}
export function buildProgressionPanel(input: {
  lifetimeXp: number; xp: number; level: number; prestigeRank: number;
}): ProgressionPanelModel

export interface SpecPanelModel {
  specId: string | null;  // null = no specialization chosen
}
export function buildSpecPanel(talentSpec: string | null): SpecPanelModel
```

Before writing `buildProgressionPanel`, read `src/ui/xp_bar.ts` and reuse its exact level-progress math (which `xpForLevel` boundary it uses, how max level is detected via `MAX_LEVEL`); do not invent a variant. The panel and the HUD XP bar must never disagree.

The stat-id lists are LOCKED (state.md decision 5). Do not add ranged power, hit, block, parry, or resistance entries; they intentionally do not exist.

### 3. Registration + tests

- Add both new/changed cores to `UI_PURE_CORES` in `tests/architecture.test.ts` (the array at lines 122-199; `char_view.ts` is already there, add `char_panels_view.ts`).
- Update `tests/char_view.test.ts`: it pins the OLD column arrays exactly; re-pin to the new arrays, keep the existing coverage style (each slot resolves in column order, jewelry placement, empty/unknown id -> null, Sim-vs-ClientWorld stub parity, purity scans), and add bag-socket cases: 4 sockets always returned, equipped bag resolves, empty socket -> null, unknown bag id -> null.
- New `tests/char_panels_view.test.ts`, following the house test style (see `tests/gathering_view.test.ts` for the shape):
  - pins all three stat-id arrays to their exact literal contents (order included),
  - `buildProgressionPanel` cross-checked against the real XP tables: totalXp passthrough, virtualLevel agrees with `virtualLevel()` from `src/sim/types.ts` for 0, mid, and huge lifetimeXp, level bar values agree with the `xp_bar.ts` math for a low level, a mid level, and max level (`atMaxLevel` true, no division by zero),
  - `buildSpecPanel(null)` and `buildSpecPanel('assassin-or-whatever-real-id')` (use a real spec id from `src/sim/content/talents.ts`),
  - purity: same-input-same-output, works against both a Sim-shaped and a ClientWorld-shaped stub input, no DOM/Three/i18n imports (mirror the scan assertions in `tests/char_view.test.ts:106`).

## Starter Prompt

```
This is Phase 1 of the Character Equipment Screen feature: Pure view cores.

Model: Opus 4.8, xhigh effort. Harness: Claude Code. No ultracode (small phase).

Goal: land the reworked paperdoll model (new slot columns + bag-socket top slot) and the new
char_panels_view pure core, fully tested, with zero visual/painter changes beyond keeping tsc green.

STEP 0 - PRE-FLIGHT:
- git status clean, branch feat/char-equipment. If dirty, ask the user.
- Memory scan: MEMORY.md entries on char window, Windows gate quirks.
- Read docs/char-equipment/state.md yourself (small, written for you). Its locked decisions
  override anything you would otherwise infer.

STEP 1 - LOAD CONTEXT:
Spawn one Explore agent to read and summarize:
- docs/char-equipment/phase-01-pure-cores.md (this file: confirm shared understanding)
- src/ui/char_view.ts (whole file, it is 67 lines) and tests/char_view.test.ts
- src/ui/xp_bar.ts (the exact level-progress math and MAX_LEVEL handling)
- src/ui/stat_tooltip.ts lines 30-60 (the StatId union)
- src/sim/types.ts lines 2600-2720 (XP_TABLE, xpForLevel, virtualLevel, virtualLevelProgress, MAX_LEVEL)
- src/world_api/inventory.ts (bags/bagCapacity shapes)
- tests/architecture.test.ts lines 60-200 (UI_PURE_CORES registration + the forbidden-import scans)
- src/ui/CLAUDE.md, section "Authoring a new HUD component" (pure-core rules)
Return: the current buildPaperdollView signature and call sites, the xp_bar math verbatim,
the StatId list, the UI_PURE_CORES registration mechanics, and one real spec id from
src/sim/content/talents.ts.

STEP 2 - EXECUTE (inline, no fan-out; this is one coherent slice):
Implement the design contract in docs/char-equipment/phase-01-pure-cores.md exactly:
1. char_view.ts: new column constants, BagSocketView, PaperdollView.bagSockets,
   buildPaperdollView(equipment, bags, items). Update the single char_window.ts call site
   mechanically so tsc stays green (pass deps.world.bags; render nothing new).
2. New src/ui/char_panels_view.ts per the contract signatures.
3. Register char_panels_view.ts in UI_PURE_CORES (tests/architecture.test.ts).
4. Re-pin tests/char_view.test.ts; write tests/char_panels_view.test.ts per the contract.
Write the tests FIRST for the new core (they fail), then implement to green.

INVARIANTS IN PLAY:
- Pure cores: no DOM, no Three, no i18n, no RNG, no render/net/game imports, no *_window/
  *_painter imports. Instance-parameterized (no hardcoded element ids).
- The three stat-id arrays are LOCKED as written in the phase file; all slot arrays LOCKED.
- No changes outside: src/ui/char_view.ts, src/ui/char_panels_view.ts, src/ui/char_window.ts
  (one mechanical call-site line), tests/char_view.test.ts, tests/char_panels_view.test.ts,
  tests/architecture.test.ts (allowlist entry), docs/char-equipment/ (progress/state).
- No em dashes / en dashes / emojis anywhere.

OUT OF SCOPE (do NOT do): any CSS, any painter markup change, tabs, bags grid, i18n keys,
anything under src/sim, src/net, server.

STEP 3 - VALIDATION + REVIEW:
- npx tsc --noEmit
- npx vitest run tests/char_view.test.ts tests/char_panels_view.test.ts tests/architecture.test.ts tests/char_window.test.ts tests/char_window_frame.test.ts
- npm run ci:changed
- Spawn the qa-checklist agent over the diff (COVERAGE prompt). No other review agents
  (pure src/ui change; see the dispatch note in implementation-plan.md).

STEP 4 - COMMIT CADENCE (explicit paths, never git add -A):
- feat(ui): rework paperdoll view model for the equipment screen layout
- feat(ui): add char_panels_view pure core for the character stat panels
- docs(char): mark phase 1 complete

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] New column arrays and bagSockets model exactly as contracted; char_view.test.ts pins them
- [ ] char_panels_view.ts exports exactly the contracted names; test cross-checks against real XP tables and a real spec id
- [ ] Both cores registered and green in tests/architecture.test.ts
- [ ] All listed vitest files + tsc + ci:changed green
- [ ] Game still boots and the char window still opens unchanged (npm run dev, quick manual check)

STEP 6 - DOC UPDATES: progress.md (Phase 1 checkboxes + notes), state.md (current-phase line,
any gotchas). Include in the docs commit.

STEP 7 - FINAL RESPONSE: phase status, files touched, validation results, qa-checklist verdict,
deferrals, one-line handoff for the Phase 1 QA session.

STOPPING RULES:
- Stop and ask if the xp_bar math cannot be reused without refactoring xp_bar itself.
- Stop and ask if keeping tsc green requires more than the one mechanical char_window.ts call-site edit.
```

## QA Starter Prompt

```
This is Phase 1 QA of the Character Equipment Screen feature: verify the pure view cores.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: audit Phase 1 (char_view rework + char_panels_view) for contract fidelity, test decisiveness,
and scope discipline.

STEP 0: git status clean (Phase 1 committed). Read docs/char-equipment/state.md yourself.

STEP 1: Spawn one Explore agent to read: docs/char-equipment/phase-01-pure-cores.md,
progress.md (Phase 1 section), the Phase 1 diff (git log + git diff against the phase-start
commit), and the four test files touched. Return: every contracted item vs what landed.

STEP 2 - AUDIT (spawn these two in parallel; prompt for COVERAGE, not filtering):
Correctness agent:
- Every contract signature matches exactly (names, parameter order, readonly-ness).
- buildProgressionPanel agrees with src/ui/xp_bar.ts math at level 1, a mid level, and MAX_LEVEL.
- buildPaperdollView: 4 bagSockets always, unknown ids -> null, column order preserved.
- The char_window.ts call-site edit is mechanical only (no visual change).
- Scope: diff touches only the files the phase allows.
Test-coverage agent (or dispatch the test-coverage-auditor agent):
- Pins are decisive (literal arrays, not self-comparisons); both world-shaped stubs exercised;
  purity scans present for the new core; no orphaned assertions from the re-pin.

STEP 3 - FIX all BLOCKING and SHOULD-FIX findings; rerun the Phase 1 validation commands.
Commit fixes separately (explicit paths).

STEP 4: Update progress.md (Phase 1 QA row) and state.md. Commit.

STEP 5 - FINAL RESPONSE: verdict PASS / PASS-WITH-FOLLOWUPS / FAIL, counts fixed, handoff line
for Phase 2.
```
