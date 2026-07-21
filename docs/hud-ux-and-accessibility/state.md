# State: HUD Visual + UX + Accessibility (cross-phase cheat sheet)

The next session reads THIS file plus `research-brief.md`, not the transcript.
Locked decisions, validation matrix, review-dispatch matrix, cross-packet
dependency, file paths, and the running ledger. Keep current after every phase.

Current phase: not started (packet authored 2026-06-17).
Critical path: Phase 1 (tokens) -> Phase 7 (chrome pass) -> Phases 9-18 (window
passes) -> Phase 19 (Reader Mode) -> Phase 25/27 (Edit Mode capstone).

---

## Locked decisions (do not re-litigate)

1. Visual direction: premium dark-fantasy (evolved classic). Dark slate, restrained
   gold trim, parchment accents, class crest sigils, crisp type. Procedural (CSS +
   canvas), no new image assets.
2. Accessibility target: WCAG 2.2 AA floor, push to AAA where feasible, PLUS a full
   opt-in Reader Mode. Where AAA legibility and the aesthetic collide, AAA wins.
3. Edit Mode layout editor: included as the capstone, clearly separable.
4. Widget navigation: roving tabindex on REAL DOM elements (not aria-activedescendant).
5. Tooltips: hybrid (aria-describedby for simple; an inspect dialog for dense items).
6. New deps are devDependencies (axe-core + @axe-core/playwright). No new runtime
   framework. Edit Mode persists to localStorage first; server sync is OPEN.
7. This packet DELIBERATELY changes visuals: re-baseline Playwright snapshots with a
   reviewed diff at each visible change (the refactor's "baselines must not change"
   rule is intentionally relaxed here, replaced by "re-baseline on purpose, review the diff").

## Non-negotiable invariants every phase preserves

1. IWorld-only access. Modules read the world through `IWorld`; never `Sim`/
   `ClientWorld` concretely. No new `IWorld` member is expected (UX/a11y is
   client-only); if one seems needed, STOP and surface.
2. t()-only render sink. EVERY new aria-label, title, placeholder, alt,
   `document.title`, announcement, and confirm/prompt string is a `t()` key present
   for `en` (locales filled by the maintainer at release). Numbers/money/dates via
   `formatNumber`/`formatMoney`/`formatDateTime`/`Intl`. This packet adds many
   labels; the i18n guard (`tests/localization_fixes.test.ts`) must stay green.
3. DOM id/class contract. The ~214 ids `index.html`/CSS depend on stay stable.
   Visual changes go through tokens/classes, not by renaming structural ids.
4. Determinism. No `Math.random`/`Date.now`/`performance.now` in `src/sim/`; sim
   stays DOM-free. HUD animations may read wall-clock; sim may not.
