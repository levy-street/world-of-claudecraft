# src/sim/encounters/gravewyrm_sanctum: the Ice Tomb of the Wyrm

The Gravewyrm Sanctum rework (`docs/design/dungeon-rework/gravewyrm_sanctum.md` on
the `design/dungeon-rework` branch): a hidden glacier cirque on Thornpeak, the
Quench, with Korzul frozen in its Calving Face. The map is the authored field
`src/sim/content/gravewyrm_sanctum_layout.ts` (key `gravewyrm_sanctum`); the mob
templates, spawns, packs, patrols, gates and story markers are
`src/sim/content/gravewyrm_sanctum.ts`; the dungeon record stays in
`src/sim/content/dungeons.ts` (shipped id, index 2, door (0, 858)).

| Module | Role |
|---|---|
| `ids.ts` | Leaf: the dungeon, boss and trash ids, the Sledge Tusker's cast ids, `TUSKER_TUNING` (its damage budget stands beside it) and the five outcrop spots `TUSKER_OUTCROPS`, the encounter object templates (`SANCTUM_OBJECT_TEMPLATES`: soulfire patches and trails, the ice outcrops in their three states, toss rings, story markers) and the Calving Face's crack steps (`sanctumStoryTemplate`, `sanctumStoryStepOf`, `sanctumFaceStage`). |
| `claim.ts` | The live Sanctum claims, the Sanctum's own encounter objects, the planted hold; the claim-generic reads are the Sunken Bastion's, re-exported. |
| `sledge_tusker.ts` | The showpiece patrol (design 5.3, reworked 2026-10-14), walking `TUSKER_ROAD` (a closed two-lane loop built by `mob/patrol_route.ts` `shuttleLoop` from `TUSKER_ROAD_LINE`: U-turns at both ends and an arc round the upper bend, the coat clear of every crevasse lip and prop; it spawns on its patrol point and rejoins along the loop, `mob/patrol.ts`): Tusk Sweep (frontal cone), Trample (a 3 s bar painting a lane to the farthest player that stops short of a drop; the lane FOLLOWS that player until `trampleLock` seconds before the charge, then locks, and the locked lane alone decides the bait; then the charge), the bait (a lane that touches an ice outcrop ends in it: Stuck in the Ice, 4 s held and 25 percent more damage taken, then the outcrop bursts), the soulfire trail (its sledge stays HITCHED through the pull, so every charge leaves the lane burning), Spilled Braziers (at half health the traces snap and three soulfire patches burn where the sledge tips; no trail after it), Enrage. Fight state `Entity.sanctumFight` (`TuskerFightState`). Dev triggers: sweep, trample, bait, stick, trail, burst, outcrops, spill, enrage. |
| `tusker_road.ts` | Pure geometry of the Sledge Road, shared with the renderer and the HUD alert: `trampleReach` (a lane stops at the road's end), `planTrampleLane` (which standing outcrop a lane runs into: its strip must touch the outcrop, with a run-up, on the lane's own road; how far the beast runs and how far the charge strikes), `inTrail`, `onSledgeRoad`, and the aim's lock (`trampleAimLocked`, read off the bar's seconds left, so the renderer and the HUD lock with the sim) and yaw (`trampleAimYaw`). |
| `tusker_outcrops.ts` | The five ice outcrops: encounter objects raised once per claim while its Tusker lives, the first time a living player comes within `outcropWake` of one (never on the claim's own tick: a party walking in through the Gate Landing is within reach and mints the five, moving every later id of the claim up by five on every host alike; a run staged elsewhere that never comes near mints none, which keeps the heroic five-man parity golden, staged onto Korzul, where it was) (found again by scanning the claim's roster, so no state is kept), their three templates (whole, struck with the held seconds on their bar, broken), and `restoreOutcrops` after a pull that ended without a kill. |
| `tusker_trail.ts` | The soulfire trail: one object per trail at the strip's start (facing its yaw, scale its length, its bar the 30 s it burns), the burn each second, two at most (`trailMax`: a third puts the oldest out). |
| `korgath_barks.ts` | His shouts down at the wings before his pull: one line per fallen wing pack (`SANCTUM_WING_PACKS`, the five the Chain Stairs wait on), escalating, each once per claim, yell channel, only within `KORGATH_BARK_RANGE`; a waiting line is said when a player comes in earshot (only the newest of several). Re-localized by `src/ui/sim_i18n.ts` `log.sanctumKorgathBark1` to `5`. |
| `korgath.ts` + `korgath_state.ts` | Korgath the Bound (design 6.1, G23): four Seal Shackles (mob templates `SEAL_SHACKLE_IDS`, raised by the encounter, held untouchable until the pull) and the chain state objects (`sealChainTemplate`); Lockbound (`buff_dr` 0.2 per intact chain), the 10 yd leash until the Anvil chain breaks, the four freed abilities (Maul Arc, Chain Flail, Threshold Charge, Foreman's Bellow), Strain on the intact pillars, the telegraphed Stomp, heroic Re-rivet and Last Link, the deeds, his lines. Every bar locks his feet and facing through the cast hold seam (`Entity.castHold`), runs at least 1.5 s, and is followed by `barGap` of plain melee; every floor strike reaches `KORGATH_REACH` (his body edge included), which is exactly what the telegraph draws (`KORZUL_REACH` likewise for Korzul's cones). `korgathChainsBroken` feeds the story's steps 2 to 5. Tuning `KORGATH_TUNING` (boss_ids.ts). |
| `story.ts` | The Calving Face's crack step (design section 3), latched per claim into the template id of the run's story markers (`STORY_MARKERS`): 0 arrival, 1 Tusker dead, 2 to 5 Korgath's chains (phase B), 6 Korgath dead, 7 Velkhar dead, 8 Korzul pulled. Monotonic; a freed claim drops the markers. |
| `velkhar.ts` + `velkhar_state.ts` | Grand Necromancer Velkhar (design 6.2): the Waking Thaw from the three pools in turn (a `SANCTUM_PYRE_FLARE` roar 1.5 s early), the kept 66 and 33 percent waves from the pools (the template has no `summonAdds`; a Velkhar dragged out of his vault raises them beside him), the death-site rule G24 (Held: a `SANCTUM_HELD_STATUE`; Unquenched: a `SANCTUM_UNQUENCHED_RING`, a rise 4 s later at 60 percent, the tithe heal), Grasp of the Thawed, the Soulfire Trench (`SANCTUM_TRENCH_LANE` then `SANCTUM_MELT_STRIP`), Shadow Volley, heroic Warm Hands and Twice-Woken. Stay Buried waits on sunk Bonewalkers (`setBossAddPendingForDeeds`); Cold Comfort is granted at his death. |
| `meltwater.ts` | Pure: is a point in meltwater (a pool, a live strip, a heroic puddle), and a ray's reach to the vault's rim. |
| `plates.ts` | Pure G25 plate floor over `LAKE_PLATES`: nearest-centre membership (`plateIndexAt`, the shelf is none), the cone-covers-plate test and `conePlates`, the Sound to Cracked to Broken ladder (`burnPlate`), the refreeze (`stepRefreeze`) and the template id each plate's object carries (`plateRecTemplate`). |
| `korzul.ts` + `korzul_state.ts` | Korzul the Gravewyrm (design 6.3). His state lives for the claim (`phase` 'idle' between pulls) because the nineteen plate objects exist before the pull. Break Free (the pull's cinematic, `korzul_emerge.ts`), Grave Breath (burns the covered plates), Tail Sweep, Grave Inferno (moved off the template: pulses 2 and 4 burn his plate, a break Douses him and ends it), quench-water on broken plates, two flights at 70 and 40 percent (G26 on `mob/flight.ts`: in combat, threat kept, `hostile` false and `damageImmune` every tick aloft, `KORZUL_AIRBORNE` aura, `pos.y` up `flightAltitude`; Wyrm's Eye, Plunging Fire, Brood from Below, Crashing Descent), the last phase, and the no-ice soft enrage. Heroic: Deep Quench, Twin Eyes. Thin Ice at his death. |
| `rune_wall.ts` | The Anchor Ledge's rune wall as a readable lore object (design section 3): the kit wall carries the Smith's picture runes (heat, the hammer, quench), never letters, so its meaning reaches each claim player once, on walking up in front of it (`inRuneWallReadZone`), as a pid-scoped `log` line (`RUNE_WALL_LORE_LOG`, re-localized by `src/ui/sim_i18n.ts` `log.sanctumRuneWall`). Per-claim memory keyed by the slot and its exit entity. |
| `korzul_emerge.ts` + `korzul_emerge_plan.ts` | Break Free, the cinematic of Korzul's pull. The plan is a pure leaf shared with the renderer (`KORZUL_EMERGE` beats: the 3 s burst bar at the face's foot `KORZUL_EMERGE_FROM`, the rise, the arc over the lake, the landing on the centre `KORZUL_EMERGE_TO`; `emergePose`); the driver holds him out of reach the way his flights do (in combat, `hostile` false, `damageImmune`, swing held) and hands him to his fight at the touchdown (`KORZUL_TOUCHDOWN` nova, a no-damage shove of whoever stands under him). Held in the ice (`encounterHeld`); a player within `KORZUL_WAKE_RADIUS` of the centre wakes him WITHOUT aggro (`waking`): the cinematic plays out of combat and lands him `'ready'` on the centre (his new home), facing the shore. Only the ordinary pull (a player in his aggro radius, or a hit) starts his fight, and with it the Hollow Ward seal and the chain pull. A wipe sends him home ready; the cinematic never replays. Held, nothing pulls him (not a premature boss chain pull either); a pull driven straight through the encounter tick (the tests) plays it as the fight's opening; a `/dev sanctum trigger` skips it. A player already inside his 18 yd aggro radius at the touchdown pulls him: the ordinary pull. |
| `index.ts` | `tickSanctumEncounters` (called from `instances/dungeons.ts` after the trash kit) and the public surface. |

