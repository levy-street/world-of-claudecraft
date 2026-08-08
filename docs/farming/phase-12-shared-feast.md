# Phase 12: The shared feast

The tier-4 showcase per D16: a placeable feast other players eat from, the communal
payoff at the top of the crop ladder. The feast is a REAL entity riding the normal entity
snapshot (the battleground-flag precedent), with server-owned charges, a per-player
consumed ledger, and tick-domain expiry, transient and never serialized.
docs/farming/state.md is the authority; if this file contradicts it, state.md wins and
this file plus phase-12-qa.md get swept in the same pass.

Live-surface note (binding): LIVE. The moment this merges, a player can cook the feast, place it in
the world, and every nearby player can eat from it once for the tier-4 well-fed buff.
This is the first farming surface other players consume; it is fully reachable on merge,
nothing dormant.

### Starter Prompt

```
This is Phase 12 of the Farming feature: The shared feast.
Model: Opus 4.8, xhigh effort (1m context variant where the file load demands it).
Harness: Claude Code.

Goal: a placeable feast other players eat from, the communal payoff at the top of the
farming ladder.

STEP 0 - PRE-FLIGHT
- Work ONLY in the persistent worktree ~/Documents/woc-farming-plan. Use
  git -C ~/Documents/woc-farming-plan for every git command.
- git status must be clean. If it is not, stop and surface; never stash or discard WIP
  that is not yours.
- Re-resolve the NEWEST release/** branch: git fetch origin --prune, then
  git branch -r --list 'origin/release/*' | sort -V and take the last row. Create branch
  fix/farming-phase-12-shared-feast off its tip. Record the phase-start commit sha.
- If release moves mid-phase and this branch turns long-lived, merge release in and run
  the release-merge-audit skill.
- Scan Claude Code memory: the MEMORY.md index, the farming-skill-program entry, plus
  these phase-relevant topics: worktree-cwd-drift-misroutes-git,
  pr-screenshot-browser-path, joint-coverage-masks-deleted-sites,
  mutation-checks-commit-first, big-diff-reviewer-turn-budgets,
  fanout-agent-delivery-traps, no-claude-session-links.

STEP 1 - LOAD CONTEXT
Spawn one Explore agent (very thorough) to read and summarize: docs/farming/state.md,
docs/farming/progress.md, docs/farming/phase-12-shared-feast.md, and these sources:
src/world_api/farming.ts (the IWorldFarming facet as it stands),
tests/world_api_parity.test.ts (the pinned member lists), src/sim/interaction.ts (the
interaction arm pattern), src/sim/quests/interact_object_credit.ts (the creditedObjects
stable-content-key ledger idiom), src/sim/professions/farming.ts (updateFarming and the
tick append rule context), the entity snapshot path (locate the battleground-flag
precedent by symbol across src/net/online.ts and server/game.ts), the wellfed
application arm from Phase 11 in src/sim/items.ts, the cooking recipe content module,
scripts/assets/build_farm_props.mjs, src/render/farm_patches.ts, src/game/audio.ts plus
scripts/sfx/sfx_prompts.mjs (the cue recipe), tests/snapshots.test.ts,
tests/env_protocol.test.ts, tests/bandwidth.test.ts, and the CLAUDE.md files: root,
src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md, src/ui/CLAUDE.md,
src/render/CLAUDE.md. The orchestrator never reads planning docs or coordinator
monoliths directly; the summary is your only context.
The summary must return, explicitly:
- The IWorldFarming member list and the command plumbing pattern in BOTH Sim and
  ClientWorld, plus where tests/world_api_parity.test.ts pins the members.
- The battleground-flag precedent in full: how a sim-spawned entity enters the entity
  snapshot, which wire fields it rides, what applyWire needs, and what the renderer
  needs to draw a new entity kind.
- The interaction arm pattern in src/sim/interaction.ts and the stable-content-key
  ledger idiom in src/sim/quests/interact_object_credit.ts, shaped for a per-player
  consumed ledger.
- Where updateFarming sits in the tick (the state.md tick anchor) and how the
  despawn and expiry check rides INSIDE that driver without reordering anything.
- How to grant the tier-4 wellfed buff from an interaction arm using only the Phase 11
  machinery (and whether that application owns any rng draw; none is expected).
- The announce-and-route precedents: which existing test drives multiple online
  sessions, for the routing test.
- The build_farm_props.mjs exporter structure and the src/render/farm_patches.ts
  adapter pattern (footprint and pivot conventions for a swap-ready prop), the VFX
  seam, and the full SFX cue recipe.
- The cooking recipe module and the economy pins an expensive produce-heavy tier-4
  recipe must satisfy.
- Any progress.md Notes from earlier phases touching entities, snapshots, interaction,
  or the wellfed arm.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
Spawn four implementation agents by vertical slice, each owning its slice plus its
tests. Fan-out reminders: request the fan-out explicitly and spawn all four in one
message so they run in parallel; give each agent ONLY the Explore summary plus its own
bullets (never a planning doc to read); never run a teammate in plan mode. Agents A and
B coordinate on the feast module's exported surface; if they must edit the same file in
parallel, use isolation: worktree per the agent-scaling section of the implementation
plan.
- Agent A, the feast core (sim): a NEW module src/sim/professions/feast.ts owning
  FeastState (owner, charges remaining, tick-domain expiry, a per-player consumed
  ledger via the stable-content-key idiom). Place draws ZERO rng; state that in the
  module. The interaction arm in src/sim/interaction.ts: consuming grants the tier-4
  wellfed buff via the Phase 11 arm, decrements a charge, once per player per feast.
  Despawn on zero charges or expiry via a check riding INSIDE the already-anchored
  updateFarming driver (the state.md tick anchor), never a second appended sweep.
  Every deny arm (no charges, already consumed, expired, out of range, anti-abuse) is a
  text-free id-carrying SimEvent. Decide the anti-abuse rule IN THIS PHASE: one active
  feast per player OR a placement cooldown; state the choice and document it in the
  module and progress.md Notes. Document the transient rationale in the module: the
  feast is never serialized because tick-domain expiry is not restart-safe (the
  mobile-station rationale). Tests: place, consume, once-per-player, charges, expiry,
  every deny arm, a same-seed determinism pin.
- Agent B, the seam and the wire (world_api plus net plus server): a placeFeast command
  on IWorldFarming (src/world_api/farming.ts, the facet file, never the barrel),
  implemented in BOTH Sim and ClientWorld in the same change, with the pinned member
  list in tests/world_api_parity.test.ts updated. The feast spawns a REAL entity that
  rides the normal entity snapshot per the battleground-flag precedent; no new wire
  mechanism. A multi-session online routing test per the announce-and-route precedents
  (placer places; a second session sees the entity and consumes; the charge decrement
  routes back). The snapshots suites stay green: tests/snapshots.test.ts,
  tests/env_protocol.test.ts, tests/bandwidth.test.ts.
- Agent C, the item and the words (content plus i18n): the feast item as an expensive,
  produce-heavy tier-4 cooking recipe (recipe economy green; the crafted output carries
  no buyValue). The placer's name in the feast title as a t() key in the
  "{name}'s Harvest Feast" shape (the name is a value, the text is the key). English
  t() rows in the matching src/ui/i18n.catalog/ module; S3 coverage for every new emit.
- Agent D, the look and the sound (render plus audio): the feast prop added to
  scripts/assets/build_farm_props.mjs (swap-ready: fixed footprint and pivot per D19),
  the render surface (default: a small dedicated src/render/feast.ts adapter; an arm
  inside src/render/farm_patches.ts is acceptable if the phase judges it cohesive;
  state the choice in progress.md), placement VFX, and a feast
  cue: UI_CUES key, facade method in src/game/audio.ts, the hud case, a prompt row in
  scripts/sfx/sfx_prompts.mjs, placeholder clip via npm run sfx:ui, then
  npm run sfx:manifest and npm run sfx:check. Tests: the tests/game_audio.test.ts
  completeness arm.

INVARIANTS THIS PHASE MUST KEEP
- Server authority: every charge decrement and every ledger entry is server state; the
  client never decides any feast outcome; no wire command ingests a client-supplied
  ItemInstancePayload.
- Zero rng in placement and consumption, stated in the module; the tier-4 wellfed
  application owns no draw either (confirm against the Phase 11 arm and state it).
- Transient state is never serialized: no feast field enters CharacterState, any save
  blob, or any database write; the mobile-station rationale is documented in the
  module.
- Every deny arm emits a text-free, id-carrying SimEvent localized client-side; every
  player-visible string added this phase is an English t() key.
- The feast rides the normal entity snapshot; no new wire mechanism of any kind.
- All sim work stays inside the 20 Hz budget: the despawn and expiry check inside
  updateFarming does no per-tick allocation in its hot path.
- All randomness in src/sim/ goes through ctx.rng.
- No em dashes, en dashes, or emojis anywhere; every new name is IP-safe per D17.

Out of scope (do NOT do in this phase)
- Wiki prose and the handoff manifest (Phase 13).
- Any second placeable object or a general placeable-object framework.
- Feast persistence of any kind (serialization, restart survival).
- Trading, mailing, or market-listing a PLACED feast (the item itself follows normal
  item rules).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW
Run, in order, and record each result:
- npx tsc --noEmit
- npx vitest run over the new feast suite (working name tests/professions_feast.test.ts;
  record the real name in progress.md)
- npx vitest run tests/architecture.test.ts tests/localization_fixes.test.ts
  tests/world_api_parity.test.ts tests/snapshots.test.ts tests/env_protocol.test.ts
  tests/bandwidth.test.ts tests/game_audio.test.ts
- npx vitest run tests/parity: this phase draws zero rng, so no golden should move; if
  the parity scenario set was deliberately extended to cover the feast, record that
  extension and isolate it in its own commit; any OTHER movement is a defect.
- npm run ci:changed
- node scripts/gate_select.mjs
- Screenshots: this IS a visual phase; capture before/after (desktop and mobile) via
  the pr-screenshots skill, commit under docs/screenshots, reference from the PR body.
Then check git diff --name-only against the phase-start commit and dispatch ONLY the
matching rows of the Review Dispatch Matrix in docs/farming/implementation-plan.md
(expected for this diff: architecture-reviewer, cross-platform-sync,
privacy-security-review for the interaction plus server surface, frontend-seam-reviewer,
and qa-checklist at phase completion). Every review agent gets a hard 30-tool-call
budget, the coverage instruction ("report every issue including low-severity and
uncertain ones; ranking happens later"), and, if truncated, the resume line: "Stop
reading more files. Output the full report now based on what you have already seen. No
more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT." No commit
while a BLOCKING stands.

STEP 4 - COMMIT CADENCE
2 to 5 Conventional Commits, each with a scope and a BODY, explicit paths only, never
git add -A, no session links or Claude attribution:
- feat(sim): the feast module, interaction arm, the updateFarming despawn check,
  deny arms, and the anti-abuse rule (with the unit suite)
- feat(net): placeFeast on IWorldFarming in both worlds, entity snapshot carriage,
  parity pin, the multi-session routing test
- feat(content): the feast recipe and the title key (with economy and S3 coverage)
- feat(render): the feast prop, the chosen render adapter, placement VFX, and the
  feast cue chain
- docs(farming): progress, state ledgers, and the screenshot references

STEP 5 - ACCEPTANCE CRITERIA
- [ ] The feast item exists: an expensive, produce-heavy tier-4 cooking recipe; recipe
      economy green; no buyValue on the crafted output.
- [ ] placeFeast lands on IWorldFarming, implemented in BOTH Sim and ClientWorld, with
      the tests/world_api_parity.test.ts pin updated in the same change.
- [ ] The feast spawns a REAL entity riding the normal entity snapshot; no new wire
      mechanism anywhere in the diff.
- [ ] src/sim/professions/feast.ts owns FeastState (owner, charges remaining,
      tick-domain expiry, per-player consumed ledger via the stable-content-key idiom);
      place draws zero rng and the module says so.
- [ ] Consuming grants the tier-4 wellfed buff, decrements a charge, once per player
      per feast; despawn on zero charges or expiry via the check riding inside the
      already-anchored updateFarming driver (the state.md tick anchor), not a second
      sweep.
- [ ] Feast state is transient and never serialized; the mobile-station rationale is
      documented in the module.
- [ ] The anti-abuse rule is decided, stated, and documented (one active feast per
      player or a placement cooldown).
- [ ] The prop is in scripts/assets/build_farm_props.mjs (swap-ready), the chosen
      render adapter draws it (the dedicated src/render/feast.ts default, or the
      farm_patches.ts arm if judged cohesive, the choice stated in progress.md),
      placement VFX fire, and the feast cue chain is complete (key, clip, manifest,
      sfx:check green).
- [ ] The feast title is a t() key in the "{name}'s Harvest Feast" shape.
- [ ] Tests green: place, consume, once-per-player, charges, expiry, every deny arm,
      the multi-session routing test, the determinism pin.
- [ ] Parity: no golden moved, or the deliberate scenario extension is recorded and
      isolated in its own commit.
- [ ] Screenshots (desktop and mobile) committed under docs/screenshots and referenced
      from the PR body.
- [ ] Every STEP 3 validation row green; gate_select green modulo the armory exception.

STEP 6 - DOC UPDATES + MEMORY
Update docs/farming/progress.md (the Phase 12 status row, the acceptance list above
copied with its check states, a Notes block including the anti-abuse decision and the
proposed charge count and expiry as maintainer-flagged tuning) and the
docs/farming/state.md ledgers (new IWorld member placeFeast, new SimEvents, new items
and recipes, new i18n keys, the anti-abuse rule as a locked deviation entry refining
D16). Any deviation decided in-phase gets swept into
docs/farming/phase-12-shared-feast.md AND docs/farming/phase-12-qa.md in the same pass.
Record genuine surprises in Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT
Report: phase status (complete or partial with reasons); files touched, grouped by
surface; validation results per command; review verdicts per agent; deferrals with
reasons; one line handing off to the Phase 12 QA session.

STOPPING RULES
- Stop if the entity route cannot carry the feast without a new wire mechanism: surface
  the design instead of inventing one.
- Stop if any path makes serialization unavoidable (a save, a snapshot-of-record, a
  restart survival requirement): the transient design is broken; surface it.
- Stop if git status is dirty at STEP 0 or the newest release branch cannot be
  resolved.
- Stop while any review BLOCKING stands.

Close: gate via node scripts/gate_select.mjs (the armory browser red is the standing
environmental exception; grep the log for "[gate] FAIL", never trust a piped exit code;
PR CI is the arbiter). Push and open the PR against the release branch this phase was
based on, following .github/PULL_REQUEST_TEMPLATE.md. Screenshots via the pr-screenshots
skill apply to the visual phases (12 and 13); this phase IS one, so the PR body
references the committed before/after set. No Claude attribution or session links in
commits or PR text.
```
