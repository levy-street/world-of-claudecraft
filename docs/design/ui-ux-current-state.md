# World of ClaudeCraft: UI / UX current-state reference

Foundation document for a AAA-style HUD and UI reshape. This captures **what
exists today**, **how it is wired**, **the design system in place**, and **the hard
constraints any redesign must respect**. Use it as the input to a redesign spec;
it is descriptive, not prescriptive.

Generated from the live code graph (graphify: 20,428 nodes / 55,224 edges over 2,523
files) cross-referenced with the repo's file-naming conventions and the area
`CLAUDE.md` contracts. `src/ui/` is 217 modules; `src/game/` is 49.

---

## 1. How the UI is wired (the seam you must design within)

One rule governs everything: **`render/` and `ui/` talk only to `IWorld`**
(`src/world_api.ts`), never to the concrete `Sim` / `ClientWorld`. The same UI runs
against the offline browser world and the online server mirror.

```
IWorld  (src/world_api.ts, the only seam)
   |
   v
Hud coordinator  (src/ui/hud.ts, ~10k lines, graph degree 456 -- the hub)
   |
   +--> 12 UI families (windows, painters, view-cores, chrome, ...)
   |
main.ts wires: concrete world + Renderer + Hud + input + i18n bootstrap
```

- **`Hud`** ([src/ui/hud.ts:820](../../src/ui/hud.ts)) is the single coordinator. It
  owns the per-frame DOM and buffers and composes every window/frame. `update()` is
  the per-frame entry; `handleEvents()` feeds log / FCT / audio / banners.
- **No UI framework.** Plain DOM + canvas. The HUD queries pre-existing markup from
  the HTML entries (`$('#...')`) and builds the rest with `createElement` / `innerHTML`
  (all interpolation through `esc()`).
- **Two HTML shells** feed the same code: `index.html` and `play.html` (hand-maintained
  parity; a HUD markup/CSS change must be checked in both, plus the unlayered
  `index.extra.css`).
- **`PainterHost`** ([src/ui/painter_host.ts](../../src/ui/painter_host.ts)) is the
  canvas-painter contract every window and per-frame painter plugs into (graph-confirmed:
  bags, bank, char, market, talents, mailbox, questlog, vendor, crafting, heroic_vendor
  all import it).

**Implication for a redesign:** new data or actions the new UI needs are added to
`IWorld` first, then implemented in both worlds. You never reach past `IWorld` into the
sim. Restyling is mostly CSS + painter changes; new *information* on screen is a seam
change.

---

## 2. Complete UI/UX inventory (`src/ui/`, 217 modules)

Organized by role family. File names are the source of truth (the repo uses strict
suffix conventions: `*_window.ts`, `*_view.ts`, `*_painter.ts`).

### 2.1 Windows -- 24 openable screens
`arena` · `bags` · `bank` · `calendar` · `char` · `chat` · `corpse_harvest` ·
`crafting` · `daily_rewards` · `heroic_vendor` · `leaderboard` · `lockpick` ·
`loot_settings` · `mailbox` · `market` (auction house) · `options` · `questlog` ·
`rite` · `social` · `spellbook` · `talents` · `town_focus` · `vale_cup` · `vendor`

Opened via `Hud.open<Window>()` / `toggle<Window>()`; `main.ts` and input dispatch call
them. Keybinds live in `src/game/keybinds.ts` (e.g. talents on `N`).

### 2.2 View-cores -- 47 (`*_view.ts`, pure, DOM/Three-free, Node-tested)
One per window plus HUD pieces. In the `UI_PURE_CORES` allowlist, tested same-input /
same-output against both a `Sim`- and a `ClientWorld`-shaped stub. Examples:
`action_bar_view`, `auras_view`, `consumable_bar_view`, `loot_roll_status_view`,
`mob_tooltip_view`, `stat_tooltip_view`, `weapon_proc_view`, the `vale_cup_*` suite,
`yumi_*`. **This is the layer that decides *what* to show; painters decide *how*.**

