# CC Studio update, 7 September 2026

This snapshot is the build running on SPACEY's machine at the time of publishing. It carries everything since the draw distance snapshot of 31 August.

## The Deepglass is now a published map

SPACEY's edited Deepglass ships as a Studio published map. `data/maps/deepglass.map.json` is the editable document, `src/sim/maps/deepglass.generated.ts` is what the game boots, and the registry lists it under the slug `deepglass`. The game prefers a published map with that slug over the code built arena, so `?map=deepglass` and Baldemar's portal both load SPACEY's version.

Studio changes that go with it:

- Publish to Game and Remove from Game moved into the More menu, and the button is enabled from Studio start on the dev server. It used to hide on the most recent save boot path.
- Open, Shipped Maps lists every published map. A publish under a shipped map's own slug replaces that row, so The Deepglass row opens the published document and reads "Arena, your published version".
- Two dev server endpoints back this: `/__studio_map/published` lists the maps, `/__studio_map/doc?slug=` returns one document.

## Tidehold buildings

- Castle, hall and bank walls use a tiled 2K grey stone with a normal map, with per panel variation (mirrored, flipped and course shifted tiles) and baked vertex colour weathering: damp plinths, broad tone patches and lighter upper storeys.
- Brass string courses match the Warden wall brass (real metalness, studs every 0.72 kit units). Window frames and door arches are dark bronze.
- The hall roof is a full A frame with a gable at each end. The throne faces the entrance and the benches face their tables.
- The bank is rebuilt as a medieval shop: an L plan with a cross gabled front wing, stone ground floor, plaster and timber upper storey, an awning over the shop window, a vault behind a portcullis and a counting room upstairs.
- The castle gallery balustrade is a dark solid material.
- The smithy front door collision, lintel, door leaf and walkable threshold line up with the real centred opening.
- Every building ships a parts twin (`<name>.parts.glb`) so Studio can split it into kit pieces: select a building and press Edit pieces (N) in the Selection panel. Each piece becomes its own placement to move, rotate, scale or delete. One undo puts the building back. Pieces are also placeable on their own from the browser under Tidehold Parts.

## Deepglass city

- The spire towers keep their baked atlas stone. The Warden tower, wall and pillar ship at 2048 textures.
- City steps wear the Warden Cobbles at the street paint's 6 yard repeat.
- The Mirefen impact crater no longer leaks into authored maps: its rocks, light, scorch tint and terrain bowl are built in world only.
- Exploration music in the city is Sunken Coral Sanctuary again, as the venue grounds cue. The match cue runs from whistle to horn and a boss fight outranks both.

## Engine and Studio

- Placed asset colliders seat on terrain height, so upper floors and stairs work on decks.
- Studio terrain sculpts persist: the zone build workers now clone content on generation change.
- The GLB loader accepts `file.glb#node:<name>` and `file.glb#group:<prefix>` to address part of a model.
- Studio Selection panel gains Edit pieces. Tests: `tests/editor_prefab_pieces_core.test.ts`, `tests/active_content_touch.test.ts`.

## Rebuilding the buildings

The Blender chain lives in `scripts/assets/blender_tidehold`. Build a building script through the Blender bridge, then run `tmp/tidehold/_install_tidehold_buildings2.mjs <names>`, `tmp/tidehold/_merge_tidehold_collision2.mjs <names>`, `scripts/gen_collision_overrides.mjs`, `scripts/gen_prefab_pieces.mjs`, `scripts/gen_asset_catalog.mjs`, `scripts/build_media_manifest.mjs generate` and `scripts/assets/bake_collision.mjs`. The install scripts under `tmp/` are not tracked, so ask SPACEY for them if you need to rebuild.
