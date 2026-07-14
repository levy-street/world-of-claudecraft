# Implementation Plan: Mobile Custom HUD Layout Editor

| | |
|---|---|
| Status | In progress |
| Date | 2026-07-11 |
| Branch | `dev-td-mobile-custom-layout` |
| Base | `release/v0.24.0` at `31182684b4043c92e0df18242bdd731bec02819e` |
| Current integration base | `upstream/release/v0.25.0` at `f81518ec9`, merged into the local integration branch at `c19d44ca8` |
| Product spec | [Mobile Custom HUD Layout Editor](../specs/2026-07-11-mobile-custom-hud-layout-editor.md) |
| Estimated tasks | 88 |

## Progress

- [x] T1: Create the deterministic screenshot harness (2026-07-11, help and 740x360 capture green)
- [x] T2: Capture the untouched release baseline (2026-07-11, five images inspected)
- [x] T3: Define the versioned editor model (2026-07-11, 13 tests and typecheck green)
- [x] T4: Pin scenes, contexts, and geometry fixtures (2026-07-11, 768 matrix cases green)
- [x] T5: Implement the exhaustive runtime context resolver (2026-07-11, all priorities green)
- [x] T6: Build registry schema invariants (2026-07-11, seven invariant tests green)
- [x] T7: Register shared actions and joystick surfaces (2026-07-11, 11 descriptors green)
- [x] T8: Register shared composites and frames (2026-07-11, nine composite descriptors and 20 registry tests green)
- [x] T9: Register and geometrically audit context surfaces (2026-07-11, 14 context descriptors and responsive protected audit green)
- [x] T10: Add defaults and DOM adapter metadata (2026-07-11, 34-surface registry and complete profile defaults green)
- [x] T11: Resolve anchors in canonical visual safe-viewport space (2026-07-11, nine anchors and inversion green)
- [x] T12: Implement canonical handedness transforms (2026-07-11, involutive placement mirroring green)
- [x] T13: Resolve scale, footprints, margins, and temporary clamps (2026-07-11, dynamic footprints and non-mutating clamp green)
- [x] T14: Validate one canonical context (2026-07-11, all failure classes and 0.5px epsilon green)
- [x] T15: Validate the complete profile matrix (2026-07-13, all 768 geometry/context cases in both handedness variants, 1,536 evaluations, and stable diagnostics green)
- [x] T16: Map scaled failing previews back to canonical coordinates (2026-07-11, letterbox and UI-author round trips green)
- [x] T17: Add lock, selection, move, and scene draft actions (2026-07-11, immutable locked and mirrored moves green)
- [x] T18: Add scale and capability-specific draft actions (2026-07-11, capability limits and left-hand round trips green)
- [x] T19: Add reset and failure-navigation draft actions (2026-07-11, scoped resets, dirty restore, and failure cycling green)
- [x] T20: Register every pure editor module in the architecture gate (2026-07-11, strict client-only boundary and size gate green)
- [x] T21: Implement the version 1 storage codec (2026-07-11, partial recovery and deterministic async adapter green)
- [x] T22: Merge defaults and matrix-validate loaded profiles (2026-07-11, independent profile fallback and zero-write load green)
- [x] T23: Save only valid drafts and activate on first success (2026-07-11, transactional validation and activation green)
- [x] T24: Map responsive tiers to phone and tablet profiles (2026-07-11, canonical tiers and compatibility green)
- [x] T25: Measure visual viewport, safe area, and UI zoom on events (2026-07-11, event-scoped visual measurement green)
- [x] T26: Hold validated runtime and ephemeral preview state (2026-07-11, validated and ephemeral ownership green)
- [x] T27: Apply custom properties and unusual-viewport fallback (2026-07-11, host conversion, mirror, fallback, and clear green)
- [x] T28: Add custom CSS for actions, frames, and clusters (2026-07-11, active-scope cleanup and 318-test aggregate green)
- [x] T29: Add CSS for Movement, View, and dynamic composites (2026-07-11, four-way drawers, composite flow, dependent roots, and 330-test aggregate green)
- [x] T30: Add context and editor chrome CSS (2026-07-11, all context classes, status bindings, proxy states, and 334-test aggregate green)
- [x] T31: Make editor ownership explicit in the touch router (2026-07-11, editor-first ownership and 97 focused tests green)
- [x] T32: Suspend every mobile touch gesture (2026-07-11, synchronous release, timer cancellation, and 100 focused tests green)
- [x] T33: Add an explicit gamepad input block (2026-07-11, held-edge consumption and 15 focused tests green)
- [x] T34: Add localized editor vocabulary (2026-07-11, 115 leaves, five non-Latin overlays, and 31 i18n tests green)
- [x] T35: Expose the current Vale Cup shoot-charge state (2026-07-11, read-only seam and 46 focused tests green)
- [x] T36: Build the editor dialog shell and lifecycle (2026-07-11, translated singleton dialog, Locked snapshot, focus restoration, and 3 focused tests green)
- [x] T37: Render scenes and capability-aware controls
- [x] T38: Add selection, drag, and ephemeral live preview (2026-07-11, pointer capture, scaled and mirrored drag, and 11 editor tests green)
- [x] T39: Add nudge, resize, orientation, and reset actions (2026-07-11, reducer capabilities, limits, scoped resets, and 14 editor tests green; visible palette simplified by T65)
- [x] T40: Show validation failures and block Save (2026-07-11, eight failure classes, non-color signals, and 23 editor tests green)
- [x] T41: Preserve exact failure metadata for automatic diagnostics (2026-07-11, exact failure geometry metadata and 25 editor tests green; visible cycling superseded by T65)
- [x] T42: Save the already-previewed draft transactionally (2026-07-11, invalid, success, and write-failure paths green)
- [x] T43: Implement Cancel, dirty back, and exact restoration (2026-07-11, pristine, rejected, and accepted discard paths with 31 editor tests green)
- [x] T44: Expose the touch-landscape Interface entry (2026-07-11, keyless shared renderer and 143 Options tests green)
- [x] T45: Wire startup load, editor, applier, Options, and debug ownership (2026-07-11, one load, event-only apply, debug seam, and 272 integration tests green)
- [x] T46: Normalize the live runtime context (2026-07-11, all snapshot sources, charge state, and 126 context/client tests green)
- [x] T47: Gate keyboard actions and movement while editing (2026-07-11, force-clear input seam and keyboard/frame gates green)
- [x] T48: Wire touch and gamepad suspension to editor lifecycle (2026-07-11, editor touch owner and controller input block green)
- [x] T49: Refresh geometry and warnings only on viewport events (2026-07-11, viewport-only refresh, fallback recovery, and 322 integration tests green)
- [x] T50: Add shared DOM overlap geometry helpers (2026-07-11, 0.5px self-test and mixed-host real-page measurements green)
- [x] T51: Verify the real Options entry and live preview (2026-07-11, 740x360 offline Puppeteer flow green)
- [x] T52: Verify Save activation and reload persistence (2026-07-11, right-hand persistence and derived left-hand mirror green)
- [x] T53: Verify Cancel and storage failure rollback (2026-07-11, exact runtime restoration and preserved open draft green)
- [x] T54: Verify keyboard isolation (2026-07-11, movement, jump, ability, target, interact, and Escape ownership green)
- [x] T55: Verify touch and haptic isolation (2026-07-11, movement, action, menu, swipe, and zero-haptic editor ownership green)
- [x] T56: Verify real gamepad isolation (2026-07-11, injected standard pad blocked while open and restored after close)
- [x] T57: Verify View and camera semantics (2026-07-11, inside/outside swipe block, close restoration, and disabled joystick deadzone green)
- [x] T58: Cover custom overlap auditing (2026-07-11, implemented in the focused editor audit rather than extending the legacy fixed-layout sweep, keeping the two contracts isolated)
- [x] T59: Add browser DOM and CSS coverage (2026-07-11, phone/tablet render, selection, focus, and preview green)
- [x] T60: Extend the browser accessibility gate (2026-07-11, axe, named modal, live status, focus trap, and keyboard alternatives green)
- [x] T61: Extend browser target-size coverage (2026-07-11, 740, 844+inset, 932, left-hand, and tablet matrix; three browser files and 47 tests green)
- [x] T62: Capture and inspect after screenshots (2026-07-11, five phone/tablet, safe-area, failure, and left-hand images inspected)
- [x] T63: Regenerate localization artifacts (2026-07-11, deterministic generation and resolved hash baseline updated)
- [x] T64: Verify all acceptance criteria and contribution gates (2026-07-11, full nine-step gate, 12,378 unit tests, 47 browser tests, real offline audit, and five inspected screenshot pairs green)
- [x] T65: Consolidate editor chrome into one movable center palette (2026-07-12, one context dropdown, scale/reset-only inspector, automatic red failures, full-height landscape map, 576 focused and 47 browser tests green)
- [x] T66: Replace opaque editor area boxes with live HUD visuals and transparent proxies, then verify in real mobile landscape runtime (2026-07-12, live fragment opacity, transparent proxy hit layer, real mobile audit, and refreshed 740x360 screenshot green)
- [x] T67: Fix device-tested editor feedback: class-gate Pet Controls, coalesce pointer moves to one update per animation frame, keep invalid drag previews live without fallback, validate only the active context during pointer moves, force the real View joystick visible and inert, align proxies one-to-one with the viewport, remove selected proxy labels over live icons, isolate the live HUD with inert, and complete keyboard palette and teardown behavior (2026-07-12, unit, browser, typecheck, and real pointer-drag mobile runtime audit green)
- [x] T68: Repair Save validation after device testing: use real interactive footprints for pair collisions, temporarily preserve equal or improved built-in validation debt while blocking worsened/new failures, prioritize protected diagnostics over View, and make the runtime audit persist a genuinely customized placement (2026-07-12, regression tests and complete-matrix one-pixel nudge green; all baseline-debt handling was removed by T79)
- [x] T69: Make invalid Save visually disabled as well as natively disabled, with a real-browser regression proving muted styling, `not-allowed` feedback, and zero storage writes (2026-07-12)
- [x] T70: Separate stable primary HUD footprints from runtime layout and gesture extents, inset editor outlines to the real visual, keep decorative text non-blocking, keep the expanded Consumables drawer viewport-bounded, and raise its interactive row above ordinary HUD frames (2026-07-12; pairwise drawer protection completed by T79)
- [x] T71: Stop unavailable class-specific surfaces from validating, falling back, or blocking Save; make center messages non-blocking and always-front; and replace the generic invalid status with the exact colliding surface names (2026-07-12, 232 focused tests and typecheck green)
- [x] T72: Focus the editor on the exact context and geometry of an off-context matrix failure, name protected collision partners instead of generic protected game UI, and paint only failures belonging to the displayed context (2026-07-12, device-screenshot regression and 45 editor tests green)
- [x] T73: Audit Delve tracker text as click-through while retaining viewport-bound validation (2026-07-12; the first pass did not account for the affix icon, which the mixed-surface audit in T83 corrects)
- [x] T74: Make empty Player Buffs and Player Debuffs discoverable and selectable through semantic editor placeholders, then hand selection back to the real aura icons when populated (2026-07-12, unit, browser CSS, selection, and type tests green)
- [x] T75: Audit all 16 runtime contexts, reduce the dropdown to nine unique editable signatures, classify informational versus foreground overlays, preserve only real interactive footprints, add scalable empty status placeholders, and document the decision contract for future contributors and AI agents (2026-07-12)
- [x] T76: Extract phone and tablet default placements into a registered pure sibling module after the full architecture gate exposed registry growth beyond 1000 lines (2026-07-12, 69 focused registry and architecture tests, typecheck, and all build targets green)
- [x] T77: Remove the redundant visible palette title and complete a first pass over player-aura foreground styling (2026-07-12; the visual simplification remains, while T82 corrects the interaction classification after tooltip and cancellation ownership was audited)
- [x] T78: Separate interactive collision, exact painted geometry, and the minimum drag proxy; measure DOM and pseudo-element artwork for Target, Player, action faces, Party, Pet, and dynamic auras; refresh dynamic geometry through event-driven observation instead of drag-frame queries (2026-07-12, Warrior and Rogue runtime measurements plus focused unit and browser regressions green)
- [x] T79: Remove baseline collision waivers, repack phone and tablet defaults so the strict canonical matrix is valid, protect the complete Movement capture zone and expanded Consumables tray, normalize the full Minimap/Party/Pet runtime geometry, and reject unsafe stored v1 profiles through the existing validated fallback (2026-07-13)
- [x] T80: Complete the post-merge mobile landscape safety audit: validate and runtime-fallback both handedness variants, normalize omitted capability fields, serialize complete phone/tablet profiles, bound nine raid-member rows inside the registered Party scroll viewport, retain 40px Minimap satellite targets at minimum scale, isolate compact/left custom CSS, and render pointer-through validation envelopes plus full empty Party/Target/Pet placeholders (2026-07-13)
- [x] T81: Correct `ui-author` placement conversion so visual X/Y and root scale divide by live UI scale while descriptor-local geometry remains canonical; pin UI scale 0.85, 1, and 1.4 and retain strict validation in both handedness variants (2026-07-13)
- [x] T82: Reclassify every interactive dynamic state as blocking and either reserve its maximum envelope or constrain it to a bounded scroll viewport: Player Buffs/Debuffs show three phone or six tablet 40 by 40 targets around unchanged classic faces, Target reserves 236 by 121 with five visible aura targets, Pet commands scroll, and sparse Party / Raid shrinks within its maximum raid envelope (2026-07-13)
- [x] T83: Complete the missing-surface audit: register the blocking `tracker.deeds` header, make `tracker.delve` mixed with click-through text and one 40 by 40 affix pocket, retain Delve as a distinct dropdown signature, and hide the duplicate mobile Discord call-to-action during active gameplay because More still owns Discord (2026-07-13)
- [x] T84: Align the architecture contract, product spec, and plan with T79 through T83, remove superseded informational/transient wording, and record the adversarial inventory result that no other persistent mobile gameplay control requires a registry surface (2026-07-13)
- [x] T85: Add touch-owned Player/Target aura descriptions and safe buff cancellation: 40px native aura buttons toggle the tooltip on tap, outside taps dismiss it, and a 650ms slop-guarded hold cancels only the exact helpful player buff pressed; keep Party mini auras as noninteractive row status and stop reparented desktop aura context menus before the Player self menu (2026-07-13)
- [x] T86: Make automatic failure preview honor the failure's handedness without changing the runtime preference, hide every foreign-hand owned fragment, snapshot handedness through pointer capture, defer proxy rebuild until release, and include localized hand state in diagnostics (2026-07-13)
- [x] T87: Disable player-layout overlap, View, protected-surface, safe-area, and viewport-boundary enforcement after device testing showed false conflicts, editor/runtime geometry drift, and unexpected fallback. Preserve the attempted strict design in this historical plan, keep safe-area measurement only for notch-aware anchoring and editor chrome, and retain blocking validation only for malformed data, unsupported capabilities, invalid scale, and undersized targets (2026-07-14)
- [x] T88: Make every painted movable context frame, not only its smaller runtime primary footprint, selectable and draggable in Edit Mode, keep context-status proxies above shared controls, hide fixed protected proxies, and restore modal stacking for discard confirmation and More over Consumables (2026-07-15)
- [x] T89: Preserve 48px combat, menu, and Consumables targets plus 40px compact composite targets while visual art scales to 0.5; elevate the selected proxy and cycle downward on repeated overlap taps; close the game-skinned context dropdown on outside tap (2026-07-15, focused unit and Chromium regressions green)

