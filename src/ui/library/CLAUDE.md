# src/ui/library: the interface primitive library

The one set of reusable chrome primitives every HUD surface and window composes.
It has two halves and one rule.

- **Tokens** live in `src/styles/tokens.css` (static values, sizes, radii, durations,
  composites) and `src/ui/theme.ts` (the preset-aware derivations `themeCssVars` emits).
  Every color, size, radius and duration a primitive uses is named there once.
- **Primitive classes** live in `src/styles/library.css` under `@layer library`, between
  `layout` and `components` in the `src/styles/index.css` order, so a component section
  in `hud.css` or `components.css` can still tune a primitive for its host.
- **The rule: new UI composes these primitives.** A new window, panel, frame, bar, button,
  chip or control starts from the matching `ui-*` family (or adds a documented variant to
  it here and in `library.css`), never from a bespoke recipe. A component section may set
  layout and host-specific geometry on a primitive; it never re-declares the primitive's
  colors, edges or shadows, and it never spells a raw color (the ratchet in
  `tests/css_raw_color_ratchet.test.ts` fails the sheet).

Behavioural primitives keep the repo's pure-core plus thin-painter shape (`src/ui/CLAUDE.md`):
a `*_view.ts` / `*_core.ts` decides, a `*_painter.ts` / `*_window.ts` paints through the
`PainterHost` writers and toggles the state classes below by name.

## Guards
- `tests/ui_library.test.ts`: the selector manifest below and `library.css` agree both
  ways; the layer wrapper; the quality tokens equal `QUALITY_COLOR`; the theme derivations
  reproduce the static defaults for the classic preset and clear AA on every preset.
- `tests/css_raw_color_ratchet.test.ts`: `library.css` carries zero raw color literals;
  every other sheet has a ratcheting ceiling; tokenized sections are pinned at zero.
- `tests/css_token_resolution.test.ts`: every `var()` the library reads is declared.

## Primitives, their tokens, their states

