# src/sim/encounters/smith_heart: the Smith's Heart raid's sim

The raid's gating, its first boss, the Guardian of the Breath and the Guardian of the
Quench and the Guardian of the Heat (`docs/design/raid/smith_heart.md`), ticked once per claim by `tickSmithHeart`
(`seal.ts`), called from `instances/dungeons.ts` `updateInstances`: the Hammer Council first
(so its fall lights the Hammer vein the same tick), then the Breath's guardian, then the
Quench's, then the Heat's, then the Masterless Strength's, then the seal and the arrival, then the portal hops.

| Module | Role |
|---|---|
| `entry.ts` | The dev-only door while `SMITH_HEART_PLAYABLE` is false. |
| `seal.ts` | The heart seal's veins, the portal bit and the arrival bit, derived every tick and carried on the seal markers' template ids; `smithHeartVeinWon` (the Hammer's vein waits on the whole council). |
| `portal.ts` | The portal hop both ways. |
| `checkpoint_order.ts` | Leaf: the death checkpoints' kill order (recorded by the seal's tick, keyed by the claim and its exit) and the pure rule (`smithHeartCheckpointRooms`: the last kill's room first, the Heart first once all four are down). |
| `checkpoint.ts` | The death checkpoints' candidates for `instances/dungeon_checkpoints.ts` (its `ORDERED_CHECKPOINTS`): the rooms in that order, the points (`content/smith_heart_checkpoints.ts`), the Heart only while the portal is open. |
| `council_ids.ts` | Leaf: the council's template, cast, aura, object and cue ids, the per-difficulty rules (`COUNCIL_DIFFICULTY`: the mythic seam), the SKETCH tuning (`COUNCIL_TUNING`), the pillar template helpers, the soak's pure split. The content, the renderer, the HUD and the tests key on it; it imports nothing. |
| `council_state.ts` | Type-only: `CouncilFightState`, ONE object shared by the two members as `Entity.smithHeartFight`. |
| `council_scope.ts` | The per-tick scope (claim, state, bodies, players on the Quarry floor, rules) and the plumbing every member module shares: the job holder (`jobHolder`: a member's own job, else its first living heir), the bars, the hashed marks, the damage rolls, the raid warnings (chat `raidWarning` with a `hudChrome.council.warn.*` key). |
| `council_pillars.ts` | The pillars: the five columns (claim objects) and the risen ones as combat walls, their integrity, the rise (nudged to a clear spot, the throw), the cracks, the fall into rubble, the wipe's restore, the fall's settle, the Wrath's cover test (`pillarBetween`), the heroic pulse. |
| `council_wrath.ts` | The Guardian's job: the energy (the holder's resource), Mountain's Wrath (whoever no pillar hides is struck, then EVERY pillar but a soul's shatters; the first Wrath takes the carved columns and warns the raid), Narrow Shelter, Hammer's Weight. |
| `council_stone.ts` | The Seam Singer's stone: Wake the Stone (a KICKABLE bar: a kick raises nothing; its marks; the Guardian's inherited locked rise spots, less often), the Falling Rock and its split (never the cursed pillar). |
| `council_song.ts` | The Seam Singer's voice: Seam Bolt, the Song of the Seam (a kick leaves one mark), Resonance (a spread: it rings on every ally near its carrier, never a pillar); a kicked Wake's warning routes through `songKicked`. |
| `council_rush.ts` | The Guardian's charge, Mountain's Rush, and his cursed pillar: the mark (never a tank), the cursed pillar raised with it (one at a time; it pulses on the raid, low on normal; shelters nobody; only the Rush or a Wrath breaks it), the dash to the FIRST pillar on its line (cursed: shattered, the Guardian stunned and exposed; a sheltering one: taken whole; none: the path trampled), mythic's Quarry Collapse after a miss. |
| `council_bond.ts` | Bond of the Stone, the separation rule: within `bondReach` of each other both members take far less damage (`shield_wall`) and a raid pulse grows each time; apart, it lifts and its count starts again. |
| `council_soul.ts` | Mythic only (the prototype behind `/dev heart council mythic`): Soul in the Stone. A fallen member's soul takes the most intact pillar (`soulHost`, `takeSoul`); its pips (`strikeSoulPip`: only the rock), its burst, the last kill's crumble; the Guardian's Echo of Wrath (`landEcho`), the Singer's Endless Song (two souls: the Slabwright's Walking Slab left with it); only the rock strikes a pip; the `soul` and `soulpip` dev verbs. |
| `council_floor_gap.ts` | Leaf, PURE: the floor gap rule (`floorGap` seconds between two FLOOR mechanics' starts, `FLOOR_PRIORITY`, the wait taken off the next interval: `nextAfterHold`, `runFloorGate`). Imports nothing; every floor start function stamps it (`stampFloor`). |
| `council_floor.ts` | The floor gap wired to the fight: `startFloorMechanics` starts the Wrath, the Echo, Wake the Stone, Mountain's Rush and the rock through the gate each tick (normal's Wrath guard, `clearOfWrath`: the Wake's marks and the Rush never run into a Wrath); `carryWrathHold` gives a held Wrath its wait back as energy. |
| `council_voice.ts` | What the two members SAY: boss yells carrying their catalog key (`hudChrome.council.say.<role>_<moment>`, `COUNCIL_LINES` the same English): the pull's two lines a breath apart, each member's own job lines (never an heir's, at most once in `SAY_EVERY`), a fall's line (its soul's on mythic) and a survivor's "the stone remembers", the last fall's defeat, a wipe. Voices are auditions only (`scripts/voices/raid_boss_voice_prompts.mjs` `HAMMER_COUNCIL_VOICE_PROMPTS`). |
| `breath_ids.ts` | Leaf: the Guardian of the Breath's cast, aura, object and cue ids, the per-difficulty rules (`BREATH_DIFFICULTY`: mythic is heroic whole, the seam), the SKETCH tuning (`BREATH_TUNING`), the pure helpers (`calmSeconds`, `BLOW_BEARINGS`/`blowBearing`, `forkPath`, `cradleShare`, `swellMult`) and the objects' template codecs (`breathWindTemplate`, `calmTemplate`, `timedTemplate`). Imports nothing. |
| `breath_geometry.ts` | PURE over the layout and the field (no SimContext, for the bots to reuse): the arena (`inBreathArena`), the gaps (`gapAt`), the pin (`pinnedAgainstRim`), the void (`fellFromCornice`), Thessaly's post and circle spot, the loose gales' paths, the barrage's spots. |
| `breath_state.ts` | Type-only: `BreathFightState` (`Entity.smithHeartBreath` on the guardian). |
| `breath_scope.ts` | The per-tick scope and the shared plumbing: the players on the Cornice, the bar, the hashed marks, the rolls, the raid warnings (`hudChrome.breathGuardian.warn.*`), the fight's objects, the quiet `internal_cd` markers, the anchor test, the void-safe throw (`throwPlayer`). |
| `breath_gale.ts` | The Wind: the blow cycle and its wind object, the kernel's wind and pull auras (`src/sim/wind_drift.ts`), the pin, the indrawn breath, its vortex and Bellows Gust, heroic's loose gales and phase-2 storm gusts. |
| `breath_void.ts` | The void and the tether: a body over a gap's lip said once (`stepOverLip`), every body come down in the void dead in the fight or out of it whatever shields it (`stepVoidDeaths`: the fall's hit, then a death of its own for an immunity; a real game master set back on the floor instead), its body laid back on the floor by its gap (`voidCorpseSpot`), and the guardian held to its Cornice (`tetherGuardian`: a target off the floor and its climb leaves the threat table, a step off the floor is undone to `floorSpot`). |
| `breath_thessaly.ts` | Captain Thessaly's circle of calm (land, hold, spent; three seats, the anchor, heroic's Calm Spent); nothing once the storm has broken. |
| `breath_storm.ts` | The storm breaking and its barrage, the strikes and charged ground, the Leaping Bolt, the Thunder's Cradle (carried, `carried_body.ts`), Drawn Lightning, the swelling storm. |
| `breath_heart.ts` | Mythic's Knotted Gale (working name the Storm Heart, hence the ids): the balls and their fuse, the portals opened at their marked players' feet (one pair, A and B, in phase 1; two pairs in phase 2's two-ball round, A to B and C to D only, never across; the small-group fallbacks: a missing B or D at the lip nearest its partner, a missing C where the second ball fell), the carrier's load (`heldFast`, the crawl in `player_motion.ts`), the crossing to a portal's partner, the throw (`tryThrowKnot`: the interact press), the burst, the `heart` dev verbs. |
| `breath_voice.ts` | What the guardian and Thessaly SAY (`hudChrome.breathGuardian.say.*`, `BREATH_LINES` the same English). |
| `breath.ts` | The coordinator: the pull, the bar, the halves, the wipe's reset, the fall, the dev tier switch (`setBreathDevTier`) and the `/dev heart breath` triggers and readout. |
| `fight_kit.ts` | The guardians' shared plumbing (the Breath's and the Quench's): the living test, the claim-local position, the fight's objects (spawn, drop, move), the quiet markers, the aura lookups; `breath_scope.ts` re-exports it. |
| `quench_ids.ts` | Leaf: the Guardian of the Quench's cast, aura, object and cue ids, the per-difficulty rules (`QUENCH_DIFFICULTY`: splash, dance, `echoRule`; mythic is heroic whole, the seam), the SKETCH tuning (`QUENCH_TUNING`) and the objects' template codecs (`crackTemplate`, `echoTemplate`, `laneTemplate`, `bladeTemplate`), the echoes' own reach (`echoReach`) and the crossing's eased flight (`danceEase`), both read by the painter too. |
| `quench_geometry.ts` | PURE over the layout (no SimContext, for the bots to reuse): the basin and the lake's ice, the shore ice's ring, the huddles (`huddlesOf`, `warmNeighbours`), the holes and where a body climbs out, the echoes' reach, the lee behind a blade (`inBladeLee`), the crossing's pairs and lanes. |
| `quench_state.ts` | Type-only: `QuenchFightState` (`Entity.smithHeartQuench` on the guardian). |
| `quench_scope.ts` | The per-tick scope: the players on the lake and its listeners, the bar, the planted hold, the rolls, the frost hit and the never-lethal hit (`survivableHit`), the raid warnings (`hudChrome.quenchGuardian.warn.*`). |
| `quench_cold.ts` | The cold bar (an aura: `value` the bar, `value2` its trend), the huddle's warmth, Encased in Rime (the freeze, the shatter and its splash, Frost-Brittle) and Deepening Cold. |
| `quench_ice.ts` | The ice under a huddle: the strain, the cracks, the holes (they stay; capped), Under the Ice (the trap, the climb out, the grace). |
| `quench_blades.ts` | The Smith's four blades (claim objects): the wake, the echoes, heroic's crossing and its lane, their combat walls. |
| `quench_attacks.ts` | Quenching Breath (encounter-driven) and the watch on Tempering Strike's swing cleave that raises the echoes. |
| `quench_rim.ts` | The shore ice: the ring of oriented combat walls that keeps the fight on the lake, rising at the pull, falling at a wipe or the kill. |
| `quench_voice.ts` | What the guardian SAYS (`hudChrome.quenchGuardian.say.*`, `QUENCH_LINES` the same English). |
| `quench.ts` | The coordinator: the pull, the half, the wipe's reset, the fall, the dev tier switch (`setQuenchDevTier`) and the `/dev heart quench` triggers and readout. |
| `heat_wheel.ts` | The Guardian of the Heat's Wheel of the Hearth (Mythic): four slices round the wellspring, three rounds back to back. |
| `quench_wander.ts` | The Guardian of the Quench's wandering blades: the loop round the lake, a passing blade's strike. |
| `heat_ids.ts` | Leaf: the Guardian of the Heat's cast, aura, object, mob and cue ids, the names (`HEAT_NAMES`), the per-difficulty rules (`HEAT_DIFFICULTY`: the overflows' adds, Seedflames, bolts, the cinder's speed, a quarter more damage; mythic is heroic whole, its `mythicRule` the seam), the phases' kits (`HEAT_PHASE_KIT`, 1 to 3 on every tier), the SKETCH tuning (`HEAT_TUNING`) and the objects' template codecs (`heatTimed`, `swellLaneTemplate`, `riverTemplate`, `zoneTemplate`, `wellTemplate`). |
| `heat_geometry.ts` | PURE over the layout (no SimContext, for the bots and the renderer to reuse): the Hearth's floor (`inHearthFloor`, `floorReach`), the wellspring (`wellDistance`, `inWell`, `beyondFlare`), Wakefire's bands (`inBand`), the lanes and a wave's wall (`inLane`, `inWave`, `swellBearings`), the posts (`WELLSPAWN_SPOTS`, `WELLKEEPER_SPOTS`, `SHORE_POINTS`). |
| `heat_state.ts` | Type-only: `HeatFightState` (`Entity.smithHeartHeat` on the guardian). |
| `heat_scope.ts` | The per-tick scope: the players on the Hearth's floor and its listeners, the bar, the rolls, the fire hit, the cues, the raid warnings (`hudChrome.heatGuardian.warn.*`), the hashed picks, the adds it raises (`spawnHeatMob`). |
| `heat_fist.ts` | Basalt Fist (its bar, spot and three lanes) and the Molten Swells rolling down them. |
| `heat_flare.ts` | Hearth Flare (phase 1 on everyone out of reach, then only on the guardian's own target), Flare-Scorched, the wellspring's own fire. |
| `heat_overflow.ts` | The overflows' rivers and Falling Cinders. |
| `heat_wellspawn.ts` | Heroic's overflow adds: the Wellspawn walking to the wellspring (slowing with their health, feeding it), the Wellkeepers' Kindling Marks and Cinder Trails. |
| `heat_seeds.ts` | Phase 2's Hearthseeds and heroic's Seedflames. |
| `heat_zones.ts` | Wakefire's runs of bands round the wellspring (phases 2 and 3). |
| `heat_cinders.ts` | Phase 3's Rolling Cinders: the fall, the hunt, the knockback and Cooling Crust, the burst. |
| `heat_cinder_ward.ts` | Pure leaf: a Rolling Cinder is a ward (a hit lands one point), hooked at `combat/damage.ts`. |
| `heat_voice.ts` | What the guardian SAYS (`hudChrome.heatGuardian.say.*`, `HEAT_LINES` the same English). |
| `heat.ts` | The coordinator: the pull, the phases and their damage floors, the overflows' stages (sinking, under, rising: the guardian untargetable), the wipe's reset, the fall, the dev tier switch (`setHeatDevTier`) and the `/dev heart heat` triggers and readout. |
| `final_ids.ts` | Leaf: the Masterless Strength's cast, aura, object and cue ids (its Basalt Fist reuses the Heat guardian's cast and objects), the names (`FINAL_NAMES`, the guardians' reused ones and the IP-checked new ones), the per-difficulty rules (`FINAL_DIFFICULTY`: a row per tier, Heroic's and Mythic's additions as fields), the SKETCH tuning (`FINAL_TUNING`), the pure helpers (`overloadStep`, `pulseScale`, `anvilShare`, `boltScale`, the zone codes) and the objects' template codecs. |
| `final_state.ts` | Type-only: `FinalFightState` (`Entity.smithHeartFinal` on the boss). |
| `final_scope.ts` | The per-tick scope: the players on the Anvil and the Heart's listeners, the bar (planted), the rolls, the hits, the raid warnings (`hudChrome.finalBoss.warn.*`), the cues, the hashed picks, `onFloor`. |
| `final_rules.ts` | The four quarter rules: the zone it stands in (held by `ZONE_HOLD` so a boss swaying on a ridge alone never flickers, crossing at once behind its tank), the drag (`followTank`: a free boss closes on a tank in another zone), Taking Root (a root aura and the hold, only on a NEW quarter), Vein Shock and Vein-Shaken (Heroic), the four Overload bars (fill, drain, pulses, the burst), Heart Unbound in the ring, the base form, and the state written to the boss's auras. |
| `final_heat.ts` | The Heat quarter: Basalt Fist and its Molten Swells (the Heat guardian's objects and numbers, lanes to the Anvil's rim via `laneReach`), Fire Whirls, Heroic's Ember Marks and their pools, Mythic's Forge Fire off the frontal. |
| `final_quench.ts` | The Quench quarter: Quenching Cold and Encased in Rime (alone you freeze), Heroic's Groaning Ice and Under the Ice, Mythic's Numbing Frost off the frontal. |
| `final_breath.ts` | The Breath quarter: Bellows Wind (the wind kernel's aura, tagged `FINAL_WIND_TAG`) and Pressed to the Rim, Leaping Bolt, Heroic's Drawn Lightning, Mythic's Storm Orbs. |
| `final_hammer.ts` | The Hammer quarter: Tremor Cracks, Weight of the Anvil (the fight's ONLY group damage share), Heroic's Stone Shell and Crushed, Mythic's turning Anvil. |
| `final.ts` | The coordinator: the boss's authored home (`finalHome`: a reset and a wipe bring it back there, never to a dev move's quarter), the pull (the base form), the zone's changes (root, fresh kit clocks, shock), the bar, the active quarter's kit, Mythic's watch on the frontal, the wipe's reset, the fall, the dev tier switch (`setFinalDevTier`) and the `/dev heart final` mechanics and readout (`sim/dev/smith_heart_final_dev.ts` routes them). |
| `final_phase_ids.ts` | Part 2's leaf: the Splinters' templates (`FINAL_ADD_MOBS`), the casts (Rime Toll kickable: `FINAL_KICK_SCHOOLS`, registered in `mob/healer_channel.ts`), the auras (the phase aura: stage, awake mask, seconds; the shield, the poured elements, Masterless Fury, the players' marks), the Quenching Ring's template codec and gaps (`quenchRingGaps`, read by the painter too), the stages (`FINAL_STAGE_CODES`), the per-difficulty rules (`FINAL_PHASE_DIFFICULTY`, its `hiddenPhase` the Mythic hook), the ONE tuning table `FINAL_PHASES`, the pure picks (`pickAddQuarters`). Imports no SimContext. |
| `final_intermission.ts` | The intermissions at 70 and 40 percent: the damage floors that hold each line (`holdThreshold`), the stride into the centre, the shield (`holdShielded`), the call (`beginCall`: the Splinters from the fullest bars), Splintered Strength, the call's end (`endCall`: the survivors pour), the release, the quarter rules held still (`rulesFrozen`, `holdShaken`), the phase aura (`showPhase`). |
| `final_adds.ts` | The Splinters: their rise (`raiseSplinter`, real mobs on the boss's summons), their bars, Shearing Blow (tank share, lethal share), the Heat's Cinder Trail and Bursting Coal, the Quench's Rime Toll and Quenching Rings, the Hammer's Mounting Weight (the swing kernel's stacking poison plus its own harder swing), the Breath's Gale Pounce, hunt, Buffeting Gale and circles (Storm Orbs). None raises a body. |
| `final_hidden.ts` | Mythic's hidden phase (`hiddenPhase` row): the kneel at 1 percent, the rebirth to 20, the collapse (a quarter every 30 s by the frozen bars, a kill zone at `hiddenFallenAt`), the ring's wipe; the hidden aura the client reads. |
| `final_plunge.ts` | A body going down with the floor: it stands until its stretch has gone (`hiddenCellGoes`), then falls as a carried pose (its own carrier, `carried_body.ts`), dies at the bottom, its corpse laid on the ring; a fight ending mid-fall sets it back alive. |
| `final_last.ts` | The poured elements' signatures (`stepPoured`, `pouredColdRate`), the final phase (`beginFinalPhase`: every quarter awake, the bars off), its mix (`mixTurn`: Fire Whirls, Groaning Ice, Leaping Bolt, Weight of the Anvil in turn), Masterless Fury, the Mythic hidden phase's hook (`mythicHiddenPhase`). |
| `final_phase_dev.ts` | Part 2's `/dev heart final` verbs (`inter70`, `inter40`, `splinter`, `killadds`, `endcall`, `last`, `enrage`, the signatures) and the readout's part-2 half. |
| `council.ts` | The coordinator: one pull of two (`keepTogether`), the fallen and their heirs, Memory of Stone, the bars, the Rush's dash, the cursed pillar and the Bond each tick, the wipe's reset (`regrowHead`), the finish, the dev switches for heroic and mythic (`setCouncilDevTier`; a switch mid-fight applies whole through `council_soul.ts` `syncSoulsToTier`) and the `/dev heart council` triggers. |

Rules:
- The Breath's push is the shared motion kernel's (an aura it reads, `src/sim/wind_drift.ts`),
  never a per-tick displacement: both hosts step it and the online client predicts it. A
  throw that can carry a body over a gap goes through `throwPlayer` (the knockback walker
  alone would seat it on the void's floor alive). Never name a wind aura `*_pull` (the Oath
  Chain's suffix, combat/paladin_control.ts).
- Deterministic: every pick is hashed (`pickMarkTargets`) or ordered (roles, roster, entity
  ids); the only rng draws are damage rolls, in claim-player order.
- Every visible state rides existing fields (cast bars and their targets, the holder's
  resource, auras on players and on the council, the pillar, rubble and rise-spot objects,
  `spellfx` cues), so the online client mirrors the fight with no wire or IWorld change; the
  pillars' collision rides the combat-wall view (`net/combat_wall_wire.ts` online).
- A new council mechanic lands in its member's module; a new difficulty is a
  `COUNCIL_DIFFICULTY` row, never a branch on a tier's name.
- Player text: every raid warning carries its catalog key (`hudChrome.council.warn.*`); the
  damage and aura names are matched by `src/ui/sim_i18n.ts`.
- Tests: `tests/smith_heart_checkpoints.test.ts` (the death checkpoints);
  `tests/smith_heart_council.test.ts` (on `tests/helpers/council_fight.ts`),
  `tests/smith_heart_council_ui.test.ts`, `tests/smith_heart_gating.test.ts`,
  `tests/smith_heart_pull.test.ts`, `tests/smith_heart_dev.test.ts`,
  `tests/smith_heart_council_mythic.test.ts` (the mythic row and Soul in the Stone),
  `tests/smith_heart_council_rush.test.ts` (Mountain's Rush, the cursed pillar, the mythic
  collapse, Bond of the Stone, the pillar supply over whole pulls),
  `tests/smith_heart_council_floor_gap.test.ts` (the gap and the Wrath guard),
  `tests/smith_heart_council_pillar_limit.test.ts` (Narrow Shelter's capacity per tier),
  `tests/smith_heart_council_soul_wire.test.ts` (the soul pillars through the server into
  the online mirror), `tests/smith_heart_council_voice.test.ts` (the lines and the mythic
  player text); the Breath: `tests/smith_heart_breath.test.ts` (on
  `tests/helpers/breath_fight.ts`), `tests/smith_heart_breath_ui.test.ts`,
  `tests/smith_heart_breath_wire.test.ts`, `tests/smith_heart_breath_void.test.ts`, `tests/smith_heart_breath_heart.test.ts`, `tests/wind_drift.test.ts`,
  `tests/wind_drift_online.test.ts`; the Quench: `tests/smith_heart_quench.test.ts` (on
  `tests/helpers/quench_fight.ts`), `tests/smith_heart_quench_ui.test.ts`,
  `tests/smith_heart_quench_wire.test.ts`, `tests/quench_water_online.test.ts`; the Heat:
  `tests/smith_heart_heat.test.ts` (on `tests/helpers/heat_fight.ts`),
  `tests/smith_heart_heat_ui.test.ts`, `tests/smith_heart_heat_wire.test.ts`; the Masterless Strength: `tests/smith_heart_final.test.ts` (on `tests/helpers/final_fight.ts`: the rules, the kits per tier, determinism, the headless full fight), `tests/smith_heart_final_ui.test.ts` (warnings, tooltips, the Overload HUD, the alert), `tests/smith_heart_final_wire.test.ts` (the online mirror), `tests/smith_heart_final_dev.test.ts`; part 2: `tests/smith_heart_final_phase.test.ts` (the intermissions, each Splinter, the final phase, the poured elements, determinism, the full fight 100 to 0 per tier), `tests/smith_heart_final_phase_ui.test.ts`, `tests/smith_heart_final_phase_wire.test.ts`. A live raid of bots fights it over a dev server:
  `scripts/heart_council_raid.mjs`.
