# Phase 9b: The bed verbs

STATUS: ADOPTED as Phase 9b, 2026-08-18, via the maintainer-authored starter prompt
(authored 2026-08-17; using it adopts the phase per its own terms). Background: the
Phase 9 QA (state.md deviation (bn)) established that
no client-side player control plants or harvests a bed: `plantCrop` and `harvestCrop`
exist on `IWorldFarming`, in `Sim`, in `ClientWorld`, and in `server/farming_commands.ts`,
and every suite drives them, but nothing under `src/ui`, `src/game`, `src/render`, or
`src/main.ts` calls either, no bed is an interact target, no window offers a seed
picker, and no `/dev plant` exists. So `q_farm_intro` is offered and accepted and can
never be completed by an ordinary player, and Phase 9's binding Live-surface note ("the
full plant-grow-harvest-cook loop is reachable by ordinary players") is unmet while the
quest and its teaching copy are live. No phase file in the packet ever planned the
client verb; this file is the phase that does.
docs/prd/masterwrought/farming/state.md is the authority; if this file contradicts it, state.md wins.

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
  ZERO monolith headroom. `hud.ts` (5 lines) cannot host the
  window field, the open route, or the widened `tryNearbyInteraction` bag either: an
  extraction lands FIRST (the ratchet rule: extract, then LOWER the ceiling),
  and a ceiling raise is a maintainer decision. `main.ts` carries 6 lines from the
  nineteenth-absorb turnstile extraction: enough for thin wiring, extraction-first
  beyond that.
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
  farming_session 9a8fefa5, the nineteenth-absorb re-mint) must not move.

## EXECUTED (2026-08-18/19, branch fix/farming-phase-09b-bed-verbs off 6981105f27)

