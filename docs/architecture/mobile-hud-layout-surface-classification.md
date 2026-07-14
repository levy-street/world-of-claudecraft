# Mobile HUD layout surface classification

This document is the decision contract for adding or changing a surface or preview state in the
mobile custom HUD editor. Read it together with the product spec in
`docs/specs/2026-07-11-mobile-custom-hud-layout-editor.md` and the typed registry in
`src/ui/mobile_hud_registry.ts`.

## Core rule

The editor lets the player place registered surfaces freely. Movable surfaces may overlap other
movable surfaces, the View region, protected UI, and safe-area or viewport boundaries. Those
positions never mark a surface red, disable Save, reject a stored profile, or trigger runtime
fallback. This is deliberate: strict geometric enforcement was implemented and device-tested, but
the interaction footprints, dynamic states, mirrored layouts, and runtime DOM frequently disagreed
in ways that made valid player layouts impossible to save or silently restored defaults.

Validation remains blocking only for malformed placement data, unsupported descriptor
capabilities, scale outside the descriptor range, and an interactive target below its minimum
usable size. Safe-area measurement remains for notch-aware anchor defaults and for keeping the
editor's own palette reachable. It is not a player-layout boundary.

Every new surface must be classified from its real DOM behavior before its descriptor is added:

| Classification | Registry representation | Player overlap | Position and scale | Editor presentation |
|---|---|---|---|---|
| Interactive HUD | No `overlapPolicy` | Allowed | Position unrestricted; scale and target floor validated | Real visual or empty placeholder with one exact selectable frame |
| Informational overlay | `overlapPolicy: 'informational-overlay'` | Allowed | Position unrestricted; scale validated | Movable real visual or placeholder with one exact selectable frame; click-through above controls |
| Foreground overlay | Protected surface with `overlapPolicy: 'foreground-overlay'` | Non-blocking | No player placement | Not a dropdown variant; runtime popup owns foreground stacking |
| Decorative text outside an interactive base | Excluded by `primaryFootprint` | Allowed | Position unrestricted | Outline only the base |
| Interactive state expansion | Complete maximum interactive footprint, or a bounded scroll viewport containing every reachable control | Allowed | Position unrestricted; scale and target floor validated | Show the live state or bounded viewport through the exact selectable frame |

## Three geometry contracts

Never reuse one rectangle for all editor responsibilities. Each movable surface has three separate
geometry contracts:

1. `primaryFootprint` is the runtime interactive region used for target-size validation. It follows
   real buttons, pointer targets, and listeners, including transparent touch padding when that
   padding receives input. A dynamic surface either describes its complete maximum interactive
   state or constrains all states to a registered scroll viewport and describes that viewport.
2. The editor frame is the union of currently painted fragments from `editorGeometrySelectors` and
   `editorPseudoGeometry`. It follows visible art, borders, bars, icons, and registered pseudo
   elements. A bounded scroll surface measures its viewport root, never clipped offscreen children.
   It does not expand to transparent touch padding.
3. The outer editor proxy is the invisible selection and drag target. It covers the complete
   painted frame, even when runtime text is click-through or `primaryFootprint` is smaller, and
   remains at least 48 by 48 CSS pixels without changing the frame.

Earlier WIP builds added a separate pointer-through layout envelope for registered worst-case
footprints. Device testing showed that extra rectangle often disagreed with the live HUD and became
misleading after overlap blocking was removed, so it is no longer part of the editor UI. Empty or
hidden content uses `editorFallbackFootprint`, which must describe one representative painted state.
A binding with `editorPlaceholderUsesLayoutFootprint` deliberately uses the registered layout size
for its empty placeholder. `runtimeSizing` separately decides whether CSS receives the validation
size, the stable base size, or intrinsic content sizing.

Pseudo-element artwork must be declared explicitly. `editorPseudoGeometry` resolves its computed
border box and transform relative to the real host. Do not replace a pseudo face with the host
button rect: action buttons and the Player XP ring intentionally paint outside or inside their
transparent roots.

`overlapPolicy` controls runtime pointer events and stacking only. Its absence does not imply
player-layout collision enforcement. Inspect the actual element tag, descendants with
`pointer-events: auto`, click/touch listeners, focusability, and stacking context so the preview
and target-size checks still describe the real control.