## Outcome

Add a landscape touch HUD editor that moves and scales every registered mobile HUD surface,
supports capability-specific orientation, validates phone and tablet profiles across the complete
gameplay-context matrix, derives left-handed layouts from canonical right-handed data, allows
intentional overlap and off-safe-area placement, and persists structurally valid local layouts. The editor must
own all touch input while open and must leave desktop, portrait, gameplay, simulation, wire, and
server behavior unchanged.

## File structure

### Create

- `src/ui/mobile_hud_editor_types.ts`
  - Shared IDs, coordinate hosts, placement document, descriptor, geometry, validation, draft, and
    adapter types.
- `src/ui/mobile_hud_context.ts`
  - Canonical scene/context fixtures and pure runtime context resolver.
- `src/ui/mobile_hud_registry.ts`
  - Capability registry, defaults, dynamic footprints, protected runtime surfaces, and DOM bindings.
- `src/ui/mobile_hud_editor_core.ts`
  - Pure anchor, mirror, geometry, data validation, preview mapping, and draft logic.
- `src/ui/mobile_hud_layout_store.ts`
  - Version 1 codec, async storage adapter, partial recovery, and validated load/save operations.
- `src/ui/mobile_hud_editor.ts`
  - Full-screen proxy editor lifecycle and DOM interaction layer.
- `tests/mobile_hud_editor_types.test.ts`
- `tests/mobile_hud_context.test.ts`
- `tests/mobile_hud_registry.test.ts`
- `tests/mobile_hud_editor_core.test.ts`
- `tests/mobile_hud_layout_store.test.ts`
- `tests/mobile_hud_editor.test.ts`
- `tests/browser/mobile_hud_editor.browser.test.ts`
- `scripts/mobile_hud_editor_check.mjs`
- `scripts/mobile_hud_editor_shots.mjs`
- `docs/screenshots/mobile-hud-editor/before-740x360-world.png`
- `docs/screenshots/mobile-hud-editor/after-740x360-world.png`
- `docs/screenshots/mobile-hud-editor/before-844x390-world.png`
- `docs/screenshots/mobile-hud-editor/after-844x390-arena-fiesta.png`
- `docs/screenshots/mobile-hud-editor/before-932x430-world.png`
- `docs/screenshots/mobile-hud-editor/after-932x430-failing-layout.png`
- `docs/screenshots/mobile-hud-editor/before-740x360-left-handed.png`
- `docs/screenshots/mobile-hud-editor/after-740x360-left-handed.png`
- `docs/screenshots/mobile-hud-editor/before-1024x768-tablet.png`
- `docs/screenshots/mobile-hud-editor/after-1024x768-tablet.png`

### Modify

- `src/ui/mobile_hud_layout.ts`
  - Map existing compact/standard tiers to the phone profile and tablet tier to tablet.
- `src/game/mobile_hud_layout_applier.ts`
  - Hold the validated in-memory custom document, measure safe area on events, and apply dedicated
    CSS properties without replacing existing transforms.
- `src/game/touch_router.ts`
  - Treat editor ownership as an explicit gameplay-input block.
- `src/game/mobile_controls.ts`
  - Add editor suspension that immediately releases movement, autorun, camera, pinch, swipe, and
    pointer ownership.
- `src/game/gamepad.ts`
  - Add an explicit gameplay-input block that neutralizes held controller state without entering
    the ordinary window cursor mode.
