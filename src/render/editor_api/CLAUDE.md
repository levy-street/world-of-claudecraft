<!-- src/render/editor_api/: render-local notes only. Root, src and
     src/render CLAUDE.md already apply. -->

# src/render/editor_api/: the map editor's renderer facade

`renderer.editor` (`RendererEditorApi`). Every editor-facing hook lives here,
NOT on the `Renderer` class: the lens switch and editor raycasts, visibility,
authored lighting/weather/skybox/atmosphere, birds, studio mode, the sculpt and
paint rebuilds (`rebuildTerrain`, `rebuildWater`, `rebuildWaterBodies`,
`rebakeTerrainNormals`, `swapPaintLayers`), the brush ring, terrain picks, the
Studio scene layers (fluids, decals, caves), map lights, and the dungeon and
battleground editor modes.

- The facade reaches the renderer's private state only through
  `RendererEditorHost`, a narrow typed host the renderer builds in
  `editorHost()`. Every member reads the live field lazily (the facade is built
  during field initialisation). Views the editor replaces (terrain, far
  terrain, water, birds) are accessor pairs, so the renderer's own field is
  what changes.
- The facade owns the editor-only state the renderer's frame reads back
  (`ambienceScale`, `placedAssetViewDistance`, `zoneResidencyFilter`,
  `visibility`, `mapWeather`, `zoneAtmosphere`, `shadowCache`,
  `dungeonLayoutOverrides`). All of it is inert in the shipped game.
- The fire-light registry never leaves the renderer: the fluid rebuild goes
  through `host.replaceFireLights` (prune + adopt), so the adoption seam pinned
  by `tests/point_light_budget.test.ts` holds.
- A new editor hook lands here (or in an `authored_map/` module it calls),
  never as a new public method on `Renderer`; callers use `renderer.editor.X`.
