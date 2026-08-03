# HUD domain: battleground (Thornhollow Fields)

The Thornhollow Fields 5v5 capture-the-flag HUD surface behind the `index.ts` barrel:

- `battleground_window_view.ts`: the queue panel's pure core (standing, the
  queue/leave affordance, the all-time board). Its PAINTER lives in the merged
  PvP window (`src/ui/arena_window.ts`, root #arena-window, keybind G):
  Thornhollow Fields is that window's primary tab (`src/ui/pvp_tabs_view.ts` decides
  the strip), and the all-time board is fetched best-effort from
  `GET /api/battleground/leaderboard`. There is no separate battleground
  window, launcher, or keybind anymore; `hud.toggleBattleground()` deep-opens
  the merged window on the Thornhollow Fields tab.
- `battleground_scoreboard_view.ts` + `battleground_scoreboard_painter.ts`: the
  in-match strip (#bg-scoreboard, self-mounted) plus the wave-respawn overlay
  (#bg-respawn) and spawn-protection line (#bg-protected). The `ValeCupHud`
  shape: structural sig gates the skeleton; every per-second value rides the
  PainterHost elided writers.

- `battleground_map_view.ts` + `battleground_map_painter.ts`: the M-key world
  map's Thornhollow surface. The view is the HONEST marker model (self plus
  same-team mates, static flag stands and rune pads; never enemies, never live
  flag positions). The painter owns the ATLAS PLATE: the static half of the
  surface, rasterized once per (canvas size, team orientation, i18n revision)
  into an offscreen canvas and blitted, in the same hand-drawn atlas language
  `src/ui/map_terrain.ts` paints the overworld in. Its per-pixel work is the
  pure core `src/ui/bg_field_relief_core.ts` (`paintBgFieldAtlas`, sharing the
  hypsometric ramp and the pixel convention with the minimap's cheaper
  `paintBgFieldRelief`); its drawn marks and label anchors are
  `battleground_atlas_view.ts`. The plate is built in the VIEWING orientation,
  never built once and rotated: a rotated raster carries the northwest light
  around with it and stands the labels on their heads.

Rules that bind here: the pure cores are registered in `UI_PURE_CORES`
(tests/architecture.test.ts) and stay DOM/i18n-free; flag states and the
carrier marker are ACTIONABLE information and are never tier-gated (the
graphics-settings fairness invariant); one-shot juice (banners, audio) rides
the bg SimEvents in `hud.handleEvents`, never these models.
