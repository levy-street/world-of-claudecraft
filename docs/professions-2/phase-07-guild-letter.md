# Phase 07: The Guild letter

This phase makes the game notice a player's crafting trend and respond in-world: a pure
trending-pair classifier (the #1295 gap) watches `craftSkills`, and when the leading adjacent
pair first crosses the letter threshold on an unattuned character, the Crafting Guild sends
exactly one letter through the existing mail system naming the master to visit for the 2039
intro attunement quest. It is its own slice because it is the first moment the professions
loop reaches out to the player, it depends only on surfaces that already exist (the wheel,
the mail pipeline, the 2039 quest content), and it carries a standalone hygiene payoff: the
S3 localization scanner finally covers `src/sim/quests/quest_commands.ts`.

## Context pointers

- `docs/professions-2/state.md`: locked decisions, the validation matrix, key existing
  surfaces (wheel math, archetype state, quest surfaces), and the planned Phase 7 entry
  under "New surfaces per phase".
- `docs/professions-2/progress.md`: phase status; check whether Phase 1 already resolved
  the 2039-review tutorial-panel timing item (deliverable 4 is conditional on this).
- `docs/professions-2/implementation-plan.md`: the team workflow and the Review Dispatch
  Matrix (the one canonical copy).
- `src/sim/professions/wheel.ts`: the 2039 `nearTier`/`dormantKnowledge` nudges,
  `TIER_SKILL_STEP`, `tierForSkill`; the trend classifier is a sibling module here.
- `src/sim/professions/archetype.ts`: `attunedPairs`, `archetypePairId`,
  `ARCHETYPE_PAIR_TARGETS`; the "player is unattuned" check and the master-name mapping.
- `src/sim/mail/post_office.ts` and `src/sim/content/letters.ts`: the mail delivery path
  and the id-based letters pipeline the Guild letter must ride.
- The 2039 profession intro attunement quest content: quest ids and the master NPCs the
  letter must name.
- `src/sim/quests/quest_commands.ts`: the file joining the S3 scan list; every
  player-facing string in it needs matcher coverage.
- `tests/localization_fixes.test.ts`: the S3 scan list and guard.
- `src/ui/sim_i18n.ts`: the sim-text matcher where letter body and quest-command strings
  resolve to `t()` keys.
- `src/sim/CLAUDE.md`, `tests/CLAUDE.md`, `src/ui/CLAUDE.md`: local conventions for the
  three areas this phase touches.

## Starter Prompt

```
This is Phase 07 of the Professions 2.0 feature: The Guild letter.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: the game notices a player's crafting trend via a pure trending-pair classifier, an
unattuned character crossing the letter threshold receives exactly one Crafting Guild letter
through the existing mail system naming the master for the 2039 intro attunement quest, and
the S3 quest-text localization blind spot closes for good.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Run git status; the checkout must be clean (a concurrent session may share it). If it is
  dirty, stop and report instead of working around it.
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries; at minimum read:
  node25-breaks-jsdom-gate (run the gate under Node 24), the PR 2039 professions state
  (toolchain and merge context for the intro quest content this phase links to), and
  combo-recipes-broken-online (the ClientWorld stub trap: verify liveness, not shape, for
  anything that must reach the online client).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-07-guild-letter.md (this file)
- src/sim/professions/wheel.ts and src/sim/professions/archetype.ts
- src/sim/mail/post_office.ts and src/sim/content/letters.ts
- the 2039 profession intro attunement quest content (locate it under src/sim/content/)
- src/sim/quests/quest_commands.ts, tests/localization_fixes.test.ts, src/ui/sim_i18n.ts
- src/sim/CLAUDE.md, tests/CLAUDE.md, src/ui/CLAUDE.md
The summary must return: the locked decisions and validation matrix rows that bind this
phase; the wheel constants and nudge signals the classifier can build on; the exact shape of
PlayerMeta.craftSkills and the attunement state (attunedPairs, archetypePairId); how a letter
is authored, id-resolved, and delivered today (content record, post_office call sites, client
matcher); the intro attunement quest ids and their master names per pair; the current S3 scan
list mechanics and which quest_commands.ts strings are player-facing; whether progress.md
shows the Phase 1 session already fixed the tutorial-panel timing item; and any surprises
that contradict this phase file.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Fan out three agents in parallel; give each ONLY the Explore summary, never raw planning
docs. Worktree isolation is not needed unless two agents must edit the same file.

Agent sim deliverables (trend module + letter trigger):
- A pure trending-pair classifier module, sibling to wheel.ts under src/sim/professions/
  (suggested: src/sim/professions/trend.ts). Input: a craftSkills map. Output: the leading
  ADJACENT pair on CRAFT_RING (adjacency per the locked ring order in state.md) and whether
  it crossed the letter threshold. Export a named letter-threshold constant chosen against
  the existing wheel tier steps (do not invent an unrelated number); deterministic, pure,
  host-agnostic, no Rng draw needed. This closes the #1295 gap.
- The letter trigger: when the classifier reports a first threshold crossing AND the player
  is unattuned (no attunedPairs entry, no archetypePairId), deliver the Crafting Guild
  letter once via the existing mail system. Persist a one-shot sent flag on PlayerMeta
  (additive JSONB with a normalize-on-load default). The flag, not a re-evaluated predicate,
  is the single-fire gate.
- The backfill guard: an existing character already past the threshold at load gets exactly
  one letter on its first evaluation and never another on later loads or logins; no burst.
- The tutorial-panel timing fix from the 2039 review (the panel renders exactly once at the
  first cap moment): first check the Explore summary; if Phase 1 already resolved it, record
  that and skip; otherwise fix it test-first, even if the defect lives in UI code.

Agent content/i18n deliverables (letter text + matcher):
- The Crafting Guild letter content record in src/sim/content/letters.ts: id-based body per
  the letters pipeline, parameterized on the leading pair and the master to visit, pointing
  the player at the 2039 intro attunement quest. The sim stays language-agnostic: it emits
  the letter id plus values only.
- English catalog entries for the letter body and subject in the matching
  src/ui/i18n.catalog/<domain>.ts module (English only; if any value is wordy per M16, add
  its five non-Latin fills in the same change).
- Matcher coverage in src/ui/sim_i18n.ts for the letter body id and for EVERY player-facing
  string already in src/sim/quests/quest_commands.ts.

Agent tests deliverables:
- Unit tests for the classifier: leading-pair selection, adjacency per the locked ring,
  threshold boundary behavior, and determinism (same input, same output).
- Letter delivery tests: fresh character crosses the threshold and gets exactly one letter
  naming the correct master; attuned character gets none; skill hovering at the threshold
  never re-fires (hysteresis via the one-shot flag); backfill single-fire for a high-skill
  character loaded from a legacy save shape.
- The S3 scan-list change in tests/localization_fixes.test.ts:
  src/sim/quests/quest_commands.ts joins the scan scope, and the guard test proves the file
  is scanned (the guard must FAIL if the file leaves the list).

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: the sim is a fixed 20 Hz tick; all randomness through Rng (the classifier
  itself must be pure and draw nothing); no Math.random, Date.now, or performance.now in
  src/sim/ (guarded by tests/architecture.test.ts).
- src/sim/ stays language-agnostic and DOM-free: the letter body travels as an id plus
  values; English lives in the catalog; the S3 matcher duty is satisfied in the SAME change.
- Server authority: letter delivery and the sent flag resolve in the sim that the server
  runs; the client never decides delivery.
- IWorld both-worlds where relevant: this phase should ride the EXISTING mail wire surface;
  if any new IWorld member proves necessary, implement it in BOTH Sim and ClientWorld and
  update the parity pin (tests/world_api_parity.test.ts) in the same change, verifying
  liveness rather than member shape.
- i18n: every new player-visible string is an English-only t() key in the catalog; never
  edit locale overlays.
- Prime directive: nothing existing breaks. The letter fires once, never spams existing
  characters (the backfill guard), and all persisted-state changes are additive with
  normalize-on-load defaults.

Out of scope (do NOT do in this phase):
- The full attunement quest content for the four wave-one archetypes (Phase 14).
- Trend nudge CHAT cadence beyond the letter (Phase 14).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
Run the state.md validation matrix rows for this change type (sim-only plus i18n keys
added):
- npx tsc --noEmit
- npx vitest run tests/localization_fixes.test.ts tests/professions_skill.test.ts
- npx vitest run <the new trend and letter test files>
- npx vitest run tests/architecture.test.ts
- npm run i18n:gen, then npx vitest run tests/i18n_completeness.test.ts
- npm run ci:changed; format only changed files with a scoped
  npx @biomejs/biome check --write <file>
Then spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY
matching rows (expected here: architecture-reviewer for the src/sim/ change,
cross-platform-sync for the sim_i18n.ts matcher and any sim behavior change,
frontend-seam-reviewer only if the tutorial-panel fix touched src/ui/, and qa-checklist once
the deliverable set is complete). Prompt every review agent for COVERAGE, not filtering:
report every correctness or requirement gap with confidence and severity; filtering happens
in a later pass. If any agent's output is truncated, spawn a fresh agent to resume from the
last complete item rather than re-running the whole task. No commit while any BLOCKING
finding stands.

STEP 4 - COMMIT CADENCE:
Commit with explicit paths, never git add -A; every commit carries a body (what changed and
why, wrapped near 72 columns). Expected sequence:
- feat(professions): add the trending-pair classifier
  (src/sim/professions/trend.ts plus its test file)
- feat(content): deliver the Crafting Guild letter on first trend crossing
  (letters content, post_office trigger, catalog keys, matcher rules, letter tests)
- fix(i18n): bring quest commands into the S3 scan list
  (tests/localization_fixes.test.ts, src/ui/sim_i18n.ts)
- fix(ui): render the profession tutorial panel exactly once (ONLY if the Phase 1 check
  shows the item unresolved)

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] A fresh character crossing the letter threshold receives exactly one Crafting Guild
      letter naming the correct master for its leading adjacent pair.
- [ ] An existing high-skill character already past the threshold receives exactly one
      letter on first evaluation, never a burst, and never another on later loads.
- [ ] An attuned character never receives the letter; skill hovering at the threshold never
      re-fires it.
- [ ] The classifier is pure and deterministic, unit-tested, and exported from its own
      module under src/sim/professions/.
- [ ] The letter body is id-based in the sim; English text lives in the catalog; the
      matcher resolves it; the S3 guard is green.
- [ ] The S3 guard FAILS if src/sim/quests/quest_commands.ts leaves the scan list, and
      every player-facing string in that file has matcher coverage.
- [ ] The tutorial panel renders exactly once at the first cap moment, or progress.md
      documents that Phase 1 already resolved it.
- [ ] All STEP 3 validation commands are green and no BLOCKING review finding stands.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md: Phase 7 status, dates, and the mirrored
  deliverable checkboxes; append any deferral or surprise to Notes.
- Update docs/professions-2/state.md "New surfaces per phase": replace the planned Phase 7
  line with the actual surfaces (the trend module path and exported symbols including the
  letter-threshold constant, the Guild letter content id, the one-shot PlayerMeta flag name
  and its normalize-on-load default, and the S3 scan list gaining
  src/sim/quests/quest_commands.ts). Record the phase-start commit hash for the QA session.
- Record genuine surprises (not routine progress) to Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT:
Report: phase status (complete / partial with reasons); files touched (absolute paths);
validation results (each command and its outcome); review verdicts per spawned agent;
deferrals with owners; and a one-line QA handoff naming the phase-start commit for
phase-07-qa.md to diff against.

STOPPING RULES:
No phase-specific rules. Baseline applies: stop and report if pre-flight finds a dirty
checkout, if a locked decision in state.md contradicts this phase file, or if validation
cannot be brought green without violating an invariant; never commit past a BLOCKING
finding.
```