The trash kit's Sanctum keys (`goad`, `toss`, `stoke`, the death burst's `slow`)
live in `src/sim/mob/trash_kit/sanctum_kit.ts` and `sanctum_cast_ids.ts`; the
trash mechanics pass rides the engine's generic keys (Thaw the Held on
`reanimate`, Counterweight Lash on `tailLash`, heroic Boiling Meltwater on
`breathPool`, Branding Iron on `brand` with the `QUENCH_POOLS` of
`gravewyrm_sanctum_layout.ts`, Topple Brazier on `usable`, Rime Breath on
`cone` with a `freezeStack`, the Ice Slab on `toss.leavesWall`, Fracture on
`split`). Dev
helpers: `src/sim/dev/gravewyrm_sanctum_dev.ts` (`/dev sanctum`).

Phase A (this directory today): the map, every pack and patrol with its kit, the
Tusker, the story steps, and the three bosses as PLACEHOLDERS in their finished
arenas (ids, pools and seals; they keep only their shipped kits: Korgath's
Shuddering Stomp and enrage, Velkhar's 66 and 33 percent Bonewalker waves,
Korzul's Grave Inferno and enrage). Phase B adds `korgath.ts` (G23 restraint
parts on `SEAL_PILLARS`), `velkhar.ts` (G24 death-site rule on `THAW_POOLS`),
`korzul.ts` (G25 plate floor on `LAKE_PLATES`, G26 flights), raising
`story.ts` steps 2 to 5 through `earnedStoryStep(ctx, inst, chainsBroken)`.

