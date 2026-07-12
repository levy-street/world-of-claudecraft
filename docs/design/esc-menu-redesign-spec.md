# Esc menu redesign: The Warden's Codex

Design specification for the full revamp of the Esc settings menu, replacing the
hub-and-spoke options window with a modern, persistent-category settings surface.
Produced by a three-proposal design panel judged on hierarchy, navigation, mobile,
accessibility and fairness, feasibility, and dark-fantasy fit; this document is the
unanimous winner ("The Warden's Codex", visual-craft-first) with the judges' grafts
applied. Companion documents: `ui-ux-redesign-spec.md` (the AAA grammar and tokens
this builds on) and `ui-ux-current-state.md`.

Design direction inputs: modern game settings surfaces were studied for structure
lessons only (persistent category navigation, preset-then-detail, uniform row
grammar, conflict surfacing, scoped resets, controller-first operation); nothing is
copied. The expression is native to this game's token system.

Revision v1.1 (approved-direction iteration): the layout, dark-fantasy styling,
left rail, gold treatment, footer actions, and gamepad legend are APPROVED and
unchanged. This revision adds, per user direction: (a) a true GLOBAL search field
in the menu shell as the primary search; (b) an Overview landing category as the
default entry (never open straight into Graphics); (c) a DEDICATED mobile
experience (back-stack model, not a shrunk desktop layout); (d) full HUD-variant
coverage plus per-setting required / not-required implementation tiers for this
sprint (section 13).

## 1. Vision

The window reads as a forged codex bound in dark iron with a gilded spine: a
recessed category rail carved one panel-depth deeper than the bright detail face
where the work happens. Gold is earned (active category, focused control, an
enabled switch, the one primary action); all passive framing is border-brown.
Cinzel appears exactly three times (window title, active category header, section
heads); everything else is the UI face. The hub-and-spoke round-trip disappears:
categories live permanently on the left, content is always in view.

## 2. Layout model

- Root `#options-menu` adopts the landed `.window-frame` grammar, size class XL:
  `width: min(1200px, 92% of #ui)`, `height: min(800px, 88% of #ui)`, centered.
  It **drags by its titlebar and resizes by the corner band** like every other
  grammar window (maintainer direction: this supersedes the earlier fixed-window
  ruling that added `options-menu` to `NON_RESIZABLE_WINDOW_IDS` and excluded its
  titlebar from the drag predicate; those exclusions are removed). The XL width and
  height are the DEFAULT sizing, overridden by an inline size once the player
  resizes; the viewport clamp keeps a moved/resized window on-screen. Because the
  window width is now dynamic, the rail's icon-collapse (below) reacts to the
  WINDOW width via a container query, not just the viewport.
- Zones top to bottom: `.window-titlebar` (40px desktop / 48px touch; title
  "Settings" in `--font-display` `--text-lg` gold; `.window-close` with 40px hit
  area) / **the SHELL SEARCH strip** (40px; a full-width `.search-field` that is
  the PRIMARY, GLOBAL search over every category; see section 7) / body grid /
  `.window-footer` (48px sticky). The former per-pane search field is removed;
  its "This section" behavior survives as a scope chip on the shell field.
- Body: `display: grid; grid-template-columns: var(--opt-rail-w) 1fr;
  min-height: 0`. New structural token `--opt-rail-w: 208px` (`:root` only).
  Two INDEPENDENT scrollers: the rail and the detail pane each own
  `overflow-y: auto`.
- Rail (left): recessed spine. `background-color: var(--color-panel-l2-base)`
  under `background-image: var(--panel-l1-bg)`; 1px `--panel-edge` divider on the
  inline-end edge; `padding: var(--spacing-sm) 0`. A vertical `role=tablist`
  (`aria-orientation=vertical`) of category tabs under three rail-group headers.
- Detail (right): L1 surface, `padding: var(--spacing-lg)`, `role=tabpanel`
  labelled by the active tab. Inner column measure-capped:
  `.opt-detail-inner { max-width: 40rem }` so rows never sprawl at XL width and
  +35 percent localized labels stay adjacent to their controls; leftover width is
  gutter. Category header in `--font-display` `--text-title` gold + a one-line
  muted subhead, then the search field, then sections.