| Family | Classes | Tokens | States / variants |
|---|---|---|---|
| Type helpers | `.ui-cin` `.ui-num` `.ui-outline` `.ui-h` `.ui-meta` `.ui-muted` `.ui-faint` `.ui-soft` | `--font-display` `--title-shadow` `--outline-shadow` `--color-accent` `--color-text-muted` `--color-text-faint` `--color-text-secondary` | |
| Surfaces | `.ui-panel` `.ui-panel-soft` `.ui-panel-strong` `.ui-window` `.ui-well` `.ui-card` `.ui-card-tile` `.ui-divider` `.ui-pill` | `--panel-bg` `--panel-bg-soft` `--panel-bg-strong` `--border` `--color-keyline` `--radius-panel` `--radius-window` `--radius-card` `--shadow-panel` `--shadow-window` `--shadow-well` `--color-bg-input` `--color-card-hi` `--color-card-lo` `--color-ink-deep` `--color-text-on-ink` `--color-text-on-ink-soft` | `button.ui-card:hover` / `.ui-card[role="button"]:hover` (an actionable card only) |
| Window head | `.ui-win-head` `.ui-win-title` `.ui-win-sub` `.ui-win-art` `.ui-win-actions` `.ui-x-btn` | `--win-head-h` `--color-panel-hi` `--panel-base` `--color-border-showcase` `--color-glint` `--color-chrome-glyph` `--color-chrome-ground` `--radius-xs` | `:hover` `:focus-visible` |
| Window shell | `.ui-win-body` `.ui-win-foot` | `--window-pad` `--spacing-sm` `--color-border-showcase` | `.ui-window:has(> .ui-win-body)` (the window becomes a column: head, optional tabs, ONE scrolling body, optional pinned foot; its open path sets `display: flex`) |
| Buttons | `.ui-btn` `.ui-icon-btn` `.ui-disc` | `--btn-h` `--btn-h-lg` `--icon-btn-w` `--icon-btn-h` `--micro-btn-w` `--micro-btn-h` `--disc-size` `--socket-fill` `--color-socket-rim` `--btn-fill-gold` `--btn-fill-red` `--btn-fill-selected` `--color-btn-red-border` `--color-control-border` `--shadow-lift` `--glow-gold-soft` `--radius-card` `--color-text-on-red` `--color-text-on-gold-btn` `--color-text-on-medal` | `.ui-btn--lg` `.ui-btn--gold` `.ui-btn--red` `.ui-btn--on` `.ui-btn--dis` `.ui-btn--plate` (+ `.is-off`) `[aria-pressed="true"]` `:disabled` `.ui-icon-btn--micro` `.ui-icon-btn.is-on` |
| Keycap and badge | `.ui-keycap` `.ui-badge` | `--keycap-h` `--keycap-min-w` `--badge-size` `--color-ink` `--color-text-on-ink-soft` `--color-danger` `--color-glint` `--radius-xs` | `.ui-keycap--round` `.ui-badge--corner` |
| Bars | `.ui-bar` `.ui-bar-fill` `.ui-bar-text` | `--bar-h` `--color-bar-track` `--bar-gloss` `--radius-2xs` `--bar-color` | `.ui-bar--hp` `.ui-bar--mana` `.ui-bar--rage` `.ui-bar--energy` `.ui-bar--focus` |
| Bevel bar | `.ui-bevel` `.ui-bevel-fill` `.ui-bevel-ticks` `.ui-bevel-edge` `.ui-bevel-text` | `--bar-h-hp` `--bar-h-res` `--bar-h-res-empty` `--bar-notch` `--bar-well-fill` `--bar-color` | `.ui-bevel--mirror` `.ui-bevel--res` `.ui-bevel--res.is-empty` |
| Name ribbon | `.ui-ribbon` `.ui-ribbon-tag` | `--ribbon-bg` `--bar-notch` `--gold-dim` `--color-accent` | `.ui-ribbon--mirror` `.ui-ribbon--hostile` `.ui-ribbon--friendly` |
| Cast ribbon | `.ui-cast` `.ui-cast-fill` `.ui-cast-edge` `.ui-cast-icon` `.ui-cast-label` `.ui-cast-timer` | `--castbar-w` `--castbar-h` `--castbar-point` `--color-cast-track` `--castbar-fill` `--castbar-fill-hostile` `--castbar-fill-channel` `--castbar-fill-consume` | `.ui-cast--hostile` `.ui-cast--channel` `.ui-cast--consume` |
| XP rail | `.ui-rail` `.ui-rail-fill` `.ui-rail-rested` `.ui-rail-ticks` `.ui-rail-label` | `--action-rail-w` `--xp-rail-h` `--xp-fill` `--xp-rested-fill` `--color-xp` `--gold-dim` | |
| Socket | `.ui-socket` `.ui-socket-art` `.ui-socket-key` `.ui-socket-count` `.ui-socket-cd` `.ui-socket-cd-text` | `--socket-size` `--socket-size-bag` `--socket-size-bank` `--socket-size-stance` `--socket-size-stance-coarse` `--socket-gap` `--socket-row-gap` `--socket-art-inset` `--radius-socket` `--color-socket-rim` `--socket-fill` `--socket-fill-empty` `--shadow-socket` `--glow-gold` `--color-proc-rim` `--color-proc-glow` `--color-text-on-ink-soft` `--cd-fill` | `.ui-socket--bag` `.ui-socket--bank` `.ui-socket--stance` `.ui-socket.is-empty` `.ui-socket.is-used` `.ui-socket.is-on` `.ui-socket.is-proc` `.ui-socket.is-oor` `.ui-socket.is-unusable` |
| Aura chip | `.ui-aura` `.ui-aura-art` `.ui-aura-time` | `--aura-size` `--aura-size-own` `--color-socket-rim` `--color-ink` `--radius-sm` `--color-hostile` | `.ui-aura--own` `.ui-aura--debuff` `.ui-aura-time--debuff` |
| Portrait | `.ui-portrait-wrap` `.ui-portrait` `.ui-medal` `.ui-combat-badge` | `--portrait-size` `--level-chip-size` `--border` `--color-hostile-rim` `--color-portrait-hi` `--color-portrait-lo` `--medal-fill` `--color-text-on-medal` `--gold-dim` `--color-combat-badge-ground` | `.ui-portrait--hostile` `.ui-medal--right` `.ui-medal--stud` `.ui-combat-badge--left` |
| Tabs | `.ui-tabs` `.ui-tab` `.ui-seg` `.ui-seg-tab` | `--tab-h` `--color-tab-on-hi` `--color-tab-on-lo` `--color-tab-off-hi` `--color-tab-off-lo` `--color-tab-off-border` `--color-text-on-tab-on` `--radius-card` `--radius-sm` | `[aria-selected="true"]` `.is-on` `.ui-tab--add` |
| Form controls | `.ui-input` `.ui-check` `.ui-toggle` `.ui-toggle-thumb` `.ui-range` `.ui-range-fill` `.ui-range-thumb` `.ui-stat-row` | `--input-h` `--toggle-w` `--toggle-h` `--range-h` `--range-thumb` `--stat-row-h` `--color-bg-input` `--color-border-showcase` `--color-control-border` `--color-medal-hi` `--color-gold-700` `--color-text-on-ink` `--dur-fast` | `[aria-checked="true"]` `.is-on` |
| Chips and money | `.ui-chip` `.ui-money` `.ui-money-coin` | `--radius-pill` `--btn-fill-selected` `--color-text-secondary` `--color-text-on-medal` | `.ui-chip.is-on` `[aria-pressed="true"]` `button.ui-chip:hover` / `.ui-chip[role="button"]:hover` |

