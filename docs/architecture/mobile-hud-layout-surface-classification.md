# Mobile HUD layout surface classification

This document is the decision contract for adding or changing a surface or preview state in the
mobile custom HUD editor. Read it together with the product spec in
`docs/specs/2026-07-11-mobile-custom-hud-layout-editor.md` and the typed registry in
`src/ui/mobile_hud_registry.ts`.

## Core rule

The editor protects access to interactive controls. It does not reserve empty screen rectangles
for text, click-through information, transient messages, or foreground popup UI.

Every new surface must be classified from its real DOM behavior before its descriptor is added:

| Classification | Registry representation | Pair collision | Bounds and scale | Editor presentation |
|---|---|---|---|---|
| Interactive HUD | No `overlapPolicy` | Blocking on the real interactive footprint | Blocking | Real visual, or an empty placeholder |
| Informational overlay | `overlapPolicy: 'informational-overlay'` | Non-blocking | Blocking | Movable real visual or placeholder; click-through above controls |
| Foreground overlay | Protected surface with `overlapPolicy: 'foreground-overlay'` | Non-blocking | No player placement | Not a dropdown variant; runtime popup owns foreground stacking |
| Decorative text outside an interactive base | Excluded by `primaryFootprint` | Non-blocking outside the base | Base remains bounded | Outline only the base |
| Transient expansion | Base in `primaryFootprint`, expansion in layout bounds | Expansion does not collide | Expansion remains viewport-bound | Outline the base; expansion may paint above HUD |

## Three geometry contracts

Never reuse one rectangle for all editor responsibilities. Each movable surface has three separate
geometry contracts:

1. `primaryFootprint` is the blocking interactive region used by collision validation. It follows
   real buttons, pointer targets, and listeners, including transparent touch padding when that
   padding receives input.
2. The editor frame is the union of currently painted fragments from `editorGeometrySelectors` and
   `editorPseudoGeometry`. It follows visible art, borders, bars, icons, and registered pseudo
   elements. It does not expand to transparent touch padding.
3. The outer editor proxy is the invisible selection and drag target. It contains the painted
   frame and remains at least 48 by 48 CSS pixels without changing the frame.

Dynamic validation variants remain conservative and independent from the live frame. Empty or
hidden content uses `editorFallbackFootprint`, which must describe one representative painted state,
not the worst-case collision envelope. `runtimeSizing` separately decides whether CSS receives the
validation size, the stable base size, or intrinsic content sizing.

Pseudo-element artwork must be declared explicitly. `editorPseudoGeometry` resolves its computed
border box and transform relative to the real host. Do not replace a pseudo face with the host
button rect: action buttons and the Player XP ring intentionally paint outside or inside their
transparent roots.

Absence of `overlapPolicy` deliberately means blocking. Do not add a blanket exception merely to
make Save succeed. First inspect the actual element tag, descendants with `pointer-events: auto`,
click/touch listeners, focusability, and stacking context.

## Interaction audit procedure

For every proposed surface:

1. Find the runtime root and every interactive descendant. Check HTML/DOM creation code, not only
   CSS. A `div` with a nested button is mixed interactive UI.
2. Inspect `pointer-events`, focusability, click/touch listeners, and the effective mobile stacking
   layer.
3. Define the smallest stable `primaryFootprint` containing every interactive descendant. Text and
   decoration outside it may overlap other HUD.
4. If the whole surface is click-through information, use `informational-overlay`. Keep safe-area,
   bounds, and scale validation.
5. If the surface is a temporary popup that intentionally covers gameplay HUD, use a protected
   `foreground-overlay`. Do not expose it as a separate layout preview.
6. If the live DOM may be absent or empty outside gameplay, set
   `binding.editorPlaceholderWhenEmpty` and normally
   `binding.editorPlaceholderUsesLayoutFootprint`. The placeholder must disappear when the real
   visual exists.
7. Add focused model, registry, and browser tests for the interactive footprint, painted frame, and
   outer proxy independently. Do not rely on a screenshot alone.

