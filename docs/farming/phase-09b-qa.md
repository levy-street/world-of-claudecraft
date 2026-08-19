# Phase 9b QA: the bed verbs audit

The independent audit of Phase 9b (the client-side plant and harvest controls).
Phase 9b's own close already ran reviewers and mutations; this QA re-walks the
loop as a PLAYER, purchase-tests nothing new, and proves the negative space.
docs/farming/state.md is the authority; if this file contradicts it, state.md wins.

EXECUTED RULINGS (the phase close, 2026-08-19): the phase merged --no-ff into
feature/farming-plan (hash in progress.md's Phase 9b notes tail; phase branch
fix/farming-phase-09b-bed-verbs deleted). Commit map: 2e6fcb42b9 adoption,
7ba29ede2c hud extraction, 5575f50260 seam widening, 252138c1db i18n rows,
6dd657a148/4486a8fb17 lane A, a2c07b2b12/8ea2432772 lane B,
6580d32ddc/bcd2132b8b lane C, b2963c1d91 convertHusks pin, 7c97ca51d1 the
review-round fixes, plus the two lane merges and the docs/gate-record
commits. farming_session md5 9a8fefa5e48c7e456db7ef2695bfb284 (unmoved by the
phase). The knob-affordability doc reconcile is state.md (bp).

## Starter Prompt

```
This is the Phase 9b QA of the Farming feature: the independent audit of the bed
verbs (the client-side plant and harvest controls). Model: Opus 4.8 or newer,
xhigh effort. Harness: Claude Code. DELIVERY per D22: LOCAL-ONLY, no pushes, no
PRs; branch fix/farming-phase-09b-qa off LOCAL feature/farming-plan, merged
--no-ff back, branch deleted; the gate log is the arbiter.

Goal: audit the Phase 9b diff (the merge recorded in the EXECUTED RULINGS block
above; the sync-side commits carry their own audit), re-drive the full
q_farm_intro loop on the dev client as an ORDINARY PLAYER through client-facing
entry points only (no window.__game for any verb; staging position/copper and
/dev farmgrow allowed), and prove the phase's negative space: NO new item, NPC,
quest, command, IWorld member, wire field, SimEvent, or golden movement, and the
monolith ceilings unraised (hud.ts and renderer.ts ceilings may only have been
LOWERED or held).

STEP 0 - PRE-FLIGHT
- Work ONLY in ~/Documents/woc-farming-plan; every shell command prefixed with
  cd ~/Documents/woc-farming-plan && export PATH=$HOME/.nvm/versions/node/v26.5.0/bin:$PATH
- git status clean on feature/farming-plan at or after the Phase 9b merge hash
  in the EXECUTED RULINGS block; stop if not.
- Re-resolve the newest release/** tip (git fetch origin --prune; sort -V; last
  row); the branch has absorbed release/v0.39.0 through 7b45fdb9a9 (the
  nineteenth absorb). A newer tip merges in FIRST per D22 (release-merge-audit
  plus the state.md (al) checklist; a minor-version jump or triple-digit
  intersection runs the 06b shape as its own mid-phase).
- Scan memory: MEMORY.md, farming-skill-program (the PHASE 9B paragraph),
  sim-api-green-hides-missing-player-verb (drive the CLIENT verb, never
  sim.plantCrop), pr-screenshot-browser-path, screenshots-on-low-graphics,
  mutation-checks-commit-first, fanout-agent-delivery-traps,
  big-diff-reviewer-turn-budgets.
- READ state.md's head block and the (bn) CLOSED record, the D8/D9/D18/D22
  decisions, docs/farming/phase-09b-bed-verbs.md (the EXECUTED block), and
  progress.md's Phase 9b notes (the journey transcript to reproduce).

STEP 1 - THE PLAYER JOURNEY (the go-live acceptance, re-proven independently)
Run scripts/farming_journey_e2e.mjs end to end; then REPEAT the walk manually
over the dev client checking what the script cannot: the plant sheet's DOM
labels come from t() (switch a locale and re-open), the knob toggles are
finger-sized on the 844x390 landscape viewport, focus is trapped in the sheet
and returns to the world on close, a deny (plant with a locked-only seed via
the bag lock control) leaves the sheet open with the sim's own toast, and the
gamepad interact edge action reaches both verbs.

STEP 2 - THE AUDIT LANES (Workflow for plain lanes; content-obligations,
test-coverage, privacy-security, qa-checklist on the Agent tool with the
report-via-SendMessage-to-main FIRST line and a 25-call budget)
- correctness/coverage/dead-code over the phase diff
- frontend-seam-reviewer (the pure-core recipe, painter contracts, fairness)
- cross-platform-sync (the arm and sheet read myFarmPlots/farmPatches/farmNowMs
  identically from Sim and ClientWorld; no wire change)
- test-coverage-auditor (vacuous-pin hunt: the reachability pin, the
  once-and-only-once plant send, the locked-above-unlocked index assertion)
- gate-integrity-reviewer IF ci.yml or the ci_workflow literal moved this phase
  (they did: the farming-phase-09b cone rows)
- qa-checklist last, over the whole phase diff.
STEP 3 - NEGATIVE SPACE (each proved by RUNNING the pin, not by reading)
- IWorld 329 = 88 + 241, facets 34; commands 202/215; delta keys 87;
  farming_session md5 unchanged from the EXECUTED RULINGS block; zero golden
  moves in the phase diff (git diff <phase-start>..<merge> -- tests/parity/golden
  is empty); no src/sim change outside comments; no server/ change; the atlas,
  Eastbrook digest, and map plates untouched; no NPC seat moved.
- The monolith rows: hud.ts and renderer.ts ceilings not RAISED by the phase.
STEP 4 - MUTATIONS (after committing, through a scratchpad runner that refuses
a dirty target, applies one exact-string mutant, records rc + failing test
names + the summary line, restores via git checkout, verifies the restore)
At least eight, including: the bed arm calling plantCrop instead of
harvestCrop; the arm skipping the my-plot check (always opening the sheet);
the resolver's range off by one; the sheet sending twice on one click; the
knob payload dropped from the send; the reachability pin gutted; the a11y
stub key removed; the priority order swapped (bed before node).
STEP 5 - DOCS AND CLOSE
Verdict in progress.md (a Phase 9b QA row + notes), state.md head updated,
this file's EXECUTED block extended with the QA record. Gate:
BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome
GATE_MAX_WORKERS=8 node scripts/gate_select.mjs; judge ONLY the log markers;
expect the full-suite fallback and about 14 minutes of vitest. Merge --no-ff
into feature/farming-plan, delete the branch, record the merge hash in
progress.md and the farming-skill-program memory topic, hand off to Phase 10.

STOPPING RULES: stop and surface before any golden, atlas, plate, NPC, IWorld,
command, wire, SimEvent, or src/sim movement; on an unresolvable release tip;
if the journey cannot complete as a player (that is a (bn)-class finding, the
exact thing this QA exists to catch).
```
