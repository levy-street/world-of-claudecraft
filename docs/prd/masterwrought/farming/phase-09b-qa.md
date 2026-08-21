# Phase 9b QA: the bed verbs audit

The independent audit of Phase 9b (the client-side plant and harvest controls).
Phase 9b's own close already ran reviewers and mutations; this QA re-walks the
loop as a PLAYER, purchase-tests nothing new, and proves the negative space.
docs/prd/masterwrought/farming/state.md is the authority; if this file contradicts it, state.md wins.

EXECUTED RULINGS (the phase close, 2026-08-19): the phase merged --no-ff into
feature/farming-plan (hash in progress.md's Phase 9b notes tail; phase branch
fix/farming-phase-09b-bed-verbs deleted). Commit map: 2e6fcb42b9 adoption,
7ba29ede2c hud extraction, 5575f50260 seam widening, 252138c1db i18n rows,
6dd657a148/4486a8fb17 lane A, a2c07b2b12/8ea2432772 lane B,
6580d32ddc/bcd2132b8b lane C, b2963c1d91 convertHusks pin, 7c97ca51d1 the
review-round fixes, plus the two lane merges and the docs/gate-record
commits. farming_session md5 9a8fefa5e48c7e456db7ef2695bfb284 (unmoved by the
phase). The knob-affordability doc reconcile is state.md (bp).

## EXECUTED (2026-08-19, branch fix/farming-phase-09b-qa off c9075785ef)

VERDICT: PASS-WITH-FOLLOWUPS. The twentieth absorb opened it (merge
919787518a of origin/release/v0.39.0 ea9377db8e, one i18n commit; the
pending.ts conflict regen-resolved and the regen explained to the row;
baselines held, art audit green). STEP 1 re-proved the journey 17/17 on
desktop AND the real mobile-interact route, plus 18 manual probes (focus
trap, panel keydown guard with a jump positive control, Esc focus restore,
the locked-seed deny leaving the sheet open with the sim's locked line and
the repaint to the locked list, the ja_JP options-dropdown locale switch,
the woc:languagechange relocalize arm over an OPEN sheet, knob toggles
44px on 844x390, shortfall contrast 8.95:1 with the committed eyeball
captures, gamepad verified-by-pin, perf:tour exit 0, the farmer-shadow
far-side probe). STEP 3 proved the negative space by running every pin.
STEP 2 lanes: 4-lane Workflow 4/4 first try; cross-platform APPROVE;
test-coverage approve-with-followups; qa-checklist recorded in
progress.md. The one BLOCKING (correctness lane, probe-confirmed): the
ctx.error dead/busy denies stranded the Plant control; fixed as state.md
deviation (bq) (the error-toast re-arm). Other fixes: report_window.ts
renamed under the cold-painter sweep with its first direct suite, the
mobile sheet's safe-area caps, the close-button title, the journey's
mobile arm failing hard, and eleven hardened pins (reachability via the
shared stripComments, containment-sliced Hud glue rows incl. close-route /
error-forward / keydown-guard, the journey layer-honesty pin, closeOthers
counts, the markDialogRoot contract, the locked-only body, the rowless
professionsState default, exact root-div counts, lockedRows length pins,
the real-painter target-size browser arm). MUTATIONS 11/11 killed named:
seven killed as shipped, two shipped survivors (the keydown-guard row and
the journey __game-verb cheat) diagnosed as real gaps, fixed, re-proven
killed, plus two fresh mutants over the (bq) fix, killed. Commit map:
919787518a the absorb merge, 208d2d048d the rename + suite, e97bab4e00
the consolidated QA fixes, then the docs and gate-record commits.
Deferrals with owners are ledgered in state.md's Phase 9b QA block; the
gate record and merge hash are in progress.md's Phase 9b QA notes tail.

## Starter Prompt (the session form)

