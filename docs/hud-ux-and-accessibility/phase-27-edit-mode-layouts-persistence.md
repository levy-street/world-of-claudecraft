# Phase 27 (impl): Edit Mode, named layouts + persistence

Copy the fenced block below into a fresh Claude Code session. It is
self-contained; do not rely on this surrounding prose at runtime.

### Starter Prompt

```
This is Phase 27 of the HUD Visual + UX + Accessibility feature: Edit Mode, named layouts + persistence.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it. Harness: Claude Code.
ULTRACODE: this phase is moderately batch-heavy (a layout model, save/load/reset/default-restore, a localStorage round-trip test, and a layout-management UI with many t() labels across the editor surface). Add `ultracode` so you orchestrate the two-agent fan-out via a Workflow and keep validation gates green between batches. If you keep it lean, the two-agent split below is fine without it.

GOAL: Add named HUD layouts to Edit Mode: save, load, reset, and a restorable built-in default, persisted to localStorage with a mandatory round-trip test, plus the layout-management UI (every label a t() key).

================================================================
STEP 0 - PRE-FLIGHT
================================================================
1. Shared worktree. Run `git status`. The tree is shared across concurrent sessions. If it is dirty with files that are NOT yours, STOP and ask the user before touching anything. Never `git add -A`; stage only this card's explicit paths.
2. CROSS-PACKET CHECKPOINT (mandatory; per docs/hud-ux-and-accessibility/state.md "Cross-packet dependency"). This phase depends on Phase 25 (Edit Mode core) having landed: `src/ui/hud/edit_mode.ts` must exist with drag-reposition, grid snap, bounds clamping, keyboard nudge, Escape-to-exit, and it must read the modular window registry via `HudContext` (the refactor's `HudContext` seam, refactor Phase 11, and the windows instrumented). Confirm `src/ui/hud/edit_mode.ts` exists and exposes a way to read and apply the current per-window layout state (positions/scale/visibility) through `HudContext`. If `edit_mode.ts` is absent or has no layout-state accessor, STOP and surface to the user; do not build persistence on a missing core.
3. Memory scan. Read /Users/fernando/.claude/projects/-Users-fernando-Documents-world-of-claudecraft/memory/MEMORY.md and the notes it indexes for: hud, i18n, shared-worktree, never-push-to-fork, no-em-dashes-or-emojis, live-site-and-test-creds. Honor all of them (push branches/PRs to origin levy-street, never the FernandoX7 fork; no em dashes or emojis anywhere; live creds fernando/turbo564 and the window.__game hook for the Playwright walkthrough).
4. Branch. Create the phase branch off the current up-to-date base: `feature/p27-edit-mode-layouts-persistence`. One card, one branch, one PR.

================================================================
STEP 1 - LOAD CONTEXT (do NOT read planning docs or src/ui/hud.ts directly)
================================================================
Spawn ONE Explore agent. Tell it to read and return a tight summary (no full-doc paste), covering:
- docs/hud-ux-and-accessibility/state.md: locked decisions (esp. 6: localStorage first, server sync OPEN; 7: deliberate visual re-baseline), the non-negotiable invariants (esp. 2 t()-only render sink and 8 no em dashes/emojis), the validation matrix row for "Edit Mode (localStorage)", the review-dispatch matrix, the ledger line "(Phase 25/27) src/ui/hud/edit_mode.ts, layout persistence, tests/edit_mode.test.ts", and the OPEN item on Edit Mode server sync.
- docs/hud-ux-and-accessibility/research-brief.md: section 3 ARIA specs for the widgets the layout-management UI will use (1 Modal dialog and/or 2 Alert dialog for a destructive reset confirm; 7 Listbox for the saved-layouts list; 11 Slider / native controls if any; the t()-key reminder that opens section 3); section 7 (what WoW Edit Mode ships: "named, saved, copyable, importable layout profiles" as the north star, scope this phase to named save/load/reset + default, NOT copy/import unless trivial); section 8 i18n mapping (every label/aria/title/confirm a t() key) and the "no new framework, prefer native <dialog>" note.
- docs/hud-ux-and-accessibility/progress.md: the Phase 27 deliverables/acceptance block ("Save/load/reset named layouts; default layout restorable" and "localStorage persistence with a round-trip test (server sync remains OPEN)") and the QA checklist.
- This starter prompt (so the agent can flag any drift).
- The SPECIFIC source files, listed individually (re-grep named anchors; do NOT trust line numbers, they drift):
  - src/ui/hud/edit_mode.ts (Phase 25 core). Re-grep for the layout-state accessor on HudContext: search for the symbols the core exposes (grep the file for `layout`, `applyLayout`, `getLayout`, `HudContext`, `position`, `snap`). Summarize the exact in/out shape of the current layout state so persistence serializes the real thing.
  - src/game/settings.ts (the canonical localStorage pattern to MIRROR, not duplicate carelessly). Re-grep for `STORE_KEY`, `localStorage.getItem`, `localStorage.setItem`, `JSON.parse`, `JSON.stringify` and the try/catch around each (corrupt-load catch, storage-unavailable save catch). Summarize the load-default-merge-save shape and the versioning, if any.
  - src/ui/i18n.en.ts (where new English t() keys go; do NOT touch the locale overlays in src/ui/i18n.locales).
  - tests/localization_fixes.test.ts (the i18n guard that must stay green) and tests/edit_mode.test.ts if Phase 25 created it (extend it; otherwise this phase adds it).
Give the two execution agents below ONLY this Explore summary, not the raw docs.

================================================================
STEP 2 - CHOOSE ORCHESTRATION + EXECUTE
================================================================
Fan out TWO agents explicitly (request parallel fan-out). They share `src/ui/hud/edit_mode.ts`, so either serialize A before B or run with `isolation: "worktree"` and merge; A defines the model B persists, so prefer A first, then B, unless you isolate.

AGENT A - Named-layout model + save/load/reset + default-layout restore (logic, in edit_mode.ts or a sibling module under src/ui/hud/):
- Define a serializable NamedLayout type: a stable name plus the per-window layout state already produced by the Phase 25 core (positions/scale/visibility for each registered window), and a schema version integer for forward back-compat. Reuse the core's existing layout-state shape; do not invent a parallel one.
- Implement, reading/writing through HudContext (no IWorld change):
  - saveLayout(name): snapshot the current live layout into a NamedLayout under that name (overwrite if the name exists).
  - loadLayout(name): apply a stored NamedLayout back through the Phase 25 apply path so windows actually move.
  - resetLayout(): restore the built-in DEFAULT layout (and apply it).
  - listLayouts() / deleteLayout(name) as needed by the UI.
  - A built-in DEFAULT_LAYOUT that captures the shipped HUD positions, always restorable and never deletable. Derive it from the core's initial state (or capture-on-first-run); do not hardcode pixel literals that will drift, prefer reading the registry defaults.
- Keep it deterministic and DOM-light in the model layer; the model is plain data + functions, the actual DOM moves go through the Phase 25 apply path.
- Deliverables: the layout model + the four operations + DEFAULT_LAYOUT restore, wired to HudContext, with clear function signatures B can call.

AGENT B - localStorage persistence + round-trip test + layout-management UI (all t() labels):
- Persistence: MIRROR the src/game/settings.ts pattern exactly. A dedicated STORE_KEY (e.g. `woc.hud.layouts.v1`), load with `JSON.parse(localStorage.getItem(KEY) ?? '...')` inside try/catch (swallow corrupt with a comment, fall back to no saved layouts), save with `localStorage.setItem(KEY, JSON.stringify(...))` inside try/catch (swallow storage-unavailable with a comment). Persist the named layouts on every save/delete/reset that should stick; load them at Edit Mode init. Keep the schema version so a future bump migrates rather than throws.
- MANDATORY round-trip test (this is the gate for this phase, per the state.md "Edit Mode (localStorage)" matrix row): in tests/edit_mode.test.ts, save a named layout, simulate a reload (re-instantiate the persistence/model against the same backing store, e.g. a mocked or in-memory localStorage in the happy-dom harness), and assert the restored layout deep-equals what was saved. Also test: reset restores DEFAULT; a corrupt localStorage value loads as empty without throwing; loading a missing name is a no-op or surfaces cleanly. Extend the existing tests/edit_mode.test.ts if Phase 25 created it; otherwise create it.
- Layout-management UI: a small panel inside Edit Mode to name + save the current layout, pick a saved layout from a list and load it, delete a saved layout, and a Reset-to-default control. Use native <dialog> for any modal save/name prompt and an alertdialog-pattern confirm for the destructive Reset/Delete (research-brief section 3 patterns 1, 2, 7; saved-layouts list as a listbox or a simple labeled button list). EVERY visible string is a t() key added to en first (src/ui/i18n.en.ts): the panel title, the "Save layout" / "Load" / "Delete" / "Reset to default" labels, the name-input aria-label and placeholder, the saved-layouts list aria-label, each confirm dialog's accessible name and required describedby message, and any status/announcer text ("Layout saved", "Layout reset"). Do NOT edit src/ui/i18n.locales overlays. Numbers (if any layout-count text) go through formatNumber.
- Deliverables: persistence wired to A's model, the round-trip + edge tests green, the layout-management UI with full t() coverage.

Give each agent ONLY the Explore summary. After both land, you (the main loop) reconcile edit_mode.ts and run STEP 3.

================================================================
INVARIANTS THIS PHASE MUST KEEP (cited by number from state.md)
================================================================
- Invariant 2 (t()-only render sink): EVERY new aria-label, title, placeholder, button label, list label, dialog name, required describedby message, and announcer/status string in the layout-management UI is a t() key present for `en` (you add English only; the maintainer fills the 20 locale overlays at release). Numbers via formatNumber/formatMoney/formatDateTime/Intl. tests/localization_fixes.test.ts and `npx tsc --noEmit` must stay green.
- Invariant 8 (no em dashes or emojis): none in any doc, comment, or player-facing string.
- Also still hold (do not regress): Invariant 1 (IWorld-only; this phase adds NO IWorld member, layout state lives on HudContext + localStorage; if you feel you need an IWorld change, STOP and surface), Invariant 6 (a11y must not regress gameplay; the layout UI lives inside Edit Mode, a modal/UI-mode surface, and must not swallow movement/hotkeys outside it), Invariant 7 (shared-worktree hygiene: explicit paths, never git add -A).
- Deliberate visual re-baseline (locked decision 7): this packet changes visuals on purpose. The layout-management UI is new chrome; when its appearance shifts the Playwright baselines, re-baseline ONLY after reviewing the diff (see STEP 3). An unreviewed `--update-snapshots` is not allowed.
- A persistence round-trip test is MANDATORY this phase; the phase is not done without it.

================================================================
OUT OF SCOPE (do NOT implement)
================================================================
- Server-side per-character layout sync. This is the OPEN item in state.md and brainstorm.md section 9. It would add server scope, additive idempotent DDL, a characters.state JSONB back-compat path, and a migration-safety + privacy-security review. localStorage ONLY in this phase.
- Copy/import/export of layouts between characters or accounts (WoW ships these; defer unless a single trivial JSON-string export falls out for free, and even then only if it adds no server surface).
- New IWorld members, SimEvents, wire fields, endpoints, or DB tables (state.md says NONE expected).
- Any change to the Phase 25 drag/snap/nudge core behavior beyond exposing the layout-state accessor it already provides.

================================================================
STEP 3 - VALIDATION + MULTI-AGENT REVIEW
================================================================
Run the state.md validation matrix row for "Edit Mode (localStorage)" PLUS the always-on a11y/visual checks (re-grep exact script names; commands drift):
1. `npx tsc --noEmit` (catches a renamed/missing t() key and type drift).
2. `npx vitest run tests/edit_mode.test.ts` (the MANDATORY round-trip + edge tests).
3. The HUD harness + perf gate: `npx vitest run tests/hud_harness.test.ts tests/hud_perf_budget.test.ts` (skip-rate stays above ~0.8; the layout UI must not add per-frame work).
4. The i18n guard: `npx vitest run tests/localization_fixes.test.ts`.
5. axe-core a11y assertions on the new layout-management UI: run the a11y suite (`npx vitest run tests/a11y/*.test.ts` and/or `npx playwright test tests/a11y`). Assert: the modal save/name dialog and the destructive Reset/Delete confirm have role + accessible name + required describedby; the saved-layouts list has a label and correct list/option (or button) semantics; focus moves into the dialog on open and restores to the opener on close; Escape closes; no keyboard trap; visible focus ring on every control; target sizes meet the floor.
6. A Playwright MCP live-game walkthrough (use the live creds / window.__game hook): enter Edit Mode, save a named layout, move a window, load a different layout and confirm windows actually move, Reset-to-default and confirm windows return, reload the page and confirm the saved layout persisted. During the walkthrough: switch locale and confirm NO English leak in any new label/dialog/announcer string; toggle a theme and text-scale and confirm the layout UI restyles via tokens (no hardcoded color/size); drive the whole flow keyboard-only with a visible focus ring at every step. Reader Mode is not central here but confirm save/reset surface a polite status announcement if the announcer is present.
7. Deliberate visual re-baseline: run `npx playwright test`; if the new layout-management chrome changes baselines, REVIEW THE DIFF first (open the diff images), confirm the change is intended and only the new UI, then `npx playwright test --update-snapshots`. Never update snapshots blind.
8. Build/pre-merge (mirrors CI): `npm test && npx tsc --noEmit && npm run build:env && npm run build:server && npm run build`; confirm the final `npm run build` game bundle does NOT pull in the dev-only a11y deps.

REVIEW-DISPATCH (spawn ONLY agents whose surface this diff touches; state.md matrix):
- This phase is CLIENT-ONLY (src/ui/hud, src/ui/i18n.en.ts, tests). So spawn `qa-checklist` only.
- Do NOT spawn `migration-safety` or `privacy-security-review`: they trigger only if Edit Mode adds server-side layout sync (the OUT-OF-SCOPE OPEN item). If you somehow touched server/ or a *_db.ts or characters.state, STOP, you have left scope.
- Do NOT spawn `cross-platform-sync`: it triggers only on src/world_api.ts / src/sim / src/net / server wire changes. If you touched IWorld, STOP and surface.
- Plus a fresh subagent (Opus 4.8) to review YOUR diff for correctness, a11y-spec conformance (dialog/listbox patterns), and requirement gaps (default-layout restore present? round-trip test real? every label a t() key?), not style.
Prompt every review agent for COVERAGE, not filtering: report every issue found, do not pre-judge severity away. If an agent's report is truncated, resume it with: "Continue the review from where you left off; do not repeat already-reported findings." No commit until there is no BLOCKING finding.

================================================================
STEP 4 - COMMIT CADENCE (explicit paths only; never git add -A)
================================================================
2 to 5 commits, Conventional Commits with a scope, explicit file paths:
- `feat(ui): named HUD layout model with save/load/reset and default restore` (edit_mode.ts / sibling model).
- `feat(ui): persist HUD layouts to localStorage (settings-pattern, versioned)`.
- `test(ui): layout persistence round-trip + reset/corrupt/missing edge tests` (tests/edit_mode.test.ts).
- `feat(a11y): layout-management UI with t() labels and accessible dialogs` (UI + src/ui/i18n.en.ts).
- `docs(hud-ux): record Phase 27 in progress.md and the state.md ledger`.
Stage only the paths you touched. Push the branch to origin (levy-street), open one PR. Never push to the fork.

================================================================
STEP 5 - ACCEPTANCE CRITERIA (mirrors progress.md Phase 27)
================================================================
- [ ] Save / load / reset named layouts implemented through HudContext (no IWorld change).
- [ ] A built-in default layout is restorable (and never deletable).
- [ ] localStorage persistence mirrors the src/game/settings.ts pattern (versioned, try/catch on load and save).
- [ ] A MANDATORY persistence round-trip test passes (save, simulate reload, assert restored deep-equals), plus reset-restores-default, corrupt-loads-empty, and missing-name edge tests.
- [ ] Layout-management UI ships: name + save, pick + load, delete, reset-to-default, with accessible dialog/list semantics.
- [ ] Every new visible string is a t() key in src/ui/i18n.en.ts; locale overlays untouched; i18n guard + tsc green.
- [ ] Server sync NOT implemented (remains OPEN); no server/IWorld/DB surface touched.
- [ ] axe-core a11y assertions green; keyboard-only walkthrough passes with visible focus; no English leak under a non-English locale; visuals re-baselined only with a reviewed diff.

================================================================
STEP 6 - DOC UPDATES + MEMORY
================================================================
- progress.md: set Phase 27 status to complete with the date; tick its deliverable/acceptance boxes; add a Notes line (final STORE_KEY, schema version, the DEFAULT_LAYOUT approach, and that server sync stays OPEN).
- state.md: update the ledger line "(Phase 25/27) src/ui/hud/edit_mode.ts, layout persistence, tests/edit_mode.test.ts" with the concrete additions (the layout model module/symbols, the localStorage STORE_KEY + schema version, tests/edit_mode.test.ts round-trip); add the new t() keys to the i18n note's running list; confirm the "New IWorld members / ... tables" section still reads NONE; if the server-sync OPEN item is now decided, record the decision, otherwise leave it OPEN.
- Memory: append a short note to the hud / i18n memory area: Phase 27 landed named HUD layouts persisted to localStorage (STORE_KEY + version), default-layout restore, round-trip test in tests/edit_mode.test.ts, server sync deferred (OPEN). Commit docs with the implementation, explicit paths.

================================================================
STEP 7 - FINAL RESPONSE FORMAT (return as your final message text)
================================================================
- Status: done / blocked / needs-input, one line.
- Files touched: absolute paths, grouped (model, persistence, UI, tests, i18n.en, docs).
- Validation results: tsc, vitest (name the edit_mode round-trip result explicitly), harness + perf skip-rate, i18n guard, axe assertions, Playwright (locale no-leak + keyboard + theme), and the visual re-baseline verdict (diff reviewed: yes/no, what changed).
- Review verdicts: qa-checklist + the diff-review subagent, with any BLOCKING items and how resolved.
- Deferrals: server-side layout sync (OPEN) and any copy/import deferred.
- One-line handoff to QA (Phase 28 / the QA template): what to re-verify and any residual risk.

================================================================
STOPPING RULES
================================================================
- STOP and surface to the user BEFORE adding ANY server-side persistence (characters.state JSONB, DDL, an endpoint, src/net or server wire). This phase is localStorage ONLY; server sync is the explicit OPEN item and needs a user decision because it adds server scope plus a migration-safety and privacy-security review.
- STOP if STEP 0 finds src/ui/hud/edit_mode.ts missing or without a layout-state accessor (Phase 25 not landed); do not build persistence on a missing core.
- STOP if the work seems to need a new IWorld member, SimEvent, wire field, endpoint, or DB table (state.md says NONE expected).
- STOP if `git status` shows another session's uncommitted files at pre-flight.
- STOP at any BLOCKING review finding and resolve before committing; do not declare done on "looks done", anchor on the green gates above.
```
