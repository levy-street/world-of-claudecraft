# HUD Program Validation Report (consolidated)

Severity-ranked findings across both HUD packets, merging five validator reports
with the independent verifications of every high-severity finding. Where a
verification REFUTED a finding it is dropped from the actionable tiers and noted
under HOLDS/REFUTED. Severities are the CORRECTED (post-verification) ones.

ASCII only. No em dashes. No emojis.

Packets:

- Refactor: `docs/ui-architecture-hud-modularization/` (files prefixed REF below)
- UX/a11y: `docs/hud-ux-and-accessibility/` (files prefixed UX below)

Severity tiers: BLOCKING (must fix before that phase can execute) > HIGH
(misleading guidance that wastes a session or ships a half-fix) > MED (real but
bounded) > LOW (nuance/polish) > HOLDS (confirmed correct, kept for assurance).

Post-verification count: BLOCKING = 0. HIGH = 9. (Two findings originally tagged
BLOCKING were downgraded to HIGH by verification; one originally HIGH was
REFUTED to LOW.)

---

## LINCHPIN VERDICTS (verbatim)

Refactor Phase 1 (DOM harness):

> NOT FEASIBLE AS WRITTEN without a canvas-2D shim or jsdom+node-canvas.
> Blockers, in construct order: (1) ~26 class-FIELD initializers run
> document.querySelector('#id') before the ctor body (hud.ts:236-269); the $
> helper (hud.ts:62) casts null to T with no guard, and fields
> castbarFillEl/LabelEl/TimerEl (262-264) immediately call .querySelector('.fill')
> on castbarEl, so a missing #castbar throws at field-init. The fake DOM must
> mirror index.html's id/class skeleton byte-for-byte (Invariant #3). (2) The CTOR
> itself uses canvas 2D three times: minimapCtx = mm.getContext('2d')! (352),
> renderTerrainCanvas() which does createElement('canvas').getContext('2d')! then
> ctx.createImageData() (353 -> 1885-1889), and drawPortrait() -> ctx.clearRect/
> drawImage + iconCanvas() (350 -> 933-936, icons.ts:1282-1285/1396). happy-dom
> AND jsdom return null from getContext('2d'); the trailing '!' is a lie, so these
> throw 'Cannot read properties of null' DURING construction. (3) update()'s
> per-frame core re-hits canvas: updateMinimap() (1818 -> 1931 uses minimapCtx)
> every fastHud frame, and drawPortrait for a set target (1607) ... the canvas
> shim/dep MUST be decided in Phase 1 before any text assertion can run; the
> plan's 'stub the canvas in the fake world' wording is imprecise because the
> canvas draws happen on Hud-owned elements created from the DOM skeleton and on a
> throwaway createElement('canvas'), not on the fake world object -- the shim must
> live on the prototype/global, not on fake_world.ts.

Verification verdict: PARTIAL, severity now HIGH. The factual core is CONFIRMED;
downgraded from BLOCKING because the plan is NOT silent on it (REF state.md:128-132
logs it as a Phase-1 OPEN item and the STOPPING RULE forces a recorded resolution).
The defect is misleading-guidance + a mechanism gap routed through a decision gate,
not an undiscovered blocker.

Refactor P2 window-extraction linchpin:

> Feasible but NOT the clean "10 disjoint one-PR render/toggle/update classes
> threading ctx.gate" the plan describes. Hard issues: (a) P1 (HudContext +
> primitives) does not exist yet ... (b) Windows are not disjoint where the plan
> assumes: the window manager (closeManagedWindow/windowZ/syncWindowOpenState ...)
> is touched by every toggle and has per-window cases that must be co-edited as
> each window leaves ... (c) Trade/Arena/Market/Social have per-frame update woven
> into update() (lines 1798-1832) and Trade has no toggle/render at all, colliding
> with the "per-frame core stays untouched" invariant. Spellbook is a poor
> "cleanest" exemplar because of dragAction. Correct the template and per-window
> risk ranks before execution.

UX foundation linchpin (token + mobile, SPLIT VERDICT):

