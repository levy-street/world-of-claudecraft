# Fenbridge rebuild master plan

Status: implementation contract

The rebuild replaces Fenbridge's four generic buildings and small prop cluster with a
purpose-built swamp settlement while keeping Mirefen's existing quests, services,
simulation order, and remote landmarks intact. The checked-in layout and asset contracts
are authoritative. Concept art is visual guidance only.

**Quality bar and rebuild queue:** `docs/design/fenbridge-rebuild/quality-bar.md`.
Eastbrook is the process base, not the beauty ceiling. **All 14 Fenbridge town
assets ship multi-round exterior factories** (no placeholders). Human-approved:
inn, tannery, gatehouse, chapel. Remaining assets shipped for review after exterior
densify polish. Concept art under `references/` and `img2threejs/` is retained.

## Locked gameplay contract

- Keep the zone id `mirefen_marsh`, hub center `(0, 300)`, all stable NPC, quest, item,
  camp, gather-node, dungeon, delve, graveyard, and POI ids, and production seed `20061`.
- Expand the hub radius from `20` to `34` yards to support the new town footprint. This is
  an intentional town-terrain, focus, music, and scatter exclusion change. It must not
  change camp ordering, camp counts, lake geometry, the Deepfen dock, the meteor site,
  the Sunken Bastion mouth/return point, or the Drowned Litany marker/return point.
- Preserve all eight Fenbridge NPC payloads. Only authored position and facing may change.
  Every NPC must spawn at its authored point without `findSafePos` relocation.
- Preserve `station_fenbridge_tannery`, `q_fenbridge_muster`, both live muster-order
  objects, `fen_muster_order`, the Fenbridge mailbox, `gy_fenbridge`, Petra's banker chest,
  and the inn rest contract.
- Keep every route bidirectionally traversable by both player and pet bodies from the
  south causeway and civic square. Test the mailbox, tannery, graveyard, inn, bank chest,
  every NPC, both muster orders, all four gates, and every building entrance.
- Keep collision-bearing silhouettes identical on every graphics tier. Low may remove
  only nonblocking clutter, emissive accents, expensive material maps, and decorative
  microgeometry.
- Buildings are exterior shells. No inaccessible interiors consume triangles.

World coordinates use the repository convention: local `+Z` is an asset's front, world
`+z` points north/deeper into Mirefen, and world `+x` points west.

## Site plan

The civic center is `(0, 303)`. A roughly circular palisade sits at radius `31.5` with
four deliberately open gates. The broad center and service aprons remain packed earth;
ground-seated boardwalk planks dress wet margins without pretending to be raised gameplay
surfaces.

| Stable layout id | Center | Native size W x H x D | Facing rule | Exterior service cues |
| --- | ---: | ---: | --- | --- |
| `fenbridge_warden_gatehouse` | `(9, 282)` | `7.8 x 10.5 x 7` | front toward civic center | horn, guard balcony, lantern cage, gate gear |
| `fenbridge_crooked_reed_inn` | `(-7, 310)` | `9 x 8.8 x 8` | front toward civic center | deep porch, provision counter, chimney, rain awning |
| `fenbridge_lantern_chapel` | `(-19.5, 294)` | `7 x 8.6 x 7` | front toward civic center | bell gable, lancets, archive display, grave lamps |
| `fenbridge_moonwort_apothecary` | `(17.8, 291.5)` | `7 x 7.2 x 6` | front toward civic center | herb racks, bottles, fungi, crooked roof |
| `fenbridge_gilded_strongbox` | `(19.2, 309.5)` | `7.5 x 7.4 x 6.5` | front toward civic center | teller window, ironbound vault cues, piling base |
| `fenbridge_hesk_tannery` | `(-16, 318)` | `12 x 7.2 x 7` | front toward civic center | open work awning, hide frames, vats, drains |
| `fenbridge_scout_lodge` | `(3, 325)` | `8 x 7.6 x 6.5` | front toward civic center | map lean-to, weapon racks, lookout perch |

Building rotations are derived with `facingToward(building.position, civic.center)` and
then literal-pinned after validation. Asset sockets, checked-in standing points, renderer
placement, and collider seating derive from the same source contract.

### Civic and repeated pieces

- `fenbridge_mirelight_cistern` at `(0, 303)`, radius `1.8`: low stone cistern, covered
  brazier, kettle, and restrained teal fenlight.
- `fenbridge_provision_stall` near `(-3.5, 306.5)`: compact exterior sales counter with a
  clear vendor side and player side.
- `fenbridge_muster_board` on the inner south gate apron. Two separate collectible muster
  orders remain available at opposite sides of the gate so multiplayer respawn behavior
  and object count remain unchanged.
- `fenbridge_palisade_wing` is an instanced exterior wall module. Gate gaps remain at least
  `5` yards wide and no decorative arch may close the gameplay lane.
- `fenbridge_gate_arch` is a visual arch with explicit jamb-only compound collision.
- `fenbridge_boardwalk` is a repeated, ground-seated wet-margin module. It is decorative,
  nonblocking, and never substitutes for sim-owned raised ground.
- `fenbridge_muster_order` is a dedicated sealed order bundle sized for the existing quest
  object normalization path. It keeps the item id and interaction behavior unchanged.

### Gates and roads

| Gate | Crossing | Connected route |
| --- | ---: | --- |
| south causeway | `(0, 271.5)` | existing Eastbrook road through `(-8, 240)` to civic center |
| west marsh road | `(30.5, 313)` | Drowned Chapel route before `(45, 336)` |
| east marsh road | `(-30.5, 314)` | Troll Mounds route before `(-40, 370)` |
| north fen road | `(0, 334.5)` | Cult/Bastion route before `(10, 400)` |

