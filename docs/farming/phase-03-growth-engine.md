# Phase 3: The growth engine

This phase makes farming work: the plantCrop and harvestCrop command bodies in the
src/sim/professions/farming.ts driver behind SimContext, the growth script pre-rolled
in one contiguous rng block at plant time, wall-clock stage deadlines through
ctx.lockoutNowMs, harvest-lives yield resolution, the farming gain schedule, the
updateFarming tick skeleton, a stated and pinned draw-count contract, and a
farming_session parity scenario that drives a real plant-grow-harvest session. The
design authority is `docs/farming/state.md` (D3 through D7, the tick and hook points,
the determinism contract).

Live-surface note (binding): dormant online. No seeds are obtainable by players, so no
player can reach plant or harvest after this phase merges. The engine is fully
testable end to end via /dev farm cheats behind ALLOW_DEV_COMMANDS (dev only).

### Starter Prompt

```
This is Phase 3 of the Farming feature: "The growth engine".
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: plant, grow, and harvest work deterministically with a stated, pinned draw
contract and a parity scenario that drives a real farming session.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Never touch the
  main checkout. Use git -C /home/fernandoramirez/Documents/woc-farming-plan for every
  git command (the Bash cwd drifts).
- git status must be clean. If it is not, stop and surface it.
- AMENDED per D22 (executed 2026-08-08 this way): git fetch origin --prune, check
  out the LOCAL feature/farming-plan, and cut fix/farming-phase-03-growth-engine
  off it. Re-resolve the NEWEST origin/release/** tip (sort -V, last row); if it
  is newer than the last absorbed tip, merge it into the phase branch FIRST
  (regenerate generated i18n bundles on conflict), run the release-merge-audit
  skill, and RE-RUN tests/world_api_parity.test.ts and tests/snapshots.test.ts on
  the merged HEAD (identical count-pin bumps on both sides auto-merge to a wrong
  total with no textual conflict). Record the phase-start commit hash for the
  STEP 3 diff. (As executed: the tip was 81804a179e, already absorbed, so no
  merge was needed and the phase started at 2cac388c91.)
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  these phase-relevant topics: frozen-clock-rig-hangs-vitest (an injected clock that
  never advances hangs self-re-arming waits), mutation-checks-commit-first,
  early-exit-pins-need-work-remaining, joint-coverage-masks-deleted-sites,
  big-diff-reviewer-turn-budgets, node25-breaks-jsdom-gate,
  worktree-cwd-drift-misroutes-git.

STEP 1 - LOAD CONTEXT
Spawn ONE Explore agent (breadth: very thorough) to read and summarize:
- docs/farming/state.md (all of it, especially D3 through D7, the tick and hook
  points, and the seam reference) and docs/farming/progress.md (the Phase 1 and
  Phase 2 Notes, including the final PlotState shape).
- This phase file, docs/farming/phase-03-growth-engine.md.
- The source surface for this phase: the fishing driver module under
  src/sim/professions/ (the command-body gate order, the hidden-bite-delay pre-roll
  template, the gain schedule shape; locate by the fishing exports); the SimContext
  seam src/sim/sim_context.ts (ctx.rng, ctx.lockoutNowMs, ctx.applyAura is NOT needed
  this phase); the shared grant queue exporting queueGatheringGrant and
  drainGatheringGrants (locate by symbol); the cast machinery: isNonSpellCast and the
  four id-discriminating sites (completion routing, castingReadout, castBarState, the
  hud castDisplayName; locate each by symbol); one existing command chain end to end
  (sim method, IWorld facet member, ClientWorld implementation, server dispatch, the
  command_facets pins and tests/world_api_parity.test.ts blocks); the /dev command
  registration pattern behind ALLOW_DEV_COMMANDS; the parity scenario authoring
  pattern under tests/parity (how a scenario drives commands and time and how a
  golden is minted); the SimEvent emit pattern plus the S3 matcher rules in
  src/ui/sim_i18n.ts and tests/localization_fixes.test.ts; the minimal ItemDef shape
  for an ordinary item; canGatherTier and the wield gate (locate by symbol);
  src/sim/content/farm_patches.ts, src/sim/professions/farming_zones.ts, and
  src/world_api/farming.ts as Phase 2 left them; Sim.tick's profession block
  (updateProfNudges and the deedsMod.updateDeeds call it precedes).
- CLAUDE.md files: the root CLAUDE.md, src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md,
  src/ui/CLAUDE.md, src/world_api/CLAUDE.md, server/CLAUDE.md.
The orchestrator never reads planning docs or coordinator monoliths directly; it works
from this summary. The summary MUST return: (1) the fishing command body's gate order
and pre-roll block as the template to scale up; (2) the exact ctx.lockoutNowMs
semantics and how raidLockouts consumes it; (3) the isNonSpellCast extension recipe
and the four id-discriminating sites with what each decides; (4) the full wiring of
one existing command chain including every pin file; (5) the /dev registration
pattern; (6) the parity scenario recipe (files to add, how the golden is minted, how
time advances in a scenario); (7) the SimEvent-to-matcher recipe the S3 guard
enforces; (8) the PlotState shape and hidden-slot names Phase 2 shipped; (9) the tick
append point between updateProfNudges and updateDeeds; (10) the CLAUDE.md constraints
that bind this phase; (11) anything in state.md or progress.md that contradicts this
brief.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Before fan-out, the orchestrator locks the shared interface in the agent briefs: the
command signatures, the typed deny result names, the SimEvent ids, the item ids
(vale_wheat_seed, vale_wheat, fine_vale_wheat, withered_husks), and
FARMING_CAST_ID, so the slices stay
file-disjoint. Then request fan-out explicitly: spawn the three agents below in
parallel, give each ONLY the Explore summary plus its own slice brief, and never put a
teammate in plan mode. Each agent owns its vertical slice including its tests. Merge
slices if one turns out trivial; if integration friction appears, serialize B after A.

Agent A, the sim driver and its suite:
- src/sim/professions/farming.ts behind the SimContext seam, never a method cluster
  on sim.ts:
  - plantCrop with gates in this STATED order, checked top to bottom: alive, range to
    a bed, bed free for this player, farming skill at or above the crop tier
    threshold, seed in bags, hoe of the required tier via canGatherTier plus the
    wield gate. Every deny path returns a typed deny result and draws ZERO rng.
  - Seed consumption on success.
  - The growth script pre-rolled in ONE contiguous ctx.rng block: the per-stage
    survival outcomes per D6 (base ramp roughly 85 percent at the gate to 100 percent
    at the band top, one full band above the threshold always survives) and the yield
    seed per D7. Decide in-phase, state, and document: the stage count and the exact
    draw layout.
  - ready-at set from the crop duration via ctx.lockoutNowMs (epoch-ms, the
    raidLockouts idiom; growth continues while logged out).
  - A short plant cast under a new FARMING_CAST_ID that extends isNonSpellCast PLUS
    the four id-discriminating sites audited and updated: completion routing,
    castingReadout, castBarState, and the hud castDisplayName.
- harvestCrop: gates alive, range, my plot, ready or withered. A withered plot grants
  withered_husks. A ready plot resolves the harvest-lives yield per D7 (a guaranteed
  floor of picks, base 3; each pick rolls a skill-scaled chance to not consume a
  life) and grants produce. XP flows through the shared queueGatheringGrant with a
  farming-owned FARMING_GAIN_SCHEDULE (the fishing pattern; the drain runs earlier in
  the tick, so an end-of-tick grant lands next tick: expected, documented).
- Minimal item defs so the phase is testable end to end: vale_wheat_seed, vale_wheat,
  the fine_vale_wheat twin with its MATERIAL_GRADES row, and withered_husks, per the
  D11 sanctioned same-phase-consumer exception (consumers explicitly deferred: husks
  to the Phase 4 convertHusks command, produce to the Phase 6 dishes), with an
  explicit comment that Phase 5 completes the ladder and may adjust values.
- The draw-count contract STATED in a comment block at the top of farming.ts AND
  PINNED in the suite: the exact number of draws at plant, the exact number at
  harvest, zero on every deny path, zero at expiry, zero at login, zero in the tick.
  Decide in-phase the exact plant and harvest counts (harvest draws may be zero if
  yield derives entirely from the pre-rolled yield seed; decide, state, document).
- The updateFarming(ctx) skeleton APPENDED in Sim.tick after updateProfNudges(this.ctx)
  and before deedsMod.updateDeeds(this.ctx): append, never reorder (the shared rng
  stream makes reordering fork every golden). It draws no rng, allocates nothing per
  tick in the hot path, runs behind an internal 1 Hz guard (ctx.tickCount % 20), and
  carries a lap marker comment: consumed by Phase 8 (ready notices).
- Typed deny results and id-carrying, text-free SimEvents for plant, harvest, wither
  payout, and every deny worth surfacing.
- tests/professions_farming.test.ts covering: the full lifecycle on real ticks with
  an injected ADVANCEABLE lockoutNowMs clock (an injected clock that never advances
  hangs self-re-arming waits: ALWAYS advance it); the survival boundaries (at-gate,
  band-top, and one-band-above always survives); the draw-count pins (count draws
  through a counting rng wrapper on every path: plant, harvest, every deny arm,
  expiry, login, tick); a same-seed determinism pin; a mid-growth save-then-load
  round trip; every deny arm asserted individually; and the anti-chore pin (a
  harvest N hours late yields exactly what an on-time harvest yields).

Agent B, the command chain and dev cheats:
- src/world_api/farming.ts gains the plantCrop and harvestCrop command members beside
  the Phase 2 reads; implemented in BOTH Sim and ClientWorld in the same change;
  server dispatch added; the command_facets pins and the tests/world_api_parity.test.ts
  facet blocks updated in the same change.
- Server authority: the server validates every id server-side (bed id, crop id
  against content, ownership); no wire command ingests a client-supplied item
  payload; outcomes resolve only in the sim on the server.
- /dev farm cheats behind ALLOW_DEV_COMMANDS following the existing /dev registration
  pattern: at minimum grow-now, which sets ready-at to now (it writes state and draws
  NOTHING). Never reachable in production.

Agent C, client rows and the parity scenario:
- Client catalog rows (English only, the matching src/ui/i18n.catalog/ module) for
  every new SimEvent and deny result, plus S3 matcher coverage in the same change;
  npx vitest run tests/localization_fixes.test.ts must go green.
- The farming_session parity scenario plus its golden: drive plant, time advance, and
  harvest in a real session (fishing's documented scenario gap is not inherited).
  Author it in the scenario pattern the Explore summary reports; the new golden mints
  in this phase's tree and no other golden moves.

INVARIANTS THIS PHASE MUST KEEP
- All of D4, stated literally: ALL randomness draws at player-action moments through
  ctx.rng; every draw this phase adds happens inside the plantCrop or harvestCrop
  command body; the full growth script is pre-rolled in ONE contiguous ctx.rng block
  at plant time; there are ZERO draws at timer expiry, ZERO in the tick sweep, ZERO
  at login, and ZERO on every deny path. The draw-count contract is stated and
  pinned.
- Server authority: the client never decides an outcome; the hidden outcome slots and
  the yield seed never cross the wire (the Phase 2 negative pin must still pass).
- The tick rule: updateFarming APPENDS after updateProfNudges and before updateDeeds
  and is never reordered.
- Sim purity in every touched sim file: zero DOM/browser/Three imports, no imports
  from render/ui/game/net, no Math.random, Date.now, or performance.now; wall clock
  only through ctx.lockoutNowMs.
- The anti-chore thesis: nothing rots, no decay after ready, no third required visit;
  a late harvest costs only opportunity.
- Every player-visible outcome surfaces as an id-carrying, text-free SimEvent with a
  client catalog row and S3 matcher coverage in the SAME change.
- Never set ALLOW_DEV_COMMANDS=1 outside dev.
- All work happens in ~/Documents/woc-farming-plan; every commit uses explicit paths,
  never git add -A.

Out of scope (do NOT do in this phase):
- No compost, no farmer's watch, no growth tonic: the knob slots stay default off
  (Phase 4).
- No crops beyond vale_wheat: the other seven crops, their fine twins, and the hoe
  ladder are Phase 5 (the fine_vale_wheat twin lands here per the D11 exception).
- No NPCs, no vendors, no quests, no seed faucets of any kind (seeds stay
  unobtainable online).
- No ready notices, no UI, no render, no map pins (Phases 7 and 8).
- No deeds, no rare event (Phase 10).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order, and record each result:
- npx tsc --noEmit
- npx vitest run tests/professions_farming.test.ts
- npx vitest run tests/architecture.test.ts
- npx vitest run tests/sim_context.test.ts if the SimContext seam moved (a pure
  per-tick driver needs NO new callback, the updateCommissionOrders precedent; if you
  did add one, it touches exactly the five sites plus the pinned CALLBACK_KEYS list
  and every suite that hand-builds a fake host, per state.md).
- npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts
- npx vitest run tests/localization_fixes.test.ts
- npx vitest run tests/recipe_economy.test.ts
- npx vitest run tests/parity: the farming_session scenario green AND no other golden
  moved. Any pre-existing golden moving means the shared rng stream or tick order
  changed: STOP.
- npm run ci:changed (fix findings with a SCOPED npx @biomejs/biome check --write
  <file>, never whole-tree)
- node scripts/gate_select.mjs
Then run git diff --name-only <phase-start-commit>..HEAD and dispatch ONLY the Review
Dispatch Matrix rows in docs/farming/implementation-plan.md that match the diff.
Expected matches for this phase: architecture-reviewer (CRITICAL this phase: rng draw
order, the contiguous pre-roll block, tick-phase order, the SimContext seam),
cross-platform-sync (facet, commands, SimEvents, matchers), privacy-security-review
(the server dispatch and dev-command gating were touched), frontend-seam-reviewer
(the i18n catalog rows and hud event arms this phase touches match its matrix row),
then qa-checklist once the deliverable set is complete. Every review agent gets: a
hard 30-tool-call budget,
report-first instructions, and the coverage instruction "report every issue including
low-severity and uncertain ones; ranking happens later". If an agent truncates or
stalls, resume it with exactly: "Stop reading more files. Output the full report now
based on what you have already seen. No more tool calls. Format: BLOCKING /
SHOULD-FIX / NICE-TO-HAVE / VERDICT." No commit while a BLOCKING stands.

STEP 4 - COMMIT CADENCE
Five Conventional Commits, each with a scope and a body (what changed and why),
explicit paths only, never git add -A, no session links or Claude attribution:
1. feat(professions): the farming growth engine (driver module, plant and harvest
   bodies, growth script, gain schedule, updateFarming skeleton, deny results,
   SimEvents, minimal items, FARMING_CAST_ID).
2. feat(net): the command chain (facet members, ClientWorld, server dispatch, the
   command_facets and parity pins) and the /dev farm cheats.
3. feat(ui): the SimEvent catalog rows and S3 matcher coverage.
4. test(professions): the lifecycle suite plus the farming_session parity scenario
   and its golden.
5. docs(farming): progress and state updates.
AMENDED per D22: when every step is done and no BLOCKING stands, merge the phase
branch --no-ff into feature/farming-plan and delete it; never push, never open a
PR. The would-be PR body is recorded in the progress.md Phase 3 Notes. (Commit 2
as executed also carries the character-blob size signal and the SIM_LAP_PHASES
registration; commit 4 also carries the census-suite absorptions.)

STEP 5 - ACCEPTANCE CRITERIA
- [ ] plantCrop enforces the gates in the stated order (alive, range, bed free for
      this player, skill threshold, seed in bags); every deny arm is tested
      individually and draws zero. AMENDED, deviation (p) in state.md: the hoe-tier
      and wield gates are DEFERRED to Phase 5, verified not assumed (farming
      registers no gatherTool, so canGatherTier would refuse every plant, and the
      R22 banner forbids the bare-hands-floored scan for access decisions).
- [ ] Planting consumes the seed and pre-rolls the full growth script in ONE
      contiguous ctx.rng block (per-stage survival per D6, the yield seed per D7);
      ready-at derives from the crop duration via ctx.lockoutNowMs.
- [ ] The plant cast runs under FARMING_CAST_ID; isNonSpellCast is extended; all four
      id-discriminating sites are audited and correct: completion routing,
      castingReadout, castBarState, hud castDisplayName.
- [ ] harvestCrop: withered grants withered_husks; ready resolves the harvest-lives
      yield with the skill-scaled save chance and grants produce; XP flows through
      queueGatheringGrant with FARMING_GAIN_SCHEDULE.
- [ ] The draw-count contract is stated in farming.ts and pinned in the suite: exact
      draws at plant, exact draws at harvest, zero on every deny path, zero at
      expiry, zero at login, zero in the tick.
- [ ] updateFarming(ctx) is appended in Sim.tick after updateProfNudges and before
      updateDeeds, draws no rng, runs behind an internal 1 Hz guard, and carries the
      Phase 8 lap marker.
- [ ] Deny results are typed; SimEvents are id-carrying and text-free; client catalog
      rows and S3 matcher coverage exist; tests/localization_fixes.test.ts green.
- [ ] The command chain is wired in all four parts (sim method, IWorldFarming member,
      ClientWorld implementation, server dispatch) with command_facets and
      tests/world_api_parity.test.ts pins green.
- [ ] The /dev farm cheats sit behind ALLOW_DEV_COMMANDS; grow-now writes state and
      draws nothing.
- [ ] tests/professions_farming.test.ts is green: lifecycle on real ticks with an
      advanceable injected clock, survival boundaries (at-gate, band-top,
      one-band-above always survives), the draw-count pins, a same-seed determinism
      pin, a mid-growth save-then-load round trip, every deny arm, and the anti-chore
      pin (a late harvest yields exactly an on-time harvest).
- [ ] The farming_session parity scenario and its golden are green, and no other
      golden moved.
- [ ] The Phase 2 negative wire-leak pin still passes with the hidden slots now
      filled by real plants.
- [ ] The proposed tuning constants (the vale_wheat duration inside the D5 tier 1
      band, the gain schedule, the save-chance endpoints, the plant cast length) are
      stated in the PR body and flagged for the maintainer per state.md's OPEN items.

STEP 6 - DOC UPDATES + MEMORY
- docs/farming/progress.md: flip the Phase 3 row to done with dates, copy the STEP 5
  acceptance list here with its check states, add a Notes block including the decided
  draw counts, stage count, and tuning constants.
- docs/farming/state.md: append to the per-phase ledgers (new IWorld members:
  plantCrop, harvestCrop; new SimEvents; new items: vale_wheat_seed, vale_wheat,
  fine_vale_wheat, withered_husks; new i18n keys and matcher rows), and record the
  exact /dev farm cheat names in the "Dev command surface" ledger row (Phases 7 and
  8 depend on them). Any deviation decided in-phase
  gets a "Locked deviations" line AND gets swept into
  docs/farming/phase-03-growth-engine.md and docs/farming/phase-03-qa.md in the same
  pass.
- Record surprises (a cast-site subtlety, a draw-layout decision, a parity scenario
  gotcha) in Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report exactly: phase status (complete or partial, with reasons); files touched
(grouped by commit); validation results (each command, pass or fail); review verdicts
(per agent, with the BLOCKING count at zero); deferrals (each with a reason and owning
phase); and a one-line handoff for the QA session (branch, PR number, base release
branch, the decided draw counts).

STOPPING RULES
- STOP if determinism cannot hold: if any design detail would force a draw outside a
  command body (at expiry, in the tick, at login, or on a deny path), surface it; do
  not ship the draw.
- STOP if the growth script cannot stay server-private: if any client surface needs
  the hidden outcomes or the yield seed to function, that is a design change.
- STOP if any pre-existing parity golden moves.
- STOP if git status is dirty at STEP 0, or if a BLOCKING review finding cannot be
  fixed without leaving this phase's scope; surface to the user.

When every step above is done and no BLOCKING stands: gate via
node scripts/gate_select.mjs (the armory browser red is the standing environmental
exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker; PR CI is the arbiter), push, and open the
PR against the release branch this phase was based on per
.github/PULL_REQUEST_TEMPLATE.md.
```
