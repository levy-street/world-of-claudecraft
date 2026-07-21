# Professions 2.0: progress

Update this file at the end of every implementation and QA session. Statuses:
`not started` / `in progress` / `complete` / `deferred (note why)`.

## Status table

| Phase | Title | Status | Started | Completed |
|---|---|---|---|---|
| 1 | Ring and identity foundations | complete | 2026-07-16 | 2026-07-17 |
| 1 QA | Verify ring and identity foundations | complete | 2026-07-17 | 2026-07-17 |
| 2 | Masterwork model | complete | 2026-07-17 | 2026-07-17 |
| 2 QA | Verify masterwork model | complete | 2026-07-17 | 2026-07-17 |
| 3 | Host-parity bug fixes | complete | 2026-07-17 | 2026-07-17 |
| 3 QA | Verify host-parity bug fixes | complete | 2026-07-17 | 2026-07-17 |
| 4 | Node materials and pristine veins | complete | 2026-07-18 | 2026-07-18 |
| 4 QA | Verify node materials and pristine veins | complete | 2026-07-18 | 2026-07-18 |
| 5 | The professions wheel window | complete | 2026-07-18 | 2026-07-18 |
| 5 QA | Verify the professions wheel window | complete | 2026-07-18 | 2026-07-18 |
| 6 | Crafting window upgrades and celebrations | complete | 2026-07-18 | 2026-07-19 |
| 6 QA | Verify crafting window upgrades | complete | 2026-07-19 | 2026-07-19 |
| 7 | The Guild letter and quest objectives | complete | 2026-07-19 | 2026-07-19 |
| 7 QA | Verify the Guild letter and quest objectives | complete | 2026-07-19 | 2026-07-19 |
| 8 | Stations and masters (sim and server) | complete | 2026-07-19 | 2026-07-19 |
| 8 QA | Verify stations and masters | complete | 2026-07-19 | 2026-07-19 |
| 9 | Station presence and recipe training | complete | 2026-07-19 | 2026-07-19 |
| 9 QA | Verify station presence and training | complete | 2026-07-19 | 2026-07-19 |
| 10 | Recipe ladders and materials content | complete | 2026-07-19 | 2026-07-19 |
| 10 QA | Verify recipe ladders and materials | complete | 2026-07-19 | 2026-07-19 |
| 11 | Fishing joins the framework | complete (PR #2197 merged into release/v0.29.0) | 2026-07-20 | 2026-07-20 |
| 11 QA | Verify fishing framework | complete (PR #2199 merged) | 2026-07-20 | 2026-07-20 |
| 12 | Base tool tier gating | complete (PR #2217 merged into release/v0.29.0) | 2026-07-20 | 2026-07-20 |
| 12 QA | Verify tool tier gating | complete (PR #2223 merged) | 2026-07-20 | 2026-07-20 |
| 12b | Gathering rhythm | complete (PR #2226 merged into release/v0.29.0) | 2026-07-20 | 2026-07-20 |
| 12b QA | Verify gathering rhythm | complete (PASS, zero blocking) | 2026-07-20 | 2026-07-20 |
| 12c | The Mastery Curve | complete (PR #2242 merged into release/v0.29.0) | 2026-07-20 | 2026-07-20 |
| 12c QA | Verify The Mastery Curve | complete (PASS, zero blocking) | 2026-07-20 | 2026-07-20 |
| 12d | Provenance and the harvest loop | complete (PR #2264 merged into release/v0.29.0) | 2026-07-21 | 2026-07-21 |
| 12d QA | Verify provenance and the harvest loop | complete (PASS, zero blocking) | 2026-07-21 | 2026-07-21 |
| 13 | Enchanting reachable | complete (PR #2269 merged into release/v0.29.0) | 2026-07-21 | 2026-07-21 |
| 13 QA | Verify enchanting reachable | complete (PASS, zero blocking) | 2026-07-21 | 2026-07-21 |
| 14 | Attunement quests and nudges | not started | | |
| 14 QA | Verify attunement quests and nudges | not started | | |
| 14b | Commissions and the Maker's Bond | not started | | |
| 14b QA | Verify commissions and the Maker's Bond | not started | | |
| 15 | Deeds, tuning, and polish | not started | | |
| 15 QA | Final integration QA and packet teardown | not started | | |

## Per-phase deliverable checklists

Each phase file (`phase-NN-*.md`) carries the authoritative acceptance
criteria; mirror the checkboxes here as phases complete.

### Phase 1: Ring and identity foundations
- [x] `CRAFT_RING` adopts the blueprint ring order (design-doc order); geometry tests re-pinned
- [x] `ArchetypeState` carries per-archetype attunement history (JSONB additive, back-compat load)
- [x] Combo eligibility requires the matching attunement in the shared rule, both hosts
- [x] Pair-named archetype title keys land (Smith, Outfitter, Apothecary, Bombardier + the six future pairs)
- [x] PR 2039 should-fix items resolved; ring adoption landed on the PR 2039 head pre-merge

Phase 1 QA (2026-07-17): PASS, zero blocking findings across the packet's
three audit roles plus the full review dispatch matrix (architecture,
frontend seam, cross-platform sync, privacy/security, migration safety,
pin quality, qa-checklist). The save-compat stopping rule was evaluated
and NOT triggered (v0.26.0 shipped the acceptance quests retired, the
ClientWorld archetype methods as no-op stubs, and no UI caller, so no
player-held save carries old-ring pair ids; an executed round-trip fixture
confirmed drop-by-design plus stable canonical ids). QA landed: coverage
additions for the pair helpers, transition state machine, resolved-count
credit, and a same-seed determinism pin; the one loosened hobby re-pin
restored to exact literals; the nythraxis interact-credit site routed
through questObjectiveRequired; a minimal accuracy pass over the
guide.professions wiki prose (full rewrite stays Phase 15). Deferred, with
notes in state.md: the hobby-switch XP repeatable (maintainer balance
decision), the COMBO_RECIPES record field order (cosmetic), legacy
IWorldProfessions member retirement (Phase 15 candidate).

### Phase 2: Masterwork model
- [x] Craft outputs deterministic; five-way quality roll retired; `trivialAt` retired
- [x] Masterwork proc (skill, self-signed, specialization inputs) with pinned rng-draw contract
- [x] Masterwork stats baked via `item_budget` into `instance.rolled.stats`; deeds reader still coherent
- [x] Masterwork SimEvent with celebration payload; power-ceiling tuning targets in `state.md`

Phase 2 QA (2026-07-17): PASS, zero blocking findings across the packet's
three audit roles plus the matched dispatch-matrix rows (architecture,
cross-platform sync, privacy/security, migration safety, pin quality,
qa-checklist; frontend seam and database performance were NO-MATCH for
this diff). The phase-emphasis probes all bind: an inserted extra rng
draw reddens five tests across three suites, a 2-tier bump reddens the
raid-floor bound through its literal tripwire pins (the derived sweep
moves with the model by design; the literal rows are the teeth, never
delete them thinking the sweep suffices), and the legacy rolled.quality
path is proven end to end in both hosts. QA landed: proc-chance wiring
pins through the real craft path (self-signed at hunted seed 69, the
joint specialization-plus-tier 74/75/76 boundary at hunted seed 2,
spares recorded in-file), the ClientWorld craftResult mirror's
masterwork flag, the top-level enchant marker save/load round trip, an
observed-roll pin making the miss-arm's seed-1 premise load-bearing,
an inv-snapshot passthrough pin (masterwork and legacy instance
payloads reach the client byte-identical), and the quality-roll
retirement cleanup (dead clampMaterialRarity deleted with its orphan
test pin; the area CLAUDE.md re-taught the deterministic model). One
audit finding dissolved on verification: the reported vestments armor
anomaly is the displaced starter recruit_tunic (delta 30 minus 20),
not a bug. Deferred with reasons: the 0.15-cap integration hunted pin
(the clamp is pure-function pinned and every term wiring is craft-path
pinned; a fourth hunted seed adds maintenance without coverage), and
the online-inspect equippedInstances gap (pre-existing, recorded in
the state.md drift notes for the Phase 6 surfacing decision).
Mixed-fleet safety verified: the previous release's HUD event if-chain
ignores unknown SimEvent types, so a new server's masterwork event is
harmless to an old client.

Phase 3 QA (2026-07-17): PASS, zero blocking findings across the
packet's three audit roles plus the matched dispatch-matrix rows
(architecture, cross-platform sync, pin quality, qa-checklist;
privacy/security, migration safety, frontend seam, and database
performance were NO-MATCH for the QA diff). One real correctness
defect found and fixed test-first, in the pre-landed PR 2045 trade
code rather than the phase diff: tradeConfirm ran the a-to-b transfer
to completion before removing b's give, so same-itemId bidirectional
trades cross-contaminated (a swapped instance bounced straight back
to its owner; a plain-for-instance offer spared the instance and
mis-routed a plain copy). The swap is now two-phase (removeOffer both
sides, then grantOffer both sides), matching the model fitsAfterSwap
already validated; conservation held in all variants, so no dupe or
loss ever occurred. QA landed: the two sequencing repro pins (revert
experiment confirms both red on the old code and only they guard the
reorder), a partial-stack sparing pin (removePreferFungible must
choose), a no-escrow cancel contract pin, the live GameServer
broadcast suite for hcb (claim-after-first-sight arrives as a lite
dyn-only record, pinned by hcb-present plus no-nm; interest-scope
eviction and re-entry deliver claims AND clears made out of view, and
a delta-guarded mirror mutation reds the clear arm), and the
claimed-corpse arms of corpseLootAvailability (self-claimed viewer,
claimed-by-another, claimed-with-personal-loot stays openable). Docs:
the hcb as-landed deviation swept into the phase file and QA twin
(the amend-the-twin trap), the phantom bandwidth hcb pin claim
corrected (the snapshots sparse-absence assertion is the no-bloat
tooth), the bareClient drift note rescoped to the real 21-copy
repo-wide idiom (extraction filed as #2088, a standalone chore), and
the Phase 4 despawn-grace heads-up recorded. Deferred with reasons: a
bandwidth claimed-corpse scenario (docs now truthful instead; the
sparse-absence pin covers the regression that matters) and a
distinct-itemId slot-order byte-equivalence pin (the push-to-end plus
splice-compaction reasoning is airtight per the architecture review).
- [x] Trade carries `ItemInstancePayload` end to end (regression test)
- [x] `harvestClaimedBy` mirrored online; corpse picker stops offering claimed corpses
- [x] Crafting view consumes the shared combo-eligibility rule in both hosts

Completed 2026-07-17. The trade code fix had pre-landed on release via
PR 2045; this phase added the missing bidirectional full-payload pin
(signer, charges, rolled including the masterwork marker, enchant,
boundTo, both directions in one mixed trade). harvestClaimedBy rides
the per-entity wire as the sparse hcb key (server/game.ts dynamicFields
emit, unconditional ClientWorld reset in src/net/online.ts), pinned by
the round-trip suite in tests/snapshots.test.ts and the online-picker
parity suite in tests/corpse_harvest_sim.test.ts; hcb is deliberately
NOT in ALL_DELTA_KEYS / TERSE_TO_IWORLD (those pin selfWireJson maybe()
self keys; the per-entity round-trip pins are the teeth, with the
snapshots sparse-absence assertion as the no-bloat pin; bandwidth stays
green but has no hcb-specific scenario).
Combo-gating liveness pinned in
tests/crafting_view_combo_liveness.test.ts (Sim and ClientWorld arms
fed by a real cprof broadcast; decisiveness mutation-tested). Review
fan-out (cross-platform-sync, privacy-security, qa-checklist,
test-coverage-auditor): PASS, zero blocking. Deferred to Phase 4:
src/main.ts still passes harvestStateReliable = (online === null) at
the three interaction open-gate sites, so the truthful mirror is not
yet consumed at the online OPEN gate (harvest-only corpses still do
not open online, pre-existing); flip with an open-gate test when
Phase 4 makes gathering trust corpse claims (details in state.md).

### Phase 4: Node materials and pristine veins
- [x] Per-rarity node material tables replace placeholder junk (zone-1 stays low-tier)
- [x] Rare+ node yields signed like corpse yields
- [x] Per-node-type rare events: pristine vein / ancient heartwood / moonlit bloom (spawns, per-flavor soft broadcasts, deed-mark hooks)
- [x] `gatherResult` consumed: gather cue + rarity-colored loot line

Completed 2026-07-18 (phase-start HEAD 4d8b32d09, the release/v0.28.0 tip
with Phase 3 QA aboard). `NODE_MATERIAL_TABLE` in
`src/sim/professions/gathering.ts` grants zone-tiered materials (four new
low-tier defs; zones 2 and 3 reuse the existing recipe-consumed premium
reagents, closing the loop the TOOL_RECIPE_STUBS note forward-declared);
zone 1 grants only the sellValue-4 starters per the stockpiling
mitigation, pinned with a non-vacuous negative arm. resolveHarvest draws
twice (rarity, then the 1/90 rare-event roll in the new
`gather_events.ts` module); the one-draw pins were re-pinned deliberately.
Rare events are five-fold always-signed yields with a per-recipient
soft-zone broadcast (the Phase 6 reuse mechanism; instance space excluded
via DUNGEON_X_THRESHOLD) and dormant `gather_event:<flavor>` deed marks.
The Phase 3 deferral landed: main.ts's three open-gate sites now trust
the hcb mirror (`tests/gather_open_gate.test.ts` pins both arms plus the
pre-existing INTERACT_RANGE + 1 open boundary, which keeps despawn-grace
corpses out of reach). The HUD consumes gatherResult as a rarity-colored
"You gather:" line worded apart from the grant hub's "You receive:" loot
line with no second cue (review catch: the first draft double-logged and
double-played; five-reviewer fan-out, zero blocking after fixes). A new
parity scenario `professions_gather` (seed 3) pins the draw order across
hosts; no existing golden changed. gatherResult gained qty and rareEvent
fields; the cue reuses existing sampled SFX (new cues are
manifest-gated). Deferred: node tier gating (Phase 12), recipe
consumption of the new materials (Phase 10), rare-event deed authoring
(Phase 15), a live-server instance-exclusion broadcast arm (unit-level
covered).

Phase 4 QA (2026-07-18): PASS with fixes. Three packet audits plus the
four matched dispatch-matrix rows (architecture, cross-platform sync,
frontend seam, qa-checklist; privacy/security, migration safety, and
database performance were NO-MATCH), all seven reports complete first
try with the hard tool-call budgets baked in. REAL FIND, fixed
test-first: the signed harvest grant could overflow bag capacity by one
slot per rare-or-better roll (the fungible canAddItem pre-gate passes
on stack top-up room while a signed instance needs a fresh slot;
runtime-confirmed via the crossing case of a slot-full bag holding a
partial stack of the zone material). Every signed unit now requires a
genuinely free slot, with an unsigned stack top-up fallback when none
exists, so the truncation contract wins over signing in that edge; the
draw order and the professions_gather golden are byte-identical. The
corpse focus-harvest path carries the same pre-existing hole (it was
the cited precedent) and is filed as #2139, deliberately not fixed
here because it sits outside the phase diff. QA also landed: the
crossing-case pin, the finder-only achievement-cue pin plus
quality-color source pins (the unpinned halves of the D1 contract and
acceptance criterion 5), and comment corrections (the gatherLine
catalog comment described the exact loot-family wording the divergence
pin forbids; the gathering.ts header still claimed no world nodes
exist; gatherRareEvent's spare fields named as Phase 15 forward
payload; corpseLootAvailability's harvestStateReliable documented as a
deliberately retained seam whose false arm stays pinned POSITIONALLY
in tests/corpse_loot_availability.test.ts and tests/interactions.test.ts,
which a name-only grep misses, an audit claim that dissolved exactly
there). Verified dismissals: finderName cannot smuggle the [[i:
item-link token (validCharNameShape forbids brackets), and all four
phase-emphasis probes bind. Deferred with reasons: the rare-event
windfall's per-instance loot-line/cue burst (consistent with the D1
cue-ownership decision, Phase 15 polish candidate), the zone-1 signed
starter instances design confirm (maintainer, see state.md), the
gatherEvent.* top-level catalog namespace (functional, moving it now
is overlay churn without user value), and the pre-existing unused
instanceOrigin import in tests/parity/scenarios.ts.

### Phase 5: The professions wheel window
- [x] New window at deeds quality per DESIGN.md: view core (UI_PURE_CORES), painter, styles, i18n
- [x] Ring visualization, per-craft skill bars, tier pips, title/majors/hobby, live perks
- [x] Identity-view semantics preserved (role, ceiling, nudges, tutorial); next-unlock and switch-cost lines
- [x] Progressive disclosure: simplified unattuned / pre-first-tier state
- [x] Desktop + mobile responsive; screenshots captured for the PR
- [x] Launchers (minimap or window row + keybind) consistent with existing windows

Completed 2026-07-18 (phase-start HEAD c1b6c68f2, the release/v0.28.0 tip
with Phase 4 QA aboard). Pure UI on post-2039 reads: no wire data, no sim
behavior, no IWorld member. `src/ui/professions_view.ts` (UI_PURE_CORES)
COMPOSES `profession_identity_view` rather than absorbing it (recorded
decision: the crafting window and quest dialog keep consuming the card,
and Phase 6 owns the crafting window), so role, ceiling, both nudges, and
the tutorial state survive by construction; it adds the ring layout math
(wrap-safe pair arc, hobby chord), bars and pips with core-derived fill,
the perks readout from `PERK_THRESHOLDS`, the next-unlock union, the
switch-cost line via `requiredAmendsProgress`, progressive disclosure,
and the refresh signature. `src/ui/professions_window.ts` is a
deeds-pattern cold painter; the ring renders as DOM nodes over one inline
SVG styled entirely from `components.css` tokens (recorded decision over
canvas: theme and language switches restyle with no token caching).
Launchers: minimap micro-button, More-tray entry, and Shift+KeyP (bare
KeyP is the spellbook). Icons: fourteen procedural recipes plus
`professionIconUrl` over an empty committed WebP override set, the
`assets:professions` converter scaffold, and a bijection test green on
the empty set. i18n: the `hudChrome.professions` English block with five
non-Latin M16 fills per wordy row. Validation: `tsc` clean and the
13-file matrix green (architecture, the mobile guard trio, client_shell,
S3, completeness, css corpus and validity, the three new suites,
mobile_controls). frontend-seam-reviewer returned zero blocking; both
should-fixes landed in-phase (the perk line now interpolates the craft
name in one key instead of concatenating localized fragments, and the
bar fill moved into the view core with pins). Screenshots under
`docs/screenshots/professions-wheel-window/`. Notes: `CRAFT_MAX_SKILL`
(300) lives in the view core as a presentational cap because content
defines no craft-side maximum and sim craft skill is uncapped;
`data-icon="target"` is the accepted launcher glyph until designer crest
art arrives; the `gather_fishing` icon ships ahead of its Phase 11 read,
and the painter's gathering name map gains the fishing row plus its
catalog key in Phase 11. The minimap launcher is the rail's eighteenth
micro-button, which broke the 1366x768 side-rail height budget; the
short-viewport compaction gap tightened from 2px to 1px (652px of the
660px budget) with the `crafting_launcher` guard re-pinned deliberately;
the next button added must revisit the rail (DESIGN.md phase 3 replaces
it with the launcher hub).

Phase 5 QA (2026-07-18): PASS with fixes. QA-start HEAD aee72d830 (the
PR 2145 merge; the phase diff is that merge's FIRST-PARENT diff, the
branch having absorbed the #2133 SFX sweep mid-phase). Three packet
audits plus the two matched dispatch-matrix rows (frontend seam,
qa-checklist; no sim/server/wire/database row matched the pure-UI
diff), all five reports complete first try under hard tool-call
budgets. Zero blocking findings. Landed from the audit: the simplified
raise-vs-start CTA decision moved from the painter into the view core
as a SimplifiedCta union on SimplifiedCallToAction (model logic the
both-worlds core tests could not reach), both arms pinned; the three
unconsumed Hud wrappers (openProfessions, closeProfessions,
professionsWindowOpen) dropped, toggleProfessions staying the one
consumed entry point (closeDeeds and deedsWindowOpen carry the same
dead-member debt pre-existing, left alone); sixteen new test pins
across the three suites: the painter's simplified/syncing surface (the
whole pre-cprof online render path had no DOM test), unknown gathering
id renders no row plus all-unknown omits the section, above-display-cap
saturation (pips, fraction, and max above 300, not only at it),
missing-craft-key-equals-zero signature equivalence (a materializing
zero can never trigger a spurious rebuild), gathering maxSkill as its
own signature dimension, unknown-major null arc, the raise CTA and
specialized perk-line interpolation arms, ring node/arc/chord emission
gating, opener-focus restore-once, the PERK_THRESHOLDS uniformity
premise behind the single perk explainer, and an icons manifest
lockstep guard that reads asset-manifest.json itself (the deed crests
are deed_prof_*, a separate namespace; two audit reports misread them
as prof_* and dissolved on verification). Live verification:
mobile_tray_overflow OK (19 buttons, none clipped) and an 18-assertion
probe over the real dev client, all green (desktop Shift+KeyP, Esc,
minimap button, stubbed attuned full mode with arc, chord, ten rows,
perks, and switch cost 8, mobile More-tray open and close, no NaN in
any state). Copy verified against sim constants: per-tier masterwork
odds (MASTERWORK_PER_TIER_ABOVE_CHANCE) and the specialization
material discount are real mechanics. Deferred with reasons: the
switch-cost line rendering for never-attuned full-mode players (the
amendment scopes the line without an attunement condition; maintainer
copy call); richer CTA copy for the practically unreachable
specialized-boundary corner (points stay arithmetically correct since
the 75 threshold coincides with a tier boundary, documented in the
core; a new key would need M16 fills); RingArc endpoint symmetry with
RingChord (painter-side SVG assembly, math unit-pinned); the
pr_shot_targets stateIsFn dual-shape guard (harmless script
robustness); painter open-while-open and toggle branch pins (low
value); a real-ClientWorld pre-sync empty-craftSkills pin (belongs to
a Phase 3 net suite; the missing-key signature equivalence covers the
risk). Also corrected: the state.md screenshot-convention drift note
claimed a docs/pr-screenshots/ convention that never existed in the
tree; the packet's shots live under docs/screenshots/ per root
CLAUDE.md.

### Phase 6: Crafting window upgrades and celebrations
- [x] Recipe rows show profession + required skill + skill-gain difficulty tint (#2037)
- [x] Combo rows name their requirement; station-bound rows show a badge and disable reason
- [x] Masterwork toast + zone-visible broadcast (Phase 4 soft-zone mechanism); tier-up toasts; maker's mark and masterwork in item tooltips
- [x] Online inspect carries instance payloads (identity wire extended, parity pinned)
- [x] Craft button never lies: same eligibility rule as the sim in both hosts (shared craftSkillGainMultiplier and combo_eligibility)

### Phase 7: The Guild letter and quest objectives
- [x] Trending-pair classifier: pure, deterministic, own module (`src/sim/professions/trend.ts`; `GUILD_LETTER_SKILL_THRESHOLD` = `TIER_SKILL_STEP`), unit-tested (closes the #1295 gap)
- [x] The Guild letter arrives via the mail system on trend detection: exactly one pair-correct `guild_trend_` letter on a fresh crossing; backfill single-fire for legacy high-skill saves; attuned and threshold-hovering characters never (re)receive it (`guildLetterSent` one-shot, the `mailWelcomed` shape)
- [x] Letter content id-based in `src/sim/content/letters.ts` (10 pair-keyed letters naming Smith Haldren, the stand-in master until Phase 8); `entities.letters` coverage via `LETTER_IDS` and `LETTERS_BY_ID`; M16 fills in the five non-Latin overlays
- [x] S3 scanner gap closed for good: `src/sim/quests/quest_commands.ts` was ALREADY in scan scope (PR 2039); every player-facing string verified covered; scan-list membership now pinned by a meta-guard in `tests/localization_fixes.test.ts`
- [x] Tutorial-panel timing item: no defect exists (the surface is the pure derived hint in `profession_identity_view.ts`, correct by construction); pinned by test
- Note: the "craft/gather quest objective types" line above predated the approved amendments; the letter rides `q_archetype_acceptance` (gather objective, shipped with PR 2039), so no new objective types were needed.

### Phase 8: Stations and masters (sim and server)
- [x] Station registry generalizes `requiresHubStation` to typed stations (forge, kitchens, apothecary, tannery, loom, toolworks); `CRAFTING_HUB_MIN_LEVEL` retired (`src/sim/professions/stations.ts` + `STATIONS`/`STATION_TYPE_BY_CRAFT` content; `recipe.stationType`; stable deny id `station_required`; `crafting_hub.ts` deleted with every consumer migrated; no recipe strands, the nine former hub recipes craft at their typed stations)
- [x] Master NPC records for the six deep crafts, spread across the three zone hubs (four archetype anchors in zone 1; tannery in Fenbridge; apothecary in Highwatch; assignment pinned in `tests/professions_station_placement.test.ts`)
- [x] Automated placement-safety test: no profession NPC or station within aggro-plus-buffer of hostile spawns (content-derived buffer, per-zone camps, mutation-proven failable)
- [x] Mobile crafting station perk activates (bypasses the station gate for the placed craft's station type; specialization-gated `place_mobile_station` wire command in both worlds with the `mst` self-delta mirror, plus a `/dev mobilestation` arm)

### Phase 9: Station presence and recipe training
- [x] Stations render as world props (`src/render/stations.ts` + pure `stations_core.ts`; existing GLBs only, no radius decal); the six masters map to existing NPC visual keys; token-colored, tier-identical `station` minimap marker in both host shapes
- [x] Skill-tier-gated recipe training at masters on the `acquireRecipe` gate (`src/sim/professions/training.ts`: `teachTierMet` is exactly the locked predicate; fees 0/25s/1g by tier, server-side, charged exactly once) with the visible locked-row ladder in the Train view (`src/ui/hud/vendor/train_view.ts` + painter); every existing recipe grandfathered known via the flag-discriminated `recipesGrandfathered` normalize-on-load (frozen 21-id `PRE_TRAINING_RECIPE_IDS`; legacy fixture test green); the three combo recipes are the wave-one trainer-taught set; new recipes default trained-not-known (pinned)
- [x] Master shops stocked: each master sells the premium reagents its own station's recipes consume (tinker_gizzel all six; darva/ottilie/hesk thorium_ore; Bree unchanged), closing the Phase 8 travel-loop flag; training fees are gold sinks
- [x] Hands-vs-stations split confirmed live (landed in Phase 8; the `FIELD_RECIPES` OPEN item resolves as the default: the nine commons stay field-craftable, recorded in state.md)

### Phase 10: Recipe ladders and materials content
- [x] Tier ladders for all six deep crafts (common through rare at minimum) with material families (`LADDER_RECIPES` in `src/sim/content/recipes.ts`: 54 trainer recipes, 9 per craft, 3 per rung at skillReq 0/25/50; outputs and materials in the new `src/sim/content/profession_items.ts`; no epic rung, per the locked wave-one ladder)
- [x] Cloth sourcing: humanoid components + plant fiber; corpse component quest-item collision ended (`homespun_cloth` via the new cloth componentTag on humanoids, the herb ladder serves as plant fiber; `HARVEST_COMPONENT_ITEMS` remapped to dedicated materials, quest items keep their questId-gated kill-loot roles, regression suite `tests/harvest_component_materials.test.ts`)
- [x] Economy invariant test pinned: no recipe vendors for more than its inputs (`tests/recipe_economy.test.ts`, strict less-than over every recipe in ALL_RECIPES with vendor reagents priced at purchase price; 14 pre-Phase-10 violators ride the frozen `LEGACY_GOLD_POSITIVE_RECIPE_IDS` exception list, a Phase 15 burn-down target pinned three ways)
- [x] Cross-tier composition; combat-worthy consumables at every cooking/alchemy tier; materialTierBonus wired; the perfect specimen (every rung-50 recipe consumes a lower-band material, pinned; food/potion/elixir outputs at every rung inside the existing power curves; `src/sim/professions/material_tier.ts` at 0.01 per tier, max-tier rule, tier-0 contributes exactly 0 so parity goldens are unchanged; `pristine_hide`/`pristine_silk`/`pristine_venom_gland`/`prime_cut` granted signed at rare+ on the existing corpse rarity roll)
- [x] Wiki content regenerated; recipe data feeds the guide (regenerates clean with zero diff; the generator does not yet enumerate recipe records, so the guide skeleton is unchanged, and the professions guide rewrite stays the Phase 15 deliverable)

### Phase 11: Fishing joins the framework
- [x] Fishing proficiency (additive, framework-integrated) while the minigame stays as-is (the
  fishing row joins `GATHERING_PROFESSIONS` appended last; one point per landed catch, junk
  included, through the shared `queueGatheringGrant` queue; no-bite, bags-full, and the
  codfather quest branch never accrue; the minigame's guards, fixed 5 s cast, emitted strings,
  and single table draw are untouched; the fishing block extracted move-not-rewrite into
  `src/sim/professions/fishing.ts` behind SimContext, sim.ts shed 111 lines, parity goldens
  byte-identical)
- [x] Catch rarity ladder feeds cooking tiers; rare catch integrates (deed intact)
  (`FISHING_TABLES_BY_BAND`, bands at proficiency 0/100/200 via `fishingBandFor`, pure state
  ahead of the unchanged single rng draw; higher bands shift weight out of junk and empty-hook
  rows into the six cooking fish; glimmerfin weight deliberately flat in every band and
  `col_glimmerfin` plus the per-zone fish marks untouched; band 0 is the shipped table object
  byte for byte, pinned by literal seed sequences in `tests/professions_fishing.test.ts`)

Phase 11 notes (2026-07-20): phase start 09e943669 (the release/v0.28.0 "prepare v0.28.0"
tip; QA diffs 09e943669..the PR head, first-parent across the 83b929398 release sync). Built
as DRAFT PR #2197 while v0.28.0 shipped; after the cut, release/v0.29.0 (623b10aee) was
merged in (sync commit 83b929398, release-merge-audit clean: three incoming commits, the
Discord invite-rotation revert only, zero overlap with the phase diff) and the PR retargeted
to release/v0.29.0. Phase 11 QA runs after the maintainer merges it. Decisions: catch feedback landed as the text-free personal
`fishingResult` SimEvent (gatherResult family) rendered as `hudChrome.gathering.catchLine`
colored by ItemDef quality with no second cue; the packet OPEN item resolved as fold-in (no
separate skill id, gprof unchanged, ALL_DELTA_KEYS stays 49). Deferrals: the
guide.professions gather prose still says "Three gathering trades" (the Phase 15 guide
rewrite owns the reword; touching reviewed prose trips the full-gate i18n
semantic-regression pins); a live chat catch-line screenshot was skipped (the two window
surfaces are covered before/after). QA probe-first: the extraction commit 62ee26ec8
move-not-rewrite, band-1 liveness at proficiency 150, and the live GameServer gprof round
trip suite.

Phase 11 QA (2026-07-20): PASS with fixes, zero blocking. Verified off the merge
15c9794db9 into release/v0.29.0 (QA diff = the PR #2197 commits first-parent across the
83b929398 sync, whose only cargo was the Discord invite-rotation revert). Method:
validation matrix green at the untouched tip first (the matrix suites plus tests/parity,
925 tests, tsc clean), one Explore context load, then an adversarial-verify Workflow (3
packet audits + the 5 dispatch-matrix reviewers; every nontrivial finding retried by two
independent skeptics under distinct lenses; all audits delivered structured output first
try) plus a correctness probe suite run and deleted in-tree (band boundaries live at
99/100/199/200, startFishing deny arms, codfather full-bags, col_glimmerfin off a real
fished koi, nonzero persistence round trips). The extraction stopping rule never
triggered: move-not-rewrite confirmed at line level, draw order and observable behavior
unchanged, the two sanctioned additions (fishingResult emit, grant queue) draw-free after
the single roll. The one guard regression found and fixed: the S3 drift guard's scan list
was not extended to src/sim/professions/fishing.ts, so the three relocated literals whose
only emitters now live there (no-bite, rare catch, face-fishable-water) had silently lost
reword-drift protection (matchers unchanged, zero runtime impact; the guard now reds on a
reword, mutation-verified). Coverage closed test-first, each pin mutation-verified: the
band-2 top-band liveness literal (B2_SEQ_4242, diverging from the band-1 walk exactly
where band 2 lands the koi and band 1 an empty hook), the codfather over-capacity
force-add (the quest soft-lock defense), col_glimmerfin on the fished path, the
startFishing deny arms plus the fixed 5 s zero-draw cast start, negative band input, the
NONZERO fishing persistence round trip (every prior fixture carried fishing 0), and the
ACCEPTED rollback caveat pin (a stripped-key reload re-zeroes fishing only, the other
three professions survive). Cleanup: the data.ts FISHING_RARE_ID / FISHING_TABLES
re-export arm, left consumer-less by the extraction, dropped. Deferred with reasons: a
char_window DOM-level gathering test (the undefined-key skip arm is unreachable by
construction: rows come from the fixed client-side GATHERING_PROFESSION_IDS list, and the
label-map tripwire plus the wheel-window DOM pins cover the reachable arm), a
vale-fallback cast test (unreachable via zoneAt: ZONES is exactly the three tabled zones,
clamped at the strip ends), the SWIM_DEPTH deep-water alias now at four copies
(extraction chore candidate, drift note in state.md), gathering accrual past maxSkill
(pre-existing semantics shared with node harvests across all four professions; the wheel
UI clamps via the Phase 5 above-cap saturation pin), and the catchLine unknown-item
fallback arm (defensive, unreachable today).

### Phase 12: Base tool tier gating
- [x] Nodes carry tiers; tool tier + skill gate node and corpse-material access
- [x] The 15 existing tools change outcomes; stale no-op test pin replaced
- [x] Tool effects remain parked (explicitly out of scope)

Built 2026-07-20. As-landed decisions (the phase file's "As landed" block is the authority):
text-free `gatherDenied` SimEvent + `hudChrome.gathering.*` keys instead of sim_i18n matcher
rows; the tiered fishing rods (ironreel tier 2, silverstream tier 3, trader_wilkes) were
authored HERE because no rod tier vocabulary existed; corpse gating reads the all-tier-1
MONSTER_MATERIAL_TIERS table so the deny arm never fires in shipped content (deny = premium
downgrade, yield preserved); the fishing band cap is silent (12b owns rod-synergy UX); no new
IWorld member; parity goldens byte-identical. Deferred: rod-synergy and cap visibility UX
(Phase 12b), higher-tier corpse families (future content composes with the live gate), the
node hover tooltip is desktop-pointer-only (mobile reads the minimap lock tint + denial
toast).

Phase 12 QA (2026-07-20): PASS with fixes, zero blocking. Verified off the merge a57e43b78
into release/v0.29.0 (QA diff = the PR #2217 commits c139db6d5..4fa130aedf first-parent
across the 59f9c42d2 sync, whose only cargo was the market landscape PR #2107, clean
release-merge-audit on record). Method: validation matrix green at the untouched tip first
(tsc plus the seventeen phase-touched suites), one Explore context load, then an
adversarial-verify Workflow (three packet audits plus the four dispatch-matrix reviewers;
every BLOCKING or SHOULD-FIX finding retried by two independent skeptics under
code-verification and impact lenses; all seven audits delivered structured output first
try), with a correctness probe suite driven through the real Sim and deleted in-tree
(bare-hands tier-1 success, rng-free t2/t3 denies with exact event shapes, pick unlocks,
per-profession owned-best, the herbalism arm, corpse deny and restore via withTier with
identical claims and draws, silent band caps with and without rods, useItem rod casts,
both-host denial liveness). Two SHOULD-FIX decisiveness holes fixed test-first with
mutation verification: the fishing band min() proficiency arm was one-arm-only (a tier-3
rod at band-0 proficiency now pins band 0; the pre-fix suite passed with the min collapsed
to the rod arm), and requiredTier was never pinned at any value other than 2 (an
owned-but-short iron pick at a tier-3 vein now pins requiredTier 3). Also landed: the
herbalism deny/unlock arm through the real harvestNode, the corpse
granted-with-tool-at-raised-tier arm, the FIRST-failing-family pin on the corpse deny
event (asymmetric raised tiers both ways at the pre-hunted seed 11), a draw-count liveness
pin on the determinism drive's fishing arm, withTier absent-component restore hygiene, and
the gate-order comment correction in gather_node_interact.ts (the client pre-gate
deliberately reports the lock before readiness while the sim checks respawn first; both
orders were already pinned, the comment claimed they matched). Verified clean: the PR body
references all five screenshot pairs, wiki:content regenerates no diff, no scope-creep
timing mechanic, the parked tool-effect half has zero callers, rods stocked at the literal
trader_wilkes. Deferred with reasons: the main.ts gate-wiring source pin (rename-fragile
idiom; the sim/server deny is the authoritative backstop, so a dropped wire only costs the
pre-gate line), the items.ts isGatherToolUse consistency swap (zero behavior change), the
toolTierUnmet key composition duplication (two copies, below the rule of three), the
hover-tooltip listener-logic test and the *_tooltip.ts painter-scan naming, and the
minimap per-build tool-tier memo allocation. Drift notes in state.md.

Phase 12b QA (2026-07-20): PASS, zero blocking; QA diff 26f7f40b9..8e7bc1121 audited off the
merge 43bfcb927. Fan-out: 21-agent Workflow (3 packet audits + 6 dispatch-matrix reviewers,
all 9 delivered schema-forced first try; every BLOCKING/SHOULD-FIX finding verified by two
skeptics, refute + impact lenses). The Pin-cost appendix executed with ZERO violations: every
touched test file classifies as an appendix row, a pre-cleared additive class, or pure
additive registration; the band literals carry a discriminating draw (second discriminator at
index 23). The anti-cheat stopping rule is NEGATIVE by live probe (every broadcast field
walked for a mid-cast angler; no hidden key, castTot constant, castRem decay bite-independent
across seeds). Played beats: the offline rhythm loop end to end 13/13 via CDP (gather cast
2.5 s with real key-input move-cancel, constant fishing bar, bite line, reel-in with the
Mirror Lake deed firing through the bite moment, got-away miss, immediate recast); the live
GameServer bite-and-reel arm rode the correctness probe. Six skeptic-confirmed SHOULD-FIX
regression-protection gaps (no live defects) fixed in the QA PR, all mutation-verified:
deadline-tick no-miss arm, cancelCast/arena/fiesta/session-cap hidden-field clear pins, the
useItem gather busy arm, the six cue routing pins (fishBite always-audible), plus literal
re-pins (constant-self-comparison removals, rod-synergy same-draw literals 127/107/87, cast
bar fill pins, exact reel-cue set) and the harvestNode duplicate bag-scan hoist. Docs: the
predicate-consumer wording corrected in state.md + the phase file (7 boolean consumers, 4
id-discriminating sites), appendix re-inventoried with the QA pins. Deferred with reasons:
observer-bobber bite flip (owner-only by design), nameplate per-frame localize (pre-existing),
raw hex log colors (repo idiom), placeholder cues pending #2208 (release-notes caveat), guide
bite-minigame prose (Phase 15 rewrite), mobile fishing E2E (desktop probe + committed mobile
shots stand; Phase 15 sweep).

Phase 12b (2026-07-20): built off release/v0.29.0, phase start 26f7f40b9 (the Phase 12 QA
merge). Seven build commits (predicate extraction, gather cast, bite minigame, ui, appendix
re-pins, professions_gather regen in its own commit, new contracts) per the phase file's
commit cadence. The Pin-cost appendix executed row by row; the professions_gather seed
re-hunted to 1 under the cast-reshaped drive (mobs silenced up front because mob damage
cancels a gather cast, per-iteration band-0 proficiency reset plus a newest-8 signed
retention filter keep the 100-cast window solvent, sampleEvery 500; the labelled frames pin
cumulative draws 2/4/204). The two fishing-cancel goldens verified byte-identical, not
regenerated. Live boundary semantics: reel valid while tickCount <= deadline, miss at
deadline + 1; reel-window tick literals 60/75/90 per rod tier; delay bounds [60, 160] bare
and [60, 100] at tier 3. Deviations and the two pre-briefed outside-appendix additive
extensions are recorded in the phase file's as-landed block and state.md (surfaces + drift
notes + tuning finals). The full validation matrix, parity, net/wire, i18n, and audio rows
were re-run green first-hand at the head before review dispatch.

### Phase 12b: Gathering rhythm
- [x] Gather cast (tool-tier and band scaled, floored); completion re-validates; move cancels free
- [x] The shared non-spell-cast predicate consolidates the eleven cast-id exemption sites
- [x] Fishing bite minigame: hidden seeded delay, private bite SimEvent, server-authoritative reaction window, reel via pole re-press, miss costs nothing
- [x] Rod synergy: shorter average delay, wider window (composes with Phase 12 bands)
- [x] Placeholder cues routed and PLACEHOLDER-marked (sfx:check green, listed on #2208)
- [x] Every Pin-cost appendix row executed as briefed; no unlisted pin weakened (two pre-briefed additive extensions outside the appendix, recorded in the as-landed block: the game_audio cue census 14 to 20 and the gather_event_i18n fishingResult cue pin)

### Phase 12c: The Mastery Curve
- [x] The four-state curve replaces the free floor (1 / 0.5 / 0.25 / 0; every recipe tier included; zero new Rng draws)
- [x] Enforced per-profession caps as content data (crafts + enchanting 125, mining/logging/herbalism 100, fishing 200) at all four clamp arms
- [x] Gathering gains node-tier-relative; fishing gains band-relative and fractional; constants named, exported, pinned
- [x] The one-time reset (two maps + one flag, nothing else): keep ledger pinned, re-crossing audit green, blob-diff rehearsal evidence recorded (synthetic corpus; the production-copy run is the maintainer's pre-deploy step), notice letter delivered once
- [x] The shared action throttle covers crafting, disenchant, enchant-apply, salvage
- [x] Enchanting gains quality-tiered with the soft ceiling; q_prof_hobby_switch xpReward 0
- [x] Four-state difficulty colors and the cap-aware mastered state in the UI
- [x] Pin-cost appendix executed as briefed; goldens byte-identical outside the appendix pair (addendum rows recorded in both phase files)

### Phase 12d: Provenance and the harvest loop
- [x] Identical-payload material stacking in bags AND through the bank move path; counted instanced stacks ride trade, wire, and removal correctly
- [x] Gathered by copy, the bag-grid instanced marker, and the full-bag signed-downgrade notice
- [x] One interact press loots AND harvests; denial of either half never blocks the other; corpse lifecycle decoupled; town focus verified and made legible (picker pre-checked, hint copy)
- [x] Mail attachment expiry (30 days, one return cycle, system mail exempt by construction)
- [x] Companion fixes landed and pinned: #2139 (verify-not-refix: the filed overflow was already guarded, now pinned + merge-aware guards) and the force-rename signer sweep

### Phase 13: Enchanting reachable
Built 2026-07-21 on feature/professions-2-phase-13-enchanting, phase-start
682df1b7b (the 12d QA merge); QA diffs 682df1b7b..the PR head. Commit
train: content (typed reagents + consumer enchants + bind-on-trade), seam
(IWorld + wire + server dispatch + pins), wire-minimization docs,
coverage suites, UI (bags menu + confirm + picker + toasts), review
fixes, mobile ctx-menu stacking fix, screenshots, docs.
- [x] Disenchant + enchant-apply + salvage on IWorld, wire commands, bags context UI, both hosts
- [x] Enchanting skill visible in the wheel window (already a CRAFT_RING craft; pinned by tests/professions_enchanting_reachable.test.ts)
- [x] Typed disenchant reagents (hybrid): rare+ adds the type-keyed secondary; every typed material has a same-phase consumer (the wolf_fang rule, referentially pinned); staves/wands in the WEAPON bucket per the resolved decision
- [x] Bind-on-trade primitive live against the typed rare+ reagents (generic enforcement arm for Phase 14b; two-session online arc pinned)
- [x] Inherited 12c pacing verified: the shared throttle and quality-tiered gains govern the newly reachable actions (online cross-action attribution pinned)

### Phase 14: Attunement quests and nudges
- [ ] Acceptance lore quests at the masters for all four wave-one archetypes
- [ ] Repeatable-quest support; make-amends wired; cheap-first-switch costs
- [ ] Trend nudges (chat first, Guild letter voice); attunement summary explains everything before commit
- [ ] Work-order quests per master (cadence-capped) and one-shot-per-tier master mail
- [ ] Title celebration on attunement
- [ ] The crafting-window "learnable at a master" hint (shown exactly when unlearned trainer recipes exist, via the shared viewer predicates)

### Phase 14b: Commissions and the Maker's Bond
- [ ] Commission opt-in at craft; the marker rides the instance in both hosts
- [ ] First trade stamps boundTo; onward trades refused beside the def-level soulbound gate, localized deny id
- [ ] Master unbind service: resolved fee, replay-safe, signer and masterwork markers survive
- [ ] The three flagged maintainer decisions implemented exactly as resolved in state.md
- [ ] Mail/market face-to-face construction pinned against the new marker

### Phase 15: Deeds, tuning, and polish
- [ ] Universal profession deeds incl. titles + marquee renown on first attunement and first masterwork, the Specialist deed, and the rare-find deeds (plus the rare fish, verified to celebrate through the Phase 12b bite moment)
- [ ] Mastery deed additions: fishing's first deed, prog_master_gatherer counts fishing, per-craft mastery deeds at the resolved caps with the approved titles; no 300 reference anywhere; reset re-crossings double-grant nothing
- [ ] Economy tuning targets applied (#1301 fee/throttle live rows; the FINAL-marked rows verified byte-unchanged); faucet-vs-sink review recorded incl. the market fee, disenchant margin, and gland-to-pristine ratio rows
- [ ] Legacy junk-recipe burn-down dispositioned, cross-checked against the typed-reagent consumers first
- [ ] Profession SFX completion sweep over #2208: placeholders replaced or explicitly re-filed, station ambiences, per-craft success variants
- [ ] The wiki at the RuneScape bar: per-skill pages, tables generated from sim content, exact numbers per the transparency policy, English-only keys with the guide-scoped M16 exemption; asset manifest final
- [ ] Whole-feature qa-checklist.md matrix green; packet teardown offered

## Notes

(append per-phase notes, deferrals, and surprises here as sessions complete)

2026-07-20 timing and economy amendments: a second maintainer-approved
amendment pass (community feedback on gathering feel and the crafted-goods
economy) restructured the remaining packet to 12, 12b, 13, 14, 14b, 15.

2026-07-20 mastery and provenance amendments (the SECOND same-day block;
state.md carries the authority rulings): the close-out brainstorm with the
maintainer settled pacing (the four-state curve, enforced caps 125/100/200,
the one-time skill reset with the keep ledger), provenance and stacking
(identical-payload merge, Gathered by, the unified loot-and-harvest
interact, mail expiry), the market ruling (gold buys materials, never
skill), the offline-taster ruling, and resolved EVERY standing flagged
decision except the letter-to-Haldren dead-end (which still rides Phase
14): the three 14b decisions, the staves/wands bucket, the work-order
formula, q_prof_hobby_switch (0 XP), masterwork discovery credit (keep
def), master voices, the titles scheme, the rare-event shared knob, the
specialization finals, and the training-fee extension. Phases 12c (#2235)
and 12d (#2236) were inserted after the 12b QA; community draft PR #2134
is out of consideration by maintainer ruling. Community inputs recorded:
the signed Ironbark Log confusion thread, the common-recipes-to-300
question, and the loot-versus-harvest report (its gland-to-pristine ratio
feeds the Phase 15 faucet review).
state.md records the rulings under "2026-07-20 timing and economy
amendments" (the authority block); the new phase files
(phase-12b-gathering-rhythm.md, phase-14b-commissions-binding.md, both
with QA twins) and the amended Phase 12/13/14/15 files (each swept with
its QA twin in the same pass) carry the deliverable wording. Epic #1866
gained sub-issues #2206 (12b), #2207 (14b, linking #1298), and #2208 (the
profession SFX help-wanted list); #2051 and #2053 closed against their
landing PRs in the same sweep. The Phase 12b file introduces the Pin-cost
appendix pattern: the phase pre-briefs its complete deliberate re-pin and
golden-regen list, inventoried against the release/v0.29.0 tree, so QA
audits appendix fidelity instead of discovering the blast radius.

2026-07-17 design-review amendments: a maintainer design review (the
response to the external Codex review) amended the packet between Phases 2
and 3. state.md records the rulings under "2026-07-17 design-review
amendments"; the owning phase and QA files, the cross-cutting docs, and the
asset manifest carry the updated deliverables (see the amendment PR's diff
for the full file list). The any-signed masterwork condition ships as its
own code change ahead of Phase 3, verified by the Phase 3 pre-flight. The
checklists above were updated in the same pass; unchecked items describe
the AMENDED deliverables.

Phase 2 (2026-07-17): phase-start commit 9a5ce7a93 (the Phase 1 QA merge,
the release/v0.27.0 head); code-final commit 90ba58f17 (the
professions_craft parity golden); the docs commit follows it, so the QA
session diffs 9a5ce7a93..branch-head. Implemented on the worktree branch
feature/professions-2-phase-02-masterwork. Validation: whole-repo tsc
clean; the six phase suites (204 tests), the new and reader suites (122),
the net/wire row (377), and tests/parity (174 passed, one pre-existing
env-gated skip) all green; the full gate passed every stage except the
known environmental armory browser failure (PR CI is the arbiter), with
typecheck and the env/server/client builds finished manually per the
established playbook. Reviews: six read-only reviewers (architecture,
cross-platform-sync, privacy-security, migration-safety, qa-checklist,
test-coverage-auditor), zero blocking and zero unresolved should-fix
findings; the archetype-ceiling-gates-masterwork semantic and the
chore-first commit order are deliberate and explained in the commit
bodies. Deferred and surfaced items live in the Phase 2 drift notes in
state.md: the rollback enchantability caveat for the release notes, the
two battlefield trickle questions, the guide prose deferral to Phases 6
and 15, and the standing instance-payload wire invariant.

2026-07-19 Phase 6 (crafting window upgrades and celebrations) landed on
feature/professions-2-phase-06-crafting-window off release/v0.28.0
(phase-start 0a4fd8078, the Phase 5 QA merge). All five checklist rows
check; #2037's scope closes with the PR (close by hand at merge,
release-branch merges never auto-close). Both sanctioned seam touches
landed as specified: announceMasterworkZone (a new structured
masterworkZone SimEvent riding the exported Phase 4 emitToZonePlayers,
rng-free, instance space excluded) and the eqi identity-wire inspect
extension (server-trimmed to signer/enchant/rolled, mirrored into
ClientWorld equippedInstances, no new IWorld member). As-landed
deviations, all recorded in the state.md Phase 6 surfaces entry: NO
sim_i18n matcher row exists (the broadcast is text-free ids+values on
the gatherRareEvent precedent; the S3 guard passes by construction);
the celebration gate is the deeds pure-plan style (no fireworks module
exists; reduced motion trims only the banner fade, information and the
ARIA announcer never gated); the parity golden professions_craft
eventDigest was re-pinned deliberately (the crafter's own zone copy,
rng fingerprints byte-identical); armory_inspect.ts is the cosmetic
skin panel, the real gear-inspect surface is hud openInspect (threaded
there). Five-reviewer fan-out (architecture, cross-platform-sync,
frontend-seam, privacy-security, qa-checklist): zero blocking; all four
should-fixes landed in-phase (shared craftSkillGainMultiplier consumed
by sim and view, eqi payload data minimization with a negative pin,
the tier-up diff bounded to a post-craftResult drain window, a real
plan.motion consumer). Deferred: the enchanted marker names the STATE
only (EnchantDef.name has no localized display surface; a named enchant
line needs an i18n surface first, Phase 13/15 candidate); bags/bank
grid painters still pass the def only where no instance exists on the
row (correct today); the online two-banner corner (masterwork and
tier-up can land in separate drains online, each keeps its own banner,
cosmetic only).

Phase 6 QA (2026-07-19): PASS with fixes. QA diff 0a4fd8078..206b0ffe7
(the PR 2150 merge, linear, eight commits). The whole validation matrix
ran green at the untouched tip first (tsc, the seventeen matched
suites, the mobile guard trio, i18n:gen plus completeness), so every
audit agent got already-verified ground instead of re-running suites.
Eight-agent fan-out (three packet audits plus the five matched dispatch
rows: frontend-seam, cross-platform-sync, architecture,
privacy-security, qa-checklist), all eight complete first try under
hard tool-call budgets with schema-forced structured output. Zero
blocking findings. Landed from the audit: tier_unmet now names the
unmet craft(s) (the acceptance criterion the painter missed: the view
threaded unmetCrafts but the status line rendered the generic
both-crafts sentence; the new comboTierUnmetNamed key renders only the
under-tier craft names with the required tier, the param-less key stays
the defensive fallback so no existing locale fill goes stale or loses a
placeholder, M16 fills in the five non-Latin overlays, jsdom pins for
the single, multi, and fallback arms); the tier-up armed drain window
moved from hud.ts into observeCraftSkillsForTierUps beside the plan
builder (four reviewers converged on the untested state machine; the
Phase 5 painter-to-core precedent; hud is now a three-line consumer
with identical behavior and the armed-window edges are unit-pinned,
including the delayed-toast contract for a crossing that outlives the
window); a live GameServer masterworkZone routing suite (three
sessions, the real sim.tick into routeEvents pump, each in-zone session
receives exactly its own recipient-pid copy, the other-zone session
receives nothing; the hcb broadcast-suite precedent, standing in for
the two-browser online probe since no local Postgres exists); threading
pins for the bags forwarding call site, the char_window self-mirror
closure, the openInspect slot rows, and the hud.itemTooltip composition
order; plan.motion consumer pins (banner-no-motion and the never-gated
ARIA announcer); DOM pins for the none band, the in-range station
badge, and the hover-tooltip sentence; dead imports dropped
(tierProgressMultiplier in crafting.ts, Stats in hud.ts) and the
emitToZonePlayers export comment corrected. Live verification: an
18-check puppeteer probe over the real dev client, all green (21 recipe
rows with skill line, difficulty text, and aria fold-in; 9 station
badges, every out-of-range row with its inline reason note; the three
difficulty bands driven live including the free floor and the unattuned
ceiling arm; a real tier-up crossing through the armed-window path at
the 25 and 50 boundaries with banner and chat line; reduced motion
keeping the text while setting banner-no-motion; masterwork and
legacy-signed tooltips over the real bags surface). Deferred with
reasons: the station out-of-range copy omits the level arm of the
predicate (Phase 8 retires CRAFTING_HUB_MIN_LEVEL, revisit with the
masters rework); the bounded 100-drain window can delay a toast past
severe mirror lag until the next armed window (deliberate, no per-frame
poll); the pre-cprof difficulty label transient (documented,
presentation-neutral); two procs in one drain coalesce to one
masterworkToast log line (zone and loot lines still per proc); the
crafter's third-person zone line beside their own toast (deliberate,
parity-pinned); eqi cosmetic payloads reach every interest-scoped
client like eq (identity-record semantics); the server eqi build shares
a live rolled reference (JSON-snapshotted per broadcast, server-owned,
no leak); the #ffd100 seal literal (matches the soulbound idiom,
tokenization is DESIGN.md territory) and the rule-less
tt-instance-bonus hook class; the guide.ts reword leaving Latin overlay
fills stale until the release-tier refill (standard workflow);
archetypeCeilingFor computed twice per resolveCraftForRecipe
(behavior-neutral).

2026-07-19 Phase 7 (the Guild letter) landed on
feature/professions-2-phase-07-guild-letter off the release/v0.28.0 tip
8e88b27f5 (the phase-start commit for the QA diff). Three-agent build
fan-out plus a four-reviewer dispatch (architecture,
cross-platform-sync, migration-safety, frontend-seam), zero blocking;
two review fixes landed: the letter trigger books mail through the NEW
append-only SimContext callback mailAuthoredLetter instead of a raw
injected PostOffice (registry, createSimContext passthrough, both test
stub hosts, and the pinned callback list all updated), and
entity_i18n.ts LETTERS_BY_ID now mirrors GUILD_TREND_LETTERS (the
parallel-registry drift cross-platform-sync confirmed; the
localization_coverage world-entry count formula was re-pinned to
include the 10 letters, a deliberate count re-pin, no rng golden
touched). Surprises: the phase file's S3 premise was stale (scan
coverage landed with PR 2039, so the deliverable reduced to the
membership meta-guard plus per-string verification);
nearTier/dormantKnowledge live in profession_identity_view.ts, not
wheel.ts; letters localize via entities.letters + LETTER_IDS, not the
i18n catalog, and the letter emits no free sim text, so no sim_i18n
matcher row was needed. Deliberate content choice for the design owner:
only the four wave-one archetype pairs name their titles in the letter
body (the other six titles exist in hudChrome.archetypePair but would
promise pre-Phase-14 content). Deploy note: a deploy, rollback,
roll-forward sequence can re-fire one duplicate letter (the
mailWelcomed precedent, cosmetic). Golden caution for future scenario
authors: an unattuned character with a craft pair sum of 25 or more
ticked past the 90 second delivery delay starts emitting guild_trend
mailArrived events into event digests. Fixed in passing: the status
table's Phase 6 QA row (completion was recorded in Notes but the row
still said not started). Phase 7 QA plays the vertical-slice checkpoint
(phase-07-qa.md).

2026-07-19 Phase 7 QA complete: PASS with fixes, zero blocking. Seven
agent fan-out (correctness, test-coverage, dead-code packet audits plus
migration-safety, cross-platform-sync, architecture, qa-checklist per
the dispatch matrix; privacy-security, database-performance, and
frontend-seam did not match the diff), 5 should-fix findings deduping to
3 unique, all fixed on the QA branch: (1) the online path was verified
live by inspection by three agents independently but had no pin, closed
by the live GameServer session-routing suite
tests/guild_letter_online.test.ts (owner-only mailArrived with exact
payload, mailU unread mirror 2 vs 1, booking-level one-shot when a
second pair qualifies); (2) the activeArchetype eligibility clause had
no isolating negative (the attuned test flips two fields at once),
closed by per-clause unit negatives on the exported
maybeSendGuildTrendLetter plus a flip-before-send spy pin, both
mutation-verified (deleting the guard or the finiteness check each
kills exactly one test); (3) no same-seed determinism pin for the sweep
through the real Sim, closed with an identical-arrival-tick run-twice
test. Also landed: skillOf now enforces its own positive-FINITE comment
contract (Number.isFinite; Infinity or NaN in a malformed save can no
longer classify as crossed), the system MailKind and Guild sender
pinned on the real mailInfo mailbox surface, a two-player same-sweep
case, and the letters.ts header enumerating all four authored families.
The vertical-slice checkpoint (kernel exit) PLAYED end to end in the
seeded offline world: pristine vein fired at harvest 41 with the finder
line and x5 signed mats; crafting surfaced loot line, XP, Crafted line,
Made By Hand deed, live identity-card skill movement and the first-tier
next-unlock hint; the crossing craft flipped guildLetterSent 12 ticks
later (the 1 Hz sweep) and the raven landed at exactly 90 seconds with
banner, whisper cue, chat line, correct pair letter (system kind, The
Crafting Guild) whose body names the Smith title and Smith Haldren; the
acceptance quest flow attuned the pair through the 10-archetype chooser
with its live Result line (Title Smith, majors uncapped, hobby
Leatherworking); a masterwork procced with the full-screen marquee,
personal toast line, AND the zone-broadcast line; the sole-copy
masterwork traded to a second player with signer + rolled.masterwork +
stats payload intact. ONE experiential finding, DEFERRED to the
maintainer (design decision): the letter's call to action dead-ends for
a player who has not done q_prof_intro, Smith Haldren shows only his
greeting and vendor line (q_archetype_acceptance reads unavailable
behind requiresQuest, no locked-row hint, no redirect to Foreman
Odell), so the letter's promise silently fails for exactly its target
audience (players who leveled crafts without the mining intro); options
recorded: a locked-quest hint row in the dialog, a letter-body pointer
to the Copper Dig (needs the 5 overlay refills), or softening the
requiresQuest gate when skills already qualify. Observations, no
action: the starter weapon recipe (arming sword) can never masterwork,
masterworkBonusStats is null for its stat-less def, so the tier-1 Smith
proc path is the caster-stat warded leggings (design note for Phase
8/10 recipe ladders); zone-1 pristine copper feeds no recipe (the
recorded Phase 4 zone-1 mitigation), so the signed-mats-into-craft link
starts with battlefield-drop reagents or zone 2+; trade removal prefers
fungible copies, a signed copy transfers only when it is the only copy
(the recorded Phase 3 model, a specific-instance offer UX is a future
call); the mail arrival banner is lost if the recipient is offline when
the raven lands (pre-existing PostOffice announce semantics, welcome
letter identical); an old client renders an unknown guild_trend_
letterId as the raw id (pre-existing letters behavior, system-wide
resolver fallback filed as a future nicety). NITs recorded, not worth
churn: source-scan pins tolerate commented-out entries (accepted
precedent), replaceAll clarity in the letterId scheme, the sweep bills
to the postOffice lap bucket, a third backfill load, a dedicated parity
scenario (the determinism pin covers the risk, the sweep draws zero
rng). Release cut reminder: the 10 letters' pending rows for the
non-M16 locales fill at the release-tier gate as usual.

2026-07-19 Phase 8 (stations and masters) landed on
feature/professions-2-phase-08-stations-masters off the release/v0.28.0
tip 571ab0219 (the phase-start commit for the QA diff). Three-agent
sequential build workflow (sim, content, tests) plus a six-reviewer
dispatch (privacy-security, cross-platform-sync, architecture,
frontend-seam, migration-safety, qa-checklist), zero blocking; the one
should-fix (a stale optimistic-mirror doc comment on the
activeMobileStationCraft facet member) was fixed with two follow-up
guard tests (recipe-stamp stranding guard, mst expiry-to-null arm).
Notable calls: the online liveness gap the build left (ClientWorld's
activeMobileStationCraft pinned null) was closed IN-PHASE with the mst
self-delta mirror rather than deferred, because a disabled online
Craft button beside an active mobile station is exactly the 2033 stub
class; the parity goldens were regenerated in their own commit for the
six static NPCs' purely mechanical +6 entity-id shift (id-family keys
only, draw order untouched, determinism arms green); the Tools of the
Trade deed desc was reworded station-neutral with the 18 stale locale
desc fills dropped for the release refill. Surprises: the
placement-safety buffer is bound by bursar_fernando against the boar
camp (11.19), not smith_haldren against the wolves (12.34) as
predicted; sim/items.ts rejects vendor rows without a positive
buyValue, so several natural reagent stocks were dead rows (tanner and
weaver stocks are flavor picks instead); deleting an i18n catalog key
hard-fails tsc on every overlay still carrying it (the retire recipe
is catalog delete + orphan-row delete + i18n:gen in one pass); the
RELEASE TIP ITSELF was red in tests/chronomancy.test.ts (the absorbed
PR 2154 barrier-scaling merge missed the chronomancy absorb pins),
repaired here in its own labeled commit (184/84 to 194/94, the
documented 25 percent spell-power term). Content flow note for the
maintainer: the six premium reagents still sell only at Quartermaster
Bree in Highwatch while the toolworks/loom/forge recipes now craft in
Eastbrook, a deliberate buy-then-travel loop to reconsider in Phase 9
stocking. STILL OPEN (unchanged from Phase 7): the Guild letter's
call to action dead-ends pre-q_prof_intro; the masters ship with
EMPTY questIds hooks and no redirect was silently implemented.

Phase 8 QA (2026-07-19): PASS with fixes, zero blocking. Nine-agent
fan-out (three packet audits plus privacy-security, migration-safety,
cross-platform-sync, architecture, frontend-seam and the closing
qa-checklist; database-performance did not match the diff), every
agent complete first try under the 30-call budget, with the phase
validation matrix pre-verified green at the untouched tip and passed
to every agent as ground. The correctness audit ran six live
headless-Sim probes (deny away from the station, wrong-type deny,
at-station success, all nine field recipes far from any station, the
full mobile place/craft/expire cycle against real ticks, caster-recipe
radius behavior at 19 vs 30 out) plus proof that FIELD_RECIPES equals
the pre-phase nine COMMON_RECIPES ids. Findings: 18 total, 3
should-fix, all fixed: the Phase 9 phase file still pointed its
reader at the deleted crafting_hub.ts (swept to stations.ts and the
crafting.ts gate), the /dev mobilestation arm had zero coverage (now
proves the cheat routes through the real specialization gate), and
the hud station_required deny toast had no binding pin (source-pinned
in profession_identity_card.test.ts). Fixed NITs: the FIELD_RECIPES
set pin was a tautology against its own definition source (now pins
the nine literal ids), the mobile expiry boundary was only incidental
(exact strict-below pin added: active at expiry-1, expired at the
expiry tick), and two comments (stations.ts header, CraftResultView)
implied a mobile-arm proximity check the spec'd gate deliberately
does not have (reworded). Dissolved on verification: the
crafting_hub test filename misnomer (its header documents the
deliberate keep for the deeds.ts anchors), the hud fallthrough
mislabel (unreachable by construction and documented in-code), the
slow-band set allocation (cold painter, throttled, pre-phase
equivalent), and the place_mobile_station rate-limit worry
(self-scoped transient slot overwrite, no growth, no rng, no db).
Closed decisively: guide freshness (wiki:content regenerates no
diff; the guide does not enumerate town NPCs). Deferred with notes
in state.md: the Eastbrook loom-toolworks radius overlap (design
observation for Phase 9 props and minimap), the consumer-less
MobileCraftingStation pos/placedAtTick/playerId fields (Phase 9
props are the natural consumer), the expired station object
lingering on the meta slot until the next placement (benign, every
reader checks isStationActive), and the mobile-viewport station row
being screenshot-verified only.

2026-07-19 Phase 9 (station presence and recipe training) landed on
feature/professions-2-phase-09-station-training off release/v0.28.0
tip d40f0a90f (the phase-start commit for the QA diff; re-resolve the
merge commit at PR time). Build was a three-agent parallel Workflow
(sim/wire, render, ui) in one shared worktree with a fixed interface
contract plus a tests agent after; all four completed first try.
Decisions this phase made (maintainer-visible, none altering a locked
state.md decision): the wave-one trainer-taught set is the three
COMBO_RECIPES (skillReq 25, exactly the locked "uncommon at 25" rung;
commons and the 75/150 TOOL/CASTER recipes keep empty acquisition,
grandfathered known to everyone by the isRecipeKnown arm, per the
locked wording); grandfathering is a flag-discriminated
normalize-on-load (recipesGrandfathered, mailWelcomed idiom) that
unions the frozen 21-id PRE_TRAINING_RECIPE_IDS into any save missing
the flag, so legacy characters keep the combos while new characters
train them; training proximity accepts STATIC stations only (a mobile
crafting station never satisfies training, pinned); the crafting
window now lists known recipes only (unlearned trainer recipes
surface in the Train ladder instead). Deferrals with reasons: the
train_not_taught_here deny arm has no positive test (content-
unreachable until a drop/quest acquisition recipe exists; precedence
pinned, Phase 10 owns content); the mobile-station prop stays
deferred (pos/placedAtTick still consumer-less); visualKeyFor pins
for the six master ids and a tokens-coverage pin for
--color-minimap-station were skipped as optional; the i18n
semantic-regressions suite is gate-tier only (no locale prose
reworded). Surprises recorded to memory: the parity harness pins new
persisted PlayerMeta fields by default (the 55-golden regen is
exactly the recipesGrandfathered field, its own reviewed commit);
resolveCraft denies combo_requirement_unmet before recipe_not_learned;
wardweave_cowl/duskhide_wraps/sootscale_mantle genuinely consume
thorium_ore, so the master-stock mapping is thorium-heavy by content,
not by choice.

Phase 9 QA (2026-07-19): PASS with fixes, zero blocking. Ten-agent
fan-out (three packet audits plus privacy-security, migration-safety,
cross-platform-sync, architecture, frontend-seam, test-coverage-
auditor and the closing qa-checklist; database-performance did not
match the diff), with the phase validation matrix pre-verified green
at the untouched tip and passed to every agent as ground. Seven of
ten completed inside the Workflow; frontend-seam, privacy-security
and qa-checklist finished their investigations but failed structured
delivery and were re-dispatched fresh via the Agent tool (the
established recovery recipe), all completing there. Played behavior
was verified twice over: the correctness audit ran six live
headless-Sim probes (exact-balance train to zero, key-absent legacy
blob, mobile-station craft beside the training deny, same-row ladder
flip, multi-violation deny order, a grandfathered common crafted at
skill 0), and the orchestrator drove the real offline client over
CDP (gossip Train option, tier deny with the named "You need Alchemy
25" line, exact-fee train, replay deny with no re-charge, fee-1
cannot-afford, out-of-range, the 8yd proximity auto-close, the
crafting-window known-filter in both directions, the station minimap
marker and token, trained-not-known on a fresh character); the
online arm rests on the live GameServer routing suite plus the
snapshots cprof-mirror pin, both re-verified decisive. All nine
acceptance criteria hold. Fixes landed: the exactly-affordable fee
edge (copper equal to fee) pinned at the Sim level; per-pair deny
reason-to-key mapping pins (a key swap inside the hud ternary chain
previously passed every pin); isStationMasterNpc parametrized over
all six STATIONS masters with a smith_haldren negative; a same-row
locked-to-teachable flip pin at the 24/25 boundary; a full
multi-violation deny-order pin; an explicit server-side
recipesGrandfathered-true pin on a fresh online join; a key-absent
(pre-#1299) legacy-save arm; and the accepted rollback caveat turned
into a pin (a full current-shape blob stripped of the flag re-unions
on return, fee-free, exactly the state.md release-notes wording).
One frontend should-fix landed as a small extraction: the
viewer-side knownness predicate was duplicated between the crafting
window filter and the train ladder, now shared as train_view.ts
isRecipeKnownForViewer (both call sites delegate; the known-filter
source pin deliberately re-pinned to the delegation), and rowState
now calls the sim's own teachTierMet instead of restating it.
Dissolved on verification (the seventh phase running): the
correctness agent's claim that the legacy fixture shape was wrong
(knownRecipes existed at phase start d40f0a90f; the hand-frozen
fixture is a genuine pre-Phase-9 shape). Deferred with reasons: the
unknown-deny-reason fallback renders the out-of-range line instead
of nothing (reachable only under client/server version skew on a
closed 5-member union; maintainer call for a later phase); a
same-state same-craft mobile-craft-versus-training-deny contrast is
impossible in wave-one content (no plain station-gated alchemy
recipe and no engineering trainer recipe exist; covered by
cross-suite composition plus the live probe); the tokens-coverage
pin for --color-minimap-station stays the accepted build-time
deferral; the pr_shot_targets forge position literals are
script-only. Privacy INFO for the economy owner: the master
stocking makes thorium_ore and the six premium reagents purchasable
in zones 1 and 2 where previously only quartermaster_bree (zone 3)
sold them; deliberate, no price/arbitrage loop. The closing
qa-checklist returned READY (zero blocking, zero should-fix); its
five verify items all closed from session ground: the architecture
suite ran green in the matrix, the fee table matches the state.md
tuning targets verbatim (common free, uncommon 25s, rare 1g), the
asset budget output is byte-identical to phase start (zero public/
changes; its red rows are pre-existing debt outside the gate), guide
freshness rides the gate's pretest wiki:content plus
tests/guide.test.ts, and mobile rests on the green mobile window
suites plus the phase's committed mobile screenshots (live mobile
E2E not re-run, the Phase 8-precedent deferral). Its remaining INFO,
a dedicated train_recipe rate limit, stays optional: the command is
idempotent (already-known denies without charging) and the global
command cadence limiter applies.

Phase 10 (2026-07-19): recipe ladders and materials content, built as
an ultracode Workflow off phase-start 720efc89f (the Phase 9 QA merge;
the QA diff is the PR's commits off that tip). Orchestration: two
parallel writer agents (materials/collision/specimen, and the
materialTierBonus wiring) with disjoint file ownership, then six
parallel craft designers returning structured ladders to scratchpad
JSON, folded in by three sequential integration passes (one commit per
craft pair) and a dedicated economy-test writer, with the validation
matrix run green at the tip before the review fan-out. Quest credit
was verified BEFORE the harvest remap landed: all three collect quests
(q_boars, q_spiders, q_widows) have questId-gated kill-loot drops on
their own mobs, so no quest lost its source. Key as-landed calls, all
swept into both phase-10 files: the economy invariant carries a frozen
14-member legacy exception list (8 commons, the 3 caster-hub rows, the
3 combos; measured, pinned three ways, Phase 15 burn-down) because
fixing the legacy sellValues would break the prime directive inside a
content phase; the perfect specimen grants IN ADDITION to the plain
component at rare+ (specimen-less families keep the old signed-regular
behavior); every new recipe including the skillReq-0 rungs is
station-bound and trainer-taught (coexists with the grandfathered
field commons); materialTierBonus keys off def-level material tier
bands, not consumed-instance rarity (instances do not report which
copy was consumed); the six raw fish already existed so no fish
ItemDefs were authored; no new deeds (recipes and materials are not
conquerable content per docs/design/deeds.md). Deferred with reasons:
guide recipe enumeration (Phase 15 professions guide rewrite), the
recipeForResultItem reverse-lookup gap for non-common tables
(pre-existing), a single shared battle-elixir aura slot (maintainer
call; per-item power stays capped at the bear's 12), and the legacy
gold-positive burn-down (Phase 15).

Phase 10 QA (2026-07-19): PASS with fixes, zero blocking. Verified off
the merge af7ac3d8b (QA diff 720efc89f..ad2bbbe92; the merge's first
parent 8564d1ee2 was concurrent release movement with zero file
overlap, verified). Method: validation matrix green at the untouched
tip first (19 suites incl. the five item-content convention suites,
727 tests, wiki:content zero diff), four live played beats (train with
the full deny ladder and exact fees, station-bound craft end to end,
rare+ specimen dual grant with zero quest-item leakage across 400
seeds, mid-objective q_boars save-compat with a working turn-in, and
the materialTierBonus 10000-craft odds decisively above the no-bonus
model), economy-invariant mutation checks (both arms bite), then a
25-agent adversarial-verify Workflow (3 packet audits + the 4
dispatch-matrix reviewers, every finding retried by an independent
skeptic: 14 confirmed, 4 dissolved). The one real sim defect: a corpse
with two specimen families could overflow the bag (the jackpot stole a
later family's reserved plain slot); fixed test-first by granting all
plain yields before any signed instance, draw order untouched. Also
landed: the ladder execution suite (all 54 recipes craft end to end,
specimen consumers, real train rungs, elixir def pins + live use path,
silkspun_satchel capacity), the HARVEST_COMPONENT_SPECIMENS literal
pin plus all-family behavior arms, the train_view locked-row literal
re-pin (formula tautology), item_icons BAG_IDS sixth bag, the stale
TOOL_RECIPE_STUBS sweep, and an itemFallback potion/elixir flask
branch (the eleven new consumables rendered junk-trinket icons).
Deferred with reasons (drift notes in state.md): wolf_fang consumer
(the one demand-rule outlier, Phase 15), recipeForResultItem widening
(a live gameplay switch for the dormant battlefield-XP trickle,
maintainer call), shared battle-elixir exclusivity (maintainer call,
re-confirmed), cooking rungs are sit-heal food only (maintainer
glance), and the retro CI reds on the release push (Release gate
locale shards + version gate) are the branch-wide mid-cycle state,
identical on the pre-phase push, with the Browser job green.

2026-07-20 Phase 12c (The Mastery Curve) built: phase-start commit 67ae62629
(the PR #2240 docs merge), PR #2242 off release/v0.29.0, branch
feature/professions-2-phase-12c. Five thematic commits per the phase cadence
plus the M16 letter-fill fix, the two appendix golden regens, a
deeds_reconcile fixture re-pin the full gate caught, screenshots with a new
four-states shot variant, and the review-round fix commit (six reviewers, all
READY, zero blocking).
- KEEP LEDGER (pinned row by row in tests/professions_mastery_reset.test.ts):
  inventory items KEPT; bank KEPT; copper KEPT; tools KEPT; knownRecipes
  KEPT; recipesGrandfathered KEPT; attunedPairs and switch history KEPT;
  hobbyCraft KEPT; deeds and renown KEPT; level and XP KEPT; quest state
  KEPT; mail KEPT; craftSkills RESET; gatheringProficiency RESET (legacy
  professions key included); masteryResetApplied ADDED (CharacterState
  only); perk and specialization activation DERIVED; tier capability
  DERIVED.
- BLOB-DIFF REHEARSAL EVIDENCE: tests/mastery_reset_rehearsal.test.ts
  default synthetic-corpus mode (modern 12b-era blob, legacy
  professions-key-only blob, over-cap values, minimal fresh blob,
  already-reset blob; the corpus is built from serializeCharacter with fixed
  seeds plus a stabilization round trip so deed retro grants never pollute
  the diff): 7 passed, per-blob assertion that the ONLY deltas are the two
  zeroed maps (plus the legacy professions dual-write mirror), the flag
  true, and the documented cap clamps on over-cap rows. The 12c QA added the
  completeness arm: a flag-absent row must also show every craft and
  gathering leaf (legacy professions mirror included) at exactly 0 in the
  output, so a PARTIAL reset fails loudly instead of tallying as applied,
  in the synthetic corpus and the production-copy run alike. The
  PRODUCTION-COPY run is the maintainer's pre-deploy step: export characters
  as JSON rows [{id, state, playerClass}] (include playerClass so each row
  rehearses under its true class; omitting it defaults the row to warrior,
  which the diff discipline tolerates but does not prefer) and run
  RESET_REHEARSAL_INPUT=<path>
  npx vitest run tests/mastery_reset_rehearsal.test.ts. The deploy does not
  ship without that run.
- BATTLEFIELD TRICKLE SHARE (for the Phase 15 review): BATTLEFIELD_XP_TRICKLE
  stays 0.25 through the capped gainCraftSkill. Under the curve, 0.25 per
  qualifying observed use equals one green own craft, half a yellow, a
  quarter of an orange; once a specialist's recipes gray out the trickle is
  the only nonzero channel at a quarter of the old per-craft rate. Dormant
  in shipped content.
- MAINTAINER-VISIBLE consequences (deliberate, pinned): pre-curve characters
  who never logged in since the Book of Deeds shipped do not receive the
  join-time skill-proof retro deed grants at first curve-era login (the
  reset zeroes skills before the retro sweep); they re-earn on the next real
  action. The rollback strip-refire caveat is DESTRUCTIVE of
  rollback-window progress (release-notes item, pinned as a conscious
  acceptance). The reset-notice letter can be lost in the bounded
  crash-between-saves and sub-tick-disconnect windows (the authored-letter
  non-atomic class; skill zeroing itself is never affected).
- Deferrals: fixture-hygiene rows deliberately left at maxSkill 300 where
  they are pure pass-through view inputs never compared against content
  (professions_window_focus incl. its fictional skinning row, the
  professions_contracts type-contract record); battlefieldExperienceTrickle
  still RETURNS 0.25 at cap while the write clamps (return-contract chore
  candidate); craft-celebration tier-up toasts can re-fire for a reset
  character re-crossing a tier (client-side session-scoped, cosmetic,
  approved); herbalism/logging finish 75 to 100 on t2 nodes at 0.25 (only
  ore ships a t3 node), roughly twice mining's time-to-cap for that stretch
  (Phase 15 balance review). Phase 13 heads-up: the shared throttle gates
  disenchant/salvage BEFORE their rng draw (unwired today; the wiring QA
  should remember the budget couples them to crafting's window).

Phase 12c QA (2026-07-20): PASS, zero blocking. QA phase-start 61959116c (the
PR #2242 merge, the release/v0.29.0 tip); QA diff 67ae62629..75e261deb
first-parent audited off that merge. Validation matrix green at the untouched
tip (tsc + 1755 tests); eleven mutations all decisive (free-floor restore,
each of the four cap clamp arms, partial reset, serialize-flag strip, letter
flip-before-send, salvage recordAction removal, fishing junk-cutoff removal,
enchanting soft-ceiling-to-hard-zero). Fan-out: 12-agent Workflow (3 packet
audits + 5 dispatch-matrix reviewers + refute-and-impact skeptics +
qa-checklist last); four agents died on mid-run API connection errors and
were re-dispatched via the Agent tool, 4 of 4 delivered (the standing
big-diff recovery recipe); skeptics dissolved 2 of 3 SHOULD-FIX findings
(sanctioned appendix addendum rows), the third survived at nit impact.
- REAL FINDING, fixed test-first: the blob-diff rehearsal verified only the
  allowlist direction, so a PARTIAL reset (one map left unzeroed) passed the
  synthetic corpus AND would have passed the env-gated production-copy run
  while tallying the row as applied. The completeness arm now requires every
  craft/gathering leaf (legacy mirror included) at exactly 0 on flag-absent
  rows; mutation-proven (a partial reset reds three corpus rows).
- Coverage closures: tests/mastery_reset_online.test.ts (NEW, live
  GameServer): join-time reset on the authoritative host, the notice booked
  exactly once through the server tick, the persisted blob carrying the flag
  and a zeroed legacy mirror, restart-plus-relog never re-firing. Re-crossing
  positive control (a never-earned prog_mining_100 granted FRESH on the
  climb, proving the deed sweep runs in the no-duplicate pins' exact idiom).
  GOLD_ACCENT_COLOR lockstep pin (tokens.css --gold, the TS twin, and the
  literal #ffd100 agree).
- Shot-stub sweep: scripts/pr_shot_targets.mjs staged post-curve-impossible
  values (weaponcrafting 132 over the 125 cap, gathering rows at maxSkill 300
  with herbalism 203); the LIVE IWorld path was verified correct
  (gatheringSkillsView reads the content caps), so this was a committed-
  screenshot fidelity defect only; the stubs now stage post-12c-legal values
  (125 mastered, 88/45/100/68 over 100/100/100/200) and the six after-shots
  were recaptured.
- Played beats (real Sim + the CDP capture): pre-curve blob reset with the
  letter exactly once; a real curve climb 0 to 75 through all four states at
  the exact boundaries (25 full + 50 reduced + 100 minimal crafts, then
  gray); the honest throttle window (10 fill, the 11th throttled, cross-kind
  deny, a 1201-tick restore); a real reduced-arm 0.5 gain crossing to exactly
  125 at the Eastbrook forge and a masterwork proc at cap (with the
  dormant-never-procs ceiling gate confirmed empirically along the way); the
  enchanting quality ladder at skill 75 (common gray, uncommon 0.25, epic 0.5
  under the soft ceiling); the four-state window and the mastered state
  verified in the live client.
- New recorded caveat (display-only): raw-blob readers (character sheet,
  armory, character select) show STALE pre-reset skills for a pre-curve
  character until that character's next login; no live entity is built from
  those reads, and the display self-heals at login (the authored-letter
  non-atomic class's display sibling).
- Load-bearing ordering note: normalizeArchetypeState is the single
  load-time reader of PRE-reset skill values (identity derivation only, by
  design); any future archetype-POWER change must key off the live
  post-reset skill number, never the derived attunement alone.
- Declined with reasons: a same-tick multi-grant band-straddle pin (reachable
  only via repeated /dev gather on one profession; queue semantics and the
  drain clamp are already pinned); a 49.99 fishing boundary pin (the 49/50
  pair already pins strict-less semantics). Comment-only free-floor drift
  fixed in place (crafting.ts CRAFT_SKILL_GAIN, wheel.ts tier-0 wording).

Phase 12d (2026-07-21): complete, PR #2264 merged into release/v0.29.0
(e302c8be5, PR head 1e7019d6c). Phase-start commit
a9d499291 (the Phase 12c QA merge, the release tip all session). Build =
six-stage sequential workflow, one cadence commit each, plus follow-ups.
- The four merge points landed together with the equality module
  (item_instance_merge.ts); the charges carve-out is the one deliberate
  extension of the byte-equality spec (mutate-in-place field, forward guard).
  sanitizeBankState's count clamp flipped in the same commit (the item-loss
  hazard); the rollback caveat is recorded in state.md and the PR body.
- The unified press needed NO new command or IWorld member: client-side
  composition of harvest_corpse then loot_corpse, availability-gated, with
  the town-focus default server-derived from the components-omitted arm.
  Sim.interact()'s TARGETED-corpse arm was missed by the build stage and
  unified in a follow-up commit with its own pin (the scan arm alone was
  landed first).
- Two deliberate parity golden regens, draws verified byte-identical outside
  the moved rows: professions_gather (merged stacks move inventory shape)
  and l1_loot_distribution (the grace window defers the respawn wanderTimer
  draw past the trace window).
- The full suite caught six contract pins the build matrix missed (five
  emptied-tagged-corpse fast-collapse pins across sim/social/fixes suites,
  plus the retired-heroic mail round trip absorbing the deploy clock); all
  re-pinned with comments. The recurring full-gate-catches class.
- Review fan-out 7/7 delivered first try, zero blocking; three should-fixes
  landed (marker accessible-name arm via hudChrome.bags.itemAriaInstanced,
  removeItem survivor-clone pin, the rollback caveat recording).
- #2139 verify-not-refix: the filed crossing case was ALREADY guarded by the
  Phase 10 QA grant-order fix; the phase pinned it at the hunted seed and
  made all signed-grant guards merge-aware (canGrantItemInstance), so a full
  bag with a byte-equal stack keeps the signature instead of downgrading.
- Deferred with reasons: foreign-held copies keep a renamed signer's old
  name (own-blob scope per the phase file, flagged maintainer surface);
  zero-loot tagged corpses never open (pre-existing, the Phase 3 note);
  partial instanced splits and the bags/bank split-prompt gate on counted
  instanced stacks (wave 2 polish); mail expiry has no UI countdown (the
  return letter's arrival toast is the visibility surface).
- Mid-PR release sync (2026-07-21): the tip moved 7 commits (loot class
  balance #2237, the character showcase redesign #2248/#2255, offline-mode
  dev gating #2254, the unspectate resync #2253); merged in as 4b7280cdb
  with TWO conflicts (hud.ts import block: union of the gatherDowngrade
  import and the release's holder_tier removal; generated pending.ts by
  regen). Release-merge-audit CLEAN: the true branch overlap was hud.ts,
  components.css, the catalog, and the five overlays, all intents verified
  present post-merge; loot_roll.ts and sim_context untouched by the delta
  so the lifecycle premises stand; the release's nythraxis_full_pull golden
  re-pin does not overlap the phase's two regens and full parity is green
  on the merged tree; the delta's new db-mock key (getCharactersCount) is
  release-owned, not the branch-export trap.

Phase 12d QA (2026-07-21): PASS, zero blocking. QA phase-start 402deef1c (the
release/v0.29.0 tip: the e302c8be5 merge plus the a02823fb7 packet amendment
and one release merge); QA diff a9d499291..1e7019d6c first-parent audited
across the 4b7280cdb release sync. Validation matrix green at the untouched
tip (tsc + full suite, 1432 files / 17752 tests). Fan-out: 21-agent Workflow
(5 probe charters + 5 dispatch-matrix reviewers + qa-checklist sweep + paired
refute-and-impact skeptics per serious finding); the two custom-agentType
reviewers (cross-platform-sync, privacy-security-review) completed without
structured output and were re-dispatched via the Agent tool, 2 of 2 delivered
(the standing recovery recipe). The re-dispatched wire review confirmed
against the real encode/decode that the omitted-vs-[] harvest components
distinction survives the online path (JSON.stringify drops undefined; the
server decode maps a non-array back to the town-focus default), that NO new
command or IWorld member landed, and that gatherDowngrade reaches online
clients through the generic per-pid event routing; parity and census suites
green (318 tests). Conservation held in EVERY inventory,
lifecycle, mail, companion, and provenance probe; the companion agent
mutation-verified all three #2139 guard pins (cp-restore dance, pristine
tree). Five skeptic-confirmed (REAL/REAL) SHOULD-FIX findings, ALL landed
this pass, plus the directed should-fix:
- DIRECTED (user-approved wording): the corpse loot window's Take All button
  is now Take Loot, both corpse buttons moved off native title attributes
  onto the shared attachTooltip idiom (hover, mobile long-press, keyboard
  focus), and the approved unified-press footer hint landed on the
  town-focus-hint idiom. Four NEW keys with five non-Latin fills each (M16);
  the retired takeAllTooltip/harvestButtonTooltip rows left the catalog and
  ALL overlays (in-place rewords go stale; the union regen makes tsc enforce
  the removal). Pins: literal labels both arms, both tooltip bindings, the
  hint, empty native titles. Before/after shots desktop + mobile.
- INV-1: the carried-inventory hydration in addPlayer loaded tampered counts
  verbatim while the bank arm sanitized; both load arms now consume ONE
  bags.ts helper (instancedCountCap), mutation-verified pin on the real
  addPlayer path. Includes the INV-4 refinement: an unknown item def stays
  dormant uncapped data on the mergeable arm (never destroyed), while the
  charge cap stays def-independent.
- INV-2: every instanced-trade pin drove a hand-copied stub of removeItem;
  landed a REAL-Sim counted-stack trade pin (both directions, both sides
  offering the same payload in one confirm, unit conservation).
- QA12D-CL-01 + F1: the harvestCorpse-arm grace clamp's never-raise side and
  the press-level denial decoupling (capacity-denied harvest still delivers
  the loot half, claim unconsumed) were live-verified but unpinned; pinned
  on both interact arms.
- MAIL-1 (nit, landed): the deploy clock's absent-secondsLeft legacy arm
  pinned beside the sentinel arm. FE-2 (nit, landed): the gathering toast
  key helpers now return TranslationKey (casts removed, typo'd keys fail
  tsc).
- Deferred with reasons: fitsAfterSwap's payload-blind scratch removal
  (capacity modeling only, over-capacity tolerated by design; wave 2 with
  partial splits); the rename-save no-nonce TOCTOU (self-state only, tiny
  window, mirrors the existing delete-guard class); harvest_corpse
  components array length unbounded (short-circuited server-side, ws
  maxPayload bounds the frame); the marker accessible-name "maker-marked"
  overclaim on non-signed per-copy stacks (maintainer copy call); the
  unified-press hint showing on loot-only corpses (the approved wording is
  unqualified); release-notes propagation of the DESTRUCTIVE
  sanitizeBankState rollback caveat (recorded in state.md; no v0.29.0 notes
  file exists yet, a cut-time item).

Phase 13 QA (2026-07-21): PASS, zero blocking. QA phase-start 90e502786
(the PR #2269 merge, the release/v0.29.0 tip); QA diff 682df1b7b..90e502786;
fix branch fix/professions-2-phase-13-qa. All 13 acceptance criteria
verified against real code; validation rows green (wire quartet 444, phase
suites 103, i18n guard, architecture + trade, tsc, parity goldens 183,
browser suite 66/66 with the known armory environmental red not even
reproducing). Fan-out: STEP 1 context loader, then a 6-agent Workflow
(correctness / coverage / dead-code audits + race, live-mirror,
mail-market emphasis probers), then 4 dispatch-matrix reviewers plus
qa-checklist over the fix diff; the orchestrator ran the live browser
probes itself (confirm-dialog keyboard arc, picker captures).
- REAL FIX (sim): fitsAfterSwap modeled the pre-stamp payload while
  grantOffer stamps boundTo on arrival; wrong in both directions (full
  receiver with a byte-equal armed slot granted OVER capacity 17/16;
  already-stamped byte-equal slot denied a fitting trade). Now models the
  stamped arrival; test-first, both directions pinned incl. the locked
  decoy that makes the isTradeLocked walk skip discriminating.
- REAL FIX (ui, live keyboard probe): Enter on the focused confirm OK
  fired the chat edge (focus escaped the aria-modal dialog), Space died
  to the jump preventDefault; keyboard users could never confirm.
  bindDialogKeyActivation repairs the family; jsdom pins + live re-probe
  ALL PASS.
- MAINTAINER-DIRECTED: Apply Enchant picker sizing (ctx-menu-picker
  modifier, both arms capped and scrolling, seven clear sites, CSS guard,
  refreshed desktop + new mobile picker shots).
- Promoted the five QA probe suites as durable pins (arc, coverage,
  races, result mirror, bound surfaces); bound-surface refusal is
  EMERGENT from the #1165 fungible-only escrow, flagged for #1146.
- Deferred as maintainer calls: salvage skill-gain absence (by design?),
  mid-trade enchant not resetting accept flags, all-enchanted disenchant
  row UX, generic mail/market bound-deny copy (#1146).
