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
| `raid_atlas_minimap_core.ts` | The minimap's pure decisions: the page crop round the player, the detail tile, room names by zoom, the idle-skip key. |
| `raid_atlas_minimap_painter.ts` | The page on the round minimap: plate (or one detail tile) blit, burnt rim, glyphs at minimap size, the live marks (mobs, aggro, loot, gates). |
| `raid_atlas_boss_core.ts` | The boss pins as data: each medallion's faces (a council is one pin with both), the bust URLs, the tooltip model, the hit test through the live camera, the card's placement. |
| `raid_atlas_portraits.ts` | The bosses' busts loaded once per session (and a once-made grey copy for a defeated boss); `version` moves on each load. |
| `raid_atlas_portrait_glyph.ts` | The portrait medallion (face in a gilded rim, per state, partner medallion) and the hover halo; the crest medallion stands in until a face lands. |
| `raid_atlas_boss_card.ts` | DOM: one boss card (faces, name, subtitle, state, lore; keyed fill, size measured per fill), shared by the map's pins and the minimap's card. |
| `raid_atlas_minimap_card.ts` | DOM: the minimap's boss card for touch (a tap on a medallion opens it beside the minimap, any other tap closes it); geometry read once per tap. |
| `raid_atlas_boss_pins.ts` | DOM: the boss card (hover, tap, focus) that follows its pin each paint, and one keyboard focus stop per boss. |
| `raid_atlas_shared_marks_core.ts` | The group's shared marks as data: wire page index to floor, the edit right (the sim's `canEditSharedMapMarks`), the hit test, the paint key. |
| `raid_atlas_shared_marks.ts` | DOM: the shared-marks tool button and its panel (the eight raid-marker symbols, clear all, who sees them or why you cannot set them). |
| `raid_atlas_controller.ts` | DOM adapter: its own DPR canvas, chrome, input, wrapped storage; drives the minimap paint. |

## Contracts
- The projection mirrors the dungeon map and minimap (+x left, +z up). Keep them in step.
- No literal colour in TS: every colour is a token in `src/styles/tokens.css`.
- The map window's own canvas hides while `#map-window.raid-atlas-on`; CSS lives in the
  `raid atlas` section of `components.css`.
- Two mark layers, never merged: the player's PINS are client-side only (per character
  and raid, teardrops in six icons and colours), while the group's SHARED marks are the
  raid world markers (the eight target-marker symbols on a dark gilded token), read
  through `IWorld.sharedMapMarks` and placed through `placeSharedMapMark` /
  `clearSharedMapMarks`. The sim owns every rule (`src/sim/social/shared_map_marks.ts`:
  solo and party members edit, a raid only its leader; one mark per symbol per instance
  claim; bounds, rate window, cleared on disband or a freed claim); the atlas only hides
  the controls a player may not use. A mark's page is the floor's index in `plan.floors`.
- A new raid joins by giving `raidAtlasPlanFor` its plan (pages, rooms, bosses, pois) and,
  if its encounters do not use the heart seal, its own boss-state source in the view.
- The minimap never re-renders the page per paint: it crops the floor's plate, and only once
  the player has stood still at a zoom the plate is too coarse for does it render ONE detail
  tile (a few minimap diameters, device density). An unchanged paint is skipped
  (`raidAtlasMinimapKey`); an engaged boss's pulse disables the skip. Every mark the plain
  dungeon minimap showed (mobs, aggro, loot, shut gates, the raid) stays on the atlas minimap.
- Boss portraits are busts of each boss's REAL model, baked by
  `scripts/raid_atlas/render_boss_portraits.mjs` into `public/ui/raid-atlas/<mobId>.webp` (the
  mob portrait job builder resolves model, clip and tint; only the bust framing is authored
  there). A re-skinned boss: re-run it. A new boss needs a FRAMING row (the test pins it).
- The boss card is the atlas's own (parchment, inside the chrome), not the shared #tooltip:
  the map owns its input and the card must follow its pin through zoom and pan. The game
  claims Tab, so the map walks its own focus ring (the map, each boss, back to the map).
- Touch has no hover: a tap on a boss medallion opens its card, on the map AND on the
  minimap (`InteriorMapController.minimapTap`, reached from the minimap's own tap binder;
  a mouse click on the minimap keeps opening the map). A tap anywhere else closes it.
- Counters with a number in them go through `tPlural` (the cartouche's boss total).
- Tests: `tests/raid_atlas_boss.test.ts`, `tests/raid_atlas.test.ts`, `tests/raid_atlas_minimap.test.ts`, and the routing in
  `tests/interior_map_controller.test.ts`.