> (A) Token-promotion + cached readToken: the readToken-feeds-the-canvas-painter
> rationale is INFEASIBLE/UNNECESSARY as stated because the canvas painter
> (icons.ts compose(), L1281-1351) never reads QUALITY_COLOR -- it paints from
> PALETTES + FX glow/sparkle, and L1331 comments "quality border lives in CSS
> outside it". So there is no per-frame getComputedStyle risk to solve on the
> canvas at all; QUALITY_COLOR is consumed only by DOM HTML in hud.ts (8 sites,
> all style="color:..."/border-color strings) and the static .q-* CSS classes.
> Promoting QUALITY_COLOR to --quality-* tokens IS feasible and worthwhile for
> theming the DOM text colors, and a cached readToken() is still the right helper
> for the FEW JS sites that build inline color strings -- but the plan's framing
> must be corrected to "tokens feed the DOM color strings + reconcile the .q-* CSS
> classes," not "feed the canvas painter." Note the .q-* classes already diverge
> from QUALITY_COLOR (common #b8b8b8 vs #ffffff), so the byte-identical guarantee
> in phase-01 cannot hold across both surfaces simultaneously -- a deliberate
> decision is required. (B) Removing user-scalable=no risking touch controls:
> removing the scale lock ALONE does NOT restore page pinch-zoom over the HUD and
> does NOT break the in-game camera (camera pinch/swipe-look bind to #game-canvas
> directly, mobile_controls.ts:194-209). The actual blocker to page pinch is the
> CSS touch-action:none on body.game-active (index.html:220) and body.mobile-touch
> #ui/#game-canvas (3828-3829); phase-05 MUST relax those rules (canvas keeps
> touch-action:none, page/HUD must drop it) for the WCAG 1.4.4 fix to actually
> work. The plan's "canvas listener is already scoped so pinch falls through to
> the page" is therefore necessary-but-insufficient and slightly wrong about the
> current behavior.

CI integration linchpin:

> CI integration is BROKEN as planned: the new Playwright visual-baseline and
> Playwright/axe gates never run in CI. CI executes only `npm test` (= vitest run)
> + tsc + builds (ci.yml:46-62), and Phase 5 deliberately keeps Playwright OUT of
> `npm test` ("its own pre-merge step", phase-05:57,96) without any phase adding
> that step to ci.yml. A new phase (in each packet, or a shared one) MUST update
> ci.yml to add a Playwright job (visual + axe) and assert the perf gate;
> otherwise the refactor's "no visual regression" and the a11y packet's "axe green
> in CI" definitions of done are unenforced.

Verification verdict: PARTIAL, severity now HIGH. The Playwright half is
CONFIRMED unenforced; the axe half is PARTIAL because the axe UNIT specs
(`tests/a11y/*.test.ts`) run under Vitest and DO ride CI. Downgraded from BLOCKING
because the highest-value gates already land in CI via `npm test`; the defect is
false DoD wording plus an unmade decision on whether the Playwright tier ever
becomes a CI gate.

Cross-packet coherence linchpin:

> Visual-baseline handoff IS clean and explicit in direction ... The contradiction
> is resolved by design. BUT the dependency that refactor Phase 5 must land BEFORE
> any UX phase can run its `npx playwright test` validation is NOT in the UX
> 'Cross-packet dependency' pre-flight checklist (UX state.md:82-92 lists only
> refactor P11 and P13/15-23) - so a UX Phase 1 or 5 session, told it may start
> before the refactor completes, will hit a validation step it cannot run. Add
> refactor Phase 5 to the UX cross-packet checklist as a hard prerequisite for the
> visual-validation step of EVERY UX phase.

---

## BLOCKING

None after verification. The two findings originally filed BLOCKING
(hud-construct-needs-dom-canvas; CI integration) were both downgraded to HIGH by
independent verification: each is a real defect, but each is already routed
through an existing gate (a Phase-1 STOPPING RULE; a Vitest-hosted gate that does
ride CI) rather than being an undiscovered hard wall. They are the top two HIGH
items below and must be fixed before their phases execute.

---

## HIGH

### H1. Phase 1 cannot instantiate Hud without a prototype canvas-2D shim
Was BLOCKING (Validator 1 F2); verified PARTIAL -> HIGH.
The `Hud` constructor needs a byte-identical `index.html` id/class skeleton AND
`getContext('2d')` returning a stub (3 ctor call sites; `happy-dom`/`jsdom` both
return null). The shim must be on `HTMLCanvasElement.prototype.getContext` or
`globalThis`/`document.createElement`, NOT on `fake_world.ts` (the terrain and
portrait canvases are created via `createElement('canvas')` and never touch the
IWorld stub).
FIX: Edit REF `phase-01-dom-harness-and-perf-gate.md` STEP 2 and the canvas
STOPPING RULE: state the canvas-2D shim lives on `HTMLCanvasElement.prototype`
(or `globalThis`/`document`), not on `fake_world.ts`; and that `jsdom` needs the
native `canvas` package (devDep) to actually return a 2D context, while
`happy-dom` needs the prototype shim. Add: keep `fakeWorld.player.targetId = null`
so the per-frame portrait draw is skipped, and install the full id/class skeleton
into `document.body` before constructing. Also update REF `state.md:128-132` OPEN
item to record the shim location.

