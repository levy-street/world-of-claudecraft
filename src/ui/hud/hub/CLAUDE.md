<!-- src/ui/hud/hub/: the shared window-hub tab group. Don't repeat root /
     src/ui / src/ui/hud CLAUDE.md, reference them. -->

# src/ui/hud/hub/: window hubs (tab groups over existing windows)

The menu consolidation (2026-11-04) folds related windows into one tabbed
window behind one launcher: the Professions hub, the Book of the Realm and
Activities. A hub is a TAB GROUP, not a container: every member window keeps
its own id, root, `.window.panel` class, title bar, mobile full-screen CSS,
focus trap, close routing and drivers. Exactly one member is shown at a time,
and each member paints the one shared strip under its title bar.

## Shape
| File | What it is |
|---|---|
| `window_hub_view.ts` | PURE (`UI_PURE_CORES`). The `WindowHubSpec` a hub is defined by (tabs, default, storage key, aria label, classes, focus prefix) plus every decision: last-tab parse, which tab an open lands on, the toggle rule, the strip model, the focus-carry key, and the position carry across a switch. |
| `window_hub_controller.ts` | Cold DOM half (`UI_DOM_MODULES`, it reads `localStorage`). Applies the decisions to members seen as `{ isOpen, open(), close(), rootElement() }`, read through a THUNK so Hud can build the hub before its windows. `stripFor(tab)` is the `WindowHubStrip` dep a member painter takes. |

## Load-bearing rules
- **A tab switch closes the shown member FIRST**, then opens the next, so
  every member records the same original opener and Escape from any tab
  returns focus where the player started.
- **Members wire the strip BEFORE their focus-restore ladder** on every
  rebuild: `wire()` stamps the `data-focus-key` the ladder looks for.
- **Every opener on Hud goes through the hub at its tab**, never a member's
  own `open()`, or the shown member is not closed first.
- **A new hub is a spec plus member wiring**, never a fork of these two
  files. Per-hub wrappers (`professions_hub_view.ts`) only bind the spec.
- Mobile keeps one More-tray tile per DESTINATION that opens the hub on its
  tab (audit section 3.7): a hub must never add a tap on a phone.
