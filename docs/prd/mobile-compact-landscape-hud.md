# PRD: Mobile Touch HUD Layout

| | |
|---|---|
| **Status** | Approved |
| **Owner** | TBD |
| **Created** | 2026-07-10 |
| **Source** | Mobile layout discussion following PR #1731 |
| **Implementation branch** | `mobile-layout-adjustments` |
| **Final integration prerequisite** | Satisfied by [PR #1724: joystick autorun lock](https://github.com/levy-street/world-of-claudecraft/pull/1724), release merge `083856d8c` |
| **Primary surface** | Touch HUD, with compact landscape as the strict reference tier |

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
Standard, tablet, portrait, safe-area, and left-handed layouts may change dimensions and
orientation-specific offsets, but they must preserve the same control relationships and input
semantics.

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

### Non-goals

- No combat balance or simulation changes.
- No removal of explicit Attack.
- No new auto-target-on-ability behavior.
- No expansion beyond the existing mobile source slots 1 through 10.
- No mobile access to desktop source slot 11 or secondary slots 12 through 22 in this scope.
- No player-authored freeform HUD editor.
- No desktop HUD layout changes.
- No reimplementation or fallback standalone Autorun button. PR #1724 owns Autorun inside the
  joystick and must land first.
- No redesign of minimap contents, party data, target data, or Consumables ordering.

## 5. Chosen approach

### 5.1 Right-handed compact landscape topology

The closed resting layout is:

```text
+-----------------------------------------------------------------------+
| [MAP] [TARGET / PARTY]                         [CHAT][QUEST][MORE]     |
|                                                                       |
|                                      +------------------------------+ |
|                                      |      CAMERA START ZONE       | |
|                                      |         swipe-look           | |
|                                      +------------------------------+ |
|                                                                       |
| [MOVE + AUTORUN] [CONS]       [PLAYER]       [A1][A2][ATK][TARGET]  |
|                                           [1/2][A3][A4][A5][JUMP/USE]|
+-----------------------------------------------------------------------+
```

When Consumables is open, its six automatic slots expand upward and inward from the toggle:

```text
                    [C1][C2][C3]
                    [C4][C5][C6]
 [MOVE + AUTORUN] [CONS]
```

The open grid is transient. It must not move the joystick, player frame, action pad, map,
target frame, party controls, or camera start zone.

### 5.2 Action pad order

The fixed visual order is:

```text
       [A1] [A2] [Attack] [Target]
[1/2]  [A3] [A4] [A5]     [Jump/Use]
```

The first page maps A1 through A5 to source slots 1 through 5. The second page maps the same
five visual seats to source slots 6 through 10. The page button remains outside the mapped
ability slots.

Rationale:

- A1 through A5 retain natural reading and source-slot order.
- Target sits directly above Jump/Use, forming the context-action column nearest the action
  thumb.
- Attack remains inside the pad but is visually quieter than abilities, Target, and Jump/Use.
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
| Page 1/2 | Visually compact, subdued page indicator | 48 x 48px |
| Jump/Use | Largest and highest-emphasis action | 56 x 56px |
| Consumables toggle and slots | Standard utility face | 48 x 48px |
| Compact top menu buttons | Standard menu face | 48 x 48px |

The user Button Size setting may scale glyphs, borders, and visible faces, but it must not
reduce the interactive target below 48 x 48px. Adjacent interactive targets require at least
a 4px rendered edge gap.

Standard and tablet tiers may increase visible sizes and gaps. They must not change the
relative order or semantics.

## 6. Functional requirements

### 6.1 Attack

- **FR-1.1** Attack remains a fixed, always discoverable button.
- **FR-1.2** With no live attack target, Attack preserves the existing acquire-nearest path.
- **FR-1.3** With a live target or active auto-attack, Attack preserves the existing toggle
  behavior.
- **FR-1.4** Active auto-attack has a clear persistent visual state that remains visible under
  the player's finger and in forced-colors mode.
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
- **FR-4.2** The explicit page control cycles between source slots 1 through 5 and 6 through 10.
- **FR-4.3** The page indicator shows the current page and page count and exposes the existing
  localized accessible label.
- **FR-4.4** Page switching is tap-only. No swipe gesture may claim open gameplay canvas or the
  whole action-pad container.
- **FR-4.5** Existing long-press drag, cooldown, count, unusable, out-of-range, queued, and used
  feedback remains intact on both pages.

### 6.5 Camera start zone

- **FR-5.1** Every touch tier and orientation reserves a contiguous non-interactive canvas
  rectangle on the action side between the top HUD and action pad.
- **FR-5.2** On every canonical landscape profile, the rectangle is at least
  `min(30vw, 220px)` wide and `min(40vh, 140px)` tall. On every canonical portrait profile,
  it is at least `min(42vw, 160px)` wide and `min(24vh, 200px)` tall.
- **FR-5.3** A pointerdown anywhere in the measured rectangle must pass
  `isCameraDragAllowedAt` when no modal is open. The browser gate samples a 3 x 3 point grid,
  including all four corners, edge midpoints, and center.
- **FR-5.4** The action pad, menu, minimap, target/party frames, Consumables, and any transparent
  wrapper must not occupy or intercept the rectangle.
- **FR-5.5** Once a camera drag begins, existing pointer ownership, pointer capture, 6px
  deadzone, double-tap recenter, and pinch behavior remain unchanged.

### 6.6 Minimap, target, party, and menus

- **FR-6.1** In right-handed touch mode, the minimap sits at the top-left above the movement
  joystick. Compact landscape targets an approximately 80 to 85px rendered map width.
- **FR-6.2** The target frame sits immediately to the right of the map, never between the map
  and movement joystick.
- **FR-6.3** Party is collapsed by default to its existing Party chip below the target frame.
  Expanded party rows grow toward the center and downward only where geometry remains clear.
- **FR-6.4** Expanded party rows must not overlap the map, movement capture zone, Consumables,
  player frame, action pad, or camera start zone.
- **FR-6.5** Compact touch layouts show Chat, Quests, and More in the top corner opposite the
  minimap.
- **FR-6.6** Social and Settings remain reachable through More on compact layouts. Their actions
  must have one logical owner and no duplicate active element IDs.
- **FR-6.7** Standard and tablet touch layouts may show all five current direct menu actions if
  they pass the same geometry and camera-zone constraints.

### 6.7 Joystick and Autorun dependency

- **FR-7.1** The movement joystick remains in its current thumb corner.
- **FR-7.2** Autorun is provided only by the joystick interaction from PR #1724.
- **FR-7.3** The layout contains no standalone Autorun seat, markup, label, or collision rule.
- **FR-7.4** Layout work may proceed before PR #1724 merges, but the old standalone button must
  be removed immediately and no temporary Autorun fallback may be added.
- **FR-7.5** Final implementation readiness requires integration with PR #1724 and verification
  of its joystick-owned Autorun markup, wiring, reset behavior, and geometry.

### 6.8 Consumables

- **FR-8.1** The closed Consumables toggle sits immediately inward of the movement joystick,
  outside its fixed capture zone.
- **FR-8.2** Opening the toggle snapshots up to six distinct carried items using the existing
  order: potion, elixir, food, drink. Duplicate stacks remain one visible slot.
- **FR-8.3** The open items use a 3 x 2 grid that grows upward and inward.
- **FR-8.4** Empty slots collapse. Counts, usability, and potion cooldown continue updating
  live while item positions remain stable until the drawer is reopened.
- **FR-8.5** Long press continues to inspect an item instead of consuming it.
- **FR-8.6** The drawer has no duplicate automatic potion shortcut near the action pad.
- **FR-8.7** A second touch can operate Consumables while the movement joystick owns another
  pointer.

### 6.9 Player frame

- **FR-9.1** The player frame remains bottom-center.
- **FR-9.2** The new pad should remove the need for the current ring-specific 15px and 44px
  compact left nudges. If a safe-area profile requires a residual adjustment, it must be the
  smallest measured offset and keep the frame visually centered.
- **FR-9.3** Cast and swing bars remain aligned with the player frame.

## 7. Responsive and handedness behavior

### Compact landscape

- Reference profiles: 740x360, 844x390, 915x412, and 932x430.
- Uses the exact two-row action order in section 5.2.
- Uses the three-action compact menu.
- Uses the 3 x 2 Consumables drawer.
- Enforces the camera rectangle in FR-5.2.

### Standard and tablet landscape

- Preserve the same action-pad order and side ownership.
- Increase visible button sizes and gaps through named tier variables.
- May expose all five direct menu controls if the pet bar, minimap, and camera zone remain clear.
- Enforce the landscape camera rectangle in FR-5.2.
- Do not return to a radial topology.

### Portrait touch

- Preserve the action order and context-action column.
- Reflow or lift the pad above the bottom-center player frame without changing button order.
- Use the compact three-action menu unless a measured profile proves all five controls fit.
- Enforce the portrait camera rectangle in FR-5.2.

### Left-handed touch

Mirror the topology as one system:

- Movement joystick and integrated Autorun move to bottom-right.
- Minimap moves above the movement joystick at top-right.
- Consumables moves inward to the left of the joystick and opens upward and inward.
- Action pad moves to bottom-left.
- Camera start zone moves to middle-left above the pad.
- Compact menu moves to top-left.
- Target/party frames sit inward of the mirrored minimap.
- The page control remains farthest from the action thumb after mirroring.

No mirrored mode may change action semantics, source-slot mapping, or touch target size.

## 8. Technical design constraints and hook points

### Markup and wiring

- `index.html` and `play.html` must carry identical control inventory and ordering.
- Preserve one element each for Attack, Target, Jump/Use, page switching, and every ability
  slot. Do not solve compact menu relocation with duplicate IDs.
- Keep touch handlers on the existing multi-touch-safe `bindTouchTap` path.

### Presentation

- Replace the radial trigonometric seat rules in `src/styles/hud.mobile.css` with a named
  two-row pad topology, preferably CSS grid or explicit grid areas.
- Define tier sizes, gaps, map size, camera-zone geometry, and safe-area anchors through named
  CSS custom properties.
- Keep pad and utility wrappers `pointer-events: none`; enable pointer events only on actual
  buttons. Transparent layout boxes must remain camera-draggable.
- Separate visible face scaling from the interactive hitbox.

### Existing pure and painter seams

- Keep page arithmetic in `src/ui/mobile_action_page_view.ts`.
- Keep ability and item state in the shared action-bar view and painter family.
- Keep dynamic Jump/Use and page accessible copy in `src/ui/mobile_action_ring_painter.ts`, or
  rename the module if the ring name becomes materially misleading without changing its pure
  responsibilities.
- Keep nearby interaction resolution in `src/game/interactions.ts`.
- Keep touch ownership and camera eligibility in `src/game/touch_router.ts` and
  `src/game/mobile_controls.ts`.
- Keep responsive tier resolution in `src/ui/mobile_hud_layout.ts`.
- Keep Consumables ordering in `src/ui/consumable_bar_view.ts`.

### Settings and state

- Existing left-handed, button-size, joystick-size, camera-joystick, haptics, and touch-opacity
  settings remain supported.
- Page and Consumables open state remain session state unless a separate requirement adds
  persistence.
- No graphics or performance tier may hide actionable information or change hitboxes.

## 9. Accessibility and feedback

- Every gameplay control must retain a localized accessible name and title where currently
  provided.
- Jump/Use must update visible label, title, and accessible name together.
- Page copy must announce the page number and count.
- Attack active state must not rely on color alone.
- All controls require visible press feedback. Existing audio and haptic behavior remains.
- `prefers-reduced-motion` removes nonessential transitions without changing layout or state.
- Forced-colors mode retains button boundaries, focus indication, and Attack active state.
- User scale settings must not reduce hitboxes below the required rendered floor.

## 10. Performance requirements

- No new per-frame layout reads such as `getBoundingClientRect` in HUD update paths.
- Dynamic painters keep write-elision and allocation-light state.
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
- Preserve and extend `tests/mobile_controls.test.ts`, `tests/touch_router.test.ts`, and
  `tests/interactions.test.ts` for multi-touch ownership and contextual actions.
- Preserve `tests/consumable_bar_view.test.ts` ordering, cap, and stable snapshot behavior.
- Update `tests/browser/target_size.browser.test.ts` to exercise minimum user scale and assert
  the 48px rendered gameplay-control floor.

### Geometry and browser checks

- Update `scripts/mobile_cluster_layout_check.mjs` and
  `scripts/mobile_hud_overlap_audit.mjs` for the new inventory and geometry.
- Add a measured camera-start rectangle assertion using the same real browser geometry.
- Replace the implicit profile set with the canonical matrix below.
- Assert every control remains on-screen, at least 48 x 48px, and at least 4px from adjacent
  controls.
- Assert no interactive element or wrapper intercepts the camera-start rectangle.

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
| iPhone 13 portrait | 390x844 | compact |
| Tablet 4:3 portrait | 768x1024 | standard |
| Large tablet portrait | 1024x1366 | tablet |

Synthetic safe-area vectors use `{ top, right, bottom, left }` CSS pixels:

| Vector | Insets |
|---|---|
| None | `{ 0, 0, 0, 0 }` |
| Landscape notch right | `{ 0, 44, 21, 0 }` |
| Landscape notch left | `{ 0, 0, 21, 44 }` |
| Portrait notch | `{ 47, 0, 34, 0 }` |

Required state runs are bounded rather than a full Cartesian product:

1. Every canonical viewport runs right-handed and left-handed baseline states with default
   scale, camera joystick off, Consumables closed, party collapsed, no pet, and no safe inset.
2. The 740x360 profile runs right-handed and left-handed minimum button and joystick scales to
   enforce the rendered touch floor.
3. The 740x360 profile runs right-handed maximum button and joystick scales with camera joystick
   on, Consumables open, party expanded, pet active, and the landscape notch-right vector.
4. The same maximum 740x360 stress state runs left-handed with the landscape notch-left vector.
5. The 390x844 profile runs both handedness modes with the portrait-notch vector, once at
   default scale and once at minimum scale.
6. Consumables open and closed, party collapsed and expanded, and pet absent and active are
   therefore each covered in both handedness directions on the strictest phone profile.

### Visual QA

Commit before and after screenshots under `docs/screenshots/` for at least:

- 740x360 compact landscape, resting state.
- 740x360 compact landscape, Consumables open.
- 844x390 compact landscape with a target and party.
- Left-handed compact landscape.
- Portrait phone.
- 1024x768 tablet landscape.

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
5. Page 1 maps source slots 1 through 5 and page 2 maps 6 through 10.
6. The page button sits left of A3 and does not create a camera gesture.
7. Every canonical landscape and portrait camera-start rectangle meets FR-5.2 and is
   camera-draggable at every point in the required 3 x 3 sample grid.
8. Minimap, target, party, menu, player frame, pad, joystick, and Consumables pass all overlap
   checks in every canonical profile and state.
9. Compact menu exposes Chat, Quests, and More directly; Social and Settings remain reachable
   through More.
10. The implementation base contains the integrated joystick Autorun behavior from PR #1724
    and contains no standalone Autorun markup, handler, or layout seat.
11. Consumables remains automatic and opens as a stable 3 x 2 grid beside the joystick.
12. Right-handed and left-handed layouts are complete mirrors with identical semantics.
13. Every gameplay touch target remains at least 48 x 48px at minimum user scale.
14. All controls remain reachable with safe-area insets and optional camera joystick enabled.
15. `index.html` and `play.html` remain structurally equivalent for touch controls.
16. Desktop layout and behavior remain unchanged.
17. Required screenshots are committed and the contribution gate passes.

## 13. Phasing and dependency order

1. Preserve or finish the contextual Jump/Use behavior already prepared on
   `mobile-layout-adjustments`.
2. Remove the standalone Autorun control without adding a fallback, then implement the layout
   against the joystick-owned Autorun contract from PR #1724.
3. Replace the radial action ring with the two-row action pad and page seat.
4. Reflow the minimap, target/party frames, compact menu, and player frame.
5. Move Consumables and implement its 3 x 2 responsive drawer.
6. Add tier, portrait, left-handed, scale, safe-area, camera-zone, and overlap validation.
7. Integrate PR #1724 before final readiness and resolve only its remaining joystick behavior.
8. Capture visual evidence and run the full contribution gate.

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Two-row pad grows into the player frame on 740x360 | Use compact 48px targets, 4px gaps, a 56px Jump/Use face, and real-browser geometry gates. |
| Moving the map creates target or party overlap | Treat map, target, party, and Consumables-open states as one audited top-left geometry system. |
| Compact menu relocation duplicates actions or IDs | Reuse one logical action owner and one active DOM element per ID. |
| Minimum Button Size silently shrinks hitboxes | Scale visual faces independently and assert rendered targets at minimum settings. |
| Page gestures steal camera input | Keep paging tap-only on its explicit control and leave wrappers non-interactive. |
| Consumables beside movement is hard to use while steering | Preserve multi-touch operation and keep it a transient utility drawer; do not move it into the camera zone. |
| Left-handed mode receives partial mirroring | Mirror map, menu, target/party, camera zone, Consumables, pad, and joystick in one audited state. |
| Dependency PR changes while this work is in progress | Re-verify PR #1724 after rebase and keep standalone Autorun explicitly out of scope. |

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

Rejected because it competes with the pet bar, menu, minimap, and camera zone. A 3 x 2 drawer
uses less horizontal space and remains transient.

### Add a full freeform HUD editor now

Rejected as unnecessary scope. Stable responsive defaults and handedness mirroring come first.

## 16. Open questions

No unresolved product decisions remain. Exact standard and tablet pixel values may be tuned
within the constraints above during implementation. Any change to action order, camera-zone
minimums, explicit Attack behavior, menu inventory, target/party topology, or Consumables
placement requires product review and a PRD update before implementation.
