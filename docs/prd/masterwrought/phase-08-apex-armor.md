# Phase 08: Apex armor catalogs

### Starter Prompt
```
This is Phase 08 of the Masterwrought feature: the armor-craft apex pieces, slot-audited.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (content batch; drive the catalog
authoring through the ultracode Workflow fan-out).

Goal: 9 apex armor pieces (3 per armor craft) plus the tailoring apex bag, with slot
picks decided by a coverage audit, every budget exactly formula-derived, and the apex
budget sweep test born in this phase.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on frozen-id goldens, test-pin traps, itemization
  coverage, parity-scenario content pins.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (rulings R2, R8, R12, R13, R14, R15; the power
  placement numbers; the phase 07 demand math; validation matrix)
- docs/prd/masterwrought/progress.md (Phase 08 row)
- src/sim/item_budget.ts (primaryStatBudget), src/sim/item_level.ts (the ALL_RECIPES
  bump: recipe.level 25 + epic -> ilvl 31), src/sim/content/recipes.ts (row shape),
  src/sim/content/items.ts + heroic_loot.ts + heroic_vendor.ts + the raid loot tables
  (slot coverage source data and same-band rating references), tests/shipped_item_ids.test.ts
  (golden shape), tests/itemization_coverage.test.ts, src/sim/CLAUDE.md.
Return: how epic armor rows are shaped per slot, where raid/heroic loot lists slots per
armor class, and the exact budget arithmetic for ilvl 31 epic per slot.

STEP 2 - EXECUTE (ultracode Workflow; fan out explicitly by vertical slice):
FIRST ACTION, blocking, before ANY item is authored: the SLOT COVERAGE AUDIT. Sweep the
raid and heroic loot tables plus the heroic vendor per armor class and slot, find the
weakest-covered slots for each of the three armor crafts, and WRITE the results to
state.md (closing the open-items line "slot coverage audit results (phase 08)").
Commit the audit BEFORE the first item row exists. Plan default the audit may override:
chest/legs/waist (armorcrafting), chest/shoulders/feet (leatherworking),
robe/leggings/gloves (tailoring). Final slot picks come from the audit.
Then fan out:
Slice 1: armorcrafting's 3 pieces. Slice 2: leatherworking's 3. Slice 3: tailoring's 3
plus the apex bag (best capacity in the game, NO masterwrought flag). Slice 4: the apex
budget sweep test, tests/masterwrought_budget.test.ts.
Every piece: recipe.level 25, quality epic, skillReq 100 (R13), masterwrought: true
(the phase 01 flag), acquisition per R8 (pattern drop; NOT a trainer row; patterns land
in phase 11). Reagents: the profession's intermediate per the phase 07 demand math plus
Wyrmfall Cores plus gathered mats, quantities recorded in state.md. Stats: PURE STATS
only, R14 binds HARD: no procs, no effects, no on-use anywhere; primary stat sum EQUALS
primaryStatBudget for ilvl 31 epic (chest 22 per state.md power placement); ratings are
OFF the primary budget but every allocation is pinned against the same-band raid or
heroic-vendor equivalent. Tradable (R2); disenchants to the standard 1 arcane_shard
(R12). Every new proper noun web-verified per R15 and recorded in the registry.
The sweep test: EVERY apex item authored so far has primary sum EQUAL to the formula
budget, a pinned rating allocation, and the masterwrought flag; written to grow as
phases 09/10 append.

INVARIANTS IN PLAY: R14 (pure stats, the hard bind of this phase); the state.md power
placement numbers are law; ids append-only against the shipped-id golden; English-only
catalog names; wiki regen for new player-facing content; no rng anywhere in this phase;
no changes to item_budget.ts constants or masterwork.ts.

Out of scope: weapons, jewelry, gadgets (phase 09); consumables and enchants (phase 10);
patterns and drop wiring (phase 11); Perfecting (phase 12).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/progression.test.ts tests/recipe_economy.test.ts
tests/itemization_coverage.test.ts tests/item_level.test.ts
tests/masterwrought_budget.test.ts tests/shipped_item_ids.test.ts tests/guide.test.ts;
npm run ci:changed. Review Dispatch Matrix (implementation-plan.md): this is pure data
plus tests, so architecture-reviewer ONLY if any non-data sim logic changed;
frontend-seam-reviewer only if icon work touched src/ui logic; qa-checklist when the
deliverable set is complete. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- docs(prd): record the apex armor slot coverage audit
- feat(content): apex armor catalogs for the three armor crafts
- feat(content): the tailoring apex bag
- test(content): the masterwrought budget sweep

STEP 5 - ACCEPTANCE:
- [ ] Slot audit committed to state.md BEFORE the first item commit (git history shows it)
- [ ] 9 pieces + bag; every primary sum EQUALS the formula; ratings pinned to same-band
- [ ] masterwrought: true on all 9, absent on the bag; R14 clean (zero effects); R2/R12 hold
- [ ] Reagent quantities in state.md, consistent with the phase 07 demand math
- [ ] All listed suites green; ci:changed clean; names web-verified per R15

STEP 6 - DOCS: progress.md Phase 08 row; state.md ledger (audit results, new ids, names,
reagent quantities, the sweep test); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff
line for Phase 08 QA.

STOPPING RULES: stop and ask if the audit argues for a different piece count than 9 plus
the bag (that changes the cap pool), if the budget formula forces a stat shape a slot
cannot carry, or if the release merge conflicts inside the content tables.
```
