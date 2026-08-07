# Phase 11: Pattern drops and vendors

### Starter Prompt
```
This is Phase 11 of the Masterwrought feature: every apex recipe reaches players
through the three pillars (R8).

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: a pattern item for every apex recipe (the phase 02 machinery), raid and rift
pattern drops as append-only loot entries, the Heroic Quartermaster pattern stock as
the day-one deterministic catch-up valve, and market browse/search coverage for
patterns and the new materials.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on loot draw order, parity goldens, market surfaces,
  test-pin traps.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (rulings R8, R9; the phase 02 pattern-kind decision;
  the full apex recipe ledger from phases 08/09/10; validation matrix)
- docs/prd/masterwrought/progress.md (Phase 11 row)
- The phase 02 pattern machinery (teachesRecipeId defs and the learn-on-use flow),
  src/sim/loot/loot_roll.ts (rollGroup rules), the raid loot tables and
  src/sim/rift/loot_pools.ts (where drop entries append), src/sim/content/heroic_vendor.ts
  (the Heroic Quartermaster stock + heroic_mark pricing), the market query/filter seam:
  implementation-plan.md names market_query.ts, but on this branch the surface is
  src/sim/market.ts + src/ui/market_filters.ts + src/world_api/market.ts (verify where
  category/search logic lives and record the actual seam in state.md),
  tests/parity/ (scenario + golden shape), src/sim/CLAUDE.md.
Return: how a loot entry appends without disturbing existing draws, the quartermaster
row shape, where market categories are defined and filtered.

STEP 2 - EXECUTE (parallel fan-out, explicitly):
Agent 1 (patterns + loot): a pattern item for EVERY apex recipe from phases 08/09/10
via the phase 02 machinery; raid and rift patterns wired into the loot tables as
rollGroup-safe APPEND-ONLY entries (never insert mid-table, never reorder; existing
draw order is a contract); tradable, bind on learn (R8). Rift entries ride the existing
rift reward flow; R9's daily first-clear gate stays a CORES-ONLY rule: patterns are
drop-rate-gated, never daily-gated, and this phase adds NO new gate. Record every drop
rate in state.md.
Agent 2 (quartermaster + valve): heroic five-man patterns sold on the Heroic
Quartermaster for Heroic Marks (R8: the deterministic channel); prices recorded in
state.md. Write the drop-rate documentation and the catch-up valve note (the marks
vendor IS the valve, live from day one) into the state.md ledger.
Agent 3 (market surfaces): category/search handling so patterns and the new materials
(Wyrmfall Core, the intermediates) are findable in the market browse ui; extend the
verified seam from Step 1; if an IWorld facet member changes, implement in BOTH hosts
and update tests/world_api_parity.test.ts in the same change.
Agent 4 (tests): a referential test: every apex pattern teaches an existing recipe AND
every apex recipe is reachable through exactly the channels R8 assigns it (raid/rift
drop or quartermaster row), no orphan in either direction, no pattern unobtainable
(every hosting boss, rift pool, and vendor row exists in live content). Draw-order
proof: the parity suite green and no loot golden changed except by append.

INVARIANTS IN PLAY: R8 (three pillars, no fourth channel); R9 (cores-only daily gate;
do not extend it to patterns); loot determinism (append-only entries, rollGroup rules,
draw order is a contract); server authority for vendor purchases; IWorld-first for any
new market read with the parity pin updated in the same change; i18n emit + matcher in
the same change for any new player text; ids append-only.

Out of scope: new recipes or items beyond pattern wrappers; drop-rate tuning beyond the
recorded initial rates (phase 15 measures); Perfecting (phase 12); market UI restyling
(phase 14).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/progression.test.ts tests/recipe_economy.test.ts
tests/itemization_coverage.test.ts tests/item_level.test.ts tests/architecture.test.ts
tests/localization_fixes.test.ts tests/shipped_item_ids.test.ts plus the new
referential test and the parity suite; tests/snapshots.test.ts tests/env_protocol.test.ts
tests/bandwidth.test.ts if any wire surface changed; npm run ci:changed. Review
Dispatch Matrix (implementation-plan.md): architecture-reviewer (loot and vendor sim
logic); privacy-security-review (server surface touched); database-performance-reviewer
only if a SQL or market query call site changed; cross-platform-sync (facet/wire/matcher
drift); frontend-seam-reviewer (the market browse ui); qa-checklist when the
deliverable set is complete. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(content): apex pattern items and append-only loot entries
- feat(content): heroic quartermaster pattern stock, the day-one valve
- feat(ui): market browse categories for patterns and materials
- test(content): pattern referential and loot draw-order pins

STEP 5 - ACCEPTANCE:
- [ ] Every apex recipe reachable per R8; referential test green both directions
- [ ] Loot entries append-only; parity suite green; no golden reordered
- [ ] Quartermaster prices and all drop rates recorded in state.md; valve note written
- [ ] Patterns and new materials findable in market browse in BOTH hosts
- [ ] All listed suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 11 row; state.md ledger (pattern ids, rates, prices,
the verified market seam, any facet member); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff
line for Phase 11 QA.

STOPPING RULES: stop and ask if any loot table cannot take an append-only entry without
perturbing existing rollGroup draw order, or if any apex recipe's reachability would
need a channel beyond the three R8 pillars (that is a maintainer re-litigation, not a
phase decision).
```
