# World of ClaudeCraft Design Language

**Status:** Adopted standard. The redesign boards and the two reference images in
section 2 are approved references. Precedence is this document, then the redesign boards,
then the images.
**Scope:** The desktop game client (the `index.html` and `play.html` entries). Because
mobile is the same client consuming the same `src/styles/tokens.css` and `src/ui/theme.ts`,
the token, theme, and typography phases restyle mobile on day one and owe mobile
screenshots; only mobile-specific LAYOUT work is deferred to its own program. Every change
still owes the mobile-coverage decisions in section 13.5.
**Updated:** 2026-09-07.

This document is the source of truth for how World of ClaudeCraft's interface should look,
move, and feel. It pairs the approved design references (section 2) with the systems this
repo already has: the token and theme engine, the painter families, the fairness, i18n,
accessibility, and performance contracts. Where this document and the current code
disagree, this document states the target; section 13 states the contracts that constrain
how you get there. Where this document and a committed guard test disagree, fix the
disagreement in the same change or do not land the change. The cited files, symbols, and
guard tests are the live anchors: when in doubt, verify against them.

We are building an incredibly beautiful classic MMORPG. The interface should feel forged,
painted, and slightly magical: a crafted fantasy artifact floating over a warm, cozy world,
never a web dashboard wearing a fantasy skin.

**How to use this document.** To build or restyle any piece of interface (whether you are
an engineer or an AI assistant): take every color, font, radius, spacing value, and
duration from the named tokens in sections 4, 5, and 11, never a raw value; find the
surface's specification in section 7 (HUD) or section 8 (windows) and its building blocks
in section 10; apply the motion rules of section 11 and the accessibility rules of
section 12; verify against the engineering contracts and guard tests of section 13.
Worked example, restyling the chat panel: section 7.10 is the spec; `--panel-bg`,
`--color-text-faint`, and the themed accent variables come from section 4; the tab strip
and form controls come from sections 10.2 and 10.7; type from 5.3; and the perf, i18n,
and CSS-discipline contracts from 13.2 to 13.4 gate the change.

---

## 1. Design principles

1. **World first.** The 3D world is the hero. Permanent UI hugs the screen edges, uses
   controlled translucency, and never parks opaque chrome over the central play area. At a
   standard desktop viewport, the central 52 percent of width and 58 percent of height stay
   free of permanent opaque UI.
2. **Classic structure, modern clarity.** Party frames, unit frames, action bar, minimap,
   tracker, chat: everything sits where a classic-MMO player expects it, with cleaner
   spacing and stronger hierarchy than a legacy HUD.
3. **Crafted fantasy, not glass UI.** Avoid generic flat cards, neon gradients, heavy blur,
   pill buttons, and mobile-app styling. Surfaces read as midnight blue-black metal and
   parchment, edged in bronze and gold.
4. **Gold is structural.** Gold defines edges, selection, rewards, and hierarchy. It never
   fills large surfaces. Most of the interface is blue-black ink and parchment; bright
   saturated yellow belongs to quest markers and reward moments (`--color-quest`), never
   to chrome.
5. **One system on every screen.** HUD panels, windows, tooltips, dialogs, the store, the
   Book of Deeds, and the options menu all share the same surfaces, edges, type, spacing,
   and interaction states. No one-off panel styles.
6. **Clarity beats ornament.** When more decoration and more readability conflict,
   readability wins. The interface feels premium through disciplined color, proportion,
   typography, and feedback, not through decoration density.
7. **Fair by construction.** Nothing in this design may hide or delay actionable gameplay
   information behind a graphics tier, a theme, or a cosmetic state (section 13.1).
8. **Performance is part of beauty.** The interface must look incredible AND hold a steady
   frame rate on every supported graphics tier and device class. Decoration is built to be
   shed: cosmetic richness rides the effects tiers, actionable information never does, and
   the low tier is a first-class design target, not a degraded afterthought (sections 4.4,
   11, 13.1, and 13.2).

## 2. Reference images and precedence

The approved reference set comprises the redesign boards and two committed images:

1. The approved redesign board set: the interface-redesign canvas
   (https://claude.ai/code/artifact/7cfa983d-7f1a-45c6-b773-1b56e59ab510, five pages:
   Redesign, HUD surfaces, More windows, Controller, Current client). Its shipped form is
   recorded by the before/after captures under `docs/screenshots/interface-redesign/`.
   The board sources are design tooling and are not committed.
2. `docs/design/design-language/desktop-style-reference.png`: the reference for color,
   typography, translucency, gold edges, icon treatment, unit frames, chat, minimap, and
   overall finish quality where the boards do not supersede it.
3. `docs/design/design-language/desktop-approved-layout-reference.png`: the reference for
   broad desktop composition and spacing where the boards do not supersede it.

Precedence when details conflict:

1. This document.
2. The redesign boards, including their pixel renders.
3. The two reference images, each within its role above.
4. Standard MMORPG usability conventions.

The boards define composition, component geometry, materiality, and finish. Text, values,
shortcuts, and icons within the boards and images are illustrative only; the shipped
interface always uses real game data, live keybinds (`src/game/keybinds.ts`), approved
assets, and the English catalog values behind their `t()` keys (any reword of an existing
key is an explicit catalog change with its M16 obligations, section 13.3).

All measurements in this document are authored CSS pixels at `--ui-scale` 1 on a
1080p-class desktop viewport; the shipped HUD scales through the existing
`zoom: var(--ui-scale)` mechanism on `#ui` (`src/ui/ui_scale.ts`, `UI_SCALE_MIN` to
`UI_SCALE_MAX`). Do not introduce a second scaling system. Supported desktop behavior:

| Viewport | Behavior |
|---|---|
| 1920 x 1080 and larger | Reference layout; players scale up via `uiScale` |
| 1600 x 900 to 1920 x 1080 | Reference layout at scale 1 |
| 1366 x 768 to 1600 x 900 | Compact: shorter chat, tighter right-rail spacing (the existing short-viewport rules on the rail are the precedent) |
| Below 1280 x 720 | Not a tuned desktop target; the HUD must remain functional but is not layout-optimized |

## 3. The non-negotiable visual signature

Every major UI surface carries all four traits:

1. **Blue-black translucent fill.** A cool midnight surface: never pure black, never bright
   navy, and the world stays faintly visible through standard panels.
2. **Fine gold edge.** A one-pixel antique-gold border between a dark outer keyline and a
   faint warm inner highlight. Never a thick solid yellow border.
3. **Warm parchment text.** Primary text is cream parchment, not pure white. Pure white is
   reserved for tiny highlights and high-value numerics.
4. **Layered depth.** A restrained drop shadow, a subtle inner top highlight, and a soft
   inner vignette. Dimensional, never glossy.

The current `.panel` chrome in `src/styles/base.css` already has this structure (border plus
black outline plus inset highlight plus inset vignette); this program retunes its values, it
does not invent a new mechanism.

## 4. Color

### 4.1 How color flows (read this before touching a hex)

Color in the game client has exactly one home: the `--color-*` / `--fx-*` custom properties
in `src/styles/tokens.css`, consumed through `var()` in CSS and through cached
`getComputedStyle` reads in the 2D canvas painters. Painters never hard-code a hex in TS
(per-painter source-scan tests). On top of the tokens sits the runtime theme engine:
`src/ui/theme.ts` (`THEME_PRESETS`, `PresetId`, `themeCssVars`) recomputes the accent,
border, panel, text, and resource variables per preset and per player customization, with
WCAG contrast repair (`resolveTheme`, the `ensureReadable` pass). Three consequences:

- A surface color that should follow theme presets must flow through a `ThemeKnob` or a
  `themeCssVars` derivation; a hex written only into `tokens.css` will be overwritten or
  ignored once a preset applies.
- **The themed/static split is a hard rule.** Any color used for text, borders on themed
  surfaces, focus indication, or interaction states is PRESET-AWARE: it must be produced
  (and contrast-repaired) by `themeCssVars`. Static tokens may only paint things that stay
  dark on every preset: modal backdrops, inset wells, keylines, icon-frame interiors, and
  canvas decoration. The light `parchment` preset is the acid test: a static gold or gray
  that vanishes on its light panel is a bug this rule exists to prevent.
- Every preset must keep `tests/theme.test.ts` green: 4.5:1 body text, 3:1 large text and
  accents, on the preset's own panel color. That suite also literally pins the shipped
  palette derivations (the "reproduces the shipped gold palette" cases), so the phase that
  changes knobs re-pins those cases in the same change.

Design tokens exist so a value is stated once, given a name, and referenced everywhere.
The rules that keep it that way:

- Raw color values live in exactly two files: `src/styles/tokens.css` (static tokens and
  seeds) and `src/ui/theme.ts` (preset knobs and derivations). Everywhere else, color is
  consumed BY NAME: `var(--color-quest)` in stylesheets, the cached `getComputedStyle`
  read in 2D canvas painters, and CSS-variable writes from painters.
- Never repeat a value to approximate a token, and never introduce a second name for an
  existing role. If a needed color has no token, add one with a SEMANTIC name (what it is
  for, not what it looks like) and a comment naming its consumer, then reference it.
- Component CSS composes tokens; it never defines palette. A hex literal in `hud.css`,
  `components.css`, or a painter is a defect (the per-painter source scans enforce the
  painter half).
- The same discipline applies to every other design value: fonts, radii, spacing, and
  durations are consumed through their tokens (sections 5, 8.1, and 11), so a system-wide
  retune is always a one-file change.

The palette below is therefore expressed as: the `classic` preset knob values (4.2),
themed derivations with their classic outputs (4.3), and genuinely static ramp tokens
(4.3). The `midnight`, `parchment`, and `highContrast` presets keep their identities and
are retuned only as far as the contrast tests require.

### 4.2 The classic preset (the nine theme knobs)

| Knob | Value | Note |
|---|---|---|
| `accent` | `#ffd100` | Shipped gold for titles, selected states, and primary accent. |
| `border` | `#6f5a2a` | Shipped bronze frame border. |
| `panel` | `#15151f` | Shipped charcoal-blue panel base. |
| `text` | `#f0ebd8` | Shipped parchment primary text. |
| `textMuted` | `#998d6a` | Shipped muted parchment. |
| `hp` | `#1eb838` | Shipped health green. |
| `mana` | `#2b7bd4` | Shipped resource blue. |
| `rage` | `#c0392b` | Classic rage red. |
| `energy` | `#e4c531` | Classic energy yellow. |

These are the shipped knobs reproduced by the `classic` preset in `THEME_PRESETS`.
`themeCssVars` derives `--gold-dim` as `#c7a300`. The proposed antique-gold retune is
withdrawn.

### 4.3 Ramp tokens and themed derivations

**Static ink ramp** (dark chrome depths; legitimately preset-invariant because backdrops,
wells, and keylines stay dark even on light presets):

| Token | Value | Use |
|---|---|---|
| `--color-ink-1000` | `#04090d` | Deepest shadow, modal backdrop base |
| `--color-ink-950` | `#071117` | Inset well floor |
| `--color-ink-900` | `#0b171e` | Elevated well floor |
| `--color-ink-850` | `#10212a` | Dark hover step inside wells |
| `--color-ink-800` | `#172b35` | Inner bevel inside wells |

**Static gold ramp** (decoration on guaranteed-dark ground only: icon-frame bevels, edge
glints inside the dark panel gradient, canvas-painted ornament; never text, never borders
on themed surfaces, never focus):

| Token | Value |
|---|---|
| `--color-gold-900` | `#4a2f10` |
| `--color-gold-800` | `#6b4517` |
| `--color-gold-700` | `#926321` |
| `--color-gold-600` | `#bc8732` |
| `--color-gold-500` | `#d8a645` |
| `--color-gold-400` | `#f0c86d` |
| `--color-gold-300` | `#ffe5a3` |

**Themed derivations** (produced by `themeCssVars` from the knobs, contrast-repaired per
preset; the values shown are the classic outputs):

| Variable | Classic output | Derivation intent | Use |
|---|---|---|---|
| `--color-text-secondary` | `#e0dac4` | text mixed toward `textMuted` | Secondary text |
| `--color-text-faint` | `#897f61` | `textMuted` mixed toward `panel` | Timestamps and metadata |
| `--panel-bg-soft` | `rgba(21, 21, 31, 0.74)` to `rgba(12, 12, 17, 0.74)` | standard panel gradient at 0.74 alpha | Tracker and chat at rest |
| `--panel-bg-strong` | `rgba(16, 16, 24, 0.97)` to `rgba(9, 9, 13, 0.97)` | panel pulled toward black at 0.97 alpha | Tooltips, text inputs, confirm dialogs |

`--color-accent-hover` and `--color-accent-glint` are not emitted variables. Interactive
gold uses the emitted accent variables. Decorative glints use the themed `--color-glint`,
which `themeCssVars` derives from the accent per preset (classic `#ffea8c`). The existing emitted
`--color-border-focus` remains the focus ring color.

**Semantic state colors** (static seeds in `tokens.css`; `themeCssVars` contrast-repairs
any of them used as text against the preset panel, the same `ensureReadable` treatment the
accent already gets):

| Token | Value | Use |
|---|---|---|
| `--color-info` | `#45c9ff` | Informational text and markers |
| `--color-quest` | `#ffd12d` | Quest markers, tracked quest titles |
| `--color-warning` | `#ff9d32` | Warning state |
| `--color-danger` | `#e74c3c` | Destructive and critical fills (error text stays `--color-text-error`) |
| `--color-success` | `var(--color-text-success)` | Successful and complete states |
| `--color-xp` | `#b85eff` | Experience fill light stop |
| `--color-xp-deep` | `#6a1bb0` | Experience fill deep stop |
| `--color-xp-rested` | `#5fb0ff` | Rested experience fill light stop |
| `--color-xp-rested-deep` | `#2b6fd0` | Rested experience fill deep stop |

Existing tokens that keep their jobs: `--color-text-error` `#ff8f85`, `--color-text-success`
`#7fdc4f`, the `--color-debuff-*` school tints, the `--color-map-*` / `--color-minimap-*` /
`--color-delve-*` canvas families, `--scrollbar-track`. The scrollbar thumb and border
colors are theme-derived (`themeCssVars` overwrites `--scrollbar-thumb`,
`--scrollbar-thumb-hover`, `--scrollbar-border` from the border knob), so their retune in
section 10.7 lands in the `theme.ts` derivation constants, not in `tokens.css`.

Classic `#ffd100` remains the gold title and accent color. Quest yellow remains the
separate `--color-quest` (`#ffd12d`) and keeps its map and minimap marker lineage.

`--panel-border` must stay undeclared. Surfaces consume `--border` through the shared
primitive recipes instead of creating a parallel alias.

Spacing stays on the existing `--spacing-*` scale and `--window-pad` (12px); this program
adds no parallel spacing system. Dense HUD rows may use tighter literal padding (6 to 8px)
where the scale has no step; that is a deliberate, narrow exception.

Untouchable color families (classic fidelity anchors, do not restyle):

- Item quality: `QUALITY_COLOR` in `src/ui/icons.ts` and the `.q-*` classes in
  `src/styles/components.css` (poor gray through legendary orange).
- Class colors: `ClassDef.color` in `src/sim/content/classes.ts`, surfaced as the `--cls`
  custom property on party rows and as `classColor` in the canvas painters.

### 4.4 Surfaces

Panel fill is the themed gradient `--panel-bg`, derived by `themeCssVars` from the `panel`
knob. The classic preset runs from `rgba(21, 21, 31, 0.95)` to
`rgba(12, 12, 17, 0.95)`. Surface alpha is part of the emitted variables in
`src/ui/theme.ts`, not per-component CSS:

| Surface | Fill | Alpha target |
|---|---|---:|
| Standard panel / window | `--panel-bg` | 0.95 |
| Objective tracker | `--panel-bg-soft` | 0.74 |
| Chat, idle | `--panel-bg-soft`, composed with the user's `--chat-opacity` | 0.74 x user setting |
| Chat, focused or hovered | `--panel-bg`, composed with the user's `--chat-opacity` | 0.95 x user setting |
| Tooltip, text input, confirm dialog | `--panel-bg-strong` | 0.97 |
| Modal backdrop | `--color-ink-1000` | 0.55 to 0.65 |

The chat idle/focus distinction is new behavior: implement it as a separate state variable
that MULTIPLIES the user's `chatOpacity` setting; the setting's meaning and default do not
change (section 12).

Backdrop blur is an opt-in enhancement (`body.frosted-panels`, the
`frostedPanels` setting), dropped wholesale on the low effects tier by the
`:root[data-fx-level="low"]` rule in `tokens.css`. The default look must be fully legible
with zero blur; never rely on blur for text contrast. Budget: at most six simultaneously
blurred surfaces, and nested controls never add their own `backdrop-filter` on top of a
blurred parent. Every `backdrop-filter` keeps its `-webkit-` twin adjacent
(`tests/backdrop_filter_survival.test.ts`).

### 4.5 The gold edge recipe

The shipped standard edge is three layers, composed by the surface primitives in
`src/styles/library.css`:

1. A one-pixel `--color-keyline` outline.
2. A one-pixel `--border` structural border.
3. The inset `--edge-glint` highlight, 16 percent of the themed `--color-glint`.

Panels take their drop shadow and inner vignette from `--shadow-panel`. Windows add the
double ring in `--shadow-window`: a two-pixel `--color-window-ring` (`#2a2214`) ring and a
three-pixel keyline. Sockets use `--shadow-socket`. Component CSS composes these named
shadows and does not restate their layers.

### 4.6 Glow discipline

Glows are reserved for: claimable rewards, selected or proc'd action slots, quest markers,
and short feedback moments. A glow is `0 0 12px` to `0 0 14px` of the relevant accent at
0.25 to 0.42 alpha, pulsing at most twice per second, and every decorative pulse rides
`--motion-scale` and the reduced-motion kills (section 11.4). The talents button's
unspent-points pulse (`.has-points`) is the existing exemplar of a justified glow.

## 5. Typography

### 5.1 Families

The interface uses the three shipped faces already named in `src/styles/tokens.css`:

| Token | Family and weights | Role |
|---|---|---|
| `--font-display` | `"Cinzel"` 400 to 700 | Window and panel titles, unit names, tab labels, button labels, zone names, banners |
| `--font-ui` | `"Alegreya Sans"` 400, 500, 700 | Body, chat, values, metadata |
| `--font-serif` | `"Alegreya"` 400 (plus italic) | Quest and lore prose |

Cinzel stays the display face. Its shared recipe uses 0.5px letter spacing and
`--title-shadow` (`1px 1px 2px` over `--color-keyline`). Alegreya Sans carries no 600 cut;
UI emphasis weights are 500 and 700 only. `--font-label` and `--font-brand` are not part
of this system. Never introduce a blackletter or another decorative medieval face.

### 5.2 Self-host the fonts

The game entries currently load Google Fonts from the CDN; the guide already self-hosts the
same families from `public/fonts/` with subset `@font-face` rules (`src/guide/styles.css`).
Moving the game entries to the same pattern remains future work, outside the coordinated
interface delivery:

- Audit the Cinzel, Alegreya Sans, and Alegreya weights used by the game, add any missing
  subsets to `public/fonts/` through the existing subset pipeline, and add the attribution
  row to `CREDITS.md` following the existing guide-webfonts row format.
- Land the `@font-face` rules as a new `fonts.css` module in the `src/styles/` barrel
  (update the pinned import order in `tests/styles_extraction.test.ts` and the section
  manifest in `tests/css_corpus.test.ts` in the same change); preload only the two
  above-the-fold faces from each entry, exactly like `guide.html` does.
- Remove the CDN `<link>`s from `index.html` and `play.html`, and trim the now-unused
  Google Fonts origins from the desktop CSP (`electron/shell_guards.cjs` and its pinned
  `tests/electron_shell_guards.test.ts`) in the same change.

`font-display: swap` everywhere; no visible fallback flash after load is an acceptance
criterion (section 16).

### 5.3 Scale

Reference sizes in authored CSS pixels at `--ui-scale` 1 (the floor is pre-zoom: a player
who chooses a sub-1 `uiScale` accepts proportionally smaller rendering). Authored body text
never goes below 12px; compress spacing before shrinking type.

| Style | Font | Size / line | Weight | Use |
|---|---|---:|---:|---|
| Window title | Cinzel | 16 / 22 | 700 | `.ui-win-title` |
| Panel title | Cinzel | 15 / 20 | 700 | HUD module titles |
| Section heading | Cinzel | 13 / 18 | 700 | `.ui-h`, grouped window content |
| Unit name | Cinzel | 13 / 16 | 700 | Player, target, party names, with 0.6px tracking |
| Tab and button label | Cinzel | 12 / 16 | 700 | `.ui-tab`, `.ui-seg-tab`, `.ui-btn` |
| Body | Alegreya Sans | 14 / 19 | 400 to 500 | Chat, descriptions, rows |
| Quest prose | Alegreya | 12.5 / 19 | 400 | Quest and lore paragraphs |
| Metadata | Alegreya Sans | 12 / 15 | 500 | Timestamps, subtitles, coords |
| Keycap | Alegreya Sans | 9 to 10 / 12 | 700 | Keybind chips |
| Nameplate | Cinzel | 13 / 15 | 700 | Outlined world names |

### 5.4 Text rules

- Primary text `var(--color-text-light)`, secondary `--color-text-secondary`, muted
  `--color-text-muted`, metadata `--color-text-faint`.
- Interactive gold text uses `--color-accent`; tracked quest titles use
  `--color-quest`; informational lines use `--color-info` (both contrast-repaired per
  preset, section 4.3).
- Panel and window titles are gold in `--font-display`, with 0.5px tracking and
  `--title-shadow`. Tab labels, button labels, and unit names use the same display recipe.
- HUD labels over the world keep the existing outline treatment (`--text-outline-color`
  halo, `body.high-contrast-text` strengthens it). Nameplates keep their four-way outline.
- Names on frames and nameplates render in Cinzel, not a separate small-caps face.
- Every number a player reads (health, resource, money, timers, XP, quest progress) goes
  through the i18n formatters (`formatNumber`, `formatMoney`, `formatDateTime` in
  `src/ui/i18n.ts`) and renders with `font-variant-numeric: tabular-nums`.
- Capitalization: title case for window titles, buttons, and quest titles; sentence case
  for descriptions and system status; never full-uppercase paragraphs. Display
  capitalization comes from the catalog copy, not `text-transform` on body copy.
- Every player-visible string in every mock and spec below is an English catalog value
  behind a `t()` key (section 13.3). None of them is ever hard-coded.

## 6. Iconography

The two-half icon system stays; this program raises its finish, it does not replace it.

- **Painted icons** (abilities, items, auras, crests): the procedural recipe compositor in
  `src/ui/icons.ts` (`iconDataUrl`) with the curated WebP override sets
  (`ABILITY_IMAGE_IDS` and `ITEM_IMAGE_IDS` in `icons.ts`, `DEED_IMAGE_IDS` in
  `src/ui/deed_image_ids.ts`; converters `npm run assets:skills` / `assets:items` /
  `assets:deeds`; gates `tests/skill_icons.test.ts`, `tests/item_icons.test.ts`,
  `tests/deed_icons.test.ts`). The compositor's painted-classic rules live in
  `docs/design/icon-system.md`: light from top-left, baked bevel frame, seeded speck noise,
  quality border in CSS outside the bevel.
  Inventory paintings additionally follow the canonical, versioned
  `docs/design/item-icon-art-style.md` contract (`woc-item-icon-v1`). It owns item-family
  composition, approved
  references, the reusable generation brief, master and shipping rules, small-size review, and
  provenance for every bag, bank, vendor, equipment, loot, mail, and tooltip item image.
- **Vector chrome glyphs** (menus, panel controls, status markers): the inline-SVG registry
  in `src/ui/ui_icons.ts` (`svgIcon`, monochrome, `fill: currentColor`). These inherit the
  themed accent from CSS `color` and are the only sanctioned thin-line icons; they serve
  secondary controls (close, collapse, zoom, filters, settings), never primary
  destinations.

Rules:

- Primary destinations (micro-menu buttons, the Daily Rewards chest, window headers) get
  painted art with recognizable silhouettes, warm highlights, and a consistent
  three-quarter or front-facing perspective.
- **The quality bar decides the source.** Draw an icon procedurally ONLY when the recipe
  hits the painted-icon bar completely: correct silhouette, lighting, materials, and a
  clean read at every rendered size. If a recipe cannot get all the way there, do not
  ship a compromise: use curated image art instead (WebP under `public/ui/` via the
  matching converter script, with a `CREDITS.md` row), and raise the art request with the
  design team the moment the gap is known so the asset exists before the coordinated
  delivery. The keyword fallback compositor remains as runtime safety for unknown ids,
  never as the shipped look for a known surface.
- Every interactive painted icon sits inside a dark inset frame with a bronze edge; the art
  never touches the border. Action sockets and micro-menu buttons take their inset from the
  shared `.ui-socket-art` and `.ui-icon-btn` recipes.
- One lighting direction, one perspective, one saturation range per panel. Never mix flat
  vector, emoji, and painted icons in the same surface. Raw emojis are never icons
  (`src/ui/CLAUDE.md`); an emoji standing in for a label still needs its real `t()` text.
- Sizes are set where the component is specced (sections 7 and 10); the pipeline facts:
  procedural master canvas at `DEFAULT_ICON_SIZE`, WebP art served at 128px square.

## 7. Desktop HUD layout

### 7.1 Composition