- Width degrade ladder (viewport-driven, no information loss): full rail (208px)
  -> under 900px effective width, icon-only 56px strip (labels become tooltips)
  -> if still too tight (cramped landscape phones), the rail renders as a top
  `.tab-rail` instead; the rail component is presentation-agnostic (one model,
  three renderings).

## 3. Category tree (the IA of record)

Ten categories: a standalone Overview landing plus nine under three rail groups. **Every `SETTING_RANGES` and
`BOOL_SETTINGS` key is assigned exactly once**; a new pure module
`options_ia.ts` owns this tree plus a category-to-keys map (drives rendering AND
scoped reset), and an exhaustiveness test fails on any unassigned or
double-assigned key. Explicit exclusion allowlist (never rendered):
`graphicsDefaultApplied` (internal first-run flag), `questTrackerCollapsed`
(toggled from the tracker header). (T) = touch environment only; (online) =
online mode only.

LANDING (above the groups, first rail item, DEFAULT on open)
0. **Overview**: the menu always opens here; it is the main entry point.
   - Quick actions: Resume (close), Report a Bug (online), Log out (online),
     Reset all settings, mirroring the footer for discoverability.
   - Alerts: if any keybind conflict or fully-unbound action exists, an
     `.error-banner` row linking to Keybinds; if a reload-required change is
     pending, its "Restart" row.
   - Pinned essentials (MIRROR rows, not second homes: each writes the SAME
     settings key and jumps nowhere; the exhaustiveness test counts only the
     HOME assignment, and mirrors are marked as pins in options_ia):
     graphicsPreset, uiScale, theme preset, language, musicVolume, sfxVolume,
     reduceMotion, interfaceMode.
   - Status: version readout, online/offline mode, total "N settings changed
     from defaults" summary.

RAIL GROUP "Display"
1. **Graphics**: Quality: `graphicsPreset` (segmented Low/Medium/High/Ultra/
   Advanced, preset-then-detail: detail rows `terrainDetail`, `foliageDensity`,
   `effectsQuality`, `shadowQuality` appear at Advanced; editing a detail row on
   a non-Advanced preset flips the preset to Advanced), `renderScale` (slider),
   `weather` (switch), `browserEffects` (segmented Auto/Full/Reduced/Minimal +
   note). View: `brightness`, `cameraFov` (degrees), `fullscreen`.
2. **Interface**: General: language (dropdown, locale-native labels), theme
   preset (segmented) + custom-color grid + "Reset colors" section action.
   Scale and Text: `uiScale` (commitOnChange), `tooltipScale`. Panels:
   `hudOpacity`, `frostedPanels`. Unit Frames: `playerFrameScale`,
   `targetFrameScale`, `aurasOnPlayerFrame`, `showOwnNameplate`, "Reset frame
   positions" action. Action Bars: `showSecondaryActionBar`. Chat:
   `chatFontScale`, `chatOpacity`, `compactChat`, chat timestamps on/off +
   12h/24h segmented (dimmed when off), "Reset chat window" action. Combat and
   Tooltips: `fctScale`, `showItemLevel`. HUD Extras: `showOverflowXp`,
   `showWalletOnCharacterScreen`, `showWalletOnPlayerCard`, `showDevBadges`,
   `showDailyRewardsChest`.
3. **Accessibility**: Motion and Contrast: `reduceMotion`, `highContrastText`,
   `landingHighContrast`. Content: `filterProfanity`.

RAIL GROUP "Input"
4. **Controls**: Camera: `mouseCamera`, `cameraSpeed`, `invertLookY`,
   `lockCursorOnRotate`. Movement: `clickToMove`, `clickToMoveButton`
   (segmented Left/Right, dimmed while click-to-move is off). Combat:
   `attackMove`, `startAttackOnAbilityUse`, `groundReticle`, `walkByAutoloot`.
   Feedback: `clickFeedback`. Input Mode: `interfaceMode` (segmented
   Auto/Desktop/Touch + note; hidden under the native app shell).
5. **Keybinds** (wide layout): the bind table by `BIND_CATEGORIES` (Movement /
   Targeting / Interface / Action Bar) as flowing columns; each row = action
   label + primary cap + alternate cap; the Attack Move key row shows only while
   `attackMove` is on. "Reset key bindings" section action.
