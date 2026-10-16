# src/sim/encounters/sunken_bastion: the Sunken Bastion boss fights

The boss encounters of the Sunken Bastion rework
(`docs/design/dungeon-rework/sunken_bastion.md`, sections 5 and 6) and the Gaol
Turnkey miniboss, ticked once per claim by `tickBastionEncounters` (`index.ts`),
called from `instances/dungeons.ts` `updateInstances` right after the trash kit,
so a planted charge, a pinned reaper or a hauled player owns its position for
the tick.

| Module | Role |
|---|---|
| `ids.ts` | Leaf: ids, cast and aura ids, object templates, tuning and the pure geometry (`bulwarkChain`, `oathLaneEnd`, `anchorDragSpeed`, `shackleStrained`, `cageDropHeight`, `cageEscapeProgress`, `reaperPoolSpot`, `inReapingSweep`, `veilSlots`, `veilBeamYaw`, `inBeam`). The renderer, the HUD prompt and tests key on it. |
| `claim.ts` | Claim plumbing: the live Bastion claims, their players and bosses, encounter object and body spawn/drop, mechanic damage through the heroic stamp, the hashed victim pick (`pickMarkTargets`), manual deed grants. |
| `olen.ts` | Olen the fallen paladin: Hallowed Brine (a pool that burns players and shields him while he stands in it), the Rebounding Bulwark (`bulwarkChain` in `ids.ts`: nearest unstruck player within reach), the Sentence of the Tide (a delayed column on a marked player), the Unbroken Oath at half health (an immune vigil broken by killing the Drowned Sergeants who rise). The tuning and the pressure math against the retired Oathbound Charge are on `OLEN_KIT`; the charge's constants stay in `ids.ts` only for its retiring lane visuals. |
| `turnkey.ts` | The Gaol Turnkey: the Iron Cage (a hittable cage body dropped over a stunned player), the escape press (`tryCageStruggle`, claimed from `sim.interact`: counted and rate-limited here), the mend, the crush, Open the Cells; heroic double cage and Brine Flood. |
| `ossick.ts` | The Drowned Anchor (a hittable anchor riding its tethered victim: they may move, never further from the winch than the chain, which reels in through `pull_toward.ts`), the Shackle Pair (strain past the chain's reach), the cudgel, Open the Cells; heroic Anchor Crash, heavier chain, shorter shackles. |
| `ossick_moorings.ts` | The Drowning Yard's four Mooring Posts: a hooked player within reach of a LIT post moors the chain (freed, the post dark for 30 s, kindling over its last 5, the others lit); the lamp's state rides each post object's template (`MOORING_TEMPLATES`), the moment is the `OSSICK_MOORED` cue; a reset relights them all. The reach math is beside `OSSICK_TUNING`. |
| `vael.ts` | Death itself, the fight's coordinator: Mist Surge, the Fog Veil with its shadow copies and the Fogbeacon's beam (the Beacon-Lit and Hollow Shade tells the beam leaves on the figures, the Drowning Hymn's mark on the players), Fogburst; heroic drift and Mistbound. |
| `vael_intro.ts` | His entrance: buried under the crown (held, non-hostile, immune) until a living player climbs onto it, then three rises and lines round the Fogbeacon and a last one at his place, where he is handed back to the fight; after a wipe, the short entrance (one rise, one line). `/dev bastion trigger intro|introshort|introskip`. |
| `vael_shadowstep.ts` | The Shadow Crossing as a chain: three steps back to back, each a pool behind a DIFFERENT player (non-tanks first, the tank last, one step per living player in a smaller group), the Reaping Scythe through their back; heroic Grave Shadow. The pressure math lives on `VAEL_TUNING`. |
| `vael_veil_gather.ts` | The breath before each Fog Veil: he stills and speaks the beam warning while the fog gathers (untouchable), sinks, then the four figures rise. |
| `vael_lines.ts` | His lines (sim English, re-localized by the EXACT matcher in `src/ui/sim_i18n.ts`). |
| `ward_hits.ts` | Pure: the cage and the anchor take fixed points per player or pet hit (asked by `combat/damage.ts` dealDamage). |
| `ghost_captain.ts` / `ghost_captain_ids.ts` | Shipwreck Captain (stable `turretback_hermit` id): parallel Spectral Broadside lanes with safe gaps, Cursed Anchor hauled down its locked lane, and Phantom Boarding. Every tell and impact rides an encounter object with start position, facing, length in scale and remaining/total time. Death, evade, wipe and cancelled casts remove owned objects. The preserved `dgn_turretback` deed now requires nobody being hit by a broadside; already-earned unlocks stay earned. Damage rolls and difficulty stamps are inherited from the retired crab kit. |

Rules:
- Deterministic: randomness only through `ctx.rng` (most picks use `kitHash`, zero
  draws), entity-id ordering, fixed DT countdowns.
- Every visible state rides existing entity fields (cast bars, facing, pos.y for the
  cage's fall, auras whose `sourceId` names the cage, the anchor or the shackle
  partner, mob health for the cage's and the anchor's points, object template ids),
  so the online client mirrors it with no wire or IWorld change. The escape press
  is the ordinary `interact` command. The HUD reads the same auras: the cage
  escape prompt and the chain alert (`src/ui/hud/dungeon/`, composed as one
  `DungeonPrompts`; `tests/sunken_bastion_chain_alert.test.ts` drives the alert
  from a real fight).
- Reset on evade and wipe dries Olen's brine and lifts his bubble, opens the cages, drops the
  anchors and shackles, relights the Mooring Posts, lifts the veil and dries the pools.
- Tests: `tests/sunken_bastion_olen.test.ts` (Olen), `tests/sunken_bastion_bosses.test.ts` (the veil),
  `tests/sunken_bastion_turnkey.test.ts` (the cage, and the Turnkey keeping
  the Gaol Grate), `tests/sunken_bastion_ossick.test.ts`,
  `tests/sunken_bastion_moorings.test.ts` (the Mooring Posts),
  `tests/sunken_bastion_reaper.test.ts`, `tests/sunken_bastion_vael_pass.test.ts`
  (the entrance, the three-step chain, the gathering, the beam's tells),
  `tests/sunken_bastion_crown_alert.test.ts` (the HUD's boss alert); dev
  triggers: `/dev bastion trigger`.