```text
+--------------------------------------------------------------------+
| Party frames                        Auras | Minimap cluster        |
|                                           | Objective tracker      |
|                                                                    |
|                          GAME WORLD                                |
|                  (nameplates, quest markers)                       |
|                                           | Daily Rewards chest    |
|                                                                    |
|                       Interaction prompt                           |
| Chat panel            Player | Target frames    Micro menu         |
|                       XP rail + action bars     Utility row        |
+--------------------------------------------------------------------+
```

Default HUD inset from the viewport edges: 12px. Anchor summary at `--ui-scale` 1
(existing element ids in parentheses; sizes are targets, offsets may flex up to 8px for
content and safe areas, hierarchy may not):

| Component | Anchor | Target size | Element |
|---|---|---|---|
| Party frames | top left | rows 170px wide | `#party-frames` |
| Chat panel | bottom left | `--chat-w` 370px | `#chatlog-wrap` |
| Player auras | top right, left of minimap | 28px chips, wrapping | `#buff-bar`, `#debuff-bar` |
| Minimap cluster | top right | shipped disc composition | `#minimap-wrap` |
| Objective tracker | below minimap | text only, no plate | `#right-tracker-stack` |
| Daily Rewards | above micro menu | chest beacon with count badge | `#daily-rewards-button` |
| Micro menu | bottom right | two columns of 34 x 30 buttons | `#side-buttons` |
| Utility row | below micro menu | four compact buttons | `#community-hud` |
| Interaction prompt | bottom center, above frames | 30px pill | static root in both game entries |
| Player + target frames | bottom-center pair | plateless mirrored frames | `#player-frame`, `#target-frame` |
| XP rail + action bars | bottom center | `--action-rail-w` 596px | `#actionbar-stack` |

Unit frames, action bars, and the quest tracker do not gain backing plates. The proposed
3 x 2 launcher and More hub are not part of this composition.

A full disposition inventory of every current HUD surface is in section 17.

### 7.2 Player and target frames

The player and target frames form a plateless bottom-center pair above the action stack:
player left, target mirrored right. Both remain movable and lockable through the existing
`MovableFrame` family (`src/ui/movable_frame.ts`, persisted by
`src/ui/target_frame_pos.ts`); changing the defaults is a one-time `LAYOUT_RESET_EPOCH`
bump in `src/ui/frame_pos_reset.ts`. The `below-target` shift on party frames retires with
the move.

Frame anatomy (the `unit_frame.ts` + `unit_frame_painter.ts` family, both instances):

- A 60px `.ui-portrait` disc with the live GLB headshot
  (`src/render/characters/portrait.ts`) painted by `unit_portrait_painter.ts`.
- A 24px `.ui-medal` overlaps the portrait. Elite targets add their elite art at the
  portrait, and the player's in-combat state uses `.ui-combat-badge`.
- A heraldic notched `.ui-ribbon` carries the 13px bold Cinzel unit name. The target
  ribbon mirrors the player ribbon.
- A 16px `.ui-bevel` health bar and an 11px resource bar. A resource bar without text
  compresses to 7px. Fill colors stay on the theme resource knobs.
- The player's own debuffs sit under the target at 30px, using `.ui-aura--own` with a gold
  rim. Other target debuffs keep their normal school-tinted treatment.
- Combat, rest, low-health, and low-resource states keep their existing hooks
  (`#pf-combat`, `#pf-rest`, `low_health.ts` vignette, `low_resource.ts`); restyle the
  visuals, do not change the signals. Health changes interpolate about 150ms with instant
  numerics; healing flashes warm-white, damage flashes a red edge; below 25 percent health
  the frame (not the whole screen) carries a restrained danger pulse alongside the existing
  vignette.

Cast bars sit outside the frame body as double-pointed `.ui-cast` ribbons. The standard
bar is 300 x 20; the hostile red variant is 236px wide. The target frame appears and
disappears without shifting the action bar (fade plus 98 to 100 percent scale over
`--dur-frame`). Hostile targets use the hostile ribbon treatment; friendly targets keep
the friendly treatment.

### 7.3 Party frames

Party rows (the third `UnitFramePainter` consumer: `party_frames.ts`, `party_frame_row.ts`,
`party_frames_painter.ts`) are 170px plated rows under a `Party N` header with a collapse
chevron.

- Each row has a class-colored 30px crest ring, a Cinzel name, a 9px health bar, and a 5px
  resource bar.
- Existing dead, offline, out-of-range, leader, targeted, aura, and ready-check states stay
  readable. The targeted row takes the gold selected edge; out-of-range and disconnected
  rows mute without removing health information.
- Party frames are deliberately never tiered (section 13.1); raid sorting and the 100-yard
  range model stay as implemented.

### 7.4 Action bars and XP

The bottom stack keeps its structure: primary bar (12 slots, `Digit1` through `Equal`),
optional secondary bar (`showSecondaryActionBar`), optional third bar
(`showThirdActionBar`, available while the secondary bar is visible), consumable slots,
and the pet bar when a pet is out. All of it stays on the `ActionBarPainter` family with
hotbar drag-and-drop and no backing plate.

- Sockets are 46px (`--socket-size`) on a 4px gap (`--socket-gap`), with rows 6px apart
  (`--socket-row-gap`). The socket's own key chip sits at the top left; stack count stays
  bottom right.
- Page chevrons and the row number sit outside the right edge. ACCEPTED DEVIATION: the
  boards hung a cluster of round 30px stance sockets off the left edge; the shipped row is
  40px square stance sockets seated inside the bottom stack above the primary bar, so showing
  it lifts the player frame (and, via `body.stance-bar-shown`, the stock target seat) by one
  row instead of floating beside the bar. The pet command bar takes the same seat (both rows
  stack when a class has both), and the pet frame sits above the player frame, flush with its
  left edge at 0.8 of its scale, since a pet's bars carry less a player acts on. The paladin's
  Devotion medallion keeps its stock centre seat on desktop, steps down to 72px on short
  viewports and 56px on touch, and in pad mode becomes the cross hotbar's keystone: the halves part by a
  socket and the medallion seats in the centre column between the set pips and the set-swap
  chip, at 60px with its label and charge pips folded away (never lost: devotion is
  information the player acts on).
- States (existing states, restyle only): ready, hover, pressed, cooldown sweep plus
  remaining seconds, `.is-used` proc glow, `.is-oor` out-of-range tint,
  `.is-unusable` desaturation, queued, `.is-empty`, and drop target.
- Cooldown text: whole seconds under a minute, compact `1m` style above (formatter-driven).
- XP is a quiet bronze `.ui-rail` exactly as wide as the twelve sockets:
  `--action-rail-w` 596px by `--xp-rail-h` 10px. It carries twenty ticks, a rested segment,
  and a numeric caption such as `4,650 / 8,000`, formatted through `formatNumber`. It has
  no medallion. Post-cap the rail keeps its overflow-XP behavior (`showOverflowXp`).

### 7.5 Player auras (buffs and debuffs)

`#buff-bar` and `#debuff-bar` keep their top-right anchor immediately left of the minimap
cluster. The `aurasOnPlayerFrame` setting (reparenting the buff bar onto the player frame)
stays supported.

- Chips are 28px `.ui-aura` primitives with timers and stack badges. Buffs and debuffs are
  separated by an 8px gap.
- Debuff chips keep their per-school tinted borders (`--color-debuff-*` via `data-school`):
  that tint is actionable dispel/school information, identical on every tier.
- Duration text sits below the chip in metadata type; stack badges use `.ui-badge`.
- The tier knobs governing aura refresh cadence and buff-overflow shedding stay exactly as
  audited (debuffs are never culled; `src/game/ui_tier_knobs.ts`, section 13.1).

### 7.6 Minimap cluster (top right)

Keep the shipped `#minimap-wrap` composition: the map disc has a conic bronze bezel, the
mail and raid-lock discs hug the ring, and the clock medallion sits under it. The compass
is a masked strip; coordinates sit in their own chip. Zone name uses the display face;
clock and coordinates use the existing `formatClockTime` and `formatMinimapCoords` paths.

- The cached terrain canvas in `src/ui/minimap_painter.ts` and its redraw-interval tier
  knob stay intact. The player arrow remains high-contrast at every zoom.
- The shipped zoom controls and day or night control are retained by rule, even though the
  redesign boards omit them. Restyle them as compact `.ui-disc` controls.
- Marker colors stay in the `--color-minimap-*` token family; quest markers stay vivid
  (`--color-quest` lineage), party pips stay class-colored.

### 7.7 Daily Rewards chest beacon

The rewards entry (`#daily-rewards-button`) stays the shipped chest beacon above the micro
menu. It uses the existing `/ui/daily-rewards/` art and a `.ui-badge` count when rewards
are claimable.

