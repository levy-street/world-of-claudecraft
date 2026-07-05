# Phase template: per-window visual + AAA accessibility pass (Phases 9-18)

REUSED PER WINDOW. This one file is the starter prompt for ALL ten window passes
(Phases 9-18: Spellbook, Bags, Character, Talents, QuestLog, Social, Trade,
Market, Arena, Options), one Claude Code session and one PR per window. It is
parameterized by `{Window}` (the window name), `{widget-types}` (the ARIA widget
types that window uses), `{N}` (the phase number), and `{card}` (the card id). Do
NOT author against this file verbatim: before starting, fill every `{...}`
placeholder from the per-window specifics table below, then re-grep the live
window module (anchors drift, never trust line numbers).

CROSS-PACKET PRECONDITION (hard stop): this pass restyles and instruments ONE
already-extracted window module. The `ui-architecture-hud-modularization` refactor
must have extracted that window first, so `src/ui/hud/{window}.ts` exists and the
`HudContext` seam (refactor Phase 11) plus the Phase 1/3/5 foundations (tokens,
a11y utilities, single-pointer drag) have landed. If `src/ui/hud/{window}.ts` does
not exist, STOP and surface (see state.md "Cross-packet dependency").

Validate the template itself on Spellbook (Phase 9) FIRST; later windows reuse the
proven flow.

## Per-window specifics (fill the placeholders from this row)

Source of the ARIA specs: `research-brief.md` section 3 (per-widget) and section 4
(focus + live-region model). Cite section 3 by widget when you instrument.