6. **Controller**: Feel: `gamepadEnabled`, `gamepadInvertY`,
   `gamepadStickDeadzone`, `gamepadCameraSpeed` (oneDecimal),
   `gamepadVibration`. Buttons: per-button remap dropdowns + "Reset buttons"
   action. Shows `.empty-state` ("No controller detected") when no pad is
   present but stays reachable.
7. **Touch** (T): Sticks: `joystickScale`, `joystickDeadzone`,
   `leftHandedTouch`, `mobileCameraJoystick`. Look: `touchLookSpeed`,
   `touchInvertLook`. Buttons: `actionButtonScale`, `touchOpacity`.

RAIL GROUP "System"
8. **Audio**: Volume: `sfxVolume`, `musicVolume`, `voiceVolume`. Toggles: music
   on/off (musicToggle, reads MusicDirector), `voiceEnabled` ("NPC Voices"),
   `footstepSfx`.
9. **System**: Performance: `showFps`, the performance-overlay panel (delegated
   to the existing PerfOverlaySettingsPanel; drag-placement stays gated to this
   category being open). Support: Report a Bug (online; pushes the bug-report
   form as a detail sub-view). About: version readout.

Footer-owned global actions (not rail rows): Reset all settings, Log out
(online), Done.

## 4. Row grammar

Net-new `.opt-*` classes, scoped under `.window-frame` (the shell-layer
collision policy), landing inside the guarded AAA grammar banner section of
`components.css`. Tokens only.

- `.opt-row`: `display: grid; grid-template-columns: 1fr auto; align-items:
  center; column-gap: var(--spacing-md); min-height: 44px` (48px touch);
  `padding: var(--spacing-xs) var(--spacing-sm); border-radius:
  var(--radius-sm)`. Rows are borderless; a 1px `--panel-edge` hairline
  separates SECTIONS, not rows (scan rhythm from row height + hover tint).
- Label block: `.opt-row-label` (`--font-ui` `--text-md` `--color-text-light`),
  optional `.opt-row-desc` (`--text-xs` muted, 2px top margin). Labels truncate
  (`min-width: 0`, ellipsis) with the full localized string in `title`.
- Control block: `.opt-row-control` right-aligned flex, `gap: --spacing-sm`.
- Slider `.opt-slider`: 180px range input reusing the existing `--range-fill`
  gold-track paint; 4px track, 16px thumb (20px touch); tabular readout
  `.opt-slider-val` (48px min-width, right-aligned, `--text-sm`), formatted by
  the existing percent/degrees/oneDecimal formatters. `commitOnChange`
  semantics preserved (uiScale).
- Switch `.opt-switch`: replaces the text ON/OFF button. `role=switch`,
  `aria-checked`; 44x24 track (radius 12), 20px thumb; off = `--color-bg-input`
  track + `--color-border-default` ring; on = `--color-primary` track + dark
  thumb; thumb slides via transform over `--dur-fast`. One control drives
  Toggle (0/1), BoolToggle, and MusicToggle models.
- Segmented `.opt-seg` (choices of 4 or fewer short options): `role=radiogroup`
  of `role=radio` buttons; 28px (`--control-h-compact`) inside the 44px row;
  selected = gold fill + dark text (`.is-selected`); 1px `--panel-edge` internal
  dividers; roving tabindex with selection-follows-focus. More than 4 options
  or long labels -> the existing `.ui-dd` dropdown (listbox, max-height 320px).
- Keybind cap `.opt-key`: `min-width: 88px; height: var(--control-h)`; 1px
  `--color-border-default`; capturing state `.is-capturing` = gold border with
  an fx-medium+ breathe (steady gold border at low fx / reduced motion);
  unbound cap shows the muted "Unbound" label.
- Note `.opt-note`: full-width span, `--text-xs` muted; only for
  browserEffects / interfaceMode / graphics-reload copy.
- Section `.opt-section` + `.opt-section-head`: `--font-display` `--text-sm`
  uppercase `--gold-dim`, 0.4px tracking, 32px min-height, `--panel-edge`
  underline, optional trailing ghost "Reset [scope]" action;
  `margin-top: var(--spacing-lg)` between sections.