Themed versus static (DESIGN.md 4.1): `theme.ts` re-emits per preset every token that
can touch a themed surface (`--color-text-secondary`, `--color-text-faint`, `--color-info`,
`--color-warning`, `--color-socket-hi`, `--color-panel-hi`, `--color-glint`,
`--color-control-border`, `--panel-bg-soft`, `--panel-bg-strong`); `tokens.css` carries
their classic outputs. The static tokens are dark chrome that stays dark on every preset
(`--color-socket-rim` on HUD sockets, discs and keycaps, `--color-ink`, the medal, the
bar wells, the cast and swing tracks). **A fixed-dark surface takes a FIXED light
foreground**, never a derived text or accent token: the `--color-text-on-*` family
(`-ink`, `-ink-soft`, `-red`, `-gold-btn`, `-medal`, `-tab-on`) is declared in
`tokens.css`, is never re-emitted by `theme.ts`, and every pair is asserted at AA
across `PRESET_ORDER` by `LIBRARY_CONTRAST_PAIRS` in `tests/ui_library.test.ts`.
Pairing a derived foreground with a fixed surface reads dark-on-dark under
Parchment, which is what the pinned table exists to refuse. Decorative glows ride `--fx-shadow`; the state
rims, the out-of-range and unusable filters, the cooldown sweep and every badge count are
actionable and never sit behind a tier or a theme. Quality tokens paint rims and borders
only (rare and epic fail the text tier; `--mkt-name-*` is the text family).

Deliberate collapses (one token per role, DESIGN.md 4.1): the boards' near-duplicate warm
greys (`#e8d9b0`, `#b9ad86`, `#b6a472`, `#95886a`, `#8f8a76`) all read as
`--color-text-secondary`, `--color-text-muted` or `--color-text-faint`; the two dark grounds
`#06060a` and `#0b0b10` are one `--color-ink-deep`; the disc gradient's `#14141d` stop is
`--panel-base`.

## Requested variants (host rules today, candidates for the library)

Each surface below wanted a primitive variant the library does not carry; the slice built it
with the closest primitive plus a host-scoped geometry rule and named the variant it wanted.
Add one when a third consumer appears (rule of three), never for a single site:

- `ui-socket--pet` (36px) and a round `ui-socket--round` species taking `--ui-socket-size`
  (the mobile ring, petals and strip items restate the round recipe).
- `ui-keycap--tab` (trapezoid `clip-path` with an `is-armed` gold fill: the cross hotbar
  trigger tabs) and `ui-keycap--pad-a/b/x/y` (or a `--pad-color` knob on `ui-keycap--round`).
