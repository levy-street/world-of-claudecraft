# The Mirefen tavern

A walk-in inn on the Fenbridge road in Mirefen Marsh: the first interior in the open world
built to classic-inn scale for the 2.6 yd player (it reads big when you walk in, and the
furniture reads right next to you). One storey for players, the common room open to a high
hammerbeam roof. Original work for this game: the plan, the model and its palette were authored
here from a written brief, and it wears the painted town's own hand-painted maps; reference
captures of classic inns were studied for mood and proportion only and never entered the build.
The model was rebuilt in the painted world style (the team's painted world style guide), in the
Fenrire look of the painted Fenbridge buildings beside it: the same plan, footprint, floors, seats
and colliders, raised wall by wall in Blender as one settled, hand-built structure, at about two
thirds of the triangles of the modelled build it replaced, its common room lined with an oak
wainscot under plaster and the bare timbers that carry its roof, and dressed with some forty
painted models (below).

## Where and what

- **Site.** `TAVERN_ORIGIN` in `src/sim/content/mirefen_tavern.ts`, the door facing the road
  (world +x). Clear of the road, the camps, the gather nodes and the quest objects
  (`tests/mirefen_tavern.test.ts` "the site").
- **Plan.** An L: the common room (the hall) with a round hearth one step down in the middle of
  the floor under a copper hood hung high from the trusses' collars; a window booth either side of
  the door; the dice table, the long table and a wall booth down the left side; the bard's raised
  stage in the back left corner with its curtain and footlights and three of the game's own shields
  over it;
  the wall fireplace and its settle on the right; the bar on a raised platform in the back right
  corner wrapped round a great octagonal oak post that carries a beam to the right gable, the
  barrel racks against the back wall either side of the kitchen's serving hatch. A round tower in
  the inner corner opens onto the hall through an arch: a flagged nook with a stone rose, a bench
  round its wall, two small tables and a crown of candles hung high in its hat. The wing behind
  the hall's right half is the kitchen and cellar, closed; the hatch looks into its kitchen (a
  range, a cook's table, pots and herbs). The walls are lined to the low windows' sills with oak
  boards between stiles under a capping rail, and over that is plain plaster up to the timbers
  that carry the roof: the wall plate under the eaves (the hammer-beam trusses land on it) and, on
  each gable end, a king-post truss against the face (its tie along the gable's foot, a rafter
  under each slope, the king post on the ridge's line and a strut up to each rafter's middle;
  `inn_hall.py`). They are hung with the marsh's own
  things, each an arm's length or less off its wall, clear of the room's air (`inn_props.py`):
  a great stag's head over the door (from the lintel up to the wall plate, the one trophy that
  reaches two yards out), a boar's head over the wall booth, a pike mounted over the nook's
  arch, stocked shelves and a weapon rack between the window rows, a fisherman's net with cork
  floats and crossed oars and copper pans either side of the wall fire, a wicker eel trap by the
  stage, the fen's catch drying on a line by the door, hams and sausages over the kitchen hatch,
  a wine rack over the barrels and the inn's red and green banners in the gable ends' storeys.
  Racks of tankards hang from the beam over the bar, an ale cask on its cradle
  stands at the open end of the bar with tankards set out along it, painted barrels lie in the
  racks, a dresser, stacked barrels, crates of apples, sacks of meal and a basket of firewood
  stand against the right wall (solid: `dressing` records), a cauldron hangs from its tripod over
  the hearth, a bearskin lies on the stage before the bard's stool, the bard's lute, drum and pipe
  stand by the stool between two iron candelabra, and every table has its cluster of candles, its
  tankards and a board of bread and cheese or a jug; no rugs lie on the boards. The rooms the
  innkeeper lets upstairs are never walked. Outside: a battered stone storey on a tall plinth with
  an arched doorway, a
  half-timbered storey jettied out along the front under the eaves of a bell-cast slate roof that
  runs along the road (its ridge sagging, its gables on the side walls, each gable jettied out on
  its own bressumer), a steep cross gable climbing over the door with a rose window in it, dormers
  on both slopes, the wall fire's stone chimney climbing the right gable up
  through the verge, a loft door and its hay hoist high in the left gable over the stable, the
  tower's twisted witch's hat of slates with a tankard weathervane rising out of the back slope,
  the wing's roof running up into it in valleys, a striped canvas awning over the porch on two oak
  posts, and the sign: a giant oak tankard, iron-hooped and foaming over, hung from a yoke on a
  scrolled iron arm out of the upper storey under the eaves (its mesh made with Tripo's P2
  model, below). A caged lantern either side of the door (they glow, they cast no light: the point
  lights stay indoors), glowing windows, and solid (`TAVERN_PROPS`): a bench
  left of the door and three casks right of it on the porch. Inside, the job board
  hangs on the left wall by the door: notices of every size pinned up under a little slate hood,
  never words.
