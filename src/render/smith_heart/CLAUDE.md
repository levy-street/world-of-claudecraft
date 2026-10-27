<!-- src/render/smith_heart/: the Smith's Heart raid's open-air renderer (phase 2A:
     the structure; phase 2B: the Hammer vein's Blender kit, air and light; phase 2C:
     its polish round; phase 2D: its last weak points; phase 2E: the mountain's rock
     kit and the Gallery's walk; phase 2F: the Ring's kit, the seal and the portal; phase 2G: the Breath vein's kit, light, sky and weather; phase 2H: the Quench vein's kit, floors, frost, light, sky and weather; phase 2I: the Heat vein as the Hearth, its kit, floors, basalt, light, sky, weather and the pour; phase 2J: the Heart, its kit, the roots, the crown, the arrival, and the gates' crystal curtain). Presentation only (parent dirs cover the IWorld seam,
     determinism and the GPU scheduler contract). Don't repeat root / src / render
     CLAUDE.md. -->

# src/render/smith_heart: the Smith's Heart's open-air renderer

The render half of the raid (`docs/design/raid/smith_heart.md`): two areas in one slot.
The main map: the Cleft, four guardian rooms (the Smith's Quarry, the Storm Cornice, the
Quench Basin, the Smith's Forge) cut into the mountain as open fissures round the Ring,
and the heart seal on its floating dais, which opens into a portal. The Heart: the
Anvil of the World held by four roots of the mountain over the Smith's beating heart in
its bed of crystal, inside a crown of mountain open to an ember sky. The sim layout (`src/sim/content/smith_heart_layout.ts`),
the gates (`SMITH_HEART_GATES`) and the seal's value (veins plus the portal bit,
`src/sim/encounters/smith_heart/seal.ts`) are the single source; everything here
derives from them. The Hammer vein (the Cleft, the Gallery, the Smith's Quarry, the Slab,
the Balcony's lookouts) is dressed with its Blender kit
(`public/models/props/smith_heart_hammer_kit.glb`, built from
`docs/design/raid/kit/build_smith_heart_hammer_kit.py`); the Ring, the Breath and the
Quench and the Heat (the Hearth, never a forge) have their own kits (phases 2F to 2I), and
the Heart has its own (phase 2J: `public/models/props/smith_heart_heart_kit.glb`, from
`docs/design/raid/kit/build_smith_heart_heart_kit.py`), as do the forge seal gates (the gate
kit, `smith_heart_gate_kit.glb`). The
Hammer guardian's and the Slab's effects are `../smith_heart_fx/`. The borrowed creature
bodies live in ONE list, `../characters/smith_heart_placeholder_looks.ts`.

| Module | Role |
|---|---|
| `index.ts` | Public surface: `buildSmithHeartInterior` (registered for interior `smith_heart` in `../open_air_fields.ts`). |
| `heart_interior.ts` | Composes the slot (terrain with the floating islands `shallow`, mountain, crags, props, Heart, lights, rivers, seal, portals, gates, sky) and owns the frame driver: the seal view, the portal stage, the hop detection and the sky's area blend. |
| `heart_plan_core.ts` | PURE: the palette and tones, the recipe of every `sh_*` prop kind (`HEART_PROP_RECIPES`: each room's hero shapes), a prop's base height, the budgeted lights (`planHeartLights`) and their zones, the hash. |
| `heart_mountain_core.ts` / `heart_mountain.ts` | PURE plan and painter of the mountain: one faceted heightfield rising out of the chasm past every floor's clearance (`heartMountainHeight`; since 2E a ledge under the floor for its first yards, `HEART_MOUNTAIN_RECESS`, and the dark mass behind the rock kit), low round the Cornice, deepest round the Heart, open air kept; `heartMountainBlocks` pins that no main-map eye sees into the Heart. In the Hammer vein it climbs in ledges and sheer risers (`heartHammerTerrace`, never above the smooth slope), banded in granite beds. |
| `heart_walls_core.ts` | PURE: the floor clearance field (`heartFloorClearance`), the open-air regions (`heartOpenAir`), each room's rock scale (`heartWallScale`), the ridge noise, and the loose crags at the mountain's foot (`planHeartWalls`, `heartRockShape`). |
| `heart_props.ts` | Instances the recipes (shared unit geometry, `surfaceMat` tones) and the crags (one instanced draw per rock shape, the shared triplanar rock on them; none deep in the Hammer vein, whose stepped granite stands in for them); the placeholders of the kinds a kit draws stand apart (`kitOwned`) so the kit takes their place. |
| `heart_kit_core.ts` / `heart_kit.ts` | A vein's Blender kit: the placement record (PURE), then the loader and baker (each Kit_* node split by slot: KitStone lit with the shared triplanar rock, KitGlow emissive), the instancer (culling cells, stretch and shear for the edge modules), the slot program warmers built with every interior, the late-landing swap. |
| `hammer_kit_plan_core.ts` / `hammer_kit.ts` | PURE plan and painter of the Hammer vein's kit: every vein prop fitted with its piece (the colossi kneeling on the first step, carved out of the terraces), the worked faces, rims and lips along every cliff run of the vein (the shared edge planner), and the render-only dressing (the great cliffs crowning the top step, `HAMMER_CROWN`; scaffold, hoists, spoil, chips, the floor's crack inlays, the collapse spot's overhang, the Balcony's lookouts). The sculpted quarry rock is `docs/design/raid/kit/hammer_cliff.py`. |
| `heart_rock_plan_core.ts` / `heart_rock.ts` | PURE plan and painter of the mountain's rock kit (`public/models/props/smith_heart_rock_kit.glb`, from `docs/design/raid/kit/build_smith_heart_rock_kit.py`): the sculpted faces laid in bands along contours of the clearance over the whole main map and the Heart (`planHeartRock`: fronts on their contour, feet sunk, crests reaching the next band, far builds high up), the lips hanging under every walk's brink (`planHeartLips`); one lit material, wide culling cells, no shadow, upper bands shed on the low tier. The loose crags stand in until the kit lands. |
| `heart_rock_cutaway.ts` | The rock's material discards its fragments near the camera (a camera zoomed out past an arena's rim stands in the mountain), and keeps a shade floor of its own colour (`HEART_ROCK_SHADE_FLOOR`, phase 2F). |
| `ring_kit_plan_core.ts` / `ring_kit.ts` | PURE plan and painter of the Ring's kit (phase 2F: `public/models/props/smith_heart_ring_kit.glb`, from `docs/design/raid/kit/build_smith_heart_ring_kit.py`): the Ring's paving, curb, foot and channels, both stairs tread by tread with their chutes, every stair's stringers and parapets, the dais, the standing stones, the cairns, the mouths' jambs and sills; the field tops it draws in their place (`RING_KIT_OMIT_TOPS`), the fascias' depth the lips start under, the spires' spots and veins. |
| `breath_kit_plan_core.ts` / `breath_kit.ts` | PURE plan and painter of the Breath's kit (phase 2G: `public/models/props/smith_heart_breath_kit.glb`, from `docs/design/raid/kit/build_smith_heart_breath_kit.py`): the Cornice's rods (a strike scar at each foot), wind-horns (bells to the rim) and channel cheek stones, the bridge's shelters and the landings' standing stones on the layout's colliders, the Wind Bridge's arch (the field then keeps a shallow keel under it, `BREATH_KIT_SHALLOW`, and no mountain lip hangs there), the low walls walked along every Breath lip over the void (`planBreathWalls`, past the lip, never over a walk), the grooves and cracks flat on the floors. |
| `breath_air_core.ts` / `breath_air.ts` | PURE plan and painter of the Breath's air and weather (phase 2G): the gale's streaks and grit over every Breath walk, cloud banks under the Cornice's rim and in the bridge's chasm, the bridge's gusts (`breathGustAt`: a band down the ramp and a curtain on its front, the streaks surging), the strikes on the rods in turn (`breathStrikeAt`: a bolt from the cloud, the crown's flash). Shader driven on the shared clock; cosmetic; the low tier a third of the particles (the gusts and strikes stay). |
| `lip_walls_core.ts` | PURE: a vein's low walls over the void (the Breath's and the Quench's): modules walked along every lip of its walks that drops to the void, set on their chords past the lip's bow (never over a walk), following a stair's slope, none where the lip bends onto another floor (`planLipWalls`, `lipWallClear`). |
| `quench_kit_plan_core.ts` / `quench_kit.ts` | PURE plan and painter of the Quench's kit (phase 2H: `public/models/props/smith_heart_quench_kit.glb`, from `docs/design/raid/kit/build_smith_heart_quench_kit.py`): the basin's fire bowls (`QUENCH_BRAZIER_FIRE` where their flame burns), vents, heaped old ice (its face square to the lake), the sunk blades, the Singing Ice's blades and the landings' frost stones on the layout's props and colliders; the low walls along every Quench lip over the void (`planQuenchWalls`); the frozen falls on the first band of rock facing a Quench walk (`planQuenchFalls`); the cracks flat on the ice and the drifts on the flat floors (`planQuenchDressing`, `QUENCH_DRIFT_FLOORS`). |
| `quench_lake_ice.ts` | The Frozen Lake's and the Singing Ice's surface (the `lake_ice` tops through the field terrain's `topMaterial` seam): a lit standard material over the painted frost skin with depth (dark water, bubbles at three depths and old cracks under parallax, the sky at grazing angles, the shallows paler), snow at every edge, the Singing Ice crazed and rougher. Opaque; the low tier one bubble layer, the Lambert tier the skin alone. |
| `quench_frost_core.ts` | PURE: the Quench's frost on the mountain (`quenchFrostWeight`, faded in past the Ring and out at the Breath and the Heart), its GLSL for the rock material (a cold film, rime on the ledges, faint glaze; read from the slot's origin, `setHeartRockSlot`), the heightfield's tint and the field cliffs' frost granite (`quenchCliffPaint`). |
| `quench_air_core.ts` / `quench_air.ts` | PURE plan and painter of the Quench's air (phase 2H): snow and frost motes over every Quench walk, steam off the vents and out of the rock, pale mist in the void under the walks, the braziers' fire (flame, embers, halo, a warm pool on the snow), and the Singing Ice's creaks (`quenchCreakAt`, `quenchCreakLook`: a crack running out across the sheet, bursting into frost). Shader driven on the shared clock; cosmetic; the low tier a third of the particles (the fire and the creaks stay). |
| `heat_kit_plan_core.ts` / `heat_kit.ts` | PURE plan and painter of the Heat's kit (phase 2I: `public/models/props/smith_heart_heat_kit.glb`, from `docs/design/raid/kit/build_smith_heart_heat_kit.py`): the Hearth's mouth, the altar-stone, the wellspring, the crystal clusters and the ember boulders on the layout's old forge props and colliders (ids frozen), the Pour Channel from the wellspring to its spill at the south lip (`heatChannelRun`), the column bundles past the Forge's corners (`planHeatPillars`), the bridge's arch (the field keeps a shallow keel under it, `HEAT_KIT_SHALLOW`, and no mountain lip hangs there), the walls along every Heat lip (never across the spill), the seams of fire and the ash flat on the floors. |
| `heat_hearth_floor.ts` | The Heat's floors (the `hearth` tops through the field terrain's `topMaterial` seam): the joints the painter marked as burning (`HEARTH_SEAM_PAINT`, found in the map by `hearthSeamMask`) scorched dark and lit with the first flame, breathing slow; opaque, lit, under every telegraph; the low tier steady, the Lambert tier the painted joints alone. |
| `heat_soot_core.ts` | PURE: the Heat's basalt on the mountain (`heatSootWeight`, faded in past the Ring and out at the Hammer and the Breath), its GLSL for the rock material (`heatSootGlsl`: darkened, the columns' vertical bands, soot, ash on the ledges; read from the slot's origin), the heightfield's tint and the field cliffs' columnar basalt (`heatCliffPaint`). |
| `heat_air_core.ts` / `heat_air.ts` | PURE plan and painter of the Heat's air (phase 2I): embers over every Heat walk and out of the chasm, the first flame's tongues in the Hearth's throat (`hearthThroatPoint`), smoke out of the chasm and off the Hearth's crown, the chasm's fire glowing under the walks, halos round the crystal, the heat's shimmer. Cosmetic; the low tier a third of the particles and no haze (the flames, halos and glow stay). |
| `heat_pour_core.ts` / `heat_pour.ts` | PURE timeline and painter of the pour, the Heat's set piece's look (`heatPourLook`, `HEAT_POUR`: the wellspring brims and the channel's bed lights to the lip BEFORE the flow, then the flow, the fall off the lip, the drain; the shaders run the same arithmetic). The warning glow and the flow on every tier (the channel on the ground rung), the sparks shed on the low tier; the vein's white-gold, never a threat colour. |
| `heart_fire_glsl.ts` | The fire in the air shared by the Quench's fire bowls and the Heat's Hearth: a flame's billboards, embers off a fire, a soft glow (halo, ember, pool). |
| `heart_ice_sheen.ts` | The kits' ice slot's touch (phase 2H): a cold sheen at grazing angles and a breath of inner light on a lit vertex-colour material. |
| `heart_air_quads.ts` | The air systems' one geometry (the Hammer's, the Breath's and the Quench's): merged view-space quads. |
| `hammer_walk_plan_core.ts` | PURE: the Gallery's worn kerb and chain rail along its lips over the chasm (the rail never over a walk); the paving is its `paving` ground, the fallen blocks layout props. |
| `hammer_air_core.ts` / `hammer_air.ts` | PURE plan and painter of the Hammer vein's air: the Cleft's fan of sun shafts with their dust, warm pools and the crystals' halos (the raid's first image), dust motes in the low sun, grit off the terrace lips and the colossi, the collapse spot's heavy trickles, the pit's grey haze, the geodes' halos. Shader-driven quads, cosmetic, a third on the low tier. |
| `heart_cliff_paint_core.ts` | PURE: the field's cliff faces' vertex paint, the Hammer vein's in its cool quarry granite (never near-black), the shared tint elsewhere; the vein's share at a point (`hammerRockLift`), its granite beds (`hammerRockBed`) and its risers' shade (`hammerRiserShade`) for the mountain and the crags. |
| `heart_lights.ts` | The point lights through the fire-light sink (at most eight per light zone), each with a halo card. A light hung past a walked floor's lip (the Cleft's) carries its own height (`HeartLightSpot.y`): the field's height there is the void. |
| `heart_rivers_core.ts` / `heart_rivers.ts` | The floor light-rivers: a ribbon per vein, dim always, the bright twin's draw range running arena to seal as the vein lights; the last leg leaps the chasm onto the dais. |
| `heart_seal_core.ts` / `heart_seal.ts` | The seal memory (veins, the portal and, phase 2J, the arrival's bit as `awakeSince`: live when seen waking, long past when first seen awake; fed by `../gate_objects.ts`), the fill timeline (`heartSealQuarterFill`, `heartSealColumn`, the arrival's wave, the spire igniting); the seal from the Ring kit (four quarters of granite and crystal that fill, charge and part like petals, the crystal boss, the shards that burst out and turn round the portal) under a flush additive light, the four crystal spires, the arrival columns and waves. |
| `heart_portal_core.ts` / `heart_portal.ts` | The opening (`heartPortalStage`: charge, flash, split, ring, swirl), the living portal (vortex, funnel, motes, tine arcs), the return portal, the hop (`heartHopLanding`, `heartHopStage`, the wash) and the area blend. |
| `heart_fx_materials.ts` | The texture-free VFX shaders (beam, floor ring, vortex, funnel, motes, core, the crystal of the seal and the spires, the rivers' surge). Fresh per call: their uniforms are the slot's state. |
| `heart_room_core.ts` / `heart_room.ts` | The Heart: the core and its shafts, the rune rings (carved glyphs, never a dashed lane), the embers; with the Heart kit the core in its bed's hollow and each vein's channel light (`setVein`, `setHeart`); without it the blockout's chains (one instanced draw) and their pours and the keels under every floating island. |
| `heart_room_kit_plan_core.ts` / `heart_room_kit.ts` | PURE plan and painter of the Heart's kit (phase 2J): the platform's and the terrace's walks and keels, the bridge on the field's ramp (the tops it paves omitted, `HEART_KIT_OMIT_TOPS`; a shallow keel under the bridge), the heart's bed drawn past the lip (`HEART_CORE_BED_SCALE`, its crystal dimming with the heart), and each vein's altar (taller than its collider, never wider: `HEART_ALTAR_RISE`) and root (`HEART_ROOT_SPINE`, the chains' replacement) on its vein's glow (`heartVeinGlowMaterial`: lit and dimmed per vein, its light running down the root). |
| `heart_crown_core.ts` | PURE: the Heart's crown of rock (`heartCrownWeight`, in the Heart alone): the GLSL for the rock material (dark warm granite, crystal veins in each quarter's vein colour, the heart's light from below) and the heightfield's tint. |
| `heart_final_core.ts` | The memory of each claim's final boss's fall (written by `../smith_heart_fx/final_fx.ts`, read by the interior's frame driver, which has no world): the room goes dark with the heart (`heartFinalDarkness`). |
| `heart_environment.ts` | PURE: the Heart's fog and light state (`smithHeartCore`), the Hammer vein's (`smithHeartHammer`: a warm quarry dusk, the key low from the south-west), the Ring's (`smithHeartRing`, phase 2F: the same sun over a neutral grey fill) and the Breath's (`smithHeartBreath`, phase 2G: a cold teal-white key high in the north-west over a neutral grey fill, winning north of the Ring's mouth, `inBreathLight`), read by `../fog_scene_state.ts` and `../interior_light_rig.ts`. |
| `heart_gates_core.ts` / `heart_gates.ts` | The gate looks on the shared gate memory: `stone_slab` splits and sinks (the kit's carved halves once the Hammer kit has landed); `forge_seal` is a LOW barrier (at most about 3 yd, `HEART_SEAL_BARRIER`), nothing metal: the gate kit's carved threshold with crystal in its channel and a standing stone at each end (`public/models/props/smith_heart_gate_kit.glb`, from `docs/design/raid/kit/build_smith_heart_gate_kit.py`), and a curtain of crystal light rising out of the channel in the gate's vein colour (`heartGateTint`; the Heart Bridge's braids all four), never a solid in a sightline. |
| `heart_sightline_core.ts` | PURE: every crag, prop part (scale included) and gate part as a plain volume, and `heartSightlineHits` to trace a sightline through them. |
| `heart_sky.ts` | The dome: the storm over the main map, the Breath's summit storm (`setBreath`, phase 2G: a rolling deck, a rift of light, lightning in the cloud and distant bolts), the ember night over the Heart (`setCore`); its `onBeforeRender` is the slot's frame driver and hands it the camera. |

Rules:
- Render reads the world, never mutates it: the seal's and the portal's state arrive
  only through the mirrored marker entities (`gate_objects.ts`), the gates' only through
  the gate memory, the hop only as the camera crossing areas in one frame.
- Every VFX mesh is built with the interior (the compile gate links it, hidden or not);
  no texture upload on first use (the shaders read none; the halos share
  `radialGlowTexture`); nothing is attached to the scene outside the interior group.
- The seal, the rivers, the gates, the portals, the bursts and the hop draw on every
  tier (progress and the way); only the motes and embers thin on the low tier (the
  static preset), and the mountain's grid coarsens (the same mountain).
- No light but the budgeted point lights through the fire-light sink; the Heart's grade
  is its own fog state, the Hammer vein's too (`smithHeartHammer`: warm key, cool
  slate-violet fill, a neutral dust; never a warm wash over everything), the Ring's and
  the Breath's and the Quench's too (`smithHeartRing`, `smithHeartBreath`,
  `smithHeartQuench`) and the Heat's (`smithHeartHeat`, phase 2I: a warm key from the
  Hearth's side over a cool slate fill, never a warm wash); whatever no vein's light holds
  keeps the borrowed `sunkenBastion` state.
- The Heart (phase 2J) has no metal either: its platform is held by four roots of the
  mountain (the chains are gone), its altars are each its vein's stone, its gates are
  carved stone with a curtain of crystal light. The arrival scene is presentation only,
  played from the seal markers' arrival bit (`awakeSince`), whole for a late arrival; the
  body and its effects are `../smith_heart_fx/final_fx.ts`'s. A piece a body can touch is
  on a layout collider (the altars) or past a lip; the walks the kit paves stay flat.
- The Heat is the Hearth, never a forge (the owner's decision, phase 2I): no anvil, bellows,
  crucible, chain, coal or tool in any piece, and white-gold fire, never volcanic red. The
  layout's forge ids stay (frozen); only the look changes. Its weather (`heat_air.ts`) is
  cosmetic; the pour's warning glow and flow (`heat_pour.ts`) draw on every tier, in the
  vein's white-gold, under every telegraph. The Heat guardian's lane and ring are
  `../smith_heart_fx/heat_fx.ts`'s, on every tier.
- The Quench's weather (snow, motes, steam, mist, fire, creaks, `quench_air.ts`) is
  cosmetic: never a telegraph (the creaks wear the vein's pale light, never a threat
  colour, on the ground rung under every telegraph), its mist under the walks and past
  the rims. The Quench guardian's cone is `../smith_heart_fx/quench_fx.ts`'s, on every tier.
- A flat effect quad (a creak, a fire's pool) is drawn double sided, and no shader takes
  `pow()` of a value that can go negative (undefined in GLSL: write the square out).
- The Breath's weather (its streaks, clouds, gusts and strikes, `breath_air.ts`) is
  cosmetic: never a telegraph, never thicker than a streak over a walk, its clouds under
  the Cornice's walk and past its rim. The Breath guardian's footprints are
  `../smith_heart_fx/breath_fx.ts`'s, on every tier.
- A point light falls off physically: one that must reach rock 15 to 25 yd away needs a
  strong source (the Cleft's door and fill), a lamp's pool a small one.
- The Ring kit draws over the field: its paving a breath over the walk, its curbs and
  thresholds under a hand, its parapets, fascias, feet and mouth stones past the lips,
  every solid a body can touch on a layout collider; the field tops it replaces are
  omitted only once it has landed. Pinned by `tests/smith_heart_ring_kit.test.ts`
  against the shipped GLB, its solids in the sightline pin (`heartRingSolids`).
- The mountain's rock never stands nearer a floor than its band's contour of the
  clearance, never in the open air, never over a walked floor (a lip's brink under its
  walk); its pieces stretch at most half again up their slope. Pinned by
  `tests/smith_heart_rock_kit.test.ts`, its volumes in the sightline pin
  (`heartRockSolids`).
- A kit piece a body can touch stays within its layout collider (plus a body's width); a
  render-only piece never stands over a walked floor (the terraces are dressing floors
  nobody reaches); the edge modules keep their lip frame (a rim never stands proud of the
  pit floor). Pinned by `tests/smith_heart_hammer_kit.test.ts` against the shipped GLB.
- One mesh hook (the sky's), pinned in `tests/point_light_carriers.test.ts`; floor marks
  (rivers, seal, portal discs and rings, rune rings) on the floor ladder's ground rung
  with literal steps, registered strict in `tests/floor_vfx_layer.test.ts`.
- No render-only solid stands in the raid's key sightlines (every 10 degrees of the Ring
  and the Balcony tip to the seal and the portal's eye, the Balcony tip to each vein
  mouth), and no main-map eye sees into the Heart through the mountain. A new solid
  joins those plans.

Tests: `tests/smith_heart_render_core.test.ts` (mountain, crags, sightlines, rivers,
seal memory and fill, portal and hop timelines, chains, keels, core, gate poses, props,
light budget), `tests/smith_heart_areas.test.ts` (areas, score, the Heart's air),
`tests/smith_heart_hammer_kit.test.ts` (the Hammer kit's GLB and its plan) and
`tests/smith_heart_hammer_fx.test.ts` (the vein's air, the guardian's and the Slab's
effects), `tests/smith_heart_rock_kit.test.ts` (the rock kit and its plan) and
`tests/smith_heart_ring_kit.test.ts` (the Ring kit, its plan and the seal's moments),
`tests/smith_heart_breath_kit.test.ts` (the scoured floor, the Breath kit and its plan) and
`tests/smith_heart_breath_air.test.ts` (its air, weather and light),
`tests/smith_heart_quench_kit.test.ts` (the frost and lake-ice floors, the Quench kit and its
plan), `tests/smith_heart_quench_air.test.ts` (its air, creaks, frost and light),
`tests/smith_heart_heat_kit.test.ts` (the hearth floors, the Heat kit and its plan, the
renamed knell) and `tests/smith_heart_heat_air.test.ts` (the pour's timeline, its air, basalt
and light), `tests/smith_heart_heart_kit.test.ts` (the Heart kit, its plan, the crown) and
`tests/smith_heart_gate_kit.test.ts` (the gate kit). Evidence:
`scripts/smith_heart_hammer_shot.mjs` (its `mesh:` action waits on an effect mesh).
