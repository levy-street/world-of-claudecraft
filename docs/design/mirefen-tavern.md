# The Mirefen tavern

A walk-in inn on the Fenbridge road in Mirefen Marsh: the first interior in the open world
built to classic-inn scale for the 2.6 yd player (it reads big when you walk in, and the
furniture reads right next to you). One storey for players, the common room open to a high
hammerbeam roof. Original work for this game: the plan, the model and its texture-free palette
were authored here from a written brief; reference captures of classic inns were studied for
mood and proportion only and never entered the build.

## Where and what

- **Site.** `TAVERN_ORIGIN` in `src/sim/content/mirefen_tavern.ts`, the door facing the road
  (world +x). Clear of the road, the camps, the gather nodes and the quest objects
  (`tests/mirefen_tavern.test.ts` "the site").
- **Plan.** An L: the common room (the hall) with a round hearth one step down in the middle of
  the floor under a copper hood hung high from the ridge; a window booth either side of the
  door; the dice table, the long table and a wall booth down the left side; the bard's raised
  stage in the back left corner with its curtain, footlights and a banner over it; the wall
  fireplace and its settle on the right; the bar on a raised platform in the back right corner
  wrapped round a limestone pillar that carries a beam to the right wall, the barrel racks
  against the back wall either side of the kitchen's serving hatch. A round tower in the inner
  corner opens onto the hall through an arch: a flagged nook with a stone rose, a bench round
  its wall, two small tables, a tapestry and a crown of candles high in its cone. The wing
  behind the hall's right half is the kitchen and cellar, closed; the hatch looks into its
  kitchen (a range, a cook's table, pots and herbs). The rooms the innkeeper lets upstairs
  are never walked. Outside: a front gable with a porch canopy, a giant wooden tankard hung from an iron
  arm as the sign, a river-stone chimney on the side the road from Fenbridge sees, a dark green
  slate roof, the tower's slate hat over it. The front the road sees is dressed
  (`tavern_facade.py`): the sign arm's carved board and scrollwork and a painted board under the
  tankard (a moon and a star, a picture, never words), a caged lantern either side of the door
  (they glow, they cast no light: the point lights stay indoors), the front's five windows
  glazed in the same glowing glass (the lit hall behind them), flowering window boxes under all
  four front windows and slate hoods over the lower two, an ivy up the left corner, hanging
  baskets from the canopy's brackets, carved drops under the bargeboards, and solid
  (`TAVERN_PROPS`): a bench left of the door and three casks right of it on the porch, and a
  stone flower tub either side of the steps' foot on the terrain (`baseY`).
- **Scale.** Every number lives in the content module (`TAVERN_HALL`, `TAVERN_DOOR`,
  `TAVERN_TOWER`, `TAVERN_STAGE`, `TAVERN_HATCH`, `TAVERN_PROPS`) and is pinned against the
  player's height by `tests/mirefen_tavern.test.ts` "scaled for the player".
- **Open to the roof.** No timber crosses the common room under `TAVERN_HALL.truss` (the hammer
  beams' undersides; only the short braces under them dip lower, hugging the side walls): the old gallery, its joists, the aisle posts and the low nook beams are
  gone, and every hung thing (the hood, the chandelier, the lanterns, the tankards on the bar's
  beam) hangs over the camera's air. `tests/mirefen_tavern_asset.test.ts` "keeps the common room
  clear" scans the shipped model for any triangle there.

## Outside: the front and the grounds

- **The jettied front.** From `TAVERN_JETTY.y` up to the gable the front stands `TAVERN_JETTY.out`
  further toward the road than the ground floor (`tavern_jetty.py`): joists whose ends show under a
  moulded bressumer, a carved bracket and a turned drop under each post (none over the door: the
  porch canopy's brackets carry that span), a hand-hewn frame with St Andrew's crosses, four leaded
  windows with shutters and boxes, two small gable windows and the round window. Purely outside:
  the hall's inner wall runs on straight to the roof (the old upper windows keep their inside), no
  upper floor, nothing below the door's head. The front's three shell parts carry it
  (`mirefen_tavern_core.ts` `BOX_VOLUMES` reach out over the jetty), so it ghosts like the wall.
- **Windows, roof, weather.** Every window is leaded in diamond panes with a mullion, a transom and
  planked shutters on strap hinges (`build_tavern.py` `window`); the roof is irregular mossy
  shingles with a bellcast flare, deep eaves and verge (`TAVERN_HALL.eaveOut`, `vergeOut`), ridge
  cappers and four dormers glowing at night (`tavern_roofing.py`); damp tide lines, fallen plaster
  showing brick and moss on the plinth are thin decals on their own wall's part (`tavern_weather.py`).
- **The grounds** (`src/sim/content/mirefen_tavern_grounds.ts`, `tavern_grounds.py`): the cobbled
  forecourt (drawn over the terrain, never a walk surface: `groundHeight` is untouched), the terrace
  (three trestle tables, benches that seat two each facing their table, lantern strings on posts,
  flower tubs and a pictures-only chalkboard menu by the door), casks and crates at the right corner,
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
  layout (`scripts/assets/mirefen_tavern/layout.ts` writes `layout.json`; `build_tavern.py` with
  `tavern_frame.py`, `tavern_shell.py`, `tavern_furnish.py` and `tavern_facade.py` builds it; `build.mjs` validates,
  fingerprints and compresses it). Vertex-coloured, texture-free, five materials. The warm light
  of the fires, lanterns, sconces and table candles is baked into the inside's vertex colours
  (`bake_warm_light`), because the runtime shares its few point lights with the whole world. The
  floor is whole: every spot a player may stand carries a drawn floor at the walk height
  (`tests/mirefen_tavern_floor_coverage.test.ts`).
- **Painter.** `src/render/mirefen_tavern.ts` over the pure core
  `src/render/mirefen_tavern_core.ts`: the walls, roofs, porch and the bar's pillar are separate
  shell parts. The front wall is three parts (the gable over the door with its posts, and
  either side of it) and the porch canopy with the tankard sign a fourth, so a camera behind any
  one ghosts it alone, never the whole front; a sight line through the open doorway crosses no
  part at all. Outdoors a part that hides the player ghosts and the chase camera never pulls in.
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
  with the chandelier, the lit lanterns under the hammer beams, the stage's footlights, the
  bar's candles and the nook's crown (`mirefenTavernLights`). The model's firebox is only a
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
blender --background --python scripts/assets/mirefen_tavern/build_tavern.py
node scripts/assets/mirefen_tavern/build.mjs
node scripts/build_media_manifest.mjs generate
```

Then re-pin the size, hash and per-part triangles in `tests/mirefen_tavern_asset.test.ts`. The
owner's review scene (terrain, player figures, a roof-off copy, warm lights, cameras) comes from
the same build with `-- --save FILE.blend --context TERRAIN.json` (`tavern_scene.py`), and
`open_tavern.py` frames it; `scripts/mirefen_tavern_shot.mjs` captures the in-game views (and,
with `WALKS=1`, the walks in and out through the front door).
