<!-- src/ui/: classic HUD, i18n, procedural icons. Local detail only; the
     IWorld seam, dependency rules, and "files-can-be-huge" convention are in
     root + src/ CLAUDE.md, don't repeat them here. -->

# src/ui/: classic HUD, i18n, procedural icons

The classic-MMO HUD: unit/party frames, action bar, all windows, tooltips,
world map + minimap, combat log, floating combat text. Plus the locale table and
runtime-drawn icons.

## How this area works
- **Plain DOM + canvas, no UI framework.** The HUD queries pre-existing DOM
  (`$('#…')` from `index.html`) and builds the rest with `innerHTML` /
  `createElement`; no virtual DOM, reactivity, or component lib.
- **Reads from / acts through `IWorld` only** (`world_api.ts`, see src/ CLAUDE.md);
  it never imports `Sim`/`ClientWorld`. It also takes `Renderer` + out-of-band glue
  via `OptionsHooks`/`ReportHooks` wired by `main.ts`.
- All HTML interpolation goes through `esc()`. **Never `innerHTML` raw
  player/server text**: names, chat, guild names, etc. must pass through `esc`.

## UI/UX, mobile & accessibility standards
The HUD ships to real players on desktop **and** phones, so verify every visible control in
mobile portrait *and* landscape before calling UI work done.
- **Aesthetic:** premium dark-fantasy theme (deep darks, gold-brown accents, rich borders);
  avoid default browser-chrome looks. **No raw emojis as in-game icons**: use the procedural
  `icons.ts` recipes (below) or real art. Transitions are interruption-safe cross-fades, never
  causing layout shift.
- **Layout stability:** content updates must not resize the parent, jump, or clip. Prefer
  `width:100%` + `max-width` over viewport units like `92vw` (they overflow once
  margins/padding are added). Flex/grid + fluid type; no ad-hoc inline styles.
- **Mobile touch** (gate on touch capability / runtime state, not only `max-width`: landscape
  phones need it too):
  - Every visible `input`/`select`/`textarea` is **>=16px** font, or iOS Safari auto-zooms the
    page on focus (it ignores the viewport `user-scalable=no`/`maximum-scale`, so font-size is
    the only reliable fix). Enforced centrally by a `@media (pointer: coarse) { input, textarea,
    select { font-size: 16px !important } }` floor in `index.html` (mirrored in `admin.html`);
    the `!important` is what wins. Don't set a per-control mobile font below 16px. Regression
    check: `node scripts/mobile_input_zoom_check.mjs` (needs `npm run dev`).
  - Every tappable target stays **>=40x40px** on mobile touch (the preferred floor); 24x24px
    (WCAG 2.2 SC 2.5.8) is the absolute minimum, used only where 40x40 is genuinely infeasible.
    Do NOT weaken the 40x40 floor to 24px.
  - Narrow headers collapse to a hamburger drawer rather than wrapping/overflowing.
- **Accessibility (WCAG 2.2 AA):** correct semantics / ARIA, high-contrast `:focus-visible` on
  every custom interactive element, honor `prefers-reduced-motion` (drop cross-fades, content
  translations, camera auto-rotate); **no `transform: scale()` on hover/focus** of list/rail/
  chip items (motion-sickness trigger). Accessible names are still `t()` keys (see i18n below).
