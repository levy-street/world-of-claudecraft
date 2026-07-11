# World of ClaudeCraft: AAA dark-fantasy UI/UX redesign specification

Companion to `docs/design/ui-ux-current-state.md` (the inventory, wiring, and hard
constraints this spec builds on). This document is the executable design spec: an
implementation agent should be able to work from it section by section without
re-deriving decisions. It preserves the existing architecture: plain DOM + canvas
painters + CSS tokens + the `Hud` coordinator, working identically in `index.html`
and `play.html`. No framework migration.

Scope: desktop full-screen HUD and windows, plus first-class mobile portrait and
landscape layouts. All redesign work is presentation-layer; section 12 names the
zero-to-few `IWorld` seam touches.

---

## 1. Design vision

The finished interface reads as a forged artifact: dark iron panels, gold-brown
metal accents, aged-parchment texture in management screens, heraldic display
type for titles. In practical UI terms:

- **Three panel depths, everywhere.** Every surface is one of three depths:
  L0 in-world chrome (translucent dark, hairline border, sits over the 3D world),
  L1 windows (the current `--panel-bg` gradient, framed border, corner ornament),
  L2 modals and dialogs (strongest border, scrim behind). Depth is encoded in
  tokens (section 9), so the whole game gets it by construction.
- **Gold is earned.** `--gold` marks interactivity, focus, selection, and rarity
  moments. It is never used as passive decoration on large areas. Passive framing
  uses the border browns (`--color-border-default`, `--panel-edge`).
- **Type has two jobs.** `--font-display` (Cinzel) appears only in window titles,
  zone and subzone names, and ceremony moments (level up, boss intro). All frames,
  bars, lists, forms, and body copy use `--font-ui` (Alegreya Sans). This is what
  makes the display font feel premium instead of noisy.
- **The center column is combat's.** The vertical band through screen center
  carries only target frame, cast bars, encounter status, announcements, ground
  reticle, and FCT. No window opens centered into it during combat by default on
  desktop (windows open in the side thirds; see 3.6).
- **One anatomy for all 24 windows.** Same titlebar, tab rail, scrollbar, search
  field, footer action row, empty state, and close affordance. A player who has
  used the vendor already knows the mailbox.
- **Mobile is a shell of its own.** Bottom menu bar, left nav drawer, bottom
  sheets with snap points. Not a scaled-down desktop; the same view-cores feed a
  different chrome.
- **Every flourish is sheddable.** Glow, parchment grain, ambient shimmer, damage
  ghosting, vignette: all keyed to `data-fx-level` and `--motion-scale`, all
  duplicating (never replacing) a baseline cue that survives at the low tier.

## 2. User experience principles

1. **Combat information is sacred.** Own debuffs, party and raid HP, target and
   boss cast bars, target HP granularity, enemy and aggro positions, threat
   state, key cooldowns, and combat warnings render at every graphics tier, every
   viewport, every theme, and are never covered by menus on mobile.
2. **One grammar, many windows.** Shared components (section 8) are the only way
   panels are built. A new window is a composition, not an invention.
3. **Density follows stakes.** Always-on combat chrome is compact (28px control
   height, 12 to 13px labels). Management windows are generous (36px controls,
   15px body, 16 to 24px gutters). Mobile is reach-first (44px controls, 40x40
   minimum targets).
4. **Reach before beauty on touch.** Primary actions live in thumb arcs: bottom
   bar, bottom sheets, right-hand action ring. Nothing critical top-center on a
   phone.
5. **Stability over spectacle.** No content update resizes a parent, shifts a
   sibling, or clips. Fixed slots for variable content (cast bar lane, aura rows,
   toast stack) are reserved in layout even when empty.
6. **Keyboard-first parity on desktop.** Everything reachable by pointer is
   reachable by Tab, with a visible focus ring, trapped focus in windows, and
   focus return to the opener.
7. **Cosmetics shed, information does not.** The fairness invariant is a design
   input, not a review gate: every effect is designed with its low-tier fallback
   named at design time.
8. **Localized by construction.** Layouts are sized for text expansion (target
   +35 percent over English); labels truncate with ellipsis plus tooltip, never
   overflow; all copy through `t()`.
9. **Performance is a design constraint.** New per-frame surfaces are budgeted
   (section 13) before they are drawn.
10. **Progressive disclosure.** Peek, half, full: chat and mobile sheets expose
    three states, and the default is the least intrusive that still informs.

## 3. Desktop full-screen layout

### 3.1 Zone map

```
+------------------------------------------------------------------+
| Z1 player/party        Z2 compass ribbon         Z3 minimap      |
| frames + buffs         subzone . clock . coords  quest tracker   |
|                                                  notifications   |
|                        Z4 target frame            perf/net chip  |
|                        boss frame + cast bar                     |
|                        combat announcer lane                     |
|                                                                  |
|                        Z5 world / reticle / FCT                  |
|                        (kept clear)                              |
|                                                                  |
|                        own cast bar                              |
| Z7 chat                Z6 action bar stack        Z8 meters      |
| tabs + log + input     consumables . swing timer  loot rolls     |
|                        XP bar (full-width thin)   micro-menu     |
+------------------------------------------------------------------+
```

### 3.2 Zone specifications

All zones anchor to the `#ui` container edges with `--hud-inset` (16px) margins,
never raw viewport units. Positions are the shipped defaults; frames built on
`movable_frame` remain user-draggable with persisted positions.

- **Z1 top-left, identity cluster.** Player unit frame (portrait 48px circle,
  name, level, HP bar 180x14, resource bar 180x10), pet frame indented below,
  party frames in a vertical column below (each 160x36 compact rows), player
  buff row (28px icons, wraps to 2 rows max) to the right of the player frame.
  Own debuffs render on the player frame bottom edge with school-tinted borders
  and are exempt from any tier shedding.
