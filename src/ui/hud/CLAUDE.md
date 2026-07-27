# Extracted HUD domains

This tree owns cohesive HUD domains extracted from `src/ui/hud.ts`. The root
`src/ui/CLAUDE.md` remains canonical for DOM, accessibility, localization, painter,
and performance rules.

## Shape

- Each domain lives in its own directory and exposes a small public surface from
  `index.ts`.
- Pure decisions stay in `*_view.ts` or `*_core.ts`. DOM and browser adapters stay
  in controllers, windows, or painters. A controller or window that reads a browser
  global (`document`, `window`, `localStorage`, `getComputedStyle`, `Date.now`) is
  registered in `UI_DOM_MODULES` in `tests/architecture.test.ts`, or the
  classification sweep there fails; a DOM-touching helper that is neither an adapter
  nor a pure core goes in `UI_PAINTER_HELPERS` and takes that list's hard contract.
- Domain modules never import the `Hud` class. They receive narrow dependency bags
  and callbacks from the coordinator.
- `Hud` retains cross-window coordination, the shared writer caches, and the frame
  loop. A domain owns its local state, rendering, persistence, and event handling.

## Preservation contract

- Keep existing DOM selectors, event order, focus restoration, storage keys, and
  localization keys unchanged during extraction.
- Every player or server value interpolated into HTML passes through `esc()`.
- Hot painters use the shared `PainterHost` writers. Do not create a second write
  cache inside a domain.
- All three adapter names above are swept by the painter gate
  (`tests/hud_perf_budget.test.ts`). A `*_controller.ts` holds the same cold contract a
  `*_window.ts` does: no forced-reflow layout read and no repeating driver of its own,
  beyond a documented, counted allowance. Three carry one today
  (`chat_geometry_controller`, `chat_window_controller`, `fiesta_controller`), all of them
  layout reads rather than drivers. The two modules that DO arm a driver are
  `daily_rewards_window` (two polls) and `hud/delve/lockpick_window` (the 100ms countdown),
  and since #2518 a granted driver also declares what ONE TICK may do, counted over everything
  that tick reaches: arming a clock means saying what it repaints and how often. Renaming
  between the adapter names therefore sheds nothing, which is the point: name by role.
- Domain tests import the owning module directly and assert behavior, not source
  line placement.
