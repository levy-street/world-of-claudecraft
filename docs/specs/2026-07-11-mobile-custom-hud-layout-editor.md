# Mobile Custom HUD Layout Editor

| | |
|---|---|
| Status | Implemented with post-device-test policy revision |
| Date | 2026-07-11 |
| Branch | `mobile-layout-adjustments` |
| Depends on | `mobile-layout-adjustments` and the Mobile Touch HUD Layout PRD |
| Surface | Landscape touch HUD only |

## Current product decision

Strict overlap, View-area, safe-area, and viewport-boundary enforcement was implemented and tested
through the complete geometry matrix. Real device testing showed that dynamic footprints, mirrored
layouts, editor proxies, and runtime DOM geometry produced too many false conflicts and unexpected
profile fallbacks. The resulting restrictions made the editor harder to use than the overlap risk
it was intended to prevent.

The product decision is therefore to allow player-authored surfaces to overlap each other, View,
protected UI, and safe-area or viewport boundaries. These conditions never paint red, disable Save,
reject load, or activate runtime defaults. Save and load still reject malformed or non-finite
placement data, unsupported descriptor capabilities, invalid scale values, and interactive targets
below their accessibility floor. Safe-area measurement remains for notch-aware default anchoring
and editor chrome reachability only.

This section supersedes every later historical reference to collision, View, safe-area, or bounds
blocking. Those references document the rejected implementation and why the current simpler policy
exists; they are not acceptance requirements.

## Goal

Players can open a mobile HUD editor from Interface settings and arrange the touch HUD for
their hands, device, and play style. Every supported HUD surface can be moved freely and resized
within its descriptor and accessibility limits. Composite orientation and opening direction remain registry-owned layout metadata,
but the version 1 player palette intentionally exposes only movement, scale, and reset. The result
remains usable across landscape phone sizes, has a separate tablet profile, mirrors
automatically for left-handed play, and allows the player to choose intentional overlap or
off-safe-area placement.

Success means the editor is predictable on a 740 by 360 compact phone, stable on wider phones,
comfortable on a 1024 by 768 tablet, and does not require a future rewrite when HUD elements are
added, removed, regrouped, or reparented.

## Context and locked decisions

This specification follows the fixed mobile topology delivered by
`docs/prd/mobile-compact-landscape-hud.md`. That PRD excluded a player-authored freeform editor
from its own implementation scope. This separate contribution intentionally adds that editor
without changing the shipped default topology.

The following product decisions are approved:

- Portrait gameplay remains out of scope because another contribution disables it.
- Combat buttons A1 through A5, Attack, Target, Jump/Use, and page switching are individually
  movable and resizable.
- The editor covers the complete landscape touch HUD, not only combat controls.
- The editor presents gameplay scenes instead of rendering every mode-specific status at once.
  Version 1 scenes are World, Arena, Vale Cup, and Delve, with supported Arena and Vale Cup
  substates.
- Shared gameplay controls keep one placement across every scene. Context-specific status surfaces
  exist only in the scenes where the game can actually show them.
- Dynamic lists and related controls remain semantic composites where independent placement
  would break their runtime behavior.
- The optional view joystick is always represented in the editor. When disabled in gameplay,
  its placement remains a guaranteed empty swipe-look area.
- Custom layouts have two profiles: phone landscape and tablet landscape.
- A custom layout is stored once in canonical right-handed form and mirrored automatically for
  left-handed mode.
- Overlap, safe-area escape, viewport escape, and View intrusion are allowed player choices. They
  never create validation errors or runtime fallback.
- Persistence is local-first, versioned, and accessed through a storage adapter. Account sync is
  deferred, but can later replace or wrap the adapter without changing the editor model.

## Chosen approach

Use a capability-driven, scene-aware mobile HUD registry and a dedicated full-screen proxy editor.
The live HUD remains the visual preview, but an editor-owned interaction layer receives all edit
touches. Gameplay controls never receive pointer events while the editor is active.

Each registered surface has a stable semantic ID, profile defaults, collision footprints, a
mirror policy, scene visibility and validation rules, and only the editing capabilities that make
sense for that surface. The persisted document refers to registry IDs, never DOM order, child
index, or transient party and pet data.

This approach is selected because it provides free placement while retaining descriptor-owned
scale, target-size, and capability limits. It also isolates gameplay input, composes with existing CSS
transforms, and permits new element types without changing the persistence format.

### Rejected alternatives

1. Direct manipulation of live gameplay DOM elements was rejected. It has a smaller initial
   implementation, but risks firing abilities, fighting pointer ownership, overwriting existing
   transforms, and persisting nodes that are dynamically reparented.
2. A universal free-transform editor with arbitrary rotation and user-controlled z-order was
   rejected. It would require rotated hitbox collision, unclear left-handed mirroring, and rules
   for text and icon rotation while adding little practical value to this HUD.
3. Automatic collision resolution was rejected. The editor must preserve the position chosen by
   the player, show why it is invalid, and let the player correct it. It must not push unrelated
   controls around the screen.
4. A complete independent layout for every gameplay mode was rejected. Two device profiles times
   multiple modes would duplicate shared controls, allow muscle-memory positions to drift, and
   multiply every future registry migration.
5. A single union scene containing every Arena, Vale Cup, Delve, and World surface was rejected.
   Many of those surfaces are mutually exclusive at runtime, so their artificial collisions would
   reject layouts that the game can safely display.
6. Strict overlap and safe-area enforcement was implemented, audited, and rejected after device
   testing. It coupled Save and runtime fallback to geometry that changes with dynamic content,
   mirroring, UI scale, and DOM state. The editor now shows those shapes only as placement context.

## Editing model

### Element capabilities

All top-level descriptors support position unless explicitly fixed by editor chrome. Scale limits
and steps are descriptor-specific, not universal.