Commit map: 2e6fcb42b9 adoption; 7ba29ede2c the hud.ts headroom extraction
(openReportWindow moved whole to src/ui/report_window_open.ts, since renamed
to src/ui/report_window.ts by the 9b QA so the cold-painter sweep governs it,
ceiling 19387 to
19352); 5575f50260 the seam widening (REQUIRED members, IWorld and Hud satisfy
structurally, main.ts untouched); 252138c1db the plantSheet i18n rows with the
five non-Latin fills; lanes A/B/C in three worktrees (6dd657a148 + 4486a8fb17
the bed arm and reachability pins, a2c07b2b12 + 8ea2432772 the plant sheet and
its Hud composition, 6580d32ddc + bcd2132b8b the journey E2E, six LOW-preset
captures, the CI cone rows, and the pr_shot_targets target), merged f0bbefd61a
/ 7196e5f2e0 / 93a3998771; b2963c1d91 the convertHusks reachability describe
(cross-platform review); 7c97ca51d1 the consolidated review-round fixes (the
panel keydown guard, the relocalize arm and registry row, same-bed re-press
preserves picks, any-farmPlanted clears the send arm, the plantSheet.close key,
the live reportHooks getter, and eleven new decisive test arms including the
comment-stripped Hud glue pin and the both-entries root pin). Reviews:
cross-platform APPROVE, frontend pass (all seven should-fixes taken), coverage
(B1 closed by the journey on the final tree, B2/B3 pinned, S1-S7 landed),
gate-integrity and qa-checklist recorded in progress.md. Mutations 10/10
KILLED with named reds through the dirty-refusing runner. The journey passed
17/17 on the final merged tree (desktop; lane C also proved the 844x390
landscape touch route through the real #mobile-interact button). GAMEPAD
REACH is verified by inspection plus a standing pin: the pad dispatch's
case 'interact' routes through the same interactKey() funnel and
tests/pad_reel.test.ts source-pins interactKey() inside that braced case
(deleting it reds the pin), the same shape whose touch twin killed the
mobile-unwired mutant. The qa-checklist round's remaining asks landed
post-snapshot: the NPC-versus-bed precedence arm (the
farmer-at-the-beds collision), the escort-versus-bed pair, the knob
captures eyeballed real, and the funnel-level harvest dispatch was
already pinned (the it.each plot arms assert harvestCrop THROUGH
tryNearbyInteraction; mutant M5, the gutted call, died on exactly them).
DESIGN REFINEMENT (deviation (bp) in state.md): unaffordable knobs and
non-sowable seeds are OFFER gates (disabled controls with the family's own
denied.* line), not outcome predictions; the sim remains the refusing
authority for everything sent, and the acceptance line below reads through
that refinement.

## Acceptance

- [x] A fresh character completes q_farm_intro on the dev client through the real UI:
      accept at Jessica, buy nothing beyond the granted seed, plant at a bed through the
      interact key or a click/tap, `/dev farmgrow`, harvest through the interact key,
      turn in; no `window.__game` call anywhere in the drive.
- [x] The plant sheet offers only sowable seeds (bag, hoe tier, skill), shows the three
      knobs with honest affordability, and sends exactly one `plantCrop` with the chosen
      knobs; a knob the bags cannot pay is refused by the SIM (never pre-empted client
      side) and the sheet stays open on the deny.
- [x] The harvest verb works on ready AND withered plots and refuses (via the sim's
      `not_ready`) on a growing one; another player's plot in the same bed is never
      offered.
- [x] Desktop, touch (844x390 landscape), and gamepad all reach both verbs; screenshots
      committed under docs/screenshots/farming-phase-09b (new subtree: CI cone rows in
      all five ci.yml blocks plus the `tests/ci_workflow.test.ts` literal, per the
      screenshot-dirs rule).
- [x] hud.ts, main.ts, renderer.ts do not grow (extraction first, ceilings lowered).
- [x] The Phase 9 Live-surface note is met; the (bn) deviation is closed in state.md;
      the journey suite's layer-honesty header is retired.
- [x] tsc, the named suites, ci:changed, and gate_select green; no golden moves.

## Starter Prompt (the session form; using it adopts the phase)

```
This is Phase 9b of the Farming feature: The bed verbs (the client-side plant and
harvest controls). Model: Opus 4.8, xhigh effort (1m context variant where the file
load demands it). Harness: Claude Code.

Goal: an ordinary player plants a seed into a garden bed and harvests a ready or
withered plot from the game client on desktop, touch, and gamepad, through the
IWorldFarming.plantCrop / harvestCrop verbs the sim already owns, with the D8
plant-time knobs (compost, farmer's watch, growth tonic) chosen in the same gesture,
so that q_farm_intro completes through the client and Phase 9's binding Live-surface
note ("the full plant-grow-harvest-cook loop is reachable by ordinary players")
becomes true. This phase adds NO item, NO NPC, NO quest, NO command, NO IWorld member,
NO wire field, and moves NO golden and NO NPC: it wires verbs, nothing else. Using
this prompt ADOPTS the phase the Phase 9 QA proposed (docs/prd/masterwrought/farming/
phase-09b-bed-verbs.md, state.md deviation (bn)).

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Other sessions
  share the main checkout; never work there. Prefix EVERY shell command with
  cd ~/Documents/woc-farming-plan && export PATH=$HOME/.nvm/versions/node/v26.5.0/bin:$PATH
  (the Bash cwd resets between calls; the inherited shell has Node 24 and no pnpm).
- git -C ~/Documents/woc-farming-plan status must be clean, on feature/farming-plan
  at 03d70f2385 or later (the Phase 9 QA merged --no-ff as 59584a800a on
  2026-08-17, QA tip 224fdd138c, followed by the merge-hash record 03d70f2385).
  Stop if it is not.
- Branch fix/farming-phase-09b-bed-verbs off LOCAL feature/farming-plan (D22: never
  off a bare release tip, which lacks the packet). No pushes, no PRs.
- ADOPTION, the first docs edit on the branch: strike the PROPOSED labels in
  docs/prd/masterwrought/farming/phase-09b-bed-verbs.md (its STATUS paragraph), the 9b row of
  docs/prd/masterwrought/farming/implementation-plan.md's phase table, and the README list line;
  add "ADOPTED as Phase 9b, 2026-08-17" to state.md deviation (bn) and to the
  Phase 9 QA DECISIONS OWED line of the OPEN list. Deviation (bo) (tier 3/4 seeds
  have no first faucet) is NOT this phase's: read it, do not decide it, ship no seed
  source, and leave its OPEN line intact.
- Re-resolve the NEWEST release/** branch: git fetch origin --prune, then
  git branch -r --list 'origin/release/*' | sort -V (VERSION sort) and take the last
  row. The branch has absorbed release/v0.39.0 through 7b45fdb9a9 (the NINETEENTH
  absorb, run 2026-08-18 as its own sync mid-phase per the D22 triple-digit rule;
  its record is in state.md's head block and progress.md). If a newer tip exists,
  merge it INTO the phase branch FIRST:
  release-merge-audit skill plus the state.md deviation (al) absorb checklist
  (portrait manifest fingerprint-only re-mint through
  scripts/build_mob_portrait_source_manifest.mjs --write plus the accepted-art
  registry row; scripts/item_art_audit.mjs --verify-only; the ART-SUBJECT rule for
  any release seal over a live inventory that pending-art items can join), re-run
  tests/world_api_parity.test.ts, tests/snapshots.test.ts,
  tests/command_schema.test.ts, tests/monolith_budget.test.ts, and tests/parity,
  and classify any farming_session golden movement before re-minting (the release
  re-records ITS goldens for a static-entity shift and can never re-record the
  branch-only farming_session: expect the (am) shape on any absorb that adds static
  world content). A minor-version jump (a release/v0.40.x tip) or a triple-digit
  intersection runs the phase-06b-release-sync shape as its OWN mid-phase first.
  ABSORB TRAPS proven live: any pnpm-lock.yaml move fires the farm-props seal
  family (byte-level restamp of BOTH stamp sites in all fifteen GLBs, sizes held,
  sha pins re-recorded, assets manifest regen; commits 1f97379ae6 and d07b578e5d
  show the shape); any patches/ move needs pnpm install; a both-sides Eastbrook seal
  conflict resolves ONLY by remint_polish_provenance.mjs on the merged tree;
  `git checkout --theirs <conflicted pin suite>` DISCARDS non-conflicting arms
  (restore with `git checkout -m -- <file>` and resolve hunk by hunk); the release's
  monolith ceilings can land BELOW your working count (heal by extraction, never a
  raise).
- Baselines as of the nineteenth-absorb sync (2026-08-18), ALL of which this phase
  must leave UNCHANGED: IWorld
  329 members (88 data, 241 method), facet count 34, command_schema 202/215, delta
  keys 87, farming_session golden md5 9a8fefa5e48c7e456db7ef2695bfb284, every other
  golden, the terrain atlas, the Eastbrook chunk digest, the map plates (do NOT move
  any NPC: every NPC is a terrain calm pad). MONOLITH HEADROOM: hud.ts 5 lines
  (19382/19387), renderer.ts 0 (13774/13774), main.ts 6 (11454/11460), sim.ts 3
  (12657/12660), server/game.ts 109 (10791/10900). This phase's wiring CANNOT land on
  hud.ts or renderer.ts as they stand (main.ts has 6 lines from the sync's turnstile
  extraction, enough for thin wiring only): for each one you must touch, an
  EXTRACTION lands FIRST as its own commit (move a self-contained block into a
  sibling module behind the file's existing seam, move-not-rewrite, then LOWER that
  file's ceiling in tests/monolith_budget.test.ts to the new size plus a small
  margin), and only then the one composition line. A ceiling raise is a maintainer
  decision: stop before one. Prefer designs that touch renderer.ts NOT AT ALL (see
  the renderer seals trap below).
- Record the phase-start commit (git rev-parse HEAD).
- Scan Claude Code memory: the MEMORY.md index; the farming-skill-program topic (its
  PHASE 9 QA paragraph is the freshest record: the (bn) finding, the design recipe,
  the live-client journey traps); sim-api-green-hides-missing-player-verb (the whole
  reason this phase exists: green through the sim API says nothing about
  reachability, so every acceptance test here drives the CLIENT verb, never
  sim.plantCrop); npcs-are-terrain-calm-pads (touch no NPC seat);
  pr-screenshot-browser-path (BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/
  chrome-linux64/chrome; no system Chrome; the camera-choice dialog and #gpu-notice
  eat clicks on fresh profiles); screenshots-on-low-graphics (LOW preset always;
  mobile captures LANDSCAPE 844x390); screenshot-dirs-need-ci-cone-rows
  (docs/screenshots/farming-phase-09b is a NEW subtree: it joins all five ci.yml
  sparse-checkout blocks AND the tests/ci_workflow.test.ts literal in the same
  change, and gate-integrity-reviewer reads that diff); renderer-edit-stales-
  evidence-seals (ANY renderer.ts edit stales the Eastbrook polish composite, the
  portrait stills bundle, and the accepted-art registry row: three sanctioned
  re-mints, all full-suite-fallback-only, so put the bed affordance in a
  src/render/<thing>.ts sibling and touch renderer.ts only if a pick or a
  composition line truly needs it, then run the three re-mints in the same change);
  window-world-read-widening-needs-browser-rig (a new world.X read inside a
  window's buildInput throws in tests/browser/a11y.browser.test.ts, browser config
  only: grep every rig, run the browser file); lockfile-moves-asset-seals;
  i18n-semantic-regressions-gate-trap (never reword an EXISTING translated key; new
  keys are English-only in the matching src/ui/i18n.catalog/hud_chrome.ts domain,
  plus the five non-Latin fills for any wordy new English value, M16);
  fanout-agent-delivery-traps (custom-agentType reviewers die report-less inside a
  Workflow: content-obligations, test-coverage, cross-platform have all done it;
  dispatch them on the Agent tool with the report-via-SendMessage-to-main line as
  the FIRST instruction and a 25-call budget, keep the Workflow for the plain
  implementer and audit lanes, and check the Workflow journal for LEN 0 results
  before calling a lane done; a background Explore loader can idle without a report:
  nudge once by SendMessage, then load the context yourself);
  mutation-checks-commit-first (commit the feature, then run mutants through a
  scratchpad runner that refuses a dirty target file, applies one exact-string
  mutant, records rc + failing test names + the summary line, restores via git
  checkout, and verifies the restore); worktree-cwd-drift-misroutes-git;
  pkill-pattern-matches-own-shell (kill dev servers by port: fuser -k 5188/tcp);
  frozen-clock-rig-hangs-vitest (any injected lockoutNowMs must advance);
  big-diff-reviewer-turn-budgets. Also note the nineteenth absorb's item-lock
  rework: setItemLocked now locks the named slot WHOLE (no single-unit peel,
  reason union reduced to not_held), so any plant-sheet bag read or test rig
  that wants a locked/unlocked mix builds it by granting around a lock (the
  rebuilt rigs in tests/professions_farming.test.ts are the template).
- READ docs/prd/masterwrought/farming/state.md's head block, deviation (bn) whole (the finding, its
  proof, and the design recipe), (bo) (read only), (bg) (the intro grant fence: the
  faucet closes only once the quest can turn ready, which this phase makes possible
  for the first time), (be) (the simplified-mode professions rows), (az) (no
  side-rail button; hud.ts headroom is the binding budget), (an) (coordinator
  headroom is absorb-eroded), the D8 / D9 / D18 decisions, and the OPEN list;
  docs/prd/masterwrought/farming/phase-09b-bed-verbs.md whole (the seams paragraph and the acceptance
  list are the spec); docs/prd/masterwrought/farming/progress.md's Phase 9 QA notes (the live-client
  journey recipe: vite on :5188 with --strictPort --host 127.0.0.1, offline Sim
  world, playwright chromium with --use-angle=swiftshader
  --enable-unsafe-swiftshader, LOW preset seeded through localStorage woc_settings
  graphicsPreset 1 before boot, woc_gpu_notice_dismissed and
  woc.cameraModePrompt.shown pre-seeded, scripts/enter_offline_game.mjs to enter,
  then a dismissal loop over .camera-prompt-confirm, .tut-skip,
  .gpu-notice-dismiss and #gpu-notice before every click; the traps: never declare a
  const named URL, a bulk-buy probe must clear bag space first, the quest-row click
  can race a repaint so retry it, tick() drains the event buffer so read events in
  the same evaluate as the click); the phase-09-world-presence.md and
  phase-08-harvest-journal.md files for the surfaces you extend.

STEP 1 - LOAD CONTEXT
Spawn ONE very-thorough Explore agent (plain-text return; if it idles, one nudge,
then load it yourself) over the CURRENT tree: src/game/nearby_interaction.ts
(tryNearbyInteraction, the NearbyInteractionWorld and NearbyInteractionHud seams,
InteractionOutcome, the priority order and the trailing nothing-to-interact string)
and every suite that pins it (tests/client_shell.test.ts and the rest: grep for
tryNearbyInteraction); src/game/gather_node_interact.ts (handleGatherNodeInteract,
decideGatherNodeAction: the outcome/denial-line shape to mirror); src/main.ts's
interactKey, the world-click path (renderer.pickGatherNode, pickSloppy), the
gatherEffectConfirm bag, and how src/game/mobile_controls.ts ('mobile-interact' ->
callbacks.onInteract) and the gamepad interact edge action reach the same interactKey;
src/render/renderer.ts pickGatherNode and how gather-node meshes become pickable,
src/render/farm_patches.ts (the FarmBedSeat map, FarmPatchVisuals per-viewer sync)
and farm_patches_core.ts, src/render/CLAUDE.md (RENDER_PURE_CORES);
src/ui/harvest_journal_view.ts + harvest_journal_window.ts and the exact lines Hud
uses to compose, open, and render it (the window recipe: pure core in UI_PURE_CORES
in tests/architecture.test.ts, thin painter on the PainterHost writers, the focus
trap, the mobile layout), src/ui/hud/CLAUDE.md, src/ui/CLAUDE.md,
src/styles/CLAUDE.md; src/world_api/farming.ts (plantCrop's FarmPlantKnobs shape,
myFarmPlots, farmPatches, farmNowMs; the facet is FROZEN this phase);
src/sim/professions/farming.ts (the plant gate ORDER and every farmDenied reason
verbatim, the hoe/tier/skill/seed/knob gates), farm_watch_fee.ts (the produce fee
plan per tier and its bag scan), src/sim/professions/tools.ts (the wieldable hoe
tier scan), src/sim/content/farm_crops.ts (seedItemId, tier) and farm_patches.ts
(FARM_BED_IDS, farmBedById); src/ui/farming_view.ts (farmDeniedToast, the deny
keys); tests/quest_dialog_controller.test.ts's husk-trade arm and
src/ui/hud/quest/quest_dialog_controller.ts's [data-husk-trade] listener (the
click-to-world template: send, then close(true)); tests/harvest_journal*.test.ts;
scripts/enter_offline_game.mjs and scripts/pr_shot_targets.mjs
(stageFarmerJessica, stageEastbrookBeds, seedLowGraphicsPreset) and
scripts/pr_screenshots.mjs (the launch args). Its summary MUST return: the exact
interaction seam (signatures, the outcome type, every pin file), whether the interact
key/button/gamepad all funnel through ONE call site, whether a bed can be resolved by
proximity from IWorld.farmPatches + player pos WITHOUT a renderer pick (that is the
preferred design), the window recipe with the line count Hud needs to compose a
window (to size the hud.ts extraction), the plant gate order and deny reasons
verbatim, the fee plan API, the current monolith counts vs ceilings, and a list of
self-contained blocks in hud.ts and main.ts that could be extracted to make room.

STEP 2 - BUILD
Design (from state.md (bn) and the phase file; the Explore summary refines it, the
maintainer's rules override it):
- HARVEST is choice-free, so it is an arm in the gather-node interaction family: a
  bed arm in tryNearbyInteraction, resolved by proximity (the caller's own plot on a
  bed within INTERACT_RANGE from IWorld.farmPatches + myFarmPlots), returning an
  InteractionOutcome that calls world.harvestCrop(bedId) for a ready or withered
  plot and lets the sim's own farmDenied (not_ready and friends) be the refusal;
  the priority order and the trailing nothing-to-interact string stay pinned.
- PLANT needs a seed and the knobs, so it is a WINDOW opened from the same arm on a
  free bed: pure core src/ui/farming_plant_sheet_view.ts (registered in
  UI_PURE_CORES; lists the seeds in the caller's bags whose crop tier the wielded
  hoe and skill allow, the three knobs with bag-derived affordability from the fee
  plan and counts, and the deny reason the sim WOULD answer, without ever predicting
  an outcome) plus a thin src/ui/farming_plant_sheet_window.ts on the PainterHost
  writers, composed by Hud like HarvestJournalWindow, opened through a new
  NearbyInteractionHud.openPlantSheet(bedId) dep; its one Plant control sends
  world.plantCrop(bedId, cropId, knobs) exactly once, then the sim's farmPlanted /
  farmDenied events are the feedback (the husk-trade contract); a deny leaves the
  sheet open; the sheet closes with focus restore.
- The world-space affordance (a highlighted or targetable bed, a ripe marker, a hover
  line on the gather-node tooltip family) is a src/render/<thing>.ts sibling or is
  DEFERRED to a follow-up if it cannot be composed without growing renderer.ts.
- Desktop (interact key F), touch (the mobile-interact button; the sheet fits
  844x390 landscape with finger-sized knob toggles), gamepad (the interact edge
  action) all reach both verbs through the one interactKey funnel.
- i18n: every label, aria, toast, and empty state is a t() key in
  src/ui/i18n.catalog/hud_chrome.ts (English only; M16 fills for wordy values); the
  deny lines reuse hudChrome.farming.denied.*; the sheet's item names come from
  itemDisplayName; no keybind literal in prose (use the keyLabel/{key} idiom the
  hud_chrome siblings use).
Orchestration (the Phase 9 shape that worked): the orchestrator lands the SHARED
SHAPES first as their own commits so every worktree compiles: (1) the extractions
that create headroom in hud.ts and main.ts (each a move-not-rewrite sibling module +
the lowered ceiling), (2) the NearbyInteractionHud/World seam widening with a no-op
stub, (3) the i18n key rows. Then THREE implementer agents in THREE SEPARATE git
worktrees (~/Documents/woc-farm-p9b-{a,b,c}, branches p9b/agent-{a,b,c}, each
pnpm-installed, created off the phase branch and fast-forwarded after each
orchestrator commit) via ultracode Workflow: A = the interaction arm (harvest
outcome + open-sheet outcome, the proximity resolver as a pure module with its own
tests, the mobile and gamepad routes, the client_shell and interaction pins); B = the
plant sheet (pure core + painter + Hud composition line, jsdom tests on the
quest_dialog_controller husk-trade template: the Plant click sends
world.plantCrop(bedId, cropId, knobs) once with the chosen knobs and never on a
deny, a bed with another player's plot is never offered, the sheet lists only
sowable seeds; the browser a11y rig); C = the browser journey E2E as a committed
script (scripts/farming_journey_e2e.mjs, the Phase 9 QA recipe: it drives
q_farm_intro to completion through client-facing entry points ONLY, no
window.__game for the verbs, window.__game allowed only for staging position and
copper and for /dev farmgrow), the screenshots (before/after, desktop and mobile
landscape, LOW preset) under docs/screenshots/farming-phase-09b with the CI cone
rows and the ci_workflow literal, and the docs rows. Every agent: an explicit file
list, no git add -A, no session links or Claude attribution, throwaway probes named
tests/qa_probe_<lane>.test.ts and deleted before reporting.
Tests that MUST land (the ones that would have caught the (bn) gap): a jsdom test
that presses the interact key beside a planted ready bed and asserts
world.harvestCrop(bedId) once (and beside a withered plot too), beside a free bed
opens the sheet, and beside a growing plot lets the sim refuse; the sheet's Plant
click test; a static reachability pin (a test that greps src/ui and src/game for a
call site of .plantCrop( and .harvestCrop( so the verb can never silently vanish
again); the browser journey (part of the browser regression suite or the standing
E2E scripts, your call, but it runs in the gate or is invoked by the phase's own
close). Determinism: nothing here touches src/sim; if a change ever needs the sim,
stop and surface.

STEP 3 - REVIEW
Dispatch: frontend-seam-reviewer (Workflow-safe), cross-platform-sync (Agent tool:
the sheet and the arm read myFarmPlots / farmPatches / farmNowMs identically from Sim
and ClientWorld; no wire change), gate-integrity-reviewer (Agent tool: the ci.yml
cone rows and the ci_workflow literal), test-coverage-auditor (Agent tool),
qa-checklist (Agent tool, budget one nudge), architecture-reviewer ONLY if src/sim
moved (it must not), privacy-security-review ONLY if server/ moved (it must not).
Every reviewer: the SendMessage-to-main FIRST line, a hard 30-tool-call budget, the
coverage instruction ("report every issue including low-severity and uncertain ones;
ranking happens later"), the resume line ("Stop reading more files. Output the full
report now. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT"). Take every
BLOCKING and SHOULD-FIX or ledger it with a reason. Then the mutation checks (after
committing, the dirty-refusing runner): at least eight, including the harvest arm
calling plantCrop instead, the sheet sending twice, the knob payload dropped, the
proximity resolver's range off by one, the reachability pin gutted, the mobile
button unwired.

STEP 4 - DOCS
progress.md (a Phase 9b row and a Notes block with the would-be PR body, the journey
transcript through the CLIENT verbs, the review verdicts, the mutation list, the
gate record, the merge hash), state.md (head block: the go-live is player-complete;
CLOSE deviation (bn) with the closing record; the next deviation letter is (bp);
the (bg) faucet now has its terminator, note it; the OPEN list line for (bn)
struck, (bo) untouched), docs/prd/masterwrought/farming/phase-09b-bed-verbs.md (an EXECUTED block plus
the acceptance list checked), docs/prd/masterwrought/farming/phase-09-world-presence.md (a note that
its Live-surface note is met as of 9b), docs/prd/masterwrought/farming/phase-10-celebrations.md (retire
the PHASE 9 QA NOTE's 9b clause), and WRITE the QA twin docs/prd/masterwrought/farming/phase-09b-qa.md
in the packet's shape (its starter prompt drives the browser journey again as a
player, purchase-tests nothing new, and proves the negative space: no new item, NPC,
quest, command, IWorld member, wire field, or golden movement). Update the
implementation-plan.md row from PROPOSED to the plain shape.

STEP 5 - FINAL RESPONSE FORMAT
The phase report: what shipped, the extraction commits and the new ceilings, the
journey transcript through the client verbs, review verdicts, mutation counts,
deviations, deferrals with reasons, the gate record, the merge hash, and a one-line
handoff for the Phase 9b QA session.

STOPPING RULES: stop and surface before any monolith ceiling raise; before any
IWorld member, command, wire field, SimEvent, or src/sim change; before any golden,
atlas, plate, or NPC movement; on an unresolvable release tip; if the design cannot
reach all three input surfaces without one of the above.

Close: gate via BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/
chrome-linux64/chrome GATE_MAX_WORKERS=8 node scripts/gate_select.mjs on the
committed tree; judge ONLY the log markers ("[gate:select] FAIL at" / "[gate] FAIL"
/ "[gate:select] PASS: all N steps green"; the exit code has lied). EXPECT the
full-suite fallback (the planner's broad arm on the terrain fixture plus
tests/helpers/bare_client.ts is on the branch for good), about 14 minutes of vitest
at 8 workers, and budget the druid_engines 20 s contention timeout as the recorded
environmental flake (prove it standalone if it fires, do not chase it). Per D22: no
push, no PR; merge the phase branch --no-ff into LOCAL feature/farming-plan, delete
it and the three agent worktrees and branches, record the merge hash in progress.md
and in the farming-skill-program memory topic, and hand off to the Phase 9b QA
(docs/prd/masterwrought/farming/phase-09b-qa.md, which you wrote), then Phase 10.
```