- **HUD-chrome WCAG 2.2 AA contract.** The chrome (windows, buttons, forms, menus, chat,
  tooltips) is in scope; the 3D world / game canvas is OUT of scope (not screen-readable, never
  faked with aria). On top of the per-control basics:
  - **Focus management:** opening a window TRAPS Tab/Shift+Tab inside it and RETURNS focus to the
    opener on close, via the one shared `FocusManager` (`src/ui/focus_manager.ts`, exporting
    `FocusManager` + `FOCUSABLE_SELECTOR`), which `Hud` drives through `windowFocus(rootSel)`.
    The trap intercepts Tab ONLY when focus is already inside (Tab is the game's target-nearest
    key, so an unconditional trap would hijack it). Esc stays with the single `closeAll`
    dispatcher, not the manager.
  - **Visible focus that never animates away:** every outline-based `:focus-visible` ring is
    steady and drawn from a token / system color, never a raw hex, never transitioned off.
  - **Skip links** ("Skip to Main HUD" / "Skip to Chat") are the first focusable elements;
    **live regions** announce chat (`#chatlog` role=log) and combat (off-screen `#combat-live`
    role=status, throttled per type).
  - **`forced-colors: active`** is the only AUTOMATIC contrast adaptation (no
    `prefers-color-scheme` auto-switch): borders + the focus ring survive via system-color
    keywords. (The theme picker also offers user-selectable presets; see `src/styles/CLAUDE.md`.)
  - **No viewport scale-lock:** `user-scalable=no` / `maximum-scale` are dropped; the 16px
    input-font floor is the anti-zoom guard.
  - Enforced always-on by the `tests/focus_*` / `live_region_politeness` / `combat_announcer` /
    `client_shell` suites; the axe-core + keyboard-reachability + rendered target-size checks are
    the opt-in browser suite (`npm run test:browser`, chromium-only locally).

## Per-frame performance contract (write-elision + tiering)
Per-frame HUD code (anything reached from `Hud.update()`) holds these:
- **Write-elision.** Every per-frame DOM write goes through the host's elided writers
  (`setText`/`setDisplay`/`setTransform`/`setWidth` + the multi-slot `setStyleProp`/
  `toggleClass`/`setAttr`), bound over the private `hotWriteCache` field in `src/ui/hud.ts`
  and exposed to painters via `src/ui/painter_host.ts` (`PainterHostWriters` /
  `makeWriterFacet`). The cache key is byte-identical so an unchanged value skips the DOM.
  ALSO elide the expensive upstream RESOLVE, not just the write: diff a stable key and re-run
  the costly producer (icon data-URL, image decode, tooltip HTML) only when the key changes
  (`action_bar_painter` `lastIcon`, `auras_painter` `lastIconKey`, `unit_portrait_painter`
  `imgCache`). A painter NEVER calls `el.textContent =` / `style.*` / `setAttribute` /
  `innerHTML` directly; both the elision mechanism and the no-raw-write rule are guarded
  always-on (`tests/painter_host.test.ts` + the per-painter source scans).
- **Allocation-light cores.** A per-frame view-core returns a REUSED, preallocated container +
  slots (no per-frame array/object garbage); jitter/clock stay in the painter, never the core.
  Guarded always-on by the reference-stability probe `tests/util/alloc_probe.ts`.
- **The perf gate.** `scripts/perf_tour.mjs` (run per per-frame phase against the recorded
  baseline) asserts `frameP95 <= baseline` and a bounded AoE-burst FCT node count; each
  green-gate commit is TAGGED so a cumulative regression bisects. The STANDING vitest budget
  is `tests/hud_perf_budget.test.ts`, split by host: it scans every hot painter for raw writes
  AND per-frame forced-reflow layout reads (`offsetWidth`/`getBoundingClientRect`/..., the
  layout-thrash killer); drives the non-pooled painters through a `makeWriterFacet` loop
  asserting establishing-write + elision for BOTH a Sim- and a `ClientWorld`-shaped input; and
  (gated behind `HUD_PERF_BUDGET_TOUR=1`) asserts on EVERY viewport the run-length-INDEPENDENT
  elision-bypass COUNT `hudHotDomWrites <= 153` (a COUNT, NOT the skip RATIO, whose denominator
  is the frame count and jitters run-to-run), plus the FCT pool stays at/under `FCT_POOL_CAP`.
  The committed baseline (`tests/hud_perf_budget.baseline.md`) is READ for both anchors (it
  throws if absent, never defaults).
