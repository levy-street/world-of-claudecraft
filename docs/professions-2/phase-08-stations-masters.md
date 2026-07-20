# Phase 08: Stations and masters (sim and server)

This phase makes crafting stations real in the world model: a typed station registry with named
master NPCs, the hands-vs-stations rule live in the sim-side craft gate, and an automated proof
that no profession NPC or station sits inside hostile aggro range. It is its own slice because it
is pure sim and content work with no rendering: Phase 9 (props, minimap, training UX) can only
build on stations that already exist, gate correctly, and are provably placed safely.

## As-landed deviations (2026-07-19, authoritative over the starter prompt below)

- The deny reason follows the Phase 6 text-free-id precedent, NOT a `sim_i18n` matcher row:
  `station_required` rides the existing `craftResult` SimEvent reason enum, and the ui resolves
  the station name from `recipeById(ev.recipeId)?.stationType` via
  `hudChrome.crafting.stationRequired` + `stationName.<type>` (`src/ui/hud.ts` mapping). The
  event carries NO stationType value (recipe content is static and identical in both worlds).
  `sim_i18n` is for free sim text; the S3 guard is satisfied by construction and stays green.
- One extra IWorld read landed beyond the plan: `activeMobileStationCraft`
  (IWorldProfessions), live in BOTH worlds via the `mst` self-delta mirror, because the
  crafting window's per-type range set needs the viewer's own active mobile station and the
  #2033 liveness rule forbids a dead null stub.
- The parity goldens were regenerated in their own reviewed commit: the six static masters
  shift the world-ctor entity-id counter by exactly +6 (id-family keys only, rng draw order
  untouched, determinism arms green). Expected for any future static-NPC addition.

## Context pointers

- `docs/professions-2/state.md`: locked decisions (hands vs stations, FIELD_RECIPES default of the
  nine common recipes, economy sinks, prime directive) and the validation matrix.
- `docs/professions-2/progress.md`: the Phase 8 deliverable checklist to mirror on completion.
- `docs/professions-2/implementation-plan.md`: team workflow and the Review Dispatch Matrix.
- `src/sim/professions/crafting_hub.ts`: today's gate, `canUseCraftingHubStation(pos, level)` with
  its proximity radius and min-level rule; the model this phase generalizes.
- `src/sim/content/professions.ts`: `CRAFTING_HUB_STATIONS` (per-craft coordinates derived from
  `CRAFT_RING`, unrendered); the new `STATIONS` records land beside it.
- `src/sim/professions/types.ts`: `ProfessionRecipeRecord.requiresHubStation` (the boolean this
  phase replaces with a typed `stationType`).
- `src/sim/professions/crafting.ts`: `resolveCraft` / `resolveCraftForRecipe`, the sim-side gate
  chain (station, combo eligibility, known recipe, materials, throttle plus gold sink).
- `src/sim/professions/mobile_station.ts`: the dormant mobile-station perk module,
  `isStationActive(station, nowTick)`, and its inert-module header comment.
- `src/sim/content/recipes.ts`: `COMMON_RECIPES` (the nine field recipes), `TOOL_RECIPES` (six)
  and `CASTER_HUB_RECIPES` (three) which carry `requiresHubStation: true` today, `COMBO_RECIPES`.
- `src/sim/content/zone1.ts`: `ZONE1_NPCS` (`trader_wilkes` is the NpcDef exemplar with
  `vendorItems`, `questIds`, `greeting`), `ZONE1_MOBS` (`aggroRadius`), `ZONE1_CAMPS`.
- `src/sim/content/zone2.ts` (`ZONE2_NPCS`, the Fenbridge hub) and `src/sim/content/zone3.ts`
  (`ZONE3_NPCS`, the Highwatch hub): the out-of-hub masters live here per the 2026-07-17
  placement ruling in `state.md`.
