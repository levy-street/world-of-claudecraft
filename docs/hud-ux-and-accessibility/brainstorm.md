# Brainstorm: HUD Visual + UX + Accessibility

Feature slug: `hud-ux-and-accessibility`
Branch: `feature/hud-ux-and-accessibility` (one branch per phase/card under it)
Owner: Fernando
Status: Approved vision, phased packet authored 2026-06-17.

This is the follow-on initiative to the `ui-architecture-hud-modularization`
refactor. The refactor is the enabler: it turns `hud.ts` into per-window modules
consuming a shared `HudContext`, adds a DOM test harness, and captures Playwright
visual baselines. THIS packet layers a premium look, world-class UX, and deep
accessibility ON TOP of those modular components, deliberately re-baselining
visuals as it goes.

The deep, cited research that grounds every decision here lives in
`research-brief.md` (9 sections, primary sources, three load-bearing claims
independently fact-checked). Read it for the why behind any recommendation; this
brainstorm is the vision and the approved scope.

---

## 1. Vision

Make the HUD look beautiful and play like a top-tier MMO: a premium
dark-fantasy aesthetic in the classic-MMO lineage, fluid and legible UX on
desktop and touch, and accessibility pushed to WCAG 2.2 AAA where feasible with a
genuine opt-in Reader Mode. The marquee feature is a classic-style Edit Mode layout
editor, which the modular refactor makes possible (each window is now a movable
unit). None of this invents new game systems; it elevates the presentation of the
systems that already exist.

## 2. Why this is a separate packet from the refactor

The refactor is behavior-preserving on purpose: its safety net (characterization
tests, golden DOM snapshots, visual baselines) assumes pixels and behavior do not
change, so any diff means a bug, not a redesign. This packet intentionally changes
visuals and adds behavior (focus management, announcements, themes). Mixing the
two would destroy that net. So: extract cleanly first (the refactor), polish and
make-accessible deliberately second (this packet), re-baselining the Playwright
snapshots with a reviewed diff at each visible change.

## 3. Locked decisions (from the user, 2026-06-17; see state.md)

1. Visual direction: premium dark-fantasy (evolved classic). Dark slate panels,
   restrained gold trim, subtle parchment, class crest sigils, crisp readable
   type. A polished modern take on the classic-MMO lineage, achieved procedurally
   with CSS plus canvas (no new image assets).
2. Accessibility target: WCAG 2.2 AA as the floor, pushing to AAA where feasible
   (enhanced contrast 7:1 where practical, etc.), PLUS a full opt-in Reader Mode.
3. Edit Mode layout editor (drag-reposition windows, save/load named layouts,
   persisted): included as the capstone workstream, clearly separable.
4. Widget navigation: roving tabindex on REAL DOM elements (not
   aria-activedescendant, which mobile screen readers handle poorly).
5. Tooltips: hybrid. Associated text (aria-describedby) for simple tooltips; an
   explicit "inspect" dialog for dense item tooltips.
6. New deps are devDependencies (a11y testing: axe-core / @axe-core/playwright);
   any runtime addition must be tiny and justified. Edit Mode persists to
   localStorage first (client-only); server-side per-character sync is an OPEN
   follow-up, not a default (it would add server scope).

## 4. The realistic accessibility ceiling (verified, be honest about it)

- Fully screen-reader accessible: menus, inventory/bags, character, talents,
  social, market, quest log. These are turn-based, DOM-backed surfaces.
- Accessible via assists: targeting, looting, casting, and slower combat, through
  coalesced live-region announcements plus assists (soft-target, directional
  earcons, click-to-move, click-casting).
- NOT parity-accessible and NOT promised: reflex-gated real-time combat. Reader
  Mode aims at meaningful play and full menu access, not twitch parity.

## 5. The 8 foundation workstreams (from research)

1. Input-mode gate (game-input vs UI-focus) + a text-input guard + KeyboardEvent
   .code-based movement, so Tab/Enter drive the UI without stealing WASD, and
   typing in chat never moves the avatar.
2. Mobile unblock: remove the verified viewport scale lock (`user-scalable=no` on
   `index.html` line 5, fails WCAG 1.4.4) and apply `env(safe-area-inset-*)`
   everywhere edge-anchored.
3. Design tokens: split the existing `:root` set into primitive + semantic CSS
   custom properties; migrate `QUALITY_COLOR` (verified `src/ui/icons.ts:1358`)
   into `--quality-*` tokens read by the canvas icon painter via a cached
   `readToken()`; add a `--text-scale` multiplier.
