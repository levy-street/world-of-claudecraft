# Mobile HUD Readability Adjustments

## Goal

Improve the mobile combat HUD shown in the supplied gameplay screenshot without changing desktop
layout or control behavior:

1. Place the existing transient mob inspection description below the minimap instead of over or
   beside it. This is the world-hover or mobile center-inspection tooltip visible in the supplied
   screenshot, not a new persistent selected-target panel.
2. Make the player and target frames easier to read across compact, standard, and tablet landscape
   touch tiers.
3. Show up to six expanded Consumables as three columns by two rows beside their disclosure button
   on every landscape tier.

## Chosen approach

Reuse the existing responsive tier variables and geometry gate instead of adding fixed per-device
pixel rules.

- Initial landscape player-frame scale targets are `0.72` on compact, `1.0` on standard, and `1.1`
  on tablet before the shared mobile chrome scale. The geometry matrix may tune a target downward
  to the smallest value that satisfies every clearance while still meeting the outcome-based
  minimum readable widths below.
- The initial target ratio is `0.9` of the active player-frame tier scale. The geometry matrix may
  tune it within `0.86` through `0.9`; it grows with the player frame but remains visually
  subordinate.
- Cast and swing bars continue using the player-frame scale and safe center.
- Compact Consumables use the existing inward `row wrap-reverse` flow with a 152px three-column
  width. Items 1 through 3 occupy the lower row beside the disclosure; items 4 through 6 wrap to
  the upper row. The complete compact group, including the disclosure, initially targets
  `calc(68px + env(safe-area-inset-bottom))`; the final inset is the lowest measured value that
  keeps at least 4px from every actionable neighbor and remains safe-contained.
- Standard and tablet Consumables keep their current three-column by two-row topology.
- The mobile mob tooltip is positioned from the rendered minimap rectangle in JavaScript. Its top
  edge is the minimap bottom plus an 8px visual gap. Its horizontal edge follows the minimap and
  mirrors in left-handed mode, then clamps inside the visual viewport. Desktop positioning is
  unchanged.

This is the direct implementation of the user's requested layout. Existing compact two-column by
three-row behavior is superseded.

## Alternatives considered

### Keep the compact disclosure at the current bottom inset

Rejected. A three-column drawer reaches into the centered player frame at 740 by 360, and enlarging
the frame makes the collision worse.

### Use one fixed scale and fixed coordinates for every phone

Rejected. It would make the screenshot viewport look larger while regressing short phones, safe
areas, tablets, and left-handed mirroring.

### Keep two columns only on the smallest phone

Rejected. It preserves collision safety but contradicts the requested two-row Consumables layout.

## Scope

In scope:

- Mobile touch landscape tiers: compact, standard, and tablet.
- Right-handed and left-handed mirroring.
- Safe-area insets and the existing UI, button, and chrome scale system.
- Source contracts, rendered geometry checks, and refreshed compact reference screenshots.

Out of scope:

- Desktop HUD geometry.
- Portrait gameplay, which remains behind the existing rotate-device gate.
- Target selection behavior, the hover or center-inspection trigger and lifetime, tooltip contents,
  player-frame contents, combat math, or Consumables ordering.
- New settings or per-device preferences.

## Technical design

### Target description

`Hud.paintMobTooltipBottomRight()` continues to own initial inline positioning because `#tooltip`
is a shared element and the minimap rectangle is only known at runtime. The existing
`showMobHoverTooltip()` trigger and `clearMobHoverTooltip()` lifetime remain unchanged. Selecting or
cycling a target does not create a new description.

The positioning helper works in visual pixels, then converts the final coordinates to the
author-space used by the zoomed `#ui`:

- `z = getUiScale()`.
- `tooltipVisualWidth = tooltip.offsetWidth * z`.
- `topVisual = minimapRect.bottom + 8`.
- Right-handed desired left is `minimapRect.left`.
- Left-handed desired left is `minimapRect.right - tooltipVisualWidth`.
- The desired left clamps between `8` and
  `window.innerWidth - tooltipVisualWidth - 8` visual pixels. Because the minimap itself already
  resolves `env(safe-area-inset-*)`, aligning to its handed edge inherits the active side inset.
- Inline author coordinates are `leftVisual / z` and `topVisual / z`.

Positioning is not tied only to tooltip content. While the tooltip is visible, a lightweight
layout invalidation path repositions it after viewport resize/orientation, a relevant mobile tier
or `mobile-left-handed` class change, `--ui-scale` or `--tooltip-scale` change, and a rendered
minimap resize. Use event, mutation, and resize observers or existing layout callbacks; do not add
`getBoundingClientRect()` to the per-frame unchanged-content path. Safe-area emulation tests dispatch
the same viewport/layout invalidation used by the app.