- **Z2 top-center, compass ribbon.** A single thin band (28px tall, L0 panel):
  compass strip with cardinal marks, subzone name in `--font-display` 15px,
  clock and coords right-aligned in `--font-ui` 12px via `formatDateTime` and
  `formatNumber`. Non-interactive except map-pin markers. Fades its decorative
  border at low fx tier; the text never fades.
- **Z3 top-right, awareness column.** Minimap (176px square, existing canvas
  painter, framed by an L0 ring with zoom and tracking buttons on a 32px rail),
  quest tracker below (max 5 objectives, 260px wide, collapsible per quest),
  notification toast stack below that (max 3 visible, FIFO), perf/connection
  chip in the extreme corner (existing `perf_overlay` + reconnect state, 20px
  tall, click expands).
- **Z4 center-upper, engagement lane.** Target frame (portrait + HP with exact
  granularity + resource + ToT chip) centered at 18 percent from top. Boss or
  encounter frame docks above it. Enemy cast bar renders in a fixed 260x22 slot
  directly under the target frame; the slot is reserved in layout even when no
  cast is active (no shift). Combat announcer text lane below that (2 lines
  reserved, `role=status` live region as today).
- **Z5 center, world.** Ground-aim reticle and FCT lanes only. FCT rises through
  two lanes offset left and right of center to keep the crosshair clear; pooled
  and capped as today (`FCT_POOL_CAP`).
- **Z6 bottom-center, action stack.** From bottom up: XP bar (full-width 6px
  thin bar hugging the screen bottom, existing `xp_bar`), primary action bar
  (12 slots, 44px cells desktop), secondary bars stack above (up to 2 rows,
  40px cells), consumable bar right-adjacent (existing `consumable_bar_view`),
  swing timer as a 2px underline on the primary bar, own cast bar centered 280x24
  above the stack in a reserved slot. Cooldowns render as radial sweeps in the
  cell canvas; keybind labels top-left of each cell, stack counts bottom-right.
- **Z7 bottom-left, chat.** Tabbed chat (existing tabs), 380x220 default, resizable
  via bottom-right grip (`movable_frame` resize), input row appears on focus with
  channel chip. Log is `role=log` as today. Rest opacity 0.92 out of combat is
  cosmetic and optional (options toggle, AA contrast preserved at rest).
- **Z8 bottom-right, management corner.** Micro-menu: a horizontal rail of 36px
  icon buttons (char, spellbook, talents, questlog, map, social, bags, options)
  with keybind tooltips; bags shortcut shows free-slot count badge. Meters panel
  (existing `meters`) docks above the rail, collapsible. Loot roll status toasts
  stack above meters (existing `loot_roll_status_view`), fixed-width 280px slots.

### 3.3 Sizing and scaling behavior

- The whole HUD scales through the existing `ui_scale` (0.8 to 1.15); zone
  insets and frame sizes are token-derived so scale applies uniformly.
- Windows clamp to the `#ui` container: `width: min(<class width>, calc(100% -
  2 * var(--spacing-lg)))`, same for height. No `92vw`-style units.
- At widths under 1280px, Z8's meters auto-collapse to a header bar and Z3's
  quest tracker collapses to counts-only rows (both are expand-on-click; the
  information remains one interaction away and this is viewport-driven, not
  fx-tier-driven, so it is layout responsiveness, not information shedding:
  the collapsed rows still show objective counts and completion state).

### 3.4 Density rules

- Combat chrome (Z1, Z2, Z4, Z6): compact scale, 12 to 13px labels, 28px
  controls, 4/8px gutters (`--spacing-xs/sm`).
- Management windows: 15px body, 36px controls, 16/24px gutters
  (`--spacing-md/lg`), max text measure 68ch in prose panes.
- Tooltips: 13px body, 15px title, max-width 320px.

### 3.5 Combat vs out-of-combat behavior

- **Entering combat:** urgency accents activate (section 10.4); chat drops to
  rest opacity if the option is on; nothing moves or resizes.
- **Out of combat:** decorative frame glow may breathe at fx high/ultra
  (`--fx-ambient-anim`); all values and bars remain fully readable.
- **Never:** hiding frames, collapsing trackers, or shifting layout on combat
  state change. Combat state changes visual emphasis only.

### 3.6 Window placement discipline

- Management windows open in the horizontal thirds left or right of center by
  default (bags/bank dock right as today via `body.bank-open`; questlog, social,
  mailbox open left; char, spellbook, talents open right). The world map and
  options open centered because they are full-attention contexts.
- Open windows never overlap Z4 (target/cast lane) while the player is in
  combat: windows that would, shift horizontally to the nearest clear third.
- Dragging persists per window; a reset-layout action lives in options.

## 4. Mobile layout and menus

Touch behaviors gate on pointer capability and runtime state, not only width
(landscape phones must get them). Safe areas: all edge-anchored chrome pads by
`env(safe-area-inset-*)` on top of `--hud-inset`; `--app-vw/--app-vh` remain the
viewport source of truth.

### 4.1 Portrait layout

```
+----------------------------+
| status strip (player+target)|
| subzone . minimap chip      |
|                             |
|        world                |
|  own debuffs strip (pinned) |
| stick          action ring  |
| chat chip                   |
| [menu][bags][map][quest][chat]
+----------------------------+
```

- **Status strip (top):** player HP/resource compact bar left, target frame with
  cast bar appears center-right when engaged (fixed slot). Party HP renders as
  a 4-chip row under the strip when grouped. All exempt from shedding.
