# Phase 11m: Harvest geography and material sinks

### Starter Prompt
```
This is Phase 11m of the Masterwrought feature: the harvest geography and material sink
rebalance. It answers reported player pain with measurement, and it fixes the two economy
faults the census found: materials whose only source sits in the starter zone, and
materials produced in bulk that almost nothing consumes.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (a measured audit plus batch content).

Goal: no material forces a leveled player back into a newbie zone, no component tag yields
nothing, and no craft reagent has zero consumers. Pure data edits over shipped content: no
new mobs, no new spawn points, no new item ids (the orphan tags reuse shipped ids, so the
authorized one-id exception is not taken).

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; SYNC RELEASE (fetch, merge the newest origin/release/**, run the
  release-merge-audit skill on the merge).
- Memory scan: the test-pin trap index, content-obligations cluster, and any entry on
  corpse harvesting or gather-node placement.
- Phases 11b through 11l are merged and green.
- DECISION 12 IS SETTLED (2026-08-20, the full delegation). Nothing here is confirmed at
  STEP 0. Read the settled decision below and its record in state.md, section "Decisions
  closed 2026-08-20 (the full delegation)" (rows 11m-D-12, 11m-ORPHAN, 11m-FLOOR,
  11m-ADMIT), and execute it. A disagreement between this file and that record is a
  doc-drift finding to fix before any edit, never a licence to pick.

THE REPORTED PAIN (player feedback, 2026-08-20, recorded verbatim in intent so a later
session can judge whether the fix landed):
- Switching professions forces killing in low-level areas, competing with new players.
  "3-5 spiders and needing 35 is going to take an hour."
- Silk is only available in the starting area, so leveled players farm newbie mobs.
- Homespun Cloth drops heavily from Mirefen mobs, making tailoring the easiest craft.
- Disenchanting yields far more of its Greater material than anything consumes.
- Vendor potions undercut alchemy (owned by Phase 11n, `phase-11n-vendor-floor.md`, not
  this phase). ADMISSION IS SETTLED: the gate in `implementation-plan.md` closed 2026-08-20
  ADMITTED, so 11l, 11m and 11n are in the packet, in the phase table, in the README list
  and in `progress.md`. This file's earlier "NOT YET ADMITTED" line was stale and is
  corrected here (11m-ADMIT). `decisions-index.md`'s matching stale row is corrected by
  Phase 11d, not by this phase.
PERCEPTION IS RELIABLE ABOUT *THAT* SOMETHING IS WRONG AND UNRELIABLE ABOUT *WHY*. Every
item below was re-measured before it became a deliverable, and the cloth report is a
worked example: the felt problem is real, but there is no drop RATE to nerf because the
mechanism is tag membership, not a rate.

THE MEASURED FAULTS (re-derive each in STEP 1; these are the shape, not the authority):

FAULT A, harvest geography. src/sim/content/professions.ts HARVEST_COMPONENT_ITEMS maps a
mob's component tag to a material (hide, fang, silk, venomSac, meat, cloth, claw, tusk), so
a material's geography is decided ENTIRELY by which mob templates carry which tag. The
census across every content file:
    tusk      curved_tusk       2 templates,  2 zones
    silk      spider_silk       3 templates,  3 zones
    venomSac  venom_gland       4 templates,  4 zones
    claw      sharp_claw        6 templates,  4 zones
    cloth     homespun_cloth    7 templates,  4 zones
    meat      game_meat        15 templates,  9 zones
    fang      wolf_fang        16 templates,  8 zones
    hide      rough_hide       33 templates, 14 zones
A 16x spread between scarcest and most abundant. Silk at three templates IS the
"3-5 spiders and needing 35" report, and it also explains why tailoring feels
simultaneously trivial (cloth) and miserable (silk): it consumes both ends of the spread.

FAULT B, orphan tags. The tags `horn` (2 templates) and `gills` (4 templates) appear on mob
templates but in NO HARVEST_COMPONENT_ITEMS row, so those corpses yield nothing from those
families. Per the extensive comment above the table, an unlisted family is never extracted,
is always forfeited breadth, AND raises the concentration bonus on every MIXED template
carrying it (professions/gathering.ts harvestConcentrationBonus). So the orphans are not
merely inert, they are distorting harvest math on every mixed template that carries one.

FAULT C, a reagent rung whose "dead end" premise was WRONG, and this correction is itself a
deliverable. The enchanting ladder is arcane_dust (base), arcane_essence (mid), arcane_shard
(Greater), lucent_reagent (apex). The census that produced the original numbers:
    arcane_dust      9 recipes,  27 units
    arcane_essence  19 recipes,  40 units
    arcane_shard     2 recipes,  10 units   <-- STALE: this scanned recipes.ts ONLY
THE CORRECTION (2026-08-20, 11m-D-12): that shard count MISSED `src/sim/content/enchants.ts`,
which carries TEN more arcane_shard consumer rows (nine at count 1, one at count 2), three of
them apex rows that pair the shard with lucent_reagent. Live demand is 12 consumers and 21
units, not 2 and 10. The "dead-end rung" premise is therefore FALSIFIED and must be
re-derived over BOTH files before any row is written; the two skill-25 tool charms
(recipe_gatherers_cache, recipe_artisans_eye) are the two 5-unit rows in recipes.ts, not the
whole story. THE SUPPLY SIDE WAS ALSO WRONG and is corrected here (2026-08-20, qr-11m-SUPPLY,
state.md row 125): DISENCHANT_MATERIAL_BY_QUALITY in
src/sim/professions/disenchant_reagents.ts maps rare to arcane_ESSENCE, not to the shard;
shards come ONLY from epic and legendary disenchants. baseDisenchantYield = qualityIdx +
floor(requiredLevel/10) + 1 plus a 0-or-1 rng bonus, so a level-20 rare yields roughly 6 to 7
ESSENCE per disenchant, and essence is the best-fed rung of the family. The corrected
two-file comparators: arcane_dust 41 consumers, arcane_essence 40, arcane_shard 12; a ratio
of 12 against those is worth REPORTING as
an outlier, not asserting as a fault, and the shard's supply channel (epics only) is the
SCARCEST in the family, so "the rung a mid-to-high player produces most" was never the
shard. Re-derive both halves, demand AND supply, before writing any row. NOTE FOR THE RECORD, and it is the reason the sweep is
a ratio table rather than a threshold: a census that scans one file and names a rung dead is
exactly how a phase invents a problem. R20's supply-coverage test cannot see demand at all;
R21's demand audit is what looks, and 11m-FLOOR below fixes what it is allowed to assert.
Cite the corrected version in the 11j ledger as the worked example.

DECISION 12 (the rebalance shape). SETTLED 2026-08-20 under the full delegation. Recorded in
state.md, section "Decisions closed 2026-08-20 (the full delegation)", as rows 11m-D-12,
11m-ORPHAN, 11m-FLOOR and 11m-ADMIT. Nothing here is confirmed at STEP 0; the session
executes it.

- SPREAD, never add. Fix scarcity by adding existing tags to existing mob templates in mid
  and high zones. No new mobs, no new spawn points, no new item ids. This was an explicit
  maintainer constraint and it is also the better fix: it makes the world denser rather
  than larger.
- TARGET, measured over the REACHABLE subset and not over membership: every mapped
  component tag reaches at least 6 templates across at least 4 zones, spanning at least two
  level bands, where every count admits ONLY templates that spawn in an open-world zone
  (not an instance, not a raid, not a delve) at a spawn point a player of that template's
  own level range can reach without a group. Bring tusk, silk, venomSac and claw up to that
  floor by tagging thematically correct existing templates (a spider in a mid zone already
  reads as a silk source; a boar-like or tusked template already reads as tusk).
  AMENDED 2026-08-20 (qr-11m-SPREAD, state.md row 124), three additions the review proved
  necessary:
  (1) THE FLOOR COVERS ALL SIX FAMILIES, horn and gills included: once 11m-ORPHAN maps
  them they are MAPPED tags, the test below asserts the floor over every mapped tag, and
  the review measured horn at roughly ONE reachable open-world carrier (sethrael_palecoil
  is a count-1 named; wildheart_hexcaller lives in an open-field DungeonDef) and gills at
  four. Without spreading them too, this phase's own suite reds on its own deliverable.
  Starting candidates, each used only where the flavor reads true: horn on moor_ram,
  veiled_stag, gilded_stag, frostmane_yeti; gills on tide_scuttler and shoal_scuttler
  beside the four shipped carriers.
  (2) THE MID-BAND SILK SOURCE IS DIRECTED BY NAME: mire_widow (zone2, levels 8 to 10,
  open world) GAINS the silk tag. Silk's shipped spread (bands 2 to 4 plus 20 to 20)
  already satisfies the two-band clause, so the floor alone cannot force a single mid-band
  source and the reported 5-to-19 hole would survive a green test; mire_widow is the one
  open-world mid-band spider in the game and closes it.
  (3) SPAWN DENSITY IS RECORDED per family in the ledger: the floor counts templates, so
  count-1 named mobs are legal members and the metric cannot see density; writing the
  per-family spawn-point counts down is what lets the QA twin's reachability agent judge
  the complaint the player actually made ("3-5 spiders and needing 35").
  WHY the reachable subset is the ruling and not a refinement: R22 states its floor in its
  own words as REACHABILITY, and says a floor met by tagging a raid boss and a dungeon rare
  is the same bug with a passing test. Counted over membership, the R22 suite would pass on
  exactly the shape R22 names as still broken.
- MAP THE ORPHANS by reusing shipped ids; mint nothing. `horn` maps to `curved_tusk`.
  `gills` maps to `mudfin_scale`. MONSTER_MATERIAL_TIERS rows at 1 for both, the shipped
  bare-hands floor. HARVEST_COMPONENT_SPECIMENS: NO specimen for either, decided explicitly
  with its reason recorded. The phase's authorized one-new-id exception is NOT used, and
  that non-use is itself recorded.
  WHY: `horn` reads as the same hard keratin structure as tusk, and `curved_tusk` is the
  THINNEST mapped family in the census at 2 templates, so pointing the orphan at the starved
  material fixes two measured faults with one line. `gills` to `mudfin_scale` ties 11l and
  11m into one act: the trophy 11l rescues from the junk sweep becomes the corpse-harvest
  yield 11m maps. No specimen because both sit at material tier 1, and a pristine jackpot on
  a bare-hands-floor component would invert the premium ladder MONSTER_MATERIAL_TIERS exists
  to state.
  PRE-CHECK, mandatory: 11l runs first and promotes `mudfin_scale` out of quality 'poor'.
  READ that promotion in code before writing the gills row. If it is not there, 11l has not
  landed and this row waits.
  REJECTED: minting a new material for either tag. It buys nothing the two shipped ids do
  not already carry and drags art, M16 and wiki obligations into a pure data phase.
- DO NOT thin cloth by nerfing anything. Its abundance is relative, and raising the floor
  under silk closes the felt gap without subtracting content. If cloth still reads as
  over-abundant after the spread, that is a follow-up measurement, not a guess made now.
- FAULT C: RE-DERIVE the arcane_shard census over BOTH `src/sim/content/recipes.ts` AND
  `src/sim/content/enchants.ts` before writing any row, because the "2 recipes, 10 units,
  both consumers skill-25 tool charms" premise is falsified (12 consumers, 21 units live).
  Then act on what the corrected census actually shows, at the rung that produces the
  material, with jewelcrafting and inscription (phases 05 and 06, both input-starved) as the
  natural second sink where magical dust in inks and gem settings is thematically right.
  NO AFFIX REROLLS: that system was deferred explicitly and is out of scope here.
  SAME-CHANGE OBLIGATION if and only if a shard consumer lands BELOW the apex band:
  `src/sim/content/recipes.ts` carries the "NEVER arcane_shard" reservation THREE times (the
  jewelcrafting hub header, the inscription header, and the INTERMEDIATE_RECIPES header),
  each saying shards stay reserved for the apex band. All three are amended in the same
  change. If every new consumer lands inside the apex band, all three are already satisfied
  and the phase records that finding instead. Neither branch may be left unstated.
- THE R21 DEMAND FLOOR, stated here because two agents below reference a floor this decision
  previously never set: THE ENFORCEABLE FLOOR IS PRESENCE, consumer count at or above 1.
  That is the ONLY numeric assertion, in tests/gathering_supply_coverage.test.ts and in
  Agent 4's pin. Consumers and unit demand per material, by family, are RECORDED in the
  packet record as a ratio table and reported by Agent 3's sweep as OUTLIERS against their
  family's own median. They are never asserted.
  WHY: zero is a structural fact, and everything above zero is a balance number nobody
  measured. A numeric floor would turn an invariant guard into a content quota, which is a
  worse test than none because it passes on padding. This is the SAME ruling as Phase 11j
  Decision E, stated once so the two files stop disagreeing; Phase 11j's deliverable 1b
  wording is corrected in its own file by the 11j session. The arcane_shard case is the
  proof the ratio table is the right instrument: the shard's corrected 12 consumers against
  arcane_essence's 19 is a genuine outlier worth reporting and a terrible thing to assert.
  REJECTED: a numeric consumer-count or unit-demand floor. It invents a threshold and is
  gameable by a decorative row.

THE INTERACTION THAT MAKES THIS NOT A SIMPLE DATA EDIT, and the reason it gets a phase.
Wiring a family into HARVEST_COMPONENT_ITEMS, or adding a tag to a template, is NEITHER
yield-only NOR local. Per the table's own comment: it re-enables the harvest affordance on
every template carrying that tag with no code change, AND it re-tunes the concentration
bonus DOWN on every mixed template carrying that same tag. Adding a tag to a mob also
widens that mob's bonus denominator, which is a balance edit. The bound that keeps it
honest (a corpse never out-pays the tag list it advertises) is a checked property in
tests/mob_component_tags.test.ts, not an assumption. Every edit here must be judged against
that test, and the phase must report the concentration-bonus movement it causes rather than
discovering it later.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs or coordinator monoliths in
the main loop):
- Re-derive all three censuses from the merged tree and report drift from the numbers above:
  (a) component tag membership per template per zone per level band, split into the REACHABLE
  subset and the rest (instances, raids, delves, and any spawn a solo player of that level
  cannot reach), because the decision-12 target counts only the reachable half,
  (b) unmapped tags, (c) per-material demand (recipes and total units) against supply, scanned
  over `src/sim/content/recipes.ts` AND `src/sim/content/enchants.ts`: a one-file scan is what
  produced the falsified arcane_shard premise above.
- src/sim/content/professions.ts (HARVEST_COMPONENT_ITEMS, MONSTER_MATERIAL_TIERS, the
  specimen table and the whole comment block above them),
  src/sim/professions/gathering.ts (isHarvestableCorpse, harvestConcentrationBonus),
  src/sim/professions/enchanting.ts (baseDisenchantYield, DISENCHANT_MATERIAL_BY_QUALITY,
  APEX_TIER_REAGENT), tests/mob_component_tags.test.ts.
- The zone level bands, so "two level bands" is measured and not guessed.
Return: the three censuses, the level-band map, and every pin that binds tag membership or
the concentration bonus.

STEP 2 - EXECUTE (parallel fan-out, explicitly):

Agent 1 (tag spread):
- Add mapped tags to thematically correct existing templates until every mapped family
  meets the decision-12 floor, ALL SIX families including the newly mapped horn and gills
  (qr-11m-SPREAD), with mire_widow's silk tag landed by name as the mid-band source. Each
  edit names, in a comment or the ledger, why that
  template plausibly carries that component.
- Report the concentration-bonus delta per touched template, before and after.
- Record the per-family spawn-density counts in the ledger beside the template counts.
- Pin the floor as a test (see agent 4).

Agent 2 (orphan tags):
- Map `horn` to `curved_tusk` and `gills` to `mudfin_scale` per decision 12, with
  MONSTER_MATERIAL_TIERS rows at 1 for both (the shipped bare-hands floor) and NO
  HARVEST_COMPONENT_SPECIMENS row for either, recorded as an explicit decision with its
  reason rather than left as a default. Zero new item ids.
- Verify the 11l promotion of `mudfin_scale` out of quality 'poor' in code before writing the
  gills row, and say so in the report. A ledger row is not the proof; the def is.
- Pin that no template carries a tag absent from HARVEST_COMPONENT_ITEMS. That pin is the
  real fix: it makes this class of gap impossible to reintroduce.

Agent 3 (material sinks):
- Re-derive the arcane_shard census over recipes.ts AND enchants.ts FIRST, publish the
  corrected numbers, and only then decide what the rung actually needs. Recompute the demand
  census afterward and record the new ratio.
- If any new shard consumer lands below the apex band, amend all three "NEVER arcane_shard"
  reservations in `src/sim/content/recipes.ts` (jewelcrafting hub header, inscription header,
  INTERMEDIATE_RECIPES header) in the same change. If every new consumer stays inside the apex
  band, record that the three reservations are already satisfied and were checked.
- Sweep EVERY reagent, not just the reported one: any material with ZERO consumers gets one at
  its own rung (that is the whole assertable floor, per decision 12's R21 paragraph). Everything
  above zero is REPORTED as a ratio table, by family, with outliers named against their family's
  own median, and is not acted on unless the phase can state a reason that is not a threshold.
  Report the full sweep even where no action was needed.

Agent 4 (the invariants and their tests):
- R22, tests/harvest_geography.test.ts: every mapped component family reaches the template,
  zone and level-band floor COUNTED OVER THE REACHABLE SUBSET (the reachability predicate is
  part of the test, not a comment beside it), and no template carries an unmapped tag. Failure
  messages name the family and what it is short of. Add one arm proving the predicate has
  teeth: a family whose count depends on an instance-only or raid-only template FAILS.
- The R21 arm extending 11j's coverage test: every craft reagent has AT LEAST ONE consumer.
  That is the only numeric assertion. Failure names the material. Do NOT assert a ratio, a
  unit-demand figure, or a per-band count; those live in the recorded table.
- Both tests must fail on a real regression: prove it by mutation (remove one tag, drop the
  last consumer of a material), then restore.

INVARIANTS IN PLAY: no new mob, no new spawn point, and ZERO new item ids (decision 12 maps
both orphan tags to shipped ids, so the one-id exception is not taken and a sweep proves it);
drop rates and drop tables are NOT touched (the
mechanism here is tag membership); no rng, no sim behavior change, so determinism is not in
play and the phase should say so rather than have its QA hunt for a draw-order impact; the
corpse-never-out-pays-its-tags bound in tests/mob_component_tags.test.ts holds throughout.

NAMED REDS THIS PHASE EXPECTS: tests/mob_component_tags.test.ts until the concentration
movement is reconciled; the economy pins until agent 3's recompute; the new R22 suite until
agent 4 lands. Any OTHER red is a real finding.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
- npx tsc --noEmit; npx vitest run tests/mob_component_tags.test.ts
  tests/harvest_geography.test.ts tests/recipe_economy.test.ts tests/progression.test.ts
  tests/itemization_coverage.test.ts tests/guide.test.ts tests/localization_fixes.test.ts
- npm run ci:changed.
- Dispatch: content-obligations-reviewer (mandatory, a content diff),
  test-coverage-auditor (the two new invariants and their mutation proofs),
  architecture-reviewer ONLY if a src/sim/ behavior actually changed (a pure content-table
  edit does not qualify; if it does qualify, that is itself worth reporting). qa-checklist
  LAST. Prompt for COVERAGE, not filtering. Apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers): one commit for the
tag spread, one for the orphan mapping, one for the sinks, one for the invariants.

STEP 5 - ACCEPTANCE:
- [ ] Decision 12 executed as settled (11m-D-12, 11m-ORPHAN, 11m-FLOOR, 11m-ADMIT), with the
      phase report citing the state.md record rather than re-deciding anything
- [ ] All three censuses re-derived from the tree; drift from this file reported; the demand
      census scanned recipes.ts AND enchants.ts, with the corrected arcane_shard numbers stated
- [ ] Every mapped family meets the template, zone and level-band floor COUNTED OVER THE
      REACHABLE SUBSET, horn and gills included (qr-11m-SPREAD), and the reachability
      predicate lives in the test
- [ ] mire_widow carries the silk tag (the directed mid-band source), and the per-family
      spawn-density counts are recorded in the ledger
- [ ] No template carries an unmapped tag, pinned
- [ ] horn yields curved_tusk and gills yields mudfin_scale, both at MONSTER_MATERIAL_TIERS 1,
      both with NO specimen row and that non-membership recorded as a decision
- [ ] The 11l promotion of mudfin_scale out of quality 'poor' was verified in code, not from
      a ledger row
- [ ] Zero new item ids: the authorized one-id exception was NOT used, and the non-use is
      recorded
- [ ] Concentration-bonus movement reported per touched template, and
      tests/mob_component_tags.test.ts green
- [ ] The corrected arcane_shard demand is stated; if any new consumer sits below the apex
      band, all three "NEVER arcane_shard" reservations in recipes.ts are amended in the same
      change, and if none does, that check is recorded
- [ ] The reagent sweep is reported in full as a ratio table with outliers named; the only
      assertion anywhere is presence (consumer count at or above 1)
- [ ] R22 and the R21 presence arm both proven decisive by mutation, restored after
- [ ] Zero new mobs, zero new spawn points, zero drop-rate edits, proven by sweep
- [ ] Economy pins recomputed, predicted before observed
- [ ] All listed suites green; ci:changed clean; only the NAMED reds above

STEP 6 - DOCS: progress.md Phase 11m row. state.md ledger: decision 12 as EXECUTED (cite the
settled rows rather than restating them), the three censuses before and after with the
reachable subset called out, the per-template concentration deltas, the corrected
arcane_shard census beside the stale one, the reagent ratio table in full with its outliers,
and an explicit note mapping each player report to what was measured, what was changed, and
what was deliberately NOT changed with its reason (the cloth report in particular, so a later
session does not re-litigate it).

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, the mutation
kill table, and a one-line handoff for the QA session.

STOPPING RULES:
- Decision 12 is settled, so there is nothing to ask about the shape. STOP instead if this
  file and the state.md record disagree on any of 11m-D-12, 11m-ORPHAN, 11m-FLOOR or
  11m-ADMIT: that is doc drift, fixed before any edit and never resolved by picking.
- Stop if a fix would need a new mob, a new spawn point, or a drop-rate change: those were
  ruled out, and needing one means the diagnosis was wrong.
- Stop if a mapped family cannot reach the floor over the REACHABLE subset without tagging an
  instance, raid or delve template. Padding the count with unreachable templates is the exact
  failure R22 names, and reaching for it means the spread needs different templates, not a
  looser count.
- Stop if the re-derived census differs materially from the numbers above (that means a
  merge moved content, which is an 11b or 11d finding).
- Stop if reconciling the concentration bonus would require changing
  harvestConcentrationBonus itself: that is a mechanic change, not a data rebalance.
```

