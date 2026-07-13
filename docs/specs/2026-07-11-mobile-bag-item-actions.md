# Mobile Bag Item Actions

## Goal

Make mobile bag interaction deliberate and predictable. A normal tap on an item opens actions
appropriate to that item instead of immediately equipping, consuming, using, or destroying it.
Consumables can be assigned to one of the six mobile Consumables quick-bar slots from the bag.

## Chosen approach

Use a compact item action menu inside the existing Bags window on mobile touch layouts. The menu
shows the selected item summary and only the actions valid for its kind and current bag mode.
Desktop bag clicks and all server-authoritative item commands remain unchanged.

This replaces the rejected standalone Consumables picker. The bag is already where players inspect
and manage items, and choosing one item before choosing its destination avoids a second inventory
browser.

## Scope

### In scope

- Normal mobile bag tap opens an item action menu.
- Every normal item action menu keeps the full existing item tooltip content visible in a
  dedicated detail pane, including use effects, stats, requirements, set or proc text, comparison,
  and sell price when applicable.
- Elixir detail includes the localized aura effect, value, and duration. Fixing a missing elixir
  line happens in the canonical tooltip renderer so hover, long press, and the persistent pane agree.
- At widths above 620 CSS pixels the detail pane sits beside the action controls. At 620 CSS pixels
  and below it stacks before the controls.
- Every normal item action menu offers Link to Chat through the existing item-link insertion flow.
- Weapon and armor actions offer Equip.
- Bag items offer Equip Bag.
- Food and drink offer Consume and assignment to Consumables slots 1 through 6.
- Potions and elixirs offer Use and assignment to Consumables slots 1 through 6.
- Tools with a use effect offer Use.
- Quest, junk, material-like, and otherwise non-usable items expose their summary without a fake
  Use action.
- Destroy is a secondary action only when the existing discard rules allow it, and keeps the
  existing confirmation flow.
- Consumables assignments persist per character through the same `char:<id>` or
  `offline:<class>:<name>` scope already supplied to keybind storage.
- The initial state remains automatic. The first explicit assignment seeds the current automatic
  six-slot layout, then replaces the chosen slot. Custom layouts may contain empty slots.
- An assigned consumable that reaches count zero stays assigned, visibly unusable, and becomes
  usable again when reacquired.
- Assigning an item already present in another Consumables slot moves it instead of duplicating it.
- Re-selecting the item's current slot removes it from that slot.
- The item menu includes Reset Consumables to Automatic whenever a custom layout exists.
- Long press continues to inspect without triggering the tap action.
- Every menu control has an accessible name, keyboard activation, visible focus, and at least a
  40 by 40 pixel mobile target.

### Existing transactional modes

The following modes keep their direct, single-purpose tap behavior and do not open the normal item
menu:

- Vendor: Sell
- Bank: Deposit
- Trade: Offer
- Mail Send: Attach
- World Market Sell: List
- Armed pet feeding: Feed or show the existing rejection

Blocked, soulbound, quest, stack-quantity, and stale-inventory guards remain authoritative and
unchanged.

### Out of scope

- No desktop bag behavior change.
- No server, database, simulation, wire-format, or inventory schema change.
- No drag-and-drop interaction on mobile.
- No assignment of tools or general items to the paged combat action bar in this change.
- No change to item balance, consumption, equipment, selling, banking, trading, mailing, or market
  rules.
- No freeform HUD editor.

## Technical design

### Pure decision core

Extend the bag view core, or add a sibling `bag_item_actions_view.ts`, to derive a menu model from:

- item kind and use metadata,
- existing `BagMode`,
- discard protection,
- whether the item is one of the four Consumables kinds,
- current six-slot custom assignment.

The pure model returns stable action identifiers and disabled states. It contains no DOM, storage,
localization runtime, or world mutation.

### Mobile action menu

Implement the menu as a self-contained Bags child component, not a new method cluster in
`hud.ts`. `BagsWindow` supplies the selected inventory stack and receives injected callbacks for
the existing item commands plus Consumables assignment.

The menu:

- opens only for a normal bag tap on mobile touch,
- renders the existing full item-tooltip markup in a persistent detail pane instead of duplicating
  or shortening item descriptions,
- lays out the detail pane beside actions above the 620 CSS pixel breakpoint and stacks it before
  actions at or below the breakpoint,
- keeps the detail and controls independently vertically scrollable in the two-column layout; in
  the stacked layout the sheet scrolls while the long detail remains bounded and scrollable,
- offers Link to Chat as a secondary action for every item,
- on successful Link to Chat, closes the item menu and Bags, opens the mobile chat panel and
  composer, inserts the exact item link, and leaves focus and caret in the composer,
