# HUD Visual, UX, and Accessibility Research Brief

World of ClaudeCraft. Synthesis of six research briefs reconciled against three
independent verification verdicts. Where a verdict corrected a research claim,
the corrected form is used and flagged inline. All external claims are cited with
a source URL; primary sources (w3.org, MDN, vendor docs) are preferred.

Scope: this is research for the FOLLOW-ON visual + UX + accessibility initiative
that rides on the already-planned behavior-preserving modularization of the
6,280-line `src/ui/hud.ts` into per-window modules under `src/ui/hud/<window>.ts`
sharing a `HudContext`. The modular refactor is the enabler; this packet does not
re-do it.

---

## 1. Executive summary

The thesis: the modular refactor is the enabler, and this packet layers beauty,
UX, and accessibility onto the modular components, deliberately re-baselining the
HUD's visuals rather than patching the monolith in place.

Three facts make this the right moment and shape every recommendation:

1. The HUD is real DOM over an opaque WebGL canvas, not a canvas-drawn UI. That
   is the single biggest structural advantage: screen-reader support is feasible
   on the DOM HUD without building a separate mirror DOM for the windows, because
   the windows are already in the accessibility tree. The hard
   canvas-accessibility problem applies only to the 3D world (treated as an
   opaque image) and to the procedurally drawn icons/bars/slots inside the HUD,
   which need accessible names attached to their DOM host elements. (Sources:
   https://www.tpgi.com/html5-canvas-sub-dom/ ,
   https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)

2. The repo is not starting from zero on tokens. `index.html` `:root` already
   ships a large flat set of CSS custom properties (verified present: `--gold` as
   the documented single source of truth for the accent, `--color-primary: var(--gold)`,
   `--color-hp/mana/rage/energy`, `--color-bg-*`, `--color-border-*`,
   `--color-text-*`, spacing/radius/transition tokens, and a font stack with
   `--font-display: 'Cinzel', ...`). Item rarity color is a separate hardcoded JS
   map, `QUALITY_COLOR` at `src/ui/icons.ts:1358` (verified). The visual work is
   to promote the flat set into a deliberate primitive-to-semantic layering and
   to drain JS color literals into tokens so a theme swap reaches everything,
   including canvas icon tinting.

3. `src/ui/CLAUDE.md` already mandates the accessibility floor (verified: WCAG 2.1
   AA, full keyboard operation, high-contrast `:focus-visible`, honor
   `prefers-reduced-motion`, text contrast >=4.5:1 / >=3:1 large, every tappable
   target >=40x40px, every input >=16px). This packet raises the target to WCAG
   2.2 AA, adds the criteria that are new in 2.2, and turns "mandated in prose"
   into "enforced by the modular seam."

The strongest single architectural recommendation: drive all of this through the
new per-window `HudContext` components. Each window owns its responsive reflow,
focus scope, ARIA semantics, and live-region wiring; centralize the
reduced-motion gate, the contrast tokens, the input-mode gate, and a single
announcer. Accessibility settings (scale, contrast, reduced motion, theme) are
read once into `HudContext` and applied as CSS variables and cached state, never
recomputed on the per-frame hot-write path.

---

## 2. Accessibility targets and standards

Recommended bar: WCAG 2.2 AA as the conformance target (a deliberate step up
from the WCAG 2.1 AA already in `src/ui/CLAUDE.md`), layered with named
game-accessibility guideline tiers as the practical roadmap, and one legal floor
that is non-negotiable for one specific surface.

### Tiers and standards to name in the design doc