| Stable registry ID | Surface | Placement and editing behavior | `visibleIn` / `validateIn` | Class |
|---|---|---|---|---|
| `action.a1` through `action.a5` | A1 through A5 | One placement each per profile; move and scale | All / All | Shared movable |
| `action.attack` | Attack | One placement per profile; move and scale | All / All | Shared movable |
| `action.target` | Target action | One placement per profile; move and scale | All / All | Shared movable |
| `action.jump_use` | Jump/Use | One placement per profile; move and scale | All / All | Shared movable |
| `action.page` | Page switch | One placement per profile; move and scale | All / All | Shared movable |
| `control.movement` | Movement | One placement per profile; move and scale capture zone and resting joystick together | All / All | Shared movable |
| `control.view` | View anchor or joystick | One placement per profile; move and scale the visible View control without reserving exclusive space | All / All | Shared movable |
| `utility.consumables` | Consumables | One placement per profile; move and scale toggle; left, right, up, or down tray opening | All / All | Shared movable |
| `pet.commands` | Pet commands | One placement per profile; move, scale, horizontal or vertical flow, reverse; bounded scrolling; editor-visible only for pet-capable classes | All / All | Shared movable |
| `party` | Party / Raid | One placement per profile; move, scale, horizontal or vertical flow, reverse; sparse content shrinks inside the raid-capacity viewport | All / All | Shared movable |
| `menu.top` | Top menu launchers | One placement per profile; move, scale, horizontal or vertical flow, reverse | All / All | Shared movable |
| `minimap.cluster` | Minimap cluster | One placement per profile; move and scale every dependent child together | All / All | Shared movable |
| `frame.target` | Target frame | One placement per profile; move and scale; 236 by 68 base and 236 by 121 with the interactive aura viewport | All / All | Shared movable |
| `frame.player` | Player cluster | One placement per profile; move and scale with cast and swing bars | All / All | Shared movable |
| `auras.player_buffs` | Player Buffs | One placement per profile; move, scale, horizontal or vertical flow, reverse; bounded scrolling | All / All | Shared movable |
| `auras.player_debuffs` | Player Debuffs | One placement per profile; move, scale, horizontal or vertical flow, reverse; bounded scrolling | All / All | Shared movable |
| `tracker.deeds` | Deeds tracker header | One placement per profile; move and scale the interactive header | All / All | Shared movable |

`All` means every canonical validation context defined below. Shared descriptors therefore have
the same explicit `visibleIn` and `validateIn` membership and cannot silently disappear from a
mode-specific validation.

The contents of the More dialog, inventory, quests, chat, social, settings, Meters, and other
opened windows are not editor surfaces. Their launchers can move through the top menu composite,
but the dialog contents remain inside their existing windows. The Quest Tracker is hidden by the
current mobile landscape contract and is explicitly excluded from version 1. The standalone
Discord call-to-action is also excluded and hidden during `body.mobile-touch.game-active`; Discord
remains available through More without leaving an unregistered clickable overlay above gameplay.

Party members are not persisted individually because their count and identity are dynamic. Party
and Raid share one placement. Sparse runtime content shrinks to its painted members, while the
maximum raid presentation remains visible as a pointer-through Edit Mode envelope and scrolls
inside its registered viewport when populated. Pet commands remain one semantic composite even if
their DOM nodes are recreated, and every command or stance stays reachable through its bounded
scroll viewport. Consumable slots remain attached to the toggle and are arranged by the configured
opening direction.

`visibleIn` models mutually exclusive gameplay contexts, not player-class capability. The editor
therefore applies a separate runtime availability filter: `pet.commands` is omitted for classes
that cannot own a controllable pet, while its shared stored placement remains intact. An unavailable
surface is excluded consistently from editor proxies, current and matrix validation, load fallback,
runtime fallback, and Save blocking. A Rogue or Warrior must never see or be blocked by a Pet
Controls proxy; Hunter and Warlock validate the same stored placement normally.

The target aura strip remains part of the Target frame. Its aura icons accept pointer input for
tooltips, so the Target maximum-state envelope is 236 by 121 rather than only the 236 by 68 base
frame. XP, cast, and swing remain part of the Player cluster. Player Buffs and Player Debuffs are
separate aura composites because the current mobile HUD positions them independently. Their icons
open tooltips, and cancellable player buffs accept cancellation, so both aura composites are
blocking interactive surfaces rather than informational overlays. Each composite is a bounded
scroll viewport: phone shows three icons and tablet shows six, with every additional icon still
reachable by scrolling. On mobile, each player or Target aura has a 40 by 40 layout and tap box
around its unchanged 28 by 28 classic face; an emphasized own aura keeps its 34 by 34 face inside
the same tap box. A short touch tap shows, swaps, or closes the tooltip, while the shared outside
dismisser closes it when another part of the HUD or world is touched. Holding for 650ms cancels only
the player's own helpful buff; moving past the tap slop turns the gesture into viewport scrolling
and prevents cancellation. Aura nodes remain native, named buttons for keyboard and switch access.

An empty Player Buffs or Player Debuffs composite remains discoverable in Edit Mode through a
subtle labeled placeholder matching its registered bounded viewport. The placeholder is only an
editor affordance. As soon as real aura icons exist, the exact painted frame follows the bounded
viewport root rather than clipped offscreen icons, while a separate pointer-through viewport
envelope continues to show the blocking occupancy. The same saved placement, scale, orientation,
and order own both representations.

### Gameplay scenes

The editor has one compact preview-state dropdown inside its floating palette. It never displays
every context-specific surface simultaneously. Runtime and matrix validation retain all canonical
contexts, while the dropdown exposes one representative for each unique editable surface
signature. Equivalent states that only add foreground popup UI alias to an existing preview. The
normative classification and alias table lives in
[`docs/architecture/mobile-hud-layout-surface-classification.md`](../architecture/mobile-hud-layout-surface-classification.md).

```ts
type MobileHudSceneId =
  | 'world'
  | 'arena.standard'
  | 'arena.fiesta'
  | 'arena.yumi'
  | 'vale_cup.briefing'
  | 'vale_cup.match'
  | 'vale_cup.spectator'
  | 'instance.delve';
```

The initial canonical validation contexts are:

| Context ID | Simultaneously active context-specific surfaces |
|---|---|
| `world.base` | No mode-specific surface |
| `world.vale_cup_indicator` | Vale Cup queue or nearby live-match indicator |
| `arena.standard` | Generic Arena status |
| `arena.fiesta.base` | Generic Arena status and Fiesta score |
| `arena.fiesta.pending` | Generic status, Fiesta score, and augment-pending status |
| `arena.fiesta.respawn` | Generic status, Fiesta score, and protected respawn overlay |
| `arena.fiesta.offer` | Generic status, Fiesta score, and protected augment offer |
| `arena.fiesta.respawn_offer` | Generic status, Fiesta score, protected respawn, and protected augment offer |
| `arena.yumi.base` | Yumi status |
| `arena.yumi.respawn` | Yumi status and protected Yumi respawn |
| `arena.yumi.returning` | Generic Arena returning status; Yumi status is hidden |
| `vale_cup.briefing` | Protected player briefing; match status is hidden |
| `vale_cup.match` | Vale Cup match status with the sport kit in the shared action seats |
| `vale_cup.match.charge` | Match status and the movable shoot-charge meter |
| `vale_cup.spectator.betting` | World combat kit and protected spectator betting surface |
| `instance.delve` | Delve tracker |

The context list is a versioned registry fixture, not persisted player data. Adding a reachable
runtime combination requires adding a context fixture and tests, but does not require a storage
schema migration.

The initial dropdown contains the representatives pinned by
`MOBILE_HUD_EDITOR_CONTEXT_IDS`: World, World with Vale Cup indicator,
Arena Standard, Fiesta Match, Fiesta Pending, Yumi Match, Vale Cup Match, Vale Cup Charge, and
Delve. Fiesta respawn/offer combinations alias to Fiesta Match, Yumi respawn aliases to Yumi Match,
Yumi returning aliases to Arena Standard, and Vale Cup briefing/betting alias to World. Delve
retains its own representative because `tracker.delve` adds a distinct mixed surface: its status
text is click-through, but its affix icon occupies a fixed 40 by 40 interactive pocket.