- `ui-badge--gold` (the quest acceptance-order chip) and `ui-badge--micro` (a corner badge
  sized for a 34x30 launcher).
- `ui-chip--gold`, `ui-chip--art` (`height: auto` around a crest or icon) and a fixed-plate
  chip that floats over the world and stays preset independent (the Steam wishlist chip).
- `ui-seg--column` (vertical rails need `flex: 0 0 auto` per tab), `ui-card--on` (an earned
  or completed plate), `ui-btn--xs` (a 20px square toggle), `ui-disc--rim` (compact minimap
  satellites), an opacity-aware `ui-panel-soft` that multiplies a player-controlled alpha
  (chat), and a flat compact `ui-panel` raid-cell variant.

## Selector manifest
Machine-read by `tests/ui_library.test.ts`: every `ui-*` class declared in `library.css`
appears here and every line here is declared there. Compound state selectors are listed
as written in the sheet.

```text
.ui-aura
.ui-aura--debuff
.ui-aura--own
.ui-aura-art
.ui-aura-time
.ui-aura-time--debuff
.ui-badge
.ui-badge--corner
.ui-bar
.ui-bar--energy
.ui-bar--focus
.ui-bar--hp
.ui-bar--mana
.ui-bar--rage
.ui-bar-fill
.ui-bar-text
.ui-bevel
.ui-bevel--mirror
.ui-bevel--res
.ui-bevel--res.is-empty
.ui-bevel-edge
.ui-bevel-fill
.ui-bevel-text
.ui-bevel-ticks
.ui-btn
.ui-btn--dis
.ui-btn--gold
.ui-btn--lg
.ui-btn--on
.ui-btn--plate
.ui-btn--plate.is-off
.ui-btn--red
.ui-card
.ui-card-tile
.ui-cast
.ui-cast--channel
.ui-cast--consume
.ui-cast--hostile
.ui-cast-edge
.ui-cast-fill
.ui-cast-icon
.ui-cast-label
.ui-cast-timer
.ui-check
.ui-chip
.ui-chip.is-on
.ui-cin
.ui-combat-badge
.ui-combat-badge--left
.ui-disc
.ui-divider
.ui-faint
.ui-h
.ui-icon-btn
.ui-icon-btn--micro
.ui-icon-btn.is-on
.ui-input
.ui-keycap
.ui-keycap--round
.ui-medal
.ui-medal--right
.ui-medal--stud
.ui-meta
.ui-money
.ui-money-coin
.ui-muted
.ui-num
.ui-outline
.ui-panel
.ui-panel-soft
.ui-panel-strong
.ui-pill
.ui-portrait
.ui-portrait--hostile
.ui-portrait-wrap
.ui-rail
.ui-rail-fill
.ui-rail-label
.ui-rail-rested
.ui-rail-ticks
.ui-range
.ui-range-fill
.ui-range-thumb
.ui-ribbon
.ui-ribbon--friendly
.ui-ribbon--hostile
.ui-ribbon--mirror
.ui-ribbon-tag
.ui-seg
.ui-seg-tab
.ui-seg-tab.is-on
.ui-socket
.ui-socket--bag
.ui-socket--bank
.ui-socket--stance
.ui-socket-art
.ui-socket-cd
.ui-socket-cd-text
.ui-socket-count
.ui-socket-key
.ui-socket.empty
.ui-socket.is-empty
.ui-socket.is-on
.ui-socket.is-oor
.ui-socket.is-proc
.ui-socket.is-unusable
.ui-socket.is-used
.ui-socket.oor
.ui-socket.proc
.ui-socket.unusable
.ui-socket.used
.ui-soft
.ui-stat-row
.ui-tab
.ui-tab--add
.ui-tab.is-on
.ui-tabs
.ui-toggle
.ui-toggle-thumb
.ui-toggle.is-on
.ui-well
.ui-win-actions
.ui-win-art
.ui-win-body
.ui-win-foot
.ui-win-head
.ui-win-sub
.ui-win-title
.ui-window
.ui-x-btn
```
