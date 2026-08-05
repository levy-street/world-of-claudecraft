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
- `bg_end_banner_view.ts`: the copy model for the two across-screen CALLS that
  are not flag plays: the match-end verdict (one big word reusing the
  scoreboard's own `resultVictory`/`resultDefeat`/`resultDraw` keys, over
  secondary lines that each stay their own `t()` key rather than one
  concatenated sentence) and the remaining-time warnings. `hud.handleEvents`
  resolves the copy here and hands it to the banner, so the decision is
  unit-testable without a DOM.
- `battleground_scoreboard_view.ts` + `battleground_scoreboard_painter.ts`: the
  in-match strip (#bg-scoreboard, self-mounted) plus the wave-respawn overlay
  (#bg-respawn) and spawn-protection line (#bg-protected). The `ValeCupHud`
  shape: structural sig gates the skeleton; every per-second value rides the
  PainterHost elided writers. The painter is also the SINGLE source of truth for
  whether the expanded board is open: it holds the player's pin, the
  snapshot-derived result-hold expansion (`view.state === 'ended'`, so a player
  who reconnects into the hold still gets the final board) and the
  dismissed-this-result latch behind one elided applier, and it writes
  `aria-expanded` from that same value. The stylesheet deliberately does NOT
  reveal the board on `.ended`: a second, invisible reveal there left the aria
  state lying and made the outside-click dismissal inert.

- `battleground_map_view.ts` + `battleground_map_painter.ts`: the M-key world
  map's Thornhollow surface. The view is the HONEST marker model (self plus
  same-team mates and the static flag stands; never enemies, never live flag
  positions, and never rune pads). The painter owns the ATLAS PLATE: the static
  half of the surface, rasterized once per (canvas size, team orientation, i18n revision)
  into an offscreen canvas and blitted, in the same hand-drawn atlas language
  `src/ui/map_terrain.ts` paints the overworld in. Its per-pixel work is the
  pure core `src/ui/bg_field_relief_core.ts` (`paintBgFieldAtlas`); its mark and
  label ANCHORS are the pure core `battleground_atlas_view.ts`. The plate is
  built in the VIEWING orientation, never built once and rotated: a rotated
  raster carries the northwest light around with it and stands the labels on
  their heads.
- `battleground_atlas_marks_painter.ts`: how one atlas mark is DRAWN (a blob
  plus its lit northwest face) plus the mark palette, in one module because the
  MINIMAP's session-cached battleground raster (`src/ui/minimap_painter.ts`
  `ensureBattlegroundBg`) bakes the same marks over the same
  `paintBgFieldAtlas` ground. The two surfaces share both halves of the plate
  art on purpose: one field must not be described two ways. What the minimap
  does NOT bake is the landmark labels (illegible at 2.5px/yd, and its blit is
  a moving sub-rect), and its walls keep the resolved `--color-minimap-outline`
  token rather than the plate's slate-plus-cast-shadow treatment, because walls
  are actionable cover and the plate's treatment is drawn at several times that
  scale.

Rules that bind here: the pure cores are registered in `UI_PURE_CORES`
(tests/architecture.test.ts) and stay DOM/i18n-free; flag states and the
carrier marker are ACTIONABLE information and are never tier-gated (the
graphics-settings fairness invariant); one-shot juice (banners, audio) rides
the bg SimEvents in `hud.handleEvents`, never these models.
