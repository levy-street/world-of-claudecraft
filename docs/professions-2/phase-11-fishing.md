# Phase 11: Fishing joins the framework

Fishing becomes a real gathering skill that feeds cooking: a proficiency counter in the gathering
framework and a catch rarity ladder over the existing tables, without touching what makes the
minigame fun. It is its own slice because it converts one self-contained system (the fishing block
inside `src/sim/sim.ts`) onto seams that already exist (gathering proficiency, `gprof`,
`rollMaterialRarity`), and the module extraction it requires must land as one atomic
move-not-rewrite change.

## Context pointers

- `docs/professions-2/state.md`: locked decisions, the validation matrix, and the OPEN item this
  phase resolves (whether fishing keeps a separate skill id or folds into the `professionsState`
  shape; the answer here is: follow the gathering row pattern).
- `docs/professions-2/progress.md`: what Phases 4 (rarity-colored gather feedback), 5 (the
  professions wheel window) and 10 (cooking inputs for higher-band catches) actually landed.
- `docs/professions-2/implementation-plan.md`: the Review Dispatch Matrix (the one canonical copy).
- `src/sim/sim.ts` fishing block: `startFishing`, `completeFishing`, and the `FISHING_TABLES` /
  `FISHING_RARE_ID` usage (imports near the top, logic around the two private methods).
- `src/sim/professions/gathering.ts`: the gathering proficiency accrual pattern and
  `rollMaterialRarity` (one draw, pinned), the model fishing adopts.
- `src/sim/deeds.ts`: the fish marks (the glimmerfin rare-catch deed path) that must keep working.
- Server wire: the `prof`/`gprof` self-wire pattern (`server/game.ts` delta emit,
  `src/net/online.ts` absorb, `ALL_DELTA_KEYS` / `TERSE_TO_IWORLD` pins in
  `tests/snapshots.test.ts`).
- `src/ui/gathering_view.ts`: `buildGatheringProficiencyRows` and its character window consumer;
  plus the Phase 5 professions wheel window (see the state.md "New surfaces per phase" entry for
  its landed paths).
- `src/sim/CLAUDE.md`, `src/sim/professions/CLAUDE.md`, `src/ui/CLAUDE.md`: local conventions for
  the areas touched.

## Starter Prompt