- **Minimap chip:** 64px circular minimap top-right; tap opens the map sheet.
- **Action ring:** existing `mobile_action_ring_painter`, bottom-right thumb
  arc; virtual stick bottom-left (existing `mobile_controls`).
- **Own debuffs strip:** pinned directly above the ring, never covered.
- **Bottom menu bar:** 56px + safe-area, five 44px slots: Menu (opens drawer),
  Bags (badge: free slots), Map, Quests (badge: completable count), Chat
  (badge: unread). Active window highlights its slot with a gold underline.

### 4.2 The nav drawer (hamburger)

- Slides from the left, 84 percent width max 360px, `--z-drawer`, scrim behind.
- Grouped, with section headers (all labels `t()` keys under
  `hudChrome.mobileNav.*`):
  - Character: char, spellbook, talents, corpse_harvest
  - Adventure: questlog, map, calendar, daily_rewards, town_focus, rite
  - Economy: bags, bank, vendor, market, crafting, mailbox, heroic_vendor,
    loot_settings
  - Social: social, chat settings, leaderboard, arena, vale_cup
  - System: options, bug report, logout (online mode only)
- Each row 48px, icon + label + optional badge; close affordances: scrim tap,
  swipe left, and an explicit close button in the drawer header; focus is
  trapped while open and returns to the Menu button on close.

### 4.3 Bottom sheets

The generic sheet host (new module, section 12) presents windows on mobile.

- **Snap points:** peek 33 percent, half 60 percent, full 92 percent of
  `--app-vh`. Opening default per window class (section 6 table).
- **Anatomy:** grab handle (44px wide hit area), sticky header (48px: back
  chevron when pushed, title in `--font-display` 17px, close button 44x44),
  content region with themed scrollbar, sticky footer action row for
  transactional windows (buy, accept, confirm).
- **Gestures:** drag handle between snaps; swipe down from peek dismisses;
  content scrolls only at full (at peek/half the sheet itself drags). All
  transform-driven, no layout reads during gesture (heights cached on open).
- **Combat guard:** while in combat, sheets clamp to half and the right 25
  percent above the ring stays untouched: the sheet narrows to 75 percent width
  bottom-anchored-left, so the action ring, own debuffs, and target cast bar
  remain visible and tappable. Full height is refused in combat.
- **Edge safety:** 16px side margins at half/full; no interactive element within
  8px of a screen edge except the handle.

### 4.4 Landscape layout

- Frames: compact player+target cluster top-left; party chips vertical on the
  far left edge.
- Nav drawer unchanged (left). Content presents as a right-side panel instead
  of a bottom sheet: same sheet module, side mode, width 60 percent max 480px,
  never overlapping the ring (ring sits bottom-right in front).
- Bottom menu bar becomes a left-edge vertical rail of the same five 44px slots.
- Chat: collapsed chip bottom-left; peek shows last two lines.

### 4.5 Chat states (mobile)

- **Collapsed:** a 44px chip with unread badge, bottom-left above the stick.
- **Peek:** last 2 lines, translucent L0 panel, tap-through disabled only on the
  text itself (existing `touch_peek` behavior); auto-shows on new message for 6s
  when enabled, reduced-motion safe (opacity only).
- **Expanded:** half-height sheet with tabs, log, and input (16px font floor);
  keyboard dismiss via existing `chat_keyboard_dismiss`; send returns to peek.

### 4.6 Menu hierarchy summary

Bottom bar (5 core) -> drawer (all 24 grouped) -> sheet (the window) -> pushed
detail (master-detail windows push within the sheet with a back chevron).
Every level has: visible close, back where pushed, section headers, sticky
primary action. Direct world interactions (talk to vendor, loot corpse) open
their sheet directly at half without passing through the drawer.

## 5. Global navigation model

- **Open:** desktop keybinds (existing `keybinds.ts` bindings, rebindable in
  options), micro-menu icon buttons, world interactions (NPC gossip, corpse,
  mailbox). Mobile: bottom bar, drawer, world interactions.
- **Close:** Esc closes the topmost window (existing single `closeAll`
  dispatcher order preserved: context menu, then tooltip, then topmost window,
  then options). Mobile: swipe-down, scrim tap, close button, system back where
  the shell provides it.
- **Toggle:** the opener key or button of an open window closes it (existing
  `toggle*` semantics preserved).
- **Exclusivity:** management windows share one layer; opening one closes a
  same-slot sibling except sanctioned pairs (bags+bank dock; bags may stay open
  beside vendor and mailbox for drag interactions). The world map and options
  are exclusive full-attention windows.
- **Search and filter:** every list-bearing window exposes the standard search
  field (section 8) in its header; filter cores already exist for bags, bank,
  and market and extend to mailbox, social, spellbook, questlog, leaderboard as
  pure view-core filters. No new global search keybind (avoids colliding with
  chat `/`); Tab order reaches the search field first in the window body.
- **Return:** closing any window returns focus to its opener element via
  `FocusManager`; on mobile, dismissing a sheet returns focus to the bottom-bar
  slot or drawer row that opened it.

## 6. Window system

### 6.1 Shared anatomy (all 24 windows)

- **Frame:** L1 panel; 1px `--color-border-default` border plus inner
  `--panel-edge` line; corner ornament via pseudo-elements at fx medium+ (pure
  decoration, dropped at low).
- **Titlebar:** 40px desktop, 48px mobile sheet header; title `t()` key in
  `--font-display` 17px `--color-gold`; drag handle area (desktop, via
  `movable_frame`); close icon button 28px visual with 40px hit area minimum.
- **Tab rail:** 36px under the titlebar where the window has modes; gold
  underline on the active tab; roving tabindex (existing `roving_index`).
