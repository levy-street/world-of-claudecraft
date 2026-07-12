# Plan: Mobile HUD Readability Adjustments

Product spec: [Mobile HUD Readability Adjustments](../specs/2026-07-11-mobile-hud-readability-adjustments.md)

Branch: `mobile-layout-adjustments`

Status: Implemented and scoped verification passed. The repository gate remains blocked by the
pre-existing dirty generated i18n freshness state; the full Vitest run also reports that same
freshness state plus an unrelated WIP pet-stance source-contract mismatch.

## File map

Create:

- `src/ui/mob_tooltip_layout.ts`: pure visual-pixel geometry for the mobile mob tooltip.
- `tests/mob_tooltip_layout.test.ts`: deterministic unit coverage for placement, mirroring, clamping, and clipping.

Modify:

- `src/ui/hud.ts`: integrate the pure helper and event-driven visible-tooltip invalidation.
- `src/styles/hud.mobile.css`: tooltip clipping/fade, responsive frame scales, and compact Consumables topology.
- `tests/client_shell.test.ts`: update source contracts for the responsive frame and Consumables rules.
- `tests/browser/target_size.browser.test.ts`: verify rendered frame and Consumables geometry.
- `scripts/mobile_cluster_layout_check.mjs`: extend the canonical mobile geometry matrix.
- `scripts/mobile_hud_layout_shots.mjs`: seed the real tooltip and six distinct Consumables.
- `docs/screenshots/mobile-hud-layout/after-compact-consumables.png`
- `docs/screenshots/mobile-hud-layout/after-compact-left-handed.png`
- `docs/screenshots/mobile-hud-layout/after-compact-rest.png`
- `docs/screenshots/mobile-hud-layout/after-iphone-target-party.png`
- `docs/screenshots/mobile-hud-layout/after-tablet-landscape.png`
- `docs/prd/mobile-compact-landscape-hud.md`: supersede the old compact 2 by 3 and frame-scale contracts.
- `docs/plans/2026-07-10-mobile-touch-hud-layout.md`: reconcile historical follow-up notes.
- `docs/solutions/2026-07-11-mobile-touch-hud-layout.md`: record the superseding follow-up.

## Global constraints

- Use the existing npm and strict TypeScript toolchain; add no dependency.
- Preserve the dirty worktree and do not overwrite unrelated user changes.
- Keep pure geometry outside `hud.ts`.
- Do not add layout reads to the per-frame unchanged-content path.
- Reuse the shared tooltip only for the existing transient mobile mob inspection trigger.
- Keep every Consumables control at 48 by 48px and every actionable clearance at 4px or more.
- Leave desktop and the portrait rotate-device gate unchanged.
- Treat initial scale and inset constants as tunable until the full geometry matrix passes.
- Use RED, GREEN, REFACTOR for each production-code change.
- Before the first RED edit, capture focused baseline output for the existing relevant tests and
  save a path-scoped diff of every already-dirty file this change will touch. During each task,
  compare only the new assertions and scoped hunks so pre-existing failures and user edits are not
  mistaken for task regressions or overwritten.

## Tasks

### 1. Extract mobile mob-tooltip geometry

1. Add failing unit tests for right-handed placement, left-handed placement, viewport clamping,
   author-space conversion under UI zoom, nearest lower intersecting obstacle selection, and
   long-content clipping.
2. Run `npx vitest run tests/mob_tooltip_layout.test.ts` and confirm the new tests fail because
   the module is absent.
3. Implement the smallest pure `mob_tooltip_layout.ts` helper that returns author-space `left`,
   `top`, `maxHeight`, and whether clipping is required.
4. Re-run the focused unit test and refactor only while it stays green.

### 2. Integrate event-driven tooltip positioning

1. Add failing source-contract coverage proving `hud.ts` imports the helper and does not retain the
   old left-of-minimap constants.
2. Replace `paintMobTooltipBottomRight()` mobile placement with the pure helper while preserving
   desktop behavior and the existing trigger/lifetime.
3. Before each positioning measurement, clear the previous mobile `max-height` and clipped class
   so natural tooltip height is never read through a stale constraint.
4. Collect visible movement, Consumables, player, Target, and Party rectangles only during a
   positioning pass. Represent the guaranteed camera-start pseudo-element as a virtual rectangle
   from its resolved CSS custom properties, or prove it is horizontally disjoint on that pass.
5. Reposition a visible mob tooltip after viewport resize, relevant body-tier or handedness class
   changes, UI or tooltip scale changes, minimap resize, Consumables open/close or population
   changes, Party expand/collapse or row changes, target visibility/geometry changes, and movement
   or other measured chrome resize. Observe the measured obstacle containers or call one shared
   invalidation hook from their existing state transitions. Guard unchanged mutation callbacks
   with a layout signature and never read geometry from the per-frame unchanged-content return.
6. Clear mobile-only max-height and clipping state whenever the shared tooltip becomes another
   tooltip type or hides.
