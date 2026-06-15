<!-- src/ui/ — classic HUD, i18n, procedural icons. Local detail only; the
     IWorld seam, dependency rules, and "files-can-be-huge" convention are in
     root + src/ CLAUDE.md — don't repeat them here. -->

# src/ui/ — classic HUD, i18n, procedural icons

The WoW-Classic HUD: unit/party frames, action bar, all windows, tooltips,
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

## hud.ts (~3570 — one class `Hud`) — navigation map
Every region is fenced by a `// ----` banner. `update()` (~L494) is the per-frame
entry; `onEvent` paths feed log/FCT/audio/banners (~L1106). Jump by banner:
| Region | ~line |
|---|---|
| Fields / constructor / `OptionsHooks`,`ReportHooks` | 31–193 |
| Portraits, icons, tooltips, money | 194 |
| Action bar (`slotMap`, `BAR_ABILITY_SLOTS`, click/keybind dispatch) | 349 |
| Frame update (unit/target/combat state) | 491 |
| Minimap & world map (`toggleMap`, zone band) | 744 |
| Ashen Coliseum arena panel (`toggleArena`) | 900 |
| Events → log / FCT / audio / banners | 1106 |
| Quest dialog (gossip) · Loot · Vendor | 1421 / 1533 / 1572 |
| World Market (auction house: browse/sell/collect) | 1626 |
| Bags · Character window · Spellbook | 1830 / 1897 / 2189 |
| Confirm dialog + in-app text-input modal (replaces native `prompt`) | 2026 / 2043 |
| Talents & Specializations panel ('N', staged-edit + loadouts) | 2220 |
| Quest log · Party frames · Player context menu | 2508 / 2567 / 2620 |
| Social panel (friends/guild/ignore, online) | 2815 |
| Prompts (party/trade/duel) · Trade window | 3123 / 3145 |
| Options menu (Esc) + keybind rebinding | 3240 |
Toggle/open methods (`toggleBags`, `openVendor`, `openContextMenu`, …) are the
public surface `main.ts`/input call.

## i18n.ts (~2020) — IMPORTANT
- **Every locale object is declared `: typeof en`** (`es`, `fr_FR`, `de_DE`, …).
  `tsc` fails if any locale is missing/renames a key. **YOU MUST add a new string
  to `en` first, then to every locale object**, or the build breaks.
- `t(key)` is typed `Leaves<typeof en>` (dotted path, e.g. `t('game.xp.suffix')`)
  and falls back to the raw key if missing. `getLanguage`/`setLanguage` persist to
  `localStorage('locale')`; `?lang=` query overrides.
- Reality check: the HUD shipped mostly English-hardcoded (~73 `t()` calls in
  hud.ts, 0 in meters.ts). New post-cap/XP/leaderboard text lives in `gameStrings`
  and **does** route through `t()`. Prefer `t()` for new user-facing strings.
- `translations` currently maps only en, es, fr_FR, de_DE, ja_JP, ru_RU; the other
  exported locales aren't wired in. Add to that map to make a locale selectable.

## icons.ts (~1330) — procedural, no image files
Icons are composed on a canvas at runtime and cached as PNG data URLs — there are
**no icon image assets**. Public API: `iconDataUrl(kind, id, size)` where `kind`
is `'ability' | 'item' | 'aura'`; plus `QUALITY_COLOR`.
Each icon is a recipe: `{ bg, pal, prims, fx? }` (`IconRecipe`) drawn over a
`BACKGROUNDS` radial + `PALETTES` tint with vector `PRIMITIVES` and optional `FX`.
Unknown ids fall back via `abilityFallback`/`itemFallback` (school + name
keywords), so every id always renders.
- **Add an icon for a known id:** add an entry to `ABILITY_RECIPES` /
  `ITEM_RECIPES` / `AURA_RECIPES` using the `r(bg, pal, prims, fx?)` helper
  (e.g. `r('fire','blood',['sword','flame'])`; `TL/TR/BL/BR/BIG` are placement
  shorthands). New visuals need a new `PRIMITIVES` painter (centered at 0,0,
  ~100×100 space, r≤36, light top-left).

## Small modules
- **xp_bar.ts** (~65) — pure `xpBarView()`, no DOM (snapshot-tested). Shows the
  post-cap **virtual level** `Lv 20 (+N)` + lifetime total when overflow is on;
  classic "MAX LEVEL" when off. See `virtualLevelProgress` in `sim/types`.
- **meters.ts** (~300) — DPS/HPS/threat meters, encounter-segmented; threat reads
  the mob's real `entity.threat` hate table. Uses `performance.now()` (UI timing
  only — fine here; that ban is sim-only).
- **player_context_menu.ts** (~44) — pure `chatPlayerContextActions()` returning
  whisper/invite/friend/ignore/report actions for the right-click-player menu.
- **auth_utils.ts** (~94) — login/char-select form helpers: password toggle, ARIA
  validity sync, `validateCharacterName` (mirrors the server regex).