- Claimable: the chest gains the restrained reward glow and shows the count. It never
  pulses during combat.
- Claimed or idle: no glow; the chest remains the entry point to
  `src/ui/daily_rewards_window.ts` and its store surfaces.
- The gates to preserve: the `dailyRewardsEnabled` flag in the HUD features wiring (set
  from the native-app check in `src/main.ts`) and the `showDailyRewardsChest` setting,
  both applied in `src/ui/hud.ts`.

The card rebuild is withdrawn. The web store promo card (`src/ui/store_promo_card.ts`,
`shouldShowStorePromo`) is outside this redesign and stays unchanged.

### 7.8 Objective tracker

`#right-tracker-stack` keeps the quest tracker, deed watch, and delve tracker on the right
edge. The quest tracker is text only, with no plate. Its header reads `Quests N` and keeps
the collapse chevron.

- Quests keep 1-based gold numbered chips matching the world map badges.
- In-progress objectives use primary or secondary parchment with right-aligned tabular
  progress. Complete objectives use `--color-success`; unavailable or deferred objective
  rows use the muted text role.
- Clicking a title opens the quest log entry. Collapse stays immediate during combat.

### 7.9 Micro menu rail

The existing `#side-buttons` rail stays at the bottom right. It is a two-column rail of
34 x 30 `.ui-icon-btn--micro` buttons, with live `.ui-keycap` labels, `.ui-badge`
notifications, and a gold selected ring while the destination window is open. Existing
destinations and keybinds remain available.

The proposed 3 x 2 launcher tile grid and the More hub are withdrawn. The micro menu does
not become a card or a full-height backing rail.

### 7.10 Chat

`#chatlog-wrap` keeps its bottom-left anchor, tab model (built-in Chat and Combat Log plus
player channel tabs from `src/ui/hud/chat/chat_channels.ts`), movable and resizable behavior
(`src/ui/hud/chat/chat_window.ts`), and live-region semantics. Target styling and behavior:

- Tab strip in the shared `.ui-tabs` and `.ui-tab` style, with unread badges on inactive
  tabs and the plus tab for player channel creation.
- An idle/focus state (new): idle chat rests at the soft fill; focus or hover brings it
  to standard fill; idle lines gently fade after a quiet period. All of it composes
  multiplicatively with the user's `chatOpacity` and respects reduced motion.
- Message text at 14/19 `--font-ui` with `--chat-font-scale` intact; timestamps in
  `--color-text-faint`; system lines in the themed accent; whispers, guild, and channels
  keep their channel colors; player names keep class colors where shown.
- Input: the existing dynamic per-channel placeholder stays (`hud.core.chatPlaceholder`
  and the channel-aware swap in `src/ui/hud.ts`); any copy reword is a catalog change with
  M16 fills, decided at implementation time. Strong fill when focused, themed focus
  border.
- Optional (new, low priority): aggregate identical consecutive system and combat lines
  with a count suffix; needs its own `t()` key and design review before building.

### 7.11 Utility row (bottom right)

`#community-hud` stays the compact row directly below `#side-buttons` and keeps exactly
what ships: the Steam wishlist chip (on the fixed preset-independent plate tokens, since it
floats over the world) and the tray toggle, now a `.ui-disc` with the more-dots glyph. The
board's four-button variant (sound, music, wiki, fullscreen) is withdrawn: the client has no
sound or fullscreen control in the HUD, music and wiki remain micro menu launchers, and the
GitHub, Donate and Discord links were removed by owner request (their absence is pinned by
`tests/client_shell.test.ts`).

### 7.12 Interaction prompt (new component)

A bottom-center 30px `.ui-pill` above the unit frames: a round `.ui-keycap--round`, a verb,
and a highlighted target name ("Speak with Apothecary Lin"). Candidate resolution is
extracted into `src/game/nearby_interaction.ts`, shared by the key handler and prompt core;
the click-pick router remains `src/game/interactions.ts`.

- The prompt is a HOT painter on the medium cadence band. Candidate proximity changes with
  movement, so it paints through the elided writers inside the standing perf budget
  (`tests/hud_perf_budget.test.ts`).
- Its root is static markup in both `index.html` and `play.html`; the painter updates that
  one shared shape instead of minting a per-frame subtree.
- Shows only when the interact key would currently do something: keycap (live binding, or
  the controller glyph from `GAMEPAD_BUTTON_LABELS_BY_KIND` when a pad is active), a
  localized verb key per interaction kind (talk, loot, open, gather, mail, bank), and the
  target name via `tEntity`, highlighted in the accent.
- One prompt at a time; fade in about 120ms, out about 90ms; never covers the unit frames;
  hold-style interactions may ring the keycap with progress.
- It is additive courtesy information: it must render identically on every graphics tier
  and never becomes the only signal for anything (fairness, section 13.1).

### 7.13 World-space UI: nameplates and markers

Nameplates stay renderer-owned positioned DOM (`src/render/nameplate_view.ts` +
`nameplate_painter.ts`) with their documented colors-as-literals exception and their
declutter pass (`nameplate_declutter.ts`). Restyle within those constraints:

- Names in 13 / 15 Cinzel with the four-way black outline; no panel background on standard
  friendly plates; health bars stay thin (about 76 x 6) with the one-pixel keyline.
- Reaction colors, threat tint, quest `!` and `?` markers, raid marks, combo pips, cast
  bars, guild tags, and badges all keep their slots; the current target's plate is always
  visible and slightly larger, coordinated with the selection ring in the world.
- A new declutter priority policy remains future Echoes work (section 15). The coordinated
  interface delivery does not change which plates shed.
- The update cadence stays on the static tier knob (`nameplateIntervalSec` in
  `src/game/ui_tier_knobs.ts`), never the FPS governor.

### 7.14 Floating combat text, banners, toasts

FCT keeps its pooled, fairness-audited pipeline (`fct_core.ts`, `fct_painter.ts`,
`FCT_POOL_CAP`, kind-class tokens like `.fct-heal`); restyle the type only: outlined
parchment numerics, crit pop preserved (and dropped to a static emphasis on the low tier
as wired). Banners (`#banner`, `#quest-banner`, `#subzone-banner`) and the
prompt stack (`#prompt-stack`) adopt the shared panel shell with reduced padding; toasts
stack with 8px gaps, live 3 to 5 seconds, and never impersonate combat warnings, which keep
their separate, more immediate treatment.

## 8. Windows

### 8.1 Shared window grammar

Windows compose `.ui-window` on the shared shell (`src/styles/layout.css`): titlebar
drag (`window_drag.ts`), SE resize grip (`window_resize.ts`, opt-outs in
`NON_RESIZABLE_WINDOW_IDS`), dialog semantics (`markDialogRoot`), focus trap and return
(`FocusManager` via `Hud.windowFocus`), Esc through the single `closeAll` dispatcher, and
the 50-to-89 z-band with `#confirm-dialog` pinned above. None of that changes. The grammar
is visual:

- Frame: `--radius-window` 8px, the three-layer gold edge, standard `--panel-bg`, and the
  double bronze ring carried by `--shadow-window`.
- Header: `.ui-win-head` at `--win-head-h` 44px, with 30px `.ui-win-art`, a Cinzel 16 / 22
  gold `.ui-win-title`, an optional subtitle, and the shared `.ui-x-btn` close button.
- Content padding stays `--window-pad` 12px; internal section dividers use `.ui-divider`,
  the gold fade (section 10.6).
- Sizing: large windows target `min(80vw, 1280px)` x `min(84vh, 820px)` inside the existing
  `--app-vw` / `--app-vh` clamps, with a practical minimum near 720 x 520; compact windows
  keep their fitted sizes. No radius above 12px on any rectangular control.
- A modal backdrop (`--color-ink-1000` at about 0.6) appears only behind flows that truly
  block (confirm dialogs, the armory-inspect overlay); ordinary windows keep the world
  interactive.

The radius scale is one vocabulary:

| Token | Value | Use |
|---|---:|---|
| `--radius-2xs` | 2px | Bars |
| `--radius-xs` | 3px | Keycaps and close buttons |
| `--radius-sm` | 4px | Auras and inputs |
| `--radius-card` | 5px | Cards, wells, and buttons |
| `--radius-panel` | 6px | Panels |
| `--radius-socket` | 6px | Sockets |
| `--radius-cell` | 7px | Controller cross hotbar cells |
| `--radius-window` | 8px | Windows |
| `--radius-pill` | 999px | Pills and round-ended rails |

`--radius-slot` and `--radius-button` are retired from the design vocabulary.

### 8.2 Per-window notes

Every window adopts the grammar; these carry specific intent:

- **Bags** (`bags_window.ts`): 40px `.ui-socket--bag` cells (`--socket-size-bag`) in a
  fluid grid, with category chips and a search and sort row. Rarity stays on the existing
  `--bag-slot-quality` hook, poor and common keep the neutral socket, stack counts stay
  bottom right, and the money footer composes `.ui-money` with `formatMoney`.
- **Bank** (`bank_window.ts`): 32px `.ui-socket--bank` cells (`--socket-size-bank`) with
  the existing `--bank-slot-quality` hook. Bank-docked behavior stays.
- **Character** (`char_window.ts`): the paperdoll and equipment sockets gain a tabbed
  sidebar with Stats, Progression, and Skills. Stat labels remain muted with parchment
  values; `item_compare.ts` continues to provide success and danger deltas.
  ACCEPTED DEVIATION (stage and overlay): on pointer form factors the 3D model preview is
  the full-height stage of the equipment pane, and the two equipment slot columns float
  over its outer edges on a scrim (`--color-stage-overlay-scrim`), spanning the stage
  height with their five armor sockets spaced evenly, while the two weapon hands sit in
  their own centred row along the stage's bottom above the skin row, with the playtime and
  share footer pinned below. The boards drew the model as a fixed narrow panel between two
  flowed 6/6 columns, which left the pane's lower half empty at every window height. Slot
  names, empty labels, the unequip and helm-eye chips and the Masterwrought marks are
  unchanged; the touch sheet keeps the stacked paperdoll (the weapons row wraps under it),
  so the stage rules are scoped away from `body.mobile-touch`. The inspect window shares
  the split and spreads its columns beside the taller inspect stage the same way.
- **Talking Head** (`src/ui/hud/talking_head/`): an NPC line spoken to the player while the
  speaker is off screen. NPC speech is a world chat bubble over the speaker whenever the player
  can see them (`speakerInView`, the same on-screen and range rule the bubbles are culled by);
  only when they cannot does the line land on this panel: portrait chip, speaker name in the
  accent, the line in the light body tone on the strong panel surface, seated a fifth of the way
  down the screen, centred, between the quest banner lane and the level banner (the top lane on
  touch), and movable through the frames editor like every other standing HUD frame. Cold and
  click-through, it replaces the bare italic caption the Proving Shore coach used to float
  mid-screen.
- **Quest log** (`src/ui/hud/quest/questlog_window.ts`): quests group by zone. Each zone
  shows its count and has a collapse control; the detail pane keeps tracked state and
  reward sockets.
- **World map** (`map_window_view.ts`, `map_window_painter.ts`): the canvas sits in a
  dark inset atlas frame beside a 300px side rail. The rail lists the zone's quests with
  numbers matching the map badges, then Available Nearby; it also carries filters, legend,
  Show Route, and Untrack. Map controls use `.ui-disc`; pins stay on the `--color-map-*`
  tokens with quest pins vivid.
- **Vendor** (`src/ui/hud/vendor/vendor_window.ts`): inventory uses a compact two-column
  `.ui-card` grid with sockets, price, stock state, and buy action composed from the shared
  primitives.
- **Game Menu**: the Esc menu is a hub of full-width `.ui-btn` rows. Each destination opens
  its per-view panel inside the same window grammar; return and destructive actions keep
  their explicit hierarchy.
- **Store surfaces** (`daily_rewards_window.ts`, `woc_store_view.ts`,
  `claudium_window.ts`): product art provides the color; cards stay restrained blue-black
  with gold edges; rarity chips reuse the weapon-skin rarity colors; price and balance
  rows use `formatNumber` / `formatMoney` and the wallet components. Claim buttons are the
  one sanctioned gold-fill button (section 10.1).
- **Options** (`options_window.ts` over the declarative `options_view.ts` model): the shared
  form controls (section 10.7) restyle every row for free; new settings this program adds
  (the sound mute, the chat idle state if it needs a knob) enter as declarative entries,
  never bespoke DOM.
- **Book of Deeds, social, spellbook, talents, crafting, market (the gold World Market
  and the $WOC Exchange, `woc_market_window.ts`, which ships config-off), mailbox, arena,
  dungeon finder, leaderboard, calendar, meters, trade (including its $WOC arm,
  `src/ui/hud/woc_trade/`), inspect, loot settings**:
  grammar plus tokens, preserving each window's existing information design. Talents 2.0
  (`docs/prd/talents-2.0.md`) and the Encounter UI draft
  (`docs/prd/dungeon-mechanic-primitives.md`) inherit this language when built.

The harvest journal, plant sheet, harvest preference and perfecting windows landed from the
release branch during this delivery; they carry the shared window shell (`ui-window`) and the
scoped legacy button look, and their bodies adopt the primitives in a follow-up.

## 9. HUD states by context

Fixed anchors; context changes emphasis, never position:

- **Exploration:** chat rests at idle fill; target frame absent; tracker and minimap fully
  readable; action bar always fully available.
- **Combat:** target frame, cast bars, cooldowns, and resource states are the loudest
  elements; party frames stay fully readable (never tiered, never dimmed); social toasts
  defer; the rewards card never pulses.
- **Town:** merchant and quest NPC markers prominent; Town Focus entry appears; chat lingers
  longer before fading.
- **Group content:** party frames grow to the five-member set with role, range, dead, and
  disconnect states mandatory; the tracker keeps its three-quest cap.

## 10. Component primitives

One implementation per primitive, reused everywhere. In this codebase a "primitive" is a
CSS class family in `src/styles/library.css` plus, where behavior exists, the owning
module; never a per-window re-implementation. New UI composes this library:

| Role | Library classes |
|---|---|
| Surfaces and window chrome | `.ui-panel`, `.ui-panel-soft`, `.ui-panel-strong`, `.ui-window`, `.ui-win-head` |
| Buttons | `.ui-btn`, `.ui-btn--lg`, `.ui-btn--gold`, `.ui-btn--red`, `.ui-btn--plate`, `[aria-pressed="true"]`; `.ui-icon-btn`, `.ui-icon-btn--micro`; `.ui-disc` |
| Keycaps and badges | `.ui-keycap`, `.ui-keycap--round`; `.ui-badge` |
| Bars and ribbons | `.ui-bar`, `.ui-bevel`, `.ui-ribbon`, `.ui-cast`, `.ui-rail` |
| Sockets | `.ui-socket`, `.ui-socket--bag`, `.ui-socket--bank`, `.ui-socket--stance`, plus `.is-empty`, `.is-used`, `.is-proc`, `.is-oor`, `.is-unusable` |
| Auras | `.ui-aura`, `.ui-aura--own`, `.ui-aura--debuff` |
| Unit art | `.ui-portrait`, `.ui-medal`, `.ui-combat-badge` |
| Tabs | `.ui-tabs`, `.ui-tab`; `.ui-seg`, `.ui-seg-tab` |
| Form controls | `.ui-input`, `.ui-check`, `.ui-toggle`, `.ui-range` |
| Supporting content | `.ui-chip`, `.ui-card`, `.ui-well`, `.ui-divider`, `.ui-money` |

### 10.1 Buttons

Every text button starts from `.ui-btn`: a socket-filled plate at `--btn-h` 32px with a
12px Cinzel label. `.ui-btn--lg` raises it to `--btn-h-lg` 38px.

- `.ui-btn--gold` is the single call-to-action on a surface.
- `.ui-btn--red` is the primary action treatment.
- Options screens use the red plate toggle, `.ui-btn--plate`, reading On or Off. Its
  selected state follows `aria-pressed="true"`; the off state remains fully labelled.
- `.ui-icon-btn` owns square glyph controls, and `.ui-icon-btn--micro` owns the 34 x 30
  micro-menu and utility-row controls. `.ui-disc` owns circular minimap and map controls.

States, on every variant: hover, pressed, selected, disabled, keyboard focus, and loading
where async. `aria-pressed="true"` is the selected contract for toggle buttons. Disabled
controls mute without losing their labels.

Keyboard focus is the existing OUTLINE mechanism, not a box-shadow ring: a steady outline
drawn from the theme-derived `--color-border-focus` with an `outline-offset` gap so it
reads as the gold ring over any fill. That is exactly what
`tests/focus_visible_guard.test.ts` enforces (it is outline-scoped); do not migrate focus
indication to box-shadows, which would escape the guard.

Every interactive element responds visibly within one frame; a cursor change alone is never
feedback. No `transform: scale()` on hover or focus of list, rail, or chip items.

### 10.2 Tabs

`.ui-tabs` and `.ui-tab` own the standard strip; `.ui-seg` and `.ui-seg-tab` own segmented
view switches. Labels are Cinzel 12px. Selected tabs use the gold selected surface;
unselected tabs use muted parchment and hover to full parchment. Roving-tabindex keyboard
navigation stays wired in the chat and window tab strips.

