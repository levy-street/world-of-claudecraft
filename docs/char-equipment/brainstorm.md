# Brainstorm: Character Equipment Screen

## Vision

The character window becomes the game's flagship piece of HUD chrome: a wide two-pane window in the shipped gold-on-dark AAA grammar. Left pane: the paperdoll, the live 3D character turntable on a pedestal under an ornate arch, equipment slots flanking it with rarity-colored borders, and an embedded bags grid below. Right pane: six stat panels with icon section headers. Title bar: character name, level/class subtitle, currency chips, close button, and a tab rail (EQUIPMENT, OVERVIEW).

## Locked design decisions (user-approved 2026-07-11)

1. **Nonexistent combat stats are dropped, not faked.** Hit chance, block chance, block value, parry, and resistance do not exist as mechanics (combat uses level-based miss only; "no parry" is an explicit design comment in `src/sim/combat/damage.ts:19`). The DEFENSE panel shows Armor and Dodge only. No display-only zeros, no new sim mechanics.
2. **Paperdoll adapts to the engine's 11 real slots.** Left column: HEAD (helmet), NECK, SHOULDERS (shoulder), CHEST, GLOVES. Right column: MAIN HAND, WAIST, LEGS, BOOTS (feet), RING 1, RING 2. Top center: the equipped-bag socket display. No OFF HAND, no TRINKET (the enum has neither; adding them is a separate gameplay feature, out of scope).
3. **Bags grid is embedded in the Equipment tab**, reusing the pure `bags_view` helpers. Container selector buttons (backpack plus each equipped bag socket) replace the mockup's "1 2 3 4"; counter = used/capacity of the selected container. The standalone `#bags` window keeps its keybind and full feature set (filter, sort, money footer).
4. **OVERVIEW tab = identity + talents + social**: archetype title, hobby craft, talent/spec summary linking to the talents window, prestige/milestones, share-card button. EQUIPMENT tab = paperdoll + bags + stat panels. Everything the old sheet showed survives across the two tabs.
5. **(added 2026-07-11)** The preview gets a real 3D procedural pedestal (char-window only, no new asset files), and the equipment-visual base seam ships now (`PreviewAppearance.equippedItems` + `CharacterVisual.setEquipment`, weapon-only rendering today) so armor-on-model can be added later without rework. Phase 2b.

## Current state (verified against origin/main, 2026-07-11)

- The char window is already a pure-core + painter module: `src/ui/char_view.ts` (67 lines, registered in `UI_PURE_CORES`) + `src/ui/char_window.ts` (351 lines, `class CharWindow`), orchestrated by `Hud` (`src/ui/hud.ts:3708-3751`). Opened via KeyC (`src/game/keybinds.ts:167`), minimap `#mm-char`, mobile `mobile-char`.
- The shared window frame (`src/ui/window_frame_view.ts` + `window_frame.ts`) natively supports tab rails with full a11y (tablist/tab/tabpanel, roving tabindex). `CHAR_FRAME` (`char_window.ts:152-156`) defines no tabs today.
- The AAA gold-on-dark grammar is SHIPPED (PR 1736 merged; spec `docs/design/ui-ux-redesign-spec.md`). `.window-frame`, corner ornaments, sticky titlebar, gold tab underline, `.item-cell` rarity borders, `.bar`/`.bar-fill` all exist in `src/styles/components.css`.
- The 3D preview is solved: one shared `CharacterPreview` turntable (`src/render/characters/preview.ts`), Hud-owned (`Hud.mountCharPreview`, `hud.ts:11734-11760`), single WebGL context re-parented via `setContainer`. It shows class rig + skin + equipped mainhand weapon. Worn armor does not change the model (no armor-mesh pipeline; not needed by the mockup).
- Stats: everything shown in the new panels already exists. `recalcPlayerStats` (`src/sim/entity.ts:194-478`) is the single derivation point; the UI reads the player `Entity` plus `IWorld` facets. DPS is a client-side estimate (`src/ui/stat_tooltip.ts`, `AP_PER_DPS = 14`). Virtual level and XP helpers are pure functions in `src/sim/types.ts` (`virtualLevel`, `virtualLevelProgress`, `xpForLevel`, `XP_TABLE`).
- Gathering (mining/logging/herbalism) exists per player and already renders on the sheet via `src/ui/gathering_view.ts`.
- Spec state: `talentSpec: string | null` on IWorld; null = no specialization chosen; the talents window (KeyN) is the chooser.
- Money: `Hud.moneyHtml(copper)` (`hud.ts:3913-3922`) renders gold/silver/copper chips with procedural CSS coin icons; already in the char window deps bag.
- Both HTML entries (`index.html`, `play.html`) hold only an empty `#char-window` stub; all markup is JS-generated, so both entries inherit changes automatically.
- i18n: character strings live in `src/ui/i18n.catalog/hud_chrome.ts` (`hudChrome.*`, English-only domain; never `as const`). The M16 rule applies: any new wordy English value needs its five non-Latin fills (`zh_CN`/`zh_TW`/`ja_JP`/`ko_KR`/`ru_RU`) in the same change, following the precedent documented at `hud_chrome.ts:224-229`.