### 2.3 Painters -- 17 (`*_painter.ts`, thin canvas/DOM writers on `PainterHost`)
`action_bar` · `auras` · `cast_bar` · `delve_map` · `fct` (floating combat text) ·
`map_window` · `minimap` · `mobile_action_ring` · `party_frames` · `perf_graph` ·
`swing_timer` · `unit_frame` · `unit_portrait` · `xp_bar` · `yumi_grab_bar` ·
`yumi_match`. Painters carry **no raw hex/px** -- they drive tokens (see section 4).

### 2.4 Always-on HUD chrome (per-frame frames / bars, not windows)
`unit_frame` / `party_frame(s)` / `party_chip` / `target_frame_pos` · `xp_bar` ·
`absorb_bar` · `hotbar` · `compass` · `clock` · `coords` · `subzone` · `rest_indicator` ·
`swing_timer` · `low_health` / `low_resource` · `meters` (DPS/HPS/threat) ·
`quest_tracker` / `quest_progress_banner` · `combat_announcer` / `chat_announcer` ·
`movable_frame` (drag/resize base for repositionable HUD elements).

### 2.5 Tooltips
`stat_tooltip` (+`_view`) · `mob_tooltip_view` · `item_set_tooltip_view` · `item_compare`
· plus `Hud.itemTooltip()` for item hovers.

### 2.6 Map & minimap
`delve_map` (+painter) · `map_window` (view + painter) · `map_quest_list_view` ·
`map_dungeon_portals` · `map_terrain` · `minimap_markers` · `minimap_painter` ·
`minimap_zoom`. 2D-canvas painters resolve `--color-*` via cached `getComputedStyle`.

### 2.7 Icons (procedural, mostly no asset files)
`icons.ts` (recipe engine: `iconDataUrl(kind,id,size)` composes on a canvas, caches as
data URL) · `ui_icons` · `talent_icons` · `pet_action_icons` · `emote_icons` ·
`icon_prewarm`. Real painted art (WebP) only for the curated `ABILITY_IMAGE_IDS` set
(`public/ui/skills/<class>/<id>.webp`).

### 2.8 Chat & social
`chat_window` · `chat_channels` · `chat_input_autosize` · `chat_command_menu` ·
`chat_timestamp` · `chat_announcer` · `player_card` (+`_share`) · `player_context_menu` ·
`portrait_chip` · `party_chip` · Discord surface (`discord_widget` / `discord_status` /
`discord_role_tag` / `discord_tier`).

### 2.9 Accessibility & focus (UX plumbing)
`focus_manager` (the shared `FocusManager` + `FOCUSABLE_SELECTOR`; traps Tab in an open
window, returns focus to opener) · `focus_order` · `roving_index` ·
`live_region_politeness` · `live_region_reannounce` · `window_focus`.

### 2.10 Notifications & overlays
`dialog_root` · `reconnect_overlay` · `tutorial` (+`_copy`) · `desktop_update_toast` /
`native_update_prompt` · `quest_progress_banner` · `bug_report` · `two_factor_setup` /
`account_portal` / `auth_utils`.

### 2.11 i18n (every player-visible string)
`i18n.ts` (runtime `t()`) + the `i18n.catalog/` domain modules (`shell`, `hud`,
`hud_chrome`, `abilities`, `quests`, `items`, `game`, `merge`, `index`, `api_error`,
`guide`, `editor`) + matchers (`entity_i18n`, `world_entity_i18n`, `sim_i18n`,
`server_i18n`, `talent_i18n`). See section 5 -- this is a **hard constraint**, not
optional polish.

### 2.12 Theme & scaling
`theme.ts` (runtime `--color-*` accent presets: `classic` / `midnight` / `parchment` /
`highContrast`) · `ui_scale` · `ui_effects_applier` (stamps `data-fx-level`) ·
`ui_effects_profile` (static graphics-tier resolver).

---

## 3. UX / input layer (`src/game/`, 49 modules)

The reshape is not only visual; interaction lives here.

- **Input & controls:** `input` · `keybinds` · `interactions` · `click_move` ·
  `pointer_lock` · `pointer_pick` · `ground_aim` (AoE reticle) · `gamepad` (+`_bindings`
  / `_map`) · `touch_router`.
