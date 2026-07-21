# HUD Program Roadmap

Top-level program doc tying the two HUD planning packets into one coherent
program. ASCII only. No em dashes. No emojis. Read this first; then descend into
the packet that owns the phase you are running.

- Refactor packet: `docs/ui-architecture-hud-modularization/`
- UX/accessibility packet: `docs/hud-ux-and-accessibility/`

This roadmap is the single source of truth for cross-packet sequencing, the
critical path, what can run concurrently, and the program-level risks. The two
packet `state.md` files remain the live ledgers for their own phases; this doc
points at them and never duplicates their per-phase detail.

---

## Vision

The HUD is one 6,280-line `src/ui/hud.ts` file that owns persistent chrome, ten
on-demand windows, the per-frame render loop, the i18n matchers, and all visual
styling at once. The program splits this into two sequenced efforts that share
one structural seam: the refactor packet first carves each on-demand window into
its own `src/ui/hud/<window>.ts` module behind a shared `HudContext`, extracts
the reusable primitives (`HotWriteGate`, `ReactiveDiff`/`StructuralDiff`,
`IconService`), and lands behavioral tests, a hot-write perf gate, and Playwright
visual baselines so behavior is provably preserved; the UX/accessibility packet
then restyles those now-modular windows into the dark-fantasy aesthetic, layers
WCAG 2.2 AA (pushing AAA where feasible) plus an opt-in Reader Mode, fixes mobile
viewport and pointer accessibility, and finishes with an Edit Mode layout editor.
The end state is a maintainable, testable, accessible, and beautiful HUD where
behavior, performance, and pixels are each guarded by a gate rather than eyeball.

---

## The two packets and their relationship

| | Refactor packet | UX/accessibility packet |
|---|---|---|
| Dir | `docs/ui-architecture-hud-modularization/` | `docs/hud-ux-and-accessibility/` |
| Goal | Structure: modular windows + primitives + gates | Surface: dark-fantasy restyle + WCAG 2.2 AA/AAA + Reader Mode + mobile + Edit Mode |
| Touches | `src/ui/hud.ts` -> `src/ui/hud/*`, tests, build config | `index.html`/CSS, `src/ui/icons.ts`, `src/ui/hud/*`, `src/game/*`, new a11y utils |
| Visual rule | Baselines must NOT change (extraction is pixel-identical) | Baselines DELIBERATELY change (re-baseline on purpose, review the diff) |
| Phase count | 1..25 (impl + QA interleaved) | 1..28 (impl + QA interleaved) |

The relationship is strictly one-directional and is resolved by design:

- The refactor CREATES the structure (`HudContext`, `src/ui/hud/<window>.ts`,
  visual baselines on the PRE-refactor HUD). The UX packet CONSUMES that
  structure (hangs a11y utilities off `HudContext`, restyles each extracted
  window module) and then re-baselines the visuals on purpose.
- The refactor's "baselines must not change" invariant and the UX packet's
  "deliberately re-baseline" decision do NOT contradict: the refactor proves
  extraction changed no pixels, then the UX packet intentionally changes pixels
  window by window and re-baselines with a reviewed diff (UX locked decision 7).

Note: phase NUMBERS are packet-scoped and collide in name only. Refactor Phase 5
is Playwright visual baselines; UX Phase 5 is mobile/pointer. Refactor Phase 11
is `IconService`/`HudContext`; UX Phase 11 is the Character window pass. Always
qualify "Phase N" with its packet.

---

## Full cross-packet dependency graph (ASCII)

Legend: `-->` hard dependency (must land first). `[R-n]` refactor phase n,
`[U-n]` UX phase n. QA phases (even numbers in each packet) are omitted for
clarity; each impl phase is gated by its own QA phase before the next consumes
it.