## Reuse map (do not rebuild these)

| Need | Existing surface |
|---|---|
| Window chrome, tabs, close, a11y | `renderWindowFrame` + `WindowFrameDescriptor.tabs` + `applyActiveWindowTab` |
| 3D pedestal preview | `Hud.mountCharPreview` -> shared `CharacterPreview` (never imported by view/painter) |
| Stat cells + tooltips | `deps.statCellHtml(stat)` / `stat_tooltip*.ts` (13 `StatId`s) |
| Rarity borders | `.item-cell[data-quality]` + `QUALITY_COLOR` tokens |
| Item icons | `iconDataUrl('item', id, size)` / `deps.itemIcon(item)`; `slot_empty` recipe exists |
| Chrome glyphs | `svgIcon(name)` in `src/ui/ui_icons.ts` (add new `UiIconName` paths for missing section icons) |
| Money chips | `deps.moneyHtml(copper)` + `.coin.g/.s/.c` CSS |
| Bags grid model | `src/ui/bags_view.ts` (`buildBagGrid`, `buildBagBar`, `bagItemAction`) + `src/sim/bags.ts` (`BACKPACK_SLOTS`, `bagSlotsOf`) |
| Gathering rows | `src/ui/gathering_view.ts` `buildGatheringProficiencyRows` |
| XP math | `virtualLevel` / `virtualLevelProgress` / `xpForLevel` from `src/sim/types.ts` (see `src/ui/xp_bar.ts` usage) |
| Focus trap / Esc | `FocusManager` via `Hud.windowFocus`, `closeAll` dispatcher (already wired) |
| Unequip flows | `char_window.ts` corner-x / right-click / drag-to-unequip (the "(sacred)" test in `tests/char_window_frame.test.ts`) |

## New work needed (all client-side)

- Rework `char_view.ts` paperdoll columns to the new arrangement + bag-socket top slot model.
- New pure core `src/ui/char_panels_view.ts` (panel section models) + `src/ui/char_bags_view.ts` (embedded container model). Both registered in `UI_PURE_CORES`.
- `window_frame` extension: optional titlebar subtitle + right-side accessory slot (money chips), behind the existing descriptor/deps seam.
- Tabs on `CHAR_FRAME`; Overview content migration.
- New CSS sections in `src/styles/components.css` (ten-dash banners, tokens only) + `src/styles/hud.mobile.css` update.
- New `hudChrome.character.*` i18n keys with M16 fills.
- New/updated tests: `char_view`, `char_panels_view`, `char_bags_view`, `char_window`, `char_window_frame`, `window_frame_view`, `window_frame`, `architecture` allowlist.
- Before/after screenshots (desktop + mobile) under `docs/screenshots/`.

## Explicitly out of scope (deferred follow-ups, do not do)

- Off-hand / trinket equipment slots (sim gameplay feature).
- Hit / block / parry / resistance mechanics or display rows.
- Ranged attack power row (`Entity.rangedPower` exists for hunters but has no `StatId`/tooltip model; adding one is a separate small feature).
- Armor MESHES on the 3D preview (deferred; the base seam ships in Phase 2b so this lands later without rework).
- Crafting-skill display (`craftSkills` is not mirrored online; showing it would break offline/online parity).
- Any change to `src/sim/`, `server/`, `src/net/`, the wire protocol, or the DB.

## Open items

- None blocking. No third-party surface, no web research required (all data and formulas already exist in-repo).