- `src/ui/options_window.ts`
  - Paint the touch-landscape-only Interface entry through the shared category-detail renderer so
    desktop rail, wide mobile rail, and narrow mobile back-stack use one action path.
- `src/ui/options_ia.ts`
  - Register the non-settings mobile HUD editor action in the Interface information architecture
    without adding it to settings-key ownership or scoped reset counts.
- `src/ui/hud.ts`
  - Extend `OptionsHooks` with thin editor availability/open callbacks and expose one read-only Vale
    Cup shoot-charge getter for runtime context normalization.
- `src/main.ts`
  - Own store loading, editor construction, runtime context inputs, input suspension, application,
    and resize/fullscreen refresh.
- `src/styles/hud.mobile.css`
  - Add custom-layout variables, per-surface composition rules, proxy editor, invalid, focus, and
    safe-area styles.
- `src/ui/i18n.catalog/hud_chrome.ts`
  - Add every visible and accessible English editor string.
- `src/ui/i18n.resolved.generated/*.ts`
  - Regenerate all deterministic UI locale outputs with English fallback strings using
    `npm run i18n:gen`; do not hand edit them.
- `tests/mobile_hud_layout.test.ts`
- `tests/mobile_hud_layout_applier.test.ts`
- `tests/touch_router.test.ts`
- `tests/mobile_controls.test.ts`
- `tests/input.test.ts`
- `tests/gamepad.test.ts`
- `tests/options_window.test.ts`
- `tests/options_ia.test.ts`
- `tests/options_mobile_shell.test.ts`
- `tests/client_shell.test.ts`
- `tests/hud_chrome_i18n.test.ts`
- `tests/vale_cup_ui_guard.test.ts`
- `tests/architecture.test.ts`
- `tests/browser/a11y.browser.test.ts`
- `tests/browser/target_size.browser.test.ts`
- `scripts/lib/overlap_geometry.mjs`
- `scripts/mobile_hud_overlap_audit.mjs`

### Delete

No files.

### Consume unchanged

- `src/game/app_viewport.ts`: existing event-driven viewport sync.
- `src/game/input.ts`: `Input.setSuspendMovement`, `Input.setAutorun`, and held-slot release.
- `src/ui/ui_scale.ts`: `getUiScale` and the existing CSS zoom author-space contract.
- `src/ui/mobile_action_page_view.ts`: action seat semantics remain unchanged.
- `src/ui/party_collapse.ts` and `src/ui/party_frames_painter.ts`: dynamic Party ownership.
- `src/ui/consumable_bar_view.ts`: six-slot worst-case Consumables fixture.
- Existing Arena, Fiesta, Yumi, Vale Cup, and Delve painters: runtime visibility remains owned by
  current gameplay painters; the custom applier only positions their roots.

## Global constraints

- **Package manager and runtime:** repository `npm`; TypeScript `^5.5.0`; Vitest `4.1.8`;
  Playwright `1.61.1`; Puppeteer Core `^25.1.0`.
- **Focused test command:** `npx vitest run <listed test files>` after every RED/GREEN task.
- **Browser test command:** `npm run test:browser -- <listed browser test files>`.
- **Final contribution command:** `npm run gate` plus the two mobile editor scripts.
- **Dependency policy:** add no runtime or development dependency. Reuse current Vitest, the
  repository's focused fake-DOM pattern, Browser Mode, Puppeteer, and geometry helpers.
- **Architecture:** pure host-agnostic decision modules under `src/ui`; DOM, storage, and viewport
  access only in adapters. Do not add behavior to `IWorld`, simulation, server, wire, or database
  surfaces. Keep `src/ui/hud.ts` as a thin hook seam.
- **Input:** opening the editor must synchronously release current touch and gamepad ownership and
  autorun; gameplay button, movement, camera, pinch, swipe, menu, keyboard, and controller intent
  remain suspended until editor exit.
- **Layout:** landscape touch only. Do not change portrait or desktop output. Use the existing tier
  resolver: compact and standard use `phone`; tablet uses `tablet`.
- **Coordinates and transforms:** persisted placements, editor proxies, safe areas, and collision
  rectangles use one canonical visual CSS-pixel space. Every DOM binding declares
  `body-visual` or `ui-author`. Body-level controls receive canonical coordinates directly. When
  writing a `ui-author` binding, divide visual X/Y by live UI scale and apply
  `placementScale / uiScale` at the root while descriptor-local geometry remains in canonical
  author space. Adapters write named CSS custom properties or individual `translate`/`scale`
  properties, never a universal inline `transform`. Movement floating `left`/`top` remains owned
  by `MobileControls`.
- **Performance:** storage reads and safe-area measurements happen at startup, editor open, save,
  and viewport/fullscreen events only. No per-frame DOM reads, storage work, or allocations.
- **Persistence:** key `woc_mobile_hud_layout_v1_defaults_3`; schema version `1`; canonical
  right-handed data; async adapter contract; Save and load share structural, capability, scale, and
  minimum-target validation.
- **Validation policy:** canonical phone/tablet, safe-area, context, and handedness fixtures remain
  developer regression inputs. T87 supersedes the earlier strict collision tasks: overlap, View,
  protected UI, and bounds are allowed and never block Save, load, or runtime application.
- **Accessibility:** preserve existing 48 by 48 gameplay target floors and existing 40 by 40 Party
  and pet floors; every drag and resize operation has button alternatives; color is never the only
  invalid signal.
- **Localization:** add source English strings only to `hud_chrome.ts`, render through `t()`, then
  run `npm run i18n:gen`.
- **Git:** consolidate the work on `mobile-layout-adjustments`; local checkpoint and release merge are
  authorized for this integration session, but do not push or mutate the draft PR remotely.

## Stable interfaces

The task sequence below must preserve these names unless a RED test proves an existing repository
constraint requires a smaller compatible adjustment:

```ts
export type MobileHudProfileId = 'phone' | 'tablet';
export type MobileHudCoordinateHost = 'body-visual' | 'ui-author';
export type MobileHudAnchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface MobileHudPlacement {
  anchor: MobileHudAnchor;
  offsetX: number;
  offsetY: number;
  scale: number;
  orientation?: 'horizontal' | 'vertical';
  reverse?: boolean;
  openingDirection?: 'left' | 'right' | 'up' | 'down';
}

export interface MobileHudLayoutDocumentV1 {
  schemaVersion: 1;
  enabled: boolean;
  profiles: Partial<
    Record<MobileHudProfileId, Partial<Record<MobileHudSurfaceId, MobileHudPlacement>>>
  >;
}

export interface MobileHudLayoutStorage {
  load(): Promise<string | null>;
  save(serialized: string): Promise<void>;
}
```

The pure resolver accepts a normalized `MobileHudRuntimeSnapshot`, not `IWorld`. The registry
exports canonical scene/context fixtures, descriptors, defaults, and DOM bindings. The editor core
exports placement resolution/inversion, mirroring, context validation, matrix validation, failure
diagnostics, preview coordinate mapping, and deterministic draft transitions. The applier accepts
either a document already validated by the store/editor boundary or an explicitly ephemeral editor
preview. Ephemeral preview is never serialized and always yields to the restored entry document on
Cancel. Core/editor geometry always stays in canonical visual CSS pixels. Registry host metadata is
used only to convert an applied `ui-author` surface into the zoomed `#ui` author's coordinates:
visual X/Y and placement scale divide by live UI scale, while descriptor-local geometry does not.

Before T1, confirm `git branch --show-current` is exactly `dev-td-mobile-custom-layout`, confirm the
release commit named above is an ancestor, and run `git status --short`. Preserve the approved spec,
this plan, and every unrelated user-owned change. This preflight is read-only and does not authorize
staging, committing, stashing, rebasing, or pushing.

## Tasks

### T1: Create the deterministic screenshot harness
- **Files:** create scripts/mobile_hud_editor_shots.mjs.
- **Changes:** reuse the offline-game Puppeteer conventions and the identical safe-area simulation
  contract from `mobile_cluster_layout_check.mjs` or the dedicated mobile safe-area scripts; accept
  viewport, handedness, scene, safe-area fixture, and output arguments. Initially capture the
  current HUD only.
- **Tests:** run the help path and one temporary 740x360 capture.
- **Interfaces - Consumes / Produces:** existing Puppeteer/offline helper / captureMobileHudEditorShot options used by T2 and T57.
- **Depends on:** none.
- **Estimated time:** 4 minutes.

### T2: Capture the untouched release baseline
- **Files:** create the five before PNG files listed in File structure.
- **Changes:** create `before-740x360-world.png`, `before-844x390-world.png`,
  `before-932x430-world.png`, `before-740x360-left-handed.png`, and
  `before-1024x768-tablet.png` before production edits. Capture the 844x390 baseline with the same
  named 50px safe-area inset fixture used by T62.
- **Tests:** visually inspect all five for the fixed release HUD and no editor overlay.
- **Interfaces - Consumes / Produces:** T1 capture seam / immutable before evidence.
- **Depends on:** T1.
- **Estimated time:** 5 minutes.

### T3: Define the versioned editor model
- **Files:** create src/ui/mobile_hud_editor_types.ts and tests/mobile_hud_editor_types.test.ts.
- **Changes:** RED/GREEN profile, `body-visual`/`ui-author` host, anchor, surface, scene, context,
  placement, geometry, descriptor, failure, draft, document, and async storage types; pin schema 1
  and storage key.
- **Tests:** exact IDs/hosts, nine anchors, partial profiles, non-finite placement rejection, and
  storage interface shape.
