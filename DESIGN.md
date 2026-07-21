# World of ClaudeCraft Design Language

**Status:** Adopted standard. Interface changes land in the phases of section 15, in
order, never as isolated fragments.
**Scope:** The desktop game client (the `index.html` and `play.html` entries). Because
mobile is the same client consuming the same `src/styles/tokens.css` and `src/ui/theme.ts`,
the token, theme, and typography phases restyle mobile on day one and owe mobile
screenshots; only mobile-specific LAYOUT work is deferred to its own program. Every change
still owes the mobile-coverage decisions in section 13.5.
**Updated:** 2026-07-15.

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

Two approved design references are committed alongside this document:

1. `docs/design/design-language/desktop-style-reference.png`: the primary reference for
   color, typography, translucency, gold edges, icon treatment, unit frames, chat, minimap,
   and overall finish quality.
2. `docs/design/design-language/desktop-approved-layout-reference.png`: the primary
   reference for the approved right rail: minimap, then the Daily Rewards card, then the
   objective tracker, then the 3 x 2 utility launcher.

Precedence when details conflict:

1. This document.
2. The style reference image.
3. The approved layout reference image.
4. Standard MMORPG usability conventions.

The images communicate direction: composition, materiality, and finish. Text, values,
shortcuts, and icons within them are illustrative only; the shipped interface always uses
real game data, live keybinds (`src/game/keybinds.ts`), approved assets, and the English
catalog values behind their `t()` keys (any reword of an existing key is an explicit
catalog change with its M16 obligations, section 13.3).

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
| `accent` | `#d8a645` | Antique gold: structural gold is dark and desaturated by design. |
| `border` | `#926321` | Bronze-gold frame borders. |
| `panel` | `#12232c` | Midnight blue-black; `themeCssVars` derives the panel gradient and `--panel-edge` from it. |
| `text` | `#fff4d9` | Parchment primary text. |
| `textMuted` | `#c4b590` | Warm muted parchment. |
| `hp` | `#25c84a` | Warm health green. |
| `mana` | `#2d8cf0` | Clear resource blue. |
| `rage` | `#c0392b` | Classic rage red. |
| `energy` | `#e4c531` | Classic energy yellow. |

Contrast check (informative): against the panel and its derived darker edge, text is
about 14.7:1, muted text 7.9:1, accent 7.3:1, mana 4.7:1; everything clears the enforced
floors with margin.

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
| `--color-accent-hover` | `#f0c86d` | accent lightened one step | Hover borders, interactive gold text, selected tab text, tooltip titles |
| `--color-accent-glint` | `#ffe5a3` | accent lightened two steps | Inner edge highlights on themed surfaces, selection glints |
| `--color-border-focus` | `#f0c86d` | existing knob-derived var | The focus ring (section 10.1) |
| `--color-text-secondary` | `#e8dcbe` | text mixed toward textMuted | Secondary text. The existing `var(--color-text-secondary, ...)` fallback consumers in `shell.css` and `components.css` migrate onto it in the change that defines it. |
| `--color-text-faint` | `#9ea6a6` | textMuted cooled and dimmed | Timestamps, metadata |
| `--panel-fill-strong` | `#060f14` at 0.95 | panel mixed harder toward black, higher alpha | Tooltips, text inputs, confirm dialogs |

**Semantic state colors** (static seeds in `tokens.css`; `themeCssVars` contrast-repairs
any of them used as text against the preset panel, the same `ensureReadable` treatment the
accent already gets):

| Token | Value | Use |
|---|---|---|
| `--color-info` | `#45c9ff` | Informational text and markers |
| `--color-quest` | `#ffd12d` | Quest markers, tracked quest titles |
| `--color-warning` | `#ff9d32` | Warning state |
| `--color-danger` | `#ee4d3c` | Destructive / critical fills (error TEXT stays `--color-text-error`) |
| `--color-xp` | `#8f37dc` | Experience fill (gradient light/dark stops derive from it; replaces the literal purples in `hud.css`) |
| `--color-xp-rested` | `#4a8fe0` | Rested-XP overlay fill |

Existing tokens that keep their jobs: `--color-text-error` `#ff8f85`, `--color-text-success`
`#7fdc4f`, the `--color-debuff-*` school tints, the `--color-map-*` / `--color-minimap-*` /
`--color-delve-*` canvas families, `--scrollbar-track`. The scrollbar thumb and border
colors are theme-derived (`themeCssVars` overwrites `--scrollbar-thumb`,
`--scrollbar-thumb-hover`, `--scrollbar-border` from the border knob), so their retune in
section 10.7 lands in the `theme.ts` derivation constants, not in `tokens.css`.

The bright `#ffd100` does not vanish from the game: it survives exactly where vividness is
the point, as `--color-quest` (retuned to `#ffd12d`) and in the map and minimap
quest-marker tokens. It stops being the color of chrome.

Define `--panel-border: var(--border)` in `tokens.css` (the variable is already consumed
in `components.css`); do not hand-migrate the call sites.

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
knob. With the new knob it lands near: `linear-gradient(170deg, #12232c 0%, #0a151c 60%,
#0a151c 100%)` at around 0.90 alpha. Retune the derivation constants in `src/ui/theme.ts`,
not per-component CSS. Opacity targets:

| Surface | Fill | Alpha target |
|---|---|---:|
| Standard panel / window | `--panel-bg` | 0.88 to 0.92 |
| Objective tracker | `--panel-bg` at the soft multiplier | about 0.72 |
| Chat, idle | `--panel-bg` soft state (new; composes with the user's `--chat-opacity`) | about 0.72 x user setting |
| Chat, focused or hovered | `--panel-bg` | 0.88 to 0.92 x user setting |
| Tooltip, text input, confirm dialog | `--panel-fill-strong` | 0.94 to 0.97 |
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

The standard edge is three layers, applied to `.panel` in `src/styles/base.css`:

1. One-pixel dark outer keyline (the existing black `outline`).
2. One-pixel `var(--border)` gold structural border; the fine edge is the signature.
3. Faint warm inner highlight: `inset 0 1px 0` of `--color-accent-glint` at roughly 0.14
   alpha (replaces the current white inset).

Plus the existing drop shadow and inner vignette, retuned soft: outer
`0 10px 28px rgba(0, 0, 0, 0.45)`, inner `inset 0 0 24px rgba(0, 0, 0, 0.30)`. Featured
surfaces (the Daily Rewards card in its claimable state, a selected reward cell) may add a
second outer glint: `0 0 0 2px` of the accent at about 0.32 alpha. Nothing else gets a
double edge.

### 4.6 Glow discipline

Glows are reserved for: claimable rewards, selected or proc'd action slots, quest markers,
and short feedback moments. A glow is `0 0 12px` to `0 0 14px` of the relevant accent at
0.25 to 0.42 alpha, pulsing at most twice per second, and every decorative pulse rides
`--motion-scale` and the reduced-motion kills (section 11.4). The talents button's
unspent-points pulse (`.has-points`) is the existing exemplar of a justified glow.

## 5. Typography

### 5.1 Families

The interface commits to the Alegreya superfamily, which the client already half-uses:

| Token | Family and weights | Role |
|---|---|---|
| `--font-display` | `"Alegreya"` 700 | Window and panel titles, zone names, banners |
| `--font-ui` | `"Alegreya Sans"` 400, 500, 700 | Body, buttons, chat, values (unchanged stack) |
| `--font-label` | `"Alegreya Sans SC"` 700 | New token: small-caps names on unit frames, party rows, nameplates |
| `--font-serif` | `"Alegreya"` 400 (plus italic) | Quest and lore prose (replaces the literal `Georgia, serif` uses in `components.css`) |
| `--font-brand` | `"Cinzel"` | New token: the brand face, used ONLY by the pre-game shell, logo lockups, and static pages |

Alegreya Sans carries no 600 cut; UI emphasis weights are 500 and 700 only. In-world UI is
Alegreya only; Cinzel is the brand face, reserved for the pre-game shell, logo lockups,
and static pages through `--font-brand`. Migration order matters because the shell
(`src/styles/shell.css`) consumes the same display tokens as the HUD: introduce
`--font-brand`, migrate the shell's display-font uses onto it, then flip `--font-display`
to Alegreya. Never introduce a blackletter or decorative medieval face anywhere.

### 5.2 Self-host the fonts

The game entries currently load Google Fonts from the CDN; the guide already self-hosts the
same families from `public/fonts/` with subset `@font-face` rules (`src/guide/styles.css`).
Move the game entries to the same pattern in the foundation phase:

- Add the missing weight and family subsets to `public/fonts/`: Alegreya 700, Alegreya Sans
  SC 700 (SIL OFL, same subset pipeline), alongside the existing Alegreya 400, Alegreya
  Sans 400/500/700, and Cinzel subsets. Add the attribution row to `CREDITS.md` following
  the existing guide-webfonts row format.
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
| Zone title | display | 19 / 24 | 700 | `#zone-label` |
| Window title | display | 17 / 22 | 700 | `.panel-title` on windows |
| Panel title | display | 15 / 20 | 700 | HUD module headers (party, tracker) |
| Unit name | label | 15 / 17 | 700 | Player, target, party names |
| Button label | ui | 14 / 17 | 700 | Buttons, launcher tiles |
| Body | ui | 14 / 19 | 400 to 500 | Chat, descriptions, rows |
| Objective row | ui | 13 / 17 | 500 | Tracker lines |
| Metadata | ui | 12 / 15 | 500 | Timestamps, subtitles, coords |
| Keycap | ui | 10 / 12 | 700 | Keybind chips |
| Nameplate | label | 13 / 15 | 700 | World names |

### 5.4 Text rules

- Primary text `var(--color-text-light)`, secondary `--color-text-secondary`, muted
  `--color-text-muted`, metadata `--color-text-faint`.
- Interactive gold text uses `--color-accent-hover`; tracked quest titles use
  `--color-quest`; informational lines use `--color-info` (both contrast-repaired per
  preset, section 4.3).
- Panel and window titles are parchment, not gold (retire the current gold `.panel-title`).
  Featured titles (Daily Rewards) may use the themed accent.
- HUD labels over the world keep the existing outline treatment (`--text-outline-color`
  halo, `body.high-contrast-text` strengthens it). Nameplates keep their four-way outline.
- Names on frames and nameplates render in small caps via `--font-label`.
- Every number a player reads (health, resource, money, timers, XP, quest progress) goes
  through the i18n formatters (`formatNumber`, `formatMoney`, `formatDateTime` in
  `src/ui/i18n.ts`) and renders with `font-variant-numeric: tabular-nums`.
- Capitalization: title case for window titles, buttons, and quest titles; sentence case
  for descriptions and system status; never full-uppercase paragraphs (small caps come from
  the SC face, not `text-transform` on body copy).
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
- **Vector chrome glyphs** (menus, panel controls, status markers): the inline-SVG registry
  in `src/ui/ui_icons.ts` (`svgIcon`, monochrome, `fill: currentColor`). These inherit the
  themed accent from CSS `color` and are the only sanctioned thin-line icons; they serve
  secondary controls (close, collapse, zoom, filters, settings), never primary
  destinations.

Rules:

- Primary destinations (launcher tiles, the Daily Rewards chest, window headers) get
  painted art with recognizable silhouettes, warm highlights, and a consistent
  three-quarter or front-facing perspective.
- **The quality bar decides the source.** Draw an icon procedurally ONLY when the recipe
  hits the painted-icon bar completely: correct silhouette, lighting, materials, and a
  clean read at every rendered size. If a recipe cannot get all the way there, do not
  ship a compromise: use curated image art instead (WebP under `public/ui/` via the
  matching converter script, with a `CREDITS.md` row), and raise the art request with the
  design team the moment the gap is known so the asset exists before its phase ships. The
  keyword fallback compositor remains as runtime safety for unknown ids, never as the
  shipped look for a known surface.
- Every interactive painted icon sits inside a dark inset frame with a bronze edge; the art
  never touches the border. Inset 3px on action slots, 6 to 8px on launcher tiles.
- One lighting direction, one perspective, one saturation range per panel. Never mix flat
  vector, emoji, and painted icons in the same surface. Raw emojis are never icons
  (`src/ui/CLAUDE.md`); an emoji standing in for a label still needs its real `t()` text.
- Sizes are set where the component is specced (sections 7 and 10); the pipeline facts:
  procedural master canvas at `DEFAULT_ICON_SIZE`, WebP art served at 128px square.

## 7. Desktop HUD layout

### 7.1 Composition

```text
+--------------------------------------------------------------------+
| Party frames                        Auras | Zone name, clock       |
|                                           | Minimap (+ compass)    |
|                                           | Daily Rewards card     |
|                                           | Objective tracker      |
|                                           | Utility launcher 3x2   |
|                          GAME WORLD                                |
|                  (nameplates, quest markers)                       |
|                                                                    |
|                       Interaction prompt                           |
| Chat panel            Player | Target frames                       |
|                       XP bar + action bars       System buttons    |
+--------------------------------------------------------------------+
```

Default HUD inset from the viewport edges: 12px. Anchor summary at `--ui-scale` 1
(existing element ids in parentheses; sizes are targets, offsets may flex up to 8px for
content and safe areas, hierarchy may not):

| Component | Anchor | Target size | Element |
|---|---|---|---|
| Party frames | top left | rows 186 wide x 52 each | `#party-frames` |
| Chat panel | bottom left | 420 x 300 | `#chatlog-wrap` |
| Player auras | top right, left of minimap | 28px chips, wrapping | `#buff-bar`, `#debuff-bar` |
| Minimap cluster | top right | 220 disc | `#minimap-wrap` |
| Daily Rewards card | below minimap | 260 x 84 | `#daily-rewards-button` (rebuilt as a card) |
| Objective tracker | below rewards card | 260 wide | `#right-tracker-stack` |
| Utility launcher | below tracker | 260 x 198, 3 x 2 | replaces `#side-buttons` |
| Interaction prompt | bottom center, above frames | 280 x 44 | new |
| Player + target frames | bottom center row | 320 x 72 each | `#player-frame`, `#target-frame` |
| XP bar + action bars | bottom center | 612 wide stack | `#actionbar-stack` |
| System buttons | bottom right | four 40 x 40 | replaces `#community-hud` |

A full disposition inventory of every current HUD surface is in section 17.

### 7.2 Player and target frames

Both frames share the bottom-center row: player left of the action-bar stack's center
line, target mirrored right, as deliberately symmetric peers. Both remain movable and
lockable through the existing `MovableFrame` family (`src/ui/movable_frame.ts`, persisted
by `src/ui/target_frame_pos.ts`); changing the defaults is a one-time
`LAYOUT_RESET_EPOCH` bump in `src/ui/frame_pos_reset.ts`. The `below-target` shift on
party frames retires with the move.

Frame anatomy (the `unit_frame.ts` + `unit_frame_painter.ts` family, both instances):

- Circular portrait disc, 64px, three-ring treatment: dark outer keyline, `--border` gold
  structural ring, faint `--color-accent-glint` inner ring. The portrait stays the live GLB
  headshot (`src/render/characters/portrait.ts`) painted by `unit_portrait_painter.ts`.
- Level medallion, 22px gold-rimmed circle overlapping the portrait's lower edge; elite and
  quest relationship tags keep their slots.
- Name in `--font-label` small caps, 15px.
- Health bar about 208 x 15 with centered tabular numerics; resource bar about 208 x 12.
  Bars keep the one-pixel black keyline, gain a one-pixel top highlight on the fill, and
  fill colors stay the theme resource knobs.
- Cast bars stay inside the frame body (`CastBarPainter`, `#castbar` / `#tf-castbar`).
- Target debuffs keep their strip below the target frame (`#tf-debuffs`).
- Combat, rest, low-health, and low-resource states keep their existing hooks
  (`#pf-combat`, `#pf-rest`, `low_health.ts` vignette, `low_resource.ts`); restyle the
  visuals, do not change the signals. Health changes interpolate about 150ms with instant
  numerics; healing flashes warm-white, damage flashes a red edge; below 25 percent health
  the frame (not the whole screen) carries a restrained danger pulse alongside the existing
  vignette.

The target frame appears and disappears without shifting the action bar (fade plus 98 to
100 percent scale over 120ms). Hostile targets tint the name and edge with muted
`--color-danger`; friendly targets stay gold and blue-black.

### 7.3 Party frames

Party rows (the third `UnitFramePainter` consumer: `party_frames.ts`, `party_frame_row.ts`,
`party_frames_painter.ts`) upgrade to match the frame family:

- A slim party header panel above the rows: "Party" in panel-title type with the member
  count, a collapse control, and an invite affordance that opens the social window's invite
  flow (the header is new; the collapse control exists).
- Rows: circular class-crest or portrait chip with a class-color ring (`--cls`), small-caps
  name, 74 x 7 health and 74 x 5 resource bars, and the existing dead, offline,
  out-of-range, leader, and aura chips restyled to the new tokens.
- States, all readable at a glance: targeted party member gets a `--color-accent-hover` row
  edge (new); out-of-range desaturates the row to about 55 percent; dead renders a
  grayscale portrait with health at zero; disconnected mutes the portrait with a connection
  icon; ready checks overlay the existing pending / accepted / declined marks on the row.
- Party frames are deliberately never tiered (section 13.1); raid sorting and the 100-yard
  range model stay as implemented.

### 7.4 Action bars and XP

The bottom stack keeps its structure: primary bar (12 slots, `Digit1` through `Equal`),
optional secondary bar (`showSecondaryActionBar`), optional third bar
(`showThirdActionBar`, available while the secondary bar is visible), consumable slots,
and the pet bar when a pet is out. All of it stays on the `ActionBarPainter` family with
hotbar drag-and-drop.

- Slot: 48px, radius `--radius-slot` (new token, 5px), 3px inset well (icon art renders at
  about 42px), bronze border, keybind cap top-right in the shared keycap style
  (section 10.3), stack count bottom-right.
- States (existing states, restyle only): ready, hover (border to `--color-accent-hover`),
  pressed (one-pixel inward), cooldown sweep plus remaining seconds, `.used` proc glow
  (gold, max two pulses per second), `.oor` out-of-range red tint (never opaque red),
  `.unusable` desaturated cool overlay, `.queued`, `.empty`, `.drop-target`.
- Cooldown text: whole seconds under a minute, compact `1m` style above (formatter-driven).
- XP bar: the existing 612 x 10 rail directly above the bar, `--color-xp` fill with the
  `--color-xp-rested` overlay; hover label stays, styled `4,650 / 8,000 XP` via
  `formatNumber`. Post-cap the bar keeps its overflow-XP behavior (`showOverflowXp`).

### 7.5 Player auras (buffs and debuffs)

`#buff-bar` and `#debuff-bar` keep their top-right anchor immediately left of the minimap
cluster; when the minimap disc grows (7.6) their offsets re-pin against the new cluster
width in the same change. The `aurasOnPlayerFrame` setting (reparenting the buff bar onto
the player frame) stays supported.

- Chips: 28px standard, radius `--radius-sm`, dark inset fill; the player's own auras on
  the target strip stay 34px with the gold emphasis edge.
- Debuff chips keep their per-school tinted borders (`--color-debuff-*` via `data-school`):
  that tint is actionable dispel/school information, identical on every tier.
- Duration text below the chip in metadata type; stack badge top-right in the shared badge
  style (section 10.4).
- The tier knobs governing aura refresh cadence and buff-overflow shedding stay exactly as
  audited (debuffs are never culled; `src/game/ui_tier_knobs.ts`, section 13.1).

### 7.6 Minimap cluster (top right)

Keep the composition (`#minimap-wrap`: zone label, clock, coords, compass, zoom, mail and
raid-lockout satellites). Target styling:

- Zone name in display type above the disc; clock and coordinates in metadata type
  (existing `formatClockTime` and `formatMinimapCoords`).
- The map disc is about 204px inside a 220px bronze ring (sized through `MINIMAP_SIZE`):
  circular bronze outer ring, thin bright-gold inner ring, dark inset
  shadow inside the map edge. The cached terrain canvas in `src/ui/minimap_painter.ts` is
  built for this; mind the redraw-interval tier knob when resizing (section 13.1).
- Satellites (zoom pair, mail, raid lockout) become compact circular map buttons
  (section 10.1) hugging the ring's lower arc. The player arrow stays high-contrast at
  every zoom.
- Marker colors stay in the `--color-minimap-*` token family; quest markers stay vivid
  (`--color-quest` lineage), party pips stay class-colored.

### 7.7 Daily Rewards card

The rewards entry (`#daily-rewards-button`) is a 260 x 84 card directly below the
minimap: chest art at left (the existing `/ui/daily-rewards/` WebP), title "Daily Rewards"
in display type, subtitle "Rewards & Cosmetics" in metadata type, whole card clickable,
notification badge top-right when a spin or task reward is claimable.

- Claimable: border brightens to `--color-accent-hover`, low-amplitude glow, chest shimmer
  at most every 4 seconds, badge shows the count. Never pulses during combat.
- Claimed / idle: standard surface, no glow; the card remains the entry point to the store
  surfaces.
- Clicking opens the existing Daily Rewards window (`src/ui/daily_rewards_window.ts`); the
  store entries (WOC Store / Season 1 Armory via `Hud.openWocStore`, Claudium via
  `src/ui/claudium_window.ts`) hang off it unchanged. The card must read as a
  first-party game panel, not an advertisement.
- The gates to preserve: the `dailyRewardsEnabled` flag in the HUD features wiring (set
  from the native-app check in `src/main.ts`) and the `showDailyRewardsChest` setting,
  both applied in `src/ui/hud.ts`. The separate web-only Armory promo banner above chat
  (`src/ui/store_promo_card.ts`, `shouldShowStorePromo`) is RETIRED when the card lands:
  the card supersedes it, and the chat height it reserved comes back.

### 7.8 Objective tracker

`#right-tracker-stack` (quest tracker, deed watch, delve tracker) moves under the rewards
card and adopts the soft-fill panel surface (section 4.4): the stack remains click-through
except its interactive rows, quests keep their 1-based numbering that matches the world
map badges, and thin gold dividers separate quests.

- Display cap (new behavior): the tracker shows the three most recently
  tracked quests, up to three objective lines each; beyond that it appends a "+N more"
  line that opens the quest log. Tracking state itself is unchanged; untracking stays in
  the quest log. Long titles truncate with a tooltip.
- Quest titles in `--color-quest`; objective lines in secondary parchment; progress
  right-aligned tabular numerics; completed objectives flip to success green with a check.
- Clicking a title opens the quest log entry; collapse stays on the header. No expand
  animation during combat.

### 7.9 Utility launcher (the 3 x 2 grid) and the More hub

The utility launcher replaces the `#side-buttons` rail: six 77 x 88 tiles in a 3 x 2
grid, plus a hub for everything else:

| Tile | Window | Default key |
|---|---|---|
| Character | `#char-window` | C |
| Bags | `#bags` | B |
| Quests | `#quest-log-window` | L |
| Map | `#map-window` | M |
| Social | `#social-window` | O |
| More | the hub popover | none |

Tiles: painted icon 36 to 40px, 13px label below, keycap chip bottom-right (live
`keyCapLabel` from `src/game/keybinds.ts`, never a hard-coded letter), selected state on
every open window's tile (the existing multi-window model stays), notification badges for
unspent talent points, unread mail, and bag prompts. The More tile shows a single aggregate
badge dot when any destination inside the hub has one.

The More hub is a compact anchored panel (not a new full window) that organizes every other
destination as list rows or small tiles, grouped:

- Progression: Spellbook (P), Talents (N), Crafting (T), Book of Deeds (Shift+Z).
- Activities: Arena (G), Dungeon Finder (Shift+I), Vale Cup (Y), Leaderboard (K), Event
  Calendar (I), Damage Meters (Shift+H), Town Focus (in town only).
- Community: Emote wheel (X), Discord (U; this row carries the full account-link and rank
  panel behavior of the `#mm-discord` button, not a plain link), plus the GitHub and
  Donate links moved from the old `#community-hud`.

Sound, music, settings, and fullscreen live ONLY in the system-button corner (7.11); they
do not duplicate into the hub. Contextual entries (Town Focus, Discord availability) show
and hide by their existing rules. Keybinds all keep working when the tile is
hidden inside More; the launcher is a surface, not the input map.

### 7.10 Chat

`#chatlog-wrap` keeps its bottom-left anchor, tab model (built-in Chat and Combat Log plus
player channel tabs from `src/ui/hud/chat/chat_channels.ts`), movable and resizable behavior
(`src/ui/hud/chat/chat_window.ts`), and live-region semantics. Target styling and behavior:

- Tab strip in the shared tab style (section 10.2); unread markers on inactive tabs.
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

### 7.11 System buttons (bottom right)

Replace the `#community-hud` details-toggle with four quiet 40px square icon buttons:

- Sound: a mute toggle. New persisted boolean setting (`sfxMuted` or equivalent) composing
  with the existing `sfxVolume` slider (restore-previous-volume semantics), with its
  options row, `t()` keys, and mobile decision.
- Music: the existing `#mm-music` toggle behavior with its muted-slash state.
- Settings: opens the options menu.
- Fullscreen: the existing `fullscreen` setting path through `requestPreferredFullscreen`
  in `src/main.ts`.

Shared icon-button style, no persistent glow. GitHub, Donate, and Discord move into the
More hub's Community group.

### 7.12 Interaction prompt (new component)

A bottom-center prompt above the unit frames: a keycap plus verb plus highlighted target
name ("Speak with Apothecary Lin"). This is a new component (the interact key currently
resolves in the `interactKey()` closure in `src/main.ts`; the click-pick router is
`src/game/interactions.ts`). Build it by the recipe (section 13.2):

- First extract the interact-candidate resolution out of `src/main.ts` (it is a firewall,
  not a home) into a shared module both the key handler and the prompt core consume.
- The prompt is a CADENCED hot-path component: candidate proximity changes with every step,
  so the core re-evaluates on a named cadence and paints through the elided writers inside
  the standing perf budget (`tests/hud_perf_budget.test.ts`).
- Shows only when the interact key would currently do something: keycap (live binding, or
  the controller glyph from `GAMEPAD_BUTTON_LABELS_BY_KIND` when a pad is active), a
  localized verb key per interaction kind (talk, loot, open, gather, mail, bank), and the
  target name via `tEntity`, highlighted in the themed accent.
- One prompt at a time; fade in about 120ms, out about 90ms; never covers the unit frames;
  hold-style interactions may ring the keycap with progress.
- It is additive courtesy information: it must render identically on every graphics tier
  and never becomes the only signal for anything (fairness, section 13.1).

### 7.13 World-space UI: nameplates and markers

Nameplates stay renderer-owned positioned DOM (`src/render/nameplate_view.ts` +
`nameplate_painter.ts`) with their documented colors-as-literals exception and their
declutter pass (`nameplate_declutter.ts`). Restyle within those constraints:

- Names in small caps with the four-way black outline; no panel background on standard
  friendly plates; health bars stay thin (about 76 x 6) with the one-pixel keyline.
- Reaction colors, threat tint, quest `!` and `?` markers, raid marks, combo pips, cast
  bars, guild tags, and badges all keep their slots; the current target's plate is always
  visible and slightly larger, coordinated with the selection ring in the world.
- Shedding policy (new): when plates must shed to resolve overlap, shed in reverse
  priority: other players, neutral NPCs, friends and guild, hostiles in combat, party
  members, quest and interactable NPCs; the current target never sheds. This is additive
  behavior on top of the existing position-nudging declutter pass.
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

Windows are `.window.panel` elements on the shared shell (`src/styles/layout.css`): titlebar
drag (`window_drag.ts`), SE resize grip (`window_resize.ts`, opt-outs in
`NON_RESIZABLE_WINDOW_IDS`), dialog semantics (`markDialogRoot`), focus trap and return
(`FocusManager` via `Hud.windowFocus`), Esc through the single `closeAll` dispatcher, and
the 50-to-89 z-band with `#confirm-dialog` pinned above. None of that changes. The grammar
this program adds is visual:

- Frame: window radius `--radius-window` (new token, 10px), the three-layer gold edge with
  a heavier structural border that is a themed derivation (the border knob darkened one
  step in `themeCssVars`; classic output lands near `--color-gold-800`), strong fill.
- Header: 44px; painted icon at left (24 to 28px), display-type title, optional subtitle or
  currency cluster at right, 34px close button in the shared icon-button style. The sticky
  header keeps its solid `--panel-base` fill.
- Content padding 12 to 16px (`--window-pad` stays the override point); internal section
  dividers use the gold-fade divider (section 10.6).
- Sizing: large windows target `min(80vw, 1280px)` x `min(84vh, 820px)` inside the existing
  `--app-vw` / `--app-vh` clamps, with a practical minimum near 720 x 520; compact windows
  keep their fitted sizes. No radius above 12px on any rectangular control.
- A modal backdrop (`--color-ink-1000` at about 0.6) appears only behind flows that truly
  block (confirm dialogs, the armory-inspect overlay); ordinary windows keep the world
  interactive.

New radius tokens and the existing ones coexist deliberately: `--radius-sm` (4px, chips
and keycaps) and `--radius-md` (8px, HUD panels) stay; `--radius-slot` (5px),
`--radius-button` (7px), and `--radius-window` (10px) are added for their component
families. None retire.

### 8.2 Per-window notes

Every window adopts the grammar; these carry specific intent:

- **Bags / bank** (`bags_window.ts`, `bank_window.ts`): 48px slots on a 4px gap; rarity as
  a restrained border color via the existing `--bag-slot-quality` / `--bank-slot-quality`
  hooks (poor and common keep the neutral socket); stack counts bottom-right, tabular; the
  money footer uses painted coin icons plus `formatMoney`. The vendor-docked and
  bank-docked cluster behavior stays.
- **Character** (`char_window.ts`): paperdoll on the equipment-slot frame family (same
  family as action slots, 52 to 60px), stat labels muted with parchment values, deltas in
  success and danger colors (`item_compare.ts` already computes them).
- **Quest log** (`questlog_window.ts`): category and list at left, detail at right; tracked
  state as a gold pin; reward cards on the item-slot frame.
- **World map** (`map_window_view.ts`, `map_window_painter.ts`): the canvas sits in a
  dark inset frame with a thin gold edge; the zoom controls and any future filters use the
  circular map-button style (section 10.1); pins stay on the `--color-map-*` tokens with
  quest pins vivid; the numbered quest badges keep matching the tracker.
- **Store surfaces** (`daily_rewards_window.ts`, `woc_store_view.ts`,
  `claudium_window.ts`): product art provides the color; cards stay restrained blue-black
  with gold edges; rarity chips reuse the weapon-skin rarity colors; price and balance
  rows use `formatNumber` / `formatMoney` and the wallet components. Claim buttons are the
  one sanctioned gold-fill button (section 10.1).
- **Options** (`options_window.ts` over the declarative `options_view.ts` model): the shared
  form controls (section 10.7) restyle every row for free; new settings this program adds
  (the sound mute, the chat idle state if it needs a knob) enter as declarative entries,
  never bespoke DOM.
- **Book of Deeds, social, spellbook, talents, crafting, market, mailbox, arena, dungeon
  finder, Vale Cup, leaderboard, calendar, meters, trade, inspect, loot settings**:
  grammar plus tokens, preserving each window's existing information design. Talents 2.0
  (`docs/prd/talents-2.0.md`) and the Encounter UI draft
  (`docs/prd/dungeon-mechanic-primitives.md`) inherit this language when built.

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
CSS class family in `src/styles/` plus, where behavior exists, the owning module; never a
per-window re-implementation.

### 10.1 Buttons

Button and tile fills, including their pressed and selected variants, are `themeCssVars`
derivations from the panel and accent knobs, never static ramp values: the ink and gold
names below name their CLASSIC outputs, and on a light preset the fills lighten with the
panel so themed text stays contrast-repaired (section 4.1).

- **Text button** (`.btn`): 34px compact, 40px standard; 12 to 16px horizontal padding;
  one-pixel bronze border, radius `--radius-button`; interactive gradient fill derived
  from the panel knob (classic output spans `--color-ink-800` to `--color-ink-950`);
  label 14px/700.
- **Primary (gold) button**: the claim/confirm emphasis variant; subdued gold-brown fill
  derived from the accent knob mixed toward the panel (classic output near
  `--color-gold-900` over ink), themed accent border, primary text. At most one per
  surface.
- **Icon button** (`.micro-btn` lineage): 40px standard, 34px compact; chrome glyphs via
  `svgIcon` at 20 to 24px. New chrome respects a 36px minimum hit target on desktop, via
  padding where the visual is smaller (the mobile floor stays 40px, section 13.5).
- **Circular map button**: two sizes, one primitive: 40px standard disc (map-window
  controls) and 30px compact disc (minimap satellites, hit target still 36px or more via
  padding); two-ring edge, dark fill, 22px glyph (16px on compact).
- **Launcher tile**: 77 x 88; painted icon, label, keycap chip; selected state uses the
  gold-brown selected fill with a bright top edge.

States, on every variant: hover (fill one tone lighter, border to `--color-accent-hover`,
restrained glow, at most one pixel of lift), pressed (one pixel down, `--color-gold-900`
inner edge, glow off), selected (the derived gold-brown fill, bright top edge, primary
text), disabled
(desaturated, muted text, border contrast reduced, label never removed), keyboard focus,
and loading where async.

Keyboard focus is the existing OUTLINE mechanism, not a box-shadow ring: a steady outline
drawn from the theme-derived `--color-border-focus` with an `outline-offset` gap so it
reads as the gold ring over any fill. That is exactly what
`tests/focus_visible_guard.test.ts` enforces (it is outline-scoped); do not migrate focus
indication to box-shadows, which would escape the guard.

Every interactive element responds visibly within one frame; a cursor change alone is never
feedback. No `transform: scale()` on hover or focus of list, rail, or chip items.

### 10.2 Tabs

32px strip; selected tab in `--color-accent-hover` text with a one-pixel accent underline;
unselected muted parchment, hover to full parchment; dark restrained backgrounds;
roving-tabindex keyboard navigation as already wired in the chat and window tab strips.

### 10.3 Keycaps

One keycap style everywhere a binding is shown (action slots, launcher tiles, the
interaction prompt, options rebind rows): minimum 20px square, dark inset fill,
`--color-gold-600` border on its dark inset (static ramp is legal here), parchment label,
radius `--radius-sm`, one-pixel inner highlight. Labels always come from `keyLabel` /
`keyCapLabel` (or the controller glyph set), never hard-coded characters.

### 10.4 Badges

Notification badges: 16 to 18px circle, `--color-danger` fill, one-pixel parchment or gold
edge, 10px bold tabular count, may overlap its parent by up to 5px. Used by mail, bags,
talents, and the rewards card; one badge component, not four.

### 10.5 Progress bars

Dark track, one-pixel black keyline, colored fill with a one-pixel top highlight, centered
tabular text when height allows. Fill colors by meaning: theme resource knobs for
health/resource, `--color-xp` for experience, gold for cast bars (blue channel variant),
school tints for debuff timers. This covers unit frames, cast bars, swing timer, XP, and
window-internal meters alike.

### 10.6 Tooltips and dividers

The single shared `#tooltip` box (lazy content, owner-tracked by `SharedTooltipOwner`)
adopts the strong fill, 10px padding, max-width 320px, title in `--color-accent-hover`,
body in secondary parchment, metadata muted; about 250ms hover delay, none on keyboard
focus; never covers the cursor or the focused slot. Dividers are one-pixel gold fades
(`transparent, accent at 0.38, transparent`), replacing the assorted literal brown-hex
borders in `hud.css` and `components.css`.

### 10.7 Form controls

The MMO-styled native controls in `base.css` (range, checkbox, select, textarea) plus
`settings_controls.ts` restyle onto the tokens: 38px inputs on the strong fill with bronze
borders and themed focus; 18px checkboxes with a gold check; toggle switches with a themed
active thumb; 4px slider track with gold fill to an 18px ringed thumb; the 16px mobile
input floor stays. Scrollbars: 8px wide, transparent track; the thumb and border colors
are theme-derived, so their retune (rest near `--color-gold-800`, hover near
`--color-gold-500` on the classic preset) lands in the `themeCssVars` derivation constants
in `src/ui/theme.ts`.

## 11. Motion

### 11.1 Durations and easing

New duration tokens in `tokens.css` (the current single `--transition-speed` is too slow
for chrome):

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
allowlist in `tests/architecture.test.ts`. Per-frame code writes DOM only through the
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
no literal hexes in painters, theme coupling through `themeCssVars`. New shared vocabulary
(a z-index scale, scrim tokens, drawer or sheet grammar) lands as part of the phase that
needs it, as one reviewed change, never as a standalone fragment.

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

## 15. Rollout phases

Each phase is independently shippable, gate-green, and screenshot-documented. Order
matters; later phases assume earlier vocabulary.

1. **Foundation: tokens, theme, type.** New ramp tokens and themed derivations; retuned
   `classic` preset knobs and `themeCssVars` derivation constants (including scrollbars
   and `--panel-fill-strong`); re-pin the shipped-palette cases in `tests/theme.test.ts`;
   the `--panel-border` and `--color-text-secondary` latent-token fixes; self-hosted fonts
   with the `--font-brand` split and the display-face switch to Alegreya; duration and
   radius tokens. Every screen, desktop and mobile, shifts tone at once; this phase
   deliberately contains no layout change. Update `src/styles/CLAUDE.md` to point at this
   document when it lands.
2. **Chrome: surfaces and primitives.** `.panel` / `.window` edge recipe, buttons, tabs,
   keycaps, badges, bars, tooltip, scrollbar derivation, form controls, dividers; retire
   the literal brown-hex borders in `hud.css` / `components.css` onto tokens.
3. **Right rail.** Minimap ring growth with the aura-bar re-pin, Daily Rewards card (and
   retirement of the web promo banner), tracker restyle with the display cap, the 3 x 2
   launcher plus More hub, retirement of the micro-button rail and `#community-hud`, the
   new system-button corner with the sound-mute setting. No `LAYOUT_RESET_EPOCH` bump is
   expected here (the rail owns no player-persisted positions); that is a decision, not an
   omission.
4. **Center stage.** Unit frame restyle and the target frame's move to bottom-center
   (with the `LAYOUT_RESET_EPOCH` bump and the retirement of the party `below-target`
   shift), party header and row states, action bar and XP polish, the interact-resolver
   extraction plus the new interaction prompt, chat restyle with the idle/focus state,
   FCT and banner typography.
5. **Windows.** The window grammar applied window-by-window, starting with the highest
   traffic (bags, character, quest log, map, options), then the long tail through the
   store surfaces and the remaining overlays.
6. **Echoes.** Nameplate polish and the new declutter priority policy within the renderer
   constraints; update the guide's `--g-*` and the editor's mirrored token blocks to the
   new palette; the mobile LAYOUT program picks up from here as its own document.

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

| Surface (element) | Disposition | Phase |
|---|---|---|
| `#target-frame` | Restyle; MOVE to bottom-center (7.2) | 4 |
| `#party-frames` | Restyle; add header, invite, targeted and ready-check states (7.3); `below-target` shift retires | 4 |
| `#player-frame`, `#petbar`, `#xpbar`, `#actionbar`, `#actionbar2`, `#actionbar3`, consumable slots | Restyle (7.2, 7.4) | 4 |
| `#castbar`, `#swingbar` | Restyle (10.5) | 4 |
| `#buff-bar`, `#debuff-bar` (+ `aurasOnPlayerFrame` mode) | Restyle chips (phase 2); re-pin beside the grown minimap (7.5) | 2, 3 |
| `#minimap-wrap` cluster (zone label, disc, clock, coords, compass, zoom, `#mail-indicator`, `#raid-lockout`) | Restyle; disc grows, satellites go circular (7.6) | 3 |
| `#right-tracker-stack` (`#quest-tracker`, `#deed-tracker`, `#delve-tracker`) | Restyle; move under rewards card; display cap (7.8) | 3 |
| `#side-buttons` micro-rail | RETIRE; replaced by launcher + More hub (7.9) | 3 |
| `#daily-rewards-button` | REBUILD as the rewards card (7.7) | 3 |
| `#community-hud` | RETIRE; links move to the More hub; corner becomes system buttons (7.11) | 3 |
| Web store promo banner (`store_promo_card.ts`) | RETIRE; superseded by the rewards card (7.7) | 3 |
| `#chatlog-wrap` (tabs, log, `#chat-input`) | Restyle; new idle/focus state (7.10) | 4 |
| Interaction prompt | NEW (7.12) | 4 |
| `#nameplates` layer | Restyle within renderer constraints; new declutter priority (7.13) | 6 |
| FCT pool (`.fct`) | Type restyle only (7.14) | 4 |
| `#banner`, `#quest-banner`, `#subzone-banner`, `#error-msg`, `#prompt-stack` | Restyle (7.14) | 4 |
| `#low-health-vignette`, `#death-overlay`, `#ghost-prompt` | Restyle; flows unchanged | 4 |
| `#tooltip`, `#ctx-menu` | Restyle (10.6) | 2 |
| `#confirm-dialog` | Restyle on the window grammar (8.1) | 2 |
| Emote wheel | Restyle | 4 |
| `#meters-window` | Restyle; gains a More hub entry (7.9, 8.2) | 5 |
| All `.window` feature windows (8.2 list) | Window grammar | 5 |
| `#loot-window`, `#quest-dialog`, delve board and rite panels, lockpick panel | Window grammar | 5 |
| `#arena-status`, `#vcup-indicator`, spectate badge, reconnect overlay, tutorial cards | Restyle | 5 |
| Discord surfaces (`#mm-discord` panel behavior, `#discord-window`, index-only CTA) | Panel behavior moves into the More hub (7.9); window restyles | 3, 5 |
| `#perf-overlay`, `#click-move-marker`, skip links, live regions | Unchanged | n/a |
| Mobile touch controls and sheets | Restyled by the shared tokens, theme, type, and chrome phases (with mobile screenshots per 13.6); mobile LAYOUT is a separate program | 1, 2, 4, 5 |
