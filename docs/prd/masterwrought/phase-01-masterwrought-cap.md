# Phase 01: Masterwrought equip cap

### Starter Prompt
```
This is Phase 01 of the Masterwrought feature: the global Masterwrought equip cap.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: every future apex piece needs the counted equip family "Unique-Equipped:
Masterwrought (2)" with the one-orange sub-cap; build it now, fully tested, in both hosts.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on equipment rules, world_api parity pins, test-pin traps.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (rulings R3, R6, R16; delivery contract)
- docs/prd/masterwrought/progress.md (Phase 01 row)
- src/sim/equipment_rules.ts (whole file; it is small), src/sim/items.ts equip paths,
  src/ui/equip_drop_core.ts, src/ui/hud.ts ONLY the uniqueEquipped tooltip arm,
  src/net/online.ts equip mirror, tests/world_api_parity.test.ts pin shape,
  src/sim/CLAUDE.md + src/world_api/CLAUDE.md + src/ui/CLAUDE.md.
Return: how equip legality is evaluated today (conflict-slot flow, ignoreSlots), where
refusal text emits, which IWorld facet owns equipment reads.

STEP 2 - EXECUTE (parallel fan-out, explicitly):
Agent 1 (sim + rules + tests):
- Add ItemDef.masterwrought?: boolean (src/sim/types.ts).
- New counted-family logic in src/sim/equipment_rules.ts BESIDE isUniqueEquipped (do not
  widen the legendary predicate): masterwroughtConflictSlot(item, equipment, lookup,
  ignoreSlots) enforcing at most 2 flagged items equipped and at most 1 of them with
  effective legendary quality (instance rolled.quality counts; R3 sub-cap). A two-hander
  counts as ONE (R6). Duplicate copies of the same item are allowed inside the cap (R16).
- Wire into the sim equip path exactly where uniqueEquipConflictSlot runs; refusal emits a
  new error line (English literal at the emit site).
- tests/masterwrought_cap.test.ts: cap at 2; third flagged equip refused; sub-cap (a
  second legendary-quality flagged piece refused while a plain flagged piece still fits);
  swap into an occupied flagged slot allowed (ignoreSlots); 2H displacement counts one;
  duplicates allowed; a pre-existing save with 3 flagged items equipped loads without
  throwing and refuses only the NEXT flagged equip.
Agent 2 (client + i18n + parity):
- sim_i18n.ts matcher for the refusal line (same change as the emit; S3 guard).
- Tooltip tag t() key (English only, hudChrome domain) rendered for flagged items next to
  the existing Unique-Equipped arm; equip_drop_core.ts drag legality mirror.
- ClientWorld equip mirror honors the same rule (client-side pre-check only; the server
  stays authoritative); update tests/world_api_parity.test.ts ONLY if a facet member is
  added (prefer reusing existing equipment reads; record the decision in state.md).

INVARIANTS IN PLAY: determinism (this phase draws NO rng); IWorld-first if any new read
is needed; server authority (client pre-check never decides); i18n emit+matcher in the
same change; no changes to isUniqueEquipped or masterwork.ts.

Out of scope: any item def carrying the flag (phases 08+); Perfecting; UI beauty work
(phase 14).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/masterwrought_cap.test.ts
tests/architecture.test.ts tests/localization_fixes.test.ts tests/world_api_parity.test.ts;
npm run ci:changed. Review Dispatch Matrix (implementation-plan.md): architecture-reviewer
+ cross-platform-sync (sim + matcher + net touched); frontend-seam-reviewer if the tooltip
arm changed hud.ts. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(sim): add the Masterwrought counted equip family
- feat(ui): masterwrought tooltip tag and equip refusal line
- test(sim): pin the masterwrought cap and sub-cap edges

STEP 5 - ACCEPTANCE:
- [ ] Cap of 2 and sub-cap of 1 legendary enforced in BOTH hosts, refusal localized
- [ ] 2H counts one; duplicates allowed; over-cap legacy saves tolerated
- [ ] No change to isUniqueEquipped, masterwork.ts, or any shipped item id
- [ ] All listed suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 01 row; state.md ledger (new i18n keys, any facet
member, the flag name); memory note if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff line
for Phase 01 QA.

STOPPING RULES: stop and ask if the equip pipeline cannot express a counted family
without modifying isUniqueEquipped's contract, or if the release merge conflicts inside
equipment_rules.ts.
```