- `src/sim/types.ts`: `NpcDef`, `CampDef` (`mobId`, `center`, `radius`, `count`), `MobTemplate`
  (`aggroRadius`), the CAMPS draw-order determinism contract on `WorldContent`.
- `src/ui/world_entity_i18n.ts`: entity name i18n registration (`tEntity` resolution path) for the
  six master names, titles, and greetings.
- `src/sim/CLAUDE.md`, `src/sim/content/CLAUDE.md`, `src/sim/professions/CLAUDE.md`,
  `src/ui/CLAUDE.md` (S3 matcher duty), `tests/CLAUDE.md`.

## Starter Prompt

```
This is Phase 08 of the Professions 2.0 feature: Stations and masters (sim and server).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Goal: typed stations with named masters exist in the world model, the hands-vs-stations rule is
live in the sim-side craft gate, and placement is provably safe via an automated test.

STEP 0 - PRE-FLIGHT:
- Sync with the LATEST release branch FIRST: git fetch origin "+refs/heads/release/*:refs/remotes/origin/release/*"; pick
  the newest by version sort (git branch -r --list "origin/release/*" | sort -V | tail -1). If this phase
  starts a fresh branch or worktree, base it on that branch; if the feature branch already exists, merge
  that release branch into it NOW, resolve conflicts, and run the release-merge-audit skill on the merge
  before proceeding. Never base work on main or an older release branch than the newest.
- Run `git status`: the working tree must be clean (a concurrent session may share the checkout).
  If it is not clean, stop and report.
- Scan Claude Code memory (the MEMORY.md index) for phase-relevant entries, at minimum:
  node25-breaks-jsdom-gate (run the gate under Node 24), the PR 2039 professions state
  (combo_eligibility, cprof, attunedPairs), and combo-recipes-broken-online (#2033: the
  liveness-not-shape trap for professions surfaces).

STEP 1 - LOAD CONTEXT (do NOT read planning docs directly):
Spawn one Explore agent to read and summarize:
- docs/professions-2/state.md and docs/professions-2/progress.md
- docs/professions-2/phase-08-stations-masters.md (this phase file)
- src/sim/professions/crafting_hub.ts, src/sim/professions/crafting.ts (the resolveCraft /
  resolveCraftForRecipe gate chain), src/sim/professions/types.ts,
  src/sim/professions/mobile_station.ts
- src/sim/content/professions.ts (CRAFTING_HUB_STATIONS, CRAFT_RING) and
  src/sim/content/recipes.ts (COMMON_RECIPES, TOOL_RECIPES, CASTER_HUB_RECIPES, COMBO_RECIPES,
  every requiresHubStation carrier)
- src/sim/content/zone1.ts (ZONE1_NPCS with trader_wilkes as the NpcDef exemplar, ZONE1_MOBS
  aggroRadius, ZONE1_CAMPS), src/sim/content/zone2.ts (ZONE2_NPCS) and src/sim/content/zone3.ts
  (ZONE3_NPCS) for the out-of-hub masters, and the NpcDef / CampDef / MobTemplate shapes in
  src/sim/types.ts
- src/ui/world_entity_i18n.ts (entity-name i18n registration path)
- src/sim/CLAUDE.md, src/sim/content/CLAUDE.md, src/sim/professions/CLAUDE.md, src/ui/CLAUDE.md
  (the S3 matcher duty), tests/CLAUDE.md
The summary MUST return: the exact gate order inside resolveCraftForRecipe and where the station
check sits; the current proximity radius and level rule in canUseCraftingHubStation; the exact id
list of the nine COMMON_RECIPES and of the nine requiresHubStation recipes with their
professionId; the NpcDef field set and how entity names localize (tEntity); the CampDef and
aggroRadius fields the placement test needs plus the CAMPS append-only determinism contract; how
mobile_station.ts expects to be wired per its header; where sim-origin deny reasons get matched
to t() keys today (sim_i18n matcher) and which test guards it (S3).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Fan out three parallel implementation agents: a sim agent (station registry plus gate), a content
agent (masters plus placement), and a tests agent. Give each agent ONLY the Explore summary plus
its deliverable list below; they do not read planning docs. The sim and content agents both touch
src/sim/content/professions.ts and src/sim/professions/types.ts surfaces, so sequence those two
edits (sim agent lands types and registry first, content agent fills records after) or isolate in
worktrees; the tests agent runs after both.

Agent sim deliverables:
- A typed station registry as its own module, src/sim/professions/stations.ts (module-first; do
  not grow crafting.ts beyond the gate hook): a StationType union
  'forge' | 'kitchens' | 'apothecary' | 'tannery' | 'loom' | 'toolworks', a StationDef record
  { id, type, zoneId, pos, masterNpcId }, and pure lookup helpers (stations of a type, standing
  at a station of a type using the existing proximity rule from crafting_hub.ts).
- STATIONS content records in src/sim/content/professions.ts, generalizing CRAFTING_HUB_STATIONS
  (data-as-code, so the table itself belongs in content). Migrate or delegate the old
  CRAFTING_HUB_STATIONS consumers; do not leave two competing sources of truth.
- ProfessionRecipeRecord gains stationType (optional StationType), generalizing
  requiresHubStation. Map the nine existing requiresHubStation recipes (six TOOL_RECIPES, three
  CASTER_HUB_RECIPES) to the station type of their professionId. Retire requiresHubStation and
  its readers in the same change if nothing else consumes it; otherwise delegate it.
- The gate in resolveCraftForRecipe: recipes in FIELD_RECIPES craft anywhere; every uncommon+
  recipe requires standing at its stationType. Deny with a STABLE reason id (for example
  'station_required' carrying the stationType value); add the matching t() key (English only)
  and the sim_i18n matcher rule in the SAME change (S3 duty).
- Retire the level gate: the STATIONS registry replaces CRAFTING_HUB_MIN_LEVEL and no
  station gate reads player level (the 2026-07-17 placement ruling); migrate or retire
  canUseCraftingHubStation's level arm with its consumers and prove no recipe strands.
- FIELD_RECIPES: a named set that is exactly the nine existing COMMON_RECIPES ids today. The T
  window keeps working for them everywhere.
- Mobile crafting station goes live: an active station (isStationActive) satisfies the station
  gate; the placement command becomes reachable, SPECIALIZATION-gated per the locked decision
  (the 75-skill perk is the craft-anywhere unlock beat; an additional dev-command path for
  testing is fine), following the existing perk command pattern; update the inert-module header
  in mobile_station.ts to describe the now-wired state.

Agent content deliverables:
- Six master NpcDefs, one per station type, spread across the three zone hubs per the
  2026-07-17 placement ruling in state.md: in the zone 1 hub (ZONE1_NPCS) the smith at the
  forge (covers both weaponcrafting and armorcrafting, matching the Smith pair), the cook
  at the kitchens, the tailor at the loom, and engineering's toolwright at the toolworks,
  so every wave-one archetype keeps a zone-1 anchor master; the leatherworker's tannery
  roots in Fenbridge (ZONE2_NPCS); the alchemist's apothecary roots in Highwatch
  (ZONE3_NPCS, keeping the #1297 crafting-hub lore without its level gate). Follow the
  trader_wilkes exemplar shape. The maintainer may reshuffle the assignment in PR review
  (a data-only move); flag it in the PR body beside the naming pass.
- Each master: a real name and title and greeting registered through the entity i18n path
  (src/ui/world_entity_i18n.ts, tEntity); starter vendorItems (base tools and reagents, stock
  only, training UX is Phase 9); an EMPTY questIds hook array for Phase 14.
- Names are content flavor the maintainer may rename (state.md OPEN item); make them real, not
  lorem, and note the naming-pass flag in the PR body.
- Station placements: guard-safe town locations inside each hosting hub, each master beside
  its station. CRAFTING_HUB_STATIONS offsets are ZONE-3 coordinates (offsets from
  CRAFTING_HUB_POS at the Highwatch hub, per src/sim/content/professions.ts): they may seed
  only the Highwatch apothecary placement; the Eastbrook and Fenbridge placements are new
  coordinates. (The level-gate retirement itself is the sim agent's deliverable above.)
- Adding the masters must NOT shift the shared Rng draw order (the CAMPS append-only contract;
  NPC creation draws no rng).

Agent tests deliverables:
- The automated placement-safety test (a new tests file, for example
  tests/professions_station_placement.test.ts): derived from spawn CONTENT, not hardcoded
  distances. For every profession NPC and every STATIONS record, distance to every hostile camp
  (mob template aggroRadius > 0) must exceed camp.radius plus the template's aggroRadius plus a
  buffer, derived PER ZONE (a Fenbridge master checks against zone 2 camps, the Highwatch
  master against zone 3 camps). Choose the buffer as the strictest value every existing town
  NPC already satisfies and document it in the test; prove the test can fail by temporarily
  moving one master next to a camp, observing the failure, then restoring.
- A master-to-zone assignment pin: the state.md default (four archetype anchors in zone 1;
  tannery in Fenbridge; apothecary in Highwatch) pinned as literals so an accidental move
  fails the test; a deliberate maintainer reshuffle re-pins with a commit-body note.
- Gate tests (extend tests/professions_crafting_hub.test.ts or a sibling): an uncommon+ recipe
  denies with the stable station reason id away from its station and succeeds at it; each of the
  nine FIELD_RECIPES crafts away from any station; a recipe denies at the WRONG station type;
  an active mobile station bypasses the gate and an expired one does not.
- A determinism check: same seed, same world; the new NPCs and the gate change do not shift rng
  draw order (pin via the existing determinism harness pattern).

INVARIANTS THIS PHASE MUST KEEP:
- Server authority: the station gate resolves sim-side inside resolveCraftForRecipe; the client
  never decides craft outcomes. No client-side-only gating.
- Determinism: all sim randomness through Rng; NPC creation draws no rng; CAMPS and content
  ordering contracts respected; tests/architecture.test.ts stays green.
- Sim purity: no DOM/Three/render/ui/game/net imports anywhere in src/sim/.
- IWorld both worlds: if ANY new read or command must surface to render/ui (it should not this
  phase; the deny reason rides the existing craft-result surface), it lands on a facet file,
  implemented in BOTH Sim and ClientWorld, parity-pinned, in the same change. Verify liveness,
  not just member shape (the 2033 stub trap).
- i18n: every new player-visible string is an English-only t() key in the matching
  src/ui/i18n.catalog/ module; sim-origin deny text is a stable id plus values with its
  sim_i18n matcher rule in the SAME change (S3 guard); entity names via tEntity; never edit
  src/ui/i18n.locales/ overlays.
- Prime directive: nothing existing breaks. Every recipe craftable BEFORE this phase remains
  craftable at its station or in the field; nothing strands. The T window keeps working for
  field recipes everywhere. No ItemDef deletions.

Out of scope (do NOT do in this phase):
- Rendering, station props, minimap markers, and master interaction UX (Phase 9).
- Recipe training and shop UX on the acquireRecipe gate (Phase 9); stocking vendorItems is fine.
- Attunement lore quests at the masters (Phase 14); the questIds hooks stay empty.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW:
Run the state.md validation matrix rows for a sim plus content change:
- npx tsc --noEmit
- npx vitest run tests/professions_crafting_hub.test.ts tests/professions_crafting.test.ts
  tests/progression.test.ts plus the new placement test file
- npx vitest run tests/architecture.test.ts (purity plus determinism guard)
- npx vitest run tests/localization_fixes.test.ts (S3 matcher duty for the deny reason)
- if i18n keys were added: npm run i18n:gen then npx vitest run tests/i18n_completeness.test.ts
- npm run wiki:content (player-facing content changed: masters, station-bound recipes)
- npm run ci:changed; format ONLY changed files with a scoped npx @biomejs/biome check --write
Then spawn review agents per the Review Dispatch Matrix in
docs/professions-2/implementation-plan.md; check git diff --name-only and spawn ONLY matching
rows. Prompt every review agent for COVERAGE, not filtering: report every correctness or
requirement gap with confidence and severity; filtering happens in a later pass. If any agent's
output arrives truncated, re-spawn it with a narrower scope and merge results; never proceed on
partial review output. No commit while any BLOCKING finding stands.

STEP 4 - COMMIT CADENCE:
Commit in slices with EXPLICIT paths (never git add -A; the checkout may be shared), Conventional
Commits, and every commit carries a body (1 to 4 sentences: what changed and why):
- feat(professions): typed station registry and station gate
- feat(content): the six crafting masters and station placements
- test(content): station and master placement safety

STEP 5 - ACCEPTANCE CRITERIA (do not mark complete until all check):
- [ ] STATIONS registry exists with typed records { id, type, zoneId, pos, masterNpcId }; recipe
      records carry stationType; the nine hub recipes map to their profession's station type;
      requiresHubStation is retired or delegates
- [ ] Uncommon+ recipes deny with a localized station reason away from their station and succeed
      at the right station type
- [ ] FIELD_RECIPES is exactly the nine pre-phase COMMON_RECIPES ids; all nine craft anywhere and
      the T window works for them everywhere
- [ ] Six masters exist with entity i18n names/titles/greetings, starter vendorItems, empty
      questIds hooks, placed guard-safe beside their stations across the three hubs per the
      state.md assignment (four archetype anchors in zone 1; tannery in Fenbridge;
      apothecary in Highwatch), with the assignment pinned by a test
- [ ] The placement-safety test is green AND proven: it fails when a master is moved next to a
      hostile spawn (mutation tried and reverted)
- [ ] The mobile crafting station perk is live: isStationActive satisfies the gate, the placement
      command is reachable and SPECIALIZATION-gated, the inert-module header is updated
- [ ] CRAFTING_HUB_MIN_LEVEL is retired: no station gate reads player level, and no recipe
      strands in the transition (pinned)
- [ ] Every recipe craftable before this phase remains craftable (station or field); nothing
      strands
- [ ] All STEP 3 validation commands green; no BLOCKING review finding open

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/professions-2/progress.md: Phase 8 status row, mirror the acceptance checkboxes,
  and record the phase-start and phase-end commit hashes in the Notes section (the QA session
  diffs against the phase-start commit).
- Update docs/professions-2/state.md: the "New surfaces per phase" Phase 8 entry gains the
  station registry module and StationType union, the stationType recipe field, the FIELD_RECIPES
  set, the six master NPC ids with their zone assignment, the deny reason id and its i18n key
  namespace, the mobile-station activation command, and the placement test file name. Amend
  "Key existing surfaces" where requiresHubStation / CRAFTING_HUB_STATIONS /
  CRAFTING_HUB_MIN_LEVEL statements went stale.
- Record surprises (gate order gotchas, rng draw-order traps, naming decisions) to memory.

STEP 7 - FINAL RESPONSE FORMAT:
Report: phase status (complete / partial with reasons); files touched (absolute paths); validation
results (each command, pass or fail); review agent verdicts (per agent, findings fixed or open);
deferrals with owners; and a one-line QA handoff naming the phase-start commit for the diff.

STOPPING RULES:
- Stop IMMEDIATELY if any existing recipe would become uncraftable for a player mid-progress (an
  uncommon+ recipe with no reachable station of its type and no FIELD_RECIPES membership); report
  to the maintainer instead of shipping.
- Stop if honoring a deliverable would require changing a locked decision in state.md; ask first.
- No commit while any BLOCKING review finding stands; if validation cannot go green without
  expanding scope beyond this phase, stop and report.
```
