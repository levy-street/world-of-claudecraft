# PR draft: Character Equipment Screen redesign

Title: `feat(ui): redesigned two-tab character equipment screen`
Branch: `feat/char-equipment` (56 commits; 75 files, +7423 / -447)
Suggested base: `release/v0.25.0` (newest release branch; this branch was cut from `origin/main`
at `fa435903a`, so retarget onto `release/v0.25.0` and rebase before opening; run
`release-merge-audit` if a release merge is involved).

## Summary

Rebuilds the character window (`#char-window`, key C) into a full-screen, two-tab, dark-fantasy
"AAA" interface matching the approved reference mockups, keeping the sim untouched.

- EQUIPMENT tab: a full-screen container (~80vw x 80dvh, resizeable, usable 1280-1920px) with a
  radial orbiting equipment stage (the 11 real equip slots placed on a symmetric half-sine arc
  around the character, who stands on a procedural stone pedestal inside a carved stone arch niche),
  a full-width embedded bags panel, and a tall right-hand stat column (Attributes, Combat, Defense,
  Progression with an XP bar, Specialization with a Choose/Change shortcut, Gathering).
- OVERVIEW tab: the migrated identity strip, talent summary, prestige/milestones, and share card;
  content-accounting tests prove nothing from the old sheet was lost.
- Preview: a procedural stone pedestal (char-window mount only, off everywhere else) plus the
  equipment-visual base seam (`PreviewAppearance.equippedItems` -> `CharacterVisual.setEquipment`,
  weapon-only rendering today) so armor-on-model can land later without rework.
- Mobile: a separate touch layout (not a scaled desktop) for portrait and landscape (icon rail,
  compact stage, per-container bag sections, stats column with Progression + Specialization paired).
- Visual language: muted dark-iron slot frames with subtle gold corner accents (glow reserved for
  hover/focus/selected), a weathered grey-blue stone arch, a deep-navy atmosphere.

Design decision (owner-confirmed during the work): "ornate look, honest data." The screen matches
the mockups' styling and layout but shows only stats and slots the sim actually has. The mockups'
fictional rows (Melee/Ranged split, Melee/Ranged Hit, Block/Parry/Resistance) and slots (Off Hand,
Trinket) are intentionally omitted; adding them would require sim/server changes (see Deferred).

Pure client work: zero changes under `src/sim/`, `src/net/`, `server/`, `src/world_api*`, the wire,
or the DB. The only `src/render/` change is the procedural pedestal + the preview equipment seam
under `src/render/characters/` (no new asset files; media manifest unchanged).

## Type of change

- [x] Feature: new functionality
- [x] Refactor (extracted five pure view-cores out of the HUD)

## How was this tested?

- Commands:
  - `npx tsc --noEmit` (clean)
  - Targeted suites green: `char_view`, `char_panels_view`, `char_bags_view`, `char_window`,
    `char_window_frame`, `window_frame_view`, `window_frame`, all 15 `*_frame`, `bags_view`,
    `bags_window`, `preview_appearance`, `pedestal`, `character_visual_equipment`,
    `milestones_overview_view`, `architecture`, `css_corpus`, `css_value_validity`,
    `styles_extraction`, `per_entry_css_wiring`, `localization_fixes`, `i18n_completeness`,
    `i18n_resolved_equivalence` (348+ tests across the feature suites).
  - `npm run ci:changed` (green), `npm run build` (all 5 entries built), `npm run gate`.
  - Gate status: green except three pre-existing environmental reds on this Windows machine that
    this branch does not touch (verified by `git diff --name-only` on each) and that fail via a
    node/tsc subprocess spawn, not assertions: `tests/server/new_endpoint.test.ts` (documented),
    `tests/ai_review.test.ts`, `tests/codex_setup.test.ts`. One real gate red WAS ours and is
    fixed: `tests/i18n_resolved_equivalence.test.ts` (the resolved-table SHA baseline had drifted
    after later phases added keys; re-baselined, now green).
- Manual / screenshot steps:
  - `node scripts/char_equipment_shot.mjs` at desktop 1600x740 / 1280x800 / 1440x900 / 1920x1080
    and mobile 390x844 / 844x390; overview-tab capture; partial-equip capture for empty-slot frames.
  - Verified the sacred equip/unequip flows (corner-x, right-click, drag-to-unequip onto the
    embedded grid AND the standalone #bags window), tab round-trip preserving the single WebGL
    preview, and the keyboard-accessible bag-socket unequip.

## Screenshots / recordings

| | Before | After |
|---|---|---|
| Desktop | docs/screenshots/char-equipment-before-desktop.png | docs/screenshots/char-equipment-after-desktop.png |
| Mobile | docs/screenshots/char-equipment-before-mobile.png | docs/screenshots/char-equipment-after-mobile.png |
| Overview tab | (n/a, new) | docs/screenshots/char-equipment-after-overview.png |

## Checklist

### Quality
- [x] Decisive tests added/updated for changed behavior; manual checks recorded above. Gate green
      except the three documented environmental Windows subprocess-spawn reds (not this branch).

### Cross-platform
- [x] Desktop (1280-1920) and mobile (portrait + landscape) verified; tap targets >= 40x40px.
- [x] Accessible: keyboard-operable (incl. bag-socket unequip), visible token focus rings, dialog
      role + labelledby, XP-bar `aria-valuetext`, roving tab rail, forced-colors + reduced-motion
      honored.

### Localization
- [x] New player-visible strings are `t()` keys in `i18n.catalog/hud_chrome.ts`; wordy values carry
      their five non-Latin M16 fills; reused existing keys where available (progression/talents/
      gathering/bags-title). Numbers via `formatNumber`, money via `moneyHtml`/`formatMoney`, names
      via `esc()`. No `src/sim`/`server` player text added.

### Hygiene
- [x] No secrets/.env; `ALLOW_DEV_COMMANDS` untouched. No hand-edited generated files beyond the
      sanctioned M16 overlay fills and the regenerated i18n tables (deterministic; SHA re-baselined).

## Deferred follow-ups (carry into issues)

1. Armor visible on the 3D preview: the equipment-visual base seam shipped (weapon-only today);
   per-slot armor meshes are a deferred render follow-up.
2. Ranged attack power display: needs a new `StatId` + tooltip model.
3. Off-hand / trinket equip slots: a sim/server feature; the orbit leaves the Off Hand anchor empty
   (honest data). Adding them reverses the pure-client constraint.
4. The mockups' fictional stat rows (Melee/Ranged split, Melee/Ranged Hit, Block Value/Block Chance/
   Parry/Resistance): intentionally omitted per the "honest data" decision; would need real sim
   mechanics to show truthfully.
5. Crafting skills on the sheet: blocked on online mirroring of `craftSkills` (ClientWorld does not
   mirror it), so it is not displayed.
6. Embedded-grid overflow: a legacy over-capacity save's excess items are not surfaced in the
   embedded grid (the standalone #bags window still shows them). Low likelihood; documented.
7. Quest-item discard from the embedded grid is a deliberate no-op (no duplicate destroy-confirm
   modal).
8. Harden `preview.ts` pedestal restore in `captureCloseup()` against future async reordering
   (gate the re-add on `!this.destroyed`); safe today.
9. `src/ui/char_window.ts` (~1250 lines) is a size watch-item; the pure logic is already extracted
   into five tested cores.
