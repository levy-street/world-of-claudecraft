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

## Tap mode is shared, never per menu

`settings.touchTapMenus` replaces every touch gesture menu (the action radial,
the consumables row, the menu strip, the stance radial) with a tap-only flow,
which is what closes
WCAG 2.5.1 for the touch HUD. It must mean the same thing in all of them or it is
not a mode: `tap_menu_core.ts` owns the whole table (open / choose / default /
dismiss, plus the untouched gesture path when the setting is off) and
`tap_menu.ts` owns the three host-reaching halves (the live setting read, which
is CACHED and invalidated on `SETTINGS_CHANGE_EVENT` because it runs at the head
of a combat-critical press; the capture-phase outside-dismiss listener, which is
what keeps the press that OPENED a menu from also closing it; and the registry
`Hud.closeAll` asks so Escape stays with the ONE dispatcher without Hud knowing
any menu by name). A new gesture menu asks those three; it does not grow a fourth
dialect.

What a control's OWN press means is the one per-menu variable, and it is a
PARAMETER of that table (`anchorRole`), never a second table: an `action` control
runs its default action when pressed with its menu open (the radial's centre
slot, the seat's first consumable), while a `toggle` control has no action of its
own (Quick Actions, the stance control), so a bare tap opens its row in EITHER
mode and the next press closes it. A new menu picks a role; it does not fork the
rule. The role reaches the RADIAL's release table the same way it reaches the
strips' (`action_bar/radial_gesture_core.ts`): a parameter, never a second table.

The two STRIP menus go further and share their whole gesture layer:
`strip_gesture_controller.ts` is the one implementation of pointer capture, the
reveal timer, the single anchor measure, the window release backstop, sticky
mode, `aria-expanded` and the Escape closer. The consumables row and the menu
control are thin instantiations of it, parameterized by direction, pitch, count,
release rule and callbacks; they were near-verbatim copies of each other before
the rule of three was reached. The action radial stays separate: its geometry is
a radial rather than a row, and it is keyed per pointer id because combat is
played with two thumbs. It is a SHARED layer too, not a one-off: the stance
control (`stance/`) is a second instantiation of it, supplying only its anchor,
its overlay, what each direction holds and its `anchorRole`.
Every gesture menu writes `aria-expanded` on the ANCHOR it opens from (the
control a screen reader is standing on), never on the overlay.

## Preservation contract

- Keep existing DOM selectors, event order, focus restoration, storage keys, and
  localization keys unchanged during extraction.
- Every player or server value interpolated into HTML passes through `esc()`.
- Hot painters use the shared `PainterHost` writers. Do not create a second write
  cache inside a domain. ONE documented exception: `menu/menu_control_controller.ts`
  mints a private facet when none is injected, because its composition point is
  `MobileControls` (built in `src/main.ts`), which holds no facet to hand down.
  It is safe only because everything it writes is gesture-driven cold chrome over
  STATIC elements, so no cache entry is ever stranded and nothing it writes rides
  a frame band; `quest/quest_strip_controller.ts` deliberately does NOT get that
  exception (it paints on the tracker's medium band) and takes Hud's facet through
  `QuestTrackerController`. A new controller takes the shared facet.
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
