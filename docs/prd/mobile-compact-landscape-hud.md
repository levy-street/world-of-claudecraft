# PRD: Mobile Touch HUD Layout

| | |
|---|---|
| **Status** | Approved |
| **Owner** | TBD |
| **Created** | 2026-07-10 |
| **Updated** | 2026-07-11 |
| **Source** | Mobile layout discussion following PR #1731 |
| **Implementation branch** | `mobile-layout-adjustments` |
| **Final integration prerequisite** | Satisfied by [PR #1724: joystick autorun lock](https://github.com/levy-street/world-of-claudecraft/pull/1724), release merge `083856d8c` |
| **Primary surface** | Touch HUD, with compact landscape as the strict reference tier |

> Follow-up: [Mobile HUD Readability Adjustments](../specs/2026-07-11-mobile-hud-readability-adjustments.md)
> supersedes this document's compact 2 x 3 Consumables drawer and old player/Target scale
> constants. Current landscape behavior is 3 x 2 Consumables on every tier, player scales
> `0.72`, `1`, and `1.1`, Target ratio `0.9`, and the transient mob description below the minimap.

## 1. Summary

The current mobile HUD gives its largest and best thumb position to Attack even though Attack
is a state toggle, not the repeated combat action. Offensive abilities start auto-attack by
default, and subsequent white swings run automatically. At the same time, the current
quarter-circle ring spreads controls through the lower and middle-right screen area that a
third-person 3D game needs for camera swipe-look.

This PRD replaces the action ring with a shallow two-row action pad, reserves a measurable
camera start zone, moves the minimap above the movement joystick, moves low-frequency menu
controls to the opposite top corner, and relocates the automatic Consumables drawer beside the
movement joystick. Jump remains a fixed primary action and becomes Interact when a nearby
contextual action is available. Attack remains explicitly available, but as a visually
tertiary control.

The design is compact-landscape-first, but defines one stable topology for all touch tiers.
Standard and tablet landscape, safe-area, and left-handed layouts may change dimensions and
offsets, but they must preserve the same control relationships and input semantics.

The action-page model also gives touch players intentional control over where a learned ability
is placed. A touch-only Spellbook picker assigns abilities to stable mobile source slots instead
of silently taking the first free position. Mobile exposes up to four five-slot action pages,
keeps Attack fixed, and keeps the automatic six-item Consumables drawer separate from persisted
hotbar mapping.

### 1.1 Landscape-only scope amendment

On 2026-07-10 the user removed portrait gameplay from this contribution because a separate PR
will disable it. Existing portrait CSS may remain for compatibility until that PR lands, but
portrait geometry, screenshots, and browser matrices are not acceptance gates here.

## 2. Problem statement

### 2.1 Incorrect action hierarchy

The standard mobile ring currently renders Attack at 100px before shared mobile chrome scale,
while ability buttons are 64px. This implies that Attack is the primary repeated action. The
actual game loop is different:

- Attack starts or stops `autoAttack` and can acquire the nearest valid enemy when no live
  attack target exists.
- Offensive abilities start auto-attack by default in PvE.
- The simulation performs later white swings automatically on the swing timer.
- Explicit Attack remains necessary for manual start or stop, white-hit-only play, and PvP.

Attack must therefore remain visible and discoverable without owning the prime thumb seat.

### 2.2 Camera space is an input surface

Swipe-look can start only on non-interactive canvas. A touch that begins on a HUD control is
owned by that control for its lifetime and cannot become a camera drag. Once a camera drag
starts on canvas, pointer capture keeps the camera active even if the finger later crosses a
control.

The layout must therefore reserve a contiguous and predictable camera start zone, not merely
leave incidental gaps between buttons.

### 2.3 Compact phones have a hard geometry budget

The compact tier covers short landscape phones at or below 480px viewport height, including
the canonical 740x360, 844x390, 915x412, and 932x430 profiles. The current radial ring reaches
toward the minimap and bottom-center player frame, which requires tier-specific shrinking and
player-frame nudges. The redesigned control pad must fit without recreating those compensating
offsets.

### 2.4 Touch scaling can shrink real targets below the intended floor

The current HUD can transform-scale a whole control cluster after its CSS dimensions are
calculated. At the minimum user button scale, several rendered targets can fall below the
repository's 40px preferred touch floor. The new layout must separate visual scale from the
actual interactive hitbox and target a 48px rendered floor for gameplay controls.

## 3. Research and design basis

The selected design applies the following external guidance without copying another game's
combat hierarchy:

- [Apple Game Controls](https://developer.apple.com/design/human-interface-guidelines/game-controls):
  frequent actions belong near the thumb, secondary navigation belongs near the top, direct
  world interaction can replace unnecessary virtual controls, and frequent touch controls
  should be at least 44 by 44 points.
- [Microsoft touch layout guide](https://learn.microsoft.com/en-us/gaming/gdk/docs/features/common/game-streaming/building-touch-layouts/game-streaming-tak-designers-guide):
  rank controls by actual frequency, keep primary actions in the thumb wheel, and reserve upper
  areas for infrequent actions.
- [Android accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views):
  interactive elements should provide at least a 48 by 48 dp target, even when their visible
  artwork is smaller.
- [Epic mobile design guidance](https://dev.epicgames.com/documentation/fortnite/designing-for-mobile-in-fortnite):
  minimize persistent controls, prefer contextual actions, and protect the thumb zones.
- [Diablo Immortal accessibility](https://news.blizzard.com/en-us/article/23805083/making-a-game-for-everyonediablo-immortals-accessibility-features):
  allow touch clusters to adapt to player comfort and device geometry.

These are placement principles, not a mandate to copy a large basic-attack button. ClaudeCraft
auto-attack semantics make that pattern inappropriate here.

## 4. Goals and non-goals

### Goals

- Correct the visual hierarchy around actual World of ClaudeCraft action frequency.
- Preserve a reliable camera swipe-look start surface on every supported touch viewport.
- Keep five ability slots, explicit Attack, Target, contextual Jump/Use, and page switching
  directly reachable.
- Keep existing combat, targeting, interaction, paging, cooldown, drag, and item behavior.
- Make the compact 740x360 landscape profile comfortable without clipping or control overlap.
- Preserve a stable topology across responsive tiers and mirror it for left-handed play.
- Keep all gameplay controls usable while the movement joystick is held by another touch.
- Preserve parity between `index.html` and `play.html`.
- Let touch players choose the exact mobile slot for a learned ability and immediately see where
  an equipped ability is assigned.
- Keep assigned source slots reachable without forcing empty higher pages into the default page
  cycle.

### Non-goals

- No combat balance or simulation changes.
- No removal of explicit Attack.
- No new auto-target-on-ability behavior.
- No expansion beyond mobile source slots 1 through 20.
- No mobile access to the remaining desktop source slots 21 and 22 in this scope.
- No player-authored freeform HUD editor.
- No desktop HUD layout changes.
- No portrait gameplay layout work or portrait QA; a separate PR owns disabling that orientation.
- No reimplementation or fallback standalone Autorun button. PR #1724 owns Autorun inside the
  joystick and must land first.
- No redesign of minimap contents, party data, target data, or Consumables ordering.
- No fifth sparse mobile action page, reduction of the six-item Consumables drawer, or treatment
  of Consumables as persisted hotbar slots.
- No server, database, wire-format, talent-loadout, or 22-slot hotbar storage migration.
- No desktop Spellbook picker or desktop drag-and-drop behavior change.

## 5. Chosen approach

### 5.1 Right-handed compact landscape topology

The closed resting layout is:

```text
+-----------------------------------------------------------------------+
| [MAP] [>][P1][P2][P3][P4][x]                   [CHAT][QUEST][MORE]     |
|                         [TARGET]                                      |
|                                                                       |
|                                      +------------------------------+ |
|                                      |      CAMERA START ZONE       | |
|                                      |         swipe-look           | |
|                                      +------------------------------+ |
|                                      [PET ATK][TAUNT][HEAL][STANCE]  |
| [MOVE + AUTORUN] [CONS]       [PLAYER]       [A1][A2][A5][TARGET]  |
|                                             [1][A3][A4][ATK][JUMP/USE]|
+-----------------------------------------------------------------------+
```

When Consumables is open on compact landscape, the toggle stays low beside movement. Items fill
toward the player frame first and only then wrap upward:

```text
                         [C4][C5][C6]
 [MOVE + AUTORUN] [CONS][C1][C2][C3]   [PLAYER]
```

The open grid is transient. It must not move the joystick, player frame, action pad, map,
target frame, party controls, or camera start zone.

### 5.2 Action pad order

The fixed visual order is:

```text
       [A1] [A2] [A5]     [Target]
[1]    [A3] [A4] [Attack] [Jump/Use]
```

The first page maps A1 through A5 to source slots 1 through 5. The second page maps the same
five visual seats to source slots 6 through 10. The third page maps them to source slots 11
through 15. The fourth page maps them to source slots 16 through 20. The page button remains
outside the mapped ability slots. Desktop source slots 21 and 22 remain desktop-only overflow.

Rationale:

- A1 through A4 form the compact ability core. A5 occupies the former Attack seat without
  changing source-slot mapping or the pad footprint.
- Target sits directly above Jump/Use, forming the context-action column nearest the action
  thumb.
- Attack stays in its original column but moves to the lower row and remains visually quieter
  than abilities, Target, and Jump/Use.
- Page switching is the least frequent pad action and sits left of A3, farthest from the action
  thumb.
- The shallow two-row footprint leaves a single camera surface above it instead of scattering
  blockers through a radial arc.

### 5.3 Control sizing and emphasis

For compact landscape at default interface scale:

| Control | Visible treatment | Minimum rendered hitbox |
|---|---|---|
| A1 through A5 | Standard ability face | 48 x 48px |
| Attack | Smaller or lower-contrast icon inside a standard target | 48 x 48px |
| Target | Standard secondary face | 48 x 48px |
| Page indicator (1, 2, 3, or 4) | Visually compact and subdued | 48 x 48px |
| Jump/Use | Largest and highest-emphasis action | 56 x 56px |
| Consumables toggle and slots | Compact 40px utility face | 48 x 48px |
| Compact top menu buttons | Standard menu face | 48 x 48px |

The user Button Size setting may scale glyphs, borders, and visible faces, but it must not
reduce the interactive target below 48 x 48px. Adjacent interactive targets require at least
a 4px rendered edge gap.

Standard and tablet tiers may increase visible sizes and gaps. They must not change the
relative order or semantics.

### 5.4 Intentional mobile slot assignment

On touch, a learned Spellbook row uses one of three states:

- An unassigned ability exposes an Add control that opens an inline slot picker.
- An ability in source slots 1 through 20 exposes a check icon, localized `{page} - A{position}`
  chip, and a separate Remove control. The chip reopens the picker for relocation.
- An ability in source slots 21 or 22 exposes a check icon, localized Desktop chip, and a
  separate Remove control. The Desktop chip opens the mobile picker so the ability can be moved
  into source slots 1 through 20.

The picker stays inside the existing Spellbook rather than opening a nested modal. It presents
page tabs 1 through 4 and exactly five slots for the selected page. Each slot shows its stable
page position, current icon or empty state, and an accessible name for its current action.

Selecting a destination immediately assigns the chosen ability. An occupied ability or item
shortcut is overwritten without confirmation because only the shortcut changes. If the chosen
ability already exists elsewhere, its old position becomes empty before the destination is
written. This picker-specific move-and-overwrite behavior intentionally differs from desktop
drag-and-drop swapping.

## 6. Functional requirements

### 6.1 Attack

- **FR-1.1** Attack remains a fixed, always discoverable button.
- **FR-1.2** With no live attack target, Attack preserves the existing acquire-nearest path.
- **FR-1.3** With a live target or active auto-attack, Attack preserves the existing toggle
  behavior.
- **FR-1.4** Active auto-attack has a clear persistent outline/glow on the Attack face that
  remains visible under the player's finger and in forced-colors mode, without a separate
  corner status marker.
- **FR-1.5** Attack never becomes the largest control in any touch tier.

### 6.2 Jump and contextual interaction

- **FR-2.1** Jump/Use keeps one stable physical seat.
- **FR-2.2** The button paints Interact icon, copy, title, and accessible name when the existing
  nearby-interaction resolver finds a valid action; otherwise it paints Jump.
- **FR-2.3** A press attempts the contextual action first and falls back to Jump when none is
  available.
- **FR-2.4** Existing interaction priorities and ranges remain authoritative.
- **FR-2.5** The press-first path and touch suppression remain intact so the action works while
  the movement thumb is held and does not fire twice after a long press.

### 6.3 Target

- **FR-3.1** Target remains directly accessible and invokes the existing hostile Tab-cycle
  behavior.
- **FR-3.2** Target remains visually secondary to Jump/Use and abilities, but more prominent
  than Attack and page switching.
- **FR-3.3** Target selection rules and candidate ordering do not change.

### 6.4 Ability paging and drag behavior

- **FR-4.1** Five ability buttons remain visible on each page.
- **FR-4.2** The explicit page control cycles through the contiguous effective page range:
  source slots 1 through 5, 6 through 10, 11 through 15, and 16 through 20.
- **FR-4.3** The compact page indicator shows the current page number and exposes the existing
  localized accessible label.
- **FR-4.4** Page switching is tap-only. No swipe gesture may claim open gameplay canvas or the
  whole action-pad container.
- **FR-4.5** Existing long-press drag, cooldown, count, unusable, out-of-range, queued, and used
  feedback remains intact on all four pages.
- **FR-4.6** The persisted touch preference is a minimum page count from 2 through 4, defaulting
  to 2. Options presents the three discrete values under localized Minimum Mobile Action Pages
  copy rather than as a continuous slider. It is a presentation setting and never resizes or
  migrates the persisted 22-slot bar.
- **FR-4.6a** Settings normalization accepts only finite numeric input. Missing, non-numeric,
  string, and non-finite stored values resolve to default 2. Finite numeric values are rounded
  to the nearest integer and then clamped to 2 through 4 before use or persistence.
- **FR-4.7** The effective page count is the greater of the configured minimum and the highest
  occupied page among source slots 1 through 20, capped at 4. Both ability and item shortcuts
  count as occupied actions.
- **FR-4.8** Effective pages remain contiguous. An occupied page 4 makes pages 1 through 4
  reachable even when page 3 is empty. A populated higher page is never hidden by Options.
- **FR-4.9** When the effective count shrinks after a removal, form switch, or loadout change,
  the current page clamps to the last effective page before the next paint or input dispatch.

### 6.5 Camera start zone

- **FR-5.1** Every supported landscape touch tier reserves a contiguous non-interactive canvas
  rectangle on the action side between the top HUD and the pet/action cluster.
- **FR-5.2** On every canonical landscape profile, the rectangle is at least
  `min(30vw, 220px)` wide and `min(24vh, 100px)` tall. Swipe-look is not restricted to this
  rectangle; it is the guaranteed unobstructed start surface within the wider free canvas.
- **FR-5.3** A pointerdown anywhere in the measured rectangle must pass
  `isCameraDragAllowedAt` when no modal is open. The browser gate samples a 3 x 3 point grid,
  including all four corners, edge midpoints, and center.
- **FR-5.4** The action pad, pet commands, menu, minimap, target/party frames, Consumables, and
  any transparent wrapper must not occupy or intercept the rectangle.
- **FR-5.5** Once a camera drag begins, existing pointer ownership, pointer capture, 6px
  deadzone, double-tap recenter, and pinch behavior remain unchanged.
- **FR-5.6** When the optional view joystick is enabled in the default layout, it sits on the
  right view side with the full guaranteed swipe-look rectangle immediately inward of it. The
  joystick and rectangle mirror together in left-handed mode and neither may collide with the
  target, pet commands, or action pad. Its outer edge remains at least 30px from the viewport edge
  or 12px inward of the corresponding safe-area inset, whichever is greater.

### 6.6 Minimap, target, party, and menus

- **FR-6.1** In right-handed touch mode, the minimap sits at the top-left above the movement
  joystick. Compact landscape targets an approximately 80 to 85px rendered map width.
- **FR-6.2** The target frame is centered within the safe viewport width in a separate row 48px
  below the safe top edge. Its rendered width remains smaller than the centered player frame on
  every landscape tier. It uses 80 percent of the responsive player-frame tier scale before the
  shared mobile chrome scale is applied.
- **FR-6.3** Party is collapsed by default to an icon-only chevron immediately inward of the
  minimap. Its transparent button retains a 40 x 40px hit target while the visible glass face is
  approximately 28px; the localized Party caption remains visually hidden as its accessible
  name. When expanded, the disclosure, all compact members, and Leave control occupy one top row.
  The entire row follows the map when handedness mirrors.
- **FR-6.4** Expanded party rows must not overlap the map, target, top menu, movement capture
  zone, Consumables, player frame, action pad, or camera start zone.
- **FR-6.5** The mobile Leave Party control uses a 40 x 40px touch target with a visually
  smaller close icon and retains the localized Leave Party accessible name.
- **FR-6.6** Whenever a live pet is active in landscape, its command bar sits directly above the
  two-row action pad with an 8px gap and shares the pad's action-side edge. It mirrors to the left
  with the pad in left-handed mode and must clear both the pad and guaranteed camera start zone.
  Each command keeps a 40 x 40px hit target, exposes approximately 32px circular art, and removes
  the desktop group panel and dark button tile from the mobile presentation.
- **FR-6.7** Compact touch layouts show Chat, Quests, and More in the top corner opposite the
  minimap.
- **FR-6.8** Social and Settings remain reachable through More on compact layouts. Their actions
  must have one logical owner and no duplicate active element IDs.
- **FR-6.9** Standard and tablet touch layouts may show all five current direct menu actions if
  they pass the same geometry and camera-zone constraints.

### 6.7 Joystick and Autorun dependency

- **FR-7.1** The movement joystick remains in its current thumb corner. Its landscape wheel is
  116px before user and shared chrome scaling, while its floating capture zone remains unchanged.
- **FR-7.2** Autorun is provided only by the joystick interaction from PR #1724.
- **FR-7.3** The layout contains no standalone Autorun seat, markup, label, or collision rule.
- **FR-7.4** Layout work may proceed before PR #1724 merges, but the old standalone button must
  be removed immediately and no temporary Autorun fallback may be added.
- **FR-7.5** Final implementation readiness requires integration with PR #1724 and verification
  of its joystick-owned Autorun markup, wiring, reset behavior, and geometry.

### 6.8 Consumables

- **FR-8.1** The closed Consumables toggle sits immediately inward of the movement joystick,
  outside its fixed capture zone. The toggle and every populated slot retain a 48 x 48px hitbox
  while exposing a 40 x 40px visible face. Button Size may reduce the visible slot content only to
  36px and may not enlarge it beyond 40px. The cooldown overlay remains clipped to the same visible
  face at every Button Size value.
- **FR-8.2** Opening the toggle snapshots up to six distinct carried items using the existing
  order: potion, elixir, food, drink. Duplicate stacks remain one visible slot.
- **FR-8.3** On every landscape tier, open items use at most three columns and two rows beside
  the toggle. On compact, items 1 through 3 occupy the lower row and items 4 through 6 wrap
  upward. Standard and tablet retain the same 3 x 2 topology.
- **FR-8.4** Empty slots collapse. Counts, usability, and potion cooldown continue updating
  live while item positions remain stable until the drawer is reopened.
- **FR-8.5** Long press continues to inspect an item instead of consuming it.
- **FR-8.6** The drawer has no duplicate automatic potion shortcut near the action pad.
- **FR-8.7** A second touch can operate Consumables while the movement joystick owns another
  pointer.

### 6.9 Player frame

- **FR-9.1** The player frame remains at the bottom and is centered within the safe viewport
  width rather than the full physical width.
- **FR-9.2** The complete player frame scales by responsive tier: 0.72 on compact phones, 1 on
  standard touch screens, and 1.1 on tablets, before the shared mobile chrome scale is applied.
  Target uses 0.9 of the active player tier.
- **FR-9.3** Cast and swing bars use the same responsive scale and safe center as the player
  frame.

### 6.10 Mobile Spellbook slot picker

- **FR-10.1** The picker is touch-only. Desktop keeps the existing Add, Remove, and native
  drag-and-drop interactions unchanged.
- **FR-10.2** An unassigned learned ability opens the picker through its Add control. A mobile-
  assigned ability opens it through its equipped chip. A source-slot 21 or 22 ability opens it
  through its Desktop chip.
- **FR-10.3** The picker always exposes page tabs 1 through 4, independent of the current
  effective action-page count, and shows five 48 x 48px destination targets for the selected
  page with at least 4px gaps.
- **FR-10.4** An unassigned ability opens on the current HUD page. A mobile-assigned ability
  opens on its assigned page. A Desktop-marked ability opens on the current HUD page.
- **FR-10.5** Selecting an empty or occupied destination immediately moves the ability there,
  overwrites the destination shortcut without confirmation, clears any previous occurrence of
  the ability, persists the active form bar, closes the picker, and switches the HUD to the
  selected page.
- **FR-10.6** Selecting the ability's existing destination is a successful no-op: no hotbar
  mutation occurs for canonical input, but the picker closes and the HUD switches to that page.
  The runtime invariant permits at most one occurrence of an ability. If corrupt legacy input
  contains duplicates, the picker transform retains the selected destination and clears every
  other occurrence before persisting.
- **FR-10.7** The equipped chip updates immediately after Add, Remove, picker assignment,
  desktop drag-and-drop, form switch, loadout change, or bar reset. It never waits for the
  Spellbook to close and reopen.
- **FR-10.8** The separate Remove control immediately removes the equipped ability without a
  confirmation dialog and keeps the picker closed.
- **FR-10.9** The picker closes through its explicit close control, Escape through the existing
  unified `closeAll` dispatcher, or by activating the same opener chip again. A pointer outside
  the Spellbook does not close it. This contribution adds no browser-history, native-shell, or
  platform Back handler.
- **FR-10.10** Closing returns focus to the opener when it still exists. Successful assignment
  returns focus to the updated equipped chip for that ability.
- **FR-10.11** Cross-page relocation uses the picker. Existing long-press drag remains scoped to
  the current visible action page.
- **FR-10.12** The page-count preference is global to the device. Effective count and equipped
  state derive from the active character, class, form, and loadout bar.
- **FR-10.13** Slots 21 and 22 remain fully functional on desktop and are represented on touch as
  Desktop-equipped abilities rather than falsely appearing unassigned.
- **FR-10.14** Any whole-bar replacement, including active-form switch, talent-loadout apply, or
  bar reset, cancels and closes the picker before replacing the bar. The refreshed Spellbook
  restores focus to the same ability's new row control when it still exists, otherwise to the
  Spellbook close control. Individual slot mutations that do not replace the bar refresh the
  open picker in place.
- **FR-10.15** The picker captures the active character and form identity at open. Assignment
  validates that identity immediately before mutation and cancels instead of writing if it has
  changed.
- **FR-10.16** On touch, Add remains enabled for every learned off-bar ability even when all 22
  hotbar slots are occupied, because the picker can overwrite a destination. Desktop preserves
  its current full-bar disabled Add behavior.
- **FR-10.17** Existing automatic placement of newly learned abilities remains unchanged. If it
  lands in source slots 1 through 20, effective pages expand as required. If it lands in slot 21
  or 22, the Spellbook shows Desktop state. Only manual touch Spellbook Add changes from
  first-free placement to explicit destination selection.

## 7. Responsive and handedness behavior

### Compact landscape

- Reference profiles: 740x360, 844x390, 915x412, and 932x430.
- Uses the exact two-row action order in section 5.2.
- Uses the three-action compact menu.
- Keeps the complete Consumables group beside movement and fills a 3 x 2 drawer toward the player
  frame, with items 1 through 3 in the lower row.
- Enforces the camera rectangle in FR-5.2.

### Standard and tablet landscape

- Preserve the same action-pad order and side ownership.
- Increase visible button sizes and gaps through named tier variables.
- May expose all five direct menu controls if the pet bar, minimap, and camera zone remain clear.
- Enforce the landscape camera rectangle in FR-5.2.
- Do not return to a radial topology.

### Portrait touch

Out of scope. A separate contribution disables portrait gameplay; this PR neither redesigns nor
validates that orientation.

### Left-handed touch

Mirror the topology as one system:

- Movement joystick and integrated Autorun move to bottom-right.
- Minimap moves above the movement joystick at top-right.
- Consumables moves inward to the left of the joystick and fills leftward toward the player frame
  before wrapping upward.
- Action pad moves to bottom-left.
- Optional view joystick moves to the left view side and the camera start zone sits immediately
  inward of it above the pad.
- Compact menu moves to top-left.
- Party stays immediately inward-left of the mirrored minimap. Target and player chrome remain
  centered within the safe viewport width.
- The page control remains farthest from the action thumb after mirroring.

No mirrored mode may change action semantics, source-slot mapping, or touch target size.

## 8. Technical design constraints and hook points

### Markup and wiring

- `index.html` and `play.html` must carry identical control inventory and ordering.
- Preserve one element each for Attack, Target, Jump/Use, page switching, and every ability
  slot. Do not solve compact menu relocation with duplicate IDs.
- Keep touch handlers on the existing multi-touch-safe `bindTouchTap` path.
- Keep the picker inside the existing Spellbook DOM and focus scope. Do not add a second modal,
  duplicate action-ring nodes, or a second hotbar state owner.
- Route picker Escape handling through the existing unified `closeAll` dispatcher with picker-
  before-Spellbook precedence. Do not add a second document key handler, browser-history entry,
  or native Back listener.

### Presentation

- Replace the radial trigonometric seat rules in `src/styles/hud.mobile.css` with a named
  two-row pad topology, preferably CSS grid or explicit grid areas.
- Define tier sizes, gaps, map size, camera-zone geometry, and safe-area anchors through named
  CSS custom properties.
- Keep pad and utility wrappers `pointer-events: none`; enable pointer events only on actual
  buttons. Transparent layout boxes must remain camera-draggable.
- Separate visible face scaling from the interactive hitbox.

### Existing pure and painter seams

- Keep maximum page arithmetic, source-slot mapping, effective-page resolution, and current-page
  clamping in `src/ui/mobile_action_page_view.ts` or a sibling pure core. Spellbook and Hud must
  not duplicate page math.
- Keep ability and item state in the shared action-bar view and painter family.
- Keep dynamic Jump/Use and page accessible copy in `src/ui/mobile_action_ring_painter.ts`, or
  rename the module if the ring name becomes materially misleading without changing its pure
  responsibilities.
- Keep nearby interaction resolution in `src/game/interactions.ts`.
- Keep touch ownership and camera eligibility in `src/game/touch_router.ts` and
  `src/game/mobile_controls.ts`.
- Keep responsive tier resolution in `src/ui/mobile_hud_layout.ts`.
- Keep Consumables ordering in `src/ui/consumable_bar_view.ts`.
- Extend `src/ui/spellbook_view.ts` with an exact mobile assignment model containing source slot,
  page, and A-position, or Desktop state. Keep `src/ui/spellbook_window.ts` as the thin DOM owner
  and route mutations through injected Hud callbacks.
- Add a separately named pure hotbar transform for picker move-and-overwrite semantics. Do not
  change or silently reuse the existing desktop swap transform.
- Document the load-bearing numbering invariant beside the shared constants and transforms:
  Attack is slot 0, persisted generic hotbar entries are source slots 1 through 22, mobile pages
  map 1 through 20, slots 21 and 22 are desktop overflow, and automatic Consumables are not
  hotbar pages.

### Settings and state

- Existing left-handed, button-size, joystick-size, camera-joystick, haptics, and touch-opacity
  settings remain supported.
- The minimum mobile action-page setting persists through the existing `woc_settings` store as a
  numeric range from 2 through 4 with default 2. The current page, picker open state, picker tab,
  and Consumables open state remain session state.
- Existing hotbar storage remains a 22-entry array per character, class, and form. The minimum
  page setting changes presentation only. No stored bar entry is moved, truncated, or deleted
  when the preference changes.
- Whole-bar mutation entry points close the picker before replacing `hotbarActions`. Picker
  assignment carries and validates an opening character/form token so a stale callback cannot
  write into a newly active bar.
- No graphics or performance tier may hide actionable information or change hitboxes.

## 9. Accessibility and feedback

- Every gameplay control must retain a localized accessible name and title where currently
  provided.
- Jump/Use must update visible label, title, and accessible name together.
- Page copy must announce the page number and count.
- Picker page navigation uses one `tablist` with four `tab` controls, `aria-selected`, and roving
  `tabindex`. Left/Right arrows move and activate the adjacent page; Home/End activate the first
  or last page. The five destinations are ordinary buttons inside a localized `group`, not radio
  controls. Tab reaches each destination, and Enter or Space performs assignment.
- Each destination exposes its page, A-position, occupied or empty state, and current action
  name. The ability's current destination also exposes `aria-current="true"`.
- Equipped state uses a check icon plus localized text. Current assignment uses icon, text, and
  selected-state semantics rather than color alone. Player-visible copy never uses raw glyphs as
  its only label.
- Opening, canceling, assigning, and removing preserve the Spellbook focus contract. Keyboard
  users can reach every picker page and slot even though the feature is touch-gated.
- Opening focuses the current destination when one exists, otherwise the first empty destination
  on the opening page, otherwise A1. Successful assignment updates a localized polite status
  announcement with ability name, page, and A-position before focus returns to the updated chip.
- Attack active state must not rely on color alone.
- All controls require visible press feedback. Existing audio and haptic behavior remains.
- `prefers-reduced-motion` removes nonessential transitions without changing layout or state.
- Forced-colors mode retains button boundaries, focus indication, and Attack active state.
- User scale settings must not reduce hitboxes below the required rendered floor.

## 10. Performance requirements

- No new per-frame layout reads such as `getBoundingClientRect` in HUD update paths.
- Dynamic painters keep write-elision and allocation-light state.
- Assignment-chip refresh must not rebuild the whole Spellbook or perform layout reads every
  frame. It uses event-driven refresh or stable-key write elision when hotbar state changes.
- Effective-page resolution is deterministic O(20) or better and allocates no per-frame arrays.
- Layout tier and handedness changes may recompute CSS state on viewport or settings changes,
  not every frame.
- Camera eligibility remains a constant-time target classification.
- Closed Consumables continues to skip per-frame painting.

## 11. Validation and testing

### Unit and source-contract tests

- Update `tests/client_shell.test.ts` for markup parity, action order, compact menu inventory,
  removal of standalone Autorun, and the new non-radial CSS topology.
- Update `tests/mobile_action_ring_painter.test.ts` for Jump/Use, page indicator, and Attack
  state presentation as applicable.
- Extend `tests/mobile_action_page_view.test.ts` for four-page mapping, configured minimum,
  content-aware effective count, contiguous pages, current-page clamping, and normalization of
  missing, string, non-finite, fractional, and out-of-range setting values.
- Extend `tests/spellbook_view.test.ts` for exact P/A/Desktop assignment state across source
  slots 1 through 22, including item occupancy and form-shaped inputs.
- Extend the hotbar pure-core suite for picker overwrite, old-source clearing, occupied ability
  and item replacement, no duplicates, canonical same-slot no-op, corrupt duplicate cleanup, and
  input immutability.
- Extend `tests/spellbook_window.test.ts` for touch-only picker ownership, equipped and Desktop
  chips, immediate refresh, full 22-slot Add availability, whole-bar replacement cancellation,
  stale form-token rejection, localized accessible state, and focus return.
- Extend settings and Options view tests for the persisted 2 through 4 minimum-page setting and
  touch-only presentation.
- Preserve and extend `tests/mobile_controls.test.ts`, `tests/touch_router.test.ts`, and
  `tests/interactions.test.ts` for multi-touch ownership and contextual actions.
- Preserve `tests/consumable_bar_view.test.ts` ordering, cap, and stable snapshot behavior.
- Update `tests/browser/target_size.browser.test.ts` to exercise minimum user scale and assert
  the 48px rendered primary gameplay-control floor and the explicit 40px pet-command floor.

### Geometry and browser checks

- Update `scripts/mobile_cluster_layout_check.mjs` and
  `scripts/mobile_hud_overlap_audit.mjs` for the new inventory and geometry.
- Add a measured camera-start rectangle assertion using the same real browser geometry.
- Replace the implicit profile set with the canonical matrix below.
- Assert every control remains on-screen and at least 4px from adjacent controls. Primary
  gameplay controls remain at least 48 x 48px; compact pet commands retain their explicit
  40 x 40px hit target from FR-6.6.
- Assert no interactive element or wrapper intercepts the camera-start rectangle.
- Add a real-page picker flow that assigns an ability to every page, overwrites an occupied
  ability and item, moves an already-equipped ability without swapping, verifies immediate chip
  state, and confirms the HUD opens the selected page.
- Add a full 22-slot touch flow proving Add still opens the picker, plus form switch, loadout
  apply, and reset flows proving an open picker cancels before whole-bar replacement.
- Add compact 740x360 picker geometry with page tabs, all five destinations, focus-visible state,
  arrow-key tab navigation, slot keyboard activation, polite assignment announcement, and no
  overlap or clipping inside the scrollable Spellbook.

Canonical viewports:

| Profile | Viewport | Expected tier |
|---|---:|---|
| Galaxy S8 landscape | 740x360 | compact |
| iPhone 13 landscape | 844x390 | compact |
| Pixel 7 landscape | 915x412 | compact |
| iPhone Pro Max landscape | 932x430 | compact |
| Touch laptop landscape | 1280x720 | standard |
| Tablet 4:3 landscape | 1024x768 | tablet |
| FHD touch landscape | 1920x1080 | tablet |

Synthetic safe-area vectors use `{ top, right, bottom, left }` CSS pixels:

| Vector | Insets |
|---|---|
| None | `{ 0, 0, 0, 0 }` |
| Landscape notch right | `{ 0, 44, 21, 0 }` |
| Landscape notch left | `{ 0, 0, 21, 44 }` |

Required state runs are bounded rather than a full Cartesian product:

1. Every canonical viewport runs right-handed and left-handed baseline states with default
   scale, camera joystick off, Consumables closed, party collapsed, no pet, and no safe inset.
2. The 740x360 profile runs right-handed and left-handed minimum button and joystick scales to
   enforce the rendered touch floor.
3. The 740x360 profile runs right-handed maximum button and joystick scales with camera joystick
   on, Consumables open, party expanded, pet active, and the landscape notch-right vector.
4. The same maximum 740x360 stress state runs left-handed with the landscape notch-left vector.
5. Consumables open and closed, party collapsed and expanded, and pet absent and active are
   therefore each covered in both handedness directions on the strictest phone profile.

### Visual QA

Commit before and after screenshots under `docs/screenshots/` for at least:

- 740x360 compact landscape, resting state.
- 740x360 compact landscape, Consumables open with an active pet and optional view joystick.
- 844x390 compact landscape with a target and party.
- Left-handed compact landscape with an active pet.
- 1024x768 tablet landscape.
- 740x360 compact landscape with the Spellbook picker open on an occupied page, including the
  equipped chip, all page tabs, five destinations, and explicit close control.

### Contribution gate

- Run focused unit tests while iterating.
- Run the updated geometry and overlap browser scripts against `npm run dev`.
- Run `npm run test:browser` when the local Chromium browser suite is available.
- Run `npm run gate` before implementation is declared complete.

## 12. Acceptance criteria

The feature is complete when all of the following are true:

1. The action pad uses the approved two-row order on every touch tier.
2. Attack remains explicit, visually tertiary, and behaviorally unchanged.
3. Jump/Use changes context without moving and works while movement is held.
4. Target remains directly available and behaviorally unchanged.
5. Page 1 maps source slots 1 through 5, page 2 maps 6 through 10, page 3 maps 11 through 15,
   and page 4 maps 16 through 20.
6. The page button sits left of A3 and does not create a camera gesture.
7. Every canonical landscape camera-start rectangle meets FR-5.2 and is
   camera-draggable at every point in the required 3 x 3 sample grid.
8. Minimap, target, party, menu, player frame, pad, joystick, and Consumables pass all overlap
   checks in every canonical profile and state; target remains narrower than the player frame.
9. Compact menu exposes Chat, Quests, and More directly; Social and Settings remain reachable
   through More.
10. The implementation base contains the integrated joystick Autorun behavior from PR #1724
    and contains no standalone Autorun markup, handler, or layout seat.
11. Consumables remains automatic and opens as a stable 3 x 2 responsive drawer beside the
    joystick on compact, standard, and tablet landscape tiers.
12. Side-owned controls mirror completely with identical semantics; Party follows the map while
    Target and the player frame remain centered within the safe width.
13. Every primary gameplay touch target remains at least 48 x 48px at minimum user scale; pet
    commands retain the explicit 40 x 40px accessible exception in FR-6.6.
14. All controls remain reachable with safe-area insets and optional camera joystick enabled.
15. `index.html` and `play.html` remain structurally equivalent for touch controls.
16. Desktop layout and behavior remain unchanged.
17. Required screenshots are committed and the contribution gate passes.
18. Touch Options persists a minimum page count from 2 through 4, default 2, while occupied
    higher pages always remain reachable and page numbering stays contiguous.
19. The inline Spellbook picker exposes all four pages and assigns a learned ability to any of
    the 20 mobile source slots without requiring an empty destination.
20. Assignment overwrites the destination shortcut without confirmation, clears the ability's
    previous source, never duplicates it, persists the active form bar, and opens the selected
    HUD page.
21. An equipped mobile ability shows a check icon and correct localized P/A chip immediately;
    an ability in source slot 21 or 22 shows a check icon and localized Desktop chip.
22. The separate Remove control remains available, and picker cancel, same-slot selection,
    keyboard navigation, and focus return follow FR-10.
23. The automatic six-item Consumables drawer, fixed Attack control, desktop 22-slot bar,
    desktop Spellbook controls, and desktop drag-and-drop remain behaviorally unchanged.
24. Effective page count recomputes safely after item or ability changes, form switches, loadout
    changes, resets, and removals without hiding an occupied mobile page.
25. Touch Add remains available with all 22 hotbar slots occupied, while desktop retains its
    existing full-bar disabled Add behavior.
26. Whole-bar replacement closes the picker before mutation, stale form callbacks cannot write,
    and deterministic focus fallback remains inside the refreshed Spellbook.
27. Setting normalization, canonical same-slot no-op, corrupt duplicate cleanup, tablist keyboard
    behavior, and localized assignment announcement match FR-4.6a and FR-10.

## 13. Phasing and dependency order

1. Preserve or finish the contextual Jump/Use behavior already prepared on
   `mobile-layout-adjustments`.
2. Remove the standalone Autorun control without adding a fallback, then implement the layout
   against the joystick-owned Autorun contract from PR #1724.
3. Replace the radial action ring with the two-row action pad and page seat.
4. Reflow the minimap, target/party frames, compact menu, and player frame.
5. Move Consumables and implement its responsive compact drawer toward the player frame, with the
   3 x 2 larger-tier drawer retained.
6. Add tier, left-handed, scale, safe-area, camera-zone, and overlap validation for landscape.
7. Extend the page pure core to four maximum pages plus configured-minimum and occupied-page
   effective-count resolution.
8. Add the touch Options setting, exact Spellbook assignment model, pure picker placement
   transform, and inline picker presentation.
9. Add focused unit, accessibility, interaction, persistence, and compact picker geometry tests.
10. Integrate PR #1724 before final readiness and resolve only its remaining joystick behavior.
11. Capture visual evidence and run the full contribution gate.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Two-row pad grows into the player frame on 740x360 | Use compact 48px targets, 4px gaps, a 56px Jump/Use face, and real-browser geometry gates. |
| Map-adjacent Party collides with target or menu on a short phone | Keep disclosure, members, and Leave in one narrow row; seat Target below at safe center; audit both rows against every landscape profile. |
| Compact menu relocation duplicates actions or IDs | Reuse one logical action owner and one active DOM element per ID. |
| Minimum Button Size silently shrinks hitboxes | Scale visual faces independently and assert rendered targets at minimum settings. |
| Page gestures steal camera input | Keep paging tap-only on its explicit control and leave wrappers non-interactive. |
| Consumables beside movement is hard to use while steering | Preserve multi-touch operation and keep it a transient utility drawer; do not move it into the camera zone. |
| Left-handed mode receives partial mirroring | Mirror map, Party, menu, camera zone, Consumables, pad, and joystick while keeping Target and player chrome safe-centered. |
| Dependency PR changes while this work is in progress | Re-verify PR #1724 after rebase and keep standalone Autorun explicitly out of scope. |
| A strict page preference hides an assigned action | Treat the preference as a minimum and derive the effective count from the highest occupied mobile page. |
| Page 4 is occupied while page 3 is empty | Keep effective pages contiguous rather than skipping page numbers during combat. |
| Picker movement accidentally swaps shortcuts | Use a separately named pure move-and-overwrite transform and test old-source clearing explicitly. |
| Equipped chips become stale while Spellbook stays open | Refresh from exact hotbar assignment after every mutation with event-driven or write-elided state. |
| Picker overflows the 740x360 Spellbook | Show one five-slot page at a time inside the existing scroll and enforce 48px targets in browser geometry. |
| A whole-bar replacement races an open picker assignment | Close before replacement and validate the captured character/form identity immediately before every picker write. |

## 15. Rejected alternatives

### Keep the radial ring and only shrink Attack

Rejected because it preserves a tall, fragmented camera surface and continues to force
ring-specific collision offsets.

### Make Attack the primary button

Rejected because explicit Attack is a low-frequency state transition while abilities and
Jump/Use are repeated actions.

### Remove explicit Attack

Rejected because manual stop/start, white-hit-only use, and PvP still require it.

### Remove Target and auto-acquire on ability use

Rejected because it changes gameplay and PvP targeting rather than only adapting the layout.

### Swipe anywhere to change action pages

Rejected because open canvas is the camera input surface, and skill-slot swipes conflict with
existing drag behavior.

### Keep the six-slot Consumables row in the top band

Rejected because it competes with the pet bar, menu, minimap, and camera zone. A low compact
drawer that fills from movement toward the player frame (and a 3 x 2 drawer on larger tiers) stays
beside the movement control and remains transient.

### Add a full freeform HUD editor now

Rejected as unnecessary scope. Stable responsive defaults and handedness mirroring come first.

### Count the Consumables drawer as a fourth action page

Rejected because action slots are stable persisted assignments while Consumables are a dynamic
inventory-derived list. Treating them as one mapping would make desktop and mobile slot identity
diverge and would shrink the existing six-item drawer only to manufacture a visual total.

### Add a fifth page for source slots 21 and 22

Rejected because a two-slot final page adds combat paging cost and an inconsistent layout for
little benefit. Slots 21 and 22 remain desktop-only overflow with honest Spellbook state.

### Make Options a strict page-count cap

Rejected because desktop arrangements, loadouts, form bars, and item shortcuts can populate a
higher mobile page. A strict cap would strand assigned actions. The persisted value is a minimum,
and occupied pages always expand the effective count.

### Keep manual Spellbook first-free placement on touch

Rejected for manual Spellbook Add because first-free scans all 22 persisted slots, gives the
player no control over page or A-position, cannot replace a shortcut when the bar is full, and
can place an ability into desktop-only overflow. Manual touch Add uses explicit destination
selection. Existing automatic placement when a new ability is learned remains unchanged under
FR-10.17.

### Confirm before overwriting an occupied shortcut

Rejected because assignment changes only a reversible shortcut, not the learned ability or
owned item. Slot contents and names stay visible in the picker, so an extra confirmation adds
friction without protecting destructive state.

### Show all 20 destinations at once

Rejected because the dense grid competes with Spellbook content on 740x360. Four page tabs and
five destinations preserve the action-pad mental model and the 48px target floor.

## 16. Open questions

No unresolved product decisions remain. Exact standard and tablet pixel values may be tuned
within the constraints above during implementation. Any change to action order, camera-zone
minimums, explicit Attack behavior, menu inventory, target/party topology, Consumables
placement, mobile source-slot range, picker overwrite semantics, or effective-page rules
requires product review and a PRD update before implementation.
