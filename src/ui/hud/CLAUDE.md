# Extracted HUD domains

This tree owns cohesive HUD domains extracted from `src/ui/hud.ts`. The root
`src/ui/CLAUDE.md` remains canonical for DOM, accessibility, localization, painter,
and performance rules.

## Shape

- Each domain lives in its own directory and exposes a small public surface from
  `index.ts`.
- Pure decisions stay in `*_view.ts` or `*_core.ts`. DOM and browser adapters stay
  in controllers, windows, or painters.
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
- Domain tests import the owning module directly and assert behavior, not source
  line placement.