Arena Fiesta reachability mirrors the current renderer: pending is hidden while an offer is active
or the player is down; respawn and augment offer may coexist. Yumi status and generic Arena status
are mutually exclusive during play, while the returning context uses only the generic status. Vale
Cup briefing and match status are mutually exclusive. Optional contexts such as the World Vale Cup
indicator and shoot-charge meter remain mandatory structural, capability, scale, and target-size
validation contexts because they can occur at runtime even when the ordinary base preview does not
show them.

World is the fallback for ordinary outdoor play, dungeons, and raids because the current game has
no generic persistent dungeon or raid HUD surface. Future registry additions may introduce stable
scene IDs such as `instance.dungeon`, `instance.raid`, or `pvp.battleground` without changing the
version 1 storage schema.

The pure runtime resolver uses existing client-visible state and adds no `IWorld` member. It returns
exactly one canonical validation context using this exhaustive priority:

1. A player-owned Vale Cup match: briefing, charging match, or ordinary match.
2. An Arena match: Protect Yumi returning, Yumi respawn, Yumi base, Fiesta respawn plus offer,
   Fiesta offer, Fiesta respawn, Fiesta pending, Fiesta base, or standard Arena.
3. A nearby Vale Cup spectator betting state.
4. An active Delve.
5. World with a visible Vale Cup indicator.
6. World base.

Player-owned Vale Cup and Arena matches are expected to be mutually exclusive. If a malformed
snapshot exposes both, Vale Cup wins deterministically and the resolver emits a development
diagnostic. Arena wins over Delve, and spectator state never overrides a player-owned Arena match.

Shared surfaces have exactly one placement per phone or tablet profile and keep that placement in
every scene. Version 1 does not permit scene-specific overrides of shared combat controls. This
preserves muscle memory. A context-specific surface has its own placement but is rendered and
validated only in scenes allowed by its registry descriptor.

Registry context semantics are normative:

- `visibleIn` is the exact set of canonical runtime context IDs in which the surface exists. The
  editor derives its smaller representative list separately and renders proxies only for movable
  surfaces; protected overlays never appear as layout ghosts.
- `validateIn` is the exact set of canonical context IDs in which the collision envelope
  participates in Save and load validation.
- `visibleIn` must be a subset of `validateIn`. Every context that runtime can reach is mandatory
  validation even if it is not the default preview for its scene.
- Shared surfaces use all canonical context IDs for both fields.
- Protected surfaces have no player placement. They remain part of the runtime inventory but are
  non-blocking and do not create editor proxies, dropdown variants, or player-repairable ghosts.

The initial context-specific surface inventory is:

For this table, `FIESTA_ALL` is the five Fiesta contexts, `YUMI_ACTIVE` is Yumi base plus
respawn, and `VALE_MATCH_ALL` is Vale Cup match plus match charge. These aliases expand to exact
context-ID sets in the registry.

| Stable registry ID | Ownership | Placement and capabilities | `visibleIn` / `validateIn` | Class |
|---|---|---|---|---|
| `status.arena.generic` | Arena | One placement per device profile; move and scale | Arena standard, `FIESTA_ALL`, Yumi returning / same | Movable |
| `status.arena.fiesta_score` | Fiesta | One placement per profile; move and scale | `FIESTA_ALL` / `FIESTA_ALL` | Movable |
| `status.arena.fiesta_pending` | Fiesta | One placement per profile; move and scale | Fiesta pending / Fiesta pending | Movable |
| `protected.arena.fiesta_respawn` | Fiesta | No player placement | Fiesta respawn and respawn-offer / same | Protected |
| `protected.arena.fiesta_offer` | Fiesta | No player placement | Fiesta offer and respawn-offer / same | Protected |
| `status.arena.yumi` | Protect Yumi | One placement per profile; move and scale | `YUMI_ACTIVE` / `YUMI_ACTIVE` | Movable |
| `protected.arena.yumi_respawn` | Protect Yumi | No player placement | Yumi respawn / Yumi respawn | Protected |
| `status.vale_cup.indicator` | World and Cup | One placement per profile; move and scale | World Vale Cup indicator / same | Movable |
| `protected.vale_cup.briefing` | Vale Cup | No player placement | Vale Cup briefing / Vale Cup briefing | Protected |
| `status.vale_cup.match` | Vale Cup | One placement per profile; move and scale | `VALE_MATCH_ALL` / `VALE_MATCH_ALL` | Movable |
| `status.vale_cup.charge` | Vale Cup | One placement per profile; move and scale | Vale Cup match charge / same | Movable |
| `protected.vale_cup.betting` | Vale Cup spectator | No player placement | Vale Cup spectator betting / same | Protected |
| `tracker.delve` | Delve | One placement per profile; move and scale; click-through text plus one 40 by 40 affix pocket | Delve / Delve | Mixed movable |
| `protected.system.center_message` | Shared system | No player placement | All / All | Protected |

Arena generic, Fiesta score/pending, and Vale Cup match/charge are informational overlays.
Fiesta/Yumi respawn, Fiesta offer, Vale Cup briefing/betting, and center message are foreground
overlays. Vale Cup indicator and the shared `tracker.deeds` header are interactive across their
registered footprints. Yumi status is mixed because only its collapse toggle owns input.
Delve is also mixed: all tracker text is click-through, while its single current affix icon owns
the registered 40 by 40 input pocket.

All shared element IDs from the element-capability table have one placement per device profile,
support the capabilities listed there, and use every canonical context in `visibleIn` and
`validateIn`.

Two protected footprints active in the same context may not overlap unless both descriptors name
each other through an explicit `allowProtectedOverlapWith` exception. Missing reciprocity or an
unapproved protected overlap is a registry-definition error caught by unit tests, not a
user-repairable layout error. There is no global protected-overlap exception.

### Registry-owned orientation

The editor does not expose arbitrary angle rotation or orientation controls. The registry and
stored placement schema still support these deterministic composite values:

- horizontal or vertical flow for bar-like composites;
- normal or reversed order for ordered composites;
- left, right, up, or down opening direction for Consumables.

Icons, labels, health bars, maps, joysticks, and individual buttons remain upright. Orientation
changes child layout, not the CSS rotation of the whole surface.

### Editor flow

1. Interface settings exposes `Customize Mobile Layout` only in touch landscape mode.
2. Opening it closes Options, captures the current layout as a cancel snapshot, suspends gameplay
   input, and shows every player-editable registered surface through the editor proxy layer. Fixed
   protected surfaces remain runtime-only registry metadata and receive no editor proxy.
3. One compact floating palette opens near the center of the safe viewport and begins Locked. Its
   header drags the entire palette without persisting that temporary editor position. The next row
   is one dropdown containing every unique editable World, Arena, Vale Cup, and Delve signature.