### H2. CI never runs the Playwright visual + Playwright-axe gates
Was BLOCKING (Validator 5 F1); verified PARTIAL -> HIGH.
`.github/workflows/ci.yml:46-62` runs only `npm test` + `tsc` + builds. REF
`phase-05` forbids wiring Playwright into `npm test`. No phase edits `ci.yml`. So
visual baselines and the `@axe-core/playwright` AAA sweep are local-only; the axe
UNIT specs (`tests/a11y/*.test.ts`) and the perf gate DO ride CI via `npm test`.
FIX (two parts):
(a) Add a MISSING CI phase (shared, or one per packet) that edits
`.github/workflows/ci.yml`: a Playwright job (`npx playwright install` +
`playwright test` for visual baselines and the `@axe-core/playwright` specs)
added to BOTH `pr-gate` and `release-gate`, plus an explicit assertion that
`tests/hud_perf_budget.test.ts` runs under `npm test`. See M-NEW below.
(b) Until that lands, correct the false wording: REF `implementation-plan.md:124`
("All ride the PR-tier `npm test`") -> the Playwright/visual tier is pre-merge
local, NOT yet CI-enforced; the Vitest gates do ride CI. UX
`implementation-plan.md:108` ("verified by axe-core in CI") -> the axe UNIT
checks ride CI; the Playwright-axe AAA sweep does not yet. UX `qa-checklist.md:10`
("axe-core ... green in CI (unit + Playwright)") -> qualify to unit-in-CI,
Playwright-pre-merge.

### H3. Vitest collects the Playwright specs and breaks `npm test`
Validator 5 F2; verified CONFIRMED with empirical proof -> HIGH.
`vite.config.ts:97-99` has no `include` override; the Vitest default include glob
matches `tests/visual/*.spec.ts`. `testDir` scopes only the Playwright runner. A
probe spec confirmed `vitest run` collects `tests/visual/*.spec.ts` and exits
non-zero once `@playwright/test` is the import.
FIX: Edit REF `phase-05-playwright-visual-baselines.md` to ALSO add
`'**/tests/visual/**'` to the Vitest `exclude` in `vite.config.ts` (it currently
forbids touching that file; that prohibition must carve out this one line), OR
name the Playwright specs off the `{test,spec}` pattern. Add an acceptance check:
`npm test` collects zero Playwright specs. Note in REF `state.md` and UX
`state.md`. (Phase 3's `tests/a11y/*.test.ts` run under Vitest by design, so no
`tests/a11y` exclusion is needed.)

### H4. Token premise is wrong: the canvas painter never reads QUALITY_COLOR
Validator 3 F3; verified CONFIRMED -> HIGH.
`icons.ts compose()` (L1281-1351) paints from PALETTES + FX only; L1331 says
verbatim "quality border lives in CSS outside it". All 8 `QUALITY_COLOR`
consumers are DOM color strings in `hud.ts`
(`:1008,3191,3491,3535,3588,3661,3879,4709`). The "canvas needs the hex / cached
readToken feeds the painter" premise is false.
FIX: Rewrite UX `phase-01-design-token-system.md` GOAL (line 15), Agent B (line
50), and acceptance text, plus UX `research-brief.md:512` and UX `state.md:97`,
so `readToken()` feeds the JS-built inline DOM color strings in `hud.ts`, NOT the
canvas painter. Drop the "no per-frame getComputedStyle on the canvas hot path
for QUALITY_COLOR" framing (the canvas never reads it; it keeps using
`qualityFx()` for glow/sparkle). Keep cached `readToken()` for the DOM sites.

### H5. QUALITY_COLOR has no single source of truth; .q-* CSS already diverges
Validator 3 F4; verified CONFIRMED (deeper) -> HIGH.
Two rarity surfaces disagree: JS `QUALITY_COLOR` colors item NAME TEXT
(`common=#ffffff`); the static `.q-*` CSS classes (`index.html:734-738`) color
the item ICON BORDER (`.q-common` border `#b8b8b8`, plus an epic box-shadow no JS
map has). Only `common` diverges. "One source of truth, byte-identical" cannot
hold across both surfaces at once.
FIX: UX `phase-01-design-token-system.md` must (a) add `index.html:734-738` to
the migration scope, and (b) consciously DECIDE: keep two semantic tokens
(`--quality-common-text #ffffff` vs `--quality-common-border #b8b8b8`, preserving
byte-identity) OR unify (a real visual change, contradicting the zero-delta/STOP
rule). State the decision in the phase doc and UX `state.md`.

