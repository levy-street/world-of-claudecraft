# Phase 9b: The bed verbs (PROPOSED by the Phase 9 QA, 2026-08-17)

STATUS: PROPOSED, NOT ADOPTED. The Phase 9 QA (state.md deviation (bn)) established that
no client-side player control plants or harvests a bed: `plantCrop` and `harvestCrop`
exist on `IWorldFarming`, in `Sim`, in `ClientWorld`, and in `server/farming_commands.ts`,
and every suite drives them, but nothing under `src/ui`, `src/game`, `src/render`, or
`src/main.ts` calls either, no bed is an interact target, no window offers a seed
picker, and no `/dev plant` exists. So `q_farm_intro` is offered and accepted and can
never be completed by an ordinary player, and Phase 9's binding Live-surface note ("the
full plant-grow-harvest-cook loop is reachable by ordinary players") is unmet while the
quest and its teaching copy are live. No phase file in the packet ever planned the
client verb; this file is the QA's proposal for the phase that does. The maintainer
adopts it (add the row to implementation-plan.md's phase table between 9 QA and 10 and
strike this paragraph) or strikes it and re-dormants the intro quest and copy instead.
docs/farming/state.md is the authority; if this file contradicts it, state.md wins.

Live-surface note (binding, if adopted): After this phase merges, an ordinary player
plants a seed into a garden bed and harvests a ready or withered plot from the game
client on desktop, touch, and gamepad, with the plant-time knobs (compost, farmer's
watch, growth tonic) chosen in the same gesture per D8. Nothing new becomes obtainable:
the phase adds no item, no NPC, no quest, no command, no IWorld member, and no wire
field; it wires the verbs the sim already owns. After it, Phase 9's Live-surface note is
met and q_farm_intro completes through the client.

## What the QA found about the seams (read before planning)

- The harvest is choice-free, so it belongs in the gather-node interaction family:
  `src/game/nearby_interaction.ts` (`tryNearbyInteraction`, the interact key on desktop
  and the interact button on touch) walks `GATHER_NODES` through the
  `NearbyInteractionWorld` seam, which already carries the sibling shape
  (`nodeHarvestableByMe`, `harvestNode`, `pickUpObject`) and the `NearbyInteractionHud`
  opener deps (`openQuestDialog`, `openDelveBoard`). A bed arm returns an
  `InteractionOutcome`, keeps the priority order and the trailing nothing-to-interact
  string (pinned by `tests/client_shell.test.ts`), and calls `world.harvestCrop(bedId)`
  for a ready or withered plot of the caller's own.
- The plant needs a seed choice (and the D8 knobs), so it is a WINDOW, not an
  interaction outcome: a pure core `src/ui/farming_plant_sheet_view.ts` (registered in
  `UI_PURE_CORES` in `tests/architecture.test.ts`, driven directly by a Vitest against
  BOTH a Sim-shaped and a ClientWorld-mirror-shaped `IWorld` stub) that lists the seeds
  in the caller's bags whose crop tier the caller's hoe and skill allow, the three knobs
  with their bag-derived affordability (compost count, the tier-scaled produce fee from
  `farm_watch_fee.ts`, tonic count), and the deny reason the sim WOULD answer, without
  ever predicting an outcome; plus a thin `src/ui/farming_plant_sheet_window.ts` on the
  `PainterHost` writers, composed by `Hud` exactly like `HarvestJournalWindow`, opened
  through a new `NearbyInteractionHud.openPlantSheet(bedId)` dep from a bed the caller
  stands beside and has not planted. Its one button sends
  `world.plantCrop(bedId, cropId, knobs)`; the sim's own `farmPlanted` / `farmDenied`
  events remain the feedback (the husk-trade row's contract).
- Bed proximity is the sim's own gate (`farmDenied` reason `range`, `INTERACT_RANGE` at
  the bed), so the client verb re-checks nothing it does not need to; the nearby-bed
  resolver reads `IWorld.farmPatches` (static content) and `myFarmPlots`.
- The world-space affordance (a highlighted bed, a ripe marker, a hover tooltip on the
  gather-node tooltip family) is a `src/render/<thing>.ts` sibling; `renderer.ts` has
  ZERO monolith headroom. `hud.ts` (5 lines) and `main.ts` (1 line) cannot host the
  window field, the open route, or the widened `tryNearbyInteraction` bag either: an
  extraction lands FIRST in each (the ratchet rule: extract, then LOWER the ceiling),
  and a ceiling raise is a maintainer decision.
- Mobile: the touch interact button already routes `tryNearbyInteraction`; the plant
  sheet must fit the 844x390 landscape viewport (the standing capture rule) and the
  knob toggles must be finger-sized. Gamepad: the interact edge action.
- i18n: every label, aria, and toast is a `t()` key in the matching
  `src/ui/i18n.catalog/hud_chrome.ts` domain (English only; M16 fills for any wordy new
  English value); the deny lines reuse `hudChrome.farming.denied.*`.