### 10.3 Keycaps

`.ui-keycap` is 18px high with an ink fill, `--color-socket-rim` border, and
`--radius-xs`. `.ui-keycap--round` serves the interaction prompt. The socket's own key chip
sits at the top left. Labels always come from `keyLabel` / `keyCapLabel` (or the controller
glyph set), never hard-coded characters.

### 10.4 Badges

`.ui-badge` is a 16px danger circle with a `--color-glint` edge and a bold tabular count.
It may overlap its parent and serves mail, bags, talents, rewards, and unread tabs.

### 10.5 Progress bars

`.ui-bar` is the 15px flat bar: dark track, keyline, colored fill, gloss, and centered
tabular text when height allows. `.ui-bevel` is the unit-frame bar with quarter ticks and a
5px notch. `.ui-ribbon` carries unit names, `.ui-cast` carries double-pointed cast bars,
and `.ui-rail` carries XP. Fill colors by meaning stay on the theme resource, cast, XP,
and rested-XP tokens.

### 10.6 Tooltips and dividers

The single shared `#tooltip` box (lazy content, owner-tracked by `SharedTooltipOwner`)
composes `.ui-panel-strong`, with 10px padding, max-width 320px, title in the accent,
body in secondary parchment, metadata muted; about 250ms hover delay, none on keyboard
focus; never covers the cursor or the focused slot. `.ui-divider` owns the one-pixel gold
fade.

### 10.7 Form controls

The native controls in `base.css` and `settings_controls.ts` compose `.ui-input`,
`.ui-check`, `.ui-toggle`, and `.ui-range`: inputs use the strong surface, checks use the
gold check, toggles expose their selected state, and ranges use the 4px track. The 16px
mobile input floor stays. Options use `.ui-btn--plate` for the visible On or Off choice.
Scrollbars remain theme-derived through `themeCssVars` in `src/ui/theme.ts`.

## 11. Motion

### 11.1 Durations and easing

The landed duration tokens in `src/styles/tokens.css` are the shared chrome timing
vocabulary:

| Token | Value | Use |
|---|---:|---|
| `--dur-fast` | 90ms | hover color and border shifts, tooltips |
| `--dur-press` | 60ms | button press |
| `--dur-panel` | 160ms | panel and window open (close about 120ms) |
| `--dur-frame` | 120ms | target frame and prompt appear |

Ease-out on the way in, ease-in on the way out.

### 11.2 Style

Opacity, one to four pixels of translation, and small scale (98 to 100 percent). No elastic
or bouncy curves, no large slides, no layout-shifting transitions (the interruption-safe
cross-fade rule in `src/ui/CLAUDE.md` stands). Reward glows pulse slowly; combat proc glows
pulse at most twice per second.

### 11.3 Drag and drop

The existing item drag pipeline keeps its behavior; visuals: floating ghost at about 85
percent opacity, source slot at about 45 percent, valid targets edge in the themed accent,
invalid targets edge danger, drops outside valid targets return without ceremony.

### 11.4 Reduced motion

`prefers-reduced-motion` and the `reduceMotion` setting (`body.reduce-motion`) remove
pulses, shimmer, and nonessential translations; animated proc glows become static bright
borders; panel transitions become opacity-only. Decorative animation cost also rides the
effects tier (`--motion-scale`, `--fx-ambient-anim`); reduced motion is the stronger
authority and never sheds information (the profile rules in
`src/game/ui_effects_profile.ts` already encode this precedence).

## 12. Accessibility

The HUD-chrome WCAG 2.2 AA contract in `src/ui/CLAUDE.md` is part of this design, not an
add-on. Highlights the visual system must actively protect:

- **Contrast:** body text at 4.5:1 and large text at 3:1 against its own surface, on every
  theme preset (`tests/theme.test.ts` enforces the knobs; the themed/static split in 4.1
  is what keeps the promise on non-classic presets). Text over the 3D world always carries
  its outline or a local fill; never rely on the scene for contrast.
- **Color independence:** every state pairs color with a second signal: quest markers are
  icon plus color, disabled is desaturation plus opacity plus cursor, roles are shape plus
  color, errors are icon plus text, online status is dot plus label.
- **Focus:** the shared themed outline ring on every interactive element, steady,
  token-driven; focus order follows visual order; the `FocusManager` trap-and-return
  behavior and the skip links stay first-class.
- **Keyboard and controller:** every window and control keyboard-operable; Esc semantics
  stay with `closeAll`; controller glyphs replace keycaps when a pad is active.
- **Forced colors:** the `forced-colors: active` pass must survive the restyle (borders
  and focus from system colors). There is deliberately no `prefers-color-scheme`
  auto-switch; user-selectable presets cover it.
- **User comfort knobs keep working across the restyle:** `uiScale`, `hudOpacity`,
  `chatFontScale`, `chatOpacity`, `tooltipScale`, `fctScale`, frame scales,
  `highContrastText`, `compactChat`, `frostedPanels`, `reduceMotion`, and the theme knobs.
  A restyle that breaks a comfort setting is a regression even if it looks better.
- **Out of scope for this program** (recorded so silence is not ambiguity): a global HUD
  edit mode, nameplate scale and density settings, and colorblind-specific marker
  palettes. The existing movable frames, the nameplate toggle, theme presets, and the
  color-independence rule carry accessibility until those are specced as their own
  settings work.
- **RTL:** no supported locale is right-to-left; layout mirroring is out of scope
  until one lands.

## 13. Engineering contracts the design rides on

These are the load-bearing constraints for anyone implementing this document. Each has
teeth in CI; the anchors are the law, this section is the summary.

### 13.1 Gameplay-neutral presentation (fairness)

`docs/design/graphics-settings-fairness.md`. A graphics or performance preset may shed
cosmetic richness, never actionable information: own debuffs, party and raid HP, cast
bars, target HP granularity, and enemy positions are identical on every tier. HUD tier
knobs read the static preset (`data-fx-level` via `src/game/ui_effects_profile.ts` and
`src/game/ui_tier_knobs.ts`), never the FPS governor. Nothing in this design may introduce
a tier- or theme-gated read. The inverse duty also holds: design every surface to look
intentional and beautiful on the LOW tier, with blur, heavy shadows, and ambient
animation shed; verify both extremes before calling a component done. Guards:
`tests/ui_effects_profile.test.ts`, `tests/ui_tier_knobs.test.ts`,
`tests/ui_effects_wiring.test.ts`, `tests/auras_painter.test.ts`.

### 13.2 Module shape and per-frame cost

New UI lands as a pure view-core plus thin painter on the `PainterHost` seam, composed by
`Hud`, per the recipe in `src/ui/CLAUDE.md`; cores register in the `UI_PURE_CORES`
allowlist in `tests/architecture.test.ts`. A `src/ui` module that can be neither (it must
touch the DOM and is not a painter) is a painter-side helper, a last resort, registered in
that same file's `UI_PAINTER_HELPERS` for its hard contract or in `UI_DOM_MODULES` when it
owns browser state; the classification sweep there fails on an unregistered module that
reaches a host. Per-frame code writes DOM only through the
elided writers, never reads layout in the hot path, and keeps allocation-light cores.
Restyling must not regress the standing budget (`tests/painter_host.test.ts`,
`tests/hud_perf_budget.test.ts` with its committed baseline, `scripts/perf_tour.mjs`).
Practical corollaries for this program: prefer CSS for decoration over per-frame JS; the
launcher, rewards card, and system buttons are cold-path or event-driven; the interaction
prompt is the one NEW hot-path component and enters the perf budget deliberately
(section 7.12). Long lists in windows keep their existing pagination and filter bounds;
no virtualization mandate.

### 13.3 i18n

Every player-visible string in this document is an English value behind a `t()` key
(new HUD chrome keys in `src/ui/i18n.catalog/hud_chrome.ts`), including aria labels,
placeholders, and tooltips; numbers and money through the formatters. Wordy new English
values need their five non-Latin fills in the same change (the M16 rule,
`tests/i18n_completeness.test.ts`). Rewording an EXISTING key (for example the chat
placeholder) is a deliberate catalog change with the same obligations. Entity names come
through `tEntity`. Text can grow about 35 percent in translation: buttons use min-width,
launcher labels may wrap to two lines only as a localization fallback. Sim and server stay
language-agnostic; the S3 guard is `tests/localization_fixes.test.ts`.

### 13.4 CSS discipline