4. Locked mode is preview-only. HUD controls do not activate and nothing can move.
5. Unlock enables selection. A selected surface receives a gold outline and an accessible name.
6. Dragging moves the selected surface. Pointer capture keeps the drag active after the finger
   leaves its original bounds.
7. The inspector provides symbol-only minus and plus scale buttons, Reset Selected, and Reset All.
   Movement stays gesture-first; focused proxies retain Arrow-key nudging without adding visible
   directional buttons. Resize never requires pinching.
8. Orientation, reverse-order, and opening-direction controls are not shown in version 1.
9. Reset Selected restores the current profile default for one surface. Reset All restores the
   deterministic built-in default for the active profile.
10. Any validation failure automatically turns the preview border, implicated surfaces, and compact
    status message red. There is no separate `Show Failing Layout` control. The player uses the same
    preview-state dropdown to inspect another unique editable context.
11. Drag, Arrow-key nudge, and scale update the same canonical draft placement used by the
    real-device preview. Nudge steps are measured in unscaled CSS pixels. Every edit continuously
    revalidates all geometries and contexts.
12. Lock returns to preview without persisting. Save validates and persists the draft, applies it,
    and exits only after the storage adapter confirms success. Cancel restores the exact entry
    snapshot and exits.

### Live HUD visual contract

The editor uses the already-rendered live HUD as its visual preview. It does not clone, reparent,
or recreate buttons, canvases, bars, icons, or dynamic painter state.

- Editor-owned attributes set every resolved live visual fragment root to exactly `opacity: 0.45`
  while unselected and exactly `opacity: 1` while selected. These are absolute editor overrides,
  not multipliers over runtime root opacity. Descendant cooldown, disabled, and item-count alpha
  remains intact. Invalidity changes outline and error text only; it does not change the selected
  or unselected live-fragment opacity.
- The editor-owned outer proxy remains the only drag, selection, focus, and pointer-capture owner.
  It has no dark fill or padding and remains at least 48 by 48 CSS pixels. A nested frame follows
  only the currently painted geometry. The nested frame receives the solid gold selected outline
  or the invalid red outline without enlarging visible artwork to the touch target.
- The visible proxy label is hidden while unselected and shown only for the selected or invalid
  surface. Every movable proxy keeps its localized accessible name through `aria-label` regardless
  of visual label visibility.
- Composite surfaces show their live root content and the nested frame follows the union of the
  currently painted fragments. Bounded scroll surfaces instead measure the viewport root so
  clipped offscreen children cannot enlarge the editor hitbox. Earlier WIP builds painted a
  separate dashed validation envelope for registered worst-case footprints, but that extra shape
  was removed after device testing because it drifted from the real HUD and was no longer useful
  once overlap blocking was disabled.
- Movement shows and outlines the live movement joystick. Minimap shows the map artwork and
  dependent controls through the same selectable frame. View shows the live camera joystick when
  enabled; when disabled, its existing joystick root is forced visible for editing.
- Party and Raid are one `party` surface. Its live frame follows the current chip/member content,
  so a sparse group does not retain an empty raid-sized deadzone, while its state envelope always
  shows the registered raid-capacity scroll viewport. Pet commands are constrained to their
  registered scroll viewport. Target reserves its 236 by 121 aura-populated maximum. Pet, Target,
  and Party / Raid use full labeled placeholders when their runtime content is absent.
- Player Buffs and Player Debuffs show blocking bounded-scroll envelopes even when empty. The phone
  profile exposes three 40 by 40 icon targets at a time and the tablet profile exposes six; pointer interaction
  remains owned by the icons for tooltip and cancellation behavior.
- The Deeds tracker header is a blocking surface. The Delve tracker is mixed: text remains
  click-through during gameplay and only the registered 40 by 40 affix pocket receives runtime
  pointer input. In Edit Mode, the complete painted tracker frame is selectable and draggable.
- Protected surfaces stay hidden in the editor. Movable context surfaces without a currently
  visible live root use labeled placeholders with the same selection and diagnostic contract as
  other movable surfaces.
- The full-screen editor stage does not blur or darken the live HUD. Dimming belongs to individual
  registry-bound visuals so the selected surface can genuinely reach 100 percent opacity.

The non-persisted visual portion of a DOM binding is explicit:

```ts
interface MobileHudEditorVisualBinding {
  editorVisualSelectors?: readonly string[];
  editorGeometrySelectors?: readonly string[];
  editorPseudoGeometry?: readonly {
    selector: string;
    pseudo: '::before' | '::after';
  }[];
  runtimeSizing?: 'validation-footprint' | 'base-footprint' | 'intrinsic';
  editorVisibility?: 'live-if-visible' | 'force-existing-root' | 'ghost-only';
}
```

`editorVisualSelectors` defaults to the binding `rootSelector` only when that root does not contain
another descriptor-owned surface. Movement explicitly names `#mobile-move-joystick`. View
explicitly names `#mobile-camera-joystick`; `#mobile-controls` is forbidden as an editor visual
fragment. `editorVisibility` defaults to `live-if-visible`.

Visual and geometry selector resolution accepts only connected matches, deduplicates them to the outermost named nodes
within one descriptor, and rejects a fragment owned by two descriptors in the same canonical
context. No opacity-bearing node may contain a fragment owned by another descriptor. Every sibling
fragment receives the descriptor's editor state independently; nested fragments receive it only on
the outermost match so opacity never multiplies.

On context change, every registered live fragment outside the selected context's `visibleIn` is
editor-hidden even if the continuing runtime currently shows it. An active `live-if-visible`
fragment is used only when its connected root has a nonempty rendered rect. A
`force-existing-root` policy may temporarily override `display` or `visibility` only on an existing
connected stable root; it must not fabricate painter data or mutate simulation/runtime state.
Missing, disconnected, empty, or zero-rect fragments fall back to the descriptor's ghost.
`ghost-only` never exposes a live fragment. Editor-only visibility attributes are removed during
teardown so normal runtime CSS resumes without copied inline-style restoration.

View uses `force-existing-root`: while the editor is open, the existing
`#mobile-camera-joystick` is shown as the View visual even when the player's ordinary camera
joystick setting is off. It remains noninteractive because the editor proxy owns pointer input.
The editor never substitutes a text-only View box when that stable joystick root exists.

### Preview geometry contract

The interactive preview is a transparent, unscaled, one-to-one layer coincident with the current
visual app viewport. Any decorative safe-area border is a separate `pointer-events: none` layer and
must not inset, scale, or become the containing block for proxy coordinates.

During a drag, every finite placement remains applied to the live HUD so the visual and interaction
proxy stay under the finger. Overlap, View intrusion, protected UI intersection, and safe-area or
viewport escape are allowed choices and do not paint red or block Save. Structural failures,
unsupported capability values, invalid scale, and undersized interactive targets remain blocking.

