<!-- src/ui/ — classic HUD, i18n, procedural icons. Local detail only; the
     IWorld seam, dependency rules, and "files-can-be-huge" convention are in
     root + src/ CLAUDE.md — don't repeat them here. -->

# src/ui/ — classic HUD, i18n, procedural icons

The classic-MMO HUD: unit/party frames, action bar, all windows, tooltips,
world map + minimap, combat log, floating combat text. Plus the locale table and
runtime-drawn icons.

## How this area works
- **Plain DOM + canvas, no UI framework.** The HUD queries pre-existing DOM
  (`$('#…')` → `index.html`) and builds the rest with `innerHTML` /
  `createElement`. There is no virtual DOM, reactivity, or component lib.
- **Reads from / acts through `IWorld` only** (`world_api.ts`). The HUD renders
  world state and dispatches every player action through `IWorld`; it never
  imports `Sim`/`ClientWorld` (see src/ CLAUDE.md). It also takes `Renderer` +
  out-of-band glue via `OptionsHooks`/`ReportHooks` wired by `main.ts`.
- All HTML interpolation goes through `esc()`. **Never `innerHTML` raw
  player/server text** — names, chat, guild names, etc. must pass through `esc`.

## UI/UX, mobile & accessibility standards
The HUD ships to real players on desktop **and** phones, so every visible control is
held to these — verify in mobile portrait *and* landscape before calling UI work done.
- **Aesthetic:** premium dark-fantasy theme (deep darks, gold-brown accents, rich
  borders); avoid default browser-chrome looks. **No raw emojis as in-game icons** —
  use the procedural `icons.ts` recipes (below) or real art. Transitions are smooth
  and interruption-safe (cross-fades), never causing layout shift.
- **Layout stability:** content updates must not resize the parent, jump, or clip.
  Prefer `width:100%` + `max-width` over viewport units like `92vw` (they overflow
  once margins/padding are added). Flex/grid + fluid type; no ad-hoc inline styles.
- **Mobile touch** (gate on touch capability / runtime state, not only `max-width` —
  landscape phones need it too):
  - Every visible `input`/`select`/`textarea` is **≥16px** font, or iOS Safari
    auto-zooms the page on focus (iOS 10+ ignores the viewport `user-scalable=no`/
    `maximum-scale`, so font-size is the only reliable fix). This is enforced centrally
    by a `@media (pointer: coarse) { input, textarea, select { font-size: 16px !important } }`
    floor in `index.html` (mirrored in `admin.html`), so new controls are covered for free
    even when their own rule out-specifies a plain catch-all; the `!important` is what
    wins. Don't set a per-control mobile font below 16px, and don't lean on the viewport
    scale-lock. Regression check: `node scripts/mobile_input_zoom_check.mjs` (needs `npm run dev`).
  - Every tappable target (buttons, links, selects, tabs, icon-only controls, anything
    with `role="button"|"tab"|"option"`) is **≥40×40px**.
  - Narrow headers collapse to a hamburger drawer rather than wrapping/overflowing.
- **Accessibility (WCAG 2.1 AA):** full keyboard operation (Tab/Shift+Tab/Enter/Space);
  high-contrast `:focus-visible` on every custom interactive element; correct
  semantics / ARIA (`role`, `aria-selected`, `aria-pressed`, `aria-invalid`,
  `aria-describedby`, `tabindex`); honor `prefers-reduced-motion` (drop cross-fades,
  content translations, camera auto-rotate); **no `transform: scale()` on hover/focus**
  of list/rail/chip items (motion-sickness trigger); text contrast ≥4.5:1 (≥3:1 large).
  Accessible names are still `t()` keys (see i18n below).