- **Body:** themed scrollbar (existing tokens); content grid per pattern below.
- **Footer:** sticky action row for transactional windows; primary button
  right-aligned desktop, full-width stacked mobile.
- **States:** every window defines empty (icon + one-line `t()` explanation +
  optional action), loading (skeleton rows, no spinners over 400ms without
  text), and error (inline `--color-text-error` banner with retry) states.

### 6.2 Size classes (desktop)

- S: 420x520 max. M: 720x560. L: 960x680. XL: min(1200px, 92 percent of `#ui`)
  by min(800px, 88 percent). Full: the world map (edge-to-edge overlay with
  L2 scrim).
- Scaling up never stretches a single column: XL windows are 2 or 3-pane grids
  whose panes widen to caps (lists 320 to 400px, detail panes to 68ch) and then
  gain gutter, so full-screen never feels sparse.

### 6.3 Per-window treatment

| Window | Desktop pattern | Class | Mobile presentation | Notes |
|---|---|---|---|---|
| arena | scoreboard panel, team columns | M | half sheet | DOM-rendered (sanctioned exception); team color tokens |
| bags | slot grid, filter header | S | full sheet grid | docks with bank; free-slot badge feeds bottom bar |
| bank | tabbed slot grid + deposit-all | M | paired sheet with bags | existing 50/50 pairing preserved |
| calendar | month grid + event detail pane | L | full sheet, agenda list first | detail pushes |
| char | paperdoll + stats two-pane | L | full sheet, Equipment/Stats tabs | stat tooltips become tap-to-reveal rows |
| chat | chat settings and tabs config | S | via chat sheet settings tab | window is config; the log lives in Z7/sheet |
| corpse_harvest | loot-style grid + progress | S | half sheet | timed action bar in footer |
| crafting | recipe list + detail + queue | XL | full sheet, list pushes detail | search + profession tabs |
| daily_rewards | 7-day card strip + claim | M | half sheet | claim is the sticky footer action |
| heroic_vendor | token table + preview pane | M | full sheet | currency chip in header |
| leaderboard | table + segmented filters | L | full sheet | virtual-scroll list rows (pooled) |
| lockpick | minigame dial | S fixed | centered modal, not a sheet | precision input; large touch dial variant |
| loot_settings | form sections | S | half sheet | plain form grammar |
| mailbox | inbox list + reader pane | L | full sheet, push nav | attachments use item cells |
| market | browse/sell/collect tabs, 3-pane browse | XL | full sheet + filter sub-sheet | heaviest window; keyed row pooling |
| options | category rail + form panes | XL | full sheet, section list pushes | keybind rebind rows keep capture UX |
| questlog | zone-grouped list + detail | L | full sheet, push nav | share/track actions in footer |
| rite | ceremony panel | M | half sheet | display-font moment; sparse by design |
| social | friends/guild/ignore tabs + list | L | full sheet | context actions via existing player menu |
| spellbook | school tabs + ability grid | L | full sheet grid | drag-to-actionbar desktop; tap-assign mobile |
| talents | tree canvas + loadout footer | XL | full sheet, pinch/pan canvas | staged-edit footer is sticky |
| town_focus | project panel + progress | M | half sheet | progress bars from shared grammar |
| vale_cup | event hub tabs (brief/bet/standings) | L | full sheet | reuses existing vale_cup views |
| vendor | buy/sell/buyback list + money row | M | full sheet at half default | opens directly from NPC interaction |

## 7. HUD chrome system

Each element keeps its existing view-core and painter; the redesign is token,
CSS, and minor painter work (section 12 maps it).

- **Player unit frame:** portrait ring gains a 2px state ring (rest gold-dim,
  combat `--color-hostile` tint at fx medium+; baseline combat cue remains the
  existing combat indicator at all tiers). HP bar uses `--color-hp` with a
  cosmetic damage-ghost trail (section 10.4); resource bar colored per class
  resource token. Text: name 13px, level chip 11px.
- **Party frames:** compact rows; HP fill plus a numeric percent at reduced
  granularity never below what ships today; role icon left; debuff dot row
  right (school-tinted). Raid grid variant packs 5-wide chips. All HP rendering
  is tier-exempt.
- **Target frame:** exact HP granularity preserved at every tier; ToT chip
  36px; classification border (elite gold filigree at fx medium+, plain gold
  border at low: the classification information itself is the border color,
  which never sheds).
- **Cast bars:** own (Z6 slot) and target (Z4 slot). Fill is linear real-time,
  never eased (the timing is the information). Interrupt window ticks as 1px
  notches. School color from the debuff-school token family.
- **Action bars:** cell chrome from L0 grammar; radial cooldown sweep on the
  cell canvas; GCD as a subtle full-bar sweep at fx medium+ with the per-cell
  sweep as the baseline; keybind label 10px top-left; out-of-resource dims icon
  to 40 percent with a `--color-mana` tint edge, out-of-range tints
  `--color-hostile` (both are actionable states: they render at all tiers).
- **Auras:** buff row (Z1) 28px icons; debuff rows school-tint borders (existing
  tokens); duration text under icon, sweeping radial overlay for time remaining.
  Own debuffs everywhere are tier-exempt.
- **Minimap and compass:** canvas painters unchanged; the framing ring, zoom
  rail, and ping styling move to tokens. Compass ribbon per 3.2.
- **XP bar:** thin bottom bar, rested segment in `--color-mana`-family tint,
  tick marks per 10 percent; hover/tap reveals the detailed readout (existing
  `xpBarView` strings).
- **Meters:** header bar + rows with class-colored left edge; collapsible;
  numbers via `formatNumber`.
- **Quest tracker:** per-quest collapsible group, objective rows with progress
  `n/m` and a 2px progress underline; complete objectives get `--color-text-success`.