- Row states: hover = faint light wash (no transform); `.is-active-row` = the
  explicit focus/controller-cursor row cue: 2px `--focus-ring-color` inset on
  the inline-start edge (`box-shadow: inset 2px 0 0`, zero layout shift) plus
  the hover tint. **`.is-active-row` is authoritative and set by the focus
  model, NOT derived from `:focus-visible`** (programmatic and gamepad focus do
  not reliably light `:focus-visible` across browsers; the token ring remains
  as the additive native cue). disabled = 0.4 opacity + `aria-disabled`.
  pending (uiScale mid-drag) = readout tinted `--gold-dim` until commit.
  reload-required rows carry a `.ui-badge.badge-warning` "Restart" chip.

## 5. Navigation

One pure focus model (`options_focus_model`, part of the view-model work)
produces move/adjust/activate/switchCategory/back intents; keyboard, controller,
and pointer all converge on a single `setActiveCategory(id)` path so behavior
cannot drift. The rail is a vertical roving tablist with
**aria-selected-follows-focus** (arrowing live-swaps the pane, no Enter).

Default entry (v1.1): the menu ALWAYS opens on Overview with focus on the
Overview rail tab; it never opens straight into Graphics or any last-visited
category.

Keyboard:
- Tab order: shell search field -> active rail tab (one roving stop) -> detail
  rows top-to-bottom -> footer actions -> close. FocusManager traps Tab only
  when focus is already inside (Tab stays the game's target-nearest key
  outside) and returns focus to the opener on close. Esc stays with `closeAll`.
- Rail: Up/Down move focus AND auto-activate; Home/End jump. Requires a new
  tested `'vertical'` orientation in `roving_index.ts` that owns
  Up/Down/Home/End only, leaving Left/Right free for in-row value adjustment.
  Auto-activation re-renders the DETAIL pane without rebuilding the rail node,
  so the focused tab element survives the trap.
- Rows: slider = Left/Right step, Home/End = min/max, PageUp/Down = 10x step;
  switch = Space/Enter toggle, Left = off, Right = on; segmented = Left/Right
  roving with selection-follows-focus; keybind cap = Enter/Space begins
  capture, Delete/Backspace unbinds.
- Ctrl+Tab / Ctrl+Shift+Tab cycle categories from anywhere in the body.

