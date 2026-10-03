# src/sim/encounters/drowned_temple: the Drowned Temple boss fights

The three boss encounters of the Drowned Temple rework and its showpiece, the
Mere Hydra (`docs/design/dungeon-rework/drowned_temple.md`, sections 4.3 and 5),
ticked once per claim by `tickTempleEncounters` (`index.ts`), called from
`instances/dungeons.ts` `updateInstances` right after the Bastion's, so a pull or
a planted cast owns its tick.

| Module | Role |
|---|---|
| `ids.ts` | Leaf: ids, cast, aura and object template ids, tuning, and the pure geometry (`tideHalfAt`, `inTideHalf`, `chorusShare`). The renderer and tests key on it. |
| `claim.ts` | The live Temple claims and the Temple's ephemeral encounter objects; the claim-generic reads are the Bastion's (`../sunken_bastion/claim.ts`), re-exported. |
| `selthe.ts` | Choirmother Selthe: Chorus (split) and Solo (spread) marks (G16), Sea-Song, Tidal Slap; heroic Duet and Echo. |
| `mere_hydra.ts` | The Mere Hydra's coordinator: three stationary heads sharing one fight state (G17), the element clocks (each fired by whoever wields that element, `ids.ts` `hydraElementOwners`), Enraged Hydra stacks, the deed, the reset (a wipe regrows every fallen head whole). |
| `hydra_elements.ts` | The three elemental attacks: ice (Freezing Breath cone and its chill), venom (Venom Spit pools that leave burning venom), water (Crushing Torrent lane and its shove). |
| `hydra_tsunami.ts` | The Tsunami: the heads submerge (a bar, 75 percent less damage) and a wave rolls over one half of the pool, alternating sides; the other half and a rim column's lee are safe; heroic backwash. |
| `hydra_regrowth.ts` | A fallen head grows back 20 s later (half health, same fight) while another lives; `Entity.regrown` keeps it from paying a reward twice. |
| `tideglass_colossus.ts` | The Tideglass Colossus: it walks its foe down (the mob AI), plants its feet for each bar and never leaves the Prism Terrace; one Reflection per player at 75/50/25 percent (G22), the prism ward, Moonlight Lance, Resonant Slam; heroic Shattering Glass and Swapped Images. |
| `reflection_guard.ts` | Pure: a Reflection takes no damage from its owner (asked by `combat/damage.ts` dealDamage). |
| `ysolei.ts` | Ysolei (stationary, coiled on the Moon Altar): Lunar Tide, the Undertow pull (G13, `../../pull_toward.ts`) and the Tidal Crash, the Rising Tide flooding one half of the island at a time (G10), the Moonspawn Call and Drowned Wrath roars; heroic Riptide and Drowned Moon. |

Rules:
- Deterministic: every pick is hashed (`kitHash`) or entity-id ordered; the only
  rng draws are damage rolls. Fixed DT countdowns.
- Every visible state rides existing entity fields (cast bars, facing, auras,
  object template ids and scale, a Reflection's `forcedTargetId`), so the online
  client mirrors it with no wire or IWorld change.
- Reset on evade and wipe clears the marks, the Reflections, the pools and dries
  the island.
- Tests: `tests/drowned_temple_bosses.test.ts`, `tests/drowned_temple_hydra_elements.test.ts`,
  `tests/drowned_temple_colossus_chase.test.ts`, `tests/drowned_temple_ysolei_pass6.test.ts`;
  dev triggers: `/dev temple trigger` (breath, spit, torrent, tsunami, regrow among them),
  jumps: `/dev temple tp selthe|hydra|colossus|ysolei`.
