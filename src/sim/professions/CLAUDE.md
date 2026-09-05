<!-- Area-scoped: src/sim/professions/ only. Root + src/sim CLAUDE.md already
     loaded (determinism, SimContext seam, module-first); this file covers the
     professions subsystem's own contracts. -->

# src/sim/professions/: profession mechanics

The mechanics home for gathering, crafting, enchanting, salvage, and the
archetype identity system. Every module here is host-agnostic sim logic behind
the `SimContext` seam (`src/sim/sim_context.ts`): functions taking `(ctx, ...)`
or pure leaves, never a `Sim` import, randomness only via `ctx.rng` (guarded by
`tests/architecture.test.ts`). The data tables live in `src/sim/content/`
(`professions.ts`, `recipes.ts`, `gather_nodes.ts`, `enchants.ts`), never here.

## Module map (mechanic owners; `ls src/sim/professions/` for the live set)
- `gathering.ts`: gathering proficiency + node harvest (`harvestNode`/
  `resolveHarvest`, `NODE_HARVEST_TABLE`, the `rollMaterialRarity` rarity
  ladder, the gather cast `gatherCastDurationSec`). Node respawn is per
  VIEWER: two players can see the same node differently.
- `gather_events.ts`: the per-node-type rare events (always signed, five
  times yield) and the zone soft-broadcast `emitToZonePlayers`.
- `node_persist.ts`: pure leaf persisting per-player node readiness across
  logout as remaining-time deltas (the `src/sim/cooldown_persist.ts` scheme;
  D6). `serializeNodeReadiness` writes only still-running timers;
  `applyNodeReadiness` re-anchors on load, filtered to live node ids and
  clamped to one respawn (the anti-tamper arm is load-side on purpose).
- `material_grades.ts`: the fine-material axis. Pure leaf owning the nine
  base/`fine_` grade pairs, the ZONE tier ladder the upgrade compares against
  (NOT `material_tier.ts`'s price band, which is a different ladder and puts
  the Eastbrook yields at 0), and the downward substitution planner the craft
  and quest consumption paths share. Upgrade needs the tool STRICTLY above the
  material AND a vein carrying that tier; substitution runs downward only.
  `planRemovalOver` is the removal KERNEL (walk these ids, take this many,
  emit no zero lines); `planGradeRemoval` is that kernel over the grade
  ladder, and `reagent_sources.ts` runs it a second time over the same ids
  against a different pool. One planner, many appliers: every site that
  removes across grades applies a plan from here rather than walking its own.
- `reagent_sources.ts`: pure leaf owning the ONE implementation of the
  carried-first-then-vault order (`planReagentSourceDraw` -> a
  `ReagentSourcePlan` of `carried` takes, `vault` takes, `planned`,
  `shortfall`). Every site that resolves where a reagent's units come from
  consumes this plan: the craft availability check, the bag-capacity scratch
  gate, the real consume, the Create All batch simulation, and all six enchant
  count/apply arms. A SECOND implementation of the order is a defect. Two
  rules ride on the split it returns: only `carried` takes free bag space (a
  capacity scratch that models `vault` takes over-credits room), and a caller
  that plans several reagents before spending any must tally the vault side
  itself, since nothing is decremented while planning. Whether the vault is in
  play at all is `vault_craft_gate.ts`'s question, never this module's.
- `fishing.ts`: the fourth gathering row (bite delay, reel window,
  `FISHING_TABLES_BY_BAND`, and since R19 the gain model: the schedule half
  `fishingCatchGain` composed with the water's teaching ceiling in
  `fishingCatchGainAt`, the ONLY function a grant site may call); the catch-band
  ladder is NOT here since masterwrought Phase 11i (see `fishing_bands.ts`
  below), and the schedule VALUES are derived from a recorded casts-to-200
  model while its four BOUNDARIES stay frozen, because the teaching ceilings
  derive from them; the TWO
  sessions' hidden per-cast state lives in
  transient Entity fields (`gatherCastNodeId`, `gatherCastToolRarity`, and
  the R40 consent `gatherCastEffectConfirmed` for the gather cast;
  `fishBiteAtTick`, `fishReelDeadlineTick`,
  `fishCastZoneId` for fishing), never wired, never persisted, all cleared
  together on every cast exit path.