- **Interfaces - Consumes / Produces:** approved spec names / common types for T4-T43.
- **Depends on:** none.
- **Estimated time:** 5 minutes.

### T4: Pin scenes, contexts, and geometry fixtures
- **Files:** create src/ui/mobile_hud_context.ts and tests/mobile_hud_context.test.ts.
- **Changes:** RED/GREEN eight scenes, 16 contexts, preview groupings, six viewports, four side-inset cases, and two bottom-inset cases as immutable unique fixtures.
- **Tests:** exact order, IDs, dimensions, inset values, and full matrix cardinality.
- **Interfaces - Consumes / Produces:** T3 types / MOBILE_HUD_SCENES, MOBILE_HUD_CONTEXTS, and MOBILE_HUD_GEOMETRY_MATRIX.
- **Depends on:** T3.
- **Estimated time:** 4 minutes.

### T5: Implement the exhaustive runtime context resolver
- **Files:** modify src/ui/mobile_hud_context.ts and tests/mobile_hud_context.test.ts.
- **Changes:** resolve normalized Cup, Arena/Yumi/Fiesta, spectator, Delve, indicator, and World state in approved priority; emit only a development diagnostic for malformed Cup plus Arena.
- **Tests:** every canonical context and Cup-over-Arena, Arena-over-Delve, and Arena-over-spectator conflicts.
- **Interfaces - Consumes / Produces:** T4 contexts / resolveMobileHudContext used by T46.
- **Depends on:** T4.
- **Estimated time:** 5 minutes.

### T6: Build registry schema invariants
- **Files:** create src/ui/mobile_hud_registry.ts and tests/mobile_hud_registry.test.ts.
- **Changes:** RED/GREEN duplicate-ID, context-set, capability, placement-field, visibleIn subset, and reciprocal overlap-declaration validation.
- **Tests:** one minimal passing registry and one focused rejection per invariant.
- **Interfaces - Consumes / Produces:** T3-T4 types/fixtures / buildMobileHudRegistry.
- **Depends on:** T3, T4.
- **Estimated time:** 5 minutes.

### T7: Register shared actions and joystick surfaces
- **Files:** modify src/ui/mobile_hud_registry.ts and tests/mobile_hud_registry.test.ts.
- **Changes:** add A1-A5, Attack, Target, Jump/Use, Page, Movement, and View with all-context membership, limits, floors, comfort padding, mirror policy, and bindings.
- **Tests:** exact IDs, individual placements, all-context sets, and View/Movement minimum envelopes.
- **Interfaces - Consumes / Produces:** T6 builder / shared combat descriptors.
- **Depends on:** T6.
- **Estimated time:** 5 minutes.

### T8: Register shared composites and frames
- **Files:** modify src/ui/mobile_hud_registry.ts and tests/mobile_hud_registry.test.ts.
- **Changes:** add Consumables, pet, Party, top menu, Minimap, Target, Player, Buffs, and Debuffs with only approved capabilities and worst-case variants.
- **Tests:** dependent-child ownership, six Consumables, maximum Party/pet/aura cases, and explicit Quest Tracker/Meters exclusions.
- **Interfaces - Consumes / Produces:** T6 builder / complete shared inventory and dynamic footprints.
- **Depends on:** T6.
- **Estimated time:** 5 minutes.

### T9: Register and geometrically audit context surfaces
- **Files:** modify src/ui/mobile_hud_registry.ts and tests/mobile_hud_registry.test.ts.
- **Changes:** add every movable status and protected ghost with exact contexts; at registry build, resolve protected footprints across every reachable context and responsive geometry.
- **Tests:** exact aliases/memberships plus failure for actual protected intersections without reciprocal exceptions, one-sided exceptions, and geometry-specific intersections.
- **Interfaces - Consumes / Produces:** T4 matrix and T6 invariants / complete validated context registry.
- **Depends on:** T4, T6.
- **Estimated time:** 5 minutes.

### T10: Add defaults and DOM adapter metadata
- **Files:** modify src/ui/mobile_hud_registry.ts and tests/mobile_hud_registry.test.ts.
- **Changes:** define deterministic phone/tablet defaults and root/dependent-root custom-property
  bindings for every movable descriptor. Each binding declares `body-visual` or `ui-author` from
  its actual DOM parent; Movement never owns inline left/top.
- **Tests:** both defaults, exact host ownership, and one valid binding per movable ID; no placement
  for protected IDs; default insertion for a new descriptor.
- **Interfaces - Consumes / Produces:** T7-T9 registry / defaultMobileHudPlacements and binding metadata.
- **Depends on:** T7, T8, T9.
- **Estimated time:** 5 minutes.

### T11: Resolve anchors in canonical visual safe-viewport space
- **Files:** create src/ui/mobile_hud_editor_core.ts and tests/mobile_hud_editor_core.test.ts.
- **Changes:** RED/GREEN nine-anchor resolution and nearest-anchor derivation after visualViewport
  offsets and safe insets, always in visual CSS pixels. Do not divide canonical data by `#ui` zoom.
- **Tests:** round-trip every anchor with nonzero visual offsets across phone/tablet geometries and
  prove the canonical result is independent of host and UI Scale.
- **Interfaces - Consumes / Produces:** T3 geometry / resolveMobileHudPlacement and deriveMobileHudPlacement.
- **Depends on:** T3.
- **Estimated time:** 5 minutes.

### T12: Implement canonical handedness transforms
- **Files:** modify src/ui/mobile_hud_editor_core.ts and tests/mobile_hud_editor_core.test.ts.
- **Changes:** RED/GREEN anchor/offset mirroring, position-and-order growth, and opening direction without reflecting text, maps, bars, or vertical order.
- **Tests:** right-left-right round trips without drift for every anchor/capability.
- **Interfaces - Consumes / Produces:** T10 mirror policies and T11 coordinates / mirror and unmirror functions.
- **Depends on:** T10, T11.
- **Estimated time:** 4 minutes.

### T13: Resolve scale, footprints, margins, and temporary clamps
- **Files:** modify src/ui/mobile_hud_editor_core.ts and tests/mobile_hud_editor_core.test.ts.
- **Changes:** RED/GREEN descriptor scale limits/steps, target floors, margins, and non-persisting
  clamps. Resolve every descriptor's canonical local size directly in the common visual collision
  space; host conversion remains an applier concern and cannot change validation geometry.
- **Tests:** invalid values and undersized targets fail; mixed-host visual sizes remain identical
  at UI scales 0.85/1/1.4; returning viewport restores exact canonical placement.
- **Interfaces - Consumes / Produces:** T10 descriptors and T11 coordinates / resolved rectangles and clamp result.
- **Depends on:** T10, T11.
- **Estimated time:** 5 minutes.

### T14: Validate one canonical context
- **Files:** modify src/ui/mobile_hud_editor_core.ts and tests/mobile_hud_editor_core.test.ts.
- **Changes:** validate bounds, pair overlap, View intrusion, Movement/View, protected ghosts, capability values, and COLLISION_EPSILON_CSS_PX 0.5 for one context.
- **Tests:** touching padded envelopes pass; over-epsilon intersections fail with reason and IDs;
  body-level controls collide correctly with zoomed `#ui` surfaces in common visual space;
  composite children do not self-collide.
- **Interfaces - Consumes / Produces:** T9 and T13 / validateMobileHudContext.
- **Depends on:** T9, T13.
- **Estimated time:** 5 minutes.

### T15: Validate the complete profile matrix
- **Files:** modify src/ui/mobile_hud_editor_core.ts and tests/mobile_hud_editor_core.test.ts.
- **Changes:** validate current geometry plus the exact profile geometry by inset by context matrix and return deterministic full diagnostics.
- **Tests:** compact-only, optional indicator/charge, Fiesta variants, and bilateral-inset failures report exact profile, viewport, inset, context, variants, IDs, and reason.
- **Interfaces - Consumes / Produces:** T4 matrix, T10 variants, T14 validator / validateMobileHudProfileMatrix.
- **Depends on:** T4, T10, T14.
- **Estimated time:** 5 minutes.

### T16: Map scaled failing previews back to canonical coordinates
- **Files:** modify src/ui/mobile_hud_editor_core.ts and tests/mobile_hud_editor_core.test.ts.
- **Changes:** RED/GREEN forward and inverse point/rectangle mapping through preview scale,
  visualViewport offset, safe area, and handedness. The editor proxy stays in visual space and
  never applies host-author conversion.
- **Tests:** drag and CSS-pixel nudge round-trip for both host types, every UI scale, and a nonzero
  visual offset with identical canonical output.
- **Interfaces - Consumes / Produces:** T11-T12 transforms and T15 diagnostics / failing-preview mapping functions.
- **Depends on:** T11, T12, T15.
- **Estimated time:** 4 minutes.

### T17: Add lock, selection, move, and scene draft actions
- **Files:** modify src/ui/mobile_hud_editor_core.ts and tests/mobile_hud_editor_core.test.ts.
- **Changes:** RED/GREEN draft creation, lock/unlock, selection, canonical move, and scene/context selection.
- **Tests:** Locked actions are mutation-free, shared placement survives scene changes, and scene changes never alter enabled state.
- **Interfaces - Consumes / Produces:** T10 defaults and T16 mapping / first draft reducer actions.
- **Depends on:** T10, T16.
- **Estimated time:** 5 minutes.

