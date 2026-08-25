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
  `*_window.ts` does (defined in `src/ui/CLAUDE.md`): no forced-reflow layout read and no
  repeating driver of its own, beyond a documented, counted allowance. WHICH modules hold an
  allowance is never listed here: the authoritative registry is `COLD_PAINTER_ALLOWANCES` in
  that test, where every entry carries its own rationale comment and a granted driver's
  `drivers` entry declares what ONE TICK may do, counted over everything the tick reaches.
  Renaming between the adapter names sheds nothing, which is the point: name by role.
- Domain tests import the owning module directly and assert behavior, not source
  line placement.

## The Shardpike bar and prompt (`shardpike/`)
The world-boss trial's whole input surface: three verbs, a balance beam, and one loud
centre-screen instruction. Two contracts are load-bearing and both came from bugs:
- **A WINDOW is not a COOLDOWN.** `ShardpikeButtonState` carries `cooldownSeconds` (the
  action is unavailable, drawn as a dim tile with a number on a dark backdrop) and
  `windowFrac` (the action is LIVE and this is how long that lasts, drawn as a bright
  conic-gradient arc draining on the border, art undimmed). The thrust's five-second
  window shipped on the cooldown field, so the one moment the fight wants a press looked
  exactly like "you cannot press this" and players let it expire. Never merge them.
- **Disabled is dimmed, not extinguished.** Only one verb of the three is available at a
  time, so a heavy grey-out made the bar read as broken rather than as not-yet. A player
  has to see what the pike CAN do while it is not doing it.
- **The hover card answers "why can't I", not just "what is this".** Because only one verb
  is ever live, a player's first read of the row is dim tiles, so `shardpike_tooltip.ts`
  appends a red reason line to the mechanic prose whenever a verb is disabled, worded the
  way the sim's own refusal is. It carries no clock: `attachTooltip` resolves its thunk once
  when the pointer arrives and caches the measured box on the stated premise that the
  content cannot change until the next show, so a countdown would freeze there while the
  digit on the icon kept ticking. Static prose in the card, live numbers on the tile.
The prompt (`shardpike_prompt_view.ts`) is a strict priority ladder, and the ORDER is the
design: almost every state is true at once in a real fight, so which one wins is the whole
difference between teaching the mechanic and adding noise.
