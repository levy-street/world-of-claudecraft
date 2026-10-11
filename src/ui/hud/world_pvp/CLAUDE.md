# src/ui/hud/world_pvp - the World PvP tab of the merged PvP window

The `/pvp` flag's HUD surface: the fourth tab of the window on `G`
(`src/ui/arena_window.ts` composes it beside Thornhollow Fields and the two
ranked brackets). Same recipe as `src/ui/hud/battleground/`: one pure view
core plus one thin painter, behind this barrel.

- `world_pvp_window_view.ts`: the pure core (registered in `UI_PURE_CORES`).
  Turns `IWorld.worldPvpInfo` + the honor balance + the window's confirm-step
  flag into ids and numbers: the status (up / down / disarming with the
  remaining clock), the ground under the player (`zone`) and whether the realm
  runs World PvP at all (`realmEnabled`), the one action the panel offers
  (`enable`, `disable`, `keepUp`, `locked`, `realmOff`), the resolved stakes
  (`WORLD_PVP_STAKES`, read from `src/sim/pvp/world_pvp_rules.ts` so a retune
  never strands the copy, the repeat ladder through `worldPvpPairMultiplier`),
  and the render-skip signature, which carries the zone and the realm switch so
  a border crossing repaints. DOM-free, i18n-free.
  `realmOff` outranks every other action arm: the sim refuses a raise, restores
  no saved flag and auto-raises nobody on a realm whose kill switch is set, so
  the flag is always down there and the only honest button is a disabled one.
- `world_pvp_panel_controller.ts`: the painter (the `_controller` suffix files it as a cold window painter
  in the `tests/hud_perf_budget.test.ts` sweep, never a per-frame one). Localizes the
  view through `hudChrome.worldPvp.*` (plus `hudChrome.warfare.balance` for the
  honor row), formats the countdown through `clock_seconds_core.ts` and the
  percent through `formatNumber`, stamps focus keys on the action buttons so
  the once-a-second countdown rebuild hands keyboard focus back (the window
  restores through `focus_restore.ts`), and wires the buttons back through
  `IWorld.setWorldPvpFlag`. The raise is a two-step confirm (the flag exposes
  the player to a gold stake); the confirm flag itself is window state, so
  `openTab`, a strip click and `close` all clear it. The status card carries two
  lines: the flag sentence (free-for-all ground gets its own, because the
  generic one promises an immunity that ground denies) and the ground line,
  whose `.wpvp-zone` tone reads hostile on free-for-all and muted elsewhere. A
  realm with the kill switch set drops the ground line (no policy is live) and
  states the reason once, under the disabled button where the level requirement
  goes; it offers no chat hint, because `/pvp` is refused there too.
- The other player's flag is never read here: it rides `Entity.pvpFlag` and is
  the nameplate / target-frame / auto-attack gate's business
  (`src/sim/pvp/world_pvp_rules.ts` `worldPvpPairHostile`).

Cover changes in `tests/world_pvp_view.test.ts` (the core and the markup) and
`tests/pvp_tabs_view.test.ts` (the tab never pins or locks).
