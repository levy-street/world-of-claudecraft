# src/ui/hud/skull_bag - the World PvP Skull Bag pane

The client half of the Skull Bag (`src/sim/pvp/skull_bag.ts`): a sub-inventory
for trophy skulls. It is not its own window: the bags window (`src/ui/bags_window.ts`)
docks the pane under its grid, and its lifetime follows the bags (closing the
bags closes it). Same recipe as the other HUD domains: a pure view core plus one
cold painter, behind this barrel.

- `skull_bag_view.ts`: the pure core (registered in `UI_PURE_CORES`). Turns
  `IWorld.worldPvpInfo.skullBag` plus the carried bags into per-victim rows
  (most skulls first, unrecorded skulls last), the plain carried skull count
  Store would move, the take action a row button sends, and the render-skip
  signature. DOM-free, i18n-free.
- `skull_bag_pane_controller.ts`: the cold painter (registered in
  `UI_DOM_MODULES`). The bag item's click toggles it (`bags_view.ts` routes the
  Skull Bag's click to `'openSkullBag'`); `mount` is called on every bags
  rebuild and `refreshIfChanged` from the bags window's slow-band refresh, which
  repaints only when the signature moves (a skull looted straight into the bag
  changes nothing in the bags themselves). Every node is built with
  `createElement` + `textContent`, so a victim's name never reaches markup. The
  commands go through `IWorld.skullBagAction`; the sim re-validates every one.
- `skull_bag_tooltip_view.ts`: the item tooltip's Use line, composed by
  `Hud.itemTooltip` beside the elixir, feast and faction-reward lines.

Copy lives under `hudChrome.skullBag.*` (the row name reuses
`hudChrome.worldPvp.skullName`); styles are the `skull bag pane` section of
`src/styles/components.css`. Cover changes in `tests/skull_bag_view.test.ts`.
