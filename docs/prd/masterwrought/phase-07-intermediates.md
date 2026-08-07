# Phase 07: Intermediates and the Quickening Catalyst

### Starter Prompt
```
This is Phase 07 of the Masterwrought feature: the skill-75 intermediates rung for all
ten professions and the Quickening Catalyst time gate.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: yes (content batch; drive the catalog
authoring through the ultracode Workflow fan-out).

Goal: one intermediate material per profession at skill 75 (R13), each consuming
gathered mats plus 1 Quickening Catalyst; the Catalyst is alchemy's 75 rung, tradable,
one craft per day per character, the bottom-of-chain time gate every apex piece inherits.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on cooldown/cache persistence, frozen-id goldens,
  test-pin traps, daily-reset gotchas.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (rulings R13, R15; naming registry; validation matrix;
  key seams; delivery contract)
- docs/prd/masterwrought/progress.md (Phase 07 row; phase 05/06 ledger entries: station
  decisions, the base-rung recipe rows as templates)
- src/sim/content/recipes.ts (ALL_RECIPES row shape), src/sim/professions/types.ts
  (ProfessionRecipeRecord), src/sim/professions/crafting.ts (the craft path; where a
  per-recipe daily gate can hook and where a refusal line emits),
  src/sim/professions/node_persist.ts (the node-readiness cooldown persistence scheme the
  Catalyst gate must ride), src/sim/content/professions.ts (trainer tiers,
  STATION_TYPE_BY_CRAFT), src/sim/content/profession_items.ts (material item def shapes),
  tests/recipe_economy.test.ts (the invariant shape), docs/design/professions.md (every
  material has a consumer), src/sim/CLAUDE.md.
Return: the recipe row + trainer wiring recipe, how node readiness survives logout, and
where craft refusal text emits today.

STEP 2 - EXECUTE (ultracode Workflow; fan out explicitly by vertical slice):
Resolve BEFORE fan-out: the profession-to-intermediate mapping. The registry names
Duskforged Billet, Forgefold Plating, Wyrmhide Cording, Sunspun Bolt, Prismstone
Setting, Precision Chassis, Seasoned Stock, Lucent Reagent; the Quickening Catalyst IS
alchemy's 75 rung; inscription's intermediate has no registry name yet. Author the
missing name, web-verify every new proper noun per R15, and record the full ten-row
mapping in state.md before any recipe row lands.
Slice 1 (catalyst + sim gate):
- Quickening Catalyst: alchemy recipe at skill 75, tradable item, ONE craft per day per
  character via a persisted daily-cooldown field riding the node_persist scheme
  (optional field with a default; survives logout; no new DDL). Refusal line: sim emit
  plus the sim_i18n matcher in the SAME change (S3 guard).
Slice 2 (the nine other intermediates):
- One recipe row per profession at skill 75 consuming existing gathered mats plus 1
  Quickening Catalyst; trainer wiring per the existing tier table; item defs under the
  registry names. Record the demand math in state.md (intermediates per apex piece and
  the implied catalysts per day) so phases 08/09 author against it.
Slice 3 (icons + names + tests):
- Icon-system rows, English catalog names (English only; M16 if a wordy value appears),
  wiki regen (npm run wiki:content rides pretest). Tests: a catalyst daily-gate test
  (craft succeeds, second craft same day refused, logout/load round-trip keeps the gate,
  next sim day allows) plus economy-invariant compliance for all ten rows.

INVARIANTS IN PLAY: determinism (the day boundary comes from sim time, never Date.now;
any randomness via Rng); item ids append-only against tests/shipped_item_ids.test.ts;
economy invariant green with no new exceptions; i18n emit + matcher in the same change;
R13 (intermediates at 75); R15 (every new proper noun web-verified and recorded); no
changes to masterwork.ts or the profession XP tables.

Out of scope: apex recipes themselves (phases 08/09/10); pattern items (phase 11); any
stat-bearing gear; the Perfecting stage.

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/progression.test.ts tests/recipe_economy.test.ts
tests/itemization_coverage.test.ts tests/item_level.test.ts tests/architecture.test.ts
tests/localization_fixes.test.ts tests/shipped_item_ids.test.ts plus the new catalyst
test; npm run ci:changed. Review Dispatch Matrix (implementation-plan.md):
architecture-reviewer (the daily-gate sim logic); migration-safety if the gate persists
via a characters.state JSONB shape change; cross-platform-sync if a SimEvent, wire
field, or matcher rule was added; frontend-seam-reviewer only if icon work touched
src/ui logic. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(sim): quickening catalyst with a persisted daily craft gate
- feat(content): skill-75 intermediates for all ten professions
- test(sim): pin the catalyst daily gate across logout and day rollover

STEP 5 - ACCEPTANCE:
- [ ] Ten intermediates exist, trainer-taught at 75, each consuming mats + 1 Catalyst
- [ ] Catalyst tradable; one craft per day; gate survives logout; refusal localized
- [ ] Demand math recorded in state.md (intermediates per apex piece) for phases 08/09
- [ ] Names web-verified per R15; all listed suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 07 row; state.md ledger (new ids, i18n keys, the
ten-row mapping, the demand math, the cooldown field name); memory note if anything
surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff
line for Phase 07 QA.

STOPPING RULES: stop and ask if the daily gate cannot ride the node_persist scheme
without new server DDL, if the demand math would force changes to shipped phase 05/06
rows, or if the release merge conflicts inside crafting.ts or recipes.ts.
```