```
This is Phase 11 of the Professions 2.0 feature: Fishing joins the framework.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Goal: make fishing a real gathering skill feeding cooking (proficiency plus a catch rarity
ladder) without touching what makes the minigame fun.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- `git status` must be clean (a concurrent session may share the checkout); stop and report if it
  is not.
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries, at minimum:
  node25-breaks-jsdom-gate (run the gate under Node 24), combo-recipes-broken-online (the 2033
  stub trap: the gprof/cprof self-wire recipe and the liveness duty), and the design language
  program (no DESIGN.md phase vocabulary in the new UI rows).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-11-fishing.md (this phase file)
- src/sim/sim.ts fishing block: startFishing, completeFishing, and every FISHING_TABLES /
  FISHING_RARE_ID touch point
- src/sim/professions/gathering.ts: gathering proficiency accrual and rollMaterialRarity
- src/sim/deeds.ts fish marks (the glimmerfin deed path)
- server/game.ts gprof delta emit and src/net/online.ts gprof self-wire, plus the
  ALL_DELTA_KEYS / TERSE_TO_IWORLD pins in tests/snapshots.test.ts
- src/ui/gathering_view.ts (buildGatheringProficiencyRows and its character window consumer) and
  the Phase 5 professions wheel window modules named in state.md
- src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md, src/ui/CLAUDE.md
The summary must return: the exact boundaries of the fishing block in sim.ts (every symbol and
private field it touches), the Rng draw sequence for a cast and a catch, the gathering
proficiency accrual and band pattern, the gprof wire path end to end, where gathering rows
render in the character window and the wheel window, what the Phase 4 rarity-colored loot line
module is, the glimmerfin deed trigger, and which tests currently pin fishing, deeds, and
snapshots.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Fan out three agents; each gets ONLY the Explore summary, never the planning docs. The sim agent
lands first (the extraction plus mechanics); the integration and tests agents run against its
result.

Agent sim deliverables:
- Extract the fishing logic from src/sim/sim.ts into a new src/sim/professions/fishing.ts module
  behind the SimContext seam, in the same change as the mechanics below (module-first; sim.ts is
  an active extraction target). Move-not-rewrite: the relocated code keeps its exact Rng draw
  order for the cast timer and table draws; sim.ts becomes a thin consumer and its net line
  count must not grow.
- Fishing proficiency: an additive counter in the gathering framework, following the gathering
  row pattern (the professionsState / gprof shape), gained per successful catch. This resolves
  the state.md OPEN item: fishing folds into the gathering proficiency shape; no separate skill
  id.
- Catch rarity ladder: FISHING_TABLES keyed by proficiency band through the shared
  rollMaterialRarity pattern (one draw, pinned). The rare catch (FISHING_RARE_ID) and its deed
  stay exactly as shipped; higher-band catches are the cooking inputs authored in Phase 10, no
  new items here.

Agent integration deliverables:
- Wire: fishing proficiency rides the existing gprof pattern end to end (server/game.ts emit,
  src/net/online.ts absorb, the IWorld gathering read). Any new or widened IWorld member lands
  on the matching src/world_api facet file, implemented in BOTH Sim and ClientWorld, with the
  parity pin in tests/world_api_parity.test.ts updated in the same change. Verify liveness, not
  just member shape (the 2033 stub trap).
- UI: fishing rows in the character window gathering panel (via the gathering_view.ts row
  builder) and in the professions wheel window; catch feedback uses the Phase 4 rarity-colored
  loot line. Every player string is an English-only t() key in the matching
  src/ui/i18n.catalog/<domain>.ts module; respect the design-language guardrails in
  docs/professions-2/implementation-plan.md (today's tokens only, mobile rules).
- Capture before/after screenshots (desktop and mobile, the pr-screenshots skill), committed
  under docs/screenshots.

Agent tests deliverables:
- A determinism test for the extracted module: fixed seed, the cast timer and catch sequence are
  identical across runs, and band 0 reproduces the shipped FISHING_TABLES results (draw order
  unchanged by the extraction).
- Proficiency tests: catches accrue proficiency in the gathering shape; rarity band rises at the
  band thresholds; the one-draw rollMaterialRarity usage is pinned.
- Wire tests: the gprof round trip carries the fishing row (snapshot pins updated deliberately);
  the glimmerfin deed still completes (tests/deeds.test.ts, extended if the trigger moved files).
- Update, never orphan, any existing fishing tests the extraction relocates.

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: all randomness through Rng (never Math.random / Date.now / performance.now in
  sim logic); the cast timer and table draws keep their existing draw order; the extraction is
  move-not-rewrite.
- Server authority: catches, proficiency gain, and loot resolve server-side; the client renders.
- IWorld both worlds: every new read lands on a facet file, implemented in BOTH Sim and
  ClientWorld, parity-pinned in the same change; verify liveness, not member shape.
- Wire parity: the gprof shape stays consistent across server, ClientWorld, and the RL surface.
- i18n: every player-visible string is an English-only t() key; sim/server player text ships as
  a stable id plus values re-localized by the client matcher, in the SAME change (the S3 guard,
  tests/localization_fixes.test.ts).
- Prime directive: nothing existing breaks. The fishing pole, the shipped FISHING_TABLES
  behavior at the baseline band, the rare catch, and the glimmerfin deed all keep working
  exactly as shipped.

Out of scope (do NOT do in this phase):
- New fishing spots or fishing zone content.
- Tool tiers for rods (Phase 12 covers rods with the rest of tool gating).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
Run the state.md validation matrix rows for sim and net/wire changes, plus the ui/render and
i18n rows for the UI-facing part of the diff:
- npx tsc --noEmit
- npx vitest run <the fishing tests, existing and new>
- npx vitest run tests/deeds.test.ts
- npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts
  tests/world_api_parity.test.ts
- npx vitest run tests/architecture.test.ts
- npm run i18n:gen, then npx vitest run tests/i18n_completeness.test.ts
  tests/localization_fixes.test.ts
- the mobile guard trio if a window changed (tests/mobile_window_coverage.test.ts,
  mobile_window_transform.test.ts, mobile_window_layout.test.ts)
- npm run ci:changed; format only changed files with a scoped
  npx @biomejs/biome check --write <file>
Then spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY matching
rows (expect architecture-reviewer, cross-platform-sync, frontend-seam-reviewer, and
qa-checklist once the deliverable set is complete). Prompt every review agent for COVERAGE, not
filtering: report every correctness or requirement gap with confidence and severity; filtering
happens afterward in the main session. If any subagent output is truncated, re-spawn it to
resume from the truncation point instead of restarting the whole pass.

STEP 4 - COMMIT CADENCE:
2 to 4 commits, explicit paths only (never git add -A), Conventional Commits, every commit
carries a body:
- refactor(sim): extract the fishing module behind SimContext
- feat(professions): fishing proficiency and catch rarity ladder
- feat(ui): fishing rows in the gathering panel and wheel window

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] Successful catches grant fishing proficiency in both hosts (offline Sim, and online via
      the gprof round trip).
- [ ] Catch rarity rises with proficiency band; band 0 reproduces the shipped tables for the
      same seed.
- [ ] The glimmerfin rare catch and its deed still complete unchanged.
- [ ] src/sim/professions/fishing.ts exists behind SimContext; the sim.ts net line count did
      not grow.
- [ ] All STEP 3 validation commands pass and no BLOCKING review finding stands.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md: phase status, decisions made, deferrals, the
  phase-start commit hash for QA.
- Update docs/professions-2/state.md: append a Phase 11 entry to "New surfaces per phase"
  (src/sim/professions/fishing.ts, the fishing row in the gprof/professionsState shape, the
  proficiency-band FISHING_TABLES keying, the UI rows and their i18n key namespace), and resolve
  the fishing OPEN item (fishing folds into the gathering proficiency shape; remove the OPEN
  row).
- Record durable surprises to memory.

STEP 7 - FINAL RESPONSE FORMAT:
Report: phase status; files touched; validation results per command; review verdicts per agent;
deferrals; one line for the QA handoff (the phase-start commit hash plus what QA should probe
first).

STOPPING RULES:
No phase-specific stopping rules. Packet defaults apply: stop and report rather than force a
fix if a determinism pin fails in a way that implies the draw order changed, or if the
extraction cannot stay move-not-rewrite without a behavior change.
```
