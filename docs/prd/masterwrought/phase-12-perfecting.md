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
  Setting. A rank track up to Perfected: DERIVE the rank/attempt counts against the
  qr-12-CADENCE criterion (state.md row 129, added 2026-08-20 by the quality-review
  adoption pass): the reference endgame character (one Maker's Ember per week, no banked
  backlog, R4's accrual untouched) reaches Perfected on a FIRST piece in 4 to 6 weeks and
  fills both cap slots in 10 to 12 weeks, with a masterwork head start (R1) worth about
  one week. Record the derivation, its inputs, and the resulting counts
  in state.md; a session that pastes counts without the derivation has failed the ruling. Fail-forward ONLY: failure consumes materials and never harms or
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
- PHASE 10 CARRY-FORWARDS (amended 2026-08-14; the guard's as-built shape is in the
  state.md Phase 10 ledger):
  - The guard is the exported holdsPerfectedTarget(meta, itemId, slot?) in
    src/sim/professions/enchanting.ts reading ItemInstancePayload.perfected === true.
    Stamp the marker in the Perfecting re-mint, and in the SAME change remove the
    minting tripwire arm in tests/lucent_infusion_guard.test.ts and take the eqi
    wire-visibility decision (perfected is pinned OFF the eqi allowlist in
    tests/snapshots.test.ts; until it rides, an online player's WORN Perfected copy is
    invisible to the picker while the sim accepts it; the bagged arm rides the
    wholesale inv mirror and needs nothing). AMENDED at the phase 10 QA (2026-08-16):
    the choice is NOT the two-way "widen eqi or accept bags-only" the phase recorded.
    A third option exists and is the recommended path: the owner's picker worn arm can
    read IWorld.equipmentInstances, the SELF mirror (server/game.ts ships
    meta.equipmentInstance WHOLE under `einst`; ClientWorld mirrors it as
    equipmentInstances; the offline Sim getter returns the same map; char_window.ts
    already reads it), instead of the trimmed PEER mirror
    (world.entities.get(world.playerId)?.equippedInstances, fed by the eqi allowlist)
    it reads today. That switch was NOT made at the QA because the peer read feeds
    wornEnchantTargets' wireTrimmed pin cluster; making it here moves that cluster
    deliberately, and it leaves the eqi decision about INSPECTING viewers only.
    The picker already paints a requiresPerfected row inert with the notPerfected
    line until a candidate copy carries the marker (EnchantPickRow.perfectedMet, the
    phase 10 QA), so the noTargets copy is unreachable for the Infusion; when minting
    lands, the row simply becomes actionable.
  - Narrow the guard's bagged arm from the HOLDING (any copy of the id) to the exact
    copy the apply consumes (the item_copy_ref discipline the disenchant and replace
    paths follow), or one Perfected copy licenses spending an ordinary one. The
    2026-08-14 v0.38.0 sync shipped the exact helper for this:
    item_copy_ref.newestMatchingSlot, the non-consuming twin of
    consumeNewestInventoryUnit; peek through it (or selectedInventorySlot), never a
    bespoke walk, so the guard stays locked to the real selection ctx.removeItem
    makes.
  - Re-decide the Infusion's slot and stat: chest { sta: 13 } is PROVISIONAL (this
    phase's file names no target), and it currently shares the chest slot with
    enchant_chest_lucent_stamina; the universal refusal makes moving it free until
    minting begins.
  - The not_perfected-before-wrong_slot deny order is deliberate and pinned (the
    refusal is slot-stable while the slot is provisional); it becomes player-visible
    when the Infusion goes live, so revisit the deny copy then.
  - Dispatch the migration-safety reviewer in the phase that first WRITES perfected
    to characters.state (phase 10 verified the round-trip is safe by construction:
    cloneItemInstancePayload is a field-agnostic spread and the instance load bound
    is drop-only, so the marker survives an older binary; the reviewer pass still
    belongs beside the minting and the wire decision).
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

### Farming arm (amended 2026-08-20)

Phase 11b absorbed `feature/farming-plan` into this packet: one branch, one PR, five
gathering professions and ten crafts shipping as one system. The prompt above is not
retracted and not rewritten. This section is part of it. Read it after STEP 0 and fold
every item into the matching step.

**STEP 0 additions.**
- DECISION 4 (monolith ceiling policy) IS SETTLED (2026-08-20, the full delegation; rows
  11b-D-4, 11d-D-4 and 11d-U6-FIFTH in state.md's "Decisions closed 2026-08-20"). Nothing is
  confirmed here. READ its landed outcome from the 11d ledger and execute against it: 11d
  took four recorded raises at the exact merged counts, each with a ledger row naming this
  merge, both parent pins, and the reason. A disagreement between the ledger and this file is
  doc drift to fix before any edit, never a licence to pick. Merged
  `src/sim/sim.ts` measures 12340 against parent pins of 12650 (masterwrought) and 12232
  (farming). Phase 12 is the FIRST phase to add sim lines post-merge, so it inherits
  11d's discipline verbatim: extraction first, and the merged literal in
  `tests/monolith_budget.test.ts` is never raised to make room for this phase's code.
- Memory scan gains: the JSONB blob-size and TOAST notes, and farming's draw-count
  contract (draws at plant, draws at harvest, ZERO on denial, expiry, login, and tick).

**STEP 1 additions (Explore agent).**
- `docs/prd/masterwrought/farming/state.md`, the farming design authority and this
  packet's open-item collection point, for the `characters.state` measurement and the
  farming parity contract.
- `src/sim/item_lock.ts`: read the MERGED export surface. Farming's F14 made
  `countRawInSlots` a shared export out of that file and turned `Sim.countItem` into a
  thin delegate over it, and lowered `sim.ts`'s ceiling on that basis.
- `src/sim/professions/farming.ts` and `src/world_api/farming.ts` for the second writer
  into the same persisted blob, and `tests/parity/golden/farming_session.json` for how
  the farming parity scenario is registered.
Return additionally: the merged `item_lock.ts` helper shapes, where `farmPlots` is
written to and read from `characters.state`, and the merged `tests/parity` scenario list.

**STEP 2 additions.**
- Agent 1, item lock: the AMENDED v0.38.0 note above names `countUnlockedItem` /
  `countUnlockedInSlots`. On the merged tree, count sufficiency through the merged helper
  family built on farming's shared `countRawInSlots` export, not the shapes that note
  names. Same doctrine, same dedicated locked-reason denial line, merged helper.
- Agent 2, persistence: Perfecting writes its new `ItemInstancePayload` fields into the
  SAME `characters.state` JSONB blob farming already writes `farmPlots` into. Farming
  measured that blob first hand (PG16 on :5433, 2026-08-19): empty character 1499 B
  compressed / 2059 B raw, 23 beds planted 3261 B / 7831 B, about 251 B raw per plot,
  rows past 2 KB TOAST, WAL plus 1.5 to 3 KB per 30 s autosave cycle per fully planted
  character. Phase 12 owes a MERGED size bound: state the worst case (a fully planted
  character carrying a full set of Perfecting instance fields) derived from those
  baselines and this phase's per-field cost, never asserted and never eyeballed.
- Agent 2, reverse compatibility (new, and covered by no research lane): state what an
  OLDER server does with a blob carrying BOTH writers. That is exactly the shape a revert
  of this PR produces on a live realm, and farming's zero-default omission only protects
  characters that never planted. The forward direction (pre-phase saves load clean) is
  already in the acceptance list above; the backward direction joins it.

**STEP 3 additions.**
- The `database-performance-reviewer` trigger CHANGES. It is no longer "only if a SQL
  call site changed": the merged blob grows on both packets with no SQL call site change,
  and farming's measured TOAST crossing is the baseline the Perfecting fields ride on top
  of. Dispatch it on the BLOB. `migration-safety` now covers two writers into one JSONB
  document, in both directions.
- Suites gain the merged parity set: run the farming parity scenario alongside the new
  Perfecting one. Re-derive the `tests/world_api_parity.test.ts` pins against the values
  11d predicted and then observed on the merged tree (332 total / 88 data / 244 method;
  11e is content-only and moves none of the three), and predict this phase's facet delta
  before running it, never after.

**STEP 5 additions (acceptance).**
- [ ] Merged `characters.state` size bound stated WITH its arithmetic against farming's
      measured baseline
- [ ] Revert direction recorded: an older server's behavior on a both-writers blob
- [ ] Item-lock sufficiency counted through the merged `countRawInSlots` family
- [ ] `farming_session` golden unmoved from the merged value 11d recorded, and farming's
      draw-count contract intact
- [ ] `sim.ts` ceiling re-derived extraction-first, never raised for this phase

**What the QA twin additionally owes.** One determinism arm: the farming draw-count
contract still holds and `farming_session` did not move. Its authority-and-wire agent
covers the merged `fplot` delta key and the merged command-schema counts; its persistence
arm reads the blob size and the TOAST crossing; `migration-safety` covers two writers
into one blob in both directions.

**Stopping rule, added.** Stop and ask if the merged blob bound cannot be derived from
farming's recorded measurement without a fresh Postgres measurement run this phase has no
rig for.
