# Phase 10 QA: Verify Celebrations

Audits the Phase 10 PR: the golden_harvest rare event, the farming deeds and title, the
cue chain, and the deliberately moved pins (draw-count contract, deeds totals, the
farming_session golden). The special hazards here are pin drift dressed up as
deliberateness and a rare-event roll that silently forked another profession's draw
order.

EXECUTED-PHASE RULINGS (2026-08-19, the phase close; read BEFORE auditing, they
supersede this file's older wording below):
- (br) The packet's "Highwatch/Evergarden beds cannot be sown" premise was PROBED
  FALSE (plantCrop has no bed-tier gate; the plant sheet offers any bagged seed at
  any bed), so ALL FOUR first-harvest chronicles are earnable today with vendor
  tier 1/2 seeds. FARM_CHRONICLE_ZONES (src/sim/deeds.ts) is the earnability
  declaration, guarded both directions.
- (bs) prog_farming_100 and its Harvestmaster title ship DORMANT (farming teaching
  grays at 75 until a tier 3 seed exists, (bo)/D11): a recorded waiver in
  docs/design/deeds.md, a self-clearing honesty arm over the three purchase
  surfaces in tests/deeds_content.test.ts, and feat_book_complete transitively
  parked for the window. Do not re-report the dormancy as a finding; audit that the
  waiver, the arm, and the row comments stay coherent.
- (bt) The Reliquary title shelf forbids fallback art for title deeds, so
  prog_farming_100's crest shipped COMMITTED (an interim wheat-sheaf medallion via
  the sanctioned converter; the brief flags the commissioned replacement). The six
  untitled deeds ride DEED_ART_PENDING.
- (bu) One belief gates the golden win (flavor AND resolved zone); the signature
  truncation on full bags is silent by design (gatherDowngrade's surface union was
  not widened; the follow-up is 'crop' in a later phase).
- (bv) gather_event:golden_harvest has NO reliquary field-note cell (noteReliquaryMark
  no-ops by allowlist, negative-arm pinned) and correctly NO
  server/character_sheet.ts RELIQUARY_MARK_ENGLISH row (the reverse guard forbids
  non-reliquary marks).
- Baselines after the phase: 280 deeds / 3190 renown / 43 titles; harvest draws are
  1 (tier 1/2) and 2 (tier 3/4); farming_session md5 83c3478142deabbffbf23912575873e9
  at 16 draws; hud.ts 19227/19230 (ceiling LOWERED via the ability-tooltip
  extraction); DEED_IMAGE_IDS 272, DEED_ART_PENDING 8.

QA EXECUTED (2026-08-19, PASS-WITH-FOLLOWUPS; full record in progress.md, ledger in
state.md): the audit found no live defect; two BLOCKING coverage gaps closed
test-first (the golden signed-grant bag paths; the finder-only sting pins rebuilt as
the src/ui/gather_rare_event_feedback.ts pure core with a behavioral quadrant suite,
hud.ts ceiling LOWERED again 19230 to 19220, file 19217); the golden belief hardened
to != null; fresh mutations 14/14 killed named; the two VERIFY items closed
(test:browser 133 green standalone, perf:tour exit 0 in the 9b swiftshader shape).
Baselines after the QA: unchanged except hud.ts 19217/19220. Deferred as state.md
(bw) by the deviation (z) precedent: the golden-WIN parity beat and the tier-3
seed-back paying-band beat both move a golden, so Phase 11 extends the scenario
deliberately.

### QA Starter Prompt