- **Combat and chat announcers:** unchanged semantics (live regions, throttling);
  visual pass only (display font for zone-entry and boss intro moments).
- **Loot roll status:** fixed-slot toasts with item cell + rarity edge + roll
  timer bar + need/greed/pass buttons (40px on touch).
- **Tooltips:** L2 mini-panels at `--z-tooltip`; item tooltips use rarity title
  color + stat block grammar; comparison tooltip docks beside (existing
  `item_compare`); mobile: long-press opens, tap-away closes.
- **Notifications:** section 8 toast grammar, priority tokens (section 9);
  critical persists until dismissed and mirrors to the live region.

## 8. Component grammar

Shared CSS classes live in `components.css` (and `hud.mobile.css` for touch
variants). All states below are mandatory for every instance. Collision policy:
a grammar name that collides with a legacy class in the later `shell` layer
takes an `is-*` modifier or `ui-*` prefixed form instead (layer order outranks
selector specificity, so scoping alone cannot win those), hence
`.btn.is-primary`, `.btn.is-danger`, and `.ui-badge` below.

- **Panels:** `.panel-l0` `.panel-l1` `.panel-l2` per depth tokens. Only these
  three; no bespoke panel backgrounds.
- **Headers:** `.panel-header` 40px, display-font title, optional icon slot,
  right-aligned control cluster.
- **Tabs:** `.tab-rail` + `.tab` (36px, gold active underline, roving
  tabindex, `aria-selected`). Overflow scrolls horizontally on touch, never wraps.
- **Buttons:** `.btn` (36px), `.btn.is-primary` (gold fill, dark text),
  `.btn-ghost` (border only), `.btn.is-danger` (error-tint border). States:
  hover (border brighten, no scale), active (inset shade), disabled (40 percent
  opacity + `aria-disabled`), loading (inline spinner replaces label,
  width preserved to avoid shift).
- **Icon buttons:** `.icon-btn` 36px desktop, 44px touch; always an `aria-label`
  `t()` key; badge slot top-right.
- **Cards and chips:** `.card` (L1 mini, 12px pad), `.chip` (24px pill,
  count/status). No scale on hover or focus, ever.
- **Inputs:** `.field` 36px desktop, 44px touch, 16px font floor on touch
  (inherited from the base.css floor); label above, validation line below in
  error/success tokens; `aria-invalid` synced (existing `auth_utils` pattern).
- **Dropdowns:** `.dropdown` reuses existing `dropdown_nav`/`dropdown_position`;
  listbox semantics, max-height 320px with scrollbar.
- **Search:** `.search-field` = field + leading icon + clear button; filters as
  `.chip` toggles in a `.filter-row` under the header.
- **Tables and lists:** `.data-table` (sticky header row, 32px rows desktop,
  48px touch, zebra via panel-depth tint), `.list-rows` for master panes;
  long lists use keyed row pooling (section 13).
- **Scrollbars:** existing scrollbar tokens; visible-on-hover desktop,
  overlay-style touch.
- **Badges:** `.ui-badge` 16px count pill; priority variants from notification
  tokens.
- **Item cells:** `.item-cell` 44px (40px grid-dense): icon, rarity border from
  `--color-quality-*`, count bottom-right, cooldown sweep overlay slot,
  focusable with the standard ring, tooltip on hover/long-press.
- **Rarity treatment:** border + title color from the quality tokens; epic+
  gains an inner glow at fx medium+ (cosmetic; border color is the baseline).
- **Progress and resource bars:** `.bar` with fill element; resource variants
  colored by resource tokens; label inside only when height >= 14px, otherwise
  adjacent; all width writes through elided writers on hot paths.
- **Empty, loading, disabled, error states:** as defined in 6.1, one shared
  visual per state across all windows.

## 9. Visual design tokens

All new tokens land in `src/styles/tokens.css` (`@layer tokens`); theme-varying
knobs additionally join `themeCssVars` in `src/ui/theme.ts`, where **all four
presets (classic, midnight, parchment, highContrast) must define every knob**
(`tests/theme.test.ts` enforces definition + WCAG contrast). No raw hex appears
in implementation guidance below; new values derive from existing tokens or are
chosen at implementation time inside the theme system.

### 9.1 Layering scale
`--z-hud: 10; --z-window: 100; --z-dock: 150; --z-drawer: 200; --z-modal: 300;
--z-toast: 400; --z-tooltip: 500;` One scale, no ad-hoc z-index anywhere.

### 9.2 Panel depth
- `--color-panel-l0-bg`: translucent dark derived from `--panel-base` (approx 86
  percent alpha); `--color-panel-l0-border`: hairline from `--color-border-default`.
- `--color-panel-l1-bg`: aliases the existing `--panel-bg` gradient.
- `--color-panel-l2-bg`: `--panel-bg` over a solid `--color-bg-dark` base (no
  translucency: modals must not composite the world through them).
- `--color-panel-edge` (exists as `--panel-edge`), reused across depths.

### 9.3 Window chrome
`--window-titlebar-h: 40px; --window-titlebar-h-touch: 48px;
--window-title-color: var(--color-gold); --window-border:
var(--color-border-default); --window-ornament-size: 12px` (ornament renders
only at fx medium+).

### 9.4 Modal overlay and scrim
`--color-scrim`: black-derived at approx 55 percent alpha; `--scrim-blur`: a
backdrop blur radius consumed only where the existing glass rules apply (the
low tier already force-drops all backdrop-filter, so the scrim falls back to
the solid translucent color automatically).