### H6. Removing user-scalable=no does not restore HUD pinch-zoom; CSS blocks it
Validator 3 F11; verified CONFIRMED -> HIGH.
Camera swipe-look + pinch listeners ARE canvas-scoped (`mobile_controls.ts:194-209`),
but page/HUD pinch is killed by `touch-action:none` on `body.game-active`
(`index.html:220`) and `body.mobile-touch #ui` (`:3829`), where `#ui` is the
full-screen HUD overlay. The plan's "pinch already falls through to the page" is
wrong about current behavior.
FIX: Edit UX `phase-05-mobile-pointer-foundation.md` (step-2 Agent A #2, lines
87-93) and UX `research-brief.md:597-599`: deliverable 1/2 must EXPLICITLY relax
`touch-action:none` on `body.game-active` (`index.html:220`) and
`body.mobile-touch #ui` (`:3829`), while KEEPING `#game-canvas` at
`touch-action:none` (`:3828`). Add a re-test step that the canvas camera pinch
still works after the page-level relax. Correct the "already scoped so it falls
through" wording.

### H7. UX cross-packet checklist omits refactor Phase 5 (visual-baseline infra)
Validator 4 XPKT-2; verified CONFIRMED -> HIGH.
UX `state.md:82-91` lists only refactor P11 and P13/15-23. But every UX visual
validation runs `npx playwright test` (UX `state.md:57`; UX
`phase-01-design-token-system.md:72`; UX `phase-window-polish-template.md:174-178`).
`playwright.config.ts` + `tests/visual/` are created ONLY by refactor Phase 5 and
do not exist yet. UX Phase 1 is cleared to start early, and its Playwright step
has no escape hatch (unlike the axe step which is guarded).
FIX: Add a row to the UX `state.md:82-91` cross-packet checklist: "The Playwright
visual-baseline infra (refactor Phase 5: `playwright.config.ts` + `tests/visual/`)
must have landed before ANY UX phase's visual-validation step. UX Phase 1/5 may
begin coding early but cannot complete visual validation until refactor Phase 5
lands." Soften UX `phase-01-design-token-system.md:19` and UX
`implementation-plan.md:77` to "can begin coding early; visual validation gates
on refactor Phase 5."

### H8. Window-manager close switch and per-frame dispatch are NOT disjoint
Validator 2 F3 + Validator 1 P2-window-manager-seam + p2-window-disjoint-render-coupling;
verified CONFIRMED (manager seam) and PARTIAL->MED (render coupling) -> net HIGH.
`closeOtherWindows(_keep?)` (`hud.ts:5961-5964`) is an inert stub. The real
close-side-effect manager is `closeManagedWindow` (`:666-684`) with a per-window
switch (`:669-682`) calling `closeOptions`/`closeMarket`/`cancelPetFeed`/
`talentStage` reset, all of which live INSIDE window regions slated for
extraction. Extracting Talents/Bags/Trade/Market/Social/Options forces a co-edit
of that switch. Separately, `refreshLocalizedDynamicUi()` (`:1093`) and the
per-frame `update()` loop (`:1798-1832`) re-enter extracted windows via method
names OUTSIDE the `{toggle*/render*/update*}` symbol set (`renderSocial`,
`refreshSocialList`, `refreshMarket`, `updateTradeWindow`).
FIX: Edit REF `phase-p2-window-template.md`: (a) name `closeManagedWindow`'s
switch (`:669-682`) as a CO-EDITED surface for those 6 windows; thread a close
hook through `HudContext` (`ctx.windows.closeManagedWindow` or a per-window
`onClose`); qualify the "window manager itself out of scope" (template:72) and
the "disjoint files, rebases cleanly" claim (REF `state.md:138-140`) for those 6.
(b) Add a call-site SWEEP step: grep ALL invocations of the window's methods (not
just `toggle/render/update`), and state that rewiring the module's render into
`refreshLocalizedDynamicUi` and the `update()` tier dispatch IS a permitted,
required exception to the "don't touch the per-frame core" invariant.

### H9. The uniform render/toggle/update window triad is false
Validator 2 F2 + P2-window-render-toggle-update-triad; verified CONFIRMED -> HIGH.
The template (REF `phase-p2-window-template.md:36,57,94`) and Spellbook prompt
(REF `phase-13-p2-spellbook.md:35,76`) demand every window class expose
`render()/toggle()/update()`. Reality: Spellbook/Talents/QuestLog/Character have
NO `update()`; Trade has ONLY `updateTradeWindow()` (no toggle/render, sim-driven
open state). The Spellbook prompt even calls Spellbook "read-mostly, no per-frame
update path" (L25) while its STEP-5 acceptance (L76) demands an `update()`.
FIX: Edit REF `phase-p2-window-template.md` STEP 5 (lines 36, 57, 94) and REF
`phase-13-p2-spellbook.md` (lines 35, 76): drop the rigid triad. Make the surface
conditional: read-mostly windows (Spellbook, Talents, QuestLog, Character) expose
`toggle()+render()` only; Trade exposes a per-frame `update()/sync()` only (open
state stays sim-derived); Arena keeps both toggle/render and a per-frame
`update()`; Market/Social keep toggle/render with conditional re-render. Fix the
"opens, closes, and updates in `npm run dev`" smoke line to match each window's
real surface (Trade has no open/close entry to test; Spellbook has no update).