```
This is Phase 10 QA of the Farming feature: Verify Celebrations.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: audit Phase 10 for correctness, missing tests, dead code, determinism, three-host
parity, i18n completeness, and the phase's own acceptance criteria.

STEP 0 - PRE-FLIGHT
- [AMENDED per D22, the Phase 1 QA precedent: no PR exists. The phase lands
  as local commits merged --no-ff into feature/farming-plan (progress.md
  records the merge hash and commit map); audit that merge's phase-side
  parent chain, EXCLUDING any release-sync absorb commits, which carry their
  own audit. QA fix commits land on a fix/farming-phase-10-qa branch off
  feature/farming-plan, merged back --no-ff. Read this file's PR wording
  below through that lens.]
- Same worktree rules: work ONLY in ~/Documents/woc-farming-plan, use
  git -C ~/Documents/woc-farming-plan everywhere, git status clean or stop.
- git fetch origin --prune, then check out the Phase 10 PR branch
  (fix/farming-phase-10-celebrations).
- Identify the phase diff: the PR's commits against its base. Use
  git diff --name-only origin/<base-release-branch>...HEAD (three dots: merge-base
  semantics). The release tip may have moved concurrently, so the diff is the PR's
  commits, never everything since phase start. If the diff cannot be identified cleanly,
  stop and surface.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  frozen-clock-rig-hangs-vitest, mutation-checks-commit-first, vacuous-bound-pin-trap,
  early-exit-pins-need-work-remaining, one-probe-outranks-agreeing-agents.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to summarize: docs/farming/state.md, the docs/farming/progress.md
Phase 10 notes, the promises in docs/farming/phase-10-celebrations.md (acceptance list,
invariants, any recorded deviation), and git diff --name-only over the phase diff. The
summary must return the acceptance checklist verbatim, every recorded deviation, the diff
file list grouped by surface, and the state.md validation matrix rows the diff demands.

STEP 2 - QA AUDIT
Spawn three parallel audit agents, each with a hard 30-tool-call budget and the coverage
instruction ("report every issue including low-severity and uncertain ones; ranking
happens later"); resume any truncated agent with: "Stop reading more files. Output the
full report now based on what you have already seen. No more tool calls. Format:
BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- Correctness agent: every deliverable and acceptance criterion actually met; the
  offline Sim and the online ClientWorld paths behave identically; edge cases (denial
  still draws zero, golden on the final pick, a chronicle mark in every
  FARM_CHRONICLE_ZONES zone). Where sim behavior changed, run live headless-Sim probes via a throwaway vitest
  file driving real ticks with an injected ADVANCEABLE clock (the clock must advance
  now() or waits hang), then delete the file and verify the tree is clean. Verify
  the Live-surface note: LIVE, additive: any harvesting player can roll
  golden_harvest, and every farming deed EXCEPT prog_farming_100 is earnable the
  moment this merges (the (bs) dormancy waiver covers that one and
  feat_book_complete transitively), with no reachability change to anything that
  already shipped.
  Phase 10 emphases, all three mandatory: verify the tests/deeds_content.test.ts
  totals re-pin is EXACT and deliberate (new pinned totals equal the old totals
  plus exactly the new records, cross-checked against src/sim/content/deeds.ts, not
  against the test's own
  arithmetic); verify the golden-harvest roll changes no other profession's draw order
  (the parity fingerprint outside the farming scenarios is untouched); verify the zone
  announcement excludes instance space per the existing announceGatherRareEvent fanout
  rules.
- Test-coverage agent: decisive assertions that fail on regression; no
  constant-self-comparison pins; both arms of every either/all claim (the event fires
  and does not fire, a deed earnable and not yet earned); orphaned tests removed;
  mutation checks only AFTER committing the work first.
- Dead-code-and-cleanup agent: unused imports and types; the sim import invariant
  (src/sim/ imports nothing from render, ui, game, or net, and has no DOM or Three
  imports); no unresolved TODOs; naming consistency (golden_harvest, farm:<zone>,
  prog_farming_100, the cue key).
Then dispatch the Review Dispatch Matrix rows in docs/farming/implementation-plan.md
that the phase diff matches, plus qa-checklist (the phase-completion gate), under the
same budget and format rules.

STEP 3 - FIX
Apply every BLOCKING and SHOULD-FIX finding test-first (a failing test that exercises
the real path, then the smallest green change). Run the docs/farming/state.md validation
matrix rows the diff demands. Separate fix commits with explicit paths, never
git add -A, no session links or Claude attribution.

STEP 4 - DOC UPDATES
Update docs/farming/progress.md (the Phase 10 QA row plus Notes) and
docs/farming/state.md (drift, ledger corrections). Any deviation gets swept into
docs/farming/phase-10-celebrations.md AND this QA twin in the same pass.

STEP 5
No teardown step in this phase; packet teardown belongs to Phase 13 QA only.

STEP 6 - FINAL RESPONSE FORMAT
Verdict PASS / PASS-WITH-FOLLOWUPS / FAIL; counts of issues found and fixed per
severity; deferrals with reasons; one line handing off to Phase 11.

STOPPING RULES
- Stop and surface if a BLOCKING cannot be fixed without changing phase scope.
- Stop if the phase diff cannot be identified cleanly.
```