- **Two controllers stay separate.** HUD tier knobs read the STATIC graphics preset via
  `src/game/ui_effects_profile.ts` (the `data-fx-level` stamp), NEVER `governor.state()`;
  `Hud.fxTier()` resolves the static stamp through `coerceFxTier`. This is the perf half of the
  gameplay-neutral-graphics invariant (root `CLAUDE.md`). Guarded by `tests/ui_tier_knobs.test.ts`,
  the `ui_tier_knobs` purity row in `tests/architecture.test.ts`, and
  `tests/ui_effects_profile.test.ts`.

### Canvas and DOM hot-path techniques (the proven patterns)
The contract above is the WHAT; reach for the matching one when you build a hot HUD component
(each names its exemplar):
- **Resolve element refs ONCE** into a field at construction, never `$()`/`querySelector` from
  a per-frame path (a re-query every frame was a real leak; `hud.ts` caches `xpbarEl` etc.).
- **Pool + keyed-reconcile, never per-frame `innerHTML` / `createElement`.** For a per-event or
  per-entity collection (FCT, auras, party), keep a persistent node pool, reconcile a keyed list
  with minimal `insertBefore` moves, recycle departed nodes, and CAP the live count (FIFO-evict
  past the cap). `auras_painter` (keyed pool + `reconcileOrder`), `fct_painter` (pool + FIFO cap).
- **Offscreen-canvas background cache.** Render static geometry ONCE to a detached canvas keyed
  by what it depends on (zone+seed, module id), then `drawImage`-blit it each redraw; only the
  dynamic markers re-stroke per frame (`delve_map_painter`, the per-zone `mapBgCache`, the
  `minimapBg` terrain canvas).
- **Set loop-invariant canvas state once.** Assigning `ctx.font` re-parses the font string every
  time, so set `font` / `fillStyle` / `lineWidth` before a draw loop, not per glyph
  (`map_window_painter`).
- **DPR backing store only where it must be crisp.** A HiDPI canvas sizes its backing store to
  `devicePixelRatio` and reassigns `width`/`height` only when the DPR changes (assignment clears
  the canvas); portraits are DPR-scaled (`unit_portrait_painter`), the minimap/map/delve are 1:1.
- **Prewarm heavy canvas work off the interaction.** A multi-hundred-ms render is painted a few
  rows per `requestIdleCallback` slice and cached, so opening the map never pays it synchronously
  (`hud.ts` `prewarmMapBg`).
- **Transform vs layout, honestly.** No blanket prefer-transform rule: reach for
  `transform`/`opacity` when an element actually MOVES every frame (nameplates), and lean on
  write-once + elision otherwise (FCT writes its screen-anchored `left`/`top` once at spawn; bars
  write `width` through the elided writer).

The CSS token system, `@layer` order, browser matrix, and bundle discipline these painters
depend on are in `src/styles/CLAUDE.md`.

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
| Events to log / FCT / audio / banners |
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
`hud.ts` is the worst monolith to grow: a window or panel that does not need `Hud`'s private
per-frame state belongs in its own `src/ui/` module the HUD composes (see the root Modularity
section). The pure painters (`unit_portrait*`, `xp_bar.ts`) are the template: a host-agnostic
core a Vitest drives directly, plus a thin DOM/canvas consumer.

### Authoring a new HUD component (the recipe)
One recipe for a new window/panel or a per-frame frame/bar, and for migrating one out of
`hud.ts` (the merge-conflict tax this pays down). Migrate one at a time, on the rule of three.
Follow the root `extract-and-test` skill for the move-not-rewrite mechanics; the UI-specific
parts (reference: the Vendor window and the `unit_frame` family):
- **Pure view-core** `src/ui/<name>_view.ts` (or `_core.ts`): maps `IWorld` (+ raw inputs) to a
  render model; DOM/Three/i18n-free; INSTANCE-PARAMETERIZED (a descriptor/id, no hardcoded
  element id); allocation-light if per-frame. NAME it `*_view`/`*_core` (NOT a bare name): the
  `architecture.test.ts` COMPLETENESS sweep asserts every on-disk `*_view`/`*_core` is registered,
  so the convention name is what makes a forgotten registration FAIL the guard instead of silently
  escaping the purity scan. Register it in the `UI_PURE_CORES` allowlist there. Test it
  same-input-same-output against BOTH a Sim- and a `ClientWorld`-shaped stub.