### 9.5 Mobile drawer and bottom sheet
`--drawer-w: min(84%, 360px); --drawer-bg: var(--color-panel-l1-bg);
--sheet-bg: var(--color-panel-l1-bg); --sheet-radius: 12px 12px 0 0;
--sheet-handle-color: var(--color-border-default);
--sheet-snap-peek: 33; --sheet-snap-half: 60; --sheet-snap-full: 92`
(snap values are percentages of `--app-vh`, consumed by the sheet module).

### 9.6 Combat urgency
`--color-urgency-warn`: amber family (aligns with the existing aggro orange
role); `--color-urgency-danger`: derived from `--color-hostile`;
`--urgency-pulse-dur: calc(1200ms * var(--motion-scale))`. Urgency colors are
emphasis over baseline cues, never the only cue.

### 9.7 Rarity
`--color-quality-poor/common/uncommon/rare/epic/legendary`, seeded from the
established `QUALITY_COLOR` table in `src/ui/icons.ts`. **Tokens become the
single source:** the JS table is refactored to resolve from the tokens via one
cached `getComputedStyle` read at startup (same pattern as the map painters),
so CSS borders and canvas icon frames can never drift apart.
`--color-quality-default` already exists and is kept.

### 9.8 Focus ring
`--focus-ring-color: var(--color-border-focus); --focus-ring-width: 2px;
--focus-ring-offset: 2px`. Consumed by one shared `:focus-visible` rule;
`forced-colors: active` swaps to system `Highlight` (existing base.css section).

### 9.9 Tooltip layer
`--tooltip-bg: var(--color-panel-l2-bg); --tooltip-border:
var(--color-border-default); --tooltip-max-w: 320px`; tooltips render at
`--z-tooltip` above everything including modals.

### 9.10 Notification priority
`--color-notify-info` (border-default family), `--color-notify-success`
(from `--color-text-success`), `--color-notify-warning` (urgency-warn),
`--color-notify-critical` (from `--color-text-error`);
`--notify-dur-short: 3000ms; --notify-dur-long: 6000ms` (critical persists).

### 9.11 Motion and reduced motion
`--dur-fast: 120ms; --dur-base: 200ms; --dur-slow: 300ms`. Every new animated
duration is authored as `calc(var(--dur-*) * var(--motion-scale))`, inheriting
the existing reduced-motion behavior (near-zero scale, `animationend` still
fires). `--fx-shadow` continues to scale decorative glow blur; parchment grain
ships as `--texture-parchment` (inline SVG data-URI) applied only under
`[data-fx-level="high"], [data-fx-level="ultra"]`.

### 9.12 Density and type scale
`--control-h-compact: 28px; --control-h: 36px; --control-h-touch: 44px;
--touch-min: 40px; --text-xs: 12px; --text-sm: 13px; --text-md: 15px;
--text-lg: 18px; --text-title: 22px`. The 16px touch input floor stays in
`base.css` and is not re-tokenized (its `!important` floor is the guard).

### 9.13 Theme inheritance
Theme-varying knobs (panel colors, scrim, urgency, rarity title colors, focus
ring, notification colors) join `themeCssVars`; structural knobs (z-scale,
sizes, durations, snap points) stay `:root`-only. `parchment` lightens panel
depths and strengthens the grain; `highContrast` maximizes border and focus
deltas and zeroes decorative glow; both keep AA text contrast (test-enforced).

## 10. Motion and effects

### 10.1 Allowed transitions
- Window open/close: 200ms cross-fade + 8px translateY, transform/opacity only.
- Sheet/drawer: 250ms transform slide; gesture-driven position is direct (no
  easing fight against the finger).
- Hover/focus: border and background color fades at 120ms. **No transform:
  scale() on hover or focus of list, rail, or chip items** (repo invariant).
- Bar fills: HP/resource/progress width moves with value through elided
  writers; an optional cosmetic damage-ghost (a second fill that drains 300ms
  behind the true value, fx medium+) may trail, the true fill is instant.

### 10.2 Reduced motion
All durations multiply by `--motion-scale`; under `prefers-reduced-motion`
cross-fades and translations collapse to near-instant, ambient loops pause
(`--fx-ambient-anim`), auto-peek chat becomes manual, the camera never
auto-rotates. No information is ever motion-only: every animated cue has a
static equivalent (color, border, text).

### 10.3 FX tier behavior (data-fx-level)
- **low:** no backdrop blur (force-dropped), no glow, no ornaments, no grain,
  no ghosting, no vignette, no ambient animation. Full information.
- **medium:** ornaments, cooldown GCD sweep, damage ghost.
- **high:** + glow accents, parchment grain, urgency vignette.
- **ultra:** + ambient breathing on decorative frame edges.
Tier resolution reads the static preset (`ui_effects_profile.ts`), never the
FPS governor.

### 10.4 Combat urgency effects
- Low-health baseline cue (all tiers): the existing `low_health` treatment.
- Additive at fx high+: a single fixed-position vignette element whose opacity
  is written per frame through an elided writer, pulsing at
  `--urgency-pulse-dur`.
- Target cast bar interrupt-window emphasis: border shifts to
  `--color-urgency-warn` (color change is baseline; any pulse is fx medium+).

### 10.5 Notification timing
Info/success auto-dismiss at `--notify-dur-short`; warnings at
`--notify-dur-long`; critical persists until dismissed and mirrors to the
status live region. Max 3 toasts visible, FIFO, fixed slots (no shift).

### 10.6 Never animate
Focus rings (steady, token-drawn). Cast bar timing (linear real-time). HP
values and granularity. Aura durations. Layout position of any combat element.
Anything under `forced-colors: active`.

## 11. Accessibility specification

- **Keyboard:** every interactive element Tab-reachable; windows trap Tab and
  Shift+Tab via the shared `FocusManager` only when focus is already inside
  (Tab remains the target-nearest game key outside); Esc closes topmost; focus
  returns to the opener on close. Roving tabindex for tab rails, action bar
  config mode, and grids (existing `roving_index`).
