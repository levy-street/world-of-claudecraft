# Phase 12: The Perfecting stage

### Starter Prompt
```
This is Phase 12 of the Masterwrought feature: the Perfecting stage, the bound,
fail-forward, above-raid upgrade. This is the packet's highest-risk phase: it touches
sim, world_api, net, server, and persisted item state at once, and R5 is measured
against exactly what it ships.

Model: xhigh effort. Harness: Claude Code. Worktree: ~/Documents/wocc-masterwrought
(branch feature/masterwrought). ULTRACODE: not needed for this phase.

Goal: a wearer pays 1 Maker's Ember + Sundered Essence + 1 Prismglass Setting per
attempt to walk an apex piece up a rank track to Perfected (R1), binding the piece the
moment Perfecting begins (R2), fail-forward only, with bonus stats worth exactly the
R5-safe delta, in both hosts, persisted, with a parity scenario.

WORKTREE GUARD (do this FIRST; the user runs multiple concurrent sessions): run pwd.
If you are not in /Users/fernando/Documents/wocc-masterwrought, switch this session into
it NOW with the EnterWorktree tool (path: /Users/fernando/Documents/wocc-masterwrought).
If EnterWorktree is unavailable or refuses, STOP and ask the user to relaunch Claude Code
from that directory. Phase work never runs from the main checkout at
~/Documents/world-of-claudecraft.

STEP 0 - PRE-FLIGHT (canonical Team Workflow, docs/prd/masterwrought/implementation-plan.md):
- git status clean; then SYNC RELEASE: git fetch origin, merge the newest origin/release/**
  into feature/masterwrought, run the release-merge-audit skill on the merge.
- Memory scan: MEMORY.md entries on SimContext extractions, parity scenario traps
  (teleport literal pins content), JSONB persistence back-compat, wire serialize-once,
  deferred-write re-check, the test-pin trap index.

STEP 1 - LOAD CONTEXT (Explore agent; do not read planning docs in the main loop):
- docs/prd/masterwrought/state.md (R1, R2, R5, R13; the Power placement numbers; Key
  seams: masterwork, commission boundTo, ItemInstancePayload)
- docs/prd/masterwrought/progress.md (Phase 12 row; the phase 01/04/07 ledger entries:
  cap machinery, Maker's Ember accrual, Prismglass Setting)
- src/sim/sim_context.ts, src/sim/professions/masterwork.ts (READ ONLY: locked, NOT
  modified this phase, R1), src/sim/professions/crafting.ts (the masterwork proc site
  and its single rng draw per successful craft), src/sim/professions/commission.ts
  (Maker's Bond boundTo), src/sim/types.ts (ItemInstancePayload, rolled.stats),
  src/sim/item_budget.ts + src/sim/item_level.ts (the delta math), the server sanitize
  site for item instances (grep sanitizeRiftGearInstance), src/net/online.ts item
  mirror, tests/parity/ scenario shape, tests/world_api_parity.test.ts pin shape,
  src/sim/CLAUDE.md + src/world_api/CLAUDE.md + server/CLAUDE.md.
Return: how an item instance's rolled fields flow sim -> wire -> client and how the
server sanitizes them; where commission binding writes boundTo; the proc site's draw
order; how a parity scenario is registered.

STEP 2 - EXECUTE (parallel fan-out, explicitly):
Agent 1 (sim module + tests):
- New module src/sim/professions/perfecting.ts behind SimContext; masterwork.ts and its
  locked constants stay untouched (R1). Eligibility: an apex (masterwrought-flagged)
  piece, crafter skill 125 in the craft that made it (R13), the wearer supplies the
  materials. Per-attempt consume: 1 Maker's Ember + Sundered Essence + 1 Prismglass
  Setting. A rank track up to Perfected: decide the rank/attempt counts and record them
  in state.md. Fail-forward ONLY: failure consumes materials and never harms or
  downgrades the piece (R1). The piece binds on the FIRST attempt via the Maker's Bond
  boundTo reuse (R2; base pieces stay freely tradable until then).
- Bonus stats land via rolled.stats worth exactly the delta to source 28 at epic quality
  (state.md Power placement: one to two points over the raid chest per slot, at most 2
  slots), derived from item_budget.ts formulas, never a magic number (R5).
- Masterwork-proc head start: the craft-time masterwork proc on an apex craft grants a
  head start on the track instead of a quality bump (R1), wired at the crafting.ts proc
  site WITHOUT moving or adding rng draws there.
- Interlock: phase 10 authored Lucent Infusion behind a Perfected guard; wire that guard
  to the real Perfected state and add its test arm.
- tests/perfecting.test.ts: attempt lifecycle, binding on first attempt, fail-forward
  (the piece is never harmed on failure), rank math, budget delta exactness
  (formula-derived), save/load round-trip.
Agent 2 (facet + wire + server):
- IWorld facet members for the flow (read state + a command) in the matching
  src/world_api/<domain>.ts facet, implemented in BOTH Sim and ClientWorld, with the
  tests/world_api_parity.test.ts pin updated in the same change.
- Server authority: the attempt resolves ONLY server-side; the client sends the command
  and mirrors the result. Wire fields for rank/Perfected state on item payloads;
  server-side sanitize of every new instance field (sanitizeRiftGearInstance pattern;
  boundTo and anything server-private never leave the server).
- Persistence: optional ItemInstancePayload fields with defaults so pre-phase saves load
  cleanly (JSONB back-compat).
Agent 3 (rng discipline + i18n):
- All attempt randomness through ctx.rng at ONE documented draw position; a parity
  scenario in tests/parity exercising an attempt deterministically across hosts.
- Refusal lines (not apex, skill too low, missing materials, already Perfected): sim
  emit + sim_i18n.ts matcher in the SAME change (S3 guard).
- AMENDED at the v0.38.0 sync (merge fa51741408): the release's player item lock
  (src/sim/item_lock.ts, issue 3042) broke this phase's implicit premise that held
  materials are always consumable; consumption is now refusable PER COPY. Every
  Perfecting consume arm must count sufficiency through the lock-aware family
  (countUnlockedItem / countUnlockedInSlots, the crafting.ts precedent), deny a
  lock-only shortfall with a dedicated locked reason rather than a misleading
  missing-materials line (the craft path already renders
  hudChrome.crafting.reagentLocked via craft_denial_line_view.ts), and spend copies
  through a passed selection, never the id-only newest-first walk
  (item_copy_ref.ts frozen-fallback doctrine; the pattern-learn wrong-victim fix at
  this sync is the exemplar). The refusal-lines list above gains that arm.

INVARIANTS IN PLAY: masterwork.ts untouched (R1); the crafting proc site keeps exactly
one rng draw per successful craft in the same order; every new draw via ctx.rng at the
documented position; server authority (the client NEVER resolves an attempt);
IWorld-first with the parity pin in the same change; i18n emit + matcher together; JSONB
fields optional with defaults; no shipped item id changes.

Out of scope: the orange promotion and Deed of Making (phase 13); Perfecting UI beyond
error lines (phase 14); the envelope measurement (phase 15).

STEP 3 - VALIDATION + REVIEW (matrix in state.md):
npx tsc --noEmit; npx vitest run tests/perfecting.test.ts tests/masterwrought_cap.test.ts
tests/architecture.test.ts tests/world_api_parity.test.ts tests/localization_fixes.test.ts;
the wire set: npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts
tests/bandwidth.test.ts; the parity suite (rng draw sites changed); npm run ci:changed.
Review Dispatch Matrix (implementation-plan.md): architecture-reviewer (sim),
cross-platform-sync (world_api + wire + net), privacy-security-review (server),
migration-safety (persisted instance shape), database-performance-reviewer only if a SQL
call site changed. COVERAGE prompts; apply ALL findings.

STEP 4 - COMMIT CADENCE (explicit paths, bodies, no session trailers):
- feat(sim): add the Perfecting stage behind SimContext
- feat(net): perfecting facet members, wire fields, and server sanitize
- test(sim): perfecting lifecycle, delta exactness, and the parity scenario

STEP 5 - ACCEPTANCE:
- [ ] R1: fail-forward only, materials consumed per attempt, masterwork.ts diff EMPTY
- [ ] R2: binds when Perfecting begins (first attempt) via boundTo; tradable until then
- [ ] Bonus stats exactly the delta to source 28 at epic quality, at most 2 slots (R5)
- [ ] Server resolves every attempt; sanitize covers every new field
- [ ] Parity scenario green; proc-site draw order unchanged; documented rng position
- [ ] Save/load round-trip; pre-phase saves default cleanly
- [ ] Phase 01 interlock: the cap and the R3 sub-cap still count a Perfected piece
- [ ] All listed suites green; ci:changed clean

STEP 6 - DOCS: progress.md Phase 12 row; state.md ledger (rank counts to Perfected,
facet members, wire fields, i18n keys, tests, the documented rng position); memory note
if anything surprised you.

STEP 7 - REPORT: phase status, files, validation results, reviewer verdicts, handoff
line for Phase 12 QA.

STOPPING RULES: stop and ask if the head-start hook cannot be expressed without editing
masterwork.ts or moving the proc site's rng draw; if the R5 delta cannot be derived from
item_budget.ts formulas (a magic number is a stop, not a workaround); or if the release
merge conflicts inside src/sim/professions/ or the item wire path.
```