Mixed surfaces require special care. Protect Yumi is the reference: its status text is
click-through, but `.yh-toggle` is interactive. The descriptor therefore blocks only the 40 by 40
toggle through `primaryFootprint`; the empty editor placeholder still uses the full strip footprint.

## Dropdown rule

The runtime resolver and Save matrix retain all reachable contexts. The dropdown is smaller: it
contains one representative for each unique set of editable context-specific surfaces after
foreground overlays are ignored.

Do not add a dropdown option just because a new runtime context exists. Add one only when its
editable surface signature differs from every existing representative. Update
`MOBILE_HUD_EDITOR_CONTEXT_ALIASES`, and keep the unique-signature regression in
`tests/mobile_hud_registry.test.ts` green.

Current mapping:

| Runtime context | Dropdown representative | Distinct layout content or reason for alias |
|---|---|---|
| `world.base` | `world.base` | Shared World HUD |
| `world.vale_cup_indicator` | itself | Interactive Vale Cup indicator button |
| `arena.standard` | itself | Movable informational Arena status |
| `arena.fiesta.base` | itself | Arena status plus Fiesta score |
| `arena.fiesta.pending` | itself | Adds Fiesta pending status |
| `arena.fiesta.respawn` | `arena.fiesta.base` | Respawn text is foreground overlay; editable status set is unchanged |
| `arena.fiesta.offer` | `arena.fiesta.base` | Augment cards are foreground popup UI |
| `arena.fiesta.respawn_offer` | `arena.fiesta.base` | Combination of the same two foreground overlays |
| `arena.yumi.base` | itself | Yumi status with interactive collapse toggle |
| `arena.yumi.respawn` | `arena.yumi.base` | Respawn countdown is foreground overlay |
| `arena.yumi.returning` | `arena.standard` | Uses the same generic Arena status surface |
| `vale_cup.briefing` | `world.base` | Full-screen foreground briefing owns its own stacking |
| `vale_cup.match` | itself | Movable informational match status |
| `vale_cup.match.charge` | itself | Adds the movable informational charge meter |
| `vale_cup.spectator.betting` | `world.base` | Interactive betting card is foreground popup UI |
| `instance.delve` | itself | Movable informational Delve tracker |

The nine current dropdown representatives are therefore World, World with Vale Cup indicator,
Arena Standard, Fiesta Match, Fiesta Pending, Yumi Match, Vale Cup Match, Vale Cup Charge, and
Delve.

## Current policy inventory

Informational overlays are Player Buffs, Player Debuffs, Arena status, Fiesta score, Fiesta pending,
Vale Cup match status, Vale Cup charge, and Delve tracker. They paint above ordinary controls but
must be click-through on mobile. The runtime DOM applier marks these roots with
`data-mobile-hud-overlap-policy="informational-overlay"`; CSS owns their foreground visual layer
and disables pointer events on the root and descendants.

Foreground overlays are Fiesta respawn, Fiesta augment offer, Yumi respawn, Vale Cup briefing,
Vale Cup betting, and center messages. They never create player-repairable layout errors.

Interactive context UI currently consists of the Vale Cup indicator and the Yumi collapse toggle.
Actions, menus, joysticks, frames, Party, Pet commands, Consumables toggle, and the minimap retain
normal blocking behavior. In Edit Mode, informational proxies stay below interactive proxies even
though their live visuals paint above them. This preserves selection of an underlying button such
as Target without hiding the information.

## Required regression coverage

- `tests/mobile_hud_context.test.ts`: canonical runtime contexts and editor aliases.
- `tests/mobile_hud_registry.test.ts`: unique dropdown signatures, overlap policies, placeholders,
  and registry invariants.
- `tests/mobile_hud_editor_core.test.ts`: blocking versus non-blocking collisions and primary
  footprints.
- `tests/mobile_hud_editor.test.ts`: dropdown contents and context normalization.
- `tests/browser/mobile_hud_editor.browser.test.ts`: real CSS visibility, placeholder selection,
  and live-visual replacement.

The complete geometry matrix must still contain all 16 runtime contexts. Reducing the dropdown
must never reduce Save/load/runtime validation coverage.