- on failed Link to Chat, keeps the menu open, leaves focus on the Link button, and shows the
  localized action error,
- focuses its first enabled action,
- closes on Escape, outside press, Bags close, or successful action,
- returns focus to the originating item when it still exists, except after successful Link to Chat,
- uses existing confirmation UI for destructive actions,
- never performs an item command merely by opening.

The dialog uses `role="dialog"`, `aria-modal="true"`, and a visible title referenced by
`aria-labelledby`. The detail is a named region with its own visible heading. DOM and keyboard order
stay detail first, then primary and secondary actions, then Consumables destinations, regardless of
whether CSS presents one or two columns. Tab and Shift+Tab remain trapped inside the dialog.

The detail component may assign `innerHTML` only from the existing trusted `itemTooltip(item)`
result supplied by `BagsWindow`. It must not concatenate raw item, player, or translated text around
that HTML. The tooltip renderer continues escaping every dynamic value before producing markup.

### Consumables preferences

Add a small storage-backed pure helper for a versioned six-slot layout. The storage key is scoped
with the `keybindScope` already passed to `startGame`, preventing online characters and offline
characters from sharing preferences.

States:

- no saved custom layout: use the existing automatic ordering,
- saved custom layout: render the six saved item ids or null slots exactly,
- corrupt or invalid storage: ignore it and fall back to automatic.

Only food, drink, potion, and elixir item ids survive validation. Storage failures are caught and
leave the in-memory layout usable for the current session.

### Localization and styling

Add English catalog keys for action labels, menu names, slot announcements, full-bar or invalid
feedback, and Reset to Automatic. Do not edit generated locale output manually. The action menu
uses the existing dark-fantasy Bags vocabulary, mobile action-face treatment, focus tokens, and
forced-colors behavior.

## Rejected alternatives

### Long press on the Consumables toggle opens a full picker

Rejected because it introduces a second inventory browser, hides a core action behind a gesture,
and does not solve accidental tap-to-consume behavior in Bags.

### Inline action buttons on every bag row

Rejected because they reduce scan density and crowd small mobile bag rows.

### Mobile drag and drop

Rejected because the full-screen Bags window occludes the destination bar and touch dragging
conflicts with scrolling and long-press inspection.

### A separate reduced item-description model

Rejected because it would drift from the established tooltip content and could omit effects,
requirements, proc text, set bonuses, comparisons, or future item fields. The action menu reuses the
same localized tooltip markup already supplied to Bags.

## Open questions

None. The user approved item-specific mobile actions, direct transactional modes, and assignment
of consumables from the bag.

## Acceptance criteria

1. Tapping a consumable in a normal mobile bag never consumes it before an explicit Use action.
2. Tapping gear in a normal mobile bag never equips it before an explicit Equip action.
3. Every normal mobile bag item opens a menu containing only valid item-specific actions, a
   persistent full item detail pane, and Link to Chat.
4. Vendor, bank, trade, mail, market, and pet-feed taps preserve their current direct behavior.
5. A carried food, drink, potion, or elixir can be assigned to any of six Consumables slots.
6. Custom slot assignments persist per character, reject duplicates, survive zero inventory
   count, and can be reset to automatic ordering.
7. Long-press inspection does not open the menu or execute an action on release.
8. Desktop click, right-click, drag, and transactional bag behavior is unchanged.
9. Both game entries remain markup-compatible, all new strings are localized through `t()`, and
   all mobile actions meet focus, forced-colors, and target-size requirements.
10. Pure decision and storage helpers, Bags interaction, persistence isolation, touch gesture
    suppression, client shell, CSS validity, and production build checks pass.
11. The item detail pane matches the existing tooltip information for consumables, equipment, bags,
    quest items, materials, and junk without requiring long press or hover.
12. Elixir detail shows its localized aura effect, value, and duration through the canonical tooltip
    renderer.
13. A rendered 740 by 360 compact landscape viewport uses two columns. A 600 pixel wide viewport
    stacks detail before controls. Neither layout overflows horizontally, both stay inside the Bags
    content area, long details scroll, and the final action remains reachable.
14. The dialog title and detail region are programmatically named, DOM and Tab order remain detail
    then actions then destinations, and focus return follows the Link to Chat exception above.
15. Tooltip-detail parity tests cover exact trusted sentinel markup, escaped markup characters, and
    equipment comparison, proc, set, and sell-price fixtures.
16. Link success closes Bags and focuses the open mobile composer with the exact item id preserved;
    link failure keeps the dialog and Link focus. No world item command is emitted by either path.
17. Transactional mobile taps open no normal menu, detail, or Link action. Desktop hover tooltip,
    click, Shift-link, right-click, and drag behavior remain unchanged.