### T18: Add scale and capability-specific draft actions
- **Files:** modify src/ui/mobile_hud_editor_core.ts and tests/mobile_hud_editor_core.test.ts.
- **Changes:** RED/GREEN CSS-pixel nudge, stepped scale, flow, reverse, and opening-direction actions with unsupported actions as no-ops.
- **Tests:** all limits, steps, descriptor capability combinations, and mirrored edits.
- **Interfaces - Consumes / Produces:** T12 and T17 reducer / manipulation actions used by T39.
- **Depends on:** T12, T17.
- **Estimated time:** 4 minutes.

### T19: Add reset and failure-navigation draft actions
- **Files:** modify src/ui/mobile_hud_editor_core.ts and tests/mobile_hud_editor_core.test.ts.
- **Changes:** RED/GREEN Reset Selected, active-profile-only Reset All, ordered failure cycling, and exact entry snapshot restore.
- **Tests:** defaults are deterministic, inactive profile is byte-identical, and every failure can be selected.
- **Interfaces - Consumes / Produces:** T10 defaults, T15 failures, T17 reducer / transaction actions for T41-T43.
- **Depends on:** T10, T15, T17.
- **Estimated time:** 4 minutes.

### T20: Register every pure editor module in the architecture gate
- **Files:** modify tests/architecture.test.ts.
- **Changes:** add editor types, context, registry, and core to `UI_PURE_CORES`; add the three
  bare-named pure modules to `BARE_NAMED`; keep store/editor DOM modules out.
- **Tests:** run the focused existence, reverse-completeness, forbidden-import, determinism, and
  exact `BARE_NAMED` equality checks after all four files exist.
- **Interfaces - Consumes / Produces:** T3-T11 pure modules / architecture ownership consumed by T59.
- **Depends on:** T3, T4, T6, T11.
- **Estimated time:** 3 minutes.

### T21: Decode, encode, and define enabled semantics
- **Files:** create src/ui/mobile_hud_layout_store.ts and tests/mobile_hud_layout_store.test.ts.
- **Changes:** RED/GREEN schema 1 codec, async local adapter, deterministic serialization, root checks, unknown-ID ignore, per-placement recovery, and explicit enabled boolean parsing.
- **Tests:** malformed root/version rejects all; invalid placement drops alone; unknown ID disappears; enabled false survives load without activating custom runtime.
- **Interfaces - Consumes / Produces:** T3 and T10 / codec plus LocalMobileHudLayoutStorage.
- **Depends on:** T3, T10.
- **Estimated time:** 5 minutes.

### T22: Merge defaults and matrix-validate loaded profiles
- **Files:** modify src/ui/mobile_hud_layout_store.ts and tests/mobile_hud_layout_store.test.ts.
- **Changes:** merge sparse data over current defaults, validate profiles independently through T15, and never rewrite during load.
- **Tests:** one profile falls back without the other; new descriptors/contexts need no migration; unusual runtime failure preserves stored data.
- **Interfaces - Consumes / Produces:** T10 and T15 / loadMobileHudLayout with fallback diagnostics.
- **Depends on:** T10, T15, T21.
- **Estimated time:** 5 minutes.

### T23: Save only valid drafts and activate on first success
- **Files:** modify src/ui/mobile_hud_layout_store.ts and tests/mobile_hud_layout_store.test.ts.
- **Changes:** validate before write, force enabled true only in the successful serialized Save result, await adapter confirmation, and return typed invalid/write failures without mutating the draft.
- **Tests:** invalid and Cancel-equivalent paths write zero times; first valid Save activates; rejection preserves draft; scene editing never toggles enabled.
- **Interfaces - Consumes / Produces:** T15 and T21 / saveMobileHudLayout result for T42.
- **Depends on:** T15, T21.
- **Estimated time:** 4 minutes.

### T24: Map existing tiers to custom profiles
- **Files:** modify src/ui/mobile_hud_layout.ts and tests/mobile_hud_layout.test.ts.
- **Changes:** RED/GREEN compact and standard to phone, tablet to tablet, without changing existing classes/menu/desktop/portrait output.
- **Tests:** all tiers, canonical viewports, touch false, and portrait compatibility.
- **Interfaces - Consumes / Produces:** MobileHudTier and T3 / mobileHudProfileForTier.
- **Depends on:** T3.
- **Estimated time:** 3 minutes.

### T25: Measure visual viewport, safe area, and UI zoom on events
- **Files:** modify src/game/mobile_hud_layout_applier.ts and tests/mobile_hud_layout_applier.test.ts.
- **Changes:** add one event-driven reader returning canonical visual viewport/insets plus a
  separate live UI Scale using visualViewport offsets/dimensions, safe-area probe, and getUiScale;
  no frame-loop read.
- **Tests:** exact visual geometry independent of UI Scale, separate scale 0.85/1/1.4, nonzero
  offsets, side/bottom insets, and one measurement per event.
- **Interfaces - Consumes / Produces:** T11 coordinate contract and src/ui/ui_scale.ts / readMobileHudViewportGeometry.
- **Depends on:** T11.
- **Estimated time:** 5 minutes.

### T26: Hold validated runtime and ephemeral preview state
- **Files:** modify src/game/mobile_hud_layout_applier.ts and tests/mobile_hud_layout_applier.test.ts.
- **Changes:** add validated document setter plus separate begin/update/end ephemeral preview APIs. Preview wins visually, never writes storage, and end restores the entry document. Disabled documents use defaults; preview does not toggle enabled.
- **Tests:** default/disabled/enabled selection, preview priority, repeated scene changes, Cancel restoration, and property clearing.
- **Interfaces - Consumes / Produces:** T22 load and T24 profile / setMobileHudCustomLayout plus preview session API.
- **Depends on:** T22, T24, T25.
- **Estimated time:** 5 minutes.

### T27: Apply custom properties and unusual-viewport fallback
- **Files:** modify src/game/mobile_hud_layout_applier.ts and tests/mobile_hud_layout_applier.test.ts.
- **Changes:** resolve/mirror in visual space, then leave `body-visual` writes unchanged and divide
  only `ui-author` X/Y and placement root scale by live UI Scale. Keep descriptor-local sizes
  canonical. Write named properties, preserve transforms and Movement inline left/top, clear stale
  state, and temporarily use defaults on runtime failure.
- **Tests:** mixed hosts at 0.85/1/1.4, desktop no-op, mirror, transform/Movement preservation,
  fallback without mutation, and idempotent clear.
- **Interfaces - Consumes / Produces:** T10, T12-T15, T25-T26 / applied state and fallback diagnostic for T49.
- **Depends on:** T10, T12, T13, T15, T25, T26.
- **Estimated time:** 5 minutes.

### T28: Add custom CSS for actions, frames, and clusters
- **Files:** modify src/styles/hud.mobile.css and tests/client_shell.test.ts.
- **Changes:** add scoped custom positioning for both body-level actions/menu and `#ui` Minimap,
  Player, Target, Buffs, and Debuffs through their already host-converted left/top/translate/scale
  properties; defaults remain authoritative otherwise.
- **Tests:** every binding exists and custom rules do not take ownership of universal transform.
- **Interfaces - Consumes / Produces:** T10 and T27 properties / shared visual layout.
- **Depends on:** T10, T27.
- **Estimated time:** 5 minutes.

### T29: Add CSS for Movement, View, and dynamic composites
- **Files:** modify src/styles/hud.mobile.css and tests/client_shell.test.ts.
- **Changes:** style body-level Movement, optional camera joystick, View ghost, Consumables, and
  menu without UI Scale conversion; style `#ui` Party, pet, and aura flow/reverse from converted
  author properties.
- **Tests:** View ghost absent at runtime when joystick is off, no runtime pointer/deadzone element is created, all directions/flows exist, and target floors remain.
- **Interfaces - Consumes / Produces:** T8 and T27 / complete shared interactive styling.
- **Depends on:** T8, T27, T28.
- **Estimated time:** 5 minutes.

### T30: Add context and editor chrome CSS
- **Files:** modify src/styles/hud.mobile.css and tests/client_shell.test.ts.
- **Changes:** style `#ui` movable statuses/protected ghosts from author-space properties while the
  body-level editor proxy/dock remains in canonical visual space; add selection, invalid,
  icon/text, focus, and failing-preview styles.
- **Tests:** every context ID class exists; Quest Tracker/Meters are absent; landscape-touch scope prevents desktop/portrait changes.
- **Interfaces - Consumes / Produces:** T9 registry / stable editor class contract for T36-T43.
- **Depends on:** T9, T28, T29.
- **Estimated time:** 5 minutes.

### T31: Make editor ownership explicit in the touch router
- **Files:** modify src/game/touch_router.ts and tests/touch_router.test.ts.
- **Changes:** add editorOpen to routing context; it blocks before Movement, combat, and camera without changing ordinary routing.
- **Tests:** every target is blocked while editing and all existing multitouch ownership stays green.
- **Interfaces - Consumes / Produces:** existing router / editor exclusion used by T32.
- **Depends on:** none.
- **Estimated time:** 3 minutes.

### T32: Suspend every mobile touch gesture
- **Files:** modify src/game/mobile_controls.ts and tests/mobile_controls.test.ts.
- **Changes:** add setHudEditorActive that releases Movement, autorun, camera joystick, swipe, pinch, pointer ledger, timers, and gates all button/gesture starts.
- **Tests:** open during each gesture, no callback/haptic/action through editor, and exact restoration after close.
- **Interfaces - Consumes / Produces:** T31 and Input release APIs / touch suspension seam for T48.
- **Depends on:** T31.
- **Estimated time:** 5 minutes.

