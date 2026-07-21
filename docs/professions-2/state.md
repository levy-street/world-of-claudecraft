# Professions 2.0: state (the cross-phase cheat sheet)

The ONLY file every session must trust. Update it at the end of every phase.

## Current phase

Phases 1 through 12b and all their QA sessions: complete (per-phase records
under "New surfaces per phase" below and in progress.md). v0.28.0 SHIPPED
with Phases 1 through 10 aboard; Phases 11, 12, and 12b plus their QA
sessions merged into release/v0.29.0 (12b QA is PR #2229). The 2026-07-20
timing and economy amendments restructured the remaining plan to 12, 12b,
13, 14, 14b, 15; the SECOND 2026-07-20 block (mastery and provenance, see
Locked design decisions) inserts Phases 12c and 12d after the 12b QA, so
the remaining order is 12c, 12d, 13, 14, 14b, 15. Phase 12c is BUILT
(PR #2242 off release/v0.29.0, 2026-07-20; as-landed surfaces below).
Next: Phase 12c QA (phase-12c-qa.md) once the PR merges; then 12d.

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
  EXCEPTION 2026-07-20: the binding enforcement half of commissions (#1298)
  moved INTO the packet as Phase 14b; the commission ORDER workflow stays
  wave 2 on #1298.
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
- 2026-07-20 timing and economy amendments (maintainer-approved; this block
  is the authority, on the 2026-07-17 template). The restructure INSERTS
  Phases 12b and 14b without renumbering anything; the remaining order was
  12, 12b, 13, 14, 14b, 15 at this block's writing (superseded by the
  second 2026-07-20 block below, which inserts 12c and 12d after the 12b
  QA). Epic #1866 sub-issues: #2206 (Gathering
  rhythm), #2207 (Commissions and the Maker's Bond), #2208 (the profession
  SFX help-wanted list). Each ruling binds its owning phase file, which
  carries the full deliverable wording:
  - NEW Phase 12b, Gathering rhythm (#2206,
    phase-12b-gathering-rhythm.md + QA twin): gathering gains ACTION TIME.
    A gather cast (base about 2.5 s, shortened per owned tool tier above
    the node's Phase 12 requirement and modestly by proficiency band,
    floor about 1.5 s) rides the fishing cast-id template behind a new
    shared non-spell-cast predicate consolidating the eleven scattered
    FISHING_CAST_ID exemption sites; completion re-validates range,
    respawn, and capacity. The FIXED 5 s FISHING CAST IS SUPERSEDED by the
    bite minigame: ONE hidden seeded delay drawn at startFishing (roughly
    3 to 8 s, exact numbers the implementer's call), never readable from
    castRemaining/castTotal or any broadcast field, a text-free personal
    bite SimEvent (bobber VFX + cue), a generous server-authoritative
    tick-deadline reaction window (the lockpick stepDeadlineTick
    precedent), reel = re-pressing the pole on the existing useItem
    dispatch (command census unchanged), and a miss costs nothing but the
    cast. Rods shorten the average bite delay and widen the window,
    composing with Phase 12's band gating. SHIPPING NOTE: v0.29.0 ships
    the fixed 5 s cast as-is; the bite model replaces it only when 12b
    lands. The phase file carries a Pin-cost appendix: the CLOSED,
    pre-briefed list of deliberate re-pins and golden regens (anything
    outside it that reds is a defect, not a cost).
  - Phase 12 (amended): stays PURE ACCESS GATING; forward notes only
    (speed lands in 12b, rods gain bite synergy in 12b).
  - Phase 13 (amended): typed disenchant reagents on the HYBRID model:
    the universal rarity ladder (DISENCHANT_MATERIAL_BY_QUALITY
    dust/essence/shard) stays for every quality, and RARE OR ABOVE
    additionally yields a type-keyed secondary material keyed off the
    existing ArmorType (cloth/leather/mail) and the sim-side weapon-kind
    taxonomy (WEAPON_TYPE_BY_ITEM); the staves/wands bucket was FLAGGED
    here and is RESOLVED by the second 2026-07-20 block below (the WEAPON
    bucket); cooking and alchemy are deliberately excluded on
    both sides. Every typed material ships WITH at least one consumer
    recipe in the same phase (the wolf_fang no-dead-materials rule). The
    bind-on-trade PRIMITIVE lands in this phase applied to the typed
    rare+ reagents as its first LIVE consumer (never a dormant stub, the
    2033 lesson); the enforcement arm stays generic so Phase 14b extends
    it. Sink sizing notes the measured faucet: every heroic final boss
    drops TWO tradeable epics (src/sim/content/heroic_loot.ts).
  - Phase 14 (amended): the crafting window gains the "learnable at a
    master" discoverability hint row (the Phase 9 known-recipes-only
    filter made the untrained ladders invisible; the hint resolves
    through the shared train_view.ts viewer predicates, never a second
    knownness rule, and renders only when unlearned trainer recipes
    exist for that craft).
  - NEW Phase 14b, Commissions and the Maker's Bond (#2207,
    phase-14b-commissions-binding.md + QA twin): opt-in commission
    crafts bind to the recipient on FIRST trade, enforced in the same
    trade gate that blocks def-level soulbound items; mail and market
    already refuse instanced items, so first delivery is face-to-face by
    construction; a master unbind service clears the bond for gold (a
    real sink on the resolveTrain service shape). Resolves the
    enforcement semantics of #1298 (which stays open as the parent for
    the full commission ORDER workflow). THREE maintainer decisions stay
    FLAGGED, never defaulted, and must be resolved before the phase
    runs: character-vs-account binding, which item classes may opt in,
    and unbind pricing (see OPEN items).
  - Phase 15 (amended): the profession SFX completion sweep over #2208
    (every Phase 12b PLACEHOLDER clip replaced or explicitly re-filed;
    the five missing station ambiences beside amb_forge; per-craft
    success variants where delivered); the rare-fish deed celebrates
    through the Phase 12b bite moment; the legacy junk-recipe burn-down
    (LEGACY_GOLD_POSITIVE_RECIPE_IDS) cross-checks candidates against
    the Phase 13 typed-reagent consumers before plain price nerfs.
  - SFX placeholders are SANCTIONED across the packet: generated with
    the deterministic local synthesis pipeline (scripts/sfx/ui_sfx.mjs
    cue specs), passing npm run sfx:check, catalog rows marked
    PLACEHOLDER for the sound engineer, all tracked on #2208.
