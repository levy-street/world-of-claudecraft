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
- `fishing.ts`: the fourth gathering row (bite delay, reel window,
  `FISHING_TABLES_BY_BAND`, and since R19 the gain model: the schedule half
  `fishingCatchGain` composed with the water's teaching ceiling in
  `fishingCatchGainAt`, the ONLY function a grant site may call); the TWO
  sessions' hidden per-cast state lives in
  transient Entity fields (`gatherCastNodeId`, `gatherCastToolRarity`, and
  the R40 consent `gatherCastEffectConfirmed` for the gather cast;
  `fishBiteAtTick`, `fishReelDeadlineTick`,
  `fishCastZoneId` for fishing), never wired, never persisted, all cleared
  together on every cast exit path.
- `session_teardown.ts`: the ONE displacement cancel for a live gather or
  fishing session (`cancelProfessionSessionOnDisplacement`), called from every
  hard-displacement site: the sim and server teleport paths, the Vale Cup
  pitch eject and kickoff placements, and the `/follow` zone-line crossing;
  gated on `isNonSpellCast`, delegates to `ctx.cancelCast`.
- `wheel.ts`: flat per-craft skills (`CraftSkills`, `gainCraftSkill`,
  `tierForSkill`/`tierCapability`, the four-state `tierProgressMultiplier`
  curve, perk-eligibility reads).
- `crafting.ts`: `craftItem`/`resolveCraft` (all-or-nothing reagent consume,
  deterministic def-quality outputs plus the single masterwork proc draw,
  skill gain, recipe acquisition).
- `masterwork.ts` + `material_tier.ts`: the pure masterwork model
  (`masterworkProcChance`, `masterworkBumpedQuality`, `masterworkBonusStats`,
  the def-keyed `materialTierBonusForReagents`); `crafting.ts` consumes it at
  the one post-consume proc draw per successful craft.
- `archetype.ts`: the active-archetype state machine (`ArchetypeState`,
  `archetypeCeilingFor`/`craftCeiling`, `getHobbyCraft`, amends-gated
  switching via `requiredAmendsProgress`). The sim-side ceiling arm is
  `archetypeCeilingFor` ALONE, never `craftCeiling`.
- `hobby_memory.ts`: the per-pair record of hobbies chosen through the
  hobby-switch quest (`normalizeHobbyMemoryOnLoad`, `recordQuestedHobby`,
  `applyPairTransitionHobbyMemory`), so a make-amends RETURN restores the
  quested hobby instead of re-deriving the skill default. Applied at all three
  pair-transition entry points beside `applyPairTransitionTierMail`; it reads
  `archetype.ts`'s pair vocabulary, so `archetype.ts` must never read it back.
- `combo_eligibility.ts`: the shared attunement gate combo recipes consult in
  both hosts (deny not_attuned / wrong_pair / tier_unmet).
- `enchanting.ts` / `disenchant_reagents.ts` / `salvage.ts`: disenchant
  (universal ladder + typed rare+ secondaries, bindOnTrade-armed), apply an
  enchant onto a SPECIFIC instanced copy (`ItemInstancePayload`), break items
  back into materials; all off-wheel, ungated, on the shared throttle. An
  already-enchanted copy is REPLACEABLE only behind the explicit
  confirmReplace flag (#2415: old enchant destroyed, no refund, surgical swap
  via `replacedEnchantPayloadFor`); without it the deny is the dedicated
  `already_enchanted` reason on both arms. The identical-id re-apply denies
  `same_enchant` on both arms WITH the flag; unconfirmed it reads
  `already_enchanted`, because the flag check precedes the id compare.
- `commission.ts`: the Maker's Bond (commission opt-in mints `bindOnTrade`,
  `resolveUnbind` + the quality-tier fee ladder).
- `action_throttle.ts`: the ONE shared action window for crafting,
  disenchant, enchant-apply, and salvage.
- `training.ts`: master training (`resolveTrain`, tier-gated learning,
  `TRAINING_FEE_BY_TIER`, the one-time `PRE_TRAINING_RECIPE_IDS`
  grandfather).
- `tools.ts` / `stations.ts` / `focus.ts` / `mobile_station.ts`: pure-leaf
  gates and bonuses (gather-tool tier, per-type crafting stations
  (superseding the retired level-20 hub), town focus allocation, field
  crafting station). Tool effects in `tools.ts` are LIVE end to end and this
  leaf owns every DECISION: `resolveSlotToolEffect` is the one mint
  authority (it also picks WHICH crafted charm copy the mint consumes, whose
  signer becomes the slot's `craftedBy`) and `resolveRechargeToolEffect`
  prices and sizes a refill (R30 fill from the tool held now, R39 material
  identity, R47 price rung floored at the slot's own ceiling). The R9 slot
  policy (`slotToolEffectRefused`) keeps Springback and fishing slots
  refused until their arms have real behavior.
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
- `fishing_zones.ts`: the per-zone rod-tier ladder (`rodTierRequiredForZone`,
  water gated by the WATER's zone) the cast gate and the vendor rows read;
  since R19 the SAME column also caps how far each water teaches
  (`fishingTeachingCeilingFor` in `fishing.ts` reads it at the gain site).
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
   FIRST, then implement in BOTH `Sim` and `ClientWorld` (root "IWorld is the
   only seam" rule).
5. A test in `tests/professions_<thing>.test.ts` (exemplars:
   `tests/professions_crafting.test.ts`, `tests/gather_node_harvest.test.ts`).
   Bug fix rule: a failing test that reproduces the bug first, then the
   smallest change that turns it green.

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