### T33: Add an explicit gamepad input block
- **Files:** modify src/game/gamepad.ts and tests/gamepad.test.ts.
- **Changes:** add GamepadCallbacks.isInputBlocked checked before pointer mode; clear movement, hide cursor, consume held edges, and skip camera, jump, autorun, and actions.
- **Tests:** every controller path is neutral while blocked, held buttons do not fire on unblock, and ordinary window cursor mode remains unchanged.
- **Interfaces - Consumes / Produces:** existing GamepadManager / isInputBlocked callback wired by T48.
- **Depends on:** none.
- **Estimated time:** 5 minutes.

### T34: Add localized editor vocabulary
- **Files:** modify src/ui/i18n.catalog/hud_chrome.ts and tests/hud_chrome_i18n.test.ts.
- **Changes:** add Interface entry, scenes, surfaces, lock, manipulation, reset, Save/Cancel, failures, fallback, discard, and storage error strings.
- **Tests:** representative typed interpolation and accessible-label keys resolve in English.
- **Interfaces - Consumes / Produces:** T3 IDs and T15 reasons / t() keys for T36-T49.
- **Depends on:** T3, T15.
- **Estimated time:** 5 minutes.

### T35: Expose the current Vale Cup shoot-charge state
- **Files:** modify src/ui/hud.ts and tests/vale_cup_ui_guard.test.ts.
- **Changes:** add a read-only isValeCupShootCharging method backed only by private shootChargeSlot; do not expose timing or mutation.
- **Tests:** source/behavior guard pins false when idle, true while held, and false after release/cancel.
- **Interfaces - Consumes / Produces:** existing charge owner / getter consumed by T46.
- **Depends on:** none.
- **Estimated time:** 4 minutes.

### T36: Build the editor dialog shell and lifecycle
- **Files:** create src/ui/mobile_hud_editor.ts and tests/mobile_hud_editor.test.ts.
- **Changes:** use the repository's focused hand-rolled fake DOM to create dependency-injected
  open/close, dialog/proxy/dock/inspector/status roots, Locked startup, entry snapshot, body
  classes, and focus restoration. Leave real DOM/event/CSS behavior to T59 Browser Mode.
- **Tests:** one instance, translated dialog semantics, active-profile-only draft, eligibility guard, and lifecycle cleanup.
- **Interfaces - Consumes / Produces:** T17-T19, T30, T34 / MobileHudEditor lifecycle and onOpenChange.
- **Depends on:** T17, T18, T19, T30, T34.
- **Estimated time:** 5 minutes.

### T37: Render scenes and capability-aware controls
- **Files:** modify src/ui/mobile_hud_editor.ts and tests/mobile_hud_editor.test.ts.
- **Changes:** render shared editable proxies plus one selected context; fixed protected surfaces remain
  registry-owned runtime metadata but stay hidden in the editor; build only descriptor-supported
  controls; Lock preserves current preview and enabled state.
- **Tests:** every context selectable, mutually exclusive variants separated, View always shown in editor, and excluded/unsupported controls absent.
- **Interfaces - Consumes / Produces:** T4, T9-T10, T36 shell / proxy and inspector DOM.
- **Depends on:** T4, T9, T10, T36.
- **Estimated time:** 5 minutes.

### T38: Add selection, drag, and ephemeral live preview
- **Files:** modify src/ui/mobile_hud_editor.ts and tests/mobile_hud_editor.test.ts.
- **Changes:** Unlock selection, accessible gold state, pointer capture, scaled/mirrored drag, and on every draft edit call T26 preview update without storage writes; proxy owns interaction while live HUD mirrors position visually.
- **Tests:** drag outside origin, capture cancel, left-handed inverse mapping, live HUD callback per edit, zero storage writes, and Locked byte-identical behavior.
- **Interfaces - Consumes / Produces:** T12, T16-T17, T26, T37 / live preview manipulation path.
- **Depends on:** T12, T16, T17, T26, T37.
- **Estimated time:** 5 minutes.

### T39: Add nudge, resize, orientation, and reset actions
- **Files:** modify src/ui/mobile_hud_editor.ts and tests/mobile_hud_editor.test.ts.
- **Changes:** connect nudge, plus/minus, flow/reverse/opening, Reset Selected, and Reset All to the
  reducer and the same ephemeral live-preview callback. T65 keeps Arrow-key nudge and plus/minus
  plus resets visible while leaving flow/reverse/opening as registry-owned document actions.
- **Tests:** keyboard/pointer alternatives match reducer, limits hold, active profile only resets, and every edit previews without saving.
- **Interfaces - Consumes / Produces:** T18-T19 and T38 / complete non-drag edit path.
- **Depends on:** T18, T19, T38.
- **Estimated time:** 5 minutes.

### T40: Show validation failures and block Save
- **Files:** modify src/ui/mobile_hud_editor.ts and tests/mobile_hud_editor.test.ts.
- **Changes:** continuously validate current plus matrix geometry, mark every involved proxy with outline/icon/text, and disable Save for collision, bounds, View, scale, or capability failures.
- **Tests:** each reason, multiple involved IDs, non-color signal, and Save enable/disable transitions.
- **Interfaces - Consumes / Produces:** T14-T15 and T39 / live validation state.
- **Depends on:** T14, T15, T39.
- **Estimated time:** 5 minutes.

### T41: Preserve exact failure metadata for automatic diagnostics
- **Files:** modify src/ui/mobile_hud_editor.ts and tests/mobile_hud_editor.test.ts.
- **Changes:** retain exact failure geometry, inset, context, and variant metadata for automatic red
  diagnostics. T65 supersedes the visible cycling control with the canonical-context dropdown.
- **Tests:** cycle all failures, UI scale/visual offset mapping, resolution removes failures, and scene membership remains exact.
- **Interfaces - Consumes / Produces:** T16, T19, T38-T40 / automatic failure diagnostic contract.
- **Depends on:** T16, T19, T38, T39, T40.
- **Estimated time:** 5 minutes.

### T42: Save the already-previewed draft transactionally
- **Files:** modify src/ui/mobile_hud_editor.ts and tests/mobile_hud_editor.test.ts.
- **Changes:** Save awaits T23, promotes the previewed canonical draft to validated runtime state, activates enabled true, clears ephemeral preview, and exits only after confirmed write.
- **Tests:** success writes/applies once; invalid Save never calls storage; write failure keeps exact draft/preview open and announces no success.
- **Interfaces - Consumes / Produces:** T23, T26, T40 / successful editor Save transaction.
- **Depends on:** T23, T26, T40.
- **Estimated time:** 5 minutes.

### T43: Implement Cancel, dirty back, and exact restoration
- **Files:** modify src/ui/mobile_hud_editor.ts and tests/mobile_hud_editor.test.ts.
- **Changes:** Cancel clears ephemeral preview and restores exact entry document without write; Escape/platform back confirms only dirty drafts, then follows Cancel.
- **Tests:** pristine/dirty close, confirmation accept/reject, entry enabled false/true, exact placement restoration, and zero writes.
- **Interfaces - Consumes / Produces:** T19, T26, T36 / complete close contract.
- **Depends on:** T19, T26, T36, T42.
- **Estimated time:** 4 minutes.

### T44: Expose the touch-landscape Interface entry
- **Files:** modify src/ui/hud.ts, src/ui/options_ia.ts, src/ui/options_window.ts,
  tests/options_ia.test.ts, tests/options_window.test.ts, and tests/options_mobile_shell.test.ts.
- **Changes:** add canCustomizeMobileHud/openMobileHudEditor hooks; model the editor launcher as a
  keyless Interface action in the release's central options IA; paint it through the shared
  category-detail renderer so the desktop rail, wide mobile rail, and narrow mobile back-stack do
  not diverge; show it only when the hook reports eligible touch landscape; close Options before
  opening the editor. Keep it out of settings-key ownership, changed counts, scoped reset, and
  global search until action rows have an explicit search contract.
- **Tests:** IA action has one Interface home and no settings-key/reset ownership; touch landscape
  is visible and callable; desktop and portrait are absent; Options closes before editor open; the
  narrow mobile shell reaches the same shared renderer; existing settings remain unchanged.
- **Interfaces - Consumes / Produces:** T34 and T36 / Options entry seam for T45.
- **Depends on:** T34, T36.
- **Estimated time:** 5 minutes.

### T45: Wire startup load, editor, applier, Options, and debug ownership
- **Files:** modify src/main.ts and tests/client_shell.test.ts.
- **Changes:** load storage once, construct editor, apply validated state, connect T44, and expose read-only window.__game.mobileHudEditor plus layout diagnostics for offline Puppeteer tests.
- **Tests:** source contract pins one load, no frame-loop storage/measurement, callback order, and named debug owner.
- **Interfaces - Consumes / Produces:** T22, T26, T42-T44 / end-to-end editor owner and Puppeteer seam.
- **Depends on:** T22, T26, T42, T43, T44.
- **Estimated time:** 5 minutes.

### T46: Normalize the live runtime context
- **Files:** modify src/main.ts, tests/client_shell.test.ts, and tests/mobile_hud_context.test.ts.
- **Changes:** build MobileHudRuntimeSnapshot only from existing Arena/Cup/Delve/indicator state plus T35 charge getter and feed it to T5 for initial/editor refresh context.
- **Tests:** every source field, charge context, priority call, no IWorld addition, and no storage mutation on context change.
- **Interfaces - Consumes / Produces:** T5 and T35 / live canonical context callback.
- **Depends on:** T5, T35, T45.
- **Estimated time:** 5 minutes.