- **Scale.** Every number lives in the content module (`TAVERN_HALL`, `TAVERN_DOOR`,
  `TAVERN_TOWER`, `TAVERN_STAGE`, `TAVERN_HATCH`, `TAVERN_PROPS`) and is pinned against the
  player's height by `tests/mirefen_tavern.test.ts` "scaled for the player".
- **Open to the roof.** No timber crosses the common room under `TAVERN_HALL.truss`: the
  hammerbeam trusses span it front to back under the ridge (`TAVERN_HALL.trusses`, along x), and
  only their hammer beams and the braces under them dip lower, hugging the front and the back
  walls a yard and more over the camera's air. The old gallery, its joists, the aisle posts and
  the low nook beams are gone, and every hung thing (the hood on the collars, the chandelier on a
  purlin, the lanterns on iron arms off the gable walls, the tankards on the bar's beam) hangs
  over the camera's air. `tests/mirefen_tavern_asset.test.ts` "keeps the common room
  clear" scans the shipped model for any triangle there.

## Outside: the front and the grounds

- **The jettied front.** From `TAVERN_JETTY.y` up to the eaves the front stands `TAVERN_JETTY.out`
  further toward the road than the ground floor (`inn_hall.py`): joists whose ends show under the
  bressumer, the half-timbered storey over them settled as one (the middle sagged, the face
  leaning out as it rises), a box frame on a regular bay grid symmetric about the door (a sill,
  posts, a girt at the window sills, a head rail and the wall plate, every window centred in its
  bay) with its curved braces only in each face's end bays, a mirrored pair, six casements with
  shutters thrown back and boxes on brackets; the gable ends and the wing carry the same grid on
  up as trusses. Over the door's bay the storey runs on up into the cross gable, jettied out again
  at the main eaves' line and framed as a queen-post truss (its tie the bressumer, a raking strut
  over each window, a collar over the rose carrying the king post), every timber stopped under
  its rakes. Purely outside: the
  hall's inner wall runs on straight up under the sarking, no upper floor, nothing below the
  door's head. The front's three shell parts carry it (`mirefen_tavern_core.ts` `BOX_VOLUMES` reach
  out over the jetty and up the cross gable), so it ghosts like the wall.