- `session_teardown.ts`: the ONE displacement cancel for a live gather or
  fishing session (`cancelProfessionSessionOnDisplacement`), called from every
  hard-displacement site. The caller list is the grep for that symbol, never a
  list kept here; the families it spans are the shared sim teleport landing
  (`displacePlayer`), instance entry and exit for dungeons, delves and rifts
  (enter, leave, eject, module advance), the spirit paths (unstuck,
  resurrection), the `/follow` zone-line crossing, the dev teleports (the sim's
  `/dev` commands and the server's `dev_teleport` message), and the server's
  own moderation moves (spectate enter and exit, jail and moderation
  teleports). The Vale Cup's pitch eject and kickoff placements were sites too,
  until it retired with release/v0.41.0. Gated on `isNonSpellCast`, delegates
  to `ctx.cancelCast`.
- `wheel.ts`: flat per-craft skills (`CraftSkills`, `gainCraftSkill`,
  `tierForSkill`/`tierCapability`, the four-state `tierProgressMultiplier`
  curve, perk-eligibility reads).
- `crafting.ts`: `craftItem` starts a CRAFT_CAST_ID cast (admission via
  `evaluateCraftAdmission`, shared with the complete-side resolve so the two
  gates cannot drift); `completeCraftCast` re-validates and applies
  `resolveCraftForRecipe` (all-or-nothing reagent consume, deterministic
  def-quality outputs plus the single masterwork proc draw, skill gain), and
  chains the Phase 3 batch (`maxCraftCountForRecipe` simulates the batch
  craft by craft so the hold-keyed self-signed discount expires mid-batch).
  Reagents come from the bags first and then the Materials Vault, and all four
  of those sites resolve that through the shared `reagent_sources.ts` plan, so
  the gate can never approve a draw the consume performs differently. Vault
  units are reported on `CraftResult.vaultDraws`, present only when a unit
  really moved. Two things stay INVENTORY-only on purpose: the #1145
  self-signed discount and the masterwork signed-reagent term, because vault
  stock is bare counts with no instance payloads and can carry no signer.
- `craft_cast_duration.ts`: the pure content-band duration table
  (`craftCastDurationSec`: skillReq/combo band, floor/ceiling clamp; no rng,
  no player state).
- `masterwork.ts` + `material_tier.ts`: the pure masterwork model
  (`masterworkProcChance`, `masterworkBumpedQuality`, `masterworkBonusStats`,
  the def-keyed `materialTierBonusForReagents`); `crafting.ts` consumes it at
  the one post-consume proc draw per successful craft. R1 (Masterwrought,
  phase 08): a masterwrought-flagged def NEVER bakes a bonus record; the gate
  is `craftBonusStatsFor` in `crafting.ts`, the ONE exported helper feeding
  both the admission capacity model and the resolve effect gate (never call
  raw `masterworkBonusStats` from production code; the draw itself stays
  unconditional so draw order never moves). Phase 12 replaces this
  suppression with the Perfecting head start AT the effect gate, where the
  proc outcome is actually known. `masterwork.ts` itself is locked by R1's
  own text and is never edited for this.
- `archetype.ts`: the active-archetype state machine (`ArchetypeState`,
  `archetypeCeilingFor`/`craftCeiling`, `getHobbyCraft`, amends-gated
  switching via `requiredAmendsProgress`). The sim-side ceiling arm is
  `archetypeCeilingFor` ALONE, never `craftCeiling`. Also owns Jack of All
  Trades (`isEligibleForJackOfAllTrades`, `attuneJackOfAllTrades`,
  `JACK_CEILING_TIER`, #1296): the breadth attunement, mutually exclusive
  with an active archetype (`ArchetypeState.isJackOfAllTrades`), reusing
  `archetypeCeilingFor`'s existing null-`activeArchetype` branch as its
  breadth ceiling rather than a second number. Attunement QUEST content and
  any switching flow between Jack and an archetype are still out of scope
  (open design questions per the issue's own Notes); `acceptArchetypeQuest`/
  `attuneArchetypePair`/`canAttuneArchetypePair` refuse outright while a
  character is Jack so no free transition can slip through either path.
- `jack_variance.ts`: the Jack of All Trades improviser output-variance roll
  (`rollCraftVariance`, #1296), a pure leaf `crafting.ts` draws ONE extra rng
  roll for at the masterwork-proc site, only for a Jack-attuned crafter.
- `hobby_memory.ts`: the per-pair record of hobbies chosen through the
  hobby-switch quest (`normalizeHobbyMemoryOnLoad`, `recordQuestedHobby`,
  `applyPairTransitionHobbyMemory`), so a make-amends RETURN restores the
  quested hobby instead of re-deriving the skill default. Applied at all three
  pair-transition entry points beside `applyPairTransitionTierMail`; it reads
  `archetype.ts`'s pair vocabulary, so `archetype.ts` must never read it back.
- `combo_eligibility.ts`: the shared attunement gate combo recipes consult in
  both hosts (deny not_attuned / wrong_pair / tier_unmet). A Jack denies here
  too, for free: its `activeArchetype`/`pairedMajor` are always null, the
  same shape `not_attuned` already covers.
- `enchanting.ts` / `disenchant_reagents.ts` / `salvage.ts`: disenchant
  (universal ladder + typed rare+ secondaries, bindOnTrade-armed), apply an
  enchant onto a SPECIFIC instanced copy (`ItemInstancePayload`), break items
  back into materials; all off-wheel, ungated, cast-paced (Phase 4/5). An
  already-enchanted copy is REPLACEABLE only behind the explicit
  confirmReplace flag (#2415: old enchant destroyed, no refund, surgical swap
  via `replacedEnchantPayloadFor`); without it the deny is the dedicated
  `already_enchanted` reason on both arms. The identical-id re-apply denies
  `same_enchant` on both arms WITH the flag; unconfirmed it reads
  `already_enchanted`, because the flag check precedes the id compare.
  Enchant REAGENTS source from bags-then-vault through the same
  `reagent_sources.ts` plan crafting uses, at all six count arms (three
  resolvers plus the three admission mirrors, which must agree or a cast is
  refused at start for materials the resolve would have found), reported on
  `ApplyEnchantResult.vaultDraws`. Reagents here stay grade-BLIND (the plan is
  run over the reagent's own id alone: the two-pool mechanic moves where a
  unit comes from, never how many are owed or what may substitute). The VICTIM
  copy is out of scope and never routes through it. Disenchant, salvage,
  unbind and tool recharge draw from the bags only.
- `perfecting.ts`: the Perfecting stage (Masterwrought phase 12) and the orange
  promotion (phase 13) on one shared deny head: a four-rank fail-forward track over
  an apex copy with exactly one rng draw per resolved attempt (zero on every
  denial), binding on the first attempt and stamping `perfected` plus the R5 bonus
  at the top; then the SEPARATE, draw-free promotion on an already-Perfected copy
  (one Deed of Making plus a player-chosen name) that overrides `rolled.quality` to
  legendary and stamps `payload.name`, presentation only. `perfectingInfoFrom` is
  the one view builder both hosts answer through. `perfecting_copy.ts` carries
  the selected copy's ordinal/count anchor and payload/provenance pin through
  confirmation and the wire; the shared deny head refuses a stale token before
  spending materials. Tokens are optional for legacy/headless callers.
- `perfecting_swap.ts`: atomic rank exchange for two owned pieces from the same
  Crucible collection. Both refs require copy pins; the shared pure view gates
  death, combat/casts, locks, distinct copies, valid progress, skill and the
  appropriate static station before either payload changes. Each swap binds both
  copies permanently, preserves names and promotion, draws no rng and charges
  nothing. `perfecting_bonus.ts` freezes each new collection copy's primary-stat
  contribution when crafted, so repeated exchanges cannot duplicate or retune it.
  `../item_instance_stats.ts` projects active stats while a Perfected-only enchant
  is dormant; its full stored contribution remains available for replacement.
- `legendary_name.ts`: the pure SHAPE leaf for a player-chosen legendary name
  (trim, collapse, `[A-Za-z' -]`, 2 to 32); the online server screens CONTENT
  before the command reaches the sim, and the load bound in
  `item_instance_load.ts` is deliberately looser (the signer doctrine).
- `commission.ts`: the Maker's Bond (commission opt-in mints `bindOnTrade`,
  `resolveUnbind` + the quality-tier fee ladder).
- `commission_order.ts`: the commission order board (#1298) layered on the
  Maker's Bond: a requester opens an order naming a recipe and a scope (the
  open board, or one named crafter), a crafter accepts and crafts with the
  commission opt-in exactly as before, then delivers the still-unbound copy
  face to face (the same bind-on-first-trade stamp `trade.ts`'s `grantOffer`
  applies; mail and the World Market refuse instanced payloads, so direct
  delivery is the one channel). An order carries NO escrow: opening one holds
  no gold or materials (order-time escrow for required materials is a flagged
  later extension, out of scope). In-memory `Sim` state only, never persisted;
  `updateCommissionOrders` is its retention sweep (open orders expire, terminal
  orders prune). Draws no rng.
- `harvest_yields.ts`: pure leaf, the corpse-harvest yield ledger (#2457)
  behind the text-free `harvestResult` event. It records what LANDED, never
  what was rolled: a signed grant a full bag downgraded to a plain top-up is
  recorded plain, and a refused specimen contributes no entry (the
  `gatherDowngrade` toast owns that feedback). ONE entry per DISTINCT granted
  item id with folded quantities, so the client's line count matches the item
  count; callers record beside each grant call, not from the roll loop.
- Craft Cast System Phase 5 retired `action_throttle.ts`: profession actions
  are cast-paced. `PlayerMeta.craftThrottle` was never persisted (session-only
  from birth) and is kept only as an inert shape for the retirement suite
  (`tests/professions_action_throttle.test.ts` pins that gameplay ignores it);
  the parity sampler excludes it (`META_EXCLUDE`).
- `training.ts`: master training (`resolveTrain`, tier-gated learning,
  `TRAINING_FEE_BY_TIER`, the one-time `PRE_TRAINING_RECIPE_IDS`
  grandfather).
- `pattern_items.ts`: recipe pattern items (kind 'recipe'): the pure
  `resolvePatternLearn` deny ladder (invalid silent, already-known,
  never-practiced, tier via the shared `teachTierMet`) plus the
  `useRecipePatternItem` apply arm dispatched from the items.ts useItem kind
  chain; learns via `acquireRecipe` source 'drop', consumes exactly one copy
  on success only (the CLICKED copy when the use names a slot, per the
  item_copy_ref tri-state contract with a pre-effect pin gate; the legacy
  newest-first walk only when no selection is named), emits the text-free
  `trainResult` ok; draws NO rng.
- `masterwrought_materials.ts`: the Masterwrought chase-material income side
  (`awardWyrmfallCores` from the death hub, the rift first-clear arm, the
  weekly Maker's Ember accrual with its pure civil-date week math, the
  per-character per-source reset-day gate on `PlayerMeta.wyrmfallDaily`).
  ONE rng draw per credited eligible final-boss kill, appended after every
  loot roll; the rift arm is draw-free.
- `sundering.ts`: the Sundered Essence extraction (`extractEssence` /
  `completeSunderCast`): a SUNDER_CAST_ID cast on the enchant-family session
  seam, raid-sourced GEAR epics only (`isSunderable` over the item_level
  source index PLUS the explicit gear-kind allowlist added at the eighth
  v0.41.0 sync, when the Ignivar span's raid-sourced epic non-gear, sigils
  and the staged core, would otherwise have widened the feedstock),
  deterministic 1:1 yield, the disenchant-style pinned-slot re-check at
  completion; draws NO rng.
- `tools.ts` / `stations.ts` / `focus.ts`: pure-leaf gates and bonuses
  (gather-tool tier, per-type crafting stations (superseding the retired
  level-20 hub), town focus allocation). Tool effects in `tools.ts` are LIVE
  end to end and this leaf owns every DECISION: `resolveSlotToolEffect` is
  the one mint authority (it also picks WHICH crafted charm copy the mint
  consumes, whose signer becomes the slot's `craftedBy`) and
  `resolveRechargeToolEffect` prices and sizes a refill (R30 fill from the
  tool held now, R39 material identity, R47 price rung floored at the slot's
  own ceiling). The R9 slot policy (`slotToolEffectRefused`) keeps Springback
  and fishing slots refused until their arms have real behavior.
- `tool_effect_actions.ts`: the slot and recharge COMMAND BODIES behind the
  seam (`Sim` keeps thin delegates). Everything stateful lives here and, for
  those TWO, every decision in the `tools.ts` leaf above: resolve first, then
  consume the price (the charm copy by index, the arcane materials), write the
  slot, and report through the one text-free personal `toolEffectResult` event
  so no refusal is silent. Draw-free in every arm. A third export, the
  admin-only `restoreToolEffectSlotAction` (R35), is deliberately NOT a
  command body and has NO `Sim` delegate: it is the server admin runtime's GM
  restore (a charm-free mint the free-grant incident bans from every
  player-reachable path), callable only from `server/game.ts`, refusing an
  intact live slot (`already_slotted`) and pinned unreachable by
  `tests/professions_admin_restore.test.ts`. It is also the one arm that does
  NOT route through `resolveSlotToolEffect`: it carries its own copy of the
  shared gate chain, which the same test pins tuple-for-tuple against the
  resolver so the two cannot drift.
- `mobile_station.ts`: the field crafting station. NOT a pure leaf: it takes
  `SimContext`, and two placement paths write the transient
  `PlayerMeta.mobileStation` slot. `placeMobileStationForPlayer` (the IWorld
  member and the `/dev mobilestation` cheat) places through the
  specialization-gated pure builder `placeMobileCraftingStation`, owner-only.
  `placeMobileStationFromItem` (the Master's Field Forge, Masterwrought phase
  09) has NO specialization gate, because holding the item IS the credential,
  never consumes the item, and stamps the station `partyShared`. That
  discriminator on `MobileCraftingStation` is what the party arm of the
  crafting station gate reads: `partySharedStationSatisfies` walks the OTHER
  party members for an ACTIVE partyShared station matching
  `stationTypeForCraft` within a squared-distance STATION_RADIUS, while the
  owner's own station still satisfies at ANY distance.
  `activeMobileStationCraftsForViewer` is the per-viewer resolver behind the
  `mst` snapshot delta: the deduped, sorted set of every craft a station
  serves the viewer, so the crafting-window rows mirror the craft gate rather
  than shadowing a shared craft behind the viewer's own. Both consumers run
  their own plain loops over the ONE private per-member predicate
  (`partySharedStationFor`), so the gate's deny and the row set cannot drift
  and a partied viewer's 20 Hz call allocates nothing on an empty answer; the
  station-TYPE filter deliberately stays out of the predicate (the gate
  layers it per craft, the resolver leaves it to `inRangeStationTypes` on the
  consumer side). Its one
  player-visible emit is the placement log line (matched by `log.placeStation`
  in `src/ui/sim_i18n.ts`); draws NO rng.
- `fishing_bands.ts`: fishing's OWN catch-band ladder, a pure leaf
  (masterwrought Phase 11i): `FISHING_CATCH_BAND_THRESHOLDS`
  ([0, 100, 150, 200, 200, 200]), the exported `FishingCatchBand` type, and
  `fishingCatchBandFor` / `fishingRodBandFor`. SEPARATE from
  `proficiency_bands.ts` deliberately: that ladder is SHARED (gathering.ts
  reads it for the land gather-cast duration, proficiency_display_heal.ts for
  the display band), so carrying fishing's six bands on it would silently
  retune land gathering. `fishing.ts` re-exports the old names and consumes
  the leaf; "thin consumer" is about the SEAM, not about size, and the
  module header records the measurement rather than implying one (fishing.ts
  went 675 to 746 lines, all 71 of them comment, and its non-comment count is
  287 on both sides, exactly flat). The band type is the ONE type every `0 | 1 | 2` site now
  writes: the four fishing SimEvent variants, `effectiveFishingBand`,
  `fishingRodBandFor`, and `server/fishing_telemetry.ts`'s label function, so
  widening the ladder again is one edit rather than seven.
- `fishing_zones.ts`: the per-zone rod-tier ladder (`rodTierRequiredForZone`,
  water gated by the WATER's zone) the cast gate and the vendor rows read;
  since R19 the SAME column also caps how far each water teaches
  (`fishingTeachingCeilingFor` in `fishing.ts` reads it at the gain site).
- `farming.ts`: the farming GROWTH ENGINE, and the module the other `farm_*`
  leaves orbit. Owns the plant and harvest command bodies and, above all, THE
  DRAW CONTRACT stated in its own header: a plant costs exactly two contiguous
  `ctx.rng` draws, a tier 1/2 harvest two contiguous (the golden-harvest roll
  then the golden BONUS roll), a tier 3/4 harvest three (the seed-back roll
  first), and every deny costs zero. The header is RESTATED WHOLE whenever a
  draw moves, never amended one line at a time. Also owns the gain model (`FARMING_GAIN_SCHEDULE`
  plus `farmingHarvestGain` / `farmingTeachingCeilingFor` /
  `farmingHarvestGainAt`, the fishing R19 shape: the boundary column IS the
  teaching-ceiling source, so it is not tuning and never moves), the
  harvest-lives yield through a PRIVATE mulberry32 seed expansion that is not
  `ctx.rng` (see the banner: it deliberately keeps seed 0 where `Rng` remaps
  it), and `FARM_EFFECT_BONUS_PICK_CAP`, farming's own cap on a slotted
  quantity tool effect, which lives here rather than in `TOOL_EFFECTS` so the
  other three land professions keep the catalog value.
- `farm_golden_bonus.ts`: pure leaf owning what a GOLDEN harvest's bonus draw
  pays (masterwrought Phase 11f): a seed of the next tier up, or at a much
  lower weight one farming pattern. One roll decides both the arm and the item
  through a partition, which is what keeps the harvest at one new draw;
  `farming.ts` re-exports the surface on the `farm_projection.ts` precedent.
  Zero new item ids, and the pattern weight is the shipped per-pattern drop
  point, held slower than the quartermaster marks route by ruling.
- `farm_projection.ts`: pure leaf owning `PlotState` (the full per-player plot
  record incl the hidden pre-rolled outcome slots) and `projectFarmPlots`, the
  ONLY public projection: explicit field picks are the wire leak barrier, and
  timestamps are absolutes in the host's own `lockoutNowMs` base.
- `farm_persist.ts`: pure leaf bridging `PlayerMeta.farmPlots` and the optional
  `CharacterState.farmPlots` row (`serializeFarmPlots`/`normalizeFarmPlots`);
  the `node_persist.ts` anti-tamper doctrine with ABSOLUTE deadlines (allowlists
  and the `FARM_MAX_GROW_MS` duration clamp on the load side; clamp before the
  future re-anchor; the zero-clock offline guard).
- `farm_load_report.ts`: pure leaf for the dev-channel visibility of a farm-plot
  load's silent-drop arms (`droppedFarmPlotCounts`, `warnDroppedFarmPlotRows`),
  extracted from `Sim.addPlayer` at masterwrought Phase 18; the counting half
  is pure and the warn stays dev-channel English, never player-visible.
- `farm_ready.ts`: the ONE ready notice (`notifyFarmReady`, called from the
  login check and the 1 Hz sweep): a personal, text-free `farmReady` event
  gated by the persisted `notified` flag, plus the Phase 18 withered-then-ready
  correction over the transient `PlayerMeta.farmWitheredAnnounced` memory
  (rides the same event as a fresh ready count; no new wire surface). Draws
  no rng.
- `feast.ts`, `feast_lifecycle.ts` + `feast_placement.ts`: the shared feast behind the `SimContext`
  seam (`placeFeastAction`, `consumeFeastAction`, the 1 Hz `updateFarmFeasts` despawn sweep): the
  catalog-derived placeable family, the one-active-per-placer rule and the
  eatenBy ledger on the domain-tagged `feastOwnerKey`, and the existence-oracle
  guard (out-of-range and nonexistent ids answer the same not-found frame).
  Transient state on `SimContext.feasts`; draws no rng. Dungeon, delve and rift
  object rosters own room teardown; the lifecycle sibling captures an arena or
  battleground match scope at placement and removes only that match's tables
  when its slot is released, including tables left by departed fighters.
  Placement samples the player's supporting floor once, including raised rift
  surfaces; retirement removes the table from its room's current object roster
  so expired tables cannot accumulate in the rift's per-tick lift scan.
- `farmer_npcs.ts`: the farmer-NPC range predicate (`nearFarmerNpc`,
  `FARMER_TRADE_RANGE`) the husk trade gates on, resolved by the NpcDef
  `farmer` flag through the grid's early-exit `someInRadius`; draws no rng.
- `wield_gate.ts`: the R22 land-tool USE requirements, a pure leaf like
  `tools.ts` (items table as a parameter, no player-state import): the one
  frozen threshold table (40/70/85/100), the wield-filtered bag scans the
  harvest gate, grade resolution, corpse premium arm, and every client
  mirror read, and the denial-naming helpers. The ownership scans in
  `tools.ts` survive for the R47/R30 price family ONLY, with banners
  saying so.
- `mastery_reset.ts`: the one-time skill reset behind `masteryResetApplied`;
  `normalizeArchetypeState` must keep running BEFORE `applyMasteryReset`
  (the single load-time reader of pre-reset values).
- `cadence.ts` / `tier_mail.ts` / `prof_nudges.ts` / `trend.ts` /
  `guild_letter.ts`: quest cadence caps, the per-tier master mail, trend
  nudges, and the one-shot Guild trend letter.
- `attunement_events.ts` / `proficiency_bands.ts`: celebration events and
  the shared band math.
- `profession_xp.ts` / `battlefield_xp.ts`: character-XP curves for gather/craft
  actions; the crafted-item attribution XP trickle.
- `types.ts`: the shared record shapes. `index.ts` is a types-only barrel; the
  logic modules are imported per-module by path (see the imports in `sim.ts`).

When a module needs a new host-side effect, it is a `SimContext` CALLBACK
(exemplar: `mailAuthoredLetter`, consumed by `guild_letter.ts`). Appending
one touches FIVE sites: the interface in `src/sim/sim_context.ts`, the
`createSimContext` passthrough, the `Sim` binding, and the two test stub
hosts, plus the pinned callback-name list in `tests/sim_context.test.ts`.

## Where a new profession mechanic lands
1. Its own small module here taking `SimContext`; never import `Sim`, never a
   new method cluster on `sim.ts`.
2. Backing state as `PlayerMeta` fields initialized in `addPlayer` (`sim.ts`),
   persisted as OPTIONAL `CharacterState` fields with defaults so pre-feature
   saves load cleanly (the pattern every existing field follows:
   `gatheringProficiency`, `craftSkills`, `knownRecipes`, `archetype`).
3. Data tables in `src/sim/content/`, never in the module.
4. Reads/actions: extend `IWorldProfessions` (`src/world_api/professions.ts`)
   FIRST, then follow the root IWorld facet procedure (both worlds plus the
   parity pin).
5. A test in `tests/professions_<thing>.test.ts` (exemplars:
   `tests/professions_crafting.test.ts`, `tests/gather_node_harvest.test.ts`).
   Bug fixes follow the root test-first rule.

## Balance invariants (settled; do not re-litigate)
- All ten craft skills are independent, purely ADDITIVE counters (`wheel.ts`):
  no conserved pool, never drain one craft to raise another. Gathering
  proficiencies are additive the same way (`gathering.ts`).
- Archetype identity is a ring-adjacent PAIR of majors (`activeArchetype` +
  `pairedMajor`, uncapped) plus a hobby (the opposite craft on `CRAFT_RING`,
  capped at rare); every other craft caps at common once an archetype is set,
  and everything caps at rare before one is set (`archetype.ts`
  `archetypeCeilingFor`).
- The ceiling freezes EMPOWERMENT, never the raw-capability climb: outputs
  are deterministic at the def quality and the ceiling instead gates the
  masterwork bump (a dormant craft never procs; a hobby or pre-attunement
  craft cannot bump past rare) and skill gain (a recipe tiered ABOVE the
  ceiling grants zero skill), but at or below the ceiling the ordinary
  progress curve runs off raw capability unchanged (`crafting.ts`
  `resolveCraftForRecipe`; pinned by `tests/archetype_ceiling.test.ts` and
  `tests/professions_skill.test.ts`).
- Deed credit is draw-order neutral: deed marks and grants (`src/sim/deeds.ts`)
  evaluate predicates and counters only, drawing ZERO rng, so adding or
  removing a deed never moves a parity golden. Keep any new deed hook on that
  side of the line.
- The signing slot policy: a SIGNED grant needs same-signer stack room OR a
  genuinely free bag slot (the merge-aware `canGrantItemInstance` gate; a
  signed instance merges only into a byte-equal same-signer stack, never a
  plain one); with neither it falls back to the unsigned fungible top-up
  (the signature truncates, the yield does not; pinned in
  `tests/gather_node_harvest.test.ts`). The room is measured against the WHOLE
  grant, not one copy: a corpse signed component carries its rolled quantity
  (#2473), so a stack with room for one of three units refuses rather than
  spilling the rest past capacity (#2139). All-or-nothing there, deliberately
  unlike `harvestNode`, whose signed batch lands a PARTIAL fit: a corpse
  downgrade is an uncapped plain grant of the full roll, so refusing costs no
  yield. Pinned on both sides of the boundary in `tests/corpse_harvest_sim.test.ts`.
- The economy invariant: no recipe vendors above its input value, enforced
  for EVERY recipe by `tests/recipe_economy.test.ts` (the exception list is
  empty). Author new recipes against it; the full economy model lives in
  `docs/design/professions.md`.

## Wire + persistence names (settled)
- Snapshot deltas: `prof` (`professionsState`), `gprof`
  (`gatheringProficiency`), and atomic `cprof` (`craftingIdentity`, including
  craft skills and attunement), all diff-sent. The terse-key maps and
  `ALL_DELTA_KEYS` are pinned in `tests/snapshots.test.ts`.
- Persistence (JSONB on the character save row, `server/db.ts`):
  `gatheringProficiency` is the current key (preferred on read, always
  written); `professions` is the legacy pre-rename key, still dual-written on
  every save for downgrade back-compat and read only as a fallback when
  `gatheringProficiency` is absent. `nodeHarvestCooldowns` is the per-player
  node-readiness record (nodeId to remaining seconds, zero-default omission,
  loaded through `node_persist.ts` `applyNodeReadiness`). Craft-side state persists as separate optional `CharacterState`
  fields (`craftSkills`, `knownRecipes`, `archetype`, `equipmentInstance` for
  enchanted copies); see the comments on `CharacterState` in `sim.ts`.
- The facet's member list is pinned by `tests/world_api_parity.test.ts`
  (`FACET_PROFESSIONS`) and exercised by `tests/professions_contracts.test.ts`;
  keep counts out of prose.

## Pure table leaves (no SimContext import)

- `gathering_materials.ts`: the `NODE_MATERIAL_TABLE` zone rows plus `nodeMaterialFor`
  (the `byZone[zoneId] ?? byZone.eastbrook_vale` fallback), moved out of `gathering.ts`
  so the eager `material_ids.ts` registry can read it at module evaluation without
  entering the gathering system's import ring.
- `salvage_materials.ts`: `SALVAGE_MATERIAL_BY_QUALITY` (frozen), the same extraction
  for the salvage side; consumed by `salvage.ts` and the material registry derive.