Controller (new; no menu navigation exists in the game today):
- A dedicated menu-input mode in `gamepad.ts`, gated by a new explicit
  **`FocusManager.hasActiveTrap()`** predicate (not window-id prose): while a
  trap is active, the pad emits pure menu intents and CONSUMES the handled
  edges, so world input (camera, movement, the pad's Esc mapping) never
  double-fires. The (button -> intent) mapping is a pure, unit-tested module
  (`menu_gamepad_nav`), provable without a pad.
- Verbs: LB/RB = previous/next category from anywhere (the headline
  affordance); D-pad Up/Down = row focus; D-pad Left/Right or left-stick X =
  adjust focused value (mirrors keyboard); A = activate; B = back (pops a
  pushed sub-view, else closes); **Y = reset the focused row to its default;
  X = clear the focused keybind slot; RT = page down and LT = page up the long
  panes** (coordinator direction: RT scrolls the detail toward the end, LT toward
  the top, mirroring the trigger geometry).
- The controller cursor is `.is-active-row` (see section 4), always visible.
- A **persistent footer button-legend strip** renders while a gamepad is
  connected (console-settings convention): live glyphs for LB/RB, D-pad, A, B,
  Y, X, RT/LT with their menu meanings, localized via t() keys.

Pointer: click a rail tab to switch (also sets roving focus); click controls
directly; hover states are color/border only, never transform.

## 6. Rebind UX

Keybinds (keyboard):
- Capture: activating a cap enters `.is-capturing` ("Press a key...") and an
  assertive live region announces "Rebinding {action}. Press a key, or Escape
  to cancel." The next keydown binds via the existing
  `keybinds().bind(action, index, code)`. **Three independent exits** (the
  no-trap safety property): physical Escape, an on-screen Cancel affordance on
  the capturing row (touch has no Escape), and focus-loss/blur. Esc itself is
  reserved (`isReservedCode`) and never bindable.
- Eviction surfacing (bind() steals a code from any prior action; one code
  lives on at most one action): the steal is never invisible. Live region and
  a transient `.ui-badge.badge-warning` chip on the displaced row announce
  **"Bound {key} to {action}; removed from {evicted}"**; the displaced row
  repaints in the same render. A persistent `.error-banner` at the top of the
  pane lists any action left fully unbound ("{action} has no key").
- Unbind: Delete/Backspace on a focused cap, or the cap's clear affordance.
- "Reset key bindings" restores the classic default layout, refreshes the
  action-bar keycaps (`deps.refreshKeybindLabels`), and announces the reset.

Controller (Buttons section): per-button remap via the existing `.ui-dd`
dropdowns (options: Unbound + Game Menu + every edge action + Jump; movement
axes stay on the stick). **Structural safety property: a controller user
rebinds via dropdown selection and can never enter a trapping press-a-key
capture state.** Two buttons MAY map to one action: any button row sharing a
non-Unbound action with another gets a warning chip naming the duplicate.
Pad connect/disconnect re-renders the open pane in place so glyphs match the
detected brand (existing refreshControllerLabels path). Both flows return
focus to the originating cap/dropdown after a rebind.

## 7. Validation, conflicts, and search

- Conflict aggregation: a new pure `keybind_conflicts.ts` computes the
  conflict/unbound state; it surfaces (a) inline on the affected row, (b) as
  the top-of-pane error banner, and (c) as an **aggregate warning dot on the
  rail category item itself**, so a conflict is visible from the rail (even
  icon-collapsed) without opening the category.
- Divergence hints: a muted "N settings changed from defaults" line under each
  category header (drives the scoped-reset decision); the count also renders in
  the future portrait master list.
- Search (GLOBAL-FIRST, v1.1): ONE `.search-field` lives in the shell strip
  under the titlebar, visually part of the Settings interface as a whole, and
  is first in the body Tab order. Default scope is "All settings": typing from
  ANY category switches the detail pane to the synthetic results view (matching
  rows grouped by home category, each row fully interactive with a muted
  category breadcrumb and a "Go to section" affordance that jumps to the home
  category with the row given a steady `.is-active-row` highlight). A "This
  section" scope chip narrows to the active category (live row filtering,
  empty sections hidden) for players who want the old behavior.
  **The search index is STRUCTURAL**: built from the same descriptor list the
  panes render (localized label + category + section), with a tiny explicit
  synonym overlay only where genuinely needed ("fps" -> showFps); a test
  asserts every rendered row appears in the index, so the index cannot drift.
  Clearing (clear button or Escape while focused) restores the category view.
  No global search keybind (avoids chat "/").
- Transient states: language dropdown busy/failed states with aria-live status
  (existing flow preserved); reload-required rows badge "Restart" and the
  Graphics pane keeps its persistent reload note + "Reload now" button; no
  setting change is silently deferred without a visible marker.

## 8. Visual treatment

- Depth: window = L1 forged panel with the landed frame chrome (ornaments at fx
  medium+); rail = recessed spine (L2 base under the L1 gradient) behind a
  single `--panel-edge` rule; detail = the bright L1 face.
- Type: `--font-display` gold exactly three places (title `--text-lg`, category
  header `--text-title`, section heads `--text-sm` uppercase `--gold-dim`).
  Everything else `--font-ui`.
- Gold budget (enumerated): active rail tab (3px gold inline-start border +
  gold label), `.is-active-row` inset, focused-control token ring, switch-on
  track, selected segment, slider fill, the one `.btn.is-primary` Done. Nothing
  large is gold. At fx high+, the active tab gains a faint additive gold edge
  glow (color-mix over the always-present border; sheds cleanly).
- Motion (reduced-motion and fairness safe): category switch = detail-pane
  opacity cross-fade over `calc(var(--dur-fast) * var(--motion-scale))`; switch
  thumb and segment selection slide via transform `--dur-fast`; slider fills
  and readouts are INSTANT (the value is information, never eased); capture
  breathe fx medium+ only with steady-border fallback; no transform scale on
  any hover/focus; under reduced motion every fade collapses near-instant and
  no information is motion-only.
- Forced-colors checklist (non-color state cues that must survive): rail
  active = `aria-selected` + the 3px border (border survives); segment selected
  = `aria-checked` + border; switch = `aria-checked` (the control keeps its
  border geometry); focus = system Highlight ring; conflict dot pairs with the
  banner text.

## 9. Mobile behavior (v1.1: a dedicated experience, not a shrunk desktop)

