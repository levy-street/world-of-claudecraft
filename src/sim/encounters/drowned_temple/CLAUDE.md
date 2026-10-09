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
| `selthe.ts` | Choirmother Selthe, a caster who never leaves her pool or swings her hands: Chorus (split) and Solo (spread) marks (G16), Sea-Song, the kickable Moonwater Bolt (her tank pressure, from her weapon roll) and Drowning Aria (a beam a kick, a lost line of sight or a body stepping into it answers, `ariaCatcher`), the Mere Surge wedge; heroic Duet and Echo. |
| `mere_hydra.ts` | The Mere Hydra's coordinator: three stationary heads sharing one fight state (G17), the element clocks (each fired by whoever wields that element, `ids.ts` `hydraElementOwners`), Enraged Hydra stacks, the deed, the reset (a wipe regrows every fallen head whole). |
| `hydra_elements.ts` | The three elemental attacks: ice (Freezing Breath cone and its chill), venom (Venom Spit pools that leave burning venom), water (Crushing Torrent lane and its shove). |
| `hydra_tsunami.ts` | The Tsunami: the heads submerge (a bar, 75 percent less damage) and a wave rolls over one half of the pool, alternating sides; the other half and a rim column's lee are safe; heroic backwash. |
| `hydra_combo.ts` | The Combined Breath: between two Tsunamis two heads fuse their elements in a fixed order (`ids.ts` `HYDRA_COMBO_ORDER`): the Frostlocked Torrent (a frozen lane and the Ice Wall, whose lee shelters from the next wave, which shatters it), the Venom Current (the venom pools slide down their currents) and the Toxic Rime (the pools freeze, then burst). Slots, hold and pricing in `HYDRA_COMBO_TUNING`. |
| `hydra_regrowth.ts` | A fallen head grows back 20 s later (half health, same fight) while another lives; `Entity.regrown` keeps it from paying a reward twice. |
| `tideglass_colossus.ts` | The Tideglass Colossus: it walks its foe down (the mob AI), plants its feet for each bar and never leaves the Prism Terrace; one Reflection per player at 75/50/25 percent (G22), the prism ward, Moonlight Lance, Resonant Slam, the Tideglass Fracture (`tideglass_fracture.ts`); heroic Shattering Glass and Swapped Images. |
| `tideglass_fracture.ts` | The Tideglass Fracture: the terrace floor splits into eight slices (`ids.ts` `fractureSliceAt`), three rounds of red slices detonating while the safe ones move (`FRACTURE_SAFE_PATTERNS` turned by a hashed rotation); the state rides eight slice objects and the Colossus's channel bar. |
| `reflection_guard.ts` | Pure: a Reflection takes no damage from its owner (asked by `combat/damage.ts` dealDamage). |
| `ysolei_moon.ts` | Ysolei calls the moon: Moonlight Tears at 75 and 45 percent (a body stops a tear and wears Moonsear; a tear that reaches her is a Moonswell stack) and the Full Moon at 20 (a Falling Moon bar under her Plenilune Ward: break it for the eclipse, or the moon falls). Tuning and its math in `YSOLEI_MOON_TUNING`. |
| `ysolei.ts` | Ysolei (stationary, coiled on the Moon Altar): Lunar Tide, the Undertow pull (G13, `../../pull_toward.ts`) and the Tidal Crash, the Rising Tide flooding one half of the island at a time (G10), the Moonspawn Call and Drowned Wrath roars; heroic Riptide and Drowned Moon. |

Rules:
- Deterministic: every pick is hashed (`kitHash`) or entity-id ordered; the only
  rng draws are damage rolls. Fixed DT countdowns.
- A kickable boss bar is listed in `ids.ts` `TEMPLE_BOSS_CAST_SCHOOLS` (spread into
  `mob/healer_channel.ts`); every other boss bar is a mechanic, never kicked.
- Every visible state rides existing entity fields (cast bars, facing, auras,
  object template ids and scale, a Reflection's `forcedTargetId`), so the online
  client mirrors it with no wire or IWorld change.
- Reset on evade and wipe clears the marks, the Reflections, the pools and dries
  the island.
- Tests: `tests/drowned_temple_bosses.test.ts`, `tests/drowned_temple_hydra_elements.test.ts`,
  `tests/drowned_temple_colossus_chase.test.ts`, `tests/drowned_temple_ysolei_pass6.test.ts`,
  `tests/drowned_temple_selthe_caster.test.ts`, `tests/drowned_temple_colossus_fracture.test.ts`,
  `tests/drowned_temple_hydra_combo.test.ts`, `tests/drowned_temple_ysolei_moon.test.ts`,
  `tests/drowned_temple_encounter_pass_dev.test.ts`;
  dev triggers: `/dev temple trigger` (bolt, aria, surge, breath, spit, torrent, tsunami, regrow,
  fracture, combo, frostlock, current, rime, tears, fullmoon, cocoon among them),
  jumps: `/dev temple tp selthe|hydra|colossus|ysolei`.