- **Thin painter** `src/ui/<name>_window.ts` (or `_painter.ts`): paints/updates nodes and wires
  callbacks via an injected `deps` object; owns no state and never imports `Hud`. ALL DOM writes
  go through the `PainterHost` elided writers; it drives tokens / CSS vars, never a literal
  hex/px/color in TS (the per-painter no-magic-values source guard). Interpolated names pass
  through `esc()`; a pure extraction reuses existing `t()` keys and adds none.
- **For chrome:** satisfy the HUD-chrome WCAG 2.2 AA contract above. **For a hot component:** keep
  the core allocation-light, pass the perf gate, read the static preset (not the governor), and
  apply the matching canvas hot-path technique.
- **Reuse a FAMILY before building bespoke:** a unit-style frame is a new `UnitFramePainter`
  instance (`unit_frame.ts` + `unit_frame_painter.ts`); an extra action bar is another
  `ActionBarPainter` from a new bar descriptor (`action_bar_view.ts` + `action_bar_painter.ts`).
- **`Hud` stays the orchestrator.** Keep `open<Window>`/`close<Window>` in `Hud` (cross-window
  coordination needs its private state); the per-render method shrinks to: resolve the entity,
  build the view, call the module with `deps`.

## i18n (sparse-overlay model; contributors add ENGLISH ONLY)
The locale data is split; touch the right file (full model + locked-terms glossary:
`docs/i18n-scaling/translation-workflow.md`):
- **`i18n.catalog/`** is the authoritative English source catalog (nested domain modules
  `shell`/`hud`/`hud_chrome`/`abilities`/`quests`/`items`/`game`/`merge` + an `index.ts`
  barrel) that drives `TranslationKey = Leaves<typeof en, 6>`, the dotted-path type every
  `t()` uses. Add a new English string in the matching domain module.
- **`i18n.locales/<lang>.ts`** are the 21 non-English flat sparse overlays
  (`Partial<Record<TranslationKey,string>>`), the ONLY files a translator edits. An omitted
  key is English-filled by the build and marked `pending`.
- **`i18n.resolved.generated/`** is the generated dense table the runtime imports (committed,
  regenerated by `npm run i18n:build`; the `i18n.status.json` registry is gitignored, only the
  counts-only `i18n.status.summary.json` is committed).
- **`i18n.ts`** is the thin runtime: `t()`/`tOptional`/`tPlural`, `hasTranslation`, the
  formatters, language get/set. The locale set derives from `SUPPORTED_LANGUAGES` in the
  generated `loaders.ts` (22 = en + 21). **Lazy locale flip:** only `en`/`en_XA`/`pending`/
  `loaders` are eager; the 21 non-en slices load on demand via `await ensureLocaleLoaded(lang)`.
  `setLanguage` is synchronous and does NOT load; `main.ts` awaits `ensureLocaleLoaded` before
  localized paint and each picker switch.

**Generated-artifact merge conflicts** (`i18n.status.summary.json`, `i18n.resolved.sha256`,
any `i18n.resolved.generated/` slice) are **never hand-resolved**: take either side, run
`npm run i18n:gen`, and `git add` the result. The output is deterministic, so a second
`i18n:gen` must leave the tree clean (that idempotency is your proof, and the CI freshness
step checks the same). A rising `pending` count after merging a `release/**` branch into a
feature branch is expected and fine at the PR-tier gate.

`t(key)` **throws on an untracked key in dev/test**, renders English for a `pending` key on
**non-release builds only**, and **hard-fails a pending key on a release build**
(`isReleaseBuild()` = `I18N_RELEASE=1` or `import.meta.env.PROD`).

**Contributor workflow (add a player-visible string): add ENGLISH ONLY.**
1. Add the key to `en` (the matching `i18n.catalog/<domain>.ts` module) and render it through
   `t()`. **Never edit the 21 `i18n.locales/<lang>.ts` overlays, and never put English / a
   `// TODO` / a placeholder into one.** Leave the key omitted; the build English-fills it and
   marks it `pending` (the maintainer batch-fills every locale at release).
