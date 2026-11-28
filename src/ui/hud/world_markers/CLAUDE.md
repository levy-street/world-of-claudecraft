# The raid's world markers in the HUD (`src/ui/hud/world_markers/`)

The eight raid-marker symbols placed on the FLOOR of an instance by clicking the
ground, the classic world-marker flare. They are the very marks the raid atlas
places from the map (`IWorld.sharedMapMarks`, `src/sim/social/shared_map_marks.ts`):
one per symbol, server-authoritative, each a map page point AND a world point on
the floor, so a mark set either way shows on the floor, the map and the minimap.

## Shape
| Module | Role |
|---|---|
| `world_markers_core.ts` | Pure: the button's view and paint key, who may edit (the sim's `canEditSharedMapMarks`), where a ground click lands (`worldMarkerTarget`: page, instance-local point, or null outside the player's copy), what a tile press does, the keybind ids. |
| `world_marker_aim.ts` | The placement aim. It speaks the spell aim's surface, so `Hud.groundAim` routes it and main.ts's mouse, touch, Escape, right-click and pad paths work unchanged. |
| `world_markers_controller.ts` | DOM: the party-column button and the flyout (tiles, clear all, tooltips, long press). Cold: repaints only when the paint key moves. |
| `hud_world_markers.ts` | The factory from the Hud's private members (welded in `tests/world_markers_hud.test.ts`). |

## Contracts
- Placement sends `IWorld.placeSharedWorldMark(page, x, y, z, symbol)` with the clicked
  point and the player's height; the server resolves the floor and every rule. The page
  is the raid atlas floor of the point (`raidAtlasPageAt`), 0 for an instance without one.
- The reticle is the shared ground-aim reticle with `marker` set; the renderer maps the
  symbol to its colour (`src/render/world_markers_core.ts` `WORLD_MARKER_COLORS`).
- The floor drawing is `src/render/world_markers.ts`; this directory never draws 3D.
- Hotkeys `worldMarker1..8` / `worldMarkerClear` are unbound by default. On desktop a
  hotkey places at the cursor on the next frame; on touch and pad it arms for a tap.
- Every string is a `hudChrome.worldMarkers.*` key; the symbols' names are
  `hud.markers.names.*` (`raid_marker_labels_view.ts`).