- Tests that would have caught the gap and must land with the verb: a jsdom test that
  presses the interact key beside a planted ready bed and asserts `world.harvestCrop`
  (and beside a free bed opens the sheet), a sheet test that clicks Plant and asserts
  `world.plantCrop(bedId, cropId, knobs)` once with the chosen knobs, and a browser
  journey (`scripts/*.mjs` on the dev client) that drives q_farm_intro to completion
  through client-facing entry points ONLY, no `window.__game`. The Phase 9 QA's probe
  (the scratchpad `qa_journey.mjs`) is the recipe: boot, LOW preset, the overlay
  dismissals, then the real gossip / vendor / dialog clicks.
- Nothing here changes `IWorld`, the wire, the goldens, or the sim; the parity and
  command-schema baselines (329 = 88 + 241, 34 facets, 202/215, delta keys 87,
  farming_session 19c49aac) must not move.

## Acceptance (if adopted)

- [ ] A fresh character completes q_farm_intro on the dev client through the real UI:
      accept at Jessica, buy nothing beyond the granted seed, plant at a bed through the
      interact key or a click/tap, `/dev farmgrow`, harvest through the interact key,
      turn in; no `window.__game` call anywhere in the drive.
- [ ] The plant sheet offers only sowable seeds (bag, hoe tier, skill), shows the three
      knobs with honest affordability, and sends exactly one `plantCrop` with the chosen
      knobs; a knob the bags cannot pay is refused by the SIM (never pre-empted client
      side) and the sheet stays open on the deny.
- [ ] The harvest verb works on ready AND withered plots and refuses (via the sim's
      `not_ready`) on a growing one; another player's plot in the same bed is never
      offered.
- [ ] Desktop, touch (844x390 landscape), and gamepad all reach both verbs; screenshots
      committed under docs/screenshots/farming-phase-09b (new subtree: CI cone rows in
      all five ci.yml blocks plus the `tests/ci_workflow.test.ts` literal, per the
      screenshot-dirs rule).
- [ ] hud.ts, main.ts, renderer.ts do not grow (extraction first, ceilings lowered).
- [ ] The Phase 9 Live-surface note is met; the (bn) deviation is closed in state.md;
      the journey suite's layer-honesty header is retired.
- [ ] tsc, the named suites, ci:changed, and gate_select green; no golden moves.

## Starter Prompt (draft; the maintainer trims it on adoption)

```
This is Phase 9b of the Farming feature: The bed verbs (the client-side plant and
harvest controls). Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: an ordinary player plants and harvests a garden bed from the game client, on
desktop, touch, and gamepad, through IWorldFarming.plantCrop / harvestCrop, with the D8
plant-time knobs chosen in the same gesture. No new item, NPC, quest, command, IWorld
member, wire field, or golden movement.

STEP 0 - PRE-FLIGHT: worktree ~/Documents/woc-farming-plan only; git status clean;
fetch and re-resolve the newest release/** tip; branch fix/farming-phase-09b-bed-verbs
off LOCAL feature/farming-plan; absorb the release tip first (release-merge-audit +
the (al) checklist; re-run the parity and count pins; farming_session md5 unchanged);
read state.md (bn) and (bo), the phase-09 files, and this file; record the phase-start
sha. Monolith headroom is the binding budget: measure hud.ts, main.ts, renderer.ts
against tests/monolith_budget.test.ts before planning and extract first.

STEP 1 - LOAD CONTEXT: one Explore agent over src/game/nearby_interaction.ts and its
tests, src/main.ts's interactKey and world-click paths, src/ui/harvest_journal_window.ts
+ harvest_journal_view.ts (the window recipe), src/ui/hud/CLAUDE.md, src/ui/CLAUDE.md,
src/render/CLAUDE.md, src/render/farm_patches.ts (bed seats), src/sim/professions/
farming.ts (the plant gate order and the deny reasons), farm_watch_fee.ts,
tests/quest_dialog_controller.test.ts (the husk-trade route as the click-to-world
template), and the Phase 9 QA journey probe recipe in progress.md.

STEP 2 - BUILD: pure core + thin painter for the plant sheet; the bed arm in the
nearby-interaction family; the render sibling for the bed affordance; the extractions
hud.ts / main.ts / renderer.ts need first; i18n rows; the jsdom tests and the browser
journey with no window.__game; screenshots (LOW preset; mobile landscape 844x390) with
the new cone rows.

STEP 3 - REVIEW: frontend-seam-reviewer, architecture-reviewer (if src/sim moves),
cross-platform-sync, qa-checklist; the (bn) close in state.md.

Close: gate via node scripts/gate_select.mjs; merge --no-ff into LOCAL
feature/farming-plan per D22; record the merge hash; hand off to Phase 10.
```