## Corrections found at execution (2026-08-25, the 11m session; the census above is the SHAPE)

Re-derived from the merged tree at 9f130d3b7c (the seventeenth release sync,
release/v0.41.0), before any edit, as STEP 0 and STEP 1 require:

- **meat is 17 templates over 10 zones, not 15 over 9** (16 over 10 on the
  reachable subset): the release's Proving Shore added shore_scuttler (levels
  1 to 2, three camps) and mister_crabs (summon-only, quest-gated, no camp).
  The two are the release's, not this phase's; the "zero new mobs, zero new
  spawn points" sweep is anchored on the merge commit, never on the 11l stamp.
- **ZONES is 15, not 14**: proving_shore appended at levelRange 1 to 2. The
  island is an open-world zone a player of any level can revisit (the ferry
  bell routes either way with no graduation gate, src/sim/interactions/
  ferry_bell.ts), so its camps count for the reachable subset.
- **claw's shipped spread was 3 zones, not 4**: every claw carrier sits in
  Eastbrook, Mirefen or Thornpeak; the 4 above counted a zone no carrier has
  a camp in. The template count of 6 was right.
- **horn's "2 templates" is 1 reachable**: wildheart_hexcaller lives only in
  the Wildheart dungeon roster (no camp), as qr-11m-SPREAD already measured.
- **The corpse-harvest test corpus used gills and horn as THE unmapped
  exemplars** (about two hundred sites across eleven suites, sethrael_palecoil
  and mudfin_murloc as the shipped mixed fixtures). Mapping the orphans
  retires every shipped unmapped fixture, so the migration to a synthetic
  never-mapped family (tests/helpers/unmapped_family.ts) is part of the orphan
  commit; the phase file above did not name it. Recorded in the ledger.
- **A premise the plan did not name**: the capacity pre-gate assumes no corpse
  carries two specimen-less families (fang, cloth, tusk, and with this phase
  horn and gills), pinned in tests/corpse_harvest_sim.test.ts. It refused two
  of the settled starting candidates (dune_troll for tusk, frostmane_yeti for
  horn, both fang carriers); the spread swapped in the Farshore's Sundered
  Horror and held horn's floor on the six remaining carriers.
