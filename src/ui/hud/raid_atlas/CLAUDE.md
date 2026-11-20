# The raid atlas (`src/ui/hud/raid_atlas/`)

A raid's illustrated M-map (pilot: the Smith's Heart), drawn in the world map
window in place of the plain dungeon floor plan. `InteriorMapController` routes
the instance-plan paint here (`show`), forwards the HUD's frame tick (`tick`) and
adds the player's pins to the dungeon minimap; Hud knows none of it.

## Shape
| Module | Role |
|---|---|
| `raid_atlas_plan_core.ts` | Pages, rooms, bosses, portals: derived from the raid's content (`smith_heart_layout.ts`, `smith_heart.ts`) and the field's painted plan (`field_map_view.ts`). Never re-author a position here: read it. |
| `raid_atlas_camera_core.ts` | Zoom and pan as pure state (cursor-centred zoom, clamps, the eased glide). |
| `raid_atlas_pins_core.ts` | The player's pins: edits, cap, hit test, defensive parse of stored text. |
| `raid_atlas_view.ts` | The live frame from IWorld: player, raid, boss states (own body first, then the heart seal markers). |
| `raid_atlas_palette_core.ts` | Token roles (`--color-raid-atlas-*`) and the art's deterministic hash. |
| `raid_atlas_page_painter.ts` | The illustrated page (text-free vector art under one transform: plate or sharp view). |
| `raid_atlas_glyph_painter.ts` | Arrow, medallions, pins, portals, rose, frame, cartouche (vector, screen size). |
| `raid_atlas_painter.ts` | Composition: cached page + marks layer, cached frame layer, live layer per frame. |
| `raid_atlas_controller.ts` | DOM adapter: its own DPR canvas, chrome, input, wrapped storage. |

## Contracts
- The projection mirrors the dungeon map and minimap (+x left, +z up). Keep them in step.
- No literal colour in TS: every colour is a token in `src/styles/tokens.css`.
- The map window's own canvas hides while `#map-window.raid-atlas-on`; CSS lives in the
  `raid atlas` section of `components.css`.
- Pins are client-side only (per character and raid). There is no shared map-marker
  system in the sim; raid-shared marks would need a server seam first.
- A new raid joins by giving `raidAtlasPlanFor` its plan (pages, rooms, bosses, pois) and,
  if its encounters do not use the heart seal, its own boss-state source in the view.
- Tests: `tests/raid_atlas.test.ts`.