---

## MED

### M1. Spellbook is not the "cleanest disjoint" exemplar (shares action-bar drag)
Validator 2 F5 + P2-spellbook-shares-action-bar-drag-plumbing; verified
CONFIRMED. Verifier held at HIGH for the framing; placed at MED here because the
fix overlaps H9 and the Spellbook STOPPING RULE surfaces it during discovery.
`renderSpellbook` (`hud.ts:4203`) sets `this.dragAction` (`:4236`), calls
`writeDraggedAction` (`:4237`) and `clearActionDropTargets` (`:4243`) plus
`hideTooltip`/`attachTooltip`/`abilityTooltip`, the SAME action-bar drag plumbing
the plan flags only for Bags.
FIX: Demote the "simplest/disjoint/nothing outside HudContext" framing in REF
`phase-13-p2-spellbook.md` (L12, L26) and the plan's Spellbook row
(REF `implementation-plan.md:99`). Add `dragAction`, `writeDraggedAction`,
`clearActionDropTargets`, `hideTooltip`, `attachTooltip`, `abilityTooltip` to the
Spellbook prompt's expected `HudContext` members. Note `dragAction` is shared by
Bags AND Spellbook AND Talents; whichever extracts first establishes the
drag-state-via-HudContext seam (do not single out Bags).

### M2. No online-mode (ClientWorld) QA in either packet
Validator 5 F4; verified (within Validator 5) HIGH/MISSING -> MED here (it is a
missing test leg, not a doc error blocking a phase).
Neither `qa-checklist.md` covers online mode, `ClientWorld`, latency, or
interest-scoped (~120yd) partial snapshots. The harness/`fake_world` is
offline-only and drives steady state, not partial snapshots or target loss.
FIX: Extend REF `mcp-qa-runbook.md` (Phase 5) and both `qa-phase-template.md`
files with an online-mode leg: a `npm run server`-backed walkthrough for phases
touching per-frame target/entity churn (player/target frame, nameplates, Social
online announcements). Add a `fake_world` mutator that drops entities mid-run
(simulated partial snapshot). Add a `qa-checklist` line: "Online mode: window
open/update and live regions behave correctly across interest-scoped snapshot
churn and target loss."

### M3. P2 prompts assume the P1 primitives exist; no STEP-1 existence pre-flight
Validator 2 F1 + P2-windows-P1-primitives-missing; verified PARTIAL -> MED
(sequencing is correct; absence today is the expected pre-execution state, so
this is prompt hardening, not a plan-construction error).
`src/ui/hud/` does not exist; the prompts tell the Explore agent to "read"
`hud_context.ts`/`hot_write_gate.ts`/`reactive_diff.ts`/`icon_service.ts`
unconditionally (REF `phase-13-p2-spellbook.md:26-28`; REF
`phase-p2-window-template.md:49`).
FIX: Add a hard STEP-1 existence pre-flight to both prompts: "If
`src/ui/hud/hud_context.ts` is absent, STOP: refactor Phases 7/9/11 have not
landed." Fast-fail instead of failing mid-flight if run out of dependency order.

### M4. No program kickoff / cross-packet sequencing doc
Validator 5 F7; verified MISSING -> MED.
No single doc defines global phase ordering, merge gating, or CI evolution across
both packets; the only cross-packet info is inside UX `state.md:80-91`.
FIX: RESOLVED by this synthesis: `docs/hud-program-roadmap.md` is the kickoff doc
(global ordering, dependency graph, critical path, concurrency, CI evolution
pointer, rollback). Add a pointer to it from both `state.md` files and both
`README.md` files.

### M5. No production rollback strategy in either packet
Validator 5 F8; verified MISSING -> MED.
No phase defines how to back out a bad merge from production beyond `git revert`.
The UX packet ships user-visible behavior changes (viewport unlock removing
`user-scalable=no`, themes, Edit Mode, input-mode gate) that can regress live
play. The input-mode gate is highest-risk: a regression breaks WASD for all
players.
FIX: Add a rollback section to `docs/hud-program-roadmap.md` and both `state.md`
files: rollback unit is one card = one PR = one revertable commit; ship the
riskiest UX behavior changes (viewport, input-mode gate, themes) behind a
settings/localStorage flag so they can be disabled without a redeploy; `DEPLOY.md`
is the production rollback reference.

