<!-- src/styles/ - extracted HUD CSS (tokens + @layer order). Local detail only; the
     no-em-dash/ASCII rule, the IWorld seam, and "files-can-be-huge" live in root
     CLAUDE.md. The painters that drive these tokens are in src/ui (see src/ui/CLAUDE.md). -->

# src/styles/ - extracted HUD CSS (tokens + layers)

All game CSS for the two game entries (`index.html` + `play.html`), extracted from the old
inline `<style>` blocks into one directory under a single `@layer` order, imported
once from `src/main.ts` via the `index.css` barrel (admin/guide keep their own entries). No
CSS framework; hand-authored, Lightning-compiled.

## Module shape and the @layer order
`index.css` is the barrel: it declares ONE `@layer` order and `@import`s every module in
that order. Modules, in cascade order:
| Layer | Module | What it is |
|---|---|---|
| `tokens` | `tokens.css` | `:root` design tokens + `--color-*` / `--fx-*` defaults |
| `base` | `base.css` | element + reset + base-tier glyph styling + the a11y skip/forced-colors/print sections |
| `layout` | `layout.css` | the generic `.window` centering/shell |
| `components` | `hud.css`, `components.css` | in-world HUD chrome; feature-window bodies (BOTH target `@layer components`; `components.css` is imported last so its window bodies win same-layer ties) |
| `hud` | (reserved, empty) | declared in the order but unused; `hud.css` targets `@layer components`, not this slot |
| `shell` | `shell.css` | desktop pre-game shell + char-select |
| `hud-mobile` | `hud.mobile.css` | the in-game mobile-touch block, ordered AFTER `shell` so in-game mobile overrides of pre-game shell elements win |
| `index-extra` / `play-extra` | `index.extra.css` / `play.extra.css` | per-entry only (a `<link>` in index.html / play.html, not the barrel): the `#rotate-device` orientation gate; the wiring is guarded by `tests/per_entry_css_wiring.test.ts` |

Flat layer names (`hud-mobile`, not `hud.mobile`): a DOT in a `@layer` name is a SUBLAYER,
which silently reorders the cascade. The completeness of the section set is guarded by
`tests/css_corpus.test.ts` (the ten-dash `/* ---------- name ---------- */` banner manifest;
a four-dash fence is NOT a boundary, so authoring one would silently drop the section from
the corpus; corpus = the inline `<style>` UNION `src/styles/*.css`). The barrel's `@import`
set + order is guarded by `tests/styles_extraction.test.ts`, and `tests/css_value_validity.test.ts`
globs every module for malformed declarations (e.g. a stray token after `var()`, which makes
the whole declaration silently drop in the browser).

## Token system + NO magic values in painters
- **Tokens, not literals.** Colors, accents, and tunables live as `--color-*` / `--fx-*`
  custom properties in `tokens.css`. A painter (`src/ui/*_painter.ts`) drives those tokens /
  CSS vars and NEVER hard-codes a hex/px/color in TS; thresholds and cadences (the
  100/250/500ms frame dividers, breakpoints) are named constants. The 2D-CANVAS painters
  (`map`/`minimap`/`delve`) resolve `--color-*` via `getComputedStyle` and CACHE the result
  (a 2D context can only read a CSS var this way; the minimap caches for the whole session,
  with a documented hook to invalidate on a future theme/contrast toggle), never per-marker.
  Documented exceptions: `nameplate_painter` is positioned DOM divs that move pre-existing
  renderer hex literals verbatim (not tokens); `arena_window` renders DOM from the
  stylesheet, not canvas. Guarded by the per-painter no-magic source scans (e.g.
  `tests/auras_painter.test.ts`, `tests/minimap_painter.test.ts`,
  `tests/action_bar_painter.test.ts`) and `tests/focus_visible_guard.test.ts`; there is no
  single central no-magic guard, each migrated painter scans its own source.
- **Graphics-tier `--fx-*` tokens.** `tokens.css` seeds `--fx-shadow` / `--fx-ambient-anim` /
  `--motion-scale`; the low tier drops the glass rule and the heavy-shadow buckets so a
  cheaper preset costs less to composite. Tier resolution is gameplay-neutral (the cosmetic
  richness a preset sheds, never actionable info; root `CLAUDE.md`). Guarded by
  `tests/ui_effects_profile.test.ts` (the static-preset resolver) and
  `tests/ui_effects_wiring.test.ts` (the `:root` seeds + tier rules cannot vanish from source).
- **Accent themes, default dark.** `src/ui/theme.ts` computes the runtime `--color-*` accent
  vars (`themeCssVars`), applied by `applyTheme()` in `src/main.ts`. The default is the
  dark-fantasy aesthetic and there is NO `prefers-color-scheme` auto-adaptation, but the
  theme picker offers user-selectable presets (`classic` / `midnight` dark plus a light
  `parchment` and a `highContrast` preset). The only AUTOMATIC contrast adaptation is
  `@media (forced-colors: active)` (borders + focus ring survive via system colors). Guarded
  by `tests/theme.test.ts` (every preset defines every knob with a valid hex and readable
  WCAG contrast) and `tests/client_shell.test.ts` (no `prefers-color-scheme`).

## Browser matrix
- **Floor (enforced today):** the big-3 desktop PLUS mobile Safari/WebKit as a first-class
  target, pinned in `.browserslistrc` (Chrome/FF/Safari/iOS minimums) and fed to Lightning
  via the zero-dep parser (`scripts/browserslist_targets.mjs`, guarded by
  `tests/browserslist_targets.test.ts`); no `browserslist` npm dep. A `forced-colors` pass
  and a MINIMAL `@media print` reset (hide `#game-canvas`/`#ui`/`#nameplates`, no reflow; a
  full-screen game has no print layout) ship in `base.css`. The Lightning `backdrop-filter`
  minification drop (the `-webkit-` twin must survive next to the standard property) is
  guarded by `tests/backdrop_filter_survival.test.ts` + `scripts/check_backdrop_survival.mjs`
  (run by `npm run build` over the emitted CSS).
- **Cross-engine E2E (prototyped, NOT landed):** `vitest.browser.config.ts` is chromium-only
  today; the Chromium/Firefox/WebKit + mobile-WebKit matrix is an OPTIONAL standalone re-land.

## Bundle discipline (MEASURED then DECLINED)
A JS bundle-budget CI gate + selective lazy-load were prototyped and proven, then DECLINED on
the evidence (the eager JS is i18n-data-dominated; lazy-loading the two heaviest cold windows
saved only ~1.5% gzip with zero FPS impact). There is NO bundle-budget gate and NO lazy-loaded
window; every cold window stays eagerly imported. Do not re-attempt without new evidence that
the i18n-data-dominated bundle has materially changed.

## Pointers
Root `CLAUDE.md` (repo-wide invariants incl gameplay-neutral graphics) ·
`src/ui/CLAUDE.md` (the painters that drive these tokens + the a11y / per-frame / canvas-performance contracts).