Under `body.mobile-touch` (BOTH orientations) the menu abandons the two-pane
grid entirely and presents as a full-screen BACK-STACK shell, fed by the same
view-model (`renderRailModel()` / `renderCategory(id)`); the desktop rail and
its degrade ladder never render on touch.

- Level 0, the mobile landing: sticky header (48px, "Settings" + close) with
  the GLOBAL search field directly beneath it; then the Overview quick actions
  and alert rows; then the STACKED CATEGORY LIST (the rail model as full-width
  56px rows: icon + label + "N changed" count + conflict dot + chevron); the
  pinned-essentials mirrors render between quick actions and the list.
- Level 1, a category page: pushed full-screen; sticky header with back
  chevron + category title + scoped "Reset" action; stacked sections and rows
  at touch sizing (44px controls, 48px rows, 20px slider thumbs, 16px input
  floor). Search results also push as a level-1 page.
- Level 2, sub-views: bug report and keybind capture push one deeper with the
  same back semantics. Android/system back and controller B pop one level;
  popping at level 0 closes the menu. Swipe-back is NOT claimed (it collides
  with camera-drag gestures); the back chevron is the affordance.
- Desktop-only features are HIDDEN on touch rather than shrunk (env-gated in
  options_ia, mirroring how the Touch category gates on touch): the Keybinds
  category (keyboard bindings), and the mouse-specific Controls rows
  (mouseCamera, cameraSpeed, invertLookY, lockCursorOnRotate, clickToMove,
  clickToMoveButton). The Controller category STAYS on mobile (Bluetooth
  pads are real). Every remaining player-required setting is reachable.
- Footer: replaced by the level-0 quick actions plus a sticky bottom "Done"
  bar on every level; the gamepad legend renders only while a pad is
  connected, above the Done bar.
- The future bottom-sheet host remains the upgrade path: the back-stack levels
  map 1:1 onto sheet pushes when it lands (chrome swap, zero IA change).

## 10. Footer actions and close semantics

- Footer left: "Reset all settings" (`.btn.is-danger`, confirm-gated via the
  shared confirm dialog; `Settings.reset()` then re-apply every key through
  `onSettingChange`, then re-render). Scoped "Reset [category]" lives in each
  category header (iterates that category's key set from the options_ia map
  back to defaults); finer section resets (key bindings, controller buttons,
  colors, chat window, frame positions) are kept.
- Footer right: "Report a Bug" (`.btn-ghost`, online) pushes the bug-report
  sub-view; "Log out" (`.btn.is-danger`, online); "Done" (`.btn.is-primary`)
  closes. The controller legend strip renders above/beside these while a pad
  is connected.
- Close/back: Esc keeps the single `closeAll` contract; with a sub-view pushed
  (bug report, capture in flight) Back / controller B pops to the category;
  only at category level does Esc/B/Done close. On close: music resumes,
  perf-overlay placement drops, tooltip hides, FocusManager returns focus to
  the opener. When nothing is open, Esc opens this menu (unchanged).

## 11. Implementation map

New pure modules (lean-module discipline: exactly these four, all in
UI_PURE_CORES with tests):
1. `src/ui/options_ia.ts`: the category tree, per-category control lists
   (replacing the per-panel builders), category-to-keys map, exclusion
   allowlist, structural search index + synonym overlay. The pinned dispatch
   coercions (`sliderDispatchValue`, `toggleNextValue`, `boolToggleNextValue`)
   stay byte-identical.
2. `src/ui/keybind_conflicts.ts`: conflict/unbound/duplicate computation for
   both keyboard and controller tables + the rail aggregate state.
3. `roving_index.ts` extension: the `'vertical'` orientation (Up/Down/Home/End
   only), tested.
4. `src/game/menu_gamepad_nav.ts`: the pure (pad button -> menu intent)
   mapping; `gamepad.ts` wires it behind `FocusManager.hasActiveTrap()` and
   consumes handled edges.

Reworked: `src/ui/options_view.ts` (IA swap onto options_ia, focus model,
rail/category render models), `src/ui/options_window.ts` (repaint on the
window-frame builder + `.opt-*` grammar; keep every dispatch and subsystem
apply path byte-identical), `src/ui/focus_manager.ts` (add `hasActiveTrap()`).
(Superseded by the maintainer drag/resize direction: `#options-menu` is NO LONGER
in `window_resize.ts` `NON_RESIZABLE_WINDOW_IDS` nor excluded from the
`window_drag_handle.ts` predicate; it drags/resizes like every grammar window.)

