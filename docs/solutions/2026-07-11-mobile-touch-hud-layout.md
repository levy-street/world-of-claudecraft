# Mobile Touch HUD Layout

## Context

The compact landscape HUD now treats camera control as a first-class input surface instead of filling both lower corners with controls. Movement stays on one side, the opposite side remains available for swipe-look or an optional view joystick, and the two-row action pad places contextual Jump/Use ahead of the less frequently used Attack action. The minimap, direct menu, Party, Target, player frame, pet controls, and Consumables drawer were reflowed around those input zones.

This work follows the contextual interaction slice documented in [Mobile Context Interact](2026-07-10-mobile-context-interact.md), implements the approved [Mobile Touch HUD Layout PRD](../prd/mobile-compact-landscape-hud.md), and integrates the joystick Autorun and portrait gate already present on `release/v0.24.0`.

## What We Learned

- A touch HUD cannot be validated from isolated control rectangles. The useful invariant is a complete populated topology: Party expanded, Target active, pet commands visible, Consumables open, maximum control scale, safe-area insets, and both handedness modes.
- Consumables need behavioral geometry assertions, not only screenshot coverage. Tests now pin the low disclosure seat, the inward expansion direction, the upward wrap order, the movement gap, safe-area mirroring, and separation from the player frame and cast bars.
- A hidden mobile window may retain stale inline `display: none` state after its body class is reopened. Opening More must clear that inline close state, and global window-close handling must understand the body-owned `mobile-more-open` state.
- Browser harnesses must close one-off windows such as Loot Settings before measuring gameplay chrome. Otherwise the audit is testing a modal state rather than the intended HUD topology.
- Release integration needs semantic conflict resolution. Keeping the release's comprehensive overlap audit, portrait gate, and joystick Autorun behavior was more important than choosing either textual side of the conflicts wholesale.
- The repository's parallel full suite can exceed its five-second per-test timeout under contention. The three observed timeouts passed 103/103 when rerun with one worker, so isolated reruns are useful evidence, but a fresh canonical gate remains the final signal.
- Generated localization state must be regenerated and checked with the repository scripts after a release merge. The merged baseline briefly produced a stale summary and a malformed two-line resolved hash even though the locale tables were equivalent.

## Decisions

- Keep the action pad ordered as A1/A2 Attack Target and A3/A4/A5 contextual Jump/Use, with the infrequently used page switch beside A3.
- Keep the movement joystick slightly compact and leave the opposite lower side as the camera view zone; show the optional view joystick only when enabled.
- Place the Consumables disclosure immediately inward of the movement zone. Open items toward the hero frame, then wrap upward, and mirror the whole topology in left-handed mode.
- Keep Party in one compact top row beside the minimap, use an icon-only Leave Party control with a full touch target, and keep Target centered one row below and smaller than the player frame.
- Place pet commands above the action pad without desktop panel chrome.
- Treat landscape phone and tablet layouts as the supported gameplay surfaces in this change. Portrait gameplay is gated by the integrated release behavior and is outside this layout's acceptance scope.

## Follow-ups

- Use the committed compact, Party/Target, tablet, Consumables, and left-handed screenshots in the draft PR.
- Keep the rendered mobile cluster matrix and strict overlap audit in the contribution gate whenever future HUD work changes anchors, safe-area math, or touch targets.