Rules:
- Zero rng in every pick; the only draws are damage rolls, in claim-player order.
- Every visible state rides existing entity fields (cast bars, a locked facing,
  auras, encounter objects, `spellfx`), so the online client mirrors it with no
  wire change. The Calving Face reads the story markers' template ids.
- Mechanic damage is stated LANDED (the normal tuning row's mechanic factor 1).

Naming (IP check at authoring, 2026-10-03): every new name was cleared in the
design's section 11 (Thawcaller, Goadsmith, Sledge Tusker exact-searched; the
rest generic English or glaciology terms). "Ice Tomb" is never a display name.

The trash mechanics pass (2026-10-04, the trash engine's keys in
`src/sim/mob/trash_kit/sanctum_kit.ts`'s neighbours; see that directory's
CLAUDE.md "Engine pieces") was web-checked the same way (exact phrase plus the
coined token on warcraft.wiki.gg, Wowhead, the GW2 and FFXIV wikis, Arknights):
Thaw the Held, Counterweight Lash, Boiling Meltwater, Topple Brazier and
Spilled Soulfire CLEAR (no exact match; "Soulfire" already ships here);
Branding Iron and Branded CLEAR-generic (plain English; WoW has a minor
Torghast power "Branding Iron", GW2's Branded is a faction, recorded as
borderline); Rime Breath, Ice Slab, Fracture, Meltwater CLEAR-generic. Two
renamed before shipping: the stacking chill "Rimechill" (an Arknights enemy
ability) is "Creeping Rime", and the freeze "Frozen Solid" (WoW's Melidrussa
pairs stacking chill with exactly that debuff) is the plain idiom "Iced Over".

Tests: `tests/gravewyrm_korgath.test.ts` (Korgath's core, reaction time, facing lock, the gap, the drawn reach), `tests/gravewyrm_korgath_barks.test.ts` (his barks), `tests/gravewyrm_sanctum_tusker_patrol.test.ts` (the Tusker's road and walk), `tests/gravewyrm_sanctum_tusker_bait.test.ts` (the bait rework: the outcrops, the lane plan, Stuck in the Ice, the soulfire trail, and a solo player and a group of four walking a whole pull with safe ground always in reach and every outcrop baited), `tests/gravewyrm_velkhar.test.ts` (Velkhar), `tests/gravewyrm_korzul.test.ts` (Korzul), `tests/gravewyrm_sanctum_route.test.ts` (route contract, heights,
arenas, story marker reach), `tests/gravewyrm_sanctum_trash.test.ts` (kits, the
Tusker, the story steps, `/dev sanctum`), `tests/gravewyrm_normal_tuning.test.ts`,
`tests/gravewyrm_sanctum_rune_wall.test.ts` (the rune wall's read zone, its once-per-claim
line, its i18n key, and no letters in the kit's runes).
