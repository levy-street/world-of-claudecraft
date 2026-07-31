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

Rules that bind here: the pure cores are registered in `UI_PURE_CORES`
(tests/architecture.test.ts) and stay DOM/i18n-free; flag states and the
carrier marker are ACTIONABLE information and are never tier-gated (the
graphics-settings fairness invariant); one-shot juice (banners, audio) rides
the bg SimEvents in `hud.handleEvents`, never these models.