- **Camera & facing:** `camera_follow` · `camera_driven_facing` · `keyboard_turn_facing`
  · `mouselook_release` · `keyboard_viewport` (+applier).
- **Mobile:** `mobile_controls` · `mobile_hud_layout_applier` · `mobile_chrome_fade` ·
  `touch_peek` / `touch_tap`.
- **Feedback:** `audio` · `music` · `sfx` · `voice` · `cursors` (custom gauntlet cursor
  set) · `spawn_cinematic`.
- **Perf / fairness:** `perf` · `perf_doctor` · `ui_effects_profile` · `ui_tier_knobs`.

---

## 4. The design system in place (`src/styles/`)

Hand-authored CSS, no framework, Lightning-compiled. One `@layer` order in
`index.css`: `tokens -> base -> layout -> components -> hud -> shell -> hud-mobile ->
index-extra/play-extra`. Modules: `tokens` · `base` · `layout` · `components` · `hud` ·
`hud.mobile` · `shell` + per-entry `.extra`.

**The token contract:** painters (`*_painter.ts`) never hard-code a hex/px/color in TS;
they drive `--color-*` / `--fx-*` custom properties. A restyle happens mostly by
**editing tokens and CSS**, not painter logic.

### 4.1 Current aesthetic (the baseline to elevate)
Premium **dark-fantasy**: deep darks, gold-brown accents, rich borders, heraldic display
type. Default dark; no `prefers-color-scheme` auto-switch. Explicitly avoid
default-browser-chrome looks.

### 4.2 Design tokens (from `tokens.css`) -- the current palette & type
| Token group | Values / notes |
|---|---|
| Primary accent | `--gold #ffd100`, `--gold-dim #c8a838`; glows `rgba(255,209,0,.2/.4)` |
| Panel | `--panel-base #15151f`; `--panel-bg` dark gradient (theme overrides wholesale) |
| Fonts | display `Cinzel` (headings), UI/body `Alegreya Sans`, serif prose `Alegreya` |
| Resource bars | HP `#1eb838`, mana `#2b7bd4`, rage `#c0392b`, energy `#e4c531` |
| Unit states | hostile `#ff6b5e`, friendly `#9fdc7f`, buff `#3a6ea8`, debuff `#c0392b` |
| Debuff schools | fire/frost/arcane/shadow/nature/holy border tints |
| Team colors | blue `#2f6fe0`, red `#d8342c` (Protect Yumi / arena) |
| Text | light `#f0ebd8`, muted `#998d6a`, overlay `#f4eede` + shadow; error/success |
| Borders | default `#4e3d1d`, focus `#c8a838`, invalid/valid |
| Spacing | xs 4 / sm 8 / md 16 / lg 24 px |
| Radius | sm 4 / md 8 px |
| Motion | `--transition-speed .25s`, ease `cubic-bezier(.4,0,.2,1)` |
| Scrollbar / cursors | custom themed scrollbar; gauntlet cursor set |
| FX tier | `--fx-shadow` / `--fx-ambient-anim` / `--motion-scale` (gameplay-neutral) |

Plus large token blocks for the map / minimap / delve schematic colors and talent-tree
accents (canvas painters read these via cached `getComputedStyle`).

There is a **rich, centralized token surface already** -- an AAA restyle should extend
this system (new tokens, new theme presets in `theme.ts`), not bypass it with inline hex.

---

## 5. Hard constraints (a redesign that breaks these fails CI)

These are non-negotiable invariants from the root and area `CLAUDE.md`. Bake them into
the redesign spec as acceptance criteria.

1. **Gameplay-neutral graphics / fairness.** No visual tier or setting may confer a
   gameplay advantage. A tier may shed *cosmetic* richness (glow, FCT volume, redraw
   smoothness) but **never actionable information** a player reacts to: own debuffs,
   party/raid HP, target/boss cast bar, target HP granularity, enemy/aggro positions.
   HUD tier knobs read the **static** `data-fx-level` preset, never the live FPS
   governor. (`docs/design/graphics-settings-fairness.md`; tests `ui_effects_profile`,
   `ui_tier_knobs`.)