7. Add an explicit regression contract around `main.ts` and the HUD seam: only the existing world
   hover or mobile center-inspection path calls `showMobHoverTooltip()`, its clear path still hides
   and resets the tooltip, and target selection or cycling does not create a persistent panel or
   extend the transient lifetime.
8. Run the focused unit and source-contract tests.

### 3. Add bounded tooltip overflow treatment

1. Add failing CSS source contracts for hidden overflow, the clipped state, and a bottom fade.
2. Add mobile-only `.mob-tooltip-clipped` styling with `pointer-events: none`; do not make the
   tooltip scrollable.
3. Re-run focused tests.

### 4. Enlarge player and Target responsively

1. Change source-contract expectations from compact `0.62`, standard `0.9`, tablet `1`, and
   Target ratio `0.8` to the approved monotonic responsive contract.
2. Confirm the focused tests fail against the old CSS.
3. Set the initial compact, standard, and tablet player scales to `0.72`, `1`, and `1.1`, with
   Target at `0.9` of the active player scale. Keep cast and swing bars derived from player scale.
4. Re-run focused tests; defer only numeric collision tuning to Task 7.

### 5. Keep compact Consumables in two rows beside the disclosure

1. Change source-contract expectations from the 100px two-column compact override to a 152px
   three-column `row wrap-reverse` layout and whole-group bottom inset.
2. Confirm the focused test fails against the old CSS.
3. Implement the compact override so items 1 through 3 occupy the lower row beside the disclosure,
   items 4 through 6 occupy the upper row, and left-handed mode mirrors the inline direction.
4. Re-run focused tests.

### 6. Add rendered browser coverage

1. Add failing browser assertions for six items as exactly three columns by two rows, logical row
   order, partial populations without holes, left-handed mirroring, and 48px hitboxes.
2. Add rendered assertions for compact, standard, and tablet player minimum widths, monotonic
   growth, Target ratio and subordination, centered safe bounds, and cast/swing width matching.
3. Run `npm run test:browser -- tests/browser/target_size.browser.test.ts` and make only
   implementation changes required by failures.

### 7. Extend and tune the canonical geometry gate

1. Extend `scripts/mobile_cluster_layout_check.mjs` to seed and measure the actual transient mob
   tooltip, six Consumables, player/Target, cast/swing, all relevant DOM obstacles, and the
   guaranteed camera-start pseudo-element rectangle.
2. Cover all seven canonical profiles, both handedness modes, both notch vectors, Button Size
   `0.8`, `1`, and `1.3`, UI-scale extremes, tooltip scale `0.85` and `1.5`, and populated
   pet/party/camera states.
3. Add same-content resize/mirroring invalidation and deterministic long quest-content checks.
   Also mutate Consumables, Party, target, and measured chrome geometry while content is unchanged,
   then assert the visible tooltip recomputes its maximum height and clearance.
4. Run the gate. Tune only player tier scales, Target ratio within `0.86` through `0.9`, and the
   compact whole-group bottom inset. Choose the smallest values meeting every acceptance bound.
5. Record the final constants in source-contract assertions.

### 8. Refresh visual evidence

1. Update `scripts/mobile_hud_layout_shots.mjs` to seed six distinct Consumables and activate the
   existing transient mob-tooltip path.
2. Generate compact right-handed and left-handed notch captures plus the existing standard/tablet
   reference set.
3. Inspect all five PNGs for two rows, readable unit frames, correct tooltip placement, mirroring,
   and absence of overlap.

### 9. Reconcile superseded documentation

1. Update the older PRD, implementation plan, and solution notes so they no longer prescribe
   compact two-column by three-row Consumables or the old frame scales as current behavior.
2. Link back to the approved follow-up spec and this plan.

### 10. Verify the complete change

1. Run the focused unit, source-contract, and browser tests.
2. Run `npm run check:ts` and `npm run build`.
3. Run the real-browser mobile geometry gate and screenshot generator.
4. Run the repository QA gate where unrelated dirty generated localization state permits it;
   report any pre-existing failure separately with exact command output.
5. Review `git diff --check` and the final scoped diff before reporting completion.
6. Compare every touched already-dirty path against the captured pre-change scoped diff and report
   only this plan's added hunks as the delivered change.

## Definition of done

- The transient mob description begins 8 visual pixels below the minimap, mirrors with it, remains
  viewport-contained, clips long supplemental content with a fade, and repositions on every
  approved layout invalidation without changing its trigger or lifetime. Target selection and
  cycling never create or prolong it.
- Player rendered widths meet 180px compact, 250px standard, and 275px tablet; tier growth is
  monotonic. Target remains between 0.86 and 0.9 of player and narrower than player. Cast and swing
  retain player width and existing vertical gaps.
- One through six Consumables occupy at most three columns and two rows; six are exactly three by
  two on every landscape tier. Compact ordering, partial populations, left-handed mirroring, 48px
  hitboxes, and 4px actionable clearances all pass.
- Desktop and portrait-gate behavior are unchanged.
- Unit, source-contract, rendered browser, TypeScript, production build, canonical geometry, and
  visual evidence checks pass, with unrelated dirty-worktree failures explicitly separated.
