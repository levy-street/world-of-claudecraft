# Phase 01: Ring and identity foundations

This phase lands the blueprint identity foundations inside PR 2039's merge window: the
`CRAFT_RING` reorder to the design-doc order, pair-named archetype titles replacing the ten
per-craft practitioner titles, and the five should-fix review items on PR 2039 itself. It is its
own slice because the ring order, and the canonical pair ids derived from it, become persistent
the moment any player attunes: everything here must land before a single player persists
`attunedPairs` pair ids derived from the old ring, and no later phase can wait on that window.

## Context pointers

- `docs/professions-2/state.md`: locked ring order, the validation matrix, and the verified
  post-2039 surfaces (archetype module shape, `cprof` wire key, combo gate).
- `docs/professions-2/progress.md`: the Phase 1 deliverable checklist to mirror on completion.
- `docs/professions-2/implementation-plan.md`: team workflow and the Review Dispatch Matrix.
- `src/sim/content/professions.ts`: `CRAFT_RING`, the reorder target.
- `src/sim/professions/archetype.ts`: `archetypePairId`, `ARCHETYPE_PAIR_TARGETS`,
  `attunedPairs`, `hobbyCandidatesForPair`; every ring-derived surface and the
  `normalizeArchetypeState` back-compat path live here.
- `src/sim/professions/combo_eligibility.ts`: the shared combo gate (deny reasons
  `not_attuned` / `wrong_pair` / `tier_unmet`) that must keep working across the reorder.
- `src/sim/content/recipes.ts`: `COMBO_RECIPES`, the two pairs whose ring adjacency must survive
  the reorder (armorcrafting plus weaponcrafting, alchemy plus engineering).
- `src/ui/i18n.catalog/hud_chrome.ts`: the existing per-craft `archetypeTitle` keys to retire and
  the home for the ten new pair-title keys.
- `getArchetypeTitle` and every consumer: the identity card, the attunement preview, dialog
  labels, and the nameplate title path (the Explore agent locates the exact call sites).
- Pinned suites to re-pin: `tests/professions.test.ts`, `tests/archetype_ceiling.test.ts`,
  `tests/combo_eligibility.test.ts`, `tests/snapshots.test.ts`.
- `CLAUDE.md` (root), `src/sim/CLAUDE.md`, `src/ui/CLAUDE.md`.

## Starter Prompt

