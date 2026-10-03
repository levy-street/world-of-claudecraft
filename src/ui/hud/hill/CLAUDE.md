# HUD domain: King of the Hill

The bar over the announced or standing hill (`src/sim/pvp/hill.ts`, read
through `IWorld.hillInfo`), behind the `index.ts` barrel:

- `hill_bar_view.ts`: the pure, DOM-free core (registered in `UI_PURE_CORES`).
  `buildHillBarView(info, playerPos)` decides everything: the bar shows only
  while the local player stands in the hill's zone (`info.inZone`); the phase
  (announced or risen) and whether the viewer counts (`standing`: a raid member
  does not, and the bar says so); the holder
  and the challenger from the viewer's seat; the two headcounts the contest is
  decided on (`yours` against the holder's members inside, or the largest
  rival's while the hill is unheld, `hillRivalCount`); the contest clock
  against `HILL_CAPTURE_SECONDS` and its 0..1 fill fraction; the whole-yard
  distance to the circle's edge (`hillEdgeDistance`, 0 inside); the minutes
  until the hill rises or falls; and the structural `sig` (zone, geometry,
  phase, standing, holder, challenger, inside) the painter rebuilds its
  skeleton on.
- `hill_bar_painter.ts`: the thin painter (`HillBar`), a self-mounted
  `#hill-bar` strip in the HUD layer, top centre under the Thornhollow Fields
  scoreboard's slot. While the hill is announced the skeleton has no contest
  rows (the counts and the fill only exist once it has risen); a `.hill-note`
  row always explains ineligibility or warns that entry enables PvP. The pure
  `shouldAnnounceHillPvp(previous, next)` helper detects eligible entry or
  activation while inside; the painter forwards it through `banner` (with
  `hudChrome.hill.pvpBanner`) to the HUD banner. Under-level viewers do not receive the banner; raid members
  do because they are flagged even though they cannot capture. The banner uses
  its own `hudChrome.hill.pvpBanner` key. The announcer's call
  (`HillInfo.callout`, src/sim/pvp/hill_bounty.ts) rides the same view as
  `callout`; the pure `hillCalloutToShow(shownId, view)` picks each call id
  exactly once and the painter forwards `hillCalloutText(call)` through
  the same `banner` dependency to the HUD banner (`hudChrome.hill.callout.*`). ONE innerHTML write per sig
  change; every per-second
  value (the counts, the contest text and fill width, the distance, the
  minutes) rides the `PainterHost` elided writers, so an idle second writes
  nothing; the tone classes (`is-you`, `is-other`, `is-contested`) are
  toggled through the elided class writer and chosen from the union, never
  interpolated from the wire. The state is carried by text as well as colour.
  Cold painter: its allowance is pinned in `tests/hud_perf_budget.test.ts`.
- Copy: `hudChrome.hill.*` in `src/ui/i18n.catalog/hud_chrome.ts`; the zone
  name resolves through `zoneDisplayName`; durations through `durationText`,
  counts through `formatNumber`. The numbers the copy quotes resolve from
  `src/sim/pvp/hill_rules.ts`, never literals.
- The circle itself is drawn by the renderer (`src/render/hill_ring.ts`; still
  and faint while announced); the `/hill` chat readout and the warning, rise,
  five-minute reminder, standings, fall and Weekly Vault announcements come
  from the sim through the matcher (`src/ui/sim_i18n.ts`, `hill.*`).