## hud.ts navigation map (one class `Hud`)
Every region is fenced by a `// ----` banner, so jump by grepping the banner (or the
named method) rather than a line number. `update()` is the per-frame entry;
`handleEvents(events)` feeds log/FCT/audio/banners (`onEvent` is a method on the
`meters` helper, not `Hud`). Regions in file order:
| Region |
|---|
| Fields / constructor / `OptionsHooks`,`ReportHooks` |
| Chat tabs / emote wheel |
| Portraits (canvas paint lives in `unit_portrait*`), icons, tooltips, money |
| Action bar (`hotbarActions`, `slotMapKey`, `BAR_ABILITY_SLOTS`, click/keybind dispatch) |
| Frame update (unit/target/combat state) |
| Minimap & world map (`toggleMap`, zone band) |
| Ashen Coliseum arena panel (`toggleArena`) |
| Events → log / FCT / audio / banners |
| 2v2 Fiesta HUD (score, respawn, augment picks) |
| Quest dialog (gossip) · Loot · Vendor |
| World Market (auction house: browse/sell/collect) |
| Bags · Character window · Spellbook |
| Confirm dialog + in-app text-input modal (replaces native `prompt`) |
| Talents & Specializations panel ('N', staged-edit + loadouts) |
| Quest log · Party frames · Player context menu |
| Social panel (friends/guild/ignore, online) |
| Prompts (party/trade/duel) · Trade window |
| Options menu (Esc) + keybind rebinding |
Toggle/open methods (`toggleBags`, `openVendor`, `openContextMenu`, …) are the
public surface `main.ts`/input call.

**New self-contained windows go in their own module, not a new banner section.**
`hud.ts` is the worst monolith to grow: a new window or panel that does not need `Hud`'s
private per-frame state belongs in its own `src/ui/` module the HUD composes (the
direction the HUD modularization is heading; see the root Modularity section). The pure
painters (`unit_portrait*`, `xp_bar.ts`) are the template: a host-agnostic core a Vitest
drives directly, plus a thin DOM/canvas consumer.

## i18n - IMPORTANT (sparse-overlay model; contributors add ENGLISH ONLY)
The locale data is split across files. Touch the right one:
- `i18n.catalog/` (nested) is the **authoritative source catalog** and drives
  `TranslationKey = Leaves<typeof en, 6>`, the dotted-path type every `t()` call uses.
  It is a directory of English-valued domain modules (`shell.ts`, `hud.ts`,
  `hud_chrome.ts`, `abilities.ts`, `quests.ts`, `items.ts`, `game.ts`, `merge.ts`) plus
  `index.ts`, the barrel that assembles + exports `en`. Add a new English string in the
  matching domain module (was the single `i18n.en.ts` before the i18n.catalog domain split).
- `i18n.locales/<lang>.ts` are the 13 non-English **flat sparse overlays**
  (`Partial<Record<TranslationKey,string>>`), the ONLY files a translator edits. An
  omitted key is filled from English by the build and marked `pending` in the registry.
- `i18n.resolved.generated/` is the **generated dense table** the runtime imports — a
  directory of one dense per-locale slice + `index.ts` (barrel), `loaders.ts`
  (`LOCALE_LOADERS` + `SUPPORTED_LANGUAGES`), `pending.ts`, and the dev-only `en_XA.ts`
  (do not hand-edit). It is committed; regenerated by `npm run i18n:build`.
  `i18n.status.json` is the **registry** (translated/pending/blocked), regenerated by
  `npm run i18n:scan` but **gitignored** (~5 MB) — only the counts-only
  `i18n.status.summary.json` is committed.
- `i18n.ts` is the thin runtime: `t()`, `tOptional`, `tPlural` (CLDR cardinal plurals),
  `hasTranslation`, formatters (`formatNumber`/`formatDateTime`/`formatMoney`/`languageTag`),
  `getLanguage`/`setLanguage`/`isSupportedLanguage`, `supportedLanguages`. **The locale set
  derives from `SUPPORTED_LANGUAGES` in the generated `loaders.ts`** (14 = en + 13), not a
  `translations` map; add a code there (via the source overlays + regenerate) to make a
  locale selectable. **Lazy locale flip:** only `en`/`en_XA`/`pending`/`loaders` are eager;
  the 13 non-en slices load on demand via `await ensureLocaleLoaded(lang)` (one dynamic
  `import()` per content-hashed chunk; `prefetchLocale`/`isLocaleResident` complete the
  surface). `setLanguage` is synchronous and does NOT load — `main.ts` awaits
  `ensureLocaleLoaded` before localized paint and before each picker switch.

**Merge conflicts in the committed generated artifacts** (`i18n.status.summary.json`
is the usual one; also `i18n.resolved.sha256` and any `i18n.resolved.generated/` slice)
are **never hand-resolved**. Take either side to clear the markers, then run
`npm run i18n:gen` (build + admin + scan) to regenerate every committed artifact from
the merged source-of-truth (the `i18n.catalog/` modules + `i18n.locales/` overlays) and
`git add` the result. The output is deterministic, so a second `npm run i18n:gen` must
leave the tree clean — that idempotency is your proof the resolution is right (and the CI
i18n:gen freshness step checks the same thing). A rising `pending` count after merging a
`release/**` branch into a feature branch is expected (its new content is not yet
translated) and is fine at the PR-tier gate.