2. If the string originates in `src/sim/` or `server/` (which stay language-agnostic), register
   a matcher RULE in the table matching the emit's ORIGIN (`sim_i18n.ts` for a `src/sim/` emit,
   `server_i18n.ts` for a `server/` emit) in the SAME change. The S3 guard
   (`tests/localization_fixes.test.ts`) fails if a new emit is recognized by neither.
3. Run `npm run i18n:scan` / `i18n:build` (+ `i18n:hash -- --write` if the resolved table
   changed) and commit the regenerated files. The PR is green at the PR-tier gate; the
   release-tier gate (`I18N_RELEASE_TIER=1`) hard-fails on any `pending` row.
   - **The one PR-tier i18n exception (M16).** A new English value that is *wordy* (a run of
     4+ consecutive lowercase letters after stripping `{tokens}`, i.e. most real prose) also
     needs its five non-Latin fills (`zh_CN`/`zh_TW`/`ja_JP`/`ko_KR`/`ru_RU`) in the SAME
     change, or the always-on `tests/i18n_completeness.test.ts` reds even at PR tier: the
     build English-fills the omission, and untranslated English left byte-identical in a
     non-Latin locale is exactly the leak it catches. The maintainer normally supplies those
     five at merge; brand/URL leaves are the only ones that may stay identical.

**Catalog-domain gotcha (where to put a new client key).** Most catalog domains carry
per-locale data that `tsc` ENFORCES (`merge.ts` / `index.ts` cross-reference every locale
block against the merged `en` object), so adding a key to their `en` block red-fails `tsc`
(TS2719) until you fill every non-en block too. `hud_chrome.ts` and `shell.ts` are the
exceptions, consumed `en`-only, so an English-only add to either compiles. For new HUD chrome,
**add the key to `i18n.catalog/hud_chrome.ts`** (namespace `hudChrome.*`): it is a flat object
whose translations live solely in the overlays (`shell.ts` instead carries inline locale
blocks). **Never add `as const` to a catalog-domain object**: it narrows the literal types and
breaks the `en_XA` pseudo-locale.

**Formatters, not hand-built numbers.** Every user-visible number/date/percent/coordinate/
duration goes through `formatNumber` / `formatDateTime` / `formatMoney`. To keep English
byte-identical to a historical hand-rolled form, pass `useGrouping: false` + matching
fraction-digit options (see `coords.ts`, `meters.ts`, `xp_bar.ts`, `clock.ts`).

**Three client-side matchers re-localize `src/sim`/`server` English** (which stay
language-agnostic): the hud-local `localizeErrorText`/`localizeSystemText`/`localizeLootText`,
then `server_i18n.ts` (`localizeServerText`), then `sim_i18n.ts` (`localizeSimText`), in that
order; the S3 drift guard accepts recognition by any of the three. Dev-channel text
(`console.*`, thrown errors) stays English and is NOT matched.

**Entity & talent names** localize through their own resolvers, not raw `t()`:
`world_entity_i18n.ts` is the single ENGLISH source for mob/NPC/quest/zone/dungeon names +
narratives; `entity_i18n.ts` (`tEntity`) localizes them at runtime; `talent_i18n.ts` localizes
talent titles/descriptions. A new world/talent name belongs in `world_entity_i18n.ts` (or the
talent source), with translations in the overlays like any other key.