### M6. Large pending-translation backlog at release
Validator 5 F9; verified DRIFTED -> MED.
The UX packet adds hundreds of English-only aria-label/announcement/theme/Edit-Mode
keys that land `pending` in `i18n.status.json`. The release-tier gate
(`I18N_RELEASE_TIER=1`, `tests/localization_fixes.test.ts:240-241` H3b +
empty-pending, `it.runIf(RELEASE_TIER)`) hard-fails on any `pending` row at the
first `release/**` push.
FIX: Add to UX `state.md` i18n note (and `docs/hud-program-roadmap.md`) an
explicit release-readiness item: the maintainer must batch-fill the pending
backlog via `npm run i18n:worklist` BEFORE any `release/**` push. Recommend a
mid-program `npm run i18n:scan` checkpoint to size the backlog.

### M7. Market ARIA assignment wrongly includes a slider
Validator 4 ARIA-Market-slider; verified DRIFTED -> MED.
UX `phase-window-polish-template.md:36` and UX `implementation-plan.md:100` list
"slider (#11)" for Market price/quantity, but the live code uses
`<input type=number>` (`hud.ts:3543,3550-3552`), not range sliders. A range
slider for an auction gold price is wrong UX. Sliders belong in Options
(`settingSlider` already uses native `<input type=range>` at `:5603-5610`).
FIX: Drop "slider (#11)" from the Market row in UX
`phase-window-polish-template.md:36` and UX `implementation-plan.md:100`. Market
price/quantity stay native `<input type=number>` with `aria-label` +
`formatMoney`/`formatNumber`. Reserve slider (#11) for Options.

### M8. Aura signature is multi-element; does not map to one ReactiveDiff instance
Validator 1 F5; DRIFTED -> MED.
The aura `sig` is stashed per-DOM-element (`(el as any).__sig`, `hud.ts:1836-1840`),
and `renderAuras` runs for distinct elements (buff bar vs target debuffs).
`ReactiveDiff<T>` as specced holds ONE internal `lastSig` per instance.
FIX: REF `phase-09-extract-reactivediff.md` must keep one `ReactiveDiff` instance
PER aura element (buff-bar and target-debuffs are separate diffs) or key
`lastSig` by element. Add an explicit note that the aura case is multi-element and
must not collapse two elements' sigs into one instance. (Also: Social's content
sig is `JSON.stringify(this.sim.socialInfo)` (`:5097/1823`); `StructuralDiff`
must reproduce that exact stringify, not a hand-built join.)

### M9. Phase 11 HudContext member list overstates what exists
Validator 1 F9; DRIFTED -> MED.
No `windowManager` object and no `tooltip` helper object exist; window management
is `initWindowManagement()` + scattered methods + a `MutationObserver`; tooltips
are a `tooltipEl` node + inline methods. `t`/`formatMoney`/`formatNumber` are
MODULE imports, not Hud fields.
FIX: Rewrite the `HudContext` member list in REF
`phase-11-iconservice-and-hudcontext.md`: pass `t`/format fns as module function
refs (fine); but "window manager" and "tooltip helper" are not discrete objects.
Either narrow `HudContext` to what truly exists (`hotWriteGate`, `iconService`,
`sim:IWorld`, `keybinds`, the renderer-pick/worldToScreen methods, `t`, format
fns, plus the close hook from H8 and the drag-state from M1) and defer
window/tooltip seams, OR explicitly scope extracting a `WindowManager`/`Tooltip`
helper into Phase 11 (which contradicts its "wraps existing, no redesign"
framing, so the narrowing is preferred).

### M10. Trade/Market/Arena extraction couplings under-documented
Validator 2 F11/F12/F14; DRIFTED -> MED.
Trade has local `stagedTrade` staging (by design, not drift), no toggle/render,
and force-opens/closes `#bags` (`hud.ts:5460-5469`). Market entry is
`openMarket`/`closeMarket` (proximity-gated via `nearbyMarketNpc`), not a free
toggle, with a per-frame hook and Bags coupling. Arena has per-frame
auto-hide-on-match (`arenaMatchSeen`, `:1813-1817`) woven into `update()`, plus a
leaderboard `fetch` + `performance.now` throttle.
FIX: In REF `phase-p2-window-template.md` per-window notes: (a) Trade is an
`update()`-only module COUPLED to Bags; sequence after Bags or extract as a pair.
(b) Market entry is proximity-gated `openMarket/closeMarket` with a per-frame
refresh and Bags coupling; reads world/entities for `nearbyMarketNpc`. (c) Arena
extraction must move/callback the per-frame auto-hide and the leaderboard fetch
throttle state; the test must mock `fetch`.

---

## LOW