- An atomic button's outer proxy contains its live hitbox, while its nested frame matches the
  painted face within one CSS pixel. For pseudo-element faces the frame uses the computed pseudo
  border box and transform.
- A composite nested frame equals the union of its currently painted fragments within one CSS
  pixel, except that a bounded scroll composite equals its viewport root and excludes clipped
  offscreen children.
- Movement's nested frame matches `#mobile-move-joystick`. View and other unavailable movable
  surfaces use their registered editor fallback when no live geometry exists; protected surfaces
  stay hidden.
- Canonical viewport and safe-area fixtures remain developer regression inputs for alignment,
  target size, mirroring, and responsive defaults. Their geometric intersections and bounds are
  diagnostic only and never remap the live stage or control Save.
- Left-handed preview derives from the same canonical placement and never toggles the player's
  global handedness setting. The chosen hand is fixed from pointerdown through pointerup so a
  preview refresh cannot replace the pointer-capturing proxy midway through a drag.

### Editor ownership and teardown

The stacking order is `live HUD < transparent proxy stage < floating palette`, with the editor
above every live game window and tooltip. Opening the editor closes non-registry windows and
transient tooltips through the existing HUD close path; they are not reopened automatically.
The stage has computed transparent background, no `backdrop-filter`, and no dimming box shadow.
Movable proxies have computed transparent background and zero padding.

All pre-existing underlying HUD/control roots, including `#ui` and `#mobile-controls`, become
`inert` for the editor session. Their exact pre-entry inert states are recorded. The transparent
proxy buttons are the only interactive and accessible control layer. Locked movable proxies are
removed from sequential focus until Unlock. Protected registry surfaces do not create editor DOM.

The palette drag handle is focusable and has a localized accessible name. Pointer drag remains the
fast path; Arrow keys move the palette in safe fixed steps and `Home` returns it to its default
near-center position, without visible directional buttons. Forced-colors rules preserve proxy,
focus, error, selected, and ghost boundaries. Reduced-motion removes editor opacity or position
transitions.

One idempotent teardown path is used by direct close, Cancel, successful Save, back/Escape,
failed or aborted open, and repeated open/close. It releases pointer capture, removes every editor
visual/context/forced-visibility attribute, restores exact pre-entry inert states, and clears
palette/selection state. A storage write failure does not teardown because the editor remains open;
subsequent Cancel or successful Save uses the same teardown path.

The world simulation may continue online, but movement, autorun, abilities, camera gestures,
menu launchers, and all other gameplay actions are suspended for the editor session. Entering the
editor must release every currently owned touch and stop local movement and camera intent.

## Responsive profiles and coordinates

The persisted document contains exactly two landscape profiles:

- `phone`: current touch tiers `compact` and `standard`;
- `tablet`: current touch tier `tablet`.

Profile selection uses the existing mobile HUD tier resolver and viewport measurements, never
user-agent device labels. The editor edits the active profile on the actual device so reach and
safe-area comfort are evaluated on the real screen.

Developer regression tests evaluate every profile against a pure canonical geometry matrix. They
evaluate each canonical context independently in both right- and left-handed presentation, never an
impossible union of mutually exclusive surfaces. Save uses the same context inventory for data,
capability, scale, and target-size validation, but does not reject geometry for overlap or bounds.
The initial regression matrix contains:

- phone: 740 by 360, 844 by 390, 915 by 412, 932 by 430, and 1280 by 720;
- tablet: 1024 by 768;
- safe-area cases for no side inset, a 50 CSS pixel left inset, a 50 CSS pixel right inset, and
  bilateral 50 CSS pixel side insets, each evaluated with both 0 and 24 CSS pixel bottom insets.

The matrix lives beside the pure editor core and is shared by automated tests. A full audit contains
768 profile/viewport/safe-area/context fixtures evaluated for both handedness variants, for 1,536
deterministic evaluations. Runtime validation receives the active handedness explicitly and uses the
same normalization and mirror order. Matrix diagnostics may name profile, viewport, safe-area case,
handedness, context, and involved surfaces, but geometry findings never become player-facing errors.

Each placement stores:

- one of nine internal safe-viewport anchors: the combinations of left, center, right and top,
  center, bottom;
- X and Y offsets in logical CSS pixels from that anchor;
- a dimensionless scale multiplier over the descriptor's canonical tier size;
- optional orientation, reverse order, or opening direction values supported by the descriptor.

The anchor is chosen automatically from the final placement. It is not another user-facing
setting. Edge controls therefore keep a stable distance from their edge as phone aspect ratios
change, while centered frames remain centered. Runtime clamping for a temporarily smaller
viewport must not overwrite the stored placement, so returning to the original size restores the
player's exact layout.

All registry coordinates resolve in canonical visual CSS pixels inside the safe visual app
viewport. `body-visual` bindings receive those coordinates directly. `ui-author` bindings live
under the already scaled `#ui` tree, so the runtime applier divides visual X and Y by the live UI
scale and applies `placementScale / uiScale` to the root while leaving descriptor-local sizes in
canonical author space. Cast and swing offsets follow the same conversion. The result is the same
visual rectangle at UI scale 0.85, 1, and 1.4 rather than a placement that is scaled twice.
Fullscreen changes, UI-scale changes, and viewport resizes re-resolve and revalidate the active
profile on events only.

If a previously saved profile contains malformed placement data, unsupported capabilities,
invalid scale values, or targets below the accessibility floor, runtime temporarily applies the
built-in default for that active profile and surfaces one localized warning. It does not mutate or
delete the stored placement. Overlap and off-safe-area position never trigger this fallback.

## Automatic left-handed mirroring

Only canonical right-handed data is stored.

- Left and right anchors swap at render time.
- The horizontal offset changes sign. Centered anchors remain centered.
- Composites marked `position-and-order` reverse their horizontal growth. Left and right opening
  directions swap, while up and down remain unchanged. Vertical item order does not reverse solely
  because handedness changes.
- Text, icons, bars, and maps are not visually reflected.
- Editing while left-handed shows the mirrored result, then applies the inverse transform before
  updating the canonical draft.
- Toggling handedness never creates or overwrites another saved profile.

## View area and input deadzones

Historical rejected design note: this section records the former reserved-View policy. The current
editor still visualizes View and real camera deadzones, but no surface is required to keep it clear.

The existing camera contract remains authoritative: swipe-look may begin on any unobstructed
canvas pixel, while interactive HUD surfaces are camera deadzones.

Edit Mode always shows a translucent View anchor:

- With the camera joystick enabled, it represents the joystick's real placement and touch area.
- With the camera joystick disabled, it disappears in gameplay while its placement remains available
  for the next time the player enables it.
- Its size is user-adjustable within descriptor limits. The minimum is at least the current camera
  hitbox plus the registry-defined comfort padding.
- Other registered surfaces may overlap its resolved footprint. The editor still shows Movement and
  View capture geometry so the player can make an informed placement choice.

