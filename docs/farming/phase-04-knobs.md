# Phase 4: Knobs and insurance

Phase 3 landed plant and harvest with a pre-rolled growth script and a pinned
draw-count contract. This phase adds every plant-time choice the design allows:
compost, farmer's watch, and growth tonic (D6, D7, D8, D9), plus the withered-husk
conversion that turns failure into the next attempt's insurance. The one hard rule of
the phase: knobs bend thresholds, never the draw count, so the Phase 3 contract
survives every combination untouched.

Live-surface note (binding): Dormant. Compost and growth tonic are minted this phase but have
no vendor row, recipe, loot source, or quest reward until Phase 5 lands crops and
Phase 9 flips go-live. Withered husks only come from failed crops, and no seed is
obtainable yet, so convertHusks is unreachable in live play. Nothing player-reachable
changes when this phase merges.

### Starter Prompt

```
This is Phase 4 of the Farming feature: Knobs and insurance.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: every plant-time choice exists (compost, farmer's watch, growth tonic) plus the
husk-to-compost conversion, without changing the number of rng draws in the Phase 3
contract.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Never touch the
  main checkout. Prefix every git command with git -C ~/Documents/woc-farming-plan.
- git status must be clean. If it is not, stop and surface.
- Re-resolve the NEWEST release branch: git fetch origin --prune; git branch -r
  --list 'origin/release/*' | sort -V. Create branch fix/farming-phase-04-knobs off
  that tip. Record the phase-start commit (git rev-parse HEAD) for the STEP 3 diff.
  If the branch goes long-lived and release moves mid-phase, merge release in and run
  the release-merge-audit skill.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  these phase-relevant topics: mutation-checks-commit-first,
  big-diff-reviewer-turn-budgets, round-trip-pins-reference-aliasing,
  early-exit-pins-need-work-remaining, fanout-agent-delivery-traps,
  worktree-cwd-drift-misroutes-git.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent to read and summarize: docs/farming/state.md,
docs/farming/progress.md, docs/farming/phase-04-knobs.md, and these source files as
Phase 3 landed them (state.md's "Key planned files" section records any refined
names): src/sim/professions/farming.ts, the farming items content module (planned
src/sim/content/farming_items.ts), src/world_api/farming.ts,
tests/professions_farming.test.ts and its siblings, the farming_session parity
scenario under tests/parity, tests/world_api_parity.test.ts (the farming member
pins). Also the relevant CLAUDE.md files: the root CLAUDE.md, src/sim/CLAUDE.md,
src/sim/professions/CLAUDE.md, src/sim/content/CLAUDE.md. The orchestrator never
reads planning docs or coordinator monoliths directly.
The summary MUST return: the exact plantCrop command signature and payload shape as
shipped; the draw-count contract as pinned (draws per plant, draws per harvest, zero
on denial) and where the pin lives; the withered_husks item id and def location; the
IWorldFarming member list and the parity-pin location; the Phase 3 denial-event idiom
(stable keys or matcher rows) to copy; the item-def convention for plain
consumed-by-command items; how the farming_session scenario is recorded and
re-recorded; any state.md ledger entries or deviations Phases 1 to 3 recorded.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Split into three agents by vertical slice, each owning its slice plus its tests.
Request the fan-out explicitly (these models under-spawn by default). Give each agent
ONLY the Explore summary and its own deliverable list, never the planning docs. Never
set plan mode on a teammate agent. Agents A and B run in parallel; agent C starts
after B lands (it consumes B's armed-tonic state). If two agents must mutate the same
file in parallel, give them isolation: "worktree".

Agent A, items and conversion:
- Item defs for compost and growth_tonic in the farming items content module, beside
  withered_husks (which landed in Phase 3). They are plain items consumed by command,
  referenced from the plant payload, NOT wired through ItemDef.use. State that choice
  in a comment on the defs. Per D9, compost receives a vendor buyValue in THIS phase
  (propose the value and flag it for the maintainer in the PR body; the vendor row
  itself is stocked in Phase 9) and growth_tonic receives NO buyValue (never
  vendor-stocked, alchemy-crafted, sellValue only). English display-name rows in the
  matching src/ui/i18n.catalog module; names IP-safe per D17.
- The convertHusks command on IWorldFarming: N husks yield one compost. Propose a
  concrete N and flag it for the maintainer in the PR body. Implement in BOTH Sim and
  ClientWorld in the same change and update the pinned member list in
  tests/world_api_parity.test.ts. The range gate to a farmer NPC arrives in Phase 9:
  land the command with a documented permissive gate and a comment naming Phase 9 as
  the phase that tightens it, phrased without any TODO marker.
- Tests: conversion arithmetic, the no-husks deny arm, the parity pin.

Agent B, the plant-time knob payload (D6, D7, D8, D9):
- Extend plantCrop with the knob payload: compost, farmer's watch, growth tonic. The
  server consumes each requested knob from bags at plant time. A requested knob that
  cannot be paid denies the WHOLE plant: nothing consumed, zero rng draws, a
  localized denial line.
- Compost consumed from bags adds 10 survival points. Farmer's watch consumes a
  tier-appropriate produce fee and adds 10 survival points. The fee predicate,
  defined here: any farming produce whose crop tier is at or below the planted crop's
  tier. Propose the fee amount per tier and flag it for the maintainer in the PR
  body. Both bonuses stack with the skill-scaled base and cap at 100 survival points.
- Growth tonic consumed at plant ARMS the yield bonus chance; the bonus is applied at
  harvest against already-drawn values (the pre-rolled yield seed), never via a new
  draw.
- Deny arms: no compost in bags, no fee produce matching the predicate, no tonic in
  bags, and an already-knobbed replant attempt on an occupied plot.
- Every player-visible denial emits a stable key plus values (or English re-localized
  via the client matcher) in the SAME change; the S3 guard
  (tests/localization_fixes.test.ts) enforces it.
- Tests: one per knob arm (consume side and deny side), the 100-point cap boundary
  (a case that would exceed 100 clamps to exactly 100, and a case landing exactly on
  100), and the fee consumption pin: the exact produce item leaves the bag and
  nothing else moves.

Agent C, contract and determinism:
- THE DESIGN RULE, STATED IN CAPS AND KEPT: KNOB EFFECTS NEVER CHANGE THE NUMBER OF
  RNG DRAWS. THEY CHANGE THRESHOLDS APPLIED TO ALREADY-DRAWN VALUES, SO THE PHASE 3
  DRAW CONTRACT SURVIVES EVERY KNOB COMBINATION.
- Restate the draw-count contract in the farming driver's doc comment (draws per
  plant, draws per harvest, zero on denial) and re-pin it: the pin must count real
  draws under every knob combination and assert the count is identical with and
  without each knob.
- A same-seed determinism pin: identical seed plus identical command sequence yields
  identical plot outcomes, bag contents, and events.
- The farming_session golden re-records ONLY if the draw block changed, as its own
  isolated commit per D23 (UPDATE_PARITY=1, never hand-edited). The expected outcome
  of this phase is NO re-record; if the scenario is extended to exercise knobs, that
  extension plus its re-record is the one legitimate cause.

INVARIANTS THIS PHASE MUST KEEP
- D4, literally: ALL randomness draws at player-action moments through ctx.rng. ZERO
  draws at timer expiry, in the tick sweep, or at login. EVERY denial draws zero.
- D8, literally: front-loaded only. EVERY choice (seed, compost, watch, tonic)
  happens at plant time. NO mid-growth interaction of any kind is added, ever,
  required or optional.
- Server authority: the server consumes every item and resolves every outcome; the
  client never decides; no wire command ingests a client-supplied
  ItemInstancePayload.
- Sim purity: no Math.random, Date.now, or performance.now anywhere in src/sim/; no
  DOM, Three, render, ui, game, or net imports (tests/architecture.test.ts guards).
- Anti-chore: no knob adds a required visit or punishes absence.

Out of scope (do NOT do in this phase):
- Vendor stock of any kind (Phase 9).
- Recipes, including the tonic's alchemy recipe (Phase 6).
- NPCs and the farmer-NPC range gate for convertHusks (Phase 9).
- UI: no Harvest Journal work, no new windows (Phase 8).
- Render: no visuals (Phase 7).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order:
- npx tsc --noEmit
- npx vitest run tests/professions_farming.test.ts tests/architecture.test.ts
  tests/localization_fixes.test.ts
- If the plantCrop wire payload or the fplot self key widened: npx vitest run
  tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts
- npx vitest run tests/parity (BEFORE touching any golden; regen only deliberately)
- npm run ci:changed
- node scripts/gate_select.mjs
Then check git diff --name-only against the phase-start commit and dispatch ONLY the
matching rows of the Review Dispatch Matrix in docs/farming/implementation-plan.md.
For this phase's expected diff the matching rows are: architecture-reviewer (sim
behavior and rng draw order), cross-platform-sync (IWorldFarming grew and the command
surface moved), and qa-checklist (the phase deliverable set is complete). Dispatch
others only if the diff actually touches their row. Every review agent gets a hard
30-tool-call budget, the coverage instruction ("report every issue including
low-severity and uncertain ones; ranking happens later"), and, if truncation looms,
the resume line: "Stop reading more files. Output the full report now based on what
you have already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
NICE-TO-HAVE / VERDICT." No commit while a BLOCKING stands.

STEP 4 - COMMIT CADENCE
2 to 5 Conventional Commits, each with a scope and a body (what changed and why),
explicit paths only, never git add -A, no session links or Claude attribution.
Suggested shape:
1. feat(farming): compost and growth tonic items plus the convertHusks command
2. feat(farming): plant-time knob payload, survival points, and the watch fee
3. test(farming): knob arms, cap boundary, fee pin, draw-contract and determinism pins
4. Only if the draw block changed: test(parity): re-record farming_session golden
   (isolated, nothing else in the commit)
5. docs(farming): progress and state ledger updates

STEP 5 - ACCEPTANCE CRITERIA
- [ ] compost and growth_tonic exist as plain items with no ItemDef.use, consumed
      only by command, with a def comment stating the consumed-by-command choice;
      compost carries a positive vendor buyValue (maintainer-flagged, stocked in
      Phase 9 per D9) and growth_tonic carries none
- [ ] plantCrop accepts the knob payload; each requested knob is consumed from bags
      server-side at plant time; a requested knob that cannot be paid denies the
      whole plant with nothing consumed and zero draws
- [ ] compost adds 10 survival points, farmer's watch adds 10, total survival caps at
      100, with boundary tests at and above the cap
- [ ] the watch fee predicate is: any farming produce whose crop tier is at or below
      the planted crop's tier; per-tier amounts proposed and maintainer-flagged in
      the PR body
- [ ] a fee consumption pin proves the exact produce leaves the bag
- [ ] tonic consumed at plant arms a yield bonus applied at harvest against
      already-drawn values, with no added draw
- [ ] the draw-count contract is restated and re-pinned, and the pin passes under
      every knob combination with identical draw counts
- [ ] convertHusks is on IWorldFarming, implemented in BOTH Sim and ClientWorld, the
      tests/world_api_parity.test.ts pin updated; N proposed and maintainer-flagged;
      the permissive gate carries a comment naming Phase 9 with no TODO marker
- [ ] all four deny arms are tested: no compost, no fee produce, no tonic, an
      already-knobbed replant attempt
- [ ] every player-visible denial rides a stable key or a matcher rule added in this
      change; tests/localization_fixes.test.ts is green
- [ ] a same-seed determinism pin passes
- [ ] the farming_session golden was re-recorded ONLY if the draw block changed, in
      an isolated commit; otherwise it is untouched
- [ ] the STEP 3 validation list is green and node scripts/gate_select.mjs passes
      apart from the standing armory browser exception
- [ ] docs/farming/progress.md and docs/farming/state.md ledgers are updated

STEP 6 - DOC UPDATES + MEMORY
Update docs/farming/progress.md (Phase 4 status row, the copied acceptance list with
check states, a Notes block) and the docs/farming/state.md ledgers (new IWorld
members, new items, new i18n keys and matcher rows, proposed constants awaiting the
maintainer). Any deviation decided in-phase gets swept into
docs/farming/phase-04-knobs.md AND docs/farming/phase-04-qa.md in the same pass, plus
a line in state.md's "Locked deviations" ledger. Record surprises in Claude Code
memory.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status; files touched; validation results (each command, pass or fail);
review verdicts per agent; deferrals with reasons; and a one-line handoff for the QA
session.

STOPPING RULES
- Stop if any knob design would require a draw-count change: the caps rule cannot
  bend. Surface the conflict to the maintainer instead of shipping it.
- Stop if git status is not clean at STEP 0 or the newest release branch cannot be
  resolved.
- Stop if a BLOCKING review finding cannot be fixed without violating a locked
  decision (D1 to D24); state.md wins over this file, and a contradiction gets swept,
  not coded around.

When everything above is done: gate via node scripts/gate_select.mjs (the armory
browser red is the standing environmental exception; grep the log for "FAIL" (the selective gate prints "[gate:select] FAIL", the full gate "[gate] FAIL") plus the GATE EXIT marker;
PR CI is the arbiter), push, and open the PR against the release branch this phase
was based on, following .github/PULL_REQUEST_TEMPLATE.md.
```