### T47: Gate keyboard actions and movement while editing
- **Files:** modify src/main.ts, tests/input.test.ts, and tests/client_shell.test.ts.
- **Changes:** include editor open state in both canUseGameKeys closures and frame suspension; opening clears held slots, keyboard movement, jump, and autorun before any new edge can dispatch.
- **Tests:** movement, ability slots, action keys, and menu launchers are blocked while open and restored after close.
- **Interfaces - Consumes / Produces:** T36 open state and existing Input callbacks / keyboard isolation.
- **Depends on:** T36, T45.
- **Estimated time:** 5 minutes.

### T48: Wire touch and gamepad suspension to editor lifecycle
- **Files:** modify src/main.ts, tests/client_shell.test.ts, and tests/gamepad.test.ts.
- **Changes:** on open call T32 and expose T33 isInputBlocked; on close restore both. Keep gamepad cursor mode for ordinary windows only.
- **Tests:** touch and controller movement, camera, jump, autorun, buttons, and held-edge state are blocked then restored.
- **Interfaces - Consumes / Produces:** T32-T33 and T36 / complete non-keyboard input isolation.
- **Depends on:** T32, T33, T36, T45.
- **Estimated time:** 5 minutes.

### T49: Refresh geometry and warnings only on viewport events
- **Files:** modify src/main.ts, src/game/mobile_hud_layout_applier.ts, and tests/mobile_hud_layout_applier.test.ts.
- **Changes:** reuse syncAppViewport resize, `visualViewport.resize`, `visualViewport.scroll`, and
  fullscreen paths to remeasure, switch profile, refresh editor, reconsider fallback, and emit one
  localized warning per failing state.
- **Tests:** UI scale/visual offsets, profile switch, fallback recovery, no stored overwrite, no frame work, and warning deduplication.
- **Interfaces - Consumes / Produces:** T25, T27, T34, T36 / event-driven responsive runtime.
- **Depends on:** T25, T27, T34, T36, T45.
- **Estimated time:** 5 minutes.

### T50: Build the real-page geometry audit
- **Files:** create scripts/mobile_hud_editor_check.mjs and modify scripts/lib/overlap_geometry.mjs.
- **Changes:** open offline game through window.__game seam and compare DOM rectangles with pure 0.5px geometry across one selected matrix case at a time.
- **Tests:** default 740x360 World passes; deliberate mixed-host overlap reports matching
  context/reason/IDs; body-level controls remain visually fixed while `#ui` writes convert at UI
  scales 0.85/1/1.4; visual-offset mapping matches core.
- **Interfaces - Consumes / Produces:** T14-T16, T27, T45 / reusable audit case runner.
- **Depends on:** T14, T15, T16, T27, T45.
- **Estimated time:** 5 minutes.

### T51: Verify real Options entry and live preview
- **Files:** modify scripts/mobile_hud_editor_check.mjs.
- **Changes:** through the real Options entry open editor, unlock, drag/nudge, switch scenes, and prove live HUD follows the canonical draft while storage write count remains zero and Lock preserves preview.
- **Tests:** phone and tablet cases assert proxy ownership, applied placement, unchanged enabled state, and no gameplay click-through.
- **Interfaces - Consumes / Produces:** T38-T45 and T50 runner / real-app entry/live-preview evidence.
- **Depends on:** T38, T44, T45, T50.
- **Estimated time:** 5 minutes.

### T52: Verify Save activation and reload persistence
- **Files:** modify scripts/mobile_hud_editor_check.mjs.
- **Changes:** save a valid already-previewed draft, assert first Save changes enabled false to true only after write confirmation, reload, and verify the same canonical/right-handed and derived left-handed layouts.
- **Tests:** phone/tablet reload plus exact localStorage document and placement assertions.
- **Interfaces - Consumes / Produces:** T23, T42, T45, T51 / real-app Save/reload evidence.
- **Depends on:** T23, T42, T45, T51.
- **Estimated time:** 5 minutes.

### T53: Verify Cancel and storage-write failure
- **Files:** modify scripts/mobile_hud_editor_check.mjs.
- **Changes:** prove Cancel restores the exact entry runtime layout with zero writes and a rejected storage write leaves the complete draft/live preview open without success state.
- **Tests:** enabled false and true entry documents, dirty back confirmation, Cancel, and injected Storage.prototype.setItem failure.
- **Interfaces - Consumes / Produces:** T42-T43, T45, T51 / real-app rollback/failure evidence.
- **Depends on:** T42, T43, T45, T51.
- **Estimated time:** 5 minutes.

### T54: Verify keyboard, action, and menu isolation
- **Files:** modify scripts/mobile_hud_editor_check.mjs.
- **Changes:** while editor is open attempt keyboard movement, jump, ability slots, target/interact, action keys, and menu launchers, then close and repeat.
- **Tests:** world position/action/menu counters remain unchanged only while open and resume after close.
- **Interfaces - Consumes / Produces:** T47 and T50 / real-app keyboard isolation evidence.
- **Depends on:** T47, T50.
- **Estimated time:** 5 minutes.

### T55: Verify mobile touch isolation
- **Files:** modify scripts/mobile_hud_editor_check.mjs.
- **Changes:** attempt Movement, action buttons, menu launchers, and pointer drift from editor proxies into canvas while open, then close and repeat.
- **Tests:** no movement/callback/haptic/camera delta while open; ordinary touch behavior returns after close.
- **Interfaces - Consumes / Produces:** T32, T48, T50 / real-app touch isolation evidence.
- **Depends on:** T32, T48, T50.
- **Estimated time:** 5 minutes.

### T56: Verify gamepad isolation
- **Files:** modify scripts/mobile_hud_editor_check.mjs.
- **Changes:** inject standard-pad axes/buttons and test movement, camera, jump, autorun, action, and held-edge consumption while open and after close.
- **Tests:** neutral state while blocked, no stale rising edge after unblock, and ordinary window pointer mode remains separate.
- **Interfaces - Consumes / Produces:** T33, T48, T50 / real-app controller isolation evidence.
- **Depends on:** T33, T48, T50.
- **Estimated time:** 5 minutes.

### T57: Verify camera and reserved View semantics
- **Files:** modify scripts/mobile_hud_editor_check.mjs.
- **Changes:** test camera joystick, swipe, and pinch blocking while open. With joystick disabled after close, prove View is invisible, collision-reserved only in the model, creates no interactive deadzone, and swipe-look starts on sampled unobstructed canvas pixels inside and outside its footprint.
- **Tests:** 740x360 and 844x390 inset cases with camera deltas blocked only during editor and restored afterward.
- **Interfaces - Consumes / Produces:** T29, T47-T50 / real-app camera/View evidence.
- **Depends on:** T29, T47, T48, T49, T50.
- **Estimated time:** 5 minutes.

### T58: Extend the existing overlap audit
- **Files:** modify scripts/mobile_hud_overlap_audit.mjs and scripts/lib/overlap_geometry.mjs.
- **Changes:** add custom profile/context/document inputs while preserving fixed-layout behavior and exact epsilon; enumerate dynamic/protected roots from registry metadata.
- **Tests:** default fixed and valid custom matrices pass; invalid custom first failure matches T15.
- **Interfaces - Consumes / Produces:** T15 and T50 helpers / final custom overlap audit.
- **Depends on:** T15, T50.
- **Estimated time:** 4 minutes.

### T59: Add Vitest Browser component and CSS coverage
- **Files:** create tests/browser/mobile_hud_editor.browser.test.ts.
- **Changes:** in the runner page instantiate local editor fixture roots and test real CSS, pointer
  capture, scene visibility, live-preview callbacks, one failing preview, mixed coordinate hosts,
  and phone/tablet layout. Do not claim main.ts, Options, reload, or offline-world coverage and do
  not export this test file as a fixture.
- **Tests:** run only this file at 740x360 and 1024x768.
- **Interfaces - Consumes / Produces:** T30 and T36-T43 / browser DOM/CSS fixture and evidence.
- **Depends on:** T30, T36, T37, T38, T39, T40, T41, T42, T43.
- **Estimated time:** 5 minutes.

### T60: Extend the browser accessibility gate
- **Files:** modify tests/browser/a11y.browser.test.ts.
- **Changes:** extend this file's existing independent harness with dialog, focus, keyboard
  alternatives, live error, and non-color feedback axe coverage. Do not import T59's test module.
- **Tests:** focused axe file with no serious/critical findings and keyboard-only completion.
- **Interfaces - Consumes / Produces:** T30, T39-T43, T59 / accessibility evidence.
- **Depends on:** T30, T39, T40, T41, T42, T43, T59.
- **Estimated time:** 5 minutes.

### T61: Extend the browser target-size gate
- **Files:** modify tests/browser/target_size.browser.test.ts.
- **Changes:** extend this file's existing independent harness to verify gameplay/editor floors at
  740x360, 844x390 with approved inset, 932x430, left-handed phone, and 1024x768 tablet. Do not
  import T59's test module.
- **Tests:** focused target-size file with populated Party, pet, Consumables, and aura proxies.
- **Interfaces - Consumes / Produces:** T29-T30 and T59 / target-size evidence.
- **Depends on:** T29, T30, T59.
- **Estimated time:** 5 minutes.

### T62: Capture and inspect after screenshots
- **Files:** modify scripts/mobile_hud_editor_shots.mjs and create the five after PNG files.
- **Changes:** create `after-740x360-world.png`, `after-844x390-arena-fiesta.png` with the approved
  50px safe-area inset, `after-932x430-failing-layout.png`,
  `after-740x360-left-handed.png`, and `after-1024x768-tablet.png` with relevant ghosts populated.