Swipe-look is not restricted to this footprint. It remains available on every other canvas pixel
that is not occupied by interactive HUD.

## Collision and save validation

Historical rejected design note: the geometric rules in this section were implemented and then
disabled after device testing. The current validator checks only placement structure, supported
capabilities, descriptor scale limits, and minimum target size. Collision and bounds metadata may
still support preview geometry, pointer routing, and developer audits, but never blocks a player's
Save, load, or runtime layout.

Strict player-layout collision enforcement was implemented first, including reciprocal overlap
exceptions, View and Movement reservation, safe-edge margins, protected-surface diagnostics,
worst-case dynamic envelopes, a subpixel intersection epsilon, and a complete canonical matrix.
Real-device testing found false conflicts, editor/runtime geometry drift, misleading dashed boxes,
and unexpected fallback to defaults. That policy was rejected and disabled. It remains recorded in
the historical implementation plan and tests only where useful for regression evidence.

The current validator rejects only:

- malformed or non-finite placement data;
- unsupported descriptor capabilities;
- scale outside the descriptor range;
- scaling that would reduce a required interactive target below its accessibility floor.

Overlap, View intrusion, protected UI intersection, and safe-area or viewport escape never paint
red, disable Save, reject a stored profile, or trigger runtime fallback. Interactive footprints are
still required for target-size checks, runtime pointer ownership, exact editor selection, and useful
preview geometry. The dynamic inventory includes:

- Consumables expose the complete expanded six-item extent;
- Party and Raid use one placement and the maximum ten-player presentation: the player plus nine
  other members. The nine member rows remain reachable inside a registered scroll viewport of
  372 by 40 horizontally or 68 by 260 vertically, including the chip and Leave control. Sparse
  runtime content shrinks below that maximum instead of retaining an empty raid-sized deadzone;
- Pet commands use a bounded scroll viewport in both orientations so every command and stance
  remains reachable without reserving the full opened list;
- Player Buffs and Player Debuffs use bounded scroll viewports in every allowed
  orientation. Phone exposes three 40 by 40 icon targets and tablet exposes six before scrolling;
- Target uses 236 by 68 without auras and a 236 by 121 maximum-state envelope containing its
  interactive aura viewport;
- `tracker.deeds` owns input across its header, while `tracker.delve` owns only its 40 by 40 affix
  pocket and leaves tracker text click-through;
- Player input remains its 300 by 68 interactive root while the Rogue combo row, XP ring, cast,
  and swing bars extend only the live painted frame.

Edit Mode renders ghost proxies for conditional surfaces so the player can place
them before they appear during gameplay. Earlier WIP builds also painted a faint dashed validation
envelope, but device testing showed that the extra box often disagreed with the actual HUD visual
and became misleading after overlap blocking was removed. The editor now uses the live visual or
placeholder frame as the single selectable shape. Mutually exclusive Arena and Vale Cup variants
are audited in separate canonical contexts, not combined. The ordinary World preview can hide the
Vale Cup indicator, while `world.vale_cup_indicator` forces it visible for editing.

## Persistence design

Use a dedicated storage adapter and a versioned local document, initially under
`woc_mobile_hud_layout_v1_defaults_3`.

The document contains a schema version, enabled state, and per-profile placements keyed by stable
registry ID. The loader accepts sparse version 1 input for forward compatibility, merges it over
current defaults, and normalizes omitted capability fields. A successful Save materializes both
complete phone and tablet profiles before serialization. The document does not duplicate a
complete layout per scene. Shared IDs have one
placement in each device profile; context-specific IDs have one placement in the profiles where
their descriptor exists. Scene membership and protected footprints belong to the current registry,
not persisted visibility arrays. Built-in CSS and registry defaults remain authoritative when a
custom value is absent.

Persistence requirements:

- Save writes only a fully validated draft.
- Load is wrapped in error handling and validates every field.
- Malformed JSON, a structurally invalid root, or an unsupported schema version rejects the entire
  document and uses built-in defaults without throwing.
- In an otherwise valid version 1 document, unknown IDs are ignored and an invalid individual
  placement is discarded while other valid placements remain. Newly introduced registry IDs and
  discarded placements receive their current built-in defaults.
- After defaults are merged, each profile receives the same structural, capability, scale, and
  target-size validation used by Save. Geometric overlap and bounds never cause profile fallback.
- Existing version 1 documents remain schema-compatible when a registry update adds context IDs,
  membership, protected footprints, or new surface IDs. These definitions are registry-owned, not
  persisted. New surface IDs receive defaults and the current registry decides whether placement
  data remains structurally valid.
- Any storage adapter write failure keeps the editor open, preserves the complete draft, shows a
  localized error, and never reports or visually implies a successful Save.
- Cancel never writes storage.
- Reset affects the draft and persists only after Save.
- The storage interface is independent of `localStorage`, so future authenticated account sync can
  implement the same load and save contract.

Named layouts, import/export, and server sync are deferred. The schema may add those features in a
later version through explicit migration, not by changing version 1 semantics.

## Technical design

The implementation should introduce small modules rather than add behavior to `src/ui/hud.ts`:

- `src/ui/mobile_hud_editor_core.ts`: pure placement resolution, runtime-context resolution,
  mirroring, scale limits, structural validation, target-size diagnostics, preview coordinate
  mapping, and draft transitions;
- `src/ui/mobile_hud_registry.ts`: stable surface, scene, and canonical context IDs; reachable
  context fixtures; descriptors; defaults; capabilities; mirror policies; exact `visibleIn` and
  `validateIn` sets; interactive footprints; dynamic variants; protected runtime surfaces; DOM
  adapters; and optional editor visual selectors for bindings whose layout
  root is not their visible fragment;
- `src/ui/mobile_hud_layout_store.ts`: versioned codec and storage adapter;
- `src/ui/mobile_hud_editor.ts`: lifecycle, proxy overlay, selection, inspector, pointer capture,
  live visual opacity synchronization, inert ownership, input suppression, save, cancel, and reset;
- a thin extension of `src/game/mobile_hud_layout_applier.ts` to resolve and apply the active custom
  profile;
- focused integration with `src/game/mobile_controls.ts` and `src/game/touch_router.ts` to release
  active pointers and give Edit Mode exclusive touch ownership.

The registry adapters must compose through dedicated CSS custom properties or individual transform
properties. They must not assign a universal `element.style.transform`, because current HUD
surfaces already use transforms for centering, tier scaling, and animation. The movement joystick's
custom resting position must not reuse the temporary inline `left` and `top` values written by its
floating interaction.

The runtime context resolver is pure and consumes only existing client-visible Arena, Cup, Delve,
and local charge state. It returns exactly one canonical context ID using the exhaustive priority
defined above. It changes visibility and active placement without writing storage. Context changes
must never copy, reset, or mutate the saved profile.