CSS: `.opt-*` grammar + `--opt-rail-w` token inside the existing guarded
sections of `components.css` / `hud.mobile.css` / `tokens.css`. No new files,
no new imports, no flat colliding names.

i18n: new `hudChrome.options.*` keys (English only; M16 five-fills where
wordy): rail group labels, category names + subheads, section heads, search
placeholder + scope chips, legend labels, eviction/announce strings, reset
labels, About/version.

Tests (decisive, per behavior): options_ia exhaustiveness (every settings key
assigned once or allowlisted; RED on a new unassigned key), search-index
completeness (every rendered row indexed), keybind_conflicts (steal, unbound
banner, controller duplicates), vertical roving (owns Up/Down only),
menu_gamepad_nav mapping (every verb incl. Y/X/RT/LT; consumed edges),
focus-trap + return (existing suites extended), forced-colors non-color cues
(scan), dispatch byte-parity (existing options dispatch tests keep passing
unchanged), theme contrast across all four presets for any new structural
token, per-entry parity, css corpus/validity.

v1.1 additions to the map: options_ia also carries the Overview category, the
pin/mirror marker set (mirrors write the same key; exhaustiveness counts only
the home), the desktop-only env-gating markers (Keybinds category and the
mouse-specific Controls rows hidden on touch), and the per-setting sprint tier
flags of section 13. The shell search strip is part of the P2 chrome; the
mobile back-stack shell is its own thin painter (`options_mobile_shell`, cold
path) consuming renderRailModel/renderCategory, replacing the old P5 landscape
two-pane pass.

Phasing (after the in-flight vendor fix wave closes, since hud.ts and grammar
CSS overlap): P1 options_ia + exhaustiveness test (pure, zero visual risk);
P2 window-frame adoption + shell search strip + rail/detail chrome + row
grammar + Overview landing (desktop); P3 navigation (keyboard + focus model +
vertical roving), then controller mode; P4 rebind UX + conflicts + global
search results view; P5 the dedicated mobile back-stack shell + polish + the
full QA matrix (all four themes, fx tiers, forced-colors, reduced motion,
ui_scale extremes, long-string locale).

## 12a. HUD variant coverage and sprint implementation tiers (v1.1)

### Variant behavior (the menu accounts for every HUD type)
| Variant | Behavior |
|---|---|
| Desktop full-screen | The two-pane Codex, XL centered by default, draggable + resizable (maintainer direction) |
| Compact (ui_scale 0.8 to 1.15; narrow viewports) | Same layout; rail icon-collapses under 900px effective width; verify no clipping at both scale extremes |
| Mobile portrait AND landscape (body.mobile-touch) | The dedicated back-stack shell (section 9); never the shrunk two-pane |
| Combat | The menu opens identically; the world keeps running (MMO rule, no pause); it is a full-attention modal the player chose, same as today; zero combat-state coupling in the menu itself |
| Non-combat | Identical; no state-dependent styling |
| Specialized HUDs (yumi match, arena/fiesta, vale cup, delve, spectate, tutorial) | The menu renders above them unchanged; event HUD elements keep updating beneath; no specialized variant alters the menu |
| FX tiers / themes / forced-colors / reduced motion | Per sections 8 and 12; low tier drops ornaments and the capture breathe only |

### Sprint implementation tiers (every rendered setting flagged)
Interpretation of record: ALL settings remain reachable in the new menu (a
settings surface cannot drop audio), so NOT REQUIRED never means omitted. It
means: mechanically migrated rows whose correctness is covered by the dispatch
byte-parity tests only; no bespoke per-variant QA this sprint. REQUIRED means:
the row is relevant to the current UI/HUD work and gets full new-grammar
treatment plus per-variant verification (section 12a table). Design-proposed
rows with no existing backing store are CUT from this sprint unless a
dependency exists.

