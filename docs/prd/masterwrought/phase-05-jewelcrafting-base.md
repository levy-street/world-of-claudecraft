# Phase 05: Jewelcrafting base catalog

### Starter Prompt
```
This is Phase 05 of the Masterwrought feature: the jewelcrafting base catalog.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (content workflow; the rung batches run as
a Workflow after the serial station decision).

Goal: jewelcrafting exists (today it has zero recipes): the 0/25/50 rungs, station and
trainer wiring, icons, names, wiki, with every budget exactly formula-derived (R10).

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on content authoring, economy-invariant pins, workflow
  gotchas (workflow agents mutate the real worktree), test-pin traps.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (rulings R10, R13, R14, R15; the power placement
  numbers; the open station/training decision this phase must record)
- docs/prd/masterwrought/progress.md (Phase 05 row)
- src/sim/content/recipes.ts (an existing profession's 0/25/50 rung shape to mirror),
  src/sim/content/professions.ts (STATION_TYPE_BY_CRAFT, the trainer tier table + fees),
  src/sim/item_budget.ts (primaryStatBudget) + src/sim/item_level.ts (recipe-derived
  ilvl), tests/recipe_economy.test.ts (the invariant AND its exception list),
  tests/itemization_coverage.test.ts, the existing ore / salvage-gem / vendor-reagent
  item ids jewelcrafting will consume, the icon-system row shape in src/ui, the items
  i18n catalog domain, the wiki regen path, src/sim/CLAUDE.md + src/ui/CLAUDE.md.
Return: the recipe record shape and a model profession's rung layout, how budgets derive
from recipe level + quality, what the economy invariant checks and what its exception
list contains today, which ores/gems/flux items exist, trainer fee rows per tier.

STEP 2 - EXECUTE (ultracode Workflow):
Serial first: the station/training decision (a new station type vs explicit stationType
on each recipe; jewelcrafting has NO station today): decide, record it in state.md with
rationale, and wire it so every batch row agrees. Then the content batches:
- Batch A (skill 0 rung): common rings and necklaces consuming existing ores,
  gems-from-salvage, and vendor flux (if no vendor flux reagent exists, add the vendor
  row and record it).
- Batch B (skill 25 rung): uncommon rings and necklaces, same input classes.
- Batch C (skill 50 rung): rare rings and necklaces.
- Batch D (wiring): trainer rows + fees per the existing tier table; icon-system rows;
  English names in the items catalog (each name web-verified per R15 and recorded in the
  state.md registry); wiki regen.
Every item budget is EXACTLY formula-derived (primaryStatBudget at the recipe-derived
ilvl); base-rung jewelry carries pure primary stats + stamina, no rating allocations
beyond the same-band vendor jewelry (R14).

INVARIANTS IN PLAY: the economy invariant (tests/recipe_economy.test.ts) must be green
with an EMPTY exception list (tune inputs, never the list); classic-era formulas only, no
invented balance numbers; data-as-code is exempt from module-first but any new LOGIC
(station machinery) is its own module; new item ids append-only against the frozen-id
golden; English-only catalog keys; wiki regenerated, never hand-edited.

Out of scope: apex jewelry (phase 09); the Prismstone Setting intermediate (phase 07);
anything above skill 50; the inscription station decision (phase 06 records its own).

STEP 3 - VALIDATION + REVIEW (matrix in state.md, content-only row):
npx tsc --noEmit; npx vitest run tests/progression.test.ts tests/recipe_economy.test.ts
tests/itemization_coverage.test.ts tests/item_level.test.ts tests/shipped_item_ids.test.ts;
npm run wiki:content then tests/guide.test.ts; npm run ci:changed. Review Dispatch Matrix
(implementation-plan.md): frontend-seam-reviewer (icon/catalog surface);
architecture-reviewer only if sim LOGIC (station machinery) changed beyond data.
COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(content): jewelcrafting base catalog, rungs 0 to 50
- feat(content): jewelcrafting station and trainer wiring
- feat(ui): jewelcrafting icons and item names

STEP 5 - ACCEPTANCE:
- [ ] 0/25/50 rungs of rings and necklaces (common/uncommon/rare) consuming existing
      ores, salvage gems, and vendor flux
- [ ] Every budget exactly formula-derived; recipe_economy green with an EMPTY exception
      list; no rating allocations beyond same-band vendor jewelry (R14)
- [ ] Station/training decision recorded in state.md; trainer rows + fees per the tier
      table
- [ ] Icons, web-verified English names (registry updated), wiki regenerated; listed
      suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 05 row; state.md ledger (station decision, new item
ids, i18n keys, name verifications, new tests); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff line
for Phase 05 QA.

STOPPING RULES: stop and ask if the economy invariant cannot pass without an
exception-list entry, or if the existing ore/gem/flux supply cannot feed three rungs
without inventing new GATHERED materials (a new gathered material is a design decision).
```