```
This is the Phase 9b QA of the Farming feature: the independent audit of the bed
verbs (the client-side plant and harvest controls). Model: Opus 4.8 or newer,
xhigh effort (1m context variant where the file load demands it). Harness:
Claude Code. DELIVERY per D22 (standing): LOCAL-ONLY. No pushes, no PRs. The QA
lands as commits on fix/farming-phase-09b-qa cut off LOCAL feature/farming-plan,
merges back --no-ff, and deletes its branch. The gate log is the arbiter.

Goal: independently audit the Phase 9b diff, re-drive the full q_farm_intro loop
on the dev client as an ORDINARY PLAYER through client-facing entry points only,
and prove the phase's negative space: NO new item, NPC, quest, command, IWorld
member, wire field, SimEvent, src/sim or server change, and no golden movement.
Phase 9b's own close ran reviewers (cross-platform APPROVE, frontend all seven
should-fixes taken, coverage B1-B3 closed and S1-S7 landed, gate-integrity PASS,
qa-checklist resolved) and killed 10/10 scripted mutants; your job is the FRESH
pass that trusts none of it.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Other
  sessions share the main checkout; never work there. Prefix EVERY shell command
  with cd ~/Documents/woc-farming-plan && export PATH=$HOME/.nvm/versions/node/v26.5.0/bin:$PATH
  (the Bash cwd resets between calls; the inherited shell has Node 24 and no pnpm).
- git -C ~/Documents/woc-farming-plan status must be clean, on feature/farming-plan
  at or after the Phase 9b merge (the --no-ff merge hash is recorded in
  progress.md's Phase 9b notes tail and in the farming-skill-program memory
  topic; verify HEAD descends from it). Stop if it is not.
- Branch fix/farming-phase-09b-qa off LOCAL feature/farming-plan. The audit
  target is the phase-side chain from the adoption commit 2e6fcb42b9 through the
  phase tip named in the merge record; the nineteenth-absorb sync commits are
  EXCLUDED (they carry their own audit, recorded in progress.md's sync notes).
- Re-resolve the NEWEST release/** branch: git fetch origin --prune, then
  git branch -r --list 'origin/release/*' | sort -V, take the last row. The
  branch has absorbed release/v0.39.0 through 7b45fdb9a9 (the NINETEENTH absorb,
  2026-08-18, run as its own sync mid-phase per the D22 triple-digit rule). If a
  newer tip exists, merge it INTO the QA branch FIRST: release-merge-audit skill
  plus the state.md deviation (al) absorb checklist (portrait manifest
  fingerprint-only re-mint via scripts/build_mob_portrait_source_manifest.mjs
  --write plus the accepted-art registry row; scripts/item_art_audit.mjs
  --verify-only; the ART-SUBJECT rule for any release seal over a live inventory
  pending-art items can join), re-run tests/world_api_parity.test.ts,
  tests/snapshots.test.ts, tests/command_schema.test.ts,
  tests/monolith_budget.test.ts, and tests/parity, and classify any
  farming_session golden movement before re-minting (expect the (am) shape on
  any absorb adding static world content; the nineteenth absorb's classifier
  recipe is in progress.md). A minor-version jump or a triple-digit intersection
  runs the phase-06b-release-sync shape as its OWN mid-phase first. ABSORB TRAPS
  proven live: a pnpm-lock.yaml move fires the farm-props seal family; a
  patches/ move needs pnpm install; a both-sides Eastbrook seal conflict
  resolves ONLY by remint_polish_provenance.mjs on the merged tree;
  `git checkout --theirs <conflicted pin suite>` DISCARDS non-conflicting arms;
  release monolith ceilings can land BELOW your working count (heal by
  extraction, never a raise); the release's npc-looks roster demands an AUTHORED
  look for every NpcDef; the shard-weight coverage floor heals by re-harvesting
  scripts/ci_shard_weights_harvest.mjs from a green FULL-MODE upstream run
  (merge-queue runs work; release-branch runs use Release lanes the filter does
  not match).
- Baselines as of the Phase 9b merge, ALL of which this QA must leave UNCHANGED:
  IWorld 329 members (88 data, 241 method), facet count 34, command_schema
  202/215, delta keys 87, farming_session golden md5
  9a8fefa5e48c7e456db7ef2695bfb284, every other golden, the terrain atlas, the
  Eastbrook chunk digest, the map plates (no NPC moves: every NPC is a terrain
  calm pad). MONOLITH: hud.ts 19351/19352 (near-exact pin, the freed extraction
  margin was spent by the phase's own composition), renderer.ts 13774/13774
  (exact, zero slack), main.ts 11454/11460, sim.ts 12657/12660, server/game.ts
  10791/10900. Any QA fix touching hud.ts or renderer.ts is extraction-first
  from the outset; a ceiling raise is a maintainer decision: stop before one.
- Record the QA-start commit (git rev-parse HEAD).
- Scan Claude Code memory: MEMORY.md; farming-skill-program (the NINETEENTH
  ABSORB and PHASE 9B paragraphs are the freshest record: the whole-slot lock
  rig template, the census heal classes, the S3-guard and reliquary source-pin
  extraction traps, the design decisions);
  sim-api-green-hides-missing-player-verb (every acceptance drive here uses the
  CLIENT verb, never sim.plantCrop; a QA recipe that says "do X through
  window.__game.sim.X" is itself the finding);
  pr-screenshot-browser-path (BROWSER_PATH=$HOME/.cache/ms-playwright/
  chromium-1228/chrome-linux64/chrome; no system Chrome; the camera-choice
  dialog and #gpu-notice eat clicks on fresh profiles);
  screenshots-on-low-graphics (LOW preset always; mobile captures LANDSCAPE
  844x390); screenshot-dirs-need-ci-cone-rows (docs/screenshots/farming-phase-09b
  EXISTS and is coned: put QA captures there, no cone churn);
  fanout-agent-delivery-traps (custom-agentType reviewers die report-less inside
  a Workflow: dispatch content-obligations, test-coverage, privacy-security,
  qa-checklist on the Agent tool with the report-via-SendMessage-to-main line
  FIRST and a 25-call budget; check the Workflow journal for LEN 0 results;
  budget one nudge for idlers); mutation-checks-commit-first (commit first, then
  a scratchpad runner that refuses a dirty target, applies one exact-string
  mutant, records rc + failing test names + the summary line, restores via git
  checkout, verifies the restore; a file-level parse FAIL is NOT a behavioral
  kill, rebuild the mutant clean); mutation-verdicts-need-exit-code-plus-names;
  worktree-cwd-drift-misroutes-git; pkill-pattern-matches-own-shell (kill dev
  servers by port: fuser -k 5188/tcp); frozen-clock-rig-hangs-vitest;
  big-diff-reviewer-turn-budgets; one-probe-outranks-agreeing-agents.
- READ docs/prd/masterwrought/farming/state.md's head block, the (bn) CLOSED record whole, the NEW
  deviation (bp) (offer gates are not outcome predictions: the sheet's disabled
  seeds/knobs are bag-derived OFFER gates with the denied.* family's own lines;
  the sim stays the refusing authority for everything sent), (bo) (read only,
  UNTOUCHED: tier 3/4 seeds still have no first faucet, D11 ruling owed), (bg)
  (its faucet terminator note), the D8 / D9 / D18 / D22 decisions, and the OPEN
  list; docs/prd/masterwrought/farming/phase-09b-bed-verbs.md whole (the EXECUTED block is the
  commit map and evidence index; the acceptance list is what you re-prove);
  progress.md's Phase 9b notes (the journey transcript, review verdicts, the
  10-mutant list, the deferrals: the world-space bed affordance is DEFERRED by
  the phase file's own clause, the online one-snapshot verb staleness is
  ACCEPTED as self-healing, the disabled-knob contrast eyeball and perf:tour are
  VERIFY items left to you).

STEP 1 - THE PLAYER JOURNEY (the go-live acceptance, re-proven independently)
Run the COMMITTED scripts/farming_journey_e2e.mjs end to end (vite on :5188
--strictPort --host 127.0.0.1, the script owns the recipe; judge by its
numbered transcript and exit code). Then re-walk the loop MANUALLY over the dev
client for what the script cannot see: the sheet's labels come from t()
(switch a locale at runtime and confirm the OPEN sheet repaints, the new
relocalize arm); focus is trapped in the sheet and returns to the world on
close; Space/Enter on a focused sheet control neither jumps nor opens chat
(the panel keydown guard); a deny leaves the sheet open with the sim's own
toast (lock your only seed through the bag lock control, then Plant); the
knob toggles are finger-sized on 844x390 landscape and the disabled knob's
shortfall line passes a manual contrast eyeball; the gamepad interact edge
action reaches both verbs (pad_reel pins the wiring; confirm live if a pad is
available, else record verified-by-pin). Capture any new evidence to
docs/screenshots/farming-phase-09b/ (existing cone).

STEP 2 - THE AUDIT LANES
Workflow for plain lanes: correctness, coverage, dead-code over the phase
diff; frontend-seam-reviewer. Agent tool (SendMessage-to-main FIRST line,
25-call budget, coverage instruction, the resume line) for: cross-platform-sync
(the arm and sheet read myFarmPlots/farmPatches/inventory/professionsState
identically from Sim and ClientWorld; no wire change; re-check the accepted
one-snapshot staleness reasoning), test-coverage-auditor (hunt vacuity in the
phase's OWN new arms: the reachability pins, the Hud glue source pin, the
send-once spy counts, the locked-above-unlocked index assertion),
gate-integrity-reviewer ONLY if ci.yml or the gate plumbing moves in THIS QA,
privacy-security-review ONLY if server/ moved (it must not), qa-checklist last.
architecture-reviewer ONLY if src/sim moved (it must not).

STEP 3 - NEGATIVE SPACE (each proved by RUNNING the pin, never by reading)
git diff over the phase range: tests/parity/golden empty; src/sim and server/
empty (docs aside); no IWorld facet file moved; the count suites pin 329 = 88 +
241, 34, 202/215, 87; farming_session md5 9a8fefa5 unchanged; the atlas,
Eastbrook digest, and plates byte-identical; hud.ts and renderer.ts ceilings
not RAISED by the phase (lowered or held only).

STEP 4 - MUTATIONS (after committing, the dirty-refusing runner)
At least eight FRESH mutants, not re-runs of the phase's ten. Candidates: the
NPC-vs-bed precedence inverted; the dead-player gate dropped from the bed arm;
canOpenPlantSheet inverted; the relocalize arm gutted; the keydown-guard entry
removed; the sowAria key swapped for another family's; the fee-plan legs
ignored in the knob model; the journey script's no-window.__game header
weakened (assert the script refuses); the reachability scanner's comment
filter widened to skip real code. Every verdict needs rc nonzero AND named
failing tests AND the summary line; a survivor is a rig defect, dead code, or
a real gap: diagnose before adding a test.

STEP 5 - DOCS AND CLOSE
progress.md (a Phase 9b QA row + notes: verdict, fixes, mutation record, gate
record, merge hash), state.md head block updated (and any new deviation
letters continuing at (bq)), this file's EXECUTED block extended with the QA
record, deferrals re-ledgered with owners. Close: gate via
BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome
GATE_MAX_WORKERS=8 node scripts/gate_select.mjs on the committed tree; judge
ONLY the log markers ("[gate:select] FAIL at" / "[gate] FAIL" /
"[gate:select] PASS: all N steps green"; the exit code has lied). EXPECT the
full-suite fallback (the terrain fixture plus tests/helpers/bare_client.ts
keep the planner's broad arm live), about 14 minutes of vitest at 8 workers,
and budget the druid_engines 20 s contention timeout as the recorded
environmental flake (prove it standalone if it fires, do not chase it). Per
D22: no push, no PR; merge --no-ff into LOCAL feature/farming-plan, delete the
branch, record the merge hash in progress.md and the farming-skill-program
memory topic, and hand off to Phase 10
(docs/prd/masterwrought/farming/phase-10-celebrations.md; its Phase 9 QA note is retired, but
(bo) still bounds it: nothing may assume Highwatch or Evergarden beds are
sowable until D11's bootstrap ruling lands).

STOPPING RULES: stop and surface before any monolith ceiling raise; before any
IWorld member, command, wire field, SimEvent, or src/sim change; before any
golden, atlas, plate, or NPC movement; on an unresolvable release tip; if the
journey cannot complete as a player (that is a (bn)-class finding, the exact
thing this QA exists to catch).
```