Safe-area values may be measured with a temporary CSS probe when the editor opens and when the
viewport changes. There are no new per-frame layout reads, allocations, `getComputedStyle` calls,
or persistence checks. `ResizeObserver`, viewport resize events, and state changes drive updates.

This is a client-only feature. It adds no `IWorld` member, simulation behavior, wire field, server
endpoint, or database table. All player-visible and accessible text is added to the English HUD
catalog and rendered through `t()`.

## Accessibility and interaction requirements

- Required gameplay targets preserve the floors already established by the mobile HUD PRD. Combat,
  Consumables, and compact menu targets remain at least 48 by 48 CSS pixels even if their visible
  face is smaller. Existing 40 by 40 floors for compact Party and pet controls remain intact.
- A 0.5 visual scale shrinks art without shrinking those runtime hit floors. The selected proxy
  paints above other proxies, and repeated taps at the same overlap cycle downward through the
  covered surfaces so every movable element remains recoverable on touch.
- Every editor control has a localized accessible name and visible focus treatment.
- Underlying live HUD controls are inert and never duplicate proxy controls in the accessibility
  tree while the editor is open.
- Drag has a keyboard alternative through selection plus Arrow-key nudging on the focused proxy.
- Resize has minus and plus controls in addition to any drag handle.
- The editor does not require pinch, simultaneous touch, or fine motor precision.
- Error state uses outline, icon, and localized text, not color alone.
- Escape or the platform back action follows the existing UI close path and behaves like Cancel
  after confirmation if the draft changed.
- Rapid keyboard nudge and resize feedback is coalesced so announcements do not flood assistive
  technology.

## Scope

### Included

- Interface settings entry and full-screen landscape touch editor.
- Lock and unlock preview state.
- Individual combat button placement and scale.
- Live HUD visuals at reduced opacity with transparent interaction proxies and 100 percent selected
  opacity.
- Complete registered mobile HUD surface placement and scale.
- Registry-owned composite orientation and Consumables opening direction remain stable while the
  palette edits position and scale.
- Separate Player Buffs and Player Debuffs bounded-scroll aura composites.
- One sparse-runtime, raid-capacity Party / Raid composite and one bounded-scroll Pet commands
  composite.
- Target's interactive aura viewport, the Deeds header, and Delve's mixed click-through
  text plus interactive affix pocket.
- One Minimap cluster containing its dependent label, indicators, clock, compass, coordinates, and
  controls.
- World, Arena, Vale Cup, and Delve scene previews with supported Arena and Vale Cup substates.
- Movable compact context status surfaces and hidden protected runtime footprints for fixed overlays.
- Automatic red diagnostics for malformed placements, unsupported capabilities, invalid scale,
  and undersized targets.
- Phone and tablet landscape profiles.
- Automatic left-handed mirroring.
- View footprint and camera-deadzone visualization without exclusive-space enforcement.
- Free overlap and off-safe-area placement, reset, cancel, and local persistence.
- Conditional ghost surfaces and maximum-state informational envelopes.
- Unit, DOM, browser geometry, accessibility, and visual regression coverage.

### Explicitly excluded

- Portrait layout and portrait QA.
- Desktop HUD editing.
- Combat, targeting, interaction, item, pet, party, or camera behavior changes.
- Arbitrary rotation, skew, user-controlled z-index, or automatic collision pushing.
- Reordering abilities between action source slots. Placement does not change keybind semantics.
- Editing the contents of More or any opened game window.
- Moving the standalone Discord call-to-action; mobile active gameplay hides it and More remains
  its supported entry point.
- Quest Tracker editing in landscape and Meters window editing.
- Independent complete layouts or shared-control placement overrides per gameplay scene.
- Hiding gameplay controls or persisting player-configurable gameplay opacity. The temporary
  editor-only 45/100 percent selection treatment is included above and is never saved.
- Named layouts, import/export, clipboard sharing, and cloud or account synchronization.
- Server, simulation, network protocol, or database changes.

## Open questions

None are blocking. The approved editor-only opacity is 45 percent unselected and 100 percent
selected. Future tuning requires real-device screenshot and target-recognition evidence and must
not change persisted layout semantics.

## Acceptance criteria

- [ ] Interface settings opens the editor only for landscape touch mode and closes Options cleanly.
- [ ] The game-skinned context dropdown closes after selection, Escape, Tab, or a tap outside it.
- [ ] Entering Edit Mode releases active movement, autorun, camera, and action touches, and no
      gameplay action fires through the editor overlay.
- [ ] Lock is preview-only. Unlock permits selection and editing. Lock never saves implicitly.
- [ ] The floating palette has no redundant visible title. Its compact grip remains keyboard and
      pointer draggable with an accessible name.
- [ ] A1 through A5, Attack, Target, Jump/Use, and page switch move and resize individually.
- [ ] Visible live HUD buttons and composites render at 45 percent opacity while unselected and 100
      percent while selected; proxies add no dark rectangular fill.
- [ ] Live-surface labels are visually hidden without removing accessible names. Empty placeholders
      retain their labels, and invalid red outlines plus text override normal selection styling.
- [ ] Composite frames follow the exact currently painted fragment union. Movement outlines its
      visible joystick while retaining its larger collision footprint; View forces its existing
      joystick visible, unavailable movable context surfaces retain semantic placeholders, and
      protected surfaces stay hidden.
- [ ] Painted frames and live visual rectangles align within one CSS pixel across the canonical
      viewport, safe-area, handedness, profile, and UI-scale matrix. Outer drag proxies remain at
      least 48 by 48 without enlarging those frames.
- [ ] Browser visual checks open the real game entry in mobile touch landscape mode, enter the HUD
      editor through the runtime UI or an equivalent real-entry debug hook, and verify the adjusted
      layout from that mobile viewport. Desktop rendering, static screenshots, and empty-body test
      fixtures are not accepted as visual evidence for this behavior.
- [ ] Real-entry mobile checks cover at least 740 by 360, 844 by 390 with a safe-area inset, 932 by
      430, left-handed phone, and 1024 by 768 tablet. They assert selected live fragments compute
      to opacity 1, unselected live fragments compute to opacity 0.45, the proxy stage has no
      background blur or dimming fill, transparent proxies receive pointer hits instead of live HUD
      controls, and screenshots show no stale dark rectangles around the real HUD buttons.
- [ ] Opening and closing the editor applies and restores inert and visual classes without leaving
      duplicate focus targets, opacity, or editor state on live HUD elements.
- [ ] Movement, View, Consumables, pet, Party / Raid, top menu, Minimap cluster, Target, Player,
      Deeds, Buffs, and Debuffs implement their descriptor capabilities and no unsupported control
      is shown.
- [ ] Pet Controls is absent for Rogue and every other non-pet class, while Hunter and Warlock keep
      the shared pet placement available in every canonical context. Every command and stance
      remains reachable inside the bounded horizontal or vertical scroll viewport.
- [ ] View renders the existing camera joystick in the editor even when its gameplay setting is
      disabled; the joystick stays noninteractive and no text-only View proxy covers it.