| {N} | {Window} | {widget-types} (research-brief sec 3) | Window-specific notes |
|---|---|---|---|
| 9 | Spellbook | listbox or grid (#6/#7) + tooltip (#5) | Template-validate here first. Tooltip is canvas-drawn: build the parallel `aria-describedby` description on the focusable host (sec 3 #5 POOR-FIT FLAG); honor 1.4.13 dismissible+persistent. Pinned non-blocking Spellbook is NOT `aria-modal` and must NOT trap focus (sec 3 #1). |
| 10 | Bags | grid (#6) + drag + tooltip (#5) | Single-pointer drag util (Phase 5) for item moves plus a "Move to..." keyboard path (2.5.7); roving tabindex with row-wrap (layout-grid behavior). Dense item tooltips use the inspect dialog (`role="dialog"`, sec 3 #5 OPEN resolved toward the inspect dialog for dense items). Tightest target grid: meet 2.5.8 via 24px + non-intersecting spacing. |
| 11 | Character | grid (#6, equipment) + a 3D preview canvas | The preview canvas needs a DOM/text equivalent for the a11y tree (state.md OPEN; research-brief sec 4 "canvas reality"): give the canvas `role="img"` + a `t()` label and a visually-hidden serialized equipped-stats summary updated on change only, never per frame. |
| 12 | Talents | grid or tree (#6) + tablist (#4) + staged-edit dialog (#1) | Keyboard tree navigation distinct from tab navigation (sec 3 #4 Talents wrinkle: Tab moves from the active tab INTO the tree); the staged-edit/apply flow is a modal dialog with focus-trap. Large window: use the ULTRACODE Workflow path below. |
| 13 | QuestLog | list or listbox (#7) + dialog (#1/#2) | List reflows to a 320px column (1.4.10); abandon-quest confirm is an `alertdialog` with required `aria-describedby` (sec 3 #2). |
| 14 | Social | tablist (#4) + listbox (#7) + live region (#8) | Friend/guild online-status announcements go through the announcer's `role="status"` polite channel (sec 3 #8, sec 4 per-surface plan); a roster row with both whisper and invite buttons may be a grid not a listbox (sec 3 #7 OPEN, decide per list). CVAA: messaging controls are ACS, keyboard-operable + SR-labeled (research-brief sec 2). |
| 15 | Trade | modal dialog (#1) + grid (#6) | `role="dialog"` `aria-modal="true"` with the Phase 3 focus-trap/inert/Escape/restore; suppress movement/ability handlers while open (sec 3 #1 load-bearing note); decline-trade confirm is an `alertdialog`; accept/confirm flow keyboard-operable (2.1.1). |
| 16 | Market | tablist (#4) + grid (#6) + slider (#11) | Price/quantity inputs prefer native `<input type="range">` (sec 3 #11); `aria-sort` on sortable columns and per-cell indices when virtualized (sec 3 #6); ALL prices via `formatMoney`, counts via `formatNumber`. Large window: use the ULTRACODE Workflow path. |
| 17 | Arena | dialog (#1) + live region (#8) + meter (#9) | Queue/match-state announcements via `role="status"` (sec 4 per-surface plan); meters use `role="meter"` with `aria-valuetext` at a coarse cadence, never per frame (sec 3 #9 PER-FRAME NOTE). |
| 18 | Options | tablist (#4) + slider (#11) + switch | Options HOSTS the theme picker, text-scale control, and Reader-Mode toggle. Phase 21 OWNS those controls; COORDINATE, do not duplicate. In this window pass, build the tablist/slider/switch a11y scaffolding and leave the theme/scale/Reader-Mode control wiring to Phase 21 (or, if Phase 21 has landed, instrument the controls it shipped without re-creating them). Switches use `role="switch"` + `aria-checked`; sliders prefer native range. |

---

### Starter Prompt

```
This is Phase {N} of the HUD Visual + UX + Accessibility feature: Per-window
visual + AAA accessibility pass for {Window}.

Model: Opus 4.8, max effort, 1m-context variant where the file load demands it.
Harness: Claude Code.
ULTRACODE: if {Window} is a large/batch-heavy window (Talents or Market: many
cells, tabs, dialogs, and events), add `ultracode` so you orchestrate this via a
small Workflow (fan-out restyle and instrumentation across the window's
sub-surfaces, then converge). For the smaller windows, hand-spawn agents; no
Workflow needed.

GOAL: Apply the dark-fantasy token restyle AND the AAA-where-feasible
accessibility instrumentation to the single extracted window module
`src/ui/hud/{window}.ts`, with no new image assets, no structural id renames, and
no new IWorld member.

STEP 0 - PRE-FLIGHT (stop on any failure):
- `git status` must be clean. This is a SHARED worktree; if dirty, ASK before
  touching anything and stage ONLY this card's files later with explicit paths
  (never `git add -A`). (memory: shared-worktree-commit-care)
- CROSS-PACKET CHECKPOINT (per state.md "Cross-packet dependency"): confirm
  `src/ui/hud/{window}.ts` EXISTS (the refactor extracted this window) and that
  the `HudContext` seam and the Phase 1 tokens, Phase 3 a11y utilities
  (`src/ui/hud/a11y/`: focus_trap, roving_tabindex, announcer, input_mode), and
  Phase 5 single-pointer drag (`src/ui/hud/a11y/pointer.ts`) have landed. If the
  window is NOT extracted, or a needed foundation is missing, STOP and surface;
  do not begin.
- Scan memory: `MEMORY.md` plus the notes hud, i18n, shared-worktree,
  never-push-to-fork, no-em-dashes-or-emojis, live-site-and-test-creds.
- Create the branch: `feature/{card}-{window}-polish` (one card, one branch, one
  PR). Push to origin (levy-street), NEVER the fork.

STEP 1 - LOAD CONTEXT (do NOT read the planning docs or any large module in the
main loop; do NOT read `src/ui/hud.ts`). Spawn ONE Explore agent to summarize and
return:
- `docs/hud-ux-and-accessibility/state.md` (locked decisions, the invariants by
  number, the validation matrix, the review-dispatch matrix).
- `docs/hud-ux-and-accessibility/research-brief.md` ONLY the sections this window
  needs: section 3 entry(ies) for {widget-types}, section 4 (focus + live-region
  model) if the window has modals or live regions, section 5 (token taxonomy) for
  the restyle, section 6 if the window drags or renders on touch.
- `docs/hud-ux-and-accessibility/progress.md` (the Phase {N} / {Window} row and
  acceptance criteria).
- This window's row in `phase-window-polish-template.md` (the per-window specifics).
- The SPECIFIC source files, listed individually (not a directory crawl):
  `src/ui/hud/{window}.ts`; the Phase 1 token block / `src/ui/hud/tokens.css` and
  the cached `readToken()` helper; the Phase 3 utilities under `src/ui/hud/a11y/`;
  the Phase 5 `src/ui/hud/a11y/pointer.ts` (only if this window drags);
  `src/ui/i18n.en.ts` and `src/ui/i18n.ts` (`t()`, `formatNumber`, `formatMoney`,
  `formatDateTime`); this window's existing test `tests/hud_{window}.test.ts` and
  the visual snapshot under `tests/visual/`.
- Anchors drift: instruct the agent to RE-GREP each named symbol (the window's
  render/open/close functions, its DOM ids, `QUALITY_COLOR` usage, the drag
  handlers) and report current locations, NOT line numbers from any doc.
Give every later agent ONLY this Explore summary, never the raw docs.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE.
Lightest tool that fits. For Talents/Market (ULTRACODE), drive a small Workflow;
otherwise hand-spawn. Name each agent and its deliverables; request fan-out
explicitly. Each agent gets only the Explore summary.
- Agent A (restyle): apply the dark-fantasy aesthetic to `src/ui/hud/{window}.ts`
  USING the Phase 1 primitive/semantic tokens (research-brief sec 5: gold trim via
  layered border + inset box-shadow bevels, parchment surface for the reading
  bodies, Cinzel display + Alegreya Sans body, text-outline/stroke tokens for
  legibility over the 3D scene). NO new image assets. NO structural id/class
  renames (the ~214-id contract, invariant 3). Restyle through tokens/classes only.
  Canvas tints read color via the cached `readToken()` (NOT re-imported JS hex,
  NOT `getComputedStyle` per frame). Deliverable: the restyled module + the diff.
- Agent B (a11y instrumentation): apply the ARIA role/state/keyboard model for
  {widget-types} per research-brief section 3 (cite the widget number). Specifically
  for {Window}: {fill the per-window specifics row}. Add roving tabindex (the Phase
  3 util) for every grid/list; wrap any MODAL window in the Phase 3
  focus-trap/inert/Escape/restore helper and suppress the window-level
  movement/ability handlers while open (sec 3 #1); use the Phase 5 single-pointer
  drag util wherever the window drags (item moves, window drag) and add the
  keyboard "Move to..." alternative (2.5.7). Make EVERY label, tooltip text,
  announcement, title, and placeholder a `t()` key added to `en` first
  (`src/ui/i18n.en.ts`); numbers via `formatNumber`, money via `formatMoney`,
  dates via `formatDateTime`. Meet contrast 1.4.3 (4.5:1 text / 3:1 large) and
  non-text contrast 1.4.11 (3:1), target size 2.5.8 (24px + non-intersecting
  spacing on dense grids), AAA where feasible (1.4.6 7:1 is cheap on the dark
  palette; treat as advisory, legibility wins over aesthetic). Live-region/value/
  aria-label writes happen on STATE CHANGE only (extend the dedup cache), never on
  the per-frame path. Deliverable: instrumented module + the new `t()` keys.
- Agent C (tests): extend `tests/hud_{window}.test.ts` with axe-core a11y
  assertions for the window's surface; add/adjust coverage for the new roles,
  roving tabindex, focus trap, and the `t()` labels. Deliverable: green window
  test with axe assertions.
DELIBERATE VISUAL CHANGE: this packet changes visuals on purpose. The
"baselines must not change" rule from the refactor is relaxed here (locked
decision 7); you WILL re-baseline this window's Playwright snapshot, but only
after reviewing the diff (STEP 3).

INVARIANTS THIS PHASE MUST KEEP (from state.md "Non-negotiable invariants",
cited by number):
- 2 (t()-only render sink): EVERY new aria-label, title, placeholder,
  announcement, and confirm/prompt string is a `t()` key present for `en`; numbers/
  money/dates via the formatters. Keep `tests/localization_fixes.test.ts` green.
- 3 (DOM id/class contract): the ~214 structural ids stay stable; visual changes
  go through tokens/classes, never id renames.
- 5 (per-frame budget): token reads on any canvas hot path go through the cached
  `readToken()` (no `getComputedStyle` per frame); add NO per-frame allocations;
  the hot-write skip rate stays above ~0.8 (`tests/hud_perf_budget.test.ts`).
- 6 (a11y does not regress gameplay): the input-mode gate never swallows movement/
  hotkeys in normal play; focus traps apply ONLY to modal UI (a pinned
  non-blocking window must not trap).
- DELIBERATE visual re-baseline with a REVIEWED diff (locked decision 7): never
  run `--update-snapshots` without first inspecting the diff.

OUT OF SCOPE (do NOT do here):
- Any OTHER window (one window per card; disjoint module).
- The persistent chrome (Phase 7), Reader Mode announcer WIRING to combat/cast/
  loot (Phase 19), the theme/text-scale/Reader-Mode CONTROLS themselves (Phase 21;
  for Options, coordinate, do not duplicate), AAA-wide audit (Phase 23), Edit Mode
  (Phases 25/27).
- New image assets; structural id/class renames; any new `IWorld` member, SimEvent,
  wire field, endpoint, or table (NONE expected; if a label needs one, STOP).
- Editing the 20 locale overlays (`src/ui/i18n.locales/<lang>.ts`): add `en` only;
  the maintainer batch-fills locales at release.

STEP 3 - VALIDATION + MULTI-AGENT REVIEW.
Run the state.md validation matrix for an A11y + visual/token change:
1. `npx tsc --noEmit`.
2. `npx vitest run tests/hud_{window}.test.ts tests/hud_harness.test.ts
   tests/hud_perf_budget.test.ts tests/localization_fixes.test.ts` (window test +
   harness + perf skip-rate gate + i18n guard all green).
3. AXE A11Y ASSERTIONS: `npx vitest run tests/a11y/*.test.ts` and/or
   `npx playwright test tests/a11y`; the window's own axe assertions (added in
   STEP 2) must pass with zero violations on its surface.
4. VISUAL: `npx playwright test` for this window's snapshot; it WILL fail
   (visuals changed on purpose). REVIEW the visual diff image first, confirm it
   matches the intended dark-fantasy restyle and nothing else regressed, THEN
   `npx playwright test --update-snapshots` to re-baseline deliberately. An
   UNREVIEWED snapshot update is not allowed.
5. MOBILE: run the mobile screenshot script at a phone viewport; confirm target
   sizes, safe-area, and reflow to a 320px column where applicable.
6. PLAYWRIGHT MCP LIVE-GAME WALKTHROUGH (live site/creds in memory
   live-site-and-test-creds; `window.__game` debug hook): open and close {Window};
   keyboard-only navigation through every interactive element with a VISIBLE focus
   ring; switch locale and confirm NO English leak (every label resolved via
   `t()`); where relevant, toggle themes / text-scale / Reader Mode and confirm
   the window recolors and scales. For modal windows, confirm Tab cycles inside,
   Escape closes, focus restores to the opener, and movement keys do not leak.
7. MANUAL: `npm run dev`, open/close {Window}, exercise the keyboard model by hand.
8. (Spellbook only) MANUAL SCREEN-READER PASS to validate the template's SR model
   before reusing it on the other nine windows.

REVIEW-DISPATCH (state.md matrix): spawn ONLY agents whose surface the diff
touches. This is a client-only window pass (`src/ui/hud/{window}.ts`, `src/ui/
i18n.en.ts`, `tests/`, snapshots), so it is `qa-checklist` only. Spawn
`migration-safety` or `privacy-security-review` ONLY if this window pass somehow
touches `server/`/`src/admin/`/`src/net/` or a `characters.state` path (it should
not). Spawn `cross-platform-sync` ONLY if `src/world_api.ts` or sim behavior is
touched (it should not; if a label seems to need an `IWorld` member, STOP). For
Opus 4.8, also have a FRESH subagent review your own diff for correctness, ARIA-
spec conformance, and requirement gaps (not style) before declaring done. Prompt
every review agent for COVERAGE, not filtering ("report every issue you find on
your surface; do not pre-filter by severity"). If an agent's output is truncated,
resume it with: "Continue from where you were truncated; do not restart."
No commit until there is no BLOCKING finding.

STEP 4 - COMMIT CADENCE (explicit paths only, NEVER `git add -A`; 2 to 3 commits):
- `style(ui): restyle {Window} to dark-fantasy tokens`
  (paths: `src/ui/hud/{window}.ts`, any window-scoped CSS).
- `a11y(ui): instrument {Window} (roles, roving tabindex, focus-trap, t() labels)`
  (paths: `src/ui/hud/{window}.ts`, `src/ui/i18n.en.ts`).
- `test(ui): {Window} a11y + visual coverage`
  (paths: `tests/hud_{window}.test.ts`, the re-baselined `tests/visual/` snapshot,
  and the docs updated in STEP 6).

STEP 5 - ACCEPTANCE CRITERIA (mirrors progress.md; all must hold):
[ ] Dark-fantasy aesthetic applied to {Window} via the Phase 1 tokens (no new
    image assets, no structural id renames).
[ ] The ARIA role/state/keyboard spec for {widget-types} is met per research-brief
    section 3 (roles, states, keyboard model, live regions where applicable).
[ ] Roving tabindex on every grid/list; modal windows wrapped in the focus-trap/
    inert/Escape/restore helper; single-pointer drag + keyboard alternative where
    the window drags.
[ ] Every label, tooltip, and announcement is a `t()` key (numbers/money/dates via
    the formatters); `tests/localization_fixes.test.ts` and `tsc` green.
[ ] Contrast (1.4.3 / 1.4.11) and target size (2.5.8) met, AAA where feasible.
[ ] The window test plus its axe assertions are green; harness + perf skip-rate
    gate green.
[ ] Visual snapshot re-baselined with a REVIEWED diff.
[ ] {Window} opens, closes, and keyboard-navigates correctly in `npm run dev` and
    in the Playwright MCP walkthrough with no English leak.

STEP 6 - DOC UPDATES + MEMORY:
- `docs/hud-ux-and-accessibility/progress.md`: set the Phase {N} / {Window} row to
  complete (branch, dates) and check off its deliverable + acceptance boxes.
- `docs/hud-ux-and-accessibility/state.md`: append to the ledger any NEW tokens,
  a11y utilities reused, and `t()` keys this window added; note any per-window
  decision that resolved an OPEN item (e.g. listbox-vs-grid for this window, the
  tooltip exposure choice, the canvas DOM-equivalent shape).
- Memory: add a short note under the hud / i18n topics recording this window is
  polished, the keys added, and any reusable instrumentation pattern.

STEP 7 - FINAL RESPONSE FORMAT (return exactly this):
- Status: complete / blocked, and which window/phase.
- Files touched (absolute paths).
- Validation results: tsc, the four vitest files, axe (violation count), the
  visual re-baseline (reviewed: yes), mobile screenshot, the Playwright MCP
  walkthrough (locale leak: none / list), and (Spellbook) the SR pass.
- Review verdicts: qa-checklist and the fresh-subagent diff review, with any
  non-blocking deferrals.
- Deferrals: anything punted to a later phase (Reader Mode wiring, theme controls,
  Edit Mode) and why.
- One-line handoff to QA (the `qa-phase-template.md` session for this window).

STOPPING RULES (stop and surface; do NOT push through):
- The window is NOT yet extracted (`src/ui/hud/{window}.ts` missing) or a needed
  Phase 1/3/5 foundation has not landed: refactor/foundation dependency unmet.
- A required label cannot become a `t()` key without adding a new `IWorld` member
  (or any new SimEvent/wire field/endpoint/table): this packet is client-only;
  STOP and surface rather than extend the seam.
- Instrumentation drops the hot-write skip rate below ~0.8 or adds any per-frame
  cost (e.g. a per-frame `getComputedStyle` or new per-frame allocation): back it
  out and route the write to state-change only.
- `git status` was dirty at pre-flight and ownership of the stray files is unclear
  (shared worktree): ASK before proceeding.
- A visual diff shows an UNINTENDED regression (not the planned restyle): fix it
  before re-baselining; do not snapshot over a regression.
```
