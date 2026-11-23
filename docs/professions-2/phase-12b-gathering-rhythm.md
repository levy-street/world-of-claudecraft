# Phase 12b: Gathering rhythm

Gathering gains action time and fishing gains a catch moment. A short gather cast (base about
2.5 s) replaces the instant node harvest, sped up by owning a tool tier above the node's
requirement (Phase 12's tiers) and modestly by proficiency band, floored around 1.5 s. Fishing
replaces its fixed 5 s cast with a bite minigame: one hidden seeded delay, a private bite signal,
and a generous server-authoritative reaction window answered by re-pressing the pole. It is its
own slice because it is pure rhythm-and-feedback work over the Phase 11 fishing module and the
Phase 12 tool tiers, it deliberately re-pins a known, pre-briefed set of timing tests (see the
Pin-cost appendix below), and none of the content phases depend on it. Approved by the
2026-07-20 timing and economy amendments (state.md is the authority); tracked as issue #2206.

As landed (2026-07-20, authoritative over the Starter Prompt below where they differ; the
full surfaces record is state.md's Phase 12b entry):
- The reel re-press does NOT land in items.ts useItem's generic busy branch: the useItem
  fishing arms route to ctx.startFishing BEFORE that guard, so the reel arm lives inside
  startFishing's own busy gate (command census unchanged either way). A re-press before the
  bite or after the deadline keeps the busy error.
- The parity storage decision: three transient Entity fields (fishBiteAtTick,
  fishReelDeadlineTick, gatherCastNodeId), inert-initialized, cleared on every end path;
  no exclude-list change; only professions_gather regenerated (hunted seed 1 under the
  re-shaped drive; the drive silences mobs, resets the herb window to band 0 per iteration,
  and keeps the newest eight signed instances so the window never hits bags-full).
- DEMON_HEAL_CAST_ID folded ONLY at the silence and lockout sites (byte-identical: it was
  already exempt there via failed ability resolution); everywhere else it stays deliberately
  ad hoc (the state.md entry lists each site with its live-behavior reason).
- The tool gate is deliberately NOT re-checked at gather-cast completion (held at cast
  start); completion re-validates exactly range, respawn, and capacity.
- The codfather cast SHIPS as 1 draw at cast start (no quest special-case in startFishing)
  plus 0 at the reel (early return preserved), per the appendix's either-is-fine row.
- FISHING_CAST_TIME retired in favor of FISHING_SESSION_CAP_SEC = 15, a constant cast-bar
  cap carrying zero bite information; the fishing cast bar renders a constant full waiting
  bar, and the /cast fishing readout shows no countdown ('You are fishing. Waiting for a
  bite.', em dash dropped, landed via the scripts/i18n_blocked_seed.mjs registry seed).
- No fishing bobber existed before this phase: src/render/fishing_bobber.ts is NEW
  (renderer-owned, idle bob for any fishing entity in view, owner-only bite state off the
  personal event, preset-identical).
- Additive pin moves landed OUTSIDE the Pin-cost appendix, all forced by mandated new
  behavior, none a weakening, in two classes. CUE-CENSUS EXTENSIONS for the six new
  PLACEHOLDER cues: tests/game_audio.test.ts 14 to 20 and tests/sfx_manifest.test.ts
  181-key/36-ui to 187/42; plus the Phase 11 gather_event_i18n pin "fishingResult is
  cue-free" re-pinned to "plays only the reel cue" (audio.fishReel present,
  audio.lootItem absent). THE SYNCHRONOUS-DRIVE FAMILY (an APPENDIX INVENTORY MISS: four
  files drive harvestNode as synchronously as gather_node_harvest's listed describes, but
  the appendix never listed them; each re-driven through cast completion via a local
  completeCastNow helper mirroring the lifecycle arm, coverage extended, nothing
  weakened): tests/gather_rare_events.test.ts (found by the review coverage pass),
  tests/gather_rare_event_online.test.ts, tests/prof_intro_quest.test.ts, and
  tests/profession_quest_objectives.test.ts (the last three caught by the FULL GATE, the
  recurring full-gate-catches-what-the-matrix-missed class). The appendix is otherwise
  CLOSED and fully executed; per the standing rule it must be re-inventoried by any later
  phase that adds pins in its blast radius.
- tests/gather_open_gate.test.ts and tests/gather_node_online.test.ts are deliberately
  unchanged (the former is corpse-focused with a stub harvestNode and corpse timing is out
  of scope; the latter is a pure ClientWorld ncd-mirror suite); the online
  castStart-wire-shape and completion-grant arms live in gather_node_harvest's live
  GameServer describe, and the interact-starts-a-cast arm in gather_node_interact.test.ts.
- Predicate-consumer precision (QA wording correction, 2026-07-20): of the eleven
  exemption sites, SEVEN consume the isNonSpellCast boolean directly (casting_lifecycle
  silence/lockout/blink-through/spell-queue, effect_dispatch interrupt immunity, damage
  cancel-not-pushback, items useItem busy guard) and FOUR are id-discriminating by
  construction, comparing the sentinels individually beside it (casting_lifecycle
  completion routing, castingReadout, castBarState, castDisplayName). The Starter
  Prompt's "all eleven route through the shared predicate" reads as the former only.

## Context pointers

- `docs/professions-2/state.md`: the 2026-07-20 timing and economy amendments block (the
  authority for this phase's rulings), locked decisions, and the validation matrix.
- `docs/professions-2/progress.md`: the Phase 12b status row and deliverable checklist.
- The Pin-cost appendix at the bottom of THIS file: every test and golden this phase deliberately
  re-pins, inventoried against the release/v0.29.0 tree. Read it before touching any test.
- `src/sim/professions/fishing.ts`: `startFishing` (fixed `FISHING_CAST_TIME` cast, zero draws)
  and `completeFishing` (the single table draw, the codfather early return, the capacity gate).
- `src/sim/types.ts`: `FISHING_CAST_ID` (the literal `'fishing'` riding `castingAbility`),
  `FISHING_CAST_TIME`, `DEMON_HEAL_CAST_ID` (a second non-ability cast sentinel handled ad hoc
  at some of the same choke points), the `fishingResult` and `gatherResult` SimEvent shapes.
- `src/sim/combat/casting_lifecycle.ts`: `updateCasting` (the silence and school-lockout
  exemptions, the fishing completion arm routing to `ctx.completeFishing`) and `castAbility`
  (the blink-through exclusion and the spell-queue exclusion).
- `src/sim/combat/effect_dispatch.ts` (`runEffects`, the interrupt-immunity arm),
  `src/sim/combat/damage.ts` (`dealDamage`, the cancel-not-pushback arm), `src/sim/items.ts`
  (`useItem`: the rod re-entry branch and the busy guard where the reel re-press lands),
  `src/sim/social/chat_readouts.ts` (`castingReadout`, the /cast fishing line),
  `src/render/cast_bar.ts` (`castBarState`), `src/ui/hud.ts` (`castDisplayName`).
- `src/sim/professions/gathering.ts`: `harvestNode` (today grants synchronously inside the
  command; draws and grants move to cast completion) and `resolveHarvest`.
- `src/sim/delves/lockpick_controller.ts`: `armLockpickStep` / `tickLockpickTimeout`, the
  server-authoritative tick-deadline precedent the bite reaction window follows
  (`stepDeadlineTick` on the session state, deadlines in sim ticks, the client never reports
  the timeout).
- `src/sim/professions/tools.ts` (`gatherToolTier`, `canGatherTier`) and the Phase 12 node
  tiers and rod band gating this phase composes with.
- The SFX pipeline for the placeholder cues: `scripts/sfx/ui_sfx.mjs` (deterministic local
  synthesis, keys match the `ui_*` pattern), `npm run sfx:manifest`, `npm run sfx:check`, the
  routing recipe in `src/game/CLAUDE.md`, and the help-wanted issue #2208 that lists every
  placeholder slot for the sound engineer.
- Local conventions: `src/sim/CLAUDE.md`, `src/sim/professions/CLAUDE.md`, `src/ui/CLAUDE.md`,
  `tests/CLAUDE.md`.

## Starter Prompt

```
This is Phase 12b of the Professions 2.0 feature: Gathering rhythm.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: give gathering a short tool-and-proficiency-scaled cast and replace the fixed fishing
cast with a hidden-delay bite minigame, without leaking the bite time to clients and while
re-pinning exactly the pre-briefed test set in this file's Pin-cost appendix.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Run git status; the checkout must be clean (a concurrent session may share it). Record the
  phase-start commit in docs/professions-2/progress.md Notes.
- Memory scan (MEMORY.md index): node25-breaks-jsdom-gate (gate under Node 24),
  combo-recipes-broken-online (the 2033 stub trap), design-language-program (today's tokens
  only), and any professions packet entries.
- Phase 12 must be LANDED (this phase reads its node tiers and rod bands). If it is not, stop.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize: docs/professions-2/state.md (the 2026-07-20
amendments block), docs/professions-2/progress.md, this phase file INCLUDING the Pin-cost
appendix, src/sim/professions/fishing.ts, src/sim/professions/gathering.ts (harvestNode),
src/sim/combat/casting_lifecycle.ts, src/sim/combat/effect_dispatch.ts (the interrupt arm),
src/sim/combat/damage.ts (the fishing cancel arm), src/sim/items.ts (useItem),
src/sim/delves/lockpick_controller.ts (the stepDeadlineTick precedent),
src/sim/social/chat_readouts.ts (castingReadout), src/render/cast_bar.ts, the hud.ts
castDisplayName helper, src/sim/professions/tools.ts, and the CLAUDE.md files for sim,
professions, ui, and tests. The summary must return: every FISHING_CAST_ID comparison site
(expect eleven exemption sites plus the definition and the cast origin), the exact
draw-order contracts of startFishing/completeFishing today, how harvestNode grants today
(synchronous in the command; only the skill point rides the pendingGatherGrants queue), the
lockpick deadline mechanism, the castRem/castTot wire behavior, and the Pin-cost appendix
verbatim.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
The sim agent lands first (predicate + gather cast + bite model); ui/render and tests agents
follow against its result. Each agent gets ONLY the Explore summary.

Agent sim deliverables:
- A shared non-spell-cast predicate (a pure function in src/sim/, e.g. isNonSpellCast(castId))
  consolidating the eleven scattered FISHING_CAST_ID exemption comparisons; the new gather
  cast id joins it. DEMON_HEAL_CAST_ID is handled ad hoc at some of the same choke points:
  fold it in ONLY where its current behavior is byte-identical to the fishing/gather
  semantics; never change its behavior in this phase.
- The gather cast: interacting with a node starts a cast (a new GATHER_CAST_ID sentinel on
  castingAbility, base about 2.5 s), validated up front exactly as harvestNode validates
  today. Duration shortens per owned tool tier ABOVE the node's Phase 12 requirement and
  modestly by proficiency band, floored around 1.5 s; exact numbers are yours, as named
  exported constants recorded in state.md tuning targets. Completion (the casting_lifecycle
  arm) re-validates range, node respawn state, and capacity, then runs the existing resolve
  (rarity and rare-event draws stay a completion-time pair, so denial-draws-zero survives).
  Moving cancels like any cast (cancelCast in player_motion is generic; verify, do not add a
  special case). NOTE the SimContext-callback trap: a new completion callback needs the five
  sites (interface, createSimContext, Sim binding, both test stub hosts, and the pinned
  callback-name list in tests/sim_context.test.ts).
- The bite minigame: startFishing keeps its deny arms and cast start but draws ONE seeded
  bite delay (roughly 3 to 8 s; exact numbers and curve are yours, named constants). The
  delay NEVER rides castRemaining/castTotal (they are broadcast per entity in dynamicFields;
  a modified client could read the bite time): store it in hidden state and read the Pin-cost
  appendix's storage-decision brief BEFORE choosing where. At the bite tick, emit a text-free
  personal SimEvent (the fishingResult idiom) that drives the bobber VFX and cue, and arm a
  server-authoritative reaction deadline in sim ticks (the lockpick stepDeadlineTick
  precedent; the client never reports the timeout). Re-pressing the fishing pole inside the
  window lands the catch through the existing completeFishing table draw; the re-press rides
  the existing useItem dispatch (it lands in the current "You are busy" branch in
  src/sim/items.ts useItem; the wire command census does not change). A miss is "it got
  away": the cast ends, a personal line renders, recast immediately, no other loss.
- Rod synergy: better rods (gatherToolTier over the fishing profession, composing with the
  Phase 12 band gating) shorten the average bite delay and widen the reaction window; named
  constants, pinned.
- Server authority: bite timing, the deadline, and the catch resolve server-side; online the
  client only sends the re-press command.

Agent ui/render deliverables:
- The gather cast bar label (the castDisplayName sentinel map in hud.ts and the castBarState
  fishing flag in src/render/cast_bar.ts generalize over the shared predicate; a new
  abilityUi.cast key for gathering, English-only).
- Bobber bite feedback: a visible bite state on the fishing bobber VFX plus the cue, so the
  moment is never sound-only (accessibility); the reaction window is attention, not
  reflexes: generous by default.
- Cue routing with PLACEHOLDER clips: gather cast/strike, a rare-strike variant keyed off
  gatherResult rarity/rareEvent, fish cast, bite, reel. Placeholders are SANCTIONED:
  deterministic local synthesis (scripts/sfx/ui_sfx.mjs cue() specs, ui_* keys), routed per
  the src/game/CLAUDE.md recipe (the bite cue is timing/affordance so it rides the
  always-audible play() arm, never playFeedback()), npm run sfx:manifest, npm run sfx:check
  green, catalog rows marked PLACEHOLDER for the sound engineer, and issue #2208 references
  them. No second cue on grant lines the loot hub already covers (the Phase 4 double-log
  trap).
- The /cast readout for fishing stays honest without leaking the bite time (see the appendix
  row for the readout literal, its em-dash trap, and the status-registry coupling).
- Every new player string is an English-only t() key; sim-origin lines ship their matcher
  rule or ride text-free id events in the SAME change (fishing.ts and gathering.ts are on
  the S3 scan list; the guard reds otherwise).

Agent tests deliverables:
- Execute the Pin-cost appendix: every listed pin is re-pinned deliberately, in its own
  reviewed commit where the appendix says so (parity golden regens especially); nothing
  outside the appendix list may weaken.
- New coverage: the bite-delay draw contract (draw count per cast/miss/land/codfather as you
  land them), the hidden-state invariant (the bite delay appears in NO wire snapshot field),
  the deadline boundary (re-press at the deadline tick vs one past it), rod synergy arms,
  gather cast duration arms (tool tier above requirement, band scaling, the floor),
  completion re-validation arms (node respawned away, bags filled mid-cast, walked out of
  range), a same-seed determinism pin for both loops, and a live GameServer round trip for
  the bite-and-reel flow.

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: all randomness through Rng; the bite delay is ONE draw at a fixed position;
  gather draws stay at completion in their existing order; deadlines derive from ticks,
  never wall clock.
- Anti-cheat: the bite delay and deadline are never readable from any broadcast field;
  server authority for every outcome.
- IWorld both worlds: any new read or command lands on a facet, implemented LIVE in BOTH
  Sim and ClientWorld, parity-pinned in the same change (the 2033 stub trap).
- i18n: English-only catalog keys; the S3 guard stays green (fishing.ts and gathering.ts
  are on its scan list).
- Fairness: the cast bar, bobber, and bite cue are graphics-preset-identical; the bite is
  never sound-only.
- Prime directive: nothing existing breaks. Every node, corpse pull, and catch reachable
  before this phase stays reachable; the only change is WHEN the resolve happens and the
  fishing wait becoming interactive. Tool effects/charges stay PARKED.

Out of scope (do NOT do in this phase):
- Tool effects, charges, recharge (parked, wave 2+).
- AFK-style repeated-attempt loops or any auto-recast.
- New fishing or gathering content (tables, nodes, items).
- The corpse-harvest interaction (instant today, stays instant this phase).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- npx tsc --noEmit; npx vitest run tests/professions_fishing.test.ts
  tests/gather_node_harvest.test.ts tests/professions_gathering.test.ts
  tests/gather_node_interact.test.ts tests/gather_open_gate.test.ts
  tests/gather_node_online.test.ts tests/gather_rare_events.test.ts tests/sim.test.ts
  tests/casting_command.test.ts tests/architecture.test.ts tests/sim_context.test.ts
- Parity: npx vitest run tests/parity (regens ONLY per the appendix, each in its own
  reviewed commit).
- net/wire row: npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts
  tests/bandwidth.test.ts tests/world_api_parity.test.ts
- i18n row: npm run i18n:gen then npx vitest run tests/i18n_completeness.test.ts
  tests/localization_fixes.test.ts
- SFX: npm run sfx:manifest && npm run sfx:check
- npm run ci:changed; scoped biome on touched files.
Then spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md (expect architecture-reviewer,
cross-platform-sync, frontend-seam-reviewer, and qa-checklist to match). Prompt each for
COVERAGE, not filtering. Resume truncated agents; never act on a truncated report.

STEP 4 - COMMIT CADENCE (explicit paths, never git add -A, every commit carries a body):
- refactor(sim): extract the shared non-spell-cast predicate
- feat(professions): the gather cast bar
- feat(professions): the fishing bite minigame
- test(sim): re-pin the appendix set; regen the appendix goldens (own commit per regen)
- feat(ui): cast labels, bobber bite feedback, placeholder cues

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] A node harvest runs a visible cast; duration responds to tool tier above the node
      requirement and proficiency band, floored; completion re-validates range, respawn,
      and capacity; moving cancels free.
- [ ] All eleven exemption sites (plus the two new-cast joins) route through the shared
      predicate for the fishing/gather semantics; DEMON_HEAL_CAST_ID folds in only at sites
      where its behavior was already byte-identical (per the sim deliverable), and any site
      where it stays ad hoc is listed in state.md.
- [ ] Fishing draws the hidden bite delay exactly once per cast; the bite fires a text-free
      personal SimEvent; the catch lands only on a pole re-press inside the
      server-authoritative window; a miss costs nothing but the cast.
- [ ] The bite delay appears in no broadcast wire field, pinned by test.
- [ ] Rods shorten average bite delay and widen the window, pinned.
- [ ] Every Pin-cost appendix row is executed exactly as briefed; no unlisted pin weakened.
- [ ] Placeholder cues pass sfx:check, are marked PLACEHOLDER in the catalog, and #2208
      lists them.
- [ ] The validation rows above are green in both hosts.

STEP 6 - DOC UPDATES + MEMORY:
Update docs/professions-2/progress.md (status row, checklist, phase-start commit) and
docs/professions-2/state.md (New surfaces per phase: the predicate name and its consumer
count, GATHER_CAST_ID, the bite-state storage choice actually made and its golden
consequence, the named timing constants into Tuning targets, the new i18n keys and cue
keys). Record surprises to memory.

STEP 7 - FINAL RESPONSE FORMAT:
Phase status; files touched; validation results per command; review verdicts; the appendix
execution report (each row: re-pinned as briefed / deviation with reason); deferrals; one
line for the Phase 12b QA handoff naming the phase-start commit.

STOPPING RULES:
- Stop if the bite delay cannot stay hidden without a new broadcast field; that is a design
  contradiction to surface, not a wire change to make.
- Stop if any pin OUTSIDE the appendix list would need weakening; the appendix is the
  complete pre-briefed cost, so an unlisted red means the design or the appendix is wrong.
- Stop if Phase 12's rod bands cannot express the synergy without redesign.
```

## Pin-cost appendix (inventoried 2026-07-20 against release/v0.29.0, 35c85b312)

Every test, literal, and golden this phase is EXPECTED to move, so the implementer re-pins
deliberately instead of discovering the blast radius mid-flight. Anything outside this list
that reds is a defect in the change, not an accepted cost. Re-inventoried by the Phase 12
QA session against the Phase 12 merge (a57e43b78) plus the QA PR's own pins: the last
three rows below cover the pins that landed AFTER the original inventory point and keep
this list closed.

- `tests/professions_fishing.test.ts`, describe "fishing one-draw rng contract (pin 2)": the
  one-draw-per-cast contract ("draws exactly one rng value per normal cast, including the
  no-bite outcome") and its bags-full sibling re-pin to the new draw contract (the bite-delay
  draw at startFishing plus the table draw at the reel). The codfather zero-draw pin
  ("codfather branch: zero draws, ...") re-pins to whichever codfather handling lands (keeping
  the codfather cast bite-roll-free preserves zero-draw; rolling unconditionally makes it one
  draw; either is fine, pin what ships and note it in state.md).
- Same file, describe "fishing determinism (pin 1)" and "fishing band selection liveness
  (pin 6)": the band-0/band-1/band-2 LITERAL seed-4242 catch sequences and the 30-catch
  same-seed pin re-record under the new draw order. TRAP (Phase 11 QA): a literal band
  sequence is only decisive if it contains a draw inside a band-DISCRIMINATING window; hunt
  the divergence index before sizing the new literals.
- Same file, describe "startFishing arms through the extracted module path (pin 10)": the
  "fixed 5 s cast and draws no rng" pin inverts (the cast start now draws the bite delay);
  the five deny arms keep their exact error literals and must stay zero-draw-and-no-castStart.
- Same file, describe "fishing over the live server (pin 8)": the live GameServer round trip
  waits out the fixed 5 s cast wall-clock-ticked; its wait arithmetic changes under the bite
  model (drive the bite deterministically by seed, do not sleep).
- `tests/sim.test.ts`, inside describe "food, drink, vendor" (there is no fishing-named
  describe): "starts a five-second fishing cast near and facing Mirror Lake" pins
  castTotal/castRemaining at the FISHING_CAST_TIME literal, plus the "rolls the fishing catch
  table only when the cast completes" and "rejects fishing away from fishable water"
  siblings; all re-pin to the new cast shape.
- The /cast readout: `castingReadout` in `src/sim/social/chat_readouts.ts` prints "You are
  fishing" with remaining/total seconds, pinned LITERALLY in `tests/casting_command.test.ts`
  ("special-cases the fishing sentinel"). Under the bite model the readout must stay honest
  without leaking the bite time (e.g. no meaningful countdown during the waiting phase).
  THREE coupled traps: (a) the current literal carries a grandfathered em dash that predates
  the repo no-dash rule (the readout itself is an ALLOW_V07_SLASH English-backstop surface in
  tests/localization_fixes.test.ts, an i18n exemption, NOT a dash exemption); any reword must
  drop the em dash per the repo rule; (b) the readout is status-registry-backed English (not
  a t() catalog key), so a reword updates src/ui/i18n.status.json via the scan, not a
  catalog; (c)
  the localization_fixes probe substituter deliberately avoids desyncing the fishing/overpower
  backstop forms that share "total/remaining"; keep that coupling intact.
- Parity: `professions_gather` (tests/parity/scenarios.ts, golden
  tests/parity/golden/professions_gather.json) snapshots immediately after SYNCHRONOUS
  harvestNode calls; the gather cast defers draws and grants to completion, so this golden
  REGENERATES and its HUNTED seed 3 (chosen for a rare-event window inside 100 harvests) must
  be RE-HUNTED against the new drive shape. Own reviewed commit.
- Parity: the two fishing-cancel scenarios (`c4a_casting_lifecycle`, snapshot label
  "warlock-fishing-cancel", and `fiesta_midcast_kill`, label "midcast-fishcancel") BYPASS
  startFishing (the drive assigns the casting fields directly: c4a sets
  castingAbility/castRemaining/castTotal, fiesta sets only castingAbility and castRemaining
  and leaves castTotal at its prior value), so they do NOT regen from the bite-delay draw;
  they only move if the cancel semantics or the assigned fields change. Verify rather than
  regen; whatever field shape each drive assigns is what its checkpoint samples pin.
- Parity storage decision (make it EXPLICITLY, before coding): the digest harness
  (tests/parity/trace.ts) samples entities and player meta through exclude lists then
  canonicalizes with omitDefaults, so a new field ESCAPES all 56 goldens only while its value
  is inert (0, false, '', null, empty array) at every sampled frame; {} is deliberately NOT
  inert, and any nonzero sampled value (a stored bite tick, a pending node id) forces a full
  56-golden regen (the Phase 8/9 precedent; deliberate, own commit). The alternatives: (a) a
  PlayerMeta/Entity field that is nonzero only mid-cast and cleared after may stay inert at
  every existing checkpoint, but any future scenario sampling mid-cast regens; (b) a
  module-local pid-keyed map escapes the digest entirely but pins weaker (parity cannot see
  desync in it) and needs its own cleanup discipline (player eviction); (c) extending
  ENTITY_EXCLUDE/META_EXCLUDE is itself a re-pin (tests/parity/harness.test.ts pins exact
  membership). Pick one, record the choice and its consequence in state.md.
- `tests/gather_node_harvest.test.ts`: "a player near a node receives the material item on
  harvest" (tolerates one tick today; a 2.5 s cast is ~50 ticks, so the drive changes), "a
  harvest grants the matching gathering profession one point of skill", "spends exactly two
  rng draws on a granted harvest and none on any denial path" (the pair moves to completion
  time), and both gatherResult emission pins. `tests/professions_gathering.test.ts` "a queued
  grant only takes effect once sim.tick() runs" survives (the queue mechanism is untouched).
  The interact/deny/online arms in tests/gather_node_interact.test.ts,
  tests/gather_open_gate.test.ts, and tests/gather_node_online.test.ts gate the new cast
  start and re-validation; extend, do not orphan.
- SimContext: a new completion callback (e.g. completeGatherCast) needs the five-site append
  (interface, createSimContext passthrough, Sim binding, the two test stub hosts) plus the
  pinned callback-name list in tests/sim_context.test.ts (the Phase 7 trap).
- The wire: castRem/castTot ride dynamicFields only while castingAbility is set; the gather
  cast reuses that shape for free. Do NOT add any bite field beside them.
- (post-inventory, Phase 12 + its QA) `tests/professions_fishing.test.ts`, describe
  "fishing band tool cap (Professions 2.0 Phase 12)": the five literal-sequence arms (the
  three rod-cap arms, the pole-only proficiency-0 byte-identity walk, and the QA's "a high
  rod never buys bands" proficiency-arm pin) re-record under the new draw order exactly
  like pins 1 and 6, same band-discriminating-window trap; and "useItem on each new rod
  starts the standard fishing cast" pins the cast start at FISHING_CAST_ID with the
  castStart emit, so it re-pins to the new bite cast-start shape.
- (post-inventory, Phase 12 + its QA) `tests/professions_tools.test.ts`, describe
  "sim-level node access gating (Professions 2.0 Phase 12)": the deny, unlock, owned-best,
  requiredTier-3, and herbalism arms drive harvestNode synchronously with exact
  gatherDenied shapes and a zero-draw deny pin; extend them to the new cast entry point
  (extend, do not orphan), and the deny-is-rng-free property must hold at cast START (a
  denied attempt draws nothing and starts no cast).
- (post-inventory, Phase 12 + its QA) `tests/gather_node_harvest.test.ts`, describes
  "node tool gate ordering (Phase 12)" and "Phase 12 determinism (same seed, same drive)":
  the deny-order pins (respawn before tool gate, tool gate before bags-full) and the
  hot-path exactly-two-draws pin re-home to the cast-completion shape; the determinism
  drive re-shapes under the cast, and its fishDraws liveness pin (completeFishing called
  directly, bypassing startFishing, exactly one table draw) survives only while the reel
  keeps its single draw, re-pin consciously if that draw moves. The corpse premium-arm
  suite (tests/corpse_harvest_sim.test.ts) is OUTSIDE this phase's blast radius: 12b adds
  no corpse timing.
- (post-inventory, Phase 12b QA, 2026-07-20) The QA pass added pins inside this
  appendix's blast radius (the standing re-inventory rule; all additive, nothing
  weakened, every one mutation-verified): tests/gathering_rhythm.test.ts gained the
  deadline-tick no-miss arm (the tick phase runs AT the deadline and must not miss; a
  `>` to `>=` flip previously survived the suite), a cast-end-clears describe pinning
  cancelCast (with the stale-deadline instant-reel scenario), arena reset, fiesta down,
  and the defensive session-cap end, the useItem busy-guard gather arm, and same-draw
  rod-synergy literals (seed 4242 first cast: bare 127 / tier-2 107 / tier-3 87 ticks,
  decisive on the reduction in both directions); tests/game_audio.test.ts gained the six
  cue ROUTING pins (five feedback-gated, fishBite on the always-audible arm);
  tests/cast_bar.test.ts pins fishing fill 1 under broadcast decay plus the gather
  honest fill; tests/gather_event_i18n.test.ts re-tightened the fishingResult arm to
  exactly one cue (exact-set form); tests/sim.test.ts re-pinned castTotal/castRemaining/
  castStart.time to the literal 15 (constant-self-comparison removal); and
  tests/gather_node_interact.test.ts pinned the 2.5 s base-duration literal.