```
This is Phase 01 of the Professions 2.0 feature: Ring and identity foundations.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: land the blueprint identity foundations (ring reorder, pair-named archetype titles, the
five PR 2039 review resolutions) DIRECTLY ON the PR 2039 branch, which the maintainer now owns
outright, so the PR merges once, already correct, and pair ids derived from the old ring never
exist in any deployed build.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Verify `git status` is clean before starting. If not, ask the user (a concurrent session may
  share this checkout).
- Memory scan: check the MEMORY.md index for entries relevant to this phase, at minimum: the
  node25 gate rule (run npm run gate under Node 24), the professions-2-program entry (the
  maintainer owns the PR 2039 branch; amendments land on it pre-merge), and the
  combo-recipes-broken-online entry (#2033, the ClientWorld stub trap for professions wire
  parity).
- This phase's working branch IS the PR 2039 branch: bring its head into a maintainer-owned
  branch (or push rights on the existing head), apply the release-branch sync above TO IT
  (2039 was cut from an older release/v0.27.0 head; merge the newest release in and run the
  release-merge-audit skill), and do all Phase 1 work on top. The PR history is yours to
  clean: rewrite or squash so every commit carries a body.

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn an Explore agent to read and summarize:
- docs/professions-2/state.md (locked decisions, validation matrix, key existing surfaces)
- docs/professions-2/progress.md (Phase 1 status plus deliverable checklist)
- docs/professions-2/phase-01-ring-and-identity.md (this prompt; verify the agent has the same
  understanding)
- src/sim/content/professions.ts (CRAFT_RING)
- src/sim/professions/archetype.ts (archetypePairId, ARCHETYPE_PAIR_TARGETS, attunedPairs,
  hobbyCandidatesForPair, normalizeArchetypeState)
- src/sim/professions/combo_eligibility.ts
- src/sim/content/recipes.ts (COMBO_RECIPES)
- src/ui/i18n.catalog/hud_chrome.ts (the archetypeTitle keys)
- tests/professions.test.ts, tests/archetype_ceiling.test.ts, tests/combo_eligibility.test.ts,
  tests/snapshots.test.ts
- CLAUDE.md (root), src/sim/CLAUDE.md, src/ui/CLAUDE.md
The summary must return: the current CRAFT_RING order; every surface that derives from ring
order or adjacency (index math, opposite and hobby maps, pair-id canonicalization, pinned test
expectations); the attunedPairs shape and how normalizeArchetypeState loads it; the two
COMBO_RECIPES pairs and their eligibility path; the exact archetypeTitle key names and every
consumer of getArchetypeTitle (identity card, attunement preview, dialog labels, nameplate title
path); and the five outstanding PR 2039 should-fix review items with their locations.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Fan out THREE agents in parallel (request the fan-out explicitly; Opus 4.8 will not
self-initiate it). Give each agent ONLY the Explore summary, never the raw planning docs.
Worktree isolation is unnecessary unless two agents end up editing the same file.

Agent sim-content deliverables:
- Reorder CRAFT_RING in src/sim/content/professions.ts to the design-doc order: engineering,
  alchemy, cooking, leatherworking, tailoring, inscription, enchanting, jewelcrafting,
  weaponcrafting, armorcrafting.
- Audit EVERY surface deriving from ring order or adjacency and regenerate each one:
  ARCHETYPE_PAIR_TARGETS, the opposite and hobby maps (hobbyCandidatesForPair), the
  archetypePairId canonical ids, and any index math on CRAFT_RING anywhere in src/sim/.
- Verify both content COMBO_RECIPES pairs stay ring-adjacent under the new order (they do:
  armorcrafting plus weaponcrafting, alchemy plus engineering); pin that adjacency in a test so
  a future reorder cannot silently break a combo recipe.
- Re-pin every geometry and pair expectation in tests/professions.test.ts,
  tests/archetype_ceiling.test.ts, tests/combo_eligibility.test.ts, and
  tests/snapshots.test.ts (deliberate re-pins with the new canonical values, never loosened
  assertions).
- Back-compat: make normalizeArchetypeState map or cleanly default any pre-reorder attunedPairs
  ids. First assert that no player data exists yet (PR 2039 is unmerged, so none should); if
  that assertion cannot be made, write the explicit id mapping.

Agent i18n-identity deliverables:
- Add the ten pair-archetype title keys to src/ui/i18n.catalog/hud_chrome.ts in ENGLISH only:
  Smith, Outfitter, Apothecary, Bombardier, Trapper, Mageweaver, Arcanist, Gembinder,
  Bladewright, Cogsmith (map each name to its canonical pair id from ARCHETYPE_PAIR_TARGETS).
- Change getArchetypeTitle to resolve the PAIR name, and update every consumer so the pair name
  renders wherever a title shows: the identity card, the attunement preview, dialog labels, and
  the nameplate title path.
- Retire the ten per-craft practitioner title keys with full i18n hygiene: remove the keys,
  remove every reference, run npm run i18n:gen, and confirm no orphaned rows remain in the
  generated bundles or locale overlays (never hand-edit the overlays).

Agent coordination deliverables (PR 2039 review items):
- Resolve all five should-fix review items so PR 2039 merges:
  1. Matcher rows for the two src/sim/quests/quest_commands.ts error strings plus the S3
     scan-list line (sim-origin player text needs its sim_i18n matcher rows in the same change).
  2. Reword "Part of #1295" in the PR body.
  3. Revert the 13 Latin-overlay hand fills (locale overlays are release-time maintainer work).
  4. Add bodies to the commits that lack them.
  5. Fix the PRD staleness.
- All amendments land in PR 2039 itself (the maintainer owns the branch; nothing is set in
  stone). The final response records the amended PR's head and its green CI run.

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: all randomness via Rng; no Math.random / Date.now / performance.now anywhere in
  src/sim/ (guarded by tests/architecture.test.ts).
- JSONB back-compat: normalizeArchetypeState must map or cleanly default any pre-reorder
  attunedPairs; assert no player data exists yet or write the mapping. Never lose or corrupt
  persisted state.
- Wire parity (cprof): craftingIdentity stays live in BOTH Sim and ClientWorld; any IWorld
  surface touched is implemented in both worlds and parity-pinned in
  tests/world_api_parity.test.ts. Verify liveness, not just member shape (the 2033 stub trap).
- Server authority: the client never decides combo eligibility outcomes; the server
  re-validates. The pre-cprof syncing state keeps the combo Craft button optimistically enabled
  by design (locked decision in state.md).
- i18n: every new player string is a t() key added in ENGLISH ONLY to
  src/ui/i18n.catalog/hud_chrome.ts; never edit the locale overlays; sim/server player text
  gets its matcher rule in src/ui/sim_i18n.ts / src/ui/server_i18n.ts in the SAME change (the
  S3 guard, tests/localization_fixes.test.ts, enforces it).
- Prime directive: nothing existing breaks. Every existing suite stays green; deprecate rather
  than delete anything players may hold.

Out of scope (do NOT do in this phase):
- The masterwork model (Phase 2).
- Stations in any form (Phases 8 and 9).
- The professions wheel window (Phase 5).
- Any new quest content (Phases 7 and 14).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- Run the state.md validation matrix rows for this change type: the net/wire row, the sim row,
  and the i18n row.
  - npx tsc --noEmit
  - npx vitest run tests/professions.test.ts tests/archetype_ceiling.test.ts
    tests/combo_eligibility.test.ts tests/snapshots.test.ts tests/world_api_parity.test.ts
  - npx vitest run tests/architecture.test.ts (sim purity plus determinism guard)
  - npx vitest run tests/env_protocol.test.ts tests/bandwidth.test.ts (rest of the net/wire row)
  - npm run i18n:gen, then npx vitest run tests/i18n_completeness.test.ts
    tests/localization_fixes.test.ts (i18n row plus the S3 guard)
- Spawn review agents per the Review Dispatch Matrix in
  docs/professions-2/implementation-plan.md; check git diff --name-only against the phase-start
  commit and spawn ONLY matching rows.
- Prompt every review agent for COVERAGE, not filtering: report every issue including
  low-severity and uncertain ones; ranking happens in a later step.
- Resume any agent that truncates with: "Stop reading more files. Output the full report now
  based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX /
  NICE-TO-HAVE / VERDICT."
- Do not commit while any BLOCKING finding stands.

STEP 4 - COMMIT CADENCE:
Aim for three commits (Conventional Commits with a scope; EXPLICIT paths, never git add -A;
every commit carries a body of 1 to 4 sentences saying what changed and why):
- feat(professions): adopt the blueprint craft ring order
- feat(i18n): pair-named archetype titles
- chore(professions): resolve PR 2039 review items

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] CRAFT_RING matches the blueprint order exactly: engineering, alchemy, cooking,
      leatherworking, tailoring, inscription, enchanting, jewelcrafting, weaponcrafting,
      armorcrafting.
- [ ] Zero surfaces still derive from the old rotation: the derivation audit found and
      regenerated every one (pair targets, opposite and hobby maps, canonical pair ids, index
      math, test pins).
- [ ] Both COMBO_RECIPES pairs verified ring-adjacent under the new order, pinned by a test.
- [ ] Pair names render everywhere a title shows: identity card, attunement preview, dialog
      labels, nameplate title path; the per-craft practitioner keys are gone with no orphans.
- [ ] normalizeArchetypeState back-compat is asserted (no pre-reorder player data exists) or
      the explicit id mapping is written and tested.
- [ ] All five PR 2039 should-fix review items closed; the PR merges inside the window.
- [ ] Parity and snapshot suites green: tests/world_api_parity.test.ts,
      tests/snapshots.test.ts, plus the three professions suites.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md: Phase 1 status plus the mirrored deliverable
  checkboxes.
- Update docs/professions-2/state.md. It gains: the final hudChrome pair-title key names under
  "New surfaces per phase" (the Phase 1 row moves from planned to landed, with the re-pinned
  ring geometry test names); the locked-decision note confirmed in place, that the pre-cprof
  syncing state keeps the combo Craft button optimistically enabled (the server re-validates);
  and the PR 2039 OPEN item resolved with the actual merge outcome and timing.
- Record to memory anything surprising (an unexpected ring derivation site, a 2039 merge
  complication) for the next session.

STEP 7 - FINAL RESPONSE FORMAT:
End your turn with: phase status, files touched, validation results, review-agent verdicts, any
deferred items, and a one-line handoff for the Phase 01 QA session.

STOPPING RULES:
- Stop and surface to the maintainer if the PR 2039 branch cannot be updated or its release
  merge produces conflicts beyond this phase's scope; the ring reorder must not land detached
  from the PR.
- Stop and surface to the maintainer if any production player already holds attunedPairs pair
  ids derived from the old ring: a save migration becomes required and is not in this phase's
  scope to improvise.
```
