# Phase 05: Jewelcrafting base catalog

### Starter Prompt
```
This is Phase 05 of the Masterwrought feature: the jewelcrafting base catalog.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (content workflow; the rung batches run as
a Workflow after the serial station decision).

Goal: jewelcrafting exists (today it has zero recipes): the 0/25/50 rungs, station and
trainer wiring, icons, names, wiki, with every budget exactly formula-derived (R10).

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

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
  AMENDED AT PHASE 04 QA (standing obligations minted by the v0.36.0 item-art wave;
  they scale per item id, and this phase ships a whole catalog):
  (a) EVERY new item id owes, IN THE SAME CHANGE: committed opaque 128px WebP art
  (the materials used SVG-rasterized originals; ITEM_IMAGE_IDS auto-enters every
  non-weapon id, so a shipped id with no art 404s and reds tests/item_icons),
  admission to the item-art audit catalog (counts, verdict row, evidence digests,
  per the class-overhaul-additions precedent; the Phase 04 materials moved it
  822 to 825), the public/ui/items/mapping.json provenance row, the CREDITS.md
  line, AND the five non-Latin name fills (M16; Latin overlays ride the release
  fill). Budget the Workflow batches for this: the art pipeline is per-id work.
  (b) The mob portrait source manifest fingerprints the sim+render browser
  bundle, so THIS phase's content lands stale it: re-mint at phase close via
  PORTRAIT_RECEIPT render_finder_portraits then
  build_mob_portrait_source_manifest --write --receipt (outputs must stay
  byte-identical; the accepted-art digest pin moves with it).
  (c) Author every recipe's acquisition EXPLICITLY as ['trainer'] (patterns are
  phase 11; never stamp 'drop' here, it flips isRecipeKnown to must-be-learned,
  and rod recipes must never gain 'drop' per the rodFeePaid trap in the Phase 02
  ledger). Skill reqs sit ON the 0/25/50 tier boundaries (the off-step recipe
  renders divergent trainer copy, the Phase 02 obligation).
Every item budget is EXACTLY formula-derived (primaryStatBudget at the recipe-derived
ilvl); base-rung jewelry carries pure primary stats + stamina, no rating allocations
beyond the same-band vendor jewelry (R14).

INVARIANTS IN PLAY: the economy invariant (tests/recipe_economy.test.ts) must be green
with an EMPTY exception list (tune inputs, never the list); classic-era formulas only, no
invented balance numbers; data-as-code is exempt from module-first but any new LOGIC
(station machinery) is its own module; new item ids append-only against the frozen-id
golden; English-only catalog keys; wiki regenerated, never hand-edited.

Out of scope: apex jewelry (phase 09); the Prismglass Setting intermediate (phase 07);
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