Interior route additions are part of the canonical road definitions so terrain painting,
map lines, vegetation suppression, and movement see the same lanes. Exterior route points
and their order stay unchanged beyond the new gate connectors.

### Service placement intent

- Warden Fenwick stands on the inner south-gate apron beside the gatehouse and muster
  orders.
- Scout Maren stands at the scout lodge map lean-to near the north route.
- Brother Aldric stands at the chapel entrance. Chronicler Osric uses the archive side of
  the same exterior.
- Provisioner Hale uses the inn's provision counter.
- Herbalist Yara uses the apothecary porch.
- Bursar Petra Vell uses the bank teller apron with a clear banker-chest candidate zone.
- Tanner Hesk and `station_fenbridge_tannery` remain at their established coordinates
  beside the new tannery facade unless collision validation requires a small, literal-pinned
  adjustment. The station-to-master distance remains between `1` and `3` yards.
- The mailbox remains at the boardwalk mouth unless its exact point conflicts with the
  expanded south-gate composition. Any move must preserve its stable id and a clear
  seven-yard interaction approach.

## Asset roster and hard budgets

All shipping GLBs are deterministic procedural Three.js exports with Meshopt compression,
floor-seated bounds, `+Z` front, semantic vertex colors, no animation, no skin, no camera,
no light, and no embedded uncompressed raster texture. Authoring keeps meaningful named
components; the shipping pass merges to at most one opaque and one emissive primitive.

| Asset key | Triangle target | Hard triangle ceiling | Hard byte ceiling | Placement count | Quality status |
| --- | ---: | ---: | ---: | ---: | --- |
| warden gatehouse | `6,200` | `12,000` | `480 KiB` | `1` | multi-round rebuild (`5,174` tris) |
| Crooked Reed inn | `5,600` | `9,500` | `420 KiB` | `1` | **quality-bar approved** (`7,869` tris) |
| Lantern Chapel | `4,200` | `6,400` | `300 KiB` | `1` | placeholder |
| Moonwort apothecary | `4,200` | `6,400` | `300 KiB` | `1` | placeholder |
| Gilded Strongbox | `4,000` | `6,200` | `280 KiB` | `1` | placeholder |
| Hesk tannery | `8,000` | `13,500` | `560 KiB` | `1` | **quality-bar approved** (`11,864` tris) |
| scout lodge | `3,800` | `6,200` | `280 KiB` | `1` | placeholder |
| mirelight cistern | `800` | `1,200` | `140 KiB` | `1` | placeholder |
| provision stall | `1,100` | `1,500` | `160 KiB` | `1` | placeholder |
| palisade wing | `240` | `320` | `100 KiB` | max `18` | placeholder |
| gate arch | `1,000` | `1,500` | `160 KiB` | max `4` | placeholder |
| boardwalk module | `160` | `240` | `90 KiB` | max `12` | placeholder |
| muster board | `420` | `650` | `110 KiB` | `1` | placeholder |
| muster order | `260` | `400` | `100 KiB` | `2` | placeholder |

Local ceilings may rise for a quality rebuild when concept fidelity needs it (inn
precedent). Raise `model.js` and this table in the same change, re-check wave totals,
and keep silhouette / socket contracts stable. See `quality-bar.md` for craft rules.

Wave ceilings (raised so concept-faithful plank walls and shingle courses can ship):

- unique shipping geometry: `72,000` triangles;
- placement-weighted runtime town geometry: at most `88,000` triangles including
  terrain foundations;
- all Fenbridge GLBs: `2.5 MiB`;
- all shared Fenbridge support textures: `448 KiB`;
- total Fenbridge media delta: `3.0 MiB`;
- desktop Ultra: at most `22` color draws and `10` shadow casters for the visible town;
- mobile Low: at most `16` color draws, no dynamic town shadow casters, no normal or
  roughness maps, and no alternate GLB downloads;
- at most three shared `512 x 512` WebP support maps: base, normal, roughness.

The repository-wide asset budget is already red before this work. Acceptance reports the
exact Fenbridge delta and never describes the aggregate budget as passing.

## Visual acceptance contract

Every asset needs front, rear, left, right, and hero previews, player-scale proof, exact
runtime-collider overlay, raw-to-optimized comparison, and a reference comparison sheet.
The minimum overall and per-critical-feature score is `0.70`. A score is an agent-reviewed
decision backed by images, not a script-generated similarity number.

Town evidence uses matched desktop Ultra and mobile Low profiles and includes:

1. elevated overview;
2. top-down site-plan proof;
3. south causeway and open gate;
4. civic square;
5. player-scale street view;
6. north/east/west gate continuity;
7. tannery station and Hesk;
8. chapel/graveyard and archive;
9. inn, bank, apothecary, and scout service aprons;
10. muster order, mailbox, banker chest, collision, and route overlay.

Final evidence must show rain, fog, terrain seating, roof fading, foliage exclusions, Low
tier silhouette parity, and no retired generic Fenbridge geometry.

## Non-goals

- No explorable interiors.
- No changes to mob models, camp ordering, lakes, distant ruins, dock gameplay, dungeon or
  delve triggers, gathering nodes, fishing rules, quest payloads, localization ids, voices,
  or persistence ids.
- No tier-specific duplicate GLBs and no new runtime framework.