4. Roving-tabindex action bar + bag grid with `t()` slot labels.
5. A shared modal helper on the `HudContext` seam: focus-trap, `inert` background,
   an Escape stack, and focus restore on close.
6. Single-pointer alternatives for every drag and for pinch-zoom (WCAG 2.5.7 /
   2.5.1), so nothing requires a multi-point or path-based gesture.
7. An announcer singleton with throttled/coalesced live regions, gated behind the
   explicit Reader Mode.
8. Theme swap (a high-contrast theme and Okabe-Ito colorblind-safe palettes) plus
   `--text-scale`, all by swapping semantic token values; and the Edit-Mode-style
   layout editor as the capstone riding the modular refactor.

## 6. Reusable surface (what exists to build on)

- The modular HUD from the refactor packet: `src/ui/hud/<window>.ts` modules and
  the `HudContext` service bag. This packet hangs the focus-trap helper, the
  roving-tabindex util, the announcer, and the token reader off `HudContext`.
- The Playwright DOM visual baselines + the happy-dom unit harness from the
  refactor's P0. This packet adds axe-core a11y assertions and re-baselines
  visuals deliberately.
- The i18n net: every new aria-label, title, placeholder, and announcement string
  is a `t()` key (English first; the maintainer fills locales by release). The
  matchers and `formatNumber`/`formatMoney`/`formatDateTime` already exist.
- Procedural icons (`icons.ts`) and `QUALITY_COLOR`: the canvas painter reads
  tokens after the migration, so themes recolor icons for free.
- The existing `:root` CSS variables and the touch-controls/mobile layout in
  `src/game/`.

## 7. New work needed

- Dev deps: axe-core + @axe-core/playwright (automated a11y checks in the unit
  harness and the Playwright suite). No new runtime framework.
- A token layer (primitive/semantic CSS custom properties) and the dark-fantasy
  semantic palette, plus high-contrast and colorblind theme token sets.
- A11y interaction primitives on `HudContext`: input-mode gate, focus-trap/inert/
  Escape-stack/focus-restore, roving-tabindex util, announcer + live regions,
  single-pointer drag util.
- Per-surface visual + a11y passes (persistent chrome, then each window) applying
  the aesthetic, ARIA roles/states/keyboard per the widget spec, contrast and
  target-size to AAA where feasible, and `t()` labels.
- Reader Mode wiring (announce target/HP/cast/cooldown/loot, coalescing, assists).
- Themes + text-scale UI in Options; full reduced-motion coverage.
- Edit Mode: drag-reposition with grid snap, save/load named layouts, reset,
  localStorage persistence.

## 8. Cross-packet dependency (important)

This packet rides on the refactor. Sequencing:
- Can start before the refactor finishes: the design-token system (Phase 1) and
  the mobile/pointer foundation (Phase 5) are mostly CSS/markup and do not need
  the modular seam.
- Needs the refactor's `HudContext` (refactor Phase 11): the a11y interaction
  foundation (Phase 3) hangs utilities off `HudContext`.
- Needs each window extracted (refactor Phases 13, 15-23): the per-window visual +
  a11y passes (Phases 7, 9-18) restyle and instrument the extracted modules.
- Late phases (Reader Mode, themes, AAA pass, Edit Mode) need the windows
  instrumented and the tokens stable.
Record exact cross-packet checkpoints in state.md and confirm them in each phase's
pre-flight before starting.

## 9. OPEN items (decide before/within the relevant phase; never assume)

- Canvas-vs-DOM accessibility for canvas-backed surfaces (minimap pins, floating
  combat text, 3D character preview): provide a hidden DOM/live-region text
  equivalent for each, since a canvas is opaque to the a11y tree. Settle the exact
  per-surface approach in Phase 7 (chrome) and the Character window pass.
- Edit Mode persistence: localStorage-first (client-only, default) vs per-character
  server sync (adds `characters.state` JSONB scope and a migration-safety review).
  Decide at the Edit Mode persistence phase; default local.
- AAA reachability: some AAA criteria (e.g. 1.4.6 enhanced contrast 7:1) may
  conflict with the gold-on-dark aesthetic in places; where AAA and the look
  collide, AAA wins for text legibility and the aesthetic adapts. Flag specific
  conflicts as they arise; do not silently drop AAA.
- Reduced motion: confirm the floating-combat-text and VFX-adjacent HUD motion all
  honor `prefers-reduced-motion` and the in-game toggle.