- WCAG 2.2 AA: the web-conformance bar for the DOM HUD. The new-in-2.2 criteria
  that apply here (2.4.11 Focus Not Obscured, 2.5.7 Dragging Movements, 2.5.8
  Target Size Minimum) were independently verified as Level AA, and 4.1.3 Status
  Messages is Level AA (carried over from 2.1, not AAA; an earlier draft
  mislabel was a truncation artifact, corrected by Verification 3).
  (https://www.w3.org/TR/WCAG22/)
- Game Accessibility Guidelines (GAG) Basic / Intermediate / Advanced tiers as
  the prioritization framework, chosen by balancing reach, impact, and value.
  (https://gameaccessibilityguidelines.com/ , https://gameaccessibilityguidelines.com/full-list/)
- Xbox Accessibility Guidelines (XAGs, v3.2) as the cross-reference for game-UI
  specifics (text display, contrast, screen narration, input remapping, motion
  settings). (https://learn.microsoft.com/en-us/gaming/accessibility/guidelines)
- CVAA (legal floor, comms surface only): the U.S. Twenty-First Century
  Communications and Video Accessibility Act, Sections 716/717 of the
  Communications Act, performance objectives in 47 CFR 14.21, enforced by the
  FCC. It covers Advanced Communications Services (ACS), which in a game means
  in-game text and voice chat AND the UI used to operate them, NOT gameplay. The
  ESA industry waiver expired Dec 31, 2018, so communication functionality
  released on/after Jan 1, 2019 must comply. For this repo, the chat + combat-log
  input surface and the messaging in Social/Trade are ACS: they must be
  keyboard-operable, screen-reader-labeled (every control a `t()` aria key), and
  honor text-scaling/contrast. This is the one place accessibility is a legal
  requirement, not a nice-to-have. (https://www.fcc.gov/cvaa ,
  https://www.fcc.gov/acs ,
  https://www.fcc.gov/consumers/guides/accessibility-communications-video-games)
  OPEN: the FCC consumer-guide page timed out during research; the CVAA facts are
  corroborated by the FCC CVAA/ACS pages plus
  https://www.3playmedia.com/blog/the-cvaa-video-game-accessibility/ but the
  consumer guide itself was not directly read.

### WCAG 2.2 success criteria that apply to this HUD, with thresholds

All thresholds below are from https://www.w3.org/TR/WCAG22/ and the per-criterion
Understanding pages at https://www.w3.org/WAI/WCAG22/Understanding/ . The numeric
thresholds (4.5:1, 3:1, 24x24, 320/256 px, text-spacing multipliers, the 2.5.8
exceptions) were independently confirmed by Verification 3 and Verification 1.

Perceivable:

- 1.4.3 Contrast (Minimum), AA: text >=4.5:1; large text >=3:1, where large is
  >=18pt or >=14pt bold (=24px / 18.66px bold at 96dpi). Disabled/inactive
  components, logos, and pure decoration are exempt. Values are not rounded
  (2.999:1 fails). Repo risk surfaces: small keybind and cooldown glyphs over
  busy action-bar icon art (likely need a scrim or stroke), FCT, tooltip body,
  unit-frame names, and `--color-text-muted` on the dark surface.
- 1.4.6 Contrast (Enhanced), AAA (cheap on a dark palette): 7:1 / 4.5:1. Treat as
  advisory.
- 1.4.11 Non-text Contrast, AA: >=3:1 for the meaning-bearing shape of UI
  components, their states (selected/focused/checked), and graphical objects
  required to understand content. Applies to procedural icon shapes vs their tile
  background, cast-bar fill vs track, buff/debuff type-coding borders, minimap
  blips, the selection ring, slot borders, and the focus ring itself.
- 1.4.4 Resize Text, AA: text resizable to 200% without loss of content or
  function. Requires rem/em DOM type and tolerant layout. (Canvas text is a
  separate concern; DOM labels must scale.)
- 1.4.10 Reflow, AA: no two-dimensional scrolling at 320 CSS px width / 256 CSS px
  height (equivalent to 400% zoom at 1280px). The world canvas and minimap
  qualify for the "usage requires 2D" exception; the DOM windows (Spellbook,
  QuestLog, Options, Social, Bags, Market) must reflow to a 320px column. This is
  a strong argument for per-window modules to own responsive layout. OPEN: the
  full 1.4.10 exception wording was paraphrased; confirm the canvas/minimap
  exemption against the Reflow Understanding doc before any formal conformance
  claim.
- 1.4.12 Text Spacing, AA: no loss when the user sets line-height 1.5x,
  paragraph spacing 2x, letter-spacing 0.12x, word-spacing 0.16x. Avoid fixed
  heights and `overflow:hidden` on chat/quest/tooltip text boxes.
- 1.4.13 Content on Hover or Focus, AA: custom tooltips must be Dismissible
  (Escape without moving pointer/focus), Hoverable (pointer can cross onto the
  tooltip without it vanishing), and Persistent (until trigger removed/dismissed/
  invalid), and should appear on keyboard focus, not hover only. This is the
  single most HUD-specific criterion: it governs every item/spell/talent/buff
  tooltip.

Operable:

- 2.1.1 Keyboard, A: every mouse/touch action has a keyboard path, including
  drag-equip into bags, action-bar assignment, context menus, the emote wheel,
  and trade accept. Drag-and-drop needs a keyboard alternative.
- 2.1.2 No Keyboard Trap, A: modal windows, the emote wheel, context menus, and
  the keybind-capture flow in Options must allow Tab/Escape out.
- 2.4.3 Focus Order, A: opening a window moves focus into it in reading order;
  closing returns focus to the opener.
- 2.4.7 Focus Visible, AA: every focusable element has a visible focus indicator
  that survives the dark backdrop (pair with 1.4.11 so the ring is >=3:1).
- 2.4.11 Focus Not Obscured (Minimum), AA: a focused element is not entirely
  hidden by author content. The always-on action bar, chat dock, party frames,
  and mobile control pads must not fully cover a focused list row or slot; supply
  scroll-padding. (2.4.12 Enhanced, AAA, asks for no part hidden.)
- 2.5.7 Dragging Movements, AA (new in 2.2): every drag has a single-pointer
  no-drag alternative unless dragging is essential. Hits action-bar slot
  reassignment, item moves, sliders (tap-on-track), and window dragging. The
  W3C-blessed alternative is tap-to-pick-then-tap-to-place.
  (https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
- 2.5.8 Target Size (Minimum), AA (new in 2.2): pointer targets >=24x24 CSS px,
  with five exceptions, the most useful being Spacing (a 24px-diameter circle on
  each undersized target's center must not intersect a neighbor's). Bag/aura
  grids are the tightest; either size up or guarantee non-intersecting spacing.
  (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) The
  repo's existing >=40x40 mandate already exceeds this; phone primary controls
  should target a 48px hit area (Section 6).
- 2.2.2 Pause, Stop, Hide, A: any auto-moving/blinking/scrolling content lasting
  > 5s (a looping ticker or marquee) must be pausable/stoppable/hideable.
- 2.3.3 Animation from Interactions, AAA: interaction-triggered motion (window
  slide-in, FCT scroll/scale, button bounce, cast flourish, emote-wheel spin) can
  be disabled unless essential; honor `prefers-reduced-motion`. Gameplay-essential
  motion (the 3D world, combat) is exempt.

Robust:

- 4.1.2 Name, Role, Value, A: every hand-built DOM control needs explicit role,
  accessible name, and state (`aria-pressed`/`aria-checked`/`aria-expanded`/
  `aria-valuenow`). All accessible names come from `t()` keys in every locale.
- 4.1.3 Status Messages, AA: status changes convey via role/properties without
  moving focus. Verification 3 confirms this is Level AA. Use `role="status"`
  (polite), `role="alert"` (assertive), `role="log"` (sequential).

Coverage matrix (target = AA unless noted):

| SC | Name | Level | Threshold |
|---|---|---|---|
| 1.4.3 | Contrast (Minimum) | AA | 4.5:1 text / 3:1 large (>=18pt or 14pt bold) |
| 1.4.6 | Contrast (Enhanced) | AAA | 7:1 / 4.5:1 (advisory) |
| 1.4.11 | Non-text Contrast | AA | 3:1 |
| 1.4.4 | Resize Text | AA | 200% |
| 1.4.10 | Reflow | AA | 320px / 256px (400% @1280) |
| 1.4.12 | Text Spacing | AA | LH 1.5x, para 2x, letter 0.12x, word 0.16x |
| 1.4.13 | Content on Hover/Focus | AA | Dismissible + Hoverable + Persistent |
| 2.1.1 | Keyboard | A | All functionality |
| 2.1.2 | No Keyboard Trap | A | Focus can leave |
| 2.4.3 | Focus Order | A | Meaning-preserving |
| 2.4.7 | Focus Visible | AA | Indicator visible |
| 2.4.11 | Focus Not Obscured (Min) | AA | Not entirely hidden |
| 2.5.7 | Dragging Movements | AA | Single-pointer alternative |
| 2.5.8 | Target Size (Min) | AA | 24x24 CSS px (+5 exceptions) |
| 2.2.2 | Pause, Stop, Hide | A | >5s auto motion controllable |
| 2.3.3 | Animation from Interactions | AAA | Disablable unless essential |
| 4.1.2 | Name, Role, Value | A | Name+role+state programmatic |
| 4.1.3 | Status Messages | AA | Live region, no focus move |

---

## 3. ARIA widget specifications

Per-widget specs from the W3C ARIA Authoring Practices Guide (APG) and MDN role
references. Each is implementation-ready. Reminder: every `aria-label`,
`aria-valuetext`, `title`, menu item, and tab label named here is a `t()` key in
every locale; numbers/money/percents in value-text route through
`formatNumber`/`formatMoney`/`Intl`.

1. Modal dialog (Trade, Options, modal prompts; Character/Talents if they trap
   focus). `role="dialog"`, `aria-modal="true"`, `aria-labelledby` (visible title)
   or `aria-label`. Tab cycles and wraps; Shift+Tab wraps backward; Escape closes;
   focus trapped; on open move focus in, on close restore to opener. Load-bearing
   HUD note: while a modal is open you MUST suppress the global movement/ability
   key handlers or WASD/Escape/Tab leak to the sim. Reserve modal semantics for
   blocking windows; a pinned non-blocking Spellbook the player keeps open while
   moving should NOT be `aria-modal` and should NOT trap focus.
   (https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
2. Alert dialog (destructive confirms: delete item, abandon quest, decline trade).
   `role="alertdialog"`, `aria-modal="true"`, name plus a REQUIRED `aria-describedby`
   pointing at the message. Keyboard identical to modal. Use `dialog` for forms
   (Trade), `alertdialog` for "Are you sure?".
   (https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)
3. Menu / menu button (right-click context menus, the radial emote wheel).
   Trigger: `role="button"` + `aria-haspopup="menu"` + `aria-expanded`. Popup:
   `role="menu"` with `menuitem`/`menuitemcheckbox`/`menuitemradio`,
   `aria-disabled` on unavailable items, roving tabindex or `aria-activedescendant`.
   Keys: Enter/Space activate, Up/Down move, Right/Left for submenus, Home/End,
   Escape closes to trigger, optional typeahead, Tab exits. POOR-FIT FLAG: the
   radial emote wheel has no natural linear order for APG menus; expose it as a
   `role="menu"` ordered clockwise from 12 o'clock and map Up/Down (and optionally
   Left/Right) to previous/next-around-the-ring; the radial geometry is purely
   presentational. The exact radial key mapping is OPEN (APG has no radial
   pattern). (https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/ ,
   https://www.w3.org/WAI/ARIA/apg/patterns/menubar/)
4. Tabs / tablist (Social, Market, Talents tab strips). `role="tablist"` /
   `role="tab"` / `role="tabpanel"`, `aria-selected`, `aria-controls`/`aria-labelledby`
   crosslinks, roving tabindex (active tab 0, rest -1). Left/Right (or Up/Down if
   vertical) move and wrap. Use automatic activation since panels are cheap.
   Talents wrinkle: keep tab navigation distinct from in-tree navigation; Tab
   moves from the active tab into the talent grid.
   (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
5. Tooltip (item/ability/buff). POOR-FIT FLAG, significant: the APG `role="tooltip"`
   pattern is explicitly "work in progress, no task-force consensus," is weakly
   supported, cannot hold interactive content, and is announced as one blob; and
   this game's tooltips are canvas-drawn so there is no DOM tooltip for AT to
   read. Do NOT rely on `role="tooltip"` over a canvas rectangle. Build a parallel
   accessible description on the focusable host (serialized stats via
   `aria-describedby`/visually-hidden node). WCAG 1.4.13 still applies
   (dismissible + persistent; hoverable is moot for a canvas tooltip). OPEN:
   whether the densest tooltips should be an on-demand "inspect item"
   `role="dialog"` instead, which is the most robust SR route but changes the
   interaction. (https://www.w3.org/WAI/ARIA/apg/patterns/tooltip/)
6. Grid (Bags/inventory, Market results, talent tree as layout grid).
   `role="grid"`/`row`/`gridcell`, `aria-label`, `aria-rowcount`/`colcount` and
   per-cell indices when virtualized (Market list), `aria-selected`, `aria-sort` on
   sortable Market columns. Composite focus: exactly one cell in the tab sequence
   via roving tabindex or `aria-activedescendant`. Arrows move by cell; a LAYOUT
   grid (the bag) wraps at row ends (the WoW-like behavior); Home/End,
   Ctrl+Home/End; Enter/F2 to act, Escape back to navigation. Canvas note: the
   grid and cells need a parallel hidden DOM structure; update selection on change
   only, not per frame. Cell label is a composed `t()` string (item name + count
   via `formatNumber`).
   (https://www.w3.org/WAI/ARIA/apg/patterns/grid/)
7. Listbox (single-pick: friends, guild roster, keybind action picker, dropdown
   option lists). `role="listbox"`/`option`, `aria-label`, `aria-selected`,
   `aria-setsize`/`aria-posinset` when virtualized, roving tabindex or
   activedescendant. Up/Down move, Home/End, typeahead for 7+ options. Prefer
   listbox over grid unless a row has multiple independently focusable controls (a
   roster row with both whisper and invite buttons is arguably a grid). That
   per-list choice is OPEN.
   (https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
8. Live regions (combat log, chat, FCT, toasts). `role="log"` (implicit polite,
   non-atomic, append-only) for the combat log and chat;
   `role="status"` (implicit polite) for ambient updates; `role="alert"` (implicit
   assertive) for connection-lost/errors. POOR-FIT FLAG: a combat log emits dozens
   of lines/sec at 20Hz; do NOT mirror the raw log to a live region. Keep the
   visual log as a static `role="log"` navigable on demand, and route only salient
   events through a throttled status/alert region. FCT exposes nothing as a live
   region. Throttle policy is OPEN. ARIA mechanics correction (Verification 1):
   `role="status"` already implies `aria-live="polite"` and `aria-atomic="true"`,
   and `role="alert"` already implies `aria-live="assertive"`; do not treat the
   role and the live value as two separate requirements. Writing both is redundant
   (and on iOS VoiceOver, pairing `role="alert"` with an explicit assertive
   double-speaks).
   (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role ,
   https://www.w3.org/WAI/WCAG21/Techniques/aria/ARIA22 ,
   https://www.w3.org/WAI/ARIA/apg/patterns/alert/)
9. Meter (HP, mana/energy/rage, XP-within-level). `role="meter"`,
   `aria-valuenow`/`min`/`max`, recommended `aria-valuetext` ("4,820 / 6,000
   health" via `formatNumber`). Not focusable. Use meter (a bounded gauge), not
   progressbar. PER-FRAME NOTE: do not write valuenow/valuetext every frame; update
   at a coarse cadence (a few Hz / on threshold crossings). The canvas bar animates
   smoothly while ARIA updates discretely. Cadence OPEN.
   (https://www.w3.org/WAI/ARIA/apg/patterns/meter/)
10. Progressbar (cast bar, channel, loading/zoning). `role="progressbar"`, name,
    `aria-valuenow` only when determinate (omit entirely for indeterminate, e.g.
    "connecting"). Not focusable. Announce cast START ("Casting Fireball") and
    END/interrupt via a polite status region; do not narrate the fill. The XP-bar
    role (meter vs progressbar) is a judgment call; guidance leans meter. OPEN.
    (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/progressbar_role)
11. Slider (Options: volume, sensitivity, UI scale, camera distance).
    `role="slider"` on the focusable thumb, `aria-valuenow`/`min`/`max`, name,
    `aria-valuetext` for friendly values. Right/Up step up, Left/Down step down,
    Home/End to bounds, PageUp/Down larger step. STRONGLY prefer native
    `<input type="range">` for free semantics/keyboard/value-text; the
    dependency-light philosophy permits native elements.
    (https://www.w3.org/WAI/ARIA/apg/patterns/slider/)

Cross-cutting: every widget above (icons, bars, slots, tooltips are
canvas-drawn) needs a parallel hidden-but-focusable DOM layer or
`aria-activedescendant` against hidden nodes; this is the biggest structural
decision and is OPEN per module. All live-region, value, and activedescendant
writes happen on state change, not per frame. Whenever a modal/menu/focused
slider-or-grid is active, suppress the window-level movement/ability handlers.

---

## 4. Real-time screen-reader and focus-management model

### The canvas reality and why the DOM HUD is the win

A WebGL/canvas surface is immediate-mode pixels with no inherent accessibility
semantics, invisible to screen readers. The standard fixes are a sub-DOM mirror
or `role="img"` + label for the whole canvas. (https://www.tpgi.com/html5-canvas-sub-dom/
, https://stevefaulkner.github.io/Articles/Notes%20on%20accessibility%20of%20text%20replacement%20using%20HTML5%20canvas.html)
Do not try to make the 3D scene navigable. Give the world canvas a `role="img"`
plus a `t()` aria-label ("Game world view") so it is not an empty void, and put
all screen-reader meaning into the DOM HUD plus a small set of live regions. This
is the GAG-recommended hybrid model (accessible core surfaces + accessible
menus). (https://gameaccessibilityguidelines.com/ensure-screenreader-support-including-menus-installers/)

### Live-region architecture: one announcer, not scattered aria-live

Build a singleton Announcer (in `src/ui/`, consumes `HudContext`, strings via
`t()`). It owns a fixed set of pre-existing empty live regions created in the DOM
at startup; the region must exist before content is injected or the first message
is not announced. (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions)

Channels: a `role="log"` for combat log + chat (polite, append-only); a
`role="status"` for ambient state (target changed, HP threshold crossings,
cooldown ready, cast finished); a `role="alert"` for interrupts (being attacked,
cast interrupted, you died, disconnected, rare and high-stakes only). Default
everything to polite; reserve assertive for true emergencies (Verification 1
confirms polite = ambient non-interrupting, assertive = critical interrupting,
use sparingly). Use `aria-atomic="true"` on the status region for composite values
so the target frame reads "Wolf, 40 percent" not just "40". Use
`aria-relevant="additions removals"` on the buff/debuff region so losing a debuff
is announced.

### Throttling and coalescing combat spam (make-or-break)

Screen readers maintain a FIFO speech queue; writing 20 events/sec floods it, and
documented behavior has JAWS reading the entire accumulated queue 1500ms+ behind.
(https://github.com/FreedomScientific/standards-support/issues/782 ,
https://github.com/microsoft/vscode/issues/185371) Strategy for the 20Hz sim:
decouple from the frame loop (buffer events, flush on a ~500-1000ms interval, not
per tick); summarize rather than enumerate ("took 65 damage over 4 hits; health
55 percent"); replace, not append, in transient status regions (single direct
`textContent` assignment); wrap multi-node rebuilds in `aria-busy="true"` then
`false`; cap the pending queue (~3 items) and drop oldest, since current HP
matters and 800ms-old HP does not. (https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
, GamerAstra: https://arxiv.org/html/2506.22937v1)

### Accessibility / Reader Mode: an explicit, persisted toggle with verbosity tiers

Do not narrate full-speed combat by default. Add a Reader Mode option (persisted
like other settings) that enables the announcer channels, coalesces more
aggressively, optionally enables targeting assists, and exposes verbosity tiers
(combat: summary/off; loot: rarity only/full). Granular control is the norm:
Diablo IV ships 50+ a11y toggles, The Last of Us Part II 60+.
(https://rossminor.com/2023/06/08/diablo-iv-blind-accessibility-review/ ,
https://www.naughtydog.com/blog/the_last_of_us_part_ii_accessibility_features_detailed)
Because announcer strings are `t()` keys, SR output is localized automatically.

### Per-surface announcement plan

Target frame -> status, atomic, on target change ("name, type, health percent");
announcing enemy type so a player can prioritize is the single highest-value
combat announcement (Diablo IV's win). Player frame -> status, HP/resource only on
threshold crossings. Cast bar -> status on start, alert on interrupt; never the
fill. Cooldowns -> status, coalesced, user-selected abilities only. Buffs/debuffs
-> status with additions+removals. Chat/combat log -> the `role="log"` region.
Loot/quest -> status, with optional distinct earcons for rarity (SR users often
prefer earcons over verbose speech for frequent events).

### Two-mode input model coexisting with WASD + number hotkeys

Maintain one explicit `inputMode: 'game' | 'ui'` on `HudContext`, flipped by
window open/close and focus events, not inferred per keypress. Game mode (default)
routes Tab/1-0/WASD to the sim; UI mode (a modal opens or a text field focuses)
swallows movement/hotkey keys and lets native focus run. This mirrors the engine
"UI Only vs game input" pattern. (https://forums.unrealengine.com/t/control-ui-using-wasd-instead-of-arrow-keys/456920)

Non-negotiable guard (the #1 WASD-web bug): at the top of the global keydown
handler, bail if a text input is focused (`INPUT`/`TEXTAREA`/`isContentEditable`),
or typing "w" walks the avatar. (https://github.com/nolimits4web/swiper/issues/7665
, https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event) Bind
movement on `KeyboardEvent.code` ("KeyW"), not `.key`, so WASD auto-maps to ZQSD
on AZERTY and is layout/i18n-robust. (https://www.bram.us/2022/03/31/wasd-controls-on-the-web/)

Modal windows: prefer the native `<dialog>` element (free focus trap, Escape,
ARIA role, scroll lock). (https://12daysofweb.dev/2022/dialog/) For custom div
windows, implement focus trap (wrap Tab at edges), `aria-modal`+`role="dialog"`+
`t()` label, background `inert` (blocks all interaction, not just SR, and
conveniently stops movement keys from leaking), an Escape-stack policy (Escape
closes topmost window first; only with no windows open does Escape pause the
game), and focus restoration to the stored opener.
(https://www.uxpin.com/studio/blog/how-to-build-accessible-modals-with-focus-traps/
, https://testparty.ai/blog/modal-dialog-accessibility)

Action bars / hotbars / bag grid: roving tabindex, not `aria-activedescendant`.
The action bar is a `role="toolbar"` (`aria-label`, orientation); exactly one slot
has `tabindex="0"`, Tab moves into/out of the whole bar as one stop, arrows move
between slots, Home/End jump. Use roving tabindex because `aria-activedescendant`
is IGNORED by iOS VoiceOver and Android TalkBack (fatal given touch ships) and by
macOS Safari, and roving gets native scroll-into-view free. (https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/
, https://sarahmhigley.com/writing/activedescendant/) Collision rule: the bar's
roving DOM focusability is live only in UI mode; in game mode the bar is
presentational and 1-0 go straight to the sim. Canvas slots need a `t()`
`aria-label` ("Fireball, ready" / "Fireball, 3 seconds") and an "N of M" position
cue, updated through the dedup cache. (https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/106)
Visible `:focus-visible` ring on every focusable control, distinct from hover.

### The realistic ceiling (be honest)

Verification 1 confirms: a screen reader can deliver a meaningful but not
full-parity experience for fast real-time combat; primary guidance treats
twitch/real-time genres as the hardest case and recommends not making precise
timing essential. SR users cannot get twitch reaction parity; "a delay of just one
second" degrades the experience, and Braille is too slow for fast action. The
gold standards solve this with mechanical ASSISTS, not narration: The Last of Us
Part II's audio cues and aim assist, Forza Motorsport's Blind Driving Assist.
(https://gameaccessibilityguidelines.com/ensure-screenreader-support-including-menus-installers/
, https://www.afb.org/aw/fall2023/Blindness-Accessibility-in-Video-Games-A-Deep-Dive
, https://arxiv.org/html/2506.22937v1) MMO-correct assists to build at the
sim/`IWorld` seam: soft/auto-target (mirrors WoW Dragonflight Soft Targeting,
https://blizzardwatch.com/2022/08/25/soft-target-mode/) and directional/HP earcons
via the procedural WebAudio (what the WoW BlindSlash addon synthesizes by hand,
https://inviocean.com/communicate/blindslash-making-world-of-warcraft-playable-for-the-blind/).

Ceiling summary for the doc: menus, inventory, character/talents, social, market,
quest log -> fully accessible. Targeting, looting, casting, status awareness,
slower combat -> accessible with coalescing + assists. Reflex-gated mechanics
(interrupt-on-half-second, dodge-the-telegraph) -> not parity-accessible; mitigate
with assists and difficulty options, do not promise parity.

---

## 5. Visual design-token and theming architecture

### Token taxonomy and primitive-vs-semantic layering

The W3C Design Tokens Community Group format reached its first stable version
(2025.10) on 2025-10-28; it defines `$type` categories (color, dimension,
fontFamily, fontWeight, duration, cubicBezier, number, plus composites) and
brace-reference aliases, but is explicitly layer-agnostic: groups are arbitrary
and must not be used to infer purpose. (https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
, https://www.designtokens.org/tr/2025.10/format/) Primitive-to-semantic-to-
component layering is therefore a best practice we impose, with the load-bearing
rule "name for why, not what" at the semantic tier. (https://www.smashingmagazine.com/2024/05/naming-best-practices/
, https://medium.com/eightshapes-llc/naming-tokens-in-design-systems-9e86c7444676)

Recommended 2.5-tier model (full 3-tier is overkill for a tiny-dependency repo):
a primitive palette ramp, a semantic intent layer, and a thin set of component
tokens only where a window genuinely overrides intent. Example kebab-case CSS
custom properties:

```
/* TIER 1 PRIMITIVES (the only place raw hex/px live) */
--palette-gold-500: #ffd100;            /* currently shipped as --gold */
--palette-ink-950:  #08080d;
--size-1:0.75rem; --size-3:1rem; --size-5:1.5rem;   /* rem so zoom + scale apply */
--space-2:8px; --radius-2:8px; --duration-base:250ms;
--ease-standard:cubic-bezier(0.4,0,0.2,1);

/* TIER 2 SEMANTIC (intent; what components reference) */
--color-accent: var(--palette-gold-500);   /* keep --gold alias for back-compat */
--color-bg-surface: var(--palette-ink-950);
--color-text-default: #f0ebd8; --color-text-muted:#998d6a;
--color-resource-health/mana/rage: ...;
--color-unit-hostile/friendly: ...; --color-aura-buff/debuff: ...;
--font-display:'Cinzel',Georgia,serif;  --font-ui:'Alegreya Sans',system-ui;
--text-scale: 1;                              /* user multiplier */

/* TIER 2.5 COMPONENT (only where a window overrides) */
--quality-poor/common/uncommon/rare/epic: ...;   /* migrate QUALITY_COLOR here */
--unitframe-border: var(--color-accent);
--tooltip-bg: var(--color-bg-surface);
```

CSS custom properties are the correct mechanism: runtime-resolved (unlike Sass),
cascading, JS-readable/writable, >97% support, with `var(--x, fallback)` for safe
defaults during the hud.ts migration. (https://css-tricks.com/a-complete-guide-to-custom-properties/
, https://developer.mozilla.org/en-US/docs/Web/CSS/var)

Repo-specific highest-value change (verified): move `QUALITY_COLOR`
(`src/ui/icons.ts:1358`, the classic values poor `#9d9d9d` / common `#ffffff` /
uncommon `#1eff00` / rare `#0070dd` / epic `#a335ee`) out of JS into `--quality-*`
tokens. Today rarity color is baked into JS string concatenation in hud.ts (the
~8 `style="color:..."` / border-color sites), so a high-contrast or colorblind
theme physically cannot recolor item names without a code change. Quality color
is a DOM/CSS concern, tokenized AT the DOM sites: the canvas icon painter does
NOT read `QUALITY_COLOR` (icons.ts ~:1331 comments that the quality border lives
in CSS outside the painter, and the painter draws from PALETTES + FX glow/sparkle),
so there is no per-frame getComputedStyle to solve on the canvas. Feed the JS-built
DOM color strings through a tiny cached `readToken('--quality-epic')` helper
(`getComputedStyle(root).getPropertyValue(...)`, invalidated on theme change)
instead of re-importing the literal; the DOM color strings and the static `.q-*`
quality CSS classes then read one source of truth. Note the `.q-*` classes
currently DIVERGE from `QUALITY_COLOR` (e.g. `.q-common` is `#b8b8b8` vs the JS
map's `#ffffff`), so reconciling both surfaces onto the tokens requires a
deliberate one-value-per-tier decision (classic convention: common = white).

### Theming by token swap: default / high-contrast / colorblind, plus text-scale

Define each theme as an alternate set of SEMANTIC values selected by a
`data-theme` attribute on the HUD root (scoped, so offline/online/admin entries
can differ). Primitives stay fixed; only semantics change, so everything recolors
for free. (https://mikeaparicio.com/posts/2024-04-03-theming-design-systems/) Wire
to OS prefs so the default adapts before opt-in: `prefers-contrast` (more/less/
custom) and `forced-colors` (Windows High Contrast; respect the OS override and
drop decorative gradients rather than fight it), alongside the
`prefers-reduced-motion` already honored in 6+ places.
(https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-contrast ,
https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors)

Colorblind themes: use the Okabe-Ito / Wong palette as the primitive basis (the
de-facto scientific standard: Okabe & Ito 2008 Color Universal Design, Wong
Nature Methods 2011): Orange #E69F00, Sky Blue #56B4E9, Bluish Green #009E73,
Yellow #F0E442, Blue #0072B2, Vermillion #D55E00, Reddish Purple #CC79A7, Black
#000000. (https://davidmathlogic.com/colorblind/ ,
https://conceptviz.app/blog/okabe-ito-palette-hex-codes-complete-reference) It
avoids pure red and pure green, which is exactly the hostile/friendly and
buff/debuff pairs deuteranopes confuse: remap hostile to vermillion, friendly to
bluish-green/sky-blue. The rarity ramp (gray/green/blue/purple) is also a
red-green hazard, so design colorblind rarity tokens to differ in BRIGHTNESS, not
just hue. Crucially, never rely on color alone (WCAG 1.4.1): pair rarity with the
existing border/text label and add a shape/letter cue where rarity is the only
signal.

Text-scale falls out for free: make type sizes rem-based primitives and multiply
by `--text-scale` (e.g. `calc(var(--size-3) * var(--text-scale))`, or scale the
root font-size). Use rem/px, never vw, for type, since viewport units do not
scale with zoom and fail WCAG 1.4.4. (https://www.smashingmagazine.com/2023/11/addressing-accessibility-concerns-fluid-type/)
This is a real nuance vs the existing `src/ui/CLAUDE.md` advice to prefer
width:100%+max-width over viewport units: good for layout, but TYPE must use rem
so the multiplier and zoom both work. Set `--text-scale` once on theme/option
change; never recompute per frame.

Contrast target: ship WCAG 2.1/2.2 AA (>=4.5:1 body, >=3:1 large) as the gate;
use APCA (the WCAG 3 candidate, better at dark-UI thin text) only as an advisory
check, since APCA is not yet a standard and its WCAG 3 inclusion is uncertain.
(https://git.apcacontrast.com/documentation/APCAeasyIntro.html) OPEN: verify the
shipped default pair `--color-text-muted: #998d6a` on `--color-bg-surface:
#08080d` against 4.5:1 with a real checker; muted-on-dark is the classic failure
spot.

### Classic-fantasy aesthetic, done procedurally

What makes WoW's UI iconic: parchment/scrolls, gryphons, thick ornamental borders,
gold trim, and diegetic framing (the silver-drake frame for rare-elite mobs), so
ornament reads as visual storytelling rather than chrome. (https://indieklem.com/12-what-you-can-learn-from-the-ui-design-of-world-of-warcraft/)
The WoW texture atlas is public for studying the visual LANGUAGE only (do not ship
Blizzard art; regenerate your own): https://github.com/Gethe/wow-ui-textures .
`src/ui/CLAUDE.md` already states the target (verified): premium dark-fantasy
(deep darks, gold-brown accents, rich borders), avoid browser-chrome looks.

Achievable with CSS + the existing procedural canvas, no new deps: gold trim and
ornamental frames via layered border + inset box-shadow + linear-gradient bevels
(generalize the existing scrollbar-thumb treatment into `--frame-trim`/
`--frame-bevel`/`--elevation-window`); parchment as a procedural warm fill +
subtle gradient/noise + inner shadow (`--surface-parchment` for QuestLog/Spellbook
bodies while combat surfaces stay dark); gryphon/heraldry crests drawn on canvas
(icons.ts already has a `'crest'` kind) used as action-bar end-caps and
unit-frame flourishes; Cinzel display type for titles, Alegreya Sans body. For
legibility over the varying-brightness 3D scene, combine a thin dark
`-webkit-text-stroke` with a soft dark `text-shadow` contrast halo and
`paint-order: stroke fill`, always with a text-shadow fallback; tokenize as
`--text-outline`/`--text-stroke` so high-contrast mode thickens them.
(https://blog.1byte.com/css-text-outline/) Because all of this is semantic tokens,
high-contrast and colorblind themes flatten the gold gradients to solid
high-luminance fills and drop parchment noise automatically; under
`forced-colors: active` decorations drop and system colors take over. The
aesthetic layer and the accessibility substrate are the same layer.

---

## 6. Mobile / touch UX and accessibility

Verified gap to fix first: `index.html` line 5 ships
`maximum-scale=1.0, minimum-scale=1.0, user-scalable=no` (confirmed). This blocks
pinch-zoom (the primary low-vision affordance on mobile web) and is a WCAG 1.4.4 /
1.4.10 violation. Removing the scale locks is necessary but NOT sufficient: page
pinch-zoom over the HUD is ALSO killed by CSS `touch-action: none` applied at the
page level (`body.game-active` at `index.html:220` and `body.mobile-touch #ui` at
`:3829`, where `#ui` is the full-screen HUD overlay), so the meta change alone does
not restore HUD pinch. The fix must relax `touch-action: none` on those page/HUD
rules WHILE KEEPING `touch-action: none` on `#game-canvas` (`:3828`); the camera
pinch/swipe-look listeners are bound to `#game-canvas` directly
(`mobile_controls.ts:194-209`), so the in-game camera is unaffected and pinch over
HUD/menus then zooms the page. Re-test that canvas camera pinch still works after
the page-level relax. (https://www.boia.org/blog/web-accessibility-tips-dont-disable-zooming-yes-even-on-mobile)

Target sizing (tiers, by surface, not blanket): WCAG 2.5.8 floor is 24x24 CSS px
with the spacing exception (20x20 + >=4px gaps conform). (https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
Apple HIG is 44x44pt; Material 3 is 48x48dp with >=8dp spacing (the icon may be
smaller inside a padded 48dp hit area). (https://developer.apple.com/design/tips/
, https://m3.material.io/foundations/designing/structure) Recommendation: primary
phone game controls (action-bar slots, joysticks, cast-interrupt, modal close)
target a 48px HIT area (expand the hit area with padding, not the procedural icon);
desktop-density windows that also render on touch bump rows/cells to >=44px under
the existing `PHONE_TOUCH_QUERY` (verified at `mobile_controls.ts:3`); use the
24px+spacing exception deliberately only for genuinely dense bag/auction grids;
>=8px between adjacent controls everywhere. This sits above the repo's existing
>=40x40 mandate.

Safe areas: `viewport-fit=cover` is present and correct (verified), but pair it
with `env(safe-area-inset-*)` everywhere fixed UI touches an edge; only one modal
uses it today (verified at `mobile_controls.ts:248`). Insets are zero on
non-notched devices, so apply unconditionally with a fallback second arg
(`max(12px, env(safe-area-inset-bottom))`). The bottom home indicator (~34px)
overlaps the action bar/joysticks; the notch/Dynamic Island (~59px) and rounded
corners affect unit frames, minimap, chat. (https://developer.mozilla.org/en-US/docs/Web/CSS/env
, https://polypane.app/blog/using-safe-area-inset-to-build-mobile-safe-layouts/)

Reachability and handedness (Hoober, 1,333 users: 49% one-handed, 75% thumb-driven,
of one-handers 67% right-thumb): natural zone = bottom third + corners (keep the
dual joysticks low); stretch zone = mid/sides (bag/menu toggles); hard zone = top
edge (glanceable only: unit frames, minimap, buffs). (https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php
, https://www.smashingmagazine.com/2016/09/the-thumb-zone-designing-for-mobile-users/)
Because right-thumb dominance is only 67%, add a left/right-handed MIRROR toggle in
Options (swap move vs camera joystick sides, flip the action-bar/menu cluster),
persisted in `src/game/settings.ts`; cheap given the modular components, and a real
win for the ~33% left-thumb and one-handed-either-side play.

Gestures: WCAG 2.5.1 (any path/multi-point gesture needs a single-pointer
alternative) hits the pinch-to-zoom camera (`mobile_controls.ts:440-459`, verified)
- add zoom +/- buttons. WCAG 2.5.7 (every drag has a single-pointer no-drag path)
hits the HTML5 drag-and-drop in hud.ts (action-bar slot reassignment at
`hud.ts:1349,1368`, item moves, window dragging): add tap-to-pick-then-tap-to-place
for slots and items, "Move to..." context menu entries, map pan/recenter buttons or
window snap presets, and tap-anywhere-on-track for sliders.
(https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) The existing
`src/ui/touch_peek.ts` already disambiguates long-press (peek) from tap and swallows
the synthetic click; keep it, make the hold threshold a named, exposable constant
(longer for motor-impaired users), ensure long-press is never the only path to an
action, and add a ~10px move threshold before a press converts to a drag/pan so
tremor does not cause accidental drags.

Mobile screen-reader reality: VoiceOver and TalkBack are gesture-driven (swipe to
move focus, double-tap to activate, rotor) and read the OS accessibility tree, not
a keyboard. (https://knowbility.org/programs/accessu-2020/mobile-web-accessibility-with-voiceover-and-talkback)
The DOM HUD overlay is the entire accessible surface, and hud.ts already labels
buttons with `t()` aria-labels and uses `.visually-hidden` text (verified pattern
to standardize per module). Do NOT use `role="application"` to grab gestures; it
is effectively unsupported on mobile SRs and will not give a "game mode."
(https://cerovac.com/a11y/2024/03/aria-roleapplication-and-mobile-screen-readers/)
`aria-pressed` needs an explicit `role="button"` on mobile. Use sparing
`aria-live` for a few high-signal events (level up, quest complete, you died,
connection lost), never per-frame FCT. Extend the hot-write dedup cache to aria
attributes so an `aria-label` is re-`setAttribute`-ed only on actual value change.
Realistic mobile scope (honest): full real-time combat is not SR-playable; the
achievable target is making the windows (Spellbook, Talents, QuestLog, Character,
Options, Social, Bags, Market, Trade, vendor/loot, modal prompts) navigable.

Text scaling on mobile web: remove the viewport scale locks (above), author the
type scale in rem/em not px so OS/browser scaling has something to act on (Firefox
for Android scales px and rem; Chrome scales relative units; iOS Safari has no
per-page text preference and does not scale web px/rem from OS Larger Text by
default). The one iOS hook that ties web text to Dynamic Type is the
`font: -apple-system-body` trick, captured into a custom property and used as a
scale factor; iOS-Safari-only, and the exact calc pattern is OPEN (verify
on-device). (https://www.tpgi.com/text-resizing-web-pages-ios-using-dynamic-type/)
Design for ~200% text: menu/window text reflows and panels scroll; in-combat
overlay (FCT, unit-frame numbers) can stay fixed-scale since it is not body text.
Keep tooltip/quest/chat body >=16px (1rem); numbers already route through
`formatNumber`/`formatMoney`/`Intl`.

---

## 7. Reference: what AAA MMOs / WoW actually ship (north star)

WoW added a dedicated Accessibility section in the ESC menu in Dragonflight, split
into General, Colorblind Mode, and Text-to-Speech. (https://us.support.blizzard.com/en/article/000362342)
The feature catalog below was independently checked by Verification 2, which
CONFIRMED all six headline features exist today, with corrections on history and
scope (folded in):

- Colorblind Mode: three filter presets (protanopia, deuteranopia, tritanopia) via
  a dropdown, each with a strength slider; NOT new (added in Patch 6.1, 2015), and
  there is a separate UI Colorblind Mode that adds text labels.
  (https://news.blizzard.com/en-us/article/17964863/new-colorblind-support-in-patch-61)
- UI Scale: native checkbox + slider in System > Graphics. (Verification 2)
- Edit Mode (Patch 10.0.0, 2022-10-25, date precise): natively move/resize/show/
  hide nearly all HUD frames (action bars 1-8, unit/party/raid/boss frames,
  minimap, cast bar, objective tracker), with named, saved, copyable, importable
  layout profiles. This is the single most important structural feature WoW
  shipped; it turned "move my unit frames" from an addon requirement into base UI.
  (https://warcraft.wiki.gg/wiki/Edit_Mode)
- Nameplate customization: native but BASIC (Always Show, Larger, enemy/friendly
  toggles, stacking, flash on aggro loss, scale); per-unit styling / debuff
  tracking still needs addons like Plater. (https://warcraft.wiki.gg/wiki/Nameplate)
- Full keybind remapping: native Key Bindings menu, per-character or per-account.
- Click-to-cast: native Click Casting and Unit Frame Mouseover Casting added in
  Dragonflight (10.0), but the built-in version binds spells only to MOUSE buttons
  with modifiers; keyboard click-cast still needs the Clique addon. (Verification 2)

Other shipped WoW accessibility features: camera-shake toggle and adjustable camera
speed; Click to Move; Press and Hold Casting and Empowered Spell Input
alternatives; Interact Key with an audio proximity Sound Cue; Text-to-Speech for
chat (multiple voices/languages/speed); Soft Targeting (auto-target the centered
enemy, explicitly framed for players who struggle with tab-target). Known gap: WoW
cinematic subtitles are NOT customizable. (https://www.gameaccessibilitynexus.com/blog/2022/10/26/world-of-warcraft-dragonflight-accessibility-impressions/
, https://blizzardwatch.com/2022/08/25/soft-target-mode/)

Why addons still exist (the gaps to close natively, since this repo owns the whole
UI): Edit Mode moves only a fixed set of frames; WeakAuras exists because the base
UI cannot express arbitrary "show graphic X when buff/cooldown/resource" logic; and
granular click-cast binding profiles (Clique) remain addon territory. The takeaway:
ship a built-in Edit-Mode-style layout editor and a flexible buff/cooldown alert
system natively, closing exactly the gaps that force WoW players to install addons.
(https://blizzardwatch.com/2025/03/18/addon-features-blizzard-consider-adding-warcraft-base-ui/
, https://www.curseforge.com/wow/addons/weakauras-2)

Prioritized GAG-tiered feature list for this repo (abbreviated; full mapping in
Section 8 alignment):
- BASIC: full keybind remap incl. window toggles; global UI Scale + independent
  font-size; colorblind-safe defaults (no essential state by fixed color alone);
  >=4.5:1 contrast; readable default font; no essential info by sound alone (each
  procedural WebAudio cue gets a HUD visual twin); separate volume sliders;
  photosensitivity safety (a flash = 10% luminance change, avoid 3+/sec); large
  well-spaced touch targets; saved settings.
- INTERMEDIATE: Edit-Mode-style layout editor (the marquee feature, rides the
  modular seam); reduced-motion master + granular sub-toggles; cursor/crosshair
  size/color; click-to-move + native click/mouseover casting; press-and-hold
  alternatives; customizable captions (beat WoW's gap); who-is-speaking in chat.
- ADVANCED: screen-reader support across HUD/menus with state enumeration
  ("slider, 52%"); chat TTS; named layout profiles; soft-target + directional
  earcons. (https://gameaccessibilityguidelines.com/full-list/ ,
  https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/106)

---

## 8. Mapping to this repo's constraints

- i18n (`t()` for every new aria/label string in every locale): every new
  `aria-label`, `aria-valuetext`, `title`, `alt`, `placeholder`, menu item, tab
  label, toast/alert/status/log content, TTS string, theme name, and toggle label
  is a `t()` key added to `en` first (`src/ui/i18n.en.ts`) and rendered via `t()`.
  Per the project contributor policy an English-only PR is legal; the maintainer
  batch-fills all locales at release. Numbers/money/percents in any value-text go
  through `formatNumber`/`formatMoney`/`Intl`, never string concatenation. The
  accessible name behind any decorative glyph is still a `t()` key.
- Procedural canvas icons: icons/bars/slots/tooltips are drawn to canvas and are
  invisible to AT. Every widget needs a parallel hidden-but-focusable DOM host (or
  `aria-activedescendant` against hidden nodes) carrying the role + `t()` name +
  state. Quality color specifically is a DOM/CSS concern: the canvas icon painter
  does NOT read `QUALITY_COLOR` (the quality border lives in CSS outside the
  painter), so the migrated `--quality-*` tokens are the one source of truth for
  the DOM color strings and the `.q-*` classes, read via a cached `readToken()`
  helper rather than re-imported JS literals. Any other canvas tint that genuinely
  reads a JS color may use the same cached `readToken()`.
- 20Hz per-frame budget with hot-write dedup: the sim ticks at a fixed 20Hz; the
  HUD updates per animation frame through a hot-write dedup cache, so per-frame
  cost matters. Accessibility/theme settings (scale, contrast, reduced motion,
  theme, `--text-scale`) are read once into `HudContext` and applied as CSS
  variables / cached state, set only on change. Live-region writes,
  `aria-valuenow`/`valuetext`, `aria-activedescendant`, and every `aria-label`
  update happen on STATE CHANGE only (extend the dedup cache to aria attributes);
  meter/cast-bar ARIA updates at a coarse cadence while the canvas animates
  smoothly; reduced-motion must actually SKIP the per-frame FCT/shake work, not
  just hide it; the per-frame path writes values and never calls
  `getComputedStyle`.
- The modular `HudContext` seam: each per-window module owns its responsive reflow
  (1.4.10), focus scope and restoration (2.4.3/2.4.11), ARIA semantics (4.1.2),
  and live-region wiring (4.1.3); shared helpers centralize the input-mode gate,
  the modal focus-trap/inert/Escape-stack, the announcer singleton, the
  reduced-motion gate, and the contrast/theme tokens. Layout position/scale state
  for the Edit-Mode editor is added to `HudContext` and persisted as profiles.
- No new framework: native `<dialog>` and `<input type="range">` are preferred for
  free semantics; everything else is hand-built DOM + CSS custom properties +
  procedural canvas, consistent with the tiny-dependency philosophy. CSS custom
  properties (runtime, cascading, >97% support) are the theming substrate.
- No em dashes / no emojis: enforced throughout this brief and required of all new
  strings and copy; emojis may not stand in for a required translation, and the
  aria name behind any symbol is still a `t()` key. (Distinct from the separate "no
  raw emojis as in-game icons" aesthetic rule.)

Implementation order (each step independently testable and behavior-preserving for
non-AT users): (1) input-mode gate + text-input guard + `event.code` movement; (2)
remove the viewport scale locks + add `env(safe-area-inset-*)`; (3) token
promotion (primitive/semantic split, migrate `QUALITY_COLOR`, `readToken` helper);
(4) roving-tabindex toolbar for the action bar, then bag grid, with `t()` slot
labels; (5) shared modal focus-trap/inert/Escape-stack/focus-restore helper; (6)
single-pointer alternatives for every drag + pinch-zoom; (7) announcer singleton +
live regions + coalescing behind Reader Mode; (8) theme swap (high-contrast +
colorblind) + text-scale; (9) assists: soft-target + directional/HP earcons; (10)
Edit-Mode-style layout editor + profiles.

---

## 9. OPEN items and proposed locked-with-easy-override defaults

### OPEN (need verification, design, or a credential/human decision before authoring)

- Canvas-vs-DOM accessibility tree: parallel hidden DOM layer vs
  `aria-activedescendant` against hidden nodes, decided per widget. This is the
  biggest structural decision (roving tabindex is the recommended default given
  mobile-SR support, but per-window exceptions need a call).
- Live-region coalescing interval and queue cap (suggested ~500-1000ms, ~3 items)
  are not empirically derived; need playtesting with NVDA/JAWS/VoiceOver under live
  combat, since SR queue behavior diverges per engine.
- Which combat/cooldown/loot events are salient enough to announce, and the
  default verbosity tiers.
- Tooltip exposure for screen readers: `aria-describedby` text vs an on-demand
  "inspect item" `role="dialog"` for the densest tooltips (the dialog is most
  robust but changes the interaction).
- World canvas: static `role="img"` label vs a periodically updated scene summary
  - a UX judgment call to validate with blind testers.
- XP-bar ARIA role: meter vs progressbar.
- Radial emote-wheel key mapping (no APG radial pattern exists; adapting the menu
  pattern).
- Contrast verification of shipped default pairs, especially
  `--color-text-muted #998d6a` on `--color-bg-surface #08080d` (run a real
  checker; muted-on-dark is the classic failure spot).
- iOS `-apple-system-body` Dynamic Type calc pattern: verify on-device (the deeper
  TPGi article was inaccessible during research).
- Final colorblind theme hex values: derive from Okabe-Ito but verify each remapped
  signal pair in a simulator against the actual scene backgrounds.
- WCAG 1.4.10 Reflow exception wording for the world-canvas/minimap exemption:
  confirm against the Reflow Understanding doc before any formal conformance claim.
- CVAA confirmation: the FCC consumer-guide page was unreachable; facts are
  corroborated by other FCC pages but the guide itself was not directly read.
- XAG 111/113/115 exact current titles: inferred, not confirmed verbatim.

### Proposed locked-with-easy-override defaults (override any of these on request)

- Accessibility tier: WCAG 2.2 AA is the conformance bar (up from the 2.1 AA
  already in `src/ui/CLAUDE.md`); AAA criteria (1.4.6 enhanced contrast, 2.5.5
  44px, 2.4.12 focus fully unobscured, 2.3.3 animation) treated as advisory or
  best-effort. CVAA accessibility of the chat/comms surface is a hard floor, not a
  tier.
- Screen-reader scope: menus and windows fully accessible; combat accessible via
  coalescing + assists; reflex-gated mechanics not promised at parity. SR features
  ship behind an explicit, persisted Reader Mode with verbosity tiers.
- Visual direction: premium classic-fantasy (deep darks, gold-brown accent on the
  existing `--gold`, Cinzel display + Alegreya Sans body, procedural parchment and
  crest flourishes), evoked entirely with CSS + the existing procedural canvas and
  no new dependencies, re-baselined deliberately on the modular components.
- Token model: 2.5-tier (primitive / semantic / thin component), CSS custom
  properties, `data-theme` swap on the HUD root, themes = default / high-contrast /
  colorblind (Okabe-Ito derived), plus a `--text-scale` multiplier; `QUALITY_COLOR`
  migrated to `--quality-*` tokens.
- Mobile: remove the viewport scale locks; 48px primary touch hit areas; full
  `env(safe-area-inset-*)`; single-pointer alternative for every drag and the
  pinch-zoom; left/right-handed mirror toggle; rem-based type scaling to ~200%.

---

File written to:
/Users/fernando/Documents/world-of-claudecraft/docs/hud-ux-and-accessibility/research-brief.md
