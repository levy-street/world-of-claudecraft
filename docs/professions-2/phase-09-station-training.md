# Phase 09: Station presence and recipe training

Phase 8 landed the typed station registry and master NPC records in sim and server; this phase
makes them real to players. Stations render as visible props in the world, show on the minimap,
and their masters teach recipes for gold through a Train view that is skill-tier gated with a
visible locked-row ladder (the 2026-07-17 amendment: the RuneScape-style unlock ladder,
delivered on the LEARNING side, never on use), while a grandfathering step
backfills every pre-existing recipe as known so acquisition goes live without stranding anyone.
It is its own slice because it is the presentation-and-wire half of stations: the sim/server
truth exists (Phase 8), and the recipe ladder content that depends on live training is Phase 10.

## Context pointers

- `docs/professions-2/state.md`: locked decisions binding this phase (acquisition via
  `acquireRecipe`, the grandfathering rule, training fee AND teach-tier tuning targets, hands
  vs stations, the 2026-07-17 skill-tier training ruling),
  the validation matrix, and the Phase 8 "New surfaces" entry (station registry, master NpcDefs).
- `docs/professions-2/progress.md`: current status and the Phase 8 handoff.
- `docs/professions-2/implementation-plan.md`: review dispatch matrix and design-language
  guardrails (today's tokens only; no DESIGN.md phase vocabulary).
- `src/render/props.ts` (prop placement patterns) and `src/render/characters/manifest.ts`
  (`NPC_KEYS`; `npc_smith` exists, `npc_villager` is the fallback), plus `src/render/CLAUDE.md`.
- `src/ui/minimap_markers.ts` and `src/ui/minimap_painter.ts`: the marker union and painter.
- `src/ui/hud/vendor/`: the vendor window family (`vendor_view.ts` pure core,
  `vendor_window.ts` painter; the heroic variant shows how the family extends).
- `src/sim/professions/crafting.ts` (`acquireRecipe`, `acquireRecipeForRecipe`,
  `isRecipeKnown`), `src/sim/professions/types.ts` (`knownRecipes`),
  `src/sim/professions/crafting_hub.ts` (today's station gate), and the Phase 8 station
  registry module named in `state.md`.
- `src/world_api/professions.ts` (the facet for the new command) and
  `tests/world_api_parity.test.ts` (the pin).
- `server/game.ts` (command dispatch) and `src/net/online.ts` (wire command send plus the
  `ClientWorld` mirror; `prof`/`gprof`/`ncd`/`cprof` self-wire keys are the pattern).
- Local conventions: `src/sim/CLAUDE.md`, `src/sim/professions/CLAUDE.md`,
  `src/render/CLAUDE.md`, `src/ui/CLAUDE.md`, `src/ui/hud/CLAUDE.md`,
  `src/world_api/CLAUDE.md`, `src/styles/CLAUDE.md`.

## Starter Prompt

```
This is Phase 09 of the Professions 2.0 feature: Station presence and recipe training.
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: make stations visible places whose masters teach recipes for fees behind a visible
skill-tier ladder, and turn recipe acquisition on without stranding any existing character.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Run git status. The tree must be clean (a concurrent session may share this checkout);
  stop and report if it is not.
- Scan Claude Code memory (the MEMORY.md index) for: node25-breaks-jsdom-gate (run the gate
  under Node 24), the PR 2039 state (the professions foundation surfaces this phase builds on),
  and the design-language program (DESIGN.md is adopted but unlanded; today's tokens only).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-09-station-training.md (this phase file)
- src/render/props.ts, src/render/characters/manifest.ts (NPC_KEYS), src/ui/minimap_markers.ts,
  src/ui/minimap_painter.ts, the src/ui/hud/vendor/ modules, src/sim/professions/crafting.ts,
  src/sim/professions/types.ts, src/sim/professions/crafting_hub.ts, the Phase 8 station
  registry module (see state.md "New surfaces per phase"), src/world_api/professions.ts,
  server/game.ts (command dispatch only), src/net/online.ts (command send + ClientWorld mirror)
- CLAUDE.md files: src/sim/CLAUDE.md, src/sim/professions/CLAUDE.md, src/render/CLAUDE.md,
  src/ui/CLAUDE.md, src/ui/hud/CLAUDE.md, src/world_api/CLAUDE.md, src/styles/CLAUDE.md
The summary must return: the locked decisions and fee tuning targets that bind this phase;
the STATIONS registry shape and the master NpcDef ids from Phase 8; the vendor window family
pattern (pure view core + painter, and how the heroic variant extends it); the minimap marker
union shape and how markers are tested against both host shapes; the existing wire command and
self-wire delta-key patterns in online.ts and game.ts to copy; where knownRecipes persists and
where normalize-on-load steps live; the ui/render and net/wire validation matrix rows; and
where the review dispatch matrix lives.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Fan out four agents; give each ONLY the Explore summary plus the files it owns. The render, ui,
and sim/wire agents edit disjoint files and run in parallel; the tests agent runs after them.

Agent render deliverables:
- src/render/stations.ts: a new module the renderer calls (never a method bank on renderer.ts)
  that places props per the STATIONS registry. Reuse anvil.glb for the smithing-family stations
  and the existing campfire for cooking; simple prop-cluster placeholders (existing crates,
  tables, props) for the rest. Prefer reuse this phase: any NEW GLB must go through the media
  manifest regen + registerPreload + the asset budget, so avoid one unless indispensable.
- Masters render via NPC_KEYS entries in src/render/characters/manifest.ts (npc_smith exists;
  the npc_villager fallback is acceptable for the remaining masters this phase).
- A station minimap marker variant: extend the marker union in src/ui/minimap_markers.ts and
  paint it in src/ui/minimap_painter.ts with token colors only (zero hex literals outside
  tokens.css/theme.ts) and tier-identical rendering (no graphics preset may hide or degrade it).

Agent ui deliverables:
- The master dialog gains a Train view on the vendor window family (src/ui/hud/vendor/): a
  DOM-free pure view core (registered in UI_PURE_CORES if it is a new module) plus a thin
  write-elided painter, following the heroic vendor variant as the extension template.
- Rows show the recipe, the fee (formatMoney), and a KNOWN / TEACHABLE / LOCKED tri-state.
  Locked rows are the visible ladder (2026-07-17 ruling): always SHOWN, grayed, with their
  requirement named ("Taught at <craft> 50"), never hidden; crossing the threshold is the
  unlock moment the ladder points at. The Train action
  issues the IWorld command; denial reasons render through the server/sim matcher keys.
- Every player-visible string is an English-only t() key in the matching
  src/ui/i18n.catalog/<domain>.ts module; mobile rules per src/styles/CLAUDE.md (a deliberate
  body.mobile-touch rule or a reasoned MOBILE_WINDOW_EXCEPTIONS entry; 40px tap floor).

Agent sim/wire deliverables:
- A trainRecipe command: a member on the IWorld professions facet (src/world_api/professions.ts),
  implemented in BOTH worlds (Sim: full validation + grant offline; ClientWorld: send the wire
  command online), with the parity pin updated in tests/world_api_parity.test.ts in the same
  change. Verify liveness, not just member shape (the 2033 stub trap).
- Server validation in the command dispatch (server/game.ts): proximity to the master's
  station, fee affordable and charged, recipe teachable at this master, AND the skill-tier
  gate (the 2026-07-17 ruling): a master teaches a recipe only when tierForSkill(the
  player's craft skill) >= tierForSkill(the recipe's skillReq), the general predicate, so
  the wave-one ladder is common always, uncommon at 25, rare at 50, and any
  higher-skillReq recipe a later phase authors gates by the same formula with no extra
  rule (the state.md teach-tier tuning target). Hobby crafts use the same thresholds. The gate is
  on LEARNING only; known recipes are never use-gated (the no-admission-gate rule stands
  untouched). On success grant via
  acquireRecipe. Fee and grant resolve SERVER-side; the client never decides. Fees follow the
  state.md tuning targets (common tier free, uncommon 25s, rare 1g) and are a gold sink.
- Denial reasons are emitted as stable ids the client matcher re-localizes (S3 duty, in the
  SAME change), including the tier denial (for example 'train_tier_unmet' carrying the
  craft and the required skill value).
- Grandfathering: a normalize-on-load step backfills every recipe id that existed before this
  phase as known, for offline saves and server-persisted state alike; deterministic and
  idempotent (running it twice changes nothing).
- New tier recipes from Phase 10 onward default to trained-not-known: set that default on the
  recipe definition now and document it at the type, since the acquisition path is now live.

Agent tests deliverables:
- Train command tests: the happy path (fee charged exactly once, recipe known after), the
  denial paths (out of range, insufficient gold, not teachable at this master, already known,
  BELOW the teach tier), and replay/idempotency (a resent or duplicated command cannot
  double-charge or double-grant).
- Teach-tier gate tests: a below-tier player is denied with the stable tier reason and sees
  the locked row; crossing the threshold flips the row to teachable; the hobby craft uses
  the same thresholds; common recipes never lock; a known recipe is NEVER use-gated
  regardless of skill (pin the no-admission-gate rule against the new predicate).
- A grandfather test on a legacy save fixture (a pre-phase state blob with craftable recipes
  and no acquisition records) proving nothing is lost. This test is the phase gate.
- The minimap marker variant tested against BOTH host shapes (tests/minimap_markers.test.ts).
- Parity and wire pins updated (tests/world_api_parity.test.ts; the ALL_DELTA_KEYS and
  TERSE_TO_IWORLD pins in tests/snapshots.test.ts if a new wire key lands).

INVARIANTS THIS PHASE MUST KEEP:
- Determinism: all sim randomness through Rng; never Math.random, Date.now, or performance.now
  in src/sim/; the fixed 20 Hz tick (guarded by tests/architecture.test.ts).
- Server authority: the fee and the grant resolve server-side; the client is a renderer and
  never decides outcomes.
- IWorld both worlds: every new read or command lands on a facet file, implemented live in
  BOTH Sim and ClientWorld, parity-pinned in the same change.
- i18n: every player-visible string is an English-only t() key; sim/server player text ships
  as stable ids with matcher rules in the SAME change (S3 guard:
  tests/localization_fixes.test.ts).
- Design language: today's tokens and the shared window shell only; no DESIGN.md phase
  vocabulary (new ramp/radius/duration tokens, font flips, window grammar fragments).
- Prime directive: nothing existing breaks. The grandfathering test is the gate; every
  pre-phase character keeps everything it could craft.

Out of scope (do NOT do in this phase):
- Recipe ladder content (tier ladders, material families): Phase 10.
- Quest hooks at the masters (attunement quests, nudges): Phase 14.
- Tool effects/charges (parked), salvage or enchanting UI (Phase 13), market/mail instance
  carriage (wave 2).

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
- Run the ui/render and net/wire rows of the validation matrix in docs/professions-2/state.md:
  npx tsc --noEmit
  npx vitest run tests/localization_fixes.test.ts
  npx vitest run tests/mobile_window_coverage.test.ts tests/mobile_window_transform.test.ts
    tests/mobile_window_layout.test.ts
  npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts tests/bandwidth.test.ts
    tests/world_api_parity.test.ts
- Plus the phase-named suites and the new tests:
  npx vitest run tests/minimap_markers.test.ts tests/snapshots.test.ts
    tests/world_api_parity.test.ts plus the new train and grandfather test files
- i18n keys were added: npm run i18n:gen, then
  npx vitest run tests/i18n_completeness.test.ts tests/localization_fixes.test.ts
- Sim changed: npx vitest run tests/architecture.test.ts
- Desktop AND mobile screenshots (the station visible in the world; the Train view open) via
  the pr-screenshots skill, committed under docs/screenshots.
- Spawn review agents per the Review Dispatch Matrix in
  docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY
  matching rows.
- Prompt every review agent for COVERAGE, not filtering: report every correctness or
  requirement gap with confidence and severity; filtering happens in a later pass.
- If any agent response comes back truncated, re-spawn that agent to resume from its last
  completed item; never treat partial output as a full report.

STEP 4 - COMMIT CADENCE (explicit paths, never git add -A; every commit carries a body):
- feat(render): station presence (stations module, master NPC keys, minimap marker variant)
- feat(professions): skill-tier-gated recipe training with server-side fee and grant, plus
  grandfathering
- feat(ui): the Train view on the vendor window family
- docs(professions-2): Phase 9 progress, state surfaces, and screenshots

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] A player can walk to a visible station in the world (props placed per the STATIONS
      registry).
- [ ] The station shows on the minimap with the new marker variant, token-colored and
      tier-identical, tested against both host shapes.
- [ ] Opening the master presents the Train view; learning a recipe charges the fee and grants
      it via acquireRecipe in BOTH the offline Sim and the online ClientWorld.
- [ ] The Train view shows locked rows with their named requirement; a below-tier train
      attempt denies with the localized tier reason; crossing the tier makes the row
      teachable (the visible ladder); a known recipe is never use-gated regardless of skill.
- [ ] Fees match the state.md tuning targets (common free, uncommon 25s, rare 1g), are charged
      server-side as a gold sink, and a replayed command cannot double-charge or double-grant.
- [ ] Every character that existed before this phase knows every recipe it could previously
      craft (grandfather normalize step plus the legacy fixture test, green).
- [ ] New recipes default to trained-not-known from Phase 10 onward (default in place and
      pinned by a test).
- [ ] All STEP 3 validation commands green; parity pin updated; no BLOCKING review finding
      stands; desktop and mobile screenshots committed under docs/screenshots.
- [ ] No new GLB shipped; or, if one was truly needed, the media manifest was regenerated,
      registerPreload wired, and npm run asset:budget is green.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md (Phase 9 checklist and status, plus the phase-start
  commit for the QA diff) and docs/professions-2/state.md: the "New surfaces per phase" list
  gains Phase 9 (src/render/stations.ts; the station minimap marker variant; the trainRecipe
  facet member and wire command; the teach-tier predicate and its denial id; the grandfather
  normalize step; the Train view i18n key
  namespace; the trained-not-known recipe default). Resolve or explicitly defer the OPEN item
  "exact FIELD_RECIPES membership" (the default stands: the 9 common recipes stay
  field-craftable) and record the outcome in state.md.
- Record durable surprises (wire quirks, fixture gotchas) to Claude Code memory.

STEP 7 - FINAL RESPONSE FORMAT:
- Phase status (complete, or partial with why), files touched, validation results per command,
  review verdicts per agent, deferrals with reasons, and a one-line QA handoff naming the
  phase-start commit for the diff.

STOPPING RULES:
- Stop immediately, without committing the acquisition switch, if grandfathering cannot be
  proven on a legacy save fixture; report what the fixture shows and wait for the maintainer.
- Stop and report if any deliverable would require violating a locked decision in state.md;
  never improvise around one.
```
