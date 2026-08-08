# Phase 2: Patches and plot state

This phase gives the world its garden beds and each player a persistent plot record:
the FARM_PATCHES content table with its placement guard suite, the farming_zones pure
leaf, the PlayerMeta.farmPlots map persisted as an optional CharacterState field, the
read-only IWorldFarming facet, and the fplot self delta key. The wire carries only the
public projection: the hidden pre-rolled outcome slots and the yield seed (filled by
Phase 3) never leave the server. The design authority is `docs/farming/state.md`
(D2, D3, D23, the seam reference).

Live-surface note (binding): dormant. Nothing is player-reachable after this phase
merges: no commands, no items, no render, no UI. The patch definitions and plot-state
plumbing exist under the surface only.

### Starter Prompt

```
This is Phase 2 of the Farming feature: "Patches and plot state".
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: the world knows where garden beds are, and each player can persist plot state,
with the wire carrying only the public projection.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Never touch the
  main checkout. Use git -C /home/fernandoramirez/Documents/woc-farming-plan for every
  git command (the Bash cwd drifts).
- git status must be clean. If it is not, stop and surface it.
- D22 SWEEP (state.md wins on contradiction): branch
  fix/farming-phase-02-patches-and-plots off the LOCAL feature/farming-plan, never
  off a bare release tip (which lacks the packet). git fetch origin --prune; if a
  newer origin/release/** tip exists than the branch has absorbed, merge it INTO the
  phase branch FIRST, resolve generated i18n bundles by regen, and run the
  release-merge-audit skill. Record the phase-start commit hash (the absorb merge)
  for the STEP 3 diff. EXECUTED 2026-08-08: absorb merge 743a1ee6ad (tip e5c16ca398).
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  these phase-relevant topics: round-trip-pins-reference-aliasing (build expectation
  literals fresh, never compare an object to itself), wire-name-constant-pins-need-
  literals, vacuous-bound-pin-trap, worktree-cwd-drift-misroutes-git,
  big-diff-reviewer-turn-budgets, node25-breaks-jsdom-gate.

STEP 1 - LOAD CONTEXT
Spawn ONE Explore agent (breadth: very thorough) to read and summarize:
- docs/farming/state.md (all of it) and docs/farming/progress.md (including the
  Phase 1 Notes).
- This phase file, docs/farming/phase-02-patches-and-plots.md.
- The source surface for this phase: src/sim/professions/fishing_zones.ts (the pure
  leaf template, including its header rules); tests/gather_node_placement.test.ts
  (the physical-safety arms to clone); the module defining PlayerMeta and the
  Sim.addPlayer initialization site (locate by symbol); the CharacterState serialize
  and load path plus node_persist.ts (the load-side anti-tamper pattern, locate by
  filename); src/world_api/professions.ts (the facet file template);
  tests/world_api_parity.test.ts (the pinned facet and member-name blocks);
  src/net/online.ts (how an existing self delta key is mirrored); the modules
  exporting ALL_DELTA_KEYS and TERSE_TO_IWORLD (locate by exported symbol);
  tests/snapshots.test.ts (an existing self-key round-trip pin and the server-trim
  negative-pin precedent); the parity sampler (how PlayerMeta is sampled and how a
  Map canonicalizes).
- CLAUDE.md files: the root CLAUDE.md, src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md,
  src/world_api/CLAUDE.md, server/CLAUDE.md.
The orchestrator never reads planning docs or coordinator monoliths directly; it works
from this summary. The summary MUST return: (1) the fishing_zones.ts header rules
verbatim in compressed form and its reader shape; (2) the exact physical-safety arms
in tests/gather_node_placement.test.ts and the helpers they call; (3) where PlayerMeta
lives, how addPlayer initializes per-player maps, and how the parity sampler
canonicalizes an empty Map; (4) the CharacterState serialize/normalize pattern and the
node_persist.ts anti-tamper moves (clamp, drop-unknown); (5) the facet-file recipe and
the exact tests/world_api_parity.test.ts blocks a new facet must update; (6) the full
end-to-end path of one existing self delta key: server emit site, online.ts mirror,
ALL_DELTA_KEYS, TERSE_TO_IWORLD, and its snapshots round-trip pin, plus the
server-trim negative-pin shape; (7) the hub-center coordinates and legal-ground
constraints for eastbrook_vale, mirefen_marsh, thornpeak_heights, and evergarden;
(8) the CLAUDE.md constraints that bind this phase; (9) anything in state.md or
progress.md that contradicts this brief.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Before fan-out, the orchestrator locks the shared interface in the agent briefs: the
PlotState field names, the public-projection subset, and the bed id scheme, so the
slices stay file-disjoint. Then request fan-out explicitly: spawn the three agents
below in parallel, give each ONLY the Explore summary plus its own slice brief, and
never put a teammate in plan mode. Each agent owns its vertical slice including its
tests. Merge slices if one turns out trivial.

Agent A, patch content and placement guard:
- src/sim/content/farm_patches.ts: export FarmPatchDef (id, zoneId, tier, position,
  and a per-site bed list with STABLE bed ids that never renumber) and FARM_PATCHES
  covering the four D2 hubs: eastbrook_vale tier 1, mirefen_marsh tier 2,
  thornpeak_heights tier 3, evergarden tier 4. Positions sit near the hub centers on
  legal ground. Decide in-phase, state, and document: the concrete positions and the
  per-site bed count (uniform or tier-scaled); record the choice in progress.md Notes
  and the state.md ledger.
- src/sim/professions/farming_zones.ts: a pure leaf per the fishing_zones.ts header
  rules: the FARMING_ZONE_TIERS tier ladder, an Object.hasOwn reader, an explicit row per
  farming zone, and every knob DERIVED from the tier, never an independent constant.
- tests/farm_patch_placement.test.ts: clone the physical-safety arms from
  tests/gather_node_placement.test.ts for FARM_PATCHES: dry land, no collider
  overlap, a reachable stand spot, zone containment, minimum spacing between beds,
  and hub reachability.

Agent B, plot state and persistence:
- PlayerMeta.farmPlots: a Map keyed by bed id; an empty Map canonicalizes to an empty
  array in the parity sampler (D3).
- The PlotState shape: crop id, planted-at epoch-ms, ready-at epoch-ms, hidden
  pre-rolled outcome slots (declared now, filled by Phase 3), applied-knob flags
  (compost, watch, tonic; all default off, wired in Phase 4), and a notified flag
  (default false; reserved for the Phase 8 ready notices; serialized with the rest).
- The OPTIONAL CharacterState field with serialize plus normalize-on-load: clamp
  deadlines, drop unknown bed ids and unknown crop ids, following the node_persist.ts
  load-side anti-tamper pattern. Every pre-farming save loads cleanly.
- Sim.addPlayer initialization (an empty map by default).
- A save-then-load round-trip test in a new suite tests/professions_farming_state.test.ts
  (a working name; if refined, note the actual name in progress.md), including the
  tamper arms: a bogus bed id is dropped, an out-of-range deadline is clamped, and a
  save with no farming field at all loads clean.

Agent C, facet and wire:
- src/world_api/farming.ts: the IWorldFarming facet, READS ONLY this phase:
  farmPatches (the static defs) and myFarmPlots (the public projection per the D3
  contract: ONLY bed id, crop id, planted-at, ready-at, the applied knob flags, the
  Phase 8 notified flag, and a server-derived status of growing, ready, or withered,
  with withered surfacing only at or after ready time). Members land in the facet
  file, never the barrel. Implement in BOTH Sim and ClientWorld in the same change.
- tests/world_api_parity.test.ts: the new facet and its member-name block pinned.
- The fplot self delta key: the server emit, the src/net/online.ts mirror, the
  ALL_DELTA_KEYS and TERSE_TO_IWORLD set-equality updates, and a snapshots round-trip
  pin (pin the wire name to its LITERAL string, never through the shared constant).
- State this rule IN CAPS in a comment in src/world_api/farming.ts: THE WIRE
  PROJECTION NEVER CARRIES THE HIDDEN OUTCOME SLOTS OR THE YIELD SEED. Enforce it
  with a negative pin following the server-trim precedent: fill the hidden fields in
  a fixture plot, serialize, and assert the payload lacks them.

INVARIANTS THIS PHASE MUST KEEP
- Sim purity in every new sim file: zero DOM/browser/Three imports, no imports from
  render/ui/game/net, no Math.random, Date.now, or performance.now
  (tests/architecture.test.ts guards it).
- Zero new rng call sites this phase: patches are static data and plot state is
  plumbing; nothing rolls anything.
- Every wire payload carries only the public projection: the hidden outcome slots and
  the yield seed never cross the wire, on any path, ever.
- Every new CharacterState field is OPTIONAL with a default; every pre-farming save
  loads cleanly; every load path clamps and sanitizes (drop every unknown bed id and
  crop id, clamp every deadline).
- The facet rule: every new IWorld member lands in src/world_api/farming.ts (never
  the barrel), is implemented in BOTH Sim and ClientWorld in the same change, and
  updates the pinned member lists in tests/world_api_parity.test.ts in the same
  change.
- All work happens in ~/Documents/woc-farming-plan; every commit uses explicit paths,
  never git add -A.

Out of scope (do NOT do in this phase):
- No commands (plant, harvest), no growth logic, no draw of any kind.
- No items (seeds, produce, husks, hoes), no knobs (compost, watch, tonic) beyond the
  default-off flags in the shape.
- No render work, no UI, no map pins, no notices.
- No NPCs, no vendors, no quests, no deeds.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order, and record each result:
- npx tsc --noEmit
- npx vitest run tests/farm_patch_placement.test.ts tests/professions_farming_state.test.ts
- npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts
  tests/bandwidth.test.ts tests/architecture.test.ts tests/world_api_parity.test.ts
- npx vitest run tests/parity: expect green with the empty default (an empty Map
  canonicalizes to an empty array). If the field add alone moves digests, verify the
  movement is ONLY the mechanical field add with the rng draw-order fingerprint
  identical, then UPDATE_PARITY=1 regen in one deliberate isolated commit containing
  nothing but tests/parity/golden/**. Any other movement: STOP.
- npm run ci:changed (fix findings with a SCOPED npx @biomejs/biome check --write
  <file>, never whole-tree)
- node scripts/gate_select.mjs
Then run git diff --name-only <phase-start-commit>..HEAD and dispatch ONLY the Review
Dispatch Matrix rows in docs/farming/implementation-plan.md that match the diff.
Expected matches for this phase: cross-platform-sync (facet, wire, sim state),
architecture-reviewer (src/sim touched), migration-safety (the characters state shape
changed), then qa-checklist once the deliverable set is complete. Every review agent
gets: a hard 30-tool-call budget, report-first instructions, and the coverage
instruction "report every issue including low-severity and uncertain ones; ranking
happens later". If an agent truncates or stalls, resume it with exactly: "Stop reading
more files. Output the full report now based on what you have already seen. No more
tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." No commit while a
BLOCKING stands.

STEP 4 - COMMIT CADENCE
Four to five Conventional Commits, each with a scope and a body (what changed and
why), explicit paths only, never git add -A, no session links or Claude attribution:
1. feat(professions): FARM_PATCHES content, the farming_zones pure leaf, and the
   placement guard suite.
2. feat(professions): farmPlots plot state (PlayerMeta, the optional CharacterState
   field, normalize-on-load, addPlayer init) and the round-trip suite.
3. feat(net): the IWorldFarming read facet, the fplot self delta key, the wire pins,
   and the negative leak pin.
4. test(parity): the isolated golden regen, ONLY if the field add moved digests,
   containing nothing but tests/parity/golden/**.
5. docs(farming): progress and state updates.

STEP 5 - ACCEPTANCE CRITERIA
- [ ] FARM_PATCHES covers exactly the four D2 hubs at the locked tiers, every bed has
      a stable id, and the chosen positions and bed counts are documented in
      progress.md Notes.
- [ ] tests/farm_patch_placement.test.ts is green with every physical-safety arm: dry
      land, no collider overlap, a reachable stand spot, zone containment, minimum
      spacing, hub reachability.
- [ ] src/sim/professions/farming_zones.ts follows the fishing_zones.ts header rules
      (Object.hasOwn reader, explicit row per zone, derived knobs); no other module
      hardcodes a farming zone tier.
- [ ] PlayerMeta.farmPlots exists, initialized empty in addPlayer; the empty Map
      canonicalizes to an empty array in the parity sampler.
- [ ] The CharacterState field is optional with a default: a pre-farming save loads
      cleanly, proven by a test.
- [ ] Normalize-on-load clamps deadlines and drops unknown bed and crop ids; the
      tamper arms are tested.
- [ ] The save-then-load round trip is green, with expectation literals built fresh
      (no reference-aliased self-comparison).
- [ ] IWorldFarming exists with reads only, implemented in BOTH Sim and ClientWorld;
      tests/world_api_parity.test.ts pins updated and green.
- [ ] fplot is registered in ALL_DELTA_KEYS and TERSE_TO_IWORLD; the snapshots
      round-trip pin is green and pins the wire name as a literal.
- [ ] The negative wire-leak pin proves the projection carries neither the hidden
      outcome slots nor the yield seed.
- [ ] tests/parity is green (or moved only by the mechanical field add, regenerated
      in one isolated goldens-only commit).
- [ ] tests/architecture.test.ts is green (sim purity; zero new rng call sites).
- [ ] Nothing is player-reachable: no command, no item, no render, no UI (the
      live-surface note holds).

STEP 6 - DOC UPDATES + MEMORY
- docs/farming/progress.md: flip the Phase 2 row to done with dates, copy the STEP 5
  acceptance list here with its check states, add a Notes block including the chosen
  patch positions and bed counts.
- docs/farming/state.md: append to the per-phase ledgers (new IWorld members:
  farmPatches, myFarmPlots; new wire keys: fplot; the actual round-trip suite name if
  it differs from the working name). Any deviation decided in-phase gets a "Locked
  deviations" line AND gets swept into docs/farming/phase-02-patches-and-plots.md and
  docs/farming/phase-02-qa.md in the same pass.
- Record surprises (a placement constraint that forced a position, a sampler
  subtlety, a wire-registration gotcha) in Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report exactly: phase status (complete or partial, with reasons); files touched
(grouped by commit); validation results (each command, pass or fail); review verdicts
(per agent, with the BLOCKING count at zero); deferrals (each with a reason and owning
phase); and a one-line handoff for the QA session (per D22: the merge commit into
feature/farming-plan and the release tip absorbed; there is no PR).

STOPPING RULES
- STOP if the public projection cannot avoid leaking the hidden outcome slots or the
  yield seed without a design change; surface the conflict, do not ship a leak.
- STOP if no legal-ground position near a hub center can satisfy the placement guard
  without moving world colliders (that is a content design change, not a farming
  decision).
- STOP if tests/parity moves by anything other than the mechanical field add.
- STOP if git status is dirty at STEP 0, or if a BLOCKING review finding cannot be
  fixed without leaving this phase's scope; surface to the user.

When every step above is done and no BLOCKING stands: gate via
BROWSER_PATH=$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome
node scripts/gate_select.mjs (grep the log for "[gate] FAIL"), then, per D22
(supersedes the original push-and-open-a-PR line here): merge the phase branch
--no-ff into feature/farming-plan and delete it. Do NOT push and do NOT open a
PR; the would-be PR body goes in progress.md's Phase 2 Notes. Deviations decided
in-phase are lettered (h) to (m) in state.md's CANONICAL ledger.
```
