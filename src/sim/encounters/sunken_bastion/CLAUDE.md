# src/sim/encounters/sunken_bastion: the Sunken Bastion boss fights

The boss encounters of the Sunken Bastion rework
(`docs/design/dungeon-rework/sunken_bastion.md`, sections 5 and 6) and the Gaol
Turnkey miniboss, ticked once per claim by `tickBastionEncounters` (`index.ts`),
called from `instances/dungeons.ts` `updateInstances` right after the trash kit,
so a planted charge, a pinned reaper or a hauled player owns its position for
the tick.

| Module | Role |
|---|---|
| `ids.ts` | Leaf: ids, cast and aura ids, object templates, tuning and the pure geometry (`oathLaneEnd`, `anchorDragSpeed`, `shackleStrained`, `cageDropHeight`, `cageEscapeProgress`, `reaperPoolSpot`, `inReapingSweep`, `veilSlots`, `veilBeamYaw`, `inBeam`). The renderer, the HUD prompt and tests key on it. |
| `claim.ts` | Claim plumbing: the live Bastion claims, their players and bosses, encounter object and body spawn/drop, mechanic damage through the heroic stamp, the hashed victim pick (`pickMarkTargets`), manual deed grants. |
| `olen.ts` | The Oathbound Charge into the buttresses (Breached or Unbroken Oath), heroic Undertow Wake. |
| `turnkey.ts` | The Gaol Turnkey: the Iron Cage (a hittable cage body dropped over a stunned player), the escape press (`tryCageStruggle`, claimed from `sim.interact`: counted and rate-limited here), the mend, the crush, Open the Cells; heroic double cage and Brine Flood. |
| `ossick.ts` | The Drowned Anchor (a hittable anchor riding its rooted victim, hauled to the pit through `pull_toward.ts`), the Shackle Pair (strain past the chain's reach), the cudgel, Open the Cells; heroic Anchor Crash, heavier chain, shorter shackles. |
| `vael.ts` | Death itself: Mist Surge, the Fog Veil with its shadow copies and the Fogbeacon's beam, the Drowning Hymn, Fogburst, the Shadow Crossing (the pool behind a player, the Reaping Scythe); heroic drift, Mistbound and Grave Shadow. |
| `ward_hits.ts` | Pure: the cage and the anchor take fixed points per player or pet hit (asked by `combat/damage.ts` dealDamage). |

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
- Reset on evade and wipe restores the buttresses, opens the cages, drops the
  anchors and shackles, lifts the veil and dries the pools.
- Tests: `tests/sunken_bastion_bosses.test.ts` (Olen, the veil),
  `tests/sunken_bastion_turnkey.test.ts`, `tests/sunken_bastion_ossick.test.ts`,
  `tests/sunken_bastion_reaper.test.ts`; dev triggers: `/dev bastion trigger`.