`t(key)` **throws on an untracked key in dev/test**, renders English for a `pending`
key on **non-release builds only**, and **hard-fails a pending key on a release build**
(`isReleaseBuild()` = `I18N_RELEASE=1` or `import.meta.env.PROD`). The HUD is fully
localized; prefer `t()` for new user-facing strings.

**Contributor workflow (add a player-visible string): add ENGLISH ONLY:**
1. Add the key to `en` (the matching `i18n.catalog/<domain>.ts` module) and render it
   through `t()`. **Never edit the 13
   `i18n.locales/<lang>.ts` overlays, and never put English/`// TODO`/a placeholder
   into one as a fake translation.** Leave the key omitted; the build English-fills it
   and the registry marks it `pending`. (Translating 13 locales per PR would drain
   small-plan token budgets; the maintainer batch-fills them at release.)
2. If the string originates in `src/sim/` or `server/` (which stay language-agnostic),
   register a matcher RULE in the table matching the emit's ORIGIN (`sim_i18n.ts` for a
   `src/sim/` emit, `server_i18n.ts` for a `server/` emit; the two are parallel mirrors)
   in the SAME change. The S3 guard accepts recognition by either matcher and fails if a
   new emit is recognized by neither.
3. Run `npm run i18n:scan` (and `npm run i18n:build`; if the resolved table changed,
   also `npm run i18n:hash -- --write`) and commit the regenerated files.
4. Open the PR. It is green at the **PR-tier gate** (no `I18N_RELEASE_TIER`), which does
   not require translations; `tsc` + the `t()` untracked-key throw still guarantee
   English completeness.

The maintainer fills the `pending` slice at release time via `npm run i18n:worklist`,
then ships from `release/**` where the **release-tier gate** (`I18N_RELEASE_TIER=1`)
hard-fails on any `pending` row. Run `I18N_RELEASE_TIER=1 npm test` locally to dry-run
that gate.
Full contributor + maintainer flow and the locked-terms glossary:
`docs/i18n-scaling/translation-workflow.md`.

**Where to put a new client key (catalog-domain gotcha).** Every catalog domain
EXCEPT `hud_chrome.ts` carries tsc-ENFORCED inline per-locale data (`shell`, `hud`,
`quests`, `items`, `abilities` hold inline `en:`/`es:`/… blocks; `game` uses parallel
`gameStrings<Lang>: typeof gameStrings` consts; `merge.ts` cross-refs), so adding a key
to one of their `en` blocks red-fails `tsc` (TS2719) until you fill every non-en block
too. For new HUD chrome, **add the key to `i18n.catalog/hud_chrome.ts` instead**
(namespace `hudChrome.*`): it is the ONLY English-only domain (a flat object, no
per-locale blocks), so an English-only add compiles and the translations live solely in
the overlays. **Never add `as const` to a catalog-domain object** — it narrows the
literal types and breaks the `en_XA` pseudo-locale.

