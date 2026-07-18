# Professions 2.0: state (the cross-phase cheat sheet)

The ONLY file every session must trust. Update it at the end of every phase.

## Current phase

Phase 1 (Ring and identity foundations) and its QA: complete
(2026-07-17, PASS, zero blocking; fixes and drift notes below). Phase 2
(Masterwork model): complete (2026-07-17, branch
feature/professions-2-phase-02-masterwork; six reviewers, zero blocking;
landed surfaces and drift notes below). Phase 2 QA: complete
(2026-07-17, PASS, zero blocking; coverage pins, retirement cleanup, and
QA drift notes below). Next: Phase 3 (phase-03-parity-bug-fixes.md).

## Locked design decisions

- Six deep crafts: weaponcrafting, armorcrafting, tailoring, leatherworking,
  cooking, alchemy; engineering ships as the toolmaker line. Jewelcrafting,
  inscription shallow; enchanting shallow but reachable (Phase 13).
- Four wave-one archetypes: Smith (weapon+armor), Outfitter (tailor+leather),
  Apothecary (alchemy+cooking), Bombardier (engineering+alchemy).
- CRAFT_RING adopts the design-doc order: engineering, alchemy, cooking,
  leatherworking, tailoring, inscription, enchanting, jewelcrafting,
  weaponcrafting, armorcrafting. LANDED on the PR 2039 head itself (Phase 1,
  2026-07-17), so pair ids derived from the old ring never exist in any
  deployed build; the load-bearing invariant (ring order and live quest
  wiring ship together) is documented at normalizeArchetypeState.
- Archetypes are pair-named identities: pair-level i18n keys replace the ten
  per-craft practitioner titles. Pair-level attunement history (2039's
  attunedPairs) IS the lore-vs-amends mechanism and stays.
- Combos require the matching attunement (2039's combo_eligibility: deny
  'not_attuned' / 'wrong_pair' / 'tier_unmet'). Client 'syncing' state
  (pre-cprof): keep the button enabled optimistically (server re-validates);
  revisit only if players report confusion. Confirmed in place at Phase 1
  (2026-07-17).
- Masterwork model: deterministic outputs; proc chance from skill +
  signed materials + specialization; bounded bonus stats baked via
  src/sim/item_budget.ts into instance.rolled.stats; no five-way quality
  roll; trivialAt retired. Power bounds: baseline crafted below dungeon BiS;
  masterwork at dungeon-drop level, always below the raid floor.
  AMENDED 2026-07-17 (design review): the signed-reagent proc term counts
  ANY player's signature, not only the crafter's own, and is decoupled from
  the #1145 quantity-discount flag (a count-1 signed reagent qualifies).
  The self-signed reagent-QUANTITY discount stays self-only. Ships as its
  own code change ahead of Phase 3, not inside a phase.
- RNG in, determinism out: input RNG (node rarity, the per-node-type rare
  events, fishing catches, corpse components) stays and grows; output RNG is
  only the masterwork proc (add-only, never a downgrade).
- Hands vs stations: field recipes (a named FIELD_RECIPES subset) craft
  anywhere; every uncommon+ recipe requires its typed station. Stations are
  master NPCs (shop + teach + quest hooks) in guard-safe locations. The
  mobile-crafting-station specialization perk bypasses the gate.
- Recipe acquisition: training at masters on the existing acquireRecipe gate;
  every recipe that exists before Phase 9 is grandfathered known on load.
  AMENDED 2026-07-17: training is additionally skill-tier gated (see the
  Phase 9 amendment below); the gate is on learning, never on use.