REQUIRED (UI/HUD-relevant): the entire Interface category (uiScale,
tooltipScale, hudOpacity, frostedPanels, playerFrameScale, targetFrameScale,
aurasOnPlayerFrame, showOwnNameplate, showSecondaryActionBar, chatFontScale,
chatOpacity, compactChat, fctScale, showItemLevel, showOverflowXp,
showWalletOnCharacterScreen, showWalletOnPlayerCard, showDevBadges,
showDailyRewardsChest, theme preset, language); the entire Accessibility
category (reduceMotion, highContrastText, landingHighContrast,
filterProfanity); graphicsPreset + effectsQuality + browserEffects (they gate
the fx tiers our grammar ornaments/grain key on); interfaceMode (drives the
mobile shell); showFps (perf chip surface); the Overview landing and its
mirrors; the whole Keybinds UI and the Controller Buttons remap UI (the rebind
experience is sprint work; the underlying bindings are unchanged); the global
search; scoped and global resets.

NOT REQUIRED (mechanically migrated, dispatch-parity tested only):
renderScale, shadowQuality, terrainDetail, foliageDensity, weather,
brightness, fullscreen, cameraFov; all Audio rows (sfxVolume, musicVolume,
voiceVolume, music toggle, voiceEnabled, footstepSfx); the Controls camera /
movement / combat rows (mouseCamera, cameraSpeed, invertLookY,
lockCursorOnRotate, clickToMove, clickToMoveButton, attackMove,
startAttackOnAbilityUse, groundReticle, walkByAutoloot, clickFeedback); the
Controller feel rows (gamepadEnabled, gamepadInvertY, gamepadStickDeadzone,
gamepadCameraSpeed, gamepadVibration); all Touch rows (joystickScale,
joystickDeadzone, leftHandedTouch, mobileCameraJoystick, touchLookSpeed,
touchInvertLook, actionButtonScale, touchOpacity); the performance overlay
panel delegation; the bug report form body (existing sub-view, re-chromed
only).

CONDITIONAL: chat timestamps show + 12h/24h format rows exist as a real
interface option (src/ui/chat_timestamp.ts store, not settings.ts); they are
REQUIRED only if the wiring is a plain read/write of that existing store,
otherwise deferred. Any other row the implementers find without a backing
store is cut and reported.

The options_ia module carries these flags as data (`sprintTier: 'required' |
'migrated' | 'conditional'`), and reviewers treat a NOT REQUIRED row that
received bespoke visual work, or a REQUIRED row that did not, as a scope
finding, mirroring the sprint-1 scope-matrix discipline.

## 12. Acceptance criteria

- [ ] Every settings key assigned exactly once or explicitly allowlisted
      (exhaustiveness test red otherwise); Overview mirrors marked as pins and
      excluded from the uniqueness count; every row carries a sprint tier flag.
- [ ] The menu always opens on Overview; the shell search is global-first and
      reachable as the first body Tab stop; results jump to home categories.
- [ ] Under body.mobile-touch the back-stack shell renders (never the two-pane);
      desktop-only rows are hidden, not shrunk; back pops levels; level-0 pop
      closes; all player-required settings reachable on touch.
- [ ] Full keyboard operation: every row reachable and adjustable without a
      pointer; trap + focus return green in the existing suites.
- [ ] Full controller operation behind hasActiveTrap(): all verbs, consumed
      edges, legend strip while connected, `.is-active-row` cursor always
      visible (not dependent on :focus-visible).
- [ ] Rebind capture has three exits and can never trap; evictions announced
      and visible; unbound actions banner-listed; controller duplicates
      chipped; rail conflict dot visible when collapsed.
- [ ] Search finds every rendered row (structural index test) in both scopes.
- [ ] Preset-then-detail graphics flips to Advanced on detail edit; fairness
      invariant untouched (cosmetic-only tiers, static preset reads).
- [ ] AA contrast in all four themes; forced-colors non-color cues verified;
      reduced-motion collapses all new motion; no transform scale anywhere.
- [ ] 44px touch controls, 16px input floor, landscape phone pass; portrait
      unaffected (rotate gate); renderRailModel/renderCategory contract in
      place for the future sheet host.
- [ ] Dispatch byte-parity: every existing onSettingChange path and coercion
      unchanged; uiScale commitOnChange preserved.
- [ ] Esc/closeAll semantics, logout, bug report, music resume, perf-overlay
      gating all preserved.
- [ ] npm run gate green (known Windows-local new_endpoint failure excluded);
      before/after screenshots (desktop + landscape mobile) committed under
      docs/screenshots.