## Interaction audit procedure

For every proposed surface:

1. Find the runtime root and every interactive descendant. Check HTML/DOM creation code, not only
   CSS. A `div` with a nested button is mixed interactive UI.
2. Inspect `pointer-events`, focusability, click/touch listeners, and the effective mobile stacking
   layer.
3. Define the smallest stable interactive footprint containing every interactive descendant in
   every supported state. Use `primaryFootprint` only when click-through content genuinely sits
   outside that interactive region. Expanded trays, satellite buttons, and transparent gesture capture
   zones count when they can receive input. A bounded scroll viewport is valid only when every
   offscreen control remains reachable inside it. Text and decoration outside it may overlap other
   HUD. The footprint is informative and supports target-size checks; it does not reserve space.
4. If the whole surface is click-through information, use `informational-overlay`. Keep scale
   validation, but do not add overlap or safe-area blocking.
5. If the surface is a temporary popup that intentionally covers gameplay HUD, use a protected
   `foreground-overlay`. Do not expose it as a separate layout preview.
6. If the live DOM may be absent or empty outside gameplay, set
   `binding.editorPlaceholderWhenEmpty` and normally
   `binding.editorPlaceholderUsesLayoutFootprint`. The placeholder must disappear when the real
   visual exists. Do not add a separate layout envelope.
7. Add focused model, registry, and browser tests for the interactive footprint, painted frame, and
   outer proxy independently. Do not rely on a screenshot alone.

Mixed surfaces require special care. Protect Yumi is one reference: its status text is
click-through, but `.yh-toggle` is interactive. The descriptor therefore identifies only the 40 by
40 toggle through `primaryFootprint`; the empty editor placeholder still uses the full strip
footprint. `tracker.delve` follows the same principle: tracker text is click-through, while its
single affix icon owns a fixed 40 by 40 interactive pocket.

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
| `instance.delve` | itself | Adds the mixed Delve tracker: click-through text plus its 40 by 40 interactive affix pocket, a distinct editable signature |

The dropdown representatives pinned by `MOBILE_HUD_EDITOR_CONTEXT_IDS` are World, World with Vale Cup indicator,
Arena Standard, Fiesta Match, Fiesta Pending, Yumi Match, Vale Cup Match, Vale Cup Charge, and
Delve.

## Current policy inventory

Informational overlays are Arena status, Fiesta score, Fiesta pending, Vale Cup match status, and
Vale Cup charge. They paint above ordinary controls but must be click-through on mobile. The
runtime DOM applier marks these roots with
`data-mobile-hud-overlap-policy="informational-overlay"`; CSS owns their foreground visual layer
and disables pointer events on the root and descendants.

Foreground overlays are Fiesta respawn, Fiesta augment offer, Yumi respawn, Vale Cup briefing,
Vale Cup betting, and center messages. They never create player-repairable layout errors.

Interactive status and tracker UI currently includes the Vale Cup indicator, Yumi collapse toggle,
shared `tracker.deeds` header, and context-specific Delve affix pocket. The Deeds header blocks
pointer input across its registered header footprint. Delve text remains click-through, but its one
current affix icon owns a fixed 40 by 40 input pocket. Neither footprint blocks another surface in
the layout editor. Delve remains a dropdown representative because that mixed
surface changes the editable signature for `instance.delve`.

Actions, menus, frames, Party / Raid, and Pet commands remain interactive but do not reserve
exclusive editor space. Movement exposes its complete capture zone, Consumables expose every
expanded slot, and the Minimap cluster exposes its disc plus raid/mail controls. Player Buffs and
Player Debuffs are also interactive: icons open tooltips and cancellable player buffs accept
cancellation. Each aura root is therefore a bounded scroll viewport, with three icons visible on
phone and six on tablet;
additional icons remain reachable by scrolling. Each Player or Target mobile aura owns a 40 by 40
layout and tap box around its unchanged 28 by 28 classic face; the emphasized own-aura face remains
34 by 34.
On touch, a short tap shows, swaps, or closes the tooltip; tapping elsewhere closes it through the
shared tooltip dismisser. A 650ms slop-guarded hold cancels only the player's own helpful buff, and
scroll movement cancels the hold before it can act. Aura nodes are native buttons with a live
localized accessible name, so the same tooltip remains keyboard reachable.
Party-row mini auras are status glyphs inside the member's own target button, not nested buttons;
they retain their existing row-owned activation and do not participate in aura cancellation.
The Target aura strip uses the same 40 by 40 tap boxes, contains five at once, and expands the
Target maximum envelope from its 236 by 68 base state to 236 by 121.