- **Focus order:** skip links ("Skip to Main HUD", "Skip to Chat") remain the
  first focusable elements; within a window: header controls, search, tab rail,
  body, footer actions.
- **Live regions:** `#chatlog` role=log; `#combat-live` role=status throttled
  per type; notifications mirror to status; error banners announce assertively.
  The new mobile drawer and sheets do not introduce new live regions; they
  reuse the toast/status channels.
- **Labels:** all accessible names via `t()` keys (aria-label included); icon
  buttons always labeled; item cells expose name + rarity + count in the
  accessible name.
- **Forced colors:** borders and focus ring survive via system colors (existing
  base.css section extends to all new components); no information conveyed by
  background color alone.
- **Contrast:** AA minimum across all four themes, test-enforced; muted text
  never used for values a player acts on.
- **Touch targets:** 40x40px minimum, 44px standard; 24px absolute floor only
  where genuinely infeasible (dense bag grids keep 40px).
- **Reduced motion:** per 10.2; verified by the existing reduced-motion suite.

## 12. Implementation architecture

### 12.1 Work-item map

| Work item | Type | Files | Notes |
|---|---|---|---|
| Token additions (section 9) | CSS tokens | `src/styles/tokens.css` | plus `themeCssVars` knobs in `src/ui/theme.ts`, all 4 presets |
| Component grammar | component CSS | `src/styles/components.css`, `hud.mobile.css` | extend existing modules, no new @import (keeps `styles_extraction` stable) |
| Window chrome restyle (24 windows) | CSS + minor markup | `components.css`, both HTML entries | shared `.window-frame` classes; markup parity in `index.html` + `play.html` |
| Desktop zone polish | CSS + hud wiring | `hud.css`, `src/ui/hud.ts` (composition only) | anchors, insets, reserved slots |
| Bottom sheet host | new module | `src/ui/bottom_sheet.ts` + `bottom_sheet_view.ts` | view-core in `UI_PURE_CORES`; instance-parameterized descriptor; side-panel mode for landscape |
| Mobile bottom menu bar | new module | `src/ui/mobile_menu_bar.ts` + `_view.ts` | badge model in the view-core (free slots, unread, completable) |
| Mobile nav drawer | new module | `src/ui/mobile_drawer.ts` + `_view.ts` | grouped nav model pure; focus trap via FocusManager |
| Notification stack | new module | `src/ui/notification_stack.ts` + `_view.ts` | pooled toasts, priority queue, fixed slots |
| Combat vignette | new module | `src/ui/combat_vignette.ts` | hot path: one element, one elided opacity write, fx high+ only |
| Window frame builder | new module | `src/ui/window_frame.ts` | cold path helper building titlebar/tabs from a descriptor (t() + esc()) |
| Rarity token unification | painter update | `src/ui/icons.ts` + `bags/bank/market` cells | QUALITY_COLOR resolves from tokens via cached getComputedStyle |
| Frame/bar visual pass | painter updates | `unit_frame_painter`, `action_bar_painter`, `auras_painter`, `cast_bar_painter`, `party_frames_painter` | token consumption + ghost/sweep hooks; write patterns unchanged |
| Filter standardization | view-core updates | `mailbox_view`, `social_view`, `spellbook_view`, `questlog_view`, `leaderboard_view` | pure filters modeled on `bag_filter`/`bank_filter` |
| New copy | i18n | `src/ui/i18n.catalog/hud_chrome.ts` | `hudChrome.mobileNav.*`, `hudChrome.sheet.*`, `hudChrome.notify.*`; English only; M16 rule for wordy strings |

### 12.2 IWorld additions
None required for the redesign as specified: every surface renders data already
exposed (frames, auras, quests, bags, market, meters, threat, connection state
via the existing reconnect/perf modules). If a future iteration adds new
on-screen information (for example a server latency number in the perf chip
sourced from the world), it follows the seam rule: extend `src/world_api.ts`,
implement in both `Sim` and `ClientWorld`, then consume. Name the seam in the
PR before building the UI.

### 12.3 Entry parity
Every markup or CSS-hook change lands in **both** `index.html` and `play.html`,
and `index.extra.css` is checked for affected selectors (known drift hazard).
New containers required in both entries: sheet host root, drawer root, bottom
menu bar root, notification stack root, vignette element.

### 12.4 Suggested phase order (for implementation agents)
1. **Phase 0:** tokens + theme knobs + z-scale (pure CSS, zero behavior risk).
2. **Phase 1:** component grammar CSS + window frame builder + one pilot window
   (vendor: it is the recipe reference) restyled end to end, both entries.
3. **Phase 2:** remaining 23 windows in family batches (grids, master-detail,
   forms, tables, canvas).
4. **Phase 3:** mobile shell (sheet host, menu bar, drawer, chat states).
5. **Phase 4:** HUD chrome polish (frames, bars, auras, tracker, toasts).
6. **Phase 5:** motion/fx layer (ghosting, vignette, ornaments, grain) with
   tier gating and reduced-motion verification.
Each phase ends green on `npm run gate` and lands before/after screenshots.

## 13. Performance plan

- **Hot-path protections:** all new per-frame writes go through PainterHost
  elided writers; the only new per-frame surfaces are the vignette (1 elided
  opacity write) and the damage-ghost fill (1 elided width write per visible
  bar, fx medium+). Menu bar badges, toasts, sheet position, and drawer state
  are event-driven, not per-frame.
- **No layout reads in hot paths:** sheet gestures cache container heights on
  open; drawer uses fixed token widths; no `offsetWidth`/`getBoundingClientRect`
  from any per-frame path (budget test scans for this).
