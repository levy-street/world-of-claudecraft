# Phase 5: Crops and tools

With the growth engine and knobs in place, this phase lands the entire content
surface: the eight-crop ladder across four tiers (seed, produce, fine twin, grades,
icons, English names), the four-rung hoe ladder, seed-back rolls that make high-tier
seeds market goods, finalized bed counts per hub, and the farming rollout arms that
make every integrity guard permanent. It is the batch-heavy content sweep of the
packet and runs as an ultracode Workflow.

Live-surface note (binding): Dormant BY CHOICE. Tier 1 and 2 seeds and brook_carrot (the
starter fee vegetable, D9) receive their positive buyValue but are placed on NO
NpcDef.vendorItems row until Phase 9 flips go-live; tier 3 and 4 seeds come only
from seed-back rolls on crops nobody can plant yet. Nothing added this phase is
player-reachable.

### Starter Prompt

```
This is Phase 5 of the Farming feature: Crops and tools.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.
ULTRACODE: add the keyword ultracode to this prompt so the content sweep (many
uniform item, grade, icon, and i18n rows) runs as a Workflow with pipeline plus
adversarial verify instead of hand-spawned agents.

Goal: the complete eight-crop ladder and the hoe ladder exist with every integrity
guard green.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Never touch the
  main checkout. Prefix every git command with git -C ~/Documents/woc-farming-plan.
- git status must be clean. If it is not, stop and surface.
- Re-resolve the NEWEST release branch: git fetch origin --prune; git branch -r
  --list 'origin/release/*' | sort -V. Create branch
  fix/farming-phase-05-crops-and-tools off that tip. Record the phase-start commit
  (git rev-parse HEAD) for the STEP 3 diff. If the branch goes long-lived and
  release moves mid-phase, merge release in and run the release-merge-audit skill.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  these phase-relevant topics: workflow-args-stringified,
  workflow-parallel-missing-await, workflow-agent-sendmessage-duplicates,
  fanout-agent-delivery-traps, big-diff-reviewer-turn-budgets,
  i18n-semantic-regressions-gate-trap, worktree-cwd-drift-misroutes-git.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to read and summarize: docs/farming/state.md,
docs/farming/progress.md, docs/farming/phase-05-crops-and-tools.md, and these source
files as earlier phases landed them (state.md's "Key planned files" section records
any refined names): src/sim/content/farm_patches.ts,
src/sim/professions/farming_zones.ts, src/sim/professions/farming.ts, the farming
items content module (planned src/sim/content/farming_items.ts), the modules
exporting MATERIAL_GRADES, TOOL_RECIPES, slotToolEffectRefused, and canGatherTier
(locate them by symbol), an existing gathering profession's material rows as the
sellValue precedent, tests/professions_zone_rollout.test.ts,
tests/farm_patch_placement.test.ts, tests/recipe_economy.test.ts,
tests/professions_farming.test.ts, and the procedural item-icon registry. Also the
relevant CLAUDE.md files: the root CLAUDE.md, src/sim/CLAUDE.md,
src/sim/professions/CLAUDE.md, src/sim/content/CLAUDE.md, src/ui/CLAUDE.md. The
orchestrator never reads planning docs or coordinator monoliths directly.
The summary MUST return: the materials sellValue convention and the exact fine-twin
pricing convention as found in code (this file names it the four-times buyValue
convention; report the precise field the MATERIAL_GRADES precedent scales and flag
any divergence); the MATERIAL_GRADES row shape; the procedural icon registration
recipe and the profession-icon precedent; the TOOL_RECIPES row shape and the
toolworks station id; the shape of the R23 top-rung-unpriced-and-craftable arm;
slotToolEffectRefused's current policy and where hoes must be admitted; the
FARM_PATCHES def shape and current bed-count status per hub; the FARMING_ZONE_TIERS set
and tiers; where the farming rollout arms belong in
tests/professions_zone_rollout.test.ts; the draw-count contract pin location and
current values; the farming_session golden re-record recipe (UPDATE_PARITY=1); the
wiki regen command and freshness gate.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
This phase orchestrates via the ultracode Workflow (pipeline plus adversarial
verify), not hand-spawned agents: the uniform row sweep is exactly the shape a
Workflow batches well. Request the fan-out explicitly. Give every Workflow agent ONLY
the Explore summary and its own lane brief, never the planning docs. Never set plan
mode on a teammate agent. Workflow traps from memory: args can arrive
JSON-STRINGIFIED (normalize with a typeof-string JSON.parse at the top), await every
parallel(), and never SendMessage a live Workflow agent (it resumes a duplicate that
re-runs stateful git steps).

Pipeline lane A, the uniform crop rows (fan out per crop, eight items in the batch;
ids are locked by D11, English display names are proposals for the maintainer lore
pass, IP-safe per D17): tier 1 vale_wheat and brook_carrot; tier 2 marsh_rice and
bog_beet; tier 3 highland_barley and frost_gourd; tier 4 gilded_sunmelon and
evergarden_greens. Per crop:
- seed item def: tier 1 and 2 seeds get a positive buyValue (for Phase 9 stocking)
  but NO vendorItems row anywhere; tier 3 and 4 seeds get no vendor pricing: they
  are market goods fed by harvest seed-back rolls and, once Phase 10 lands, the
  rare event (D11)
- produce def: kind 'junk' so it browses under the market's material filter,
  sellValue per the materials convention in the state.md seam reference,
  market-listable by default
- brook_carrot only, the starter fee vegetable per D9: its produce def also
  receives a buyValue at the four-times-sell convention in THIS phase
  (vendor-stocked by farmer_jessica in Phase 9), so a day-one player can pay
  their first watch fee; no other produce receives a buyValue
- fine_ twin def per the MATERIAL_GRADES requirement, following the four-times
  buyValue convention (follow the precedent exactly as the Explore summary reports
  it; note any divergence from this file's wording in progress.md)
- a MATERIAL_GRADES row, a procedural item icon per item, and English item-name rows
  in the matching src/ui/i18n.catalog module

Lane B, the crop duration and tier table per D5: tier 1 crops 30 to 60 min, tier 2
about 2 h, tier 3 about 4 h, tier 4 overnight. Tuning constants live in content with
a maintainer-flag comment on every value proposing it for adjustment.

Lane C, the hoe ladder (D10): four rungs as ordinary items with
use: { type: 'gatherTool', professionId: 'farming', tier } at ascending tiers,
riding canGatherTier and the frozen wield-gate thresholds; TOOL_RECIPES rows at the
toolworks; rung one gets a buyValue for Phase 9 vendor stocking; the top rung is
unpriced and craftable per the R23 arm. slotToolEffectRefused admits farming hoes,
and a pin proves all three existing tool effects slot onto a hoe.

Lane D, seed-back rolls: at harvest, tier 3 and 4 crops roll seed-back (action-time
draws, allowed by D4). Propose the rates and flag them for the maintainer as
economy-sensitive (state.md OPEN items). The draw-count contract is RESTATED in the
driver's doc comment and re-pinned with the new per-harvest count, and the
farming_session golden re-records in its own isolated commit (UPDATE_PARITY=1, never
hand-edited).

Lane E, patches and rollout arms: finalize FARM_PATCHES bed counts per hub; add the
farming rollout arms to tests/professions_zone_rollout.test.ts keyed to
FARMING_ZONE_TIERS per D2. Per farming zone the arms assert: patches exist on legal
ground, a tier-appropriate crop set, seed/produce/twin/icon/name integrity, a hoe
rung per tier, the top rung unpriced, and every material has a consumer or an
explicit Phase 6 consumer note. The hub-stocking arm is authored now but states that
stocking flips in Phase 9 (today it pins the dormant state: no vendor rows).

Adversarial verify stage: re-run the integrity suites over the whole batch, hunt
row-level drift (a crop missing its twin, an icon or name row skipped, a tier
mismatch, an IP-unsafe name), and confirm tests/recipe_economy.test.ts is green and
the wiki regenerated (npm run wiki:content; tests/guide.test.ts freshness).

INVARIANTS THIS PHASE MUST KEEP
- EVERY new material ships with a consumer or a pinned Phase 6 consumer note (the
  wolf_fang rule), no exceptions.
- ALL names are IP-safe per D17: no coined terms from other games, real plant words
  and original zone-flavored coinages only, audited at authoring time.
- NO vendor row without a positive buyValue ever ships (the dead-row trap; trivially
  true this phase since no vendor rows are added at all).
- D4: ALL randomness draws at player-action moments through ctx.rng; the seed-back
  roll draws at harvest, never at timer expiry, in the tick sweep, or at login.
- Crop ids are locked by D11; no id changes for any reason.
- Anti-chore: EVERY duration constant respects two visits per crop cycle; nothing
  rots, no third visit.

Out of scope (do NOT do in this phase):
- Cooking and alchemy recipes (Phase 6).
- Vendor placement of any item (Phase 9).
- Deeds (Phase 10).
- Work orders (Phase 9).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order:
- npx tsc --noEmit
- npx vitest run tests/professions_zone_rollout.test.ts
  tests/farm_patch_placement.test.ts tests/recipe_economy.test.ts
  tests/professions_farming.test.ts tests/architecture.test.ts
  tests/localization_fixes.test.ts tests/guide.test.ts
- npx vitest run tests/parity (goldens regenerate ONLY in the lane D isolated commit)
- npm run ci:changed
- node scripts/gate_select.mjs
Then check git diff --name-only against the phase-start commit and dispatch ONLY the
matching rows of the Review Dispatch Matrix in docs/farming/implementation-plan.md.
For this phase's expected diff the matching rows are: architecture-reviewer (the
seed-back draws touch sim rng order), frontend-seam-reviewer (the i18n catalog and
icon touches match its matrix row), and qa-checklist (the phase deliverable set is
complete); dispatch cross-platform-sync ONLY if any event or wire surface moved
(pure content rows do not move it). Every review agent gets a hard 30-tool-call
budget, the coverage instruction ("report every issue including low-severity and
uncertain ones; ranking happens later"), and, if truncation looms, the resume line:
"Stop reading more files. Output the full report now based on what you have already
seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
No commit while a BLOCKING stands.

STEP 4 - COMMIT CADENCE
2 to 5 Conventional Commits, each with a scope and a body (what changed and why),
explicit paths only, never git add -A, no session links or Claude attribution.
Suggested shape:
1. feat(farming): eight-crop content ladder (seeds, produce, fine twins, grades,
   icons, English names)
2. feat(farming): hoe ladder, tool-effect admission, crop duration table
3. feat(farming): tier 3 and 4 seed-back rolls with the re-pinned draw contract
4. test(parity): re-record farming_session golden after the seed-back draw change
   (isolated, nothing else in the commit)
5. test(professions): farming rollout arms, finalized bed counts, wiki regen

STEP 5 - ACCEPTANCE CRITERIA
- [ ] all eight locked crop ids exist with seed, produce, and fine_ twin defs;
      produce is kind 'junk' and market-listable; sellValue follows the materials
      convention; fine twins follow the four-times buyValue convention as the
      precedent implements it
- [ ] MATERIAL_GRADES rows, procedural icons, and English name rows exist for every
      new item; display names are flagged for the maintainer lore pass and audited
      IP-safe per D17
- [ ] tier 1 and 2 seeds carry a positive buyValue and appear on NO vendorItems row;
      tier 3 and 4 seeds carry no vendor pricing and flow from harvest seed-back
      rolls and, once Phase 10 lands, the rare event (D11)
- [ ] brook_carrot carries a buyValue at the four-times-sell convention (the starter
      fee vegetable, D9; stocked in Phase 9) and no other produce carries one
- [ ] the crop duration and tier table per D5 lives in content with a
      maintainer-flag comment on every tuning constant
- [ ] the hoe ladder has four rungs with use: { type: 'gatherTool', professionId:
      'farming', tier } at ascending tiers, TOOL_RECIPES rows at the toolworks,
      buyValue on rung one only, and the top rung unpriced and craftable per the
      R23 arm
- [ ] slotToolEffectRefused admits farming hoes and a pin proves all three tool
      effects slot onto a hoe
- [ ] seed-back rolls for tier 3 and 4 seeds draw at harvest action time; rates are
      proposed and economy-flagged; the draw-count contract is restated and
      re-pinned
- [ ] the farming_session golden re-record is its own isolated commit
- [ ] FARM_PATCHES bed counts are finalized per hub and
      tests/farm_patch_placement.test.ts is green
- [ ] the farming rollout arms in tests/professions_zone_rollout.test.ts pass: per
      farming zone, patches on legal ground, a tier-appropriate crop set,
      seed/produce/twin/icon/name integrity, a hoe rung per tier, the top rung
      unpriced, and every material with a consumer or an explicit Phase 6 consumer
      note; the hub-stocking arm exists and states that stocking flips in Phase 9
- [ ] tests/recipe_economy.test.ts is green and the wiki regenerated
      (tests/guide.test.ts freshness green)
- [ ] the STEP 3 validation list is green and node scripts/gate_select.mjs passes
      apart from the standing armory browser exception
- [ ] docs/farming/progress.md and docs/farming/state.md ledgers are updated

STEP 6 - DOC UPDATES + MEMORY
Update docs/farming/progress.md (Phase 5 status row, the copied acceptance list with
check states, a Notes block) and the docs/farming/state.md ledgers (new
items/recipes, new i18n keys, proposed rates and names awaiting the maintainer, any
refined file names). Any deviation decided in-phase (including a fine-twin pricing
convention that differs from this file's wording) gets swept into
docs/farming/phase-05-crops-and-tools.md AND docs/farming/phase-05-qa.md in the same
pass, plus a line in state.md's "Locked deviations" ledger. Record surprises in
Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status; files touched; validation results (each command, pass or fail);
review verdicts per agent; deferrals with reasons; and a one-line handoff for the QA
session.

STOPPING RULES
- Stop if a crop cannot satisfy the integrity arms without changing a locked id: the
  D11 ids do not move. Surface the conflict to the maintainer instead.
- Stop if git status is not clean at STEP 0 or the newest release branch cannot be
  resolved.
- Stop if a BLOCKING review finding cannot be fixed without violating a locked
  decision (D1 to D24); state.md wins over this file, and a contradiction gets swept,
  not coded around.

When everything above is done: gate via node scripts/gate_select.mjs (the armory
browser red is the standing environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker;
PR CI is the arbiter), push, and open the PR against the release branch this phase
was based on, following .github/PULL_REQUEST_TEMPLATE.md.
```