## icons.ts: procedural recipes, plus a hand-authored WebP set
Most icons are composed on a canvas at runtime and cached as data URLs (no asset file).
Public API: `iconDataUrl(kind, id, size)` where `kind` is
`'ability' | 'item' | 'aura' | 'crest'`; plus `QUALITY_COLOR`. Each procedural icon is a recipe
`{ bg, pal, prims, fx? }` (`IconRecipe`) drawn over a `BACKGROUNDS` radial + `PALETTES`
tint with vector `PRIMITIVES` and optional `FX`. Unknown ids fall back via
`abilityFallback`/`itemFallback` (school + name keywords), so every id always renders.
- **Add a procedural icon for a known id:** add an entry to `ABILITY_RECIPES` / `ITEM_RECIPES` /
  `AURA_RECIPES` / `CREST_RECIPES` using the `r(bg, pal, prims, fx?)` helper (e.g.
  `r('fire','blood',['sword','flame'])`; `TL/TR/BL/BR/BIG` are placement shorthands). New
  visuals need a new `PRIMITIVES` painter (centered at 0,0, ~100×100 space, r≤36, light top-left).
- **The exception, real painted art (WebP):** the curated `ABILITY_IMAGE_IDS` set ships image
  files instead of a recipe. `abilityImageUrl(id)` returns `/ui/skills/<class>/<id>.webp`, served
  for `kind:'ability'` (action bar), `kind:'aura'` (buff/debuff frames), and the `/wiki` guide
  class pages (weapons use `WEAPON_ICON_DIR` JPGs the same way). **The committed tree is WebP only
  and WebP is the source of truth: no PNGs.** To add one, drop the art into
  `public/ui/skills/<class>/` in any common raster format and run `npm run assets:skills`
  (`scripts/convert_skill_icons_webp.mjs`): it encodes each non-webp image to WebP (tuned
  `quality: 82, alphaQuality: 100, smartSubsample: true, effort: 6`) and deletes the original. Then
  list its id in `ABILITY_IMAGE_IDS`. Nothing converts at BUILD time (the script is a pre-commit
  step, not wired into `npm run build`); `tests/skill_icons.test.ts` fails if a wired id lacks its
  webp or any non-webp image is committed. Only `ui/skills/` is auto-converted by `assets:skills`
  and gated by `tests/skill_icons.test.ts`; the existing weapon JPGs and cursor/emote PNGs are
  grandfathered. Prefer WebP for any new ability/skill art.

## Small modules (pure-core + thin-consumer pointers)
Presentation/domain logic lifted out of `hud.ts` into a host-agnostic core a Vitest imports
directly, with a thin DOM/canvas consumer. Follow this shape for reusable/testable features.
- **unit_portrait.ts** / **unit_portrait_painter.ts**: the circular player/target-frame
  portrait. The DOM-free core holds geometry + crest-id resolution (HiDPI backing sizing, crest
  overscan-to-fill, family/NPC crest ids); the painter is the thin DPR-aware consumer with a
  decoded-image cache. Player and target frames share one implementation.
- **xp_bar.ts**: pure `xpBarView()`, no DOM. Shows the post-cap virtual level `Lv 20 (+N)` +
  lifetime total when overflow is on; classic "MAX LEVEL" when off.
- **meters.ts**: DPS/HPS/threat meters, encounter-segmented; threat reads the mob's real
  `entity.threat` table. Uses `performance.now()` (UI timing only, fine here; that ban is sim-only).
- **vendor_view.ts** / **vendor_window.ts**: the merchant window, the first migrated out of
  `hud.ts` by the recipe above (pure view decides sellable + buyback rows with prices; thin
  consumer paints `#vendor-window` from injected `deps`).
- **player_context_menu.ts**: pure `chatPlayerContextActions()` (whisper/invite/friend/ignore/
  report) for the right-click-player menu.
- **auth_utils.ts**: login/char-select form helpers (password toggle, ARIA validity sync,
  `validateCharacterName` mirroring the server regex).
- **stat_tooltip.ts** / **stat_tooltip_view.ts**: the character-screen stat hover tooltips. The
  DOM/i18n-free core builds the structured `StatTooltipModel` (reconciled against
  `recalcPlayerStats`); the pure view turns a model into the tooltip HTML + aria breakdown +
  focusable `statCellHtml`, taking i18n + `formatNumber` as injected deps.
- **esc.ts**: the one canonical HTML escaper (`esc`) for innerHTML / attribute interpolation
  (the src/ui rule "all HTML interpolation goes through `esc()`"); escapes `& < > " '`.
