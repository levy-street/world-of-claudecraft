# Phase 25 (impl): Edit Mode layout editor: core

This file is a self-contained starter prompt. Paste the fenced block below into a
fresh Claude Code session; it executes without other context. It references the
packet docs by path (do not paste their contents) and tells the runner to re-grep
named anchors rather than trust line numbers.

### Starter Prompt

```
This is Phase 25 of the HUD Visual + UX + Accessibility feature: Edit Mode layout editor: core.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: this phase is moderately batch-heavy (every window/element in the registry gains drag handles, keyboard nudge, and position announcements across two interacting agents A and B). If, after the Explore summary, the registry exposes many distinct movable surfaces or the drag + keyboard wiring fans across several modules, add ultracode and orchestrate via a Workflow so the surfaces are instrumented uniformly. Otherwise a plain Task fan-out (A, B, C) is enough.

GOAL: Implement an accessible Edit Mode that lets players drag-reposition HUD windows/elements with grid snap and bounds clamping, with a full keyboard path (arrow-key nudge), an Escape-to-exit, and live announcements of positions, reading the modular window registry via HudContext, with no IWorld change.

=== STEP 0 - PRE-FLIGHT (do this first; STOP on any failure) ===
1. Shared worktree. Run `git status`. This tree hosts concurrent sessions. If it is dirty with files you do not own, STOP and ask before touching anything; do not stash or revert another session's work. You will stage ONLY this card's files with explicit paths later (never `git add -A`).
2. CROSS-PACKET checkpoint (per docs/hud-ux-and-accessibility/state.md, "Cross-packet dependency"). This phase REQUIRES that the ui-architecture-hud-modularization refactor has landed the modular per-window modules under src/ui/hud/ AND the HudContext window registry (the refactor's HudContext seam, refactor Phase 11, plus the per-window extractions, refactor Phases 13/15-23). Concretely confirm BOTH exist before starting:
   - `src/ui/hud/hud_context.ts` exists and exposes a window registry (re-grep for the registry symbol; do NOT trust a line number).
   - the per-window modules exist under `src/ui/hud/` (the windows this editor must move are registered there).
   It also assumes the Phase 3 announcer (src/ui/hud/a11y/announcer.ts) and the Phase 5 single-pointer drag util (src/ui/hud/a11y/pointer.ts) have landed; agent B uses the announcer and agent A reuses the single-pointer drag alternative.
   If the registry, the modules, the announcer, or the pointer util are not present, STOP and surface "cross-packet checkpoint not met: <what is missing>". Do not stub the refactor.
3. Memory scan. Read ~/.claude/projects/-Users-fernando-Documents-world-of-claudecraft/memory/MEMORY.md and the notes it indexes that are relevant here: hud, i18n, shared-worktree (stage only your files), never-push-to-fork (push to origin levy-street, never the FernandoX7 fork), no-em-dashes-or-emojis, live-site-and-test-creds (worldofclaudecraft.com, fernando/turbo564, window.__game debug hook). Honor all of them.
4. Branch. Create the phase branch off the packet base: `git checkout -b feature/p25-edit-mode-core`. One card, one branch, one PR.

=== STEP 1 - LOAD CONTEXT (do NOT read planning docs or src/ui/hud.ts in the main loop) ===
Spawn ONE Explore agent to read and summarize back (return findings as text, no report files):
- docs/hud-ux-and-accessibility/state.md (locked decisions; invariants by NUMBER; validation matrix row for "Edit Mode (localStorage)" and "A11y change"; review-dispatch matrix; the ledger line "(Phase 25/27) src/ui/hud/edit_mode.ts, layout persistence, tests/edit_mode.test.ts").
- docs/hud-ux-and-accessibility/research-brief.md, ONLY these sections: 2 (WCAG 2.5.7 Dragging Movements AA, single-pointer no-drag alternative is tap-to-pick-then-tap-to-place; 2.1.1 Keyboard A; 2.4.7 Focus Visible AA; 2.4.11 Focus Not Obscured AA; 4.1.2 Name/Role/Value A; 4.1.3 Status Messages AA via role=status polite); 3 (the live-region mechanics: role=status implies aria-live=polite + aria-atomic, do not double up); 4 (the one announcer singleton, polite vs assertive, coalescing/replace-not-append; the inputMode game-vs-ui gate; the Escape-stack policy "Escape closes topmost first"; roving tabindex on real DOM, NOT aria-activedescendant); 7 (WoW Edit Mode as the north star: move/resize/show/hide HUD frames; this phase is the move/reposition core only); 8 (the t()-for-every-aria rule; the per-frame budget and aria-on-state-change-only rule). Cite the brief for these specifics; do not invent thresholds.
- docs/hud-ux-and-accessibility/progress.md, the "Phase 25 - Edit Mode core" deliverable/acceptance block ONLY.
- THIS phase prompt (docs/hud-ux-and-accessibility/phase-25-edit-mode-core.md).
- These SPECIFIC source files, individually (re-grep for named anchors; report the symbol and where it now lives, not a line number):
  * src/ui/hud/hud_context.ts (the HudContext service bag and the window REGISTRY: how windows/elements register, their ids, current position/visibility state, and how Phase 3 hung the announcer + Phase 5 the single-pointer pointer util off it).
  * the modular window modules under src/ui/hud/ (how each window's root element is addressed; the DOM id/class contract; which surfaces are movable).
  * the existing window-management / drag / z-index code: re-grep the tree for the current window-drag and z-order handlers (the brief notes legacy HTML5 drag-and-drop and window dragging once lived in hud.ts around the action-bar slot reassignment and window-drag paths; FIND where they live now post-refactor, do NOT read the giant src/ui/hud.ts in the main loop, and do NOT trust the brief's old line numbers).
  * src/ui/hud/a11y/announcer.ts (the announcer API agent B calls) and src/ui/hud/a11y/pointer.ts (the single-pointer drag alternative agent A reuses), src/ui/hud/a11y/focus_trap.ts for the Escape-stack integration point.
  * src/ui/i18n.en.ts (where to add the new en keys) and src/ui/i18n.ts (t(), formatNumber for any numeric position read-out).
  * tests/edit_mode.test.ts if present (likely absent; agent C creates it), the test harness conventions in tests/hud_harness.test.ts, and tests/a11y/ for the axe-assertion pattern.
Give every downstream agent ONLY this Explore summary, not the raw docs.

=== STEP 2 - CHOOSE ORCHESTRATION + EXECUTE ===
Fan out THREE agents in parallel (request the fan-out explicitly). A and B both write src/ui/hud/edit_mode.ts; if they will edit it concurrently, run them with isolation: "worktree" and merge, or sequence B after A on the same file. Each agent gets ONLY the Explore summary.

- Agent A - Edit Mode toggle + drag-reposition (grid snap + bounds clamp).
  Deliverables in src/ui/hud/edit_mode.ts:
  * An Edit Mode enter/exit toggle that reads the window REGISTRY from HudContext (Invariant 1: read the registry; no IWorld member, no new IWorld access). When active, each registered movable window/element gets a drag affordance and a visible move handle.
  * Pointer drag-reposition: dragging a window moves it; snap the resulting top-left to a fixed grid (define the grid step as a named constant); clamp within the viewport bounds so a window can never be dragged fully off-screen or under a safe-area inset (reuse the Phase 5 safe-area handling).
  * Single-pointer no-drag ALTERNATIVE for the move (WCAG 2.5.7, brief section 2): reuse the Phase 5 single-pointer drag util (src/ui/hud/a11y/pointer.ts), i.e. tap-to-pick-then-tap-to-place, so reposition never REQUIRES a drag gesture.
  * Apply positions via CSS (transform/inset on the window root) keyed by the registry id; update on state change only, never per frame; do not call getComputedStyle on a hot path (Invariant 5). Do NOT rename or repurpose any structural DOM id/class (Invariant 3) - position via style on the existing roots.
  * NO persistence here (Phase 27 owns localStorage/named layouts); positions live in memory/HudContext for this phase.
- Agent B - keyboard repositioning + Escape-stack + position announcements.
  Deliverables (in src/ui/hud/edit_mode.ts, coordinated with A):
  * Keyboard path (WCAG 2.1.1): when Edit Mode is active and a movable element is focused, Arrow keys NUDGE it by one grid step (Shift+Arrow or PageUp/Down for a larger step is a nice-to-have; the single-step nudge is required); the same grid snap + bounds clamp from A apply. Every movable element is focusable with a visible :focus-visible ring (2.4.7) and is not fully obscured when focused (2.4.11).
  * Escape-to-exit via the Phase 3 Escape stack (focus_trap.ts): Escape exits Edit Mode at the top of the stack per the brief's "Escape closes topmost first" policy; integrate, do not invent a parallel Escape handler. Edit Mode is a non-blocking editing layer over the live HUD, NOT a focus-trapped modal; do not trap movement keys outside Edit Mode (Invariant 6 - never swallow movement/hotkeys in normal play).
  * Announce positions via the Phase 3 announcer singleton (announcer.ts), polite role=status (brief section 3: role=status already implies aria-live=polite + aria-atomic; do not also set aria-live). On enter Edit Mode, on select/pick a window, and after each nudge or drop, announce the window name and its new position as a t() string; route any numeric coordinate through formatNumber (Invariant 2; brief section 8). Coalesce/replace rather than append so rapid nudges do not flood the speech queue (brief section 4).
  * Every new aria-label, the move-handle name, the Edit Mode enter/exit control label, and every announcement template is a t() key added to en in src/ui/i18n.en.ts and rendered via t(). Do NOT edit the locale overlays (maintainer batch-fills at release). No string concatenation for the assembled position read-out - compose via a t() template with formatNumber values.
- Agent C - tests/edit_mode.test.ts.
  Deliverables: unit tests in tests/edit_mode.test.ts (Vitest, happy-dom harness conventions from tests/hud_harness.test.ts):
  * Drag/nudge math: a drop or nudge snaps to the grid step and clamps within bounds (cannot exit the viewport).
  * Keyboard: an Arrow nudge on a focused window moves it exactly one grid step and re-clamps at an edge.
  * Registry read: Edit Mode enumerates the windows from the HudContext registry (no IWorld access).
  * Escape: Escape exits Edit Mode through the stack and restores normal input mode.
  * a11y: an axe assertion that Edit Mode active has no violations (move handles have accessible names, focus is visible); assert announcements fire on enter/select/nudge/drop with a t()-keyed (not hard-coded English) message. Cover, do not filter.
  NO persistence test here (that is Phase 27's localStorage round-trip).

=== INVARIANTS THIS PHASE MUST KEEP (by number, from state.md) ===
- 1 (IWorld-only / no new IWorld member): Edit Mode reads the window registry from HudContext; it must NOT add or touch an IWorld member and must NOT require a server change. If repositioning seems to need an IWorld member or any server-side write, STOP (see Stopping rules).
- 2 (t()-only render sink): EVERY new aria-label, move-handle name, toggle label, and announcement is a t() key present for en (src/ui/i18n.en.ts), rendered via t(); numeric positions via formatNumber; keep tests/localization_fixes.test.ts and `npx tsc --noEmit` green.
- 3 (DOM id/class contract): the ~214 structural ids that index.html/CSS depend on stay stable; reposition via style on existing window roots, never by renaming ids.
- 6 (keyboard-operable; single-pointer drag alternative from Phase 5): full keyboard nudge path; reuse the Phase 5 single-pointer alternative so reposition is never drag-only; Edit Mode must never swallow movement/hotkeys during normal play (it is a non-blocking layer, not a global trap).
- Visuals are DELIBERATELY changed by this packet (drag handles, move-mode chrome): re-baseline Playwright snapshots ONLY after reviewing the visual diff (state.md locked decision 7); an unreviewed --update-snapshots is not allowed.
- Invariant 5 (per-frame budget): position writes happen on state change only; no per-frame getComputedStyle, no new per-frame allocations.

=== OUT OF SCOPE (do NOT do these here) ===
- Named layouts, save/load/reset, and ANY persistence (localStorage or otherwise) - that is Phase 27.
- ANY server-side layout sync (characters.state JSONB or otherwise) - explicitly excluded; default is client-only.
- Window RESIZE / show-hide / full WoW Edit Mode parity - this phase is reposition (move) core only.
- New IWorld members, SimEvents, wire fields, endpoints, or tables.

=== STEP 3 - VALIDATION + MULTI-AGENT REVIEW ===
Run the validation matrix rows for "Edit Mode (localStorage)" + "A11y change" from state.md (this phase is client-only, a11y + a deliberate visual change):
1. `npx tsc --noEmit` (no type errors; the registry is typed; no new IWorld access).
2. `npx vitest run tests/edit_mode.test.ts tests/hud_harness.test.ts tests/hud_perf_budget.test.ts` (new tests pass; harness green; perf hot-write skip rate stays > 0.8).
3. `npx vitest run tests/localization_fixes.test.ts` (every new label/announcement is a t() key; the i18n guard stays green).
4. axe-core a11y assertions: `npx vitest run tests/a11y/*.test.ts` and/or `npx playwright test tests/a11y` - assert zero axe violations with Edit Mode ACTIVE (move handles named, focus visible, no obscured focus).
5. Playwright MCP live-game walkthrough (needs `npm run dev`, often `npm run server`; window.__game hook from memory): enter Edit Mode; drag a window (grid snap + bounds clamp visible); use the single-pointer tap-pick-tap-place alternative; keyboard-only: Tab to a window, Arrow-nudge it, confirm a VISIBLE focus ring; Escape exits Edit Mode and returns to normal input (movement keys work again). Switch locale and confirm NO English leak in any Edit Mode label/announcement/handle name. Toggle Reader Mode where relevant and confirm the announcer speaks positions. (Themes/text-scale: confirm Edit Mode chrome still renders under each, but the marquee toggles here are locale + keyboard + Reader Mode.)
6. Visual re-baseline (DELIBERATE): run `npx playwright test`, REVIEW the visual diff (Edit Mode handles/chrome are the expected delta), and only then `npx playwright test --update-snapshots`. Never update snapshots without inspecting the diff. Also capture a phone-viewport screenshot to confirm handles honor safe-area.
7. Build / pre-merge (mirrors CI): `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`; confirm the game bundle does NOT pull in the dev-only a11y deps (axe-core / @axe-core/playwright stay devDependencies).

Review-dispatch (state.md matrix - spawn ONLY agents whose surface the diff touches): this is a client-only diff (src/ui/hud/, src/ui/i18n.en.ts, tests). Spawn `qa-checklist` (every phase). Do NOT spawn privacy-security or migration-safety - they trigger only if Edit Mode adds server-side layout sync (it must not here). Do NOT spawn cross-platform-sync - it triggers only on an IWorld/sim/wire change (none here; if one appears, STOP). For Opus 4.8: also spawn a fresh subagent to review YOUR diff for correctness, a11y-spec conformance (2.5.7 single-pointer alternative present, 2.1.1 keyboard path, 4.1.3 announcements via role=status, t() on every string), and requirement gaps - not style.
Prompt every review/Explore agent for COVERAGE, not filtering (report everything, do not pre-judge what matters). If an agent truncates, resume it with: "Continue from where you left off; do not restart; return only the remaining findings." No commit while any BLOCKING finding is open.

=== STEP 4 - COMMIT CADENCE (explicit paths; never git add -A) ===
Stage only this card's files. Suggested 2-5 commits, Conventional Commits with a scope:
- `feat(ui): add Edit Mode drag-reposition with grid snap and bounds clamp` (src/ui/hud/edit_mode.ts, registry hookup in src/ui/hud/hud_context.ts if needed).
- `feat(a11y): keyboard nudge, Escape-stack exit, and position announcements for Edit Mode` (src/ui/hud/edit_mode.ts, src/ui/hud/a11y/* integration).
- `feat(a11y): add en t() keys for Edit Mode labels and position announcements` (src/ui/i18n.en.ts).
- `test(ui): cover Edit Mode snap/clamp, keyboard nudge, Escape, and axe a11y` (tests/edit_mode.test.ts).
- `docs(hud): mark Phase 25 Edit Mode core complete and update the ledger` (docs/hud-ux-and-accessibility/progress.md, docs/hud-ux-and-accessibility/state.md).

=== STEP 5 - ACCEPTANCE CRITERIA (mirror progress.md "Phase 25 - Edit Mode core") ===
- [ ] Drag-reposition of HUD windows/elements with grid snap and bounds clamping.
- [ ] Keyboard-accessible repositioning (arrow-key nudge) and an Escape-to-exit.
- [ ] Reads the modular window registry via HudContext; no IWorld change.
- [ ] A single-pointer no-drag alternative (tap-pick-tap-place, Phase 5 util) so reposition is never drag-only (WCAG 2.5.7).
- [ ] Positions announced on enter/select/nudge/drop via the Phase 3 announcer (role=status polite); every label/announcement a t() key; coordinates via formatNumber.
- [ ] axe clean with Edit Mode active; visible focus ring; tests/edit_mode.test.ts + harness + perf gate + i18n guard + tsc green; visuals re-baselined with a reviewed diff.

=== STEP 6 - DOC UPDATES + MEMORY ===
- progress.md: set Phase 25 status to complete (Started/Completed dates); tick the Phase 25 deliverable boxes; add a Notes line.
- state.md: update "Current phase"; fill the ledger line "(Phase 25/27) src/ui/hud/edit_mode.ts ..." with the actual file(s) created, the grid-step constant name, the new t() keys added, and any gotcha (e.g. how the registry exposes movable surfaces, the Escape-stack integration point). Record any OPEN item touched.
- Memory: add a short note under the hud topic (Edit Mode core landed: file path, registry symbol, grid-step constant, that persistence is still Phase 27, client-only).

=== STEP 7 - FINAL RESPONSE FORMAT (return as text, no report files) ===
- Status: complete / blocked / needs-input.
- Files touched (absolute paths).
- Validation results: tsc, vitest (edit_mode + harness + perf skip rate value + i18n guard), axe verdict, the Playwright live walkthrough outcome (locale no-leak, keyboard nudge + visible focus, Escape exit), and the visual re-baseline (diff reviewed? what changed?).
- Review verdicts: qa-checklist + the self-diff review (BLOCKING items resolved).
- Deferrals: anything pushed to Phase 27 (persistence/named layouts) or flagged.
- One-line handoff to QA (Phase 26).

=== STOPPING RULES ===
- STOP and surface if the cross-packet checkpoint is not met (no HudContext registry, no modular windows, no Phase 3 announcer / focus-trap, no Phase 5 pointer util).
- STOP and surface if repositioning appears to need an IWorld member, a SimEvent, a wire field, or ANY server-side change - this card is client-only (Invariant 1). Do not add an IWorld member to "make it work."
- STOP if the worktree is dirty with files you do not own (ask before touching).
- STOP if a movable surface cannot get an accessible name / keyboard path without a structural id rename (Invariant 3) - surface the conflict instead of renaming.
- Do not implement persistence or named layouts (Phase 27); if the design pulls you there, note it and stop at the in-memory core.
```
