# Phase 10: Apex consumables and enchants

### Starter Prompt
```
This is Phase 10 of the Masterwrought feature: the consumable professions' apex rung
and the bounded enchant line.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: three flasks, three role foods, three apex enchants (all exactly one rung over
the shipped lines, all in existing aura families), the two skill-125 capstone
placements (Grand Cauldron, The Laden Hearth), and the guarded Perfected-only Lucent
Infusion.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on aura/exclusivity, cooldown persistence, test-pin
  traps, station/placement gotchas.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (rulings R7, R13, R14, R15; the phase 06 scroll
  family decisions; the phase 07 Lucent Reagent ledger entry; validation matrix)
- docs/prd/masterwrought/progress.md (Phase 10 row)
- src/sim/combat/exclusive_aura.ts (the family machinery scrolls/flasks share with
  elixirs), the rare elixir line and current-best food rows in src/sim/content/
  (increment baselines), src/sim/content/enchants.ts + src/sim/professions/enchanting.ts
  (the enchant defs and the application cast seam), src/sim/professions/mobile_station.ts
  (the phase 09 placement family the cauldron/hearth reuse), src/sim/CLAUDE.md.
Return: how aura families exclude, the exact rare-elixir and best-food numbers the
increments build on, how an enchant applies today, what a placement needs.

STEP 2 - EXECUTE (parallel fan-out, explicitly):
Agent 1 (alchemy): three flasks (tank/physical/caster): persist through death, one
active at a time, exclusive with their elixir pairs via the exclusive_aura families,
exactly ONE increment over the rare elixir line (R14: stat increments, no new proc
effects). "Grand Cauldron": alchemy skill 125 (R13 capstone), places a
party-interactable flask dispenser; reuse the phase 09 mobile_station placement family
(FAMILY reuse before bespoke).
Agent 2 (cooking): three role foods, one increment over the current best, well-fed
exclusive; "The Laden Hearth" feast, cooking skill 125, party-wide, same placement
family.
Agent 3 (enchanting): confirm the Lucent Reagent intermediate from phase 07 feeds this
line (author it here ONLY if the phase 07 ledger lacks it). Three apex enchants
(weapon, chest, boots) as FLAT stat increments one rung over the existing enchants,
stats only; boots per R7: stats only, NO movement speed. "Lucent Infusion": enchanting
skill 125, applicable ONLY to Perfected pieces: authored now behind a guard that
refuses every current item (phase 12's instance flag turns it live); application rides
the existing enchanting cast seam. Refusal lines: sim emit + sim_i18n matcher in the
SAME change (S3 guard).
Agent 4 (tests): exclusivity pins (a flask and an elixir of the paired family never
both apply; scroll/flask/food land in distinct-or-shared families EXACTLY as designed);
increment pins (exactly one rung vs the shipped values); flask death-persistence; the
infusion guard (no current item accepts it).
Record in state.md: the full aura-family design (which families flasks, foods, and the
phase 06 scrolls share), every increment value, and the infusion guard shape phase 12
must flip.

INVARIANTS IN PLAY: R14 (stat increments in existing aura families; no new proc effects
anywhere); R7 (boots enchant stats only, no movement speed: rift racing); R13 (apex
products at 100, capstones at 125); R15 (any new proper noun web-verified; Grand
Cauldron, The Laden Hearth, Lucent Infusion are already registered); determinism (any
draw via Rng at a documented site); i18n emit + matcher same change; ids append-only;
masterwork.ts untouched.

Out of scope: the Perfecting stage itself and the instance flag (phase 12: the infusion
stays inert here); patterns and drop wiring (phase 11); UI beauty work (phase 14).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/progression.test.ts tests/recipe_economy.test.ts
tests/itemization_coverage.test.ts tests/item_level.test.ts tests/architecture.test.ts
tests/localization_fixes.test.ts tests/shipped_item_ids.test.ts plus the new
exclusivity/increment/guard tests; npm run ci:changed. Review Dispatch Matrix
(implementation-plan.md): architecture-reviewer (aura families, cast seam, placements
are sim behavior); cross-platform-sync if a SimEvent, wire field, or matcher rule was
added for the placements; frontend-seam-reviewer only if src/ui logic changed;
qa-checklist when the deliverable set is complete. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(content): apex flasks and role foods one rung over the shipped lines
- feat(sim): grand cauldron and laden hearth party placements
- feat(content): apex enchant line and the guarded lucent infusion
- test(sim): exclusivity, increment, and infusion-guard pins

STEP 5 - ACCEPTANCE:
- [ ] Flasks persist through death, one active, exclusive with elixir pairs; foods
      well-fed exclusive; every increment exactly one rung
- [ ] Boots enchant has NO movement speed (R7); no new proc effect anywhere (R14)
- [ ] Lucent Infusion inert (guard refuses every current item); guard shape in state.md
- [ ] Cauldron and Hearth party-usable in BOTH hosts on the placement family
- [ ] Aura-family design recorded in state.md; all suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 10 row; state.md ledger (new ids, i18n keys, the
family design, increments, the guard shape); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff
line for Phase 10 QA.

STOPPING RULES: stop and ask if the exclusive_aura families cannot express the
flask/elixir pairing without behavior-changing edits to shipped family constants, if
the infusion guard cannot be authored without phase 12 machinery, or if the release
merge conflicts inside exclusive_aura.ts or enchanting.ts.
```
