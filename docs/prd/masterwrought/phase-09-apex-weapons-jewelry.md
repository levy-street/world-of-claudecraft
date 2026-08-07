# Phase 09: Apex weapons, jewelry, gadgets

### Starter Prompt
```
This is Phase 09 of the Masterwrought feature: the remaining cap-pool pieces (weapons,
jewelry, engineering gadgets, the inscription tome).

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (content batch; drive the catalog
authoring through the ultracode Workflow fan-out).

Goal: weaponcrafting's 1H / 2H / shield on the dps budget curve, jewelcrafting's
necklace and two rings, engineering's gadget + Master's Field Forge + apex charm, and
inscription's Voidbound Grimoire; all in the budget sweep, all flagged except the forge
and the charm.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on frozen-id goldens, test-pin traps, station/placement
  gotchas, world_api parity pins.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (rulings R2, R6, R12, R13, R14, R15; power placement;
  the phase 07 demand math; validation matrix)
- docs/prd/masterwrought/progress.md (Phase 09 row; the Phase 08 ledger: sweep test
  shape, reagent conventions)
- src/sim/item_budget.ts (weaponDpsBudget, primaryStatBudget, the TWOHAND multipliers),
  src/sim/professions/mobile_station.ts (the mobile station seam the field forge
  extends), src/sim/professions/stations.ts (station radius rules),
  src/sim/content/heroic_vendor.ts (the game's only jewelry source: the rating-pin
  reference for R14 jewelry), the existing engineering tool-charm ladder in
  src/sim/content/ (its price family), tests/masterwrought_budget.test.ts,
  src/sim/CLAUDE.md.
Return: the dps arithmetic for ilvl 31 epic 1H/2H, how the charm ladder rungs price,
what the mobile station seam needs for a party-usable placement.

STEP 2 - EXECUTE (ultracode Workflow; fan out explicitly by vertical slice):
Slice 1 (weaponcrafting): a 1H, the "Ridgebreaker" 2H (TWOHAND budget multipliers; R6:
it consumes ONE cap slot), and a shield; dps exactly from weaponDpsBudget at ilvl 31
epic; stat allocations pure (R14).
Slice 2 (jewelcrafting): a necklace and two rings; PURE primary stats plus stamina only
(R14 binds HARD for stat-light slots); rating allocations pinned against the same-band
heroic-vendor jewelry rows.
Slice 3 (engineering): "Gyrelens Array" offhand gadget (stats plus a COSMETIC use only,
never a combat effect; R14); "Master's Field Forge" (apex mobile station, party-usable,
on the mobile_station seam; FAMILY reuse before bespoke); the apex tool charm, one rung
over the existing charm ladder, priced per the R47/R30 price family
implementation-plan.md names (derive the family from the shipped charm ladder and
record the resolved price in state.md).
Slice 4 (inscription): "Voidbound Grimoire" offhand tome, caster stats on the formula
budget.
Slice 5 (tests): extend tests/masterwrought_budget.test.ts with EVERY phase 09 item;
masterwrought: true on all of them EXCEPT the field forge and the charm; a cap-interplay
case (Ridgebreaker plus one flagged piece fits, a third flagged equip refuses; R6).
All recipes: recipe.level 25, epic, skillReq 100 (R13), acquisition per R8, reagents =
the profession's intermediate (phase 07 demand math) + Wyrmfall Cores + gathered mats,
quantities in state.md. Tradable (R2), standard disenchant (R12). Names beyond the
registered ones (Ridgebreaker, Gyrelens Array, Master's Field Forge, Voidbound
Grimoire): web-verify per R15 and record.

INVARIANTS IN PLAY: R14 (no new proc effects anywhere; the gadget use is cosmetic
only); R6 (a 2H counts as ONE cap slot); determinism (the forge/gadget sim logic draws
no rng, or documents its Rng site if a draw is unavoidable); module-first for any new
sim behavior (a sibling module behind SimContext, never a method cluster on sim.ts);
i18n emit + matcher in the same change for any new player text; ids append-only.

Out of scope: consumables and enchants (phase 10); patterns and drop wiring (phase 11);
any Perfecting interaction; UI beauty work (phase 14).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/progression.test.ts tests/recipe_economy.test.ts
tests/itemization_coverage.test.ts tests/item_level.test.ts
tests/masterwrought_budget.test.ts tests/masterwrought_cap.test.ts
tests/architecture.test.ts tests/localization_fixes.test.ts
tests/shipped_item_ids.test.ts; npm run ci:changed. Review Dispatch Matrix
(implementation-plan.md): architecture-reviewer (the forge and gadget-use sim logic);
cross-platform-sync if an IWorld member, SimEvent, or wire field was added for the
placement flow; frontend-seam-reviewer only if src/ui logic changed; qa-checklist when
the deliverable set is complete. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(content): apex weapons and shield on the dps budget curve
- feat(content): apex jewelry with pinned rating shapes
- feat(sim): master's field forge and gyrelens gadget on the mobile station seam
- test(content): extend the masterwrought budget sweep to phase 09

STEP 5 - ACCEPTANCE:
- [ ] Weapon dps EQUALS weaponDpsBudget at ilvl 31 epic; TWOHAND mults applied; R6 pinned
- [ ] Jewelry is pure primary + stamina; ratings pinned to heroic-vendor rows (R14)
- [ ] Forge party-usable within station radius rules; charm priced per the plan's family
- [ ] masterwrought: true everywhere EXCEPT forge and charm; all items in the sweep
- [ ] All listed suites green; ci:changed clean; new names web-verified per R15

STEP 6 - DOCS: progress.md Phase 09 row; state.md ledger (new ids, names, reagent
quantities, the resolved charm price, any new IWorld member or SimEvent); memory note
if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff
line for Phase 09 QA.

STOPPING RULES: stop and ask if the mobile_station seam cannot express a party-usable
station without server work beyond this phase's scope, if the charm price family cannot
be resolved from the shipped ladder, or if TWOHAND budget multipliers are absent from
item_budget.ts.
```