Long localized or quest-heavy content remains supplemental, non-interactive information with
`pointer-events: none`. At each positioning pass, compute the first vertically lower obstacle whose
rectangle horizontally intersects the tooltip lane: visible movement control, Consumables group,
player/target/party chrome, or viewport safe bottom. Set the tooltip maximum author height from the
visual gap to that obstacle with at least 4px clearance. Overflow is clipped with a visible bottom
fade, never made scrollable. The title and level/family lines remain first and visible; extreme
content or text-scale combinations may clip trailing quest lines. The target frame and quest log
remain the accessible and complete interaction surfaces.

### Responsive frames

The final mobile topology block in `hud.mobile.css` remains the single source of tier values. The
player frame, cast bar, and swing bar consume the same `--mobile-player-frame-scale`. Landscape
Target continues to derive from that value through `--mobile-target-frame-ratio`. Geometry tests
assert monotonic tier scales, safe centering, minimum rendered widths, target-to-player ordering,
and bar widths/gaps. Exact constants are recorded by the gate after collision tuning rather than
being accepted without measurement.

### Consumables

The base three-column by two-row implementation remains unchanged. The compact override changes
from a 100px two-column wrap to a 152px three-column wrap and retains `wrap-reverse`, so visible
slots collapse without leaving grid holes and the first populated row stays beside the disclosure.
For one through three populated items, only the lower row is used. For four or five, items 1 through
3 remain in the lower row and the remainder begins the upper row. Left-handed mode reverses the
inline direction while preserving this item order. The whole compact group uses the higher bottom
inset rather than lifting only the items above a low disclosure.

## Risks and mitigations

- Compact overlap: measure the 740 by 360 profile with player, cast, swing, joystick, and all six
  Consumables visible. The group inset is accepted only if every gap is non-negative and actionable
  controls keep the repository minimum gap.
- Long target descriptions: verify a deterministic populated quest description at minimum and
  maximum tooltip scale. The non-interactive clipped overflow policy must preserve the heading and
  keep 4px from actionable controls.
- Safe-area asymmetry: derive horizontal placement from rendered rectangles and run both notch
  vectors instead of adding separate device offsets.
- Larger frames can reduce world view: use monotonic tier values and keep Target smaller than the
  player frame.

## Acceptance criteria

1. On every canonical landscape profile, the transient mob inspection description begins 8px in
   visual coordinates below the minimap, remains inside the visual viewport, and never covers the
   minimap. Its trigger and lifetime remain unchanged.
2. The description mirrors with the minimap in left-handed mode and keeps at least 4px from Party,
   Target, the movement control, visible Consumables, and the guaranteed camera-start zone. The
   same visible tooltip repositions after resize, handedness, tier, UI-scale, and tooltip-scale
   changes even when its content key is unchanged.
3. Player-frame tier scales increase monotonically and produce rendered widths of at least 180px
   compact, 250px standard, and 275px tablet at the default shared chrome scale. Exact scale values
   are the smallest tuned constants that pass the complete geometry matrix.
4. Target uses between `0.86` and `0.9` of the active player tier and remains narrower than the
   player frame.
5. Player and Target remain centered within the safe viewport width. Cast and swing bars match the
   player-frame width and retain their existing vertical gaps.
6. One through six expanded Consumables use at most three columns and exactly one or two rows on
   every landscape tier. Six items render as exactly three columns by two rows.
7. On compact, items 1 through 3 fill the lower row beside the disclosure and items 4 through 6
   fill the upper row. Partial populations do not leave holes. Left-handed mode mirrors the inline
   direction without changing the logical order.
8. Consumables keep at least 4px from the movement zone, player frame, cast bar, swing bar, action
   pad, and safe-area edge across every canonical profile and all supported scale extremes.
9. Every Consumables control retains its 48 by 48px hitbox and current button-scale behavior.
10. Desktop positioning and all input behavior remain unchanged.
11. `scripts/mobile_cluster_layout_check.mjs` measures the tooltip, six Consumables, player/target
    frames, cast/swing bars, and actionable neighbors across all seven canonical profiles, both
    handedness modes, both notch vectors, Button Size `0.8`, `1.0`, and `1.3`, UI-scale extremes,
    tooltip scale `0.85` and `1.5`, and the existing populated pet/party/camera states. It includes
    same-content resize and mirroring checks plus a deterministic long quest tooltip.
12. Source contracts in `tests/client_shell.test.ts`, target-size browser tests, TypeScript check,
    production build, and the real-browser geometry gate pass.
13. `mobile_hud_layout_shots.mjs` seeds six distinct Consumables and the actual transient tooltip
    trigger. Compact right-handed and left-handed notch screenshots visibly prove the new layout.

## Open questions

None. The supplied screenshot and numbered requirements select the final topology. Exact scale and
compact inset constants remain tunable only within the outcome constraints above.