2. **Every player-visible string is a `t()` key.** Labels, tooltips, placeholders,
   aria/alt, toasts, dialogs, validation, `document.title`. No concatenation, no
   `?? 'English'` fallback, no `setAttribute('aria-label', ...)`. Contributors add
   **English only** (to `i18n.catalog/<domain>.ts`; new HUD chrome -> `hud_chrome.ts`).
   Numbers/dates/money via `formatNumber` / `formatDateTime` / `formatMoney`.
3. **`IWorld` is the only seam.** New on-screen data/actions -> extend `world_api.ts`,
   implement in both `Sim` and `ClientWorld`. UI never imports a concrete world.
4. **Per-frame performance contract.** Anything reached from `Hud.update()`: DOM writes
   go through the elided writers (`setText`/`setDisplay`/`setTransform`/`setWidth`);
   painters never call `textContent =` / `style.*` / `setAttribute` / `innerHTML`
   directly; pool + keyed-reconcile instead of per-frame `createElement`; no per-frame
   layout reads (`offsetWidth`/`getBoundingClientRect`). Guarded by
   `tests/hud_perf_budget.test.ts` (hot-write count `<= 153`) + `scripts/perf_tour.mjs`.
5. **Accessibility WCAG 2.2 AA (HUD chrome in scope; 3D world out of scope).** Focus
   trap + return on window open/close via the shared `FocusManager`; steady
   `:focus-visible` ring from a token (never animated off, never raw hex); skip links
   first; live regions for chat/combat; `forced-colors: active` support; **no
   `transform: scale()` on hover/focus** of list/chip items (motion-sickness);
   honor `prefers-reduced-motion`.
6. **Mobile / touch (first-class, incl. landscape).** Every input/select/textarea
   `>= 16px` font (iOS auto-zoom guard, enforced by a `base.css` floor); every tappable
   target `>= 40x40px` (24x24 absolute floor only where unavoidable); narrow headers
   collapse to a hamburger drawer. Verify portrait **and** landscape.
7. **Layout stability.** Content updates must not resize the parent, jump, or clip.
   Prefer `width:100%` + `max-width` over viewport units. Transitions are
   interruption-safe cross-fades, no layout shift.
8. **Tokens, not literals.** Colors/tunables as `--color-*` / `--fx-*`; thresholds and
   cadences as named constants. Canvas painters cache `getComputedStyle` reads.
9. **All interpolated player/server text through `esc()`.** Names, chat, guild names.
10. **No emojis / em dashes / en dashes** anywhere (code, copy, docs, commits). Icons
    are procedural `icons.ts` recipes or real art, never raw emoji.

---

## 6. `Hud` internal map (where the current logic lives)

`src/ui/hud.ts` is one `Hud` class; regions are fenced by `// ----` banners (grep the
banner, not a line number). File-order regions:

Fields / constructor / hooks · Chat tabs & emote wheel · Portraits / icons / tooltips /
money · Action bar (`hotbarActions`, keybind dispatch) · Frame update (unit/target/combat)
· Minimap & world map · Arena panel · Events -> log/FCT/audio/banners · 2v2 Fiesta HUD ·
Quest dialog / Loot / Vendor · World Market · Bags / Character / Spellbook · Confirm +
text-input modal · Talents panel · Quest log / Party frames / context menu · Social panel
· Prompts (party/trade/duel) & Trade window · Options menu + keybind rebinding.

**Rule for the reshape:** new self-contained windows/panels go in their **own module**
the Hud composes, never a new banner section. `hud.ts` is an active extraction target;
never grow it.

---

## 7. Authoring recipe (how redesign work slots into the codebase)

For a new or reworked window/panel or per-frame frame/bar (reference: the Vendor window
and the `unit_frame` family):