One flat `@layer` order in `src/styles/index.css`; new window bodies in `components.css`,
HUD chrome in `hud.css`, tokens in `tokens.css`, each under a ten-dash section banner
(`tests/css_corpus.test.ts`, `tests/css_value_validity.test.ts`,
`tests/styles_extraction.test.ts`, `tests/per_entry_css_wiring.test.ts`). Token-first,
no literal hexes in painters, theme coupling through `themeCssVars`. Component CSS carries
no raw color literal: `tests/css_raw_color_ratchet.test.ts` ratchets every sheet, with
`src/styles/library.css` and every redesigned section pinned at zero. New UI composes the
`ui-*` primitives under the contract in `src/ui/library/CLAUDE.md`, pinned by
`tests/ui_library.test.ts`. New shared vocabulary (a z-index scale, scrim tokens, drawer or
sheet grammar) lands as part of the phase that needs it, as one reviewed change, never as a
standalone fragment.

### 13.5 Mobile duty and platform floors

Desktop-first does not mean desktop-only: every new or renamed `.window` id needs its
mobile decision (`tests/mobile_window_coverage.test.ts`), mobile `left` re-pins re-declare
`transform`, touch targets keep the 40px floor and inputs the 16px floor. The desktop
Electron shell needs no special layout treatment (standard OS frame, no zoom management,
Steam overlay not hooked), but the font self-hosting change touches its CSP
(section 5.2).

### 13.6 Verification per phase

Every phase of section 15 ships with: `npm run gate` green, before/after screenshots under
`docs/screenshots` captured with the `pr-screenshots` tooling, a fresh
`frontend-seam-reviewer` pass over the diff, and the `/qa` checklist. Every phase owes a
MOBILE screenshot pass too unless its diff provably touches only desktop-only surfaces:
mobile consumes the same tokens, theme, type, and shared chrome families, and phases 4 and
5 restyle surfaces (chat, unit frames, windows) that mobile renders directly. Visual
claims are verified against the running game, not the stylesheet.

## 14. What not to do

- No neon gradients, no glassmorphism-first surfaces, no pill buttons, no bright filled
  cards, no thick yellow borders, no pure-black opaque panels.
- No new fonts beyond the Alegreya faces and the shell-scoped Cinzel brand face; no
  blackletter anywhere.
- No emojis as icons, ever; no mixing icon families in one panel.
- No hard-coded colors in painters; no unlayered shared CSS; no per-component copies of
  panel styling; no second scaling system; no parallel token namespaces: every color,
  font, radius, spacing value, and duration is consumed through its one named token from
  sections 4, 5, and 11.
- No static ramp token doing a preset-dependent job (section 4.1's themed/static split).
- No decoration that hides or delays actionable information, on any tier, in any theme.
- No layout-shifting hover or open animations; no `transform: scale()` on list hovers.
- No landing restyle fragments outside the phase plan of section 15.

## 15. Rollout

This redesign lands as one coordinated PR against `release/v0.42.0`: the
maintainer-approved re-land of the interface overhaul. The library, HUD core, HUD surfaces,
every window, mobile HUD, and controller cross hotbar land together so no surface ships
against half of the vocabulary. The PR uses focused per-area commits for review and
rollback clarity:

1. Interface tokens and the `ui-*` primitive library.
2. Desktop HUD core, including frames, action bars, XP, minimap, tracker, chat, and rails.
3. HUD surfaces, prompts, banners, auras, casts, and related state variants.
4. Every feature window on the shared window grammar.
5. Mobile HUD surfaces and shared mobile chrome.
6. Controller HUD and controller cross hotbar.

Echoes remains future work after that coordinated delivery: nameplate declutter priority,
the guide and editor token mirrors, and the broader mobile layout program. The font
self-hosting plan in section 5.2 is also future work, outside this delivery.

## 16. Acceptance criteria

The program (and each phase, for its slice) is done when:

- Panels read blue-black with the world visible through them; every major surface carries
  the fine gold edge; gold appears as structure and emphasis, never as large fills.
- Typography is the Alegreya system per section 5, self-hosted, with no fallback flash and
  no authored body text below 12px within the supported ranges of section 2.
- The layout matches section 7.1: party top-left, chat bottom-left, aura bars beside the
  minimap cluster with rewards card, tracker, and 3 x 2 launcher down the right rail,
  player and target frames flanking bottom-center above the bars, four quiet system
  buttons bottom-right, prompt above the frames.
- Launcher tiles, map controls, item and action slots, portraits, keycaps, badges, and
  tooltips each come from exactly one primitive family.
- Every control exhibits the full state set of section 10.1, keyboard focus included.
- All comfort settings, theme presets, and accessibility behaviors of section 12 still
  work; `tests/theme.test.ts` and the focus and live-region suites stay green on all four
  presets.
- The fairness, perf-budget, i18n, CSS-discipline, and mobile-coverage guards of section 13
  stay green; `npm run gate` passes.
- Before/after screenshots for each phase live under `docs/screenshots` and tell the story
  without commentary.
- The interface reads as one crafted system that makes the game look better than players
  remember it; a player mid-fight notices nothing missing, on any graphics tier.

## 17. Appendix: disposition inventory

Every current HUD surface, so silence is impossible. "Restyle" means tokens and chrome
only; behavior changes are named in the linked section.

| Surface (element) | Disposition | Delivery |
|---|---|---|
| `#target-frame` | Restyle; move beside `#player-frame` in the bottom-center pair (7.2) | Coordinated PR |
| `#party-frames` | Restyle as plated rows with a `Party N` header (7.3); `below-target` shift retires | Coordinated PR |
| `#player-frame`, `#petbar`, `#xpbar`, `#actionbar`, `#actionbar2`, `#actionbar3`, consumable slots | Restyle as plateless frames, sockets, and rail (7.2, 7.4) | Coordinated PR |
| `#castbar`, `#swingbar` | Restyle (10.5) | Coordinated PR |
| `#buff-bar`, `#debuff-bar` (+ `aurasOnPlayerFrame` mode) | Restyle as aura chips and keep beside the minimap (7.5) | Coordinated PR |
| `#minimap-wrap` cluster (zone label, disc, clock, coords, compass, zoom, day or night, `#mail-indicator`, `#raid-lockout`) | Restyle the bezel, strips, chips, and compact disc controls; retain zoom and day or night (7.6) | Coordinated PR |
| `#right-tracker-stack` (`#quest-tracker`, `#deed-tracker`, `#delve-tracker`) | Restyle; quest tracker stays text only with gold numbered chips (7.8) | Coordinated PR |
| `#side-buttons` micro-rail | Keep and restyle as the two-column 34 x 30 micro menu (7.9) | Coordinated PR |
| `#daily-rewards-button` | Keep and restyle as the chest beacon with count badge (7.7) | Coordinated PR |
| `#community-hud` | Keep and restyle as the separate utility row (7.11) | Coordinated PR |
| Web store promo banner (`store_promo_card.ts`) | Out of scope; unchanged (7.7) | Out of scope |
| `#chatlog-wrap` (tabs, log, `#chat-input`) | Restyle; new idle/focus state (7.10) | Coordinated PR |
| Interaction prompt | New static root and HOT painter (7.12) | Coordinated PR |
| `#nameplates` layer | Type restyle within renderer constraints; declutter priority remains future (7.13) | Coordinated PR, then Echoes |
| FCT pool (`.fct`) | Type restyle only (7.14) | Coordinated PR |
| `#banner`, `#quest-banner`, `#subzone-banner`, `#error-msg`, `#prompt-stack` | Restyle (7.14) | Coordinated PR |
| `#low-health-vignette`, `#death-overlay`, `#ghost-prompt` | Restyle; flows unchanged | Coordinated PR |
| `#tooltip`, `#ctx-menu` | Restyle (10.6) | Coordinated PR |
| `#confirm-dialog` | Restyle on the window grammar (8.1) | Coordinated PR |
| Emote wheel | Restyle | Coordinated PR |
| `#meters-window` | Restyle on the window grammar | Coordinated PR |
| All `.window` feature windows (8.2 list) | Window grammar | Coordinated PR |
| `#loot-window`, `#quest-dialog`, delve board and rite panels, lockpick panel | Window grammar | Coordinated PR |
| `#arena-status`, spectate badge, reconnect overlay, tutorial cards | Restyle | Coordinated PR |
| Discord surfaces (`#mm-discord` panel behavior, `#discord-window`, index-only CTA) | Keep the existing micro-menu behavior and restyle the window in place | Coordinated PR |
| `#perf-overlay`, `#click-move-marker`, skip links, live regions | Unchanged | n/a |
| Mobile touch controls and sheets | Restyle the mobile HUD in the coordinated PR; broader mobile layout remains future Echoes work | Coordinated PR, then Echoes |