- 2026-07-20 mastery and provenance amendments (maintainer-approved; the
  SECOND 2026-07-20 block, on the same template; this block is the
  authority). The restructure INSERTS Phases 12c and 12d after the 12b QA
  without renumbering; the remaining order is 12c, 12d, 13, 14, 14b, 15.
  Epic #1866 sub-issues: #2235 (The Mastery Curve), #2236 (Provenance and
  the harvest loop). Each ruling binds its owning phase file, which carries
  the full deliverable wording:
  - NEW Phase 12c, The Mastery Curve (#2235, phase-12c-mastery-curve.md +
    QA twin): the tier-0 free floor is RETIRED and the skill-gain
    multiplier becomes the four-state curve for EVERY recipe tier (full at
    or above capability, 0.5 one tier below, 0.25 two below, zero three or
    more below); deterministic fractional gains, NEVER a skill-up roll.
    Per-profession skill caps become ENFORCED content data: the nine
    crafts and enchanting 125; mining, logging, herbalism 100; fishing
    200 (caps end where content ends and rise with future zones by data
    edit). Clamps land at all four arms (gainCraftSkill, the gathering
    drain, both normalize-on-load functions); at cap, actions still work
    (masterwork still procs, harvests still yield), only gain stops.
    Gathering gains go node-tier-relative and fishing gains band-relative
    and fractional (adventure is the clock; t3 nodes finish the gathering
    trades). A ONE-TIME reset zeroes craftSkills and gatheringProficiency
    behind a persisted one-shot flag (the recipesGrandfathered idiom);
    players keep all items, gold, bank, knownRecipes, attunements, deeds,
    character level, quests, and mail; a one-time authored system letter
    explains it; the keep/reset ledger, the re-crossing audit, and a
    production blob-diff rehearsal are release evidence. The craft
    throttle becomes ONE shared action window covering crafting,
    disenchant, enchant-apply, and salvage. Enchanting gains become
    quality-tiered with a SOFT ceiling (effective gain tier = min(input
    quality tier, archetype ceiling): rarer input never grants less, and
    never zero above a pre-archetype ceiling; crafting's hard ceiling
    stays). q_prof_hobby_switch xpReward becomes 0 (stays repeatable).
    Curve, caps, and reset ship in the SAME deploy, BEFORE Phase 13.
  - NEW Phase 12d, Provenance and the harvest loop (#2236,
    phase-12d-provenance-stacking.md + QA twin): identical-payload
    material stacking (byte-equal instance payloads merge, in bags AND
    through the bank move path; equipment kinds stay one-per-slot;
    counted instanced stacks ride trade, wire, and removal correctly);
    provenance copy ("Gathered by {name}" for gathered signers, "Crafted
    by {name}" stays for crafted; a visible bag-grid marker on instanced
    slots; the full-bag signed-yield downgrade emits a player-visible
    notice). ONE interact press loots AND harvests an eligible corpse
    (focus selection with the town focus as default; the picker remains
    for overrides; a denial of either half never blocks the other); the
    corpse lifecycle decouples (looting never destroys harvestability,
    harvesting alone never strands the corpse or the respawn); the town
    focus behavior is verified and fixed or made legible. Mail
    attachments expire after 30 days with one return-to-sender cycle
    (system and work-order mail exempt); the bank is the warehouse and
    its expansion ladder the storage gold sink. Companion bug fixes land
    with or ahead of the phase: #2139 and the force-rename instance
    signer sweep (renames re-key market and mail but never stored
    signer strings: a moderation leak that also breaks the self-signed
    discount and battlefield attribution).
  - Market ruling, LOCKED: gold buys MATERIALS, never skill directly.
    Fungible materials stay market-listable (gatherer income and the
    socializer economy are the point); the curve, the shared throttle,
    and material volume are the sanctioned brake on purchased progress.
    No gathered or monster material ever gets a vendor buyValue.
  - Offline host ruling: offline is a documented TASTER for professions
    (characters do not persist there); no host-scoped pacing knob;
    offline persistence is low priority by maintainer call.
  - Masterwork constants are FINAL as shipped: at the 125 cap with full
    bonuses the proc lands at its 15 percent ceiling, so at-cap crafting
    becomes the masterwork hunt by construction; no constant changes.
  - Phase 13 (amended): inherits the 12c shared throttle and the
    quality-tiered soft-ceiling gain model on day one. The staves/wands
    typed-reagent bucket is RESOLVED: the weapon bucket, no cloth special
    case. Typed-reagent yields are APPROVED (see Tuning targets).
    Community draft PR #2134 is OUT of consideration by maintainer
    ruling; do not absorb, rebase, or reconcile it.
  - Phase 14 (amended): the work-order reward FORMULA is resolved (see
    Tuning targets; the stop-and-ask row is satisfied). Six master voice
    sketches are approved and live in the phase file; the maintainer may
    veto wording in the PR review.
  - Phase 14b (amended): the three flagged decisions are RESOLVED (see
    OPEN items): the Maker's Bond binds to the CHARACTER; opt-in classes
    are equipment only (weapon, armor, held_offhand); the unbind fee is
    tier-scaled on the training-fee family.
  - Phase 15 (amended): deed additions (fishing's first deed;
    prog_master_gatherer counts fishing; mastery deeds authored against
    the RESOLVED caps, no reach-300 records); the titles scheme is
    approved (Guildsworn for first attunement, Masterwright for first
    masterwork, "Grandmaster {Craft}" per-craft at 125, Master Angler at
    fishing 200; rare-find deeds stay renown-only; wording veto in the PR
    review). The rare-event cadence is RESOLVED: ONE shared knob, no
    per-family split in wave one (revisit with zone-expansion data).
    Specialization perks are FINAL (threshold 75, materialDiscountPct
    0.2). Masterwork discovery-deed credit is RESOLVED: keep def-quality
    credit (item closed). The training-fee ladder EXTENDS on the 4x
    geometric step for future tiers (tier 3 = 40000, tier 4 = 160000
    copper; future-proofing, re-tunable when content exists). The wiki
    rewrite expands to the RuneScape-wiki bar as its own dedicated arm:
    per-skill pages, tables GENERATED from src/sim/ content, FULL
    transparency on numbers (the repo is public; the wiki is the accurate
    source), English-only keys with a guide-scoped M16 exemption (locale
    fill stays a release-time batch). The faucet-vs-sink review gains
    three named rows: the market fee (#2156), the dust-vs-cheap-uncommon
    disenchant margin, and the live gland-to-pristine ratio report
    (about 250 plain glands per 5 pristine).

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
- Crafting: resolveCraftForRecipe gates = station (professions/stations.ts,
  typed per recipe.stationType, position-only, own active mobile station of
  the matching craft also satisfies; stable deny id station_required),
  combo_eligibility, isRecipeKnown (acquireRecipe, #1299), materials,
  throttle + gold sink (#1301). NO skillReq admission gate, NO level gate
  (CRAFTING_HUB_MIN_LEVEL retired in Phase 8 per the 2026-07-17 ruling).
- Instances: ItemInstancePayload {signer, charges, rolled, boundTo} rides the
  inv wire; bags/bank/equip/save-load correct; trade CARRIES payloads (the
  Phase 3 trade deliverable pre-landed on release via PR 2045; Phase 3 added
  the bidirectional full-payload pin, signer/charges/rolled incl masterwork/
  enchant/boundTo in one mixed trade, in tests/trade.test.ts); mail/market
  refuse instanced items (wave 2).
- Gathering: nodes (harvestNode both hosts, ncd cooldowns), corpse harvesting
  (claims + focus picker + town focus, tfocus; claims mirrored online via the
  per-entity hcb key since Phase 3), fixed corpse rarity baseline
  40; node yields are real zone-tiered materials since Phase 4
  (NODE_MATERIAL_TABLE; rare+ rolls signed, rare events x5 always
  signed with the soft-zone broadcast; see the Phase 4 row below).
- Salvage/disenchant/enchant: sim-complete in salvage.ts / enchanting.ts;
  lastSalvageResult/lastDisenchantResult/lastEnchantResult on PlayerMeta;
  no IWorld/wire/UI until Phase 13 (salvage wiring JOINS Phase 13 per the
  2026-07-17 amendments; it no longer waits for wave 2).
- Stations today (Phase 8): STATIONS content records (six typed stations
  across the three hubs) + the pure registry src/sim/professions/stations.ts
  (StationType, isAtStation, stationTypeForCraft) + recipe.stationType +
  FIELD_RECIPES. requiresHubStation, CRAFTING_HUB_STATIONS,
  CRAFTING_HUB_POS/RADIUS/ZONE_ID/MIN_LEVEL, and crafting_hub.ts are GONE
  (retired with their consumers; unrendered until Phase 9 props).
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
  - Screenshot convention (corrected by Phase 5 QA, 2026-07-18): the
    packet's shots live under docs/screenshots/ per root CLAUDE.md. No
    docs/pr-screenshots/ directory has ever existed in the tree; the
    earlier version of this note recorded a packet-local convention that
    was never actually used, and Phases 1 to 5 all committed under
    docs/screenshots/.
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
  materialTierBonus summand that Phase 10 WIRED with real material-tier
  values at the crafting.ts call site, see the Phase 10 entry),
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
    semantic-regression pins mid-packet. DONE 2026-07-19: Phase 6 landed
    the minimal accuracy reword (the two factually wrong sentences only:
    masterwork proc instead of quality-buying, skill tier instead of
    quality tier); the full page rewrite stays Phase 15.
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
  its round-trip suites instead (the snapshots sparse-absence assertion is
  the no-bloat tooth; bandwidth.test.ts stays green but carries no
  hcb-specific scenario); the phase file's pin instruction was written for
  self keys (deviation reviewed, cross-platform-sync PASS; as-landed note
  swept into the phase file + QA twin by Phase 3 QA).
  Trade payload carriage pre-landed via PR 2045; Phase 3 added the
  bidirectional full-payload pin (tests/trade.test.ts) and the combo-gating
  liveness pin (tests/crafting_view_combo_liveness.test.ts: Sim and
  ClientWorld arms fed by a real cprof broadcast, decisiveness
  mutation-tested). No IWorld member changes; world_api_parity untouched.
  - DEFERRAL LANDED in Phase 4 (2026-07-18): the three main.ts open-gate
    sites dropped their (online === null) override, so the helpers default
    harvestStateReliable = true and the truthful hcb mirror is consumed at
    the online OPEN gate; harvest-only corpses now open online when
    unclaimed and stay closed when claimed
    (tests/gather_open_gate.test.ts pins both arms). The despawn-grace
    heads-up resolved by pinning the REAL open boundary: the corpse open
    arm has always gated at INTERACT_RANGE + 1 (6 yd, pre-existing), far
    inside the 90 yd+ interest/grace band, so a grace-frozen boundary
    corpse can be approached but never opened; the pin asserts opens at
    exactly 6, refusals at 6.01 and at 90.
  - Drift notes: instance-level boundTo copies are tradeable (tradeSetOffer
    gates only def-level soulbound; carried verbatim per #1298, possible
    design follow-up); vendor sellItem buyback still re-grants a plain copy
    losing the payload (pre-existing, documented in the removeOffer comment
    in trade.ts, out of scope); the bareClient fixture is hand-rolled in 21
    test files repo-wide (tests/CLAUDE.md blesses the idiom; the three
    professions suites are byte-near-identical copies): Phase 3 QA judged
    the extraction a standalone chore, not QA churn (a shared
    tests/helpers/bare_client.ts adopted first by the three identical
    copies; the 18 divergent variants need per-file verification; filed
    as issue 2088).
  - Phase 3 QA: PASS 2026-07-17, zero blocking. Found and fixed
    test-first the tradeConfirm sequencing defect in the pre-landed
    PR 2045 code (same-itemId bidirectional trades cross-contaminated:
    grant-before-remove let the second removal consume just-granted
    stock; now two-phase, removeOffer both sides then grantOffer both
    sides, matching the fitsAfterSwap model; no dupe or loss existed,
    conservation always held). Coverage closed: live GameServer
    broadcast suite for hcb (lite delta record + scope
    eviction/re-entry, claims and clears made out of view),
    partial-stack sparing pin, no-escrow cancel pin, claimed-corpse
    arms of corpseLootAvailability. Reviewer fan-out (architecture,
    cross-platform-sync, test-coverage-auditor with revert
    experiments, qa-checklist): all PASS. Details in progress.md.
- Phase 4: (landed 2026-07-18) `NODE_MATERIAL_TABLE` + `nodeMaterialFor`
  in src/sim/professions/gathering.ts (node type x zoneId rows, one
  frozen shared `MATERIAL_QTY_BY_RARITY` curve: 1/2/2/3/4; Phase 15
  clones per row before tuning per family). New material ItemDef ids:
  copper_ore, iron_ore, ironbark_log, silverleaf_herb (junk/common,
  tier via sellValue 4/8, no buyValue); zones 2 and 3 grant the existing
  thorium_ore/ashwood_log/elderwood_log/goldleaf_herb/sunpetal_herb.
  Rare-event module src/sim/professions/gather_events.ts:
  GATHER_RARE_EVENT_CHANCE (1/90, the one shared cadence knob),
  GATHER_RARE_EVENT_YIELD_MULT (5), rollGatherRareEvent = resolveHarvest
  draw #2 (draw #1 stays rollMaterialRarity; two draws per granted
  harvest, zero on denial, pinned by tests + the professions_gather
  parity golden). SimEvents: gatherResult gained qty + rareEvent;
  new per-recipient 'gatherRareEvent' (pid = recipient, flavor
  pristine_vein/ancient_heartwood/moonlit_bloom by node type). The
  soft-zone broadcast mechanism Phase 6 reuses lives in
  gather_events.ts emitToZonePlayers (zoneAt(z) match, instance space
  excluded past DUNGEON_X_THRESHOLD). Dormant deed marks:
  markVisited 'gather_event:<flavor>' at the resolution site.
  Client i18n namespaces: hudChrome.gathering.gatherLine/gatherLineQty
  ("You gather:", distinct from the grant hub's "You receive:" loot
  line, no second cue) and gatherEvent.pristineVein/ancientHeartwood/
  moonlitBloom (top-level, the skinEvent idiom). The Phase 3
  harvestStateReliable deferral landed: main.ts's three open-gate
  sites trust the hcb mirror (open gate stays at the pre-existing
  INTERACT_RANGE + 1 boundary, so grace-frozen boundary corpses stay
  unreachable; tests/gather_open_gate.test.ts).
  - Phase 4 QA: PASS with fixes 2026-07-18. Found and fixed test-first:
    the signed harvest grant could overflow bag capacity (the fungible
    canAddItem pre-gate counts stack top-up room; a signed instance
    needs a fresh slot). Landed policy: every signed unit requires a
    genuinely free slot, and with none the yield falls back to an
    UNSIGNED stack top-up of what fits, so the truncation contract wins
    over signing in that self-inflicted edge (crossing-case pin in
    tests/gather_rare_events.test.ts; draw order and the
    professions_gather golden untouched). The corpse focus-harvest path
    keeps the same pre-existing hole (fitsAll fungible simulation vs
    rare+ signed instance grants) and is filed as #2139 with the
    gathering fix as the reference policy.
  - Phase 4 QA drift notes (2026-07-18): a signed rare-event windfall
    emits one grant-hub loot line + cue PER INSTANCE (up to five) on
    top of the single "You gather: x5" line and the broadcast line;
    consistent with the D1 cue-ownership decision but reads as spam,
    Phase 15 polish candidate (batch or debounce). Zone-1 signed
    starter instances are a design-confirm item for the maintainer:
    signing tracks rarity/rare events, never zone tier, so
    high-proficiency zone-1 farming mints signed sellValue-4 starters
    (self-limiting: signed units never merge, so they consume slots
    fast, and the stockpiling mitigation caps the item TIER as locked).
    corpseLootAvailability's harvestStateReliable parameter is a
    deliberately retained seam: production always uses the default
    (true) since the open-gate flip, and its false arm stays pinned
    POSITIONALLY (no named reference) in
    tests/corpse_loot_availability.test.ts and tests/interactions.test.ts,
    so name-greps miss it; documented at the helper. gatherEvent.* as a
    top-level catalog namespace (not hudChrome.gathering) is accepted
    as landed: the skinEvent idiom, overlays filled, moving it is
    churn without user value. finderName cannot smuggle the [[i:
    item-link token into the chat parser: validCharNameShape forbids
    brackets server-side.
- Phase 5: (landed 2026-07-18) the professions window (.window id
  professions-window): src/ui/professions_view.ts (UI_PURE_CORES pure
  core; COMPOSES profession_identity_view, does not absorb it; exports
  the ring layout math, skill-bar/pip model with core-derived
  fillFraction, next-unlock union, switch cost via
  requiredAmendsProgress, progressive disclosure, professionsRefreshSig;
  CRAFT_MAX_SKILL 300 is a presentational cap local to the core, content
  defines no craft-side maximum) and src/ui/professions_window.ts (cold
  deeds-pattern painter; the ring is DOM nodes over one inline SVG
  styled from components.css tokens; close is the only interactive
  control, pinned). The hudChrome.professions.* key namespace (plus
  hudChrome.mobile.professions; the perk line is one perkSpecializedLine
  key interpolating {craft}, never a concat of localized fragments).
  Icons: prof_<craftId> x10 + gather_* x4 procedural recipes (incl. the
  Phase 11 forward slot gather_fishing), professionIconUrl over the
  empty committed WebP set public/ui/professions/, the
  scripts/convert_profession_icons_webp.mjs scaffold (assets:professions)
  and tests/profession_icons.test.ts pinning the empty-set bijection.
  Launchers: #mm-professions, #mobile-professions (More tray), keybind
  Shift+KeyP via input.ts/mobile_controls.ts dispatch (main.ts kept to
  switch cases + the handler-bag entry). The change-aware shot target
  'professions' in scripts/pr_shot_targets.mjs stubs craftingIdentity +
  professionsState with a representative attuned Smith (renown-board
  precedent). Phase 11 touch point: the painter's GATHERING_NAME_KEYS
  map gains the fishing row and its catalog key with the fishing read.
  QA (2026-07-18): the simplified raise-vs-start call-to-action decision
  lives in the core (SimplifiedCta on SimplifiedCallToAction, both arms
  pinned), not the painter; Hud exposes only toggleProfessions (the
  open/close/isOpen wrappers were unconsumed and dropped).
- Phase 6: (landed 2026-07-19, branch
  feature/professions-2-phase-06-crafting-window) SimEvent masterworkZone
  { recipeId, itemId, crafterPid, crafterName, zoneId } (one pid-scoped
  copy per overworld zone player, the crafter included; instance space
  excluded; a SEPARATE type from the personal masterwork event so
  bystander copies never touch lastMasterwork), emitted via
  announceMasterworkZone in src/sim/professions/gather_events.ts (the
  Phase 4 emitToZonePlayers is now exported); wire identity key eqi
  (players only, sparse, beside eq, NEVER a delta key; payload trimmed
  server-side to signer/enchant/rolled, the boundTo/charges strip pinned)
  mirrored into ClientWorld EntityView.equippedInstances with
  cloneItemInstancePayload; NO new IWorld member (EntityView already
  declared equippedInstances; parity counts unchanged);
  craftSkillGainMultiplier in src/sim/professions/archetype.ts (the ONE
  gain composition, consumed by crafting.ts AND the crafting view so the
  difficulty label cannot diverge); crafting_view rows gain skillReq,
  difficulty ('full'/'reduced'/'none'), station { required, inRange }
  (requiresHubStation joined RecipeDefLike, buildCraftingView gained
  stationInRange); pure cores src/ui/craft_celebration_view.ts
  (computeCraftTierUps + buildCraftCelebrationPlan, in UI_PURE_CORES) and
  sibling module src/ui/item_instance_tooltip.ts (seal, enchanted marker,
  bonus stat lines, makers mark; also now owns itemStatName/itemNumber,
  moved out of hud.ts); PainterHostPresentation.itemTooltip widened to
  (item, instance?) and threaded at bags/bank/paperdoll/inspect;
  hudChrome.crafting.* keys skillReqLine, difficultyFull/Reduced/None,
  stationBadge, stationOutOfRange, masterworkToast, masterworkZoneLine,
  tierUpToast, makersMark, masterworkSeal, enchantedLine (M16 fills in
  the five non-Latin overlays); NO sim_i18n matcher row (as-landed
  deviation: the broadcast is a structured text-free event on the
  gatherRareEvent precedent, so the S3 guard is satisfied by
  construction; the phase file's premised matcher rule does not exist);
  parity golden professions_craft eventDigest re-pinned deliberately (the
  crafter's own zone copy; rng fingerprints byte-identical); tier-up
  toasts derive client-side from craftSkills inside a bounded
  post-craftResult drain window; the celebration consumer trims only the
  banner fade under reduced motion (plan.motion), the polite ARIA
  announcer is never gated. Tests: crafting_view boundary sweep pinned to
  the shared multiplier, masterwork_zone_broadcast + inspect_instances
  liveness suites, snapshots eqi round-trip + data-minimization pin,
  item_instance_tooltip + craft_celebration_view unit suites, bank_view
  instance passthrough pin. Phase 6 QA additions (2026-07-19, PASS with
  fixes, zero blocking): tier_unmet now names the under-tier craft(s)
  via hudChrome.crafting.comboTierUnmetNamed ({crafts} + {tier}; the
  param-less comboTierUnmet stays the defensive fallback, M16 fills in
  the five non-Latin overlays); the tier-up armed drain window is the
  pure step observeCraftSkillsForTierUps (+
  CRAFT_TIER_UP_DRAIN_WINDOW) in craft_celebration_view.ts, hud.ts a
  thin consumer; masterwork_zone_broadcast gained a live GameServer
  session-routing suite (the hcb broadcast-suite precedent) and hud
  zone-arm source pins; threading pins landed for the bags forwarding
  call site, the char_window self-mirror closure, the openInspect slot
  rows, and hud.itemTooltip composition order; plan.motion consumer and
  station-repaint liveness are source-pinned.
- Phase 7 (landed 2026-07-19; phase start 8e88b27f5): trend module
  src/sim/professions/trend.ts (classifyCraftTrend, CraftTrend,
  GUILD_LETTER_SKILL_THRESHOLD = TIER_SKILL_STEP; pair score = member
  sum over ARCHETYPE_PAIR_TARGETS, leading pair by score then min
  member then first member then ring order, crossed at the threshold);
  trigger src/sim/professions/guild_letter.ts (maybeSendGuildTrendLetter
  + updateGuildTrendLetters, the 1 Hz sweep beside postOffice.update in
  the tick mail phase) booking mail through the NEW append-only
  SimContext callback mailAuthoredLetter; one-shot
  PlayerMeta.guildLetterSent (optional CharacterState field, normalize
  default false via s.guildLetterSent === true, serialized
  unconditionally, the mailWelcomed shape); GUILD_TREND_LETTERS in
  src/sim/content/letters.ts (10 pair-keyed letters, ids
  guild_trend_<a>_<b>, load-time ring-completeness guard, Smith Haldren
  stands in for masters until Phase 8); entities.letters coverage via
  LETTER_IDS in world_entity_i18n.ts + LETTERS_BY_ID in entity_i18n.ts
  + M16 fills in the five non-Latin overlays; the S3 scan list ALREADY
  contained src/sim/quests/quest_commands.ts (PR 2039), its membership
  now pinned by a meta-guard in tests/localization_fixes.test.ts.
  Phase 7 QA additions (2026-07-19): skillOf counts only positive
  FINITE numbers (Number.isFinite, the comment contract made real);
  per-clause eligibility negatives and a flip-before-send pin on the
  exported maybeSendGuildTrendLetter, the system MailKind pinned on the
  mailInfo surface, a two-player same-sweep case, and a same-seed
  determinism pin (tests/professions_trend.test.ts); live GameServer
  session-routing suite tests/guild_letter_online.test.ts (owner-only
  mailArrived, mailU mirrors, booking-level one-shot). OPEN maintainer
  decision from the vertical slice: the letter to Haldren hop dead-ends
  pre-q_prof_intro (no locked-row hint, no redirect to Odell).
- Phase 8 (landed 2026-07-19; phase start 571ab0219): station registry
  src/sim/professions/stations.ts (StationType union
  forge/kitchens/apothecary/tannery/loom/toolworks; StationDef
  {id, type, zoneId, pos, masterNpcId}; isAtStation/stationsOfType/
  stationTypeForCraft/inRangeStationTypes) over STATIONS +
  STATION_TYPE_BY_CRAFT + STATION_RADIUS in content/professions.ts;
  recipe.stationType (six TOOL_RECIPES toolworks, wardweave_cowl loom,
  duskhide_wraps tannery, sootscale_mantle forge) replacing
  requiresHubStation; FIELD_RECIPES = the nine COMMON_RECIPES ids,
  field-craftable (COMBO_RECIPES stay ungated); deny reason
  station_required on the craftResult surface, rendered via
  hudChrome.crafting.stationRequired + stationName.<type> (no sim_i18n
  matcher row, the Phase 6 text-free-id precedent); the six masters
  forgemistress_darva/cook_marlow/weaver_ottilie/tinker_gizzel (zone 1)
  + tanner_hesk (Fenbridge) + alchemist_verane (Highwatch), empty
  questIds, entity i18n via NPC_IDS + M16 fills; mobile station live:
  transient PlayerMeta.mobileStation, IWorld placeMobileStation +
  activeMobileStationCraft, place_mobile_station wire command, mst
  self-delta mirror, /dev mobilestation arm; placement-safety suite
  tests/professions_station_placement.test.ts (content-derived buffer
  11.19 bound by bursar_fernando vs the boar camp, mutation-proven) +
  live-wire suite tests/professions_station_online.test.ts; parity
  goldens regenerated deliberately for the purely mechanical +6
  entity-id shift of the six static NPCs (own reviewed commit);
  Tools of the Trade deed desc reworded station-neutral (stale locale
  desc fills dropped for the release refill). The nine former hub
  recipes relocated from Highwatch to their typed stations (seven in
  Eastbrook, tannery in Fenbridge); Highwatch keeps the apothecary
  (no alchemy station recipe exists yet, forward content). Phase 8 QA
  drift notes (2026-07-19): Eastbrook loom-to-toolworks separation is
  about 13.6 against STATION_RADIUS 20, so standing at the loom also
  satisfies the toolworks gate (and forge-to-kitchens clears by only
  1.6), accepted town-square density with no strand and no info
  hiding, for Phase 9 props/minimap to be aware of;
  MobileCraftingStation.pos, placedAtTick, and playerId are recorded
  but consumer-less today (the gate reads craftId plus expiresAtTick
  only; Phase 9 props are the natural pos consumer); an expired
  mobileStation object lingers on the meta slot until the next
  placement (benign, every reader checks isStationActive);
  content/professions.ts reads ZONE1/2/3_ZONE.id at module init (no
  runtime cycle today because the zone modules never import
  professions content, but a future reverse import would see
  undefined during init).
- Phase 9 (landed 2026-07-19; phase start d40f0a90f): recipe training
  live end to end. src/sim/professions/training.ts (TRAINING_FEE_BY_TIER
  [0, 2500, 10000] copper, clamp-to-last for future tiers pending the
  Phase 10/15 tuning; trainingFeeFor; teachTierMet = exactly
  tierForSkill(craftSkills[professionId] ?? 0) >= tierForSkill(skillReq);
  resolveTrain with the replay-safe deny order already_known ->
  not_taught_here -> out_of_range -> tier_unmet -> cannot_afford;
  PRE_TRAINING_RECIPE_IDS, the frozen 21 pre-phase recipe ids;
  grandfatherKnownRecipes). The acquisition switch: exactly the three
  COMBO_RECIPES carry acquisition ['trainer'] (the wave-one taught set:
  skillReq 25 is the locked "uncommon at 25" rung; commons and the
  75/150 TOOL/CASTER recipes keep empty acquisition, grandfathered
  known to everyone); every recipe authored after Phase 9 must carry a
  non-empty acquisition list (trained-not-known default, pinned in
  tests/professions_grandfather.test.ts). Persistence: PlayerMeta +
  CharacterState recipesGrandfathered boolean (new chars true; a load
  missing the flag unions PRE_TRAINING_RECIPE_IDS into knownRecipes
  once, idempotent; parity goldens regenerated for the new persisted
  field in their own commit). Wire: IWorldProfessions.trainRecipe +
  train_recipe command; CraftingIdentityView.knownRecipes (sorted)
  rides the existing cprof JSON-diff key (ALL_DELTA_KEYS stays 49);
  text-free SimEvent trainResult {ok, recipeId, reason?} with deny ids
  train_already_known/train_not_taught_here/train_out_of_range/
  train_tier_unmet/train_cannot_afford rendered via hudChrome.training.*
  (17 keys + five non-Latin M16 overlay fills; no sim_i18n matcher row,
  the Phase 6/8 text-free-id precedent). Training proximity accepts
  STATIC stations only (a mobile crafting station never satisfies
  training, pinned). UI: Train dialog option on STATIONS masters,
  train_view.ts pure core (UI_PURE_CORES) + train_window.ts painter on
  the vendor family; locked rows always render with "Taught at {craft}
  {skill}"; the crafting window now lists known recipes only. Render:
  src/render/stations.ts + stations_core.ts (RENDER_PURE_CORES) prop
  clusters on all six STATIONS records (existing GLBs only, no radius
  decal), six master ids mapped to existing NPC visual keys, minimap
  'station' marker + --color-minimap-station token, tier-identical,
  pinned against both host shapes. Master stocking (the Phase 8 travel
  loop flag): tinker_gizzel sells all six premium reagents;
  forgemistress_darva, weaver_ottilie, tanner_hesk sell thorium_ore
  (their station recipes' only premium reagent); cook_marlow,
  alchemist_verane, quartermaster_bree unchanged. Phase 9 drift notes
  (2026-07-19): the unknown-recipe (malformed) train arm emits a
  reason-less ok:false trainResult (craftResult precedent; hud renders
  nothing for it); train_not_taught_here is content-unreachable until
  a drop/quest acquisition recipe exists (precedence pinned, no
  positive arm test); online, before the first cprof lands
  (craftingIdentity.synced false) the crafting window briefly hides
  trainer recipes the player knows (transient, advisory-only); the
  Eastbrook forge station prop stands ~2.7yd from smith_haldren's
  stall anvil (two anvils, accepted: the station pos is the legible
  gate anchor; drop the anvil entry in STATION_PROP_CLUSTERS.forge if
  the maintainer prefers the stall to be the visual); station props
  are BUILTIN_WORLD-guarded (artisan-row precedent), so editor custom
  maps get the sim gate with no props; the mobile-station prop stays
  deferred (pos/placedAtTick still consumer-less); smith_haldren does
  not train (the forge's masterNpcId is forgemistress_darva, the
  locked Phase 8 seating); since the Phase 9 QA pass, the viewer-side
  knownness predicate is the SHARED train_view.ts
  isRecipeKnownForViewer (the train ladder's known state and the
  crafting window's known-filter both delegate to it, and rowState
  delegates to training.ts teachTierMet, so neither UI site can
  drift from the sim's rule; the hud known-filter source pin in
  tests/train_window_hud.test.ts pins the delegation itself).
  ROLLBACK CAVEAT (reviewed and consciously
  accepted, migration-safety 2026-07-19): a character created under
  Phase 9 code whose save round-trips through pre-Phase-9 server code
  loses the unknown recipesGrandfathered field (old serialize rebuilds
  CharacterState), so returning to Phase 9 code re-runs the union and
  grants the three combos without the fee or tier gate. Same class as
  the mailWelcomed re-trigger; bounded to a skipped gold fee (combo
  USE stays pair-gated), and unavoidable for any additive flag old
  code strips. Note it in the v0.28.0 release notes rollback section.
- Phase 10 (2026-07-19): recipe ladders and materials content.
  Materials (new data module src/sim/content/profession_items.ts, merged
  via mergeItems in data.ts): harvest materials rough_hide, spider_silk,
  venom_gland, game_meat, homespun_cloth (kind junk, quality common, no
  buyValue); perfect specimens pristine_hide, pristine_silk,
  pristine_venom_gland, prime_cut (quality rare), granted as a SIGNED
  instance IN ADDITION to the plain component when the existing
  rollCorpseMaterialRarity draw clears rare+ (src/sim/interaction.ts
  harvestCorpse, zero new rng draws; specimen-less families, fang and
  cloth, keep the pre-Phase-10 signed-regular behavior at rare+); vendor
  reagents smithing_flux, spool_of_thread, tanning_agent, cooking_salt,
  glass_vial (positive buyValue, sellValue a quarter of it, stocked ONLY
  at the matching master; inserted before thorium_ore where the Phase 9
  stock pin holds it last). HARVEST_COMPONENT_ITEMS remap: hide to
  rough_hide, silk to spider_silk, venomSac to venom_gland, plus NEW
  rows meat to game_meat (tags on wild_boar, mire_prowler, ridge_stalker)
  and cloth to homespun_cloth (vale_bandit, gravecaller_cultist,
  gravecaller_summoner, wyrmcult_zealot, wyrmcult_necromancer); fang
  stays wolf_fang. The old quest items (boar_hide, webwood_silk,
  widow_venom_sac) keep their questId-gated kill-loot roles only;
  regression suite tests/harvest_component_materials.test.ts pins the
  map, the no-quest-credit-from-harvest arm, and the live drop paths.
  Ladders: LADDER_RECIPES in src/sim/content/recipes.ts, 54 trainer
  recipes (9 per deep craft, 3 per rung at skillReq 0/25/50, acquisition
  ['trainer'], stationType = the craft's station, scaffolding normalized
  to 10/10, 16/15, 20/20 per rung; station-bound skillReq-0 rungs
  coexist with the grandfathered field commons by design). Per-master
  trained sets: forgemistress_darva 18 (weaponcrafting 9 + armorcrafting
  9), weaver_ottilie 9, tanner_hesk 9, cook_marlow 9, alchemist_verane
  9, tinker_gizzel 0 this phase (engineering stays the toolmaker line).
  Specimen consumers, exactly one per family: recipe_silkbinders_raiment
  (pristine_silk), recipe_mirewarden_jerkin (pristine_hide),
  recipe_marlows_grand_roast (prime_cut), recipe_elixir_of_the_serpent
  (pristine_venom_gland, resultCount 2). Cooking consumes all six
  pre-existing raw fish (no fish ItemDefs were authored; fishing was
  already live, so the phase-file premise was already satisfied).
  materialTierBonus WIRED: src/sim/professions/material_tier.ts exports
  MATERIAL_TIER_BY_ITEM (iron_ore, ashwood_log, goldleaf_herb,
  thorium_ore tier 1; elderwood_log, sunpetal_herb, arcanite_bar tier
  2; everything else 0) and MASTERWORK_MATERIAL_TIER_CHANCE 0.01,
  max-tier rule, def-level keying (consumed-instance rarity is not
  recoverable at the crafting.ts call site without a consumption-order
  change); tier-0 reagent lists contribute exactly 0 so the parity
  goldens are unchanged, pinned in tests/professions_masterwork.test.ts
  including a real-Sim seed-69 call-site flip pin.
  Economy invariant: tests/recipe_economy.test.ts, strict less-than over
  every recipe in ALL_RECIPES with vendor-purchasable reagents priced at
  buyValue; the frozen 14-member LEGACY_GOLD_POSITIVE_RECIPE_IDS
  exception list (8 wave-one commons, the 3 caster-hub rows, the 3
  combos; recipe_tough_jerky and the 6 tools clear) is pinned three ways
  (subset of PRE_TRAINING_RECIPE_IDS, every member still violates so it
  self-prunes, exact literals) and is a Phase 15 burn-down target, never
  an escape hatch for new content. The same file pins referential
  integrity (trainer homes resolve via stationTypeForCraft(professionId),
  which also covers the station-free combos), material demand coverage
  for every Phase 4 and Phase 10 material id, and the ladder shape rules.
  i18n: 68 new entities.items.<id>.name keys with five non-Latin overlay
  fills each; three new aura keys (aura.elixirBoar,
  aura.elixirVenomfire, aura.elixirSerpent) beside aura.elixirBear in
  sim_i18n (baseEnTable, the 14 locale DICT blocks, AURA_NAME_KEY
  reverse rows), S3 guard green.
  Drift and flags: distinct elixirs stack with each other and the bear
  (per-item power capped at the bear's 12; a single shared battle-elixir
  slot would be a sim change, maintainer call); recipeForResultItem still
  scans COMMON_RECIPES only, so ladder outputs are invisible to the
  Battlefield Experience reverse lookup (pre-existing for every
  non-common table); the wiki generator does not yet enumerate recipe
  records (guide professions rewrite stays Phase 15); each craft's cheap
  reagent is stocked only at its master's hub (economy INFO, same class
  as the Phase 9 premium-reagent note); the shipped-items golden re-mint
  also absorbed 24 ids earlier phases had shipped without re-minting
  (append-only).
  Phase 10 QA (2026-07-19) landed on top: harvestCorpse now grants ALL
  plain yields before any signed instance (signed-family instances next,
  specimens last as guarded extras; rarity draws stay in the first loop
  in yield order so the draw sequence and parity goldens are
  byte-identical). The reorder closes a real capacity break: on a corpse
  with two specimen families (wild_boar hide+meat, webwood_spider
  silk+venomSac) a jackpot granted mid-loop could consume the slot the
  pre-gate reserved for a later family's plain stack and push the
  uncapped plain grant past capacity (17 of 16, reproduced at seed 1;
  pinned in tests/corpse_harvest_sim.test.ts). Also QA-landed: the
  ladder execution suite tests/ladder_crafting.test.ts (all 54 recipes
  craft end to end, the four specimen consumers consume real signed
  instance slots, trainRecipe charges the real rungs, the three elixir
  defs are pinned literally and apply through useItem, silkspun_satchel
  contributes its authored 10 slots); a literal
  HARVEST_COMPONENT_SPECIMENS pin plus behavior arms for every specimen
  family and the cloth signed-regular arm; the train_view locked-row
  requirement re-pinned to literals (the old expectation composed the
  production formula and could never red); item_icons BAG_IDS carries
  the sixth bag so guard F's license-override arm runs for it; the
  stale inert TOOL_RECIPE_STUBS block in content/professions.ts was
  swept (the real table is TOOL_RECIPES in recipes.ts, deliberately
  outside COMMON_RECIPES); and src/ui/icons.ts itemFallback gained a
  potion/elixir flask branch (the eleven new crafted consumables
  rendered the junk-trinket fallback; now tinted flasks by function).
  QA drift flags: wolf_fang is the one harvest family with no consuming
  recipe (a signed jackpot that can never be crafted with; Phase 15
  candidate: a consumer recipe or demoting fang out of
  HARVEST_COMPONENT_ITEMS); the recipeForResultItem gap is sharper than
  the Phase 10 note stated (zero COMMON outputs have rare+ def quality,
  so every item that can pass battlefieldExperienceTrickle's
  def-quality gate is unresolvable and the trickle stays dormant;
  widening the scan to ALL_RECIPES is a one-line change but a live
  gameplay switch, maintainer call); cooking's "combat-worthy
  consumable at every rung" is satisfied by sit-heal foodHp values
  only, no buff food exists at any rung (maintainer glance if the
  amendment intended buff food); the aura M16 fills live in sim_i18n.ts
  plus sim_i18n.newlocales.ts, NOT the i18n.locales overlays (which
  carry the 68 item-name fills), the correct layout for sim-emitted
  text; the economy invariant's decisiveness was mutation-verified both
  ways (a seeded gold-positive new recipe reds the sweep, a legacy
  member flipped non-violating reds the self-pruning arm).
- Phase 11 (built 2026-07-20; phase start 09e943669; DRAFT PR #2197
  retargeted to release/v0.29.0 after the cut, sync 83b929398 audit-clean;
  QA runs after the maintainer merges):
  fishing joins the gathering framework. `src/sim/professions/fishing.ts`
  (startFishing/completeFishing behind SimContext, late-bound ctx arrows at
  the sim.ts host literal on the runEffects idiom; move-not-rewrite, parity
  goldens byte-identical, sim.ts shed 111 lines). `GatheringProfessionId`
  gains `fishing` appended LAST (eager-init in emptyGatheringProficiency;
  normalize-on-load zero-defaults old saves; ROLLBACK CAVEAT: pre-Phase-11
  normalize drops the unknown fishing key, so accrued fishing proficiency
  re-zeroes on a downgrade round trip, the mailWelcomed class). Accrual:
  `queueGatheringGrant(meta, 'fishing', 1)` per landed catch (junk counts;
  no-bite, bags-full, and the codfather branch never accrue). Catch rarity
  ladder: `FISHING_TABLES_BY_BAND` (3 bands x 3 zones) selected by
  `fishingBandFor` over `FISHING_BAND_THRESHOLDS` [0, 100, 200]; band 0 IS
  the shipped table object (the `FISHING_TABLES` export aliases it) so every
  pre-phase seed reproduces its catch sequence; higher bands shift weight
  from junk/empty-hook rows into the six cooking fish, koi weight flat
  everywhere; band selection is pure state ahead of the unchanged single rng
  draw. Wire: zero changes (gprof/prof whole-record; no IWorld member
  added). Catch feedback: text-free personal `fishingResult` SimEvent
  (gatherResult family, itemId + ItemDef quality) rendered as
  `hudChrome.gathering.catchLine` colored by quality, wording apart from the
  loot and gather lines, no second cue; keys `hudChrome.gathering.fishing` +
  `catchLine` with M16 fills in the five non-Latin overlays. UI rows ride
  the existing builders (char window + wheel window name-key maps; the Phase
  5 gather_fishing icon read went live). `tests/professions_fishing.test.ts`
  (21 pins: literal band-0/band-1 seed sequences, the one-draw contract with
  zero draws on the codfather branch, accrual arms, table literals with flat
  koi and monotone shifts, alias identity, the fishingResult contract, a
  live GameServer gprof round trip with bystander isolation, the accepted
  deed drift). Screenshots: docs/screenshots/professions-2-phase-11-fishing/.
- Phase 11 drift notes (2026-07-20): prog_first_harvest (trigger gathering
  amount 1, desc "Harvest your first gathering node") now completes on a
  first landed CATCH, and prog_master_gatherer (count 3, desc naming the
  starter trio) counts fishing so any 3 of 4 at 100 completes it; both
  accepted as cosmetic-only and pinned as documented Phase 11 semantics in
  tests/professions_fishing.test.ts (a deed-desc wording pass is a
  maintainer call). guide.professions gatherTitle/gatherIntro prose still
  says "Three gathering trades" (Phase 15 guide rewrite owns the reword;
  touching reviewed prose trips the full-gate i18n semantic-regression
  pins). catchLine's English carries no trailing period while gatherLine
  has one (deliberate; the five overlay fills match their English source).
- Phase 11 QA notes (2026-07-20, PASS with fixes, zero blocking): the S3
  drift guard scan list now includes src/sim/professions/fishing.ts (the
  extraction had orphaned the three fishing-only emit literals from reword
  protection; matchers unchanged). The stranded data.ts FISHING_RARE_ID /
  FISHING_TABLES re-export dropped (the band-0 alias comment in
  content/items.ts now names the deeds zone-key guard as the surviving
  consumer). New pins, all mutation-verified: band-2 liveness on the live
  catch path, codfather over-capacity force-add (soft-lock defense),
  col_glimmerfin off a fished koi, startFishing deny arms + fixed 5 s
  zero-draw cast start, nonzero fishing persistence round trip, and the
  ACCEPTED rollback caveat (stripped-key reload re-zeroes fishing only).
  Chore candidate: the `const SWIM_DEPTH = PLAYER_SWIM_DEPTH` deep-water
  alias now has FOUR copies (sim.ts, player_motion.ts, mob/locomotion.ts,
  professions/fishing.ts); rule of three tripped, a shared deep-water
  predicate is the extraction shape. Awareness note: gathering proficiency
  accrual has no maxSkill cap on the drain path (shared, pre-existing
  semantics across all four professions; the wheel UI clamps display via
  the Phase 5 above-cap saturation pin).
- Phase 12 (built 2026-07-20, phase start c139db6d5, PR #2217): base tool
  tier gating, PURE ACCESS GATING (no speed/cast/timing, 12b owns rhythm).
  GatherNodeDef gains required `tier` (all 24 pre-phase defs tier 1; nine
  new veins: ore/wood/herb_mirefen_t2, ore/wood/herb_thornpeak_t2 and
  _t3; new defs of an existing type need no render change). Bare hands
  resolve to effective tool tier 1 (BARE_HANDS_TOOL_TIER floors the
  owned-best bag scan in professions/tools.ts: bestOwnedGatherToolTier
  per profession, bestOwnedAnyGatherToolTier across all four for corpse
  pulls; no equip UI). harvestNode gates tier 2+ nodes pre-draw and
  rng-free (deny touches nothing); harvestCorpse gates ONLY the rare+
  premium arm against MONSTER_MATERIAL_TIERS (content/professions.ts,
  EVERY wave-one family tier 1, so the arm is live but never fires in
  shipped content; deny downgrades to the plain grant, claim and draw
  order byte-identical); completeFishing caps the band at the owned rod
  tier (band b needs tier b + 1, SILENT cap, band 0 always reachable).
  Denials: text-free personal SimEvent `gatherDenied { pid, surface:
  'node'|'corpse', requiredTier, professionId? (node only) }` rendered
  via hudChrome.gathering.* (nodeName.*, tierRequired.*, toolTierUnmet.*,
  toolTierUnmetCorpse, stateReady/stateCooldown; five non-Latin overlay
  fills); NO sim_i18n matcher rows (sim emits no text; S3 green). NEW
  content: ironreel_fishing_rod (tier 2) and silverstream_fishing_rod
  (tier 3) at trader_wilkes; a useItem arm routes gatherTool+fishing to
  startFishing (the pole stays use:{type:'fishing'}, effective tier 1).
  UI: node hover tooltip (desktop pointer only; src/ui/gather_node_tooltip.ts
  on the shared #tooltip container; pure model in gathering_view.ts),
  minimap lock tint (--color-minimap-node-locked) composing with
  ready/cooldown, client pre-gate 'tool_tier' verdict in
  gather_node_interact.ts (tryNearbyInteraction gained a REQUIRED 4th
  nodeToolGateFor param: the client_shell source pin forbids trailing).
  NO new IWorld member (tier reads off shared content in both hosts);
  parity goldens byte-identical (nodes are content, not entities); the
  tools.ts gating trio now has live callers while the effect/recharge
  half stays PARKED with zero callers.
  Phase 12 QA drift notes (2026-07-20): the corpse deny event's
  requiredTier is the FIRST failing family in yield order (now pinned
  both ways at seed 11); for a future corpse mixing tiers the single
  toast can advertise a lower tier than the highest needed, revisit when
  a tier-2+ family is authored. bestOwnedAnyGatherToolTier spans ALL
  gathering professions, so a fishing rod re-opens a raised-tier corpse
  premium pull (proven live in QA; inert through shipped content;
  maintainer design call whether rods should count as skinning tools
  when tier-2+ corpse families arrive). In normal play the client
  pre-gate short-circuits before harvestNode, so the sim gatherDenied
  fires mainly online and under direct drives; the sim gate is the
  authoritative backstop, deliberate. Spectator sessions receive the
  spectated player's gatherDenied toast (the generic personal-event
  contract, inherited, not Phase 12-specific). The client pre-gate
  checks the tool gate BEFORE readiness while the sim checks respawn
  first; deliberate divergence, both orders pinned, documented at
  decideGatherNodeAction. RELEASE-NOTES AWARENESS for v0.29.0: the
  silent band cap applies retroactively to existing high-proficiency
  rod-less anglers the moment the release ships (band 0 until they buy
  the 60c/150c rods at trader_wilkes; 12b adds the visibility UX).
- Phase 12b (built 2026-07-20, phase start 26f7f40b9): the gather cast and
  the fishing bite minigame. Shared predicate: `isNonSpellCast(castId)`
  (src/sim/types.ts, fishing | gathering) consolidates the ELEVEN cast-id
  exemption sites: SEVEN consume the boolean directly (casting_lifecycle
  silence/lockout/blink-through/spell-queue, effect_dispatch interrupt
  immunity, damage cancel-not-pushback, items useItem busy guard) and FOUR
  are id-DISCRIMINATING by construction, so they compare the sentinels
  individually beside it (casting_lifecycle completion routing, chat_readouts
  castingReadout, cast_bar castBarState, hud castDisplayName; QA wording
  correction, the original entry said all eleven "route through" the
  predicate). DEMON_HEAL_CAST_ID folded ONLY
  at the silence and lockout sites (byte-identical: it was already exempt
  there via failed ability resolution); it stays deliberately AD HOC at
  blink-through (live during its channel), spell queue (queuing works for
  channels), interrupt immunity (interruptible today), damage pushback,
  useItem busy (items usable during its channel), completion (channel path),
  and the readout/label rows. PARITY STORAGE DECISION (the appendix brief,
  option (a) Entity variant): hidden per-cast state = three transient Entity
  fields, `fishBiteAtTick`/`fishReelDeadlineTick` (0 = inert) and
  `gatherCastNodeId` ('' = inert), initialized inert, cleared on every end
  path including cancelCast, never wired, never persisted; consequence: all
  goldens except professions_gather stayed byte-identical (verified), and any
  FUTURE parity scenario sampling mid-cast will regen; parity CAN see
  hidden-state desync (stronger than a module map). GATHER CAST: harvestNode
  keeps its name/signature/bool return and all deny arms (order preserved,
  new busy gate after the dead gate), rng-free at cast start, then starts a
  GATHER_CAST_ID cast (duration = gatherCastDurationSec off tool tier above
  the node tier + proficiency band, via the new shared
  professions/proficiency_bands.ts leaf that fishing's band exports now
  delegate to); completion routes through the NEW SimContext callback
  completeGatherCast (five-site append) and re-validates EXACTLY range,
  respawn, capacity (existing literals); the tool gate is deliberately NOT
  re-checked at completion (held at cast start). The two-draw resolve pair
  moved intact to completion. BITE MINIGAME: startFishing keeps its deny
  arms byte-identical, draws ONE hidden bite delay after them (stored in
  ticks on the hidden Entity state, ceil, the lockpick precedent), sets
  castTotal/castRemaining to the constant FISHING_SESSION_CAP_SEC = 15
  (FISHING_CAST_TIME RETIRED; the broadcast fields carry zero bite
  information); the updateCasting fishing arm fires the text-free personal
  fishingBite at the hidden tick (reel window re-scans the rod at bite time)
  and the miss (fishingGotAway, castStop success false, zero draws, no loss)
  at deadline + 1; the reel = re-pressing the pole (the existing useItem
  fishing arms route to startFishing BEFORE the generic busy guard, so the
  reel arm lives in startFishing's busy gate; command census unchanged),
  valid while tickCount <= deadline, landing through completeFishing's
  unchanged single table draw (codfather early return kept: a codfather cast
  draws 1 at start + 0 at the reel, the shipped choice per the appendix row;
  a bags-full reel still draws the table, capacity gates after). Draw
  contract: 1 draw per cast + 1 per landed reel; miss = 1 total. UI: new
  src/render/fishing_bobber.ts (NO bobber existed; renderer-owned instance,
  idle bob for any fishing entity, owner-only bite state off the personal
  event, preset-identical), castBarState renders fishing as a CONSTANT full
  waiting bar (fill 1), gather as a normal filling cast;
  abilityUi.cast.gathering + hudChrome.gathering.biteLine/gotAwayLine
  (English + the five M16 non-Latin overlay fills); /cast readouts reworded
  (em dash dropped, fishing shows no countdown: 'You are fishing. Waiting
  for a bite.'; gather counts down honestly), landed via the
  scripts/i18n_blocked_seed.mjs status-registry seed. Six PLACEHOLDER cues
  on #2208's canonical keys (ui_gather_cast/strike/rare, ui_fish_cast/bite/
  reel; bite rides the always-audible play() arm, pinned); the game_audio
  cue census re-pinned 14 to 20 (pre-briefed additive extension class), and
  the Phase 11 fishingResult cue-free pin re-pinned to plays-only-the-reel-
  cue (both outside the appendix, both additive, recorded in the phase
  files' as-landed blocks).
  Phase 12b review-pass drift notes (six reviewers, zero blocking): the
  hidden fields are ALSO cleared at the three direct cast-end sites
  (handleDeath, the arena match reset, the fiesta down path), closing a
  sourceless-lethal stale-state hole the architecture pass found (sourceless
  damage skips the cancel-not-pushback arm, which requires a source and kind
  hit). ctx.completeFishing on SimContext is now VESTIGIAL-but-retained: the
  lifecycle completion arm no longer calls it (fishing completion is the
  defensive got-away end) and the reel calls the module function directly;
  the callback stays for interface/pin stability. ACCEPTED-BY-DESIGN
  anti-cheat sign-off: a modified client can script the reel off the
  personal bite event; the window is deliberately attention-not-reflexes,
  and no client can learn the bite BEFORE it fires nor extend the window.
  Mixed-fleet transient (rolling deploy window only): a stale client renders
  the 'gathering' sentinel raw on the cast bar and ignores the unknown
  fishingBite/fishingGotAway events per the unknown-event precedent; the
  reel still works (it rides use_item). The gather completion's castStop
  success reflects the CAST, not the grant (a re-validation denial still
  stops successfully and renders its own error line). The tool gate held at
  cast start means a tool dropped mid-cast still completes that one harvest
  (deliberate; balance-inert). tests/gather_rare_events.test.ts joined the
  outside-appendix additive list at build time (appendix inventory miss,
  drives re-driven through completion, coverage extended). The bobber anchor
  logic lives in the RENDER_PURE_CORES core fishing_bobber_core.ts walking
  the sim's exported FISHING_SAMPLE_DISTANCES by identity.
  Phase 12b QA notes (2026-07-20, PASS, zero blocking): the anti-cheat
  invariant was proven NEGATIVE live twice (a GameServer probe walked every
  broadcast field for a mid-cast angler across ~58 pre-bite rounds: no
  hidden key, castTot constant 15, castRem uniform DT decay carrying no
  bite information; note castRem DOES decay on the wire toward the 15 s
  cap, identically for every drawn delay, so the earlier "constant" phrasing
  means bite-independent, not frozen). The appendix executed with ZERO
  violations. Five mutation-proven pin gaps were closed in the QA PR (miss
  boundary at the deadline tick, cancelCast/arena/fiesta/session-cap
  hidden-field clears, the useItem gather busy arm, cue routing pins, plus
  literal re-pins; the appendix post-inventory block lists them). The
  played-beats probe ran the offline rhythm loop end to end 13/13,
  including both gathering deeds and the Mirror Lake first-catch deed
  celebrating through the new cast/bite moments. Deferred as INFO:
  observer clients never see another angler's bobber bite flip
  (owner-only by design), nameplate cast-label per-frame localize is
  pre-existing, gatherResult/fishingResult log lines use the repo's raw
  hex log-color idiom, and the six cues stay PLACEHOLDER pending #2208
  (release-notes caveat).
- Phase 12c (built 2026-07-20, phase start 67ae62629, PR #2242): the
  four-state curve is tierProgressMultiplier in wheel.ts (free floor
  DELETED; REDUCED_TIER_MULTIPLIER 0.5 and the new MINIMAL_TIER_MULTIPLIER
  0.25 both exported); gathering gain = gatherNodeGainMultiplier(prof,
  nodeTier) with GATHER_GAIN_TIER_STEP 25 (node tier T teaches as curve
  tier T-1: t1 grays at 75+, t3 carries to 100); fishing gain =
  fishingCatchGain via FISHING_GAIN_SCHEDULE (1 below 50, 0.5 below 100,
  0.1 below 150, 0.02 below 200) and FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY
  100 (junk = ItemDef.kind 'junk'). Caps as content data: CraftDef.maxSkill
  (all ten ring crafts 125) + craftMaxSkillFor in content/professions.ts;
  gathering maxSkill 100/100/100/200; clamps at gainCraftSkill,
  drainGatheringGrants, normalizeCraftSkills, normalizeGatheringProficiency
  (the legacy professions key flows through the sim.ts call-site shape
  s.gatheringProficiency ?? s.professions). THE RESET: masteryResetApplied
  is a CharacterState-ONLY optional boolean (serializeCharacter writes
  literal true; NO PlayerMeta field, so samplePlayerMeta sees zero new keys
  and only the two appendix goldens regenerated, draws byte-identical);
  applyMasteryReset + updateMasteryResetNotices live in
  professions/mastery_reset.ts; the transient
  PlayerMeta.pendingMasteryResetNotice (inert false, never serialized)
  drives the one-time mail-phase send of MASTERY_RESET_LETTER (letterId
  mastery_reset_notice, sender The Guildhall, letters.ts + BOTH ui letter
  registries + the coverage count pin + five non-Latin M16 fills incl. the
  letter body). Shared pacing: professions/action_throttle.ts WRAPS the
  meta.craftThrottle seam (historical name kept deliberately;
  CRAFT_THROTTLE_* re-exported); crafting, disenchant, enchant-apply, and
  salvage draw one budget, and the throttle gates disenchant/salvage BEFORE
  their rng draw (unwired until Phase 13; wiring QA heads-up). Enchanting:
  enchantingGainMultiplier in archetype.ts (SOFT ceiling min(input tier,
  ceiling), never crafting's hard zero) with ENCHANTING_GAIN_TIER_BY_QUALITY
  exported from enchanting.ts; the apply arm reads the enchant's max
  reagent ItemDef quality via enchantGainTier (dust 0, essence 1, shard 2,
  pinned). q_prof_hobby_switch xpReward 0. UI: CraftDifficulty four-state
  (full/reduced/minimal/none) from the shared multiplier; DIFFICULTY_TINT
  orange QUALITY_COLOR.legendary / yellow GOLD_ACCENT_COLOR (the new named
  TS twin of --gold in icons.ts) / green uncommon / gray poor;
  CRAFT_MAX_SKILL RETIRED, craftNextUnlock kind 'mastered' at cap; skill
  readouts FLOOR and points-to-go CEIL in both view cores (fractional gains
  never render an uncrossed threshold as crossed); new keys
  hudChrome.crafting.difficultyMinimal +
  hudChrome.professions.nextUnlockMastered (nextUnlockMax deleted
  catalog-wide); S3 scan list gained mastery_reset.ts and
  action_throttle.ts. Appendix ADDENDUM rows (old-curve premises re-pinned
  minimally, the 12b incompleteness precedent): crafting_view (3 tests + 2
  boundary rows), archetype_ceiling (dormant free-floor test became
  curve-not-ceiling), professions_crafting (two-below/minimal + gray
  common), deeds_sites (74 to 74.75 staging), deeds + deeds_reconcile
  (curve-era masteryResetApplied fixtures; the pre-curve arm pinned in
  professions_mastery_reset).
- Phase 12d: (planned) the identical-payload merge rule in bags/bank/
  addItemInstance, the Gathered by key + bag-grid instanced marker + the
  signed-downgrade notice event, the unified loot-and-harvest interact
  flow with the decoupled corpse lifecycle and verified town focus, mail
  attachment expiry with the return cycle, and the companion fixes
  (#2139, the rename signer sweep).
- Phase 13: (planned) disenchantItem/applyEnchant/salvageItem IWorld
  members + wire commands; plus, per the 2026-07-20 amendments, the typed
  disenchant reagents (hybrid model, same-phase consumers) and the
  bind-on-trade primitive applied to them; inherits the Phase 12c shared
  throttle and quality-tiered soft-ceiling gain model on day one.
- Phase 14b: (planned) the commission marker, bind-on-first-trade
  enforcement, the master unbind service; the three maintainer decisions
  are RESOLVED in OPEN items (character binding, equipment-only opt-in
  classes, the tier-scaled unbind ladder), so STEP 0's gate is satisfied.

## Tuning targets (placeholders until Phase 15 tunes against live data)

- Masterwork proc, FINAL (2026-07-20 mastery amendments): base 3 percent at
  recipe tier parity, +1 percent per tier of skill above, +2 percent with
  any signed reagent (any player's signature; decoupled from the
  quantity-discount flag per the 2026-07-17 amendment), +3 percent at the
  75-skill specialization threshold; cap 15 percent. Masterwork bonus: +1
  quality tier for the stat budget, never above the raid floor band. These
  constants harmonize with the 125 cap (at-cap, full-bonus crafting sits at
  the ceiling) and do not change in Phase 15.
- Training fees: common tier free (starter recipes), uncommon 25s, rare 1g;
  RESOLVED extension for future tiers on the 4x geometric step: tier 3 =
  40000, tier 4 = 160000 copper (future-proofing; nothing sells at those
  tiers yet; re-tunable when zone content arrives).
- Mastery curve and caps (Phase 12c, 2026-07-20, APPROVED): four-state gain
  multipliers 1 / 0.5 / 0.25 / 0 by tiers below capability, every recipe
  tier included (the free floor is retired); enforced per-profession caps:
  nine crafts and enchanting 125, mining/logging/herbalism 100, fishing
  200; gathering gains node-tier-relative, fishing gains band-relative and
  fractional (AS LANDED 2026-07-20, PR #2242: gatherNodeGainMultiplier with
  GATHER_GAIN_TIER_STEP 25 and node tier T teaching as curve tier T-1;
  FISHING_GAIN_SCHEDULE 1 below 50, 0.5 below 100, 0.1 below 150, 0.02
  below 200; junk zero at FISHING_JUNK_GAIN_CUTOFF_PROFICIENCY 100).
  Time-to-master TARGETS to tune against: first tier-up in 15 to 20
  minutes; skill 50 in an evening; craft mastery (major, materials
  included) 10 to 20 focused hours spread over days; gathering 100 in 8 to
  12 hours; fishing 200 in 15 to 25 hours. If mastery should get longer,
  the lever is material quantities per craft, never smaller gain numbers.
- Mail attachment expiry (Phase 12d, 2026-07-20, APPROVED): 30 days with
  one return-to-sender cycle; system and work-order mail exempt.
- Teach tiers (Phase 9): the general predicate is tierForSkill(craft skill)
  >= tierForSkill(recipe skillReq); the wave-one ladder is common always,
  uncommon at 25 skill, rare at 50. Hobby crafts use the same thresholds.
- Craft fee (#1301) and throttle: unchanged until live data.
- Rare gather events (all three node flavors): roughly 1 per zone per 20
  minutes, 5x yield, always signed. RESOLVED (2026-07-20 mastery
  amendments): the cadence stays ONE shared knob; no per-family split in
  wave one; revisit with zone-expansion data.
- Work-order quests (Phase 14), FORMULA RESOLVED (2026-07-20 mastery
  amendments): coin reward = floor(0.5 * the summed vendor SELL value of the
  requested materials), plus standard repeatable-quest XP for the level
  band; cadence-capped on the nudge cadence pattern. Vendoring is always
  more gold by construction, so work orders can never be the gold-optimal
  path; never gold-positive against the input vendor value.
- Gathering rhythm (Phase 12b), FINALS as landed, all named exports, all
  pinned: gather cast GATHER_CAST_BASE_SEC 2.5, GATHER_CAST_FLOOR_SEC 1.5,
  GATHER_CAST_TOOL_TIER_REDUCTION_SEC 0.4 per owned tool tier ABOVE the
  node's tier, GATHER_CAST_BAND_REDUCTION_SEC 0.15 per proficiency band
  (duration = max(floor, base - tiersAbove * 0.4 - band * 0.15),
  gathering.ts gatherCastDurationSec). Bite delay FISH_BITE_DELAY_MIN_SEC 3
  to FISH_BITE_DELAY_MAX_SEC 8, FISH_BITE_DELAY_ROD_REDUCTION_SEC 1.5 per
  rod tier above 1 off the MAX only (tier 2 covers [3, 6.5], tier 3
  [3, 5]); reel window FISH_REEL_WINDOW_SEC 3 plus
  FISH_REEL_WINDOW_ROD_BONUS_SEC 0.75 per rod tier above 1 (tick literals
  60/75/90 pinned), rod re-scanned at bite time. FISHING_SESSION_CAP_SEC 15
  (the constant cast-bar cap; FISHING_CAST_TIME retired).
- Unbind service fee (Phase 14b), RESOLVED (2026-07-20 mastery
  amendments): tier-scaled on the training-fee family by the item's
  quality tier: uncommon 2500, rare 10000, epic 40000 copper,
  clamp-to-last above.
- Typed-reagent yields (Phase 13), APPROVED (2026-07-20 mastery
  amendments): uncommon disenchants to 1 to 2 arcane_dust; rare to 1
  arcane_essence plus 1 typed secondary; epic and legendary to exactly 1
  arcane_shard plus 1 to 2 typed secondaries. The 1-shard-per-epic rate
  deliberately maps shard supply one to one onto the measured heroic
  faucet (two tradeable epics per heroic final boss); Greater-tier enchant
  recipes price at 1 to 2 shards so the sink drinks what the faucet pours.
  Consumer costs get the evidence check in the Phase 15 review.

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
- RESOLVED (2026-07-19, Phase 9): exact FIELD_RECIPES membership stays
  the default, the 9 common recipes remain field-craftable (nothing
  breaks; combos stay field-craftable but pair-gated and are now
  trainer-taught; recorded in the Phase 9 surfaces entry).
- Master NPC names/personalities: RESOLVED (2026-07-20 mastery
  amendments) as six approved voice sketches recorded in
  phase-14-attunement-quests.md (the quest and letter text inherits
  them); the maintainer vetoes wording in the Phase 14 PR review.
- RESOLVED (2026-07-20, Phase 11): fishing FOLDS into the gathering
  proficiency shape (a fourth GATHERING_PROFESSIONS row, no separate skill
  id); the wire rides the existing gprof/prof whole-record keys unchanged
  (ALL_DELTA_KEYS stays 49; recorded in the Phase 11 surfaces entry).
- RESOLVED (2026-07-20 mastery amendments): q_prof_hobby_switch xpReward
  becomes 0 and the quest STAYS repeatable (its job is the switching
  service, not an XP faucet); implemented in Phase 12c. The original
  flag: an unbounded repeatable 75 XP turn-in with no escalating gate
  (Phase 1 QA security review).
- Master-to-zone assignment (2026-07-17 default): forge, kitchens, loom,
  toolworks in Eastbrook; tannery in Fenbridge; apothecary in Highwatch.
  The maintainer may reshuffle in the Phase 8 PR review; positions are
  data-only records, so a move is cheap before Phase 9 renders them.
- RESOLVED (2026-07-20 mastery amendments): work-order rewards are a
  FORMULA, recorded in Tuning targets (coin = floor(0.5 * summed input
  vendor value) plus standard repeatable XP, cadence-capped); Phase 14's
  stop-and-ask condition is satisfied.
- RESOLVED (2026-07-20 mastery amendments): masterwork discovery-deed
  credit stays DEF quality (the first-masterwork deed and title celebrate
  the feat; the discovery ledger does not double-count it). Item closed;
  no code change.
- RESOLVED (2026-07-20 mastery amendments): the three Phase 14b
  decisions: (a) the Maker's Bond binds to the CHARACTER (professions are
  per-character, and character is the only identity the sim knows, so it
  is also the only clean deterministic option); (b) opt-in item classes
  are EQUIPMENT ONLY (weapon, armor, held_offhand: the kinds that already
  carry instances); (c) the unbind fee is TIER-SCALED on the training-fee
  family (2500 / 10000 / 40000 copper by quality tier, clamp-to-last).
  Phase 14b's STEP 0 gate is satisfied.
- RESOLVED (2026-07-20 mastery amendments): the staves/wands typed-reagent
  bucket is the WEAPON bucket; no cloth special case (they are weapons in
  the sim taxonomy and the special case buys nothing).
- The letter-to-Haldren dead-end (Phase 7 QA): an unattuned player who
  follows the Guild letter before q_prof_intro is available hits a dialog
  dead-end; options recorded in progress.md Notes; the fix naturally rides
  Phase 14's master quest work. Still open.