- [ ] Player Buffs and Player Debuffs are independent aura composites with populated ghost states
      and supported scale controls. Their icons remain clickable for tooltip and cancellation
      behavior, their bounded viewports show the interactive extent, phone exposes three 40 by 40 icon targets,
      tablet exposes six, and every additional icon remains reachable by scrolling. Tap toggles or
      swaps a tooltip, tapping elsewhere dismisses it, and only a slop-guarded hold on the player's
      own helpful buff cancels that aura.
- [ ] The Minimap cluster moves and scales its zone label, map, clock, coordinates, compass, raid
      lockout, mail indicator, and controls together. Target auras stay with Target; XP, cast, and
      swing stay with Player. Target reserves 236 by 68 when empty and a 236 by 121 maximum envelope
      for its interactive aura viewport.
- [ ] Party / Raid shrinks to sparse runtime content without leaving a raid-sized pointer deadzone,
      while Edit Mode shows its maximum 372 by 40 horizontal or 68 by 260 vertical raid-capacity
      scroll viewport. Save validates scale and target size, not exclusive space.
- [ ] The Deeds tracker header shows its registered interactive footprint. Delve text is
      click-through, its one affix icon owns a fixed 40 by 40 interactive pocket, and Delve remains a
      dropdown representative because that mixed surface has a distinct editable signature.
- [ ] The standalone Discord call-to-action is hidden during mobile `game-active` gameplay and
      Discord remains reachable through More, so no duplicate unregistered pointer interceptor is
      present.
- [ ] Quest Tracker is absent from every landscape editor scene and Meters remains an opened window,
      not a layout surface.
- [ ] The editor exposes nine unique editable preview signatures across World, Arena, Fiesta, Yumi,
      Vale Cup, and Delve without displaying equivalent foreground-only states as duplicate options.
- [ ] Every canonical context ID remains pinned by the runtime resolver and complete validation
      matrix. Each context maps deterministically to one dropdown representative with the same
      editable surface signature after foreground overlays are ignored.
- [ ] Every descriptor satisfies `visibleIn` as a subset of `validateIn`; every runtime-reachable
      context is mandatory Save and load validation even when hidden by the ordinary scene preview.
- [ ] Shared controls keep one placement across scenes. Scene changes never mutate persisted data.
- [ ] Context-specific compact status strips use their own placements and visible empty
      placeholders. Informational status text is click-through and pairwise non-blocking;
      foreground briefing, augment, betting, respawn, and center-message UI never creates a
      player-repairable collision.
- [ ] Protected-to-protected overlap requires a reciprocal explicit registry exception. Missing or
      one-sided exceptions fail registry tests and are never presented as player-repairable errors.
- [ ] Registry-owned composite orientation changes child flow without rotating icons, text, or
      health bars.
- [ ] Phone and tablet profiles resolve through the existing tier model and survive viewport and
      fullscreen changes.
- [ ] Save validates placement structure, finite values, supported capabilities, descriptor scale
      limits, and minimum target size across applicable contexts. Overlap, View intrusion,
      protected UI intersection, and safe-area or viewport escape never paint red or disable Save.
- [ ] Left-handed mode is a derived mirror of canonical data and editing it round-trips without
      drift or a second persisted layout.
- [ ] View is always visible in Edit Mode and never limits camera swipe-look on other unobstructed
      canvas pixels. Other surfaces may overlap it when the player chooses.
- [ ] Invalid placement data, unsupported capabilities, invalid scale, and undersized targets use
      visual plus textual feedback and disable Save. Geometric intersections and bounds do not.
- [ ] Expanded Consumables, full Party / Raid, bounded pet commands, aura viewports, Target auras,
      cast, swing, Deeds, and the Delve affix pocket expose their informative maximum envelopes even
      when the player overlaps them.
- [ ] Drag, Arrow-key nudge, plus and minus resize, Reset Selected, Reset All, Cancel, and Save
      behave deterministically.
- [ ] A valid Save survives reload. Cancel restores the exact entry snapshot. Corrupt or unknown
      stored data falls back safely to current defaults.
- [ ] Load applies the same structural, capability, scale, and target-size validation as Save.
      Registry-owned new contexts and surfaces remain schema-compatible with version 1 data.
- [ ] A storage write failure leaves the draft editable, reports a localized error, and does not
      exit or claim success.
- [ ] Adding a new registry descriptor produces its default placement without migrating existing
      version 1 documents.
- [ ] Custom placement composes with existing element transforms and the floating movement
      joystick. `ui-author` X/Y and root scale conversion preserves the same visual geometry at UI
      scale 0.85, 1, and 1.4 without changing descriptor-local sizes.
- [ ] No production path performs layout measurement or storage work per animation frame.
- [ ] The 740 by 360 compact, 844 by 390 safe-area, 932 by 430 wide-phone, left-handed phone, and
      1024 by 768 tablet browser profiles pass placement, target-size, View, real-entry mobile, and
      screenshot checks.
- [ ] Desktop behavior remains unchanged and the full contribution gate passes.

## Deferred questions

- Whether account sync should be introduced after local usage proves the editor model.
- Whether a later schema adds named layouts, clipboard import/export, opacity, control visibility,
  alignment guides, or undo and redo history.
- Whether players should edit an inactive profile through a simulated canvas. Version 1 edits only
  the active real-device profile so reach and safe areas remain trustworthy.
- Whether a later version permits sparse scene-specific placement overrides for shared controls.
  Version 1 deliberately keeps shared controls fixed across scenes for muscle memory.
- Whether future content adds `instance.dungeon`, `instance.raid`, or `pvp.battleground` scenes.
  The version 1 registry namespace supports adding them without a storage-schema change.

## Research basis

- [Apple Game Controls](https://developer.apple.com/design/human-interface-guidelines/game-controls)
  for safe areas, thumb reach, control size, and maximizing direct camera input space.
- [Apple flexible touch layouts](https://developer.apple.com/videos/play/wwdc2026/358/) for
  anchor-based placement and grouping across different screen shapes.
- [Final Fantasy XIV HUD Layout](https://na.finalfantasyxiv.com/uiguide/know/know-hud/hud-layout.html)
  for selection feedback, explicit Save, element sizing, and orientation limited to appropriate
  hotbar-like surfaces.
- [Call of Duty Mobile Controls](https://blog.activision.com/fr/call-of-duty/2019-10/Getting-a-Grip-on-the-Call-of-Duty-Mobile-Controls)
  for a mock HUD that separates layout editing from gameplay input.
- [WCAG 2.2 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements)
  for a single-pointer alternative to drag-only placement.
- [WCAG 2.2 Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
  for minimum target and spacing validation.
- [CSS environment variables](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Environment_variables)
  for browser-provided safe-area insets.
- [Pointer Events](https://www.w3.org/TR/pointerevents/) for pointer capture and editor gesture
  ownership.