- **Tests:** inspect every pair for clipping, dock obstruction, View clearance, readable errors, and no mutually exclusive/excluded surfaces.
- **Interfaces - Consumes / Produces:** T2, T45, T49, T51-T57 / final visual evidence.
- **Depends on:** T2, T45, T49, T51, T52, T53, T54, T55, T56, T57.
- **Estimated time:** 5 minutes.

### T63: Regenerate localization artifacts
- **Files:** modify src/ui/i18n.resolved.generated/*.ts deterministically.
- **Changes:** run npm run i18n:gen and accept only generated UI fallback changes from T34.
- **Tests:** focused hud chrome, completeness, localization coverage, and git diff --check.
- **Interfaces - Consumes / Produces:** T34 English catalog / current generated TranslationKey artifacts.
- **Depends on:** T34.
- **Estimated time:** 4 minutes.

### T64: Verify all acceptance criteria and contribution gates
- **Files:** modify this plan only with exact evidence; repair a task-owned defect only after a RED regression.
- **Changes:** map every spec checkbox to fresh unit, architecture, DOM, Puppeteer, browser, screenshot, type, build, i18n, and security evidence.
- **Tests:** run all changed/new unit tests, npm run check:types, both mobile scripts, three browser files, then npm run gate and rerun editor scripts if the gate omits them.
- **Interfaces - Consumes / Produces:** T1-T63 / verification-before-completion record suitable for draft PR review.
- **Depends on:** T20, T51, T52, T53, T54, T55, T56, T57, T58, T59, T60, T61, T62, T63.
- **Estimated time:** 5 minutes excluding command runtime.

### T65: Consolidate the editor into one movable center palette
- **Files:** modify src/ui/mobile_hud_editor.ts, src/styles/hud.mobile.css, focused unit/browser
  tests, real-page scripts, screenshots, and this spec/plan.
- **Changes:** replace separate scene/context rails and bottom inspector with one near-center
  draggable palette; use one canonical-context dropdown; expose only symbol scale controls and the
  two resets; retain Arrow-key nudging without visible direction buttons; paint failures red
  automatically; remove the landscape map's obsolete fixed bottom reservation.
- **Tests:** RED on old rails/nudge/failure button/map gap, then 576 focused unit tests, 47 browser
  tests, typecheck, formatting/diff checks, real offline audit, and five regenerated screenshots.
- **Interfaces - Consumes / Produces:** T36-T43, T51-T62 / simplified approved player-facing editor
  chrome without changing the storage schema or runtime layout document.
- **Depends on:** T36, T38, T39, T40, T45, T51, T59, T60, T61, T62, T64.
- **Estimated time:** completed 2026-07-12.

### T81: Correct UI-author conversion and handedness validation

- **Files:** modify `src/game/mobile_hud_layout_applier.ts`, pure geometry tests, and runtime
  applier tests.
- **Changes:** keep persisted and registry geometry in canonical visual CSS pixels. Write
  `ui-author` X/Y as `visualOffset / uiScale`, apply `placementScale / uiScale` at the root, and
  keep descriptor-local width/height in canonical author space. Apply the same rule to dependent
  cast and swing offsets. Run runtime fallback and canonical profile validation for both right- and
  left-handed presentation with no waiver path.
- **Tests:** visual rectangles remain stable at UI scale 0.85, 1, and 1.4; both handedness variants
  pass every profile, viewport, safe-area, and context fixture.
- **Interfaces - Consumes / Produces:** T11-T16, T27, T79-T80 / one host-aware visual-space
  conversion contract.
- **Depends on:** T15, T27, T79, T80.
- **Estimated time:** completed 2026-07-13.

### T82: Bound interactive dynamic surfaces

- **Files:** modify the registry, runtime applier, mobile HUD CSS, editor proxy rendering, and
  focused unit/browser tests.
- **Changes:** treat every interactive state expansion as blocking. Use complete maximum envelopes
  or bounded scroll viewports: Player Buffs/Debuffs expose three phone or six tablet 40 by 40 icon
  targets before scrolling, Target grows from 236 by 68 to a 236 by 121 aura maximum with five
  visible aura targets, Pet commands retain every
  command and stance inside a scroll viewport, and Party / Raid shrinks for sparse groups while
  retaining the 372 by 40 horizontal or 68 by 260 vertical raid-capacity envelope.
- **Tests:** pointer hits reach aura icons, tooltip/cancel behavior is not covered by another HUD
  surface, all scroll content is reachable, sparse Party has no empty deadzone, and the full raid
  envelope remains visible and blocking in Edit Mode.
- **Interfaces - Consumes / Produces:** T8, T13-T15, T29, T74, T78-T80 / conservative interactive
  geometry without unbounded runtime expansion.
- **Depends on:** T15, T29, T74, T78, T79, T80, T81.
- **Estimated time:** completed 2026-07-13.

### T83: Register missed persistent interceptors

- **Files:** modify registry/default data, context CSS, English HUD catalog, and focused
  registry/browser tests.
- **Changes:** add the blocking `tracker.deeds` header; reclassify `tracker.delve` as mixed with
  click-through status text and one fixed 40 by 40 interactive affix pocket; retain Delve in the
  dropdown because that mixed surface creates a distinct editable signature. Hide the standalone
  Discord call-to-action during mobile `game-active`, since More already exposes Discord and the
  duplicate banner would otherwise be an unregistered pointer interceptor.
- **Tests:** Deeds header and Delve affix receive pointer hits, Delve text passes through, the
  Delve dropdown signature remains unique, current Delve content never exceeds one affix icon, and
  the Discord banner is absent only in active mobile gameplay.
- **Interfaces - Consumes / Produces:** T9-T10, T73, T75, T79-T82 / complete persistent gameplay
  surface inventory.
- **Depends on:** T73, T75, T79, T80, T81, T82.
- **Estimated time:** completed 2026-07-13.

### T84: Reconcile the contract and run the missing-surface audit

- **Files:** modify the mobile HUD architecture classification, product spec, and this plan only.
- **Changes:** remove superseded compatibility-debt, non-blocking interactive expansion, aura
  pointer-ownership, and Delve interaction language. Record T81-T83 as the current normative
  contract.
  Audit persistent mobile gameplay roots, optional class controls, context surfaces, and top-level
  interceptors. The resulting inventory adds no surface beyond Deeds and the mixed Delve affix
  pocket; temporary windows, prompts, tutorials, and foreground overlays remain intentionally
  outside player placement.
- **Tests:** search all three documents for stale interaction classifications, inspect their diff,
  and leave final deterministic and browser verification to the shared Done definition.
- **Interfaces - Consumes / Produces:** T75, T79-T83 / one non-contradictory contributor contract.
- **Depends on:** T75, T79, T80, T81, T82, T83.
- **Estimated time:** completed 2026-07-13.

### T85: Add touch aura inspection and deliberate cancellation

- **Files:** modify the aura painter, HUD gesture wiring, HUD CSS, architecture/spec documentation,
  and focused aura/gesture/context-menu tests.
- **Changes:** expose Player and Target auras as named native buttons with 40 by 40 touch boxes. A
  short tap shows, swaps, or closes the shared tooltip; an outside tap dismisses it. A 650ms hold
  captures the exact helpful player aura under the finger, aborts on scroll slop, and never cancels
  a replacement that recycles the same pooled DOM node. Retain Party mini auras as status-only
  glyphs inside the member target row. Prevent a desktop buff context menu reparented under the
  Player frame from also opening the self menu.
- **Tests:** pooled live tooltip/cancel identity, first/second/outside tap, non-primary touch,
  long-hold consumption, scroll slop, status-only Party semantics, 40px CSS targets, and
  player-frame context-menu ownership.
- **Interfaces - Consumes / Produces:** T74, T78, T82 / one input-modality-complete aura contract.
- **Depends on:** T74, T78, T82.
- **Estimated time:** completed 2026-07-13.

### T86: Preview validation failures in their handedness

- **Files:** modify the editor presentation coordinator, mobile editor CSS, and focused editor/CSS
  tests; reconcile architecture/spec wording.
- **Changes:** derive preview handedness from the active drag or focused failure before the runtime
  preference. Opposite-hand failures use canonical ghost geometry and hide every surface-owned
  runtime fragment without hiding shared roots such as `#mobile-controls`. Snapshot handedness at
  pointerdown and defer any proxy rebuild until pointerup so pointer capture remains intact. Name
  the localized left-handed On/Off state alongside viewport and safe-area diagnostics.
- **Tests:** opposite-hand Yumi collision, inverse drag/nudge/scale, pointer capture through failure
  resolution, Minimap satellite hiding, standalone hidden selector, localized diagnostics, and
  teardown back to the runtime hand.
- **Interfaces - Consumes / Produces:** T12, T15, T40-T41, T72, T80-T81 / truthful automatic
  failure presentation without mutating player settings.
- **Depends on:** T12, T15, T40, T41, T72, T80, T81.
- **Estimated time:** completed 2026-07-13.

## Done definition
- Every task is complete in dependency order using RED, GREEN, REFACTOR.
- Every file in File structure is either created/modified as listed or explicitly removed from the
  plan with a recorded reason before execution reaches its dependent task.
- Both device profiles pass structural, capability, scale, and target-size validation in every
  canonical context. Overlap and bounds never block a player-authored layout.
- Input suspension, persistence failure, unusual viewport fallback, and left-handed inverse editing
  have direct behavioral tests.
- The five before/after screenshot pairs are inspected, not merely generated.
- Focused checks and `npm run gate` pass from the final working tree.
- No stage, commit, push, branch mutation, or remote PR mutation occurs without separate user
  authorization.