**Formatters, not hand-built numbers.** Every user-visible number/date/percent/
coordinate/duration goes through `formatNumber` / `formatDateTime` / `formatMoney`
(this dir's `i18n.ts`). To keep English byte-identical to a historical hand-rolled
form, pass `useGrouping: false` + matching fraction-digit options (see `coords.ts`,
`meters.ts`, `xp_bar.ts`, `clock.ts`); units that reorder per locale go in a `t()`
key with the digits spliced as a `{placeholder}` (e.g. `hudChrome.meters.*`).

**Three client-side matchers re-localize `src/sim`/`server` English** (these stay
language-agnostic): the hud-local arms `localizeErrorText`/`localizeSystemText`/
`localizeLootText` (→ `t()` keys), then `server_i18n.ts` (`localizeServerText`), then
`sim_i18n.ts` (`localizeSimText`). They run in that order; the S3 drift guard
(`tests/localization_fixes.test.ts`) accepts recognition by any of the three. Dev-
channel text (`console.*`, thrown errors) stays English and is NOT matched.

**Entity & talent names** localize through their own resolvers here, not raw `t()`:
`world_entity_i18n.ts` is the single ENGLISH source for mob/NPC/quest/zone/dungeon
names + narratives (its `.en` slice spreads into the catalog); `entity_i18n.ts`
(`tEntity`) localizes those at runtime; `talent_i18n.ts` localizes talent
titles/descriptions. A new world/talent name belongs in `world_entity_i18n.ts` (or the
talent source), with the translations living in the overlays like any other key.

## icons.ts — procedural, no image files
Icons are composed on a canvas at runtime and cached as PNG data URLs — there are
**no icon image assets**. Public API: `iconDataUrl(kind, id, size)` where `kind`
is `'ability' | 'item' | 'aura' | 'crest'`; plus `QUALITY_COLOR`.
Each icon is a recipe: `{ bg, pal, prims, fx? }` (`IconRecipe`) drawn over a
`BACKGROUNDS` radial + `PALETTES` tint with vector `PRIMITIVES` and optional `FX`.
Unknown ids fall back via `abilityFallback`/`itemFallback` (school + name
keywords), so every id always renders.
- **Add an icon for a known id:** add an entry to `ABILITY_RECIPES` /
  `ITEM_RECIPES` / `AURA_RECIPES` / `CREST_RECIPES` using the `r(bg, pal, prims, fx?)` helper
  (e.g. `r('fire','blood',['sword','flame'])`; `TL/TR/BL/BR/BIG` are placement
  shorthands). New visuals need a new `PRIMITIVES` painter (centered at 0,0,
  ~100×100 space, r≤36, light top-left).

## Small modules
These are the **pure-core + thin-consumer** split the root CLAUDE.md Conventions
ask for: presentation/domain logic lifted out of `hud.ts` into a small,
host-agnostic module a Vitest test imports directly, with the DOM/canvas side kept
thin. Follow this shape for new/updated features whose logic is worth reusing or
unit-testing.
- **unit_portrait.ts** / **unit_portrait_painter.ts**: the circular
  player/target-frame portrait. The pure core (`unit_portrait.ts`, DOM-free,
  unit-tested in `tests/unit_portrait.test.ts`) holds the geometry + crest-id
  resolution: HiDPI backing-store sizing (`portraitBackingPx`), crest
  overscan-to-fill the disc (`overscanRect`/`CREST_OVERSCAN`), and family/NPC
  crest ids (`crestIdForEntity`). The painter (`UnitPortraitPainter`) is the thin
  consumer: DPR-aware canvas backing store, crest/headshot blit, decoded-image
  cache. Player and target frames share one implementation; `hud.ts` only routes
  the framed unit to it. Screenshot harness: `scripts/target_frame_visual.mjs`.
- **xp_bar.ts** — pure `xpBarView()`, no DOM (snapshot-tested). Shows the
  post-cap **virtual level** `Lv 20 (+N)` + lifetime total when overflow is on;
  classic "MAX LEVEL" when off. See `virtualLevelProgress` in `sim/types`.
- **meters.ts** — DPS/HPS/threat meters, encounter-segmented; threat reads
  the mob's real `entity.threat` hate table. Uses `performance.now()` (UI timing
  only — fine here; that ban is sim-only).
- **player_context_menu.ts** — pure `chatPlayerContextActions()` returning
  whisper/invite/friend/ignore/report actions for the right-click-player menu.
- **auth_utils.ts** — login/char-select form helpers: password toggle, ARIA
  validity sync, `validateCharacterName` (mirrors the server regex).
- **stat_tooltip.ts** / **stat_tooltip_view.ts**: the character-screen (C panel)
  stat hover tooltips. The pure **core** (`stat_tooltip.ts`, DOM/i18n-free,
  reconciled against `recalcPlayerStats` in `tests/stat_tooltip.test.ts`) builds the
  structured `StatTooltipModel` (which class-aware effect lines a stat contributes
  and their live values) and exposes `weaponDps`. The pure **view**
  (`stat_tooltip_view.ts`, unit-tested in `tests/stat_tooltip_view.test.ts`) turns a
  model into the floating tooltip HTML, the visually-hidden aria breakdown, and the
  focusable `statCellHtml` markup, taking i18n + `formatNumber` as an injected
  `StatTooltipI18n` so it never imports the runtime. `hud.ts` is the thin consumer:
  `statModel()` bridges the live sim to the core, then it hands the model to the view.
- **esc.ts**: the one canonical HTML escaper (`esc`) for innerHTML / attribute
  interpolation, shared by `hud.ts`, `portrait_chip.ts`, and the small view modules
  (the src/ui rule "all HTML interpolation goes through `esc()`"); escapes `& < > " '`.
