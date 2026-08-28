# hud/professions: the one professions interface

The merged professions UI family: crafting, commissions, enchanting, the
profession identity and tutorial surfaces, gathering's professions-window
surface, and farming's windows (plant sheet, harvest journal, farm event
feedback, feast/food tooltips). Minted by the Masterwrought Phase 14
migration (ruling ip-14-UI): the two independently designed families now
live behind one barrel and share one visual language per DESIGN.md.
`src/ui/CLAUDE.md` and `src/ui/hud/CLAUDE.md` stay canonical for the
painter, a11y, i18n, and performance contracts.

## Shape
- Pure decisions in `*_view.ts` / `*_core.ts`, registered in `UI_PURE_CORES`
  (`tests/architecture.test.ts`) under their full `src/ui/hud/professions/`
  paths. DOM stays in the `*_window.ts` / `*_card.ts` painters; a painter
  that reads a browser global registers in `UI_DOM_MODULES`.
  `farming_plant_sheet_window.ts` deliberately reaches no browser global
  (every DOM touch rides `deps.root()`), so it needs no registration: copy
  that shape for a new window here when you can.
- Modules never import `Hud`; they take narrow dependency bags
  (`... extends PainterHostPresentation`) plus callbacks, wired in
  `src/ui/hud.ts`.
- `index.ts` re-exports the whole family (every module, the two family-wide
  seams below included). Production consumers (`hud.ts`, `main.ts`) DEEP-IMPORT
  the module they need (`./hud/professions/<module>`), the accepted style this
  domain shares with `action_bar/` and `chat/` (the battleground barrel is the
  consumed-barrel style); the barrel exists for the domain's public-surface
  contract and for tests, not as a required import path. A new module joins
  the barrel in the same change.
- Every window joins the mobile window-open body-class family: an
  `onVisibilityChange?()` dep called on BOTH display flips, wired by Hud to
  `syncAnyWindowOpenState` (pinned by `tests/farming_windows_body_class.test.ts`).

## House a11y patterns (farming's, reused, never reinvented)
- Single-select rows are a `role="radiogroup"` of natively tabbable
  `role="radio"` buttons with `aria-checked` (plant sheet shape; the
  roving-tabindex refinement is a recorded OPEN follow-up in
  `docs/prd/masterwrought/farming/state.md`, and both farming roots run
  `bindPointerBlur`, so a mouse click parks focus on the window root:
  verify against `tests/farming_plant_sheet_window.test.ts`'s pointer-drop
  arm before changing the pattern).
- In-flight sends mirror a `pendingSend` flag onto the root's `aria-busy`
  through ONE writer, cleared by the answering event AND by
  `notifyErrorToast` (the sim's dead/busy gates answer through `ctx.error`,
  not a domain event).
- Flip-to-ready announcements are a persistent `role="status"` node beside
  the repaint target (never inside an `innerHTML`-rewritten subtree), fed a
  FRESH child span per announcement (harvest journal shape).

## Boundary (recorded at the ip-14-UI migration, 2026-08-28)
Kept at `src/ui/` root on purpose; do not pull them in without a reason:
- `worn_item_cell_view.ts`, `item_compare_view.ts`, `item_compare.ts`,
  `item_instance_tooltip.ts`, `bag_instance_glyph_view.ts`: the item-cell
  and item-presentation authorities. They serve EVERY owned-item surface
  (bags, banks, character, inspect, market), not just professions.
- `bag_item_action_menu.ts`: the bags-domain context menu; enchanting is
  one of its verbs, not its home.
- `gather_node_tooltip_controller.ts`, `gather_tool_tooltip.ts`,
  `gather_rare_event_feedback.ts`, `map_gather_tip_memo.ts`,
  `tool_effect_tooltip.ts`, `tool_effect_name.ts`: world-surface and
  item-tooltip gathering glue (3D node tooltips, map tips, bag tooltips),
  consumed by the map/world/tooltip families.

## Family-wide presentation seams (the phase 14 unification; reuse, never fork)
- Chat-log tones: `profession_log_tones.ts` names the family's five inline
  log colours once (`tests/profession_log_tones.test.ts` scans this whole
  directory for a re-spell). A new module never spells a log hex.
- Refusals: `denial_line_core.ts` owns the ProfessionDenialLine shape (key
  plus ready-made params) every "action refused with a reason" resolves to;
  crafting's `crafting_deny_core.ts` extends it, farming renders
  `farmDenialLine` through it. One surface per refusal, no cue.
- Empty states: the `.prof-empty` CSS family (components.css, professions
  section) is the ONE empty-state shape (optional h3 title + p body); every
  family window's no-candidates / no-orders / no-crops state uses it.
- Progress/rank/growth tracks: the `.prof-track` CSS family (same section,
  DESIGN.md 10.5) is the ONE stepped-track presentation; the Perfecting rank
  track and the Harvest Journal growth stages both consume it (steps are
  aria-hidden decoration beside accessible text).

## Named siblings and recorded decisions
- The commission board opens from the crafting window's title-bar button
  (`.crafting-orders-btn`), not a rail tile; a sibling professions window
  reuses that precedent.
- `professions_view.ts`'s simplified-mode body is governed by an OPEN
  maintainer ruling ((be), `docs/prd/masterwrought/farming/state.md`): do
  not restructure the simplified-mode gathering rows without that ruling.
