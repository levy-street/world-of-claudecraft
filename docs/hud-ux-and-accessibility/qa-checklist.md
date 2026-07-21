# QA Checklist: HUD Visual + UX + Accessibility (whole-packet gate)

Verified at packet completion (Phase 28) and per-phase for the categories a phase
touches. Unlike the refactor packet, this one INTENTIONALLY changes visuals and
adds behavior, so the test is "the HUD is more beautiful, more usable, and more
accessible, with no functional or performance regression and every change verified."

## Accessibility (the headline)
- [ ] WCAG 2.2 AA holds across the HUD; AAA met where feasible (document where not and why).
- [ ] axe-core automated checks are green. The axe UNIT specs (`tests/a11y/*.test.ts`,
      Vitest) ride `npm test` and run IN CI; the `@axe-core/playwright` sweep runs as a
      separate CI job that EXTENDS the refactor packet's Phase 5 Playwright job (gated
      on that job landing), not as part of `npm test`.
- [ ] Keyboard: every interactive control reachable and operable; visible focus
      everywhere (2.4.7) and focus not obscured (2.4.11); no keyboard trap (2.1.2);
      logical focus order (2.4.3); roving tabindex on action bar + grids.
- [ ] Input-mode gate: Tab/Enter drive the UI without stealing WASD; typing in chat
      never moves the avatar; hotkeys work in game-input mode.
- [ ] Modals: focus trapped, background inert, Escape closes, focus restored on close.
- [ ] Screen reader: a manual pass (VoiceOver or NVDA) confirms menus/inventory/
      character/talents/social/market/quests are navigable; Reader Mode announces
      target/HP/cast/loot via coalesced live regions; combat assists work; the
      realistic ceiling (no reflex-combat parity) is respected, not over-promised.
- [ ] Canvas surfaces (minimap, FCT, character preview) expose a DOM/text equivalent.
- [ ] Contrast: text >= 4.5:1 (3:1 large), UI/non-text >= 3:1; AAA 7:1 where feasible.
- [ ] Target size >= 24px (AA), larger for primary touch controls; spacing adequate.
- [ ] Motion: prefers-reduced-motion and the in-game toggle fully honored.
- [ ] Single-pointer alternatives exist for every drag and for pinch-zoom (2.5.7/2.5.1).

## Visual / aesthetic
- [ ] Premium dark-fantasy look applied consistently (dark slate, gold trim,
      parchment, crest sigils) via tokens, procedurally (no new image assets).
- [ ] Visual hierarchy and legibility hold over a busy 3D scene (text outlines/
      shadows, quality colors); dense panels remain readable at default and scaled text.
- [ ] Playwright DOM visual baselines updated DELIBERATELY with reviewed diffs;
      no unintended drift. Desktop + mobile. PREREQUISITE: the refactor packet's
      Phase 5 (`playwright.config.ts` + `tests/visual/` baselines + the CI Playwright
      job) must have landed before any visual-validation step can run.

## Theming and scaling
- [ ] Default, high-contrast, and colorblind (Okabe-Ito) themes swap via a single
      data-theme token swap; canvas icons recolor via tokens.
- [ ] Text-scale control resizes HUD text without clipping or overlap (reflow 1.4.10).
- [ ] Theme/text-scale/Reader-Mode controls live in Options, all labels t() keys.

## i18n
- [ ] Every new aria-label/title/placeholder/alt/announcement/document.title is a
      t() key present for en; numbers/money/dates via the formatters.
- [ ] tests/localization_fixes.test.ts and npx tsc --noEmit green; locale switch in
      the MCP walkthrough shows no English leak in any label, tooltip, or announcement.

## Architecture / seam / determinism / perf
- [ ] No new IWorld member, SimEvent, wire field, endpoint, or table (client-only);
      any exception (Edit Mode server sync) is justified in state.md and reviewed.
- [ ] Modules import only IWorld + helpers + HudContext; no Sim/ClientWorld/net imports.
- [ ] No Math.random/Date.now/performance.now in src/sim/; sim DOM-free.
- [ ] Per-frame budget preserved: cached token reads (no per-frame getComputedStyle);
      no per-frame allocations added; hot-write skip rate > 0.8.

## Edit Mode
- [ ] Windows reposition (mouse + keyboard) with grid snap and bounds clamping.
- [ ] Named layouts save/load/reset; default restorable; localStorage round-trip test passes.
- [ ] If server sync was chosen: additive idempotent DDL, JSONB back-compat,
      persistence round-trip test, migration-safety review passed.

## Tests / hygiene / build
- [ ] New code has tests (unit + axe a11y assertions); no dead code/unused imports;
      no leftover TODO/FIXME; no em dashes or emojis introduced.
- [ ] CI-equivalent green: npm test && npx tsc --noEmit && npm run build:env &&
      npm run build:server && npm run build.
- [ ] npm run build proves the game bundle does not pull in the dev-only a11y deps.
- [ ] Mobile verified at a phone viewport (safe areas, target sizes, no scale lock).