- No skillReq admission gate on known recipes, ever (documented rule stands).
- Pacing: fast early, slow top; scarcity (materials, adventure) is the clock.
- Economy: players trade with players; NPCs only sink (training fees, tools,
  reagents, #1301 craft fee, market cut, make-amends costs); pinned invariant
  that no recipe vendors above its input value.
- Deeds: basic universal only (first craft, first masterwork, first
  attunement, per-craft tier milestones, the rare fish). Cosmetic only.
  AMENDED 2026-07-17: plus the Specialist deed and the rare-find deeds, and
  first attunement / first masterwork carry titles and marquee-tier renown
  (see the Phase 15 amendment below). Still cosmetic-only.
- Identity costs: first attunement free; make-amends escalation stays
  5 + 3 * switchCount with cheap early costs.
- Tool effects/charges/recharge: PARKED. Pure modules in
  src/sim/professions/tools.ts stay dormant; do not wire, do not delete.
- Wave 2+ excluded from this packet (see implementation-plan.md); EXCEPTION
  2026-07-17: salvage wiring moved INTO Phase 13 (see the amendments below).
- 2026-07-17 design-review amendments (maintainer-approved; the response to
  the external Codex review). Each binds its owning phase file, which
  carries the full deliverable wording:
  - Phase 4: the rare-event module ships PER-NODE-TYPE flavors on one
    shared cadence knob: pristine vein (ore), ancient heartwood (wood),
    moonlit bloom (herb); per-flavor broadcast ids and deed-mark hooks.
    Fishing keeps the shipped glimmerfin catch; corpse harvesting gains
    the perfect specimen component in Phase 10.
  - Phase 5: the wheel window preserves the identity-view semantics (role,
    ceiling, nudges, tutorial), adds a per-craft next-unlock line and a
    client-computed switch-cost-at-rest line, and renders a SIMPLIFIED
    pre-first-tier/unattuned state (progressive disclosure).
  - Phase 6: the zone-visible masterwork broadcast rides the Phase 4
    soft-zone-broadcast mechanism (the Phase 2 SimEvent is personal,
    pid = crafter, and keeps feeding the crafter's own toast); online
    inspect EXTENDS the identity wire with equipped instance payloads
    (the Phase 2 QA drift decision resolves as extend); client-derived
    tier-up toasts fire at every TIER_SKILL_STEP crossing.
  - Phase 7 QA is the vertical-slice checkpoint: play the eight-step
    journey end to end before wave one begins (see README).
  - Phase 8: masters spread across the three zone hubs. Default
    assignment: forge, kitchens, loom, toolworks in the zone 1 hub (every
    wave-one archetype keeps a zone-1 anchor master); the tannery roots
    in Fenbridge (zone 2); the apothecary in Highwatch (zone 3, keeping
    the #1297 hub lore, dropping its level gate). CRAFTING_HUB_STATIONS
    offsets are ZONE-3 coordinates and may seed only the Highwatch
    placement. The mobile-station perk ships SPECIALIZATION-gated.
  - Phase 9: recipe training is skill-tier gated at the masters. The
    general predicate: a master teaches a recipe only at
    tierForSkill(craft skill) >= tierForSkill(recipe skillReq). Wave-one
    ladder: common always, uncommon at 25, rare at 50; any
    higher-skillReq recipe a later phase authors (the existing
    TOOL_RECIPES sit at 75/150 but are grandfathered known) gates by the
    same formula with no extra rule. The gate is on LEARNING via
    acquireRecipe, never on using a known recipe (the no-admission-gate
    rule stands). Hobby crafts use the same thresholds. The Train view
    always SHOWS locked rows with their named requirement (the visible
    ladder).
  - Phase 10: higher-tier recipes also consume some lower-tier materials;
    cooking and alchemy carry combat-worthy consumables at EVERY tier;
    the named Phase 2 materialTierBonus hook gets wired with real values.
  - Phase 13: salvage wiring joins disenchant/enchant on the same seam
    and confirm machinery (salvage.ts is already sim-complete).
  - Phase 14: one cadence-capped repeatable work-order quest per master
    (a recurring material sink with a face) and a one-shot-per-tier
    congratulation mail from the attuned archetype's master.
  - Phase 15: first attunement and first masterwork deeds carry TITLE
    rewards and marquee-tier renown (>= 25) so the deeds pipeline
    (nameplate title, banner, marquee broadcast, Renown board) celebrates
    professions; a cosmetic Specialist deed lands at the 75-skill
    threshold; a faucet-vs-sink review runs in the tuning pass. Still
    basic, universal, cosmetic-only, append-only.

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

Note (2026-07-17): release moved after this verification; re-verify against
code per the docs anchor rule. Known drift so far: enchanting shipped a
two-tier table with a shard-consuming Greater tier (#1950, relevant to
Phase 13), and interaction handlers return an outcome boolean (#1982).

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
  inv wire; bags/bank/equip/save-load correct; trade CARRIES payloads (the
  Phase 3 trade deliverable pre-landed on release via PR 2045; Phase 3 added
  the bidirectional full-payload pin, signer/charges/rolled incl masterwork/
  enchant/boundTo in one mixed trade, in tests/trade.test.ts); mail/market
  refuse instanced items (wave 2).
- Gathering: nodes (harvestNode both hosts, ncd cooldowns), corpse harvesting
  (claims + focus picker + town focus, tfocus; claims mirrored online via the
  per-entity hcb key since Phase 3), fixed corpse rarity baseline
  40; node yields are placeholder junk until Phase 4.
- Salvage/disenchant/enchant: sim-complete in salvage.ts / enchanting.ts;
  lastSalvageResult/lastDisenchantResult/lastEnchantResult on PlayerMeta;
  no IWorld/wire/UI until Phase 13 (salvage wiring JOINS Phase 13 per the
  2026-07-17 amendments; it no longer waits for wave 2).
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

- Phase 1: (landed 2026-07-17, on the PR 2039 head) i18n keys
  hudChrome.archetypePair.* (ten pair titles keyed by canonical pair id),
  hudChrome.craftName.* (ten per-craft display names), and
  hudChrome.crafting.pairOptionLabel; sim_i18n matcher rows
  error.professionChoiceUnavailable / error.professionChoiceExpired; ring
  geometry re-pinned in tests/professions.test.ts (ARCHETYPE_PAIR_TARGETS
  ring-order pin + COMBO_RECIPES adjacency pin), stale-pair drop-by-design
  pin in tests/profession_attunement_quests.test.ts, and the deployed
  v0.26.0 empty-shape pin in tests/professions_archetype.test.ts.
- Phase 1 QA (2026-07-17): direct literal pins for the ring-derived pair
  helpers (archetypePairId, isAdjacentPairTarget, craftsForPairTarget,
  hobbyCandidatesForPair, defaultHobbyForPair skill preference) and the
  attune/switchHobby transition state machine in
  tests/professions_archetype.test.ts; a same-seed determinism pin for the
  gather/craft/attune/hobby-switch flow in
  tests/profession_attunement_quests.test.ts; questObjectiveRequired and
  resolvedCounts-aware credit pins in tests/quest_credit.test.ts; the
  restored exact hobby re-pin in tests/professions_hobby_craft.test.ts; a
  no-magic source scan in tests/profession_identity_card.test.ts. The
  nythraxis interact-credit site now routes through questObjectiveRequired
  like every other questProgress emit (behavior identical, golden parity
  unchanged). Guide wiki professions prose got a minimal accuracy pass
  (see QA drift notes).
- Phase 1 QA drift notes (2026-07-17):
  - The phase docs' "nameplate title path" consumer does not exist:
    nameplates render Book of Deeds titles only
    (src/render/nameplate_painter.ts, deedTitleText). The pair title's real
    surfaces are the character-sheet title line (src/ui/char_window.ts,
    archetypeTitleText), the crafting-window identity card, and the quest
    dialog labels. Phase 14's celebration work must not assume a nameplate
    surface.
  - COMBO_RECIPES records keep the pre-reorder craftA/craftB field order by
    design: combo_eligibility compares unordered, so only the crafting
    window's combo label renders record order. Flip the records only as a
    deliberate display decision (it stales test comments and screenshots).
  - Guide wiki: guide.professions.* archetype prose was corrected at QA to
    match the shipped system (pair archetypes, live declaration and amends
    quests, the rare/common ceilings, the combo attunement requirement).
    The full page rewrite remains a Phase 15 deliverable; non-Latin
    overlays hold pre-reword translations until the release locale fill.
  - Legacy IWorldProfessions members (acceptArchetypeQuest,
    advanceAmendsProgress, switchArchetype, and the scalar mirrors) have
    zero UI consumers after Phase 1; kept per deprecate-not-delete. Retire
    them together with their world_api_parity pins in a later phase
    (candidate: Phase 15 teardown).
  - ClientWorld.questState's identity guard in src/net/online.ts looks
    dead (the field initializes at declaration) but is load-bearing for
    the bareClient test idiom, which builds instances via
    Object.create(ClientWorld.prototype) and skips field initializers.
  - Save-compat stopping rule: NOT triggered (migration review, full
    evidence chain in the Phase 1 QA record). Rollback caveat for the
    release runbook: once v0.27.0 players attune, rolling back to v0.26.0
    does not crash (its normalize ignores the unknown keys) but its next
    save DROPS attunedPairs/hobbyCraft and may re-default pairedMajor
    under the old ring. Do not roll v0.27.0 back to v0.26.0 once the
    attunement quests are live; mirror this in the v0.27.0 release notes
    at tag time.
  - Screenshot convention: this packet's phases commit PR shots under
    docs/pr-screenshots/ (established earlier in the program), while root
    CLAUDE.md names docs/screenshots. Keep the program-local convention
    consistent within the packet; the maintainer may unify later.
- Phase 2: (landed 2026-07-17, branch
  feature/professions-2-phase-02-masterwork) SimEvent masterwork
  { recipeId, itemId, crafter } (personal, pid = crafter, ids only),
  mirrored event-driven into lastMasterwork on PlayerMeta (Sim) and
  ClientWorld (session-only, no snapshot delta key, modeled on
  lastCraftResult); IWorldProfessions.lastMasterwork (MasterworkView) and
  CraftResultView.masterwork, parity pins updated; instance payload
  fields rolled.masterwork and top-level enchant (the applied enchant id;
  isEnchantedInstance in enchanting.ts is the single already-enchanted
  predicate, and enchant stat merges are additive); CraftResult.quality
  now reports the OUTPUT DEF quality; trivialAt removed from
  ProfessionRecipeRecord and all content records. Files created:
  src/sim/professions/masterwork.ts (pure leaf; masterworkProcChance
  carries the named Phase 10 material-tier hook, a defaulted
  materialTierBonus summand that Phase 10 wires with real material-tier
  values at the crafting.ts call site),
  tests/professions_masterwork.test.ts,
  tests/masterwork_event_mirror.test.ts, and the professions_craft
  parity scenario plus golden. Rng draw-order pins: the drawCounts pin
  in tests/professions_masterwork.test.ts, the denial-draws-zero pins in
  tests/professions_crafting.test.ts, and the professions_craft golden
  draw digest.
- Phase 2 drift notes (2026-07-17):
  - The predicted golden-parity regen never triggered: tests/parity had
    no craft scenario, so the roll retirement was invisible to the
    goldens (the swap is also draw-parity-perfect: rollMaterialRarity
    consumed exactly one draw and the proc draw consumes the same value
    at the same stream position). The coverage gap is closed by the
    professions_craft scenario; its regen added that one golden and
    modified none.
  - The archetype ceiling now binds craft outputs through the masterwork
    gate, a deliberate re-expression of the Phase 1 ceiling invariant
    under deterministic outputs: a dormant craft never procs, hobby and
    pre-attunement (rare ceiling) cannot bump past rare, majors are
    uncapped. Pinned in tests/archetype_ceiling.test.ts.
  - Rollback caveat for the release runbook (mirror in the v0.27.0
    release notes at tag time, alongside the Phase 1 attunement caveat):
    rolled-back code reads bare rolled.stats as already-enchanted, so
    masterwork copies are temporarily non-enchantable and
    non-disenchantable under rollback; no data loss or corruption,
    fully reversible on roll-forward. Second arm (Phase 2 QA,
    migration-safety): Phase 2 crafts stop writing rolled.quality, and
    the previous release's battlefield_xp reads only rolled.quality, so
    under rollback EVERY new-format signed craft (masterwork or plain
    rare-plus) grants no Battlefield Experience trickle; the signer
    field survives on the row and the trickle resumes on roll-forward
    via the def-quality fallback.
  - Battlefield XP trickle, two maintainer questions surfaced and NOT
    changed here: (a) a masterwork of a sub-rare def carries bonus stats
    but does not trickle (the def-quality gate; masterwork is not
    rare-tier attribution today); (b) pre-existing reach limit:
    recipeForResultItem scans COMMON_RECIPES only and no common recipe
    outputs a rare-plus def, so the new def-quality fallback arm is
    future-proofing until content or the recipe gate catches up.
  - Guide prose (the guide.ts crafting and archetype rows: skill "buys
    quality", ceilings "advance to the rare quality tier") still reads
    correctly against the masterwork ceiling but was authored for the
    rolled-output model; rewording is deferred to Phase 6 (masterwork
    surfacing) and Phase 15 (full rewrite) to avoid the i18n
    semantic-regression pins mid-packet.
  - Standing wire invariant (security review): equipped stats flow from
    instance rolled.stats server-side, which is safe because no wire
    command ingests a client-supplied ItemInstancePayload; any future
    command that would must re-mint the instance server-side or
    masterwork and enchant forgery becomes possible.
- Phase 2 QA drift notes (2026-07-17):
  - Deeds quality-mark delta (intended, silently absorbed by the
    fallback): markItemDiscovered records the def quality for new
    crafts (rolled.quality is gone), so a masterwork copy credits its
    DEF quality toward discovery deeds, never the bumped tier,
    consistent with the battlefield-trickle stance above. If masterwork
    copies should count toward higher-quality discovery deeds, that is
    a deliberate maintainer design change, not a fix.
  - Online inspect never carries equippedInstances (the identity wire
    has no instance payloads; offline builds them for the render
    mirror), so another player's masterwork and enchant stats are
    invisible to online inspection. Pre-existing for enchants.
    RESOLVED 2026-07-17: Phase 6 EXTENDS the identity wire (see the
    design-review amendments above); the choice is no longer open.
  - Quality-roll retirement cleanup landed in QA: clampMaterialRarity
    and its private ladder deleted from gathering.ts (zero consumers
    after the craft-side clamp retirement); the professions CLAUDE.md
    module map and ceiling invariant re-teach the deterministic
    masterwork model.
  - Mixed-fleet check: the previous release's HUD event if-chain
    ignores unknown SimEvent types, so a new server's masterwork event
    is harmless to an old client during a staged rollout.
- Phase 3: LANDED 2026-07-17. hcb wire key (corpse claims): sparse per-entity
  emit in server/game.ts dynamicFields (present only when claimed, so the
  entity delta cache elides unclaimed corpses byte-unchanged) + unconditional
  reset-on-absence mirror in src/net/online.ts applyWire. Pinned by the
  round-trip suite in tests/snapshots.test.ts (claimed, sparse absence,
  stale-claim clear) and the online-picker parity suite in
  tests/corpse_harvest_sim.test.ts (claimed corpse harvestable false against
  a ClientWorld-shaped mirror). hcb is deliberately NOT in ALL_DELTA_KEYS or
  TERSE_TO_IWORLD: those pin selfWireJson maybe() self keys only (the scrape
  test asserts set-equality), and a per-entity dynamicFields key is pinned by
  the round-trip + bandwidth tests instead; the phase file's pin instruction
  was written for self keys (deviation reviewed, cross-platform-sync PASS).
  Trade payload carriage pre-landed via PR 2045; Phase 3 added the
  bidirectional full-payload pin (tests/trade.test.ts) and the combo-gating
  liveness pin (tests/crafting_view_combo_liveness.test.ts: Sim and
  ClientWorld arms fed by a real cprof broadcast, decisiveness
  mutation-tested). No IWorld member changes; world_api_parity untouched.
  - DEFERRED to Phase 4 (gathering trusts corpse claims): src/main.ts still
    passes harvestStateReliable = (online === null) at its three interaction
    open-gate sites, so the truthful mirror is consumed by the in-window
    picker (hud.ts wiring defaults reliable true) but not yet at the online
    OPEN gate: a harvest-only corpse (tags, no regular loot) still never
    opens online, a pre-existing limitation, not a Phase 3 regression. Flip
    the three sites to trust the mirror, with an open-gate test, when
    Phase 4 makes gathering trust corpse claims.
  - Drift notes: instance-level boundTo copies are tradeable (tradeSetOffer
    gates only def-level soulbound; carried verbatim per #1298, possible
    design follow-up); vendor sellItem buyback still re-grants a plain copy
    losing the payload (pre-existing, documented in trade.ts's header, out
    of scope); the bareClient test fixture now has three hand-rolled copies
    (snapshots, corpse_harvest_sim, combo liveness suites): rule-of-three
    tripped, a shared tests/helpers/ extraction is a Phase 3 QA or Phase 15
    cleanup candidate.
- Phase 4: (planned) node material tables; per-node-type rare events
  (pristine vein / ancient heartwood / moonlit bloom) + deed-mark hooks.
- Phase 5: (planned) professions window (.window id professions-window) +
  view core + painter + hudChrome.professions.* keys.
- Phase 7: (planned) trend detection module; Guild letter content; S3 scan
  list gains src/sim/quests/quest_commands.ts.
- Phase 8: (planned) station registry (typed stations, multi-zone); master
  NpcDefs across the three hubs; placement-safety test.
- Phase 13: (planned) disenchantItem/applyEnchant/salvageItem IWorld
  members + wire commands.

## Tuning targets (placeholders until Phase 15 tunes against live data)

- Masterwork proc: base 3 percent at recipe tier parity, +1 percent per tier
  of skill above, +2 percent with any signed reagent (any player's
  signature; decoupled from the quantity-discount flag per the 2026-07-17
  amendment), +3 percent at the 75-skill specialization threshold; cap 15
  percent. Masterwork bonus: +1 quality tier for the stat budget, never
  above the raid floor band.
- Training fees: common tier free (starter recipes), uncommon 25s, rare 1g.
- Teach tiers (Phase 9): the general predicate is tierForSkill(craft skill)
  >= tierForSkill(recipe skillReq); the wave-one ladder is common always,
  uncommon at 25 skill, rare at 50. Hobby crafts use the same thresholds.
- Craft fee (#1301) and throttle: unchanged until live data.
- Rare gather events (all three node flavors): roughly 1 per zone per 20
  minutes, 5x yield, always signed; one shared cadence knob until Phase 15
  tunes per family.
- Work-order quests (Phase 14): reward numbers need MAINTAINER numbers
  before Phase 14 runs (never gold-positive against the input vendor value;
  the cadence cap reuses the nudge cadence pattern). Flagged in OPEN items.

## OPEN items

- Design-system sequencing: the maintainer wants professions to be the first
  feature under the new design system (root DESIGN.md). Ideal order: the
  design-language program's phase 1 (tokens/theme/type) lands before packet
  Phase 5 (the wheel window). Each UI phase probes the rollout state at
  session start (see implementation-plan.md guardrails) and uses the new
  vocabulary once it exists; until then, today's tokens, grammar-ready.
  Relief valve (2026-07-17): Phase 6 depends on Phases 2 and 4, not on
  Phase 5, and may leapfrog the wheel window if the rollout stalls it.

- RESOLVED (2026-07-16): the maintainer owns the PR 2039 branch outright.
  Phase 1 amendments (ring reorder, pair titles, review fixes, release sync,
  commit-history cleanup) land ON the PR itself before it merges; no
  merge-window coordination remains. DONE (2026-07-17): all five review
  items closed, the newest release head merged in (world_api_parity re-pinned
  as the union, delta-key census 47), history rewritten so every commit
  carries a body, and the six review agents passed the amended head with
  zero blocking findings.
- Exact FIELD_RECIPES membership (Phase 9 decides; default: the 9 common
  recipes stay field-craftable so nothing breaks).
- Master NPC names/personalities (content flavor, Phase 8; maintainer may
  want a naming pass).
- Whether fishing keeps a separate skill id or folds into professionsState
  shape (Phase 11 decides; wire shape follows gprof pattern either way).
- q_prof_hobby_switch is an unbounded repeatable 75 XP turn-in (flagged by
  the Phase 1 QA security review): fully server-authoritative and XP-only,
  but unlike its two self-limiting siblings it has no escalating gate, so a
  player can ping-pong the hobby between the two candidates for 75 XP per
  cycle. Maintainer decision (xpReward 0, or drop repeatable) in a tuning
  phase; do not change balance numbers inside QA.
- Master-to-zone assignment (2026-07-17 default): forge, kitchens, loom,
  toolworks in Eastbrook; tannery in Fenbridge; apothecary in Highwatch.
  The maintainer may reshuffle in the Phase 8 PR review; positions are
  data-only records, so a move is cheap before Phase 9 renders them.
- Work-order reward numbers (see Tuning targets): maintainer numbers
  required before Phase 14 runs; never invent balance numbers.
- Masterwork discovery-deed credit: a masterwork copy credits its DEF
  quality toward discovery deeds, never the bumped tier (Phase 2 QA drift
  note, intended). Flagged 2026-07-17 for a maintainer call; if masterworks
  should credit the bumped tier, that is a deliberate design change for a
  tuning phase, never a QA fix.