- **Pooling and keyed reconciliation:** toasts, loot rolls, leaderboard and
  market rows, and party/raid chips use keyed pools with FIFO caps (patterns:
  `auras_painter`, `fct_painter`).
- **Canvas token caching:** every canvas painter reads new tokens via cached
  `getComputedStyle` (session cache, invalidation hook on theme change, as the
  minimap does today).
- **Cold-path freedom:** window open/build may use `innerHTML` (through `esc()`)
  and `createElement`; only `Hud.update()`-reachable code is budgeted.
- **Budget:** `tests/hud_perf_budget.test.ts` stays green; if the vignette and
  ghost writes push `hudHotDomWrites` past 153, re-baseline via the documented
  process in the same PR with the perf tour green (`scripts/perf_tour.mjs`
  against the recorded baseline, `frameP95 <= baseline`).
- **Tests that must pass:** `hud_perf_budget`, `architecture` (purity + the
  `*_view` completeness sweep for the four new view-cores), `painter_host`,
  per-painter no-magic scans, `alloc_probe`-backed core tests.

## 14. Mobile QA plan

- Portrait and landscape passes on a real or emulated phone for: bottom bar,
  drawer, every sheet-presented window, chat states, combat guard behavior.
- Mobile Safari/WebKit first-class: run the browserslist floor build, verify
  backdrop-filter fallbacks, safe-area padding on a notched viewport.
- Tap targets: rendered-size audit >= 40x40 on every interactive element
  (browser suite target-size checks).
- Input zoom: `node scripts/mobile_input_zoom_check.mjs` against `npm run dev`
  (16px floor holds in every sheet and drawer form).
- Drawer: open/close via button, scrim, swipe; focus trap and return; badge
  correctness.
- Sheets: snap points, gesture drag, combat clamp (half max + ring quadrant
  clear), edge safety margins, push/back navigation, sticky footers.
- Safe areas: no interactive element under `env(safe-area-inset-*)` regions.
- Combat readability: with a sheet open in combat, verify visible and tappable:
  action ring, own debuffs strip, target cast bar, party chips, low-health cue.

## 15. Desktop QA plan

- Big-3 desktop browsers (pinned floor in `.browserslistrc`): visual pass over
  all 24 windows and all HUD zones in each.
- Fullscreen and windowed at 1280x720, 1920x1080, 3440x1440; ui_scale extremes
  (0.8 and 1.15); zone collapse behavior under 1280px.
- Keyboard: full Tab walk of every window (order per 11); trap and return on
  every open/close; Esc stack order; rebound-key smoke test.
- Focus: `:focus-visible` ring visible on every interactive element in all four
  themes; never animated away.
- High contrast: `forced-colors: active` pass (borders + ring survive) and the
  `highContrast` theme preset pass.
- Reduced motion: `prefers-reduced-motion` collapses transitions, pauses
  ambient loops, keeps all information static-readable.
- Window overlap: combat-lane discipline (3.6), dock pairs, drag persistence,
  reset-layout action.
- Both entries: repeat the window pass on `index.html` and `play.html`.

## 16. Acceptance criteria

- [ ] No concrete world imports from UI (`tests/architecture.test.ts` green).
- [ ] No raw string copy outside i18n; new keys English-only in the correct
      catalog domain; M16 fills where wordy.
- [ ] No raw interpolated user/server text (all through `esc()`).
- [ ] No token bypasses: no literal hex/px/color in painter TS; per-painter
      no-magic scans green.
- [ ] No gameplay advantage or information loss from FX tiers
      (`ui_effects_profile` + `ui_tier_knobs` tests green; manual fairness pass
      against the section 10.3 tier table).
- [ ] No hot-path layout reads; no per-frame node churn (pooled + keyed).
- [ ] No layout shift during combat, chat, loot, quest, aura, or tooltip
      updates (reserved-slot audit).
- [ ] WCAG 2.2 AA for HUD chrome: focus suites + axe browser suite green.
- [ ] Mobile tap targets >= 40x40px; inputs >= 16px
      (`mobile_input_zoom_check.mjs` green).
- [ ] Desktop and mobile before/after screenshots committed under
      `docs/screenshots/` and referenced from the PR body.
- [ ] `npm run gate` passes (note the known Windows-local `new_endpoint` golden
      failure is pre-existing and excluded).
- [ ] `index.html`, `play.html`, and `index.extra.css` parity verified
      (`per_entry_css_wiring` test green plus manual selector check).
- [ ] `tests/theme.test.ts` green with every new knob defined in all four
      presets at AA contrast.
- [ ] New `*_view` cores registered in `UI_PURE_CORES` and tested against both
      Sim-shaped and ClientWorld-shaped stubs.

## 17. Deliverables

This specification delivers, in one document:

1. **Redesign narrative:** sections 1 and 2 (vision + principles).
2. **Desktop full-screen layout spec:** section 3 (zones, sizing, density,
   combat behavior, placement discipline).
3. **Mobile menu and responsive behavior spec:** sections 4 and 5 (portrait,
   landscape, drawer, sheets, chat states, navigation model).
4. **Component and token spec:** sections 6 to 10 (window system, HUD chrome,
   component grammar, tokens, motion).
5. **Implementation map:** section 12 (work items, new modules, seam policy,
   entry parity, phase order) plus section 13 (performance plan).
6. **QA and acceptance checklist:** sections 14 to 16.

Companion input: `docs/design/ui-ux-current-state.md`. Repo contracts of
record: root `CLAUDE.md`, `src/ui/CLAUDE.md`, `src/styles/CLAUDE.md`,
`docs/design/graphics-settings-fairness.md`.