```
REFACTOR PACKET                                  UX / ACCESSIBILITY PACKET

[R-1] DOM harness + perf gate ----+
  |                               |
  |  (parallel, share R-1 only)   |
  +--> [R-3] i18n decouple +      |
  |        IWorld parity +        |
  |        sim-purity boundary    |
  |          |                    |
  +--> [R-5] Playwright visual    |
  |        baselines + MCP QA ----+----------------------------+
  |          |   (PRE-refactor golden master)                  |
  |          |                                                  v
  +--> [R-7] HotWriteGate                       [U-1] design tokens + palette
            |                                        |   (CSS only; starts early)
            v                                        |   visual VALIDATION step
        [R-9] ReactiveDiff/StructuralDiff           |   waits on --> [R-5]
            |  (migrate 7 sig sites)                 |
            v                                        |
        [R-11] IconService + HudContext ------+      |
            |                                 |      |
            |                                 +----> [U-3] a11y interaction
            v                                 |        foundation (HudContext)
        [R-13] Spellbook (worked template)    |        |
            |                                 |        |   (also starts early,
            +--> [R-15..R-23] 9 windows       |        |    CSS/markup only)
                 Talents, QuestLog,           +----> [U-5] mobile + pointer
                 Character, Options,          |        (viewport, safe-area,
                 Social(+R-3), Trade,         |         touch-action, pinch)
                 Bags, Market, Arena          |
                   |   |                       \
                   |   |  each window R-1x ----> [U-7] persistent chrome pass
                   |   |  gates its U pass      |   (needs chrome present)
                   |   |                        |
                   |   +-- per window --------> [U-9..U-18] per-window
                   |       (R extract gates         visual + AAA a11y passes
                   |        the matching             (each gated on its window
                   |        U window pass)           being extracted by R)
                   |                                  |
        [R-24] per-frame perf hardening               v
            (needs R-1 skip-rate gate)        [U-19] Reader Mode (needs windows
                                                      instrumented; needs U-7)
                                                      |
                                              [U-21] themes + text-scale
                                                      (needs tokens stable U-1)
                                                      |
                                              [U-23] AAA conformance pass
                                                      |
                                              [U-25] Edit Mode core
                                                      (needs windows modular)
                                                      |
                                              [U-27] Edit Mode persistence
                                                      (localStorage; server OPEN)

MISSING / TO-ADD (see "Confirmed risks"):
  [CI] ci.yml Playwright + axe job  --> gates BOTH packets' visual/a11y DoD
  [ONLINE-QA] ClientWorld snapshot-churn QA leg --> applies to per-frame phases
```

Edges in words (hard prerequisites only):

- `[R-1] --> R-3, R-5, R-7` (everything needs the harness + perf gate first).
- `[R-7] --> R-9 --> R-11` (primitives build on each other, sequential).
- `[R-11] --> R-13 --> R-15..R-23` (HudContext gates window extraction).
- `[R-3] --> R-19 Social` (Social touches the matcher boundary; see risk note,
  this is a SOFT dep via `localizeZone`, not the recognition matchers).
- `[R-11] --> U-3` (a11y foundation hangs off HudContext; hard STOP gate).
- `[R-5] --> U-1, U-5, and every U phase's visual-VALIDATION step` (no
  `playwright.config.ts` / `tests/visual/` exists until R-5 lands).
- `[R-1x window extract] --> [U-(matching) window pass]` (per-window, file
  existence gate; the two packets order the 10 windows differently but the gate
  is per-window so the order mismatch is harmless).
- `[U-1] --> U-21` (themes need stable tokens).
- `[U-7] + windows instrumented --> U-19` (Reader Mode).
- `windows modular --> U-25 --> U-27` (Edit Mode capstone last).

---

## Critical path across both packets

The longest hard-dependency chain that gates final delivery:

```
[R-1] harness + perf gate
  --> [R-7] HotWriteGate
  --> [R-9] ReactiveDiff/StructuralDiff
  --> [R-11] IconService + HudContext
  --> [R-13] Spellbook (worked template, proves the seam)
  --> [R-15..R-23] remaining 9 window extractions
  --> [U-9..U-18] per-window visual + AAA a11y passes
  --> [U-19] Reader Mode
  --> [U-25] Edit Mode core
  --> [U-27] Edit Mode persistence
```

R-5 (visual baselines) is NOT on the longest chain but is an early hard gate for
all UX visual validation, so it must land alongside R-1/R-7 even though it does
not block the structural extraction chain. The CI Playwright/axe job (missing
phase) gates the DEFINITION OF DONE of both packets, not the build of any single
phase, so it sits beside the path rather than inside it; schedule it after R-5
creates the Playwright config and before window extractions begin re-baselining.

---

## What can run concurrently (across fresh sessions)

The packets are built for parallel sessions on the shared worktree. Stage only
your card's files, never `git add -A`, one card / one branch / one PR.

Early, before the structural chain completes:

- `[R-1]`, `[R-3]`, `[R-5]` are mutually independent after they share R-1's
  output (R-3 is parallel-safe with R-1; R-5 depends only on R-1). Disjoint
  files.
- `[U-1]` (tokens, CSS only) and `[U-5]` (mobile/pointer, markup/CSS only) can
  begin CODING early with no HudContext dependency. CAVEAT: their visual
  VALIDATION step (`npx playwright test`) cannot RUN until `[R-5]` has landed
  `playwright.config.ts` + `tests/visual/`. Code early, validate after R-5.

Mid-program, once `[R-11]` HudContext exists:

- `[U-3]` (a11y foundation) unblocks.