### L1. README/anchor hygiene
Anchors in REF `state.md:117-126` are currently accurate (docs authored same
day), but concurrent sessions on the shared worktree can drift them; phases must
re-grep by symbol. (Validator 1 F10.) No fix beyond the existing re-grep
instruction.

### L2. Options is a drill-down today, not a tablist
Validator 4 ARIA-Options. `renderOptions` (`hud.ts:5568`) is a drill-down
menu, not a tablist; slider/switch assignments are correct. Converting to a
tablist is a deliberate restructure. FIX: In the Options row of UX
`phase-window-polish-template.md`, flag the tablist as a decision (drill-down ->
tabs) rather than asserting it; keep slider/switch as-is.

### L3. QuestLog pass adds a confirm step (small behavior change)
Validator 4 ARIA-QuestLog. Abandon currently fires immediately
(`hud.ts:4716-4720`); the planned alertdialog confirm is an added safeguard, so
the QuestLog QA diff will not be purely cosmetic. FIX: note this in the QuestLog
row (informational).

### L4. Pre-existing role+aria-live double-write at hud.ts:4989
Validator 3 F12. `role='alert' aria-live='polite'` together is the double-speak
anti-pattern the announcer rule warns against. FIX (optional): note as a
candidate cleanup in UX `phase-03`/`phase-07`; out of strict scope.

### L5. :root is already partially layered
Validator 3 F5. `index.html:96-164` already has ~50 vars with aliases
(`--color-primary` aliases `--gold`, font aliases). FIX: UX `phase-01` should
note "promote flat set into semantic aliases" is partly done; avoid re-doing
existing aliases.

### L6. Social opens via `.open` class, not `display`
Validator 2 F13. `social-window` toggles `classList 'open'`
(`hud.ts:585,672,5113`), not `style.display`. FIX: add a Social caveat to the
template/QA so open-state assertions use the class, not `style.display`.

### L7. client_shell.test rewrite must preserve index.html structural checks
Validator 1 F7. Many `client_shell.test.ts` assertions are raw index.html/CSS
substrings unrelated to Hud behavior. FIX: REF Phase 1's rewrite to behavioral
assertions must preserve (or move) those index.html structural checks, not drop
them.

### L8. i18n.en.ts is a concurrent-append hot file across UX window passes
Validator 4 BRANCH-1. Branch names do not collide, but `src/ui/i18n.en.ts` is
appended by every UX window pass. FIX: add a note to UX `state.md` to keep each
window's new keys in a distinct nested namespace and land lower-numbered cards
first; clarify in both READMEs that "Phase N" is packet-scoped.

### L9. localization_fixes/client_shell source-coupling loses coverage on extraction
Validator 5 F3. `tests/localization_fixes.test.ts` (`:54,:452,:489`) and
`tests/client_shell.test.ts:6` read `hud.ts` as a STRING. When window code moves
to `src/ui/hud/<window>.ts`, source-coupled guards silently lose coverage. FIX:
add a step to REF `phase-p2-window-template.md`: when a window extracts, re-point
or extend any source-scanning i18n/shell guard to also scan the new module file
(or finish the Phase 3 conversion to runtime assertions so file location is
irrelevant). Add a tracking OPEN item to REF `state.md`.

### L10. Playwright and puppeteer mobile shots coexist (not a deprecation)
Validator 5 F10. REF Phase 5 keeps the `mobile_*_shot.mjs` puppeteer scripts.
FIX (optional): one line in `docs/hud-program-roadmap.md` / REF `state.md` that
Playwright (committed golden-master diff) and the `.mjs` scripts (ad-hoc shots)
coexist.

### L11. Edit Mode server-sync decision should be made before Phase 25
Validator 5 F6. The OPEN server-sync item is adequately flagged (UX Phase 27 +
migration-safety trigger; `characters.state JSONB` is the real target,
`server/db.ts:46`). FIX (optional): note in UX `state.md` OPEN items that the
localStorage-vs-server decision should be made before Phase 25 (it changes the
layout schema shape; a later localStorage->JSONB migration would itself need
back-compat).

---

## HOLDS (confirmed correct) and REFUTED

Confirmed correct (kept brief for assurance):

- HOLD: `Hud` ctor is cleanly injectable (3 deps, no internal subsystem
  construction); a stub `Renderer` cast `as unknown as Renderer` suffices.
  (Validator 1 F1.)
- HOLD: `hotWriteCache` + 4 setters + 2 counters + PUBLIC `perfStats()` exist;
  the perf gate reads `perfStats().hotDomSkipRate` with no new accessor.
  (Validator 1 F3.)
- HOLD: all 7 signature sites exist as anchored; Social content sig is
  `JSON.stringify(socialInfo)`. (Validator 1 F4.)