- **Roof and settling.** Every big surface is one function that every part samples (the style
  guide's rule for code-built models): the hall roof runs along the road, its ridge
  (`TAVERN_HALL.ridge`) over the hall's length midway between the jettied front's face and the
  back wall, its profile across the ridge a bell-cast (`build_tavern.py` `roof_line`, steep under
  the ridge and easing out to the eaves), and it settles as a whole in `inn_roof.py`: the ridge
  sagged toward its middle, the eaves drooping between the gables and kicking up at the corners.
  The gable ends, the eave walls' tops, the dormers, the trusses, the tower's hat, the wing's roof
  and the cross gable all meet that same surface (`Roof.height` and `Roof.under`): the cross
  gable's slopes and the wing's run only as far as the valleys where they meet it, the eaves stop
  over the door's bay and behind the tower and the wing, the right verge is notched round the
  chimney. Nothing is ruler-straight and nothing comes apart: the settling is low-frequency and
  whole (`inn_kit.py`), and the floors, the doorway and every collider stay square.
- **The grounds** (`src/sim/content/mirefen_tavern_grounds.ts`, `inn_grounds.py`): the cobbled
  forecourt (drawn over the terrain, never a walk surface: `groundHeight` is untouched), the terrace
  (three trestle tables, benches that seat two each facing their table, lantern strings on posts
  and a pictures-only chalkboard menu by the door), casks and crates at the right corner,
  the open stable west of the hall (its walls, partition and posts collide:
  `src/sim/mirefen_tavern_grounds.ts`), its trough, hay and a parked cart, a woodpile under a lean-to
  by the chimney, and a dog asleep on the porch. Every piece stands on the terrain (`baseY`, pinned by
  `tests/mirefen_tavern_grounds.test.ts`) and collides; the scatter and the grass keep off the grounds
  (`mirefenTavernGroundsCovers`, `tavernGroundsRects`), which removes the odd scatter tree or rock
  that stood where the terrace and the stable now are.
- **Life.** The dog is its own part (`TavernDog`) and breathes round where it lies
  (`src/render/mirefen_tavern_dog_core.ts`); the chimney and the hearth's flue smoke from medium
  effects up (`src/render/mirefen_tavern_smoke.ts` over `mirefen_tavern_smoke_core.ts`: Lambert
  billboards lit by the sun and sky, built at world build, their program in the props prewarm);
  two terrace lights join the fire-light budget (`TAVERN_TERRACE_LIGHTS`); and a muffled room bed of
  talk and a little music spills out of the door (`src/game/tavern_ambience_core.ts`,
  `amb_tavern`), clear inside, fading over 30 yards outside.

## How it works

- **Floor.** `src/sim/mirefen_tavern_floor.ts` answers ONE absolute walk height per point over
  the footprint, folded into `groundHeight` by `src/sim/walk_lifts.ts` as a max (the Forgefather
  stair idiom): level, one ramped step down into the hearth pit, half a yard up onto the bar
  platform and the stage (each ramped at its open edges), level in the nook and the closed wing.
  There is no upper floor anywhere (`tests/mirefen_tavern.test.ts` "has no upper floor"). The
  terrain the renderer draws (`terrainHeight`) is untouched; the building stands on a stone base
  over it. Only the `groundHeight` samples on the tavern's floor are pinned in
  `tests/fixtures/terrain_height_parity.v1.f64le.gz`.
- **Colliders.** `src/sim/mirefen_tavern.ts` `mirefenTavernColliders`, joined to the static grid
  through `src/sim/built_structure_colliders.ts` (built-in world only): full-height walls minus
  the front doorway and the nook's arch (the back wall runs on over the kitchen hatch, so it is
  no way through), a ring of boxes for the tower, the porch parapets, and the furniture
  (standable) and what stands at full height (the hearth, the wall fireplace, the barrel racks,
  the bar's pillar).
- **Rest area.** The inn rule (`src/sim/progression/xp.ts` `isResting`) through
  `tavernRestsAt`: anywhere inside (the hall and the nook), out of combat. Both worlds read it
  as `IWorld.resting` (derived from the player's own position and combat flag, no wire field),
  and the player portrait's zZz says so (`src/ui/rest_indicator.ts`, `hudChrome.rest.restArea`).
- **Innkeeper.** `MIREFEN_TAVERN_NPCS`, spawned under the reserved `TAVERN_KEEPER_ENTITY_ID` by
  `src/sim/built_world_keepers.ts` (no sequential id moves), her calm pad skipped
  (`src/sim/terrain_calm_anchors.ts`) because she stands on the tavern's floor. She stands
  behind the long counter, before the kitchen hatch, and sells bread and water for the road and
  the marsh's own fare (existing records Fenbridge's provisioner and the starter vendors stock;
  pinned by `tests/mirefen_tavern.test.ts` "the innkeeper"). There is no hearthstone in this
  game, so an innkeeper has no bind service.
- **Seats.** Every place a body can sit is a `SeatAnchor` (`src/sim/seat_anchor.ts`) derived
  from the furniture in `src/sim/content/mirefen_tavern_seats.ts`: the hearth's and the nook's
  benches, the long table's benches, the booths' settles and the fire's settle, the chairs,
  the stools, the bar stools and the porch bench. Each names its anchor on the seat surface,
  the seat's height and floor, its facing (the hearth, the tower's middle, its table, the
  counter, the road), a collision-free STAND spot where the seated body stands, an optional
  `via` point the drawn body walks in through (a booth's inner place), and a click box. The sit
  command (`src/sim/seating.ts`, `IWorld.sitOnSeat`, wire `sit_seat`) re-checks everything on
  the server; occupancy is derived from who sits on a stand spot, so two bodies never share a
  seat and every stand-up path frees it. Plain wooden seats stand at `SEAT_CHAIR_HEIGHT` over
  their floor (a cushion gives under the body to it), the bar stools at `SEAT_HIGH_HEIGHT`, the
  heights the chair clips were authored for (`tests/seating.test.ts`).
- **Patrons.** `src/sim/content/mirefen_tavern_patrons.ts`: the regulars, spawned seated under
  reserved ids (`src/sim/mirefen_tavern_patrons.ts`), each holding its seat like a player
  would: two chatting side by side on the hearth's far bench, a drover at the bar, a mapmaker
  in the window booth. Friendly, a short word each, no quests or stock. Their names are
  original and were checked against the major game wikis and this repo before shipping
  (exact-phrase and surname-token searches): Amos Eelby, Grissel Sedgeworth, Ned Oxley and
  Hester Quillby are clear; the rejected candidates collided with an NPC already in this
  game (Tobin, Wick, Nell, Cobb, Petra) or with another game ("Brackwater" is a Guild Wars 2
  village and a World of Warcraft gear prefix).
- **Scatter and grass** keep off the footprint (`src/sim/decoration_exclusions.ts`,
  `src/render/foliage_core.ts` `mirefenTavernGrassExclusions`); rain stops falling on a player
  inside (`src/render/precip_shelter.ts`).

## On screen

- **Model.** One Blender-built GLB, `public/models/props/mirefen_tavern.glb`, from the sim's own
  layout (`scripts/assets/mirefen_tavern/layout.ts` writes `layout.json`; `build_tavern.py` raises
  it with its builders: `inn_hall.py` the hall's four walls, `inn_roof.py` its roof,
  `inn_tower.py` the nook's tower, `inn_wing.py` the kitchen wing, `inn_porch.py` the porch, its
  awning and the sign, `inn_interior.py` the floors, hearth, hood, bar, stage, trusses and
  kitchen, `inn_props.py` what hangs on the walls inside, `inn_furnish.py` the furniture,
  `inn_lights.py` the lights, `inn_grounds.py` the grounds and `tavern_dog.py` the dog, all on the
  hand-built kit `inn_kit.py`; `build.mjs` validates, fingerprints and compresses it). It can be
  raised wall by wall in a live Blender session too (`build_tavern.preview`). Vertex-coloured, and
  painted like the town's painted buildings: each face wears one of the painted town's
  hand-painted tiling maps in the Fenrire look the painted Fenbridge buildings beside it wear
  (`tavern_texture.py`, `textures.json`, `tex/`: the Fenrire maps, the stone, oak and slates
  lifted to draw as Fenbridge's do), at the town kit's repeat at the scale Fenbridge stands its
  inn, laid once per smooth sheet (`tavern_texture.lay_sheet`: the faces of one solid and
  material that meet smoothly wear one projection, so a wall's faces share their plane's across
  parts and solids, the tower's drum and hat are laid round, and timber runs along its grain), so
  the map runs on across every bow and joint with no cut. Indoors the rubble wears the plain
  dressed stone instead (the wall fire's breast, the nook's drum, the kitchen's range:
  `build_tavern.plain_stone_inside`), so the moss stays on the walls the weather reaches. The
  furniture wears the frame's oak
  under a strong warm tint, so indoors its moss reads as an amber grain. A level floor's boards
  run along the hall (x) whatever the floor's outline. The metal, the glow and the plain material
  (glass, candles, food, greenery, the dog) stay untextured. The vertex colour stays the
  multiplier: on a painted face it is the builder's tint over the map (eased toward the map's own
  value, so the paint carries the material and a tint only nudges it). The room's dressing is
  some forty real models with their own painted textures (`inn_props.py`; the lights hang theirs,
  `inn_lights.py`, the tables, racks and stage set theirs, `inn_furnish.py`, the hearth's hood is
  `inn_interior.py`'s and the sign's giant tankard `inn_porch.py`'s), made the way the art lead
  made the stag's head over the door: front, side and back views of each painted in the stag's
  style (ChatGPT's image generation, not checked in), built from them
  in Tripo Studio (P2, multi-view image to 3D, Smart Mesh, about two thousand quads) with the
  same views as its texture reference, and three of the game's own shields. Tripo's dense model
  cannot be simplified to its budget in place (its texture's seams hold its edges, and a
  simplifier let across them smears the paint), so `props/bake_low.py` brings each down the way
  a painted game prop is made: welded, decimated to its triangles (`props/props.json`, a few
  hundred), unwrapped afresh and its paint baked onto the new surface (Cycles). The Tripo exports
  and the pieces baked from them are a maintainer-local source pack
  (`tmp/asset_src/mirefen_tavern_props/`, gitignored like every raw pack); what is checked in is
  what the packer makes of them, which `tests/mirefen_tavern_asset.test.ts` pins to `props.json`.
  Then `props/build_atlas.mjs` packs their maps into one atlas, a 512 tile apiece (`TavernProps`,
  `textures.json` `scale`: 2048 by 5120 at the full tier); their candles are unlit in the paint and
  every wick wears a glowing flame standing on it (`inn_props.WICKS`, each wick measured off its
  model's own corners; `inn_furnish.light_wicks`). The warm light of the fires, lanterns, sconces
  and table candles is baked into the inside's vertex colours on top of that (`bake_warm_light`;
  the textured props take only a touch of it, their paint carrying its own light and shade),
  because the runtime shares its few point lights with
  the whole world. A painted face's colour is stored under a headroom (`textures.json`
  `headroom`), so that light can lift the paint above the map itself as it lifted the old palette;
  each painted material's extras name the linear factor the runtime multiplies it back by
  (`vertexColourScale`, read by `src/render/vertex_colour_glb_parts.ts`). Like the painted
  buildings it ships in three texture tiers, `mirefen_tavern.glb` and its `.half.glb` and
  `.quarter.glb` twins (the same model with every map at half and a quarter of its size, KTX2),
  and the painter loads the file of the profile's texture tier (`placed_texture_tier_core.ts`).
  The floor is whole: every spot a player may stand carries a drawn floor at the walk height
  (`tests/mirefen_tavern_floor_coverage.test.ts`).
- **Painter.** `src/render/mirefen_tavern.ts` over the pure core
  `src/render/mirefen_tavern_core.ts`: the walls, roofs, porch and the bar's pillar are separate
  shell parts. The front wall is three parts (the door's bay with its posts and the cross gable
  over it, and either side of it) and the porch awning with the tankard sign a fourth, so a camera
  behind any one ghosts it alone, never the whole front; a sight line through the open doorway
  crosses no part at all. Outdoors a part that hides the player ghosts and the chase camera never
  pulls in.
- **Indoor camera.** Indoors the camera stays in the tavern's air: the common room (up to
  `TAVERN_HALL_AIR_TOP`, a yard and more under the hammer beams, stepping round the barrel racks
  and the fireplace's breast), the doorway, the arch and the nook's round shaft are registered
  as boxes (`src/render/mirefen_tavern_interior_core.ts`) with the generic indoor camera clamp
  (`src/render/interior_camera.ts` over `src/render/interior_camera_core.ts`). It pulls the drawn
  camera in along its ray to just inside a wall or ceiling (a near-plane pad clear), gliding
  both ways. The tavern opts into `preserve-angle`: inside the room, collisions shorten the
  distance without choosing a different yaw or pitch. Other interiors retain adaptive framing.
  Walking in, the camera follows through the door: past the doorway's threshold the lens comes
  down, keeping its distance behind the player, until it is no higher over the eye than the
  door's head allows (`interiorEntryCap`), so its sight line threads the doorway while it is
  still outside; a ray out through the door runs on past it, so the lens keeps its whole
  distance and nothing between it and the player is cut; once the requested lens has come in
  through the door the cap lets go gently, avoiding a simultaneous height/zoom jerk against
  the ceiling. If the player stops just inside, the lens comes in to the
  room a moment later. The lens only ever comes down on the way in (never the old high
  dollhouse view, never a dive into the head: `tests/mirefen_tavern_interior_core.test.ts`
  "walking in and out through the front door", at the default, a steep far and a low close
  camera). It is the one authored-interior exception to the pinned no-pull-in rule
  (`tests/graphics_overhaul_integration.test.ts`: a player on the porch or in the doorway's
  thickness keeps the camera to the bit); the requested distance is never written. The bar's
  pillar stands in the air, so it cuts away when it stands between the lens and the player or
  hard by the lens. Where the boom is cramped, it stays on the requested ray. The close avatar
  hides with hysteresis without jumping the lens to the eyes. Regression coverage lives in
  `tests/mirefen_tavern_camera_stability.test.ts`, including 30/60/144 FPS wall approaches.
  While the player is inside, the plates of bodies outside draw only when seen through the front
  door (the nameplate painter's `interiorHidesNameplate` gate: the camera's sight line, or the
  player's eye while the lens still follows through the door); a selected target keeps its unit
  frame.
- **Tiers.** Everything walkable or solid, the whole shell and every light on every preset; the
  trim from medium, the clutter from high (`mirefenTavernParts`).
- **Fires and lights.** The round hearth and the wall fireplace burn with the campfires' live
  flame (`MIREFEN_TAVERN_FLAMES`, built in `src/render/props.ts`), lit by the fire-light budget
  with the chandelier, the lit lanterns on their arms off the gable walls, the stage's footlights,
  the bar's candles and the nook's crown (`mirefenTavernLights`). The model's firebox is only a
  shallow soot panel in the breast's face, so the wall fire stands in the mouth: its flames,
  logs, bed of embers and a flickering glow on the soot and the hearthstone
  (`src/render/mirefen_tavern_wall_fire_core.ts` lays them out in front of the panel,
  `mirefen_tavern_wall_fire.ts` draws them in the model's own materials; the render test checks
  the flames are in view from the room).

- **Sitting.** A right-click (or a left-click) on a seat the camera can see walks the body to
  its stand spot and sits it (`src/game/seat_interact.ts`, the ornate chair cursor on hover).
  The drawn body walks in (through the `via` point), turns and sits with the authored chair
  clips (`sit_anims.glb`: sit-down, idle, stand-up, a relaxed lean against a high back, a
  conversation, a drink, and the bar stool's own three), eats and drinks in the chair, and gets
  up again at the seat (`src/render/seated_pose.ts`, `src/render/CLAUDE.md` "Sitting on
  furniture").

## Rebuilding the model

```
npx tsx scripts/assets/mirefen_tavern/layout.ts
blender --background --factory-startup --python scripts/assets/mirefen_tavern/props/bake_low.py
node scripts/assets/mirefen_tavern/props/build_atlas.mjs
blender --background --python scripts/assets/mirefen_tavern/build_tavern.py
KTX_BIN="C:\Program Files\KTX-Software\bin" node scripts/assets/mirefen_tavern/build.mjs
node scripts/build_media_manifest.mjs generate
```

`build.mjs` writes all three texture tiers and needs the `ktx` tool of KTX-Software 4.3 or later
on PATH (or its `bin` folder in `KTX_BIN`). Then re-pin the sizes, hashes and per-part triangles
in `tests/mirefen_tavern_asset.test.ts`. `bake_low.py` bakes only the props whose Tripo model
is newer than their baked piece (name ids to bake those again). The
owner's review scene (terrain, player figures, a roof-off copy, warm lights, cameras) comes from
the same build with `-- --save FILE.blend --context TERRAIN.json` (`tavern_scene.py`), and
`open_tavern.py` frames it; `scripts/mirefen_tavern_shot.mjs` captures the in-game views (and,
with `WALKS=1`, the walks in and out through the front door).