Pet commands use a bounded scroll viewport so attack, utility, current stance, and every other
stance remain reachable without reserving the full open list. The `party` surface is labeled
Party / Raid. Sparse runtime parties shrink to their current content, while Edit Mode and Save
retain the maximum raid-capacity envelope and the runtime viewport scrolls when that envelope is
full.

In Edit Mode, informational proxies stay below interactive proxies even though their live visuals
paint above them. Each movable surface uses one selectable live or placeholder frame. Descriptors
still keep maximum active footprints for validation, target-size checks, and runtime sizing, but the
editor no longer paints those footprints as a second dashed rectangle.

The standalone Discord call-to-action is not a movable gameplay surface. During mobile touch
gameplay, `body.mobile-touch.game-active` hides it because Discord remains reachable from More.
Leaving a second top-level call-to-action visible would create an unregistered pointer interceptor.

The Quest Tracker is intentionally excluded from the landscape editor because every mobile-touch
landscape tier hides `#quest-tracker` with `display: none`; it therefore owns no rendered, focus, or
pointer geometry. Do not register its currently unbounded expanded list as a finite variant. Any
future landscape restoration must first give quest rows 40 by 40 touch targets, constrain all rows
to a bounded scroll viewport, add a `tracker.quests` descriptor and defaults, and verify both
left/right previews. Meters and ordinary windows remain transient foreground UI rather
than player-placed HUD surfaces.

## Coordinate-host and validation invariants

Registry geometry lives in canonical visual CSS pixels. A `body-visual` binding receives those
coordinates directly. For a `ui-author` binding, the applier divides X and Y placement by the live
UI scale and applies `placementScale / uiScale` to the root; descriptor-local widths and heights
remain canonical author-space values. This conversion keeps the final visual rectangle stable at
UI scale 0.85, 1, and 1.4 instead of scaling the saved placement twice.

Canonical profile validation may run every geometry, safe-area, and runtime-context fixture in
both right- and left-handed presentation, but geometry is diagnostic only. Save, load, and runtime
fallback reject only malformed placement data, unsupported capabilities, invalid scale steps, and
targets below their descriptor minimum. Overlap, View intrusion, protected UI intersections, and
safe-area or viewport escape are never validation failures.

If a validation failure belongs to the opposite handedness from the runtime setting, the editor
derives that hand's ghost geometry from the same canonical placement and hides the runtime-hand
fragments it owns. It never toggles the player's global handedness setting. The handedness is
snapshotted for the complete pointer gesture so resolving a failure cannot rebuild the captured
proxy midway through a drag; the normal runtime-hand presentation returns after pointer release.

## Required regression coverage

- `tests/mobile_hud_context.test.ts`: canonical runtime contexts and editor aliases.
- `tests/mobile_hud_registry.test.ts`: unique dropdown signatures, overlap policies, placeholders,
  scale limits, and registry invariants.
- `tests/mobile_hud_editor_core.test.ts`: unrestricted overlap and safe-area placement, remaining
  data and accessibility validation, primary footprints, handedness, and UI-scale mapping.
- `tests/mobile_hud_editor.test.ts`: skinned dropdown contents, context normalization, and absence
  of the removed layout envelope.
- `tests/browser/mobile_hud_editor.browser.test.ts`: real CSS visibility, placeholder selection,
  live-visual replacement, sparse Party / Raid sizing, bounded scrolling, and mixed-surface
  pointer hits.

The complete geometry matrix must still contain every `MOBILE_HUD_CONTEXT_IDS` entry. Reducing the
dropdown must never reduce structural, capability, scale, target-size, or runtime-context coverage.
