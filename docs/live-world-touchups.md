# Live world touch-ups

This workflow edits the native integration map without converting its buildings,
services or gameplay tables into a standalone Studio map. The initial branch is
`feature/map-touchup-pipeline`, based on `feature/v045-integration` at
`91e9c7753f2a132e55647455dd4fccfd5edbe6de`. This identifies the Git baseline;
it does not assert which commit a remote production host is running.

The previous whole-map reconciliation remains in draft PR4606 on
`feature/world-map-reconciliation`. It is not part of this pipeline branch.

## Open the current integration map

Use a separate checkout of the pipeline branch, with the repository's pinned pnpm
installation and dependencies. From that checkout:

```sh
npm run dev -- --host 127.0.0.1 --port 5198 --strictPort
```

Open `http://127.0.0.1:5198/editor.html?liveWorld=1`. The banner must say
**Live world**. The ordinary `editor.html` entry remains the standalone map editor.
The normal game at `http://127.0.0.1:5198/` renders the compiled integration map.

The live editor opens the latest checked-in touch-up source. Local saves use the
native baseline and published touch-up revision as their identity, so an old
local draft cannot silently replace a newly published revision. Keep exported
JSON backups of unfinished work before updating branches. If starting a new
standalone map, return to the live-world URL before editing the integration map.

## First supported scope

- Terrain height stamps and vertex edits; biome paint, detail regions, grass
  clearing and decoration exclusion regions.
- Native road edits/removals and added roads.
- The editor's existing movable gameplay objects: farm beds, practice dummies,
  gather nodes and dungeon doors. Their stable IDs are preserved.
- Added props and supplemental buildings from the shipped asset library, including
  their collision settings. These added placements can be moved and deleted. Moving
  a ground-attached prop keeps it attached unless its placement is explicitly
  detached. For added Fenbridge cottages (`tidehold/fenrire/house_a`), terrain
  level pads and foliage exclusion zones are generated automatically from their
  active placement transforms.
- Bounded Fenbridge town layout touch-ups (`fenbridgeTouchup`):
  - The 5 canonical Fenbridge buildings (`fenbridge_warden_gatehouse`,
    `fenbridge_crooked_reed_inn`, `fenbridge_lantern_chapel`,
    `fenbridge_moonwort_apothecary`, `fenbridge_gilded_strongbox`) and 3 native
    civic props (`well_fenbridge_cistern`, `stall_fenbridge_provisions`,
    `fenbridge_muster_board`) carry stable `fenbridgeNativeKey` bindings in the
    live-world editor document (`createLiveWorldEditorMap`).
  - Moving or rotating those native Fenbridge entries in the live editor compiles
    into `WORLD_TOUCHUP.fenbridgeTouchup.buildingMoves` and `civicPropMoves`
    without duplicating native geometry or colliders.
  - One authoritative runtime transform seam (`getActiveFenbridgeLayout()` and
    `getActiveFenbridgeCivicProps()`) updates `FenbridgeTownView` rendering,
    compound and walk-in wall colliders, interior floor bounds, porch/step ramps,
    level terrain pads (`1.2` elevation aprons), and foliage/grass exclusions.
  - Relocated Fenbridge NPC stands round-trip via `fenbridgeNpcMoves` on the
    live-world map document into `WORLD_TOUCHUP.fenbridgeTouchup.npcMoves`,
    updating only horizontal `(x, z)` positions for allowlisted Fenbridge NPCs
    while preserving all NPC IDs, roles, quests, dialogue, and shop inventories.

Other zones' native buildings remain fixed in their existing renderer and collider
systems. The pipeline does not delete native buildings, alter non-Fenbridge NPC/camp/zone
tables, change global water/weather/caves, or ship browser-local uploads and imported
textures. Such edits are rejected on export, not silently dropped. Markers remain
editor annotations. There is no standalone Publish action for a live-world map.

For Mirefen, begin with a small terrain or road change away from an entrance.
Changing ground under a native building can still bury its entrance or expose
its foundation: inspect those approaches in the actual game before accepting it.

## Export, compile and review

1. Use **Export** in the live editor. It downloads a map JSON document. Local
   editor saves alone do not change the normal game.
2. In the same checkout, validate that exported file:

   ```sh
   node scripts/world_touchup.mjs check /path/to/exported-map.json
   ```

3. Write the reviewed source and shared game artifact locally:

   ```sh
   node scripts/world_touchup.mjs export /path/to/exported-map.json
   ```

   This writes `data/world_touchup/current.map.json` and
   `src/sim/world_touchup.generated.ts`. The latter is consumed by the same world
   data module in the offline game, server and online client. Keep both files in
   the same change. Never edit the generated file by hand.

4. Review the reported changed layers and Git diff. Restart the local dev server
   and reload the normal game. Inspect the edited spot and nearby roads,
   entrances, NPCs and services; walk around added or moved props to check their
   collision. Reopen the live editor and confirm the source contains the edit.
5. Run the focused regressions, typecheck and repository QA required for the PR:

   ```sh
   npx vitest run tests/live_world_touchup.test.ts tests/studio_default_world_gate.test.ts
   npx tsc --noEmit
   ```

6. Commit both source and generated artifact for review. Publishing or merging
   a PR and deploying the game remain separate actions; exporting is local only.

The compiler rejects a changed native baseline or touch-up revision. Update the
checkout, reopen the current live source, and reapply/review the small edits.
Do not remove the provenance fields to force an old file through. Re-exporting a
file from before the latest published edit is intentionally rejected.

For an isolated fixture, `export ... --out-dir tmp/my-fixture` writes the two
files under that directory and leaves the checkout's normal game unchanged.
An unchanged baseline export (`createBaselineLiveWorldEditorMap()`) has zero
changed layers. The checked-in `data/world_touchup/current.map.json` and
`src/sim/world_touchup.generated.ts` carry the selective Fenbridge town layout
reconstruction (5 relocated canonical Fenbridge buildings, 2 relocated civic
props, 3 added north `tidehold/fenrire/house_a` cottages, 1 added streetlamp,
12 added Fenbridge foliage trees, 8 Fenbridge farm-bed and gather-node moves,
and 9 Fenbridge NPC horizontal stand moves) without importing whole-map terrain
stamps or altering other zones.

## Validation boundary

The pipeline has focused no-op, terrain, road, gameplay-object, prop-collision,
Fenbridge building/civic/NPC relocation, walk-in doorway, provenance and Node CLI
regression tests. These do not establish visual correctness for every location in
the world. Each authored touch-up still needs a game review. Use a desktop for
this editor handoff; mobile editor operation is unverified.