1. **Pure view-core** `src/ui/<name>_view.ts`: maps `IWorld` (+ raw inputs) to a render
   model; DOM/Three/i18n-free; instance-parameterized (descriptor/id, no hardcoded
   element id); allocation-light if per-frame. Register in `UI_PURE_CORES`. Test against
   both a `Sim`- and a `ClientWorld`-shaped stub.
2. **Thin painter/window** `src/ui/<name>_window.ts` (or `_painter.ts`): paints nodes,
   wires callbacks via an injected `deps`; owns no state, never imports `Hud`; all DOM
   writes through `PainterHost` elided writers; drives tokens, never literal hex/px;
   interpolation through `esc()`.
3. **Reuse a family before bespoke:** a unit-style frame is a new `UnitFramePainter`
   instance; an extra action bar is another `ActionBarPainter` from a bar descriptor.
4. **`Hud` stays orchestrator:** keep `open<Window>` / `close<Window>` in `Hud`; the
   per-render method shrinks to: resolve entity -> build view -> call module with `deps`.
5. **Chrome** satisfies the WCAG contract (section 5.5); **hot components** keep the core
   allocation-light, pass the perf gate, read the static preset, apply the matching
   canvas hot-path technique.

Bug fixes are test-first (failing test that reproduces, then the smallest green change).
See the `extract-and-test` skill.

---

## 8. Screenshots & delivery (repo expectations)

- **Visual changes require before/after screenshots** (desktop + mobile where relevant),
  committed under `docs/screenshots/` and referenced from the PR body.
- Gate locally with `npm run gate` before calling any change done.
- The two game entries (`index.html` + `play.html`) share `main.ts`; verify both, plus
  `index.extra.css`, on any HUD markup/CSS change.
- Browser matrix floor: big-3 desktop **plus** mobile Safari/WebKit as first-class.

---

## 9. Opportunity notes for an AAA reshape (analysis, not requirements)

Observations to inform the redesign spec, given the current state above:

- **The token system is the lever.** A cohesive AAA restyle is largely: (a) expand
  `tokens.css`, (b) add richer theme presets in `theme.ts`, (c) refine painter/CSS
  composition. The no-literal-hex discipline means a palette overhaul is centralized.
- **Depth without breaking fairness.** AAA "juice" (glows, parallax panels, animated
  frames) must live in the **cosmetic** `--fx-*` tier that low-end sheds, and must never
  gate actionable info. Design the flourish as tier-sheddable from the start.
- **Motion budget is real.** The per-frame contract and reduced-motion / no-scale-on-hover
  rules bound how much animation the HUD can carry. Prefer transform/opacity on genuinely
  moving elements; write-once + elision elsewhere.
- **Mobile is not an afterthought.** 40x40 targets, 16px inputs, hamburger collapse, and
  landscape support constrain layout density; design the AAA HUD responsive-first.
- **Consistency surface.** 24 windows + ~14 chrome elements share tokens but were authored
  incrementally; an AAA pass benefits from a unified component grammar (panel frame,
  header, close affordance, scrollbars, tooltips, focus ring) expressed once as reusable
  CSS + a painter family, then applied across families.
- **Accessibility is a feature, not a tax.** The focus-trap, live-region, and
  forced-colors plumbing already exists; a redesign should preserve and visibly polish it
  (a crisp, on-brand focus ring is an AAA detail, not a compliance checkbox).

---

## 10. Key file pointers

| Concern | Path |
|---|---|
| The seam | `src/world_api.ts` |
| HUD coordinator | `src/ui/hud.ts` |
| Painter contract | `src/ui/painter_host.ts` |
| Design tokens | `src/styles/tokens.css` |
| Style layers | `src/styles/` (+ `src/styles/CLAUDE.md`) |
| Theme presets | `src/ui/theme.ts` |
| Icon engine | `src/ui/icons.ts` |
| i18n home | `src/ui/i18n.ts` + `src/ui/i18n.catalog/` |
| Input / UX | `src/game/` |
| UI area rules | `src/ui/CLAUDE.md` |
| Fairness spec | `docs/design/graphics-settings-fairness.md` |
| Repo invariants | `CLAUDE.md` (root) |