- HOLD: `tests/localization_fixes.test.ts` and `tests/client_shell.test.ts`
  source-couple to `hud.ts` exactly as described (the Phase 3 target).
  (Validator 1 F6/F7.)
- HOLD: Vitest env is `node`, no `happy-dom`/`jsdom`/`@vitest/browser` installed;
  per-file `// @vitest-environment happy-dom` is the right path (paired with the
  H1 prototype shim). (Validator 1 F8.)
- HOLD: all 10 window root ids exist and are shared with `index.html`
  (`:5303-5407`); Invariant 3 (byte-identical ids) is real and important.
  (Validator 2 F13.)
- HOLD: Bags shares `dragAction` with the action bar; thread via `HudContext`.
  (Validator 2 F8.) Broaden to Spellbook + Talents (see M1).
- HOLD: Character owns a preview canvas via `CharacterPreview` (Three.js); the
  test may need to MOCK `CharacterPreview` rather than rely on a 2D polyfill.
  (Validator 2 F9.)
- HOLD: Options keybind capture delegates through `OptionsHooks.captureKey` on
  the modal gate; `optionsHooks.settings.get` is read OUTSIDE Options too, so
  `optionsHooks` must stay reachable from `hud.ts` after extraction.
  (Validator 2 F10.)
- HOLD: viewport meta at `index.html:5` has `user-scalable=no` exactly as
  anchored. (Validator 3 F1.)
- HOLD: `QUALITY_COLOR` at `icons.ts:1358` with the byte-matching hex values.
  (Validator 3 F2.)
- HOLD: UX Phase 3's HudContext hard gate is correctly written and WILL fire;
  Phase 3 is BLOCKED until refactor Phase 11 lands `HudContext`. Phases 1/5 have
  no such dependency (modulo the F7 visual-validation gate). (Validator 3 F6/F7,
  phase-03-hudcontext-seam-gate verification.)
- HOLD: movement binds on `KeyboardEvent.code` not `.key`; the AZERTY auto-map
  claim is correct. (Validator 3 F9.)
- HOLD: the visual-baseline handoff (refactor extracts pixel-identical -> UX
  re-baselines on purpose) is clean and explicit in BOTH directions; the
  contradiction is resolved by design. (Validator 4 XPKT-1.)
- HOLD: UX Phase 3 depends on refactor Phase 11 `HudContext`; the best-specified
  cross-packet dependency, with a robust grep + STOP gate. (Validator 4 XPKT-3.)
- HOLD: per-window UX precondition is a per-window file-existence gate, so the
  differing extraction vs polish orders are harmless. (Validator 4 XPKT-4.)
- HOLD: a11y additions are perf-safe via cached `readToken()` + the >0.8 skip
  rate gate (a Vitest test that rides CI). Tighten only by asserting announcer
  coalescing caps announce/sec and adds no per-frame allocation. (Validator 5
  F5.)
- HOLD: both packets add `t()` keys English-first per the repo i18n rules; the
  matcher references are the dispatch guard, not emits. (Validator 4 I18N-1.)
- HOLD: input-mode gate is feasible and additive; a two-mode gate already exists
  (`canUseGameKeys` + `suspendMovement`). Net-new work is hardening the keydown
  text guard (`input.ts:356-357` misses `isContentEditable` and `select`; reuse
  `isEditableContextTarget` at `input.ts:148`) and formalizing the gate as an
  explicit `inputMode` on `HudContext`. (Validator 3 F10.)
- HOLD: QuestLog is genuinely clean; ARIA assignments for Bags (grid), Social
  (tablist + per-row listbox-vs-grid judgment), Trade/Arena (dialog + live
  region/meter) are sound. (Validator 4 ARIA-*.)

REFUTED (do NOT action):

- REFUTED -> LOW: "only one modal uses `env(safe-area-inset)` today" was filed
  HIGH/BROKEN by Validator 3 (F8). Verification REFUTED it: the 61
  `env(safe-area-inset` usages are non-modal touch-HUD chrome (joysticks, bars,
  frames, minimap, chat); the real `.window` (`index.html:690-692`) and
  `.modal-backdrop` (`:3508-3516`) modals genuinely LACK insets, and
  `mobile_controls.ts:248` is the one modal that already injects them. The plan's
  "only one modal" wording is CORRECT. UX Phase 5 step-2 #3 is a REAL gap audit
  (the `.window`/`.modal-backdrop` modals need insets on notched devices), NOT
  redundant make-work. Only nuance left (LOW): the sub-list of overlay elements
  (frames, minimap, chat, toasts) DOES already carry insets, so treat that
  sub-list as a completeness check. Acting on the original HIGH verdict would
  wrongly skip real work.