Once `[R-13]` plus each `[R-1x]` window extraction lands:

- The window extractions `[R-15..R-23]` can run concurrently across sessions
  (disjoint new files, disjoint id roots) PROVIDED the co-edited surfaces are
  handled (see risks: the `closeManagedWindow` switch and the per-frame /
  language-change dispatch are shared and must be serialized or rebased).
- Each `[U-(window)]` pass unblocks as soon as ITS window module exists. Because
  the refactor extraction order and the UX polish order differ, a given UX
  window can be ready while a lower-numbered one is still blocked; the per-window
  file-existence gate handles this correctly.

Late (mostly sequential): `[U-19]`, `[U-21]`, `[U-23]`, `[U-25]`, `[U-27]` form
a near-linear tail; `[U-21]` (themes) only needs stable tokens so it can overlap
the per-window passes.

Concurrency hot files to serialize (not git-distinct, content-contended):

- `src/ui/hud.ts` window-manager switch (`closeManagedWindow`, ~`:669-682`) and
  the per-frame / `refreshLocalizedDynamicUi` dispatch are co-edited by ~6
  window extractions. Land lower-id cards first and rebase.
- `src/ui/i18n.en.ts` is appended by EVERY UX window pass. Keep each window's new
  keys in a distinct nested namespace; land lower-numbered cards first.

---

## Start here

Run refactor Phase 1 first: `docs/ui-architecture-hud-modularization/phase-01-dom-harness-and-perf-gate.md`.
It builds the DOM test harness (`tests/helpers/fake_world.ts`,
`tests/hud_harness.test.ts`) and the hot-write perf gate
(`tests/hud_perf_budget.test.ts`) that every later phase in BOTH packets leans
on. Nothing else can be proven correct until this lands.

LINCHPIN STATUS for Phase 1 (verified against live `src/ui/hud.ts`):

- The Phase 1 linchpin (instantiate the real `Hud` in a DOM env and assert
  rendered text) is FEASIBLE but NOT as the current wording implies. It needs a
  canvas-2D shim that the plan under-specifies. Confirmed mechanism gaps:
  1. The `Hud` constructor (not just `update()`) requires a full `index.html`
     id/class skeleton: ~26 class-field initializers run `document.querySelector`
     BEFORE the ctor body, and `castbarFillEl/LabelEl/TimerEl` immediately
     dereference `.querySelector('.fill')` on `#castbar`, so a missing id throws
     at field-init.
  2. The constructor calls `getContext('2d')` three times (minimap, terrain
     canvas, portrait) with a trailing `!`. `happy-dom` AND `jsdom` return `null`
     from `getContext('2d')`, so these THROW during construction. `happy-dom`
     alone does not provide a 2D context.
  3. The shim must live on `HTMLCanvasElement.prototype.getContext` (or
     `globalThis`/`document.createElement`), NOT on `fake_world.ts`: the terrain
     and portrait canvases are created via `document.createElement('canvas')` and
     never touch the IWorld stub, so a shim on the fake world cannot intercept
     them. The plan's "stub the canvas in the fake world" wording is imprecise
     and must be corrected before any text assertion can run.
- VERDICT: feasible with a prototype-level canvas-2D shim plus a byte-identical
  id/class skeleton, both decided IN Phase 1 (the plan already routes this
  through a STOPPING RULE, so the gate exists; the wording is what needs fixing).
  See the validation report's BLOCKING/HIGH section for the exact edits.

UX linchpin status (token + mobile approach), for when the UX packet starts:

- Token approach: FEASIBLE, but the central premise "the canvas icon painter
  reads `QUALITY_COLOR` / still needs the numeric hex" is FALSE. The canvas
  painter never consumes `QUALITY_COLOR`; all 8 consumers are DOM color strings
  in `hud.ts`, and a second surface (the `.q-*` CSS classes in `index.html`)
  already diverges from `QUALITY_COLOR` on `common` (`#b8b8b8` vs `#ffffff`).
  Repoint the token migration at the DOM sites + reconcile the `.q-*` classes;
  the cached `readToken()` helper is still the right pattern for the DOM sites.
- Mobile approach: FEASIBLE, but removing `user-scalable=no` alone will NOT
  restore HUD pinch-zoom. `body.game-active` and `body.mobile-touch #ui` carry
  `touch-action:none`; UX Phase 5 must explicitly relax those two CSS rules while
  keeping `#game-canvas` at `touch-action:none`. The safe-area work is already
  ~done in CSS (61 `env(safe-area-inset` usages); re-scope to a gap audit).

---

## Confirmed risks and how the plan handles them

Distilled from five validator reports plus independent verification. Full
severity-ranked detail and exact doc fixes live in
`docs/hud-program-validation-report.md`. Highlights:

1. CI does not run the new visual/a11y gates (HIGH, partially blocking the DoD).
   CI runs only `npm test` (Vitest) + `tsc` + builds. Refactor Phase 5
   deliberately keeps Playwright OUT of `npm test`, and no phase edits
   `.github/workflows/ci.yml`. So Playwright visual baselines and the
   `@axe-core/playwright` sweep are honor-system local-only; the Vitest-hosted
   axe unit checks and the perf gate DO ride CI. HANDLING: add a missing CI phase
   (one shared, or one per packet) that adds a Playwright + axe job to both
   pr-gate and release-gate, and correct the false "all ride npm test" wording.

2. Vitest will collect the Playwright specs and fail (HIGH). The Vitest default
   include glob matches `tests/visual/*.spec.ts`; `testDir` scopes only the
   Playwright runner. HANDLING: refactor Phase 5 must add `'**/tests/visual/**'`
   to the Vitest `exclude` in `vite.config.ts` (empirically verified to break
   `npm test` otherwise).

3. Phase 1 cannot instantiate `Hud` without a canvas shim (HIGH). See "Start
   here". HANDLING: the plan already gates this through a Phase 1 STOPPING RULE;
   the wording (shim on `fake_world.ts`, "jsdom is enough") is wrong and must be
   corrected to "shim on `HTMLCanvasElement.prototype`; jsdom needs node-canvas".

4. Token premise is wrong about the canvas (HIGH). The canvas never reads
   `QUALITY_COLOR`. HANDLING: rewrite UX Phase 1 GOAL/acceptance to target the
   DOM color sites + the `.q-*` CSS classes, and decide consciously whether to
   keep two tokens (text `#ffffff` vs border `#b8b8b8`) or unify (a real visual
   change).

5. Mobile pinch-zoom fix is incomplete (HIGH). `touch-action:none` on the page
   and HUD swallows pinch. HANDLING: UX Phase 5 must relax those CSS rules
   explicitly, not just rely on canvas listener scoping.

6. UX cross-packet checklist omits refactor Phase 5 (HIGH). UX Phase 1/5 are
   cleared to start early but hit an unrunnable `npx playwright test`. HANDLING:
   add a checklist row "visual validation gates on refactor Phase 5" and soften
   the early-start wording to "code early, validate after R-5".

7. Window-extraction co-edited surfaces are not disjoint (HIGH). The
   `closeManagedWindow` switch and the per-frame / language-change dispatch are
   shared by ~6 windows. HANDLING: thread a close hook through `HudContext`, name
   `closeManagedWindow` (~`:669-682`) as a co-edited surface, and qualify the
   "disjoint files, rebases cleanly" claim for those windows.

8. The uniform render/toggle/update window triad is false (HIGH). Spellbook
   shares action-bar drag plumbing (not the "cleanest disjoint" exemplar); Trade
   has only `update()`; several windows have no `update()`. HANDLING: make the
   template's window surface conditional, and add the drag-state members to the
   Spellbook prompt's expected `HudContext` set.

9. No online-mode (ClientWorld) QA exists in either packet (MISSING). The
   harness is offline-only; interest-scoped snapshot churn and target loss are
   untested. HANDLING: add an online-mode QA leg (a `npm run server`-backed
   walkthrough + a fake-world entity-drop path) for the per-frame phases.

10. Large pending-translation backlog at release (MED). The UX packet adds many
    English-only keys that land `pending`; the release-tier gate hard-fails on
    any pending row. HANDLING: note the release batch-fill cost and recommend a
    mid-program `i18n:scan` checkpoint to size it.

11. No production rollback strategy (MED). HANDLING: state that the rollback unit
    is one card = one PR = one revert; ship the riskiest UX behavior changes
    (viewport unlock, input-mode gate, themes) behind a settings/localStorage
    flag so they can be disabled without a redeploy.

REFUTED by verification (do NOT action): the "only one modal uses
`env(safe-area-inset)`" claim is essentially CORRECT (the 61 usages are non-modal
touch chrome; the real `.window`/`.modal-backdrop` modals genuinely lack insets),
so the earlier "BROKEN/HIGH" verdict was downgraded to LOW. Treat UX Phase 5
step-2 #3 as a real gap audit, not redundant make-work.

---

## Pointers

- Refactor live ledger: `docs/ui-architecture-hud-modularization/state.md`
- UX live ledger: `docs/hud-ux-and-accessibility/state.md`
- Consolidated findings + exact doc fixes: `docs/hud-program-validation-report.md`
- Start phase: `docs/ui-architecture-hud-modularization/phase-01-dom-harness-and-perf-gate.md`
