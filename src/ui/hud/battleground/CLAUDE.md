# HUD domain: battleground (Thornhollow Fields)

The Thornhollow Fields 5v5 capture-the-flag HUD surface behind the `index.ts` barrel:

- `battleground_window_view.ts`: the queue panel's pure core (standing, the
  queue/leave affordance, the all-time board). Its PAINTER lives in the merged
  PvP window (`src/ui/arena_window.ts`, root #arena-window, keybind G):
  Thornhollow Fields is that window's primary tab (`src/ui/pvp_tabs_view.ts` decides
  the strip), and the all-time board is fetched best-effort from
  `GET /api/battleground/leaderboard`. There is no separate battleground
  window, launcher, or keybind anymore; `hud.toggleBattleground()` deep-opens
  the merged window on the Thornhollow Fields tab. The standing and board show
  a W-L-D record including DRAWS (#3099); every wire row folds `draws ?? 0`, so
  a record stored before the field existed cannot render NaN.
- `bg_end_banner_view.ts`: the copy model for the two across-screen CALLS that
  are not flag plays: the match-end verdict (one big word reusing the
  scoreboard's own `resultVictory`/`resultDefeat`/`resultDraw` keys, over
  secondary lines that each stay their own `t()` key rather than one
  concatenated sentence) and the remaining-time warnings. `hud.handleEvents`
  resolves the copy here and hands it to the banner, so the decision is
  unit-testable without a DOM.
- `battleground_scoreboard_view.ts` + `battleground_scoreboard_painter.ts`: the
  in-match strip (#bg-scoreboard, self-mounted) plus the wave-respawn overlay
  (#bg-respawn), which owns the personal respawn/protection readout. No module
  mints a #bg-protected element anymore (a leftover rule in
  `src/styles/components.css` still names that id; do not build on it). The `ValeCupHud`
  shape: structural sig gates the skeleton; every per-second value rides the
  PainterHost elided writers. The painter is also the SINGLE source of truth for
  whether the expanded board is open: it holds the player's pin, the
  snapshot-derived result-hold expansion (`view.state === 'ended'`, so a player
  who reconnects into the hold still gets the final board) and the
  dismissed-this-result latch behind one elided applier, and it writes
  `aria-expanded` from that same value. The stylesheet deliberately does NOT
  reveal the board on `.ended`: a second, invisible reveal there left the aria
  state lying and made the outside-click dismissal inert.

- `battleground_kill_feed_view.ts` + `battleground_kill_feed_painter.ts`: the
  top-right kill feed. The pure core owns the cap/expiry list rules and returns
  the SAME array when nothing expired, so the per-frame caller elides its
  repaint on reference equality (the frame budget only pays on a death or an
  expiry); the painter owns the DOM and the LOCALIZED line text. A kill call is
  actionable information and is never tier-gated.
- `battleground_proposal_view.ts` + `battleground_proposal_popup.ts`: the
  queue-pop Accept/Decline prompt, deliberately the same component shape as
  `src/ui/dungeon_finder_proposal_popup.ts` (same question asked the same way;
  two queues that prompt differently would read as a bug). It never steals
  keyboard focus (the player may be mid-fight): role=alert, tab-reachable
  buttons. The view is COUNTS ONLY, never names (a decline must not leak who
  was on the other side; the sim promises anonymity and the core has no field
  to break it with). A backfill is a materially different offer (a live match,
  a scoreline the joiner had no part in, no rating either way), so the prompt
  body says so itself rather than relying on the chat line that scrolls away.
  Perf contract: closed it does zero work (it only OPENS from the bgProposed
  SimEvent); open, it rebuilds DOM only when the structural sig changes and
  refreshes the countdown text slot in place.
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
