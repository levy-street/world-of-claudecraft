# Professions 2.0: state (the cross-phase cheat sheet)

The ONLY file every session must trust. Update it at the end of every phase.

## Current phase

Phase 1 (Ring and identity foundations): not started.

## Locked design decisions

- Six deep crafts: weaponcrafting, armorcrafting, tailoring, leatherworking,
  cooking, alchemy; engineering ships as the toolmaker line. Jewelcrafting,
  inscription shallow; enchanting shallow but reachable (Phase 13).
- Four wave-one archetypes: Smith (weapon+armor), Outfitter (tailor+leather),
  Apothecary (alchemy+cooking), Bombardier (engineering+alchemy).
- CRAFT_RING adopts the design-doc order: engineering, alchemy, cooking,
  leatherworking, tailoring, inscription, enchanting, jewelcrafting,
  weaponcrafting, armorcrafting. MUST land inside PR 2039's merge window
  (before players persist attunedPairs pair ids derived from the old ring).
- Archetypes are pair-named identities: pair-level i18n keys replace the ten
  per-craft practitioner titles. Pair-level attunement history (2039's
  attunedPairs) IS the lore-vs-amends mechanism and stays.
- Combos require the matching attunement (2039's combo_eligibility: deny
  'not_attuned' / 'wrong_pair' / 'tier_unmet'). Client 'syncing' state
  (pre-cprof): keep the button enabled optimistically (server re-validates);
  revisit only if players report confusion.
- Masterwork model: deterministic outputs; proc chance from skill +
  self-signed materials + specialization; bounded bonus stats baked via
  src/sim/item_budget.ts into instance.rolled.stats; no five-way quality
  roll; trivialAt retired. Power bounds: baseline crafted below dungeon BiS;
  masterwork at dungeon-drop level, always below the raid floor.
- RNG in, determinism out: input RNG (node rarity, pristine veins, fishing
  catches, corpse components) stays and grows; output RNG is only the
  masterwork proc (add-only, never a downgrade).
- Hands vs stations: field recipes (a named FIELD_RECIPES subset) craft
  anywhere; every uncommon+ recipe requires its typed station. Stations are
  master NPCs (shop + teach + quest hooks) in guard-safe locations. The
  mobile-crafting-station specialization perk bypasses the gate.
- Recipe acquisition: training at masters on the existing acquireRecipe gate;
  every recipe that exists before Phase 9 is grandfathered known on load.