5. Per-frame budget. The per-frame core stays imperative under rAF; no per-frame
   allocations added. Token reads on the canvas hot path go through a CACHED
   `readToken()` (do not call getComputedStyle per frame). The hot-write skip rate
   stays above ~80% (refactor's `tests/hud_perf_budget.test.ts`).
6. Accessibility does not regress gameplay. The input-mode gate must never swallow
   movement/hotkeys during normal play; focus traps apply only to modal UI.
7. Shared-worktree commit hygiene. Stage only your card's files with explicit
   paths. Never `git add -A`. One card, one branch (`feature/<card-id>-<slug>`),
   one PR. Push to origin (levy-street), never the fork.
8. No em dashes or emojis in any doc, comment, or player-facing string (raw emojis
   as in-game icons remain disallowed by the aesthetic rule).

## Validation matrix (by change type)

- Visual/token change: `npx tsc --noEmit` + `npx vitest run tests/hud_harness.test.ts tests/hud_perf_budget.test.ts`; `npx playwright test` then re-baseline deliberately (`npx playwright test --update-snapshots`) ONLY after reviewing the visual diff; a mobile screenshot script at a phone viewport.
- A11y change (roles/labels/focus/keyboard): the above PLUS the axe-core assertions (`npx vitest run tests/a11y/*.test.ts` and/or `npx playwright test tests/a11y`) and `npx vitest run tests/localization_fixes.test.ts` (new labels are `t()` keys).
- Reader Mode / announcer: axe + a manual screen-reader pass (VoiceOver/NVDA) recorded in the QA, plus live-region unit tests.
- Edit Mode (localStorage): harness + a persistence round-trip unit test (save layout, reload, assert restored). If server sync is chosen, add the persistence/DDL matrix and migration-safety review.
- Build / pre-merge (mirrors CI): `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`. The final `npm run build` must show the game bundle does not pull in the dev-only a11y deps.

## Review-dispatch matrix (spawn ONLY the agents whose surface the diff touches)

This packet is client-only (`src/ui`, `src/game`, `index.html`/CSS, `tests`,
`scripts`, build config). Most phases trigger `qa-checklist` plus the a11y/visual
verification, not the heavy review agents.

| Agent | Spawn ONLY when the diff touches | This packet |
|---|---|---|
| `privacy-security-review` | `server/`, `src/admin/`, `src/net/`, a deploy/secret/CI file, or new SQL/auth/secret/`ALLOW_DEV_COMMANDS`/`Math.random`\|`Date.now`\|`performance.now` in `src/sim/` | Only if Edit Mode adds server-side layout sync, or a CI/E2E file toggles `ALLOW_DEV_COMMANDS`. |
| `migration-safety` | `server/db.ts`, `server/social_db.ts`, a `server/*_db.ts`, or a `characters.state` JSONB path | Only if Edit Mode persists layouts to `characters.state` (the OPEN server-sync option). Default localStorage avoids it. |
| `cross-platform-sync` | `src/world_api.ts`, `src/sim/` behavior/obs/`SimEvent`, `src/net/online.ts`, `server/game.ts` wire/dispatch, the matchers, or the RL surface | Not expected (no IWorld/sim change). If a phase touches `IWorld`, STOP and surface. |
| `qa-checklist` | a phase/deliverable set is complete | Every phase. |

Always-on for this packet (not an agent, a procedure): axe-core automated checks
+ a Playwright MCP live-game walkthrough that switches locale and toggles themes/
text-scale/Reader Mode, plus a manual screen-reader pass on a11y-heavy phases.

## Cross-packet dependency (the ui-architecture-hud-modularization refactor)

Confirm these in each phase pre-flight before starting:
- The Playwright visual-baseline infra (refactor Phase 5: `playwright.config.ts` +
  `tests/visual/` + the CI Playwright job) must have landed before ANY UX phase's
  visual-validation step can run. This is a HARD prerequisite for EVERY UX phase that
  re-baselines visuals. UX Phase 1/5 may begin CODING early but cannot COMPLETE
  visual validation until refactor Phase 5 lands.
- Phase 1 (tokens) and Phase 5 (mobile/pointer): can be CODED early before the
  refactor completes (CSS/markup; no modular seam needed), but visual validation
  requires refactor Phase 5 to have landed (see the row above).
- Phase 3 (a11y interaction foundation): needs the refactor's `HudContext` seam
  (refactor Phase 11). Hang the new utilities off `HudContext`.
- Phase 7 (persistent chrome) and Phases 9-18 (per-window passes): need the
  relevant surface extracted (refactor Phases 13, 15-23). A window pass restyles +
  instruments that window's module.
- Phases 19-27 (Reader Mode, themes, AAA, Edit Mode): need the windows instrumented
  and tokens stable.

## Key file paths

Existing:
- `index.html` (line 5: `user-scalable=no`, remove it; the ~214 ids contract).
- `src/ui/icons.ts` (`QUALITY_COLOR` at `:1358`; the canvas icon painter to feed tokens).
- `src/ui/hud/` (the refactor's modular windows + `hud_context.ts` seam).
- `src/ui/i18n.ts` (`t()`, `supportedLanguages`, `formatNumber`/`formatMoney`/`formatDateTime`).
- `src/game/` (touch controls, input, keybinds; the input-mode gate hooks here).
- the `:root` CSS variables (current ad hoc set; Phase 1 formalizes them).
- `tests/hud_harness.test.ts`, `tests/hud_perf_budget.test.ts`, `playwright.config.ts`, `tests/visual/` (from the refactor packet).
- `research-brief.md` (this packet's cited research; per-widget ARIA specs, token taxonomy, SR model).

Created by this packet (ledger; fill as phases land):
- (Phase 1) `src/ui/hud/tokens.css` or the formalized token block, `--quality-*` migration, cached `readToken()` helper, `tests/tokens.test.ts`.
- (Phase 3) `src/ui/hud/a11y/` (input_mode.ts, focus_trap.ts, roving_tabindex.ts, announcer.ts), `tests/a11y/*.test.ts`.
- (Phase 5) viewport/safe-area edits, `src/ui/hud/a11y/pointer.ts` (single-pointer drag util).
- (Phase 21) high-contrast + colorblind theme token sets, theme + text-scale UI in Options.
- (Phase 25/27) `src/ui/hud/edit_mode.ts`, layout persistence, `tests/edit_mode.test.ts`.

## New IWorld members / SimEvents / wire fields / endpoints / tables

NONE expected (client-only). The only possible exception is Edit Mode server-side
layout sync (OPEN, default avoided). Any other addition is a red flag; record and
justify or revert.

## i18n note

This packet adds MANY new `t()` keys (aria-labels, announcements, theme/option
labels, Edit Mode UI). Add them to `en` first (`src/ui/i18n.en.ts`); do not edit
the locale overlays (the maintainer batch-fills at release). Keep
`tests/localization_fixes.test.ts` and `npx tsc --noEmit` green.

## OPEN items / gotchas

- Canvas surfaces (minimap, FCT, character preview) need a hidden DOM/live-region
  text equivalent for the a11y tree; settle per surface (Phase 7, Character pass).
- Edit Mode persistence: localStorage default; server sync OPEN (adds scope).
- AAA vs aesthetic contrast conflicts: AAA legibility wins; the look adapts.
- Re-baselining visuals is expected and deliberate here; an UNREVIEWED snapshot
  update is not allowed (always inspect the diff).

## Rollback

Rollback unit is one card = one PR = one revertable commit. Ship the riskiest
user-visible behavior changes behind a settings/localStorage flag so a regression
can be toggled OFF without a redeploy: the viewport unlock (removing
`user-scalable=no`), the input-mode gate (highest-risk; a regression breaks WASD for
all players), and the themes. `DEPLOY.md` is the production rollback reference.