- No skillReq admission gate on known recipes, ever (documented rule stands).
- Pacing: fast early, slow top; scarcity (materials, adventure) is the clock.
- Economy: players trade with players; NPCs only sink (training fees, tools,
  reagents, #1301 craft fee, market cut, make-amends costs); pinned invariant
  that no recipe vendors above its input value.
- Deeds: basic universal only (first craft, first masterwork, first
  attunement, per-craft tier milestones, the rare fish). Cosmetic only.
- Identity costs: first attunement free; make-amends escalation stays
  5 + 3 * switchCount with cheap early costs.
- Tool effects/charges/recharge: PARKED. Pure modules in
  src/sim/professions/tools.ts stay dormant; do not wire, do not delete.
- Wave 2+ excluded from this packet (see implementation-plan.md).

## Non-negotiable constraints

- Sim purity + 20 Hz determinism (all randomness via Rng; guarded by
  tests/architecture.test.ts). Server authority for every outcome.
- IWorld-first: new reads/commands land on a facet file, implemented in BOTH
  Sim and ClientWorld, parity-pinned, in the same change. Verify liveness,
  not just member shape (the 2033 stub trap).
- i18n: English-only catalog keys; sim/server text via ids + matchers (S3
  guard); M16 for wordy strings; entity names via tEntity.
- Design language: today's tokens + shared shell only; NO DESIGN.md phase
  vocabulary in feature PRs (see implementation-plan.md guardrails).
- Prime directive: nothing breaks. Never delete an ItemDef players may hold;
  deprecate by removing sources. Existing deeds stay earnable. Additive JSONB
  with normalize-on-load defaults. The T window keeps working.
- Release-branch currency: every session syncs with the NEWEST release/**
  branch at start (version-sort the remote list; 0.27 gives way to 0.28 and
  onward); fresh branches base on it, existing feature branches merge it in
  immediately with the release-merge-audit skill run on the merge. Never base
  work on main or a stale release branch.
- Shared-worktree commit care: explicit paths, never `git add -A`.
- npm run gate under Node 24 (memory: node25-breaks-jsdom-gate); the known
  armory browser-test failure aborts the gate early, finish tsc + builds
  manually; PR CI is the arbiter.
- package-lock.json regenerates ONLY via `npx npm@10 install
  --package-lock-only`.

## Validation matrix by change type

- sim-only: `npx tsc --noEmit` + `npx vitest run tests/<affected>.ts` +
  `npx vitest run tests/architecture.test.ts`; determinism check.
- content-only: `npx tsc --noEmit` + `npx vitest run tests/progression.test.ts
  tests/professions_crafting.test.ts` (+ referential suites for the touched
  domain); `npm run wiki:content` if player-facing content changed.
- server-only: relevant server suites + `npx tsc --noEmit` + `npm run
  build:server`.
- net/wire: `npx vitest run tests/snapshots.test.ts tests/env_protocol.test.ts
  tests/bandwidth.test.ts tests/world_api_parity.test.ts`.
- ui/render: `npx tsc --noEmit` + `npx vitest run
  tests/localization_fixes.test.ts` (if text) + the mobile guard trio
  (`tests/mobile_window_coverage.test.ts`, `mobile_window_transform.test.ts`,
  `mobile_window_layout.test.ts`) + a mobile screenshot script.
- i18n keys added: `npm run i18n:gen` then `npx vitest run
  tests/i18n_completeness.test.ts tests/localization_fixes.test.ts`.
- deeds content: `npx vitest run tests/deeds_content.test.ts tests/deeds.test.ts`.
- icons/assets: the matching converter (`npm run assets:items` family) + its
  bijection test; new GLBs need media manifest regen + `npm run asset:budget`
  + registerPreload.
- full-stack / pre-merge: `npm run gate` (Node 24; release-tier on release/**).
- any code change: `npm run ci:changed`; format with a SCOPED
  `npx @biomejs/biome check --write <file>`.

## Key existing surfaces (verified 2026-07-16, release/v0.27.0 + PR 2039)

- Craft skills: PlayerMeta.craftSkills; wheel math in
  src/sim/professions/wheel.ts (TIER_SKILL_STEP=25, tierForSkill,
  tierCapability, tierProgressMultiplier 1/0.5/0, materialCostMultiplier at
  75 skill).
- Archetype: src/sim/professions/archetype.ts (post-2039: attunedPairs,
  archetypePairId, ARCHETYPE_PAIR_TARGETS, hobbyCandidatesForPair,
  attuneArchetypePair, ceilings with explicit hobby). Combo gate:
  src/sim/professions/combo_eligibility.ts (shared by resolver + UI).
- Wire: cprof delta key -> IWorldProfessions.craftingIdentity
  (CraftingIdentityView, atomic, synced flag). Existing prof/gprof/ncd/tfocus
  self-wire keys are the pattern for any new key (ALL_DELTA_KEYS +
  TERSE_TO_IWORLD pins in tests/snapshots.test.ts).
- Quests: objective union has 'craft' and 'gather' (2039);
  QuestDef.repeatable/completionEffect ('attunePair'|'switchHobby');
  QuestProgress.selection + resolvedCounts; profession_quest_effects.ts.
- Crafting: resolveCraftForRecipe gates = station (crafting_hub.ts),
  combo_eligibility, isRecipeKnown (acquireRecipe, #1299), materials,
  throttle + gold sink (#1301). NO skillReq admission gate.
- Instances: ItemInstancePayload {signer, charges, rolled, boundTo} rides the
  inv wire; bags/bank/equip/save-load correct; trade STRIPS payloads (Phase 3
  bug); mail/market refuse instanced items (wave 2).
- Gathering: nodes (harvestNode both hosts, ncd cooldowns), corpse harvesting
  (claims + focus picker + town focus, tfocus), fixed corpse rarity baseline
  40; node yields are placeholder junk until Phase 4.
- Salvage/disenchant/enchant: sim-complete in salvage.ts / enchanting.ts;
  lastSalvageResult/lastDisenchantResult/lastEnchantResult on PlayerMeta;
  no IWorld/wire/UI until Phase 13 (salvage stays wave 2).
- Stations today: requiresHubStation + CRAFTING_HUB_STATIONS (per-craft
  coordinates, unrendered) + canUseCraftingHubStation.
- Icons: iconDataUrl(kind, id, size), procedural recipes + WebP override sets
  (ITEM_IMAGE_IDS / ABILITY_IMAGE_IDS / DEED_IMAGE_IDS), converters
  npm run assets:items|skills|deeds, 128px WebP under public/ui/<set>/,
  bijection tests. Designer slot recipe: see asset-manifest.json.
- NPCs: NpcDef in ZONE{N}_NPCS (vendorItems, questIds, greeting); render via
  NPC_KEYS in src/render/characters/manifest.ts (npc_villager fallback);
  minimap glyphs automatic for kind 'npc'; vendor window pure-core pair under
  src/ui/hud/vendor/.
- Deeds recipe (the UX bar): docs/design/deeds.md + the 12-step recipe in the
  packet recon; view core in UI_PURE_CORES, cold painter class, hot strips
  separate, celebrations behind a pure gate, i18n by id with lazy locale
  chunks, icons via category crest + bespoke recipes + WebP overrides.

## New surfaces per phase

(append as phases land: IWorld members, SimEvents, wire keys, commands,
tables, i18n key namespaces, files created)

- Phase 1: (planned) pair-title i18n keys hudChrome.archetypePair.*;
  re-pinned ring geometry tests.
- Phase 2: (planned) masterwork SimEvent; instance.rolled.masterwork;
  masterwork proc rng-draw pin.
- Phase 3: (planned) hcb wire key (corpse claims); trade payload carriage.
- Phase 4: (planned) node material tables; pristine vein event + deed mark.
- Phase 5: (planned) professions window (.window id professions-window) +
  view core + painter + hudChrome.professions.* keys.
- Phase 7: (planned) trend detection module; Guild letter content; S3 scan
  list gains src/sim/quests/quest_commands.ts.
- Phase 8: (planned) station registry (typed stations); master NpcDefs;
  placement-safety test.
- Phase 13: (planned) disenchantItem/applyEnchant IWorld members + wire
  commands.

## Tuning targets (placeholders until Phase 15 tunes against live data)

- Masterwork proc: base 3 percent at recipe tier parity, +1 percent per tier
  of skill above, +2 percent with any self-signed reagent, +3 percent at the
  75-skill specialization threshold; cap 15 percent. Masterwork bonus: +1
  quality tier for the stat budget, never above the raid floor band.
- Training fees: common tier free (starter recipes), uncommon 25s, rare 1g.
- Craft fee (#1301) and throttle: unchanged until live data.
- Pristine vein: roughly 1 per zone per 20 minutes, 5x yield, always signed.

## OPEN items

- Design-system sequencing: the maintainer wants professions to be the first
  feature under the new design system (root DESIGN.md). Ideal order: the
  design-language program's phase 1 (tokens/theme/type) lands before packet
  Phase 5 (the wheel window). Each UI phase probes the rollout state at
  session start (see implementation-plan.md guardrails) and uses the new
  vocabulary once it exists; until then, today's tokens, grammar-ready.

- RESOLVED (2026-07-16): the maintainer owns the PR 2039 branch outright.
  Phase 1 amendments (ring reorder, pair titles, review fixes, release sync,
  commit-history cleanup) land ON the PR itself before it merges; no
  merge-window coordination remains.
- Exact FIELD_RECIPES membership (Phase 9 decides; default: the 9 common
  recipes stay field-craftable so nothing breaks).
- Master NPC names/personalities (content flavor, Phase 8; maintainer may
  want a naming pass).
- Whether fishing keeps a separate skill id or folds into professionsState
  shape (Phase 11 decides; wire shape follows gprof pattern either way).
